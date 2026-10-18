// B1.2.3-B2 P1 – Benchmark & Proof (KHÔNG phải test nghiệm thu, KHÔNG đổi ngưỡng). Chỉ chạy trên DB thử đã xác minh.
// Đọc dữ liệu tổng hợp có sẵn (50.000 khách PERF-* / 100.000 liên hệ); KHÔNG seed, KHÔNG tạo index.
// Kịch bản phạm vi/xoá mềm/MST cần dữ liệu khác: chạy trong MỘT transaction và ROLLBACK (không lưu gì).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../src/generated/prisma/client';
import type { Actor, Scope } from '../../../src/common/auth/actor';
import { CUSTOMER_DETAIL_INCLUDE } from '../../../src/modules/customers/customers.queries';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { Fixtures } from '../../helpers/fixtures';
import { loadFixturesReadOnly } from './readonly-fixtures';
import { as, makeApp, TestApp } from '../../helpers/test-app';
import { assertTestConnection, createTestPrisma } from '../../helpers/test-db';
import { BASELINE, BenchInput, countSql, pageSql, runVariant, Variant, VARIANTS } from './search-variants';

const LIMITS = { list: 150, search3: 500, search2: 1500 }; // đã duyệt, KHÔNG đổi
const ROUNDS = Math.max(3, Number(process.env.BENCH_ROUNDS ?? 3));
const SAMPLES = Math.max(15, Number(process.env.BENCH_SAMPLES ?? 15));
const WARMUP = Number(process.env.BENCH_WARMUP ?? 3);
const PROOF = process.env.BENCH_PROOF_ONLY === '1'; // chỉ chạy test 1 (đối chiếu) + test 7 (kết luận); không EXPLAIN/p95/HTTP/UPDATE
const FAILED_ONLY = process.env.BENCH_FAILED_ONLY === '1'; // chạy lại đúng 5 nhóm: S0b, 02, 14, 15, 18 (KHÔNG phải nghiệm thu 23 nhóm)
const ANALYZE_IN_TX = process.env.BENCH_ANALYZE_IN_TX === '1'; // tuỳ chọn: ANALYZE customer trong transaction sau UPDATE owner (thống kê cũng ROLLBACK)
const SEL = new Set(['2', '14', '15', '18']); // FailedOnly: 4 nhóm (S0b đã bỏ: r5-A kiểm chứng timeout độc lập)
const STEP_GUARD_MS = 330000; // hạn cục bộ mỗi nhóm: quá hạn thì KHÔNG gửi thêm câu nào (Prisma timeout 480 s, statement_timeout 120 s; không tăng)
const REQUIRE_FRESH = process.env.BENCH_REQUIRE_FRESH_STATS === '1'; // r5-C: bản sao đã ANALYZE; dừng nếu thống kê owner_id đang cũ
const SCEN = process.env.BENCH_SCENARIOS_ONLY === '1' || FAILED_ONLY; // chỉ chạy bài 6 + bài 7; không bài 1/3/4/5
const HTTP = process.env.BENCH_HTTP !== '0' && !PROOF && !SCEN;
const heavy = PROOF || SCEN ? it.skip : it;
const scen = PROOF ? it.skip : it;
const proofIt = SCEN ? it.skip : it;
const PAGE = 20;
const ALL_TERMS: { term: string; sortBy: string }[] = [
  { term: 'minh phat', sortBy: 'relevance' }, { term: 'dien lanh', sortBy: 'relevance' }, { term: 'cumperf', sortBy: 'relevance' },
  { term: 'nguyen van', sortBy: 'relevance' }, { term: '0912345', sortBy: 'relevance' }, { term: 'mi', sortBy: 'createdAt' },
];
const pick = <T extends { id?: string; term?: string }>(xs: T[], env: string | undefined, key: (x: T) => string): T[] => (env ? xs.filter((x) => env.split(',').map((s) => s.trim()).includes(key(x))) : xs);
const TERMS = pick(ALL_TERMS, process.env.BENCH_TERMS, (x) => x.term);
const VARS = (() => { const v = pick(VARIANTS, process.env.BENCH_VARIANTS, (x) => x.id); return v.some((x) => x.id === BASELINE) ? v : [VARIANTS[0] as Variant, ...v]; })();
const limitOf = (term: string): number => (term.length < 3 ? LIMITS.search2 : LIMITS.search3);

let prisma: PrismaService; let fx: Fixtures; let t: TestApp | undefined; let dbName = ''; let before: Record<string, unknown> = {};
const report: Record<string, unknown> = { kind: 'B1.2.3-B2-P1-bench', startedAt: new Date().toISOString(), limits: LIMITS, rounds: ROUNDS, samples: SAMPLES, warmup: WARMUP, variants: VARS.map((v) => v.id), terms: TERMS, proofOnly: PROOF, scenariosOnly: SCEN };
const plans: Record<string, unknown> = {};
const failures: string[] = [];

const p95 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)] as number; };
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2; };
const r1 = (x: number): number => Math.round(x * 10) / 10;

