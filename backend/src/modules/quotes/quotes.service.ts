import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { PrismaService } from '../../prisma/prisma.service';
import { fullReadWhere, OppRef, ScopeOf } from '../opportunities/opportunities.access';
import { allowsQuoteWrite, assertQuoteReadCode, mayHaveDefaults, mayManageTemplates, mayUseTemplates, quoteReadWhere, readsQuotesOf, seesCost } from './quotes.access';
import { quoteErrors } from './quotes.errors';
import {
  oppRefOf, QUOTE_DETAIL_SELECT, QUOTE_LIST_SELECT, QuoteDetailRow, QuoteListRow, TEMPLATE_SELECT, TemplateRow, toQuoteDetail, toQuoteListItem, toQuoteOfOpportunity, toTemplate,
  VERSION_SUMMARY_SELECT, VersionSummaryRow,
} from './quotes.mapper';
import { candidateIds, todayVn } from './quotes.state';
import type { QueryQuotesDto } from './dto/query-quotes.dto';

type Tx = Prisma.TransactionClient;
const MAX_OFFSET_WINDOW = 100000;
// Bố cục in hiện hành (mục 4.3): phiên bản mới ghi mã này; bố cục cũ không bao giờ bị sửa.
export const CURRENT_PRINT_TEMPLATE = 'siscom-v1';
const cut = (s: string | null | undefined, max: number): string | null => { const t = (s ?? '').trim(); return t === '' ? null : t.slice(0, max); };
const addDays = (ymd: string, days: number): string => new Date(new Date(ymd + 'T00:00:00.000Z').getTime() + days * 86_400_000).toISOString().slice(0, 10);

