import { DomainException } from '../../common/errors/domain.exception';

// Mã lỗi ổn định theo docs/B3_ACTIVITIES_DESIGN.md §6. Thông điệp tiếng Việt an toàn để trả về client (không lộ chi tiết nội bộ).
export const activityErrors = {
  validation: (details: string[]) => new DomainException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', details),
  forbidden: (message = 'Không có quyền thực hiện thao tác này.') => new DomainException(403, 'FORBIDDEN', message),
  typeNotAllowed: () => new DomainException(403, 'ACTIVITY_TYPE_NOT_ALLOWED', 'Bạn chỉ được tạo khảo sát, ghi chú hoặc công việc kỹ thuật.'),
  // Khách ngoài phạm vi đọc => 404 (không lộ tồn tại), cùng mã với module khách hàng.
  customerNotFound: () => new DomainException(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.'),
  customerDeleted: () => new DomainException(409, 'CUSTOMER_DELETED', 'Khách hàng đã bị xoá, không thể ghi hoạt động.'),
  contactMismatch: () => new DomainException(400, 'ACTIVITY_CONTACT_MISMATCH', 'Người liên hệ không thuộc khách hàng này.', { field: 'contactId' }),
  assigneeInvalid: () => new DomainException(400, 'ACTIVITY_ASSIGNEE_INVALID', 'Người phụ trách không hợp lệ: không tồn tại, không còn làm việc hoặc khác phòng ban.', { field: 'performedById' }),
  assigneeNoAccess: () => new DomainException(400, 'ACTIVITY_ASSIGNEE_NO_ACCESS', 'Người này chưa có quyền xem khách hàng.', { field: 'performedById' }),
  busy: () => new DomainException(409, 'ACTIVITY_BUSY', 'Bản ghi đang được xử lý bởi thao tác khác. Vui lòng thử lại.'),
};
