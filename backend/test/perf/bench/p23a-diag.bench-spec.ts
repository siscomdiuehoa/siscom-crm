// B1.2.3-B2 P2-3a BƯỚC A – CHẨN ĐOÁN, CHỈ ĐỌC, trên bản sao PERF đã ANALYZE. Chạy khi BENCH_P23A_DIAG=1 (cờ -P23aDiag -CloneOf).
// Mọi truy vấn chạy trong giao dịch READ ONLY + statement_timeout 120 s (không tăng). Biến thể A1/A2 chỉ nằm trong file này, KHÔNG đưa vào src.
// Công thức relevance, tie-break c.code DESC, COUNT (count(*) OVER ()), phân quyền: giữ nguyên; tập ứng viên KHÔNG bị giới hạn trước khi tính điểm/sắp xếp.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../src/generated/prisma/client';
import type { Scope } from '../../../src/common/auth/actor';
import { buildOuterWhere, buildSearchPageQuery, buildSearchWhere, chooseSearchPath, textBranches, type SearchWhereInput } from '../../../src/modules/customers/customers.search';
import { buildOrderBy, CUSTOMER_DETAIL_INCLUDE } from '../../../src/modules/customers/customers.queries';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { as, makeApp, TestActorProvider, TestApp } from '../../helpers/test-app';
import { assertTestConnection, createTestPrisma } from '../../helpers/test-db';
import type { Fixtures } from '../../helpers/fixtures';
import { loadFixturesReadOnly } from './readonly-fixtures';

