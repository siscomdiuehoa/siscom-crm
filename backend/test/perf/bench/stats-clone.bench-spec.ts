// B1.2.3-B2 P1 r5-B – V3 với thống kê owner_id MỚI, trên BẢN SAO hủy bỏ được (tạo bởi make-stats-clone). Chỉ chạy khi BENCH_STATS_CLONE=1.
// Không kết nối DB gốc / siscom_crm_dev. Ghi (commit) CHỈ trên bản sao: ALTER TABLE autovacuum_enabled=false + 3 UPDATE setup. ANALYZE chỉ chạy khi có -ApproveAnalyze, ngoài transaction.
// Không sửa SQL production; không đổi statement_timeout (120 s) hay ngưỡng p95. Mọi truy vấn đo chạy trong giao dịch CHỈ ĐỌC.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../src/generated/prisma/client';
import type { Actor, Scope } from '../../../src/common/auth/actor';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { Fixtures } from '../../helpers/fixtures';
import { assertTestConnection, createTestPrisma } from '../../helpers/test-db';
import { loadFixturesReadOnly } from './readonly-fixtures';
import { BASELINE, BenchInput, countSql, pageSql, runVariant, Variant, VARIANTS } from './search-variants';

const ON = process.env.BENCH_STATS_CLONE === '1';
const APPROVE = process.env.BENCH_APPROVE_ANALYZE === '1';
const CLONE_OF = process.env.BENCH_CLONE_OF ?? '';
const PAGE = 20; const TX_MS = 300000; const BIG = 2147483647; const V3 = 'V3_unionall_two_orig';
let prisma: PrismaService; let dbName = ''; let fx: Fixtures; let F1: Record<string, unknown> = {};
const report: Record<string, unknown> = { kind: 'B1.2.3-B2-P1-r5B-stats-clone', startedAt: new Date().toISOString(), cloneOf: CLONE_OF, analyzeApproved: APPROVE, statementTimeout: '120s' };
const failures: string[] = [];
type Plans = Record<string, Record<string, unknown>>;
const plans: { stale: Plans; fresh: Plans } = { stale: {}, fresh: {} };
const results: Record<string, Record<string, unknown>> = {};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const msgOf = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 400) : String(e));
const rd = (x: number): number => Math.round(x);

async function snapshot(): Promise<Record<string, unknown>> {
  const r = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT
    (SELECT md5(string_agg(concat_ws('|', id, owner_id, deleted_at, deleted_by, tax_id, version, updated_at, tier_id, status_id, name, phone), ',' ORDER BY id)) FROM customer WHERE legacy_id LIKE 'PERF-%') AS perf_fingerprint,
    (SELECT count(*)::int FROM customer) AS customer, (SELECT count(*)::int FROM contact) AS contact, (SELECT count(*)::int FROM lookup_item) AS lookup_item,
    (SELECT count(*)::int FROM department) AS department, (SELECT count(*)::int FROM employee) AS employee, (SELECT count(*)::int FROM audit_log) AS audit_log`;
  return r[0] ?? {};
}
const busyNow = async (): Promise<number> => (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`)[0]?.n ?? 0;
const waitIdle = async (limitMs: number): Promise<number> => { const t0 = Date.now(); let n = await busyNow(); while (n > 0 && Date.now() - t0 < limitMs) { await sleep(500); n = await busyNow(); } return n; };
async function foldOf(s: string): Promise<string> { return (await prisma.$queryRaw<{ t: string | null }[]>`SELECT public.f_vn_fold(btrim(${s})) AS t`)[0]?.t ?? ''; }
function input(folded: string, raw: string, actor: Actor, o: Partial<BenchInput> = {}): BenchInput {
  return { actor, folded, raw, deletedOnly: false, readScope: 'ALL' as Scope, restoreScope: null, ids: {}, sortBy: 'relevance', order: 'desc', ...o };
}
async function statsInfo(): Promise<Record<string, unknown>> {
  const col = (await prisma.$queryRaw<Record<string, unknown>[]>`SELECT null_frac::float8 AS null_frac, n_distinct::float8 AS n_distinct, most_common_vals::text AS mcv FROM pg_stats WHERE schemaname = 'public' AND tablename = 'customer' AND attname = 'owner_id'`)[0] ?? null;
  const live = (await prisma.$queryRaw<{ n: number; total: number }[]>`SELECT count(*) FILTER (WHERE owner_id IS NOT NULL)::int AS n, count(*)::int AS total FROM customer`)[0];
  const st = (await prisma.$queryRaw<Record<string, unknown>[]>`SELECT last_analyze::text AS last_analyze, last_autoanalyze::text AS last_autoanalyze, n_mod_since_analyze::int AS n_mod_since_analyze FROM pg_stat_user_tables WHERE relname = 'customer'`)[0] ?? null;
  const rel = (await prisma.$queryRaw<Record<string, unknown>[]>`SELECT reltuples::float8 AS reltuples, relpages::int AS relpages FROM pg_class WHERE oid = 'public.customer'::regclass`)[0] ?? null;
  const actual = live && live.total ? 1 - live.n / live.total : null;
  const nf = col?.null_frac as number | undefined;
  return { ownerColumnStats: col, ownerNotNullLive: live?.n, customerTotal: live?.total, ownerNullFracActual: actual, tableStats: st, relation: rel, staleDetected: nf !== undefined && actual !== null ? Math.abs(nf - actual) > 0.25 : null };
}

