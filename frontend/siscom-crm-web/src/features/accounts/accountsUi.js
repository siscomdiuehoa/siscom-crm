// P1: controller trang Tài khoản trên API /accounts (không React / DOM / lưu trữ cục bộ).
// Mọi thao tác ghi là MỘT lời gọi; thành công => đọc lại danh sách từ máy chủ (không tự sửa dòng); lỗi => báo, không thử lại ngầm.
// Mật khẩu tạm chỉ đi qua tham số `payload` tới thân yêu cầu: KHÔNG lưu vào state của controller, không ghi log.
import { buildAccountsQuery } from './accountsModel.js';

const enc = encodeURIComponent;
const idleList = { status: 'idle', filters: null, items: [], page: 0, total: 0, totalPages: 0, error: null, refreshError: null, more: 'idle', moreError: null };
const idleMeta = { status: 'idle', roles: [], departments: [], error: null };
const trim = (v) => (typeof v === 'string' ? v.trim() : '');
const profile = (p) => ({ fullName: trim(p.fullName), email: trim(p.email), departmentId: p.departmentId || null, positionTitle: trim(p.positionTitle) || null });

export function createAccountsController(repo, describe) {
  let state = { list: idleList, meta: idleMeta, busy: null };
  const subs = new Set();
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
  const req = (m, p, b) => repo.accounts(m, p, b);
  const qs = (o) => (typeof repo.qs === 'function' ? repo.qs(o) : '');
  let lseq = 0; let mseq = 0; let inflight = false;
  const page = (d, filters, items) => ({ ...idleList, status: 'ready', filters: { ...filters }, items, page: d.page || 1, total: d.total, totalPages: d.totalPages });

  const ctl = {
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    // filters = { q, role, status }
    async load(filters) {
      const my = ++lseq; const f = { ...(filters || {}) };
      set({ list: { ...idleList, status: 'loading', filters: f } });
      try { const d = await req('GET', '/accounts' + qs(buildAccountsQuery({ ...f, page: 1 }))); if (my === lseq) set({ list: page(d, f, d.items) }); }
      catch (e) { if (my === lseq) set({ list: { ...idleList, status: 'error', filters: f, error: describe(e) } }); }
    },
    // Đọc lại KHÔNG PHÁ: giữ các dòng đang hiện tới khi có dữ liệu mới (hộp thoại gắn với dòng không bị gỡ). Lỗi => giữ dữ liệu + refreshError.
    async reload() {
      const l = state.list; if (!l.filters) return;
      if (l.status !== 'ready') { await ctl.load(l.filters); return; }
      const my = ++lseq;
      try { const d = await req('GET', '/accounts' + qs(buildAccountsQuery({ ...l.filters, page: 1 }))); if (my === lseq) set({ list: page(d, l.filters, d.items) }); }
      catch (e) { if (my === lseq) set({ list: { ...state.list, refreshError: describe(e) } }); }
    },
    async loadMore() {
      const l = state.list; if (l.status !== 'ready' || l.more === 'loading' || l.page >= l.totalPages) return;
      const my = lseq; set({ list: { ...l, more: 'loading', moreError: null } });
      try {
        const d = await req('GET', '/accounts' + qs(buildAccountsQuery({ ...l.filters, page: l.page + 1 })));
        if (my !== lseq) return;
        const seen = new Set(state.list.items.map((a) => a.id));
        set({ list: { ...state.list, items: state.list.items.concat(d.items.filter((a) => !seen.has(a.id))), page: d.page || l.page + 1, total: d.total, totalPages: d.totalPages, more: 'idle' } });
      } catch (e) { if (my === lseq) set({ list: { ...state.list, more: 'error', moreError: describe(e) } }); }
    },
    // Vai trò + phòng ban cho các ô chọn. Tải một lần; lỗi => các hộp thoại báo và cho thử lại.
    async loadMeta(force) {
      if (!force && (state.meta.status === 'ready' || state.meta.status === 'loading')) return;
      const my = ++mseq; set({ meta: { ...state.meta, status: 'loading', error: null } });
      try {
        const [roles, departments] = await Promise.all([req('GET', '/accounts/roles'), req('GET', '/accounts/departments')]);
        if (my === mseq) set({ meta: { status: 'ready', roles: Array.isArray(roles) ? roles : [], departments: Array.isArray(departments) ? departments : [], error: null } });
      } catch (e) { if (my === mseq) set({ meta: { ...idleMeta, status: 'error', error: describe(e) } }); }
    },
    // kind: create | edit | role | resetPassword | disable | enable. row = dòng đã tải (id, updatedAt) — null khi thêm mới.
    async act(kind, row, payload = {}) {
      if (inflight) return { ok: false, duplicate: true };
      const id = row ? '/accounts/' + enc(row.id) : null;
      const calls = {
        create: () => req('POST', '/accounts', { ...profile(payload), role: payload.role, tempPassword: payload.tempPassword }),
        edit: () => req('PATCH', id, { updatedAt: payload.updatedAt || row.updatedAt, ...profile(payload) }),
        role: () => req('POST', id + '/role', { role: payload.role }),
        resetPassword: () => req('POST', id + '/reset-password', { tempPassword: payload.tempPassword }),
        disable: () => req('POST', id + '/disable', { reason: trim(payload.reason) }),
        enable: () => req('POST', id + '/enable', { tempPassword: payload.tempPassword }),
      };
      if (!calls[kind] || (kind !== 'create' && !row)) return { ok: false, error: describe(new Error('unknown')) };
      inflight = true; set({ busy: kind + ':' + (row ? row.id : 'new') });
      try {
        const data = await calls[kind]();
        await ctl.reload();
        return { ok: true, data };
      } catch (e) { return { ok: false, error: describe(e) }; }
      finally { inflight = false; set({ busy: null }); }
    },
    // Sau 409 VERSION_CONFLICT: đọc lại danh sách và trả dòng mới nhất của tài khoản đó (để lấy updatedAt mới; nội dung đang gõ do hộp thoại giữ).
    async fresh(id) {
      await ctl.reload();
      const l = state.list;
      if (l.refreshError) return { ok: false, error: l.refreshError };
      const row = l.items.find((a) => a.id === id);
      return row ? { ok: true, row } : { ok: false, gone: true };
    },
  };
  return ctl;
}
