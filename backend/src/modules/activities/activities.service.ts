import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, Permission, RequestCtx, Scope } from '../../common/auth/actor';
import { inScope, OwnerInfo } from '../../common/auth/scope';
import { AUDIT_REDACTED_TEXT } from '../../common/audit/db-audit.port';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { DomainException } from '../../common/errors/domain.exception';
import { mapPrismaError } from '../../common/errors/prisma-error.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import { EMPLOYEE_ACCESS, EmployeeAccessReader } from './activities.employee-access';
import { activityErrors } from './activities.errors';
import { ACTIVITY_SELECT, ActivityRow, toActivity } from './activities.mapper';
import { vnDateFilter } from './activities.time';
import { CreateActivityDto, TECH_TYPES } from './dto/create-activity.dto';
import type { QueryTimelineDto } from './dto/query-activities.dto';

type Tx = Prisma.TransactionClient;
const CUSTOMER_PICK = { id: true, code: true, deletedAt: true, ownerId: true, owner: { select: { departmentId: true } } } as const;
const ownerInfo = (r: { ownerId: string | null; owner: { departmentId: string | null } | null }): OwnerInfo => ({ ownerId: r.ownerId, ownerDepartmentId: r.owner ? r.owner.departmentId : null });
const MAX_OFFSET_WINDOW = 100000;
const CANDIDATES_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
// Rà soát #209 I-1: khoảng năm hợp lý cho mốc nghiệp vụ (chặn 9999, 0001...). Ngoài khoảng / không đọc được => 400, không bao giờ 500.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
function parseInstant(v: string | undefined, field: string, errs: string[]): Date | null {
  if (v === undefined) return null;
  const d = new Date(v);
  const y = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || y < MIN_YEAR || y > MAX_YEAR) { errs.push(field + ' không phải thời điểm hợp lệ (năm ' + MIN_YEAR + '–' + MAX_YEAR + ').'); return null; }
  return d;
}