const ON = process.env.BENCH_P23A_DIAG === '1';
const GATE = { 'nguyen van': 450, mi: 1350, an: 1350 } as Record<string, number>; // cổng KỸ THUẬT mức SQL (không thay ngưỡng API 500/1500)
const BUDGET_MS = Number(process.env.BENCH_DIAG_BUDGET_MIN ?? 30) * 60000;
const T0 = Date.now(); const RUNS = 5;
type V = 'S0' | 'A1' | 'A2'; const VARS: V[] = ['S0', 'A1', 'A2'];
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let dbName = '';
const prov = (): TestActorProvider => new TestActorProvider(fx);
const report: Record<string, unknown> = { kind: 'B1.2.3-B2-P2-3a-stepA-diag', startedAt: new Date().toISOString(), gates: GATE, runsPerVariant: RUNS };
const failures: string[] = [];
const left = (): boolean => Date.now() - T0 < BUDGET_MS;
const r1 = (x: number): number => Math.round(x * 10) / 10;
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)] as number;
const busyNow = async (): Promise<number> => (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`)[0]?.n ?? 0;
const counts = async () => (await prisma.$queryRaw<Record<string, number>[]>`SELECT (SELECT count(*)::int FROM customer) AS customer, (SELECT count(*)::int FROM contact) AS contact, (SELECT count(*)::int FROM audit_log) AS audit_log`)[0];

async function ro<T>(f: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await tx.$executeRaw`SET LOCAL statement_timeout = '120s'`; return f(tx); }, { timeout: 200000, maxWait: 10000 });
}
function parts(p: SearchWhereInput, path: 'union' | 'or'): { from: Prisma.Sql; where: Prisma.Sql } {
  if (path === 'or') return { from: Prisma.sql`customer c`, where: buildSearchWhere(p) };
  const sel = textBranches(p).flatMap((b) => b.union);
  return { from: Prisma.sql`customer c JOIN (${Prisma.join(sel, ' UNION ')}) cand ON cand.id = c.id`, where: buildOuterWhere(p) };
}
const score = (f: string): Prisma.Sql => Prisma.sql`greatest(public.similarity(public.f_vn_fold(c.name), ${f}), coalesce(public.similarity(public.f_vn_fold(c.short_name), ${f}), 0), coalesce(k.m, 0))`;
function vq(v: V, p: SearchWhereInput, dir: 'asc' | 'desc', limit: number, offset: number): Prisma.Sql {
  const path = chooseSearchPath(p.folded, false);
  if (v === 'S0') return buildSearchPageQuery(p, path, { sortBy: 'relevance', order: dir }, limit, offset); // đúng truy vấn API hiện tại
  const d = dir === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC'); const m = parts(p, path);
  const tail = Prisma.sql`ORDER BY ${score(p.folded)} ${d}, c.code DESC LIMIT ${limit}::int OFFSET ${offset}::int`;
  if (v === 'A1') return Prisma.sql`WITH cand0 AS MATERIALIZED (SELECT c.id FROM ${m.from} WHERE ${m.where}) SELECT c.id, count(*) OVER ()::int AS total FROM customer c JOIN cand0 ON cand0.id = c.id LEFT JOIN (SELECT ct.customer_id, max(public.similarity(public.f_vn_fold(ct.full_name), ${p.folded})) AS m FROM contact ct JOIN cand0 x ON x.id = ct.customer_id WHERE ct.deleted_at IS NULL GROUP BY ct.customer_id) k ON k.customer_id = c.id ${tail}`;
  return Prisma.sql`SELECT c.id, count(*) OVER ()::int AS total FROM ${m.from} LEFT JOIN (SELECT ct.customer_id, max(public.similarity(public.f_vn_fold(ct.full_name), ${p.folded})) AS m FROM contact ct WHERE ct.deleted_at IS NULL GROUP BY ct.customer_id) k ON k.customer_id = c.id WHERE ${m.where} ${tail}`;
}
async function run(v: V, p: SearchWhereInput, dir: 'asc' | 'desc', limit: number, offset: number): Promise<{ ids: string[]; total: number; ms: number }> {
  return ro(async (tx) => { const s = performance.now(); const rows = await tx.$queryRaw<{ id: string; total: number }[]>(vq(v, p, dir, limit, offset)); return { ids: rows.map((r) => r.id), total: rows[0] ? Number(rows[0].total) : 0, ms: performance.now() - s }; });
}
type PlanNode = Record<string, unknown>;
function walk(n: PlanNode, acc: PlanNode[]): void { acc.push(n); for (const c of (n['Plans'] as PlanNode[] | undefined) ?? []) walk(c, acc); }
function summarize(rows: Record<string, unknown>[]): Record<string, unknown> {
  const root = (rows[0]?.['QUERY PLAN'] as PlanNode[] | undefined)?.[0] ?? {}; const plan = (root['Plan'] ?? {}) as PlanNode; const all: PlanNode[] = []; walk(plan, all);
  return {
    executionMs: root['Execution Time'], planningMs: root['Planning Time'], rootSharedHit: plan['Shared Hit Blocks'], rootSharedRead: plan['Shared Read Blocks'], rootTempWritten: plan['Temp Written Blocks'],
    nodeTypes: [...new Set(all.map((n) => String(n['Node Type'])))],
    seqScans: all.filter((n) => n['Node Type'] === 'Seq Scan').map((n) => ({ relation: n['Relation Name'], rows: n['Actual Rows'], loops: n['Actual Loops'], ms: n['Actual Total Time'] })),
    subPlans: all.filter((n) => n['Parent Relationship'] === 'SubPlan' || n['Subplan Name']).map((n) => ({ name: n['Subplan Name'], type: n['Node Type'], loops: n['Actual Loops'], msPerLoop: n['Actual Total Time'], rows: n['Actual Rows'] })),
    aggregates: all.filter((n) => n['Node Type'] === 'Aggregate').map((n) => ({ strategy: n['Strategy'], rows: n['Actual Rows'], ms: n['Actual Total Time'] })),
    sorts: all.filter((n) => n['Node Type'] === 'Sort').map((n) => ({ method: n['Sort Method'], space: n['Sort Space Used'], rows: n['Actual Rows'], ms: n['Actual Total Time'] })),
    ctes: all.filter((n) => n['Node Type'] === 'CTE Scan').length,
  };
}
const explain = async (q: Prisma.Sql): Promise<Record<string, unknown>> => ro(async (tx) => { const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`); return { ...summarize(rows), raw: rows[0]?.['QUERY PLAN'] }; });
const fold = async (s: string): Promise<string> => (await prisma.$queryRaw<{ t: string }[]>`SELECT public.f_vn_fold(btrim(${s})) AS t`)[0]?.t ?? '';

