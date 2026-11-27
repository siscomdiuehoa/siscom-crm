import { DomainException } from '../../common/errors/domain.exception';
import { mapPrismaError, sqlStateOf } from '../../common/errors/prisma-error.mapper';

// Mã lỗi ổn định của Báo giá (docs/QUOTES_DESIGN.md mục 9). Thông điệp tiếng Việt an toàn để trả về client: không lộ chi tiết nội bộ,
// không lặp lại số tiền hay giá vốn (mục 7.2, 7.3).
export const quoteErrors = {
  validation: (details: unknown[]) => new DomainException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', details),
  // Không có mã quyền của thao tác => 403.
  forbidden: (message = 'Không có quyền thực hiện thao tác này trên báo giá.') => new DomainException(403, 'FORBIDDEN', message),
  // Ngoài phạm vi xem (kể cả báo giá đã xoá, cơ hội đã xoá hoặc không thấy được) => 404, không lộ tồn tại.
  notFound: () => new DomainException(404, 'QUOTE_NOT_FOUND', 'Không tìm thấy báo giá.'),
  opportunityNotFound: () => new DomainException(404, 'OPPORTUNITY_NOT_FOUND', 'Không tìm thấy cơ hội.'),
  templateNotFound: () => new DomainException(404, 'QUOTE_TEMPLATE_NOT_FOUND', 'Không tìm thấy loại báo giá.'),
  opportunityNotOpen: () => new DomainException(422, 'OPPORTUNITY_NOT_OPEN', 'Chỉ lập báo giá mới cho cơ hội đang mở.'),
  templateInactive: () => new DomainException(422, 'TEMPLATE_INACTIVE', 'Loại báo giá này đã ngừng dùng.'),
  // ───── Q5: ghi ─────
  // 409 chỉ trả số phiên bản hiện tại, không kèm nội dung báo giá (mục 7.3).
  versionConflict: (currentVersion: number) => new DomainException(409, 'VERSION_CONFLICT', 'Báo giá đã được người khác cập nhật. Vui lòng tải lại.', { currentVersion }),
  versionNotFound: () => new DomainException(404, 'QUOTE_VERSION_NOT_FOUND', 'Không tìm thấy phiên bản báo giá.'),
  versionLocked: () => new DomainException(409, 'QUOTE_VERSION_LOCKED', 'Phiên bản đã gửi khách — không sửa, không xoá được. Hãy tạo bản mới.'),
  draftExists: () => new DomainException(409, 'QUOTE_DRAFT_EXISTS', 'Báo giá đang có một bản nháp. Hãy sửa hoặc xoá bản nháp đó trước.'),
  alreadyAccepted: () => new DomainException(409, 'QUOTE_ALREADY_ACCEPTED', 'Báo giá đã có phiên bản được chấp nhận — cần thay đổi thì lập báo giá mới.'),
  deleteForbidden: () => new DomainException(409, 'QUOTE_DELETE_FORBIDDEN', 'Báo giá đã có phiên bản gửi khách — không xoá được.'),
  lastVersion: () => new DomainException(422, 'QUOTE_LAST_VERSION', 'Đây là phiên bản duy nhất của báo giá. Hãy xoá cả báo giá nếu không dùng nữa.'),
  versionLimit: () => new DomainException(422, 'QUOTE_VERSION_LIMIT', 'Báo giá đã đủ 999 phiên bản.'),
  amountOutOfRange: () => new DomainException(400, 'AMOUNT_OUT_OF_RANGE', 'Tổng giá trị trước VAT vượt giới hạn cho phép.'),
  busy: () => new DomainException(409, 'QUOTE_BUSY', 'Báo giá đang được xử lý bởi thao tác khác. Vui lòng thử lại.'),
  conflict: () => new DomainException(409, 'CONSTRAINT_CONFLICT', 'Dữ liệu vi phạm ràng buộc của hệ thống.'),
  // ───── Q5b: gửi / kết quả / đang theo đuổi ─────
  empty: () => new DomainException(422, 'QUOTE_EMPTY', 'Phiên bản chưa có dòng hàng nào — chưa gửi được.'),
  notSent: () => new DomainException(422, 'QUOTE_NOT_SENT', 'Phiên bản này chưa gửi khách.'),
  notLatest: () => new DomainException(422, 'QUOTE_NOT_LATEST', 'Chỉ ghi kết quả cho phiên bản đã gửi mới nhất của báo giá.'),
  notPrimary: () => new DomainException(409, 'QUOTE_NOT_PRIMARY', 'Chỉ chấp nhận được báo giá đang theo đuổi. Hãy chọn báo giá này làm đang theo đuổi trước.'),
  primaryFixed: () => new DomainException(409, 'QUOTE_PRIMARY_FIXED', 'Cơ hội đã có báo giá được chấp nhận — không đổi báo giá đang theo đuổi.'),
  primaryNeedsSent: () => new DomainException(422, 'QUOTE_PRIMARY_NEEDS_SENT', 'Báo giá chưa có phiên bản nào đã gửi khách.'),
  // ───── Q6: loại báo giá ─────
  templateCodeExists: () => new DomainException(409, 'TEMPLATE_CODE_EXISTS', 'Mã loại báo giá đã được dùng.'),
  templateLimit: () => new DomainException(422, 'TEMPLATE_LIMIT', 'Đã đủ 200 loại báo giá.'),
  templateLastActive: () => new DomainException(422, 'TEMPLATE_LAST_ACTIVE', 'Đây là loại báo giá cuối cùng đang dùng — ngừng dùng thì không ai lập được báo giá mới.'),
};

