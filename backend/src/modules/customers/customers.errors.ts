import { DomainException } from '../../common/errors/domain.exception';
import type { LookupKey } from './customers.defaults';

export const customerErrors = {
  validation: (details: string[]) => new DomainException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', details),
  lookupInvalid: (field: LookupKey) => new DomainException(400, 'LOOKUP_INVALID', 'Giá trị danh mục không hợp lệ hoặc đã ngừng sử dụng.', { field }),
  forbidden: (message = 'Không có quyền thực hiện thao tác này.') => new DomainException(403, 'FORBIDDEN', message),
  notFound: () => new DomainException(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.'),
  duplicateTaxId: (visibleConflict: { code: string; name: string } | null) =>
    new DomainException(409, 'CUSTOMER_DUPLICATE_TAX_ID', 'Mã số thuế đã được dùng bởi một khách hàng khác.', { visibleConflict }),
  versionConflict: (currentVersion: number) =>
    new DomainException(409, 'CUSTOMER_VERSION_CONFLICT', 'Khách hàng đã được người khác cập nhật. Vui lòng tải lại.', { currentVersion }),
  notDeleted: () => new DomainException(409, 'CUSTOMER_NOT_DELETED', 'Khách hàng đang hoạt động, không cần khôi phục.'),
  restoreConflict: (conflicts: { code: string; name: string }[]) =>
    new DomainException(409, 'CUSTOMER_RESTORE_CONFLICT', 'Không thể khôi phục: mã số thuế đang được dùng bởi một khách hàng khác.', { conflicts }),
  deleteUnverified: (unchecked: string[]) =>
    new DomainException(409, 'DELETE_LINKS_UNVERIFIED', 'Chưa thể xoá khách hàng: hệ thống chưa kiểm tra được hợp đồng, báo giá, dự án, cơ hội liên quan.', { unchecked }),
};
