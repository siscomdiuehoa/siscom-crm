// B3 A8: controller trang Công việc + chuông + thao tác việc trên API A6 (không React/DOM/lưu trữ cục bộ).
// Mọi thao tác ghi gửi `version` đã tải (khoá lạc quan); thành công => đọc lại từ máy chủ (không tự sửa dòng); lỗi => báo, không thử lại ngầm.
import { detailsToFieldErrors } from './activityModel.js';
import { buildTasksQuery } from './tasksModel.js';

const enc = encodeURIComponent;
const idleList = { status: 'idle', query: null, items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null };
const idle = { status: 'idle', data: null, error: null };
export const VERSION_CONFLICT = 'ACTIVITY_VERSION_CONFLICT';

export function createTasksController(repo, describe, hooks = {}) {
  let state = { summary: idle, list: idleList, transfers: { status: 'idle', inbox: [], outbox: [], error: null }, busy: null };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  const req = (m, p, b) => repo.tasks(m, p, b);
  const qs = (o) => (typeof repo.qs === 'function' ? repo.qs(o) : '');
  const err = (e) => { const d = describe(e); if (d.kind !== 'bad_request') return d; const r = detailsToFieldErrors(e && e.details); return { ...d, fieldErrors: r.fieldErrors, extra: r.extra }; };
  let lseq = 0; let sseq = 0; let tseq = 0; let inflight = false;

  const ctl = {
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    async loadSummary() {
      const my = ++sseq; if (state.summary.status !== 'ready') set({ summary: { ...state.summary, status: 'loading' } });
      try { const data = await req('GET', '/activities/reminders/summary'); if (my === sseq) set({ summary: { status: 'ready', data, error: null } }); }
      catch (e) { if (my === sseq) set({ summary: { status: 'error', data: state.summary.data, error: err(e) } }); }
    },
    // filters = { tab, due, status, type }
    async load(filters) {
      const my = ++lseq; const query = buildTasksQuery({ ...filters, page: 1 });
      set({ list: { ...idleList, status: 'loading', query: { ...filters } } });
      try {
        const d = await req('GET', '/activities' + qs(query));
        if (my === lseq) set({ list: { ...idleList, status: 'ready', query: { ...filters }, items: d.items, page: d.page || 1, total: d.total, totalPages: d.totalPages } });
      } catch (e) { if (my === lseq) set({ list: { ...idleList, status: 'error', query: { ...filters }, error: err(e) } }); }
    },
    reload() { return state.list.query ? ctl.load(state.list.query) : Promise.resolve(); },
    async loadMore() {
      const l = state.list; if (l.status !== 'ready' || l.more === 'loading' || l.page >= l.totalPages) return;
      const my = lseq; set({ list: { ...l, more: 'loading', moreError: null } });
      try {
        const d = await req('GET', '/activities' + qs(buildTasksQuery({ ...l.query, page: l.page + 1 })));
        if (my !== lseq) return;
        const seen = new Set(state.list.items.map((a) => a.id));
        set({ list: { ...state.list, items: state.list.items.concat(d.items.filter((a) => !seen.has(a.id))), page: d.page || l.page + 1, total: d.total, totalPages: d.totalPages, more: 'idle' } });
      } catch (e) { if (my === lseq) set({ list: { ...state.list, more: 'error', moreError: err(e) } }); }
    },
    async loadTransfers() {
      const my = ++tseq; set({ transfers: { ...state.transfers, status: 'loading' } });
      try {
        const [inbox, outbox] = await Promise.all([req('GET', '/activity-transfer-requests?box=inbox'), req('GET', '/activity-transfer-requests?box=outbox')]);
        if (my === tseq) set({ transfers: { status: 'ready', inbox: inbox.items, outbox: outbox.items, error: null } });
      } catch (e) { if (my === tseq) set({ transfers: { status: 'error', inbox: [], outbox: [], error: err(e) } }); }
    },
    // Sau mọi ghi: chuông + danh sách + hộp đề xuất (nếu đã tải) + dòng thời gian khách (hook) đọc lại từ máy chủ.
    async refreshAll(customerId) {
      const jobs = [ctl.loadSummary()];
      if (state.list.status !== 'idle') jobs.push(ctl.reload());
      if (state.transfers.status !== 'idle') jobs.push(ctl.loadTransfers());
      if (typeof hooks.onChanged === 'function') { try { jobs.push(Promise.resolve(hooks.onChanged(customerId))); } catch (e) { /* bỏ qua */ } }
      await Promise.all(jobs);
    },
    // kind: complete | reopen | edit | cancel | reassign | transfer | delete. a = hoạt động đã tải (id, version, customerId).
    async act(kind, a, payload = {}) {
      if (inflight) return { ok: false, duplicate: true };
      const id = '/activities/' + enc(a.id);
      const calls = {
        complete: () => req('POST', id + '/complete', { version: a.version, ...(payload.outcome ? { outcome: payload.outcome } : {}) }),
        reopen: () => req('POST', id + '/reopen', { version: a.version }),
        edit: () => req('PATCH', id, { version: a.version, ...(payload.changes || {}) }),
        cancel: () => req('PATCH', id, { version: a.version, status: 'CANCELLED' }),
        reassign: () => req('POST', id + '/assign', { performedById: payload.performedById, version: a.version, ...(payload.external ? { external: true } : {}) }),
        transfer: () => req('POST', id + '/transfer-requests', { toEmployeeId: payload.toEmployeeId, reason: payload.reason }),
        delete: () => req('DELETE', id, payload.reason ? { reason: payload.reason } : {}),
      };
      if (!calls[kind]) return { ok: false, error: describe(new Error('unknown')) };
      inflight = true; set({ busy: kind + ':' + a.id });
      try {
        const data = await calls[kind]();
        await ctl.refreshAll(a.customerId || (a.customer && a.customer.id));
        return { ok: true, data };
      } catch (e) {
        const error = err(e);
        if (error.code === VERSION_CONFLICT) await ctl.refreshAll(a.customerId || (a.customer && a.customer.id));
        return { ok: false, error };
      } finally { inflight = false; set({ busy: null }); }
    },
    // Duyệt / từ chối / rút đề xuất chuyển. t = đề xuất (id) ; version = phiên bản việc khi duyệt (tuỳ chọn).
    async decide(kind, t, payload = {}) {
      if (!['approve', 'reject', 'withdraw'].includes(kind)) return { ok: false };
      if (inflight) return { ok: false, duplicate: true };
      inflight = true; set({ busy: kind + ':' + t.id });
      try {
        const body = {};
        if (payload.version) body.version = payload.version;
        if (kind !== 'withdraw' && payload.decisionNote) body.decisionNote = payload.decisionNote;
        const data = await req('POST', '/activity-transfer-requests/' + enc(t.id) + '/' + kind, body);
        await ctl.refreshAll(t.customer && t.customer.id);
        return { ok: true, data };
      } catch (e) { const error = err(e); if (error.code === VERSION_CONFLICT) await ctl.refreshAll(); return { ok: false, error }; }
      finally { inflight = false; set({ busy: null }); }
    },
    // Đọc phụ (không lưu state chung): ứng viên giao (external = người ngoài phạm vi khách), lịch sử, chi tiết, thẻ việc.
    async candidates(customerId, external) {
      try { const d = await req('GET', '/activities/assignee-candidates' + qs({ customerId, ...(external ? { external: 'true' } : {}) })); return { ok: true, items: d.items }; }
      catch (e) { return { ok: false, error: err(e) }; }
    },
    async history(id) { try { const d = await req('GET', '/activities/' + enc(id) + '/history'); return { ok: true, items: d.items }; } catch (e) { return { ok: false, error: err(e) }; } },
    async get(id) { try { return { ok: true, data: await req('GET', '/activities/' + enc(id)) }; } catch (e) { return { ok: false, error: err(e) }; } },
    async workCard(id) { try { return { ok: true, data: await req('GET', '/activities/' + enc(id) + '/work-card') }; } catch (e) { return { ok: false, error: err(e) }; } },
  };
  return ctl;
}
