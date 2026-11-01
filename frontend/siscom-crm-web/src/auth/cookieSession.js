// Bộ điều khiển phiên COOKIE (headless, không React/DOM) — cùng giao diện với loginSession.js (getState/subscribe/submit/logout/
// handleUnauthorized) để dùng lại LoginScreen, cộng thêm restore() (tải lại trang: hỏi /auth/me) và getCsrfToken().
// - Không có token trong JS: cookie HttpOnly do trình duyệt giữ. CSRF token chỉ trong bộ nhớ (hoặc đọc lại từ cookie siscom_csrf
//   khi tải lại trang), không ghi storage, không log, không nằm trong state công khai.
// - Trạng thái: UNAVAILABLE | IDLE | LOADING | AUTHENTICATED | ERROR. `me` (employeeId, code, fullName, roles, permissions) chỉ từ server.
// - epoch: kết quả async của thế hệ cũ (submit/logout/401 chen ngang) bị bỏ, không ghi đè trạng thái mới.
import { parseLoginIdentifier, validatePassword } from './loginIdentifier.js';
import { classifyAuthError } from './loginSession.js';
import { readCsrfCookie } from './cookieAuthClient.js';

const idle = () => ({ status: 'IDLE', error: null, employeeId: null, expiresAt: null, me: null });

