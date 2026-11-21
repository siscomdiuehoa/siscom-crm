// Sales S10: controller màn hình Cơ hội trên API Sales (không React/DOM/lưu trữ cục bộ). Mẫu của tasksUi.js (B3 A8).
// Mọi dữ liệu chỉ từ máy chủ; thao tác ghi thành công => đọc lại danh sách từ máy chủ (không tự sửa dòng); lỗi => báo, không thử lại ngầm.
import {
  buildListQuery, validateCreate, toCreateBody, serverFieldErrors, validateAction, toActionRequest, ACTION_CANDIDATES,
  validateEdit, toPatchBody, validateDocument, toDocumentBody, validateReason, BOARD_PAGE_SIZE,
  OPP_CUSTOMER_NO_OWNER, CUSTOMER_NO_OWNER_TITLE, CUSTOMER_NO_OWNER_MESSAGE,
} from './opportunitiesModel.js';
import { validateDraft, buildCreateBody, detailsToFieldErrors } from '../activities/activityModel.js';

const enc = encodeURIComponent;
const idle = { status: 'idle', data: null, error: null };
const idleList = { status: 'idle', query: null, items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null, refreshError: null };
export const OPP_VERSION_CONFLICT = 'OPPORTUNITY_VERSION_CONFLICT';
const NOT_FOUND = { title: 'Không tìm thấy cơ hội', message: 'Cơ hội không tồn tại, đã bị xoá hoặc ngoài phạm vi của bạn.', hint: '' };

