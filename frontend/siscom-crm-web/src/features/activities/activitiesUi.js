// B3 A7: controller tab Hoạt động (không React/DOM/lưu trữ cục bộ) trên repository API. Mọi lỗi được báo ra; không thử lại ngầm, không dữ liệu giả.
// describe = describeRepoError (truyền vào để tránh import vòng với customerApiUi.js).
import { detailsToFieldErrors } from './activityModel.js';

export const PAGE_SIZE = 20;
const idleList = { status: 'idle', customerId: null, filters: {}, items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null };
const idleRef = { status: 'idle', customerId: null, items: [], error: null };
const clean = (f) => { const o = {}; for (const k of ['type', 'status', 'from', 'to']) if (f && f[k]) o[k] = f[k]; return o; };

export function createActivitiesController(repo, describe) {
  let state = { list: idleList, submit: { status: 'idle', error: null }, assignees: idleRef, contacts: idleRef };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  let seq = 0; let aseq = 0; let cseq = 0; let inflight = false;
  // Lỗi 400 của hoạt động: gắn chi tiết theo ô của biểu mẫu hoạt động (không dùng bảng trường của khách hàng).
  const err = (e) => { const d = describe(e); if (d.kind !== 'bad_request') return d; const r = detailsToFieldErrors(e && e.details); return { ...d, fieldErrors: r.fieldErrors, extra: r.extra }; };

  const ctl = {
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    // Trang 1 với bộ lọc mới. Phản hồi cũ (khách khác/bộ lọc khác) bị bỏ; lỗi không hiện dữ liệu cũ.
    async load(customerId, filters) {
      const my = ++seq; const f = clean(filters);
      set({ list: { ...idleList, status: 'loading', customerId, filters: f } });
      try {
        const d = await repo.activities(customerId, { ...f, page: 1, pageSize: PAGE_SIZE });
        if (my === seq) set({ list: { ...idleList, status: 'ready', customerId, filters: f, items: d.items, page: d.page || 1, total: d.total, totalPages: d.totalPages } });
      } catch (e) { if (my === seq) set({ list: { ...idleList, status: 'error', customerId, filters: f, error: err(e) } }); }
    },
    reload() { const l = state.list; return l.customerId ? ctl.load(l.customerId, l.filters) : Promise.resolve(); },
    // "Tải thêm": nối trang kế tiếp; lỗi chỉ hiện ở nút (danh sách đã tải giữ nguyên). Bỏ trùng id nếu dữ liệu dịch trang.
    async loadMore() {
      const l = state.list;
      if (l.status !== 'ready' || l.more === 'loading' || l.page >= l.totalPages) return;
      const my = seq; set({ list: { ...l, more: 'loading', moreError: null } });
      try {
        const d = await repo.activities(l.customerId, { ...l.filters, page: l.page + 1, pageSize: PAGE_SIZE });
        if (my !== seq) return;
        const seen = new Set(state.list.items.map((a) => a.id));
        set({ list: { ...state.list, items: state.list.items.concat(d.items.filter((a) => !seen.has(a.id))), page: d.page || l.page + 1, total: d.total, totalPages: d.totalPages, more: 'idle' } });
      } catch (e) { if (my === seq) set({ list: { ...state.list, more: 'error', moreError: err(e) } }); }
    },
    // Ghi nhận: chặn bấm trùng; thành công => đọc lại trang 1 từ máy chủ (không tự chèn dòng); lỗi => giữ biểu mẫu.
    async create(customerId, body) {
      if (inflight) return { ok: false, duplicate: true };
      inflight = true; set({ submit: { status: 'saving', error: null } });
      try {
        const activity = await repo.createActivity(customerId, body);
        set({ submit: { status: 'idle', error: null } });
        if (state.list.customerId === customerId) await ctl.reload();
        return { ok: true, activity };
      } catch (e) {
        const error = err(e); set({ submit: { status: 'error', error } });
        return { ok: false, error };
      } finally { inflight = false; }
    },
    clearSubmitError() { if (state.submit.status !== 'saving') set({ submit: { status: 'idle', error: null } }); },
    // Ứng viên phụ trách (chỉ gọi khi giao diện có activity.assign). Lỗi được báo ở ô chọn, không chặn ghi nhận cho chính mình.
    async loadAssignees(customerId) {
      const my = ++aseq; set({ assignees: { status: 'loading', customerId, items: [], error: null } });
      try { const items = await repo.assigneeCandidates(customerId); if (my === aseq) set({ assignees: { status: 'ready', customerId, items, error: null } }); }
      catch (e) { if (my === aseq) set({ assignees: { status: 'error', customerId, items: [], error: err(e) } }); }
    },
    // Người liên hệ của khách (chỉ khi có contact.read) cho ô chọn và tab Người liên hệ.
    async loadContacts(customerId) {
      const my = ++cseq; set({ contacts: { status: 'loading', customerId, items: [], error: null } });
      try { const items = await repo.contacts(customerId); if (my === cseq) set({ contacts: { status: 'ready', customerId, items, error: null } }); }
      catch (e) { if (my === cseq) set({ contacts: { status: 'error', customerId, items: [], error: err(e) } }); }
    },
  };
  return ctl;
}