// B3 A5 (docs/B3_ACTIVITIES_DESIGN.md §5, §6): timeline theo khách, tạo hoạt động, ứng viên người phụ trách NỘI BỘ.
// Quy tắc: không có quyền => 403; khách ngoài phạm vi đọc => 404 (không lộ tồn tại); trong phạm vi đọc nhưng thiếu phạm vi ghi => 403.
// Phạm vi xem hoạt động = phạm vi RBAC V2 trên KHÁCH (không nới vì được giao). Giao việc ra NGOÀI phạm vi (activity_access) thuộc A6.
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EMPLOYEE_ACCESS) private readonly access: EmployeeAccessReader,
  ) {}

  private scope(actor: Actor, p: Permission): Scope | null { return this.actors.scopeFor(actor, p); }
  private need(actor: Actor, p: Permission): Scope {
    const s = this.scope(actor, p);
    if (!s) throw activityErrors.forbidden();
    return s;
  }

  async timeline(ctx: RequestCtx, customerId: string, q: QueryTimelineDto) {
    const { actor } = ctx;
    const actRead = this.need(actor, 'activity.read');
    const custRead = this.need(actor, 'customer.read');
    const includeDeleted = q.includeDeleted === 'true';
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    if (page * pageSize > MAX_OFFSET_WINDOW) throw activityErrors.validation(['page × pageSize vượt quá ' + MAX_OFFSET_WINDOW + '.']);
    const range = vnDateFilter(q.from, q.to);
    if (!range) throw activityErrors.validation(['from/to không phải ngày hợp lệ.']);
    if (range.gte && range.lt && range.gte >= range.lt) throw activityErrors.validation(['from phải không sau to.']);

    const cust = await this.prisma.customer.findFirst({ where: { id: customerId }, select: CUSTOMER_PICK });
    if (!cust) throw activityErrors.customerNotFound();
    const owner = ownerInfo(cust);
    if (!inScope(actor, custRead, owner) || !inScope(actor, actRead, owner)) throw activityErrors.customerNotFound();
    if (cust.deletedAt) {
      // Khách đã xoá mềm: đường đọc MỚI, chỉ khi xin tường minh includeDeleted=true VÀ có customer.restore trong phạm vi (N6 của customers).
      if (!includeDeleted || !inScope(actor, this.scope(actor, 'customer.restore'), owner)) throw activityErrors.customerNotFound();
    }

    const where: Prisma.ActivityWhereInput = {
      customerId, deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(range.gte || range.lt ? { occurredAt: range } : {}),
    };
    const order = q.sortOrder ?? 'desc';
    const orderBy: Prisma.ActivityOrderByWithRelationInput[] = q.sortBy === 'dueAt'
      ? [{ dueAt: { sort: order, nulls: 'last' } }, { occurredAt: 'desc' }, { code: 'desc' }]
      : [{ occurredAt: order }, { code: order }];
    const { total, rows } = await this.prisma.$transaction(async (tx: Tx) => {
      const total = await tx.activity.count({ where });
      const rows = total === 0 ? [] : await tx.activity.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: ACTIVITY_SELECT });
      return { total, rows: rows as ActivityRow[] };
    });
    return { items: rows.map(toActivity), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  async create(ctx: RequestCtx, customerId: string, dto: CreateActivityDto) {
    const { actor } = ctx;
    const createScope = this.scope(actor, 'activity.create');
    const techScope = this.scope(actor, 'activity.create_tech');
    if (!createScope && !techScope) throw activityErrors.forbidden();
    const custRead = this.need(actor, 'customer.read');

    const isTask = dto.type === 'TASK';
    const now = new Date();
    const errs: string[] = [];
    const due = parseInstant(dto.dueAt, 'dueAt', errs);
    const remind = parseInstant(dto.remindAt, 'remindAt', errs);
    let occurredAt = now;
    if (isTask) {
      if (dto.occurredAt !== undefined) errs.push('Công việc (TASK) không nhận occurredAt — máy chủ đặt bằng thời điểm tạo.');
      if (!due && dto.dueAt === undefined) errs.push('Công việc (TASK) phải có hạn (dueAt).');
    } else if (dto.occurredAt !== undefined) {
      const at = parseInstant(dto.occurredAt, 'occurredAt', errs);
      if (at) {
        occurredAt = at;
        if (dto.type !== 'MEETING' && occurredAt.getTime() > now.getTime() + DAY_MS) errs.push('Thời điểm diễn ra không được quá 1 ngày sau hiện tại (trừ lịch hẹn MEETING).');
      }
    }
    if (due && remind && remind.getTime() > due.getTime()) errs.push('Thời điểm nhắc phải không sau hạn.');
    if (errs.length) throw activityErrors.validation(errs);
    const title = dto.title ? dto.title : null;
    const outcome = dto.outcome ? dto.outcome : null;
    // Rà soát #209 M-4: UUID so sánh không phân biệt hoa/thường (IsUUID nhận chữ hoa) — chuẩn hoá chữ thường như PostgreSQL trả về.
    const performedById = (dto.performedById ?? actor.employeeId).toLowerCase();
    const assigningOther = performedById !== actor.employeeId.toLowerCase();
    const contactId = dto.contactId ? dto.contactId.toLowerCase() : null;

    try {
      return await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
        // Khoá dòng khách TRƯỚC (cùng thứ tự với module khách hàng) rồi mới kiểm lại trạng thái.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer WHERE id = ${customerId}::uuid FOR UPDATE`;
        if (!locked.length) throw activityErrors.customerNotFound();
        const cust = await tx.customer.findFirst({ where: { id: customerId }, select: CUSTOMER_PICK });
        if (!cust) throw activityErrors.customerNotFound();
        const owner = ownerInfo(cust);
        if (!inScope(actor, custRead, owner)) throw activityErrors.customerNotFound();
        if (cust.deletedAt) throw activityErrors.customerDeleted();
        // activity.create: 6 loại; activity.create_tech: chỉ SITE_SURVEY/NOTE/TASK. Cả hai theo phạm vi CHỦ KHÁCH (không cần customer.update).
        const full = inScope(actor, createScope, owner);
        const tech = inScope(actor, techScope, owner);
        if (!full) {
          if (!tech) throw activityErrors.forbidden();
          if (!TECH_TYPES.includes(dto.type)) throw activityErrors.typeNotAllowed();
        }
        if (contactId) {
          const ct = await tx.contact.findFirst({ where: { id: contactId, customerId, deletedAt: null }, select: { id: true } });
          if (!ct) throw activityErrors.contactMismatch();
        }
        if (assigningOther) await this.assertAssignee(tx, actor, owner, performedById);

        const row = await tx.activity.create({
          data: {
            customerId, contactId, type: dto.type, title, content: dto.content, outcome,
            occurredAt, dueAt: due, remindAt: remind, status: isTask ? 'OPEN' : 'DONE', performedById,
            createdById: actor.employeeId, updatedById: actor.employeeId,
          },
          select: ACTIVITY_SELECT,
        }) as ActivityRow;
        // Nhật ký: chỉ mã + loại trong summary; title/content/outcome ghi "(đã thay đổi)" (SENSITIVE_KEYS chặn nếu sơ suất).
        const iso = (d: Date | null) => (d ? d.toISOString() : null);
        await this.audit.record(tx, {
          action: 'activity.create', entityType: 'activity', entityId: row.id, entityCode: row.code,
          summary: 'Tạo hoạt động ' + row.code + ' (' + row.type + ') cho khách hàng ' + cust.code,
          changes: {
            type: [null, row.type], status: [null, row.status], occurredAt: [null, iso(row.occurredAt)], dueAt: [null, iso(row.dueAt)], remindAt: [null, iso(row.remindAt)],
            contactId: [null, row.contactId], performedById: [null, row.performedById], customerId: [null, customerId],
            content: AUDIT_REDACTED_TEXT, ...(title ? { title: AUDIT_REDACTED_TEXT } : {}), ...(outcome ? { outcome: AUDIT_REDACTED_TEXT } : {}),
          },
          actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
        });
        // Giao cho người khác ngay lúc tạo => thêm MỘT dòng activity.assign (thiết kế §6 POST).
        if (assigningOther) {
          await this.audit.record(tx, {
            action: 'activity.assign', entityType: 'activity', entityId: row.id, entityCode: row.code,
            summary: 'Giao hoạt động ' + row.code + ' (' + row.type + ')', changes: { performedById: [actor.employeeId, performedById] },
            actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
          });
        }
        return toActivity(row);
      }, { maxWait: 5000, timeout: 20000 });
    } catch (e) {
      if (e instanceof DomainException) throw e;
      const m = mapPrismaError(e);
      if (m) throw m.code === 'CUSTOMER_BUSY' ? activityErrors.busy() : m;
      throw e;
    }
  }

  // Người nhận: tồn tại + ACTIVE; cùng phòng với người giao (phạm vi activity.assign = ALL: mọi phòng); ĐỌC ĐƯỢC khách (customer.read ∧
  // activity.read của CHÍNH người nhận theo vai trò trong DB). Người giao phải có activity.assign trong phạm vi khách.
  private async assertAssignee(tx: Tx, actor: Actor, owner: OwnerInfo, assigneeId: string): Promise<void> {
    const assignScope = this.scope(actor, 'activity.assign');
    if (!inScope(actor, assignScope, owner)) throw activityErrors.forbidden('Không có quyền giao việc cho người khác trên khách hàng này.');
    const a = (await this.access.load(tx, [assigneeId])).get(assigneeId);
    if (!a || !a.active) throw activityErrors.assigneeInvalid();
    if (assignScope !== 'ALL' && (actor.departmentId === null || a.departmentId !== actor.departmentId)) throw activityErrors.assigneeInvalid();
    if (!readsCustomer(a, owner)) throw activityErrors.assigneeNoAccess();
  }

  // Ứng viên NỘI BỘ: ACTIVE, chưa xoá; cùng phòng với người gọi (phạm vi activity.assign = ALL: mọi phòng); ĐỌC ĐƯỢC khách.
  async assigneeCandidates(ctx: RequestCtx, customerId: string) {
    const { actor } = ctx;
    const assignScope = this.need(actor, 'activity.assign');
    const custRead = this.need(actor, 'customer.read');
    const cust = await this.prisma.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: CUSTOMER_PICK });
    if (!cust) throw activityErrors.customerNotFound();
    const owner = ownerInfo(cust);
    if (!inScope(actor, custRead, owner)) throw activityErrors.customerNotFound();
    if (!inScope(actor, assignScope, owner)) throw activityErrors.forbidden();
    const where: Prisma.EmployeeWhereInput = { status: 'ACTIVE', deletedAt: null,
      ...(assignScope === 'ALL' ? {} : actor.departmentId ? { departmentId: actor.departmentId } : { id: actor.employeeId }) };
    // Rà soát #209 M-3: lọc "đọc được khách" TRƯỚC rồi mới cắt CANDIDATES_MAX (không bỏ sót người đủ điều kiện khi công ty > 500 người).
    const rows = await this.prisma.employee.findMany({
      where, select: { id: true, code: true, fullName: true, department: { select: { code: true } } },
      orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
    });
    const acc = await this.access.load(this.prisma, rows.map((r) => r.id));
    const items = rows.filter((r) => { const a = acc.get(r.id); return !!a && a.active && readsCustomer(a, owner); })
      .slice(0, CANDIDATES_MAX)
      .map((r) => ({ id: r.id, code: r.code, fullName: r.fullName, departmentCode: r.department ? r.department.code : null }));
    return { items };
  }
}

function readsCustomer(a: { id: string; departmentId: string | null; scopes: Readonly<Partial<Record<Permission, Scope>>> }, owner: OwnerInfo): boolean {
  const who: Actor = { employeeId: a.id, departmentId: a.departmentId };
  return inScope(who, a.scopes['customer.read'] ?? null, owner) && inScope(who, a.scopes['activity.read'] ?? null, owner);
}