// Báo giá Q4 (docs/QUOTES_DESIGN.md mục 7, 9) — ĐỌC: danh sách, theo cơ hội, chi tiết, giá trị điền sẵn, loại báo giá, mặc định cá nhân.
// Quy tắc: không có mã quyền của đường đọc => 403; ngoài phạm vi xem => 404 (không lộ tồn tại); mọi bộ lọc áp SAU vị từ phạm vi.
// MỘT vị từ cho mọi đường đọc báo giá: quoteReadWhere = quote.read đang hiệu lực + đường ĐẦY ĐỦ của cơ hội (không có đường theo việc).
// ĐỌC NHẤT QUÁN: mỗi request đọc toàn bộ dữ liệu của nó trong MỘT transaction REPEATABLE READ (cùng mẫu OpportunitiesService) — căn cứ quyền,
// dữ liệu và total luôn thuộc một snapshot. Không truy vấn nghiệp vụ nào đi qua this.prisma trực tiếp.
// GIÁ VỐN (mục 7.3): chỉ có ở API chi tiết, theo TỪNG phiên bản: seesCost(người gọi, người tạo phiên bản) — xét SAU khi đã qua quoteReadWhere.
@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService, @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }
  private snapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
  }
  // Phiên bản mới nhất của từng báo giá trong nhóm (một truy vấn; DISTINCT ON không có ở Prisma nên lấy theo versionNo giảm dần rồi giữ dòng đầu).
  private async latestOf(tx: Tx, quoteIds: readonly string[]): Promise<Map<string, VersionSummaryRow>> {
    const out = new Map<string, VersionSummaryRow>();
    if (quoteIds.length === 0) return out;
    const rows = (await tx.quoteVersion.findMany({ where: { quoteId: { in: [...quoteIds] } }, orderBy: [{ quoteId: 'asc' }, { versionNo: 'desc' }], select: VERSION_SUMMARY_SELECT })) as VersionSummaryRow[];
    for (const v of rows) if (!out.has(v.quoteId)) out.set(v.quoteId, v);
    return out;
  }

  // ───── GET /quotes ─────
  async list(ctx: RequestCtx, q: QueryQuotesDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    assertQuoteReadCode(scopeOf);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const errs: string[] = [];
    if (page * pageSize > MAX_OFFSET_WINDOW) errs.push('page × pageSize vượt quá ' + MAX_OFFSET_WINDOW + '.');
    const search = q.q === undefined ? undefined : q.q.trim();
    if (search !== undefined && search.length < 2) errs.push('Từ khoá tìm kiếm cần ít nhất 2 ký tự.');
    if (errs.length) throw quoteErrors.validation(errs);

    const filters: Prisma.QuoteWhereInput[] = [];
    if (q.templateId) filters.push({ templateId: q.templateId });
    if (q.customerId) filters.push({ customerId: q.customerId });
    if (q.opportunityId) filters.push({ opportunityId: q.opportunityId });
    if (q.ownerId) filters.push({ opportunity: { is: { ownerId: q.ownerId } } });
    const order = q.sortOrder ?? 'desc';
    const orderBy: Prisma.QuoteOrderByWithRelationInput[] = q.sortBy === 'code' ? [{ code: order }] : q.sortBy === 'createdAt' ? [{ createdAt: order }, { code: order }] : [{ updatedAt: order }, { code: order }];

    return this.snapshot(async (tx) => {
      const today = await todayVn(tx);
      // Trạng thái theo phiên bản mới nhất / từ khoá không dấu: tính bằng SQL (quotes.state.ts) thành danh sách id, CHỈ dùng để thu hẹp thêm.
      const narrowed = q.state !== undefined || search !== undefined ? [{ id: { in: await candidateIds(tx, { ...(q.state ? { state: q.state } : {}), ...(search !== undefined ? { search } : {}) }) } }] : [];
      // Vị từ phạm vi LUÔN đứng đầu; count và rows dùng CÙNG where, cùng snapshot.
      const where: Prisma.QuoteWhereInput = { AND: [quoteReadWhere(actor, scopeOf), ...filters, ...narrowed] };
      const total = await tx.quote.count({ where });
      const rows = (total === 0 ? [] : await tx.quote.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: QUOTE_LIST_SELECT })) as QuoteListRow[];
      const latest = await this.latestOf(tx, rows.map((r) => r.id));
      return { items: rows.map((r) => toQuoteListItem(r, latest.get(r.id), today)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
    });
  }

  // Cơ hội mà người gọi thấy trên đường ĐẦY ĐỦ (đường theo việc không tính) — không thấy => 404 như cơ hội không tồn tại.
  private async visibleOpportunity(tx: Tx, actor: Actor, scopeOf: ScopeOf, opportunityId: string) {
    const o = await tx.opportunity.findFirst({
      where: { AND: [{ id: opportunityId }, fullReadWhere(actor, scopeOf)] },
      select: { id: true, code: true, title: true, status: true, ownerId: true, deletedAt: true, contactId: true, projectName: true, customerId: true, customer: { select: { ownerId: true, deletedAt: true } } },
    });
    if (!o) throw quoteErrors.opportunityNotFound();
    const ref: OppRef = { ownerId: o.ownerId, deletedAt: o.deletedAt, customer: { ownerId: o.customer.ownerId, deletedAt: o.customer.deletedAt } };
    return { o, ref };
  }

  // ───── GET /opportunities/:opportunityId/quotes ─────
  async listByOpportunity(ctx: RequestCtx, opportunityId: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    assertQuoteReadCode(scopeOf);
    return this.snapshot(async (tx) => {
      const { ref } = await this.visibleOpportunity(tx, actor, scopeOf, opportunityId);
      if (!readsQuotesOf(actor, scopeOf, ref)) throw quoteErrors.opportunityNotFound();
      const today = await todayVn(tx);
      const rows = (await tx.quote.findMany({ where: { AND: [quoteReadWhere(actor, scopeOf), { opportunityId }] }, orderBy: [{ createdAt: 'asc' }, { code: 'asc' }], select: QUOTE_LIST_SELECT })) as QuoteListRow[];
      const versions = rows.length === 0 ? [] : ((await tx.quoteVersion.findMany({ where: { quoteId: { in: rows.map((r) => r.id) } }, orderBy: [{ quoteId: 'asc' }, { versionNo: 'asc' }], select: VERSION_SUMMARY_SELECT })) as VersionSummaryRow[]);
      const by = new Map<string, VersionSummaryRow[]>();
      for (const v of versions) { const a = by.get(v.quoteId); if (a) a.push(v); else by.set(v.quoteId, [v]); }
      return {
        items: rows.map((r) => toQuoteOfOpportunity(r, by.get(r.id) ?? [], today)),
        // Quyền thao tác của người gọi trên cơ hội này (giao diện ẩn / hiện nút; máy chủ vẫn kiểm lại ở từng thao tác ghi).
        can: { create: allowsQuoteWrite(actor, scopeOf, 'quote.create', ref), export: allowsQuoteWrite(actor, scopeOf, 'quote.export', ref) },
      };
    });
  }

  // ───── GET /quotes/:id ─────
  async detail(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    assertQuoteReadCode(scopeOf);
    return this.snapshot(async (tx) => {
      const row = (await tx.quote.findFirst({ where: { AND: [{ id }, quoteReadWhere(actor, scopeOf)] }, select: QUOTE_DETAIL_SELECT })) as QuoteDetailRow | null;
      if (!row) throw quoteErrors.notFound();
      const ref = oppRefOf(row.opportunity);
      const today = await todayVn(tx);
      return {
        ...toQuoteDetail(row, today, (v) => seesCost(actor, scopeOf, v.createdById)),
        can: {
          update: allowsQuoteWrite(actor, scopeOf, 'quote.update', ref), send: allowsQuoteWrite(actor, scopeOf, 'quote.send', ref), decide: allowsQuoteWrite(actor, scopeOf, 'quote.decide', ref),
          delete: allowsQuoteWrite(actor, scopeOf, 'quote.delete', ref), export: allowsQuoteWrite(actor, scopeOf, 'quote.export', ref),
        },
      };
    });
  }

  // ───── GET /quotes/templates ─────
  // Đang dùng: người có quote.create hoặc quote.template. all = kể cả đã ngừng: chỉ quote.template [QB19].
  async templates(ctx: RequestCtx, all: boolean) {
    const scopeOf = this.scopeOf(ctx.actor);
    if (!mayUseTemplates(scopeOf)) throw quoteErrors.forbidden('Không có quyền xem loại báo giá.');
    if (all && !mayManageTemplates(scopeOf)) throw quoteErrors.forbidden('Không có quyền quản lý loại báo giá.');
    return this.snapshot(async (tx) => {
      const rows = (await tx.quoteTemplate.findMany({ where: all ? {} : { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { code: 'asc' }], select: TEMPLATE_SELECT })) as TemplateRow[];
      return { items: rows.map(toTemplate), canManage: mayManageTemplates(scopeOf) };
    });
  }

  // ───── GET /quotes/my-defaults ─────
  // Mặc định cá nhân [QB15]: LUÔN là của chính người gọi (không có tham số nhân viên) — không ai đọc được của người khác.
  async myDefaults(ctx: RequestCtx) {
    const scopeOf = this.scopeOf(ctx.actor);
    if (!mayHaveDefaults(scopeOf)) throw quoteErrors.forbidden('Không có quyền dùng mặc định báo giá.');
    return this.snapshot(async (tx) => {
      const d = await tx.quoteUserDefault.findUnique({ where: { employeeId: ctx.actor.employeeId }, select: { quoterTitle: true, quoterPhone: true, quoterEmail: true, paymentInfo: true, updatedAt: true } });
      return { saved: d !== null, quoterTitle: d?.quoterTitle ?? null, quoterPhone: d?.quoterPhone ?? null, quoterEmail: d?.quoterEmail ?? null, paymentInfo: d?.paymentInfo ?? '', updatedAt: d ? d.updatedAt.toISOString() : null };
    });
  }

  // ───── GET /opportunities/:opportunityId/quotes/defaults?templateId= ─────
  // Giá trị điền sẵn khi lập báo giá mới (mục 4.3, 8.1): CHỈ là gợi ý — khi lưu, máy chủ chép lại từ nguồn và từ thân yêu cầu (Q5).
  // Cần quote.create trên cơ hội mình phụ trách (hoặc ALL); cơ hội phải đang mở; loại báo giá phải đang dùng.
  async defaults(ctx: RequestCtx, opportunityId: string, templateId: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('quote.create') === null) throw quoteErrors.forbidden('Không có quyền lập báo giá.');
    return this.snapshot(async (tx) => {
      const { o, ref } = await this.visibleOpportunity(tx, actor, scopeOf, opportunityId);
      if (!allowsQuoteWrite(actor, scopeOf, 'quote.create', ref)) throw quoteErrors.forbidden('Chỉ người phụ trách cơ hội được lập báo giá.');
      if (o.status !== 'OPEN') throw quoteErrors.opportunityNotOpen();
      const t = (await tx.quoteTemplate.findUnique({ where: { id: templateId }, select: TEMPLATE_SELECT })) as TemplateRow | null;
      if (!t) throw quoteErrors.templateNotFound();
      if (!t.isActive) throw quoteErrors.templateInactive();
      const today = await todayVn(tx);
      const customer = await tx.customer.findFirst({ where: { id: o.customerId, deletedAt: null }, select: { name: true, phone: true, email: true, address: true } });
      if (!customer) throw quoteErrors.opportunityNotFound(); // không xảy ra trong cùng snapshot (vị từ buộc khách chưa xoá) — fail-closed
      // Người liên hệ: của cơ hội nếu có, không thì người liên hệ chính của khách.
      const contact = o.contactId
        ? await tx.contact.findFirst({ where: { id: o.contactId, customerId: o.customerId, deletedAt: null }, select: { fullName: true, phone: true, email: true } })
        : await tx.contact.findFirst({ where: { customerId: o.customerId, deletedAt: null, isPrimary: true }, orderBy: { createdAt: 'asc' }, select: { fullName: true, phone: true, email: true } });
      const me = await tx.employee.findUnique({ where: { id: actor.employeeId }, select: { fullName: true, positionTitle: true, phone: true, email: true } });
      const mine = await tx.quoteUserDefault.findUnique({ where: { employeeId: actor.employeeId }, select: { quoterTitle: true, quoterPhone: true, quoterEmail: true, paymentInfo: true } });
      return {
        template: toTemplate(t),
        printTemplate: CURRENT_PRINT_TEMPLATE,
        quoteDate: today, validUntil: addDays(today, t.defaultValidDays), vatPercent: t.defaultVat,
        client: {
          name: cut(contact?.fullName, 200), contact: null, company: cut(customer.name, 200), phone: cut(contact?.phone ?? customer.phone, 30), email: cut(contact?.email ?? customer.email, 254),
          address: cut(customer.address, 500),
        },
        projectName: cut(o.projectName, 200),
        quoter: { name: cut(me?.fullName, 200) ?? '', title: cut(mine?.quoterTitle ?? me?.positionTitle, 120), phone: cut(mine?.quoterPhone ?? me?.phone, 30), email: cut(mine?.quoterEmail ?? me?.email, 254) },
        intro: t.intro, terms: t.defaultTerms, paymentInfo: mine?.paymentInfo ?? '',
      };
    });
  }
}
