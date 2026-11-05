import type { Actor, Permission, Scope } from '../../common/auth/actor';
import type { EmployeeAccess } from '../../common/auth/scope-merge';
import { DomainException } from '../../common/errors/domain.exception';
import { assigneeLost, hasTechAuthority, planAssignment, readsByScope, scopeReadWhere, taskAccessWhere } from './activities.access';

// B3 A6 — unit cho ActivityAccessPolicy (hàm thuần): quy tắc giao nội bộ/ngoài phạm vi, cờ assigneeLostAccess, vị từ đọc.
type Scopes = Partial<Record<Permission, Scope>>;
const SALES: Scopes = { 'customer.read': 'OWN', 'activity.read': 'OWN', 'activity.assign': 'OWN', 'activity.assign_external': 'OWN', 'activity.update': 'OWN' };
const TECH: Scopes = { 'customer.read': 'DEPARTMENT', 'activity.read': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT', 'activity.transfer_request': 'DEPARTMENT' };
const ACCT: Scopes = { 'customer.read': 'ALL', 'activity.read': 'ALL' };
const sales: Actor = { employeeId: 'e-sales', departmentId: 'KD' };
const of = (s: Scopes) => (p: Permission) => s[p] ?? null;
const emp = (id: string, departmentId: string | null, scopes: Scopes, active = true): EmployeeAccess => ({ id, departmentId, active, scopes });
const ownSales = { ownerId: 'e-sales', ownerDepartmentId: 'KD' };
const code = (fn: () => unknown): string => { try { fn(); return 'OK'; } catch (e) { return e instanceof DomainException ? e.code : 'THROW'; } };

describe('planAssignment (§5, §5.4)', () => {
  const techKD = emp('t-kd', 'KD', TECH); const techKT = emp('t-kt', 'KT', TECH); const acctKT = emp('a-kt', 'KT', ACCT);
  it('nội bộ: người nhận cùng phòng đọc được khách => INTERNAL', () => {
    expect(planAssignment(sales, of(SALES), ownSales, techKD, { external: false, openTask: true })).toBe('INTERNAL');
  });
  it('không xin external: giữ quy tắc A5 (khác phòng => INVALID; cùng phòng nhưng không đọc được => NO_ACCESS)', () => {
    expect(code(() => planAssignment(sales, of(SALES), ownSales, techKT, { external: false, openTask: true }))).toBe('ACTIVITY_ASSIGNEE_INVALID');
    expect(code(() => planAssignment(sales, of(SALES), ownSales, emp('x', 'KD', {}), { external: false, openTask: true }))).toBe('ACTIVITY_ASSIGNEE_NO_ACCESS');
  });
  it('external: kỹ thuật phòng khác có update_own, TASK OPEN => EXTERNAL', () => {
    expect(planAssignment(sales, of(SALES), ownSales, techKT, { external: true, openTask: true })).toBe('EXTERNAL');
  });
  it('external: không phải TASK OPEN, hoặc người nhận thiếu update_own => 400 EXTERNAL_NOT_ALLOWED', () => {
    expect(code(() => planAssignment(sales, of(SALES), ownSales, techKT, { external: true, openTask: false }))).toBe('ACTIVITY_EXTERNAL_NOT_ALLOWED');
    expect(code(() => planAssignment(sales, of(SALES), ownSales, emp('k', 'KT', { 'customer.read': 'ALL' }), { external: true, openTask: true }))).toBe('ACTIVITY_EXTERNAL_NOT_ALLOWED');
  });
  it('external: người giao thiếu assign_external => 403; thiếu assign => 403; người nhận nghỉ việc => INVALID', () => {
    const noExt = { ...SALES }; delete noExt['activity.assign_external'];
    expect(code(() => planAssignment(sales, of(noExt), ownSales, techKT, { external: true, openTask: true }))).toBe('FORBIDDEN');
    expect(code(() => planAssignment(sales, of(TECH), ownSales, techKD, { external: false, openTask: true }))).toBe('FORBIDDEN');
    expect(code(() => planAssignment(sales, of(SALES), ownSales, emp('t', 'KT', TECH, false), { external: true, openTask: true }))).toBe('ACTIVITY_ASSIGNEE_INVALID');
  });
  it('external nhưng người nhận ĐỌC ĐƯỢC khách => quy tắc nội bộ (kế toán ALL ở phòng khác => INVALID với người giao OWN)', () => {
    expect(code(() => planAssignment(sales, of(SALES), ownSales, acctKT, { external: true, openTask: true }))).toBe('ACTIVITY_ASSIGNEE_INVALID');
  });
});

describe('assigneeLost (§5 TOCTOU, §5.4)', () => {
  const techKD = emp('t', 'KD', TECH);
  it('chỉ cho việc OPEN có người phụ trách', () => {
    expect(assigneeLost('DONE', 't', ownSales, undefined, false)).toBe(false);
    expect(assigneeLost('OPEN', null, ownSales, undefined, false)).toBe(false);
  });
  it('còn đọc được khách => false; không đọc được + quyền theo việc còn hiệu lực + update_own => false', () => {
    expect(assigneeLost('OPEN', 't', ownSales, techKD, false)).toBe(false);
    expect(assigneeLost('OPEN', 't', { ownerId: 'o', ownerDepartmentId: 'KT2' }, techKD, true)).toBe(false);
  });
  it('không đọc được + (không còn quyền theo việc | mất update_own | nghỉ việc) => true', () => {
    const other = { ownerId: 'o', ownerDepartmentId: 'KT2' };
    expect(assigneeLost('OPEN', 't', other, techKD, false)).toBe(true);
    expect(assigneeLost('OPEN', 't', other, emp('t', 'KD', { 'customer.read': 'DEPARTMENT', 'activity.read': 'DEPARTMENT' }), true)).toBe(true);
    expect(assigneeLost('OPEN', 't', ownSales, emp('t', 'KD', TECH, false), false)).toBe(true);
  });
});

describe('vị từ đọc', () => {
  it('readsByScope cần CẢ customer.read lẫn activity.read trong phạm vi', () => {
    expect(readsByScope(sales, of(SALES), ownSales)).toBe(true);
    expect(readsByScope(sales, of({ 'customer.read': 'ALL' }), ownSales)).toBe(false);
  });
  it('scopeReadWhere fail-closed: phạm vi DEPARTMENT mà người gọi không có phòng => không khớp dòng nào', () => {
    const w = scopeReadWhere({ employeeId: 'x', departmentId: null }, of(TECH));
    expect(JSON.stringify(w)).toContain('"in":[]');
  });
  it('taskAccessWhere chỉ có khi người gọi HIỆN có activity.update_own', () => {
    expect(taskAccessWhere(sales, of(SALES), new Date())).toBeNull();
    expect(taskAccessWhere(sales, of(TECH), new Date())).not.toBeNull();
  });
  it('hasTechAuthority = ACTIVE + update_own', () => {
    expect(hasTechAuthority(emp('t', 'KT', TECH))).toBe(true);
    expect(hasTechAuthority(emp('t', 'KT', TECH, false))).toBe(false);
    expect(hasTechAuthority(emp('t', 'KT', ACCT))).toBe(false);
    expect(hasTechAuthority(undefined)).toBe(false);
  });
});
