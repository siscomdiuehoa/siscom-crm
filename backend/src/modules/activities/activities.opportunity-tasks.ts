import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Actor, Permission, Scope } from '../../common/auth/actor';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { AUDIT_REDACTED_TEXT } from '../../common/audit/db-audit.port';
import type { OwnerInfo } from '../../common/auth/scope';
import type { EmployeeAccess } from '../../common/auth/scope-merge';
// Vị từ THUẦN của Sales (không Nest, không Prisma client): một nguồn duy nhất cho "người gọi đạt đường đọc đầy đủ với cơ hội".
import { fullReadWhere, readsFull } from '../opportunities/opportunities.access';
import { grantAccess, hasTechAuthority, readsCustomer, revokeAccess, withdrawPendingTransfers, WriteCtx } from './activities.access';
import { EMPLOYEE_ACCESS, EmployeeAccessReader } from './activities.employee-access';

// Sales S8b — CÔNG VIỆC TỰ SINH của cơ hội (docs/SALES_DESIGN.md §5.5(e), §6.4, §6.5, §6.7, §6.13).
//  - HOLD_REMINDER: việc nhắc khi Tạm hoãn; người làm = người phụ trách cơ hội.
//  - WIN_HANDOVER: việc "Bàn giao thực hiện" khi Thắng; người làm do người chốt chọn.
// Cổng này do SERVICE SALES gọi (hàm nội bộ, KHÔNG phải endpoint), LUÔN trong transaction của thao tác trên cơ hội — nơi đã khoá dòng khách
// (FOR SHARE) và dòng cơ hội (FOR UPDATE) và đã kiểm mã Sales của thao tác (opportunity.close / reopen / assign). Vì vậy cổng không kiểm lại
// activity.* theo khách (§5.5(e)). Nhận diện việc tự sinh "của lần hiện tại" bằng ĐÚNG điều kiện của chỉ mục unique riêng phần
// uq_activity_opp_auto_open (opportunity_id, opportunity_auto_kind, status = 'OPEN', deleted_at IS NULL) — không dựa vào tiêu đề, không đụng việc
// người dùng tự tạo (opportunity_auto_kind NULL). Tiêu đề / nội dung việc tự sinh KHÔNG chứa giá trị cơ hội.
// Thứ tự khoá: khách FOR SHARE -> cơ hội FOR UPDATE (Sales) -> hoạt động FOR UPDATE (ở đây). API Hoạt động khoá khách FOR SHARE -> hoạt động
// FOR UPDATE và không khoá cơ hội => không tạo vòng chờ.

type Tx = Prisma.TransactionClient;
type ScopeOf = (p: Permission) => Scope | null;
export type AutoKind = 'HOLD_REMINDER' | 'WIN_HANDOVER';
export interface AutoTaskCtx { tx: Tx; actorId: string; requestId?: string; opportunity: { id: string; code: string; customerId: string } }
interface AutoRow { id: string; code: string; version: number; performedById: string | null; dueAt: Date | null }
const SEL = { id: true, code: true, version: true, performedById: true, dueAt: true } as const;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// 09:00 giờ Việt Nam (UTC+7, không đổi giờ mùa) của ngày YYYY-MM-DD = 02:00 UTC cùng ngày.
export const vnNineAm = (ymd: string): Date => new Date(ymd + 'T02:00:00.000Z');

