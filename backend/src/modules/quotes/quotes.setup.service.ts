import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeOf } from '../opportunities/opportunities.access';
import { mayHaveDefaults, mayManageTemplates } from './quotes.access';
import { quoteDbError, quoteErrors } from './quotes.errors';
import { TEMPLATE_SELECT, TemplateRow, toTemplate } from './quotes.mapper';
import { QuotesService } from './quotes.service';
import type { CreateTemplateDto, MyDefaultsDto, TemplateColumnDto, UpdateTemplateDto } from './dto/write-quotes.dto';

type Tx = Prisma.TransactionClient;
const MAX_TEMPLATES = 200; // mục 8 điểm 12
// Khoá tư vấn trong transaction: tuần tự hoá việc thêm loại (giới hạn 200) và ngừng dùng (luôn còn ít nhất một loại đang dùng).
const TEMPLATE_LOCK = 'siscom.quote_template.write';

// Cột riêng chuẩn hoá (đơn vị không gửi => ''); key trùng => lỗi theo vị trí.
function normColumns(cols: readonly TemplateColumnDto[]): { columns: Array<{ key: string; label: string; unit: string }>; errs: Array<{ field: string; code: string; message: string }> } {
  const seen = new Set<string>();
  const errs: Array<{ field: string; code: string; message: string }> = [];
  const columns = cols.map((c, i) => {
    if (seen.has(c.key)) errs.push({ field: 'columns[' + i + '].key', code: 'DUPLICATE_COLUMN', message: 'Cột thứ ' + (i + 1) + ' trùng key với cột trước.' });
    seen.add(c.key);
    return { key: c.key, label: c.label, unit: c.unit ?? '' };
  });
  return { columns, errs };
}
// So sánh không phụ thuộc thứ tự khoá (JSONB của PostgreSQL tự sắp lại khoá của đối tượng).
const colsKey = (c: unknown): string => JSON.stringify(Array.isArray(c) ? c.map((x: { key?: unknown; label?: unknown; unit?: unknown }) => [x.key, x.label, x.unit]) : c);
const text = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());

