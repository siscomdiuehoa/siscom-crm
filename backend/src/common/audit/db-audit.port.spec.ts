import { Logger } from '@nestjs/common';
import type { AuditEntry } from './audit.port';
import { AuditWriteError, AUDIT_REDACTED_TEXT, buildAuditRow, DbAuditPort } from './db-audit.port';

const UID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const base = (): AuditEntry => ({
  action: 'customer.update', entityType: 'customer', entityId: UID, entityCode: 'KH-00001', summary: 'Cập nhật khách hàng KH-00001',
  actorEmployeeId: ACTOR, requestId: 'req-12345678', changes: { name: ['A', 'B'], phone: AUDIT_REDACTED_TEXT },
});
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } throw new Error('mong đợi lỗi'); };

describe('buildAuditRow', () => {
  it('ánh xạ đủ trường; actor_type USER; actor_role null', () => {
    expect(buildAuditRow(base())).toEqual({
      actorType: 'USER', actorId: ACTOR, actorRole: null, action: 'customer.update', entityType: 'customer', entityId: UID, entityCode: 'KH-00001',
      summary: 'Cập nhật khách hàng KH-00001', changes: { name: ['A', 'B'], phone: AUDIT_REDACTED_TEXT }, requestId: 'req-12345678',
    });
  });
  it('không có changes => không gửi trường changes', () => {
    const e = base();
    delete e.changes;
    expect('changes' in buildAuditRow(e)).toBe(false);
  });
  it('requestId: thiếu => null; dài hơn 64 => cắt còn 64', () => {
    expect(buildAuditRow({ ...base(), requestId: undefined }).requestId).toBeNull();
    expect(buildAuditRow({ ...base(), requestId: 'x'.repeat(100) }).requestId).toHaveLength(64);
  });
  it.each(['Customer.create', '1abc', 'a b', '', 'x'.repeat(41)])('action sai định dạng bị từ chối: %p', (action) => {
    expect(thrown(() => buildAuditRow({ ...base(), action }))).toMatchObject({ name: 'AuditWriteError', reason: 'INVALID_ENTRY', field: 'action' });
  });
  it('entityType, entityId, actorEmployeeId sai bị từ chối', () => {
    expect(thrown(() => buildAuditRow({ ...base(), entityType: 'Customer' }))).toMatchObject({ field: 'entityType' });
    expect(thrown(() => buildAuditRow({ ...base(), entityId: 'khong-phai-uuid' }))).toMatchObject({ field: 'entityId' });
    expect(thrown(() => buildAuditRow({ ...base(), actorEmployeeId: '' }))).toMatchObject({ field: 'actorEmployeeId' });
  });
  it('entityCode > 40 hoặc rỗng; summary rỗng hoặc > 1000 bị từ chối', () => {
    expect(thrown(() => buildAuditRow({ ...base(), entityCode: 'K'.repeat(41) }))).toMatchObject({ field: 'entityCode' });
    expect(thrown(() => buildAuditRow({ ...base(), entityCode: '' }))).toMatchObject({ field: 'entityCode' });
    expect(thrown(() => buildAuditRow({ ...base(), summary: '   ' }))).toMatchObject({ field: 'summary' });
    expect(thrown(() => buildAuditRow({ ...base(), summary: 's'.repeat(1001) }))).toMatchObject({ field: 'summary' });
  });
  it('changes phải là object thường và không quá 32 KB', () => {
    expect(thrown(() => buildAuditRow({ ...base(), changes: [] as unknown as Record<string, unknown> }))).toMatchObject({ field: 'changes' });
    expect(thrown(() => buildAuditRow({ ...base(), changes: null as unknown as Record<string, unknown> }))).toMatchObject({ field: 'changes' });
    expect(thrown(() => buildAuditRow({ ...base(), changes: { big: 'x'.repeat(40000) } }))).toMatchObject({ field: 'changes' });
  });
  it('trường nhạy cảm chỉ được ghi "(đã thay đổi)": giá trị thô bị từ chối và lỗi không chứa giá trị', () => {
    const e = thrown(() => buildAuditRow({ ...base(), changes: { phone: '0903123456' } })) as AuditWriteError;
    expect(e).toBeInstanceOf(AuditWriteError);
    expect(e.reason).toBe('UNREDACTED');
    expect(e.message).toContain('changes.phone');
    expect(e.message).not.toContain('0903123456');
    for (const k of ['phoneE164', 'email', 'address', 'note', 'fullName', 'title']) {
      expect(thrown(() => buildAuditRow({ ...base(), changes: { [k]: [null, 'giá trị thô'] } }))).toMatchObject({ reason: 'UNREDACTED' });
    }
  });
  it('khoá nhạy cảm lồng bên trong cũng bị kiểm', () => {
    expect(thrown(() => buildAuditRow({ ...base(), changes: { contact: { email: 'a@b.vn' } } }))).toMatchObject({ reason: 'UNREDACTED' });
    expect(thrown(() => buildAuditRow({ ...base(), changes: { list: [{ note: 'x' }] } }))).toMatchObject({ reason: 'UNREDACTED' });
    expect(() => buildAuditRow({ ...base(), changes: { contact: { email: AUDIT_REDACTED_TEXT } } })).not.toThrow();
  });
  it('chuẩn hoá JSON: bỏ undefined, Date thành chuỗi', () => {
    const when = new Date('2026-10-18T10:00:00.000Z');
    const row = buildAuditRow({ ...base(), changes: { a: undefined, when, tags: ['x'] } });
    expect(row.changes).toEqual({ when: '2026-10-18T10:00:00.000Z', tags: ['x'] });
  });
});

describe('DbAuditPort.record', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => { errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
  afterEach(() => errorSpy.mockRestore());

  it('ghi đúng một dòng bằng chính tx được truyền vào', async () => {
    const create = jest.fn().mockResolvedValue({});
    await new DbAuditPort().record({ auditLog: { create } }, base());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: buildAuditRow(base()) });
  });
  it('tx không có auditLog.create => NOT_A_TRANSACTION', async () => {
    await expect(new DbAuditPort().record({}, base())).rejects.toMatchObject({ name: 'AuditWriteError', reason: 'NOT_A_TRANSACTION' });
    await expect(new DbAuditPort().record(null, base())).rejects.toMatchObject({ reason: 'NOT_A_TRANSACTION' });
  });
  it('dữ liệu sai => ném TRƯỚC khi ghi', async () => {
    const create = jest.fn();
    await expect(new DbAuditPort().record({ auditLog: { create } }, { ...base(), changes: { note: 'thô' } })).rejects.toMatchObject({ reason: 'UNREDACTED' });
    expect(create).not.toHaveBeenCalled();
  });
  it('lỗi DB => AuditWriteError WRITE_FAILED; lỗi và log không chứa thông điệp gốc hay nội dung', async () => {
    const create = jest.fn().mockRejectedValue(Object.assign(new Error('duplicate key value (matkhau=hunter2)'), { code: '23503' }));
    const err = await new DbAuditPort().record({ auditLog: { create } }, base()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuditWriteError);
    expect(err).toMatchObject({ reason: 'WRITE_FAILED' });
    expect(String((err as Error).message)).not.toMatch(/hunter2|duplicate/);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0]);
    expect(logged).toContain('action=customer.update');
    expect(logged).toContain('sqlstate=23503');
    expect(logged).not.toMatch(/hunter2|KH-00001|Cập nhật/);
  });
});
