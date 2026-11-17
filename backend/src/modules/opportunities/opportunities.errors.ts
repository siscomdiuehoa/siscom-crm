import { DomainException } from '../../common/errors/domain.exception';

// Mã lỗi ổn định theo docs/SALES_DESIGN.md §5.4, §7. Thông điệp tiếng Việt an toàn để trả về client (không lộ chi tiết nội bộ).
export const opportunityErrors = {
  // details: chuỗi (tham số truy vấn) hoặc { field, message } (lỗi theo trường của đường ghi).
  validation: (details: unknown[]) => new DomainException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', details),
  // Khách không tồn tại / đã xoá / ngoài phạm vi và không có cơ hội nào nhìn thấy được => 404, cùng mã với module khách hàng.
  customerNotFound: () => new DomainException(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.'),
  // Ngoài phạm vi xem (kể cả cơ hội đã xoá mềm với người không có quyền khôi phục) => 404, không lộ tồn tại.
  notFound: () => new DomainException(404, 'OPPORTUNITY_NOT_FOUND', 'Không tìm thấy cơ hội.'),
  // Thấy được nhưng thiếu mã ghi hoặc ngoài điều kiện của mã đó.
  forbidden: (message = 'Không có quyền thực hiện thao tác này trên cơ hội.') => new DomainException(403, 'FORBIDDEN', message),
  // MỘT mã chung cho mọi nguyên nhân người nhận không đủ điều kiện (không ACTIVE, tài khoản không dùng được, thiếu quyền, khác phòng):
  // thông báo không lộ trạng thái tài khoản của người khác (§5.4, PR234-R3-DESIGN-01).
  assigneeIneligible: () => new DomainException(400, 'OPPORTUNITY_ASSIGNEE_INELIGIBLE', 'Người nhận không đủ điều kiện phụ trách cơ hội này.', { field: 'ownerId' }),
  state: (message = 'Cơ hội không ở trạng thái phù hợp cho thao tác này.') => new DomainException(409, 'OPPORTUNITY_STATE', message),
  versionConflict: (currentVersion: number) => new DomainException(409, 'OPPORTUNITY_VERSION_CONFLICT', 'Cơ hội đã được người khác cập nhật. Vui lòng tải lại.', { currentVersion }),
  busy: () => new DomainException(409, 'OPPORTUNITY_BUSY', 'Bản ghi đang được xử lý bởi thao tác khác. Vui lòng thử lại.'),
  // §6.1: người phụ trách mặc định = người phụ trách khách; khách chưa có người phụ trách thì chưa tạo được cơ hội.
  customerNoOwner: () => new DomainException(409, 'OPPORTUNITY_CUSTOMER_NO_OWNER', 'Khách hàng chưa có người phụ trách. Hãy phân công người phụ trách khách trước khi tạo cơ hội.'),
  // Danh mục giai đoạn chưa được nạp (lệnh seed S4) hoặc có giai đoạn mà mã nguồn không biết xác suất mặc định.
  catalogMissing: () => new DomainException(409, 'OPPORTUNITY_CATALOG_MISSING', 'Danh mục giai đoạn cơ hội chưa sẵn sàng. Vui lòng báo quản trị.'),
  customerDeleted: () => new DomainException(409, 'OPPORTUNITY_CUSTOMER_DELETED', 'Khách hàng của cơ hội đang bị xoá. Hãy khôi phục khách hàng trước.'),
};
