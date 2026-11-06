import type { Prisma } from '../../generated/prisma/client';
import type { Actor, Permission, Scope } from '../../common/auth/actor';
import { inScope, OwnerInfo } from '../../common/auth/scope';
import type { EmployeeAccess } from '../../common/auth/scope-merge';
import type { AuditPort } from '../../common/audit/audit.port';
import type { EmployeeAccessReader } from './activities.employee-access';
import { activityErrors } from './activities.errors';

// B3 A6 — ActivityAccessPolicy (docs/B3_ACTIVITIES_DESIGN.md §5, §5.4): code path RIÊNG cho
//   (1) phạm vi đọc theo KHÁCH (customer.read ∧ activity.read, §5) và
//   (2) quyền theo VIỆC (activity_access còn hiệu lực ∧ người gọi HIỆN vẫn có activity.update_own ∧ việc + khách chưa xoá mềm).
// (2) chỉ áp cho CHÍNH hoạt động đó — không bao giờ dùng trong truy vấn customer/contact/timeline.
// Ghi activity_access/activity_transfer_request đi qua các hàm ở đây để thứ tự + lý do thu hồi thống nhất.

type Tx = Prisma.TransactionClient;
export type ScopeOf = (p: Permission) => Scope | null;
export type AccessMode = 'SCOPE' | 'TASK';
export type RevokeReason = 'REASSIGNED' | 'COMPLETED' | 'CANCELLED' | 'DELETED' | 'CUSTOMER_DELETED' | 'EXPIRED' | 'ROLE_LOST' | 'DUE_CHANGED' | 'MANUAL';

export const ownerInfo = (r: { ownerId: string | null; owner: { departmentId: string | null } | null }): OwnerInfo => ({ ownerId: r.ownerId, ownerDepartmentId: r.owner ? r.owner.departmentId : null });

const NONE: Prisma.CustomerWhereInput = { id: { in: [] } };
// Điều kiện phạm vi trên KHÁCH (bản cục bộ, cùng ngữ nghĩa scopeWhere của customers — không import nội bộ module khác). Fail-closed.
export function customerScopeWhere(actor: Actor, scope: Scope | null): Prisma.CustomerWhereInput {
  switch (scope) {
    case 'ALL': return {};
    case 'OWN': return { ownerId: actor.employeeId };
    case 'DEPARTMENT': return actor.departmentId ? { owner: { is: { departmentId: actor.departmentId } } } : NONE;
    default: return NONE;
  }
}

// (1) Đọc theo khách: customer.read ∧ activity.read trong phạm vi chủ khách.
export function readsByScope(actor: Actor, scopeOf: ScopeOf, owner: OwnerInfo): boolean {
  return inScope(actor, scopeOf('customer.read'), owner) && inScope(actor, scopeOf('activity.read'), owner);
}
export function scopeReadWhere(actor: Actor, scopeOf: ScopeOf): Prisma.ActivityWhereInput {
  return { customer: { is: { AND: [customerScopeWhere(actor, scopeOf('customer.read')), customerScopeWhere(actor, scopeOf('activity.read'))] } } };
}
// (2) Quyền theo việc trong truy vấn danh sách (Prisma). null = người gọi không có activity.update_own => không có nhánh này.
export function taskAccessWhere(actor: Actor, scopeOf: ScopeOf, now: Date): Prisma.ActivityWhereInput | null {
  if (!scopeOf('activity.update_own')) return null;
  return { accesses: { some: { employeeId: actor.employeeId, revokedAt: null, expiresAt: { gt: now } } } };
}

// NGƯỜI KHÁC (người được giao/ứng viên) đọc được khách theo vai trò trong DB (chỉ dùng làm điều kiện thu hẹp).
export function readsCustomer(a: Pick<EmployeeAccess, 'id' | 'departmentId' | 'scopes'>, owner: OwnerInfo): boolean {
  const who: Actor = { employeeId: a.id, departmentId: a.departmentId };
  return inScope(who, a.scopes['customer.read'] ?? null, owner) && inScope(who, a.scopes['activity.read'] ?? null, owner);
}
// Thẩm quyền kỹ thuật (điều kiện nhận việc ngoài phạm vi / nhận đề xuất chuyển): ACTIVE + có activity.update_own.
export const hasTechAuthority = (a: EmployeeAccess | undefined): boolean => !!a && a.active && !!a.scopes['activity.update_own'];

// (2) cho MỘT hoạt động: dòng activity_access còn hiệu lực (giờ DB) của người gọi. Kiểm update_own trước (gỡ vai trò => mất ngay).
export async function activeTaskAccess(db: Pick<Tx, '$queryRaw'>, actor: Actor, scopeOf: ScopeOf, activityId: string): Promise<{ id: string; expiresAt: Date } | null> {
  if (!scopeOf('activity.update_own')) return null;
  const rows = await db.$queryRaw<{ id: string; expires_at: Date }[]>`
    SELECT id, expires_at FROM activity_access
    WHERE activity_id = ${activityId}::uuid AND employee_id = ${actor.employeeId}::uuid AND revoked_at IS NULL AND expires_at > now()
    LIMIT 1`;
  return rows.length ? { id: rows[0].id, expiresAt: rows[0].expires_at } : null;
}

