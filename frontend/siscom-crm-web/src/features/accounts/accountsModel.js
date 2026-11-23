// P1 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §7): hàm thuần của trang Tài khoản — không React, không DOM, không mạng.
// Giao diện chỉ là cổng tiện dụng: máy chủ vẫn là nơi kiểm quyền và mọi quy tắc (tự thao tác lên mình, tài khoản hệ thống, người duyệt cuối cùng…).

// perm(code) => phạm vi máy chủ cấp cho phiên hiện tại (me.permissions[code]) hoặc null/undefined.
export const canManageAccounts = (perm) => typeof perm === 'function' && !!perm('access.approve');

// Mục thanh bên của trang. Có quyền => thay chỗ mục "Nhân sự" (chưa vận hành) trong nhóm Vận hành; không quyền => thanh bên giữ nguyên.
export const ACCOUNTS_NAV_ITEM = { id: 'accounts', label: 'Tài khoản', icon: 'id-card' };
export function accountsNav(nav, enabled) {
  if (!enabled || !Array.isArray(nav)) return nav;
  return nav.some((n) => n.id === 'hr') ? nav.map((n) => (n.id === 'hr' ? ACCOUNTS_NAV_ITEM : n)) : nav.concat([ACCOUNTS_NAV_ITEM]);
}

// Vai trò cấp được qua giao diện, theo thứ tự hiển thị. KHÔNG BAO GIỜ có `admin` (tài khoản hệ thống).
export const GRANTABLE_ROLES = ['sales', 'technician', 'accountant', 'crm_admin'];
export const ROLE_LABEL = { admin: 'Hệ thống', crm_admin: 'Quản trị CRM', sales: 'Kinh doanh', technician: 'Kỹ thuật', accountant: 'Kế toán' };
export const roleLabel = (code) => ROLE_LABEL[code] || String(code || '');
export const LOGIN_LABEL = { ACTIVE: 'Đang dùng', MUST_CHANGE: 'Chờ đổi mật khẩu', DISABLED: 'Đã khoá', NONE: 'Chưa có mật khẩu' };
export const LOGIN_TONE = { ACTIVE: 'success', MUST_CHANGE: 'warning', DISABLED: 'error', NONE: 'neutral' };
// Bộ lọc trạng thái của API: ACTIVE = đang dùng (kể cả chờ đổi mật khẩu), DISABLED = đã khoá.
export const STATUS_FILTERS = [{ value: '', label: 'Mọi trạng thái' }, { value: 'ACTIVE', label: 'Đang dùng' }, { value: 'DISABLED', label: 'Đã khoá' }];
export const ROLE_FILTERS = [{ value: '', label: 'Mọi vai trò' }].concat(['crm_admin', 'sales', 'technician', 'accountant', 'admin'].map((c) => ({ value: c, label: ROLE_LABEL[c] })));

export const ACTION_LABEL = { edit: 'Sửa thông tin', role: 'Đổi vai trò', resetPassword: 'Cấp lại mật khẩu', disable: 'Khoá tài khoản', enable: 'Mở lại tài khoản' };
export const ACTION_ICON = { edit: 'pencil', role: 'shield', resetPassword: 'key-round', disable: 'lock', enable: 'lock-open' };

const ON = { enabled: true };
const off = (reason) => (reason ? { enabled: false, reason } : { enabled: false });

// Thao tác trên MỘT dòng: { edit, role, resetPassword, disable, enable } — mỗi mục { enabled, reason? }.
export function rowActions(row) {
  const r = row || {};
  if (r.isSystem) return { edit: off(), role: off(), resetPassword: off(), disable: off(), enable: off() };
  if (r.isSelf) return { edit: ON, role: off('Không tự đổi vai trò của mình'), resetPassword: off('Dùng "Đổi mật khẩu" của bạn'), disable: off('Không tự khoá chính mình'), enable: off() };
  const usable = r.login === 'ACTIVE' || r.login === 'MUST_CHANGE'; // đang đăng nhập được
  const single = Array.isArray(r.roles) && r.roles.length === 1;
  return {
    edit: ON,
    role: single ? ON : off('Tài khoản có nhiều vai trò, cần xử lý riêng'),
    resetPassword: usable ? ON : off('Tài khoản đang khoá hoặc chưa có mật khẩu'),
    disable: usable ? ON : off(),
    enable: usable ? off() : ON,
  };
}

const NAME_MAX = 200; const EMAIL_MAX = 254; const TITLE_MAX = 120; const REASON_MAX = 200; const PW_MIN = 12; const PW_MAX = 128;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const str = (v) => (typeof v === 'string' ? v : '');

