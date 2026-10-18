import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, uniq, uniqueTax } from './helpers/fixtures';

const C = '/api/v1/customers/';
const ROUNDS = Number(process.env.CONCURRENCY_ROUNDS ?? 20);
const N = 10;
let prisma: PrismaService; let fx: Fixtures; let tv: TestApp;
// Dùng app có checker GIẢ (chỉ test) để thử đua giữa xoá mềm và các thao tác khác.
const a = (who = 'all') => as(tv.app, who);
const codes = (rs: { body: { error?: { code?: string } } }[]): string[] => rs.map((r) => r.body.error?.code ?? 'OK');

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  tv = await makeApp(prisma, fx, { verifiedLinks: true });
}, 60000);
afterAll(async () => { await tv.app.close(); await prisma.$disconnect(); });

describe(`đồng thời (${ROUNDS} vòng × ${N} yêu cầu)`, () => {
  it('thêm liên hệ chính song song: cuối cùng đúng 1 liên hệ chính, không 5xx', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const c = await makeCustomer(prisma, fx);
      const rs = await Promise.all(Array.from({ length: N }, (_v, k) => a().post(C + c.id + '/contacts', { fullName: `Chính ${i}-${k}`, phone: '0903123456', isPrimary: true })));
      for (const r of rs) expect([201, 409]).toContain(r.status);
      for (const r of rs.filter((x) => x.status === 409)) expect(['CONTACT_PRIMARY_CONFLICT', 'CUSTOMER_BUSY']).toContain(r.body.error.code);
      expect(rs.some((r) => r.status === 201)).toBe(true);
      expect(await prisma.contact.count({ where: { customerId: c.id, isPrimary: true, deletedAt: null } })).toBe(1);
      expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(rs.filter((r) => r.status === 201).length);
    }
  }, 300000);

  it('thêm liên hệ song song với xoá mềm: liên hệ không bao giờ gắn vào khách đã xoá; số liên hệ = số 201', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const c = await makeCustomer(prisma, fx);
      const ops = [...Array.from({ length: 5 }, (_v, k) => a().post(C + c.id + '/contacts', { fullName: `Đua xoá ${i}-${k}`, phone: '0903123456' })), a().delete(C + c.id)];
      const rs = await Promise.all(ops);
      const del = rs[rs.length - 1] as (typeof rs)[number];
      const posts = rs.slice(0, -1);
      for (const r of posts) expect([201, 409]).toContain(r.status);
      for (const r of posts.filter((x) => x.status === 409)) expect(['CUSTOMER_DELETED', 'CUSTOMER_BUSY']).toContain(r.body.error.code);
      expect([200, 409]).toContain(del.status);
      expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(posts.filter((r) => r.status === 201).length);
      if (del.status === 200) {
        // sau khi đã xoá mềm, mọi yêu cầu thêm liên hệ mới đều bị từ chối
        const later = await a().post(C + c.id + '/contacts', { fullName: 'Sau xoá', phone: '0903123456' });
        expect(later.status).toBe(409);
        expect(later.body.error.code).toBe('CUSTOMER_DELETED');
      }
    }
  }, 300000);

  it('hai thao tác khôi phục song song: đúng một thành công, còn lại 409', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const c = await makeCustomer(prisma, fx, { deleted: true, taxId: i % 2 ? uniqueTax() : null });
      const rs = await Promise.all(Array.from({ length: N }, () => a().post(C + c.id + '/restore')));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of rs.filter((x) => x.status !== 200)) { expect(r.status).toBe(409); expect(['CUSTOMER_NOT_DELETED', 'CUSTOMER_BUSY']).toContain(r.body.error.code); }
      const row = await prisma.customer.findUnique({ where: { id: c.id } });
      expect(row?.deletedAt).toBeNull();
      expect(row?.version).toBe(2);
    }
  }, 300000);

  it('khôi phục song song với tạo khách mới cùng MST: nhiều nhất một khách còn hiệu lực giữ MST, không 5xx', async () => {
    const outcomes = { restoreWon: 0, createWon: 0 };
    for (let i = 0; i < ROUNDS; i++) {
      const tax = uniqueTax();
      const x = await makeCustomer(prisma, fx, { deleted: true, taxId: tax });
      const [rs, cr] = await Promise.all([a().post(C + x.id + '/restore'), a().post('/api/v1/customers', { name: 'Đua MST ' + uniq(), phone: '0903123456', taxId: tax })]);
      for (const r of [rs, cr]) expect([200, 201, 409]).toContain(r.status);
      if (rs.status === 409) expect(['CUSTOMER_RESTORE_CONFLICT', 'CUSTOMER_BUSY', 'CUSTOMER_NOT_DELETED']).toContain(rs.body.error.code);
      if (cr.status === 409) expect(['CUSTOMER_DUPLICATE_TAX_ID', 'CUSTOMER_BUSY']).toContain(cr.body.error.code);
      const active = await prisma.customer.count({ where: { taxId: tax, deletedAt: null } });
      expect(active).toBeLessThanOrEqual(1);
      expect(active).toBe((rs.status === 200 ? 1 : 0) + (cr.status === 201 ? 1 : 0));
      if (rs.status === 200) outcomes.restoreWon++; if (cr.status === 201) outcomes.createWon++;
    }
    console.log('[đua MST] restore thắng:', outcomes.restoreWon, '| tạo mới thắng:', outcomes.createWon);
  }, 300000);

  it('hai PATCH song song cùng version: đúng một thành công, còn lại 409 xung đột phiên bản', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const c = await makeCustomer(prisma, fx);
      const rs = await Promise.all(Array.from({ length: N }, (_v, k) => a().patch(C + c.id, { version: 1, note: 'ghi ' + k })));
      const ok = rs.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      for (const r of rs.filter((x) => x.status !== 200)) { expect(r.status).toBe(409); expect(['CUSTOMER_VERSION_CONFLICT', 'CUSTOMER_BUSY']).toContain(r.body.error.code); }
      const row = await prisma.customer.findUnique({ where: { id: c.id } });
      expect(row?.version).toBe(2);
      expect(row?.note).toBe(ok[0]?.body.data.note);
    }
  }, 300000);

  it('PATCH song song với xoá mềm: bản ghi đã xoá không được "sống lại" bởi PATCH', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const c = await makeCustomer(prisma, fx);
      const [p, d] = await Promise.all([a().patch(C + c.id, { version: 1, note: 'đua xoá' }), a().delete(C + c.id)]);
      expect([200, 404, 409]).toContain(p.status);
      expect([200, 404, 409]).toContain(d.status);
      const row = await prisma.customer.findUnique({ where: { id: c.id } });
      if (d.status === 200) expect(row?.deletedAt).not.toBeNull();
      if (p.status === 200 && d.status === 200) expect(row?.version).toBe(3);
    }
  }, 300000);

  it('không có lỗi 5xx và mã lỗi chỉ thuộc tập nghiệp vụ (kiểm chứng tổng hợp một vòng)', async () => {
    const c = await makeCustomer(prisma, fx, { deleted: true });
    const rs = await Promise.all([...Array.from({ length: 5 }, () => a().post(C + c.id + '/restore')), ...Array.from({ length: 5 }, () => a().get(C + c.id))]);
    expect(rs.every((r) => r.status < 500)).toBe(true);
    expect(codes(rs).filter((x) => x === 'INTERNAL_ERROR')).toEqual([]);
  });
});
