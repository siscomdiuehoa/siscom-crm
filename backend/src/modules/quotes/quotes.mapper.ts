import type { OppRef } from '../opportunities/opportunities.access';
import { suggestedFileName } from './quotes.filename';
import { costSummary, LineIn, qtyFromDb } from './quotes.money';

// Báo giá Q4 — trường trả về (docs/QUOTES_DESIGN.md mục 7.2, 7.3). Mỗi hàm LIỆT KÊ TƯỜNG MINH từng trường, không bao giờ sao chép cả dòng
// (cùng cách toOpportunityTechDetail). Dòng hàng có HAI dạng: có giá vốn / không có giá vốn — người không được xem nhận phản hồi KHÔNG CÓ KHOÁ
// costPriceVnd (không phải null: không lộ cả việc "đã nhập hay chưa"). Danh sách khoá của từng dạng được ghim trong quotes.mapper.spec.ts.
// Tiền: bigint => CHUỖI chữ số (tổng sau VAT có thể vượt số nguyên an toàn của JavaScript). Số lượng: chuỗi thập phân.

const EMP = { select: { id: true, code: true, fullName: true } } as const;
// Phần cơ hội + khách mà vị từ quyền cần, kèm nhận diện.
const OPP_REF = { select: { id: true, code: true, title: true, status: true, ownerId: true, deletedAt: true, customer: { select: { id: true, code: true, name: true, ownerId: true, deletedAt: true } } } } as const;
const TEMPLATE_REF = { select: { id: true, code: true, name: true } } as const;

export const QUOTE_LIST_SELECT = {
  id: true, code: true, itemName: true, isPrimary: true, version: true, createdAt: true, updatedAt: true,
  template: TEMPLATE_REF, opportunity: OPP_REF, createdBy: EMP,
} as const;

export const VERSION_SUMMARY_SELECT = {
  id: true, quoteId: true, versionNo: true, status: true, quoteDate: true, validUntil: true, subtotalVnd: true, totalVnd: true, sentAt: true, decidedAt: true,
} as const;

const LINE_SELECT = {
  lineNo: true, kind: true, description: true, unit: true, note: true, extra: true, quantity: true, unitPriceVnd: true, vatPercent: true, amountVnd: true, costPriceVnd: true,
} as const;

export const VERSION_DETAIL_SELECT = {
  id: true, versionNo: true, status: true, codeSnapshot: true, itemName: true, printTemplate: true, templateName: true, title: true, columns: true, vatMode: true,
  quoteDate: true, validUntil: true, clientName: true, clientContact: true, clientCompany: true, clientPhone: true, clientEmail: true, clientAddress: true, projectName: true,
  quoterName: true, quoterTitle: true, quoterPhone: true, quoterEmail: true, intro: true, terms: true, paymentInfo: true,
  subtotalVnd: true, base8Vnd: true, base10Vnd: true, vat8Vnd: true, vat10Vnd: true, totalVnd: true, note: true, rejectReason: true,
  createdById: true, createdAt: true, updatedAt: true, sentAt: true, decidedAt: true,
  createdBy: EMP, sentBy: EMP, decidedBy: EMP,
  lines: { select: LINE_SELECT, orderBy: { lineNo: 'asc' as const } },
} as const;

export const QUOTE_DETAIL_SELECT = { ...QUOTE_LIST_SELECT, versions: { select: VERSION_DETAIL_SELECT, orderBy: { versionNo: 'asc' as const } } } as const;

export const TEMPLATE_SELECT = {
  id: true, code: true, name: true, title: true, intro: true, defaultTerms: true, defaultValidDays: true, defaultVat: true, vatMode: true, columns: true, isActive: true, sortOrder: true, version: true,
} as const;

