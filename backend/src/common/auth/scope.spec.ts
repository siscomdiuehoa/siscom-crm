import { inScope } from './scope';

const me = { employeeId: 'e1', departmentId: 'd1' };
const noDept = { employeeId: 'e1', departmentId: null };

describe('inScope (fail-closed)', () => {
  it('ALL luôn đúng', () => expect(inScope(me, 'ALL', { ownerId: null, ownerDepartmentId: null })).toBe(true));
  it('OWN: chỉ khi chủ sở hữu là chính mình; khách không có chủ sở hữu -> sai', () => {
    expect(inScope(me, 'OWN', { ownerId: 'e1', ownerDepartmentId: null })).toBe(true);
    expect(inScope(me, 'OWN', { ownerId: 'e2', ownerDepartmentId: 'd1' })).toBe(false);
    expect(inScope(me, 'OWN', { ownerId: null, ownerDepartmentId: null })).toBe(false);
  });
  it('DEPARTMENT: cùng phòng ban; không có phòng ban -> sai', () => {
    expect(inScope(me, 'DEPARTMENT', { ownerId: 'e2', ownerDepartmentId: 'd1' })).toBe(true);
    expect(inScope(me, 'DEPARTMENT', { ownerId: 'e2', ownerDepartmentId: 'd2' })).toBe(false);
    expect(inScope(me, 'DEPARTMENT', { ownerId: null, ownerDepartmentId: null })).toBe(false);
    expect(inScope(noDept, 'DEPARTMENT', { ownerId: 'e2', ownerDepartmentId: null })).toBe(false);
  });
  it('không có quyền (null) -> sai', () => expect(inScope(me, null, { ownerId: 'e1', ownerDepartmentId: 'd1' })).toBe(false));
});
