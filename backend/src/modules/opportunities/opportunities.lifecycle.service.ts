import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { AUDIT_REDACTED_TEXT } from '../../common/audit/db-audit.port';
import { AutoTaskCtx, OPPORTUNITY_AUTO_TASKS, OpportunityAutoTasks } from '../activities/activities.opportunity-tasks';
import type { ScopeOf } from './opportunities.access';
import { opportunityErrors } from './opportunities.errors';
import { FieldError, ruleViolations } from './opportunities.rules';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityWritesService, WRow } from './opportunities.write.service';
import type { HoldOpportunityDto, LoseOpportunityDto, ReopenOpportunityDto, ResumeOpportunityDto, WinOpportunityDto } from './dto/write-opportunity.dto';

type Tx = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
// Hôm nay theo giờ Việt Nam (UTC+7, không đổi giờ mùa), dạng YYYY-MM-DD.
const todayVn = (now = new Date()): string => new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
function dateOf(v: string, field: string, errs: FieldError[]): Date | null {
  const d = new Date(v + 'T00:00:00.000Z');
  const y = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || y < MIN_YEAR || y > MAX_YEAR) { errs.push({ field, message: 'Ngày không hợp lệ (năm ' + MIN_YEAR + '–' + MAX_YEAR + ').' }); return null; }
  return d;
}
const trimmed = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());
// Trạng thái dùng để kiểm luật R-S khi cơ hội TRỞ VỀ Đang mở (tiếp tục, mở lại).
const asOpen = (r: WRow) => ({
  status: 'OPEN', stageCode: r.stage.code, typeCode: r.type.code, needSummary: r.needSummary, expectedAmountVnd: r.expectedAmountVnd,
  isProjectLinked: r.isProjectLinked, projectName: r.projectName, offerScope: r.offerScope,
});

// Sales S8b (docs/SALES_DESIGN.md §6.4–6.7, §6.13 bảng chuyển trạng thái) — VÒNG ĐỜI trạng thái của cơ hội và công việc tự sinh đi kèm.
//
//   Từ → Đến                      | Endpoint · mã quyền        | Việc tự sinh
//   OPEN → ON_HOLD                | /hold · close              | tạo 1 việc nhắc
//   ON_HOLD → ON_HOLD (đổi hạn)   | /hold · close              | cập nhật hạn việc nhắc OPEN; không còn OPEN => tạo mới
//   ON_HOLD → OPEN                | /resume · close            | việc nhắc OPEN => CANCELLED
//   OPEN | ON_HOLD → WON          | /win · close               | việc nhắc OPEN => CANCELLED; tạo 1 việc bàn giao
//   OPEN | ON_HOLD → LOST         | /lose · close              | việc nhắc OPEN => CANCELLED
//   WON | LOST → OPEN             | /reopen · reopen (chỉ ALL) | việc bàn giao OPEN => CANCELLED
//   mọi đường khác                | —                          | 409 OPPORTUNITY_STATE, không ghi gì
//
// Dùng lại đúng khuôn của đường ghi S7 (OpportunityWritesService): khoá khách FOR SHARE → cơ hội FOR UPDATE → đọc lại → kiểm ĐÚNG mã của thao
// tác → kiểm version → ghi kèm điều kiện version. NGUYÊN TỬ (§6.13): đổi trạng thái + opportunity_change + tạo/đóng việc tự sinh + nhật ký trong
// MỘT transaction; lỗi bất kỳ => không ghi gì. KHÔNG TRÙNG: yêu cầu lặp / đồng thời gặp version cũ => 409; DB chốt thêm bằng chỉ mục unique riêng
// phần uq_activity_opp_auto_open. Luật R-S1..R-S3 áp lại trên trạng thái sau cập nhật mỗi khi cơ hội trở về Đang mở.
// Nhật ký chung không mang số liệu / lý do; chi tiết ở opportunity_change và trên chính cơ hội.
@Injectable()
export class OpportunityLifecycleService {
  constructor(
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly writes: OpportunityWritesService,
    private readonly reads: OpportunitiesService,
    @Inject(OPPORTUNITY_AUTO_TASKS) private readonly tasks: OpportunityAutoTasks,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }
  private taskCtx(tx: Tx, ctx: RequestCtx, row: WRow): AutoTaskCtx {
    return { tx, actorId: ctx.actor.employeeId, requestId: ctx.requestId, opportunity: { id: row.id, code: row.code, customerId: row.customerId } };
  }
  // Cập nhật theo version + ghi lịch sử + nhật ký. changes: chỉ mã / cờ; lý do luôn được che.
  private async apply(tx: Tx, ctx: RequestCtx, row: WRow, data: Prisma.OpportunityUncheckedUpdateManyInput, hist: Array<{ field: 'STATUS' | 'HOLD'; oldValue: string | null; newValue: string | null; reason?: string | null }>,
    action: string, summary: string, changes: Record<string, unknown>): Promise<void> {
    const upd = await tx.opportunity.updateMany({ where: { id: row.id, version: row.version }, data: { ...data, version: { increment: 1 }, updatedById: ctx.actor.employeeId } });
    if (upd.count !== 1) throw opportunityErrors.versionConflict(row.version);
    if (hist.length) await tx.opportunityChange.createMany({ data: hist.map((h) => ({ opportunityId: row.id, field: h.field, oldValue: h.oldValue, newValue: h.newValue, reason: h.reason ?? null, changedById: ctx.actor.employeeId })) });
    await this.audit.record(tx, { action, entityType: 'opportunity', entityId: row.id, entityCode: row.code, summary: summary + ' ' + row.code, changes, actorEmployeeId: ctx.actor.employeeId, requestId: ctx.requestId });
  }

