// Xem thử màn hình đăng nhập (PREVIEW) — THUẦN, không React/DOM, không mạng, không storage.
// - Cờ VITE_CRM_LOGIN_PREVIEW_ENABLED === 'true' mới bật; MẶC ĐỊNH TẮT => ứng dụng CRM hiện tại giữ nguyên.
// - Chưa có AuthController thẩm quyền: phiên preview KHÔNG BAO GIỜ đăng nhập thành công, không tạo người dùng giả,
//   không mở khóa khách hàng. Gửi biểu mẫu hợp lệ => báo rõ "máy chủ xác thực chưa khả dụng".
// - Mật khẩu/định danh không được lưu hay ghi log; phiên chỉ giữ { status, error }.
import { parseLoginIdentifier, validatePassword } from './loginIdentifier.js';

export const LOGIN_PREVIEW_ERROR = 'BACKEND_AUTH_UNAVAILABLE';
export const LOGIN_PREVIEW_UNAVAILABLE_TEXT = 'Máy chủ xác thực chưa khả dụng: chưa có AuthController. Đây chỉ là bản xem thử giao diện, chưa đăng nhập được.';

export function readLoginPreviewFlag(env) {
  return !!env && env.VITE_CRM_LOGIN_PREVIEW_ENABLED === 'true';
}

// Chọn gốc render: 'preview' chỉ khi cờ bật; còn lại luôn là 'app' (giao diện CRM hiện có).
export function selectRootKind(env) {
  return readLoginPreviewFlag(env) ? 'preview' : 'app';
}

// Cùng giao diện với bộ điều khiển headless (getState/subscribe/submit) để dùng lại LoginScreen.
export function createLoginPreviewSession() {
  let state = { status: 'IDLE', error: null, employeeId: null, expiresAt: null };
  const listeners = new Set();
  const set = (s) => { state = s; listeners.forEach((l) => l(state)); };
  const fail = (code) => set({ status: 'ERROR', error: code, employeeId: null, expiresAt: null });
  return {
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    getAuthHeader: () => null,
    async submit(loginInput, password) {
      if (parseLoginIdentifier(loginInput).kind === 'INVALID') { fail('IDENTIFIER_INVALID'); return state; }
      const pe = validatePassword(password);
      if (pe) { fail(pe); return state; }
      fail(LOGIN_PREVIEW_ERROR); // luôn từ chối: không có backend xác thực thẩm quyền
      return state;
    },
    async logout() { return state; },
    handleUnauthorized() { return state; },
  };
}
