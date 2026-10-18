// B1.2.3-B2 P2-3c – so S0 (SubPlan, truy vấn API hiện tại) với A2-stored (gom theo tập dùng contact.full_name_fold) trên BẢN SAO MỚI đã áp up.sql. CHỈ ĐỌC. Chạy khi BENCH_FOLD_PROBE=1 (qua fold-verify -Step probe).
// A2-stored chỉ nằm trong file này, KHÔNG vào src. Công thức relevance, tie-break c.code DESC, count(*) OVER (), quyền: nguyên văn. Không đổi statement_timeout (120 s) hay ngưỡng.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../src/generated/prisma/client';
import type { Scope } from '../../../src/common/auth/actor';
import { buildOuterWhere, buildSearchPageQuery, buildSearchWhere, chooseSearchPath, textBranches, type SearchWhereInput } from '../../../src/modules/customers/customers.search';
import { CUSTOMER_DETAIL_INCLUDE } from '../../../src/modules/customers/customers.queries';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { as, makeApp, TestActorProvider, TestApp } from '../../helpers/test-app';
import { assertTestConnection, createTestPrisma } from '../../helpers/test-db';
import type { Fixtures } from '../../helpers/fixtures';
import { loadFixturesReadOnly } from './readonly-fixtures';

const ON = process.env.BENCH_FOLD_PROBE === '1';
const GATE: Record<string, number> = { 'nguyen van': 450, mi: 1350, an: 1350 }; // cổng kỹ thuật mức SQL; ngưỡng API 500/1500 giữ nguyên
const API_LIMIT: Record<string, number> = { 'nguyen van': 500, mi: 1500, an: 1500 };
const TERMS = ['nguyen van', 'mi', 'an']; const CONTROL = ['cumperf', 'minh phat'];
const BUDGET_MS = Number(process.env.BENCH_DIAG_BUDGET_MIN ?? 30) * 60000; const T0 = Date.now(); const RUNS = 5;
type V = 'S0' | 'A2S';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let dbName = '';
const report: Record<string, unknown> = { kind: 'B1.2.3-B2-P2-3c-fold-probe', startedAt: new Date().toISOString(), gates: GATE, apiLimits: API_LIMIT };
const failures: { step: string; code?: string; message: string }[] = [];
const left = (): boolean => Date.now() - T0 < BUDGET_MS;
const r1 = (x: number): number => Math.round(x * 10) / 10;
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)] as number;
const pn = (): number => performance.now();
const busyNow = async (): Promise<number> => (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`)[0]?.n ?? 0;
const counts = async () => (await prisma.$queryRaw<Record<string, number>[]>`SELECT (SELECT count(*)::int FROM customer) AS customer, (SELECT count(*)::int FROM contact) AS contact, (SELECT count(*)::int FROM audit_log) AS audit_log`)[0];
const fold = async (s: string): Promise<string> => (await prisma.$queryRaw<{ t: string }[]>`SELECT public.f_vn_fold(btrim(${s})) AS t`)[0]?.t ?? '';
const errInfo = (e: unknown): { code?: string; message: string } => { const x = e as { code?: string; meta?: { code?: string }; message?: string }; return { code: x?.meta?.code ?? x?.code, message: String(x?.message ?? e).slice(0, 400) }; };
async function ro<T>(f: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await tx.$executeRaw`SET LOCAL statement_timeout = '120s'`; return f(tx); }, { timeout: 200000, maxWait: 10000 });
}
function parts(p: SearchWhereInput, path: 'union' | 'or'): { from: Prisma.Sql; where: Prisma.Sql } {
  if (path === 'or') return { from: Prisma.sql`customer c`, where: buildSearchWhere(p) };
  const sel = textBranches(p).flatMap((b) => b.union);
  return { from: Prisma.sql`customer c JOIN (${Prisma.join(sel, ' UNION ')}) cand ON cand.id = c.id`, where: buildOuterWhere(p) };
}
function vq(v: V, p: SearchWhereInput, dir: 'asc' | 'desc', limit: number, offset: number): Prisma.Sql {
  const path = chooseSearchPath(p.folded, false);
  if (v === 'S0') return buildSearchPageQuery(p, path, { sortBy: 'relevance', order: dir }, limit, offset);
  const d = dir === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC'); const m = parts(p, path); const f = p.folded;
  const score = Prisma.sql`greatest(public.similarity(public.f_vn_fold(c.name), ${f}), coalesce(public.similarity(public.f_vn_fold(c.short_name), ${f}), 0), coalesce(k.m, 0))`;
  return Prisma.sql`SELECT c.id, count(*) OVER ()::int AS total FROM ${m.from} LEFT JOIN (SELECT ct.customer_id, max(public.similarity(ct.full_name_fold, ${f})) AS m FROM contact ct WHERE ct.deleted_at IS NULL GROUP BY ct.customer_id) k ON k.customer_id = c.id WHERE ${m.where} ORDER BY ${score} ${d}, c.code DESC LIMIT ${limit}::int OFFSET ${offset}::int`;
}
async function run(v: V, p: SearchWhereInput, dir: 'asc' | 'desc', limit: number, offset: number): Promise<{ ids: string[]; total: number; ms: number }> {
  return ro(async (tx) => { const s = pn(); const rows = await tx.$queryRaw<{ id: string; total: number }[]>(vq(v, p, dir, limit, offset)); return { ids: rows.map((r) => r.id), total: rows[0] ? Number(rows[0].total) : 0, ms: pn() - s }; });
}
type PlanNode = Record<string, unknown>;
function walk(n: PlanNode, acc: PlanNode[]): void { acc.push(n); for (const c of (n['Plans'] as PlanNode[] | undefined) ?? []) walk(c, acc); }
async function explain(q: Prisma.Sql): Promise<Record<string, unknown>> {
  return ro(async (tx) => {
    const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`);
    const root = (rows[0]?.['QUERY PLAN'] as PlanNode[] | undefined)?.[0] ?? {}; const plan = (root['Plan'] ?? {}) as PlanNode; const all: PlanNode[] = []; walk(plan, all);
    return { executionMs: root['Execution Time'], planningMs: root['Planning Time'], rootSharedHit: plan['Shared Hit Blocks'], nodeTypes: [...new Set(all.map((n) => String(n['Node Type'])))],
      subPlans: all.filter((n) => n['Parent Relationship'] === 'SubPlan').map((n) => ({ type: n['Node Type'], loops: n['Actual Loops'], msPerLoop: n['Actual Total Time'] })),
      aggregates: all.filter((n) => n['Node Type'] === 'Aggregate').map((n) => ({ strategy: n['Strategy'], rows: n['Actual Rows'], ms: n['Actual Total Time'] })),
      seqScans: all.filter((n) => n['Node Type'] === 'Seq Scan').map((n) => ({ relation: n['Relation Name'], rows: n['Actual Rows'], ms: n['Actual Total Time'] })) };
  });
}

