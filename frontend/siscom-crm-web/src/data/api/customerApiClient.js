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
  // opts.raw (FV-4A): phản hồi thành công là FILE (text/csv) => trả Blob nguyên byte (Response.text() sẽ bỏ BOM UTF-8) kèm header X-Export-*.
  async function call(method, path, body, opts) {
    const raw = !!(opts && opts.raw);
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
    let json = null; let blob = null;
    if (raw && res.ok) blob = await res.blob();
    else { try { json = await res.json(); } catch (e) { /* non-JSON body */ } }
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
      const e = new ApiError(res.status, er.code || 'REQUEST_FAILED', er.message || (json && json.message) || 'Yêu cầu thất bại (' + res.status + ').', er.details);
      const ra = Number(header(res, 'Retry-After'));
      if (Number.isFinite(ra) && ra > 0) e.retryAfter = ra;
      throw e;
    }
    if (raw) return { blob, rows: Number(header(res, 'X-Export-Rows')), skipped: Number(header(res, 'X-Export-Skipped') || 0), exportId: header(res, 'X-Export-Id'), disposition: header(res, 'Content-Disposition') };
    return json ? json.data : null;
  }
  function header(res, name) { try { return res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null; } catch (e) { return null; } }
  const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const t = p.toString(); return t ? '?' + t : ''; };
  return {
    enabled: cfg.enabled,
    async getLookupMaps() { return buildLookupMaps(await call('GET', '/lookups' + qs({ type: 'customer_tier,customer_status,industry,source,province' }))); },
    async getOwnerCandidates() { return normalizeOwnerCandidates(await call('GET', '/customers/owner-candidates')); },
    async list(params) { const d = await call('GET', '/customers' + qs(params)); return { ...d, items: d.items.map(fromApiCustomer) }; },
    async get(id) { return fromApiCustomer(await call('GET', '/customers/' + encodeURIComponent(id))); },
    // FV-4A: máy chủ kiểm quyền customer.export + phạm vi, tạo CSV và ghi nhật ký. Body: { mode, search?, ids?, tier?, status?, industry?, source?, province? }.
    async exportCustomers(body) { return await call('POST', '/customers/export', body, { raw: true }); },
    async create(ui, maps) { return fromApiCustomer(await call('POST', '/customers', toApiCustomer(ui, maps, { mode: 'create' }))); },
    async update(id, ui, maps, version) { return fromApiCustomer(await call('PATCH', '/customers/' + encodeURIComponent(id), toApiCustomer(ui, maps, { mode: 'update', version }))); },
    // B1.4 người liên hệ: API Contact có sẵn (GET/POST /customers/:id/contacts). Server sắp người chính lên đầu; POST isPrimary gỡ cờ người chính cũ.
    async listContacts(id) { return await call('GET', '/customers/' + encodeURIComponent(id) + '/contacts'); },
    async createContact(id, body) { return await call('POST', '/customers/' + encodeURIComponent(id) + '/contacts', body); },
    // FV-3: sửa / xoá mềm (quyền customer.update trên khách — máy chủ kiểm); body luôn kèm updatedAt đã tải (khoá lạc quan).
    async updateContact(id, contactId, body) { return await call('PATCH', '/customers/' + encodeURIComponent(id) + '/contacts/' + encodeURIComponent(contactId), body); },
    async deleteContact(id, contactId, body) { return await call('DELETE', '/customers/' + encodeURIComponent(id) + '/contacts/' + encodeURIComponent(contactId), body); },
    // B3 A7 hoạt động (API A5): dòng thời gian theo khách, ghi nhận hoạt động, ứng viên phụ trách. Người tạo/khách do máy chủ xác định.
    async listActivities(id, params) { return await call('GET', '/customers/' + encodeURIComponent(id) + '/activities' + qs(params)); },
    async createActivity(id, body) { return await call('POST', '/customers/' + encodeURIComponent(id) + '/activities', body); },
    async getAssigneeCandidates(id) { return await call('GET', '/activities/assignee-candidates' + qs({ customerId: id })); },
    // B3 A8 công việc (API A6): MỘT cổng cho các đường dẫn /activities… và /activity-transfer-requests…; đường dẫn khác bị từ chối trước khi gọi mạng.
    async activityRequest(method, path, body) {
      if (!/^\/(activities|activity-transfer-requests)(\/|\?|$)/.test(String(path)) || /\.\.|\/\//.test(String(path))) throw new Error('Đường dẫn API công việc không hợp lệ.');
      return await call(method, path, body);
    },
    qs,
  };
}
