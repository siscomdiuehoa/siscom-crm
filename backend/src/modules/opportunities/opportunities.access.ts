import type { Prisma } from '../../generated/prisma/client';
import type { Actor, Permission, Scope } from '../../common/auth/actor';
import type { EmployeeAccess } from '../../common/auth/scope-merge';
import { opportunityErrors } from './opportunities.errors';

// Sales S5 — OpportunityAccessPolicy (docs/SALES_DESIGN.md §5.4). Hàm THUẦN: service (S6–S9) chỉ biết MÃ QUYỀN + PHẠM VI HIỆU LỰC của người gọi
// (scopeOf = ActorProvider.scopeFor đã hợp nhất mọi vai trò đã xác nhận, tính lại mỗi request) — không có nhánh theo tên vai trò.
// Ngữ nghĩa phạm vi với CƠ HỘI (khác khách hàng): ALL = mọi cơ hội; OWN = theo người phụ trách CƠ HỘI (riêng ĐỌC và TẠO có thêm người phụ
// trách KHÁCH); DEPARTMENT = KHÔNG cấp ở đợt này => fail-closed (từ chối) cho tới khi có review riêng.
// Đường đọc theo VIỆC (§5.5(d)) cần truy vấn activity/activity_access => làm ở S9; ở đây chỉ có kiểu AccessPath và cổng mã read_assigned.

export type ScopeOf = (p: Permission) => Scope | null;
// Đường truy cập quyết định trường được trả (§5.4): FULL = mọi trường; TASK = bản kỹ thuật (không giá trị/xác suất/lịch sử/lý do thua/won_doc/COMMERCIAL).
export type AccessPath = 'FULL' | 'TASK';

// Phần của cơ hội mà vị từ cần. Service nạp đúng các cột này (kèm khách) rồi mới hỏi chính sách.
export interface OppRef {
  ownerId: string;
  deletedAt: Date | null;
  customer: { ownerId: string | null; deletedAt: Date | null };
}
export interface CustomerRef { ownerId: string | null; deletedAt: Date | null }

// Mọi vị từ TRỪ khôi phục: cơ hội VÀ khách đều chưa xoá mềm.
const live = (o: OppRef): boolean => o.deletedAt === null && o.customer.deletedAt === null;

const NONE: Prisma.OpportunityWhereInput = { id: { in: [] } };
const LIVE: Prisma.OpportunityWhereInput = { deletedAt: null, customer: { is: { deletedAt: null } } };

// ---------- ĐỌC — đường đầy đủ ----------
// opportunity.read: ALL; hoặc OWN và (người phụ trách cơ hội HOẶC người phụ trách khách [C4]).
export function readsFull(actor: Actor, scopeOf: ScopeOf, o: OppRef): boolean {
  if (!live(o)) return false;
  switch (scopeOf('opportunity.read')) {
    case 'ALL': return true;
    case 'OWN': return o.ownerId === actor.employeeId || (o.customer.ownerId !== null && o.customer.ownerId === actor.employeeId);
    default: return false;
  }
}
// Phần phạm vi của đường đầy đủ ở dạng Prisma (KHÔNG gồm điều kiện xoá mềm — dùng lại cho danh sách đã xoá). Fail-closed.
function fullScopeWhere(actor: Actor, scope: Scope | null): Prisma.OpportunityWhereInput {
  switch (scope) {
    case 'ALL': return {};
    case 'OWN': return { OR: [{ ownerId: actor.employeeId }, { customer: { is: { ownerId: actor.employeeId } } }] };
    default: return NONE;
  }
}
// Cùng vị từ với readsFull cho danh sách / đếm / tìm kiếm / kanban / báo cáo (§5.1: một hàm kiểm quyền cho mọi đường đọc).
export function fullReadWhere(actor: Actor, scopeOf: ScopeOf): Prisma.OpportunityWhereInput {
  return { AND: [LIVE, fullScopeWhere(actor, scopeOf('opportunity.read'))] };
}

// Người gọi có mã của đường theo việc đang hiệu lực (điều kiện CẦN; điều kiện đủ là vị từ §5.5(d), S9).
export const hasAssignedReadCode = (scopeOf: ScopeOf): boolean => scopeOf('opportunity.read_assigned') !== null;
// Đạt cả hai đường => đầy đủ; không đạt đường nào => null (404).
export function accessPath(full: boolean, task: boolean): AccessPath | null {
  return full ? 'FULL' : task ? 'TASK' : null;
}