// Dấu vân tay dữ liệu: PERF-* (mọi cột bị UPDATE + vài cột khác) và số dòng các bảng liên quan. Trước == sau ⇒ không còn thay đổi nào.
async function snapshot(): Promise<Record<string, unknown>> {
  const r = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT
    (SELECT md5(string_agg(concat_ws('|', id, owner_id, deleted_at, deleted_by, tax_id, version, updated_at, tier_id, status_id, name, phone), ',' ORDER BY id)) FROM customer WHERE legacy_id LIKE 'PERF-%') AS perf_fingerprint,
    (SELECT count(*)::int FROM customer WHERE legacy_id LIKE 'PERF-%' AND (owner_id IS NOT NULL OR deleted_at IS NOT NULL OR deleted_by IS NOT NULL OR tax_id IS NOT NULL)) AS perf_modified_rows,
    (SELECT count(*)::int FROM customer) AS customer, (SELECT count(*)::int FROM contact) AS contact, (SELECT count(*)::int FROM lookup_item) AS lookup_item,
    (SELECT count(*)::int FROM department) AS department, (SELECT count(*)::int FROM employee) AS employee, (SELECT count(*)::int FROM audit_log) AS audit_log`;
  return r[0] ?? {};
}
const deadTuples = async (): Promise<unknown> => (await prisma.$queryRaw<{ customer: number | null; contact: number | null }[]>`SELECT (SELECT n_dead_tup::int FROM pg_stat_user_tables WHERE relname = 'customer') AS customer, (SELECT n_dead_tup::int FROM pg_stat_user_tables WHERE relname = 'contact') AS contact`)[0];

async function foldOf(q: Pick<Prisma.TransactionClient, '$queryRaw'>, s: string): Promise<string> {
  return (await q.$queryRaw<{ t: string | null }[]>(Prisma.sql`SELECT public.f_vn_fold(btrim(${s})) AS t`))[0]?.t ?? '';
}
function input(folded: string, raw: string, actor: Actor, o: Partial<BenchInput> = {}): BenchInput {
  return { actor, folded, raw, deletedOnly: false, readScope: 'ALL' as Scope, restoreScope: null, ids: {}, sortBy: 'relevance', order: 'desc', ...o };
}

// Một mẫu = đúng các bước của runSearch: fold → lõi (biến thể) → nạp chi tiết 20 dòng bằng Prisma, trong transaction REPEATABLE READ.
async function sample(raw: string, sortBy: string, v: Variant): Promise<number> {
  const t0 = performance.now();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`; // mẫu đo không thể ghi
    const folded = await foldOf(tx, raw);
    const r = await runVariant(tx, input(folded, raw, { employeeId: fx.empA, departmentId: fx.d1 }, { sortBy }), v, PAGE, 0);
    if (r.ids.length) await tx.customer.findMany({ where: { id: { in: r.ids } }, include: CUSTOMER_DETAIL_INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 60000 });
  return performance.now() - t0;
}

