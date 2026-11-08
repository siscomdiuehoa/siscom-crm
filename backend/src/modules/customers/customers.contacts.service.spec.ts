import { Actor, Permission, Scope } from '../../common/auth/actor';
import { DomainException } from '../../common/errors/domain.exception';
import { ContactsService } from './customers.contacts.service';

const CID = '11111111-1111-4111-8111-111111111111';
const actor: Actor = { employeeId: 'e1', departmentId: 'd1' };
const ctx = { actor, requestId: 'r1' };
type Scopes = Partial<Record<Permission, Scope>>;
const ALL: Scopes = { 'customer.read': 'ALL', 'customer.update': 'ALL', 'contact.read': 'ALL', 'contact.create': 'ALL' };
const cust = (o: Record<string, unknown> = {}) => ({ id: CID, code: 'KH-00001', deletedAt: null, ownerId: null, owner: null, ...o });
const contactRow = (o: Record<string, unknown> = {}) => ({ id: 'c1', code: 'LH-000001', fullName: 'Nguyễn Văn A', title: null, phone: '0903123456', email: null, isPrimary: false, note: null, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), ...o });

function build(scopes: Scopes = ALL) {
  const customer = { findFirst: jest.fn() };
  const contact = { findMany: jest.fn(), findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn(), create: jest.fn() };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([{ id: CID }]), customer, contact };
  const prisma = { customer, contact, $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const actors = { scopeFor: jest.fn((_a: Actor, p: Permission) => scopes[p] ?? null) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new ContactsService(prisma as never, actors as never, audit as never);
  return { svc, customer, contact, tx, prisma, audit };
}
async function err(p: Promise<unknown>): Promise<DomainException> {
  try { await p; } catch (e) { if (e instanceof DomainException) return e; throw e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}
const ready = (scopes: Scopes = ALL, c = cust()) => {
  const e = build(scopes);
  e.customer.findFirst.mockResolvedValue(c);
  e.contact.create.mockResolvedValue(contactRow());
  e.contact.updateMany.mockResolvedValue({ count: 0 });
  return e;
};

describe('ContactsService.list', () => {
  it('trả liên hệ còn hiệu lực, chính trước; không lộ trường nội bộ', async () => {
    const e = ready();
    e.contact.findMany.mockResolvedValue([contactRow({ isPrimary: true }), contactRow({ id: 'c2', code: 'LH-000002' })]);
    const r = await e.svc.list(ctx, CID);
    expect(e.contact.findMany.mock.calls[0][0].where).toEqual({ customerId: CID, deletedAt: null });
    expect(e.contact.findMany.mock.calls[0][0].orderBy[0]).toEqual({ isPrimary: 'desc' });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ code: 'LH-000001', fullName: 'Nguyễn Văn A', isPrimary: true });
    expect(r.items[0]).not.toHaveProperty('createdById');
  });
  it('khách không có/đã xoá/ngoài phạm vi -> 404; thiếu quyền -> 403', async () => {
    const a = ready();
    a.customer.findFirst.mockResolvedValue(null);
    expect((await err(a.svc.list(ctx, CID))).code).toBe('CUSTOMER_NOT_FOUND');
    expect((await err(ready({ ...ALL, 'customer.read': 'OWN' }).svc.list(ctx, CID))).code).toBe('CUSTOMER_NOT_FOUND');
    expect((await err(ready({ ...ALL, 'contact.read': 'OWN' }).svc.list(ctx, CID))).code).toBe('CUSTOMER_NOT_FOUND');
    expect((await err(ready({ 'customer.read': 'ALL' }).svc.list(ctx, CID))).code).toBe('FORBIDDEN');
  });
});

