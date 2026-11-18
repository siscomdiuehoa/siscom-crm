// Sales S10: controller màn hình Cơ hội trên API Sales (không React/DOM/lưu trữ cục bộ). Mẫu của tasksUi.js (B3 A8).
// Mọi dữ liệu chỉ từ máy chủ; thao tác ghi thành công => đọc lại danh sách từ máy chủ (không tự sửa dòng); lỗi => báo, không thử lại ngầm.
import { buildListQuery, validateCreate, toCreateBody, serverFieldErrors, validateAction, toActionRequest, ACTION_CANDIDATES } from './opportunitiesModel.js';

const enc = encodeURIComponent;
const idle = { status: 'idle', data: null, error: null };
const idleList = { status: 'idle', query: null, items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null, refreshError: null };
export const OPP_VERSION_CONFLICT = 'OPPORTUNITY_VERSION_CONFLICT';
const NOT_FOUND = { title: 'Không tìm thấy cơ hội', message: 'Cơ hội không tồn tại, đã bị xoá hoặc ngoài phạm vi của bạn.', hint: '' };

// repo: { opportunities(method, path, body), qs(obj) }. describe: describeRepoError của lớp khách hàng (phân loại lỗi dùng chung).
export function createOpportunitiesController(repo, describe, hooks = {}) {
  let state = { meta: idle, list: idleList, busy: null };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  const req = (m, p, b) => repo.opportunities(m, p, b);
  const qs = (o) => (typeof repo.qs === 'function' ? repo.qs(o) : '');
  // Lỗi 400 theo trường của API Sales có dạng [{ field, message }] => gắn vào đúng ô của biểu mẫu Cơ hội. 404 => thông báo của cơ hội (không phải khách).
  const err = (e) => {
    const d = describe(e);
    if (d.kind === 'not_found') return { ...d, ...NOT_FOUND };
    if (d.kind !== 'bad_request') return d;
    const r = serverFieldErrors(e && e.details);
    return { ...d, fieldErrors: r.fieldErrors, extra: r.extra };
  };
  let mseq = 0; let lseq = 0; let inflight = false;

  const ctl = {
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    // Danh mục (giai đoạn, loại, lý do thua kèm id). Đã có thì không gọi lại, trừ khi force.
    async loadMeta(force) {
      if (!force && (state.meta.status === 'ready' || state.meta.status === 'loading')) return;
      const my = ++mseq; set({ meta: { ...state.meta, status: 'loading', error: null } });
      try { const data = await req('GET', '/opportunities/meta'); if (my === mseq) set({ meta: { status: 'ready', data, error: null } }); }
      catch (e) { if (my === mseq) set({ meta: { status: 'error', data: null, error: err(e) } }); }
    },
    // filters = { status, stageId, typeId, ownerId, q, closeFrom, closeTo, sortBy, sortOrder, deleted }
    async load(filters) {
      const my = ++lseq; const f = { ...(filters || {}) };
      set({ list: { ...idleList, status: 'loading', query: f } });
      try {
        const d = await req('GET', '/opportunities' + qs(buildListQuery({ ...f, page: 1 })));
        if (my === lseq) set({ list: { ...idleList, status: 'ready', query: f, items: d.items, page: d.page || 1, total: d.total, totalPages: d.totalPages } });
      } catch (e) { if (my === lseq) set({ list: { ...idleList, status: 'error', query: f, error: err(e) } }); }
    },
    // Đọc lại KHÔNG PHÁ: giữ dòng đang hiển thị tới khi có dữ liệu mới; lỗi => giữ dữ liệu cũ + refreshError để giao diện báo "có thể đã cũ".
    async reload() {
      const l = state.list; if (!l.query) return;
      if (l.status !== 'ready') { await ctl.load(l.query); return; }
      const my = ++lseq;
      try {
        const d = await req('GET', '/opportunities' + qs(buildListQuery({ ...l.query, page: 1 })));
        if (my === lseq) set({ list: { ...idleList, status: 'ready', query: l.query, items: d.items, page: d.page || 1, total: d.total, totalPages: d.totalPages } });
      } catch (e) { if (my === lseq) set({ list: { ...state.list, refreshError: err(e) } }); }
    },
    async loadMore() {
      const l = state.list; if (l.status !== 'ready' || l.more === 'loading' || l.page >= l.totalPages) return;
      const my = lseq; set({ list: { ...l, more: 'loading', moreError: null } });
      try {
        const d = await req('GET', '/opportunities' + qs(buildListQuery({ ...l.query, page: l.page + 1 })));
        if (my !== lseq) return;
        const seen = new Set(state.list.items.map((o) => o.id));
        set({ list: { ...state.list, items: state.list.items.concat(d.items.filter((o) => !seen.has(o.id))), page: d.page || l.page + 1, total: d.total, totalPages: d.totalPages, more: 'idle' } });
      } catch (e) { if (my === lseq) set({ list: { ...state.list, more: 'error', moreError: err(e) } }); }
    },
    // Tạo cơ hội từ biểu mẫu (§8.3). Kiểm tại chỗ trước (không gọi mạng khi thiếu trường); máy chủ vẫn kiểm lại đầy đủ.
    async create(form) {
      const meta = state.meta.data;
      const fieldErrors = validateCreate(form, meta);
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      if (inflight) return { ok: false, duplicate: true };
      inflight = true; set({ busy: 'create' });
      try {
        const data = await req('POST', '/opportunities', toCreateBody(form, meta));
        if (state.list.status !== 'idle') await ctl.reload();
        if (typeof hooks.onChanged === 'function') { try { await hooks.onChanged(data); } catch (e) { /* bỏ qua */ } }
        return { ok: true, data };
      } catch (e) { const error = err(e); return { ok: false, error, fieldErrors: error.fieldErrors || {} }; }
      finally { inflight = false; set({ busy: null }); }
    },
    // Thao tác trên một cơ hội đã tải (o: id, version, stage, probabilityOverridden). Kiểm tại chỗ trước; thành công => đọc lại danh sách + hook.
    // 409 (phiên bản lệch / sai trạng thái) => cũng đọc lại danh sách để người dùng thấy dữ liệu mới; lỗi được trả về cho hộp thoại.
    async act(kind, o, form) {
      const fieldErrors = validateAction(kind, form || {}, { meta: state.meta.data, o });
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      if (inflight) return { ok: false, duplicate: true };
      const r = toActionRequest(kind, form || {}, o);
      inflight = true; set({ busy: kind + ':' + o.id });
      try {
        const data = await req(r.method, '/opportunities/' + enc(o.id) + r.suffix, r.body);
        if (state.list.status !== 'idle') await ctl.reload();
        if (typeof hooks.onChanged === 'function') { try { await hooks.onChanged(data); } catch (e) { /* bỏ qua */ } }
        return { ok: true, data };
      } catch (e) {
        const error = err(e);
        if (error.kind === 'conflict' && state.list.status !== 'idle') await ctl.reload();
        return { ok: false, error, fieldErrors: error.fieldErrors || {}, stale: error.kind === 'conflict' };
      } finally { inflight = false; set({ busy: null }); }
    },
    // Người có thể nhận (S10a): kind = assign (chuyển người phụ trách) | win (bàn giao). Máy chủ lọc đúng điều kiện của thao tác ghi.
    async candidates(kind, id) {
      const path = ACTION_CANDIDATES[kind]; if (!path) return { ok: true, items: [] };
      try { const d = await req('GET', '/opportunities/' + enc(id) + '/' + path); return { ok: true, items: d.items }; } catch (e) { return { ok: false, error: err(e) }; }
    },
    // Đọc phụ (không lưu state chung): chi tiết một cơ hội.
    async get(id) { try { return { ok: true, data: await req('GET', '/opportunities/' + enc(id)) }; } catch (e) { return { ok: false, error: err(e) }; } },
  };
  return ctl;
}
