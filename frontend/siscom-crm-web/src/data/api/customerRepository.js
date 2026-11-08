// Feature-flagged customer repository (list + create + detail + update). Chooses ONE backend from the flag and never mixes them:
//   flag OFF (default)  -> `local` (caller-supplied localStorage demo ops). fetch is never touched.
//   flag ON + base URL  -> HTTP API via customerApiClient. Any failure is surfaced; there is NO fallback to `local`.
//   flag ON, no base    -> misconfigured: every call throws kind 'config' (never silently falls back to localStorage).
// Owner is never sent (server derives it from the authenticated actor). No token/cookie handling here.
import { AdapterError, LOOKUP_FIELDS } from './customerAdapter.js';
import { createCustomerApi, readApiConfig, ApiError, ApiDisabledError } from './customerApiClient.js';

export class CustomerRepoError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.name = 'CustomerRepoError'; this.kind = kind; Object.assign(this, extra); }
}

const HTTP_KIND = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict' };
const HTTP_MSG = {
  400: 'Dữ liệu gửi lên không hợp lệ.',
  401: 'Chưa đăng nhập hoặc phiên đã hết hạn. Dữ liệu không được lưu.',
  403: 'Bạn không có quyền thực hiện thao tác này. Dữ liệu không được lưu.',
  404: 'Không tìm thấy khách hàng.',
  409: 'Xung đột dữ liệu (bản ghi trùng hoặc đã bị thay đổi).',
};

function wrap(e) {
  if (e instanceof CustomerRepoError) return e;
  if (e instanceof ApiDisabledError) return new CustomerRepoError('disabled', e.message);
  if (e instanceof ApiError) {
    const kind = HTTP_KIND[e.status] || (e.status >= 500 ? 'server' : 'http');
    const base = HTTP_MSG[e.status] || 'Máy chủ từ chối yêu cầu (' + e.status + ').';
    return new CustomerRepoError(kind, e.message && e.message !== base ? base + ' ' + e.message : base, { status: e.status, code: e.code, details: e.details });
  }
  if (e instanceof AdapterError) return new CustomerRepoError('validation', e.message, { field: e.field });
  return new CustomerRepoError('unknown', 'Lỗi không xác định. Dữ liệu không được lưu.', { cause: e });
}

const malformed = (what) => new CustomerRepoError('malformed', 'Phản hồi máy chủ không hợp lệ (' + what + ').');
const blank = (v) => String(v == null ? '' : v).trim() === '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const needsLookups = (ui) => Object.keys(LOOKUP_FIELDS).some((f) => !blank(ui[f]));

