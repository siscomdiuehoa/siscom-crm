// Run: node --test tests/accountsModel.test.mjs   (Node >= 18, không dependency). P1: hàm thuần của trang Tài khoản
// (quyền vào trang, thao tác được phép theo từng dòng, kiểm biểu mẫu, câu báo lỗi theo mã máy chủ). Không mạng, không DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageAccounts, GRANTABLE_ROLES, LOGIN_LABEL, ROLE_LABEL, rowActions, validateAccountForm, accountErrorMessage, buildAccountsQuery, initials, accountsNav, ACCOUNTS_NAV_ITEM } from '../src/features/accounts/accountsModel.js';

const row = (over = {}) => ({ id: 'e1', code: 'NV-0006', fullName: 'Trần Thị Mẫu', email: 'mau@thu.local', departmentId: 'd1', departmentName: 'Kinh doanh', positionTitle: null, roles: ['sales'], login: 'ACTIVE', isSystem: false, isSelf: false, updatedAt: '2026-11-23T03:00:00.000Z', ...over });
const on = { enabled: true };

test('canManageAccounts: chỉ khi máy chủ cấp access.approve; thiếu / null / không phải hàm => false', () => {
  assert.equal(canManageAccounts((p) => (p === 'access.approve' ? 'ALL' : null)), true);
  assert.equal(canManageAccounts((p) => (p === 'customer.read' ? 'ALL' : null)), false);
  assert.equal(canManageAccounts(() => undefined), false);
  assert.equal(canManageAccounts(null), false);
});

test('hằng số: 4 vai trò cấp được (không có admin); nhãn trạng thái đăng nhập', () => {
  assert.deepEqual(GRANTABLE_ROLES, ['sales', 'technician', 'accountant', 'crm_admin']);
  assert.equal(GRANTABLE_ROLES.includes('admin'), false);
  assert.deepEqual(LOGIN_LABEL, { ACTIVE: 'Đang dùng', MUST_CHANGE: 'Chờ đổi mật khẩu', DISABLED: 'Đã khoá', NONE: 'Chưa có mật khẩu' });
  assert.equal(ROLE_LABEL.crm_admin, 'Quản trị CRM');
  assert.equal(ROLE_LABEL.admin, 'Hệ thống');
});

test('rowActions — dòng thường đang dùng: sửa / đổi vai trò / cấp lại mật khẩu / khoá bật; mở lại tắt', () => {
  const a = rowActions(row());
  assert.deepEqual([a.edit, a.role, a.resetPassword, a.disable], [on, on, on, on]);
  assert.equal(a.enable.enabled, false);
});

test('rowActions — chính mình: chỉ sửa bật; ba thao tác còn lại tắt kèm đúng lý do', () => {
  const a = rowActions(row({ isSelf: true, roles: ['crm_admin'] }));
  assert.deepEqual(a.edit, on);
  assert.deepEqual(a.role, { enabled: false, reason: 'Không tự đổi vai trò của mình' });
  assert.deepEqual(a.resetPassword, { enabled: false, reason: 'Dùng "Đổi mật khẩu" của bạn' });
  assert.deepEqual(a.disable, { enabled: false, reason: 'Không tự khoá chính mình' });
  assert.equal(a.enable.enabled, false);
});

test('rowActions — tài khoản hệ thống: mọi thao tác tắt', () => {
  const a = rowActions(row({ isSystem: true, roles: ['admin'] }));
  for (const k of ['edit', 'role', 'resetPassword', 'disable', 'enable']) assert.equal(a[k].enabled, false, k);
});

test('rowActions — đã khoá: mở lại bật; khoá + cấp lại mật khẩu tắt; sửa và đổi vai trò vẫn bật', () => {
  const a = rowActions(row({ login: 'DISABLED' }));
  assert.deepEqual([a.enable, a.edit, a.role], [on, on, on]);
  assert.equal(a.disable.enabled, false);
  assert.equal(a.resetPassword.enabled, false);
});

test('rowActions — chưa có mật khẩu: mở lại (cấp mật khẩu) bật; khoá + cấp lại tắt', () => {
  const a = rowActions(row({ login: 'NONE' }));
  assert.deepEqual(a.enable, on);
  assert.equal(a.disable.enabled, false);
  assert.equal(a.resetPassword.enabled, false);
});

test('rowActions — nhiều vai trò (hoặc không có vai trò): đổi vai trò tắt kèm lý do; thao tác khác như thường', () => {
  for (const roles of [['sales', 'accountant'], []]) {
    const a = rowActions(row({ roles }));
    assert.deepEqual(a.role, { enabled: false, reason: 'Tài khoản có nhiều vai trò, cần xử lý riêng' });
    assert.deepEqual([a.edit, a.resetPassword, a.disable], [on, on, on]);
  }
});

