// Ranh giới HTTP xác thực bằng PHIÊN COOKIE server-side (thiết kế đã chốt 28/10/2026, Issue #8; backend PR #167).
//   POST /auth/login  {login,password} -> 200 {data:{me, csrfToken}} + Set-Cookie siscom_sid (HttpOnly) + siscom_csrf (đọc được)
//   GET  /auth/me     (cookie)         -> 200 {data:{me}} | 401
//   POST /auth/logout (cookie + Origin + X-CSRF-Token) -> 200 {data:{ok:true}} + cookie xoá | 401 | 403 CSRF_FAILED
// B1.4 Remember Me (Issue #177): login gửi remember:true CHỈ khi người dùng tích (thiếu = không ghi nhớ; backend cũ vẫn chạy khi không tích).
//   POST /auth/remember/restore (cookie siscom_rmb HttpOnly do trình duyệt gửi + X-Remember-Restore: 1) -> 200 {data:{me, csrfToken}} | 401 | 403 | 429.
//   JS KHÔNG đọc/ghi cookie siscom_rmb (HttpOnly); không ghi storage.
// Cùng origin qua Vite proxy /api (base mặc định '/api/v1'); mọi yêu cầu dùng credentials:'include'. Không có token trong JS;
// CSRF token lấy từ phản hồi login hoặc cookie siscom_csrf (double-submit), chỉ giữ trong bộ nhớ, không ghi storage, không log.
import { AuthHttpError, AuthNetworkError, AuthUnavailableError } from './authClient.js';

export const CSRF_COOKIE_NAME = 'siscom_csrf';
const B64URL_256 = /^[A-Za-z0-9_-]{43}$/;

function isAcceptableBase(u) {
  if (typeof u !== 'string') return false;
  if (u.startsWith('/')) return !u.startsWith('//'); // đường dẫn cùng origin (qua proxy)
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch (e) { return false; }
}

// Bật khi VITE_CRM_AUTH_ENABLED === 'true'; base mặc định '/api/v1' (cùng origin). Không nhận javascript:/rác.
export function readCookieAuthConfig(env) {
  const e = env || {};
  const raw = String(e.VITE_CRM_API_BASE || '/api/v1').trim().replace(/\/+$/, '');
  const ok = isAcceptableBase(raw);
  return { enabled: e.VITE_CRM_AUTH_ENABLED === 'true' && ok, baseUrl: ok ? raw : '' };
}

// Đọc cookie siscom_csrf (double-submit) từ document.cookie; sai định dạng/thiếu => null. Không ném lỗi.
export function readCsrfCookie(cookieString) {
  if (typeof cookieString !== 'string' || !cookieString) return null;
  let found = null;
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== CSRF_COOKIE_NAME) continue;
    const v = part.slice(eq + 1).trim();
    if (found !== null) return null;
    found = v;
  }
  return found !== null && B64URL_256.test(found) ? found : null;
}

function isMe(d) {
  return !!d && typeof d === 'object' && typeof d.employeeId === 'string' && typeof d.code === 'string' && typeof d.fullName === 'string'
    && Array.isArray(d.roles) && d.permissions && typeof d.permissions === 'object';
}

export function createCookieAuthClient(config, fetchImpl) {
  const cfg = config || { enabled: false, baseUrl: '' };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  async function call(method, path, { body, csrf, extraHeaders } = {}) {
    if (!cfg.enabled || !doFetch) throw new AuthUnavailableError();
    const headers = { Accept: 'application/json', ...(extraHeaders || {}) };
    if (body) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-CSRF-Token'] = csrf;
    let res;
    try {
      res = await doFetch(cfg.baseUrl + path, { method, credentials: 'include', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (e) { throw new AuthNetworkError(); }
    let json = null;
    try { json = await res.json(); } catch (e) { /* thân không phải JSON */ }
    if (!res.ok) throw new AuthHttpError(res.status, String((json && json.error && json.error.code) || (json && json.code) || 'REQUEST_FAILED'), json && json.error && json.error.details !== undefined ? json.error.details : (json && json.details !== undefined ? json.details : null));
    const data = json && json.data !== undefined ? json.data : json;
    if (data === null || typeof data !== 'object') throw new AuthHttpError(res.status, 'BAD_RESPONSE');
    return data;
  }
  return {
    enabled: cfg.enabled,
    mode: 'cookie',
    async login(login, password, remember) {
      if (typeof login !== 'string' || !login || typeof password !== 'string' || !password) throw new AuthHttpError(400, 'REQUEST_INVALID');
      const d = await call('POST', '/auth/login', { body: remember === true ? { login, password, remember: true } : { login, password } });
      if (!isMe(d.me) || typeof d.csrfToken !== 'string' || !B64URL_256.test(d.csrfToken)) throw new AuthHttpError(200, 'BAD_RESPONSE');
      return { me: d.me, csrfToken: d.csrfToken };
    },
    // Tái lập phiên thường từ cookie ghi nhớ (HttpOnly). Không có body; header tuỳ biến buộc preflight CORS (máy chủ kiểm Origin + header).
    async restoreRemembered() {
      const d = await call('POST', '/auth/remember/restore', { extraHeaders: { 'X-Remember-Restore': '1' } });
      if (!isMe(d.me) || typeof d.csrfToken !== 'string' || !B64URL_256.test(d.csrfToken)) throw new AuthHttpError(200, 'BAD_RESPONSE');
      return { me: d.me, csrfToken: d.csrfToken };
    },
    async me() {
      const d = await call('GET', '/auth/me');
      if (!isMe(d.me)) throw new AuthHttpError(200, 'BAD_RESPONSE');
      return { me: d.me };
    },
    // PR 8: đổi mật khẩu của chính mình. Thiếu CSRF => không gọi mạng. Phản hồi: me + csrfToken MỚI (máy chủ đã cấp phiên mới, mọi phiên cũ bị thu hồi).
    async changePassword(currentPassword, newPassword, confirmPassword, csrfToken) {
      if (typeof csrfToken !== 'string' || !csrfToken) throw new AuthHttpError(403, 'CSRF_FAILED');
      for (const v of [currentPassword, newPassword, confirmPassword]) if (typeof v !== 'string' || !v) throw new AuthHttpError(400, 'REQUEST_INVALID');
      const d = await call('POST', '/auth/change-password', { body: { currentPassword, newPassword, confirmPassword }, csrf: csrfToken });
      if (!isMe(d.me) || typeof d.csrfToken !== 'string' || !B64URL_256.test(d.csrfToken)) throw new AuthHttpError(200, 'BAD_RESPONSE');
      return { me: d.me, csrfToken: d.csrfToken };
    },
    async logout(csrfToken) {
      if (typeof csrfToken !== 'string' || !csrfToken) throw new AuthHttpError(403, 'CSRF_FAILED'); // không gọi mạng khi thiếu CSRF
      await call('POST', '/auth/logout', { csrf: csrfToken });
    },
  };
}
