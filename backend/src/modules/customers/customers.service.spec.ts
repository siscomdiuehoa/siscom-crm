import { Actor, Permission, Scope } from '../../common/auth/actor';
import { DomainException } from '../../common/errors/domain.exception';
import { UnverifiedLinksChecker } from './customers.deletion-guard';
import { CustomersService, deriveShortName, diffFields } from './customers.service';

const ID = '11111111-1111-4111-8111-111111111111';
const actor: Actor = { employeeId: 'e1', departmentId: 'd1' };
const ctx = { actor, requestId: 'r1' };
type Scopes = Partial<Record<Permission, Scope>>;
const ALL: Scopes = { 'customer.read': 'ALL', 'customer.create': 'ALL', 'customer.update': 'ALL', 'customer.delete': 'ALL', 'customer.restore': 'ALL' };
const lk = (code = 'POTENTIAL', isActive = true) => ({ code, labelVi: code, isActive });
const row = (o: Record<string, unknown> = {}) => ({
  id: ID, code: 'KH-00001', name: 'Công ty ABC', shortName: 'ABC', taxId: null, address: null, phone: '0903123456', phoneE164: '+84903123456',
  email: null, website: null, note: null, tags: [], revenueVnd: 0n, revenueBasis: 'ESTIMATED', version: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), deletedAt: null, restoredAt: null, ownerId: null,
  tier: lk(), status: lk(), industry: null, source: null, province: null, owner: null, ...o,
});
const lookups = [{ id: 't1', type: 'customer_tier', code: 'POTENTIAL', isActive: true }, { id: 's1', type: 'customer_status', code: 'POTENTIAL', isActive: true }];

