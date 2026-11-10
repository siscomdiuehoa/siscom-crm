import { Prisma } from '../../generated/prisma/client';
import type { Actor, Scope } from '../../common/auth/actor';
import type { LookupKey } from './customers.defaults';

// Thoát ký tự đặc biệt của LIKE (\ % _) — khớp cách fn_customer_search xử lý: chúng là ký tự thường.
export const escapeLike = (s: string): string => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

// Mẫu tìm SĐT khi chuỗi nhập có ≥ 3 chữ số: ILIKE trên phone (chỉ mục trigram) + tiền tố trên phone_e164.
export function phonePatterns(raw: string): { ilike: string; e164Prefix: string } | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 3) return null;
  const t = raw.trim();
  let e: string;
  if (t.startsWith('+')) e = '+' + digits;
  else if (digits.startsWith('00')) e = '+' + digits.slice(2);
  else if (digits.startsWith('0')) e = '+84' + digits.slice(1);
  else if (digits.startsWith('84')) e = '+' + digits;
  else e = digits;
  return { ilike: '%' + escapeLike(t) + '%', e164Prefix: escapeLike(e) + '%' };
}

// Phạm vi đọc ở dạng SQL (bản song song của scopeWhere dùng cho Prisma). Fail-closed.
export function scopeSql(actor: Actor, scope: Scope | null): Prisma.Sql {
  switch (scope) {
    case 'ALL': return Prisma.sql`TRUE`;
    case 'OWN': return Prisma.sql`c.owner_id = ${actor.employeeId}::uuid`;
    case 'DEPARTMENT': return actor.departmentId
      ? Prisma.sql`EXISTS (SELECT 1 FROM employee e WHERE e.id = c.owner_id AND e.department_id = ${actor.departmentId}::uuid)`
      : Prisma.sql`FALSE`;
    default: return Prisma.sql`FALSE`;
  }
}

export interface SearchWhereInput {
  actor: Actor;
  folded: string;
  raw: string;
  deletedOnly: boolean;
  readScope: Scope | null;
  restoreScope: Scope | null;
  ownerId?: string;
  ids: Partial<Record<LookupKey, string>>;
}

// ───── P2-1: nguồn sự thật DUY NHẤT cho điều kiện văn bản (đường OR và đường UNION dùng chung) ─────
// Mỗi nhóm có hai cách biểu diễn dựng từ CÙNG các mảnh SQL: `or` (vị từ cho WHERE ... OR ...) và `union` (SELECT id cho UNION, mỗi nhánh dùng đúng biểu thức của chỉ mục partial `deleted_at IS NULL`).
export interface TextBranch { kind: 'name' | 'shortName' | 'codeTax' | 'contact' | 'phone'; or: Prisma.Sql[]; union: Prisma.Sql[] }

export function textBranches(p: Pick<SearchWhereInput, 'folded' | 'raw'>): TextBranch[] {
  const pat = '%' + escapeLike(p.folded) + '%';
  const ph = phonePatterns(p.raw);
  const live = Prisma.sql`c.deleted_at IS NULL`;
  const nameLike = Prisma.sql`public.f_vn_fold(c.name) LIKE ${pat}`;
  const shortLike = Prisma.sql`public.f_vn_fold(c.short_name) LIKE ${pat}`;
  const codeLike = Prisma.sql`lower(c.code) LIKE ${pat}`;
  const taxLike = Prisma.sql`c.tax_id LIKE ${pat}`;
  const contactLike = Prisma.sql`public.f_vn_fold(ct.full_name) LIKE ${pat}`;
  const branches: TextBranch[] = [
    { kind: 'name', or: [nameLike], union: [Prisma.sql`SELECT c.id FROM customer c WHERE ${live} AND ${nameLike}`] },
    { kind: 'shortName', or: [shortLike], union: [Prisma.sql`SELECT c.id FROM customer c WHERE ${live} AND ${shortLike}`] },
    { kind: 'codeTax', or: [codeLike, taxLike], union: [Prisma.sql`SELECT c.id FROM customer c WHERE ${live} AND (${codeLike} OR ${taxLike})`] },
    {
      kind: 'contact',
      or: [Prisma.sql`EXISTS (SELECT 1 FROM contact ct WHERE ct.customer_id = c.id AND ct.deleted_at IS NULL AND ${contactLike})`],
      union: [Prisma.sql`SELECT ct.customer_id AS id FROM contact ct WHERE ct.deleted_at IS NULL AND ${contactLike}`],
    },
  ];
  if (ph) {
    const phoneIlike = Prisma.sql`c.phone ILIKE ${ph.ilike}`;
    const phoneE164 = Prisma.sql`c.phone_e164 LIKE ${ph.e164Prefix}`;
    branches.push({ kind: 'phone', or: [phoneIlike, phoneE164], union: [Prisma.sql`SELECT c.id FROM customer c WHERE ${live} AND ${phoneIlike}`, Prisma.sql`SELECT c.id FROM customer c WHERE ${live} AND ${phoneE164}`] });
  }
  return branches;
}

