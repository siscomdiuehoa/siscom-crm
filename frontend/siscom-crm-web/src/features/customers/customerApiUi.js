// UI glue for the flagged customer API (list + create). Framework-free (no React, no DOM, no storage) so it can be unit-tested with an injected repository.
//   flag OFF -> createCustomerApiUi() returns null: the app keeps its original localStorage code path and NOTHING here (nor fetch) is touched.
//   flag ON  -> returns a controller over the async repository. Every failure is surfaced; nothing is ever written to localStorage and there is no fallback.
import { createCustomerRepository, CustomerRepoError } from '../../data/api/customerRepository.js';

// Backend DTO field -> UI form field (details strings from class-validator start with the property name, e.g. "phone must be ...").
const BACKEND_TO_UI = { name: 'name', phone: 'phone', shortName: 'short', taxId: 'taxId', email: 'email', website: 'website', address: 'address', note: 'note', industry: 'industry', source: 'source', province: 'city', tier: 'tier', status: 'status' };

const TITLES = {
  validation: 'Dữ liệu chưa hợp lệ', bad_request: 'Máy chủ từ chối dữ liệu', unauthenticated: 'Chưa đăng nhập', forbidden: 'Không đủ quyền',
  conflict: 'Xung đột dữ liệu', network: 'Lỗi kết nối', server: 'Lỗi máy chủ', http: 'Yêu cầu thất bại', malformed: 'Phản hồi không hợp lệ',
  config: 'Cấu hình chưa đúng', disabled: 'Chế độ API đang tắt', unknown: 'Lỗi không xác định',
};

function fieldFromDetail(d) {
  if (d && typeof d === 'object') { const k = d.field || d.property; return k ? { field: BACKEND_TO_UI[k] || null, text: Array.isArray(d.messages) ? d.messages.join('; ') : String(d.message || d.messages || k) } : { field: null, text: String(d.message || '') }; }
  const text = String(d == null ? '' : d); const first = text.split(/[\s.:[]/)[0];
  return { field: BACKEND_TO_UI[first] || null, text };
}

// Any thrown value -> { kind, title, message, fieldErrors: { uiField: text }, extra: [text of details we could not attach to a field], retryable }
export function describeRepoError(err) {
  const e = err instanceof CustomerRepoError ? err : new CustomerRepoError('unknown', 'Lỗi không xác định. Dữ liệu không được lưu.');
  const fieldErrors = {}; const extra = [];
  if (e.kind === 'validation' && e.field) fieldErrors[e.field] = e.message;
  if (e.kind === 'bad_request' && Array.isArray(e.details)) {
    for (const d of e.details) { const r = fieldFromDetail(d); if (r.field && !fieldErrors[r.field]) fieldErrors[r.field] = r.text; else if (r.text) extra.push(r.text); }
  }
  return { kind: e.kind, title: TITLES[e.kind] || TITLES.unknown, message: e.message, status: e.status, code: e.code, fieldErrors, extra, retryable: ['network', 'server', 'http', 'malformed'].includes(e.kind) };
}

// Business code shown to people. The backend UUID (`id`) is never displayed; a record without code shows a dash.
export const customerDisplayCode = (c) => (c && c.code) || '—';

// CustomerForm state -> input for repository.create. Owner and contact person are not part of the create contract (server derives owner) and are dropped.
export function formToCustomerInput(f) {
  const { cName, cTitle, cPhone, cEmail, owner, ...rest } = f || {};
  return { ...rest, name: String(rest.name || '').trim(), short: String(rest.short || '').trim(), taxId: String(rest.taxId || '').trim() };
}

export function createCustomerApiController(repo) {
  const idle = { status: 'idle', items: [], error: null };
  let state = { mode: repo.mode, list: idle, submit: { status: 'idle', error: null } };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  let seq = 0; let inflight = false;
  return {
    mode: repo.mode,
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    async load(params) {
      const my = ++seq;
      set({ list: { status: 'loading', items: [], error: null } });
      try { const r = await repo.list(params); if (my === seq) set({ list: { status: 'ready', items: r.items, error: null } }); }
      catch (e) { if (my === seq) set({ list: { status: 'error', items: [], error: describeRepoError(e) } }); }
    },
    // Duplicate submission is rejected synchronously: repo.create is called at most once while a save is in flight.
    async submit(input) {
      if (inflight) return { ok: false, duplicate: true };
      inflight = true; set({ submit: { status: 'saving', error: null } });
      try {
        const customer = await repo.create(input);
        const items = [customer, ...state.list.items.filter((c) => c.id !== customer.id)];
        set({ list: { ...state.list, items, status: state.list.status === 'idle' ? 'idle' : 'ready' }, submit: { status: 'idle', error: null } });
        return { ok: true, customer };
      } catch (e) {
        const error = describeRepoError(e); set({ submit: { status: 'error', error } });
        return { ok: false, error };
      } finally { inflight = false; }
    },
    clearSubmitError() { if (state.submit.error) set({ submit: { status: 'idle', error: null } }); },
  };
}

// env = import.meta.env (or a plain object in tests). Returns null when the flag is not exactly "true" (demo mode, repository not even built).
export function createCustomerApiUi({ env, fetchImpl } = {}) {
  if (!env || env.VITE_CRM_API_ENABLED !== 'true') return null;
  return createCustomerApiController(createCustomerRepository({ env, fetchImpl }));
}