// ───── Ngoại lệ ĐỌC của việc nhắc tạm hoãn (§5.5(e)) — ngoại lệ DUY NHẤT của "API Activities chung tính quyền theo khách" ─────
// Người phụ trách cơ hội có thể KHÔNG đọc được khách (C5) nhưng phải thấy và hoàn thành được việc nhắc của chính mình. Điều kiện đầy đủ:
// việc là HOLD_REMINDER, là TASK, chưa xoá mềm; performed_by = người gọi; người gọi ĐANG đạt đường đọc đầy đủ với cơ hội (cơ hội và khách chưa
// xoá mềm; tính lại mỗi request). Đổi người phụ trách, mất vai trò, xoá mềm => mất ngay. Nơi dùng trả mode 'TASK' (như quyền theo việc B3):
// đọc đúng việc đó + hoàn thành qua đường "performed_by = tôi"; KHÔNG sửa nội dung, giao lại, xoá; KHÔNG mở khách / liên hệ / hoạt động khác.
// Không áp cho WIN_HANDOVER (dùng activity_access của B3) và không áp cho việc người dùng tạo.
export interface ReminderRow {
  type: string; deletedAt: Date | null; performedById: string | null; opportunityAutoKind: string | null;
  opportunity: { ownerId: string; deletedAt: Date | null } | null;
  customer: { ownerId: string | null; deletedAt: Date | null };
}
export function readsOwnReminder(actor: Actor, scopeOf: ScopeOf, r: ReminderRow): boolean {
  if (r.opportunityAutoKind !== 'HOLD_REMINDER' || r.type !== 'TASK' || r.deletedAt !== null || r.performedById !== actor.employeeId || !r.opportunity) return false;
  return readsFull(actor, scopeOf, { ownerId: r.opportunity.ownerId, deletedAt: r.opportunity.deletedAt, customer: { ownerId: r.customer.ownerId, deletedAt: r.customer.deletedAt } });
}
// Cùng vị từ ở dạng Prisma cho danh sách việc và chuông. null = người gọi không có opportunity.read => không có nhánh này.
export function reminderReadWhere(actor: Actor, scopeOf: ScopeOf): Prisma.ActivityWhereInput | null {
  if (scopeOf('opportunity.read') === null) return null;
  return { opportunityAutoKind: 'HOLD_REMINDER', type: 'TASK', performedById: actor.employeeId, opportunity: { is: fullReadWhere(actor, scopeOf) } };
}

// ───── Cổng ghi việc tự sinh ─────
export const OPPORTUNITY_AUTO_TASKS = Symbol('OPPORTUNITY_AUTO_TASKS');
export type HandoverResult = 'INTERNAL' | 'EXTERNAL' | 'INVALID';
// Điều kiện NGƯỜI NHẬN việc "Bàn giao thực hiện" (§6.5) — MỘT nguồn cho createHandover (ghi) và handoverCandidates (danh sách gợi ý, S10a):
// nhân viên ACTIVE; đọc được khách => 'INTERNAL'; không đọc được khách nhưng có thẩm quyền kỹ thuật => 'EXTERNAL' (cấp activity_access); còn lại => null.
export function handoverKind(acc: EmployeeAccess | undefined, customerOwner: OwnerInfo): 'INTERNAL' | 'EXTERNAL' | null {
  if (!acc || !acc.active) return null;
  if (readsCustomer(acc, customerOwner)) return 'INTERNAL';
  return hasTechAuthority(acc) ? 'EXTERNAL' : null;
}
export interface HandoverCandidate { id: string; code: string; fullName: string; departmentCode: string | null }
export const HANDOVER_CANDIDATES_MAX = 500;

