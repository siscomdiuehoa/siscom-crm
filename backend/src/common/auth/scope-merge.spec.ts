// B3 A5 — mergeScopes: một hàm thuần dùng chung cho SessionActorProvider (người đang đăng nhập) và effectiveAccessOf (người KHÁC, ví dụ
// người được giao việc). Hai nơi phải ra cùng kết quả cho cùng dữ liệu vai trò (docs/B3_ACTIVITIES_DESIGN.md §5 "Cách tính phạm vi của người khác").
import { effectiveAccessOf, KNOWN, mergeScopes, RoleGrantRow } from './scope-merge';

const role = (code: string, isConfirmed: boolean, perms: Array<[string, string]>): RoleGrantRow =>
  ({ role: { code, isConfirmed, permissions: perms.map(([c, s]) => ({ scope: s, permission: { code: c } })) } });

describe('mergeScopes', () => {
  it('không vai trò => không quyền nào (fail-closed)', () => {
    expect(mergeScopes([])).toEqual({ roles: [], scopes: {} });
  });
  it('nhiều vai trò: phạm vi RỘNG NHẤT thắng (ALL > DEPARTMENT > OWN), roles sắp xếp', () => {
    const r = mergeScopes([
      role('sales', true, [['customer.read', 'OWN'], ['activity.read', 'OWN']]),
      role('technician', true, [['customer.read', 'DEPARTMENT'], ['activity.update_own', 'DEPARTMENT']]),
      role('accountant', true, [['activity.read', 'ALL']]),
    ]);
    expect(r.roles).toEqual(['accountant', 'sales', 'technician']);
    expect(r.scopes).toEqual({ 'customer.read': 'DEPARTMENT', 'activity.read': 'ALL', 'activity.update_own': 'DEPARTMENT' });
  });
  it('vai trò CHƯA xác nhận không cấp quyền và không xuất hiện trong roles', () => {
    expect(mergeScopes([role('draft', false, [['customer.read', 'ALL']])])).toEqual({ roles: [], scopes: {} });
  });
  it('mã quyền lạ (không thuộc KNOWN) và phạm vi lạ bị bỏ qua', () => {
    const r = mergeScopes([role('x', true, [['employee.manage', 'ALL'], ['customer.read', 'GLOBAL'], ['activity.read', 'OWN']])]);
    expect(r.scopes).toEqual({ 'activity.read': 'OWN' });
  });
  it('KNOWN gồm 8 quyền B1 + 9 quyền activity.* (A4)', () => {
    expect(KNOWN.size).toBe(17);
    expect(KNOWN.has('activity.assign_external')).toBe(true);
  });
  it('kết quả bị đóng băng (không ai sửa được phạm vi sau khi tính)', () => {
    const r = mergeScopes([role('sales', true, [['customer.read', 'OWN']])]);
    expect(Object.isFrozen(r.scopes)).toBe(true);
  });
});

describe('effectiveAccessOf (người khác, qua pool nghiệp vụ)', () => {
  const rows = [
    { id: 'e1', departmentId: 'd1', status: 'ACTIVE', deletedAt: null, roles: [role('technician', true, [['customer.read', 'DEPARTMENT'], ['activity.read', 'DEPARTMENT']])] },
    { id: 'e2', departmentId: 'd2', status: 'RESIGNED', deletedAt: null, roles: [role('sales', true, [['customer.read', 'OWN']])] },
    { id: 'e3', departmentId: null, status: 'ACTIVE', deletedAt: new Date(), roles: [] },
  ];
  const db = { employee: { findMany: jest.fn(async () => rows) } };
  it('trả phạm vi đã gộp + trạng thái hoạt động; nhân viên nghỉ việc / xoá mềm => active=false; id không tồn tại => không có trong Map', async () => {
    const m = await effectiveAccessOf(db as never, ['e1', 'e2', 'e3', 'khong-co']);
    expect(m.get('e1')).toEqual({ id: 'e1', departmentId: 'd1', active: true, scopes: { 'customer.read': 'DEPARTMENT', 'activity.read': 'DEPARTMENT' } });
    expect(m.get('e2')?.active).toBe(false);
    expect(m.get('e3')?.active).toBe(false);
    expect(m.has('khong-co')).toBe(false);
  });
  it('danh sách rỗng => không truy vấn DB', async () => {
    db.employee.findMany.mockClear();
    expect((await effectiveAccessOf(db as never, [])).size).toBe(0);
    expect(db.employee.findMany).not.toHaveBeenCalled();
  });
});