function build(scopes: Scopes = ALL, links: { check: () => Promise<{ verified: boolean; unchecked: string[] }> } = new UnverifiedLinksChecker()) {
  const customer = { findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), updateMany: jest.fn() };
  const lookupItem = { findMany: jest.fn() };
  const employee = { findFirst: jest.fn(), findMany: jest.fn() };
  const customerAssignment = { create: jest.fn().mockResolvedValue({ id: 'as1' }) };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn(), customer, lookupItem, employee, customerAssignment };
  const prisma = { customer, lookupItem, employee, $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const actors = { resolve: jest.fn(), scopeFor: jest.fn((_a: Actor, p: Permission) => scopes[p] ?? null) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new CustomersService(prisma as never, actors as never, audit as never, links as never);
  return { svc, customer, lookupItem, employee, customerAssignment, tx, prisma, audit };
}
async function err(p: Promise<unknown>): Promise<DomainException> {
  try { await p; } catch (e) { if (e instanceof DomainException) return e; throw e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}

describe('helpers', () => {
  it('deriveShortName theo quy tắc frontend B1.1', () => {
    expect(deriveShortName('Công ty TNHH ABC')).toBe('ABC');
    expect(deriveShortName('Cty CP Xây dựng Minh Phát')).toBe('Xây dựng Minh Phát');
    expect(deriveShortName('Tập đoàn XYZ')).toBe('Tập đoàn XYZ');
  });
  it('diffFields ẩn trường nhạy cảm', () => {
    expect(diffFields({ name: 'A', phone: '1', tags: [] }, { name: 'B', phone: '2', tags: [] })).toEqual({ name: ['A', 'B'], phone: '(đã thay đổi)' });
  });
});

describe('create', () => {
  const input = { name: 'Công ty TNHH ABC', phone: '0903 123 456' } as never;
  const ready = () => {
    const e = build();
    e.lookupItem.findMany.mockResolvedValue(lookups);
    e.customer.create.mockResolvedValue({ id: ID, code: 'KH-00001' });
    e.customer.findUniqueOrThrow.mockResolvedValue(row());
    return e;
  };
  it('chỉ Tên + SĐT: mã do DB sinh, không nhận dữ liệu giả, ghi nhật ký cùng transaction', async () => {
    const e = ready();
    const r = await e.svc.create(ctx, input);
    const data = e.customer.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('code');
    expect(data).not.toHaveProperty('id');
    expect(data).toMatchObject({ tierId: 't1', statusId: 's1', shortName: 'ABC', phoneE164: '+84903123456', createdById: 'e1', updatedById: 'e1', taxId: null, email: null, website: null, industryId: null, tags: [] });
    expect(e.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(e.audit.record).toHaveBeenCalledTimes(1);
    expect(e.audit.record.mock.calls[0][1]).toMatchObject({ action: 'customer.create', entityCode: 'KH-00001', actorEmployeeId: 'e1', requestId: 'r1' });
    expect(r.revenueVnd).toBe('0');
    expect(r.code).toBe('KH-00001');
  });
  it('không có quyền customer.create -> 403 và không mở transaction', async () => {
    const e = build({});
    expect((await err(e.svc.create(ctx, input))).code).toBe('FORBIDDEN');
    expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('B-3 ALL không gửi ownerId: không có chủ sở hữu, không tạo phân công', async () => {
    const e = ready();
    await e.svc.create(ctx, input);
    expect(e.customer.create.mock.calls[0][0].data.ownerId).toBeNull();
    expect(e.employee.findFirst).not.toHaveBeenCalled();
    expect(e.customerAssignment.create).not.toHaveBeenCalled();
    expect(e.audit.record.mock.calls[0][1].changes).not.toHaveProperty('ownerId');
  });
  it('B-3 OWN không gửi ownerId (D14): chủ sở hữu = chính mình, phân công OWNER cùng transaction, nhật ký ownerId', async () => {
    const e = build({ 'customer.read': 'OWN', 'customer.create': 'OWN' });
    e.lookupItem.findMany.mockResolvedValue(lookups);
    e.employee.findFirst.mockResolvedValue({ id: 'e1', departmentId: 'd1' });
    e.customer.create.mockResolvedValue({ id: ID, code: 'KH-00001' });
    e.customer.findUniqueOrThrow.mockResolvedValue(row({ ownerId: 'e1', owner: { id: 'e1', code: 'NV-0001', fullName: 'A', departmentId: 'd1' } }));
    const r = await e.svc.create(ctx, { ...(input as object), ownerReason: ' tự tạo ' } as never);
    expect(e.employee.findFirst.mock.calls[0][0].where).toEqual({ id: 'e1', deletedAt: null, status: 'ACTIVE' });
    expect(e.customer.create.mock.calls[0][0].data.ownerId).toBe('e1');
    expect(e.customerAssignment.create.mock.calls[0][0].data).toEqual({ customerId: ID, employeeId: 'e1', role: 'OWNER', assignedById: 'e1', reason: 'tự tạo' });
    expect(e.audit.record.mock.calls[0][1].changes.ownerId).toEqual([null, 'e1']);
    expect(r.owner).toEqual({ id: 'e1', code: 'NV-0001', fullName: 'A' });
  });
  it('B-3 OWN gửi ownerId người khác -> 403 trước transaction; DEPARTMENT gửi người khác phòng -> 403 trong transaction, không tạo khách', async () => {
    const own = build({ 'customer.create': 'OWN' });
    expect((await err(own.svc.create(ctx, { ...(input as object), ownerId: 'e2' } as never))).code).toBe('FORBIDDEN');
    expect(own.prisma.$transaction).not.toHaveBeenCalled();
    const dept = build({ 'customer.create': 'DEPARTMENT' });
    dept.lookupItem.findMany.mockResolvedValue(lookups);
    dept.employee.findFirst.mockResolvedValue({ id: 'e2', departmentId: 'd2' });
    expect((await err(dept.svc.create(ctx, { ...(input as object), ownerId: 'e2' } as never))).code).toBe('FORBIDDEN');
    expect(dept.customer.create).not.toHaveBeenCalled();
  });
  it('B-3 ownerId không tồn tại / không ACTIVE -> 400 OWNER_INVALID, không tạo khách', async () => {
    const e = ready();
    e.employee.findFirst.mockResolvedValue(null);
    const x = await err(e.svc.create(ctx, { ...(input as object), ownerId: 'e9' } as never));
    expect(x.code).toBe('OWNER_INVALID');
    expect(e.customer.create).not.toHaveBeenCalled();
    expect(e.customerAssignment.create).not.toHaveBeenCalled();
  });
  it('SĐT sai -> VALIDATION_FAILED, không mở transaction', async () => {
    const e = build();
    const x = await err(e.svc.create(ctx, { name: 'Công ty A', phone: '123' } as never));
    expect(x.code).toBe('VALIDATION_FAILED');
    expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('mã danh mục không có/ngừng dùng -> LOOKUP_INVALID', async () => {
    const e = build();
    e.lookupItem.findMany.mockResolvedValue([]);
    expect((await err(e.svc.create(ctx, input))).code).toBe('LOOKUP_INVALID');
    e.lookupItem.findMany.mockResolvedValue([{ ...lookups[0], isActive: false }, lookups[1]]);
    expect((await err(e.svc.create(ctx, input))).code).toBe('LOOKUP_INVALID');
  });
  it('MST trùng: người xem được khách kia thấy mã+tên; người không xem được thì không', async () => {
    const hit = { id: 'x', code: 'KH-00002', ownerId: null, owner: null };
    const e = ready();
    e.customer.findFirst.mockResolvedValue(hit);
    e.customer.findUnique.mockResolvedValue({ name: 'Công ty khác' });
    const a = await err(e.svc.create(ctx, { ...(input as object), taxId: '0312345678' } as never));
    expect(a.code).toBe('CUSTOMER_DUPLICATE_TAX_ID');
    expect(a.details).toEqual({ visibleConflict: { code: 'KH-00002', name: 'Công ty khác' } });
    expect(e.customer.create).not.toHaveBeenCalled();
    const h = build({ ...ALL, 'customer.read': 'OWN' });
    h.lookupItem.findMany.mockResolvedValue(lookups);
    h.customer.findFirst.mockResolvedValue(hit);
    const b = await err(h.svc.create(ctx, { ...(input as object), taxId: '0312345678' } as never));
    expect(b.details).toEqual({ visibleConflict: null });
    expect(h.customer.findUnique).not.toHaveBeenCalled(); // tên khách kia không được đọc
    expect(JSON.stringify([b.message, b.details])).not.toMatch(/KH-00002|Công ty khác/);
  });
  it('đua nhau: unique MST do DB báo -> vẫn ra CUSTOMER_DUPLICATE_TAX_ID (có kiểm tra quyền xem)', async () => {
    const e = ready();
    e.customer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'x', code: 'KH-00002', ownerId: null, owner: null });
    e.customer.findUnique.mockResolvedValue({ name: 'Công ty khác' });
    e.customer.create.mockRejectedValue({ code: 'P2002', meta: { target: ['uq_customer_tax_id_active'] } });
    const x = await err(e.svc.create(ctx, { ...(input as object), taxId: '0312345678' } as never));
    expect(x.code).toBe('CUSTOMER_DUPLICATE_TAX_ID');
    expect(x.details).toEqual({ visibleConflict: { code: 'KH-00002', name: 'Công ty khác' } });
  });
  it('nhật ký lỗi => thao tác lỗi (transaction bị huỷ), không nuốt lỗi', async () => {
    const e = ready();
    e.audit.record.mockRejectedValue(new Error('AuditLog chưa triển khai'));
    await expect(e.svc.create(ctx, input)).rejects.toThrow('AuditLog');
  });
});

describe('create — số điện thoại không bắt buộc (04/11/2026)', () => {
  const ready = () => {
    const e = build();
    e.lookupItem.findMany.mockResolvedValue(lookups);
    e.customer.create.mockResolvedValue({ id: ID, code: 'KH-00001' });
    e.customer.findUniqueOrThrow.mockResolvedValue(row({ phone: null, phoneE164: null }));
    return e;
  };
  it('không gửi / rỗng / null / toàn khoảng trắng: lưu phone NULL và phone_e164 NULL, không tạo số giả', async () => {
    for (const phone of [undefined, '', null, '   ']) {
      const e = ready();
      const r = await e.svc.create(ctx, { name: 'Công ty TNHH ABC', ...(phone === undefined ? {} : { phone }) } as never);
      expect(e.customer.create.mock.calls[0][0].data).toMatchObject({ phone: null, phoneE164: null });
      expect(r.phone).toBeNull();
    }
  });
  it('có số: vẫn kiểm định dạng (sai -> 400, không mở transaction)', async () => {
    const e = ready();
    const x = await err(e.svc.create(ctx, { name: 'Công ty TNHH ABC', phone: '123' } as never));
    expect(x.code).toBe('VALIDATION_FAILED');
    expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  const ready = (cur = row(), scopes: Scopes = ALL) => {
    const e = build(scopes);
    e.tx.$queryRaw.mockResolvedValue([{ id: ID }]);
    e.customer.findFirst.mockResolvedValue(cur);
    e.customer.updateMany.mockResolvedValue({ count: 1 });
    e.customer.findUniqueOrThrow.mockResolvedValue(cur);
    e.lookupItem.findMany.mockResolvedValue([]);
    return e;
  };
  it('version lệch -> 409 kèm currentVersion; không ghi', async () => {
    const e = ready(row({ version: 3 }));
    const x = await err(e.svc.update(ctx, ID, { version: 1, note: 'x' } as never));
    expect(x.code).toBe('CUSTOMER_VERSION_CONFLICT');
    expect(x.details).toEqual({ currentVersion: 3 });
    expect(e.customer.updateMany).not.toHaveBeenCalled();
  });
  it('chỉ cập nhật trường được gửi; rỗng -> NULL; tăng version; ghi người sửa và nhật ký', async () => {
    const e = ready(row({ version: 3, address: 'cũ' }));
    await e.svc.update(ctx, ID, { version: 3, note: 'ghi chú mới', address: '' } as never);
    const arg = e.customer.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: ID, version: 3, deletedAt: null });
    expect(arg.data).toEqual({ note: 'ghi chú mới', address: null, updatedById: 'e1', version: { increment: 1 } });
    const entry = e.audit.record.mock.calls[0][1];
    expect(entry.action).toBe('customer.update');
    expect(entry.changes).toEqual({ note: '(đã thay đổi)', address: '(đã thay đổi)' });
  });
  it('B-3 đổi chủ sở hữu: kiểm ứng viên, ghi ownerId, đóng phân công cũ (giờ DB) + mở phân công mới, nhật ký [cũ, mới]', async () => {
    const e = ready(row({ ownerId: 'e2', owner: { id: 'e2', code: 'NV-0002', fullName: 'B', departmentId: 'd1' } }));
    e.employee.findFirst.mockResolvedValue({ id: 'e3', departmentId: 'd1' });
    await e.svc.update(ctx, ID, { version: 1, ownerId: 'e3', ownerReason: 'bàn giao' } as never);
    expect(e.employee.findFirst.mock.calls[0][0].where).toEqual({ id: 'e3', deletedAt: null, status: 'ACTIVE' });
    expect(e.customer.updateMany.mock.calls[0][0].data).toEqual({ ownerId: 'e3', updatedById: 'e1', version: { increment: 1 } });
    expect(e.tx.$executeRaw).toHaveBeenCalledTimes(3); // 2 SET LOCAL + 1 UPDATE customer_assignment ... ended_at = now()
    expect(e.customerAssignment.create.mock.calls[0][0].data).toEqual({ customerId: ID, employeeId: 'e3', role: 'OWNER', assignedById: 'e1', reason: 'bàn giao' });
    expect(e.audit.record.mock.calls[0][1].changes).toEqual({ ownerId: ['e2', 'e3'] });
  });
  it('B-3 ownerId bằng hiện tại -> không đổi, không phân công; null (ALL) -> bỏ chủ: đóng phân công, không mở mới', async () => {
    const same = ready(row({ ownerId: 'e2', owner: { id: 'e2', code: 'NV-0002', fullName: 'B', departmentId: 'd1' } }));
    await same.svc.update(ctx, ID, { version: 1, ownerId: 'e2' } as never);
    expect(same.customer.updateMany).not.toHaveBeenCalled();
    expect(same.customerAssignment.create).not.toHaveBeenCalled();
    const clear = ready(row({ ownerId: 'e2', owner: { id: 'e2', code: 'NV-0002', fullName: 'B', departmentId: 'd1' } }));
    await clear.svc.update(ctx, ID, { version: 1, ownerId: null } as never);
    expect(clear.customer.updateMany.mock.calls[0][0].data.ownerId).toBeNull();
    expect(clear.tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(clear.customerAssignment.create).not.toHaveBeenCalled();
    expect(clear.employee.findFirst).not.toHaveBeenCalled();
    expect(clear.audit.record.mock.calls[0][1].changes).toEqual({ ownerId: ['e2', null] });
  });
  it('B-3 phạm vi OWN: đặt chủ sở hữu người khác/null -> 403; ứng viên không ACTIVE -> 400 OWNER_INVALID', async () => {
    const own = ready(row({ ownerId: 'e1', owner: { id: 'e1', code: 'NV-0001', fullName: 'A', departmentId: 'd1' } }), { 'customer.read': 'OWN', 'customer.update': 'OWN' });
    expect((await err(own.svc.update(ctx, ID, { version: 1, ownerId: 'e2' } as never))).code).toBe('FORBIDDEN');
    expect((await err(own.svc.update(ctx, ID, { version: 1, ownerId: null } as never))).code).toBe('FORBIDDEN');
    expect(own.customer.updateMany).not.toHaveBeenCalled();
    const bad = ready(row());
    bad.employee.findFirst.mockResolvedValue(null);
    expect((await err(bad.svc.update(ctx, ID, { version: 1, ownerId: 'e9' } as never))).code).toBe('OWNER_INVALID');
    expect(bad.customer.updateMany).not.toHaveBeenCalled();
  });
  it('không đổi gì -> trả bản hiện tại, không tăng version, không ghi nhật ký', async () => {
    const e = ready(row());
    await e.svc.update(ctx, ID, { version: 1, note: null } as never);
    expect(e.customer.updateMany).not.toHaveBeenCalled();
    expect(e.audit.record).not.toHaveBeenCalled();
  });
  it('SĐT cũ không đạt chuẩn mới vẫn sửa được khi không đổi SĐT; đổi sang SĐT sai thì bị chặn', async () => {
    const legacy = row({ phone: '12345', phoneE164: null });
    const a = ready(legacy);
    await a.svc.update(ctx, ID, { version: 1, phone: '12345', note: 'x' } as never);
    expect(a.customer.updateMany.mock.calls[0][0].data).not.toHaveProperty('phone');
    const b = ready(legacy);
    expect((await err(b.svc.update(ctx, ID, { version: 1, phone: '12' } as never))).code).toBe('VALIDATION_FAILED');
  });
  it('04/11/2026: khách chưa có số -> cập nhật thêm số sau (kiểm định dạng, tính phone_e164)', async () => {
    const e = ready(row({ phone: null, phoneE164: null }));
    await e.svc.update(ctx, ID, { version: 1, phone: '0903 123 456' } as never);
    expect(e.customer.updateMany.mock.calls[0][0].data).toMatchObject({ phone: '0903 123 456', phoneE164: '+84903123456' });
    const bad = ready(row({ phone: null, phoneE164: null }));
    expect((await err(bad.svc.update(ctx, ID, { version: 1, phone: '123' } as never))).code).toBe('VALIDATION_FAILED');
    expect(bad.customer.updateMany).not.toHaveBeenCalled();
  });
  it('04/11/2026: xoá số (null / rỗng) -> phone NULL và phone_e164 NULL; không gửi phone -> giữ nguyên', async () => {
    for (const phone of [null, '', '  ']) {
      const e = ready();
      await e.svc.update(ctx, ID, { version: 1, phone } as never);
      expect(e.customer.updateMany.mock.calls[0][0].data).toMatchObject({ phone: null, phoneE164: null });
    }
    const keep = ready();
    await keep.svc.update(ctx, ID, { version: 1, note: 'x' } as never);
    expect(keep.customer.updateMany.mock.calls[0][0].data).not.toHaveProperty('phone');
  });
  it('đổi SĐT hợp lệ cập nhật cả phone_e164', async () => {
    const e = ready();
    await e.svc.update(ctx, ID, { version: 1, phone: '+82 2 1234 5678' } as never);
    expect(e.customer.updateMany.mock.calls[0][0].data).toMatchObject({ phone: '+82 2 1234 5678', phoneE164: '+82212345678' });
  });
  it('không tồn tại / đã xoá / ngoài phạm vi đọc -> 404', async () => {
    const a = ready();
    a.tx.$queryRaw.mockResolvedValue([]);
    expect((await err(a.svc.update(ctx, ID, { version: 1, note: 'x' } as never))).code).toBe('CUSTOMER_NOT_FOUND');
    const b = ready();
    b.customer.findFirst.mockResolvedValue(null);
    expect((await err(b.svc.update(ctx, ID, { version: 1, note: 'x' } as never))).code).toBe('CUSTOMER_NOT_FOUND');
    const c = ready(row(), { ...ALL, 'customer.read': 'OWN' });
    expect((await err(c.svc.update(ctx, ID, { version: 1, note: 'x' } as never))).code).toBe('CUSTOMER_NOT_FOUND');
  });
  it('thiếu quyền/phạm vi ghi -> 403', async () => {
    expect((await err(ready(row(), { 'customer.read': 'ALL' }).svc.update(ctx, ID, { version: 1, note: 'x' } as never))).code).toBe('FORBIDDEN');
    const e = ready(row({ ownerId: 'e2', owner: { id: 'e2', code: 'NV-0002', fullName: 'B', departmentId: 'd1' } }), { 'customer.read': 'ALL', 'customer.update': 'OWN' });
    expect((await err(e.svc.update(ctx, ID, { version: 1, note: 'x' } as never))).code).toBe('FORBIDDEN');
  });
  it('đổi MST sang MST đang có khách khác -> 409', async () => {
    const e = ready();
    e.customer.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce({ id: 'x', code: 'KH-00009', ownerId: null, owner: null });
    e.customer.findUnique.mockResolvedValue({ name: 'Cty khác' });
    const x = await err(e.svc.update(ctx, ID, { version: 1, taxId: '0312345678' } as never));
    expect(x.code).toBe('CUSTOMER_DUPLICATE_TAX_ID');
    expect(e.customer.updateMany).not.toHaveBeenCalled();
  });
  it('danh mục: đổi sang mục ngừng dùng bị chặn; đổi sang mục hoạt động ghi id; xoá bằng rỗng', async () => {
    const a = ready();
    a.lookupItem.findMany.mockResolvedValue([{ id: 't2', type: 'customer_tier', code: 'VIP', isActive: false }]);
    expect((await err(a.svc.update(ctx, ID, { version: 1, tier: 'VIP' } as never))).code).toBe('LOOKUP_INVALID');
    const b = ready();
    b.lookupItem.findMany.mockResolvedValue([{ id: 't2', type: 'customer_tier', code: 'VIP', isActive: true }]);
    await b.svc.update(ctx, ID, { version: 1, tier: 'VIP' } as never);
    expect(b.customer.updateMany.mock.calls[0][0].data.tierId).toBe('t2');
    const c = ready(row({ industry: lk('IND1') }));
    await c.svc.update(ctx, ID, { version: 1, industry: '' } as never);
    expect(c.customer.updateMany.mock.calls[0][0].data.industryId).toBeNull();
  });
});

describe('restore', () => {
  const deleted = () => row({ deletedAt: new Date('2026-02-01T00:00:00Z') });
  const ready = (cur = deleted(), conflicts: unknown[] = [], scopes: Scopes = ALL) => {
    const e = build(scopes);
    e.tx.$queryRaw.mockResolvedValueOnce([{ id: ID }]).mockResolvedValueOnce(conflicts);
    e.customer.findFirst.mockResolvedValue(cur);
    e.customer.updateMany.mockResolvedValue({ count: 1 });
    e.customer.findUniqueOrThrow.mockResolvedValue(row());
    return e;
  };
  it('thành công: xoá dấu xoá mềm, ghi người khôi phục, tăng version, nhật ký', async () => {
    const e = ready();
    await e.svc.restore(ctx, ID);
    const arg = e.customer.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: ID, deletedAt: { not: null } });
    expect(arg.data).toMatchObject({ deletedAt: null, deletedById: null, deleteReason: null, restoredById: 'e1', updatedById: 'e1', version: { increment: 1 } });
    expect(e.audit.record.mock.calls[0][1].action).toBe('customer.restore');
  });
  it('đang hoạt động -> 409 CUSTOMER_NOT_DELETED; không tồn tại -> 404; thiếu quyền -> 403', async () => {
    expect((await err(ready(row()).svc.restore(ctx, ID))).code).toBe('CUSTOMER_NOT_DELETED');
    const n = ready();
    n.tx.$queryRaw.mockReset().mockResolvedValue([]);
    expect((await err(n.svc.restore(ctx, ID))).code).toBe('CUSTOMER_NOT_FOUND');
    expect((await err(ready(deleted(), [], { 'customer.read': 'ALL' }).svc.restore(ctx, ID))).code).toBe('FORBIDDEN');
  });
  it('xung đột MST: chỉ liệt kê khách mà người thao tác được xem', async () => {
    const conflicts = [{ conflict_code: 'KH-00002', conflict_name: 'Cty X' }];
    const a = ready(deleted(), conflicts);
    a.customer.findMany.mockResolvedValue([{ code: 'KH-00002', ownerId: null, owner: null }]);
    const x = await err(a.svc.restore(ctx, ID));
    expect(x.code).toBe('CUSTOMER_RESTORE_CONFLICT');
    expect(x.details).toEqual({ conflicts: [{ code: 'KH-00002', name: 'Cty X' }] });
    expect(a.customer.updateMany).not.toHaveBeenCalled();
    const b = ready(row({ deletedAt: new Date(), ownerId: 'e1', owner: { id: 'e1', code: 'NV-0001', fullName: 'A', departmentId: 'd1' } }), conflicts, { ...ALL, 'customer.read': 'OWN' });
    b.customer.findMany.mockResolvedValue([{ code: 'KH-00002', ownerId: null, owner: null }]);
    const y = await err(b.svc.restore(ctx, ID));
    expect(y.details).toEqual({ conflicts: [] });
    expect(JSON.stringify([y.message, y.details])).not.toMatch(/KH-00002|Cty X/);
  });
  it('đua nhau: unique MST do DB báo khi khôi phục -> CUSTOMER_RESTORE_CONFLICT', async () => {
    const e = ready(row({ deletedAt: new Date(), taxId: '0312345678' }));
    e.customer.updateMany.mockRejectedValue({ code: 'P2002', meta: { target: ['uq_customer_tax_id_active'] } });
    e.customer.findFirst.mockResolvedValueOnce(row({ deletedAt: new Date(), taxId: '0312345678' })).mockResolvedValueOnce({ id: 'x', code: 'KH-00003', ownerId: null, owner: null });
    e.customer.findUnique.mockResolvedValue({ name: 'Cty Y' });
    const x = await err(e.svc.restore(ctx, ID));
    expect(x.code).toBe('CUSTOMER_RESTORE_CONFLICT');
    expect(x.details).toEqual({ conflicts: [{ code: 'KH-00003', name: 'Cty Y' }] });
  });
});

describe('remove (khoá, N2 = Y)', () => {
  it('cấu hình thật: luôn 409 DELETE_LINKS_UNVERIFIED; không ghi, không mở transaction, không nhật ký', async () => {
    const e = build();
    e.customer.findFirst.mockResolvedValue(row());
    const x = await err(e.svc.remove(ctx, ID));
    expect(x.code).toBe('DELETE_LINKS_UNVERIFIED');
    expect(x.getStatus()).toBe(409);
    expect(e.prisma.$transaction).not.toHaveBeenCalled();
    expect(e.customer.updateMany).not.toHaveBeenCalled();
    expect(e.audit.record).not.toHaveBeenCalled();
  });
  it('thiếu quyền -> 403; ngoài phạm vi đọc -> 404 (đều trước khi nói đến liên kết)', async () => {
    const a = build({ 'customer.read': 'ALL' });
    a.customer.findFirst.mockResolvedValue(row());
    expect((await err(a.svc.remove(ctx, ID))).code).toBe('FORBIDDEN');
    const b = build({ ...ALL, 'customer.read': 'OWN' });
    b.customer.findFirst.mockResolvedValue(row());
    expect((await err(b.svc.remove(ctx, ID))).code).toBe('CUSTOMER_NOT_FOUND');
  });
  it('logic xoá mềm (chỉ kiểm chứng với checker GIẢ định nghĩa NGAY TRONG test, không có trong src)', async () => {
    const e = build(ALL, { check: async () => ({ verified: true, unchecked: [] }) });
    e.tx.$queryRaw.mockResolvedValue([{ id: ID }]);
    e.customer.findFirst.mockResolvedValue(row());
    e.customer.updateMany.mockResolvedValue({ count: 1 });
    e.customer.findUniqueOrThrow.mockResolvedValue(row({ deletedAt: new Date() }));
    await e.svc.remove(ctx, ID);
    expect(e.customer.updateMany.mock.calls[0][0].data).toMatchObject({ deletedById: 'e1', version: { increment: 1 } });
    expect(e.customer.updateMany.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect(e.audit.record.mock.calls[0][1].action).toBe('customer.delete');
  });
});

describe('list / get', () => {
  it('mặc định: chỉ khách chưa xoá mềm, phân trang, sắp xếp ổn định, totalPages đúng', async () => {
    const e = build();
    e.customer.count.mockResolvedValue(25);
    e.customer.findMany.mockResolvedValue([row()]);
    const r = await e.svc.list(ctx, {});
    const a = e.customer.findMany.mock.calls[0][0];
    expect(a.where).toMatchObject({ deletedAt: null, AND: [{}] });
    expect(a).toMatchObject({ skip: 0, take: 20, orderBy: [{ createdAt: 'desc' }, { code: 'desc' }] });
    expect(r).toMatchObject({ page: 1, pageSize: 20, total: 25, totalPages: 2 });
    expect(r.items[0]).not.toHaveProperty('isDemo');
  });
  it('page 2, pageSize 10 -> skip 10; không có dữ liệu -> items rỗng và không gọi findMany', async () => {
    const e = build();
    e.customer.count.mockResolvedValue(0);
    const r = await e.svc.list(ctx, { page: 2, pageSize: 10 });
    expect(r).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(e.customer.findMany).not.toHaveBeenCalled();
    const f = build();
    f.customer.count.mockResolvedValue(50);
    f.customer.findMany.mockResolvedValue([]);
    await f.svc.list(ctx, { page: 2, pageSize: 10 });
    expect(f.customer.findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 10 });
  });
  it('phạm vi OWN / DEPARTMENT được áp vào truy vấn; không có quyền đọc -> 403', async () => {
    const o = build({ 'customer.read': 'OWN' });
    o.customer.count.mockResolvedValue(1);
    o.customer.findMany.mockResolvedValue([]);
    await o.svc.list(ctx, {});
    expect(o.customer.findMany.mock.calls[0][0].where.AND).toEqual([{ ownerId: 'e1' }]);
    expect((await err(build({}).svc.list(ctx, {}))).code).toBe('FORBIDDEN');
  });
  it('deleted=only: cần customer.restore VÀ vẫn giới hạn bởi phạm vi đọc (N6)', async () => {
    expect((await err(build({ 'customer.read': 'ALL' }).svc.list(ctx, { deleted: 'only' }))).code).toBe('FORBIDDEN');
    const e = build({ 'customer.read': 'ALL', 'customer.restore': 'DEPARTMENT' });
    e.customer.count.mockResolvedValue(0);
    await e.svc.list(ctx, { deleted: 'only' });
    expect(e.customer.count.mock.calls[0][0].where).toMatchObject({ deletedAt: { not: null }, AND: [{}, { owner: { is: { departmentId: 'd1' } } }] });
  });
  it('page × pageSize quá lớn -> 400; mã danh mục lọc không tồn tại -> LOOKUP_INVALID', async () => {
    expect((await err(build().svc.list(ctx, { page: 1001, pageSize: 100 }))).code).toBe('VALIDATION_FAILED');
    const e = build();
    e.lookupItem.findMany.mockResolvedValue([]);
    expect((await err(e.svc.list(ctx, { tier: 'NOPE' }))).code).toBe('LOOKUP_INVALID');
  });
  it('lọc theo danh mục dùng id đã giải mã (kể cả mục ngừng dùng)', async () => {
    const e = build();
    e.lookupItem.findMany.mockResolvedValue([{ id: 't9', type: 'customer_tier', code: 'VIP', isActive: false }]);
    e.customer.count.mockResolvedValue(0);
    await e.svc.list(ctx, { tier: 'VIP' });
    expect(e.customer.count.mock.calls[0][0].where.tierId).toBe('t9');
  });
  it('xung đột snapshot (40001) được thử lại', async () => {
    const e = build();
    e.customer.count.mockResolvedValue(0);
    e.prisma.$transaction.mockImplementationOnce(async () => { throw { code: 'P2034', meta: { code: '40001' } }; });
    await expect(e.svc.list(ctx, {})).resolves.toMatchObject({ total: 0 });
    expect(e.prisma.$transaction).toHaveBeenCalledTimes(2);
  });
  it('get: có -> chi tiết (BigInt thành chuỗi, lookup kèm isActive); không có hoặc ngoài phạm vi -> 404', async () => {
    const e = build();
    e.customer.findFirst.mockResolvedValue(row({ revenueVnd: 9007199254740993n }));
    const r = await e.svc.get(ctx, ID);
    expect(r.revenueVnd).toBe('9007199254740993');
    expect(r.tier).toEqual({ code: 'POTENTIAL', label: 'POTENTIAL', isActive: true });
    e.customer.findFirst.mockResolvedValue(null);
    expect((await err(e.svc.get(ctx, ID))).code).toBe('CUSTOMER_NOT_FOUND');
    const o = build({ 'customer.read': 'OWN' });
    o.customer.findFirst.mockResolvedValue(row());
    expect((await err(o.svc.get(ctx, ID))).code).toBe('CUSTOMER_NOT_FOUND');
  });
});
