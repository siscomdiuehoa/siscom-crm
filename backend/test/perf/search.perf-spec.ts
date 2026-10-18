import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '../../src/generated/prisma/client';
import { buildSearchWhere } from '../../src/modules/customers/customers.search';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { as, makeApp, TestApp } from '../helpers/test-app';
import { assertTestConnection, createTestPrisma } from '../helpers/test-db';
import { ensureFixtures, Fixtures } from '../helpers/fixtures';

// Ngưỡng đã duyệt (N4): danh sách p95 < 150 ms; tìm ≥3 ký tự p95 < 500 ms; 2 ký tự p95 < 1500 ms. KHÔNG tự đổi ngưỡng.
const LIMITS = { list: 150, search3: 500, search2: 1500 };
const TOTAL = 50000;
const CLUSTER = 1250; // g % 40 = 0  => "CUMPERF"
const URL = '/api/v1/customers';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), limits: LIMITS };

const p95 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)] as number; };
async function timed(n: number, f: () => Promise<{ status: number }>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); const r = await f(); const dt = performance.now() - t0; if (r.status !== 200) throw new Error('Yêu cầu lỗi ' + r.status); out.push(dt); }
  return out;
}

async function seed(): Promise<void> {
  const have = await prisma.customer.count({ where: { legacyId: { startsWith: 'PERF-' } } });
  if (have === TOTAL) return;
  if (have !== 0) throw new Error('Dữ liệu tổng hợp dở dang (' + have + '/' + TOTAL + '). Tạo lại database thử.');
  const tier = fx.tier.POTENTIAL as string; const status = fx.status.POTENTIAL as string;
  await prisma.$executeRaw`INSERT INTO customer (name, short_name, phone, phone_e164, tier_id, status_id, is_demo, legacy_id)
    SELECT 'Công ty ' || (ARRAY['TNHH','Cổ phần','Xây dựng','Thương mại','Điện lạnh','Cơ điện','Công nghệ','Vận tải'])[1 + (g % 8)] || ' ' || (ARRAY['Minh Phát','Thành Đạt','Hoàng Gia','Đại Việt','Bình Minh','Phú Quý','An Khang','Hòa Bình','Tân Cảng','Sao Mai'])[1 + (g % 10)] || ' ' || g || CASE WHEN g % 40 = 0 THEN ' CUMPERF' ELSE '' END,
           'PERF ' || g, '09' || lpad((g % 100000000)::text, 8, '0'), '+849' || lpad((g % 100000000)::text, 8, '0'), ${tier}::uuid, ${status}::uuid, true, 'PERF-' || g
    FROM generate_series(1, ${TOTAL}::int) g`;
  await prisma.$executeRaw`INSERT INTO contact (customer_id, full_name, phone, is_primary, is_demo)
    SELECT c.id, (ARRAY['Nguyễn Văn','Trần Thị','Lê Hoàng','Phạm Quang','Đỗ Minh'])[1 + (k + (substr(c.legacy_id, 6)::int % 5)) % 5] || ' ' || (ARRAY['An','Bình','Cường','Dũng','Hà','Khánh'])[1 + (substr(c.legacy_id, 6)::int + k) % 6],
           '0912' || lpad(((substr(c.legacy_id, 6)::int * 2 + k) % 10000000)::text, 7, '0'), k = 1, true
    FROM customer c CROSS JOIN generate_series(1, 2) k WHERE c.legacy_id LIKE 'PERF-%'`;
  await prisma.$executeRaw`ANALYZE customer`;
  await prisma.$executeRaw`ANALYZE contact`;
}

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  const t0 = Date.now();
  await seed();
  report.seedSeconds = (Date.now() - t0) / 1000;
  t = await makeApp(prisma, fx);
  report.customers = await prisma.customer.count();
  report.contacts = await prisma.contact.count();
}, 900000);
afterAll(async () => {
  const dir = process.env.PERF_REPORT_DIR ?? 'perf-report';
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'perf_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('Báo cáo hiệu năng:', file);
  await t.app.close();
  await prisma.$disconnect();
});

const api = (q: string) => as(t.app, 'all').get(URL + q);

