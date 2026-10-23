// UI glue for the flagged customer API (list + create). Framework-free (no React, no DOM, no storage) so it can be unit-tested with an injected repository.
//   flag OFF -> createCustomerApiUi() returns null: the app keeps its original localStorage code path and NOTHING here (nor fetch) is touched.
//   flag ON  -> returns a controller over the async repository. Every failure is surfaced; nothing is ever written to localStorage and there is no fallback.
import { createCustomerRepository, CustomerRepoError } from '../../data/api/customerRepository.js';

// Backend DTO field -> UI form field (details strings from class-validator start with the property name, e.g. "phone must be ...").
const BACKEND_TO_UI = { name: 'name', phone: 'phone', shortName: 'short', taxId: 'taxId', email: 'email', website: 'website', address: 'address', note: 'note', industry: 'industry', source: 'source', province: 'city', tier: 'tier', status: 'status' };

const TITLES = {
  validation: 'Dữ liệu chưa hợp lệ', bad_request: 'Máy chủ từ chối dữ liệu', unauthenticated: 'Chưa đăng nhập', forbidden: 'Không đủ quyền',
  conflict: 'Xung đột dữ liệu', not_found: 'Không tìm thấy khách hàng', network: 'Lỗi kết nối', server: 'Lỗi máy chủ', http: 'Yêu cầu thất bại', malformed: 'Phản hồi không hợp lệ',
  config: 'Cấu hình chưa đúng', disabled: 'Chế độ API đang tắt', unknown: 'Lỗi không xác định',
};