// ---------- TẠO ----------
// opportunity.create tính theo KHÁCH: ALL; hoặc OWN và mình phụ trách khách. Không suy từ quyền ghi cơ hội.
export function allowsCreate(actor: Actor, scopeOf: ScopeOf, c: CustomerRef): boolean {
  if (c.deletedAt !== null) return false;
  switch (scopeOf('opportunity.create')) {
    case 'ALL': return true;
    case 'OWN': return c.ownerId !== null && c.ownerId === actor.employeeId;
    default: return false;
  }
}

// ---------- GHI trên cơ hội có sẵn ----------
// MỖI thao tác kiểm ĐÚNG mã của nó (PR234-R1-SEC-01): không suy move_stage / close / assign từ update.
//   update / move_stage / close (Tạm hoãn, đổi hạn, Tiếp tục, Thắng, Thua) / assign: ALL; hoặc OWN và mình phụ trách CƠ HỘI.
//   reopen / delete: chỉ ALL. (restore có đường riêng bên dưới.)
// Người phụ trách KHÁCH mà không phụ trách CƠ HỘI: không có quyền ghi nào.
export type OppWriteCode = 'opportunity.update' | 'opportunity.move_stage' | 'opportunity.close' | 'opportunity.assign' | 'opportunity.reopen' | 'opportunity.delete';
const ALL_ONLY: ReadonlySet<OppWriteCode> = new Set<OppWriteCode>(['opportunity.reopen', 'opportunity.delete']);
export function allowsWrite(actor: Actor, scopeOf: ScopeOf, code: OppWriteCode, o: OppRef): boolean {
  if (!live(o)) return false;
  const s = scopeOf(code);
  if (s === 'ALL') return true;
  if (ALL_ONLY.has(code)) return false;
  return s === 'OWN' && o.ownerId === actor.employeeId;
}
// Không thấy được (path = null) => 404; thấy được nhưng thiếu mã hoặc ngoài điều kiện => 403.
export function assertWrite(actor: Actor, scopeOf: ScopeOf, code: OppWriteCode, o: OppRef, path: AccessPath | null): void {
  if (path === null) throw opportunityErrors.notFound();
  if (!allowsWrite(actor, scopeOf, code, o)) throw opportunityErrors.forbidden();
}

// ---------- NGƯỜI NHẬN khi chuyển người phụ trách [O3] ----------
// Quyền của NGƯỜI CHUYỂN: allowsWrite(..., 'opportunity.assign', o). Hàm này chỉ xét NGƯỜI NHẬN (điều kiện thu hẹp, không cấp quyền cho ai).
//  1. Nhân viên ACTIVE (chưa xoá mềm) VÀ tài khoản dùng được — canSignIn lấy từ cổng auth (AssigneeEligibility), KHÔNG từ pool nghiệp vụ.
//  2. Quyền hiệu lực của người nhận có CẢ opportunity.read VÀ opportunity.update (bất kỳ phạm vi).
//  3. Cùng phòng với người phụ trách hiện tại, trừ khi người chuyển có opportunity.assign phạm vi ALL; phòng của một trong hai chưa xác định
//     => chỉ phạm vi ALL được chuyển.
//  4. KHÔNG yêu cầu người nhận có quyền trên chính cơ hội đó từ trước, KHÔNG yêu cầu đọc được khách.
// Lý do trả về chỉ dùng nội bộ (test, nhật ký máy chủ); client luôn nhận MỘT mã OPPORTUNITY_ASSIGNEE_INELIGIBLE.
export type AssigneeRefusal = 'INACTIVE' | 'CANNOT_SIGN_IN' | 'LACKS_PERMISSION' | 'OTHER_DEPARTMENT';
export function assigneeRefusal(
  scopeOf: ScopeOf,
  currentOwner: Pick<EmployeeAccess, 'departmentId'> | undefined,
  recipient: EmployeeAccess | undefined,
  canSignIn: boolean,
): AssigneeRefusal | null {
  if (!recipient || !recipient.active) return 'INACTIVE';
  if (canSignIn !== true) return 'CANNOT_SIGN_IN';
  if (!recipient.scopes['opportunity.read'] || !recipient.scopes['opportunity.update']) return 'LACKS_PERMISSION';
  if (scopeOf('opportunity.assign') !== 'ALL') {
    const from = currentOwner ? currentOwner.departmentId : null;
    if (from === null || recipient.departmentId === null || from !== recipient.departmentId) return 'OTHER_DEPARTMENT';
  }
  return null;
}
export function assertAssignee(scopeOf: ScopeOf, currentOwner: Pick<EmployeeAccess, 'departmentId'> | undefined, recipient: EmployeeAccess | undefined, canSignIn: boolean): void {
  if (assigneeRefusal(scopeOf, currentOwner, recipient, canSignIn) !== null) throw opportunityErrors.assigneeIneligible();
}

