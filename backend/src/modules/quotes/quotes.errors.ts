import { DomainException } from '../../common/errors/domain.exception';

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
};
