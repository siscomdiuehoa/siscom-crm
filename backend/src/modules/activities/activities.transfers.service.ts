import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, Permission, RequestCtx, Scope } from '../../common/auth/actor';
import { inScope, OwnerInfo } from '../../common/auth/scope';
import type { EmployeeAccess } from '../../common/auth/scope-merge';
import { AUDIT_REDACTED_TEXT } from '../../common/audit/db-audit.port';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { PrismaService } from '../../prisma/prisma.service';
import {
  activeTaskAccess, customerScopeWhere, grantAccess, hasTechAuthority, ownerInfo, readsByScope, readsCustomer, revokeAccess, ScopeOf, sweepStaleAccess, WriteCtx,
} from './activities.access';
import { EMPLOYEE_ACCESS, EmployeeAccessReader } from './activities.employee-access';
import { activityErrors } from './activities.errors';
import { ActivityTaskRow, toTransfer, TRANSFER_SELECT } from './activities.mapper';
import { lockActivity, mapError } from './activities.tasks.service';
import type { CreateTransferRequestDto, DecideTransferDto } from './dto/task-actions.dto';

type Tx = Prisma.TransactionClient;
const DECISION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // người đề xuất thấy kết quả trong 3 ngày (§5.5)
const INBOX_MAX = 500;