interface Emp { id: string; code: string; fullName: string }
interface OppRow { id: string; code: string; title: string; status: string; ownerId: string; deletedAt: Date | null; customer: { id: string; code: string; name: string; ownerId: string | null; deletedAt: Date | null } }
export interface QuoteListRow {
  id: string; code: string; itemName: string; isPrimary: boolean; version: number; createdAt: Date; updatedAt: Date;
  template: { id: string; code: string; name: string }; opportunity: OppRow; createdBy: Emp;
}
export interface VersionSummaryRow { id: string; quoteId: string; versionNo: number; status: string; quoteDate: Date | null; validUntil: Date | null; subtotalVnd: bigint; totalVnd: bigint; sentAt: Date | null; decidedAt: Date | null }
// Decimal của Prisma: chỉ cần toString().
interface DecimalLike { toString(): string }
export interface LineRow {
  lineNo: number; kind: string; description: string; unit: string; note: string | null; extra: unknown; quantity: DecimalLike | null;
  unitPriceVnd: bigint | null; vatPercent: number | null; amountVnd: bigint | null; costPriceVnd: bigint | null;
}
export interface VersionDetailRow {
  id: string; versionNo: number; status: string; codeSnapshot: string; itemName: string; printTemplate: string; templateName: string; title: string; columns: unknown; vatMode: string;
  quoteDate: Date | null; validUntil: Date | null; clientName: string | null; clientContact: string | null; clientCompany: string | null; clientPhone: string | null; clientEmail: string | null;
  clientAddress: string | null; projectName: string | null; quoterName: string; quoterTitle: string | null; quoterPhone: string | null; quoterEmail: string | null;
  intro: string; terms: string; paymentInfo: string; subtotalVnd: bigint; base8Vnd: bigint; base10Vnd: bigint; vat8Vnd: bigint; vat10Vnd: bigint; totalVnd: bigint;
  note: string | null; rejectReason: string | null; createdById: string; createdAt: Date; updatedAt: Date; sentAt: Date | null; decidedAt: Date | null;
  createdBy: Emp; sentBy: Emp | null; decidedBy: Emp | null; lines: LineRow[];
}
export interface QuoteDetailRow extends QuoteListRow { versions: VersionDetailRow[] }
export interface TemplateRow {
  id: string; code: string; name: string; title: string; intro: string; defaultTerms: string; defaultValidDays: number; defaultVat: number; vatMode: string; columns: unknown;
  isActive: boolean; sortOrder: number; version: number;
}

export const oppRefOf = (o: OppRow): OppRef => ({ ownerId: o.ownerId, deletedAt: o.deletedAt, customer: { ownerId: o.customer.ownerId, deletedAt: o.customer.deletedAt } });

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
// Cột DATE: 'YYYY-MM-DD' (Prisma trả Date ở 00:00 UTC).
export const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
// Tiền: bigint => chuỗi chữ số; KHÔNG đi qua Number.
export const money = (v: bigint | null): string | null => (v === null ? null : v.toString());
const emp = (e: Emp | null) => (e ? { id: e.id, code: e.code, fullName: e.fullName } : null);

// Trạng thái hiển thị của một phiên bản: SENT quá hạn => EXPIRED ("hết hiệu lực" không lưu trong DB — mục 5.3). today: 'YYYY-MM-DD' theo giờ Việt Nam,
// lấy từ DB trong cùng snapshot (quotes.state.ts) — cùng một mốc với bộ lọc danh sách.
export type VersionState = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export function versionState(status: string, validUntil: Date | null, today: string): { state: VersionState; daysLeft: number | null } {
  if (status !== 'SENT' || validUntil === null) return { state: status as VersionState, daysLeft: null };
  const days = Math.round((validUntil.getTime() - new Date(today + 'T00:00:00.000Z').getTime()) / 86_400_000);
  return { state: days < 0 ? 'EXPIRED' : 'SENT', daysLeft: days };
}

function toVersionSummary(v: VersionSummaryRow, today: string) {
  const s = versionState(v.status, v.validUntil, today);
  return {
    versionNo: v.versionNo, status: v.status, state: s.state, daysLeft: s.daysLeft, quoteDate: ymd(v.quoteDate), validUntil: ymd(v.validUntil),
    subtotalVnd: money(v.subtotalVnd), totalVnd: money(v.totalVnd), sentAt: iso(v.sentAt), decidedAt: iso(v.decidedAt),
  };
}

function quoteHead(r: QuoteListRow) {
  return {
    id: r.id, code: r.code, itemName: r.itemName, isPrimary: r.isPrimary, version: r.version, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    template: { id: r.template.id, code: r.template.code, name: r.template.name },
    opportunity: { id: r.opportunity.id, code: r.opportunity.code, title: r.opportunity.title, status: r.opportunity.status, ownerId: r.opportunity.ownerId },
    customer: { id: r.opportunity.customer.id, code: r.opportunity.customer.code, name: r.opportunity.customer.name },
    createdBy: emp(r.createdBy),
  };
}

// Danh sách chung: một dòng / báo giá, kèm tóm tắt phiên bản MỚI NHẤT (null nếu chưa có phiên bản). KHÔNG có giá vốn.
export function toQuoteListItem(r: QuoteListRow, latest: VersionSummaryRow | undefined, today: string) {
  return { ...quoteHead(r), latest: latest ? toVersionSummary(latest, today) : null };
}
// Theo cơ hội: một khối / báo giá, kèm bảng MỌI phiên bản (tóm tắt). KHÔNG có giá vốn.
export function toQuoteOfOpportunity(r: QuoteListRow, versions: readonly VersionSummaryRow[], today: string) {
  return { ...quoteHead(r), versions: versions.map((v) => toVersionSummary(v, today)) };
}

