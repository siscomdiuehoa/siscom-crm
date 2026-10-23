// Feature-flagged HTTP boundary for the Customers API. OFF by default. NOT wired into the UI (the app still uses localStorage).
// No credentials of any kind: no token, no cookie (credentials:'omit'), no login. Backend 401 is surfaced as ApiError and never bypassed.
import { fromApiCustomer, toApiCustomer, buildLookupMaps } from './customerAdapter.js';

export class ApiDisabledError extends Error { constructor() { super('Chế độ API đang TẮT (VITE_CRM_API_ENABLED khác "true" hoặc thiếu VITE_CRM_API_BASE).'); this.name = 'ApiDisabledError'; } }
export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details; }
}

// env = import.meta.env (or a plain object in tests). Enabled only when the flag is exactly "true" AND a base URL is set.
export function readApiConfig(env) {
  const e = env || {};
  const baseUrl = String(e.VITE_CRM_API_BASE || '').trim().replace(/\/+$/, '');
  return { enabled: e.VITE_CRM_API_ENABLED === 'true' && !!baseUrl, baseUrl };
}

export function createCustomerApi(config, fetchImpl) {
  const cfg = config || { enabled: false, baseUrl: '' };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  async function call(method, path, body) {
    if (!cfg.enabled) throw new ApiDisabledError();
    if (!doFetch) throw new Error('fetch không khả dụng.');
    const res = await doFetch(cfg.baseUrl + path, {
      method, credentials: 'omit', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body */ }
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
    async list(params) { const d = await call('GET', '/customers' + qs(params)); return { ...d, items: d.items.map(fromApiCustomer) }; },
    async get(id) { return fromApiCustomer(await call('GET', '/customers/' + encodeURIComponent(id))); },
    async create(ui, maps) { return fromApiCustomer(await call('POST', '/customers', toApiCustomer(ui, maps, { mode: 'create' }))); },
    async update(id, ui, maps, version) { return fromApiCustomer(await call('PATCH', '/customers/' + encodeURIComponent(id), toApiCustomer(ui, maps, { mode: 'update', version }))); },
  };
}
