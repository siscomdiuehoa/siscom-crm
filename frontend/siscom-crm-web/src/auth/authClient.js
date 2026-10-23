// Ranh giới HTTP xác thực, MẶC ĐỊNH TẮT. Hợp đồng theo PR #31 (A4): backend CHƯA có AuthController/route nào hoạt động;
// client này chỉ chạy khi VITE_CRM_AUTH_ENABLED === 'true' VÀ có VITE_CRM_API_BASE. Không có đường giả lập thành công.
//   POST /auth/login  {login,password} -> 200 {token,expiresAt} | 400 REQUEST_INVALID | 401 LOGIN_INVALID | 429 LOGIN_THROTTLED (PR #39)
//   POST /auth/logout  Bearer          -> 200 {ok:true}         | 401 AUTH_REQUIRED  | 503 AUTH_UNAVAILABLE
//   GET  /auth/me      Bearer          -> 200 {employeeId}      | 401 AUTH_REQUIRED
// Đường dẫn /auth/* là GIẢ ĐỊNH CHƯA CHỐT (hợp đồng A4 chưa gắn route) — phải đối chiếu lại khi AuthController được duyệt.
// Token/mật khẩu: không ghi storage/cookie (credentials:'omit'), không log. Token chỉ trả cho người gọi để giữ trong bộ nhớ.
export class AuthUnavailableError extends Error {
  constructor() { super('Xác thực chưa khả dụng.'); this.name = 'AuthUnavailableError'; }
}
export class AuthHttpError extends Error {
  constructor(status, code) { super(code); this.name = 'AuthHttpError'; this.status = status; this.code = code; }
}
export class AuthNetworkError extends Error {
  constructor() { super('NETWORK'); this.name = 'AuthNetworkError'; }
}

export function readAuthConfig(env) {
  const e = env || {};
  const baseUrl = String(e.VITE_CRM_API_BASE || '').trim().replace(/\/+$/, '');
  return { enabled: e.VITE_CRM_AUTH_ENABLED === 'true' && !!baseUrl, baseUrl };
}

export function createAuthClient(config, fetchImpl) {
  const cfg = config || { enabled: false, baseUrl: '' };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  async function call(method, path, { body, token } = {}) {
    if (!cfg.enabled || !doFetch) throw new AuthUnavailableError();
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await doFetch(cfg.baseUrl + path, { method, credentials: 'omit', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (e) { throw new AuthNetworkError(); }
    let json = null;
    try { json = await res.json(); } catch (e) { /* thân không phải JSON */ }
    if (!res.ok) {
      const code = (json && json.error && json.error.code) || (json && json.code) || 'REQUEST_FAILED';
      throw new AuthHttpError(res.status, String(code));
    }
    const data = json && json.data !== undefined ? json.data : json; // chấp nhận cả {data:{...}} lẫn thân trần
    if (data === null || typeof data !== 'object') throw new AuthHttpError(res.status, 'BAD_RESPONSE');
    return data;
  }
  return {
    enabled: cfg.enabled,
    async login(login, password) {
      const d = await call('POST', '/auth/login', { body: { login, password } });
      if (typeof d.token !== 'string' || !d.token || typeof d.expiresAt !== 'string') throw new AuthHttpError(200, 'BAD_RESPONSE');
      return { token: d.token, expiresAt: d.expiresAt };
    },
    async me(token) {
      const d = await call('GET', '/auth/me', { token });
      if (d.employeeId === undefined || d.employeeId === null) throw new AuthHttpError(200, 'BAD_RESPONSE');
      return { employeeId: d.employeeId };
    },
    async logout(token) { await call('POST', '/auth/logout', { token }); },
  };
}