// Quyết định Owner #4 (06/11/2026): mọi phép so thời hạn quyền theo việc dùng ĐỒNG HỒ POSTGRESQL, không dùng giờ Node.
// Trong transaction, now() là thời điểm bắt đầu transaction — trùng với now() mà grantAccess/revokeAccess dùng khi ghi.
export async function dbNow(db: Pick<Tx, '$queryRaw'>): Promise<Date> {
  const rows = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  return rows[0].now;
}

// Dòng truy cập còn hiệu lực của MỘT nhóm hoạt động (để tính cờ assigneeLostAccess, danh sách người được cấp). now: lấy từ dbNow().
export async function activeAccessRows(db: Pick<Tx, 'activityAccess'>, activityIds: readonly string[], now: Date) {
  if (!activityIds.length) return [];
  return db.activityAccess.findMany({
    where: { activityId: { in: [...activityIds] }, revokedAt: null, expiresAt: { gt: now } },
    select: { activityId: true, employeeId: true, expiresAt: true, grantedById: true, employee: { select: { id: true, code: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

// Cờ §5 TOCTOU/§5.4: việc OPEN mà người phụ trách KHÔNG còn đọc được khách VÀ không còn quyền theo việc hiệu lực (gồm hết hạn/thu hồi/mất vai trò).
export function assigneeLost(status: string, performedById: string | null, owner: OwnerInfo, perf: EmployeeAccess | undefined, hasActiveAccess: boolean): boolean {
  if (status !== 'OPEN' || !performedById) return false;
  if (!perf || !perf.active) return true;
  if (readsCustomer(perf, owner)) return false;
  return !(hasActiveAccess && !!perf.scopes['activity.update_own']);
}

// Quy tắc giao việc (thiết kế §5, §5.4, §6). Người giao cần activity.assign trong phạm vi khách.
//  - Không xin external (hoặc người nhận ĐỌC ĐƯỢC khách): đúng quy tắc A5 — ACTIVE; cùng phòng người giao (phạm vi assign = ALL: mọi phòng);
//    đọc được khách => 'INTERNAL'; không đọc được => 400 ACTIVITY_ASSIGNEE_NO_ACCESS.
//  - external=true và người nhận KHÔNG đọc được khách: người giao cần thêm activity.assign_external trong phạm vi khách (403); chỉ TASK OPEN và
//    người nhận có thẩm quyền kỹ thuật (activity.update_own) => 'EXTERNAL' (cấp activity_access). Quyết định Owner #2 (06/11/2026):
//    không phải TASK OPEN => 400 ACTIVITY_EXTERNAL_NOT_ALLOWED; người nhận thiếu update_own => 403 cùng mã.
export function planAssignment(actor: Actor, scopeOf: ScopeOf, owner: OwnerInfo, a: EmployeeAccess | undefined, opts: { external: boolean; openTask: boolean }): 'INTERNAL' | 'EXTERNAL' {
  const assignScope = scopeOf('activity.assign');
  if (!inScope(actor, assignScope, owner)) throw activityErrors.forbidden('Không có quyền giao việc cho người khác trên khách hàng này.');
  if (!a || !a.active) throw activityErrors.assigneeInvalid();
  const reads = readsCustomer(a, owner);
  if (!opts.external || reads) {
    if (assignScope !== 'ALL' && (actor.departmentId === null || a.departmentId !== actor.departmentId)) throw activityErrors.assigneeInvalid();
    if (!reads) throw activityErrors.assigneeNoAccess();
    return 'INTERNAL';
  }
  if (!inScope(actor, scopeOf('activity.assign_external'), owner)) throw activityErrors.forbidden('Không có quyền giao việc cho người ngoài phạm vi khách hàng.');
  if (!opts.openTask) throw activityErrors.externalNotAllowed();
  if (!a.scopes['activity.update_own']) throw activityErrors.externalAssigneeForbidden();
  return 'EXTERNAL';
}

export interface WriteCtx { tx: Tx; audit: AuditPort; actorId: string; requestId?: string; activity: { id: string; code: string; type: string } }

async function auditRevoked(w: WriteCtx, rows: { employee_id: string; reason: string }[]): Promise<void> {
  for (const r of rows) {
    await w.audit.record(w.tx, {
      action: 'activity.access_revoke', entityType: 'activity', entityId: w.activity.id, entityCode: w.activity.code,
      summary: 'Thu hồi quyền theo việc ' + w.activity.code + ' (' + r.reason + ')',
      changes: { employeeId: r.employee_id, revokeReason: r.reason },
      actorEmployeeId: w.actorId, requestId: w.requestId,
    });
  }
}

// Thu hồi dòng còn revoked_at IS NULL của hoạt động (một người hoặc tất cả). Dòng đã quá hạn được ghi lý do EXPIRED (đúng sự thật), còn lại = reason.
// Ghi nhật ký activity.access_revoke cho TỪNG dòng (khoá 'revokeReason' — 'reason' là khoá nhạy cảm).
export async function revokeAccess(w: WriteCtx, reason: RevokeReason, employeeId: string | null = null): Promise<{ employee_id: string; reason: string }[]> {
  const rows = await w.tx.$queryRaw<{ employee_id: string; reason: string }[]>`
    UPDATE activity_access SET revoked_at = now(), revoked_by = ${w.actorId}::uuid,
      revoke_reason = (CASE WHEN expires_at <= now() THEN 'EXPIRED' ELSE ${reason} END)::activity_access_revoke_reason
    WHERE activity_id = ${w.activity.id}::uuid AND revoked_at IS NULL AND (${employeeId}::uuid IS NULL OR employee_id = ${employeeId}::uuid)
    RETURNING employee_id, revoke_reason::text AS reason`;
  await auditRevoked(w, rows);
  return rows;
}

// Cấp quyền theo việc (§5.4). expires_at tính TRONG câu INSERT bằng SQL cùng now() với created_at (rà soát lần 7 N-1) — không dùng giờ Node.
// Cấp lại cho cùng người: thu hồi dòng cũ trước (EXPIRED/REASSIGNED) => không bao giờ 23505. Kiểm câu INSERT trả ĐÚNG 1 dòng (rà soát lần 8).
// Gọi SAU khi đã UPDATE activity (due_at/performed_by mới) trong cùng transaction.
export async function grantAccess(w: WriteCtx, employeeId: string, renewReason: RevokeReason = 'REASSIGNED'): Promise<{ expiresAt: Date }> {
  await revokeAccess(w, renewReason, employeeId);
  const rows = await w.tx.$queryRaw<{ id: string; expires_at: Date }[]>`
    INSERT INTO activity_access (activity_id, employee_id, granted_by, expires_at)
    SELECT a.id, ${employeeId}::uuid, ${w.actorId}::uuid, least(greatest(a.due_at, now()) + interval '168 hours', now() + interval '720 hours')
    FROM activity a
    WHERE a.id = ${w.activity.id}::uuid AND a.type = 'TASK' AND a.status = 'OPEN' AND a.deleted_at IS NULL AND a.due_at IS NOT NULL
    RETURNING id, expires_at`;
  if (rows.length !== 1) throw activityErrors.constraint(); // không im lặng (thiết kế §10 A6)
  const expiresAt = rows[0].expires_at;
  await w.audit.record(w.tx, {
    action: 'activity.access_grant', entityType: 'activity', entityId: w.activity.id, entityCode: w.activity.code,
    summary: 'Cấp quyền theo việc ' + w.activity.code + ' (' + w.activity.type + ')',
    changes: { employeeId, expiresAt: expiresAt.toISOString() },
    actorEmployeeId: w.actorId, requestId: w.requestId,
  });
  return { expiresAt };
}

// Rút đề xuất chuyển đang chờ của hoạt động (TASK đóng/đổi người/xoá) => WITHDRAWN, decided_by = người thực hiện thao tác.
export async function withdrawPendingTransfers(w: WriteCtx): Promise<number> {
  const rows = await w.tx.$queryRaw<{ id: string }[]>`
    UPDATE activity_transfer_request SET status = 'WITHDRAWN', decided_by = ${w.actorId}::uuid, decided_at = now()
    WHERE activity_id = ${w.activity.id}::uuid AND status = 'PENDING'
    RETURNING id`;
  for (const r of rows) {
    await w.audit.record(w.tx, {
      action: 'activity.transfer_withdraw', entityType: 'activity', entityId: w.activity.id, entityCode: w.activity.code,
      summary: 'Tự rút đề xuất chuyển việc ' + w.activity.code + ' (việc đã thay đổi)',
      changes: { transferRequestId: r.id, status: ['PENDING', 'WITHDRAWN'], auto: true },
      actorEmployeeId: w.actorId, requestId: w.requestId,
    });
  }
  return rows.length;
}

// §5.4 (rà soát lần 6 I-5, lần 7 N-4): ở lần ghi kế tiếp trên CHÍNH hoạt động do NGƯỜI KHÁC thực hiện, đánh dấu dòng truy cập của người
// đã mất thẩm quyền (nghỉ việc / gỡ activity.update_own) là ROLE_LOST, dòng đã quá hạn là EXPIRED; revoked_by = người thực hiện lần ghi.
export async function sweepStaleAccess(w: WriteCtx, reader: EmployeeAccessReader): Promise<void> {
  const rows = await w.tx.activityAccess.findMany({ where: { activityId: w.activity.id, revokedAt: null, employeeId: { not: w.actorId } }, select: { employeeId: true, expiresAt: true } });
  if (!rows.length) return;
  const acc = await reader.load(w.tx, rows.map((r) => r.employeeId));
  const now = (await dbNow(w.tx)).getTime();
  for (const r of rows) {
    if (r.expiresAt.getTime() <= now || !hasTechAuthority(acc.get(r.employeeId))) await revokeAccess(w, 'ROLE_LOST', r.employeeId);
  }
}
