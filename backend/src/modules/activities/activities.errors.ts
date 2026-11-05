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
  // B3 A6 (§6): vòng đời việc, quyền theo việc (§5.4), đề xuất chuyển (§5.5).
  notFound: () => new DomainException(404, 'ACTIVITY_NOT_FOUND', 'Không tìm thấy hoạt động.'),
  versionConflict: (currentVersion: number) => new DomainException(409, 'ACTIVITY_VERSION_CONFLICT', 'Hoạt động đã được người khác cập nhật. Vui lòng tải lại.', { currentVersion }),
  notOpen: () => new DomainException(409, 'ACTIVITY_NOT_OPEN', 'Công việc không ở trạng thái đang mở.'),
  alreadyOpen: () => new DomainException(409, 'ACTIVITY_ALREADY_OPEN', 'Công việc đang mở, không cần mở lại.'),
  notTask: () => new DomainException(409, 'ACTIVITY_NOT_TASK', 'Thao tác này chỉ áp dụng cho công việc (TASK).'),
  externalNotAllowed: () => new DomainException(400, 'ACTIVITY_EXTERNAL_NOT_ALLOWED', 'Chỉ giao được công việc đang mở cho người có thẩm quyền kỹ thuật ở phòng khác.', { field: 'performedById' }),
  transferPending: () => new DomainException(409, 'ACTIVITY_TRANSFER_PENDING', 'Công việc đã có một đề xuất chuyển đang chờ duyệt.'),
  transferNotAllowed: (message = 'Không có quyền với đề xuất chuyển việc này.') => new DomainException(403, 'ACTIVITY_TRANSFER_NOT_ALLOWED', message),
  transferNotPending: () => new DomainException(409, 'ACTIVITY_TRANSFER_NOT_PENDING', 'Đề xuất chuyển việc không còn chờ duyệt.'),
  transferNotFound: () => new DomainException(404, 'ACTIVITY_TRANSFER_NOT_FOUND', 'Không tìm thấy đề xuất chuyển việc.'),
  transferTargetInvalid: () => new DomainException(400, 'ACTIVITY_ASSIGNEE_INVALID', 'Người nhận đề xuất không hợp lệ: phải đang làm việc, cùng phòng với bạn và có thẩm quyền kỹ thuật.', { field: 'toEmployeeId' }),
  constraint: () => new DomainException(409, 'CONSTRAINT_CONFLICT', 'Dữ liệu vi phạm ràng buộc của hệ thống.'),
};
