import { DomainException } from '../../../common/errors/domain.exception';

// FV-4A §2 bảng lỗi. retryAfter (giây) được controller đặt vào header Retry-After.
export class ExportException extends DomainException {
  constructor(status: number, code: string, message: string, readonly retryAfter?: number, details?: unknown) {
    super(status, code, message, details);
  }
}

export const exportErrors = {
  forbidden: () => new ExportException(403, 'FORBIDDEN', 'Bạn không có quyền xuất dữ liệu khách hàng.'),
  tooLarge: () => new ExportException(422, 'EXPORT_TOO_LARGE', 'Có hơn 5.000 khách hàng phù hợp. Vui lòng thu hẹp bộ lọc (tìm kiếm, phân hạng, trạng thái, ngành, tỉnh, phụ trách) rồi xuất lại.', undefined, { limit: 5000, matched: 'over' }),
  rateLimited: (retryAfter: number) => new ExportException(429, 'EXPORT_RATE_LIMITED', 'Bạn đã xuất 10 lần trong 1 giờ. Vui lòng thử lại sau.', retryAfter),
  inProgress: () => new ExportException(429, 'EXPORT_IN_PROGRESS', 'Bạn đang có một lượt xuất khác. Vui lòng thử lại sau ít giây.', 5),
  rbacBusy: () => new ExportException(429, 'EXPORT_RBAC_BUSY', 'Hệ thống đang cập nhật phân quyền. Vui lòng thử lại sau ít giây.', 5),
  busy: () => new ExportException(503, 'EXPORT_BUSY', 'Hệ thống đang xuất dữ liệu cho người khác. Vui lòng thử lại sau ít giây.', 5),
  failed: () => new ExportException(500, 'EXPORT_FAILED', 'Không xuất được. Vui lòng thử lại.'),
  validation: (details: string[]) => new ExportException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', undefined, details),
  lookupInvalid: (field: string) => new ExportException(400, 'LOOKUP_INVALID', 'Giá trị danh mục không hợp lệ hoặc đã ngừng sử dụng.', undefined, { field }),
};
