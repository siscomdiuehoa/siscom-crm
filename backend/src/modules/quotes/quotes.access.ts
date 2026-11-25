import type { Prisma } from '../../generated/prisma/client';
import type { Actor } from '../../common/auth/actor';
import { fullReadWhere, OppRef, readsFull, ScopeOf } from '../opportunities/opportunities.access';
import { quoteErrors } from './quotes.errors';

// Báo giá Q4 — chính sách truy cập (docs/QUOTES_DESIGN.md mục 7.1, 7.3). Hàm THUẦN, không có nhánh theo tên vai trò.
// Báo giá ĐI THEO CƠ HỘI: mọi đường đọc = mã quote.read ĐANG HIỆU LỰC  VÀ  vị từ "đường đầy đủ" của cơ hội (fullReadWhere / readsFull của module
// cơ hội — MỘT nguồn duy nhất). KHÔNG dùng "đường theo việc" (taskPathWhere): Kỹ thuật có việc trên cơ hội vẫn không thấy báo giá.
// Phạm vi của chính mã quote.* (ALL / OWN) không mở rộng gì thêm: OWN = theo cơ hội mình thấy được (đọc) / mình phụ trách (ghi, tải);
// DEPARTMENT không cấp ở đợt này => fail-closed.

const NONE: Prisma.QuoteWhereInput = { id: { in: [] } };

// Không có mã đọc => 403 (khác "ngoài phạm vi" => 404).
export function assertQuoteReadCode(scopeOf: ScopeOf): void {
  if (scopeOf('quote.read') === null) throw quoteErrors.forbidden('Không có quyền xem báo giá.');
}
const readScopeOk = (scopeOf: ScopeOf): boolean => { const s = scopeOf('quote.read'); return s === 'ALL' || s === 'OWN'; };

// MỘT vị từ cho danh sách / đếm / chi tiết / theo cơ hội (và tải tệp ở Q9, Q10): báo giá chưa xoá + cơ hội đạt đường đầy đủ.
export function quoteReadWhere(actor: Actor, scopeOf: ScopeOf): Prisma.QuoteWhereInput {
  if (!readScopeOk(scopeOf)) return NONE;
  return { AND: [{ deletedAt: null }, { opportunity: { is: fullReadWhere(actor, scopeOf) } }] };
}
// Cùng vị từ ở dạng hàm trên một cơ hội đã nạp.
export function readsQuotesOf(actor: Actor, scopeOf: ScopeOf, opp: OppRef): boolean {
  return readScopeOk(scopeOf) && readsFull(actor, scopeOf, opp);
}

// Ghi / gửi / kết quả / xoá / tải: ALL, hoặc OWN và mình PHỤ TRÁCH cơ hội (như opportunity.update). Luôn cần thấy được cơ hội trước.
export type QuoteWriteCode = 'quote.create' | 'quote.update' | 'quote.send' | 'quote.decide' | 'quote.delete' | 'quote.export';
export function allowsQuoteWrite(actor: Actor, scopeOf: ScopeOf, code: QuoteWriteCode, opp: OppRef): boolean {
  if (!readsFull(actor, scopeOf, opp)) return false;
  const s = scopeOf(code);
  return s === 'ALL' || (s === 'OWN' && opp.ownerId === actor.employeeId);
}

// Giá vốn [QB23] (mục 7.3): người có quote.cost, HOẶC người tạo ra chính phiên bản đó. CHỈ gọi sau khi người gọi đã qua quoteReadWhere —
// "là người tạo" không bao giờ mở rộng phạm vi đọc.
export function seesCost(actor: Actor, scopeOf: ScopeOf, versionCreatedById: string): boolean {
  return scopeOf('quote.cost') !== null || versionCreatedById === actor.employeeId;
}

// Loại báo giá: đọc danh sách đang dùng = người có quote.create hoặc quote.template; xem cả loại đã ngừng / quản lý = quote.template [QB19].
export const mayUseTemplates = (scopeOf: ScopeOf): boolean => scopeOf('quote.create') !== null || scopeOf('quote.template') !== null;
export const mayManageTemplates = (scopeOf: ScopeOf): boolean => scopeOf('quote.template') !== null;
// Mặc định cá nhân: chỉ của chính mình; cần quote.create.
export const mayHaveDefaults = (scopeOf: ScopeOf): boolean => scopeOf('quote.create') !== null;
