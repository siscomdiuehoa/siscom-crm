import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { AUDIT_REDACTED_TEXT } from '../../common/audit/db-audit.port';
import { ASSIGNEE_ELIGIBILITY, AssigneeEligibility } from '../../common/auth/assignee-eligibility';
import { inScope } from '../../common/auth/scope';
import { DomainException } from '../../common/errors/domain.exception';
import { mapPrismaError } from '../../common/errors/prisma-error.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import { OPPORTUNITY_AUTO_TASKS, OpportunityAutoTasks } from '../activities/activities.opportunity-tasks';
import { OPPORTUNITY_STAGE } from '../lookups/sales.catalog';
import {
  allowsCreate, assertAssignee, assertMayLoadDeleted, assertRestorable, assertWrite, hasAssignedReadCode, OppRef, OppWriteCode, readsFull, ScopeOf,
} from './opportunities.access';
import { OPP_EMPLOYEE_ACCESS, OppEmployeeAccessReader } from './opportunities.employee-access';
import { resolvePath } from './opportunities.task-path';
import { opportunityErrors } from './opportunities.errors';
import { defaultProbability, FieldError, isConstructionType, ruleViolations } from './opportunities.rules';
import { OpportunitiesService } from './opportunities.service';
import type { AssignOpportunityDto, CreateOpportunityDto, DeleteOpportunityDto, MoveStageDto, RestoreOpportunityDto, UpdateOpportunityDto } from './dto/write-opportunity.dto';

type Tx = Prisma.TransactionClient;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// Dòng cơ hội mà đường ghi cần: căn cứ quyền + mọi trường sửa được + mã giai đoạn / loại (luật R-S chỉ theo MÃ).
const W_SELECT = {
  id: true, code: true, version: true, status: true, ownerId: true, deletedAt: true, title: true, needSummary: true, typeId: true, stageId: true,
  isProjectLinked: true, projectName: true, offerScope: true, contactId: true, expectedAmountVnd: true, probability: true, probabilityOverridden: true,
  expectedCloseDate: true, customerId: true, holdUntil: true, holdReason: true,
  type: { select: { code: true } }, stage: { select: { code: true } },
  customer: { select: { ownerId: true, deletedAt: true, owner: { select: { departmentId: true } } } },
} as const;
export interface WRow {
  id: string; code: string; version: number; status: string; ownerId: string; deletedAt: Date | null; title: string; needSummary: string | null; typeId: string; stageId: string;
  isProjectLinked: boolean; projectName: string | null; offerScope: string | null; contactId: string | null; expectedAmountVnd: bigint | null; probability: number;
  probabilityOverridden: boolean; expectedCloseDate: Date | null; customerId: string; holdUntil: Date | null; holdReason: string | null;
  type: { code: string }; stage: { code: string }; customer: { ownerId: string | null; deletedAt: Date | null; owner: { departmentId: string | null } | null };
}
const refOf = (r: WRow): OppRef => ({ ownerId: r.ownerId, deletedAt: r.deletedAt, customer: { ownerId: r.customer.ownerId, deletedAt: r.customer.deletedAt } });

// Trường văn bản tuỳ chọn: undefined = không gửi; null / '' / toàn khoảng trắng = xoá; còn lại = đã bỏ khoảng trắng hai đầu.
const text = (v: string | null | undefined): string | null | undefined => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());
const amountOf = (v: string | null | undefined): bigint | null | undefined => (v === undefined ? undefined : v === null || v === '' ? null : BigInt(v));
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
// Ngày YYYY-MM-DD cho cột DATE. Ngày không có thật hoặc ngoài khoảng năm => ghi lỗi theo trường.
function dateOf(v: string | null | undefined, field: string, errs: FieldError[]): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v + 'T00:00:00.000Z');
  const y = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || y < MIN_YEAR || y > MAX_YEAR) { errs.push({ field, message: 'Ngày không hợp lệ (năm ' + MIN_YEAR + '–' + MAX_YEAR + ').' }); return undefined; }
  return d;
}
const str = (v: bigint | number | null): string | null => (v === null ? null : String(v));

