import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { OppRef, readsFull, ScopeOf } from '../opportunities/opportunities.access';
import { allowsQuoteWrite, QuoteWriteCode, readsQuotesOf, seesCost } from './quotes.access';
import { quoteDbError, quoteErrors } from './quotes.errors';
import { TEMPLATE_SELECT, TemplateRow } from './quotes.mapper';
import { computeTotals, LineIn, MoneyError, parseQuantity, parseVnd, qtyText, VatMode } from './quotes.money';
import { CURRENT_PRINT_TEMPLATE, QuotesService } from './quotes.service';
import type { CreateQuoteDto, DeleteQuoteDto, QuoteLineDto, QuoteVersionRefDto, SaveQuoteDraftDto, UpdateQuoteDto } from './dto/write-quotes.dto';

type Tx = Prisma.TransactionClient;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MAX_VERSION_NO = 999;
const MAX_EXTRA_LEN = 200;

// Cơ hội mà đường ghi cần: căn cứ quyền + trạng thái + nguồn điền sẵn.
const OPP_W = { id: true, status: true, ownerId: true, deletedAt: true, contactId: true, projectName: true, customerId: true, customer: { select: { ownerId: true, deletedAt: true } } } as const;
interface OppW { id: string; status: string; ownerId: string; deletedAt: Date | null; contactId: string | null; projectName: string | null; customerId: string; customer: { ownerId: string | null; deletedAt: Date | null } }
const refOf = (o: OppW): OppRef => ({ ownerId: o.ownerId, deletedAt: o.deletedAt, customer: { ownerId: o.customer.ownerId, deletedAt: o.customer.deletedAt } });
// Báo giá mà đường ghi cần (kèm tóm tắt mọi phiên bản).
const QUOTE_W = { id: true, code: true, version: true, itemName: true, deletedAt: true, versions: { select: { id: true, versionNo: true, status: true, createdById: true }, orderBy: { versionNo: 'asc' as const } } } as const;
interface QuoteW { id: string; code: string; version: number; itemName: string; deletedAt: Date | null; versions: Array<{ id: string; versionNo: number; status: string; createdById: string }> }
// Cột của phiên bản được chép sang bản mới (mục 8 điểm 5) — mọi nội dung, KHÔNG có trạng thái / người gửi / kết quả / người tạo.
const COPY_SELECT = {
  codeSnapshot: true, itemName: true, templateName: true, title: true, columns: true, vatMode: true, quoteDate: true, validUntil: true,
  clientName: true, clientContact: true, clientCompany: true, clientPhone: true, clientEmail: true, clientAddress: true, projectName: true,
  quoterName: true, quoterTitle: true, quoterPhone: true, quoterEmail: true, intro: true, terms: true, paymentInfo: true, note: true,
  subtotalVnd: true, base8Vnd: true, base10Vnd: true, vat8Vnd: true, vat10Vnd: true, totalVnd: true,
  lines: { select: { lineNo: true, kind: true, description: true, unit: true, note: true, extra: true, quantity: true, unitPriceVnd: true, vatPercent: true, amountVnd: true, costPriceVnd: true }, orderBy: { lineNo: 'asc' as const } },
} as const;

interface FieldErr { field: string; code: string; message: string }
// Trường văn bản tuỳ chọn: undefined = không gửi (giữ nguyên); null / '' / toàn khoảng trắng = để trống; còn lại = đã bỏ khoảng trắng.
const text = (v: string | null | undefined): string | null | undefined => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());
const keep = <T>(sent: T | undefined, cur: T): T => (sent === undefined ? cur : sent);
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
function dateOf(v: string | null | undefined, field: string, errs: FieldErr[]): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v + 'T00:00:00.000Z');
  const y = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || y < MIN_YEAR || y > MAX_YEAR) { errs.push({ field, code: 'INVALID_DATE', message: 'Ngày không hợp lệ (năm ' + MIN_YEAR + '–' + MAX_YEAR + ').' }); return undefined; }
  return d;
}