export function createCookieSession(client, { readCookie } = {}) {
  let csrf = null;
  let epoch = 0;
  let state = client && client.enabled ? idle() : { status: 'UNAVAILABLE', error: null, employeeId: null, expiresAt: null, me: null };
  const listeners = new Set();
  const set = (s) => { state = s; listeners.forEach((l) => l(state)); };
  const fail = (code) => set({ status: 'ERROR', error: code, employeeId: null, expiresAt: null, me: null });
  const cookies = typeof readCookie === 'function' ? readCookie : () => (typeof document !== 'undefined' ? document.cookie : '');
  const authed = (me) => set({ status: 'AUTHENTICATED', error: null, employeeId: me.employeeId, expiresAt: null, me });
  // B1.4 Remember Me: phiên thường hết hạn GIỮA CHỪNG (tab đang mở) => thử tái lập MỘT lần từ cookie ghi nhớ (HttpOnly). Tối đa 1 lần / 60 giây
  // (chống vòng lặp 401 -> restore). Thất bại => giữ ERROR SESSION_EXPIRED (đăng nhập lại bằng mật khẩu). Đăng xuất / submit / 401 mới chen ngang => bỏ kết quả.
  let lastAutoRestoreAt = -Infinity;
  const now = () => Date.now();
  function autoRestoreAfterExpiry() {
    if (typeof client.restoreRemembered !== 'function' || now() - lastAutoRestoreAt < 60_000) return;
    lastAutoRestoreAt = now();
    const my = epoch;
    Promise.resolve().then(() => client.restoreRemembered()).then((r) => {
      if (my !== epoch || state.status !== 'ERROR' || state.error !== 'SESSION_EXPIRED') return;
      csrf = r.csrfToken;
      authed(r.me);
    }, () => { /* giữ SESSION_EXPIRED */ });
  }

  return {
    mode: 'cookie',
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    getAuthHeader: () => null, // không Bearer: cookie do trình duyệt gửi
    // CSRF token hiện hành: bộ nhớ trước, cookie double-submit sau (sau khi tải lại trang). null khi chưa đăng nhập.
    getCsrfToken() {
      if (state.status !== 'AUTHENTICATED') return null;
      return csrf || readCsrfCookie(cookies());
    },
    // Tải lại trang: cookie phiên có thể còn hiệu lực => hỏi /auth/me. Không ném lỗi; thất bại => IDLE (phải đăng nhập lại).
    // B1.4 Remember Me: /auth/me trả 401 => thử MỘT lần tái lập phiên từ cookie ghi nhớ (HttpOnly; JS không thấy cookie). REMEMBER_RACE (tab khác
    // vừa xoay vòng token) => hỏi lại /auth/me một lần. Mọi lỗi khác => IDLE (đăng nhập bằng mật khẩu). Lỗi mạng ở /auth/me => không thử restore.
    async restore() {
      if (state.status === 'UNAVAILABLE') return state;
      const my = ++epoch;
      set({ status: 'LOADING', error: null, employeeId: null, expiresAt: null, me: null });
      try {
        const r = await client.me();
        if (my !== epoch) return state;
        csrf = null; // lấy từ cookie siscom_csrf khi cần
        authed(r.me);
        return state;
      } catch (e) {
        if (my !== epoch) return state;
        if (!(e && e.name === 'AuthHttpError' && e.status === 401) || typeof client.restoreRemembered !== 'function') { set(idle()); return state; }
      }
      try {
        const r = await client.restoreRemembered();
        if (my !== epoch) return state;
        csrf = r.csrfToken;
        authed(r.me);
      } catch (e) {
        if (my !== epoch) return state;
        if (e && e.name === 'AuthHttpError' && e.code === 'REMEMBER_RACE') {
          try { const r2 = await client.me(); if (my !== epoch) return state; csrf = null; authed(r2.me); return state; } catch (e2) { if (my !== epoch) return state; }
        }
        set(idle());
      }
      return state;
    },
    // remember: ô "Ghi nhớ đăng nhập trên thiết bị này" (mặc định không tích). Chỉ đúng true mới gửi.
    async submit(loginInput, password, remember) {
      if (state.status === 'UNAVAILABLE' || state.status === 'LOADING') return state;
      const reject = (code) => { epoch++; csrf = null; fail(code); return state; };
      const id = parseLoginIdentifier(loginInput);
      if (id.kind === 'INVALID') return reject('IDENTIFIER_INVALID');
      const pe = validatePassword(password);
      if (pe) return reject(pe);
      const my = ++epoch;
      csrf = null;
      set({ status: 'LOADING', error: null, employeeId: null, expiresAt: null, me: null });
      try {
        const r = await client.login(id.value, password, remember === true);
        if (my !== epoch) return state;
        csrf = r.csrfToken;
        authed(r.me);
      } catch (e) {
        if (my !== epoch) return state;
        csrf = null; fail(classifyAuthError(e));
      }
      return state;
    },
    async logout() {
      if (state.status === 'UNAVAILABLE') return state;
      const my = ++epoch;
      const t = this.getCsrfToken ? this.getCsrfToken() : csrf;
      const wasAuthed = state.status === 'AUTHENTICATED';
      csrf = null;
      if (wasAuthed) {
        try { await client.logout(t); } catch (e) { if (my !== epoch) return state; set(idle()); return state; } // cookie phía server có thể còn: vẫn về IDLE (fail-safe cho UI), không giữ phiên
        if (my !== epoch) return state;
      }
      set(idle());
      return state;
    },
    // PR 8: đổi mật khẩu của chính mình. Chỉ khi AUTHENTICATED (nếu không => BLOCKED, không gọi mạng). Thành công: máy chủ cấp phiên + CSRF mới
    // => thay csrf trong bộ nhớ và me (mustChangePassword=false), phiên vẫn AUTHENTICATED. 401 => phiên đã bị thu hồi => SESSION_EXPIRED.
    // Lỗi khác (400/403/429/mạng) => trả { ok:false, error } và KHÔNG đổi trạng thái phiên. Không giữ mật khẩu.
    async changePassword(currentPassword, newPassword, confirmPassword) {
      if (state.status !== 'AUTHENTICATED') return { ok: false, error: { code: 'BLOCKED', details: null } };
      const my = epoch;
      const token = this.getCsrfToken ? this.getCsrfToken() : csrf;
      try {
        const r = await client.changePassword(currentPassword, newPassword, confirmPassword, token);
        if (my !== epoch) return { ok: false, error: { code: 'SESSION_EXPIRED', details: null } };
        csrf = r.csrfToken;
        authed(r.me);
        return { ok: true };
      } catch (e) {
        if (my !== epoch) return { ok: false, error: { code: 'SESSION_EXPIRED', details: null } };
        if (e && e.name === 'AuthHttpError' && e.status === 401) { this.handleUnauthorized(); return { ok: false, error: { code: 'SESSION_EXPIRED', details: null } }; }
        if (e && e.name === 'AuthNetworkError') return { ok: false, error: { code: 'NETWORK', details: null } };
        return { ok: false, error: { code: (e && e.code) || 'UNKNOWN', details: e && e.details !== undefined ? e.details : null } };
      }
    },
    // API khác trả 401: phiên server đã hết/thu hồi => về ERROR SESSION_EXPIRED (không tự đăng nhập lại). Khi đang LOADING: bỏ qua.
    handleUnauthorized() {
      if (state.status === 'LOADING') return state;
      epoch++; csrf = null;
      if (state.status === 'AUTHENTICATED') { fail('SESSION_EXPIRED'); autoRestoreAfterExpiry(); }
      return state;
    },
  };
}