(ON ? describe : describe.skip)('P2-3a bước A: chẩn đoán relevance + trang 100 (chỉ đọc)', () => {
  let scopes: { who: string; actor: SearchWhereInput['actor']; scope: Scope }[] = [];
  const inp = async (term: string, who = 'all'): Promise<SearchWhereInput> => { const s = scopes.find((x) => x.who === who) as { actor: SearchWhereInput['actor']; scope: Scope }; return { actor: s.actor, folded: await fold(term), raw: term, deletedOnly: false, readScope: s.scope, restoreScope: null, ids: {} }; };
  beforeAll(async () => {
    const c = createTestPrisma(); prisma = c.prisma; dbName = c.name;
    if (!process.env.BENCH_EXPECT_DB || process.env.BENCH_EXPECT_DB !== dbName) throw new Error('BENCH_EXPECT_DB phải trùng tên database thử.');
    await assertTestConnection(prisma, dbName);
    fx = await loadFixturesReadOnly(prisma);
    if ((await busyNow()) > 0) throw new Error('Có phiên khác đang hoạt động trên DB thử. Dừng.');
    const perf = (await prisma.$queryRaw<{ c: number; ct: number }[]>`SELECT (SELECT count(*)::int FROM customer WHERE legacy_id LIKE 'PERF-%') AS c, (SELECT count(*)::int FROM contact c JOIN customer x ON x.id = c.customer_id WHERE x.legacy_id LIKE 'PERF-%') AS ct`)[0];
    if (perf?.c !== 50000 || perf?.ct !== 100000) throw new Error('DB không phải bộ PERF 50.000/100.000. Dừng.');
    const st = (await prisma.$queryRaw<{ nf: number | null; actual: number }[]>`SELECT (SELECT null_frac::float8 FROM pg_stats WHERE schemaname = 'public' AND tablename = 'customer' AND attname = 'owner_id') AS nf, (SELECT (count(*) FILTER (WHERE owner_id IS NULL))::float8 / greatest(count(*), 1) FROM customer) AS actual`)[0];
    if (st?.nf == null || Math.abs(st.nf - st.actual) > 0.25) throw new Error('Thống kê owner_id cũ/thiếu. Chỉ chẩn đoán trên bản sao đã ANALYZE. Dừng.');
    const pr = prov().presets;
    scopes = [{ who: 'all', actor: pr.all!.actor, scope: 'ALL' }, { who: 'ownA', actor: pr.ownA!.actor, scope: 'OWN' }, { who: 'deptA', actor: pr.deptA!.actor, scope: 'DEPARTMENT' }];
    report.database = dbName; report.statsPrecheck = st; report.before = await counts();
    report.versions = { postgres: (await prisma.$queryRaw<{ v: string }[]>`SHOW server_version`)[0]?.v, node: process.version };
    t = await makeApp(prisma, fx);
  }, 120000);
  afterAll(async () => {
    try {
      const after = await counts(); report.after = after; report.dataUnchanged = JSON.stringify(after) === JSON.stringify(report.before); report.activeSessionsAfter = await busyNow();
      report.failures = failures; report.budgetUsedMin = r1((Date.now() - T0) / 60000); report.finishedAt = new Date().toISOString();
      const dir = process.env.PERF_REPORT_DIR ?? 'perf-report'; mkdirSync(dir, { recursive: true });
      const f = join(dir, 'p23a_diag_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'); writeFileSync(f, JSON.stringify(report, null, 2)); console.log('Báo cáo P2-3a bước A:', f);
      console.log('Cổng SQL: ' + JSON.stringify(report.gateVerdict ?? 'chưa tính') + ' | sai khác: ' + failures.length);
    } finally { await t?.app.close(); await prisma?.$disconnect(); }
  });

  it('A0. tách chi phí trên 100.000 liên hệ: quét / f_vn_fold / similarity', async () => {
    const f = await fold('nguyen van'); const out: Record<string, unknown> = {};
    const qs: Record<string, Prisma.Sql> = {
      scanOnly: Prisma.sql`SELECT count(*)::int FROM contact WHERE deleted_at IS NULL`,
      foldOnly: Prisma.sql`SELECT sum(length(public.f_vn_fold(full_name)))::bigint FROM contact WHERE deleted_at IS NULL`,
      foldAndSimilarity: Prisma.sql`SELECT sum(public.similarity(public.f_vn_fold(full_name), ${f})) FROM contact WHERE deleted_at IS NULL`,
    };
    for (const [k, q] of Object.entries(qs)) { await explain(q); const e = await explain(q); out[k] = { executionMs: e.executionMs, rootSharedHit: e.rootSharedHit }; }
    const x = (k: string): number => Number((out[k] as { executionMs: number }).executionMs);
    out.derived = { foldMs: r1(x('foldOnly') - x('scanOnly')), similarityMs: r1(x('foldAndSimilarity') - x('foldOnly')), perContactMicros: r1(((x('foldAndSimilarity') - x('scanOnly')) * 1000) / 100000), note: 'trần cải thiện của A1/A2: chi phí CPU không thể giảm bằng cách gom theo tập' };
    report.a0 = out;
  }, 600000);

  it('A2. nguyen van / mi / an (+ cumperf, minh phat đối chứng): EXPLAIN + 5 lần đo mỗi biến thể (S0 hiện tại, A1, A2)', async () => {
    const res: Record<string, unknown> = {}; const gateVerdict: Record<string, unknown> = {};
    for (const term of ['nguyen van', 'mi', 'an', 'cumperf', 'minh phat']) {
      if (!left()) { failures.push('hết ngân sách thời gian trước ' + term); break; }
      const p = await inp(term); const per: Record<string, unknown> = { path: chooseSearchPath(p.folded, false) };
      for (const v of VARS) {
        const plan = await explain(vq(v, p, 'desc', 20, 0)); await run(v, p, 'desc', 20, 0);
        const ms: number[] = []; let total = 0;
        for (let i = 0; i < RUNS; i++) { const r = await run(v, p, 'desc', 20, 0); ms.push(r1(r.ms)); total = r.total; }
        per[v] = { timesMs: ms, median: med(ms), max: Math.max(...ms), total, plan: { ...plan, raw: undefined }, rawPlan: plan.raw };
      }
      res[term] = per;
    }
    report.timings = res; report.gateVerdictInputs = Object.keys(res);
    report.gateVerdict = gateVerdict;
    for (const term of Object.keys(GATE)) {
      const per = res[term] as Record<string, { max: number }> | undefined; if (!per) continue;
      gateVerdict[term] = Object.fromEntries(VARS.map((v) => [v, { max: per[v]?.max, gate: GATE[term], pass: (per[v]?.max ?? 1e9) <= (GATE[term] as number) }]));
    }
  }, 3600000);

  it('A3. so khớp tuyệt đối với S0: tổng, TOÀN BỘ ID đúng thứ tự (ALL/OWN/DEPARTMENT × relevance asc/desc) và trang đầu/giữa/cuối/vượt cuối', async () => {
    const eq: Record<string, unknown>[] = []; let compared = 0;
    for (const term of ['nguyen van', 'mi', 'an', 'cumperf', 'minh phat']) for (const sc of scopes) for (const dir of ['desc', 'asc'] as const) {
      if (!left()) { failures.push('hết ngân sách trước so khớp ' + term + '/' + sc.who + '/' + dir); continue; }
      if ((term === 'cumperf' || term === 'minh phat') && sc.who !== 'all') continue;
      const p = await inp(term, sc.who); const ref = await run('S0', p, dir, 100000, 0);
      for (const v of ['A1', 'A2'] as V[]) {
        const o = await run(v, p, dir, 100000, 0); const same = o.total === ref.total && o.ids.length === ref.ids.length && o.ids.every((id, i) => id === ref.ids[i]);
        compared++; eq.push({ term, scope: sc.who, dir, v, total: o.total, refTotal: ref.total, sameAllIds: same });
        if (!same) failures.push('KHÁC S0: ' + v + ' ' + term + ' ' + sc.who + ' ' + dir + ' (total ' + o.total + ' vs ' + ref.total + ')');
        if (sc.who === 'all') {
          const last = Math.max(1, Math.ceil(ref.total / 20));
          for (const page of [...new Set([1, 2, Math.ceil(last / 2), last, last + 1])]) {
            const a = await run('S0', p, dir, 20, (page - 1) * 20); const b = await run(v, p, dir, 20, (page - 1) * 20); compared++;
            const okPage = a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]) && (a.ids.length === 0 || a.total === b.total);
            if (!okPage) failures.push('KHÁC S0 trang ' + page + ': ' + v + ' ' + term + ' ' + dir);
          }
        }
      }
    }
    report.equality = { compared, mismatches: failures.length, rows: eq };
    expect(failures).toEqual([]);
  }, 3600000);

  it('A4. trang 100 danh sách: EXPLAIN + p95 từng vòng (HTTP, Prisma, SQL) để tách OFFSET / COUNT / nạp quan hệ / dao động', async () => {
    const out: Record<string, unknown> = {}; const order = buildOrderBy('createdAt', 'desc');
    const where = { deletedAt: null };
    const roundsOf = async (f: () => Promise<unknown>): Promise<{ p95PerRound: number[]; medianPerRound: number[]; max: number }> => {
      for (let i = 0; i < 3; i++) await f(); const p95s: number[] = []; const meds: number[] = []; let mx = 0;
      for (let k = 0; k < 3; k++) { const xs: number[] = []; for (let i = 0; i < 15; i++) { const s = performance.now(); await f(); xs.push(performance.now() - s); } p95s.push(r1(p95(xs))); meds.push(r1(med(xs))); mx = Math.max(mx, ...xs); }
      return { p95PerRound: p95s, medianPerRound: meds, max: r1(mx) };
    };
    const get = (q: string) => async (): Promise<void> => { const r = await as(t.app, 'all').get('/api/v1/customers' + q); if (r.status !== 200) throw new Error('HTTP ' + r.status); };
    out.httpPage1 = await roundsOf(get('?pageSize=20&page=1'));
    out.httpPage100 = await roundsOf(get('?pageSize=20&page=100'));
    out.prismaCount = await roundsOf(() => prisma.customer.count({ where }));
    out.prismaFindMany_skip0 = await roundsOf(() => prisma.customer.findMany({ where, include: CUSTOMER_DETAIL_INCLUDE, orderBy: order, skip: 0, take: 20 }));
    out.prismaFindMany_skip1980 = await roundsOf(() => prisma.customer.findMany({ where, include: CUSTOMER_DETAIL_INCLUDE, orderBy: order, skip: 1980, take: 20 }));
    out.sqlIdsOnly_offset1980 = await roundsOf(() => prisma.$queryRaw`SELECT c.id FROM customer c WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC, c.code DESC LIMIT 20 OFFSET 1980`);
    out.explainCount = await explain(Prisma.sql`SELECT count(*)::int FROM customer c WHERE c.deleted_at IS NULL`);
    out.explainIds_offset0 = await explain(Prisma.sql`SELECT c.id FROM customer c WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC, c.code DESC LIMIT 20 OFFSET 0`);
    out.explainIds_offset1980 = await explain(Prisma.sql`SELECT c.id FROM customer c WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC, c.code DESC LIMIT 20 OFFSET 1980`);
    out.note = 'Điều kiện/sắp xếp lấy gần đúng từ đường danh sách phạm vi ALL (deletedAt null, createdAt desc, code desc); không thay thế log Prisma. So p95PerRound: một vòng cao bất thường = nhiễu đo.';
    report.page100 = out;
  }, 1800000);
});