interface ParsedLines { ins: LineIn[]; rows: Array<Omit<Prisma.QuoteLineCreateManyInput, 'quoteVersionId'>>; errs: FieldErr[] }
// Dòng của bản nháp => đầu vào bộ tính tiền + dữ liệu ghi. Lỗi chỉ nêu TÊN TRƯỜNG và SỐ DÒNG, không bao giờ lặp lại giá trị (mục 7.3).
// vatMode QUOTE: mức chung (topVat) cho mọi dòng hàng, dòng không được tự gửi mức; LINE: mỗi dòng hàng gửi mức riêng, không có mức chung.
export function parseLines(lines: readonly QuoteLineDto[], vatMode: VatMode, columnKeys: ReadonlySet<string>, topVat: 8 | 10 | null | undefined): ParsedLines {
  const errs: FieldErr[] = [];
  const ins: LineIn[] = [];
  const rows: ParsedLines['rows'] = [];
  const hasTop = topVat !== undefined && topVat !== null;
  if (vatMode === 'LINE' && hasTop) errs.push({ field: 'vatPercent', code: 'VAT_NOT_ALLOWED', message: 'Loại báo giá này tính VAT theo từng dòng — không gửi mức VAT chung.' });
  if (vatMode === 'QUOTE' && !hasTop && lines.some((l) => l.kind === 'ITEM')) errs.push({ field: 'vatPercent', code: 'VAT_REQUIRED', message: 'Chọn mức VAT (8 % hoặc 10 %) cho cả báo giá.' });
  lines.forEach((l, i) => {
    const f = 'lines[' + i + ']';
    const lineNo = i + 1;
    const extra = l.extra ?? {};
    const extraKeys = Object.keys(extra);
    if (l.kind === 'SECTION') {
      const stray = [l.quantity, l.unitPriceVnd, l.vatPercent, l.costPriceVnd].some((x) => x !== undefined && x !== null) || extraKeys.length > 0 || (l.unit !== undefined && l.unit !== '');
      if (stray) errs.push({ field: f, code: 'SECTION_HAS_VALUES', message: 'Dòng ' + lineNo + ': dòng tiêu đề nhóm chỉ có nội dung chữ.' });
      ins.push({ kind: 'SECTION' });
      rows.push({ lineNo, kind: 'SECTION', description: l.description, unit: '', note: text(l.note) ?? null, extra: {} });
      return;
    }
    const q = parseQuantity(l.quantity);
    if (q === null) errs.push({ field: f + '.quantity', code: 'QUANTITY_PRECISION', message: 'Dòng ' + lineNo + ': số lượng phải là chuỗi số > 0, tối đa 6 chữ số nguyên và 3 chữ số thập phân.' });
    const price = parseVnd(l.unitPriceVnd);
    if (price === null) errs.push({ field: f + '.unitPriceVnd', code: 'AMOUNT_OUT_OF_RANGE', message: 'Dòng ' + lineNo + ': đơn giá phải là chuỗi chữ số nguyên, 0 – 999 999 999 999.' });
    const hasCost = l.costPriceVnd !== undefined && l.costPriceVnd !== null;
    const cost = hasCost ? parseVnd(l.costPriceVnd) : null;
    if (hasCost && cost === null) errs.push({ field: f + '.costPriceVnd', code: 'AMOUNT_OUT_OF_RANGE', message: 'Dòng ' + lineNo + ': giá vốn phải là chuỗi chữ số nguyên, 0 – 999 999 999 999.' });
    const lineVat = l.vatPercent ?? null;
    if (vatMode === 'QUOTE' && lineVat !== null) errs.push({ field: f + '.vatPercent', code: 'VAT_NOT_ALLOWED', message: 'Dòng ' + lineNo + ': loại báo giá này dùng một mức VAT cho cả báo giá.' });
    if (vatMode === 'LINE' && lineVat === null) errs.push({ field: f + '.vatPercent', code: 'VAT_REQUIRED', message: 'Dòng ' + lineNo + ': chọn mức VAT (8 % hoặc 10 %).' });
    if (extraKeys.length > 10) errs.push({ field: f + '.extra', code: 'UNKNOWN_COLUMN', message: 'Dòng ' + lineNo + ': tối đa 10 cột riêng.' });
    for (const k of extraKeys) {
      if (!columnKeys.has(k)) errs.push({ field: f + '.extra', code: 'UNKNOWN_COLUMN', message: 'Dòng ' + lineNo + ': có cột riêng không thuộc loại báo giá này.' });
      const val = extra[k];
      if (typeof val !== 'string' || val.length > MAX_EXTRA_LEN) errs.push({ field: f + '.extra', code: 'INVALID_EXTRA', message: 'Dòng ' + lineNo + ': giá trị cột riêng phải là chữ, tối đa ' + MAX_EXTRA_LEN + ' ký tự.' });
    }
    const vat = (vatMode === 'QUOTE' ? topVat : lineVat) ?? 10;
    ins.push({ kind: 'ITEM', q: q ?? 1n, price: price ?? 0n, vat, cost });
    rows.push({ lineNo, kind: 'ITEM', description: l.description, unit: l.unit ?? '', note: text(l.note) ?? null, extra: extra as Prisma.InputJsonValue, quantity: q === null ? null : qtyText(q), unitPriceVnd: price, vatPercent: vat, costPriceVnd: cost });
  });
  return { ins, rows, errs };
}
const columnKeysOf = (columns: unknown): Set<string> => new Set(Array.isArray(columns) ? columns.map((c) => (typeof c === 'object' && c !== null ? String((c as { key?: unknown }).key ?? '') : '')).filter((k) => k !== '') : []);

