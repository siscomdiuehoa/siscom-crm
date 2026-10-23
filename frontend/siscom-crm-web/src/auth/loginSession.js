// Bộ điều khiển đăng nhập HEADLESS (không React, không DOM). Trạng thái: UNAVAILABLE | IDLE | LOADING | AUTHENTICATED | ERROR.
// - Cờ tắt => UNAVAILABLE ("xác thực chưa khả dụng"); KHÔNG BAO GIỜ chuyển sang đăng nhập demo/giả.
// - Trạng thái công khai KHÔNG chứa mật khẩu hay token; token giữ trong closure (bộ nhớ), không ghi storage.
// - Danh tính (employeeId) chỉ lấy từ phản hồi /auth/me của server; không gán vai trò/actor ở client.
import { parseLoginIdentifier, validatePassword } from './loginIdentifier.js';
import { AuthHttpError, AuthNetworkError, AuthUnavailableError } from './authClient.js';

export const LOGIN_ERRORS = {
  IDENTIFIER_INVALID: 'Email hoặc mã nhân viên không hợp lệ.',
  PASSWORD_REQUIRED: 'Vui lòng nhập mật khẩu.',
  PASSWORD_TOO_LONG: 'Mật khẩu quá dài.',
  INVALID_CREDENTIALS: 'Thông tin đăng nhập không đúng.',
  RATE_LIMITED: 'Quá nhiều lần thử, vui lòng thử lại sau.',
  ENDPOINT_UNAVAILABLE: 'Chức năng đăng nhập chưa được bật.',
  NETWORK: 'Không kết nối được máy chủ.',
  SERVICE_UNAVAILABLE: 'Dịch vụ xác thực tạm thời không khả dụng.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn.',
  REQUEST_INVALID: 'Yêu cầu không hợp lệ.',
  UNKNOWN: 'Đăng nhập thất bại.',
};

export function classifyAuthError(err) {
  if (err instanceof AuthNetworkError) return 'NETWORK';
  if (err instanceof AuthUnavailableError) return 'ENDPOINT_UNAVAILABLE';
  if (err instanceof AuthHttpError) {
    if ([404, 405, 501].includes(err.status)) return 'ENDPOINT_UNAVAILABLE'; // route chưa tồn tại: KHÔNG phải sai mật khẩu
    if (err.status === 429) return 'RATE_LIMITED';
    if (err.status === 401) return err.code === 'LOGIN_INVALID' ? 'INVALID_CREDENTIALS' : 'SESSION_EXPIRED';
    if (err.status === 400) return 'REQUEST_INVALID';
    if (err.status >= 500) return 'SERVICE_UNAVAILABLE';
  }
  return 'UNKNOWN';
}

const idle = () => ({ status: 'IDLE', error: null, employeeId: null, expiresAt: null });

export function createLoginSession(client) {
  let token = null;
  let epoch = 0; // tăng mỗi khi submit/logout/401 xảy ra: kết quả async của "thế hệ" cũ bị bỏ, không ghi đè trạng thái mới
  let state = client && client.enabled ? idle() : { status: 'UNAVAILABLE', error: null, employeeId: null, expiresAt: null };
  const listeners = new Set();
  const set = (s) => { state = s; listeners.forEach((l) => l(state)); };
  const fail = (code) => set({ status: 'ERROR', error: code, employeeId: null, expiresAt: null });

  return {
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    getAuthHeader: () => (token ? 'Bearer ' + token : null), // chỉ trong bộ nhớ
    async submit(loginInput, password) {
      if (state.status === 'UNAVAILABLE' || state.status === 'LOADING') return state;
      const id = parseLoginIdentifier(loginInput);
      if (id.kind === 'INVALID') { fail('IDENTIFIER_INVALID'); return state; }
      const pe = validatePassword(password);
      if (pe) { fail(pe); return state; }
      const my = ++epoch;
      token = null; // đăng nhập lại: không giữ token phiên cũ trong lúc LOADING
      set({ status: 'LOADING', error: null, employeeId: null, expiresAt: null });
      try {
        const issued = await client.login(id.value, password);
        if (my !== epoch) return state; // đã logout/bị thay thế khi chờ: bỏ kết quả cũ
        const me = await client.me(issued.token); // danh tính do server xác nhận
        if (my !== epoch) return state;
        token = issued.token;
        set({ status: 'AUTHENTICATED', error: null, employeeId: me.employeeId, expiresAt: issued.expiresAt });
      } catch (e) {
        if (my !== epoch) return state;
        token = null; fail(classifyAuthError(e));
      }
      return state;
    },
    async logout() {
      if (state.status === 'UNAVAILABLE') return state;
      const my = ++epoch; // hủy mọi submit đang chờ
      const t = token;
      token = null; // xóa token cục bộ trước, bất kể kết quả server
      if (t) {
        try { await client.logout(t); } catch (e) { if (my !== epoch) return state; fail(classifyAuthError(e)); return state; }
        if (my !== epoch) return state; // đã có đăng nhập mới trong lúc chờ server: không xóa phiên mới
      }
      set(idle());
      return state;
    },
    // Gọi khi API khác trả 401: bỏ token, KHÔNG tự đăng nhập lại.
    // Khi đang LOADING: token đã bị xóa từ đầu submit, 401 chỉ có thể đến từ yêu cầu của phiên cũ => không hủy lần đăng nhập đang chạy.
    handleUnauthorized() {
      if (state.status === 'LOADING') return state;
      epoch++; token = null;
      if (state.status === 'AUTHENTICATED') fail('SESSION_EXPIRED');
      return state;
    },
  };
}
