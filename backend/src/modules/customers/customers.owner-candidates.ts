import type { Prisma } from '../../generated/prisma/client';
import type { Actor, Scope } from '../../common/auth/actor';

// PR 7 (D15): danh sách ứng viên chủ sở hữu cho ô "Nhân viên phụ trách" của biểu mẫu khách hàng. KHÔNG dùng quyền hệ thống employee.read
// (ma trận V2 chỉ crm_admin có); dùng phạm vi RỘNG NHẤT của customer.create / customer.update: ALL => mọi nhân viên; DEPARTMENT => cùng
// phòng ban; OWN => chỉ chính mình. Chỉ nhân viên ACTIVE chưa xoá mềm; chỉ trả id/code/fullName/departmentCode (không email/điện thoại).
// Không phân trang (số nhân viên nhỏ), chặn 500 dòng để không bao giờ trả quá lớn.

export const OWNER_CANDIDATES_MAX = 500;
const RANK: Record<Scope, number> = { OWN: 1, DEPARTMENT: 2, ALL: 3 };

export function widestScope(a: Scope | null, b: Scope | null): Scope | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

// Phạm vi hiệu lực cho người thao tác: DEPARTMENT mà không có phòng ban => chỉ chính mình (fail-closed).
export function effectiveCandidateScope(actor: Actor, scope: Scope): Scope {
  return scope === 'DEPARTMENT' && !actor.departmentId ? 'OWN' : scope;
}

export function candidateWhere(actor: Actor, scope: Scope): Prisma.EmployeeWhereInput {
  const base: Prisma.EmployeeWhereInput = { status: 'ACTIVE', deletedAt: null };
  switch (effectiveCandidateScope(actor, scope)) {
    case 'ALL': return base;
    case 'DEPARTMENT': return { ...base, departmentId: actor.departmentId };
    default: return { ...base, id: actor.employeeId };
  }
}

export interface OwnerCandidate { id: string; code: string; fullName: string; departmentCode: string | null }
export interface OwnerCandidatesResult { scope: Scope; items: OwnerCandidate[] }

export async function listOwnerCandidates(db: Pick<Prisma.TransactionClient, 'employee'>, actor: Actor, scope: Scope): Promise<OwnerCandidatesResult> {
  const eff = effectiveCandidateScope(actor, scope);
  const rows = await db.employee.findMany({
    where: candidateWhere(actor, scope),
    select: { id: true, code: true, fullName: true, department: { select: { code: true } } },
    orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
    take: OWNER_CANDIDATES_MAX,
  });
  return { scope: eff, items: rows.map((r) => ({ id: r.id, code: r.code, fullName: r.fullName, departmentCode: r.department ? r.department.code : null })) };
}
