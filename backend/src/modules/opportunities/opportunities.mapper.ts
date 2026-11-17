import type { OppRef } from './opportunities.access';

// Sales S6 — trường trả về của cơ hội cho ĐƯỜNG ĐỌC ĐẦY ĐỦ (docs/SALES_DESIGN.md §5.4 "đường truy cập quyết định trường được trả").
// Bản kỹ thuật cho đường theo việc (S9a): hai hàm toOpportunityTech* ở cuối file — chỉ CHỌN RA các trường kỹ thuật, không bao giờ sao chép cả dòng.
const LOOKUP = { select: { id: true, code: true, labelVi: true } } as const;
const EMP = { select: { id: true, code: true, fullName: true } } as const;
// Phần khách mà vị từ quyền cần (chủ, phòng chủ, đã xoá) + nhận diện.
const CUSTOMER_REF = { select: { id: true, code: true, name: true, deletedAt: true, ownerId: true, owner: { select: { departmentId: true } } } } as const;

export const OPP_LIST_SELECT = {
  id: true, code: true, title: true, status: true, probability: true, expectedAmountVnd: true, expectedCloseDate: true, isProjectLinked: true, projectName: true,
  holdUntil: true, wonAmountVnd: true, closedAt: true, version: true, createdAt: true, updatedAt: true, ownerId: true, deletedAt: true,
  type: LOOKUP, stage: LOOKUP, owner: EMP, customer: CUSTOMER_REF,
} as const;

export const OPP_DETAIL_SELECT = {
  ...OPP_LIST_SELECT,
  needSummary: true, offerScope: true, probabilityOverridden: true, holdReason: true, contactId: true,
  wonDocType: true, wonDocNo: true, wonDocDate: true, wonDocUrl: true, wonDocFileName: true, lostNote: true,
  lostReason: LOOKUP,
} as const;

interface Lookup { id: string; code: string; labelVi: string }
interface Emp { id: string; code: string; fullName: string }
interface CustomerRefRow { id: string; code: string; name: string; deletedAt: Date | null; ownerId: string | null; owner: { departmentId: string | null } | null }
export interface OppListRow {
  id: string; code: string; title: string; status: string; probability: number; expectedAmountVnd: bigint | null; expectedCloseDate: Date | null;
  isProjectLinked: boolean; projectName: string | null; holdUntil: Date | null; wonAmountVnd: bigint | null; closedAt: Date | null;
  version: number; createdAt: Date; updatedAt: Date; ownerId: string; deletedAt: Date | null;
  type: Lookup; stage: Lookup; owner: Emp; customer: CustomerRefRow;
}
export interface OppDetailRow extends OppListRow {
  needSummary: string | null; offerScope: string | null; probabilityOverridden: boolean; holdReason: string | null; contactId: string | null;
  wonDocType: string | null; wonDocNo: string | null; wonDocDate: Date | null; wonDocUrl: string | null; wonDocFileName: string | null; lostNote: string | null;
  lostReason: Lookup | null;
}

export const oppRef = (r: Pick<OppListRow, 'ownerId' | 'deletedAt' | 'customer'>): OppRef => ({ ownerId: r.ownerId, deletedAt: r.deletedAt, customer: { ownerId: r.customer.ownerId, deletedAt: r.customer.deletedAt } });

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
// Cột kiểu ngày (không giờ): Prisma trả Date ở 00:00 UTC => lấy phần YYYY-MM-DD.
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
// Số tiền VNĐ là bigint: trả CHUỖI (JSON không có bigint; không ép về number để khỏi mất chính xác). null = "Chưa rõ" — không bao giờ đổi thành 0 (D7).
const money = (v: bigint | null): string | null => (v === null ? null : v.toString());
const lookup = (l: Lookup) => ({ id: l.id, code: l.code, label: l.labelVi });
const emp = (e: Emp) => ({ id: e.id, code: e.code, fullName: e.fullName });
// Xác suất HIỂN THỊ (§6.5): Thắng = 100, Thua = 0, suy từ status; cột probability giữ giá trị trước khi đóng (dùng lại nếu mở lại).
const shownProbability = (status: string, stored: number): number => (status === 'WON' ? 100 : status === 'LOST' ? 0 : stored);

