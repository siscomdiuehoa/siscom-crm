// UI glue for the flagged customer API (list + create). Framework-free (no React, no DOM, no storage) so it can be unit-tested with an injected repository.
//   flag OFF -> createCustomerApiUi() returns null: the app keeps its original localStorage code path and NOTHING here (nor fetch) is touched.
//   flag ON  -> returns a controller over the async repository. Every failure is surfaced; nothing is ever written to localStorage and there is no fallback.
import { createCustomerRepository, CustomerRepoError } from '../../data/api/customerRepository.js';
import { createActivitiesController } from '../activities/activitiesUi.js';
import { createTasksController } from '../activities/tasksUi.js';

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
const BUSY_SAVE = { kind: 'busy', title: 'Đang lưu khách hàng khác', message: 'Một thao tác lưu khác vẫn đang chạy. Chờ xong rồi bấm Lưu lại; nội dung bạn đã nhập vẫn được giữ.', fieldErrors: {}, extra: [], retryable: false, hint: '', staleVersion: false, denied: false };
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

// FV-3: lỗi ghi người liên hệ. 409 CONTACT_VERSION_CONFLICT = người khác vừa sửa/xoá; 404 CONTACT_NOT_FOUND = liên hệ không còn.
export const CONTACT_VERSION_CONFLICT_CODE = 'CONTACT_VERSION_CONFLICT';
export function contactError(e) {
  const d = describeRepoError(e);
  return { ...d, contactConflict: d.kind === 'conflict' && d.code === CONTACT_VERSION_CONFLICT_CODE, contactGone: d.kind === 'not_found' };
}

// Business code shown to people. The backend UUID (`id`) is never displayed; a record without code shows a dash.
export const customerDisplayCode = (c) => (c && c.code) || '—';

// CustomerForm state -> input for repository.create/update. Contact person (demo cName/... and API `contactName`) and the demo `owner` label are dropped:
// the contact goes through its own endpoint (submit/update second argument). PR 7: `ownerId` (employee uuid) is kept; for update, `original`
// (the loaded customer) supplies `ownerIdBefore` so the adapter sends ownerId only when it really changed.
export function formToCustomerInput(f, original) {
  const { cName, cTitle, cPhone, cEmail, owner, contactName, ...rest } = f || {};
  const out = { ...rest, name: String(rest.name || '').trim(), short: String(rest.short || '').trim(), taxId: String(rest.taxId || '').trim(), ownerId: String(rest.ownerId || '').trim() };
  if (original) out.ownerIdBefore = String(original.ownerId || '').trim();
  return out;
}

// B1.4 người liên hệ (một người / khách hàng): CHỈ người chính (isPrimary). Không có người chính => null (QA M-5: người thường không được hiển thị
// như "Người liên hệ"; nhập tên sẽ tạo người chính).
export function pickPrimaryContact(items) {
  if (!Array.isArray(items)) return null;
  return items.find((c) => c && c.isPrimary) || null;
}
// QA I-2: có tên mới nhưng chưa biết người liên hệ hiện tại của chính khách này => không gửi (tránh tạo trùng) và nói rõ là CHƯA lưu.
const CONTACT_SKIPPED = { kind: 'contact_skipped', title: 'Chưa lưu người liên hệ', message: 'Chưa tải được người liên hệ hiện tại nên tên người liên hệ chưa được lưu. Tải lại trang rồi sửa lại.', fieldErrors: {}, extra: [], retryable: false, hint: '', staleVersion: false, denied: false };
export const CONTACT_NAME_MAX = 200; // contact.full_name VARCHAR(200)
// Tên người liên hệ: không bắt buộc; chỉ kiểm độ dài (server kiểm lại).
export function contactNameError(v) {
  const t = String(v == null ? '' : v).trim();
  return t.length > CONTACT_NAME_MAX ? 'Tên người liên hệ tối đa ' + CONTACT_NAME_MAX + ' ký tự.' : '';
}
const trimmed = (v) => String(v == null ? '' : v).trim();

