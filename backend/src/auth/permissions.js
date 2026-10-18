// DEMO permission matrix. NOT security: it only hides/disables UI and guards the local repository.
// Real enforcement must live on the backend. Roles/matrix are placeholders until SISCOM confirms them.
export const ROLES = {
  admin: { label: 'Quản trị hệ thống' },
  director: { label: 'Giám đốc điều hành' },
  sales_manager: { label: 'Trưởng phòng kinh doanh' },
  sales: { label: 'Nhân viên kinh doanh' },
  estimator: { label: 'Kỹ thuật – Dự toán' },
  accountant: { label: 'Kế toán' },
};
export const ACTIONS = {
  'customer.create': 'Thêm khách hàng', 'customer.update': 'Sửa khách hàng', 'customer.delete': 'Xoá khách hàng',
  'customer.import': 'Nhập khách hàng', 'customer.export': 'Xuất khách hàng',
  'contact.write': 'Quản lý người liên hệ', 'interaction.write': 'Ghi nhận tương tác',
  'approval.decide': 'Phê duyệt báo giá', 'data.backup': 'Sao lưu dữ liệu', 'data.restore': 'Khôi phục dữ liệu',
};
// true = allowed; 'own' = only records whose owner is the user; absent/false = denied
const M = {
  'customer.create':   { admin: 1, director: 1, sales_manager: 1, sales: 1 },
  'customer.update':   { admin: 1, director: 1, sales_manager: 1, sales: 'own' },
  'customer.delete':   { admin: 1, director: 1 },
  'customer.import':   { admin: 1, director: 1, sales_manager: 1 },
  'customer.export':   { admin: 1, director: 1, sales_manager: 1, sales: 1, estimator: 1, accountant: 1 },
  'contact.write':     { admin: 1, director: 1, sales_manager: 1, sales: 'own' },
  'interaction.write': { admin: 1, director: 1, sales_manager: 1, sales: 'own' },
  'approval.decide':   { director: 1, sales_manager: 1 },
  'data.backup':       { admin: 1, director: 1 },
  'data.restore':      { admin: 1, director: 1 },
};
export const DEMO_USERS = [
  { id: 'u-director', name: 'Phạm Quốc Huy', role: 'director' },
  { id: 'u-admin', name: 'Quản trị hệ thống', role: 'admin' },
  { id: 'u-smgr', name: 'Trần Minh Khoa', role: 'sales_manager' },
  { id: 'u-sales', name: 'Lê Thu Hà', role: 'sales' },
  { id: 'u-est', name: 'Nguyễn Đức Anh', role: 'estimator' },
  { id: 'u-acc', name: 'Võ Thị Mai', role: 'accountant' },
];
export function can(user, action, record) {
  const rule = (M[action] || {})[user && user.role];
  if (!rule) return false;
  if (rule === 'own') return !!record && record.owner === user.name;
  return true;
}