// B3 A6 — đề xuất chuyển việc có duyệt (docs/B3_ACTIVITIES_DESIGN.md §5.5).
// Đề xuất: người ĐANG phụ trách TASK OPEN, có activity.transfer_request (kể cả chỉ có quyền theo việc). Người nhận: ACTIVE, CÙNG PHÒNG người
// đề xuất, có activity.update_own. Người đề xuất KHÔNG BAO GIỜ tự mở quyền xem khách — quyền chỉ cấp khi người duyệt (assign + assign_external
// nếu người nhận ngoài phạm vi) duyệt. Duyệt: một transaction — đổi performed_by, thu hồi quyền cũ (REASSIGNED), cấp mới nếu cần, APPROVED.
@Injectable()
export class ActivityTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EMPLOYEE_ACCESS) private readonly access: EmployeeAccessReader,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p: Permission) => this.actors.scopeFor(actor, p); }
  private need(actor: Actor, p: Permission): Scope {
    const s = this.actors.scopeFor(actor, p);
    if (!s) throw activityErrors.forbidden();
    return s;
  }

  // Thẩm quyền duyệt/từ chối của actor với người nhận `to` trên khách `owner` (§5.5): activity.assign trong phạm vi khách; người nhận đọc được
  // khách => quy tắc giao nội bộ (cùng phòng NGƯỜI DUYỆT, trừ phạm vi assign = ALL); không đọc được => cần thêm activity.assign_external.
  private approverKind(actor: Actor, owner: OwnerInfo, to: EmployeeAccess | undefined): 'INTERNAL' | 'EXTERNAL' | null {
    const s = this.scopeOf(actor);
    const assignScope = s('activity.assign');
    if (!inScope(actor, assignScope, owner)) return null;
    if (to && readsCustomer(to, owner)) {
      if (assignScope !== 'ALL' && (actor.departmentId === null || to.departmentId !== actor.departmentId)) return null;
      return 'INTERNAL';
    }
    return inScope(actor, s('activity.assign_external'), owner) ? 'EXTERNAL' : null;
  }

  // ───── POST /activities/:id/transfer-requests ─────
  async create(ctx: RequestCtx, activityId: string, dto: CreateTransferRequestDto) {
    const { actor } = ctx;
    this.need(actor, 'activity.transfer_request');
    const to = dto.toEmployeeId.toLowerCase();
    return this.tx(async (tx) => {
      const { row } = await this.lockVisible(tx, ctx, activityId);
      if (row.performedById !== actor.employeeId) throw activityErrors.transferNotAllowed('Chỉ người đang phụ trách mới được đề xuất chuyển việc.');
      if (row.type !== 'TASK') throw activityErrors.notTask();
      if (row.status !== 'OPEN') throw activityErrors.notOpen();
      if (to === actor.employeeId || actor.departmentId === null) throw activityErrors.transferTargetInvalid();
      const ta = (await this.access.load(tx, [to])).get(to);
      if (!hasTechAuthority(ta) || ta!.departmentId !== actor.departmentId) throw activityErrors.transferTargetInvalid();
      if (await tx.activityTransferRequest.findFirst({ where: { activityId, status: 'PENDING' }, select: { id: true } })) throw activityErrors.transferPending();
      const r = await tx.activityTransferRequest.create({ data: { activityId, fromEmployeeId: actor.employeeId, toEmployeeId: to, reason: dto.reason }, select: TRANSFER_SELECT });
      await this.audit.record(tx, {
        action: 'activity.transfer_request', entityType: 'activity', entityId: row.id, entityCode: row.code,
        summary: 'Đề xuất chuyển công việc ' + row.code, changes: { transferRequestId: r.id, toEmployeeId: to, reason: AUDIT_REDACTED_TEXT },
        actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return toTransfer(r);
    });
  }

  // ───── GET /activity-transfer-requests?box=inbox|outbox ─────
  async box(ctx: RequestCtx, box: 'inbox' | 'outbox') {
    const { actor } = ctx;
    this.need(actor, 'activity.read');
    if (box === 'outbox') {
      const rows = await this.prisma.activityTransferRequest.findMany({
        where: { fromEmployeeId: actor.employeeId, OR: [{ status: 'PENDING' }, { decidedAt: { gte: new Date(Date.now() - DECISION_WINDOW_MS) } }] },
        orderBy: { createdAt: 'desc' }, take: INBOX_MAX, select: TRANSFER_SELECT,
      });
      return { items: rows.map(toTransfer) };
    }
    return { items: await this.inbox(actor) };
  }

  // Chờ TÔI duyệt: đề xuất PENDING trên việc TASK OPEN chưa xoá, khách chưa xoá, tôi đọc được khách VÀ có thẩm quyền duyệt với người nhận.
  private async inbox(actor: Actor) {
    const s = this.scopeOf(actor);
    if (!s('activity.assign')) return [];
    const rows = await this.prisma.activityTransferRequest.findMany({
      where: {
        status: 'PENDING',
        activity: { deletedAt: null, type: 'TASK', status: 'OPEN', customer: { is: { deletedAt: null, AND: [customerScopeWhere(actor, s('customer.read')), customerScopeWhere(actor, s('activity.read')), customerScopeWhere(actor, s('activity.assign'))] } } },
      },
      orderBy: { createdAt: 'asc' }, take: INBOX_MAX,
      select: { ...TRANSFER_SELECT, activity: { select: { id: true, code: true, type: true, status: true, title: true, dueAt: true, customer: { select: { id: true, code: true, name: true, ownerId: true, owner: { select: { departmentId: true } } } } } } },
    });
    const acc = await this.access.load(this.prisma, [...new Set(rows.map((r) => r.toEmployeeId))]);
    return rows
      .filter((r) => this.approverKind(actor, ownerInfo(r.activity.customer), acc.get(r.toEmployeeId)) !== null)
      .map((r) => ({
        ...toTransfer(r),
        activity: { id: r.activity.id, code: r.activity.code, type: r.activity.type, status: r.activity.status, title: r.activity.title, dueAt: r.activity.dueAt ? r.activity.dueAt.toISOString() : null },
        customer: { id: r.activity.customer.id, code: r.activity.customer.code, name: r.activity.customer.name },
      }));
  }

  // Cho chuông: pendingApprovals (chờ tôi duyệt) + transferDecisions (đề xuất của tôi được QUYẾT — duyệt/từ chối — trong 3 ngày).
  async counts(actor: Actor): Promise<{ pendingApprovals: number; transferDecisions: number }> {
    const [inbox, transferDecisions] = await Promise.all([
      this.inbox(actor),
      this.prisma.activityTransferRequest.count({ where: { fromEmployeeId: actor.employeeId, status: { in: ['APPROVED', 'REJECTED'] }, decidedAt: { gte: new Date(Date.now() - DECISION_WINDOW_MS) } } }),
    ]);
    return { pendingApprovals: inbox.length, transferDecisions };
  }

  // ───── POST /activity-transfer-requests/:id/approve ─────
  async approve(ctx: RequestCtx, requestId: string, dto: DecideTransferDto) {
    const { actor } = ctx;
    this.need(actor, 'activity.assign');
    if (dto.version === undefined) throw activityErrors.validation(['version (phiên bản hoạt động) là bắt buộc khi duyệt.']);
    return this.tx(async (tx) => {
      const { req, row, w, owner } = await this.lockDecision(tx, ctx, requestId);
      if (row.type !== 'TASK' || row.status !== 'OPEN' || row.performedById !== req.fromEmployeeId) throw activityErrors.transferNotPending();
      if (row.version !== dto.version) throw activityErrors.versionConflict(row.version);
      const to = (await this.access.load(tx, [req.toEmployeeId])).get(req.toEmployeeId);
      if (!hasTechAuthority(to)) throw activityErrors.assigneeInvalid();
      const kind = this.approverKind(actor, owner, to);
      if (!kind) throw activityErrors.transferNotAllowed('Bạn không có thẩm quyền duyệt chuyển việc cho người này.');
      const u = await tx.activity.updateMany({ where: { id: row.id, version: dto.version, deletedAt: null }, data: { performedById: req.toEmployeeId, updatedById: actor.employeeId, version: { increment: 1 } } });
      if (u.count !== 1) throw activityErrors.versionConflict(row.version);
      const note = dto.decisionNote ? dto.decisionNote : null;
      const d = await tx.activityTransferRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: actor.employeeId, decidedAt: new Date(), decisionNote: note } });
      if (d.count !== 1) throw activityErrors.transferNotPending();
      await revokeAccess(w, 'REASSIGNED');
      await this.audit.record(tx, { action: 'activity.assign', entityType: 'activity', entityId: row.id, entityCode: row.code, summary: 'Giao hoạt động ' + row.code + ' (' + row.type + ')', changes: { performedById: [req.fromEmployeeId, req.toEmployeeId], transferRequestId: req.id }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      await this.audit.record(tx, { action: 'activity.transfer_approve', entityType: 'activity', entityId: row.id, entityCode: row.code, summary: 'Duyệt chuyển công việc ' + row.code, changes: { transferRequestId: req.id, status: ['PENDING', 'APPROVED'], ...(note ? { decisionNote: AUDIT_REDACTED_TEXT } : {}) }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      if (kind === 'EXTERNAL') await grantAccess(w, req.toEmployeeId);
      return toTransfer(await tx.activityTransferRequest.findUniqueOrThrow({ where: { id: req.id }, select: TRANSFER_SELECT }));
    });
  }

  // ───── POST /activity-transfer-requests/:id/reject ─────
  async reject(ctx: RequestCtx, requestId: string, dto: DecideTransferDto) {
    const { actor } = ctx;
    this.need(actor, 'activity.assign');
    return this.tx(async (tx) => {
      const { req, row, owner } = await this.lockDecision(tx, ctx, requestId);
      if (dto.version !== undefined && row.version !== dto.version) throw activityErrors.versionConflict(row.version);
      const to = (await this.access.load(tx, [req.toEmployeeId])).get(req.toEmployeeId);
      if (!this.approverKind(actor, owner, to)) throw activityErrors.transferNotAllowed('Bạn không có thẩm quyền quyết định đề xuất này.');
      const note = dto.decisionNote ? dto.decisionNote : null;
      const d = await tx.activityTransferRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'REJECTED', decidedById: actor.employeeId, decidedAt: new Date(), decisionNote: note } });
      if (d.count !== 1) throw activityErrors.transferNotPending();
      await this.audit.record(tx, { action: 'activity.transfer_reject', entityType: 'activity', entityId: row.id, entityCode: row.code, summary: 'Từ chối chuyển công việc ' + row.code, changes: { transferRequestId: req.id, status: ['PENDING', 'REJECTED'], ...(note ? { decisionNote: AUDIT_REDACTED_TEXT } : {}) }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      return toTransfer(await tx.activityTransferRequest.findUniqueOrThrow({ where: { id: req.id }, select: TRANSFER_SELECT }));
    });
  }

  // ───── POST /activity-transfer-requests/:id/withdraw ─────  Chỉ người đề xuất.
  async withdraw(ctx: RequestCtx, requestId: string, dto: DecideTransferDto) {
    const { actor } = ctx;
    return this.tx(async (tx) => {
      const head = await tx.activityTransferRequest.findUnique({ where: { id: requestId }, select: { activityId: true, fromEmployeeId: true } });
      if (!head) throw activityErrors.transferNotFound();
      if (head.fromEmployeeId !== actor.employeeId) throw activityErrors.transferNotAllowed('Chỉ người đề xuất mới được rút đề xuất.');
      const row = await lockActivity(tx, head.activityId);
      if (!row) throw activityErrors.transferNotFound();
      if (dto.version !== undefined && row.version !== dto.version) throw activityErrors.versionConflict(row.version);
      const d = await tx.activityTransferRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status: 'WITHDRAWN', decidedById: actor.employeeId, decidedAt: new Date() } });
      if (d.count !== 1) throw activityErrors.transferNotPending();
      await this.audit.record(tx, { action: 'activity.transfer_withdraw', entityType: 'activity', entityId: row.id, entityCode: row.code, summary: 'Rút đề xuất chuyển công việc ' + row.code, changes: { transferRequestId: requestId, status: ['PENDING', 'WITHDRAWN'] }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      return toTransfer(await tx.activityTransferRequest.findUniqueOrThrow({ where: { id: requestId }, select: TRANSFER_SELECT }));
    });
  }

  // ───── hạ tầng ─────
  private async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
        return fn(tx);
      }, { maxWait: 5000, timeout: 20000 });
    } catch (e) {
      throw mapError(e);
    }
  }

  // Khoá + kiểm người gọi đọc được việc (theo khách HOẶC quyền theo việc). Khách đã xoá => 409.
  private async lockVisible(tx: Tx, ctx: RequestCtx, activityId: string): Promise<{ row: ActivityTaskRow; w: WriteCtx }> {
    const { actor } = ctx;
    const row = await lockActivity(tx, activityId);
    if (!row || row.deletedAt) throw activityErrors.notFound();
    const s = this.scopeOf(actor);
    const owner = ownerInfo(row.customer);
    const byScope = readsByScope(actor, s, owner);
    if (!byScope && (row.customer.deletedAt || !(await activeTaskAccess(tx, actor, s, row.id)))) throw activityErrors.notFound();
    if (row.customer.deletedAt) throw activityErrors.customerDeleted();
    const w: WriteCtx = { tx, audit: this.audit, actorId: actor.employeeId, requestId: ctx.requestId, activity: { id: row.id, code: row.code, type: row.type } };
    await sweepStaleAccess(w, this.access);
    return { row, w };
  }

  // Duyệt/từ chối: người quyết phải ĐỌC ĐƯỢC khách theo phạm vi (không qua quyền theo việc). Đề xuất phải PENDING.
  private async lockDecision(tx: Tx, ctx: RequestCtx, requestId: string) {
    const { actor } = ctx;
    const head = await tx.activityTransferRequest.findUnique({ where: { id: requestId }, select: { activityId: true } });
    if (!head) throw activityErrors.transferNotFound();
    const row = await lockActivity(tx, head.activityId);
    if (!row || row.deletedAt) throw activityErrors.transferNotFound();
    const owner = ownerInfo(row.customer);
    if (!readsByScope(actor, this.scopeOf(actor), owner)) throw activityErrors.transferNotFound();
    if (row.customer.deletedAt) throw activityErrors.customerDeleted();
    const req = await tx.activityTransferRequest.findUniqueOrThrow({ where: { id: requestId }, select: { id: true, status: true, fromEmployeeId: true, toEmployeeId: true } });
    if (req.status !== 'PENDING') throw activityErrors.transferNotPending();
    const w: WriteCtx = { tx, audit: this.audit, actorId: actor.employeeId, requestId: ctx.requestId, activity: { id: row.id, code: row.code, type: row.type } };
    await sweepStaleAccess(w, this.access);
    return { req, row, w, owner };
  }
}