test('validateAccountForm — thêm: họ tên, email, vai trò, mật khẩu tạm >= 12 ký tự', () => {
  const ok = { fullName: 'Nguyễn Văn A', email: 'a@thu.local', role: 'sales', tempPassword: 'x'.repeat(12) };
  assert.deepEqual(validateAccountForm('create', ok), []);
  assert.deepEqual(validateAccountForm('create', { ...ok, fullName: '   ' }), ['Chưa nhập họ tên.']);
  assert.deepEqual(validateAccountForm('create', { ...ok, email: 'khong-phai-email' }), ['Email không hợp lệ.']);
  assert.deepEqual(validateAccountForm('create', { ...ok, tempPassword: 'x'.repeat(11) }), ['Mật khẩu tạm cần ít nhất 12 ký tự.']);
  assert.deepEqual(validateAccountForm('create', { ...ok, tempPassword: 'x'.repeat(129) }), ['Mật khẩu tạm tối đa 128 ký tự.']);
  assert.deepEqual(validateAccountForm('create', { ...ok, tempPassword: ' ' + 'x'.repeat(12) }), ['Mật khẩu tạm không được bắt đầu hoặc kết thúc bằng khoảng trắng.']);
  assert.deepEqual(validateAccountForm('create', { ...ok, role: 'admin' }), ['Chưa chọn vai trò.']);
  assert.equal(validateAccountForm('create', { fullName: '', email: '', role: '', tempPassword: '' }).length, 4);
});

test('validateAccountForm — sửa: chỉ họ tên + email (+ chức danh <= 120); không đòi mật khẩu / vai trò', () => {
  assert.deepEqual(validateAccountForm('edit', { fullName: 'A', email: 'a@b.vn' }), []);
  assert.deepEqual(validateAccountForm('edit', { fullName: 'A', email: 'a@b' }), ['Email không hợp lệ.']);
  assert.deepEqual(validateAccountForm('edit', { fullName: 'A', email: 'a@b.vn', positionTitle: 'c'.repeat(121) }), ['Chức danh tối đa 120 ký tự.']);
  assert.deepEqual(validateAccountForm('edit', { fullName: 'h'.repeat(201), email: 'a@b.vn' }), ['Họ tên tối đa 200 ký tự.']);
});

test('validateAccountForm — đổi vai trò / cấp lại / mở lại / khoá', () => {
  assert.deepEqual(validateAccountForm('role', { role: 'accountant' }), []);
  assert.deepEqual(validateAccountForm('role', { role: 'accountant', current: 'accountant' }), ['Tài khoản đang giữ đúng vai trò này.']);
  assert.deepEqual(validateAccountForm('role', { role: '' }), ['Chưa chọn vai trò.']);
  assert.deepEqual(validateAccountForm('resetPassword', { tempPassword: 'ngan' }), ['Mật khẩu tạm cần ít nhất 12 ký tự.']);
  assert.deepEqual(validateAccountForm('enable', { tempPassword: 'x'.repeat(12) }), []);
  assert.deepEqual(validateAccountForm('disable', { reason: '  ' }), ['Chưa nhập lý do.']);
  assert.deepEqual(validateAccountForm('disable', { reason: 'r'.repeat(201) }), ['Lý do tối đa 200 ký tự.']);
  assert.deepEqual(validateAccountForm('disable', { reason: 'Nghỉ việc từ 01/12' }), []);
});

test('accountErrorMessage — theo mã máy chủ', () => {
  const m = (code, extra = {}) => accountErrorMessage({ code, message: 'thông báo gốc', extra: [], fieldErrors: {}, ...extra });
  assert.equal(m('EMAIL_TAKEN'), 'Email này đã có người dùng.');
  assert.equal(m('VERSION_CONFLICT'), 'Thông tin vừa được người khác sửa. Tải lại rồi thử lại.');
  assert.equal(m('LAST_APPROVER'), 'Không thể khoá hoặc gỡ quyền của Quản trị CRM cuối cùng.');
  assert.equal(m('LAST_ADMIN'), 'Không thể khoá tài khoản hệ thống cuối cùng.');
  assert.equal(m('SELF_MODIFICATION'), 'Bạn không tự làm thao tác này trên tài khoản của mình được.');
  assert.equal(m('SYSTEM_ACCOUNT'), 'Không thao tác được trên tài khoản hệ thống.');
  assert.equal(m('MULTI_ROLE_UNSUPPORTED'), 'Tài khoản có nhiều vai trò, cần xử lý riêng.');
  assert.equal(m('ACCOUNT_ADMIN_UNAVAILABLE'), 'Chức năng quản lý tài khoản chưa được bật trên máy chủ.');
  assert.equal(m('SYSTEM_REQUESTER_UNAVAILABLE'), 'Thiếu tài khoản hệ thống, chưa quản lý tài khoản được. Báo người quản trị máy chủ.');
  assert.equal(m('RATE_LIMITED'), 'Thao tác quá nhanh. Chờ một phút rồi thử lại.');
  assert.equal(m('ACCOUNT_NOT_FOUND'), 'Không tìm thấy tài khoản. Có thể tài khoản vừa bị xoá — hãy tải lại danh sách.');
});

