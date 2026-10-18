// B1.2.3-B2 P1 – CHỈ DÙNG CHO BENCHMARK. Không được import từ src/. Không thay đổi hành vi production.
// Dựng các biến thể truy vấn tìm kiếm để so sánh với đường hiện tại (buildSearchWhere + buildSearchOrder của src, dùng nguyên trạng).
import { Prisma } from '../../../src/generated/prisma/client';
import { buildSearchOrder, buildSearchWhere, escapeLike, phonePatterns, scopeSql, SearchWhereInput } from '../../../src/modules/customers/customers.search';

export type Structure = 'or' | 'union' | 'unionall';
export type CountForm = 'two' | 'window';
export type ScoreForm = 'orig' | 'lateral';
export interface Variant { id: string; structure: Structure; count: CountForm; score: ScoreForm }

// V1 = đúng hình dạng runSearch hiện tại (đối chứng). Các biến thể khác tách riêng từng yếu tố A (cấu trúc), B (COUNT), C (điểm).
export const VARIANTS: Variant[] = [
  { id: 'V1_or_two_orig', structure: 'or', count: 'two', score: 'orig' },
  { id: 'V2_union_two_orig', structure: 'union', count: 'two', score: 'orig' },
  { id: 'V3_unionall_two_orig', structure: 'unionall', count: 'two', score: 'orig' },
  { id: 'V4_or_window_orig', structure: 'or', count: 'window', score: 'orig' },
  { id: 'V5_union_window_orig', structure: 'union', count: 'window', score: 'orig' },
  { id: 'V6_unionall_window_orig', structure: 'unionall', count: 'window', score: 'orig' },
  { id: 'V7_union_window_lateral', structure: 'union', count: 'window', score: 'lateral' },
  { id: 'V8_unionall_window_lateral', structure: 'unionall', count: 'window', score: 'lateral' },
];
export const BASELINE = 'V1_or_two_orig';

export interface BenchInput extends SearchWhereInput { sortBy: string; order: 'asc' | 'desc' }

// Điều kiện ngoài (KHÔNG có phần văn bản) — bản sao có chủ đích của phần AND trong buildSearchWhere.
// Tính đúng đắn được chứng minh bằng đối chiếu tập ID/thứ tự với V1 (dùng buildSearchWhere thật).
function outerSql(p: SearchWhereInput): Prisma.Sql {
  const parts: Prisma.Sql[] = [p.deletedOnly ? Prisma.sql`c.deleted_at IS NOT NULL` : Prisma.sql`c.deleted_at IS NULL`, scopeSql(p.actor, p.readScope)];
  if (p.deletedOnly) parts.push(scopeSql(p.actor, p.restoreScope));
  if (p.ownerId) parts.push(Prisma.sql`c.owner_id = ${p.ownerId}::uuid`);
  if (p.ids.tier) parts.push(Prisma.sql`c.tier_id = ${p.ids.tier}::uuid`);
  if (p.ids.status) parts.push(Prisma.sql`c.status_id = ${p.ids.status}::uuid`);
  if (p.ids.industry) parts.push(Prisma.sql`c.industry_id = ${p.ids.industry}::uuid`);
  if (p.ids.source) parts.push(Prisma.sql`c.source_id = ${p.ids.source}::uuid`);
  if (p.ids.province) parts.push(Prisma.sql`c.province_id = ${p.ids.province}::uuid`);
  return Prisma.join(parts, ' AND ');
}

// Mỗi nhánh dùng đúng biểu thức của chỉ mục partial (deleted_at IS NULL) để planner có thể chọn chỉ mục.
// Với deleted=only, nhánh khách dùng deleted_at IS NOT NULL (giữ ngữ nghĩa; chỉ mục partial không áp dụng được).
function branches(p: SearchWhereInput): Prisma.Sql[] {
  const pat = '%' + escapeLike(p.folded) + '%';
  const ph = phonePatterns(p.raw);
  const del = p.deletedOnly ? Prisma.sql`c.deleted_at IS NOT NULL` : Prisma.sql`c.deleted_at IS NULL`;
  const b: Prisma.Sql[] = [
    Prisma.sql`SELECT c.id FROM customer c WHERE ${del} AND public.f_vn_fold(c.name) LIKE ${pat}`,
    Prisma.sql`SELECT c.id FROM customer c WHERE ${del} AND public.f_vn_fold(c.short_name) LIKE ${pat}`,
    Prisma.sql`SELECT ct.customer_id AS id FROM contact ct WHERE ct.deleted_at IS NULL AND public.f_vn_fold(ct.full_name) LIKE ${pat}`,
    Prisma.sql`SELECT c.id FROM customer c WHERE ${del} AND (lower(c.code) LIKE ${pat} OR c.tax_id LIKE ${pat})`,
  ];
  if (ph) b.push(
    Prisma.sql`SELECT c.id FROM customer c WHERE ${del} AND c.phone ILIKE ${ph.ilike}`,
    Prisma.sql`SELECT c.id FROM customer c WHERE ${del} AND c.phone_e164 LIKE ${ph.e164Prefix}`,
  );
  return b;
}

