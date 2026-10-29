// Feature-flagged HTTP boundary for the Customers API. OFF by default. NOT wired into the UI (the app still uses localStorage).
// Default: no credentials of any kind (credentials:'omit'). Backend 401 is surfaced as ApiError and never bypassed.
// OPT-IN (options.auth = an independently verified login session exposing getState/getAuthHeader/handleUnauthorized): the Authorization header
// is read from that session's memory on every call; nothing is stored here. No verified session => AuthRequiredError BEFORE any network call.
// ASSUMPTION (server auth contract not final): bearer is only a trial seam, NOT approved for production; cookie/CSRF would change this.
import { fromApiCustomer, toApiCustomer, buildLookupMaps, normalizeOwnerCandidates } from './customerAdapter.js';

export class ApiDisabledError extends Error { constructor() { super('Chế độ API đang TẮT (VITE_CRM_API_ENABLED khác "true" hoặc thiếu VITE_CRM_API_BASE).'); this.name = 'ApiDisabledError'; } }
export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details; }
}

export class AuthRequiredError extends ApiError { constructor() { super(401, 'AUTH_REQUIRED', 'Chưa đăng nhập: không gửi yêu cầu tới máy chủ.'); this.name = 'AuthRequiredError'; } }
export class StaleSessionError extends Error { constructor() { super('Phiên đăng nhập đã thay đổi trong lúc chờ phản hồi: kết quả bị bỏ.'); this.name = 'StaleSessionError'; } }

const BEARER = /^Bearer [A-Za-z0-9._~+/=-]+$/; // một dòng, không khoảng trắng/CR/LF: chống chèn header

// Header hợp lệ chỉ khi phiên báo AUTHENTICATED VÀ có bearer đúng dạng; mọi lỗi/ngoại lệ => null (fail-closed).
function readVerifiedHeader(auth) {
  try {
    if (!auth || typeof auth.getState !== 'function' || typeof auth.getAuthHeader !== 'function') return null;
    const st = auth.getState();
    if (!st || st.status !== 'AUTHENTICATED') return null;
    const h = auth.getAuthHeader();
    return typeof h === 'string' && BEARER.test(h) ? h : null;
  } catch (e) { return null; }
}
function currentHeader(auth) { try { return auth.getAuthHeader(); } catch (e) { return null; } }

// env = import.meta.env (or a plain object in tests). Enabled only when the flag is exactly "true" AND a base URL is set.
export function readApiConfig(env) {
  const e = env || {};
  const baseUrl = String(e.VITE_CRM_API_BASE || '').trim().replace(/\/+$/, '');
  return { enabled: e.VITE_CRM_API_ENABLED === 'true' && !!baseUrl, baseUrl };
}

// options.session: phiên COOKIE (createCookieSession) — cookie do trình duyệt gửi (credentials:'include'); mọi phương thức ghi kèm X-CSRF-Token;
// chưa AUTHENTICATED => AuthRequiredError TRƯỚC khi gọi mạng; 401 => session.handleUnauthorized(); phiên đổi trong lúc chờ => StaleSessionError.
function sessionReady(session) {
  try { return !!session && typeof session.getState === 'function' && session.getState().status === 'AUTHENTICATED'; } catch (e) { return false; }
}
function sessionKey(session) { try { const s = session.getState(); return s.status + ':' + (s.employeeId || ''); } catch (e) { return null; } }
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createCustomerApi(config, fetchImpl, options) {
  const auth = options && options.auth ? options.auth : null;
  const session = options && options.session ? options.session : null;
  const cfg = config || { enabled: false, baseUrl: '' };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  async function call(method, path, body) {
    if (!cfg.enabled) throw new ApiDisabledError();
    if (!doFetch) throw new Error('fetch không khả dụng.');
    let authHeader = null;
    if (auth) { authHeader = readVerifiedHeader(auth); if (!authHeader) throw new AuthRequiredError(); }
    let csrf = null; let sessKey = null;
    if (session) {
      if (!sessionReady(session)) throw new AuthRequiredError();
      sessKey = sessionKey(session);
      if (UNSAFE.has(method)) { csrf = typeof session.getCsrfToken === 'function' ? session.getCsrfToken() : null; if (!csrf) throw new AuthRequiredError(); }
    }
    const res = await doFetch(cfg.baseUrl + path, {
      method, credentials: session ? 'include' : 'omit',
      headers: { Accept: 'application/json', ...(authHeader ? { Authorization: authHeader } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body */ }
    if (session) {
      if (res.status === 401) { try { session.handleUnauthorized(); } catch (e) { /* không che lỗi 401 gốc */ } }
      else if (sessionKey(session) !== sessKey) throw new StaleSessionError();
    }
    if (auth) {
      // 401 báo kèm header đã dùng: phiên chỉ hủy khi vẫn khớp token hiện tại (401 muộn không hủy phiên mới). 403 không hủy phiên.
      if (res.status === 401) { try { auth.handleUnauthorized(authHeader); } catch (e) { /* không che lỗi 401 gốc */ } }
      else if (currentHeader(auth) !== authHeader) throw new StaleSessionError(); // phiên đã đổi/đăng xuất: không trả dữ liệu của phiên cũ
    }
    if (!res.ok) {
      const er = (json && json.error) || {};
      throw new ApiError(res.status, er.code || 'REQUEST_FAILED', er.message || (json && json.message) || 'Yêu cầu thất bại (' + res.status + ').', er.details);
    }
    return json ? json.data : null;
  }
  const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const t = p.toString(); return t ? '?' + t : ''; };
  return {
    enabled: cfg.enabled,
    async getLookupMaps() { return buildLookupMaps(await call('GET', '/lookups' + qs({ type: 'customer_tier,customer_status,industry,source,province' }))); },
    async getOwnerCandidates() { return normalizeOwnerCandidates(await call('GET', '/customers/owner-candidates')); },
    async list(params) { const d = await call('GET', '/customers' + qs(params)); return { ...d, items: d.items.map(fromApiCustomer) }; },
    async get(id) { return fromApiCustomer(await call('GET', '/customers/' + encodeURIComponent(id))); },
    async create(ui, maps) { return fromApiCustomer(await call('POST', '/customers', toApiCustomer(ui, maps, { mode: 'create' }))); },
    async update(id, ui, maps, version) { return fromApiCustomer(await call('PATCH', '/customers/' + encodeURIComponent(id), toApiCustomer(ui, maps, { mode: 'update', version }))); },
  };
}
