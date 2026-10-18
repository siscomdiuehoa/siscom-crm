import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, runId, uniqueTax } from './helpers/fixtures';

const URL = '/api/v1/customers';
const m = runId; // dấu riêng của lần chạy (chữ thường, chữ số)
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who = 'all') => as(t.app, who);
const ids = (r: { body: { data: { items: { id: string }[] } } }): string[] => r.body.data.items.map((i) => i.id);
const ref: Record<string, { id: string; code: string; taxId?: string | null }> = {};

async function allIds(q: string, who = 'all'): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page < 500; page++) {
    const r = await a(who).get(URL + '?pageSize=100&page=' + page + '&sortBy=code&sortOrder=asc&' + q);
    if (r.status !== 200) throw new Error('GET lỗi ' + r.status + ' ' + JSON.stringify(r.body));
    out.push(...ids(r));
    if (page >= r.body.data.totalPages) break;
  }
  return out;
}

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  const tax = uniqueTax();
  ref.c1 = await makeCustomer(prisma, fx, { name: `Công ty TNHH Điện Lạnh Thành Đạt ${m}`, phone: '0912 345 001', phoneE164: '+84912345001' });
  ref.c2 = { ...(await makeCustomer(prisma, fx, { name: `Cty CP Xây dựng Bình Minh ${m}`, taxId: tax })), taxId: tax };
  ref.c3 = await makeCustomer(prisma, fx, { name: `Thương mại Đại Việt ${m}` });
  await makeContact(prisma, ref.c3.id, 'Trần Văn Bình ' + m);
  ref.c4 = await makeCustomer(prisma, fx, { name: `Khách VIP ${m}`, tier: 'VIP', status: 'ACTIVE' });
  ref.ownB = await makeCustomer(prisma, fx, { name: `Khách của B ${m}`, ownerId: fx.empB });
  for (let i = 0; i < 25; i++) await makeCustomer(prisma, fx, { name: `Công ty phân trang ${m} số ${i}` });
}, 120000);
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

