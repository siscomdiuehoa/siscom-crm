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

// FV-3 (CT-FV3-1, Owner 08/11/2026 phương án A): sửa/xoá mềm theo customer.update trên từng khách; khoá lạc quan updatedAt.
describe('Contact API — sửa / xoá mềm (FV-3)', () => {
  const add = async (cid: string, body: object = {}, who = 'all') => (await a(who).post(C + cid + '/contacts', { fullName: 'Người ' + uniq(), phone: '0903123456', ...body })).body.data as { id: string; code: string; updatedAt: string; isPrimary: boolean };
  const U = (cid: string, id: string) => C + cid + '/contacts/' + id;

  it('R2-230: isPrimary = null => 400 (không phải 500), không đổi dòng', async () => {
    const c = await makeCustomer(prisma, fx);
    const k = await add(c.id, {});
    const r = await a().patch(U(c.id, k.id), { updatedAt: k.updatedAt, isPrimary: null });
    expect(r.status).toBe(400);
    const row = await prisma.contact.findUniqueOrThrow({ where: { id: k.id } });
    expect(row.isPrimary).toBe(k.isPrimary); expect(row.updatedAt.toISOString()).toBe(k.updatedAt);
  });
  it('FV3-1. sửa đúng phạm vi: 200, chỉ đổi trường gửi, updatedAt tăng; nhật ký chỉ có tên trường', async () => {
    const c = await makeCustomer(prisma, fx);
    const k = await add(c.id, { email: 'cu@x.vn' });
    const r = await a().patch(U(c.id, k.id), { updatedAt: k.updatedAt, phone: '0903 999 888', title: 'Kế toán', email: '' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: k.id, phone: '0903 999 888', title: 'Kế toán', email: null, fullName: expect.stringMatching(/^Người /) });
    expect(Date.parse(r.body.data.updatedAt)).toBeGreaterThan(Date.parse(k.updatedAt));
    const row = await prisma.contact.findUnique({ where: { id: k.id } });
    expect(row).toMatchObject({ phone: '0903 999 888', email: null, updatedById: fx.empA, deletedAt: null });
    const e = t.audit.entries.at(-1);
    expect(e).toMatchObject({ action: 'contact.update', entityId: k.id, entityCode: k.code, changes: { fields: ['email', 'phone', 'title'] } });
    expect(JSON.stringify(e)).not.toMatch(/0903|Kế toán|cu@x/);
  });
  it('FV3-2. updatedAt cũ -> 409 CONTACT_VERSION_CONFLICT, DB không đổi; hai lần sửa liên tiếp cùng mốc -> lần sau 409', async () => {
    const c = await makeCustomer(prisma, fx);
    const k = await add(c.id);
    expect((await a().patch(U(c.id, k.id), { updatedAt: k.updatedAt, title: 'Lần 1' })).status).toBe(200);
    const r = await a().patch(U(c.id, k.id), { updatedAt: k.updatedAt, title: 'Lần 2' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CONTACT_VERSION_CONFLICT');
    expect((await prisma.contact.findUnique({ where: { id: k.id } }))?.title).toBe('Lần 1');
    expect((await a().delete(U(c.id, k.id), { updatedAt: k.updatedAt })).status).toBe(409);
    expect((await prisma.contact.findUnique({ where: { id: k.id } }))?.deletedAt).toBeNull();
  });
  it('FV3-3. quyền theo TỪNG khách: không có customer.update -> 403; customer.update OWN trên khách người khác -> 404/403; chủ khách sửa được', async () => {
    const c = await makeCustomer(prisma, fx, { ownerId: fx.empB });
    const k = await add(c.id);
    const body = { updatedAt: k.updatedAt, title: 'X' };
    expect((await a('readonly').patch(U(c.id, k.id), body)).status).toBe(403);
    expect((await a('readonly').delete(U(c.id, k.id), { updatedAt: k.updatedAt })).status).toBe(403);
    expect((await a('ownA').patch(U(c.id, k.id), body)).status).toBe(404);
    expect((await a('ownA').delete(U(c.id, k.id), { updatedAt: k.updatedAt })).status).toBe(404);
    expect((await a('none').patch(U(c.id, k.id), body)).status).toBe(403);
    expect((await prisma.contact.findUnique({ where: { id: k.id } }))?.title).toBeNull();
    expect((await a('ownB').patch(U(c.id, k.id), body)).status).toBe(200);
  });
  it('FV3-4. liên hệ thuộc khách khác / không tồn tại -> 404 CONTACT_NOT_FOUND; thiếu/sai updatedAt hoặc trường lạ -> 400', async () => {
    const c1 = await makeCustomer(prisma, fx);
    const c2 = await makeCustomer(prisma, fx);
    const k = await add(c1.id);
    const r = await a().patch(U(c2.id, k.id), { updatedAt: k.updatedAt, title: 'X' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('CONTACT_NOT_FOUND');
    expect((await a().delete(U(c2.id, k.id), { updatedAt: k.updatedAt })).status).toBe(404);
    expect((await a().patch(U(c1.id, '00000000-0000-4000-8000-000000000000'), { updatedAt: k.updatedAt, title: 'X' })).status).toBe(404);
    expect((await a().patch(U(c1.id, k.id), { title: 'X' })).status).toBe(400);
    expect((await a().patch(U(c1.id, k.id), { updatedAt: 'hôm qua', title: 'X' })).status).toBe(400);
    expect((await a().patch(U(c1.id, k.id), { updatedAt: k.updatedAt, customerId: c2.id })).status).toBe(400);
    expect((await a().patch(U(c1.id, k.id), { updatedAt: k.updatedAt, fullName: '  ' })).status).toBe(400);
    expect((await a().delete(U(c1.id, k.id))).status).toBe(400);
    expect((await prisma.contact.findUnique({ where: { id: k.id } }))?.customerId).toBe(c1.id);
  });
  it('FV3-5. xoá mềm: 200, biến khỏi danh sách, DB còn dòng có deleted_at/deleted_by; xoá lại -> 404; nhật ký contact.delete', async () => {
    const c = await makeCustomer(prisma, fx);
    const k = await add(c.id, { isPrimary: true });
    const r = await a().delete(U(c.id, k.id), { updatedAt: k.updatedAt });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: k.id, code: k.code });
    expect((await a().get(C + c.id + '/contacts')).body.data.items).toEqual([]);
    const row = await prisma.contact.findUnique({ where: { id: k.id } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.deletedById).toBe(fx.empA);
    expect(t.audit.entries.at(-1)).toMatchObject({ action: 'contact.delete', entityId: k.id, entityCode: k.code });
    expect((await a().delete(U(c.id, k.id), { updatedAt: r.body.data.updatedAt ?? k.updatedAt })).status).toBe(404);
    // Đã xoá liên hệ chính thì thêm liên hệ chính mới được (unique chỉ tính bản còn hiệu lực).
    expect((await add(c.id, { isPrimary: true })).isPrimary).toBe(true);
  });
  it('FV3-6. đặt làm liên hệ chính qua sửa: luôn đúng một liên hệ chính', async () => {
    const c = await makeCustomer(prisma, fx);
    const p = await add(c.id, { isPrimary: true });
    const k = await add(c.id);
    const r = await a().patch(U(c.id, k.id), { updatedAt: k.updatedAt, isPrimary: true });
    expect(r.status).toBe(200);
    const list = (await a().get(C + c.id + '/contacts')).body.data.items as { id: string; isPrimary: boolean }[];
    expect(list.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([k.id]);
    expect(list.find((i) => i.id === p.id)?.isPrimary).toBe(false);
  });
  it('FV3-7. khách đã xoá mềm: sửa/xoá liên hệ -> 409 CUSTOMER_DELETED (như thêm liên hệ); không ghi', async () => {
    const c = await makeCustomer(prisma, fx);
    const k = await add(c.id);
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: new Date(), deletedById: fx.empA } });
    const r = await a().patch(U(c.id, k.id), { updatedAt: k.updatedAt, title: 'X' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CUSTOMER_DELETED');
    expect((await a().delete(U(c.id, k.id), { updatedAt: k.updatedAt })).status).toBe(409);
    expect((await prisma.contact.findUnique({ where: { id: k.id } }))?.title).toBeNull();
  });
});