type Dict = Record<string, unknown>;
const dig = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((cur, k) => (typeof cur === 'object' && cur !== null ? (cur as Dict)[k] : undefined), v);

// Tên ràng buộc / mã lỗi của trigger báo giá trong lỗi DB. Trigger Q2 đặt trường CONSTRAINT = mã cố định (mục 19, điểm 5) và đầu thông điệp
// cũng là mã đó; chỉ mục duy nhất mang tên của nó. Chỉ dùng để SO KHỚP nội bộ — không bao giờ đưa vào phản hồi hay log.
const KNOWN = /\b(QUOTE_[A-Z_]+|uq_quote_[a-z_]+|quote_version_quote_id_version_no_key|quote_template_code_key)\b/;
export function quoteConstraintOf(e: unknown): string | null {
  for (const p of [dig(e, 'meta', 'driverAdapterError', 'cause', 'constraint'), dig(e, 'meta', 'constraint'), dig(e, 'cause', 'constraint'), dig(e, 'constraint')]) {
    if (typeof p === 'string' && KNOWN.test(p)) return KNOWN.exec(p)![1]!;
  }
  for (const p of [dig(e, 'meta', 'driverAdapterError', 'cause', 'originalMessage'), dig(e, 'meta', 'message'), dig(e, 'message'), dig(e, 'meta', 'target')]) {
    const s = Array.isArray(p) ? p.join(',') : p;
    if (typeof s === 'string' && KNOWN.test(s)) return KNOWN.exec(s)![1]!;
  }
  return null;
}

// Lỗi DB => mã lỗi API cố định (mục 7.2: không trả nguyên văn lỗi PostgreSQL). null = không phải lỗi DB đã biết (để nguyên => 500 chung).
export function quoteDbError(e: unknown): DomainException | null {
  const st = sqlStateOf(e);
  if (st === '55P03' || st === '40001' || st === '40P01') return quoteErrors.busy();
  switch (quoteConstraintOf(e)) {
    case 'QUOTE_VERSION_LOCKED': return quoteErrors.versionLocked();
    case 'uq_quote_version_one_draft': return quoteErrors.draftExists();
    case 'QUOTE_ALREADY_ACCEPTED': case 'uq_quote_version_one_accepted': case 'uq_quote_version_accepted_opportunity': return quoteErrors.alreadyAccepted();
    case 'QUOTE_DELETE_FORBIDDEN': return quoteErrors.deleteForbidden();
    case 'quote_version_quote_id_version_no_key': case 'uq_quote_primary_per_opportunity': return quoteErrors.busy();
    case 'QUOTE_EMPTY': return quoteErrors.empty();
    case 'QUOTE_NOT_PRIMARY': return quoteErrors.notPrimary();
    case 'QUOTE_PRIMARY_FIXED': return quoteErrors.primaryFixed();
    case 'QUOTE_PRIMARY_NEEDS_SENT': return quoteErrors.primaryNeedsSent();
    case 'QUOTE_DELETED': return quoteErrors.notFound();
    case 'quote_template_code_key': return quoteErrors.templateCodeExists();
    default: break;
  }
  const m = mapPrismaError(e);
  if (!m) return null;
  return m.code === 'CUSTOMER_BUSY' ? quoteErrors.busy() : m.code === 'CUSTOMER_NOT_FOUND' ? quoteErrors.notFound() : quoteErrors.conflict();
}