type PNode = Record<string, unknown> & { Plans?: PNode[] };
function shape(raw: unknown): Record<string, unknown> {
  const root = (Array.isArray(raw) ? raw[0] : raw) as { Plan: PNode; 'Execution Time'?: number };
  const nodes: PNode[] = []; const walk = (n: PNode): void => { nodes.push(n); (n.Plans ?? []).forEach(walk); }; walk(root.Plan);
  const cond = (n: PNode): string => String((n['Index Cond'] as string | undefined) ?? '') + ' ' + String((n['Filter'] as string | undefined) ?? '');
  const scans = nodes.filter((n) => /Scan/.test(String(n['Node Type']))).map((n) => ({ node: n['Node Type'], rel: n['Relation Name'] ?? null, index: n['Index Name'] ?? null, cond: cond(n).slice(0, 140), estRows: n['Plan Rows'] as number, actRows: n['Actual Rows'] ?? null, loops: n['Actual Loops'] ?? null }));
  const joins = nodes.filter((n) => /Join|Nested Loop/.test(String(n['Node Type']))).map((n) => ({ node: n['Node Type'], joinType: n['Join Type'] ?? null, estRows: n['Plan Rows'], actRows: n['Actual Rows'] ?? null, loops: n['Actual Loops'] ?? null }));
  const ownerScanEst = scans.filter((s) => s.rel === 'customer' && /owner_id/.test(s.cond)).map((s) => s.estRows);
  const nestedLoopSemi = nodes.some((n) => n['Node Type'] === 'Nested Loop' && n['Join Type'] === 'Semi');
  const materialize = nodes.some((n) => n['Node Type'] === 'Materialize');
  return {
    topEstRows: root.Plan['Plan Rows'], totalCost: root.Plan['Total Cost'], executionMs: root['Execution Time'] ?? null,
    nestedLoopSemi, hashSemi: nodes.some((n) => /Hash/.test(String(n['Node Type'])) && n['Join Type'] === 'Semi'), materialize,
    hashNode: nodes.some((n) => n['Node Type'] === 'Hash'), hashedAggregate: nodes.some((n) => n['Node Type'] === 'Aggregate' && n['Strategy'] === 'Hashed'),
    append: nodes.some((n) => n['Node Type'] === 'Append'), gather: nodes.some((n) => /Gather/.test(String(n['Node Type']))),
    hashedSubPlan: nodes.some((n) => /hashed/i.test(String(n['Subplan Name'] ?? ''))),
    ownerScanMinEstRows: ownerScanEst.length ? Math.min(...ownerScanEst) : null,
    badShape: nestedLoopSemi && !materialize,
    joins, scans, sharedHit: root.Plan['Shared Hit Blocks'] ?? null, sharedRead: root.Plan['Shared Read Blocks'] ?? null,
  };
}
async function explain(q: Prisma.Sql, analyze: boolean): Promise<{ shape?: Record<string, unknown>; raw?: unknown; error?: string; ms: number }> {
  const t0 = performance.now();
  try {
    const raw = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '120s'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      const r = await tx.$queryRaw<Record<string, unknown>[]>(analyze ? Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}` : Prisma.sql`EXPLAIN (FORMAT JSON) ${q}`);
      let p = r[0]?.['QUERY PLAN']; if (typeof p === 'string') p = JSON.parse(p); return p;
    }, { maxWait: 10000, timeout: TX_MS });
    return { shape: shape(raw), raw, ms: rd(performance.now() - t0) };
  } catch (e) { return { error: msgOf(e), ms: rd(performance.now() - t0) }; }
}
type Timed = { ok: true; total: number; ids: string[]; ms: number } | { ok: false; kind: string; ms: number; error: string };
async function timedVariant(p: BenchInput, v: Variant, limit: number, offset: number): Promise<Timed> {
  const t0 = performance.now();
  try {
    const r = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '120s'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      return runVariant(tx, p, v, limit, offset);
    }, { maxWait: 10000, timeout: TX_MS });
    return { ok: true, total: r.total, ids: r.ids, ms: rd(performance.now() - t0) };
  } catch (e) { const m = msgOf(e); return { ok: false, kind: /statement timeout|canceling statement/i.test(m) ? 'STATEMENT_TIMEOUT' : 'ERROR', ms: rd(performance.now() - t0), error: m }; }
}

interface Sc { id: string; name: string; term: string; o: () => Partial<BenchInput> }
const scenarios = (): Sc[] => [
  { id: '02', name: 'OWN A cumperf', term: 'cumperf', o: () => ({ readScope: 'OWN' }) },
  { id: '14', name: 'tên liên hệ OWN', term: 'tran thi', o: () => ({ readScope: 'OWN' }) },
  { id: '18', name: 'ownerId B + tier', term: 'minh phat', o: () => ({ ownerId: fx.empB, ids: { tier: fx.tier.POTENTIAL as string } }) },
];
const actorA = (): Actor => ({ employeeId: fx.empA, departmentId: fx.d1 });
async function collectPlans(phase: 'stale' | 'fresh'): Promise<void> {
  for (const s of scenarios()) {
    const p = input(await foldOf(s.term), s.term, actorA(), s.o());
    const out: Record<string, unknown> = {}; plans[phase][s.id] = out;
    for (const v of VARIANTS) {
      const pg = await explain(pageSql(p, v, BIG, 0), false);
      const entry: Record<string, unknown> = { page: pg.shape ?? { error: pg.error } };
      if (v.count === 'two') { const ct = await explain(countSql(p, v), false); entry.count = ct.shape ?? { error: ct.error }; }
      if (v.id === V3) entry.pageRaw = pg.raw;
      out[v.id] = entry;
    }
  }
}
async function execScenario(s: Sc): Promise<Record<string, unknown>> {
  const p = input(await foldOf(s.term), s.term, actorA(), s.o());
  const out: Record<string, unknown> = { term: s.term }; const variants: Record<string, unknown> = {};
  const baseV = VARIANTS.find((v) => v.id === BASELINE) as Variant;
  const base = await timedVariant(p, baseV, BIG, 0);
  if (!base.ok) { variants[baseV.id] = base; out.variants = variants; out.stoppedAt = baseV.id; return out; }
  variants[baseV.id] = { ok: true, ms: base.ms, total: base.total }; out.total = base.total;
  for (const v of VARIANTS.filter((x) => x.id !== BASELINE)) {
    const full = await timedVariant(p, v, BIG, 0);
    if (!full.ok) { variants[v.id] = full; out.stoppedAt = v.id; break; }
    const beyond = await timedVariant(p, v, PAGE, (Math.ceil(base.total / PAGE) + 1) * PAGE);
    if (!beyond.ok) { variants[v.id] = { ...beyond, phase: 'beyond' }; out.stoppedAt = v.id; break; }
    const match = full.total === base.total && full.ids.length === base.ids.length && full.ids.every((id, k) => id === base.ids[k]) && beyond.ids.length === 0 && beyond.total === base.total;
    variants[v.id] = { ok: true, match, ms: full.ms, beyondMs: beyond.ms, total: full.total };
    if (!match) failures.push('[' + s.id + '] ' + v.id + ' KHÁC V1 (total ' + full.total + '/' + base.total + ', vượt cuối total=' + beyond.total + ')');
  }
  out.variants = variants; return out;
}

(ON ? describe : describe.skip)('B1.2.3-B2 P1 r5-B: V3 với thống kê mới trên bản sao', () => {
  beforeAll(async () => {
    const c = createTestPrisma(); prisma = c.prisma; dbName = c.name;
    const want = process.env.BENCH_EXPECT_DB;
    if (!want || want !== dbName) throw new Error('BENCH_EXPECT_DB phải trùng đúng tên database (' + dbName + '). Chạy qua run-search-bench.bat -StatsClone.');
    if (!/^siscom_crm_restore_\d{8}_\d{6}$/.test(CLONE_OF) || CLONE_OF === dbName) throw new Error('BENCH_CLONE_OF không hợp lệ hoặc trùng bản sao: ' + CLONE_OF);
    await assertTestConnection(prisma, dbName);
    const marker = (await prisma.$queryRaw<{ m: string }[]>`SELECT coalesce(shobj_description(oid, 'pg_database'), '') AS m FROM pg_database WHERE datname = current_database()`)[0]?.m;
    if (marker !== 'SISCOM_STATS_CLONE_OF:' + CLONE_OF) throw new Error('Database không có nhãn bản sao của make-stats-clone -> TỪ CHỐI ghi. Nhãn hiện tại: "' + String(marker) + '"');
    fx = await loadFixturesReadOnly(prisma);
    const d = (await prisma.$queryRaw<{ cus: number; con: number }[]>`SELECT (SELECT count(*)::int FROM customer WHERE legacy_id LIKE 'PERF-%') AS cus, (SELECT count(*)::int FROM contact ct JOIN customer c ON c.id = ct.customer_id WHERE c.legacy_id LIKE 'PERF-%') AS con`)[0];
    if (d?.cus !== 50000 || d?.con !== 100000) throw new Error('Bản sao không có đúng 50.000/100.000 dữ liệu PERF. Dừng.');
    const busy = await busyNow();
    if (busy > 0) throw new Error('Có ' + busy + ' phiên khác hoạt động trên bản sao. Dừng.');
    report.database = dbName;
    report.versions = { postgres: (await prisma.$queryRaw<{ v: string }[]>`SHOW server_version`)[0]?.v, node: process.version };
    const applied = ((await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM customer WHERE legacy_id LIKE 'PERF-%' AND owner_id IS NOT NULL`)[0]?.n ?? 0) > 0;
    const opts = (await prisma.$queryRaw<{ o: string | null }[]>`SELECT reloptions::text AS o FROM pg_class WHERE oid = 'public.customer'::regclass`)[0]?.o ?? '';
    const setup: Record<string, unknown> = { alreadyApplied: applied, reloptionsBefore: opts };
    if (!/autovacuum_enabled=false/.test(opts)) {
      await prisma.$executeRaw`ALTER TABLE customer SET (autovacuum_enabled = false)`; // CHỈ bản sao: chặn auto-ANALYZE xen vào giai đoạn "thống kê cũ"
      setup.autovacuumDisabledNow = true;
    }
    if (!applied) {
      setup.startedAt = (await prisma.$queryRaw<{ t: string }[]>`SELECT clock_timestamp()::text AS t`)[0]?.t;
      let t0 = performance.now();
      setup.ownerRows = await prisma.$executeRaw`UPDATE customer SET owner_id = CASE (substr(legacy_id, 6)::int / 10) % 10 WHEN 1 THEN ${fx.empA}::uuid WHEN 2 THEN ${fx.empA}::uuid WHEN 3 THEN ${fx.empB}::uuid WHEN 4 THEN ${fx.empC}::uuid ELSE NULL END WHERE legacy_id LIKE 'PERF-%'`;
      setup.ownerMs = rd(performance.now() - t0); t0 = performance.now();
      setup.deletedRows = await prisma.$executeRaw`UPDATE customer SET deleted_at = now(), deleted_by = ${fx.empA}::uuid WHERE legacy_id LIKE 'PERF-%' AND substr(legacy_id, 6)::int % 97 = 0`;
      setup.deletedMs = rd(performance.now() - t0); t0 = performance.now();
      setup.taxRows = await prisma.$executeRaw`UPDATE customer SET tax_id = '0300' || lpad(substr(legacy_id, 6), 6, '0') WHERE legacy_id LIKE 'PERF-%' AND substr(legacy_id, 6)::int % 500 = 1 AND deleted_at IS NULL`;
      setup.taxMs = rd(performance.now() - t0);
    }
    report.setup = setup;
    F1 = await snapshot(); report.snapshotAfterSetup = F1;
  }, 600000);

  afterAll(async () => {
    const dir = process.env.PERF_REPORT_DIR ?? 'perf-report';
    mkdirSync(dir, { recursive: true });
    report.finishedAt = new Date().toISOString(); report.failures = failures; report.plans = plans; report.results = results;
    const f = join(dir, 'stats_clone_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    writeFileSync(f, JSON.stringify(report, null, 2));
    console.log('Báo cáo r5-B:', f);
    await prisma?.$disconnect();
  });

  it('A. thống kê CŨ: pg_stats + kế hoạch (EXPLAIN không ANALYZE) của V1–V8 cho nhóm 02/14/18', async () => {
    const si = await statsInfo(); report.statsStale = si;
    const ts = si.tableStats as { last_analyze: string | null; last_autoanalyze: string | null } | null;
    const setupAt = (report.setup as { startedAt?: string }).startedAt;
    report.staleContamination = setupAt && ts ? !!((ts.last_analyze && ts.last_analyze > setupAt) || (ts.last_autoanalyze && ts.last_autoanalyze > setupAt)) : null;
    await collectPlans('stale');
  }, 900000);

  (APPROVE ? it : it.skip)('B. ANALYZE customer (ngoài transaction, đã duyệt) + kế hoạch mới + thực thi V1–V8 (chỉ đọc, statement_timeout 120 s)', async () => {
    const t0 = performance.now();
    await prisma.$executeRaw`ANALYZE customer`;
    report.analyzeMs = rd(performance.now() - t0);
    report.statsFresh = await statsInfo();
    await collectPlans('fresh');
    for (const s of scenarios()) {
      const r = await execScenario(s); results[s.id] = r;
      const p = input(await foldOf(s.term), s.term, actorA(), s.o());
      const v3 = VARIANTS.find((v) => v.id === V3) as Variant;
      const ea = await explain(pageSql(p, v3, BIG, 0), true);
      r.v3ExplainAnalyze = ea.shape ?? { error: ea.error }; r.v3ExplainAnalyzeRaw = ea.raw;
    }
  }, 3600000);

  it('C. kết luận + kiểm tra phiên/fingerprint (kết quả đo, KHÔNG phải PASS/FAIL của V3)', async () => {
    const idle = await waitIdle(60000);
    const fin = await snapshot(); report.snapshotFinal = fin;
    if (idle > 0) failures.push('còn ' + idle + ' phiên hoạt động sau phép đo');
    if (JSON.stringify(fin) !== JSON.stringify(F1)) failures.push('dấu vân tay SAU khác SAU-SETUP: phép đo (chỉ đọc + ANALYZE) làm đổi dữ liệu');
    type V = { ok: boolean; match?: boolean; kind?: string; ms?: number };
    const concl: Record<string, unknown> = {};
    for (const s of scenarios()) {
      const sp = (plans.stale[s.id]?.[V3] as { page?: Record<string, unknown> } | undefined)?.page;
      const fp = (plans.fresh[s.id]?.[V3] as { page?: Record<string, unknown> } | undefined)?.page;
      const staleRep = !!sp && sp.nestedLoopSemi === true && typeof sp.ownerScanMinEstRows === 'number' && sp.ownerScanMinEstRows <= 10;
      const freshBad = fp ? fp.badShape === true : null;
      const ex = results[s.id]; const vs = ex?.variants as Record<string, V> | undefined; const v3 = vs?.[V3];
      let verdict: string;
      if (!APPROVE) verdict = 'STALE_ONLY: ANALYZE chưa được duyệt (-ApproveAnalyze); chỉ có bằng chứng kế hoạch cũ';
      else if (!ex || !vs) verdict = 'NOT_RUN';
      else if (v3 && !v3.ok) verdict = 'REJECTED: V3 vẫn lỗi (' + String(v3.kind) + ') với thống kê mới';
      else if (!v3) verdict = 'INCOMPLETE: không tới được V3 (dừng ở ' + String(ex.stoppedAt) + ')';
      else if (v3.match === false) verdict = 'MISMATCH: V3 khác V1';
      else if (staleRep && freshBad === false) verdict = 'CONFIRMED: kế hoạch cũ tái hiện (Nested Loop Semi, ước lượng ≤10 dòng); thống kê mới đổi kế hoạch; V3 chạy xong và khớp V1';
      else if (!staleRep) verdict = 'INCONCLUSIVE: kế hoạch cũ KHÔNG tái hiện được trên bản sao (staleContamination=' + String(report.staleContamination) + ')';
      else verdict = 'PARTIAL: V3 chạy xong nhưng kế hoạch mới vẫn dạng Nested Loop Semi không Materialize';
      concl[s.id] = { name: s.name, verdict, staleReproduced: staleRep, staleOwnerEstRows: sp?.ownerScanMinEstRows ?? null, freshBadShape: freshBad, v1Ms: vs?.[BASELINE]?.ms ?? null, v2Ms: vs?.['V2_union_two_orig']?.ms ?? null, v3Ms: v3?.ms ?? null };
    }
    const verdicts = Object.values(concl).map((c) => (c as { verdict: string }).verdict);
    const recommendation = !APPROVE ? 'Chưa có số đo thống kê mới (cần -ApproveAnalyze).'
      : verdicts.some((v) => v.startsWith('REJECTED') || v.startsWith('MISMATCH')) ? 'ĐỀ XUẤT loại V3 khỏi ứng viên P2: V3 vẫn lỗi hoặc sai khi thống kê đã mới. Không sửa SQL để vượt kiểm thử.'
      : verdicts.every((v) => v.startsWith('CONFIRMED')) ? 'Giả thuyết xác nhận: V3 chạy đúng khi thống kê đúng, nhưng nhạy với ước lượng sai (kế hoạch cũ treo 120 s). Cân nhắc ở P2; kết quả này KHÔNG chứng minh V3 an toàn khi thống kê lệch.'
      : 'Kết quả hỗn hợp/chưa đủ: xem verdict từng nhóm; không kết luận V3 an toàn.';
    report.conclusion = { perScenario: concl, recommendation };
    console.log('KẾT LUẬN r5-B: ' + JSON.stringify(concl, null, 1) + '\n' + recommendation);
    if (failures.length) throw new Error('Phép đo không hợp lệ hoặc có sai khác kết quả:\n' + failures.join('\n'));
  }, 180000);
});
