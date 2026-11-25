import { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

// Báo giá Q4 — trạng thái theo phiên bản MỚI NHẤT và tìm kiếm không dấu (docs/QUOTES_DESIGN.md mục 5.3, 9).
// "Hết hiệu lực" KHÔNG lưu trong DB: phiên bản SENT có valid_until < hôm nay (ngày theo giờ Việt Nam). MỘT biểu thức SQL duy nhất cho mốc "hôm nay"
// (TODAY_VN) dùng cho cả bộ lọc danh sách (candidateIds) lẫn nhãn trả về (todayVn => versionState trong mapper).
// Hai hàm này KHÔNG áp phạm vi đọc: kết quả CHỈ được dùng làm điều kiện thu hẹp `id IN (...)` đứng SAU quoteReadWhere trong cùng snapshot.
const TODAY_VN = Prisma.sql`(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;

export async function todayVn(tx: Tx): Promise<string> {
  const r = await tx.$queryRaw<{ d: string }[]>`SELECT to_char(${TODAY_VN}, 'YYYY-MM-DD') AS d`;
  return r[0]!.d;
}

export const QUOTE_STATES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'EXPIRING'] as const;
export type QuoteStateFilter = (typeof QUOTE_STATES)[number];
// Số ngày của bộ lọc "sắp hết hạn" (mục 9).
export const EXPIRING_DAYS = 7;

// Điều kiện trên phiên bản mới nhất (bí danh v). SENT = đã gửi và CÒN hiệu lực; EXPIRING là tập con của SENT.
function stateCond(state: QuoteStateFilter): Prisma.Sql {
  switch (state) {
    case 'DRAFT': return Prisma.sql`v.status = 'DRAFT'`;
    case 'ACCEPTED': return Prisma.sql`v.status = 'ACCEPTED'`;
    case 'REJECTED': return Prisma.sql`v.status = 'REJECTED'`;
    case 'SENT': return Prisma.sql`v.status = 'SENT' AND v.valid_until >= ${TODAY_VN}`;
    case 'EXPIRED': return Prisma.sql`v.status = 'SENT' AND v.valid_until < ${TODAY_VN}`;
    case 'EXPIRING': return Prisma.sql`v.status = 'SENT' AND v.valid_until >= ${TODAY_VN} AND v.valid_until <= ${TODAY_VN} + ${EXPIRING_DAYS}::int`;
  }
}

// Gập dấu từ khoá bằng CHÍNH hàm của DB (public.f_vn_fold, như tìm khách hàng / cơ hội) rồi thoát ký tự đại diện của LIKE.
async function likePattern(tx: Tx, raw: string): Promise<string> {
  const r = await tx.$queryRaw<{ t: string | null }[]>`SELECT public.f_vn_fold(btrim(${raw})) AS t`;
  return '%' + (r[0]?.t ?? '').replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

// ID các báo giá (chưa xoá) có phiên bản mới nhất ở trạng thái `state` và / hoặc khớp từ khoá (mã, hạng mục, tên khách — không phân biệt dấu, hoa thường).
export async function candidateIds(tx: Tx, f: { state?: QuoteStateFilter; search?: string }): Promise<string[]> {
  const conds: Prisma.Sql[] = [Prisma.sql`q.deleted_at IS NULL`];
  if (f.state) conds.push(Prisma.sql`(${stateCond(f.state)})`);
  if (f.search !== undefined) {
    const p = await likePattern(tx, f.search);
    conds.push(Prisma.sql`(public.f_vn_fold(q.code) LIKE ${p} OR public.f_vn_fold(q.item_name) LIKE ${p} OR public.f_vn_fold(c.name) LIKE ${p})`);
  }
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT q.id::text AS id
    FROM public.quote q
    JOIN public.customer c ON c.id = q.customer_id
    LEFT JOIN LATERAL (SELECT x.status, x.valid_until FROM public.quote_version x WHERE x.quote_id = q.id ORDER BY x.version_no DESC LIMIT 1) v ON true
    WHERE ${Prisma.join(conds, ' AND ')}`;
  return rows.map((r) => r.id);
}
