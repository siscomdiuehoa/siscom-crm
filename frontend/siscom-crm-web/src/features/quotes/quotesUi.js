// Báo giá Q7 — controller trên API /quotes (không React / DOM / bộ nhớ trình duyệt). Mẫu của opportunitiesUi.js / accountsUi.js.
// Mọi dữ liệu chỉ từ máy chủ; thao tác ghi thành công => trả lại chi tiết máy chủ gửi về (không tự sửa); lỗi => báo, không thử lại ngầm.
// Tiền / số lượng luôn là chuỗi; máy chủ tự tính mọi tổng (thân yêu cầu không có trường tổng nào).
import { toMyDefaultsBody, toSaveBody, toTemplateBody, validateDraft, validateMyDefaults, validateTemplateForm } from './quotesModel.js';

const enc = encodeURIComponent;
export const QUOTE_VERSION_CONFLICT = 'VERSION_CONFLICT';
const NOT_FOUND = { title: 'Không tìm thấy báo giá', message: 'Báo giá không tồn tại, đã bị xoá hoặc ngoài phạm vi của bạn.', hint: '' };

// repo: { quotes(method, path, body), qs(obj) }. describe: describeRepoError của lớp khách hàng. hooks.onChanged(opportunityId): sau mỗi lần ghi
// thành công (giá trị cơ hội có thể vừa được đồng bộ) — trang cơ hội đọc lại.
export function createQuotesController(repo, describe, hooks = {}) {
  let state = { busy: null, tick: 0 };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  const req = (m, p, b) => repo.quotes(m, p, b);
  const qs = (o) => (typeof repo.qs === 'function' ? repo.qs(o) : '');
  // Lỗi 400 của API báo giá: details = [{ field, code, message }] — field trùng khoá của biểu mẫu (lines[i].quantity…). Thông điệp không lặp lại giá trị.
  const err = (e) => {
    const d = describe(e);
    const base = d.kind === 'not_found' ? { ...d, ...NOT_FOUND } : d;
    const fieldErrors = {}; const extra = [];
    if (d.kind === 'bad_request' && e && Array.isArray(e.details)) {
      for (const x of e.details) {
        if (x && typeof x === 'object' && typeof x.field === 'string' && typeof x.message === 'string') { if (!fieldErrors[x.field]) fieldErrors[x.field] = x.message; } else if (typeof x === 'string') extra.push(x);
      }
    }
    return { ...base, fieldErrors, extra, stale: d.kind === 'conflict' && d.code === QUOTE_VERSION_CONFLICT };
  };
  const read = async (path) => { try { return { ok: true, data: await req('GET', path) }; } catch (e) { return { ok: false, error: err(e) }; } };
  let inflight = false;
  // Khung chung cho mọi thao tác ghi: chặn bấm trùng; thành công => tick + hook; lỗi => trả về cho hộp thoại / màn hình soạn.
  const write = async (busy, oppId, fn) => {
    if (inflight) return { ok: false, duplicate: true };
    inflight = true; set({ busy });
    try {
      const data = await fn();
      set({ tick: state.tick + 1 });
      if (typeof hooks.onChanged === 'function') { try { await hooks.onChanged(oppId); } catch (e) { /* bỏ qua */ } }
      return { ok: true, data };
    } catch (e) {
      const error = err(e);
      return { ok: false, error, fieldErrors: error.fieldErrors, stale: error.stale };
    } finally { inflight = false; set({ busy: null }); }
  };
  const oppOf = (q) => (q && q.opportunity ? q.opportunity.id : null);
  const vpath = (q, no, tail = '') => '/quotes/' + enc(q.id) + '/versions/' + enc(String(no)) + tail;

  const ctl = {
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    // ───── Đọc ─────
    // Q8a: danh sách chung (GET /quotes). query = buildQuoteListQuery(...) — chỉ gồm tham số máy chủ nhận.
    list(query) { return read('/quotes' + qs(query)); },
    byOpportunity(oppId) { return read('/opportunities/' + enc(oppId) + '/quotes'); },
    detail(id) { return read('/quotes/' + enc(id)); },
    templates() { return read('/quotes/templates'); },
    // ───── Ghi ─────
    async create(oppId, form) {
      const fieldErrors = {};
      if (!form.templateId) fieldErrors.templateId = 'Chọn loại báo giá.';
      const item = String(form.itemName || '').trim();
      if (!item) fieldErrors.itemName = 'Nhập hạng mục.'; else if (item.length > 120) fieldErrors.itemName = 'Tối đa 120 ký tự.';
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      return write('create:' + oppId, oppId, () => req('POST', '/opportunities/' + enc(oppId) + '/quotes', { templateId: form.templateId, itemName: item }));
    },
    async rename(q, itemName) {
      const item = String(itemName || '').trim();
      if (!item) return { ok: false, invalid: true, fieldErrors: { itemName: 'Nhập hạng mục.' } };
      return write('rename:' + q.id, oppOf(q), () => req('PATCH', '/quotes/' + enc(q.id), { version: q.version, itemName: item }));
    },
    // Lưu cả bản nháp. Kiểm tại chỗ trước (không gọi mạng khi còn lỗi); máy chủ kiểm lại và tính lại mọi tổng.
    async save(q, no, form) {
      const fieldErrors = validateDraft(form);
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      return write('save:' + q.id, oppOf(q), () => req('PUT', vpath(q, no), toSaveBody(form, q.version)));
    },
    newVersion(q) { return write('version:' + q.id, oppOf(q), () => req('POST', '/quotes/' + enc(q.id) + '/versions', { version: q.version })); },
    deleteVersion(q, no) { return write('delversion:' + q.id, oppOf(q), () => req('DELETE', vpath(q, no), { version: q.version })); },
    async deleteQuote(q, reason) {
      const r = String(reason || '').trim();
      if (!r) return { ok: false, invalid: true, fieldErrors: { reason: 'Xoá báo giá phải ghi lý do.' } };
      return write('delete:' + q.id, oppOf(q), () => req('DELETE', '/quotes/' + enc(q.id), { version: q.version, reason: r }));
    },
    async send(q, no, dates = {}) {
      const fieldErrors = {};
      if (!dates.quoteDate) fieldErrors.quoteDate = 'Chọn ngày báo giá.';
      if (!dates.validUntil) fieldErrors.validUntil = 'Chọn hạn hiệu lực.';
      else if (dates.quoteDate && dates.validUntil < dates.quoteDate) fieldErrors.validUntil = 'Hạn hiệu lực phải từ ngày báo giá trở đi.';
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      return write('send:' + q.id, oppOf(q), () => req('POST', vpath(q, no, '/send'), { version: q.version, quoteDate: dates.quoteDate, validUntil: dates.validUntil }));
    },
    accept(q, no) { return write('accept:' + q.id, oppOf(q), () => req('POST', vpath(q, no, '/accept'), { version: q.version })); },
    async reject(q, no, reason) {
      const r = String(reason || '').trim();
      if (!r) return { ok: false, invalid: true, fieldErrors: { reason: 'Ghi lý do khách từ chối.' } };
      return write('reject:' + q.id, oppOf(q), () => req('POST', vpath(q, no, '/reject'), { version: q.version, reason: r }));
    },
    setPrimary(q) { return write('primary:' + q.id, oppOf(q), () => req('POST', '/quotes/' + enc(q.id) + '/primary', { version: q.version })); },
    // ───── Q8b: loại báo giá (quote.template) và mặc định của chính người đang đăng nhập (quote.create) ─────
    templatesAll() { return read('/quotes/templates' + qs({ all: '1' })); }, // gồm cả loại đã ngừng dùng
    myDefaults() { return read('/quotes/my-defaults'); },
    // t = loại đang sửa (null = thêm mới). Kiểm tại chỗ trước; máy chủ kiểm lại. Sửa gửi kèm version của loại (khoá lạc quan).
    async saveTemplate(t, form) {
      const fieldErrors = validateTemplateForm(form, !t);
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      if (!t) return write('template:new', null, () => req('POST', '/quotes/templates', toTemplateBody(form, null)));
      return write('template:' + t.id, null, () => req('PATCH', '/quotes/templates/' + enc(t.id), toTemplateBody(form, t.version)));
    },
    // Bật / ngừng dùng nhanh từ danh sách: chỉ gửi isActive + version.
    setTemplateActive(t, isActive) { return write('template:' + t.id, null, () => req('PATCH', '/quotes/templates/' + enc(t.id), { version: t.version, isActive: !!isActive })); },
    async saveMyDefaults(form) {
      const fieldErrors = validateMyDefaults(form);
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      return write('my-defaults', null, () => req('PUT', '/quotes/my-defaults', toMyDefaultsBody(form)));
    },
  };
  return ctl;
}