// ownerLostAccess: undefined = người gọi không được biết (không có opportunity.assign) => KHÔNG có khoá này trong phản hồi.
export function toOpportunityListItem(r: OppListRow, ownerLostAccess: boolean | undefined) {
  return {
    id: r.id, code: r.code, title: r.title, status: r.status, access: 'FULL' as const,
    type: lookup(r.type), stage: lookup(r.stage),
    customer: { id: r.customer.id, code: r.customer.code, name: r.customer.name },
    owner: emp(r.owner),
    isProjectLinked: r.isProjectLinked, projectName: r.projectName,
    expectedAmountVnd: money(r.expectedAmountVnd), probability: shownProbability(r.status, r.probability), expectedCloseDate: ymd(r.expectedCloseDate),
    holdUntil: r.status === 'ON_HOLD' ? ymd(r.holdUntil) : null,
    wonAmountVnd: r.status === 'WON' ? money(r.wonAmountVnd) : null,
    closedAt: iso(r.closedAt), deletedAt: iso(r.deletedAt),
    version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    ...(ownerLostAccess === undefined ? {} : { ownerLostAccess }),
  };
}

export interface CustomerCard { id: string; code: string; name: string; shortName: string | null; address: string | null; provinceName: string | null; phone: string | null }
export interface ContactCard { id: string; code: string; fullName: string; title: string | null; phone: string | null }

// Chi tiết — đường đầy đủ. Trường tạm hoãn / thắng / thua chỉ hiện khi đang ở đúng trạng thái đó (§6.4: hold_* giữ làm dấu vết, không hiển thị
// khi OPEN; won_* / lost_* giữ làm dấu vết sau khi mở lại) — dấu vết xem ở lịch sử thay đổi (S7), không ở đây.
export function toOpportunityDetail(r: OppDetailRow, extra: { customer: CustomerCard; customerReadable: boolean; contact: ContactCard | null; ownerLostAccess: boolean | undefined }) {
  const hold = r.status === 'ON_HOLD'; const won = r.status === 'WON'; const lost = r.status === 'LOST';
  return {
    id: r.id, code: r.code, title: r.title, status: r.status, access: 'FULL' as const,
    type: lookup(r.type), stage: lookup(r.stage),
    // Thẻ khách TỐI THIỂU [C5] cho mọi người đọc được cơ hội; customerReadable = người gọi có đọc được hồ sơ khách qua API Khách hàng hay không.
    customer: extra.customer, customerReadable: extra.customerReadable,
    contact: extra.contact,
    owner: emp(r.owner),
    needSummary: r.needSummary, isProjectLinked: r.isProjectLinked, projectName: r.projectName, offerScope: r.offerScope,
    expectedAmountVnd: money(r.expectedAmountVnd), probability: shownProbability(r.status, r.probability), probabilityOverridden: r.probabilityOverridden,
    expectedCloseDate: ymd(r.expectedCloseDate),
    holdUntil: hold ? ymd(r.holdUntil) : null, holdReason: hold ? r.holdReason : null,
    wonAmountVnd: won ? money(r.wonAmountVnd) : null, wonDocType: won ? r.wonDocType : null, wonDocNo: won ? r.wonDocNo : null,
    wonDocDate: won ? ymd(r.wonDocDate) : null, wonDocUrl: won ? r.wonDocUrl : null, wonDocFileName: won ? r.wonDocFileName : null,
    lostReason: lost && r.lostReason ? lookup(r.lostReason) : null, lostNote: lost ? r.lostNote : null,
    closedAt: iso(r.closedAt),
    version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    ...(extra.ownerLostAccess === undefined ? {} : { ownerLostAccess: extra.ownerLostAccess }),
  };
}

// ───── Bản KỸ THUẬT — đường đọc theo việc (§5.1 [C7], §5.4 "đường truy cập quyết định trường được trả") ─────
// Chỉ: tiêu đề, loại, giai đoạn, trạng thái, tên dự án / công trình, phạm vi chào, nhu cầu, ngày dự kiến, khách (mã + tên), người phụ trách.
// KHÔNG BAO GIỜ: giá trị dự kiến / chốt, xác suất, hold_*, won_*, lost_*, closed_at, cờ ownerLostAccess, người liên hệ, thẻ khách (địa chỉ, điện
// thoại — lấy qua /activities/:id/work-card của B3). Liệt kê tường minh từng trường: thêm cột mới vào select không tự lọt ra ngoài.
export function toOpportunityTechListItem(r: OppListRow) {
  return {
    id: r.id, code: r.code, title: r.title, status: r.status, access: 'TASK' as const,
    type: lookup(r.type), stage: lookup(r.stage),
    customer: { id: r.customer.id, code: r.customer.code, name: r.customer.name },
    owner: emp(r.owner),
    isProjectLinked: r.isProjectLinked, projectName: r.projectName,
    expectedCloseDate: ymd(r.expectedCloseDate),
    version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}
export function toOpportunityTechDetail(r: OppDetailRow) {
  return { ...toOpportunityTechListItem(r), needSummary: r.needSummary, offerScope: r.offerScope };
}