// Báo giá Q5a (docs/QUOTES_DESIGN.md mục 6, 7, 8, 9) — GHI: tạo báo giá, đổi hạng mục, lưu nháp, tạo bản mới, xoá nháp, xoá báo giá.
// Gửi / chấp nhận / từ chối / đang theo đuổi / đồng bộ giá trị cơ hội = Q5b.
// Quyền: không có mã của thao tác => 403 TRƯỚC khi tra bản ghi; ngoài phạm vi xem (kể cả đã xoá) => 404; thấy được nhưng không phụ trách => 403.
// Thứ tự khoá (mục 8.1, giống đường ghi cơ hội): khách FOR SHARE -> cơ hội FOR UPDATE -> quote FOR UPDATE, SAU ĐÓ mới đọc lại và kiểm quyền.
// Khoá lạc quan: mọi thao tác gửi kèm `version` của quote; lệch => 409 VERSION_CONFLICT; mọi thay đổi tăng quote.version.
// Tiền: máy chủ TỰ TÍNH mọi tổng bằng BigInt (quotes.money.ts); thân yêu cầu không có trường tổng nào (DTO cấm).
// Giá vốn (mục 7.3): chỉ người tạo phiên bản hoặc người có quote.cost sửa được bản nháp (người khác => 403, giá vốn đang lưu giữ nguyên);
// tạo bản mới chỉ chép giá vốn khi người tạo bản mới được xem giá vốn của bản nguồn.
// Nhật ký (audit_log): chỉ mã, số phiên bản, số dòng — KHÔNG ghi số tiền, giá vốn hay nội dung dòng hàng (mục 7.2).
@Injectable()
export class QuotesWriteService {
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

  // Khoá khách FOR SHARE rồi cơ hội FOR UPDATE, đọc lại. customer_id của cơ hội bất biến (trigger S2) nên đọc trước khi khoá là an toàn.
  private async lockOpportunity(tx: Tx, opportunityId: string): Promise<OppW | null> {
    const head = await tx.opportunity.findFirst({ where: { id: opportunityId }, select: { customerId: true } });
    if (!head) return null;
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${head.customerId}::uuid FOR SHARE`;
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity WHERE id = ${opportunityId}::uuid FOR UPDATE`;
    return locked.length ? ((await tx.opportunity.findFirst({ where: { id: opportunityId }, select: OPP_W })) as OppW | null) : null;
  }

