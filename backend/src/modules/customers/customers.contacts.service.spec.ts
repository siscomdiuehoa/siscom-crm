import { Actor, Permission, Scope } from '../../common/auth/actor';
import { DomainException } from '../../common/errors/domain.exception';
import { ContactsService } from './customers.contacts.service';

const CID = '11111111-1111-4111-8111-111111111111';
const actor: Actor = { employeeId: 'e1', departmentId: 'd1' };
const ctx = { actor, requestId: 'r1' };
type Scopes = Partial<Record<Permission, Scope>>;
const ALL: Scopes = { 'customer.read': 'ALL', 'customer.update': 'ALL', 'contact.read': 'ALL', 'contact.create': 'ALL' };
const cust = (o: Record<string, unknown> = {}) => ({ id: CID, code: 'KH-00001', deletedAt: null, ownerId: null, owner: null, ...o });
const contactRow = (o: Record<string, unknown> = {}) => ({ id: 'c1', code: 'LH-000001', fullName: 'Nguyễn Văn A', title: null, phone: '0903123456', email: null, isPrimary: false, note: null, createdAt: new Date('2026-01-01T00:00:00Z'), ...o });

function build(scopes: Scopes = ALL) {
  const customer = { findFirst: jest.fn() };
  const contact = { findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn() };
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
  it('phải có SĐT hoặc email; định dạng sai bị từ chối; không mở transaction', async () => {
    for (const body of [{ fullName: 'A' }, { fullName: 'A', phone: '', email: '' }, { fullName: 'A', phone: '123' }, { fullName: 'A', email: 'x@' }, { fullName: '  ', phone: '0903123456' }]) {
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