@Injectable()
export class OpportunityAutoTasks {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort, @Inject(EMPLOYEE_ACCESS) private readonly access: EmployeeAccessReader) {}

  private w(c: AutoTaskCtx, a: { id: string; code: string }): WriteCtx {
    return { tx: c.tx, audit: this.audit, actorId: c.actorId, requestId: c.requestId, activity: { id: a.id, code: a.code, type: 'TASK' } };
  }
  // Việc tự sinh ĐANG MỞ của cơ hội theo loại (tối đa một — chỉ mục unique). Khoá dòng trước khi đọc để không đua với người đang hoàn thành việc.
  private async openAuto(c: AutoTaskCtx, kind: AutoKind): Promise<AutoRow | null> {
    const ids = await c.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM activity WHERE opportunity_id = ${c.opportunity.id}::uuid AND opportunity_auto_kind = ${kind} AND status = 'OPEN' AND deleted_at IS NULL FOR UPDATE`;
    return ids.length ? ((await c.tx.activity.findUnique({ where: { id: ids[0].id }, select: SEL })) as AutoRow | null) : null;
  }
  private async bump(c: AutoTaskCtx, cur: AutoRow, data: Prisma.ActivityUncheckedUpdateManyInput): Promise<void> {
    const r = await c.tx.activity.updateMany({ where: { id: cur.id, version: cur.version }, data: { ...data, version: { increment: 1 }, updatedById: c.actorId } });
    if (r.count !== 1) throw new Error('Việc tự sinh ' + cur.code + ' đổi version dù đã khoá dòng.');
  }
  private async createTask(c: AutoTaskCtx, kind: AutoKind, performerId: string, dueAt: Date, title: string, content: string): Promise<AutoRow> {
    const row = (await c.tx.activity.create({
      data: {
        customerId: c.opportunity.customerId, type: 'TASK', title, content, occurredAt: new Date(), dueAt, remindAt: dueAt, status: 'OPEN', performedById: performerId,
        opportunityId: c.opportunity.id, opportunityAutoKind: kind, createdById: c.actorId, updatedById: c.actorId,
      },
      select: SEL,
    })) as AutoRow;
    await this.audit.record(c.tx, {
      action: 'activity.create', entityType: 'activity', entityId: row.id, entityCode: row.code,
      summary: 'Tạo công việc tự sinh ' + row.code + ' (' + kind + ') cho cơ hội ' + c.opportunity.code,
      changes: {
        type: [null, 'TASK'], status: [null, 'OPEN'], dueAt: [null, iso(row.dueAt)], performedById: [null, performerId], customerId: [null, c.opportunity.customerId],
        opportunityId: [null, c.opportunity.id], opportunityAutoKind: [null, kind], content: AUDIT_REDACTED_TEXT, title: AUDIT_REDACTED_TEXT,
      },
      actorEmployeeId: c.actorId, requestId: c.requestId,
    });
    return row;
  }

  // Tạm hoãn / đổi hạn hoãn: việc nhắc còn OPEN => cập nhật hạn (và người làm) của CHÍNH việc đó; không còn OPEN => tạo việc mới. Không bao giờ có hai việc nhắc OPEN.
  async upsertReminder(c: AutoTaskCtx, ownerId: string, holdUntil: string): Promise<'CREATED' | 'UPDATED'> {
    const dueAt = vnNineAm(holdUntil);
    const cur = await this.openAuto(c, 'HOLD_REMINDER');
    if (!cur) {
      await this.createTask(c, 'HOLD_REMINDER', ownerId, dueAt, 'Liên hệ lại cơ hội ' + c.opportunity.code, 'Cơ hội ' + c.opportunity.code + ' đang tạm hoãn. Đến hạn liên hệ lại khách hàng.');
      return 'CREATED';
    }
    const changes: Record<string, unknown> = {};
    if (iso(cur.dueAt) !== iso(dueAt)) changes.dueAt = [iso(cur.dueAt), iso(dueAt)];
    if (cur.performedById !== ownerId) changes.performedById = [cur.performedById, ownerId];
    if (Object.keys(changes).length) {
      await this.bump(c, cur, { dueAt, remindAt: dueAt, performedById: ownerId });
      await this.audit.record(c.tx, {
        action: 'activity.update', entityType: 'activity', entityId: cur.id, entityCode: cur.code, summary: 'Cập nhật việc nhắc tạm hoãn ' + cur.code + ' của cơ hội ' + c.opportunity.code,
        changes, actorEmployeeId: c.actorId, requestId: c.requestId,
      });
    }
    return 'UPDATED';
  }

  // Đóng (CANCELLED) việc tự sinh còn OPEN của cơ hội theo loại; việc đã DONE / đã huỷ / việc người dùng tạo không bị đụng. Trả true nếu có việc bị đóng.
  async cancelOpen(c: AutoTaskCtx, kind: AutoKind, outcome: string): Promise<boolean> {
    const cur = await this.openAuto(c, kind);
    if (!cur) return false;
    await this.bump(c, cur, { status: 'CANCELLED', outcome, completedAt: null, completedById: null });
    const w = this.w(c, cur);
    await revokeAccess(w, 'CANCELLED');
    await withdrawPendingTransfers(w);
    await this.audit.record(c.tx, {
      action: 'activity.cancel', entityType: 'activity', entityId: cur.id, entityCode: cur.code, summary: 'Huỷ công việc tự sinh ' + cur.code + ' của cơ hội ' + c.opportunity.code,
      changes: { status: ['OPEN', 'CANCELLED'], outcome: AUDIT_REDACTED_TEXT }, actorEmployeeId: c.actorId, requestId: c.requestId,
    });
    return true;
  }

  // Chuyển người phụ trách cơ hội (§6.8): việc nhắc tạm hoãn còn OPEN đổi người làm sang người phụ trách mới. Việc bàn giao và việc người dùng tạo không đổi.
  async reassignReminder(c: AutoTaskCtx, toId: string): Promise<boolean> {
    const cur = await this.openAuto(c, 'HOLD_REMINDER');
    if (!cur || cur.performedById === toId) return false;
    await this.bump(c, cur, { performedById: toId });
    await this.audit.record(c.tx, {
      action: 'activity.assign', entityType: 'activity', entityId: cur.id, entityCode: cur.code, summary: 'Chuyển việc nhắc tạm hoãn ' + cur.code + ' theo người phụ trách cơ hội ' + c.opportunity.code,
      changes: { performedById: [cur.performedById, toId] }, actorEmployeeId: c.actorId, requestId: c.requestId,
    });
    return true;
  }

  // Thắng (§6.5): tạo việc "Bàn giao thực hiện" cho người do người chốt chọn. Người nhận kiểm như B3: nhân viên ACTIVE; đọc được khách => giao
  // nội bộ; không đọc được khách => phải có thẩm quyền kỹ thuật (activity.update_own) và được cấp activity_access theo B3 §5.4 trong cùng transaction
  // (hạn, nhật ký, thu hồi y như B3; granted_by = người chốt). Không đạt => 'INVALID', KHÔNG tạo gì (nơi gọi từ chối cả thao tác Thắng).
  async createHandover(c: AutoTaskCtx, recipientId: string, dueAt: Date, customerOwner: OwnerInfo): Promise<HandoverResult> {
    const kind = handoverKind((await this.access.load(c.tx, [recipientId])).get(recipientId), customerOwner);
    if (kind === null) return 'INVALID';
    const reads = kind === 'INTERNAL';
    const row = await this.createTask(c, 'WIN_HANDOVER', recipientId, dueAt, 'Bàn giao thực hiện ' + c.opportunity.code, 'Cơ hội ' + c.opportunity.code + ' đã Thắng. Tiếp nhận bàn giao để thực hiện.');
    if (!reads) await grantAccess(this.w(c, row), recipientId);
    return reads ? 'INTERNAL' : 'EXTERNAL';
  }

  // S10a — danh sách người CÓ THỂ nhận việc bàn giao của một khách: đúng điều kiện handoverKind ở trên (chỉ đọc; nơi gọi — service Sales — đã kiểm
  // mã opportunity.close trên cơ hội). Chỉ trả id, mã, họ tên, mã phòng; không nói người đó thuộc nhánh nội bộ hay ngoài phạm vi.
  async handoverCandidates(db: Pick<Tx, 'employee'>, customerOwner: OwnerInfo): Promise<HandoverCandidate[]> {
    const rows = await db.employee.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true, code: true, fullName: true, department: { select: { code: true } } },
      orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
    });
    const acc = await this.access.load(db, rows.map((r) => r.id));
    return rows.filter((r) => handoverKind(acc.get(r.id), customerOwner) !== null).slice(0, HANDOVER_CANDIDATES_MAX)
      .map((r) => ({ id: r.id, code: r.code, fullName: r.fullName, departmentCode: r.department ? r.department.code : null }));
  }
}