// repo: { opportunities(method, path, body), qs(obj) }. describe: describeRepoError của lớp khách hàng (phân loại lỗi dùng chung).
export function createOpportunitiesController(repo, describe, hooks = {}) {
  let state = { meta: idle, list: idleList, busy: null, activityTick: 0 };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  const req = (m, p, b) => repo.opportunities(m, p, b);
  const qs = (o) => (typeof repo.qs === 'function' ? repo.qs(o) : '');
  // Lỗi 400 theo trường của API Sales có dạng [{ field, message }] => gắn vào đúng ô của biểu mẫu Cơ hội. 404 => thông báo của cơ hội (không phải khách).
  const err = (e) => {
    const d = describe(e);
    if (d.kind === 'not_found') return { ...d, ...NOT_FOUND };
    // T-08: 409 vì khách chưa có người phụ trách là quy tắc nghiệp vụ, không phải "bản ghi trùng" => câu rõ ràng, bỏ tiền tố xung đột chung.
    if (d.kind === 'conflict' && d.code === OPP_CUSTOMER_NO_OWNER) return { ...d, title: CUSTOMER_NO_OWNER_TITLE, message: CUSTOMER_NO_OWNER_MESSAGE, hint: '' };
    if (d.kind !== 'bad_request') return d;
    const r = serverFieldErrors(e && e.details);
    return { ...d, fieldErrors: r.fieldErrors, extra: r.extra };
  };
  let mseq = 0; let lseq = 0; let inflight = false;
  // muted: trong lúc chạy hook của một thao tác KHÔNG làm đổi hoạt động của cơ hội đang mở (sửa trường, khôi phục, xoá — sắp rời trang), hoặc thao tác
  // tự báo tab đúng một lần (ghi nhận hoạt động), lời gọi touchActivities() đến qua hook chuông công việc bị bỏ qua để không đọc lại thừa.
  let muted = false;
  const runHook = async (data, mute) => {
    if (typeof hooks.onChanged !== 'function') return;
    if (mute) muted = true;
    try { await hooks.onChanged(data); } catch (e) { /* bỏ qua */ } finally { if (mute) muted = false; }
  };
  // Lỗi 400 của API Hoạt động: chi tiết là chuỗi => gắn theo ô của biểu mẫu hoạt động.
  const errActivity = (e) => { const d = describe(e); if (d.kind === 'not_found') return { ...d, ...NOT_FOUND }; if (d.kind !== 'bad_request') return d; const r = detailsToFieldErrors(e && e.details); return { ...d, fieldErrors: r.fieldErrors, extra: r.extra }; };
  const read = async (path, describeErr = err) => { try { return { ok: true, data: await req('GET', path) }; } catch (e) { return { ok: false, error: describeErr(e) }; } };
  // Khung chung cho thao tác ghi của S10c: chặn bấm trùng; thành công => đọc lại danh sách (nếu đã tải) + hook; 409 => cũng đọc lại danh sách.
  const write = async (busy, fn, opt = {}) => {
    if (inflight) return { ok: false, duplicate: true };
    inflight = true; set({ busy });
    try {
      const data = await fn();
      if (opt.list !== false && state.list.status !== 'idle') await ctl.reload();
      if (opt.hook !== false) await runHook(data, opt.mute === true);
      return { ok: true, data };
    } catch (e) {
      const error = (opt.err || err)(e);
      if (error.kind === 'conflict' && opt.list !== false && state.list.status !== 'idle') await ctl.reload();
      return { ok: false, error, fieldErrors: error.fieldErrors || {}, stale: error.kind === 'conflict' };
    } finally { inflight = false; set({ busy: null }); }
  };

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
        await runHook(data, kind === 'delete'); // xoá: trang chi tiết sắp đóng => không đọc lại tab hoạt động của cơ hội vừa xoá
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

    // ───── S10c ─────
    // Sửa trường (PATCH): chỉ gửi trường thực sự đổi + version đã tải. Không đổi gì => không gọi mạng.
    async update(o, form) {
      const meta = state.meta.data;
      const fieldErrors = validateEdit(form, meta, o);
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      const body = toPatchBody(o, form, meta);
      if (!Object.keys(body).length) return { ok: true, unchanged: true, data: o };
      return write('edit:' + o.id, () => req('PATCH', '/opportunities/' + enc(o.id), { version: o.version, ...body }), { mute: true });
    },
    // Khôi phục cơ hội đã xoá mềm (dòng lấy từ danh sách deleted=only).
    restore(o) { return write('restore:' + o.id, () => req('POST', '/opportunities/' + enc(o.id) + '/restore', { version: o.version }), { mute: true }); },
    // Người liên hệ của khách (cho ô chọn ở biểu mẫu Sửa) — chỉ gọi khi giao diện có contact.read và đọc được khách.
    async contacts(customerId) { try { return { ok: true, items: await repo.contacts(customerId) }; } catch (e) { return { ok: false, error: describe(e) }; } },
    // Hoạt động THEO CƠ HỘI (§5.5): máy chủ lọc theo đường truy cập. f = { type, status }.
    activities(id, f = {}, page = 1) {
      const q = { page, pageSize: 20 }; if (f.type) q.type = f.type; if (f.status) q.status = f.status;
      return read('/opportunities/' + enc(id) + '/activities' + qs(q), errActivity);
    },
    // Ghi nhận hoạt động gắn với cơ hội (người thực hiện = người ghi nhận). Kiểm tại chỗ như biểu mẫu Hoạt động; máy chủ kiểm lại.
    async createActivity(id, draft) {
      const fieldErrors = validateDraft(draft);
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      const r = await write('activity:' + id, () => req('POST', '/opportunities/' + enc(id) + '/activities', buildCreateBody(draft)), { list: false, err: errActivity, mute: true });
      if (r.ok) ctl.touchActivities();
      return r;
    },
    // Báo cho tab "Hoạt động & công việc" đang mở đọc lại (sau ghi nhận, hoặc sau thao tác trên công việc ở màn hình Công việc).
    touchActivities() { if (!muted) set({ activityTick: state.activityTick + 1 }); },
    changes(id) { return read('/opportunities/' + enc(id) + '/changes'); },
    // ───── S11 ─────
    // Một cột kanban: cơ hội ĐANG MỞ của một giai đoạn (Tạm hoãn / đã đóng nằm ngoài kanban), tối đa 100 thẻ mỗi lần. f = { typeId, q }.
    board(stageId, f = {}, page = 1) { return read('/opportunities' + qs(buildListQuery({ status: 'OPEN', stageId, typeId: f.typeId, q: f.q, page, pageSize: BOARD_PAGE_SIZE, sortBy: 'updatedAt', sortOrder: 'desc' }))); },
    // Cơ hội của MỘT khách (tab "Cơ hội" ở chi tiết khách). 404 ở đây là của khách hàng => giữ nguyên thông báo của lớp khách hàng.
    async byCustomer(customerId, page = 1) {
      try { return { ok: true, data: await req('GET', '/customers/' + enc(customerId) + '/opportunities' + qs(buildListQuery({ page }))) }; } catch (e) { return { ok: false, error: describe(e) }; }
    },
    documents(id) { return read('/opportunities/' + enc(id) + '/documents'); },
    async addDocument(id, form) {
      const fieldErrors = validateDocument(form);
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      return write('doc:' + id, () => req('POST', '/opportunities/' + enc(id) + '/documents', toDocumentBody(form)), { list: false, hook: false });
    },
    async removeDocument(id, docId, reason) {
      const fieldErrors = validateReason(reason, 'Xoá tài liệu phải ghi lý do');
      if (Object.keys(fieldErrors).length) return { ok: false, invalid: true, fieldErrors };
      return write('doc:' + id, () => req('DELETE', '/opportunities/' + enc(id) + '/documents/' + enc(docId), { reason: String(reason).trim() }), { list: false, hook: false });
    },
  };
  return ctl;
}