function fieldFromDetail(d) {
  if (d && typeof d === 'object') { const k = d.field || d.property; return k ? { field: BACKEND_TO_UI[k] || null, text: Array.isArray(d.messages) ? d.messages.join('; ') : String(d.message || d.messages || k) } : { field: null, text: String(d.message || '') }; }
  const text = String(d == null ? '' : d); const first = text.split(/[\s.:[]/)[0];
  return { field: BACKEND_TO_UI[first] || null, text };
}

// Next step for the user per error kind. Unsaved form fields always stay in memory; nothing is retried automatically.
const HINTS = {
  unauthenticated: 'Không tự động thử lại. Hãy đăng nhập lại; nội dung bạn đã nhập vẫn được giữ trên biểu mẫu.',
  forbidden: 'Không tự động thử lại. Hãy liên hệ quản trị để được cấp quyền; nội dung bạn đã nhập vẫn được giữ trên biểu mẫu.',
  not_found: 'Khách hàng có thể đã bị xoá hoặc bạn không còn quyền truy cập. Nội dung bạn đã nhập vẫn được giữ; hãy quay lại danh sách để kiểm tra.',
  network: 'Kiểm tra kết nối mạng rồi bấm Lưu lại. Nội dung bạn đã nhập vẫn được giữ.',
  server: 'Máy chủ đang lỗi. Nội dung bạn đã nhập vẫn được giữ; hãy thử lại sau ít phút.',
  validation: 'Sửa các trường được đánh dấu rồi lưu lại.',
  bad_request: 'Sửa các trường được đánh dấu rồi lưu lại.',
};
export const VERSION_CONFLICT_CODE = 'CUSTOMER_VERSION_CONFLICT';

// Any thrown value -> { kind, title, message, fieldErrors: { uiField: text }, extra: [text of details we could not attach to a field], retryable }
export function describeRepoError(err) {
  const e = err instanceof CustomerRepoError ? err : new CustomerRepoError('unknown', 'Lỗi không xác định. Dữ liệu không được lưu.');
  const fieldErrors = {}; const extra = [];
  if (e.kind === 'validation' && e.field) fieldErrors[e.field] = e.message;
  if (e.kind === 'bad_request' && Array.isArray(e.details)) {
    for (const d of e.details) { const r = fieldFromDetail(d); if (r.field && !fieldErrors[r.field]) fieldErrors[r.field] = r.text; else if (r.text) extra.push(r.text); }
  }
  return { kind: e.kind, title: TITLES[e.kind] || TITLES.unknown, message: e.message, status: e.status, code: e.code, fieldErrors, extra, retryable: ['network', 'server', 'http', 'malformed'].includes(e.kind), hint: HINTS[e.kind] || '',
    staleVersion: e.kind === 'conflict' && e.code === VERSION_CONFLICT_CODE, denied: e.kind === 'unauthenticated' || e.kind === 'forbidden' };
}

// Business code shown to people. The backend UUID (`id`) is never displayed; a record without code shows a dash.
export const customerDisplayCode = (c) => (c && c.code) || '—';

// CustomerForm state -> input for repository.create. Owner and contact person are not part of the create contract (server derives owner) and are dropped.
export function formToCustomerInput(f) {
  const { cName, cTitle, cPhone, cEmail, owner, ...rest } = f || {};
  return { ...rest, name: String(rest.name || '').trim(), short: String(rest.short || '').trim(), taxId: String(rest.taxId || '').trim() };
}

// API mode only: what a lookup <Select> may show/do, from controller state `lookups` ({ status, maps }). Only server choices are ever offered (no demo list, no invented value).
//   -> { options: [label], disabled, hint, error }. An unknown non-empty current value is a controlled validation error, not silently accepted.
export function lookupFieldView(lookups, field, value) {
  const st = (lookups && lookups.status) || 'idle';
  if (st === 'idle' || st === 'loading') return { options: [], disabled: true, hint: 'Đang tải danh mục từ máy chủ…', error: '' };
  if (st === 'error') return { options: [], disabled: true, hint: 'Chưa tải được danh mục từ máy chủ.', error: '' };
  const m = lookups.maps && lookups.maps[field];
  const options = m ? m.options : [];
  const v = String(value == null ? '' : value).trim();
  if (!options.length) return { options: [], disabled: true, hint: 'Máy chủ chưa có danh mục này.', error: v ? 'Giá trị "' + v + '" không có trong danh mục máy chủ.' : '' };
  return { options, disabled: false, hint: '', error: v && !options.includes(v) ? 'Giá trị "' + v + '" không có trong danh mục máy chủ.' : '' };
}

export const LOOKUP_UI_FIELDS = ['industry', 'source', 'city', 'tier', 'status'];

// Errors for every non-empty lookup field whose label is not a server choice (or whose choices are not loaded). Empty = fine (server defaults / cleared).
export function lookupFormErrors(lookups, f) {
  const errs = {};
  for (const k of LOOKUP_UI_FIELDS) {
    if (!String((f && f[k]) == null ? '' : f[k]).trim()) continue;
    const st = (lookups && lookups.status) || 'idle';
    const v = lookupFieldView(lookups, k, f[k]);
    if (v.error) errs[k] = v.error; else if (st !== 'ready') errs[k] = 'Danh mục máy chủ chưa tải xong.';
  }
  return errs;
}

// Client-side filter over the already loaded PAGE only — never a global search (global search = server `search` param, see buildListParams). Accent/case-insensitive, all words must match.
const SEARCH_KEYS = ['name', 'short', 'code', 'taxId', 'owner', 'city', 'phone', 'email'];
const fold = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
export function searchCustomers(items, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((c) => { const hay = SEARCH_KEYS.map((k) => fold(c[k])).join(' '); return words.every((w) => hay.includes(w)); });
}

// ---- Server paging + server search (contract: GET /customers?page&pageSize&search, see backend QueryCustomersDto) ----
// page >= 1 integer; pageSize 1..100 (default 20); search is trimmed and the server rejects < 2 chars (400), so a shorter query is simply NOT sent.
// The server also rejects page * pageSize > 100000 (400); that error is surfaced as-is, never hidden. Response: { items, page, pageSize, total, totalPages }.
export const LIST_PAGE_SIZE = 20; export const LIST_PAGE_SIZE_MAX = 100; export const SEARCH_MIN_CHARS = 2;
const toInt = (v, d, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function buildListParams({ page, pageSize, search } = {}) {
  const out = { page: toInt(page, 1, 1, Number.MAX_SAFE_INTEGER), pageSize: toInt(pageSize, LIST_PAGE_SIZE, 1, LIST_PAGE_SIZE_MAX) };
  const q = String(search == null ? '' : search).trim();
  if (q.length >= SEARCH_MIN_CHARS) out.search = q.slice(0, 100);
  return out;
}
// Server list response -> paging info for the pager. A missing/invalid total is never invented: null hides the pager.
export function normalizePaging(d, requested) {
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  const total = num(d && d.total);
  if (total === null) return null;
  const page = num(d && d.page) || (requested && requested.page) || 1;
  const pageSize = num(d && d.pageSize) || (requested && requested.pageSize) || LIST_PAGE_SIZE;
  const totalPages = Math.max(1, num(d && d.totalPages) || Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages, hasPrev: page > 1, hasNext: page < totalPages, search: (requested && requested.search) || '' };
}

// Form fields a conflict can differ on: UI field -> label. Used to show the user what the server copy holds before they decide.
export const CONFLICT_FIELDS = { name: 'Tên công ty', short: 'Tên viết tắt', taxId: 'Mã số thuế', industry: 'Ngành nghề', source: 'Nguồn', address: 'Địa chỉ', city: 'Tỉnh / Thành phố', phone: 'Điện thoại', email: 'Email', website: 'Website', tier: 'Phân hạng', status: 'Trạng thái', note: 'Ghi chú' };
// Fields where the user's unsaved draft differs from the fresh server copy: [{ field, label, mine, server }].
export function diffAgainstServer(draft, server) {
  const v = (x) => String(x == null ? '' : x).trim();
  return Object.entries(CONFLICT_FIELDS).filter(([k]) => v(draft && draft[k]) !== v(server && server[k])).map(([k, label]) => ({ field: k, label, mine: v(draft && draft[k]), server: v(server && server[k]) }));
}

export function createCustomerApiController(repo) {
  const idle = { status: 'idle', items: [], error: null, paging: null, params: null };
  const noDetail = { status: 'idle', id: null, customer: null, error: null };
  const noLookups = { status: 'idle', maps: null, error: null };
  let state = { mode: repo.mode, lookups: noLookups, list: idle, submit: { status: 'idle', error: null }, detail: noDetail, update: { status: 'idle', error: null, conflict: null } };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  let seq = 0; let lseq = 0; let inflight = false; let dseq = 0; let uinflight = false; let cseq = 0;
  return {
    mode: repo.mode,
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    // Canonical GET /lookups choices for the form. Loaded once and cached; `force` (retry) refetches. Failure leaves maps null (selects stay disabled, no demo choices).
    async loadLookups(force) {
      const st = state.lookups.status;
      if (st === 'loading' || (st === 'ready' && !force)) return;
      const my = ++lseq;
      set({ lookups: { status: 'loading', maps: null, error: null } });
      try {
        const maps = await repo.lookups();
        if (my === lseq) set({ lookups: maps ? { status: 'ready', maps, error: null } : noLookups });
      } catch (e) { if (my === lseq) set({ lookups: { status: 'error', maps: null, error: describeRepoError(e) } }); }
    },
    // params = { page, pageSize, search } normalised by buildListParams. They stay in state (also on error) so retry/next/prev reuse them. Stale responses are dropped.
    async load(params) {
      const my = ++seq; const req = buildListParams(params);
      set({ list: { status: 'loading', items: [], error: null, paging: null, params: req } });
      try { const r = await repo.list(req); if (my === seq) set({ list: { status: 'ready', items: r.items, error: null, paging: normalizePaging(r, req), params: req } }); }
      catch (e) { if (my === seq) set({ list: { status: 'error', items: [], error: describeRepoError(e), paging: null, params: req } }); }
    },
    reload() { return this.load(state.list.params || undefined); },
    goToPage(page) { return this.load({ ...(state.list.params || {}), page }); },
    nextPage() { const g = state.list.paging; return g && g.hasNext ? this.goToPage(g.page + 1) : Promise.resolve(); },
    prevPage() { const g = state.list.paging; return g && g.hasPrev ? this.goToPage(g.page - 1) : Promise.resolve(); },
    // Server-side search (>= 2 chars after trim; shorter/empty = no search param). Always restarts at page 1.
    search(text) { return this.load({ pageSize: (state.list.params || {}).pageSize, search: text, page: 1 }); },
    // Duplicate submission is rejected synchronously: repo.create is called at most once while a save is in flight.
    async submit(input) {
      if (inflight) return { ok: false, duplicate: true };
      inflight = true; set({ submit: { status: 'saving', error: null } });
      try {
        const customer = await repo.create(input);
        const items = [customer, ...state.list.items.filter((c) => c.id !== customer.id)];
        set({ list: { ...state.list, items, paging: state.list.paging ? { ...state.list.paging, total: state.list.paging.total + 1 } : null, status: state.list.status === 'idle' ? 'idle' : 'ready' }, submit: { status: 'idle', error: null } });
        return { ok: true, customer };
      } catch (e) {
        const error = describeRepoError(e); set({ submit: { status: 'error', error } });
        return { ok: false, error };
      } finally { inflight = false; }
    },
    // Detail by backend UUID. Stale responses (user moved to another id) are dropped; a failed load never shows the previous customer.
    async loadDetail(id) {
      const my = ++dseq;
      ++cseq; set({ detail: { status: 'loading', id, customer: null, error: null }, update: { status: 'idle', error: null, conflict: null } });
      try { const customer = await repo.get(id); if (my === dseq) set({ detail: { status: 'ready', id, customer, error: null } }); }
      catch (e) { if (my === dseq) set({ detail: { status: 'error', id, customer: null, error: describeRepoError(e) } }); }
    },
    // Update with the optimistic-lock version of the loaded detail. Success replaces detail/list entry with the SERVER response; failure keeps old data (no fake save).
    async update(id, input, version) {
      if (uinflight) return { ok: false, duplicate: true };
      uinflight = true; ++cseq; set({ update: { status: 'saving', error: null, conflict: null } });
      try {
        const customer = await repo.update(id, input, version);
        const items = state.list.items.map((c) => (c.id === customer.id ? customer : c));
        set({ detail: state.detail.id === customer.id ? { status: 'ready', id: customer.id, customer, error: null } : state.detail, list: { ...state.list, items }, update: { status: 'idle', error: null, conflict: null } });
        return { ok: true, customer };
      } catch (e) {
        const error = describeRepoError(e); set({ update: { status: 'error', error, conflict: error.staleVersion ? { status: 'idle', server: null, error: null } : null } });
        return { ok: false, error };
      } finally { uinflight = false; }
    },
    // Stale version (409 CUSTOMER_VERSION_CONFLICT): fetch the current server copy WITHOUT touching detail/list, so the open form (unsaved draft) is not reset.
    // Nothing is written to the server here; the user then decides via acceptServerCopy (drop own edits) or keeps editing and saves on top of server.version.
    async refreshConflict(id) {
      if (!state.update.conflict || state.update.conflict.status === 'loading') return { ok: false };
      const my = ++cseq; set({ update: { ...state.update, conflict: { status: 'loading', server: null, error: null } } });
      try {
        const server = await repo.get(id);
        if (my !== cseq) return { ok: false, stale: true };
        set({ update: { ...state.update, conflict: { status: 'ready', server, error: null } } });
        return { ok: true, server };
      } catch (e) {
        if (my !== cseq) return { ok: false, stale: true };
        set({ update: { ...state.update, conflict: { status: 'error', server: null, error: describeRepoError(e) } } });
        return { ok: false };
      }
    },
    // Explicit user choice "use server copy": detail + list entry now show the server data (the form re-initialises from it, discarding the draft).
    acceptServerCopy() {
      const c = state.update.conflict; if (!c || c.status !== 'ready') return null;
      const server = c.server; ++cseq;
      set({ detail: state.detail.id === server.id ? { status: 'ready', id: server.id, customer: server, error: null } : state.detail, list: { ...state.list, items: state.list.items.map((x) => (x.id === server.id ? server : x)) }, update: { status: 'idle', error: null, conflict: null } });
      return server;
    },
    clearSubmitError() { if (state.submit.error || state.update.error) { ++cseq; set({ submit: { status: 'idle', error: null }, update: { status: 'idle', error: null, conflict: null } }); } },
  };
}

// env = import.meta.env (or a plain object in tests). Returns null when the flag is not exactly "true" (demo mode, repository not even built).
export function createCustomerApiUi({ env, fetchImpl } = {}) {
  if (!env || env.VITE_CRM_API_ENABLED !== 'true') return null;
  return createCustomerApiController(createCustomerRepository({ env, fetchImpl }));
}