// ---------- Người phụ trách mất quyền sau khi nhận ----------
// true khi người phụ trách không còn dùng được tài khoản HOẶC quyền hiệu lực không còn đạt đường đầy đủ với cơ hội. owner_id KHÔNG tự đổi.
// Cờ chỉ là true/false (không nói nguyên nhân) và chỉ trả cho người có opportunity.assign đang hiệu lực.
export function ownerLostAccess(o: OppRef, owner: EmployeeAccess | undefined, canSignIn: boolean): boolean {
  if (!owner || !owner.active || canSignIn !== true) return true;
  return !readsFull({ employeeId: owner.id, departmentId: owner.departmentId }, (p) => owner.scopes[p] ?? null, o);
}
export const seesOwnerLostFlag = (scopeOf: ScopeOf): boolean => scopeOf('opportunity.assign') !== null;

// ---------- KHÔI PHỤC cơ hội đã xoá mềm (PR234-R3-SEC-02) ----------
// Đường nạp RIÊNG: chỉ người có opportunity.restore phạm vi ALL được tìm cơ hội theo id KHÔNG qua bộ lọc xoá mềm. Service PHẢI gọi
// assertMayLoadDeleted TRƯỚC khi truy vấn — người thiếu mã nhận 404 dù id có tồn tại hay không (không phân biệt được).
export const mayRestore = (scopeOf: ScopeOf): boolean => scopeOf('opportunity.restore') === 'ALL';
export function assertMayLoadDeleted(scopeOf: ScopeOf): void {
  if (!mayRestore(scopeOf)) throw opportunityErrors.notFound();
}
// Chỉ gọi SAU assertMayLoadDeleted, với dòng nạp theo id KHÔNG lọc deleted_at (ghi chú R4: chỉ sau khi xác thực restore ALL mới phân biệt
// "không tồn tại" (404) với "tồn tại nhưng chưa xoá" (409)). Khách còn bị xoá mềm => 409, phải khôi phục khách trước.
export type RestoreDecision = 'OK' | 'NOT_FOUND' | 'NOT_DELETED' | 'CUSTOMER_DELETED';
export function restoreDecision(scopeOf: ScopeOf, row: { deletedAt: Date | null; customer: { deletedAt: Date | null } } | null): RestoreDecision {
  if (!mayRestore(scopeOf) || row === null) return 'NOT_FOUND';
  if (row.deletedAt === null) return 'NOT_DELETED';
  if (row.customer.deletedAt !== null) return 'CUSTOMER_DELETED';
  return 'OK';
}
export function assertRestorable(scopeOf: ScopeOf, row: { deletedAt: Date | null; customer: { deletedAt: Date | null } } | null): void {
  switch (restoreDecision(scopeOf, row)) {
    case 'OK': return;
    case 'NOT_DELETED': throw opportunityErrors.state('Cơ hội chưa bị xoá, không cần khôi phục.');
    case 'CUSTOMER_DELETED': throw opportunityErrors.customerDeleted();
    default: throw opportunityErrors.notFound();
  }
}
// Danh sách cơ hội ĐÃ XOÁ (GET /opportunities?deleted=only): cần CẢ restore ALL VÀ opportunity.read, và vẫn bị giới hạn bởi PHẠM VI đọc
// (quyền khôi phục không tự mở rộng quyền xem — cùng nguyên tắc N6 của khách hàng). Thiếu một trong hai => không trả dòng nào.
// Không lọc theo trạng thái xoá của KHÁCH: người khôi phục cần thấy cả cơ hội mà khách còn bị xoá để biết phải khôi phục khách trước.
export function deletedListWhere(actor: Actor, scopeOf: ScopeOf): Prisma.OpportunityWhereInput {
  if (!mayRestore(scopeOf)) return NONE;
  return { AND: [{ deletedAt: { not: null } }, fullScopeWhere(actor, scopeOf('opportunity.read'))] };
}
