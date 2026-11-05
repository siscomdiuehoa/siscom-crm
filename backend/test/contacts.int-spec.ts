import type { PrismaService } from '../src/prisma/prisma.service';
import { as, leaks, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, uniq } from './helpers/fixtures';

const C = '/api/v1/customers/';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who = 'all') => as(t.app, who);

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

describe('Contact API', () => {
  it('17. liên hệ thuộc đúng khách hàng; danh sách chỉ của khách đó; customerId trong body bị từ chối', async () => {
    const c1 = await makeCustomer(prisma, fx);
    const c2 = await makeCustomer(prisma, fx);
    const r = await a().post(C + c1.id + '/contacts', { fullName: 'Nguyễn Văn Một', phone: '0903 123 456', email: 'mot@x.vn', title: 'Giám đốc' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ fullName: 'Nguyễn Văn Một', title: 'Giám đốc', isPrimary: false });
    expect(r.body.data.code).toMatch(/^LH-\d{6,}$/);
    expect((await prisma.contact.findUnique({ where: { id: r.body.data.id } }))?.customerId).toBe(c1.id);
    expect((await a().get(C + c1.id + '/contacts')).body.data.items.map((i: { id: string }) => i.id)).toEqual([r.body.data.id]);
    expect((await a().get(C + c2.id + '/contacts')).body.data.items).toEqual([]);
    expect((await a().post(C + c2.id + '/contacts', { fullName: 'A', phone: '0903123456', customerId: c1.id })).status).toBe(400);
  });
  it('04/11/2026: chỉ họ tên là đủ (SĐT/email không bắt buộc); định dạng sai bị từ chối; không có họ tên bị từ chối', async () => {
    const c = await makeCustomer(prisma, fx);
    for (const b of [{ fullName: 'A', phone: '123' }, { fullName: 'A', email: 'x@' }, { phone: '0903123456' }]) expect((await a().post(C + c.id + '/contacts', b)).status).toBe(400);
    for (const b of [{ fullName: 'Chỉ họ tên' }, { fullName: 'Rỗng hết', phone: '', email: '' }]) {
      const r = await a().post(C + c.id + '/contacts', b);
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ phone: null, email: null });
    }
    expect((await a().post(C + c.id + '/contacts', { fullName: 'Chỉ email', email: 'a@b.vn' })).status).toBe(201);
  });
  it('liên hệ chính mới thay liên hệ chính cũ trong cùng transaction: luôn đúng một liên hệ chính', async () => {
    const c = await makeCustomer(prisma, fx);
    const p1 = await a().post(C + c.id + '/contacts', { fullName: 'Chính 1', phone: '0903123456', isPrimary: true });
    const p2 = await a().post(C + c.id + '/contacts', { fullName: 'Chính 2', phone: '0903123457', isPrimary: true });
    expect([p1.status, p2.status]).toEqual([201, 201]);
    const list = (await a().get(C + c.id + '/contacts')).body.data.items as { id: string; isPrimary: boolean }[];
    expect(list.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([p2.body.data.id]);
    expect(list[0]?.isPrimary).toBe(true); // chính xếp trước
    expect(await prisma.contact.count({ where: { customerId: c.id, isPrimary: true, deletedAt: null } })).toBe(1);
  });
  it('khách đã xoá mềm: thêm liên hệ -> 409 CUSTOMER_DELETED; xem danh sách -> 404', async () => {
    const c = await makeCustomer(prisma, fx, { deleted: true });
    const r = await a().post(C + c.id + '/contacts', { fullName: 'A', phone: '0903123456' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CUSTOMER_DELETED');
    expect((await a().get(C + c.id + '/contacts')).status).toBe(404);
    expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(0);
  });
  it('liên hệ đã xoá mềm không hiện trong danh sách', async () => {
    const c = await makeCustomer(prisma, fx);
    const ct = await makeContact(prisma, c.id, 'Sẽ bị ẩn ' + uniq());
    await prisma.contact.update({ where: { id: ct.id }, data: { deletedAt: new Date(), deletedById: fx.empA } });
    expect((await a().get(C + c.id + '/contacts')).body.data.items).toEqual([]);
  });
  it('phạm vi và quyền: ngoài phạm vi -> 404, thiếu quyền ghi -> 403, không quyền -> 403', async () => {
    const c = await makeCustomer(prisma, fx, { ownerId: fx.empB });
    expect((await a('ownB').get(C + c.id + '/contacts')).status).toBe(200);
    expect((await a('ownA').get(C + c.id + '/contacts')).status).toBe(404);
    expect((await a('ownA').post(C + c.id + '/contacts', { fullName: 'A', phone: '0903123456' })).status).toBe(404);
    expect((await a('readonly').post(C + c.id + '/contacts', { fullName: 'A', phone: '0903123456' })).status).toBe(403);
    expect((await a('none').get(C + c.id + '/contacts')).status).toBe(403);
    expect((await a('ownB').post(C + c.id + '/contacts', { fullName: 'B ghi', phone: '0903123456' })).status).toBe(201);
  });
  it('không tồn tại -> 404; nhật ký ghi mã liên hệ, không ghi tên người; lỗi không lộ nội bộ', async () => {
    const miss = await a().get(C + '00000000-0000-4000-8000-000000000000/contacts');
    expect(miss.status).toBe(404);
    expect(leaks(miss.body)).toBe(false);
    const c = await makeCustomer(prisma, fx);
    const r = await a().post(C + c.id + '/contacts', { fullName: 'Họ Tên Riêng Tư', phone: '0903123456' });
    const e = t.audit.entries.at(-1);
    expect(e).toMatchObject({ action: 'contact.create', entityCode: r.body.data.code, actorEmployeeId: fx.empA });
    expect(JSON.stringify(e)).not.toContain('Riêng Tư');
  });
});