  // ───── POST /opportunities/:id/hold ───── Tạm hoãn (OPEN) hoặc đổi hạn / lý do (đang ON_HOLD). §6.4.
  async hold(ctx: RequestCtx, id: string, dto: HoldOpportunityDto) {
    const { actor } = ctx; const scopeOf = this.scopeOf(actor);
    const errs: FieldError[] = [];
    const until = dateOf(dto.holdUntil, 'holdUntil', errs);
    if (until && dto.holdUntil < todayVn()) errs.push({ field: 'holdUntil', message: 'Ngày liên hệ lại không được ở quá khứ.' });
    const reason = trimmed(dto.holdReason);
    if (!reason) errs.push({ field: 'holdReason', message: 'Tạm hoãn phải ghi lý do.' });
    if (errs.length || !until || !reason) throw opportunityErrors.validation(errs);
    return this.writes.inTx(async (tx) => {
      const row = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.close');
      if (row.status !== 'OPEN' && row.status !== 'ON_HOLD') throw opportunityErrors.state('Chỉ tạm hoãn được cơ hội đang mở.');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const was = row.status === 'ON_HOLD'; const oldUntil = ymd(row.holdUntil);
      // Đang tạm hoãn và không đổi gì => không ghi, không tăng version (việc nhắc giữ nguyên).
      if (was && oldUntil === dto.holdUntil && row.holdReason === reason) return this.reads.detailIn(tx, actor, scopeOf, id);
      const hist: Array<{ field: 'STATUS' | 'HOLD'; oldValue: string | null; newValue: string | null; reason?: string | null }> = [];
      if (!was) hist.push({ field: 'STATUS', oldValue: 'OPEN', newValue: 'ON_HOLD', reason });
      hist.push({ field: 'HOLD', oldValue: was ? oldUntil : null, newValue: dto.holdUntil, reason });
      await this.apply(tx, ctx, row, { status: 'ON_HOLD', holdUntil: until, holdReason: reason }, hist, 'opportunity.hold', was ? 'Đổi hạn tạm hoãn cơ hội' : 'Tạm hoãn cơ hội',
        { ...(was ? {} : { status: ['OPEN', 'ON_HOLD'] }), holdUntil: [was ? oldUntil : null, dto.holdUntil], reason: AUDIT_REDACTED_TEXT });
      await this.tasks.upsertReminder(this.taskCtx(tx, ctx, row), row.ownerId, dto.holdUntil);
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── POST /opportunities/:id/resume ───── Tạm hoãn → Đang mở, giữ nguyên giai đoạn; hold_* giữ làm dấu vết. §6.4.
  async resume(ctx: RequestCtx, id: string, dto: ResumeOpportunityDto) {
    const { actor } = ctx; const scopeOf = this.scopeOf(actor);
    const reason = trimmed(dto.reason);
    return this.writes.inTx(async (tx) => {
      const row = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.close');
      if (row.status !== 'ON_HOLD') throw opportunityErrors.state('Chỉ tiếp tục được cơ hội đang tạm hoãn.');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const errs = ruleViolations(asOpen(row));
      if (errs.length) throw opportunityErrors.validation(errs);
      await this.apply(tx, ctx, row, { status: 'OPEN' }, [{ field: 'STATUS', oldValue: 'ON_HOLD', newValue: 'OPEN', reason }], 'opportunity.resume', 'Tiếp tục cơ hội',
        { status: ['ON_HOLD', 'OPEN'], ...(reason ? { reason: AUDIT_REDACTED_TEXT } : {}) });
      await this.tasks.cancelOpen(this.taskCtx(tx, ctx, row), 'HOLD_REMINDER', 'Cơ hội đã tiếp tục');
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── POST /opportunities/:id/win ───── Thắng từ OPEN hoặc ON_HOLD: bắt buộc chứng từ + giá trị chốt + người nhận bàn giao. §6.5.
  async win(ctx: RequestCtx, id: string, dto: WinOpportunityDto) {
    const { actor } = ctx; const scopeOf = this.scopeOf(actor);
    const errs: FieldError[] = [];
    const docDate = dateOf(dto.wonDocDate, 'wonDocDate', errs);
    const docNo = trimmed(dto.wonDocNo);
    if (!docNo) errs.push({ field: 'wonDocNo', message: 'Vui lòng nhập số chứng từ.' });
    const dueDay = dto.handoverDueDate ?? todayVn(new Date(Date.now() + 7 * DAY_MS)); // không gửi hạn bàn giao => 7 ngày kể từ hôm nay
    const due = dateOf(dueDay, 'handoverDueDate', errs);
    if (due && dueDay < todayVn()) errs.push({ field: 'handoverDueDate', message: 'Hạn bàn giao không được ở quá khứ.' });
    if (errs.length || !docDate || !docNo || !due) throw opportunityErrors.validation(errs);
    return this.writes.inTx(async (tx) => {
      const row = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.close');
      if (row.status !== 'OPEN' && row.status !== 'ON_HOLD') throw opportunityErrors.state('Cơ hội đã đóng.');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      await this.apply(tx, ctx, row, { status: 'WON', wonAmountVnd: BigInt(dto.wonAmountVnd), wonDocType: dto.wonDocType, wonDocNo: docNo, wonDocDate: docDate, wonDocUrl: dto.wonDocUrl, closedAt: new Date() },
        [{ field: 'STATUS', oldValue: row.status, newValue: 'WON' }], 'opportunity.win', 'Chốt Thắng cơ hội', { status: [row.status, 'WON'], handoverToId: [null, dto.handoverToId] });
      const c = this.taskCtx(tx, ctx, row);
      await this.tasks.cancelOpen(c, 'HOLD_REMINDER', 'Cơ hội đã chốt');
      const handover = await this.tasks.createHandover(c, dto.handoverToId, new Date(dueDay + 'T02:00:00.000Z'), { ownerId: row.customer.ownerId, ownerDepartmentId: row.customer.owner ? row.customer.owner.departmentId : null });
      // Người nhận không hợp lệ => ném lỗi => TOÀN BỘ thao tác Thắng rollback (trạng thái, lịch sử, việc nhắc vừa đóng, nhật ký).
      if (handover === 'INVALID') throw opportunityErrors.validation([{ field: 'handoverToId', message: 'Người nhận bàn giao không hợp lệ: phải đang làm việc và đọc được khách hàng, hoặc có thẩm quyền kỹ thuật.' }]);
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── POST /opportunities/:id/lose ───── Thua từ OPEN hoặc ON_HOLD: bắt buộc lý do (danh mục); "Khác" phải kèm ghi chú. §6.6.
  async lose(ctx: RequestCtx, id: string, dto: LoseOpportunityDto) {
    const { actor } = ctx; const scopeOf = this.scopeOf(actor);
    const note = trimmed(dto.lostNote);
    return this.writes.inTx(async (tx) => {
      const row = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.close');
      if (row.status !== 'OPEN' && row.status !== 'ON_HOLD') throw opportunityErrors.state('Cơ hội đã đóng.');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const why = await tx.lookupItem.findFirst({ where: { id: dto.lostReasonId, type: 'opportunity_lost_reason', isActive: true }, select: { id: true, code: true } });
      if (!why) throw opportunityErrors.validation([{ field: 'lostReasonId', message: 'Lý do thua không hợp lệ hoặc đã ngừng dùng.' }]);
      if (why.code === 'OTHER' && !note) throw opportunityErrors.validation([{ field: 'lostNote', message: 'Lý do "Khác" phải kèm ghi chú.' }]);
      await this.apply(tx, ctx, row, { status: 'LOST', lostReasonId: why.id, lostNote: note, closedAt: new Date() },
        [{ field: 'STATUS', oldValue: row.status, newValue: 'LOST' }], 'opportunity.lose', 'Chốt Thua cơ hội', { status: [row.status, 'LOST'] });
      await this.tasks.cancelOpen(this.taskCtx(tx, ctx, row), 'HOLD_REMINDER', 'Cơ hội đã chốt');
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── POST /opportunities/:id/reopen ───── Mở lại cơ hội đã Thắng / Thua: chỉ opportunity.reopen phạm vi ALL, bắt buộc lý do. §6.7.
  // closed_at → NULL; won_* / lost_* giữ làm dấu vết (lần đóng sau ghi đè); giữ giai đoạn và probability đã lưu.
  async reopen(ctx: RequestCtx, id: string, dto: ReopenOpportunityDto) {
    const { actor } = ctx; const scopeOf = this.scopeOf(actor);
    const reason = trimmed(dto.reason);
    if (!reason) throw opportunityErrors.validation([{ field: 'reason', message: 'Mở lại cơ hội phải ghi lý do.' }]);
    return this.writes.inTx(async (tx) => {
      const row = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.reopen');
      if (row.status !== 'WON' && row.status !== 'LOST') throw opportunityErrors.state('Chỉ mở lại được cơ hội đã Thắng hoặc Thua.');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const errs = ruleViolations(asOpen(row));
      if (errs.length) throw opportunityErrors.validation(errs);
      await this.apply(tx, ctx, row, { status: 'OPEN', closedAt: null }, [{ field: 'STATUS', oldValue: row.status, newValue: 'OPEN', reason }], 'opportunity.reopen', 'Mở lại cơ hội',
        { status: [row.status, 'OPEN'], reason: AUDIT_REDACTED_TEXT });
      await this.tasks.cancelOpen(this.taskCtx(tx, ctx, row), 'WIN_HANDOVER', 'Cơ hội đã mở lại');
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }
}