// Báo giá Q6 (docs/QUOTES_DESIGN.md mục 4.1, 7.1, 8 điểm 10–12) — GHI loại báo giá (chỉ người có quote.template = Quản trị CRM [QB19]) và
// mặc định cá nhân của CHÍNH người gọi [QB15]. Loại báo giá không chứa giá của báo giá nào; sửa loại KHÔNG đổi báo giá đã lập (phiên bản giữ
// bản chép — mục 4.3). Không xoá cứng loại báo giá (R-Q12): ngừng dùng = isActive false; luôn còn ít nhất một loại đang dùng.
// Khoá lạc quan: loại báo giá có version riêng (mục 8.1). Nhật ký: chỉ mã loại và tên trường đã đổi.
@Injectable()
export class QuotesSetupService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly reads: QuotesService,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }
  private async inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
        return fn(tx);
      }, { maxWait: 5000, timeout: 20000 });
    } catch (e) {
      if (e instanceof DomainException) throw e;
      const m = quoteDbError(e);
      if (!m) throw e;
      throw m;
    }
  }
  private lockTemplates(tx: Tx) {
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${TEMPLATE_LOCK}))::text AS ok`;
  }

  // ───── POST /quotes/templates ─────
  async createTemplate(ctx: RequestCtx, dto: CreateTemplateDto) {
    const scopeOf = this.scopeOf(ctx.actor);
    if (!mayManageTemplates(scopeOf)) throw quoteErrors.forbidden('Chỉ Quản trị CRM được thêm loại báo giá.');
    const { columns, errs } = normColumns(dto.columns ?? []);
    if (errs.length) throw quoteErrors.validation(errs);
    return this.inTx(async (tx) => {
      await this.lockTemplates(tx);
      if ((await tx.quoteTemplate.count()) >= MAX_TEMPLATES) throw quoteErrors.templateLimit();
      if (await tx.quoteTemplate.findUnique({ where: { code: dto.code }, select: { id: true } })) throw quoteErrors.templateCodeExists();
      const row = (await tx.quoteTemplate.create({
        data: {
          code: dto.code, name: dto.name, title: dto.title, intro: dto.intro ?? '', defaultTerms: dto.defaultTerms ?? '', defaultValidDays: dto.defaultValidDays ?? 15,
          defaultVat: dto.defaultVat ?? 10, vatMode: dto.vatMode ?? 'QUOTE', columns, isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0,
          createdById: ctx.actor.employeeId, updatedById: ctx.actor.employeeId,
        },
        select: TEMPLATE_SELECT,
      })) as TemplateRow;
      await this.audit.record(tx, {
        action: 'quote.template.create', entityType: 'quote_template', entityId: row.id, entityCode: row.code, summary: 'Thêm loại báo giá ' + row.code,
        changes: { vatMode: row.vatMode, columnCount: columns.length, isActive: row.isActive }, actorEmployeeId: ctx.actor.employeeId, requestId: ctx.requestId,
      });
      return toTemplate(row);
    });
  }

  // ───── PATCH /quotes/templates/:id ─────
  async updateTemplate(ctx: RequestCtx, id: string, dto: UpdateTemplateDto) {
    const scopeOf = this.scopeOf(ctx.actor);
    if (!mayManageTemplates(scopeOf)) throw quoteErrors.forbidden('Chỉ Quản trị CRM được sửa loại báo giá.');
    const norm = dto.columns === undefined ? undefined : normColumns(dto.columns);
    if (norm?.errs.length) throw quoteErrors.validation(norm.errs);
    return this.inTx(async (tx) => {
      await this.lockTemplates(tx);
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM quote_template WHERE id = ${id}::uuid FOR UPDATE`;
      const row = locked.length ? ((await tx.quoteTemplate.findUnique({ where: { id }, select: TEMPLATE_SELECT })) as TemplateRow | null) : null;
      if (!row) throw quoteErrors.templateNotFound();
      if (row.version !== dto.version) throw quoteErrors.versionConflict(row.version);

      const next = {
        name: dto.name ?? row.name, title: dto.title ?? row.title, intro: dto.intro ?? row.intro, defaultTerms: dto.defaultTerms ?? row.defaultTerms,
        defaultValidDays: dto.defaultValidDays ?? row.defaultValidDays, defaultVat: dto.defaultVat ?? row.defaultVat, vatMode: dto.vatMode ?? row.vatMode,
        columns: norm ? norm.columns : row.columns, isActive: dto.isActive ?? row.isActive, sortOrder: dto.sortOrder ?? row.sortOrder,
      };
      const changed = (Object.keys(next) as Array<keyof typeof next>).filter((k) => (k === 'columns' ? colsKey(next[k]) !== colsKey(row[k]) : next[k] !== row[k]));
      if (changed.length === 0) return toTemplate(row);
      if (row.isActive && !next.isActive && (await tx.quoteTemplate.count({ where: { isActive: true, id: { not: id } } })) === 0) throw quoteErrors.templateLastActive();

      const upd = await tx.quoteTemplate.updateMany({
        where: { id, version: row.version },
        data: { ...next, vatMode: next.vatMode as 'QUOTE' | 'LINE', columns: next.columns as Prisma.InputJsonValue, version: { increment: 1 }, updatedById: ctx.actor.employeeId },
      });
      if (upd.count !== 1) throw quoteErrors.versionConflict(row.version);
      await this.audit.record(tx, {
        action: 'quote.template.update', entityType: 'quote_template', entityId: row.id, entityCode: row.code, summary: 'Sửa loại báo giá ' + row.code,
        changes: Object.fromEntries(changed.map((k) => [k, '(đã thay đổi)'])), actorEmployeeId: ctx.actor.employeeId, requestId: ctx.requestId,
      });
      return toTemplate((await tx.quoteTemplate.findUniqueOrThrow({ where: { id }, select: TEMPLATE_SELECT })) as TemplateRow);
    });
  }

  // ───── PUT /quotes/my-defaults ─────
  // LUÔN của chính người gọi; thay toàn bộ (trường không gửi => để trống). Trả lại đúng dạng của GET /quotes/my-defaults.
  async putMyDefaults(ctx: RequestCtx, dto: MyDefaultsDto) {
    const scopeOf = this.scopeOf(ctx.actor);
    if (!mayHaveDefaults(scopeOf)) throw quoteErrors.forbidden('Không có quyền dùng mặc định báo giá.');
    const data = { quoterTitle: text(dto.quoterTitle), quoterPhone: text(dto.quoterPhone), quoterEmail: text(dto.quoterEmail), paymentInfo: dto.paymentInfo ?? '' };
    await this.inTx(async (tx) => {
      const me = await tx.employee.findUniqueOrThrow({ where: { id: ctx.actor.employeeId }, select: { code: true } });
      await tx.quoteUserDefault.upsert({ where: { employeeId: ctx.actor.employeeId }, create: { employeeId: ctx.actor.employeeId, ...data }, update: { ...data, updatedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'quote.my_defaults.update', entityType: 'employee', entityId: ctx.actor.employeeId, entityCode: me.code, summary: 'Cập nhật mặc định báo giá của ' + me.code,
        changes: { quoterTitle: '(đã ghi)', quoterPhone: '(đã ghi)', quoterEmail: '(đã ghi)', paymentInfo: '(đã ghi)' }, actorEmployeeId: ctx.actor.employeeId, requestId: ctx.requestId,
      });
    });
    return this.reads.myDefaults(ctx);
  }
}