// Sales S7 (docs/SALES_DESIGN.md §6.1–6.3, §6.10, §6.12, §7) — GHI cơ hội: tạo, sửa trường, đổi giai đoạn. Tạm hoãn / Thắng / Thua / chuyển người
// phụ trách / mở lại / xoá mềm thuộc S8.
// Quyền: mỗi thao tác kiểm ĐÚNG mã của nó (create theo KHÁCH; update / move_stage theo người phụ trách CƠ HỘI) qua opportunities.access.
//   Không thấy được => 404; thấy được nhưng thiếu mã / ngoài điều kiện => 403.
// Đồng bộ (cùng thứ tự với module Hoạt động): khoá dòng KHÁCH FOR SHARE (chặn chuyển chủ / xoá mềm khách song song) rồi dòng CƠ HỘI FOR UPDATE,
//   SAU ĐÓ mới đọc lại dòng và kiểm quyền => căn cứ quyền không thể đổi giữa lúc kiểm và lúc ghi. Ghi theo version (khoá lạc quan): lệch => 409.
// Nguyên tử: cập nhật cơ hội + dòng lịch sử opportunity_change + nhật ký trong MỘT transaction; lỗi bất kỳ => không ghi gì.
// Luật R-S1..R-S3 kiểm trên trạng thái SAU khi cập nhật (opportunities.rules) ở MỌI đường ghi.
// Nhật ký chung (audit_log — người có audit.read đọc được, gồm Quản trị hệ thống): KHÔNG ghi giá trị, xác suất, tiêu đề, nhu cầu, tên dự án, phạm vi
//   chào, lý do — chỉ đánh dấu "(đã thay đổi)". Số liệu cũ/mới nằm ở opportunity_change, chỉ đường đọc đầy đủ xem được.
@Injectable()
export class OpportunityWritesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly reads: OpportunitiesService,
    @Inject(OPP_EMPLOYEE_ACCESS) private readonly access: OppEmployeeAccessReader,
    @Inject(ASSIGNEE_ELIGIBILITY) private readonly eligibility: AssigneeEligibility,
    @Inject(OPPORTUNITY_AUTO_TASKS) private readonly tasks: OpportunityAutoTasks,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }

  // inTx và loadForWrite dùng chung cho service vòng đời (opportunities.lifecycle.service.ts, S8b): cùng thứ tự khoá, cùng cách kiểm mã.
  async inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
        return fn(tx);
      }, { maxWait: 5000, timeout: 20000 });
    } catch (e) {
      if (e instanceof DomainException) throw e;
      const m = mapPrismaError(e);
      if (!m) throw e;
      throw m.code === 'CUSTOMER_BUSY' ? opportunityErrors.busy() : m.code === 'CUSTOMER_NOT_FOUND' ? opportunityErrors.notFound() : m;
    }
  }
  private async lockCustomer(tx: Tx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer WHERE id = ${id}::uuid FOR SHARE`;
    return rows.length > 0;
  }
  private lookup(tx: Tx, id: string, type: string) {
    return tx.lookupItem.findFirst({ where: { id, type, isActive: true }, select: { id: true, code: true } });
  }
  private async contactOk(tx: Tx, contactId: string, customerId: string): Promise<boolean> {
    return (await tx.contact.findFirst({ where: { id: contactId, customerId, deletedAt: null }, select: { id: true } })) !== null;
  }

  // S10a — CÙNG phép kiểm với loadForWrite (không thấy => 404; thấy nhưng thiếu mã / ngoài điều kiện => 403) nhưng KHÔNG khoá dòng nào: chỉ cho
  // đường ĐỌC "ai có thể nhận" (GET …-candidates) chạy trong snapshot chỉ đọc. Kết quả chỉ là gợi ý hiển thị — thao tác ghi thật luôn kiểm lại
  // bằng loadForWrite (có khoá). KHÔNG dùng hàm này trước một lệnh ghi.
  async peekForWrite(tx: Tx, actor: Actor, scopeOf: ScopeOf, id: string, code: OppWriteCode): Promise<WRow> {
    if (scopeOf('opportunity.read') === null && !hasAssignedReadCode(scopeOf) && scopeOf(code) === null) throw opportunityErrors.forbidden();
    const row = (await tx.opportunity.findFirst({ where: { id }, select: W_SELECT })) as WRow | null;
    if (!row) throw opportunityErrors.notFound();
    const ref = refOf(row);
    assertWrite(actor, scopeOf, code, ref, await resolvePath(tx, actor, scopeOf, id, ref));
    return row;
  }

  // Khoá (khách FOR SHARE -> cơ hội FOR UPDATE), đọc lại, kiểm đúng mã ghi. customer_id của cơ hội là bất biến (trigger S2) nên đọc trước khi khoá là an toàn.
  async loadForWrite(tx: Tx, actor: Actor, scopeOf: ScopeOf, id: string, code: OppWriteCode): Promise<WRow> {
    // Không có mã opportunity.* nào liên quan => 403 như các đường đọc (không phải 404).
    if (scopeOf('opportunity.read') === null && !hasAssignedReadCode(scopeOf) && scopeOf(code) === null) throw opportunityErrors.forbidden();
    const head = await tx.opportunity.findFirst({ where: { id }, select: { customerId: true } });
    if (!head) throw opportunityErrors.notFound();
    await this.lockCustomer(tx, head.customerId);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity WHERE id = ${id}::uuid FOR UPDATE`;
    const row = locked.length ? ((await tx.opportunity.findFirst({ where: { id }, select: W_SELECT })) as WRow | null) : null;
    if (!row) throw opportunityErrors.notFound();
    const ref = refOf(row);
    // Đường theo việc (S9a) chỉ quyết định 404 hay 403: thấy được qua việc nhưng không có mã ghi => 403; nó không bao giờ cho quyền ghi.
    assertWrite(actor, scopeOf, code, ref, await resolvePath(tx, actor, scopeOf, id, ref));
    return row;
  }

  // ───── POST /opportunities ─────
  async create(ctx: RequestCtx, dto: CreateOpportunityDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('opportunity.create') === null) throw opportunityErrors.forbidden('Không có quyền tạo cơ hội.');
    const errs: FieldError[] = [];
    const closeDate = dateOf(dto.expectedCloseDate, 'expectedCloseDate', errs);
    return this.inTx(async (tx) => {
      if (!(await this.lockCustomer(tx, dto.customerId))) throw opportunityErrors.customerNotFound();
      const c = await tx.customer.findFirst({ where: { id: dto.customerId }, select: { deletedAt: true, ownerId: true, owner: { select: { departmentId: true } } } });
      if (!c || c.deletedAt !== null) throw opportunityErrors.customerNotFound();
      if (!allowsCreate(actor, scopeOf, { ownerId: c.ownerId, deletedAt: c.deletedAt })) {
        // Đọc được khách nhưng không phụ trách => 403; không đọc được => 404 (không lộ tồn tại).
        const reads = inScope(actor, scopeOf('customer.read'), { ownerId: c.ownerId, ownerDepartmentId: c.owner ? c.owner.departmentId : null });
        throw reads ? opportunityErrors.forbidden('Chỉ tạo được cơ hội cho khách hàng mình phụ trách.') : opportunityErrors.customerNotFound();
      }
      // §6.1: người phụ trách mặc định = người phụ trách khách tại lúc tạo. Khách chưa có người phụ trách => từ chối (không tự chọn người khác).
      if (c.ownerId === null) throw opportunityErrors.customerNoOwner();

      const type = await this.lookup(tx, dto.typeId, 'opportunity_type');
      if (!type) errs.push({ field: 'typeId', message: 'Loại cơ hội không hợp lệ hoặc đã ngừng dùng.' });
      const stage = await tx.lookupItem.findFirst({ where: { type: 'opportunity_stage', code: OPPORTUNITY_STAGE.PROSPECTING, isActive: true }, select: { id: true, code: true } });
      const prob = stage ? defaultProbability(stage.code) : undefined;
      if (!stage || prob === undefined) throw opportunityErrors.catalogMissing();
      const contactId = dto.contactId === undefined || dto.contactId === null || dto.contactId === '' ? null : dto.contactId;
      if (contactId && !(await this.contactOk(tx, contactId, dto.customerId))) errs.push({ field: 'contactId', message: 'Người liên hệ không thuộc khách hàng này.' });

      // R-S3: loại có thi công => ô "Gắn với dự án" tự bật; gửi tường minh false => bị từ chối bởi luật.
      const linked = dto.isProjectLinked ?? (type ? isConstructionType(type.code) : false);
      const state = {
        status: 'OPEN', stageCode: stage.code, typeCode: type ? type.code : '', needSummary: text(dto.needSummary) ?? null,
        expectedAmountVnd: amountOf(dto.expectedAmountVnd) ?? null, isProjectLinked: linked, projectName: text(dto.projectName) ?? null, offerScope: text(dto.offerScope) ?? null,
      };
      if (type) errs.push(...ruleViolations(state));
      if (errs.length || !type) throw opportunityErrors.validation(errs);

      const created = await tx.opportunity.create({
        data: {
          customerId: dto.customerId, contactId, title: dto.title.trim(), typeId: type.id, stageId: stage.id, status: 'OPEN', ownerId: c.ownerId,
          needSummary: state.needSummary, isProjectLinked: linked, projectName: state.projectName, offerScope: state.offerScope,
          expectedAmountVnd: state.expectedAmountVnd, probability: prob, probabilityOverridden: false, expectedCloseDate: closeDate ?? null,
          createdById: actor.employeeId, updatedById: actor.employeeId,
        },
        select: { id: true, code: true },
      });
      await this.audit.record(tx, {
        action: 'opportunity.create', entityType: 'opportunity', entityId: created.id, entityCode: created.code, summary: 'Tạo cơ hội ' + created.code,
        changes: { customerId: dto.customerId, ownerId: c.ownerId, typeCode: type.code, stageCode: stage.code, isProjectLinked: linked },
        actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return this.reads.detailIn(tx, actor, scopeOf, created.id);
    });
  }

  // ───── PATCH /opportunities/:id ─────
  async update(ctx: RequestCtx, id: string, dto: UpdateOpportunityDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    return this.inTx(async (tx) => {
      const row = await this.loadForWrite(tx, actor, scopeOf, id, 'opportunity.update');
      if (row.status === 'WON' || row.status === 'LOST') throw opportunityErrors.state('Cơ hội đã đóng, không sửa được.');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const errs: FieldError[] = [];

      let typeId = row.typeId; let typeCode = row.type.code;
      if (dto.typeId !== undefined && dto.typeId !== row.typeId) {
        const t = await this.lookup(tx, dto.typeId, 'opportunity_type');
        if (!t) errs.push({ field: 'typeId', message: 'Loại cơ hội không hợp lệ hoặc đã ngừng dùng.' }); else { typeId = t.id; typeCode = t.code; }
      }
      const pick = <T>(sent: T | undefined, cur: T): T => (sent === undefined ? cur : sent);
      const title = dto.title === undefined ? row.title : dto.title.trim();
      const needSummary = pick(text(dto.needSummary), row.needSummary);
      const linked = dto.isProjectLinked ?? row.isProjectLinked;
      let projectName = pick(text(dto.projectName), row.projectName);
      let offerScope = pick(text(dto.offerScope), row.offerScope);
      // Bỏ gắn dự án mà không gửi hai trường đi kèm => xoá chúng (không để dữ liệu mồ côi); gửi kèm giá trị => luật từ chối.
      if (dto.isProjectLinked === false) { if (dto.projectName === undefined) projectName = null; if (dto.offerScope === undefined) offerScope = null; }
      const amount = pick(amountOf(dto.expectedAmountVnd), row.expectedAmountVnd);
      const sentDate = dateOf(dto.expectedCloseDate, 'expectedCloseDate', errs);
      const closeDate = sentDate === undefined ? row.expectedCloseDate : sentDate;
      const contactId = dto.contactId === undefined ? row.contactId : dto.contactId === null || dto.contactId === '' ? null : dto.contactId;
      if (contactId && contactId !== row.contactId && !(await this.contactOk(tx, contactId, row.customerId))) errs.push({ field: 'contactId', message: 'Người liên hệ không thuộc khách hàng này.' });

      // §6.3: sửa xác suất bằng tay bắt buộc lý do; lưu lịch sử; đánh dấu "đã sửa tay".
      const reason = text(dto.probabilityReason) ?? null;
      const probChanged = dto.probability !== undefined && dto.probability !== row.probability;
      if (probChanged && !reason) errs.push({ field: 'probabilityReason', message: 'Sửa xác suất phải ghi lý do.' });
      if (!probChanged && reason) errs.push({ field: 'probabilityReason', message: 'Chỉ gửi lý do khi đổi xác suất.' });
      const probability = probChanged ? (dto.probability as number) : row.probability;

      errs.push(...ruleViolations({ status: row.status, stageCode: row.stage.code, typeCode, needSummary, expectedAmountVnd: amount, isProjectLinked: linked, projectName, offerScope }));
      if (errs.length) throw opportunityErrors.validation(errs);

      const amountChanged = amount !== row.expectedAmountVnd;
      const dateChanged = ymd(closeDate) !== ymd(row.expectedCloseDate);
      // Nhật ký: trường nghiệp vụ nhạy cảm chỉ đánh dấu đã đổi; mã / cờ / id thì ghi [cũ, mới].
      const changes: Record<string, unknown> = {};
      if (title !== row.title) changes.title = AUDIT_REDACTED_TEXT;
      if (needSummary !== row.needSummary) changes.needSummary = AUDIT_REDACTED_TEXT;
      if (typeId !== row.typeId) changes.typeCode = [row.type.code, typeCode];
      if (linked !== row.isProjectLinked) changes.isProjectLinked = [row.isProjectLinked, linked];
      if (projectName !== row.projectName) changes.projectName = AUDIT_REDACTED_TEXT;
      if (offerScope !== row.offerScope) changes.offerScope = AUDIT_REDACTED_TEXT;
      if (contactId !== row.contactId) changes.contactId = [row.contactId, contactId];
      if (amountChanged) changes.expectedAmountVnd = AUDIT_REDACTED_TEXT;
      if (dateChanged) changes.expectedCloseDate = AUDIT_REDACTED_TEXT;
      if (probChanged) changes.probability = AUDIT_REDACTED_TEXT;
      // Không có gì đổi => không ghi, không tăng version.
      if (Object.keys(changes).length === 0) return this.reads.detailIn(tx, actor, scopeOf, id);

      const upd = await tx.opportunity.updateMany({
        where: { id, version: row.version },
        data: {
          title, needSummary, typeId, isProjectLinked: linked, projectName, offerScope, contactId, expectedAmountVnd: amount, expectedCloseDate: closeDate,
          probability, probabilityOverridden: probChanged ? true : row.probabilityOverridden, version: { increment: 1 }, updatedById: actor.employeeId,
        },
      });
      if (upd.count !== 1) throw opportunityErrors.versionConflict(row.version);
      const hist: Prisma.OpportunityChangeCreateManyInput[] = [];
      if (amountChanged) hist.push({ opportunityId: id, field: 'AMOUNT', oldValue: str(row.expectedAmountVnd), newValue: str(amount), changedById: actor.employeeId });
      if (probChanged) hist.push({ opportunityId: id, field: 'PROBABILITY', oldValue: str(row.probability), newValue: str(probability), reason, changedById: actor.employeeId });
      if (dateChanged) hist.push({ opportunityId: id, field: 'CLOSE_DATE', oldValue: ymd(row.expectedCloseDate), newValue: ymd(closeDate), changedById: actor.employeeId });
      if (hist.length) await tx.opportunityChange.createMany({ data: hist });
      await this.audit.record(tx, {
        action: 'opportunity.update', entityType: 'opportunity', entityId: id, entityCode: row.code, summary: 'Cập nhật cơ hội ' + row.code,
        changes, actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── POST /opportunities/:id/stage ─────
  // §6.2: tới hoặc lùi tự do giữa 4 giai đoạn mở; mỗi lần ghi lịch sử. Xác suất về mặc định của giai đoạn mới, trừ khi đang sửa tay (KEEP / RESET).
  async moveStage(ctx: RequestCtx, id: string, dto: MoveStageDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    return this.inTx(async (tx) => {
      const row = await this.loadForWrite(tx, actor, scopeOf, id, 'opportunity.move_stage');
      if (row.status !== 'OPEN') throw opportunityErrors.state('Chỉ đổi giai đoạn khi cơ hội đang mở.');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const stage = await this.lookup(tx, dto.stageId, 'opportunity_stage');
      if (!stage) throw opportunityErrors.validation([{ field: 'stageId', message: 'Giai đoạn không hợp lệ hoặc đã ngừng dùng.' }]);
      if (stage.id === row.stageId) throw opportunityErrors.validation([{ field: 'stageId', message: 'Cơ hội đang ở giai đoạn này.' }]);
      const def = defaultProbability(stage.code);
      if (def === undefined) throw opportunityErrors.catalogMissing();

      const errs = ruleViolations({
        status: row.status, stageCode: stage.code, typeCode: row.type.code, needSummary: row.needSummary, expectedAmountVnd: row.expectedAmountVnd,
        isProjectLinked: row.isProjectLinked, projectName: row.projectName, offerScope: row.offerScope,
      });
      let probability = def; let overridden = false;
      if (row.probabilityOverridden) {
        if (dto.probability === undefined) errs.push({ field: 'probability', message: 'Xác suất đang được sửa tay: chọn KEEP (giữ) hoặc RESET (về mặc định của giai đoạn mới).' });
        else if (dto.probability === 'KEEP') { probability = row.probability; overridden = true; }
      }
      if (errs.length) throw opportunityErrors.validation(errs);

      const upd = await tx.opportunity.updateMany({
        where: { id, version: row.version },
        data: { stageId: stage.id, probability, probabilityOverridden: overridden, version: { increment: 1 }, updatedById: actor.employeeId },
      });
      if (upd.count !== 1) throw opportunityErrors.versionConflict(row.version);
      const hist: Prisma.OpportunityChangeCreateManyInput[] = [{ opportunityId: id, field: 'STAGE', oldValue: row.stage.code, newValue: stage.code, changedById: actor.employeeId }];
      if (probability !== row.probability) hist.push({ opportunityId: id, field: 'PROBABILITY', oldValue: str(row.probability), newValue: str(probability), changedById: actor.employeeId });
      await tx.opportunityChange.createMany({ data: hist });
      await this.audit.record(tx, {
        action: 'opportunity.move_stage', entityType: 'opportunity', entityId: id, entityCode: row.code, summary: 'Đổi giai đoạn cơ hội ' + row.code,
        changes: { stageCode: [row.stage.code, stage.code] }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── POST /opportunities/:id/assign (S8a) ─────
  // §6.8 [C6][O3]: chuyển người phụ trách — bắt buộc lý do; ghi người chuyển, thời điểm, người cũ, người mới (opportunity_change OWNER). KHÔNG đổi
  // người phụ trách khách. Người chuyển cần opportunity.assign (ALL; hoặc OWN và đang phụ trách cơ hội). Người nhận: assertAssignee (§5.4) — ACTIVE,
  // tài khoản dùng được (cổng auth), đọc + sửa được cơ hội sau khi nhận, cùng phòng trừ khi người chuyển có phạm vi ALL. Mọi nguyên nhân từ chối
  // người nhận trả MỘT mã OPPORTUNITY_ASSIGNEE_INELIGIBLE. Áp cho mọi trạng thái (kể cả đã đóng: người phụ trách nghỉ việc vẫn phải chuyển được).
  // Sau khi chuyển, người chuyển có thể KHÔNG còn thấy cơ hội (Kinh doanh chuyển cơ hội ở khách không do mình phụ trách) => trả bản tối thiểu.
  async assign(ctx: RequestCtx, id: string, dto: AssignOpportunityDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    const reason = text(dto.reason) ?? null;
    if (!reason) throw opportunityErrors.validation([{ field: 'reason', message: 'Chuyển người phụ trách phải ghi lý do.' }]);
    return this.inTx(async (tx) => {
      const row = await this.loadForWrite(tx, actor, scopeOf, id, 'opportunity.assign');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      if (dto.ownerId === row.ownerId) throw opportunityErrors.validation([{ field: 'ownerId', message: 'Người này đang là người phụ trách cơ hội.' }]);
      const [acc, can] = await Promise.all([this.access.load(tx, [row.ownerId, dto.ownerId]), this.eligibility.canSignIn([dto.ownerId])]);
      assertAssignee(scopeOf, acc.get(row.ownerId), acc.get(dto.ownerId), can.get(dto.ownerId) === true);

      const upd = await tx.opportunity.updateMany({ where: { id, version: row.version }, data: { ownerId: dto.ownerId, version: { increment: 1 }, updatedById: actor.employeeId } });
      if (upd.count !== 1) throw opportunityErrors.versionConflict(row.version);
      await tx.opportunityChange.createMany({ data: [{ opportunityId: id, field: 'OWNER', oldValue: row.ownerId, newValue: dto.ownerId, reason, changedById: actor.employeeId }] });
      await this.audit.record(tx, {
        action: 'opportunity.assign', entityType: 'opportunity', entityId: id, entityCode: row.code, summary: 'Chuyển người phụ trách cơ hội ' + row.code,
        changes: { ownerId: [row.ownerId, dto.ownerId], reason: AUDIT_REDACTED_TEXT }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      // S8b (§6.8): việc nhắc tạm hoãn còn OPEN đổi người làm theo người phụ trách mới, cùng transaction. Việc bàn giao và việc người dùng tạo không đổi.
      await this.tasks.reassignReminder({ tx, actorId: actor.employeeId, requestId: ctx.requestId, opportunity: { id, code: row.code, customerId: row.customerId } }, dto.ownerId);
      const after: OppRef = { ...refOf(row), ownerId: dto.ownerId };
      if (readsFull(actor, scopeOf, after)) return this.reads.detailIn(tx, actor, scopeOf, id);
      return { id, code: row.code, version: row.version + 1, transferred: true as const };
    });
  }

  // ───── DELETE /opportunities/:id (S8a) ─────
  // §6.9: xoá mềm — chỉ opportunity.delete phạm vi ALL (Quản trị CRM), bắt buộc lý do. Không xoá vĩnh viễn. Không tạo / đóng / đổi công việc nào
  // (§5.4 "Khôi phục"): việc gắn cơ hội vẫn là hoạt động của khách. Dấu vết ở nhật ký (enum opportunity_change_field không có giá trị cho xoá).
  async remove(ctx: RequestCtx, id: string, dto: DeleteOpportunityDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    const reason = text(dto.reason) ?? null;
    if (!reason) throw opportunityErrors.validation([{ field: 'reason', message: 'Xoá cơ hội phải ghi lý do.' }]);
    return this.inTx(async (tx) => {
      const row = await this.loadForWrite(tx, actor, scopeOf, id, 'opportunity.delete');
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const upd = await tx.opportunity.updateMany({
        where: { id, version: row.version, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.employeeId, deleteReason: reason, version: { increment: 1 }, updatedById: actor.employeeId },
      });
      if (upd.count !== 1) throw opportunityErrors.versionConflict(row.version);
      await this.audit.record(tx, {
        action: 'opportunity.delete', entityType: 'opportunity', entityId: id, entityCode: row.code, summary: 'Xoá mềm cơ hội ' + row.code,
        changes: { reason: AUDIT_REDACTED_TEXT }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return { id, code: row.code, version: row.version + 1, deleted: true as const };
    });
  }

  // ───── POST /opportunities/:id/restore (S8a) ─────
  // §5.4 "Khôi phục cơ hội đã xoá mềm" (PR234-R3-SEC-02). ĐƯỜNG NẠP RIÊNG: kiểm opportunity.restore phạm vi ALL TRƯỚC khi truy vấn — người thiếu
  // mã nhận 404 dù id có tồn tại hay không. Chỉ sau đó mới phân biệt: không tồn tại => 404; chưa xoá => 409 OPPORTUNITY_STATE; khách còn bị xoá
  // mềm => 409 OPPORTUNITY_CUSTOMER_DELETED (phải khôi phục khách trước; không tự khôi phục khách). Trạng thái, giai đoạn, người phụ trách, hold_* /
  // won_* / lost_*, giá trị giữ nguyên như lúc xoá; không tạo / đổi công việc nào. Dấu vết ở nhật ký.
  async restore(ctx: RequestCtx, id: string, dto: RestoreOpportunityDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    assertMayLoadDeleted(scopeOf);
    return this.inTx(async (tx) => {
      const head = await tx.opportunity.findFirst({ where: { id }, select: { customerId: true } });
      if (head) await this.lockCustomer(tx, head.customerId);
      const locked = head ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity WHERE id = ${id}::uuid FOR UPDATE` : [];
      const row = locked.length ? await tx.opportunity.findFirst({ where: { id }, select: { code: true, version: true, deletedAt: true, customer: { select: { deletedAt: true } } } }) : null;
      assertRestorable(scopeOf, row);
      if (!row) throw opportunityErrors.notFound(); // assertRestorable đã ném; dòng này để TypeScript thu hẹp kiểu
      if (row.version !== dto.version) throw opportunityErrors.versionConflict(row.version);
      const upd = await tx.opportunity.updateMany({
        where: { id, version: row.version, deletedAt: { not: null } },
        data: { deletedAt: null, deletedById: null, deleteReason: null, version: { increment: 1 }, updatedById: actor.employeeId },
      });
      if (upd.count !== 1) throw opportunityErrors.versionConflict(row.version);
      await this.audit.record(tx, {
        action: 'opportunity.restore', entityType: 'opportunity', entityId: id, entityCode: row.code, summary: 'Khôi phục cơ hội ' + row.code,
        actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }
}
