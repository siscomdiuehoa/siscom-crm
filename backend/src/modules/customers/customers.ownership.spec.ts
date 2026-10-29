import type { Actor } from '../../common/auth/actor';
import { DomainException } from '../../common/errors/domain.exception';
import { assertOwnerInScope, closeOwnerAssignment, loadOwnerCandidate, openOwnerAssignment, ownerIdForCreate, ownerIdForUpdate } from './customers.ownership';

const me: Actor = { employeeId: 'e1', departmentId: 'd1' };
const noDept: Actor = { employeeId: 'e9', departmentId: null };
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof DomainException) return e.code; throw e; } return 'OK'; };

describe('ownerIdForCreate (D14)', () => {
  it('ALL: không gửi => không chủ; gửi => giữ nguyên (kiểm tồn tại sau)', () => {
    expect(ownerIdForCreate(me, 'ALL', undefined)).toBeNull();
    expect(ownerIdForCreate(me, 'ALL', null)).toBeNull();
    expect(ownerIdForCreate(me, 'ALL', 'e2')).toBe('e2');
  });
  it('OWN: không gửi hoặc chính mình => chính mình; người khác => 403', () => {
    expect(ownerIdForCreate(me, 'OWN', undefined)).toBe('e1');
    expect(ownerIdForCreate(me, 'OWN', 'e1')).toBe('e1');
    expect(codeOf(() => ownerIdForCreate(me, 'OWN', 'e2'))).toBe('FORBIDDEN');
  });
  it('DEPARTMENT: không gửi => chính mình (phải có phòng ban); gửi => để kiểm cùng phòng sau', () => {
    expect(ownerIdForCreate(me, 'DEPARTMENT', undefined)).toBe('e1');
    expect(ownerIdForCreate(me, 'DEPARTMENT', 'e2')).toBe('e2');
    expect(codeOf(() => ownerIdForCreate(noDept, 'DEPARTMENT', undefined))).toBe('FORBIDDEN');
  });
});

describe('ownerIdForUpdate (§3.7)', () => {
  it('không gửi hoặc bằng hiện tại => không đổi', () => {
    expect(ownerIdForUpdate(me, 'ALL', 'e2', undefined)).toBeUndefined();
    expect(ownerIdForUpdate(me, 'ALL', 'e2', 'e2')).toBeUndefined();
    expect(ownerIdForUpdate(me, 'ALL', null, null)).toBeUndefined();
  });
  it('ALL: đổi sang người khác hoặc xoá chủ', () => {
    expect(ownerIdForUpdate(me, 'ALL', 'e2', 'e3')).toBe('e3');
    expect(ownerIdForUpdate(me, 'ALL', 'e2', null)).toBeNull();
  });
  it('OWN: chỉ chính mình; người khác/null => 403. DEPARTMENT: null => 403', () => {
    expect(ownerIdForUpdate(me, 'OWN', 'e2', 'e1')).toBe('e1');
    expect(codeOf(() => ownerIdForUpdate(me, 'OWN', 'e1', 'e2'))).toBe('FORBIDDEN');
    expect(codeOf(() => ownerIdForUpdate(me, 'OWN', 'e1', null))).toBe('FORBIDDEN');
    expect(codeOf(() => ownerIdForUpdate(me, 'DEPARTMENT', 'e1', null))).toBe('FORBIDDEN');
    expect(ownerIdForUpdate(me, 'DEPARTMENT', 'e1', 'e2')).toBe('e2');
  });
});

describe('assertOwnerInScope', () => {
  it('ALL tuỳ ý; OWN chỉ mình; DEPARTMENT cùng phòng (người thao tác không có phòng => 403)', () => {
    expect(codeOf(() => assertOwnerInScope(me, 'ALL', { id: 'e2', departmentId: 'd9' }))).toBe('OK');
    expect(codeOf(() => assertOwnerInScope(me, 'OWN', { id: 'e1', departmentId: 'd1' }))).toBe('OK');
    expect(codeOf(() => assertOwnerInScope(me, 'OWN', { id: 'e2', departmentId: 'd1' }))).toBe('FORBIDDEN');
    expect(codeOf(() => assertOwnerInScope(me, 'DEPARTMENT', { id: 'e2', departmentId: 'd1' }))).toBe('OK');
    expect(codeOf(() => assertOwnerInScope(me, 'DEPARTMENT', { id: 'e2', departmentId: 'd2' }))).toBe('FORBIDDEN');
    expect(codeOf(() => assertOwnerInScope(me, 'DEPARTMENT', { id: 'e2', departmentId: null }))).toBe('FORBIDDEN');
    expect(codeOf(() => assertOwnerInScope(noDept, 'DEPARTMENT', { id: 'e2', departmentId: null }))).toBe('FORBIDDEN');
  });
});

describe('thao tác DB', () => {
  it('loadOwnerCandidate: chỉ nhân viên ACTIVE chưa xoá mềm; không có => OWNER_INVALID', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 'e2', departmentId: 'd1' }).mockResolvedValueOnce(null);
    const tx = { employee: { findFirst } } as never;
    expect(await loadOwnerCandidate(tx, 'e2')).toEqual({ id: 'e2', departmentId: 'd1' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'e2', deletedAt: null, status: 'ACTIVE' });
    await expect(loadOwnerCandidate(tx, 'e3')).rejects.toMatchObject({ code: 'OWNER_INVALID', status: 400 });
  });
  it('closeOwnerAssignment dùng giờ DB qua $executeRaw; openOwnerAssignment ghi OWNER + assigned_by + reason', async () => {
    const $executeRaw = jest.fn().mockResolvedValue(1);
    const create = jest.fn().mockResolvedValue({ id: 'as1' });
    expect(await closeOwnerAssignment({ $executeRaw } as never, 'c1')).toBe(1);
    expect($executeRaw).toHaveBeenCalledTimes(1);
    await openOwnerAssignment({ customerAssignment: { create } } as never, { customerId: 'c1', employeeId: 'e2', assignedById: 'e1', reason: 'bàn giao' });
    expect(create.mock.calls[0][0].data).toEqual({ customerId: 'c1', employeeId: 'e2', role: 'OWNER', assignedById: 'e1', reason: 'bàn giao' });
  });
});
