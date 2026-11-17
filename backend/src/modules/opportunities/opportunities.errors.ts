import { DomainException } from '../../common/errors/domain.exception';

// Mã lỗi ổn định theo docs/SALES_DESIGN.md §5.4, §7. Thông điệp tiếng Việt an toàn để trả về client (không lộ chi tiết nội bộ).
export const opportunityErrors = {
  // Ngoài phạm vi xem (kể cả cơ hội đã xoá mềm với người không có quyền khôi phục) => 404, không lộ tồn tại.
  notFound: () => new DomainException(404, 'OPPORTUNITY_NOT_FOUND', 'Không tìm thấy cơ hội.'),
  // Thấy được nhưng thiếu mã ghi hoặc ngoài điều kiện của mã đó.
  forbidden: (message = 'Không có quyền thực hiện thao tác này trên cơ hội.') => new DomainException(403, 'FORBIDDEN', message),
  // MỘT mã chung cho mọi nguyên nhân người nhận không đủ điều kiện (không ACTIVE, tài khoản không dùng được, thiếu quyền, khác phòng):
  // thông báo không lộ trạng thái tài khoản của người khác (§5.4, PR234-R3-DESIGN-01).
  assigneeIneligible: () => new DomainException(400, 'OPPORTUNITY_ASSIGNEE_INELIGIBLE', 'Người nhận không đủ điều kiện phụ trách cơ hội này.', { field: 'ownerId' }),
  state: (message = 'Cơ hội không ở trạng thái phù hợp cho thao tác này.') => new DomainException(409, 'OPPORTUNITY_STATE', message),
  customerDeleted: () => new DomainException(409, 'OPPORTUNITY_CUSTOMER_DELETED', 'Khách hàng của cơ hội đang bị xoá. Hãy khôi phục khách hàng trước.'),
};