// env: import.meta.env or a plain object. fetchImpl: injectable for tests. local: { list(params) -> Customer[], create(ui, ...rest) -> Customer, get(id) -> Customer, update(id, ui, ...rest) -> Customer } (sync or async).
// Detail/update address the customer by its stable backend UUID (never by display code). Update never sends code/owner/id; `version` = optimistic lock from the loaded detail.
// auth (tùy chọn): phiên đã xác minh do thành phần tin cậy cấp (getState/getAuthHeader/handleUnauthorized); chỉ chuyển nguyên vẹn xuống API client, repo không tạo/lưu/đọc token. Không có auth => hành vi cũ (không Authorization, backend trả 401).
export function createCustomerRepository({ env, fetchImpl, local, auth, session } = {}) {
  const e = env || {};
  const config = readApiConfig(e);
  const flagOn = e.VITE_CRM_API_ENABLED === 'true';

  if (!flagOn) {
    const need = () => { if (!local) throw new CustomerRepoError('config', 'Thiếu nguồn dữ liệu cục bộ (local).'); return local; };
    return {
      mode: 'local',
      async lookups() { return null; }, // demo mode: the form keeps its built-in demo choices; GET /lookups is never called
      async ownerCandidates() { return null; }, // demo mode: owner select keeps the demo list
      async list(params) { return { items: await need().list(params), source: 'local' }; },
      async create(ui, ...rest) { return need().create(ui, ...rest); },
      async get(id) { const l = need(); if (typeof l.get !== 'function') throw new CustomerRepoError('config', 'Nguồn cục bộ không hỗ trợ xem chi tiết.'); return l.get(id); },
      async update(id, ui, ...rest) { const l = need(); if (typeof l.update !== 'function') throw new CustomerRepoError('config', 'Nguồn cục bộ không hỗ trợ cập nhật.'); return l.update(id, ui, ...rest); },
      async contacts() { throw new CustomerRepoError('config', 'Chế độ demo: người liên hệ dùng dữ liệu cục bộ.'); },
      async setPrimaryContact() { throw new CustomerRepoError('config', 'Chế độ demo: người liên hệ dùng dữ liệu cục bộ.'); },
      async addContact() { throw new CustomerRepoError('config', 'Chế độ demo: người liên hệ dùng dữ liệu cục bộ.'); },
      async updateContact() { throw new CustomerRepoError('config', 'Chế độ demo: người liên hệ dùng dữ liệu cục bộ.'); },
      async deleteContact() { throw new CustomerRepoError('config', 'Chế độ demo: người liên hệ dùng dữ liệu cục bộ.'); },
      async activities() { throw new CustomerRepoError('config', 'Chế độ demo: hoạt động chỉ có ở chế độ API.'); },
      async createActivity() { throw new CustomerRepoError('config', 'Chế độ demo: hoạt động chỉ có ở chế độ API.'); },
      async assigneeCandidates() { throw new CustomerRepoError('config', 'Chế độ demo: hoạt động chỉ có ở chế độ API.'); },
      async tasks() { throw new CustomerRepoError('config', 'Chế độ demo: công việc chỉ có ở chế độ API.'); },
    };
  }

  if (!config.enabled) {
    const err = () => new CustomerRepoError('config', 'Đã bật VITE_CRM_API_ENABLED nhưng thiếu VITE_CRM_API_BASE. Không dùng dữ liệu cục bộ thay thế.');
    return { mode: 'misconfigured', async lookups() { throw err(); }, async ownerCandidates() { throw err(); }, async list() { throw err(); }, async create() { throw err(); }, async get() { throw err(); }, async update() { throw err(); }, async contacts() { throw err(); }, async setPrimaryContact() { throw err(); }, async addContact() { throw err(); }, async updateContact() { throw err(); }, async deleteContact() { throw err(); }, async activities() { throw err(); }, async createActivity() { throw err(); }, async assigneeCandidates() { throw err(); }, async tasks() { throw err(); } };
  }

  // Wrap fetch: transport failures become kind 'network', and we know whether a request was sent
  // (AdapterError after sending = malformed server payload; before sending = invalid input).
  const rawFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  let sent = false;
  const guardedFetch = async (...args) => {
    if (!rawFetch) throw new CustomerRepoError('network', 'Trình duyệt không hỗ trợ fetch.');
    sent = true;
    try { return await rawFetch(...args); }
    catch (err) { throw new CustomerRepoError('network', 'Không kết nối được máy chủ. Dữ liệu không được lưu.', { cause: err }); }
  };
  const api = createCustomerApi(config, guardedFetch, auth || session ? { auth, session } : undefined);
  const classify = (err) => {
    if (err instanceof AdapterError && sent) return malformed(err.message);
    if (err instanceof TypeError) return malformed('sai cấu trúc dữ liệu');
    return wrap(err);
  };
  const checkId = (id) => { if (typeof id !== 'string' || !UUID_RE.test(id)) throw new AdapterError('Mã định danh khách hàng (UUID) không hợp lệ.', 'id'); };
  const sameId = (c, id) => { if (c.id.toLowerCase() !== id.toLowerCase()) throw malformed('id khách hàng không khớp'); return c; };
  return {
    mode: 'api',
    // Canonical server choices for the form selects: { tier|status|industry|source|city: { options: [label], missing, toCode, toLabel } }.
    async lookups() {
      sent = false;
      try { return await api.getLookupMaps(); } catch (err) { throw classify(err); }
    },
    // PR 7: who the actor may set as owner (GET /customers/owner-candidates): { scope, items: [{ id, code, fullName, departmentCode, label }] }.
    async ownerCandidates() {
      sent = false;
      try { return await api.getOwnerCandidates(); } catch (err) { throw classify(err); }
    },
    async list(params) {
      sent = false;
      try {
        const d = await api.list(params);
        if (!d || !Array.isArray(d.items)) throw malformed('danh sách khách hàng');
        return { ...d, source: 'api' };
      } catch (err) { throw classify(err); }
    },
    async create(ui) {
      sent = false;
      try {
        if (!ui || blank(ui.name)) throw new AdapterError('Vui lòng nhập tên công ty', 'name'); // 04/11/2026: phone optional
        const maps = needsLookups(ui) ? await api.getLookupMaps() : {};
        sent = false; // lookups is a read; until POST goes out, AdapterError = invalid input (e.g. unknown label)
        return await api.create(ui, maps);
      } catch (err) { throw classify(err); }
    },
    async get(id) {
      sent = false;
      try {
        checkId(id);
        return sameId(await api.get(id), id);
      } catch (err) { throw classify(err); }
    },
    async update(id, ui, version) {
      sent = false;
      try {
        checkId(id);
        if (!ui || blank(ui.name)) throw new AdapterError('Vui lòng nhập tên công ty', 'name'); // 04/11/2026: phone optional (blank = clear)
        if (!Number.isInteger(version) || version < 1) throw new AdapterError('Thiếu version (khoá lạc quan) để cập nhật.', 'version');
        const maps = needsLookups(ui) ? await api.getLookupMaps() : {};
        sent = false;
        return sameId(await api.update(id, ui, maps, version), id);
      } catch (err) { throw classify(err); }
    },
    // B1.4 người liên hệ: danh sách liên hệ của khách (GET /customers/:id/contacts) -> mảng { id, code, fullName, isPrimary, ... }.
    async contacts(id) {
      sent = false;
      try {
        checkId(id);
        const d = await api.listContacts(id);
        if (!d || !Array.isArray(d.items)) throw malformed('danh sách người liên hệ');
        return d.items;
      } catch (err) { throw classify(err); }
    },
    // Đặt người liên hệ CHÍNH (POST isPrimary:true). Không có trường SĐT riêng: có SĐT công ty thì gửi kèm; 04/11/2026: không có số vẫn lưu được tên (không tạo số giả).
    async setPrimaryContact(id, fullName, companyPhone) {
      sent = false;
      try {
        checkId(id);
        if (blank(fullName)) throw new AdapterError('Vui lòng nhập họ tên người liên hệ', 'contactName');
        const body = { fullName: String(fullName).trim(), isPrimary: true };
        if (!blank(companyPhone)) body.phone = String(companyPhone).trim();
        const c = await api.createContact(id, body);
        if (!c || typeof c.fullName !== 'string') throw malformed('người liên hệ');
        return c;
      } catch (err) { throw classify(err); }
    },
    // FV-3: thêm / sửa / xoá mềm người liên hệ. Thân gửi đã được giao diện chuẩn hoá (chỉ trường đổi + updatedAt); máy chủ kiểm quyền theo khách.
    async addContact(id, body) {
      sent = false;
      try {
        checkId(id);
        if (!body || blank(body.fullName)) throw new AdapterError('Vui lòng nhập họ tên người liên hệ', 'fullName');
        const c = await api.createContact(id, body);
        if (!c || typeof c.id !== 'string') throw malformed('người liên hệ');
        return c;
      } catch (err) { throw classify(err); }
    },
    async updateContact(id, contactId, body) {
      sent = false;
      try {
        checkId(id); checkId(contactId);
        if (!body || typeof body.updatedAt !== 'string' || !body.updatedAt) throw new AdapterError('Thiếu mốc cập nhật của người liên hệ.', 'updatedAt');
        const c = await api.updateContact(id, contactId, body);
        if (!c || c.id !== contactId) throw malformed('người liên hệ');
        return c;
      } catch (err) { throw classify(err); }
    },
    async deleteContact(id, contactId, updatedAt) {
      sent = false;
      try {
        checkId(id); checkId(contactId);
        if (typeof updatedAt !== 'string' || !updatedAt) throw new AdapterError('Thiếu mốc cập nhật của người liên hệ.', 'updatedAt');
        return await api.deleteContact(id, contactId, { updatedAt });
      } catch (err) { throw classify(err); }
    },
    // B3 A7: dòng thời gian hoạt động của khách (GET /customers/:id/activities) -> { items, page, pageSize, total, totalPages }.
    async activities(id, params) {
      sent = false;
      try {
        checkId(id);
        const d = await api.listActivities(id, params);
        if (!d || !Array.isArray(d.items) || !Number.isInteger(d.total)) throw malformed('danh sách hoạt động');
        return d;
      } catch (err) { throw classify(err); }
    },
    // Ghi nhận hoạt động (POST). Thân do activityModel.buildCreateBody dựng; không gửi người tạo/khách trong thân.
    async createActivity(id, body) {
      sent = false;
      try {
        checkId(id);
        const a = await api.createActivity(id, body);
        if (!a || typeof a.id !== 'string' || typeof a.type !== 'string') throw malformed('hoạt động');
        return a;
      } catch (err) { throw classify(err); }
    },
    // Ứng viên phụ trách (GET /activities/assignee-candidates?customerId=) -> [{ id, code, fullName, departmentCode }].
    async assigneeCandidates(id) {
      sent = false;
      try {
        checkId(id);
        const d = await api.getAssigneeCandidates(id);
        if (!d || !Array.isArray(d.items)) throw malformed('ứng viên phụ trách');
        return d.items;
      } catch (err) { throw classify(err); }
    },
    // B3 A8: gọi API công việc A6 (path đã dựng sẵn, id đã encode). Lỗi phân loại như mọi lời gọi khác; không thử lại ngầm.
    async tasks(method, path, body) {
      sent = false;
      try { return await api.activityRequest(method, path, body); } catch (err) { throw classify(err); }
    },
    qs: api.qs,
  };
}