// Điều kiện NGOÀI (không có văn bản): xóa mềm, phạm vi đọc/restore (fail-closed), ownerId, bộ lọc danh mục. Thứ tự giữ đúng như bản cũ để SQL của buildSearchWhere không đổi.
function outerPre(p: SearchWhereInput): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [
    p.deletedOnly ? Prisma.sql`c.deleted_at IS NOT NULL` : Prisma.sql`c.deleted_at IS NULL`,
    scopeSql(p.actor, p.readScope),
  ];
  if (p.deletedOnly) parts.push(scopeSql(p.actor, p.restoreScope));
  return parts;
}
function outerPost(p: SearchWhereInput): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (p.ownerId) parts.push(Prisma.sql`c.owner_id = ${p.ownerId}::uuid`);
  if (p.ids.tier) parts.push(Prisma.sql`c.tier_id = ${p.ids.tier}::uuid`);
  if (p.ids.status) parts.push(Prisma.sql`c.status_id = ${p.ids.status}::uuid`);
  if (p.ids.industry) parts.push(Prisma.sql`c.industry_id = ${p.ids.industry}::uuid`);
  if (p.ids.source) parts.push(Prisma.sql`c.source_id = ${p.ids.source}::uuid`);
  if (p.ids.province) parts.push(Prisma.sql`c.province_id = ${p.ids.province}::uuid`);
  return parts;
}
export function buildOuterWhere(p: SearchWhereInput): Prisma.Sql {
  return Prisma.join([...outerPre(p), ...outerPost(p)], ' AND ');
}

// Điều kiện tìm kiếm dựng INLINE bằng đúng các biểu thức đã có chỉ mục (f_vn_fold(...), phone, deleted_at IS NULL),
// toàn bộ giá trị là THAM SỐ. Không nối chuỗi từ dữ liệu người dùng. (P2-1: dựng lại từ textBranches/outer*, SQL và tham số GIỮ NGUYÊN.)
export function buildSearchWhere(p: SearchWhereInput): Prisma.Sql {
  const text = textBranches(p).flatMap((b) => b.or);
  return Prisma.join([...outerPre(p), Prisma.sql`(${Prisma.join(text, ' OR ')})`, ...outerPost(p)], ' AND ');
}

// Chọn đường: UNION khi KHÔNG deleted=only và chuỗi đã fold ≥ 3 ký tự; còn lại OR (2 ký tự: pg_trgm không trích trigram; deleted=only: chỉ mục partial không dùng được).
export type SearchPath = 'union' | 'or';
export function chooseSearchPath(folded: string, deletedOnly: boolean): SearchPath {
  return !deletedOnly && folded.length >= 3 ? 'union' : 'or';
}

export interface SearchSort { sortBy: string; order: 'asc' | 'desc' }

// FV-4A: export để xuất CSV dùng đúng điều kiện tìm kiếm của danh sách trong MỘT câu truy vấn (không đổi SQL).
export function matchedFrom(p: SearchWhereInput, path: SearchPath): { from: Prisma.Sql; where: Prisma.Sql } {
  if (path === 'or') return { from: Prisma.sql`customer c`, where: buildSearchWhere(p) };
  if (p.deletedOnly) throw new Error('Đường UNION không dùng cho deleted=only (dùng đường OR).');
  const selects = textBranches(p).flatMap((b) => b.union);
  return { from: Prisma.sql`customer c JOIN (${Prisma.join(selects, ' UNION ')}) cand ON cand.id = c.id`, where: buildOuterWhere(p) };
}

// Một truy vấn trả trang kèm tổng: count(*) OVER () được tính TRƯỚC LIMIT/OFFSET nên bằng đúng số dòng khớp. ORDER BY dùng nguyên buildSearchOrder.
export function buildSearchPageQuery(p: SearchWhereInput, path: SearchPath, sort: SearchSort, limit: number, offset: number): Prisma.Sql {
  const m = matchedFrom(p, path);
  return Prisma.sql`SELECT c.id, count(*) OVER ()::int AS total FROM ${m.from} WHERE ${m.where} ORDER BY ${buildSearchOrder(sort.sortBy, sort.order, p.folded)} LIMIT ${limit}::int OFFSET ${offset}::int`;
}

// Chỉ dùng khi trang trả 0 dòng ở page > 1 (trang vượt cuối) để tổng vẫn chính xác.
export function buildSearchCountQuery(p: SearchWhereInput, path: SearchPath): Prisma.Sql {
  const m = matchedFrom(p, path);
  return Prisma.sql`SELECT count(*)::int AS n FROM ${m.from} WHERE ${m.where}`;
}

// ORDER BY: chỉ chuỗi hằng trong bảng trắng (Prisma.raw chỉ nhận hằng ASC/DESC và tên cột cố định); giá trị người dùng chỉ là tham số.
export function buildSearchOrder(sortBy: string, order: 'asc' | 'desc', folded: string): Prisma.Sql {
  const dir = order === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC');
  let primary: Prisma.Sql;
  switch (sortBy) {
    case 'code': return Prisma.sql`c.code ${dir}`;
    case 'name': primary = Prisma.sql`c.name ${dir}`; break;
    case 'updatedAt': primary = Prisma.sql`c.updated_at ${dir}`; break;
    case 'tier': primary = Prisma.sql`(SELECT l.sort_order FROM lookup_item l WHERE l.id = c.tier_id) ${dir}`; break;
    case 'status': primary = Prisma.sql`(SELECT l.sort_order FROM lookup_item l WHERE l.id = c.status_id) ${dir}`; break;
    case 'relevance':
      primary = Prisma.sql`greatest(public.similarity(public.f_vn_fold(c.name), ${folded}), coalesce(public.similarity(public.f_vn_fold(c.short_name), ${folded}), 0), coalesce((SELECT max(public.similarity(public.f_vn_fold(ct.full_name), ${folded})) FROM contact ct WHERE ct.customer_id = c.id AND ct.deleted_at IS NULL), 0)) ${dir}`;
      break;
    default: primary = Prisma.sql`c.created_at ${dir}`;
  }
  return Prisma.sql`${primary}, c.code DESC`;
}