describe('hiệu năng tìm kiếm (DB thử, dữ liệu tổng hợp 50.000 khách / 100.000 liên hệ)', () => {
  it('tổng chính xác: bằng đếm trực tiếp qua fn_customer_search; duyệt hết trang không trùng không sót', async () => {
    const rows: Record<string, unknown>[] = [];
    for (const term of ['cumperf', 'dien lanh', 'sao mai', 'minh phat', 'nguyen van']) {
      const direct = Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM public.fn_customer_search(${term}, 2147483647)`)[0]?.n);
      const r = await api('?pageSize=1&search=' + encodeURIComponent(term));
      expect(r.status).toBe(200);
      rows.push({ term, directCount: direct, apiTotal: r.body.data.total });
      expect(r.body.data.total).toBe(direct);
    }
    report.exactTotals = rows;
    expect((rows[0] as { apiTotal: number }).apiTotal).toBe(CLUSTER);
    expect((rows[0] as { apiTotal: number }).apiTotal).toBeGreaterThan(500); // vượt trần 500 cũ vẫn chính xác
    const seen = new Set<string>();
    const pages = Math.ceil(CLUSTER / 100);
    for (let p = 1; p <= pages + 1; p++) {
      const r = await api('?pageSize=100&sortBy=code&sortOrder=asc&search=cumperf&page=' + p);
      for (const i of r.body.data.items as { id: string }[]) { expect(seen.has(i.id)).toBe(false); seen.add(i.id); }
    }
    expect(seen.size).toBe(CLUSTER);
  }, 300000);

  it('danh sách không tìm kiếm: p95 < ' + LIMITS.list + ' ms', async () => {
    const xs = await timed(30, () => api('?pageSize=20&page=1'));
    report.list = { p95: p95(xs), samples: xs.length };
    expect(p95(xs)).toBeLessThan(LIMITS.list);
  }, 120000);

  it('tìm kiếm ≥ 3 ký tự: p95 < ' + LIMITS.search3 + ' ms (theo từng từ khoá)', async () => {
    const out: Record<string, number> = {};
    for (const term of ['minh phat', 'dien lanh', 'cumperf', 'nguyen van', '0912345']) {
      const xs = await timed(15, () => api('?pageSize=20&sortBy=relevance&search=' + encodeURIComponent(term)));
      out[term] = p95(xs);
    }
    report.search3 = out;
    for (const [term, v] of Object.entries(out)) if (v >= LIMITS.search3) throw new Error('Từ khoá "' + term + '": p95 = ' + v.toFixed(0) + ' ms >= ' + LIMITS.search3 + ' ms');
  }, 300000);

  it('tìm kiếm 2 ký tự: p95 < ' + LIMITS.search2 + ' ms', async () => {
    const xs = await timed(15, () => api('?pageSize=20&search=mi'));
    report.search2 = { p95: p95(xs), samples: xs.length };
    expect(p95(xs)).toBeLessThan(LIMITS.search2);
  }, 120000);

  it('EXPLAIN (ANALYZE, BUFFERS): lưu kế hoạch và kết luận có dùng chỉ mục trigram hay không', async () => {
    const plans: Record<string, unknown> = {};
    for (const term of ['cumperf', 'minh phat']) {
      const f = await prisma.$queryRaw<{ t: string }[]>`SELECT public.f_vn_fold(btrim(${term})) AS t`;
      const where = buildSearchWhere({ actor: { employeeId: fx.empA, departmentId: fx.d1 }, folded: f[0]?.t ?? term, raw: term, deletedOnly: false, readScope: 'ALL', restoreScope: null, ids: {} });
      const rows = await prisma.$queryRaw<Record<string, string>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) SELECT count(*)::int FROM customer c WHERE ${where}`);
      const text = rows.map((r) => r['QUERY PLAN']).join('\n');
      plans[term] = { usesTrigramIndex: /ix_customer_name_fold|ix_customer_short_fold|ix_contact_name_fold|ix_customer_phone_trgm/.test(text), seqScanOnCustomer: /Seq Scan on customer/.test(text), plan: text };
    }
    report.explain = plans;
    expect(Object.keys(plans)).toHaveLength(2);
  }, 120000);
});
