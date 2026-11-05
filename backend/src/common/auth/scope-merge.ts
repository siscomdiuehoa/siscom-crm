import type { Prisma } from '../../generated/prisma/client';
import type { Permission, Scope } from './actor';

// B3 A5 (docs/B3_ACTIVITIES_DESIGN.md §5 "Cách tính phạm vi của người khác"): MỘT hàm thuần gộp quyền từ vai trò, dùng chung cho
//   - SessionActorProvider: người đang đăng nhập (đọc qua pool auth);
//   - effectiveAccessOf: người KHÁC (vd người được giao việc) đọc qua pool nghiệp vụ (siscom_app SELECT được employee/employee_role/role/
//     role_permission/permission theo APP_GRANTS_V4).
// Quy tắc: hợp quyền của mọi vai trò ĐÃ XÁC NHẬN, phạm vi rộng nhất thắng (ALL > DEPARTMENT > OWN); mã/phạm vi lạ bị bỏ qua (fail-closed).
// Kết quả của effectiveAccessOf CHỈ dùng làm điều kiện THU HẸP (AND) — không bao giờ gán vào RequestCtx.actor (không leo thang).

export const RANK: Record<Scope, number> = { OWN: 1, DEPARTMENT: 2, ALL: 3 };
const SCOPES = new Set<string>(['ALL', 'DEPARTMENT', 'OWN']);
export const KNOWN: ReadonlySet<string> = new Set<Permission>(['customer.read', 'customer.create', 'customer.update', 'customer.delete', 'customer.restore', 'contact.read', 'contact.create', 'lookup.read',
  // B3 A4
  'activity.read', 'activity.create', 'activity.create_tech', 'activity.update', 'activity.update_own', 'activity.assign', 'activity.delete', 'activity.assign_external', 'activity.transfer_request']);

export interface RoleGrantRow {
  role: { code: string; isConfirmed: boolean; permissions: ReadonlyArray<{ scope: unknown; permission: { code: string } }> };
}
export const ROLE_GRANTS_SELECT = {
  role: { select: { code: true, isConfirmed: true, permissions: { select: { scope: true, permission: { select: { code: true } } } } } },
} as const;

export function mergeScopes(rows: readonly RoleGrantRow[]): { roles: string[]; scopes: Readonly<Partial<Record<Permission, Scope>>> } {
  const scopes: Partial<Record<Permission, Scope>> = {};
  const roles: string[] = [];
  for (const er of rows) {
    if (!er.role.isConfirmed) continue;
    roles.push(er.role.code);
    for (const rp of er.role.permissions) {
      const code = rp.permission.code;
      const sc = String(rp.scope);
      if (!KNOWN.has(code) || !SCOPES.has(sc)) continue;
      const p = code as Permission; const next = sc as Scope; const cur = scopes[p];
      if (cur === undefined || RANK[next] > RANK[cur]) scopes[p] = next;
    }
  }
  return { roles: roles.sort(), scopes: Object.freeze(scopes) };
}

export interface EmployeeAccess {
  readonly id: string;
  readonly departmentId: string | null;
  // ACTIVE và chưa xoá mềm. (Pool nghiệp vụ không đọc employee_credential: credential bị khoá vẫn có thể "active" ở đây — thiết kế §5 chấp nhận.)
  readonly active: boolean;
  readonly scopes: Readonly<Partial<Record<Permission, Scope>>>;
}

export async function effectiveAccessOf(db: Pick<Prisma.TransactionClient, 'employee'>, ids: readonly string[]): Promise<Map<string, EmployeeAccess>> {
  const out = new Map<string, EmployeeAccess>();
  if (ids.length === 0) return out;
  const rows = await db.employee.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, departmentId: true, status: true, deletedAt: true, roles: { select: ROLE_GRANTS_SELECT } },
  });
  for (const e of rows) {
    out.set(e.id, { id: e.id, departmentId: e.departmentId, active: e.status === 'ACTIVE' && e.deletedAt === null, scopes: mergeScopes(e.roles).scopes });
  }
  return out;
}