(ON ? describe : describe.skip)('P2-3c: S0 vs A2-stored trên bản sao mới (chỉ đọc)', () => {
  let scopes: { who: string; actor: SearchWhereInput['actor']; scope: Scope }[] = [];
  const inp = async (term: string, who = 'all'): Promise<SearchWhereInput> => { const s = scopes.find((x) => x.who === who) as { actor: SearchWhereInput['actor']; scope: Scope }; return { actor: s.actor, folded: await fold(term), raw: term, deletedOnly: false, readScope: s.scope, restoreScope: null, ids: {} }; };
  beforeAll(async () => {
    const c = createTestPrisma(); prisma = c.prisma; dbName = c.name;
    if (!process.env.BENCH_EXPECT_DB || process.env.BENCH_EXPECT_DB !== dbName) throw new Error('BENCH_EXPECT_DB phải trùng tên bản sao.');
    await assertTestConnection(prisma, dbName);
    const marker = (await prisma.$queryRaw<{ m: string }[]>`SELECT coalesce(shobj_description(oid, 'pg_database'), '') AS m FROM pg_database WHERE datname = current_database()`)[0]?.m ?? '';
    if (!marker.startsWith('SISCOM_STATS_CLONE_OF:')) throw new Error('Không có nhãn bản sao của make-stats-clone. TỪ CHỐI.');
    if (['siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948'].includes(dbName)) throw new Error('Không đo trên DB đã khóa/đang dùng.');
    const col = (await prisma.$queryRaw<{ g: string }[]>`SELECT attgenerated::text AS g FROM pg_attribute WHERE attrelid = 'public.contact'::regclass AND attname = 'full_name_fold' AND NOT attisdropped`)[0]?.g;
    if (col !== 's') throw new Error('contact.full_name_fold chưa phải cột STORED (chạy fold-verify -Step apply).');
    const mism = (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM contact WHERE full_name_fold IS DISTINCT FROM public.f_vn_fold(full_name)`)[0]?.n;
    if (mism !== 0) throw new Error(String(mism) + ' dòng full_name_fold lệch f_vn_fold(full_name).');
    fx = await loadFixturesReadOnly(prisma);
    if ((await busyNow()) > 0) throw new Error('Có phiên khác trên bản sao. Dừng.');
    const st = (await prisma.$queryRaw<{ nf: number | null; actual: number }[]>`SELECT (SELECT null_frac::float8 FROM pg_stats WHERE schemaname = 'public' AND tablename = 'customer' AND attname = 'owner_id') AS nf, (SELECT (count(*) FILTER (WHERE owner_id IS NULL))::float8 / greatest(count(*), 1) FROM customer) AS actual`)[0];
    if (st?.nf == null || Math.abs(st.nf - st.actual) > 0.25) throw new Error('Thống kê owner_id cũ/thiếu. Dừng.');
    const pr = new TestActorProvider(fx).presets;
    scopes = [{ who: 'all', actor: pr.all!.actor, scope: 'ALL' }, { who: 'ownA', actor: pr.ownA!.actor, scope: 'OWN' }, { who: 'deptA', actor: pr.deptA!.actor, scope: 'DEPARTMENT' }];
    report.database = dbName; report.marker = marker; report.before = await counts();
    report.versions = { postgres: (await prisma.$queryRaw<{ v: string }[]>`SHOW server_version`)[0]?.v, node: process.version };
    t = await makeApp(prisma, fx);
  }, 120000);
  afterAll(async () => {
    try {
      const after = await counts(); report.after = after; report.dataUnchanged = JSON.stringify(after) === JSON.stringify(report.before); report.activeSessionsAfter = await busyNow();
      report.failures = failures; report.budgetUsedMin = r1((Date.now() - T0) / 60000); report.finishedAt = new Date().toISOString();
      const dir = process.env.PERF_REPORT_DIR ?? 'perf-report'; mkdirSync(dir, { recursive: true });
      const f = join(dir, 'fold_probe_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'); writeFileSync(f, JSON.stringify(report, null, 2));
      console.log('Báo cáo P2-3c:', f); console.log('gateVerdict: ' + JSON.stringify(report.gateVerdict ?? 'chưa tính') + ' | lỗi/sai khác: ' + failures.length);
    } finally { await t?.app.close(); await prisma?.$disconnect(); }
  });

  it('1. so khớp tuyệt đối S0 vs A2-stored NGAY TRONG PostgreSQL (tổng, toàn bộ ID đúng thứ tự); từng bước ghi mã lỗi', async () => {
    const eq: Record<string, unknown>[] = [];
    for (const term of [...TERMS, ...CONTROL]) for (const sc of scopes) for (const dir of ['desc', 'asc'] as const) {
      if ((CONTROL.includes(term) && sc.who !== 'all') || (sc.who !== 'all' && dir === 'asc')) continue;
      const step = term + '/' + sc.who + '/' + dir;
      if (!left()) { failures.push({ step, message: 'hết ngân sách thời gian' }); continue; }
      try {
        const p = await inp(term, sc.who); const a = vq('S0', p, dir, 100000, 0); const b = vq('A2S', p, dir, 100000, 0); const s = pn();
        const r = await ro((tx) => tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT (a.ids = b.ids) AS same, cardinality(a.ids) AS na, cardinality(b.ids) AS nb, a.total AS ta, b.total AS tb, (SELECT min(i) FROM generate_series(1, greatest(cardinality(a.ids), cardinality(b.ids))) i WHERE a.ids[i] IS DISTINCT FROM b.ids[i]) AS first_diff FROM (SELECT coalesce(array_agg(id), '{}'::uuid[]) AS ids, max(total) AS total FROM (${a}) s) a, (SELECT coalesce(array_agg(id), '{}'::uuid[]) AS ids, max(total) AS total FROM (${b}) s) b`));
        const row = r[0] ?? {}; const ok = row.same === true && row.ta === row.tb; eq.push({ step, ms: r1(pn() - s), ...row, ok });
        if (!ok) failures.push({ step, message: 'KHÁC S0: ' + JSON.stringify(row) });
      } catch (e) { failures.push({ step, ...errInfo(e) }); eq.push({ step, error: errInfo(e) }); }
    }
    // trang đầu / giữa / cuối / vượt cuối (ALL, desc)
    for (const term of TERMS) {
      const p = await inp(term); let ref: { total: number } | undefined;
      try { ref = await run('S0', p, 'desc', 20, 0); } catch (e) { failures.push({ step: 'pages/' + term, ...errInfo(e) }); continue; }
      const last = Math.max(1, Math.ceil(ref.total / 20));
      for (const page of [...new Set([1, 2, Math.ceil(last / 2), last, last + 1])]) {
        const step = 'page/' + term + '/' + page;
        try { const a = await run('S0', p, 'desc', 20, (page - 1) * 20); const b = await run('A2S', p, 'desc', 20, (page - 1) * 20);
          const ok = a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]) && (a.ids.length === 0 || a.total === b.total); eq.push({ step, ok });
          if (!ok) failures.push({ step, message: 'trang khác S0' });
        } catch (e) { failures.push({ step, ...errInfo(e) }); }
      }
    }
    report.equality = { rows: eq, allOk: eq.length > 0 && eq.every((x) => x.ok === true) };
    expect(failures).toEqual([]);
  }, 3600000);

  it('2. thời gian SQL: S0 vs A2-stored (EXPLAIN + 5 lần đo) và cổng 450/1.350/1.350', async () => {
    const res: Record<string, unknown> = {}; const verdict: Record<string, unknown> = {};
    for (const term of [...TERMS, ...CONTROL]) {
      if (!left()) { failures.push({ step: 'timing/' + term, message: 'hết ngân sách' }); break; }
      const p = await inp(term); const per: Record<string, unknown> = { path: chooseSearchPath(p.folded, false) };
      for (const v of ['S0', 'A2S'] as V[]) {
        try { const plan = await explain(vq(v, p, 'desc', 20, 0)); await run(v, p, 'desc', 20, 0); const ms: number[] = []; let total = 0;
          for (let i = 0; i < RUNS; i++) { const r = await run(v, p, 'desc', 20, 0); ms.push(r1(r.ms)); total = r.total; }
          per[v] = { timesMs: ms, median: med(ms), max: Math.max(...ms), total, plan };
        } catch (e) { failures.push({ step: 'timing/' + term + '/' + v, ...errInfo(e) }); }
      }
      res[term] = per;
    }
    for (const term of TERMS) { const per = res[term] as Record<string, { max: number; median: number }> | undefined; if (per?.S0 && per.A2S) verdict[term] = { s0Max: per.S0.max, a2sMax: per.A2S.max, gate: GATE[term], a2sPassGate: per.A2S.max <= (GATE[term] as number), savedMedianMs: r1(per.S0.median - per.A2S.median) }; }
    report.timings = res; report.gateVerdict = verdict;
  }, 3600000);

  it('3. phân rã SQL/API (đường API HIỆN TẠI = S0) + ước tính API sau A2-stored (chỉ là ước tính, không phải đo API)', async () => {
    const dec: Record<string, unknown> = {};
    for (const term of TERMS) {
      if (!left()) { failures.push({ step: 'decompose/' + term, message: 'hết ngân sách' }); break; }
      try {
        const p = await inp(term); const tx: { fold: number[]; page: number[]; load: number[]; total: number[] } = { fold: [], page: [], load: [], total: [] };
        for (let i = 0; i < RUNS + 1; i++) {
          const s = pn();
          const r = await prisma.$transaction(async (x) => {
            const t0 = pn(); await x.$queryRaw`SELECT public.f_vn_fold(btrim(${term})) AS t`; const t1 = pn();
            const rows = await x.$queryRaw<{ id: string; total: number }[]>(vq('S0', p, 'desc', 20, 0)); const t2 = pn();
            await x.customer.findMany({ where: { id: { in: rows.map((q) => q.id) } }, include: CUSTOMER_DETAIL_INCLUDE }); const t3 = pn();
            return { fold: t1 - t0, page: t2 - t1, load: t3 - t2 };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
          if (i > 0) { tx.fold.push(r1(r.fold)); tx.page.push(r1(r.page)); tx.load.push(r1(r.load)); tx.total.push(r1(pn() - s)); }
        }
        const get = (): Promise<{ status: number }> => as(t.app, 'all').get('/api/v1/customers?pageSize=20&sortBy=relevance&search=' + encodeURIComponent(term));
        for (let i = 0; i < 3; i++) await get();
        const rounds: number[] = []; const all: number[] = [];
        for (let k = 0; k < 3; k++) { const xs: number[] = []; for (let i = 0; i < 15; i++) { const s = pn(); const r = await get(); if (r.status !== 200) throw new Error('HTTP ' + r.status); xs.push(pn() - s); } rounds.push(r1(p95(xs))); all.push(...xs); }
        const timing = (report.timings as Record<string, Record<string, { median: number }>> | undefined)?.[term];
        const saved = timing?.S0 && timing.A2S ? timing.S0.median - timing.A2S.median : undefined;
        const httpWorst = Math.max(...rounds);
        dec[term] = { txMedian: { foldQuery: med(tx.fold), pageQuery: med(tx.page), loadRelations: med(tx.load), txTotal: med(tx.total) }, httpP95PerRound: rounds, httpP95Worst: httpWorst, httpMedian: r1(med(all)),
          gapHttpMinusTxMedian: r1(med(all) - med(tx.total)), estimatedApiP95WorstAfterA2S: saved === undefined ? null : r1(httpWorst - saved), apiLimit: API_LIMIT[term], note: 'ước tính = p95Worst API hiện tại − (median S0 − median A2-stored); KHÔNG phải số đo API' };
      } catch (e) { failures.push({ step: 'decompose/' + term, ...errInfo(e) }); }
    }
    report.decomposition = dec;
  }, 3600000);
});