test('accountErrorMessage — 400: nối các câu chi tiết của máy chủ; ACCOUNT_STATE: câu của máy chủ; mã lạ: thông báo đã phân loại; không có gì: câu chung', () => {
  assert.equal(accountErrorMessage({ code: 'VALIDATION_FAILED', kind: 'bad_request', message: 'Dữ liệu gửi lên không hợp lệ.', extra: ['Mật khẩu cần ít nhất 12 ký tự.', 'Email không hợp lệ.'], fieldErrors: {} }), 'Mật khẩu cần ít nhất 12 ký tự. Email không hợp lệ.');
  assert.equal(accountErrorMessage({ code: 'VALIDATION_FAILED', kind: 'bad_request', message: 'Dữ liệu gửi lên không hợp lệ.', extra: [], fieldErrors: { email: 'email must be a string' } }), 'email must be a string');
  // ACCOUNT_STATE: tầng repository ghép "<câu chung 409> <câu của máy chủ>" => bỏ câu chung, giữ câu của máy chủ.
  assert.equal(accountErrorMessage({ code: 'ACCOUNT_STATE', kind: 'conflict', message: 'Xung đột dữ liệu (bản ghi trùng hoặc đã bị thay đổi). Tài khoản đã bị khoá từ trước.', extra: [], fieldErrors: {} }), 'Tài khoản đã bị khoá từ trước.');
  assert.equal(accountErrorMessage({ kind: 'network', message: 'Không kết nối được máy chủ.', extra: [], fieldErrors: {} }), 'Không kết nối được máy chủ.');
  assert.equal(accountErrorMessage(null), 'Không thực hiện được. Hãy thử lại.');
});

test('buildAccountsQuery: bỏ trường rỗng; từ khoá < 2 ký tự không gửi; luôn kèm pageSize', () => {
  assert.deepEqual(buildAccountsQuery({ q: '  mau ', role: 'sales', status: 'DISABLED' }), { pageSize: 100, page: 1, q: 'mau', role: 'sales', status: 'DISABLED' });
  assert.deepEqual(buildAccountsQuery({ q: 'a', role: '', status: '' }), { pageSize: 100, page: 1 });
  assert.deepEqual(buildAccountsQuery({ page: 3 }), { pageSize: 100, page: 3 });
});

test('initials: chữ cái đầu của hai từ cuối', () => {
  assert.equal(initials('Trần Thị Mẫu'), 'TM');
  assert.equal(initials('  Quản trị CRM '), 'TC');
  assert.equal(initials('An'), 'A');
  assert.equal(initials(''), '?');
});

test('accountsNav: có quyền => mục "Tài khoản" thay chỗ mục "Nhân sự" (đúng vị trí, nhóm Vận hành); không quyền => thanh bên giữ nguyên', () => {
  const nav = [{ section: 'Vận hành' }, { id: 'finance', label: 'Tài chính', icon: 'wallet' }, { id: 'hr', label: 'Nhân sự', icon: 'id-card' }, { section: 'AI' }, { id: 'agents', label: 'AI' }];
  assert.deepEqual(ACCOUNTS_NAV_ITEM, { id: 'accounts', label: 'Tài khoản', icon: 'id-card' });
  const on = accountsNav(nav, true);
  assert.deepEqual(on.map((n) => n.id || n.section), ['Vận hành', 'finance', 'accounts', 'AI', 'agents']);
  assert.deepEqual(on[2], ACCOUNTS_NAV_ITEM);
  assert.equal(nav[2].id, 'hr', 'không sửa mảng gốc');
  assert.equal(accountsNav(nav, false), nav);
  assert.equal(accountsNav(nav, false).some((n) => n.id === 'accounts'), false);
  // Thanh bên không có mục "Nhân sự" => thêm vào cuối, vẫn chỉ một mục.
  assert.deepEqual(accountsNav([{ id: 'customers' }], true).map((n) => n.id), ['customers', 'accounts']);
});