function lineBase(l: LineRow) {
  return {
    lineNo: l.lineNo, kind: l.kind, description: l.description, unit: l.unit, note: l.note, extra: l.extra,
    quantity: l.quantity === null ? null : l.quantity.toString(), unitPriceVnd: money(l.unitPriceVnd), vatPercent: l.vatPercent, amountVnd: money(l.amountVnd),
  };
}
// Dạng KHÔNG có giá vốn — không có khoá costPriceVnd.
export const toLine = (l: LineRow) => lineBase(l);
// Dạng CÓ giá vốn — chỉ cho người qua seesCost.
export const toLineWithCost = (l: LineRow) => ({ ...lineBase(l), costPriceVnd: money(l.costPriceVnd) });

// Chi tiết một phiên bản. withCost do service quyết định bằng seesCost(người gọi, phiên bản) — mapper không tự suy quyền.
export function toVersionDetail(v: VersionDetailRow, quoteCode: string, today: string, withCost: boolean) {
  const s = versionState(v.status, v.validUntil, today);
  return {
    versionNo: v.versionNo, status: v.status, state: s.state, daysLeft: s.daysLeft,
    codeSnapshot: v.codeSnapshot, itemName: v.itemName, printTemplate: v.printTemplate, templateName: v.templateName, title: v.title, columns: v.columns, vatMode: v.vatMode,
    quoteDate: ymd(v.quoteDate), validUntil: ymd(v.validUntil),
    client: { name: v.clientName, contact: v.clientContact, company: v.clientCompany, phone: v.clientPhone, email: v.clientEmail, address: v.clientAddress },
    projectName: v.projectName,
    quoter: { name: v.quoterName, title: v.quoterTitle, phone: v.quoterPhone, email: v.quoterEmail },
    intro: v.intro, terms: v.terms, paymentInfo: v.paymentInfo,
    subtotalVnd: money(v.subtotalVnd), base8Vnd: money(v.base8Vnd), base10Vnd: money(v.base10Vnd), vat8Vnd: money(v.vat8Vnd), vat10Vnd: money(v.vat10Vnd), totalVnd: money(v.totalVnd),
    note: v.note, rejectReason: v.rejectReason,
    createdBy: emp(v.createdBy), createdAt: iso(v.createdAt), updatedAt: iso(v.updatedAt), sentBy: emp(v.sentBy), sentAt: iso(v.sentAt), decidedBy: emp(v.decidedBy), decidedAt: iso(v.decidedAt),
    // Tên tệp gợi ý (mục 4.4): mọi thành phần lấy từ CHÍNH phiên bản (mã, hạng mục, khách đã chốt). Nháp chưa có ngày => hôm nay.
    suggestedFileName: suggestedFileName({
      quoteDate: ymd(v.quoteDate) ?? today, code: v.codeSnapshot || quoteCode, versionNo: v.versionNo, clientName: v.clientCompany ?? v.clientName, itemName: v.itemName, draft: v.status === 'DRAFT',
    }),
    costVisible: withCost,
    lines: withCost ? v.lines.map(toLineWithCost) : v.lines.map(toLine),
    // Lãi gộp tạm tính (Q5, mục 6): CHỈ có ở dạng có giá vốn; người không được xem không có cả khoá này.
    ...(withCost ? { margin: marginOf(v.lines) } : {}),
  };
}

// Dòng đã lưu => đầu vào của bộ tính tiền (số lượng từ chuỗi numeric, tiền BigInt; không qua Number).
export function lineInOf(l: LineRow): LineIn {
  if (l.kind !== 'ITEM' || l.quantity === null || l.unitPriceVnd === null || (l.vatPercent !== 8 && l.vatPercent !== 10)) return { kind: 'SECTION' };
  return { kind: 'ITEM', q: qtyFromDb(l.quantity.toString()), price: l.unitPriceVnd, vat: l.vatPercent, cost: l.costPriceVnd };
}
const marginOf = (lines: readonly LineRow[]) => costSummary(lines.map(lineInOf), lines.map((l) => l.amountVnd));

export function toQuoteDetail(r: QuoteDetailRow, today: string, withCostOf: (v: VersionDetailRow) => boolean) {
  return { ...quoteHead(r), versions: r.versions.map((v) => toVersionDetail(v, r.code, today, withCostOf(v))) };
}

// Loại báo giá: không chứa giá của báo giá nào.
export function toTemplate(t: TemplateRow) {
  return {
    id: t.id, code: t.code, name: t.name, title: t.title, intro: t.intro, defaultTerms: t.defaultTerms, defaultValidDays: t.defaultValidDays, defaultVat: t.defaultVat,
    vatMode: t.vatMode, columns: t.columns, isActive: t.isActive, sortOrder: t.sortOrder, version: t.version,
  };
}