// API mode only: what the owner <Select> may show/do, from controller state `owners` ({ status, scope, items }).
//   -> { options: [{ value, label }], disabled, hint, allowNone }. "— Chưa phân công —" is offered only for scope ALL (OWN/DEPARTMENT cannot clear the owner).
//   A current value not in the list (e.g. owner from another department) is kept as a read-only option so an edit does not silently drop it.
export function ownerFieldView(owners, value) {
  const st = (owners && owners.status) || 'idle';
  if (st === 'idle' || st === 'loading') return { options: [], disabled: true, hint: 'Đang tải danh sách nhân viên…', allowNone: false };
  if (st === 'error') return { options: [], disabled: true, hint: 'Chưa tải được danh sách nhân viên.', allowNone: false };
  const items = (owners.items || []).map((x) => ({ value: x.id, label: x.label || x.fullName }));
  const allowNone = owners.scope === 'ALL';
  const v = String(value == null ? '' : value).trim();
  if (v && !items.some((o) => o.value === v)) items.unshift({ value: v, label: 'Người phụ trách hiện tại' });
  const options = allowNone ? [{ value: '', label: '— Chưa phân công —' }, ...items] : items;
  return { options, disabled: false, hint: '', allowNone };
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
export const EXPORT_MAX_ROWS = 5000;
// FV-4: dữ liệu xuất là dữ liệu người dùng nhập => chặn chèn công thức khi mở bằng Excel (CSV/formula injection).
// Ô bắt đầu bằng = @ TAB CR, hoặc + / - mà KHÔNG phải số điện thoại/số thuần, được thêm dấu ' phía trước.
export function csvSafe(v) {
  const s = v == null ? '' : String(v);
  if (/^[=@\t\r]/.test(s)) return "'" + s;
  if (/^[+-]/.test(s) && !/^[+-][\d\s().-]*$/.test(s)) return "'" + s;
  return s;
}
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
  const noOwners = { status: 'idle', scope: null, items: [], error: null };
  const noContact = { status: 'idle', id: null, item: null, error: null };
  let state = { mode: repo.mode, lookups: noLookups, owners: noOwners, list: idle, submit: { status: 'idle', error: null }, detail: noDetail, update: { status: 'idle', error: null, conflict: null }, contact: noContact };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  let seq = 0; let lseq = 0; let oseq = 0; let inflight = false; let dseq = 0; let uinflight = false; let uid = null; let cseq = 0; let ctseq = 0;
  // Đặt người liên hệ chính sau khi khách đã lưu. Lỗi KHÔNG làm hỏng việc lưu khách (đã xong trên server): trả về để giao diện báo riêng, không tự thử lại.
  const savePrimaryContact = async (customer, name) => {
    try {
      const item = await repo.setPrimaryContact(customer.id, trimmed(name), customer.phone);
      // QA M-6: chỉ cập nhật khi state.contact vẫn là của khách này (người dùng có thể đã mở khách khác trong lúc chờ).
      if (state.contact.id === customer.id) { ++ctseq; set({ contact: { status: 'ready', id: customer.id, item, error: null } }); }
      return undefined;
    } catch (e) { return describeRepoError(e); }
  };
  return {
    mode: repo.mode,
    queryList(params) { return repo.list(buildListParams(params)); },
    async exportList(params, matches = () => true) {
      const items = []; let page = 1; let total = 0;
      do {
        const r = await repo.list(buildListParams({ ...params, page, pageSize: LIST_PAGE_SIZE_MAX }));
        if (!Number.isInteger(r.total) || r.total < 0 || !Array.isArray(r.items)) throw new Error('Phản hồi danh sách không hợp lệ.');
        total = r.total;
        for (const item of r.items) if (matches(item)) { if (items.length === EXPORT_MAX_ROWS) return { items, truncated: true }; items.push(item); }
        if (!r.items.length && (page - 1) * LIST_PAGE_SIZE_MAX < total) throw new Error('Phản hồi danh sách không đầy đủ.');
        page += 1;
      } while ((page - 1) * LIST_PAGE_SIZE_MAX < total && page <= 1000);
      return { items, truncated: false };
    },
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    // Canonical GET /lookups choices for the form. Loaded once and cached; `force` (retry) refetches. Failure leaves maps null (selects stay disabled, no demo choices).
    async loadLookups(force) {
      const st = state.lookups.status;
      if (st === 'loading' || (st === 'ready' && !force)) return;
      if (st === 'error' && state.lookups.error && state.lookups.error.denied && !force) return; // 401/403 are never retried implicitly (e.g. by reopening the form); only the explicit reload button (force)
      const my = ++lseq;
      set({ lookups: { status: 'loading', maps: null, error: null } });
      try {
        const maps = await repo.lookups();
        if (my === lseq) set({ lookups: maps ? { status: 'ready', maps, error: null } : noLookups });
      } catch (e) { if (my === lseq) set({ lookups: { status: 'error', maps: null, error: describeRepoError(e) } }); }
    },
    // PR 7: owner candidates for the form select (GET /customers/owner-candidates). Same caching/retry rules as loadLookups; 401/403 never retried implicitly.
    async loadOwners(force) {
      const st = state.owners.status;
      if (st === 'loading' || (st === 'ready' && !force)) return;
      if (st === 'error' && state.owners.error && state.owners.error.denied && !force) return;
      const my = ++oseq;
      set({ owners: { status: 'loading', scope: null, items: [], error: null } });
      try {
        const r = typeof repo.ownerCandidates === 'function' ? await repo.ownerCandidates() : null;
        if (my === oseq) set({ owners: r ? { status: 'ready', scope: r.scope, items: r.items, error: null } : noOwners });
      } catch (e) { if (my === oseq) set({ owners: { status: 'error', scope: null, items: [], error: describeRepoError(e) } }); }
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
    // Success never patches the visible page by hand (a new row may belong to another page/search; total/totalPages are the server's to state):
    // the list is re-read from the server with the CURRENT params. That reload supersedes older in-flight list requests (seq), and its failure
    // is shown by the list state (retry), never turned into a failed create. List not loaded yet (idle) -> nothing to refresh.
    // contactName (tùy chọn, B1.4): sau khi tạo khách, đặt người liên hệ chính mang SĐT công ty. Lỗi => { ok: true, contactError } (khách vẫn đã lưu).
    async submit(input, contactName) {
      if (inflight) return { ok: false, duplicate: true };
      inflight = true; set({ submit: { status: 'saving', error: null } });
      let customer; let contactError;
      try {
        try { customer = await repo.create(input); }
        catch (e) {
          const error = describeRepoError(e); set({ submit: { status: 'error', error } });
          return { ok: false, error };
        }
        if (trimmed(contactName)) contactError = await savePrimaryContact(customer, contactName);
      } finally { inflight = false; }
      set({ submit: { status: 'idle', error: null } });
      if (state.list.status !== 'idle') await this.reload();
      return contactError ? { ok: true, customer, contactError } : { ok: true, customer };
    },
    // B1.4: người liên hệ của khách (GET /customers/:id/contacts) -> state.contact { status, id, item (người chính hoặc null), error }. Phản hồi cũ của id khác bị bỏ.
    async loadContact(id) {
      const my = ++ctseq;
      set({ contact: { status: 'loading', id, item: null, error: null } });
      try { const items = await repo.contacts(id); if (my === ctseq) set({ contact: { status: 'ready', id, item: pickPrimaryContact(items), error: null } }); }
      catch (e) { if (my === ctseq) set({ contact: { status: 'error', id, item: null, error: describeRepoError(e) } }); }
    },
    // FV-3: thêm / sửa / xoá mềm người liên hệ -> { ok, contact } | { ok:false, error } (error = describeRepoError; 409 CONTACT_VERSION_CONFLICT => error.contactConflict).
    // Thành công: nếu ô "Người liên hệ" (người chính) của khách này đang hiển thị thì đọc lại. Danh sách ở tab do giao diện tự đọc lại.
    async saveContact(customerId, contactId, body) {
      try {
        const contact = contactId ? await repo.updateContact(customerId, contactId, body) : await repo.addContact(customerId, body);
        if (state.contact.id === customerId) await this.loadContact(customerId);
        return { ok: true, contact };
      } catch (e) { return { ok: false, error: contactError(e) }; }
    },
    async deleteContact(customerId, contactId, updatedAt) {
      try {
        await repo.deleteContact(customerId, contactId, updatedAt);
        if (state.contact.id === customerId) await this.loadContact(customerId);
        return { ok: true };
      } catch (e) { return { ok: false, error: contactError(e) }; }
    },
    // Detail by backend UUID. Stale responses (user moved to another id) are dropped; a failed load never shows the previous customer.
    async loadDetail(id) {
      const my = ++dseq;
      ++cseq; set({ detail: { status: 'loading', id, customer: null, error: null }, update: { status: 'idle', error: null, conflict: null } });
      try { const customer = await repo.get(id); if (my === dseq) set({ detail: { status: 'ready', id, customer, error: null } }); }
      catch (e) {
        if (my !== dseq) return;
        const error = describeRepoError(e); set({ detail: { status: 'error', id, customer: null, error } });
        // Record gone on the server: a loaded list may still hold its row. Re-read the list (server-authoritative); never delete the row by hand.
        if (error.kind === 'not_found' && state.list.status !== 'idle') await this.reload();
      }
    },
    // Update with the optimistic-lock version of the loaded detail. Success replaces detail/list entry with the SERVER response; failure keeps old data (no fake save).
    // contactName (tùy chọn, B1.4): chỉ khi đã tải được người liên hệ hiện tại của CHÍNH khách này và tên thực sự đổi (bỏ khoảng trắng) mới đặt người chính mới;
    // để trống = giữ nguyên (API chưa có xoá/sửa liên hệ). Lỗi => { ok: true, contactError }.
    async update(id, input, version, contactName) {
      // Same customer: silent duplicate. Another customer's save still running: say so (the form shows it) instead of swallowing the click.
      if (uinflight) return uid === id ? { ok: false, duplicate: true } : { ok: false, error: BUSY_SAVE };
      // `mine` = this save still owns the update state; opening another id / refreshing a conflict bumps cseq, so a late outcome of an older id never lands on the new one.
      const mine = ++cseq; uinflight = true; uid = id; set({ update: { status: 'saving', error: null, conflict: null } });
      const ct = state.contact; const want = trimmed(contactName); // QA I-2: chụp TRƯỚC khi PATCH (người liên hệ người dùng đã thấy khi bấm Lưu)
      try {
        const customer = await repo.update(id, input, version);
        const items = state.list.items.map((c) => (c.id === customer.id ? customer : c));
        set({ detail: state.detail.id === customer.id ? { status: 'ready', id: customer.id, customer, error: null } : state.detail, list: { ...state.list, items }, ...(mine === cseq ? { update: { status: 'idle', error: null, conflict: null } } : {}) });
        // A list read still in flight may have been taken before this write: re-read so the row never goes back to the old version.
        if (state.list.status === 'loading') this.reload();
        if (want && !(ct.id === id && ct.status === 'ready')) return { ok: true, customer, contactError: CONTACT_SKIPPED };
        if (want && want !== trimmed(ct.item && ct.item.fullName)) {
          const contactError = await savePrimaryContact(customer, want);
          if (contactError) return { ok: true, customer, contactError };
        }
        return { ok: true, customer };
      } catch (e) {
        const error = describeRepoError(e);
        if (mine === cseq) set({ update: { status: 'error', error, conflict: error.staleVersion ? { status: 'idle', server: null, error: null } : null } });
        if (error.kind === 'not_found' && state.list.status !== 'idle') await this.reload();
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
// auth (tùy chọn): phiên đã xác minh do thành phần tin cậy cấp; chỉ chuyển tiếp xuống repository.
// session (tùy chọn): phiên cookie (createCookieSession); chỉ chuyển tiếp xuống repository.
export function createCustomerApiUi({ env, fetchImpl, auth, session } = {}) {
  if (!env || env.VITE_CRM_API_ENABLED !== 'true') return null;
  const repo = createCustomerRepository({ env, fetchImpl, auth, session });
  const ctl = createCustomerApiController(repo);
  // B3 A8: công việc (API A6). Ghi ở một nơi => nơi kia đọc lại từ máy chủ (dòng thời gian khách <-> danh sách việc + chuông).
  ctl.tasks = createTasksController(repo, describeRepoError, { onChanged: (cid) => { const l = ctl.activities.getState().list; return l.customerId && (!cid || l.customerId === cid) ? ctl.activities.reload() : undefined; } });
  ctl.activities = createActivitiesController(repo, describeRepoError, { onCreated: () => (ctl.tasks.getState().summary.status !== 'idle' ? ctl.tasks.refreshAll() : undefined) }); // B3 A7: tab Hoạt động dùng chung repository/phiên
  return ctl;
}