describe('tìm kiếm chính xác', () => {
  it('8. phân trang: tổng chính xác, các trang không trùng không sót', async () => {
    const r1 = await a().get(URL + '?search=phan trang ' + m + '&pageSize=10&page=1&sortBy=code&sortOrder=asc');
    expect(r1.body.data).toMatchObject({ total: 25, page: 1, pageSize: 10, totalPages: 3 });
    const all = [...ids(r1), ...ids(await a().get(URL + '?search=phan trang ' + m + '&pageSize=10&page=2&sortBy=code&sortOrder=asc')), ...ids(await a().get(URL + '?search=phan trang ' + m + '&pageSize=10&page=3&sortBy=code&sortOrder=asc'))];
    expect(all).toHaveLength(25);
    expect(new Set(all).size).toBe(25);
    expect((await a().get(URL + '?search=phan trang ' + m + '&pageSize=10&page=4')).body.data.items).toEqual([]);
  });
  it('9. có dấu / không dấu / hoa-thường / theo tên liên hệ / mã / MST / SĐT', async () => {
    const find = async (q: string) => ids(await a().get(URL + '?pageSize=100&search=' + encodeURIComponent(q)));
    for (const q of ['dien lanh thanh dat ' + m, 'ĐIỆN LẠNH THÀNH ĐẠT ' + m, 'Điện Lạnh Thành Đạt ' + m.toUpperCase(), 'DIEN LANH THANH DAT ' + m]) expect(await find(q)).toEqual([ref.c1.id]);
    expect(await find('tran van binh ' + m)).toEqual([ref.c3.id]); // theo tên người liên hệ
    expect(await find(ref.c1.code.toLowerCase())).toContain(ref.c1.id); // theo mã
    expect(await find(ref.c2.taxId as string)).toEqual([ref.c2.id]); // theo MST
    expect(await find('0912345001')).toContain(ref.c1.id); // SĐT liền
    expect(await find('0912 345 001')).toContain(ref.c1.id); // SĐT có khoảng trắng
    expect(await find('xay dung binh minh ' + m)).toEqual([ref.c2.id]); // tên viết tắt/không dấu
  });
  it('ký tự đặc biệt là ký tự thường; chuỗi tiêm SQL vô hại; dưới 2 ký tự -> 400', async () => {
    expect((await a().get(URL + '?search=a')).status).toBe(400);
    for (const q of ['%%', '__', '\\\\', "'; DROP TABLE customer; --"]) {
      const r = await a().get(URL + '?search=' + encodeURIComponent(q));
      expect(r.status).toBe(200);
      expect(r.body.data.total).toBe(0);
    }
    expect(await prisma.customer.count()).toBeGreaterThan(0); // bảng còn nguyên
  });
  it('10. lọc phân hạng / trạng thái; mã không tồn tại -> 400; mục ngừng dùng vẫn lọc được', async () => {
    expect(ids(await a().get(URL + '?search=' + m + '&tier=VIP'))).toEqual([ref.c4.id]);
    expect(ids(await a().get(URL + '?search=' + m + '&status=ACTIVE'))).toEqual([ref.c4.id]);
    expect((await a().get(URL + '?search=' + m + '&tier=VIP&status=POTENTIAL')).body.data.total).toBe(0);
    const bad = await a().get(URL + '?tier=KHONGCO');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('LOOKUP_INVALID');
    expect((await a().get(URL + '?search=' + m + '&tier=LEGACY')).body.data.total).toBe(0);
  });
  it('sắp xếp: bảng trắng; relevance cần search; thứ tự theo code ổn định', async () => {
    expect((await a().get(URL + '?sortBy=relevance')).status).toBe(400);
    expect((await a().get(URL + '?sortBy=name%3B%20DROP')).status).toBe(400);
    const r = await a().get(URL + '?search=' + m + '&sortBy=relevance&pageSize=100');
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBeGreaterThanOrEqual(30);
    const codes: string[] = (await a().get(URL + '?search=' + m + '&pageSize=100&sortBy=code&sortOrder=asc')).body.data.items.map((i: { code: string }) => i.code);
    expect([...codes].sort((x, y) => Number(x.slice(3)) - Number(y.slice(3)))).toEqual(codes);
    const tiers: string[] = (await a().get(URL + '?search=' + m + '&pageSize=100&sortBy=tier&sortOrder=asc')).body.data.items.map((i: { tier: { code: string } }) => i.tier.code);
    expect(tiers[tiers.length - 1]).toBe('VIP'); // POTENTIAL(10) trước VIP(20)
  });
  it('phạm vi khi tìm kiếm và liệt kê (OWN / DEPARTMENT / không quyền)', async () => {
    const has = async (who: string) => (await allIds('search=' + encodeURIComponent('khach cua b ' + m), who)).includes(ref.ownB.id);
    expect(await has('all')).toBe(true);
    expect(await has('ownB')).toBe(true);
    expect(await has('deptA')).toBe(true);
    expect(await has('ownA')).toBe(false);
    expect(await has('deptC')).toBe(false);
    expect((await a('none').get(URL + '?search=' + m)).status).toBe(403);
    // không tìm kiếm: cùng quy tắc phạm vi
    const list = async (who: string) => (await allIds('', who)).includes(ref.ownB.id);
    expect(await list('ownB')).toBe(true);
    expect(await list('ownA')).toBe(false);
  }, 120000);
  it('kết quả khớp fn_customer_search của DB (không tính SĐT) cho nhiều từ khoá', async () => {
    for (const term of [m, 'dien lanh', 'tran van binh', 'dai viet', 'phan trang', 'kh-0']) {
      const fn = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM public.fn_customer_search(${term}, 2147483647)`;
      const api = await allIds('search=' + encodeURIComponent(term));
      expect([...api].sort()).toEqual(fn.map((r) => r.id).sort());
    }
  }, 180000);
  it('deleted=only: cần quyền restore và vẫn theo phạm vi', async () => {
    const dc = await makeCustomer(prisma, fx, { name: `Đã xoá của B ${m}`, deleted: true, ownerId: fx.empB });
    expect(await allIds('deleted=only&search=' + encodeURIComponent('da xoa cua b ' + m), 'all')).toContain(dc.id);
    expect(await allIds('deleted=only&search=' + encodeURIComponent('da xoa cua b ' + m), 'ownA')).not.toContain(dc.id);
    expect(await allIds('deleted=only&search=' + encodeURIComponent('da xoa cua b ' + m), 'ownB')).toContain(dc.id);
    expect((await a('readonly').get(URL + '?deleted=only&search=' + m)).status).toBe(403);
  }, 60000);
});
