// TEST-ONLY. Thay thế src/auth/apiModePermissions.js trong test bằng một actor GIẢ LẬP "máy chủ đã cấp quyền" (qua alias vite trong loadApp).
// src vẫn fail-closed (createApiModeCan(null) -> từ chối tất cả); file này KHÔNG được import từ src và không phải cơ chế cấp quyền thật.
// Chỉ cấp đúng hai quyền mà các luồng test cần (tạo/sửa); KHÔNG cấp import/delete/export để test vẫn bắt được việc mở rộng quyền ngoài ý muốn.
const GRANTS = new Set(['customer.create', 'customer.update']);
export function createApiModeCan() {
  return (action) => GRANTS.has(action);
}
