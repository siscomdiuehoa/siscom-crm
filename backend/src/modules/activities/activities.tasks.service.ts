import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, Permission, RequestCtx, Scope } from '../../common/auth/actor';
import { inScope, OwnerInfo } from '../../common/auth/scope';
import { AUDIT_REDACTED_TEXT } from '../../common/audit/db-audit.port';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { DomainException } from '../../common/errors/domain.exception';
import { mapPrismaError } from '../../common/errors/prisma-error.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AccessMode, activeAccessRows, activeTaskAccess, assigneeLost, grantAccess, ownerInfo, planAssignment, readsByScope, revokeAccess,
  scopeReadWhere, ScopeOf, sweepStaleAccess, taskAccessWhere, withdrawPendingTransfers, WriteCtx,
} from './activities.access';
import { EMPLOYEE_ACCESS, EmployeeAccessReader } from './activities.employee-access';
import { activityErrors } from './activities.errors';
import { ACTIVITY_TASK_SELECT, ActivityTaskRow, toActivity } from './activities.mapper';
import { vnDayRange } from './activities.time';
import type { AssignActivityDto, CompleteActivityDto, DeleteActivityDto, QueryTasksDto, RevokeAccessDto, UpdateActivityDto, VersionDto } from './dto/task-actions.dto';

type Tx = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OFFSET_WINDOW = 100000;
const HISTORY_MAX = 500;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function parseInstant(v: string, field: string, errs: string[]): Date | null {
  const d = new Date(v);
  const y = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || y < MIN_YEAR || y > MAX_YEAR) { errs.push(field + ' không phải thời điểm hợp lệ (năm ' + MIN_YEAR + '–' + MAX_YEAR + ').'); return null; }
  return d;
}

interface Vis { mode: AccessMode; owner: OwnerInfo; accessExpiresAt?: Date }

// B3 A6 (docs/B3_ACTIVITIES_DESIGN.md §5, §5.4, §6, §7): vòng đời công việc + quyền theo việc.
// Quy tắc chung: không có quyền => 403; hoạt động không đọc được (ngoài phạm vi khách VÀ không có quyền theo việc) => 404 ACTIVITY_NOT_FOUND;
// đọc được nhưng thiếu quyền ghi => 403; khách đã xoá mềm => ghi 409 CUSTOMER_DELETED. Ghi: transaction (lock 5 s/statement 15 s), khoá khách
// FOR SHARE rồi hoạt động FOR UPDATE (cùng thứ tự với module khách hàng), updateMany theo version, nhật ký cùng transaction.
@Injectable()
export class ActivityTasksService {
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
  // Đọc chi tiết/thẻ việc: cần activity.read (theo khách) hoặc activity.update_own (đường quyền theo việc). Không có cả hai => 403.
  private needReadOrTask(actor: Actor): void {
    if (!this.actors.scopeFor(actor, 'activity.read') && !this.actors.scopeFor(actor, 'activity.update_own')) throw activityErrors.forbidden();
  }

  // Ai đọc được hoạt động này, theo đường nào. forWrite: khách đã xoá vẫn trả SCOPE để nơi gọi báo 409 CUSTOMER_DELETED (như A5).
  private async resolve(db: Pick<Tx, '$queryRaw'>, actor: Actor, row: ActivityTaskRow, forWrite: boolean): Promise<Vis | null> {
    if (row.deletedAt) return null;
    const s = this.scopeOf(actor);
    const owner = ownerInfo(row.customer);
    if (readsByScope(actor, s, owner)) {
      // Đọc hoạt động của khách đã xoá mềm: như timeline includeDeleted — chỉ người có customer.restore trong phạm vi (§5).
      if (row.customer.deletedAt && !forWrite && !inScope(actor, s('customer.restore'), owner)) return null;
      return { mode: 'SCOPE', owner };
    }
    if (row.customer.deletedAt) return null;
    const acc = await activeTaskAccess(db, actor, s, row.id);
    return acc ? { mode: 'TASK', owner, accessExpiresAt: acc.expiresAt } : null;
  }