  // Khoá theo thứ tự cố định rồi kiểm: báo giá chưa xoá + đọc được (404) + đúng mã ghi trên cơ hội mình phụ trách (403).
  private async loadQuote(tx: Tx, actor: Actor, scopeOf: ScopeOf, id: string, code: QuoteWriteCode): Promise<{ q: QuoteW; opp: OppW }> {
    const head = await tx.quote.findFirst({ where: { id }, select: { opportunityId: true } });
    if (!head) throw quoteErrors.notFound();
    const opp = await this.lockOpportunity(tx, head.opportunityId);
    await tx.$queryRaw`SELECT id FROM quote WHERE id = ${id}::uuid FOR UPDATE`;
    const q = (await tx.quote.findFirst({ where: { id }, select: QUOTE_W })) as QuoteW | null;
    if (!q || q.deletedAt !== null || !opp || !readsQuotesOf(actor, scopeOf, refOf(opp))) throw quoteErrors.notFound();
    if (!allowsQuoteWrite(actor, scopeOf, code, refOf(opp))) throw quoteErrors.forbidden('Chỉ người phụ trách cơ hội được thao tác trên báo giá này.');
    return { q, opp };
  }
  private versionOf(q: QuoteW, no: number) {
    const v = q.versions.find((x) => x.versionNo === no);
    if (!v) throw quoteErrors.versionNotFound();
    return v;
  }
  // Tăng quote.version theo khoá lạc quan (đã khoá dòng FOR UPDATE nên chỉ lệch khi version gửi lên đã cũ — đã kiểm trước).
  private async bump(tx: Tx, q: QuoteW, data: Prisma.QuoteUncheckedUpdateManyInput = {}): Promise<void> {
    const r = await tx.quote.updateMany({ where: { id: q.id, version: q.version }, data: { ...data, version: { increment: 1 } } });
    if (r.count !== 1) throw quoteErrors.versionConflict(q.version);
  }
  private record(tx: Tx, ctx: RequestCtx, action: string, q: { id: string; code: string }, summary: string, changes: Record<string, unknown>) {
    return this.audit.record(tx, { action, entityType: 'quote', entityId: q.id, entityCode: q.code, summary, changes, actorEmployeeId: ctx.actor.employeeId, requestId: ctx.requestId });
  }

