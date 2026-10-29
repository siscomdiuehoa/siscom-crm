import type { Prisma } from '../../generated/prisma/client';
import type { Actor, Scope } from '../../common/auth/actor';
import { customerErrors } from './customers.errors';

// B1.2.3-B3 (N1 = B, hợp đồng §3.5/§3.7): chủ sở hữu (customer.owner_id) và phân công OWNER (customer_assignment) ghi CÙNG transaction.
// Hàm thuần + 3 thao tác DB nhỏ, không log, không bí mật. Không có endpoint phân công riêng.
// D14 (xác nhận trên Issue #8): khi TẠO với phạm vi OWN/DEPARTMENT mà không gửi ownerId => chủ sở hữu mặc định = chính người tạo
// (để trống sẽ sinh khách mà người tạo không xem được — đúng lỗi D12). ALL không gửi => không có chủ sở hữu.

export type OwnerTx = Pick<Prisma.TransactionClient, 'employee' | 'customerAssignment' | '$executeRaw'>;
export interface OwnerCandidate { id: string; departmentId: string | null }

// Chủ sở hữu mong muốn khi TẠO. requested: undefined/null = không gửi. Trả về id ứng viên (chưa kiểm tồn tại) hoặc null (không có chủ).
// OWN: gửi khác mình => 403. DEPARTMENT: người tạo không có phòng ban thì không thể tự làm chủ => 403 (fail-closed).
export function ownerIdForCreate(actor: Actor, scope: Scope, requested: string | null | undefined): string | null {
  switch (scope) {
    case 'ALL': return requested ?? null;
    case 'OWN':
      if (requested && requested !== actor.employeeId) throw customerErrors.forbidden('Phạm vi OWN chỉ được đặt chủ sở hữu là chính mình.');
      return actor.employeeId;
    case 'DEPARTMENT':
      if (!requested) {
        if (!actor.departmentId) throw customerErrors.forbidden('Người tạo không thuộc phòng ban nào nên không thể làm chủ sở hữu.');
        return actor.employeeId;
      }
      return requested;
    default: throw customerErrors.forbidden();
  }
}

// Có đổi chủ sở hữu khi SỬA không? requested undefined = không gửi; null = xoá chủ; '' đã được DTO/blank() đưa về null.
// Trả về undefined (không đổi) hoặc id mới (string | null). OWN: chỉ chính mình (người khác/null => 403). DEPARTMENT: null => 403.
export function ownerIdForUpdate(actor: Actor, scope: Scope, currentOwnerId: string | null, requested: string | null | undefined): string | null | undefined {
  if (requested === undefined || requested === currentOwnerId) return undefined;
  if (scope === 'OWN' && requested !== actor.employeeId) throw customerErrors.forbidden('Phạm vi OWN chỉ được đặt chủ sở hữu là chính mình.');
  if (scope === 'DEPARTMENT' && requested === null) throw customerErrors.forbidden('Phạm vi DEPARTMENT không được bỏ trống chủ sở hữu.');
  return requested;
}

// Ứng viên phải cùng phạm vi với người thao tác (sau khi đã tải từ DB). ALL: tuỳ ý.
export function assertOwnerInScope(actor: Actor, scope: Scope, cand: OwnerCandidate): void {
  if (scope === 'ALL') return;
  if (scope === 'OWN') { if (cand.id !== actor.employeeId) throw customerErrors.forbidden('Phạm vi OWN chỉ được đặt chủ sở hữu là chính mình.'); return; }
  if (scope === 'DEPARTMENT') { if (!actor.departmentId || cand.departmentId !== actor.departmentId) throw customerErrors.forbidden('Phạm vi DEPARTMENT chỉ được đặt chủ sở hữu cùng phòng ban.'); return; }
  throw customerErrors.forbidden();
}

// Nhân viên tồn tại, ACTIVE, chưa xoá mềm; nếu không => 400 OWNER_INVALID (không lộ lý do cụ thể).
export async function loadOwnerCandidate(tx: Pick<OwnerTx, 'employee'>, id: string): Promise<OwnerCandidate> {
  const e = await tx.employee.findFirst({ where: { id, deletedAt: null, status: 'ACTIVE' }, select: { id: true, departmentId: true } });
  if (!e) throw customerErrors.ownerInvalid();
  return e;
}

// Đóng phân công OWNER đang hiệu lực (ended_at = giờ DB). Trả về số dòng đã đóng (0 hoặc 1 nhờ uq_assignment_owner_active).
export async function closeOwnerAssignment(tx: Pick<OwnerTx, '$executeRaw'>, customerId: string): Promise<number> {
  return tx.$executeRaw`UPDATE customer_assignment SET ended_at = now() WHERE customer_id = ${customerId}::uuid AND role = 'OWNER' AND ended_at IS NULL`;
}

// Mở phân công OWNER mới cho khách (sau khi đã đóng phân công cũ trong cùng transaction).
export async function openOwnerAssignment(tx: Pick<OwnerTx, 'customerAssignment'>, p: { customerId: string; employeeId: string; assignedById: string; reason: string | null }): Promise<void> {
  await tx.customerAssignment.create({ data: { customerId: p.customerId, employeeId: p.employeeId, role: 'OWNER', assignedById: p.assignedById, reason: p.reason }, select: { id: true } });
}