function matchParts(p: SearchWhereInput, s: Structure): { from: Prisma.Sql; where: Prisma.Sql } {
  if (s === 'or') return { from: Prisma.sql`customer c`, where: buildSearchWhere(p) };
  if (s === 'union') return { from: Prisma.sql`customer c JOIN (${Prisma.join(branches(p), ' UNION ')}) cand ON cand.id = c.id`, where: outerSql(p) };
  return { from: Prisma.sql`customer c`, where: Prisma.sql`${outerSql(p)} AND c.id IN (${Prisma.join(branches(p), ' UNION ALL ')})` };
}

// lateral: cùng công thức relevance của buildSearchOrder (greatest(name, short_name, max liên hệ đang hoạt động)), tie-break c.code DESC.
function scoreParts(p: BenchInput, f: ScoreForm): { join: Prisma.Sql; order: Prisma.Sql } {
  if (f === 'orig' || p.sortBy !== 'relevance') return { join: Prisma.empty, order: buildSearchOrder(p.sortBy, p.order, p.folded) };
  const dir = p.order === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC');
  return {
    join: Prisma.sql` LEFT JOIN LATERAL (SELECT max(public.similarity(public.f_vn_fold(ct.full_name), ${p.folded})) AS m FROM contact ct WHERE ct.customer_id = c.id AND ct.deleted_at IS NULL) k ON TRUE`,
    order: Prisma.sql`greatest(public.similarity(public.f_vn_fold(c.name), ${p.folded}), coalesce(public.similarity(public.f_vn_fold(c.short_name), ${p.folded}), 0), coalesce(k.m, 0)) ${dir}, c.code DESC`,
  };
}

export function countSql(p: BenchInput, v: Variant): Prisma.Sql {
  const m = matchParts(p, v.structure);
  return Prisma.sql`SELECT count(*)::int AS n FROM ${m.from} WHERE ${m.where}`;
}

export function pageSql(p: BenchInput, v: Variant, limit: number, offset: number): Prisma.Sql {
  const m = matchParts(p, v.structure);
  const s = scoreParts(p, v.score);
  const total = v.count === 'window' ? Prisma.sql`, count(*) OVER ()::int AS total` : Prisma.empty;
  return Prisma.sql`SELECT c.id${total} FROM ${m.from}${s.join} WHERE ${m.where} ORDER BY ${s.order} LIMIT ${limit}::int OFFSET ${offset}::int`;
}

type Q = Pick<Prisma.TransactionClient, '$queryRaw'>;
// Lõi tìm kiếm theo biến thể. two: count rồi trang (như hiện tại). window: một truy vấn; trang rỗng mới đếm riêng để tổng vẫn chính xác.
export async function runVariant(tx: Q, p: BenchInput, v: Variant, limit: number, offset: number): Promise<{ total: number; ids: string[]; queries: number }> {
  if (v.count === 'two') {
    const n = Number((await tx.$queryRaw<{ n: number }[]>(countSql(p, v)))[0]?.n ?? 0);
    if (n === 0) return { total: 0, ids: [], queries: 1 };
    const rows = await tx.$queryRaw<{ id: string }[]>(pageSql(p, v, limit, offset));
    return { total: n, ids: rows.map((r) => r.id), queries: 2 };
  }
  const rows = await tx.$queryRaw<{ id: string; total: number }[]>(pageSql(p, v, limit, offset));
  if (rows.length > 0) return { total: Number(rows[0]?.total ?? 0), ids: rows.map((r) => r.id), queries: 1 };
  const n = Number((await tx.$queryRaw<{ n: number }[]>(countSql(p, v)))[0]?.n ?? 0);
  return { total: n, ids: [], queries: 2 };
}