  // ───── POST /opportunities/:opportunityId/quotes ─────
  // Báo giá mới + phiên bản 1 (nháp, chưa có dòng); các ô ở mục 4.3 chép từ khách / người liên hệ / cơ hội / người lập / mặc định cá nhân / loại báo giá.
  async create(ctx: RequestCtx, opportunityId: string, dto: CreateQuoteDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('quote.create') === null) throw quoteErrors.forbidden('Không có quyền lập báo giá.');
    return this.inTx(async (tx) => {
      const opp = await this.lockOpportunity(tx, opportunityId);
      if (!opp || !readsFull(actor, scopeOf, refOf(opp))) throw quoteErrors.opportunityNotFound();
      if (!allowsQuoteWrite(actor, scopeOf, 'quote.create', refOf(opp))) throw quoteErrors.forbidden('Chỉ người phụ trách cơ hội được lập báo giá.');
      if (opp.status !== 'OPEN') throw quoteErrors.opportunityNotOpen();
      const t = (await tx.quoteTemplate.findUnique({ where: { id: dto.templateId }, select: TEMPLATE_SELECT })) as TemplateRow | null;
      if (!t) throw quoteErrors.templateNotFound();
      if (!t.isActive) throw quoteErrors.templateInactive();
      const p = await this.reads.prefillIn(tx, actor, opp, t);
      const q = await tx.quote.create({ data: { opportunityId: opp.id, customerId: opp.customerId, templateId: t.id, itemName: dto.itemName, createdById: actor.employeeId }, select: { id: true, code: true } });
      await tx.quoteVersion.create({
        data: {
          quoteId: q.id, versionNo: 1, codeSnapshot: q.code, itemName: dto.itemName, printTemplate: CURRENT_PRINT_TEMPLATE, templateName: t.name, title: t.title,
          columns: t.columns as Prisma.InputJsonValue, vatMode: t.vatMode as VatMode,
          quoteDate: new Date(p.quoteDate + 'T00:00:00.000Z'), validUntil: new Date(p.validUntil + 'T00:00:00.000Z'),
          clientName: p.client.name, clientContact: p.client.contact, clientCompany: p.client.company, clientPhone: p.client.phone, clientEmail: p.client.email, clientAddress: p.client.address,
          projectName: p.projectName, quoterName: p.quoter.name || '—', quoterTitle: p.quoter.title, quoterPhone: p.quoter.phone, quoterEmail: p.quoter.email,
          intro: p.intro, terms: p.terms, paymentInfo: p.paymentInfo, createdById: actor.employeeId,
        },
      });
      await this.record(tx, ctx, 'quote.create', q, 'Tạo báo giá ' + q.code, { opportunityId: opp.id, templateId: t.id, versionNo: 1 });
      return this.reads.detailIn(tx, actor, scopeOf, q.id);
    });
  }

  // ───── PATCH /quotes/:id ─────
  // Đổi hạng mục: đổi cả hạng mục của bản nháp (nếu có); phiên bản đã gửi giữ bản chép của nó (mục 4.3).
  async updateItem(ctx: RequestCtx, id: string, dto: UpdateQuoteDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('quote.update') === null) throw quoteErrors.forbidden();
    return this.inTx(async (tx) => {
      const { q, opp } = await this.loadQuote(tx, actor, scopeOf, id, 'quote.update');
      if (opp.status !== 'OPEN') throw quoteErrors.opportunityNotOpen();
      if (q.version !== dto.version) throw quoteErrors.versionConflict(q.version);
      if (dto.itemName === q.itemName) return this.reads.detailIn(tx, actor, scopeOf, id);
      await this.bump(tx, q, { itemName: dto.itemName });
      const draft = q.versions.find((v) => v.status === 'DRAFT');
      if (draft) await tx.quoteVersion.update({ where: { id: draft.id }, data: { itemName: dto.itemName } });
      await this.record(tx, ctx, 'quote.update', q, 'Đổi hạng mục báo giá ' + q.code, { itemName: '(đã thay đổi)' });
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── PUT /quotes/:id/versions/:no ─────
  // Lưu CẢ bản nháp trong một transaction: thay toàn bộ dòng, ghi ô đầu trang, máy chủ tính lại mọi tổng.
  async saveDraft(ctx: RequestCtx, id: string, no: number, dto: SaveQuoteDraftDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('quote.update') === null) throw quoteErrors.forbidden();
    return this.inTx(async (tx) => {
      const { q, opp } = await this.loadQuote(tx, actor, scopeOf, id, 'quote.update');
      const v = this.versionOf(q, no);
      if (v.status !== 'DRAFT') throw quoteErrors.versionLocked();
      if (opp.status !== 'OPEN') throw quoteErrors.opportunityNotOpen();
      // Mục 7.3: bản nháp do người khác tạo và người gọi không được xem giá vốn => không sửa (giá vốn đang lưu không bị xoá, không bị lộ).
      if (!seesCost(actor, scopeOf, v.createdById)) throw quoteErrors.forbidden('Chỉ người tạo bản nháp hoặc Quản trị CRM được sửa bản nháp này. Có thể xoá bản nháp rồi tạo bản mới.');
      if (q.version !== dto.version) throw quoteErrors.versionConflict(q.version);
      const cur = await tx.quoteVersion.findUniqueOrThrow({ where: { id: v.id }, select: { vatMode: true, columns: true, quoteDate: true, validUntil: true } });

      const errs: FieldErr[] = [];
      const quoteDate = keep(dateOf(dto.quoteDate, 'quoteDate', errs), cur.quoteDate);
      const validUntil = keep(dateOf(dto.validUntil, 'validUntil', errs), cur.validUntil);
      if (quoteDate && validUntil && ymd(validUntil)! < ymd(quoteDate)!) errs.push({ field: 'validUntil', code: 'INVALID_DATE', message: 'Hạn hiệu lực phải từ ngày báo giá trở đi.' });
      const parsed = parseLines(dto.lines, cur.vatMode as VatMode, columnKeysOf(cur.columns), dto.vatPercent);
      errs.push(...parsed.errs);
      if (errs.length) throw quoteErrors.validation(errs);
      let totals;
      try { totals = computeTotals(parsed.ins, cur.vatMode as VatMode); } catch (e) {
        if (e instanceof MoneyError && e.code === 'AMOUNT_OUT_OF_RANGE') throw quoteErrors.amountOutOfRange();
        if (e instanceof MoneyError) throw quoteErrors.validation([{ field: 'lines', code: e.code, message: 'Loại báo giá này dùng một mức VAT cho cả báo giá.' }]);
        throw e;
      }

      await tx.quoteLine.deleteMany({ where: { quoteVersionId: v.id } });
      if (parsed.rows.length) {
        await tx.quoteLine.createMany({ data: parsed.rows.map((r, i) => ({ ...r, quoteVersionId: v.id, amountVnd: totals.amounts[i] ?? null })) });
      }
      await tx.quoteVersion.update({
        where: { id: v.id },
        data: {
          quoteDate, validUntil,
          clientName: text(dto.clientName), clientContact: text(dto.clientContact), clientCompany: text(dto.clientCompany), clientPhone: text(dto.clientPhone),
          clientEmail: text(dto.clientEmail), clientAddress: text(dto.clientAddress), projectName: text(dto.projectName),
          quoterName: dto.quoterName, quoterTitle: text(dto.quoterTitle), quoterPhone: text(dto.quoterPhone), quoterEmail: text(dto.quoterEmail),
          intro: dto.intro, terms: dto.terms, paymentInfo: dto.paymentInfo, note: text(dto.note),
          base8Vnd: totals.base8, base10Vnd: totals.base10, subtotalVnd: totals.subtotal, vat8Vnd: totals.vat8, vat10Vnd: totals.vat10, totalVnd: totals.total,
        },
      });
      await this.bump(tx, q);
      await this.record(tx, ctx, 'quote.version.save', q, 'Lưu nháp ' + q.code + ' v' + no, { versionNo: no, lineCount: parsed.rows.length });
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── POST /quotes/:id/versions ─────
  // Tạo bản mới từ phiên bản MỚI NHẤT (mục 8 điểm 5): chép nội dung, bố cục in hiện hành, người tạo = người gọi; giá vốn theo mục 7.3.
  async newVersion(ctx: RequestCtx, id: string, dto: QuoteVersionRefDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('quote.update') === null) throw quoteErrors.forbidden();
    return this.inTx(async (tx) => {
      const { q, opp } = await this.loadQuote(tx, actor, scopeOf, id, 'quote.update');
      if (opp.status !== 'OPEN') throw quoteErrors.opportunityNotOpen();
      if (q.version !== dto.version) throw quoteErrors.versionConflict(q.version);
      if (q.versions.some((v) => v.status === 'DRAFT')) throw quoteErrors.draftExists();
      if (q.versions.some((v) => v.status === 'ACCEPTED')) throw quoteErrors.alreadyAccepted();
      const src = q.versions[q.versions.length - 1];
      if (!src) throw quoteErrors.versionNotFound();
      if (src.versionNo >= MAX_VERSION_NO) throw quoteErrors.versionLimit();
      const s = await tx.quoteVersion.findUniqueOrThrow({ where: { id: src.id }, select: COPY_SELECT });
      const withCost = seesCost(actor, scopeOf, src.createdById);
      const no = src.versionNo + 1;
      const created = await tx.quoteVersion.create({
        data: {
          quoteId: q.id, versionNo: no, codeSnapshot: q.code, itemName: q.itemName, printTemplate: CURRENT_PRINT_TEMPLATE, templateName: s.templateName, title: s.title,
          columns: s.columns as Prisma.InputJsonValue, vatMode: s.vatMode, quoteDate: s.quoteDate, validUntil: s.validUntil,
          clientName: s.clientName, clientContact: s.clientContact, clientCompany: s.clientCompany, clientPhone: s.clientPhone, clientEmail: s.clientEmail, clientAddress: s.clientAddress,
          projectName: s.projectName, quoterName: s.quoterName, quoterTitle: s.quoterTitle, quoterPhone: s.quoterPhone, quoterEmail: s.quoterEmail,
          intro: s.intro, terms: s.terms, paymentInfo: s.paymentInfo, note: s.note,
          subtotalVnd: s.subtotalVnd, base8Vnd: s.base8Vnd, base10Vnd: s.base10Vnd, vat8Vnd: s.vat8Vnd, vat10Vnd: s.vat10Vnd, totalVnd: s.totalVnd, createdById: actor.employeeId,
        },
        select: { id: true },
      });
      if (s.lines.length) {
        await tx.quoteLine.createMany({
          data: s.lines.map((l) => ({
            quoteVersionId: created.id, lineNo: l.lineNo, kind: l.kind, description: l.description, unit: l.unit, note: l.note, extra: l.extra as Prisma.InputJsonValue,
            quantity: l.quantity, unitPriceVnd: l.unitPriceVnd, vatPercent: l.vatPercent, amountVnd: l.amountVnd, costPriceVnd: withCost ? l.costPriceVnd : null,
          })),
        });
      }
      await this.bump(tx, q);
      await this.record(tx, ctx, 'quote.version.create', q, 'Tạo bản mới ' + q.code + ' v' + no, { versionNo: no, fromVersionNo: src.versionNo, costCopied: withCost });
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── DELETE /quotes/:id/versions/:no ─────
  // Xoá bản nháp (xoá cứng dòng + phiên bản; R-Q2b ở DB chỉ cho xoá nháp). Phiên bản duy nhất => xoá cả báo giá thay vì để báo giá rỗng.
  async deleteVersion(ctx: RequestCtx, id: string, no: number, dto: QuoteVersionRefDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('quote.delete') === null) throw quoteErrors.forbidden();
    return this.inTx(async (tx) => {
      const { q } = await this.loadQuote(tx, actor, scopeOf, id, 'quote.delete');
      const v = this.versionOf(q, no);
      if (v.status !== 'DRAFT') throw quoteErrors.versionLocked();
      if (q.versions.length === 1) throw quoteErrors.lastVersion();
      if (q.version !== dto.version) throw quoteErrors.versionConflict(q.version);
      await tx.quoteLine.deleteMany({ where: { quoteVersionId: v.id } });
      await tx.quoteVersion.delete({ where: { id: v.id } });
      await this.bump(tx, q);
      await this.record(tx, ctx, 'quote.version.delete', q, 'Xoá bản nháp ' + q.code + ' v' + no, { versionNo: no });
      return this.reads.detailIn(tx, actor, scopeOf, id);
    });
  }

  // ───── DELETE /quotes/:id ─────
  // Xoá mềm cả báo giá khi CHƯA có phiên bản nào đã gửi (R-Q9 ở DB là lưới chặn thứ hai). Bắt buộc lý do.
  async deleteQuote(ctx: RequestCtx, id: string, dto: DeleteQuoteDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('quote.delete') === null) throw quoteErrors.forbidden();
    return this.inTx(async (tx) => {
      const { q } = await this.loadQuote(tx, actor, scopeOf, id, 'quote.delete');
      if (q.version !== dto.version) throw quoteErrors.versionConflict(q.version);
      if (q.versions.some((v) => v.status !== 'DRAFT')) throw quoteErrors.deleteForbidden();
      await this.bump(tx, q, { deletedAt: new Date(), deletedById: actor.employeeId, deleteReason: dto.reason });
      await this.record(tx, ctx, 'quote.delete', q, 'Xoá báo giá ' + q.code, { reason: '(đã ghi)' });
      return { id: q.id, code: q.code, deleted: true };
    });
  }
}