  private async loadVisible(actor: Actor, id: string): Promise<{ row: ActivityTaskRow; vis: Vis }> {
    const row = await this.prisma.activity.findUnique({ where: { id }, select: ACTIVITY_TASK_SELECT }) as ActivityTaskRow | null;
    const vis = row ? await this.resolve(this.prisma, actor, row, false) : null;
    if (!row || !vis) throw activityErrors.notFound();
    return { row, vis };
  }

  // Trình bày một hoạt động. SCOPE: thêm cờ assigneeLostAccess + danh sách người đang có quyền theo việc; người liên hệ chỉ hiện khi có
  // contact.read trong phạm vi (rà soát #209 M-1). TASK: chỉ việc + accessExpiresAt (thẻ khách lấy qua /work-card).
  private async present(db: Pick<Tx, 'activityAccess'>, actor: Actor, row: ActivityTaskRow, vis: Vis, extra: Record<string, unknown> = {}) {
    const base = { ...toActivity(row), customer: { id: row.customer.id, code: row.customer.code, name: row.customer.name }, access: vis.mode };
    if (vis.mode === 'TASK') return { ...base, accessExpiresAt: iso(vis.accessExpiresAt ?? null), assigneeLostAccess: false, ...extra };
    const s = this.scopeOf(actor);
    const rows = await activeAccessRows(db, [row.id], new Date());
    const perf = row.performedById ? (await this.access.load(this.prisma, [row.performedById])).get(row.performedById) : undefined;
    const lost = assigneeLost(row.status, row.performedById, vis.owner, perf, rows.some((r) => r.employeeId === row.performedById));
    return {
      ...base,
      contact: inScope(actor, s('contact.read'), vis.owner) ? base.contact : null,
      assigneeLostAccess: lost,
      taskAccesses: rows.map((r) => ({ employee: r.employee, expiresAt: r.expiresAt.toISOString(), grantedById: r.grantedById })),
      ...extra,
    };
  }