describe('ContactsService.create', () => {
  it('thành công: chỉ tên + SĐT; không hạ liên hệ chính cũ; nhật ký không chứa tên người', async () => {
    const e = ready();
    const r = await e.svc.create(ctx, CID, { fullName: ' Nguyễn Văn A ', phone: '0903 123 456' } as never);
    expect(e.contact.updateMany).not.toHaveBeenCalled();
    expect(e.contact.create.mock.calls[0][0].data).toEqual({ customerId: CID, fullName: 'Nguyễn Văn A', title: null, phone: '0903 123 456', email: null, isPrimary: false, note: null, createdById: 'e1', updatedById: 'e1' });
    const a = e.audit.record.mock.calls[0][1];
    expect(a).toMatchObject({ action: 'contact.create', entityType: 'contact', entityCode: 'LH-000001', actorEmployeeId: 'e1' });
    expect(JSON.stringify(a)).not.toContain('Nguyễn');
    expect(r.code).toBe('LH-000001');
  });
  it('isPrimary: hạ liên hệ chính cũ TRƯỚC khi chèn, cùng transaction và sau khi khoá dòng khách', async () => {
    const e = ready();
    await e.svc.create(ctx, CID, { fullName: 'B', email: 'b@x.vn', isPrimary: true } as never);
    expect(e.contact.updateMany.mock.calls[0][0]).toEqual({ where: { customerId: CID, isPrimary: true, deletedAt: null }, data: { isPrimary: false, updatedById: 'e1' } });
    expect(e.contact.updateMany.mock.invocationCallOrder[0]).toBeLessThan(e.contact.create.mock.invocationCallOrder[0]);
    expect(e.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(e.contact.updateMany.mock.invocationCallOrder[0]);
    expect(e.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('04/11/2026: chỉ có họ tên (không SĐT/email) hợp lệ -> phone/email NULL, không tạo giá trị giả', async () => {
    for (const body of [{ fullName: 'A' }, { fullName: 'A', phone: '', email: '' }, { fullName: 'A', phone: null, email: '   ' }]) {
      const e = ready();
      await e.svc.create(ctx, CID, body as never);
      expect(e.contact.create.mock.calls[0][0].data).toMatchObject({ fullName: 'A', phone: null, email: null });
    }
  });
  it('định dạng sai / thiếu họ tên bị từ chối; không mở transaction', async () => {
    for (const body of [{ fullName: 'A', phone: '123' }, { fullName: 'A', email: 'x@' }, { fullName: '  ', phone: '0903123456' }]) {
      const e = ready();
      expect((await err(e.svc.create(ctx, CID, body as never))).code).toBe('VALIDATION_FAILED');
      expect(e.prisma.$transaction).not.toHaveBeenCalled();
    }
  });
  it('khách đã xoá mềm (kể cả bị xoá sau khi giành khoá) -> 409 CUSTOMER_DELETED', async () => {
    const e = ready(ALL, cust({ deletedAt: new Date() }));
    const x = await err(e.svc.create(ctx, CID, { fullName: 'A', phone: '0903123456' } as never));
    expect(x.code).toBe('CUSTOMER_DELETED');
    expect(e.contact.create).not.toHaveBeenCalled();
  });
  it('không tồn tại -> 404; ngoài phạm vi đọc -> 404', async () => {
    const a = ready();
    a.tx.$queryRaw.mockResolvedValue([]);
    expect((await err(a.svc.create(ctx, CID, { fullName: 'A', phone: '0903123456' } as never))).code).toBe('CUSTOMER_NOT_FOUND');
    const b = ready({ ...ALL, 'customer.read': 'OWN' });
    expect((await err(b.svc.create(ctx, CID, { fullName: 'A', phone: '0903123456' } as never))).code).toBe('CUSTOMER_NOT_FOUND');
  });
  it('thiếu quyền contact.create / customer.update hoặc ngoài phạm vi ghi -> 403', async () => {
    const body = { fullName: 'A', phone: '0903123456' } as never;
    expect((await err(ready({ 'customer.read': 'ALL', 'customer.update': 'ALL' }).svc.create(ctx, CID, body))).code).toBe('FORBIDDEN');
    expect((await err(ready({ 'customer.read': 'ALL', 'contact.create': 'ALL' }).svc.create(ctx, CID, body))).code).toBe('FORBIDDEN');
    expect((await err(ready({ ...ALL, 'contact.create': 'OWN' }).svc.create(ctx, CID, body))).code).toBe('FORBIDDEN');
  });
  it('lưới an toàn: unique liên hệ chính do DB báo -> 409 CONTACT_PRIMARY_CONFLICT', async () => {
    const e = ready();
    e.contact.create.mockRejectedValue({ code: 'P2002', meta: { target: ['uq_contact_primary_active'] } });
    expect((await err(e.svc.create(ctx, CID, { fullName: 'A', phone: '0903123456', isPrimary: true } as never))).code).toBe('CONTACT_PRIMARY_CONFLICT');
  });
  it('lock_timeout -> 409 CUSTOMER_BUSY; nhật ký lỗi -> thao tác lỗi', async () => {
    const a = ready();
    a.tx.$queryRaw.mockRejectedValue({ code: 'P2010', meta: { code: '55P03' } });
    expect((await err(a.svc.create(ctx, CID, { fullName: 'A', phone: '0903123456' } as never))).code).toBe('CUSTOMER_BUSY');
    const b = ready();
    b.audit.record.mockRejectedValue(new Error('AuditLog chưa triển khai'));
    await expect(b.svc.create(ctx, CID, { fullName: 'A', phone: '0903123456' } as never)).rejects.toThrow('AuditLog');
  });
});

// FV-3 (CT-FV3-1, Owner 08/11/2026 phương án A): sửa/xoá mềm liên hệ theo quyền customer.update trên TỪNG khách; khoá lạc quan bằng updatedAt.
const KID = '22222222-2222-4222-8222-222222222222';
const T0 = new Date('2026-11-01T00:00:00.000Z');
const stored = (o: Record<string, unknown> = {}) => contactRow({ id: KID, updatedAt: T0, ...o });
const readyW = (scopes: Scopes = ALL, c = cust(), row: Record<string, unknown> | null = stored()) => {
  const e = ready(scopes, c);
  e.contact.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) => (q.where.id === KID ? row : null));
  e.contact.updateMany.mockResolvedValue({ count: 1 });
  e.contact.findUniqueOrThrow.mockResolvedValue(stored({ updatedAt: new Date(T0.getTime() + 1) }));
  return e;
};
const upd = (o: Record<string, unknown> = {}) => ({ updatedAt: T0.toISOString(), ...o }) as never;

describe('ContactsService.update (FV-3)', () => {
  it('sửa đúng phạm vi: chỉ ghi trường thay đổi, điều kiện updatedAt cũ, updatedAt mới tăng chặt; nhật ký không chứa thông tin cá nhân', async () => {
    const e = readyW();
    const r = await e.svc.update(ctx, CID, KID, upd({ phone: '0903 999 888', title: 'Kế toán trưởng', fullName: 'Nguyễn Văn A' }));
    const call = e.contact.updateMany.mock.calls.at(-1)[0];
    expect(call.where).toEqual({ id: KID, customerId: CID, deletedAt: null, updatedAt: T0 });
    expect(call.data).toMatchObject({ phone: '0903 999 888', title: 'Kế toán trưởng', updatedById: 'e1' });
    expect(call.data).not.toHaveProperty('fullName'); // không đổi => không ghi
    expect(call.data.updatedAt.getTime()).toBeGreaterThan(T0.getTime());
    const a = e.audit.record.mock.calls[0][1];
    expect(a).toMatchObject({ action: 'contact.update', entityType: 'contact', entityId: KID, entityCode: 'LH-000001', actorEmployeeId: 'e1' });
    expect(a.changes.fields).toEqual(['phone', 'title']);
    expect(JSON.stringify(a)).not.toMatch(/0903|Kế toán|Nguyễn/);
    expect(r).toHaveProperty('updatedAt');
    expect(e.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(e.contact.findFirst.mock.invocationCallOrder[0]); // khoá khách trước
  });
  it('gửi rỗng/null = xoá giá trị tuỳ chọn; không gửi = giữ nguyên', async () => {
    const e = readyW(ALL, cust(), stored({ email: 'a@x.vn', note: 'ghi chú' }));
    await e.svc.update(ctx, CID, KID, upd({ email: '', note: null }));
    const d = e.contact.updateMany.mock.calls.at(-1)[0].data;
    expect(d).toMatchObject({ email: null, note: null });
    expect(d).not.toHaveProperty('phone');
  });
  it('không có thay đổi -> trả bản hiện tại, không ghi, không nhật ký', async () => {
    const e = readyW();
    const r = await e.svc.update(ctx, CID, KID, upd({ fullName: 'Nguyễn Văn A' }));
    expect(e.contact.updateMany).not.toHaveBeenCalled();
    expect(e.audit.record).not.toHaveBeenCalled();
    expect(r.updatedAt).toBe(T0.toISOString());
  });
  it('updatedAt cũ -> 409 CONTACT_VERSION_CONFLICT, không ghi; DB đổi giữa chừng (count 0) -> 409', async () => {
    const e = readyW();
    const x = await err(e.svc.update(ctx, CID, KID, upd({ updatedAt: '2026-10-01T00:00:00.000Z', phone: '0903111222' })));
    expect(x.code).toBe('CONTACT_VERSION_CONFLICT');
    expect(x.getStatus()).toBe(409);
    expect(e.contact.updateMany).not.toHaveBeenCalled();
    const f = readyW();
    f.contact.updateMany.mockResolvedValue({ count: 0 });
    expect((await err(f.svc.update(ctx, CID, KID, upd({ phone: '0903111222' })))).code).toBe('CONTACT_VERSION_CONFLICT');
    expect(f.audit.record).not.toHaveBeenCalled();
  });
  it('đặt làm liên hệ chính: hạ liên hệ chính khác của CÙNG khách trước khi ghi, cùng transaction', async () => {
    const e = readyW();
    await e.svc.update(ctx, CID, KID, upd({ isPrimary: true }));
    const [demote, own] = e.contact.updateMany.mock.calls.map((c: unknown[]) => c[0] as { data: Record<string, unknown> });
    expect(demote).toEqual({ where: { customerId: CID, isPrimary: true, deletedAt: null, id: { not: KID } }, data: { isPrimary: false, updatedById: 'e1' } });
    expect(own.data).toMatchObject({ isPrimary: true });
    expect(e.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('quyền theo từng khách: thiếu customer.update -> 403; customer.update ngoài phạm vi khách -> 403; ngoài phạm vi đọc -> 404', async () => {
    const body = upd({ phone: '0903111222' });
    const noUpdate = readyW({ 'customer.read': 'ALL', 'contact.read': 'ALL', 'contact.create': 'ALL' });
    expect((await err(noUpdate.svc.update(ctx, CID, KID, body))).code).toBe('FORBIDDEN');
    const other = cust({ ownerId: 'e9', owner: { departmentId: 'd9' } });
    const outOwn = readyW({ ...ALL, 'customer.update': 'OWN' }, other);
    expect((await err(outOwn.svc.update(ctx, CID, KID, body))).code).toBe('FORBIDDEN');
    expect(outOwn.contact.updateMany).not.toHaveBeenCalled();
    expect((await err(readyW({ ...ALL, 'customer.read': 'OWN' }, other).svc.update(ctx, CID, KID, body))).code).toBe('CUSTOMER_NOT_FOUND');
    expect((await err(readyW({ ...ALL, 'contact.read': 'OWN' }, other).svc.update(ctx, CID, KID, body))).code).toBe('CUSTOMER_NOT_FOUND');
  });
  it('liên hệ không thuộc khách / đã xoá -> 404 CONTACT_NOT_FOUND; khách đã xoá -> 409 CUSTOMER_DELETED', async () => {
    const e = readyW(ALL, cust(), null);
    expect((await err(e.svc.update(ctx, CID, KID, upd({ phone: '0903111222' })))).code).toBe('CONTACT_NOT_FOUND');
    expect(e.contact.findFirst.mock.calls[0][0].where).toMatchObject({ id: KID, customerId: CID, deletedAt: null });
    const d = readyW(ALL, cust({ deletedAt: new Date() }));
    expect((await err(d.svc.update(ctx, CID, KID, upd({ phone: '0903111222' })))).code).toBe('CUSTOMER_DELETED');
  });
  it('định dạng sai, họ tên rỗng, updatedAt sai -> VALIDATION_FAILED, không mở transaction', async () => {
    for (const b of [upd({ phone: '123' }), upd({ email: 'x@' }), upd({ fullName: '   ' }), upd({ updatedAt: 'hôm qua' })]) {
      const e = readyW();
      expect((await err(e.svc.update(ctx, CID, KID, b))).code).toBe('VALIDATION_FAILED');
      expect(e.prisma.$transaction).not.toHaveBeenCalled();
    }
  });
});

describe('ContactsService.remove (FV-3)', () => {
  it('xoá mềm: đặt deletedAt/deletedBy, điều kiện updatedAt; nhật ký contact.delete; không xoá vật lý', async () => {
    const e = readyW();
    const r = await e.svc.remove(ctx, CID, KID, upd());
    const call = e.contact.updateMany.mock.calls.at(-1)[0];
    expect(call.where).toEqual({ id: KID, customerId: CID, deletedAt: null, updatedAt: T0 });
    expect(call.data).toMatchObject({ deletedById: 'e1', updatedById: 'e1' });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(e.audit.record.mock.calls[0][1]).toMatchObject({ action: 'contact.delete', entityId: KID, entityCode: 'LH-000001', actorEmployeeId: 'e1' });
    expect(JSON.stringify(e.audit.record.mock.calls[0][1])).not.toContain('Nguyễn');
    expect(r).toEqual({ id: KID, code: 'LH-000001' });
    expect(e.contact).not.toHaveProperty('delete');
  });
  it('updatedAt cũ -> 409; thiếu quyền / ngoài phạm vi customer.update -> 403; không thuộc khách -> 404', async () => {
    expect((await err(readyW().svc.remove(ctx, CID, KID, upd({ updatedAt: '2026-10-01T00:00:00.000Z' })))).code).toBe('CONTACT_VERSION_CONFLICT');
    expect((await err(readyW({ 'customer.read': 'ALL', 'contact.read': 'ALL' }).svc.remove(ctx, CID, KID, upd()))).code).toBe('FORBIDDEN');
    const other = cust({ ownerId: 'e9', owner: { departmentId: 'd9' } });
    const o = readyW({ ...ALL, 'customer.update': 'OWN' }, other);
    expect((await err(o.svc.remove(ctx, CID, KID, upd()))).code).toBe('FORBIDDEN');
    expect(o.contact.updateMany).not.toHaveBeenCalled();
    expect((await err(readyW(ALL, cust(), null).svc.remove(ctx, CID, KID, upd()))).code).toBe('CONTACT_NOT_FOUND');
  });
});
