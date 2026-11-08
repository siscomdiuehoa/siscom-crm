// B3 A8: hàm thuần cho trang Công việc, chuông và thao tác việc (không React/DOM/mạng). Thiết kế §6–§8; API A6 (PR #211).
// Mọi cổng ở đây chỉ là tiện ích giao diện (fail-closed); máy chủ luôn kiểm lại quyền, phạm vi, phiên bản.

const has = (can, p) => { try { return typeof can === 'function' && !!can(p); } catch (e) { return false; } };
const scope = (scopeOf, p) => { try { return typeof scopeOf === 'function' ? scopeOf(p) : undefined; } catch (e) { return undefined; } };

export const DUE_FILTERS = [
  { value: 'overdue', label: 'Quá hạn' }, { value: 'today', label: 'Hôm nay' }, { value: 'week', label: '7 ngày tới' }, { value: 'all', label: 'Tất cả' },
];
const DUES = DUE_FILTERS.map((d) => d.value);
export const TASKS_PAGE_SIZE = 20;

// Tab theo phạm vi activity.read (§8): Của tôi luôn có; Phòng tôi khi DEPARTMENT; Tất cả khi ALL.
export function scopeTabs(scopeOf) {
  const s = scope(scopeOf, 'activity.read');
  if (!s) return [];
  const tabs = [{ id: 'mine', label: 'Của tôi' }];
  if (s === 'DEPARTMENT') tabs.push({ id: 'dept', label: 'Phòng tôi' });
  if (s === 'ALL') tabs.push({ id: 'all', label: 'Tất cả' });
  return tabs;
}

// Truy vấn GET /activities. "Của tôi" = assignee=me; tab khác = mọi việc trong phạm vi (máy chủ lọc phạm vi).
export function buildTasksQuery({ tab = 'mine', due = 'all', status, type, page = 1 } = {}) {
  const q = {};
  if (tab === 'mine') q.assignee = 'me';
  q.due = DUES.includes(due) ? due : 'all';
  if (status) q.status = status;
  if (type) q.type = type;
  return { ...q, page, pageSize: TASKS_PAGE_SIZE, sortBy: 'dueAt', sortOrder: 'asc' };
}

// Chuông = quá hạn + hôm nay + chờ tôi duyệt (§7).
export function bellCount(s) {
  if (!s) return 0;
  const n = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  return n(s.overdue) + n(s.today) + n(s.pendingApprovals);
}

// Thao tác hiện trên một mục, theo thứ tự hiển thị. ctx = { can, meId }.
export function taskActions(a, ctx = {}) {
  if (!a) return [];
  const { can, meId } = ctx;
  const isTask = a.type === 'TASK'; const open = a.status === 'OPEN'; const byTask = a.access === 'TASK';
  const mine = !!meId && ((a.performedBy && a.performedBy.id === meId));
  const own = !!meId && (mine || a.createdById === meId);
  const canUpdate = !byTask && (has(can, 'activity.update') || (has(can, 'activity.update_own') && own));
  const out = [];
  if (isTask && open && (canUpdate || mine)) out.push('complete');
  if (isTask && !open && canUpdate) out.push('reopen');
  if (canUpdate) out.push('edit'); // PATCH: người chỉ có quyền theo việc không sửa (chỉ ghi kết quả khi Hoàn thành)
  if (isTask && open && !byTask && has(can, 'activity.assign')) out.push('reassign');
  if (isTask && open && mine && has(can, 'activity.transfer_request')) out.push('transfer');
  if (isTask && open && canUpdate) out.push('cancel');
  if (!byTask && (has(can, 'activity.read') || canUpdate)) out.push('history');
  if (!byTask && has(can, 'activity.delete')) out.push('delete');
  return out;
}
export const ACTION_LABEL = { complete: 'Hoàn thành', reopen: 'Mở lại', edit: 'Sửa', reassign: 'Giao lại', transfer: 'Đề xuất chuyển', cancel: 'Huỷ việc', history: 'Lịch sử', delete: 'Xoá' };
export const ACTION_ICON = { complete: 'circle-check', reopen: 'rotate-ccw', edit: 'pencil', reassign: 'user-round-cog', transfer: 'arrow-right-left', cancel: 'circle-x', history: 'history', delete: 'trash-2' };

// Route: #/activities[/overdue|today|week|all|approvals], #/activities/view/:id
const ROUTE_FILTERS = [...DUES, 'approvals'];
export function parseTasksRoute(parts) {
  if (parts[1] === 'view' && parts[2]) { let id = parts[2]; try { id = decodeURIComponent(id); } catch (e) { /* giữ nguyên, máy chủ trả 404 */ } return { page: 'activities', id }; }
  return { page: 'activities', filter: ROUTE_FILTERS.includes(parts[1]) ? parts[1] : 'all' };
}

const TRANSFER_STATUS = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', WITHDRAWN: 'Đã rút' };
export const transferStatusLabel = (s) => TRANSFER_STATUS[s] || s || '—';
export const TRANSFER_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', WITHDRAWN: 'neutral' };

const t = (v) => String(v == null ? '' : v).trim();
export function validateTransfer(d) {
  const e = {};
  if (!t(d && d.toEmployeeId)) e.toEmployeeId = 'Chọn người nhận';
  const r = t(d && d.reason);
  if (!r) e.reason = 'Vui lòng nhập lý do';
  else if (r.length > 200) e.reason = 'Lý do tối đa 200 ký tự';
  return e;
}
