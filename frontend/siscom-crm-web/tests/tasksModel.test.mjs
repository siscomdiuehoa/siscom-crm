// Run: node --test tests/tasksModel.test.mjs   (Node >= 18, không dependency). B3 A8: hàm thuần cho trang Công việc + chuông
// (tab theo phạm vi, truy vấn danh sách, thao tác được phép theo quyền, số chuông, route). Không mạng, không DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeTabs, buildTasksQuery, bellCount, taskActions, parseTasksRoute, transferStatusLabel, validateTransfer } from '../src/features/activities/tasksModel.js';

const can = (...keys) => (a) => keys.includes(a);
const ME = 'e-me';
const task = (over = {}) => ({ id: 't1', type: 'TASK', status: 'OPEN', dueAt: '2026-11-06T10:00:00Z', createdById: 'e-other', performedBy: { id: ME, code: 'NV-1', fullName: 'Tôi' }, access: 'SCOPE', version: 3, ...over });

test('scopeTabs: OWN => chỉ "Của tôi"; DEPARTMENT => + "Phòng tôi"; ALL => + "Tất cả"; không quyền => rỗng', () => {
  assert.deepEqual(scopeTabs((p) => (p === 'activity.read' ? 'OWN' : undefined)).map((t) => t.id), ['mine']);
  assert.deepEqual(scopeTabs((p) => (p === 'activity.read' ? 'DEPARTMENT' : undefined)).map((t) => t.label), ['Của tôi', 'Phòng tôi']);
  assert.deepEqual(scopeTabs((p) => (p === 'activity.read' ? 'ALL' : undefined)).map((t) => t.label), ['Của tôi', 'Tất cả']);
  assert.deepEqual(scopeTabs(() => undefined), []);
});

test('buildTasksQuery: "Của tôi" gửi assignee=me; tab khác không gửi assignee; mặc định sắp theo hạn tăng dần, 20/trang', () => {
  assert.deepEqual(buildTasksQuery({ tab: 'mine', due: 'overdue' }), { assignee: 'me', due: 'overdue', page: 1, pageSize: 20, sortBy: 'dueAt', sortOrder: 'asc' });
  assert.deepEqual(buildTasksQuery({ tab: 'all', due: 'all', status: 'DONE', type: 'TASK', page: 2 }), { due: 'all', status: 'DONE', type: 'TASK', page: 2, pageSize: 20, sortBy: 'dueAt', sortOrder: 'asc' });
  assert.equal(buildTasksQuery({ tab: 'mine', due: 'xyz' }).due, 'all');
});

test('bellCount: quá hạn + hôm nay + chờ duyệt; dữ liệu thiếu => 0', () => {
  assert.equal(bellCount({ overdue: 2, today: 1, upcoming7d: 5, pendingApprovals: 3, transferDecisions: 4 }), 6);
  assert.equal(bellCount(null), 0);
  assert.equal(bellCount({ overdue: 'x' }), 0);
});

test('taskActions: người phụ trách (update_own) => Hoàn thành, Đề xuất chuyển, Huỷ, Lịch sử; không Giao lại/Xoá', () => {
  assert.deepEqual(taskActions(task(), { can: can('activity.read', 'activity.update_own', 'activity.transfer_request'), meId: ME }), ['complete', 'transfer', 'cancel', 'history']);
});

test('taskActions: crm_admin (update + assign + delete) với việc người khác => Hoàn thành, Giao lại, Huỷ, Lịch sử, Xoá', () => {
  const a = task({ performedBy: { id: 'e-x', fullName: 'X' } });
  assert.deepEqual(taskActions(a, { can: can('activity.read', 'activity.update', 'activity.assign', 'activity.delete'), meId: ME }), ['complete', 'reassign', 'cancel', 'history', 'delete']);
});

test('taskActions: việc đã xong => Mở lại (khi có quyền sửa), không Hoàn thành/Huỷ/Giao lại', () => {
  assert.deepEqual(taskActions(task({ status: 'DONE' }), { can: can('activity.update', 'activity.assign'), meId: ME }), ['reopen', 'history']);
});

test('taskActions: người chỉ có quyền theo việc (access=TASK) => chỉ Hoàn thành + Đề xuất chuyển; không Lịch sử/Huỷ', () => {
  assert.deepEqual(taskActions(task({ access: 'TASK' }), { can: can('activity.update_own', 'activity.transfer_request'), meId: ME }), ['complete', 'transfer']);
});

test('taskActions: hoạt động không phải TASK => chỉ Lịch sử (+ Xoá cho admin); không có can => rỗng an toàn', () => {
  assert.deepEqual(taskActions(task({ type: 'CALL', status: 'DONE' }), { can: can('activity.read', 'activity.delete'), meId: ME }), ['history', 'delete']);
  assert.deepEqual(taskActions(task(), { meId: ME }), ['complete']); // người phụ trách luôn được hoàn thành (máy chủ kiểm lại)
  assert.deepEqual(taskActions(task({ performedBy: { id: 'e-x' } }), {}), []);
});

test('parseTasksRoute: #/activities[/overdue|today|week|all|approvals] và #/activities/view/:id', () => {
  assert.deepEqual(parseTasksRoute(['activities']), { page: 'activities', filter: 'all' });
  assert.deepEqual(parseTasksRoute(['activities', 'overdue']), { page: 'activities', filter: 'overdue' });
  assert.deepEqual(parseTasksRoute(['activities', 'approvals']), { page: 'activities', filter: 'approvals' });
  assert.deepEqual(parseTasksRoute(['activities', 'bogus']), { page: 'activities', filter: 'all' });
  assert.deepEqual(parseTasksRoute(['activities', 'view', 'abc%2D1']), { page: 'activities', id: 'abc-1' });
});

test('transferStatusLabel + validateTransfer: lý do bắt buộc ≤ 200, phải chọn người nhận', () => {
  assert.equal(transferStatusLabel('PENDING'), 'Chờ duyệt');
  assert.equal(transferStatusLabel('APPROVED'), 'Đã duyệt');
  assert.deepEqual(validateTransfer({ toEmployeeId: '', reason: ' ' }), { toEmployeeId: 'Chọn người nhận', reason: 'Vui lòng nhập lý do' });
  assert.deepEqual(validateTransfer({ toEmployeeId: 'e2', reason: 'a'.repeat(201) }), { reason: 'Lý do tối đa 200 ký tự' });
  assert.deepEqual(validateTransfer({ toEmployeeId: 'e2', reason: 'Nghỉ phép' }), {});
});