function profileProblems(v, out) {
  const name = str(v.fullName).trim(); const email = str(v.email).trim(); const title = str(v.positionTitle).trim();
  if (!name) out.push('Chưa nhập họ tên.'); else if (name.length > NAME_MAX) out.push('Họ tên tối đa ' + NAME_MAX + ' ký tự.');
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) out.push('Email không hợp lệ.');
  if (title.length > TITLE_MAX) out.push('Chức danh tối đa ' + TITLE_MAX + ' ký tự.');
}
// Chỉ các quy tắc rẻ, chắc chắn: máy chủ kiểm đủ chính sách (3 nhóm ký tự, không chứa email / mã nhân viên, không phải mật khẩu phổ biến).
function passwordProblems(v, out) {
  const pw = str(v.tempPassword); const len = [...pw].length;
  if (len < PW_MIN) out.push('Mật khẩu tạm cần ít nhất ' + PW_MIN + ' ký tự.');
  else if (len > PW_MAX) out.push('Mật khẩu tạm tối đa ' + PW_MAX + ' ký tự.');
  else if (/^\s|\s$/u.test(pw)) out.push('Mật khẩu tạm không được bắt đầu hoặc kết thúc bằng khoảng trắng.');
}
function roleProblems(v, out) {
  if (!GRANTABLE_ROLES.includes(v.role)) out.push('Chưa chọn vai trò.');
  else if (v.current && v.current === v.role) out.push('Tài khoản đang giữ đúng vai trò này.');
}

// kind: create | edit | role | resetPassword | enable | disable. Trả danh sách câu vi phạm (rỗng = đạt). Không bao giờ chứa mật khẩu.
export function validateAccountForm(kind, values) {
  const v = values || {}; const out = [];
  if (kind === 'create') { profileProblems(v, out); roleProblems({ role: v.role }, out); passwordProblems(v, out); }
  else if (kind === 'edit') profileProblems(v, out);
  else if (kind === 'role') roleProblems(v, out);
  else if (kind === 'resetPassword' || kind === 'enable') passwordProblems(v, out);
  else if (kind === 'disable') { const r = str(v.reason).trim(); if (!r) out.push('Chưa nhập lý do.'); else if (r.length > REASON_MAX) out.push('Lý do tối đa ' + REASON_MAX + ' ký tự.'); }
  return out;
}

const BY_CODE = {
  EMAIL_TAKEN: 'Email này đã có người dùng.',
  VERSION_CONFLICT: 'Thông tin vừa được người khác sửa. Tải lại rồi thử lại.',
  LAST_APPROVER: 'Không thể khoá hoặc gỡ quyền của Quản trị CRM cuối cùng.',
  LAST_ADMIN: 'Không thể khoá tài khoản hệ thống cuối cùng.',
  SELF_MODIFICATION: 'Bạn không tự làm thao tác này trên tài khoản của mình được.',
  SYSTEM_ACCOUNT: 'Không thao tác được trên tài khoản hệ thống.',
  MULTI_ROLE_UNSUPPORTED: 'Tài khoản có nhiều vai trò, cần xử lý riêng.',
  ACCOUNT_ADMIN_UNAVAILABLE: 'Chức năng quản lý tài khoản chưa được bật trên máy chủ.',
  SYSTEM_REQUESTER_UNAVAILABLE: 'Thiếu tài khoản hệ thống, chưa quản lý tài khoản được. Báo người quản trị máy chủ.',
  RATE_LIMITED: 'Thao tác quá nhanh. Chờ một phút rồi thử lại.',
  ACCOUNT_NOT_FOUND: 'Không tìm thấy tài khoản. Có thể tài khoản vừa bị xoá — hãy tải lại danh sách.',
};
export const VERSION_CONFLICT = 'VERSION_CONFLICT';
// Câu chung mà tầng repository đặt trước thông báo của máy chủ cho HTTP 409 (customerRepository.js HTTP_MSG[409]).
const CONFLICT_PREFIX = 'Xung đột dữ liệu (bản ghi trùng hoặc đã bị thay đổi). ';

// d = kết quả describeRepoError(err) ({ code, kind, message, extra, fieldErrors }). Trả MỘT câu tiếng Việt cho người dùng.
export function accountErrorMessage(d) {
  if (!d || typeof d !== 'object') return 'Không thực hiện được. Hãy thử lại.';
  if (d.code && BY_CODE[d.code]) return BY_CODE[d.code];
  if (d.kind === 'bad_request') {
    const parts = (Array.isArray(d.extra) ? d.extra : []).concat(Object.values(d.fieldErrors || {})).filter((x) => typeof x === 'string' && x);
    if (parts.length) return parts.join(' ');
  }
  const msg = str(d.message);
  if (d.code === 'ACCOUNT_STATE' && msg.startsWith(CONFLICT_PREFIX) && msg.length > CONFLICT_PREFIX.length) return msg.slice(CONFLICT_PREFIX.length);
  return msg || 'Không thực hiện được. Hãy thử lại.';
}

export const ACCOUNTS_PAGE_SIZE = 100;
// Bộ lọc của trang -> tham số GET /accounts. Từ khoá dưới 2 ký tự không gửi (máy chủ từ chối 400).
export function buildAccountsQuery(f) {
  const x = f || {}; const q = str(x.q).trim(); const out = { pageSize: ACCOUNTS_PAGE_SIZE, page: Number.isInteger(x.page) && x.page > 0 ? x.page : 1 };
  if (q.length >= 2) out.q = q;
  if (x.role) out.role = x.role;
  if (x.status) out.status = x.status;
  return out;
}

// Ảnh chữ cái: chữ đầu của hai từ cuối (tên người Việt: tên đệm + tên).
export function initials(name) {
  const w = str(name).trim().split(/\s+/).filter(Boolean).slice(-2);
  return w.length ? w.map((x) => [...x][0]).join('').toUpperCase() : '?';
}