// ───── EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON): rút gọn các nút để báo cáo; kế hoạch đầy đủ lưu file riêng ─────
type PNode = Record<string, unknown> & { Plans?: PNode[] };
function summarize(planJson: unknown): Record<string, unknown> {
  const root = (Array.isArray(planJson) ? planJson[0] : planJson) as { Plan: PNode; 'Execution Time': number; 'Planning Time': number };
  const nodes: PNode[] = []; const walk = (n: PNode): void => { nodes.push(n); (n.Plans ?? []).forEach(walk); }; walk(root.Plan);
  const scans = nodes.filter((n) => /Scan/.test(String(n['Node Type']))).map((n) => ({ node: n['Node Type'], rel: n['Relation Name'] ?? null, index: n['Index Name'] ?? null, estRows: n['Plan Rows'], actRows: n['Actual Rows'], loops: n['Actual Loops'] }));
  return {
    executionMs: root['Execution Time'], planningMs: root['Planning Time'],
    sharedHit: root.Plan['Shared Hit Blocks'], sharedRead: root.Plan['Shared Read Blocks'], tempRead: root.Plan['Temp Read Blocks'], tempWritten: root.Plan['Temp Written Blocks'],
    seqScanCustomer: nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'customer'),
    seqScanContact: nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'contact'),
    indexesUsed: [...new Set(nodes.map((n) => n['Index Name']).filter(Boolean))],
    hashAggregate: nodes.some((n) => n['Node Type'] === 'Aggregate' && n.Strategy === 'Hashed') || nodes.some((n) => n['Node Type'] === 'HashAggregate'),
    hashedSubPlan: nodes.some((n) => /hashed SubPlan/.test(String(n['Subplan Name'] ?? ''))),
    sortMethod: nodes.filter((n) => n['Sort Method']).map((n) => n['Sort Method']),
    nodeTypes: [...new Set(nodes.map((n) => n['Node Type']))], scans,
  };
}
async function explain(q: Prisma.Sql): Promise<{ summary: Record<string, unknown>; raw: unknown }> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`);
  let raw = rows[0]?.['QUERY PLAN'];
  if (typeof raw === 'string') raw = JSON.parse(raw);
  return { summary: summarize(raw), raw };
}

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma; dbName = c.name;
  const want = process.env.BENCH_EXPECT_DB;
  if (!want || want !== dbName) throw new Error('BENCH_EXPECT_DB phải trùng đúng tên database thử (' + dbName + '). Chạy qua scripts\\windows\\run-search-bench.bat.');
  await assertTestConnection(prisma, dbName);
  const d = (await prisma.$queryRaw<{ cus: number; con: number; codes: number; dup: number }[]>`
    SELECT (SELECT count(*)::int FROM customer WHERE legacy_id LIKE 'PERF-%') AS cus,
           (SELECT count(*)::int FROM contact ct JOIN customer c ON c.id = ct.customer_id WHERE c.legacy_id LIKE 'PERF-%') AS con,
           (SELECT count(*)::int FROM customer) AS codes,
           (SELECT count(*)::int - count(DISTINCT code)::int FROM customer) AS dup`)[0];
  if (d?.cus !== 50000 || d?.con !== 100000) throw new Error('DB thử không có đúng dữ liệu tổng hợp (khách PERF=' + String(d?.cus) + ', liên hệ PERF=' + String(d?.con) + '). Benchmark KHÔNG tự seed. DỪNG.');
  if (d.dup !== 0) throw new Error('customer.code không duy nhất -> tie-break không ổn định. DỪNG.');
  report.database = { name: dbName, perfCustomers: d.cus, perfContacts: d.con, allCustomers: d.codes };
  report.pgSettings = await prisma.$queryRaw`SELECT name, setting FROM pg_settings WHERE name IN ('server_version','shared_buffers','work_mem','effective_cache_size','random_page_cost','jit','plan_cache_mode','max_parallel_workers_per_gather') ORDER BY name`;
  report.stats = await prisma.$queryRaw`SELECT relname, n_live_tup::int AS live, n_dead_tup::int AS dead, last_analyze::text, last_autoanalyze::text FROM pg_stat_user_tables WHERE relname IN ('customer','contact')`;
  fx = await loadFixturesReadOnly(prisma); // CHỈ ĐỌC; thiếu thì dừng, không tự tạo
  before = await snapshot();
  report.snapshotBefore = before;
  if (HTTP) t = await makeApp(prisma, fx);
}, 600000);

afterAll(async () => {
  const dir = process.env.PERF_REPORT_DIR ?? 'perf-report';
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  report.finishedAt = new Date().toISOString(); report.failures = failures;
  writeFileSync(join(dir, (PROOF ? 'proof_' : SCEN ? 'scen_' : 'bench_') + ts + '.json'), JSON.stringify(report, null, 2));
  if (!PROOF && !SCEN) writeFileSync(join(dir, 'bench_plans_' + ts + '.json'), JSON.stringify(plans, null, 2));
  console.log('Báo cáo P1:', join(dir, (PROOF ? 'proof_' : SCEN ? 'scen_' : 'bench_') + ts + '.json'), PROOF ? '(ProofOnly)' : SCEN ? '(ScenariosOnly)' : '| Kế hoạch đầy đủ: ' + join(dir, 'bench_plans_' + ts + '.json'));
  if (t) await t.app.close();
  await prisma?.$disconnect();
});

describe('B1.2.3-B2 P1: benchmark & proof (DB thử)', () => {
  proofIt('1. đúng đắn trên dữ liệu thật: tổng, toàn bộ ID theo thứ tự, trang đầu/giữa/cuối/vượt cuối (mọi biến thể = V1)', async () => {
    const actor = { employeeId: fx.empA, departmentId: fx.d1 };
    const out: Record<string, unknown>[] = [];
    for (const { term, sortBy } of TERMS) {
      const folded = await foldOf(prisma, term);
      const p = input(folded, term, actor, { sortBy });
      const base = await runVariant(prisma, p, VARIANTS[0] as Variant, 2147483647, 0);
      const direct = Number((await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM public.fn_customer_search(${term}, 2147483647)`)[0]?.n);
      if (base.total !== direct) failures.push(`[${term}] V1 total=${base.total} khác fn_customer_search=${direct}`);
      if (base.ids.length !== base.total) failures.push(`[${term}] V1 số ID=${base.ids.length} khác total=${base.total}`);
      const last = Math.max(1, Math.ceil(base.total / PAGE));
      const pages = [...new Set([1, Math.ceil(last / 2), last, last + 1])];
      const row: Record<string, unknown> = { term, sortBy, total: base.total, fnCustomerSearch: direct, pagesChecked: pages };
      for (const v of VARS) {
        const full = await runVariant(prisma, p, v, 2147483647, 0);
        const sameTotal = full.total === base.total; const sameOrder = full.ids.length === base.ids.length && full.ids.every((id, i) => id === base.ids[i]);
        const sameSet = sameOrder || (() => { const a = new Set(base.ids); return full.ids.length === a.size && full.ids.every((x) => a.has(x)); })();
        let pagesOk = true;
        for (const pg of pages) {
          const r = await runVariant(prisma, p, v, PAGE, (pg - 1) * PAGE);
          const exp = base.ids.slice((pg - 1) * PAGE, pg * PAGE);
          if (r.total !== base.total || r.ids.length !== exp.length || r.ids.some((id, i) => id !== exp[i])) pagesOk = false;
        }
        row[v.id] = { sameTotal, sameSet, sameOrder, pagesOk };
        if (!sameTotal || !sameSet || !sameOrder || !pagesOk) failures.push(`[${term}] ${v.id}: total=${sameTotal} set=${sameSet} order=${sameOrder} pages=${pagesOk}`);
      }
      out.push(row);
    }
    report.correctness = out;
  }, 3600000);

  heavy('3. EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) cho COUNT và trang relevance của từng biến thể', async () => {
    const actor = { employeeId: fx.empA, departmentId: fx.d1 };
    const sum: Record<string, Record<string, unknown>> = {};
    for (const { term, sortBy } of TERMS) {
      const p = input(await foldOf(prisma, term), term, actor, { sortBy });
      sum[term] = {};
      for (const v of VARS) {
        const page = await explain(pageSql(p, v, PAGE, 0));
        const entry: Record<string, unknown> = { page: page.summary };
        plans[`${term}|${v.id}|page`] = page.raw;
        if (v.count === 'two') { const cnt = await explain(countSql(p, v)); entry.count = cnt.summary; plans[`${term}|${v.id}|count`] = cnt.raw; }
        (sum[term] as Record<string, unknown>)[v.id] = entry;
      }
    }
    report.explain = sum;
  }, 3600000);

  heavy('4. p95 lõi tìm kiếm: warm-up + ' + ROUNDS + ' vòng × ' + SAMPLES + ' mẫu, thứ tự biến thể xoay vòng mỗi vòng', async () => {
    for (const { term, sortBy } of TERMS) for (const v of VARS) for (let i = 0; i < WARMUP; i++) await sample(term, sortBy, v);
    const res: Record<string, Record<string, { rounds: { p95: number; median: number; max: number }[] }>> = {};
    for (let r = 0; r < ROUNDS; r++) {
      const order = VARS.map((_, i) => VARS[(i + r) % VARS.length] as Variant);
      for (const { term, sortBy } of TERMS) for (const v of order) {
        const xs: number[] = []; for (let i = 0; i < SAMPLES; i++) xs.push(await sample(term, sortBy, v));
        const slot = ((res[term] ??= {})[v.id] ??= { rounds: [] });
        slot.rounds.push({ p95: r1(p95(xs)), median: r1(median(xs)), max: r1(Math.max(...xs)) });
      }
    }
    const final: Record<string, Record<string, unknown>> = {};
    for (const [term, byV] of Object.entries(res)) {
      final[term] = {};
      for (const [vid, s] of Object.entries(byV)) {
        const ps = s.rounds.map((x) => x.p95);
        (final[term] as Record<string, unknown>)[vid] = { rounds: s.rounds, p95Median: r1(median(ps)), p95Worst: r1(Math.max(...ps)), limit: limitOf(term), coreUnderLimitAllRounds: Math.max(...ps) < limitOf(term) };
      }
    }
    report.coreP95 = final;
  }, 7200000);

  (HTTP ? it : it.skip)('5. hiệu chuẩn HTTP: API hiện tại (= V1) cùng số vòng/mẫu, để ước lượng phần chênh HTTP/Nest/serialize', async () => {
    const app = (t as TestApp).app;
    const api = (q: string) => as(app, 'all').get('/api/v1/customers' + q);
    const timed = async (q: string): Promise<number[]> => { const xs: number[] = []; for (let i = 0; i < SAMPLES; i++) { const t0 = performance.now(); const r = await api(q); if (r.status !== 200) throw new Error('HTTP ' + r.status); xs.push(performance.now() - t0); } return xs; };
    const qOf = (term: string, sortBy: string) => '?pageSize=' + PAGE + (sortBy === 'relevance' ? '&sortBy=relevance' : '') + '&search=' + encodeURIComponent(term);
    for (let i = 0; i < WARMUP; i++) { await api('?pageSize=20&page=1'); for (const { term, sortBy } of TERMS) await api(qOf(term, sortBy)); }
    const out: Record<string, unknown> = {};
    const listR: number[] = []; for (let r = 0; r < ROUNDS; r++) listR.push(r1(p95(await timed('?pageSize=20&page=1'))));
    out.list = { roundsP95: listR, limit: LIMITS.list };
    for (const { term, sortBy } of TERMS) { const rs: number[] = []; for (let r = 0; r < ROUNDS; r++) rs.push(r1(p95(await timed(qOf(term, sortBy))))); out[term] = { roundsP95: rs, limit: limitOf(term) }; }
    report.httpBaseline = out;
  }, 3600000);

  scen('6. kịch bản phạm vi/xoá mềm/mã/MST/liên hệ/SĐT/bộ lọc: MỖI kịch bản một transaction nhỏ, ROLLBACK độc lập, kiểm tra dữ liệu sau từng nhóm', async () => {
    const A: Actor = { employeeId: fx.empA, departmentId: fx.d1 }; const C: Actor = { employeeId: fx.empC, departmentId: fx.d2 };
    const MARK = '__bench_rollback__'; const TX_MS = 480000; const BUDGET_MS = Number(process.env.BENCH_SCEN_BUDGET_MIN ?? 40) * 60000;
    const busyNow = async (): Promise<number> => (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`)[0]?.n ?? 0;
    const busy0 = await busyNow();
    if (busy0 > 0) throw new Error('Có ' + busy0 + ' phiên khác đang hoạt động trên DB thử; UPDATE sẽ khoá chúng. Dừng, KHÔNG sửa dữ liệu.');
    if (REQUIRE_FRESH) {
      const st = (await prisma.$queryRaw<{ nf: number | null; actual: number | null }[]>`SELECT (SELECT null_frac::float8 FROM pg_stats WHERE schemaname = 'public' AND tablename = 'customer' AND attname = 'owner_id') AS nf, (SELECT (count(*) FILTER (WHERE owner_id IS NULL))::float8 / greatest(count(*), 1) FROM customer) AS actual`)[0];
      report.statsPrecheck = { nullFracInStats: st?.nf ?? null, nullFracActual: st?.actual ?? null };
      if (st?.nf == null || st?.actual == null || Math.abs(st.nf - st.actual) > 0.25) throw new Error('Thống kê owner_id đang CŨ hoặc thiếu (stats=' + String(st?.nf) + ', thực tế=' + String(st?.actual) + '). r5-C chỉ chạy trên bản sao đã ANALYZE. Dừng, KHÔNG ghi gì.');
    }
    report.r5c = { stepGuardMs: STEP_GUARD_MS, statementTimeout: '120s', txTimeoutMs: TX_MS, requireFreshStats: REQUIRE_FRESH };
    report.deadTuplesBeforeScenarios = await deadTuples();
    type Tx = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
    interface GroupResult { group: string; expectedStatus: string; actualStatus: string; errorCode?: string; outcome: 'PASS' | 'FAIL' | 'SKIPPED' | 'NOT_RUN'; ms: number; error?: string; fails: string[]; detail?: Record<string, unknown>; fingerprintEqual: boolean; lingeringSessions: number; lingerWaitMs: number; rollbackVerified: boolean }
    const results: GroupResult[] = [];
    let haltReason: string | null = null; // đặt khi KHÔNG xác minh được rollback -> không chạy thêm nhóm UPDATE nào
    const waitIdle = async (limitMs: number): Promise<{ n: number; waited: number }> => { const t0 = Date.now(); let n = await busyNow(); while (n > 0 && Date.now() - t0 < limitMs) { await new Promise((r) => setTimeout(r, 500)); n = await busyNow(); } return { n, waited: Date.now() - t0 }; };
    const skip = (group: string, why: string): void => { results.push({ group, expectedStatus: 'OK', actualStatus: 'NOT_RUN', outcome: 'SKIPPED', ms: 0, fails: [why], fingerprintEqual: true, lingeringSessions: 0, lingerWaitMs: 0, rollbackVerified: false }); failures.push('[' + group + '] SKIPPED: ' + why); console.log('[nhóm] ' + group + ' | SKIPPED | ' + why); };
    const notRun = (group: string): void => { results.push({ group, expectedStatus: 'OK', actualStatus: 'NOT_RUN', outcome: 'NOT_RUN', ms: 0, fails: [], fingerprintEqual: true, lingeringSessions: 0, lingerWaitMs: 0, rollbackVerified: false }); };
    // Một nhóm = một transaction: chạy body rồi LUÔN chủ động ném lỗi để ROLLBACK. Sau đó (thành công, exception hay timeout) chờ phiên kết thúc, so dấu vân tay. Mọi phần kiểm tra sau đó nằm trong try/catch nên kết quả luôn được ghi.
    const runGroup = async (group: string, body: (tx: Tx, fail: (m: string) => void) => Promise<Record<string, unknown>>, o: { txMs?: number; expected?: 'OK' | 'ERROR' | 'TIMEOUT' } = {}): Promise<void> => {
      if (haltReason) { skip(group, 'dừng vì ' + haltReason); return; }
      const expectedStatus = o.expected ?? 'OK'; const fails: string[] = []; const t0 = performance.now();
      let actualStatus = 'OK'; let error: string | undefined; let errorCode: string | undefined; let detail: Record<string, unknown> | undefined;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '120s'`;
          await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = '300s'`;
          detail = await body(tx, (m) => fails.push(m));
          throw new Error(MARK);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: o.txMs ?? TX_MS });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        errorCode = (e as { code?: string } | null)?.code;
        // TIMEOUT chỉ khi là timeout GIAO DỊCH của Prisma (P2028 / transaction expired). statement_timeout của PostgreSQL và mọi lỗi khác KHÔNG bị gộp vào TIMEOUT.
        if (m !== MARK) { actualStatus = (errorCode === 'P2028' || /expired transaction|Transaction already closed|Transaction API error/i.test(m)) ? 'TIMEOUT' : /statement timeout|canceling statement/i.test(m) ? 'STATEMENT_TIMEOUT' : 'ERROR'; error = m.slice(0, 600); }
      }
      const ms = Math.round(performance.now() - t0);
      let idleN = -1; let waited = 0; let fpEqual = false; let verifyErr: string | undefined;
      try { const idle = await waitIdle(60000); idleN = idle.n; waited = idle.waited; fpEqual = JSON.stringify(await snapshot()) === JSON.stringify(before); } catch (e) { verifyErr = e instanceof Error ? e.message.slice(0, 200) : String(e); }
      const rollbackVerified = !verifyErr && fpEqual && idleN === 0;
      if (!rollbackVerified) { fails.push('ROLLBACK KHÔNG XÁC MINH ĐƯỢC: dấu vân tay ' + (fpEqual ? 'khớp' : 'KHÁC/không đo được') + ', phiên còn hoạt động=' + idleN + (verifyErr ? ', lỗi kiểm tra: ' + verifyErr : '')); haltReason = 'nhóm "' + group + '" không xác minh được rollback'; }
      if (expectedStatus === 'TIMEOUT' && o.txMs) { if (!(error ?? '').includes(String(o.txMs))) fails.push('lỗi timeout không nêu đúng giới hạn Prisma ' + o.txMs + ' ms: ' + (error ?? '(không có lỗi)')); if (ms < o.txMs) fails.push('nhóm kết thúc sau ' + ms + ' ms < ' + o.txMs + ' ms: timeout Prisma chưa thực sự xảy ra'); }
      if (actualStatus !== expectedStatus) fails.push('trạng thái thực tế ' + actualStatus + ' khác kỳ vọng ' + expectedStatus + (error ? ' (' + error + ')' : ''));
      const outcome: 'PASS' | 'FAIL' = fails.length ? 'FAIL' : 'PASS';
      results.push({ group, expectedStatus, actualStatus, outcome, ms, error, errorCode, fails, detail, fingerprintEqual: fpEqual, lingeringSessions: idleN, lingerWaitMs: waited, rollbackVerified });
      fails.forEach((m) => failures.push('[' + group + '] ' + m));
      console.log('[nhóm] ' + group + ' | ' + outcome + ' (thực tế ' + actualStatus + ', kỳ vọng ' + expectedStatus + ') | ' + ms + ' ms | rollback ' + (rollbackVerified ? 'OK' : 'LỖI'));
    };
    // VACUUM: ngoài transaction, chỉ trên DB thử (current_database() đúng tên), chỉ khi không còn phiên nào hoạt động. Thất bại -> ghi vào failures.
    const vacuum = async (label: string): Promise<void> => {
      if (haltReason) return;
      try {
        const db = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]?.d;
        if (db !== dbName) throw new Error('current_database()=' + String(db) + ' khác DB thử ' + dbName);
        const idle = await waitIdle(60000);
        if (idle.n > 0) throw new Error('còn ' + idle.n + ' phiên đang hoạt động, không VACUUM');
        const t0 = performance.now(); await prisma.$executeRaw`VACUUM (ANALYZE) customer`;
        report.vacuumMs = [...((report.vacuumMs as number[]) ?? []), Math.round(performance.now() - t0)];
        report.vacuumLog = [...((report.vacuumLog as unknown[]) ?? []), { label, db, idleBefore: idle.n, ms: Math.round(performance.now() - t0) }];
      } catch (e) { const m = e instanceof Error ? e.message.slice(0, 200) : String(e); report.vacuumError = m; failures.push('[VACUUM ' + label + '] THẤT BẠI: ' + m); }
    };
    const setOwner = (tx: Tx) => tx.$executeRaw`UPDATE customer SET owner_id = CASE (substr(legacy_id, 6)::int / 10) % 10 WHEN 1 THEN ${fx.empA}::uuid WHEN 2 THEN ${fx.empA}::uuid WHEN 3 THEN ${fx.empB}::uuid WHEN 4 THEN ${fx.empC}::uuid ELSE NULL END WHERE legacy_id LIKE 'PERF-%'`;
    const setDeleted = (tx: Tx) => tx.$executeRaw`UPDATE customer SET deleted_at = now(), deleted_by = ${fx.empA}::uuid WHERE legacy_id LIKE 'PERF-%' AND substr(legacy_id, 6)::int % 97 = 0`;
    const setTax = (tx: Tx) => tx.$executeRaw`UPDATE customer SET tax_id = '0300' || lpad(substr(legacy_id, 6), 6, '0') WHERE legacy_id LIKE 'PERF-%' AND substr(legacy_id, 6)::int % 500 = 1 AND deleted_at IS NULL`;
    const touch = (tx: Tx) => tx.$executeRaw`UPDATE customer SET owner_id = ${fx.empB}::uuid WHERE legacy_id LIKE 'PERF-%' AND substr(legacy_id, 6)::int <= 100`;
    const code = (await prisma.$queryRaw<{ c: string }[]>`SELECT code AS c FROM customer WHERE legacy_id = 'PERF-12345'`)[0]?.c ?? 'KH-00000';
    const tier = fx.tier.POTENTIAL as string;
    // Số điện thoại THẬT trong dữ liệu PERF (không bị xoá mềm/gán MST trong kịch bản) -> V1 phải trả về khác 0 và chứa đúng khách này.
    const realPhone = (await prisma.$queryRaw<{ id: string; phone: string }[]>`SELECT id, phone FROM customer WHERE legacy_id LIKE 'PERF-%' AND phone IS NOT NULL AND deleted_at IS NULL AND substr(legacy_id, 6)::int % 97 <> 0 AND substr(legacy_id, 6)::int % 500 <> 1 ORDER BY legacy_id LIMIT 1`)[0];
    if (!realPhone) throw new Error('Không có khách PERF nào có số điện thoại -> không thể dựng kịch bản SĐT. Dừng, không sửa dữ liệu.');
    report.realPhoneUsed = realPhone;
    const sc: { name: string; term: string; o: Partial<BenchInput>; owner: boolean; expectRows: boolean; mustInclude?: string }[] = [
      { name: 'ALL cumperf', term: 'cumperf', o: {}, owner: false, expectRows: true },
      { name: 'OWN A cumperf', term: 'cumperf', o: { readScope: 'OWN' }, owner: true, expectRows: true },
      { name: 'DEPARTMENT A(d1) cumperf', term: 'cumperf', o: { readScope: 'DEPARTMENT' }, owner: true, expectRows: true },
      { name: 'DEPARTMENT C(d2) cumperf', term: 'cumperf', o: { readScope: 'DEPARTMENT', actor: C }, owner: true, expectRows: true },
      { name: 'không quyền -> rỗng', term: 'cumperf', o: { readScope: null }, owner: false, expectRows: false },
      { name: 'deleted=only ALL/ALL', term: 'cumperf', o: { deletedOnly: true, restoreScope: 'ALL' }, owner: false, expectRows: true },
      { name: 'deleted=only ALL/OWN', term: 'cong ty', o: { deletedOnly: true, restoreScope: 'OWN' }, owner: true, expectRows: true },
      { name: 'deleted=only DEPT/ALL', term: 'minh phat', o: { deletedOnly: true, readScope: 'DEPARTMENT', restoreScope: 'ALL' }, owner: true, expectRows: true },
      { name: 'mã khách (một phần)', term: code.slice(0, -1), o: {}, owner: false, expectRows: true },
      { name: 'mã khách (đủ)', term: code, o: {}, owner: false, expectRows: true },
      { name: 'MST một phần', term: '0300000', o: {}, owner: false, expectRows: true },
      { name: 'MST đủ', term: '0300025001', o: {}, owner: false, expectRows: true },
      { name: 'tên liên hệ', term: 'le hoang an', o: {}, owner: false, expectRows: true },
      { name: 'tên liên hệ OWN', term: 'tran thi', o: { readScope: 'OWN' }, owner: true, expectRows: true },
      { name: 'SĐT nội địa (số thật trong PERF)', term: realPhone.phone, o: {}, owner: false, expectRows: true, mustInclude: realPhone.id },
      { name: 'SĐT có khoảng trắng', term: '0900 012 345', o: {}, owner: false, expectRows: true },
      { name: 'SĐT +84', term: '+84900012', o: {}, owner: false, expectRows: true },
      { name: 'ownerId B + tier', term: 'minh phat', o: { ownerId: fx.empB, ids: { tier } }, owner: true, expectRows: true },
      { name: '2 ký tự DEPARTMENT', term: 'mi', o: { readScope: 'DEPARTMENT', sortBy: 'createdAt' }, owner: true, expectRows: true },
      { name: 'sắp xếp tên tăng', term: 'dien lanh', o: { sortBy: 'name', order: 'asc' }, owner: false, expectRows: true },
      { name: 'relevance tăng', term: 'minh phat', o: { order: 'asc' }, owner: false, expectRows: true },
    ];
    const plannedTotal = 1 + sc.length; const planned = FAILED_ONLY ? SEL.size : plannedTotal;
    report.acceptanceScope = FAILED_ONLY ? 'PARTIAL: chỉ chạy lại 4 nhóm (02,14,15,18). KHÔNG phải nghiệm thu 22 nhóm.' : 'FULL: 22 nhóm (S0a + 21 kịch bản)';
    if (FAILED_ONLY) console.log('*** FailedOnly: chỉ 4 nhóm chạy; 18 nhóm còn lại NOT_RUN (không phải PASS). Không dùng kết quả này để nghiệm thu 22 nhóm. ***');
    try {
      if (!FAILED_ONLY) await runGroup('S0a rollback khi exception', async (tx, fail) => { const n = await touch(tx); if (n !== 100) fail('UPDATE thử chỉ chạm ' + n + ' dòng (kỳ vọng 100)'); throw new Error('bench-injected-exception'); }, { expected: 'ERROR' });
      else notRun('S0a rollback khi exception');
      const tAll = Date.now();
      for (const [i, s] of sc.entries()) {
        const label = String(i + 1).padStart(2, '0') + ' ' + s.name;
        if (FAILED_ONLY && !SEL.has(String(i + 1))) { notRun(label); continue; }
        if (Date.now() - tAll > BUDGET_MS) { skip(label, 'quá ngân sách thời gian ' + BUDGET_MS / 60000 + ' phút'); continue; }
        await runGroup(label, async (tx, fail) => {
          const timings: Record<string, number> = {}; const diag: Record<string, unknown>[] = []; let aborted = false; const groupT0 = performance.now();
          // Mỗi bước trong SAVEPOINT: lỗi/timeout của MỘT truy vấn được ghi lại chính xác (tên bước, ms, SQL, kế hoạch ước lượng, thống kê owner_id) mà transaction vẫn dùng được.
          const step = async <T>(name: string, fn: () => Promise<T>, p?: BenchInput, v?: Variant): Promise<T | undefined> => {
            if (!aborted && performance.now() - groupT0 > STEP_GUARD_MS) {
              aborted = true; timings['guard'] = Math.round(performance.now() - groupT0);
              fail('quá hạn cục bộ ' + STEP_GUARD_MS + ' ms trước bước "' + name + '": dừng nhóm, KHÔNG gửi thêm câu nào (rollback chủ động)');
              diag.push({ step: name, kind: 'LOCAL_DEADLINE', ms: timings['guard'] });
            }
            if (aborted) return undefined;
            await tx.$executeRaw`SAVEPOINT bench_sp`;
            const t0 = performance.now();
            try { const r = await fn(); timings[name] = Math.round(performance.now() - t0); await tx.$executeRaw`RELEASE SAVEPOINT bench_sp`; return r; }
            catch (e) {
              timings[name] = Math.round(performance.now() - t0); aborted = true;
              const m = e instanceof Error ? e.message.slice(0, 300) : String(e);
              const kind = /statement timeout|canceling statement/i.test(m) ? 'STATEMENT_TIMEOUT' : 'ERROR';
              fail('bước "' + name + '" ' + kind + ' sau ' + timings[name] + ' ms: ' + m);
              const d: Record<string, unknown> = { step: name, kind, ms: timings[name], error: m };
              try {
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT bench_sp`;
                d.ownerStats = await tx.$queryRaw`SELECT null_frac, n_distinct, most_common_vals::text AS mcv FROM pg_stats WHERE schemaname = 'public' AND tablename = 'customer' AND attname = 'owner_id'`;
                d.ownerNotNullLive = (await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM customer WHERE owner_id IS NOT NULL`)[0]?.n;
                if (p && v) for (const [k, q] of [['count', countSql(p, v)], ['page', pageSql(p, v, 2147483647, 0)]] as [string, Prisma.Sql][]) {
                  try {
                    const r = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`EXPLAIN (FORMAT JSON) ${q}`);
                    let raw = r[0]?.['QUERY PLAN']; if (typeof raw === 'string') raw = JSON.parse(raw);
                    d['plan_' + k] = summarize(raw); d['planRaw_' + k] = raw; d['sql_' + k] = String((q as { text?: string }).text ?? '').slice(0, 2500);
                  } catch (e3) { d['planError_' + k] = e3 instanceof Error ? e3.message.slice(0, 160) : String(e3); }
                }
              } catch (e2) { d.diagError = e2 instanceof Error ? e2.message.slice(0, 200) : String(e2); }
              diag.push(d); return undefined;
            }
          };
          if (s.owner) await step('setup.owner', async () => { await setOwner(tx); });
          if (s.owner && ANALYZE_IN_TX) await step('setup.analyze', async () => { await tx.$executeRaw`ANALYZE customer`; });
          await step('setup.deleted', async () => { await setDeleted(tx); });
          await step('setup.tax', async () => { await setTax(tx); });
          const folded = await step('fold', () => foldOf(tx, s.term));
          if (folded === undefined) return { term: s.term, timings, diag };
          const p = input(folded, s.term, A, s.o);
          const base = await step('V1 base (full)', () => runVariant(tx, p, VARIANTS[0] as Variant, 2147483647, 0), p, VARIANTS[0] as Variant);
          if (!base) return { term: s.term, timings, diag };
          if (s.expectRows && base.total === 0) fail('V1 rỗng -> kịch bản không kiểm được gì');
          if (!s.expectRows && base.total !== 0) fail('V1 phải rỗng nhưng total=' + base.total);
          if (s.mustInclude && !base.ids.includes(s.mustInclude)) fail('V1 không chứa khách ' + s.mustInclude + ' (số điện thoại thật ' + s.term + ')');
          const per: Record<string, unknown> = {};
          for (const v of VARS) {
            const full = await step(v.id + ' full', () => runVariant(tx, p, v, 2147483647, 0), p, v);
            const beyond = full ? await step(v.id + ' beyond', () => runVariant(tx, p, v, PAGE, (Math.ceil(base.total / PAGE) + 1) * PAGE), p, v) : undefined;
            if (!full || !beyond) break;
            const ok = full.total === base.total && full.ids.length === base.ids.length && full.ids.every((id, k) => id === base.ids[k]) && beyond.ids.length === 0 && beyond.total === base.total;
            per[v.id] = { ok };
            if (!ok) fail(v.id + ' khác V1 (total ' + full.total + '/' + base.total + ', vượt cuối total=' + beyond.total + ')');
          }
          return { term: s.term, total: base.total, timings, variants: per, diag, analyzeInTx: ANALYZE_IN_TX };
        });
        if (s.owner) await vacuum(label);
      }
      await vacuum('cuối bài');
    } finally {
      report.deadTuplesAfterScenarios = await deadTuples().catch(() => null);
      report.scenarioGroups = results;
      report.rollbackClean = results.length > 0 && results.every((r) => r.rollbackVerified || r.outcome === 'SKIPPED' || r.outcome === 'NOT_RUN') && !haltReason;
      report.scenarioTotalMs = results.reduce((x, r) => x + r.ms, 0);
      report.haltReason = haltReason;
      const pass = results.filter((r) => r.outcome === 'PASS').length;
      report.scenarioSummary = { fullSuite: !FAILED_ONLY, planned, pass, fail: results.filter((r) => r.outcome === 'FAIL').length, skipped: results.filter((r) => r.outcome === 'SKIPPED').length, notRunByDesign: results.filter((r) => r.outcome === 'NOT_RUN').length, neverReached: plannedTotal - results.length, note: FAILED_ONLY ? 'NOT_RUN không phải PASS; không nghiệm thu 23 nhóm' : undefined };
      if (pass !== planned) failures.push('Bài 6 KHÔNG đạt trọn vẹn: ' + JSON.stringify(report.scenarioSummary) + (haltReason ? ' | dừng vì ' + haltReason : ''));
    }
  }, 3600000);

  it('7. kết luận: dữ liệu không đổi so với trước khi chạy; mọi biến thể phải khớp V1 tuyệt đối (hiệu năng chỉ báo cáo, không tự chọn phương án)', async () => {
    const fin = await snapshot();
    report.snapshotAfter = fin;
    if (!PROOF) { const sm = report.scenarioSummary as { planned: number; pass: number } | undefined; if (!sm || sm.pass !== sm.planned) failures.push('Bài 6 chưa hoàn thành hoặc có nhóm FAIL/SKIPPED: ' + JSON.stringify(sm ?? null)); }
    if (JSON.stringify(fin) !== JSON.stringify(before)) failures.push('Dấu vân tay CUỐI KHÁC dữ liệu ĐẦU: ' + JSON.stringify({ before, after: fin }));
    { const sm2 = report.scenarioSummary as { planned: number; pass: number; fullSuite?: boolean } | undefined;
      if (!PROOF && !failures.length && sm2 && sm2.pass === sm2.planned) console.log(sm2.fullSuite === false ? 'FailedOnly: ' + sm2.pass + '/' + sm2.planned + ' nhóm PASS — KHÔNG phải nghiệm thu đầy đủ.' : 'r5-C: ' + sm2.pass + '/' + sm2.planned + ' nhóm PASS (S0a + 21 kịch bản), rollback và dấu vân tay sạch trên ' + dbName + ' — bài 6 NGHIỆM THU ĐẦY ĐỦ.'); }
    if (failures.length) throw new Error('Có ' + failures.length + ' sai khác:\n' + failures.join('\n'));
  });
});
