import type { Prisma } from '../../generated/prisma/client';

// Sales T-07 — tìm cơ hội KHÔNG PHÂN BIỆT DẤU tiếng Việt và hoa/thường (GET /opportunities?q=, bảng kanban, tab cơ hội của khách).
// Hai vế dùng CÙNG một hàm gập dấu public.f_vn_fold (migration 20261012000000_b1_2_crm_core, A3 — như tìm khách hàng):
//  - cột: opportunity.title_fold / project_name_fold là cột SINH TỰ ĐỘNG = f_vn_fold(title) / f_vn_fold(project_name) (migration 20261121000000),
//    có chỉ mục GIN trigram; ứng dụng chỉ ĐỌC hai cột này để lọc, không bao giờ ghi;
//  - từ khoá: gập bằng `SELECT public.f_vn_fold(btrim($1))` (tham số gắn kết, không ghép chuỗi) trong CÙNG transaction đọc.
// Vì vậy "hoa phat" khớp "Hòa Phát", "d" khớp "đ", chữ có dấu / hoa vẫn khớp. Điều kiện văn bản chỉ THU HẸP thêm sau vị từ phạm vi (service).

// Prisma `contains` dịch thành LIKE '%' || $1 || '%' mà KHÔNG thoát ký tự đặc biệt => tự thoát \ % _ để chúng là ký tự thường
// (cùng quy ước fn_customer_search / customers.search.ts; ký tự thoát mặc định của LIKE là \).
export const escapeLike = (s: string): string => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

// Điều kiện văn bản trên cột đã gập dấu: tiêu đề CHỨA từ khoá HOẶC tên dự án CHỨA từ khoá (giữ đúng nghĩa trước T-07).
// `folded` phải là kết quả của foldSearch (đã gập dấu, chữ thường) — không truyền chuỗi thô của người dùng.
export function foldedTextWhere(folded: string): Prisma.OpportunityWhereInput {
  const v = escapeLike(folded);
  return { OR: [{ titleFold: { contains: v } }, { projectNameFold: { contains: v } }] };
}

// Gập dấu từ khoá bằng chính hàm của DB. Chỉ gọi hàm thuần (IMMUTABLE), không đọc bảng nào. null (chuỗi rỗng không thể xảy ra sau kiểm
// ≥ 2 ký tự) => chuỗi rỗng; bên gọi tự từ chối.
export async function foldSearch(tx: Prisma.TransactionClient, raw: string): Promise<string> {
  const r = await tx.$queryRaw<{ t: string | null }[]>`SELECT public.f_vn_fold(btrim(${raw})) AS t`;
  return r[0]?.t ?? '';
}