  // ───── GET /activities ─────
  async list(ctx: RequestCtx, q: QueryTasksDto) {
    const { actor } = ctx;
    this.need(actor, 'activity.read');
    const s = this.scopeOf(actor);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    if (page * pageSize > MAX_OFFSET_WINDOW) throw activityErrors.validation(['page × pageSize vượt quá ' + MAX_OFFSET_WINDOW + '.']);
    const now = new Date();
    const vis: Prisma.ActivityWhereInput[] = [scopeReadWhere(actor, s)];
    const ta = taskAccessWhere(actor, s, now);
    if (ta) vis.push(ta);
    const filters: Prisma.ActivityWhereInput = {};
    if (q.assignee) filters.performedById = q.assignee === 'me' ? actor.employeeId : q.assignee.toLowerCase();
    if (q.type) filters.type = q.type;
    const due = q.due && q.due !== 'all' ? q.due : null;
    if (due) {
      const tomorrow = vnDayRange(now).end;
      filters.dueAt = due === 'overdue' ? { lt: now } : due === 'today' ? { gte: now, lt: tomorrow } : { gte: tomorrow, lt: new Date(tomorrow.getTime() + 7 * DAY_MS) };
    }
    // Bộ lọc hạn mà không chỉ định trạng thái => chỉ việc OPEN (CHECK ck_activity_status_type: OPEN ⇒ TASK) — trùng định nghĩa chuông §7.
    if (q.status) filters.status = q.status; else if (due) filters.status = 'OPEN';
    // Vị từ phạm vi đọc đặt TRƯỚC, bộ lọc áp sau (AND) — §5: không bao giờ trả việc trên khách ngoài phạm vi.
    const where: Prisma.ActivityWhereInput = { AND: [{ deletedAt: null, customer: { is: { deletedAt: null } } }, { OR: vis }, filters] };
    const order = q.sortOrder ?? 'asc';
    const orderBy: Prisma.ActivityOrderByWithRelationInput[] = (q.sortBy ?? 'dueAt') === 'dueAt'
      ? [{ dueAt: { sort: order, nulls: 'last' } }, { occurredAt: 'desc' }, { code: 'desc' }]
      : [{ occurredAt: order }, { code: order }];
    const { total, rows } = await this.prisma.$transaction(async (tx: Tx) => {
      const total = await tx.activity.count({ where });
      const rows = total === 0 ? [] : await tx.activity.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: ACTIVITY_TASK_SELECT });
      return { total, rows: rows as ActivityTaskRow[] };
    });
    const scoped = rows.filter((r) => readsByScope(actor, s, ownerInfo(r.customer)));
    const accRows = await activeAccessRows(this.prisma, scoped.map((r) => r.id), now);
    const perfIds = [...new Set(scoped.filter((r) => r.status === 'OPEN' && r.performedById).map((r) => r.performedById as string))];
    const perf = await this.access.load(this.prisma, perfIds);
    const items = rows.map((r) => {
      const owner = ownerInfo(r.customer);
      const mode: AccessMode = readsByScope(actor, s, owner) ? 'SCOPE' : 'TASK';
      const a = toActivity(r);
      const lost = mode === 'SCOPE' && assigneeLost(r.status, r.performedById, owner, r.performedById ? perf.get(r.performedById) : undefined, accRows.some((x) => x.activityId === r.id && x.employeeId === r.performedById));
      return { ...a, contact: mode === 'SCOPE' && !inScope(actor, s('contact.read'), owner) ? null : a.contact, customer: { id: r.customer.id, code: r.customer.code, name: r.customer.name }, access: mode, assigneeLostAccess: lost };
    });
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  assertCanReadList(ctx: RequestCtx): void { this.need(ctx.actor, 'activity.read'); }

  // ───── GET /activities/reminders/summary (§7) ─────
  // 3 số đầu: CHỈ TASK OPEN tôi phụ trách, chưa xoá, khách chưa xoá, tôi CÒN đọc được (theo khách hoặc quyền theo việc). Ba nhóm không chồng nhau.
  async summary(ctx: RequestCtx, transfers: { pendingApprovals: number; transferDecisions: number }) {
    const { actor } = ctx;
    this.need(actor, 'activity.read');
    const s = this.scopeOf(actor);
    const now = new Date();
    const vis: Prisma.ActivityWhereInput[] = [scopeReadWhere(actor, s)];
    const ta = taskAccessWhere(actor, s, now);
    if (ta) vis.push(ta);
    const base: Prisma.ActivityWhereInput = { type: 'TASK', status: 'OPEN', performedById: actor.employeeId, deletedAt: null, customer: { is: { deletedAt: null } }, OR: vis };
    const tomorrow = vnDayRange(now).end;
    const [overdue, today, upcoming7d] = await Promise.all([
      this.prisma.activity.count({ where: { ...base, dueAt: { lt: now } } }),
      this.prisma.activity.count({ where: { ...base, dueAt: { gte: now, lt: tomorrow } } }),
      this.prisma.activity.count({ where: { ...base, dueAt: { gte: tomorrow, lt: new Date(tomorrow.getTime() + 7 * DAY_MS) } } }),
    ]);
    return { overdue, today, upcoming7d, ...transfers };
  }

  // ───── GET /activities/:id ─────
  async detail(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    this.needReadOrTask(actor);
    const { row, vis } = await this.loadVisible(actor, id);
    return this.present(this.prisma, actor, row, vis);
  }

  // ───── GET /activities/:id/work-card (§5.4) ─────
  // Thẻ khách tối thiểu: code, name, shortName, address, tên tỉnh, phone; người liên hệ CỦA CHÍNH VIỆC: fullName, title, phone.
  // KHÔNG email, taxId, doanh thu, ghi chú, thẻ, chủ khách, hoạt động khác, người liên hệ khác.
  async workCard(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    this.needReadOrTask(actor);
    const { row } = await this.loadVisible(actor, id);
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: row.customerId }, select: { code: true, name: true, shortName: true, address: true, phone: true, province: { select: { labelVi: true } } } });
    const ct = row.contactId ? await this.prisma.contact.findFirst({ where: { id: row.contactId, deletedAt: null }, select: { fullName: true, title: true, phone: true } }) : null;
    return {
      activity: { id: row.id, code: row.code, type: row.type, status: row.status },
      customer: { code: c.code, name: c.name, shortName: c.shortName, address: c.address, provinceName: c.province ? c.province.labelVi : null, phone: c.phone },
      contact: ct ? { fullName: ct.fullName, title: ct.title, phone: ct.phone } : null,
    };
  }

  // ───── GET /activities/:id/history ─────
  // CHỈ theo phạm vi khách (không qua quyền theo việc §5.4). Trả occurredAt, action, actor{code,fullName}, changes (đã che nội dung).
  async history(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    this.need(actor, 'activity.read');
    const { vis } = await this.loadVisible(actor, id);
    if (vis.mode !== 'SCOPE') throw activityErrors.notFound();
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'activity', entityId: id }, orderBy: { id: 'asc' }, take: HISTORY_MAX,
      select: { occurredAt: true, action: true, changes: true, actor: { select: { code: true, fullName: true } } },
    });
    return { items: rows.map((r) => ({ occurredAt: r.occurredAt.toISOString(), action: r.action, actor: r.actor ? { code: r.actor.code, fullName: r.actor.fullName } : null, changes: r.changes ?? null })) };
  }

  // ───── khung ghi chung ─────
  private async write<T>(ctx: RequestCtx, id: string, fn: (tx: Tx, row: ActivityTaskRow, vis: Vis, w: WriteCtx) => Promise<T>): Promise<T> {
    const { actor } = ctx;
    try {
      return await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
        const row = await lockActivity(tx, id);
        const vis = row ? await this.resolve(tx, actor, row, true) : null;
        if (!row || !vis) throw activityErrors.notFound();
        if (row.customer.deletedAt) throw activityErrors.customerDeleted();
        const w: WriteCtx = { tx, audit: this.audit, actorId: actor.employeeId, requestId: ctx.requestId, activity: { id: row.id, code: row.code, type: row.type } };
        await sweepStaleAccess(w, this.access); // §5.4: ROLE_LOST/EXPIRED ở lần ghi kế tiếp do người khác thực hiện
        return fn(tx, row, vis, w);
      }, { maxWait: 5000, timeout: 20000 });
    } catch (e) {
      throw mapError(e);
    }
  }

  private canEditByScope(actor: Actor, row: ActivityTaskRow, owner: OwnerInfo): boolean {
    const s = this.scopeOf(actor);
    if (inScope(actor, s('activity.update'), owner)) return true;
    return inScope(actor, s('activity.update_own'), owner) && (row.createdById === actor.employeeId || row.performedById === actor.employeeId);
  }

  private async bump(tx: Tx, actor: Actor, row: ActivityTaskRow, version: number, data: Prisma.ActivityUncheckedUpdateManyInput): Promise<void> {
    const r = await tx.activity.updateMany({ where: { id: row.id, version, deletedAt: null }, data: { ...data, updatedById: actor.employeeId, version: { increment: 1 } } });
    if (r.count !== 1) throw activityErrors.versionConflict(row.version);
  }

  private async reload(tx: Tx, id: string): Promise<ActivityTaskRow> {
    return await tx.activity.findUniqueOrThrow({ where: { id }, select: ACTIVITY_TASK_SELECT }) as ActivityTaskRow;
  }

  private async audit1(w: WriteCtx, action: string, summary: string, changes: Record<string, unknown>): Promise<void> {
    await this.audit.record(w.tx, { action, entityType: 'activity', entityId: w.activity.id, entityCode: w.activity.code, summary, changes, actorEmployeeId: w.actorId, requestId: w.requestId });
  }

  // Đổi người phụ trách (assign, PATCH performedById, duyệt đề xuất): cập nhật đã xong ở nơi gọi; ở đây thu hồi quyền theo việc cũ (REASSIGNED),
  // rút đề xuất chờ (trừ khi đang duyệt chính đề xuất đó), cấp quyền mới khi giao ra ngoài phạm vi, ghi activity.assign.
  private async afterReassign(w: WriteCtx, from: string | null, to: string, kind: 'INTERNAL' | 'EXTERNAL', extra: Record<string, unknown> = {}, withdraw = true): Promise<void> {
    await revokeAccess(w, 'REASSIGNED');
    if (withdraw) await withdrawPendingTransfers(w);
    await this.audit1(w, 'activity.assign', 'Giao hoạt động ' + w.activity.code + ' (' + w.activity.type + ')', { performedById: [from, to], ...extra });
    if (kind === 'EXTERNAL') await grantAccess(w, to);
  }

  // Rà soát độc lập A6 I-1: "giao lại" CHÍNH người đang phụ trách với external=true => cấp lại quyền theo việc khi TASK OPEN và người đó
  // KHÔNG còn dòng quyền hiệu lực (hết hạn / thu hồi thủ công / mở lại / ROLE_LOST rồi được gán lại vai trò). Còn quyền hoặc đọc được khách => không làm gì.
  private async regrantSelf(tx: Tx, actor: Actor, row: ActivityTaskRow, vis: Vis, to: string): Promise<boolean> {
    if (row.type !== 'TASK' || row.status !== 'OPEN') return false;
    if ((await activeAccessRows(tx, [row.id], new Date())).some((r) => r.employeeId === to)) return false;
    return planAssignment(actor, this.scopeOf(actor), vis.owner, (await this.access.load(tx, [to])).get(to), { external: true, openTask: true }) === 'EXTERNAL';
  }

  // ───── PATCH /activities/:id ─────
  async update(ctx: RequestCtx, id: string, dto: UpdateActivityDto) {
    const { actor } = ctx;
    const s = this.scopeOf(actor);
    if (!s('activity.update') && !s('activity.update_own')) throw activityErrors.forbidden();
    const touched = (['title', 'content', 'outcome', 'occurredAt', 'dueAt', 'remindAt', 'contactId', 'performedById', 'status', 'external'] as const).filter((k) => dto[k] !== undefined);
    if (!touched.length) throw activityErrors.validation(['Không có trường nào để cập nhật.']);
    return this.write(ctx, id, async (tx, row, vis, w) => {
      if (vis.mode === 'TASK') {
        // §5.4: người CHỈ có quyền theo việc chỉ sửa kết quả (outcome) — trường khác => 403, dù có activity.update_own.
        if (touched.some((k) => k !== 'outcome')) throw activityErrors.forbidden('Bạn chỉ được cập nhật kết quả của công việc được giao.');
      } else if (!this.canEditByScope(actor, row, vis.owner)) {
        throw activityErrors.forbidden();
      }
      if (row.version !== dto.version) throw activityErrors.versionConflict(row.version);

      const isTask = row.type === 'TASK';
      const errs: string[] = [];
      const data: Prisma.ActivityUncheckedUpdateManyInput = {};
      const changes: Record<string, unknown> = {};
      if (dto.title !== undefined) { const v = dto.title ? dto.title : null; if (v !== row.title) { data.title = v; changes.title = AUDIT_REDACTED_TEXT; } }
      if (dto.content !== undefined && dto.content !== row.content) { data.content = dto.content; changes.content = AUDIT_REDACTED_TEXT; }
      if (dto.outcome !== undefined) { const v = dto.outcome ? dto.outcome : null; if (v !== row.outcome) { data.outcome = v; changes.outcome = AUDIT_REDACTED_TEXT; } }
      if (dto.occurredAt !== undefined) {
        if (isTask) errs.push('Công việc (TASK) không sửa được occurredAt.');
        else {
          const at = parseInstant(dto.occurredAt, 'occurredAt', errs);
          if (at && row.type !== 'MEETING' && at.getTime() > Date.now() + DAY_MS) errs.push('Thời điểm diễn ra không được quá 1 ngày sau hiện tại (trừ lịch hẹn MEETING).');
          if (at && at.getTime() !== row.occurredAt.getTime()) { data.occurredAt = at; changes.occurredAt = [iso(row.occurredAt), iso(at)]; }
        }
      }
      let newDue = row.dueAt;
      if (dto.dueAt !== undefined) {
        if (dto.dueAt === null) { if (isTask) errs.push('Công việc (TASK) phải có hạn (dueAt).'); else newDue = null; }
        else { const d = parseInstant(dto.dueAt, 'dueAt', errs); if (d) newDue = d; }
      }
      let newRemind = row.remindAt;
      if (dto.remindAt !== undefined) {
        if (dto.remindAt === null) newRemind = null;
        else { const d = parseInstant(dto.remindAt, 'remindAt', errs); if (d) newRemind = d; }
      }
      if (newDue && newRemind && newRemind.getTime() > newDue.getTime()) errs.push('Thời điểm nhắc phải không sau hạn.');
      const dueChanged = iso(newDue) !== iso(row.dueAt);
      if (dueChanged) { data.dueAt = newDue; changes.dueAt = [iso(row.dueAt), iso(newDue)]; }
      if (iso(newRemind) !== iso(row.remindAt)) { data.remindAt = newRemind; changes.remindAt = [iso(row.remindAt), iso(newRemind)]; }
      const cancel = dto.status === 'CANCELLED';
      if (cancel) { if (!isTask) throw activityErrors.notTask(); if (row.status !== 'OPEN') throw activityErrors.notOpen(); }
      if (errs.length) throw activityErrors.validation(errs);
      if (dto.contactId !== undefined) {
        const v = dto.contactId ? dto.contactId.toLowerCase() : null;
        if (v && !(await tx.contact.findFirst({ where: { id: v, customerId: row.customerId, deletedAt: null }, select: { id: true } }))) throw activityErrors.contactMismatch();
        if (v !== row.contactId) { data.contactId = v; changes.contactId = [row.contactId, v]; }
      }
      // Đổi người phụ trách qua PATCH => cần activity.assign (+ assign_external khi external=true và người nhận ngoài phạm vi).
      const to = dto.performedById ? dto.performedById.toLowerCase() : null;
      let kind: 'INTERNAL' | 'EXTERNAL' | null = null;
      if (to && to !== row.performedById) {
        kind = planAssignment(actor, s, vis.owner, (await this.access.load(tx, [to])).get(to), { external: dto.external === true, openTask: isTask && row.status === 'OPEN' && !cancel });
        data.performedById = to;
      }
      const regrant = !!to && to === row.performedById && dto.external === true && !cancel && vis.mode === 'SCOPE' && await this.regrantSelf(tx, actor, row, vis, to);
      if (cancel) { data.status = 'CANCELLED'; data.completedAt = null; data.completedById = null; }
      if (!Object.keys(data).length && !regrant) return this.present(tx, actor, row, vis); // không có gì đổi: trả nguyên trạng, không tăng version

      // UPDATE activity TRƯỚC (rà soát lần 8: due_at mới phải có trước câu INSERT … SELECT a.due_at).
      await this.bump(tx, actor, row, dto.version, data);
      if (Object.keys(changes).length) await this.audit1(w, 'activity.update', 'Cập nhật hoạt động ' + row.code + ' (' + row.type + ')', changes);
      if (kind && to) await this.afterReassign(w, row.performedById, to, kind);
      let accessExpiresAt: string | undefined;
      if (cancel) {
        await revokeAccess(w, 'CANCELLED');
        await withdrawPendingTransfers(w);
        await this.audit1(w, 'activity.cancel', 'Huỷ công việc ' + row.code, { status: ['OPEN', 'CANCELLED'] });
      } else if (dueChanged && isTask && row.status === 'OPEN' && !kind) {
        // §5.4 đổi hạn: quyền theo việc còn hiệu lực + người PATCH có assign_external trong phạm vi khách => thu hồi DUE_CHANGED + cấp lại theo hạn mới.
        // Không có assign_external => giữ nguyên quyền cũ, trả accessExpiresAt để giao diện cảnh báo (không gia hạn ngầm).
        const holders = (await activeAccessRows(tx, [row.id], new Date())).filter((r) => r.employeeId !== actor.employeeId);
        if (holders.length) {
          if (vis.mode === 'SCOPE' && inScope(actor, s('activity.assign_external'), vis.owner)) {
            for (const h of holders) { const g = await grantAccess(w, h.employeeId, 'DUE_CHANGED'); accessExpiresAt = g.expiresAt.toISOString(); }
          } else {
            accessExpiresAt = holders[0].expiresAt.toISOString();
          }
        }
      }
      if (regrant && to) accessExpiresAt = (await grantAccess(w, to)).expiresAt.toISOString();
      return this.present(tx, actor, await this.reload(tx, row.id), vis, accessExpiresAt ? { accessExpiresAt } : {});
    });
  }

  // ───── POST /activities/:id/assign ─────
  async assign(ctx: RequestCtx, id: string, dto: AssignActivityDto) {
    const { actor } = ctx;
    this.need(actor, 'activity.assign');
    const s = this.scopeOf(actor);
    const to = dto.performedById.toLowerCase();
    return this.write(ctx, id, async (tx, row, vis, w) => {
      if (vis.mode !== 'SCOPE') throw activityErrors.forbidden(); // người chỉ có quyền theo việc KHÔNG giao lại (§5.4)
      if (!inScope(actor, s('activity.assign'), vis.owner)) throw activityErrors.forbidden();
      if (row.version !== dto.version) throw activityErrors.versionConflict(row.version);
      if (to === row.performedById) {
        // I-1: external=true + mất quyền theo việc => cấp lại (version+1, audit access_grant; không audit assign vì người phụ trách không đổi).
        if (dto.external === true && await this.regrantSelf(tx, actor, row, vis, to)) {
          await this.bump(tx, actor, row, dto.version, {});
          await grantAccess(w, to);
          return this.present(tx, actor, await this.reload(tx, row.id), vis);
        }
        return this.present(tx, actor, row, vis); // đã là người phụ trách và không cần cấp lại: không đổi gì
      }
      const kind = planAssignment(actor, s, vis.owner, (await this.access.load(tx, [to])).get(to), { external: dto.external === true, openTask: row.type === 'TASK' && row.status === 'OPEN' });
      await this.bump(tx, actor, row, dto.version, { performedById: to });
      await this.afterReassign(w, row.performedById, to, kind);
      return this.present(tx, actor, await this.reload(tx, row.id), vis);
    });
  }

  // ───── POST /activities/:id/complete ─────
  // activity.update / activity.update_own (mình tạo/được giao) / performed_by = tôi — luôn áp lại phạm vi đọc HOẶC quyền theo việc.
  async complete(ctx: RequestCtx, id: string, dto: CompleteActivityDto) {
    const { actor } = ctx;
    this.needReadOrTask(actor); // rà soát A6 M-1: không có quyền hoạt động nào => 403 (không 404)
    return this.write(ctx, id, async (tx, row, vis, w) => {
      const mine = row.performedById === actor.employeeId;
      const ok = vis.mode === 'TASK' ? mine : (mine || this.canEditByScope(actor, row, vis.owner));
      if (!ok) throw activityErrors.forbidden();
      if (row.type !== 'TASK') throw activityErrors.notTask();
      if (row.status !== 'OPEN') throw activityErrors.notOpen();
      if (row.version !== dto.version) throw activityErrors.versionConflict(row.version);
      const data: Prisma.ActivityUncheckedUpdateManyInput = { status: 'DONE', completedAt: new Date(), completedById: actor.employeeId };
      const changes: Record<string, unknown> = { status: ['OPEN', 'DONE'] };
      if (dto.outcome !== undefined) { const v = dto.outcome ? dto.outcome : null; if (v !== row.outcome) { data.outcome = v; changes.outcome = AUDIT_REDACTED_TEXT; } }
      await this.bump(tx, actor, row, dto.version, data);
      await this.audit1(w, 'activity.complete', 'Hoàn thành công việc ' + row.code, changes);
      await revokeAccess(w, 'COMPLETED');
      await withdrawPendingTransfers(w);
      const fresh = await this.reload(tx, row.id);
      // Người chỉ có quyền theo việc: quyền vừa hết cùng transaction => trả bản tối thiểu (không gọi lại present theo SCOPE).
      return vis.mode === 'TASK' ? { ...toActivity(fresh), customer: { id: fresh.customer.id, code: fresh.customer.code, name: fresh.customer.name }, access: 'TASK' as const, accessExpiresAt: null, assigneeLostAccess: false } : this.present(tx, actor, fresh, vis);
    });
  }

  // ───── POST /activities/:id/reopen ─────
  async reopen(ctx: RequestCtx, id: string, dto: VersionDto) {
    const { actor } = ctx;
    const s = this.scopeOf(actor);
    if (!s('activity.update') && !s('activity.update_own')) throw activityErrors.forbidden();
    return this.write(ctx, id, async (tx, row, vis, w) => {
      if (vis.mode !== 'SCOPE' || !this.canEditByScope(actor, row, vis.owner)) throw activityErrors.forbidden();
      if (row.type !== 'TASK') throw activityErrors.notTask();
      if (row.status === 'OPEN') throw activityErrors.alreadyOpen();
      if (row.version !== dto.version) throw activityErrors.versionConflict(row.version);
      await this.bump(tx, actor, row, dto.version, { status: 'OPEN', completedAt: null, completedById: null });
      await this.audit1(w, 'activity.reopen', 'Mở lại công việc ' + row.code, { status: [row.status, 'OPEN'] });
      return this.present(tx, actor, await this.reload(tx, row.id), vis);
    });
  }

  // ───── DELETE /activities/:id (xoá mềm, chỉ crm_admin) ─────
  async remove(ctx: RequestCtx, id: string, dto: DeleteActivityDto) {
    const { actor } = ctx;
    const delScope = this.need(actor, 'activity.delete');
    const reason = dto.reason ? dto.reason : null;
    return this.write(ctx, id, async (tx, row, vis, w) => {
      if (vis.mode !== 'SCOPE' || !inScope(actor, delScope, vis.owner)) throw activityErrors.forbidden();
      const r = await tx.activity.updateMany({ where: { id: row.id, deletedAt: null }, data: { deletedAt: new Date(), deletedById: actor.employeeId, updatedById: actor.employeeId, version: { increment: 1 } } });
      if (r.count !== 1) throw activityErrors.notFound();
      await this.audit1(w, 'activity.delete', 'Xoá mềm hoạt động ' + row.code + ' (' + row.type + ')', reason ? { reason: AUDIT_REDACTED_TEXT } : {});
      await revokeAccess(w, 'DELETED');
      await withdrawPendingTransfers(w);
      return { id: row.id, code: row.code, deleted: true };
    });
  }

  // ───── POST /activities/:id/access/revoke (thu hồi thủ công §5.4) ─────
  // Người có activity.assign trong phạm vi khách (chủ khách hiện tại / crm_admin). Không có dòng còn hiệu lực => 404.
  async revokeTaskAccess(ctx: RequestCtx, id: string, dto: RevokeAccessDto) {
    const { actor } = ctx;
    this.need(actor, 'activity.assign');
    const s = this.scopeOf(actor);
    const emp = dto.employeeId.toLowerCase();
    return this.write(ctx, id, async (tx, row, vis, w) => {
      if (vis.mode !== 'SCOPE' || !inScope(actor, s('activity.assign'), vis.owner)) throw activityErrors.forbidden();
      const rows = await revokeAccess(w, 'MANUAL', emp);
      if (!rows.length) throw activityErrors.notFound();
      return this.present(tx, actor, await this.reload(tx, row.id), vis);
    });
  }
}

// Khoá: khách FOR SHARE (chặn xoá mềm/sửa khách song song) rồi hoạt động FOR UPDATE; sau đó đọc dòng đầy đủ. Không tồn tại => null.
export async function lockActivity(tx: Tx, id: string): Promise<ActivityTaskRow | null> {
  const c = await tx.$queryRaw<{ id: string }[]>`SELECT c.id FROM customer c WHERE c.id = (SELECT a.customer_id FROM activity a WHERE a.id = ${id}::uuid) FOR SHARE`;
  if (!c.length) return null;
  const a = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM activity WHERE id = ${id}::uuid FOR UPDATE`;
  if (!a.length) return null;
  return await tx.activity.findUnique({ where: { id }, select: ACTIVITY_TASK_SELECT }) as ActivityTaskRow | null;
}

export function mapError(e: unknown): unknown {
  if (e instanceof DomainException) return e;
  const m = mapPrismaError(e);
  if (m) return m.code === 'CUSTOMER_BUSY' ? activityErrors.busy() : m.code === 'CUSTOMER_NOT_FOUND' ? activityErrors.notFound() : m;
  return e;
}
