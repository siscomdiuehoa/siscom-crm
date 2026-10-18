// B1.2.3-B2 P2-3 – đo hiệu năng Customer API (đường V5 đã tích hợp) trên BẢN SAO PERF đã ANALYZE. CHỈ ĐỌC (HTTP GET + EXPLAIN khi cần). Chạy khi BENCH_API_PERF=1 (cờ -ApiPerf -CloneOf).
// Ngưỡng giữ nguyên: danh sách < 150 ms; tìm ≥3 ký tự < 500 ms; 2 ký tự < 1500 ms. Mỗi ca: warm-up + ROUNDS vòng × SAMPLES mẫu; p95 từng vòng, kết luận theo p95 vòng XẤU NHẤT.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../../src/generated/prisma/client';
import { buildSearchPageQuery, chooseSearchPath } from '../../../src/modules/customers/customers.search';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { as, makeApp, TestApp } from '../../helpers/test-app';
import { assertTestConnection, createTestPrisma } from '../../helpers/test-db';
import type { Fixtures } from '../../helpers/fixtures';
import { loadFixturesReadOnly } from './readonly-fixtures';

const ON = process.env.BENCH_API_PERF === '1';
const LIMITS = { list: 150, search3: 500, search2: 1500 };
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 3), SAMPLES = Number(process.env.BENCH_SAMPLES ?? 15), WARMUP = Number(process.env.BENCH_WARMUP ?? 3);
const CASES = process.env.BENCH_CASES ? new RegExp(process.env.BENCH_CASES) : null; // chỉ đo các ca khớp (ví dụ trang 100); không đặt = đo tất cả
const URL = '/api/v1/customers';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let dbName = ''; let phone = '';
const report: Record<string, unknown> = { kind: 'B1.2.3-B2-P2-3-api-perf', startedAt: new Date().toISOString(), limits: LIMITS, rounds: ROUNDS, samples: SAMPLES, warmup: WARMUP };
const cases: Record<string, unknown>[] = [];
const p95 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)] as number; };
const r1 = (x: number): number => Math.round(x * 10) / 10;
const busyNow = async (): Promise<number> => (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`)[0]?.n ?? 0;
const counts = async () => (await prisma.$queryRaw<Record<string, number>[]>`SELECT (SELECT count(*)::int FROM customer) AS customer, (SELECT count(*)::int FROM contact) AS contact, (SELECT count(*)::int FROM audit_log) AS audit_log`)[0];

async function measure(name: string, who: string, query: string, limit: number, opts: { expectRows?: boolean } = {}): Promise<void> {
  if (CASES && !CASES.test(name)) return;
  const get = () => as(t.app, who).get(URL + query);
  let total = -1; let status = 0;
  for (let i = 0; i < WARMUP; i++) { const r = await get(); status = r.status; total = r.body?.data?.total ?? -1; if (r.status !== 200) break; }
  const rec: Record<string, unknown> = { name, who, query, limit, status, total };
  if (status !== 200) { rec.verdict = 'FAIL'; rec.reason = 'HTTP ' + status; cases.push(rec); return; }
  const rounds: number[] = []; const all: number[] = [];
  for (let k = 0; k < ROUNDS; k++) { const xs: number[] = []; for (let i = 0; i < SAMPLES; i++) { const t0 = performance.now(); const r = await get(); const dt = performance.now() - t0; if (r.status !== 200) { rec.verdict = 'FAIL'; rec.reason = 'HTTP ' + r.status; cases.push(rec); return; } xs.push(dt); } rounds.push(r1(p95(xs))); all.push(...xs); }
  const worst = Math.max(...rounds);
  rec.p95PerRound = rounds; rec.p95Worst = worst; rec.p50 = r1([...all].sort((a, b) => a - b)[Math.floor(all.length / 2)] as number); rec.max = r1(Math.max(...all));
  const reasons: string[] = [];
  if (worst >= limit) reasons.push('p95Worst ' + worst + ' ms >= ' + limit + ' ms');
  if (opts.expectRows && total <= 0) reasons.push('kỳ vọng total > 0 nhưng total = ' + total);
  rec.verdict = reasons.length ? 'FAIL' : 'PASS'; rec.reasons = reasons; cases.push(rec);
}

(ON ? describe : describe.skip)('P2-3: hiệu năng Customer API (V5) trên bản sao PERF', () => {
  beforeAll(async () => {
    const c = createTestPrisma(); prisma = c.prisma; dbName = c.name;
    if (!process.env.BENCH_EXPECT_DB || process.env.BENCH_EXPECT_DB !== dbName) throw new Error('BENCH_EXPECT_DB phải trùng tên database thử. Chạy qua run-search-bench.bat -ApiPerf -CloneOf.');
    await assertTestConnection(prisma, dbName);
    fx = await loadFixturesReadOnly(prisma);
    if ((await busyNow()) > 0) throw new Error('Có phiên khác đang hoạt động trên DB thử. Dừng.');
    const perf = (await prisma.$queryRaw<{ c: number; ct: number }[]>`SELECT (SELECT count(*)::int FROM customer WHERE legacy_id LIKE 'PERF-%') AS c, (SELECT count(*)::int FROM contact c JOIN customer x ON x.id = c.customer_id WHERE x.legacy_id LIKE 'PERF-%') AS ct`)[0];
    if (perf?.c !== 50000 || perf?.ct !== 100000) throw new Error('DB không phải bộ PERF 50.000/100.000 (có ' + String(perf?.c) + '/' + String(perf?.ct) + '). Dừng.');
    const st = (await prisma.$queryRaw<{ nf: number | null; actual: number }[]>`SELECT (SELECT null_frac::float8 FROM pg_stats WHERE schemaname = 'public' AND tablename = 'customer' AND attname = 'owner_id') AS nf, (SELECT (count(*) FILTER (WHERE owner_id IS NULL))::float8 / greatest(count(*), 1) FROM customer) AS actual`)[0];
    if (st?.nf == null || Math.abs(st.nf - st.actual) > 0.25) throw new Error('Thống kê owner_id cũ/thiếu (' + String(st?.nf) + ' vs ' + String(st?.actual) + '). Chỉ đo trên bản sao đã ANALYZE. Dừng.');
    // SĐT thật trong dữ liệu PERF (kiểm thử SĐT phải có kết quả)
    phone = (await prisma.$queryRaw<{ p: string }[]>`SELECT phone AS p FROM customer WHERE legacy_id = 'PERF-12345'`)[0]?.p ?? '';
    if (!phone) throw new Error('Không đọc được SĐT của PERF-12345.');
    report.database = dbName; report.statsPrecheck = st; report.phoneKeyword = phone; report.before = await counts(); report.versions = { postgres: (await prisma.$queryRaw<{ v: string }[]>`SHOW server_version`)[0]?.v, node: process.version };
    t = await makeApp(prisma, fx);
  }, 120000);
  afterAll(async () => {
    try {
      const idle = await busyNow(); const after = await counts();
      report.after = after; report.dataUnchanged = JSON.stringify(after) === JSON.stringify(report.before); report.activeSessionsAfter = idle;
      report.cases = cases; report.finishedAt = new Date().toISOString();
      const bad = cases.filter((c) => c.verdict !== 'PASS');
      report.summary = { total: cases.length, pass: cases.length - bad.length, fail: bad.map((c) => c.name) };
      const dir = process.env.PERF_REPORT_DIR ?? 'perf-report'; mkdirSync(dir, { recursive: true });
      const f = join(dir, 'api_perf_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'); writeFileSync(f, JSON.stringify(report, null, 2)); console.log('Báo cáo P2-3:', f);
      console.log('P2-3: ' + (cases.length - bad.length) + '/' + cases.length + ' ca đạt ngưỡng' + (bad.length ? '; KHÔNG ĐẠT: ' + bad.map((c) => String(c.name)).join(', ') : '') + '. Lưu ý: kết quả này chỉ là P2-3 (API V5), không thay baseline P1.');
    } finally { await t?.app.close(); await prisma?.$disconnect(); }
  });

  it('1. danh sách + phân trang + quyền (ngưỡng 150 ms)', async () => {
    await measure('list/all/p1', 'all', '?pageSize=20&page=1', LIMITS.list);
    await measure('list/all/p100', 'all', '?pageSize=20&page=100', LIMITS.list);
    await measure('list/all/sort=name', 'all', '?pageSize=20&sortBy=name&sortOrder=asc', LIMITS.list);
    for (const who of ['ownA', 'deptA', 'deptC']) await measure('list/' + who, who, '?pageSize=20', LIMITS.list);
  }, 3600000);

  it('2. tìm kiếm ≥ 3 ký tự (500 ms): relevance và createdAt đo RIÊNG, SĐT có kết quả', async () => {
    for (const term of ['minh phat', 'dien lanh', 'cumperf', 'nguyen van']) for (const sortBy of ['relevance', 'createdAt'])
      await measure('search3/' + term + '/' + sortBy, 'all', '?pageSize=20&sortBy=' + sortBy + '&search=' + encodeURIComponent(term), LIMITS.search3, { expectRows: true });
    await measure('search3/phone/relevance', 'all', '?pageSize=20&sortBy=relevance&search=' + encodeURIComponent(phone), LIMITS.search3, { expectRows: true });
    await measure('search3/phone/createdAt', 'all', '?pageSize=20&search=' + encodeURIComponent(phone), LIMITS.search3, { expectRows: true });
  }, 3600000);

  it('3. phân trang tìm kiếm (trang giữa, trang cuối, vượt cuối) và quyền (500 ms)', async () => {
    await measure('search3/cumperf/page=30', 'all', '?pageSize=20&page=30&sortBy=relevance&search=cumperf', LIMITS.search3, { expectRows: true });
    await measure('search3/cumperf/page=63-last', 'all', '?pageSize=20&page=63&sortBy=relevance&search=cumperf', LIMITS.search3, { expectRows: true });
    await measure('search3/cumperf/page=80-beyond', 'all', '?pageSize=20&page=80&sortBy=relevance&search=cumperf', LIMITS.search3, { expectRows: true });
    for (const who of ['ownA', 'deptA', 'deptC']) for (const term of ['cumperf', 'nguyen van'])
      await measure('search3/' + term + '/relevance@' + who, who, '?pageSize=20&sortBy=relevance&search=' + encodeURIComponent(term), LIMITS.search3);
  }, 3600000);

  it('4. tìm kiếm 2 ký tự (1500 ms): các cách sắp xếp quan trọng', async () => {
    for (const q of [['mi', 'createdAt'], ['mi', 'relevance'], ['mi', 'name'], ['an', 'createdAt'], ['an', 'relevance']] as const)
      await measure('search2/' + q[0] + '/' + q[1], 'all', '?pageSize=20&sortBy=' + q[1] + '&search=' + q[0], LIMITS.search2, { expectRows: true });
  }, 3600000);

  it('5. nếu có ca vượt ngưỡng: EXPLAIN (ANALYZE, BUFFERS) của truy vấn trang V5 để ghi nguyên nhân (chỉ đọc)', async () => {
    const bad = cases.filter((c) => c.verdict !== 'PASS' && String(c.name).startsWith('search3/nguyen van'));
    const plans: Record<string, unknown> = {};
    if (bad.length || process.env.BENCH_ALWAYS_EXPLAIN === '1') {
      const term = 'nguyen van';
      const folded = (await prisma.$queryRaw<{ t: string }[]>`SELECT public.f_vn_fold(btrim(${term})) AS t`)[0]?.t ?? term;
      const p = { actor: { employeeId: fx.empA, departmentId: fx.d1 }, folded, raw: term, deletedOnly: false, readScope: 'ALL' as const, restoreScope: null, ids: {} };
      for (const sortBy of ['relevance', 'createdAt']) {
        const q = buildSearchPageQuery(p, chooseSearchPath(folded, false), { sortBy, order: 'desc' }, 20, 0);
        const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`);
        const plan = (rows[0]?.['QUERY PLAN'] as Record<string, unknown>[] | undefined)?.[0] ?? {};
        const txt = JSON.stringify(plan);
        plans[sortBy] = { executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], seqScanCustomer: /"Relation Name":"customer"[^}]*"Node Type":"Seq Scan"|"Node Type":"Seq Scan"[^}]*"Relation Name":"customer"/.test(txt), externalSort: /external merge/i.test(txt), usesContactIndex: /ix_contact_name_fold/.test(txt), usesCustomerTrgm: /ix_customer_(name|short)_fold/.test(txt), plan };
      }
    }
    report.explainNguyenVan = plans;
  }, 600000);
});
