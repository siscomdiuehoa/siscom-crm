// Run: node --test tests/tasksApiUi.test.mjs   (Node >= 18; vite + react đã có). Fetch giả lập; không mạng, không DB, không trình duyệt.
// B3 A8: trang Công việc + thao tác việc (hoàn thành, giao lại, đề xuất chuyển, duyệt) + thẻ việc + tích hợp tab Hoạt động. Chỉ API A6.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const CID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const ME = 'e-me';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const past = new Date(Date.now() - 3600e3).toISOString(); const future = new Date(Date.now() + 86400e3).toISOString();
const task = (over = {}) => ({ id: 't1', code: 'HD-000010', customerId: CID, type: 'TASK', title: 'Gửi báo giá', content: 'Phương án VRV', outcome: null, occurredAt: past, dueAt: past, remindAt: null, status: 'OPEN', performedBy: { id: ME, code: 'NV-0003', fullName: 'Nhân viên kinh doanh' }, contact: null, createdById: 'e-admin', version: 3, customer: { id: CID, code: 'KH-00007', name: 'Công ty A' }, access: 'SCOPE', assigneeLostAccess: false, ...over });
const SUMMARY = { overdue: 1, today: 2, upcoming7d: 3, pendingApprovals: 1, transferDecisions: 0 };
const page = (items, over = {}) => ({ data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over } });

const server = ({ list = () => page([task()]), cands = () => [{ id: 'e2', code: 'NV-0002', fullName: 'Lê Thị Hai', departmentCode: 'KD' }], post, get } = {}) => {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', ''); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, q: u.searchParams, body });
    if (p === '/activities/reminders/summary') return res(200, { data: SUMMARY });
    if (p === '/activities/assignee-candidates') return res(200, { data: { items: cands(u.searchParams) } });
    if (p === '/activities' && method === 'GET') return res(200, list(u.searchParams));
    if (p === '/activity-transfer-requests') return res(200, { data: { items: u.searchParams.get('box') === 'inbox' ? [{ id: 'tr1', status: 'PENDING', reason: 'Nghỉ phép', createdAt: past, activity: { id: 't1', code: 'HD-000010', type: 'TASK', status: 'OPEN', title: 'Gửi báo giá', version: 5 }, customer: { id: CID, code: 'KH-00007', name: 'Công ty A' }, from: { fullName: 'Nhân viên kinh doanh' }, to: { fullName: 'Lê Thị Hai' } }] : [] } });
    if (method !== 'GET') { const r = post && post(p, body, method); if (r) return r; return res(200, { data: { ...task(), status: 'DONE' } }); }
    if (get) { const r = get(p); if (r) return r; }
    if (/^\/activities\/[^/]+$/.test(p)) return res(200, { data: task() });
    if (/\/work-card$/.test(p)) return res(200, { data: { activity: { id: 't1', code: 'HD-000010', type: 'TASK', status: 'OPEN' }, customer: { code: 'KH-00007', name: 'Công ty A', address: '12 Nguyễn Huệ', provinceName: 'TP.HCM', phone: '028 1' }, contact: null } });
    if (/\/history$/.test(p)) return res(200, { data: { items: [{ occurredAt: past, action: 'activity.complete', actor: { code: 'NV-0003', fullName: 'Nhân viên kinh doanh' }, changes: { status: ['OPEN', 'DONE'] } }] } });
    if (/\/activities$/.test(p)) return res(200, page([task()])); // dòng thời gian khách
    return res(200, { data: { id: CID, code: 'KH-00007', name: 'Công ty A', version: 1 } });
  };
  f.calls = calls;
  f.lists = () => calls.filter((c) => c.method === 'GET' && c.p === '/activities');
  f.writes = () => calls.filter((c) => c.method !== 'GET');
  f.count = (p) => calls.filter((c) => c.p === p).length;
  return f;
};

let vite; let dom; let createCustomerApiUi; let TasksPage; let TaskView; let CustomerApiDetail; let createRoot; let act;
before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
  ({ default: TasksPage, TaskView } = await vite.ssrLoadModule('/src/features/activities/TasksPage.jsx'));
  ({ default: CustomerApiDetail } = await vite.ssrLoadModule('/src/features/customers/CustomerApiDetail.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const role = (perms) => ({ can: (p) => p in perms, me: { employeeId: ME, permissions: perms } });
const SALES = role({ 'customer.read': 'OWN', 'activity.read': 'OWN', 'activity.create': 'OWN', 'activity.update_own': 'OWN', 'activity.assign': 'OWN', 'activity.transfer_request': 'OWN' });
const ADMIN = role({ 'customer.read': 'ALL', 'activity.read': 'ALL', 'activity.create': 'ALL', 'activity.update': 'ALL', 'activity.assign': 'ALL', 'activity.delete': 'ALL', 'activity.assign_external': 'ALL' });
const ACCT = role({ 'customer.read': 'ALL', 'activity.read': 'ALL' });
const TECH_TASK = role({ 'activity.read': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT', 'activity.transfer_request': 'DEPARTMENT' });

async function mount(fetchImpl, r, el) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const confirms = []; const nav = [];
  const ui = { ...r, customerApi: ctl, toast: (t) => toasts.push(t), confirm: (o) => confirms.push(o), db: { customers: [] }, navigate: (p) => nav.push(p) };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(el(ui)); }); await flush(); await flush();
  return { ctl, ui, toasts, confirms, nav, container, unmount: () => act(async () => root.unmount()) };
}
const page_ = (f, r, filter = 'all') => mount(f, r, (ui) => React.createElement(TasksPage, { ui, filter }));
const modal = (root) => findAll(root, (e) => e.attributes.role === 'dialog')[0];
const menuItem = async (root, re) => { await doAct(() => click(findAll(root, (e) => e.tagName === 'BUTTON' && e.attributes['aria-label'] === 'Thao tác khác')[0])); const it = findAll(root, (e) => e.attributes.role === 'menuitem' && re.test(text(e)))[0]; assert.ok(it, 'có mục ' + re); await doAct(() => click(it)); };
async function pick(root, labelRe, optionRe) {
  const field = findAll(root, (e) => e.attributes.class === 'sg-field' && findAll(e, (l) => l.tagName === 'LABEL' && labelRe.test(text(l))).length)[0];
  await doAct(() => click(findAll(field, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]));
  await doAct(() => click(findAll(root, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]));
}

test('trang Công việc: "Của tôi" gọi GET /activities?assignee=me&type=TASK…; KPI từ chuông; dòng có quá hạn + khách + phụ trách', async () => {
  const f = server(); const m = await page_(f, SALES);
  try {
    const q = f.lists()[0].q;
    assert.equal(q.get('assignee'), 'me'); assert.equal(q.get('type'), 'TASK'); assert.equal(q.get('due'), 'all'); assert.equal(q.get('sortBy'), 'dueAt'); assert.equal(q.get('pageSize'), '20');
    const t = text(m.container);
    assert.match(t, /Quá hạn\s*1/); assert.match(t, /Hôm nay\s*2/); assert.match(t, /7 ngày tới\s*3/); assert.match(t, /Chờ tôi duyệt\s*1/);
    assert.match(t, /Gửi báo giá/); assert.match(t, /Công ty A/); assert.match(t, /Nhân viên kinh doanh/); assert.match(t, /Quá hạn/);
    assert.deepEqual(findAll(m.container, (e) => e.attributes.role === 'tab').map((x) => text(x)), ['Của tôi']); // sales OWN
  } finally { await m.unmount(); }
});

test('phạm vi ALL: có tab "Tất cả" (không gửi assignee); route overdue gửi due=overdue', async () => {
  const f = server(); const m = await page_(f, ADMIN, 'overdue');
  try {
    assert.equal(f.lists()[0].q.get('due'), 'overdue');
    await doAct(() => click(findAll(m.container, (e) => e.attributes.role === 'tab' && text(e) === 'Tất cả')[0]));
    assert.equal(f.lists().at(-1).q.get('assignee'), null);
  } finally { await m.unmount(); }
});

test('Hoàn thành: hộp thoại gửi POST /complete {version, outcome}; đọc lại danh sách + chuông; toast', async () => {
  const f = server(); const m = await page_(f, SALES);
  try {
    const nList = f.lists().length; const nSum = f.count('/activities/reminders/summary');
    await doAct(() => click(buttonByText(m.container, /^Hoàn thành$/)));
    const d = modal(m.container); assert.ok(d);
    type(inputByLabel(d, /^Kết quả/), 'Đã gửi email báo giá'); await flush();
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Hoàn thành')[0]));
    const w = f.writes()[0];
    assert.equal(w.p, '/activities/t1/complete'); assert.deepEqual(w.body, { version: 3, outcome: 'Đã gửi email báo giá' });
    assert.ok(f.lists().length > nList); assert.ok(f.count('/activities/reminders/summary') > nSum);
    assert.equal(modal(m.container), undefined); assert.match(m.toasts[0].title, /Đã hoàn thành/);
  } finally { await m.unmount(); }
});

test('Giao lại (admin): chọn người trong phạm vi => POST /assign {performedById, version}; bật "phòng khác" => ứng viên external=true và gửi external:true', async () => {
  const f = server({ list: () => page([task({ performedBy: { id: 'e-x', code: 'NV-9', fullName: 'Người khác' } })]) }); const m = await page_(f, ADMIN);
  try {
    await menuItem(m.container, /^Giao lại/);
    assert.equal(f.calls.filter((c) => c.p === '/activities/assignee-candidates').at(-1).q.get('external'), null);
    await pick(modal(m.container), /^Người phụ trách mới/, /Lê Thị Hai/);
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Giao lại')[0]));
    assert.deepEqual(f.writes()[0], { ...f.writes()[0], p: '/activities/t1/assign' }); assert.deepEqual(f.writes()[0].body, { performedById: 'e2', version: 3 });
    await menuItem(m.container, /^Giao lại/);
    const sw = findAll(modal(m.container), (e) => e.tagName === 'INPUT' && e.attributes.role === 'switch')[0]; assert.ok(sw, 'có công tắc phòng khác');
    sw.checked = true; await doAct(() => click(sw));
    assert.equal(f.calls.filter((c) => c.p === '/activities/assignee-candidates').at(-1).q.get('external'), 'true');
    await pick(modal(m.container), /^Người phụ trách mới/, /Lê Thị Hai/);
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Giao lại')[0]));
    assert.deepEqual(f.writes().at(-1).body, { performedById: 'e2', version: 3, external: true });
  } finally { await m.unmount(); }
});

test('Đề xuất chuyển: thiếu lý do bị chặn tại chỗ; đủ => POST /transfer-requests {toEmployeeId, reason}', async () => {
  const f = server(); const m = await page_(f, SALES);
  try {
    await menuItem(m.container, /^Đề xuất chuyển/);
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Gửi đề xuất')[0]));
    assert.equal(f.writes().length, 0); assert.match(text(modal(m.container)), /Vui lòng nhập lý do/);
    await pick(modal(m.container), /^Chuyển cho/, /Lê Thị Hai/);
    type(inputByLabel(modal(m.container), /^Lý do/), 'Nghỉ phép tuần sau'); await flush();
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Gửi đề xuất')[0]));
    assert.equal(f.writes()[0].p, '/activities/t1/transfer-requests'); assert.deepEqual(f.writes()[0].body, { toEmployeeId: 'e2', reason: 'Nghỉ phép tuần sau' });
  } finally { await m.unmount(); }
});

test('Chờ duyệt (#/activities/approvals): người có quyền giao duyệt => POST /activity-transfer-requests/tr1/approve', async () => {
  const f = server(); const m = await page_(f, ADMIN, 'approvals');
  try {
    assert.match(text(m.container), /Chờ tôi duyệt \(1\)/); assert.match(text(m.container), /Nghỉ phép/);
    await doAct(() => click(buttonByText(m.container, /^Duyệt$/)));
    assert.equal(f.writes()[0].p, '/activity-transfer-requests/tr1/approve');
    assert.deepEqual(f.writes()[0].body, { version: 5 }, 'F-A8-01: duyệt phải gửi activity.version lấy từ hộp đến');
    assert.match(m.toasts[0].title, /Đã duyệt/);
  } finally { await m.unmount(); }
});

test('F-A8-01: duyệt khi việc đã đổi (409 ACTIVITY_VERSION_CONFLICT) => báo lỗi, đọc lại hộp đến', async () => {
  const f = server({ post: (p) => (/\/approve$/.test(p) ? res(409, { error: { code: 'ACTIVITY_VERSION_CONFLICT', message: 'Việc đã bị người khác thay đổi.', details: { currentVersion: 6 } } }) : null) });
  const m = await page_(f, ADMIN, 'approvals');
  try {
    const n = f.count('/activity-transfer-requests');
    await doAct(() => click(buttonByText(m.container, /^Duyệt$/)));
    assert.deepEqual(f.writes()[0].body, { version: 5 });
    assert.equal(m.toasts.length, 1); assert.equal(m.toasts[0].tone, 'error');
    assert.ok(f.count('/activity-transfer-requests') > n, 'đọc lại hộp đến sau 409');
  } finally { await m.unmount(); }
});

test('409 ACTIVITY_VERSION_CONFLICT: hộp thoại báo lỗi, danh sách đọc lại từ máy chủ', async () => {
  const f = server({ post: () => res(409, { error: { code: 'ACTIVITY_VERSION_CONFLICT', message: 'Việc đã bị người khác thay đổi.', details: { currentVersion: 4 } } }) }); const m = await page_(f, SALES);
  try {
    const n = f.lists().length;
    await doAct(() => click(buttonByText(m.container, /^Hoàn thành$/)));
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Hoàn thành')[0]));
    assert.ok(modal(m.container)); assert.match(text(modal(m.container)), /Xung đột dữ liệu|bị người khác thay đổi/);
    assert.ok(f.lists().length > n);
  } finally { await m.unmount(); }
});

test('kế toán (chỉ đọc): thấy việc, không có nút thao tác nào ngoài Lịch sử', async () => {
  const f = server({ list: () => page([task({ performedBy: { id: 'e-x', fullName: 'Người khác' } })]) }); const m = await page_(f, ACCT);
  try {
    assert.equal(buttonByText(m.container, /^Hoàn thành$/), undefined);
    await menuItem(m.container, /^Lịch sử/);
    assert.match(text(modal(m.container)), /Hoàn thành · Nhân viên kinh doanh/); assert.match(text(modal(m.container)), /Trường: Trạng thái/);
  } finally { await m.unmount(); }
});

test('thẻ việc (quyền theo việc): đọc /work-card, không link hồ sơ khách, chỉ Hoàn thành + Đề xuất chuyển', async () => {
  const f = server({ get: (p) => (p === '/activities/t1' ? res(200, { data: task({ access: 'TASK', accessExpiresAt: future }) }) : null) });
  const m = await mount(f, TECH_TASK, (ui) => React.createElement(TaskView, { ui, id: 't1' }));
  try {
    assert.equal(f.count('/activities/t1/work-card'), 1);
    const t = text(m.container); assert.match(t, /12 Nguyễn Huệ/); assert.match(t, /chỉ xem thẻ việc/);
    assert.equal(findAll(m.container, (e) => e.tagName === 'A' && /customers/.test(e.attributes.href || '')).length, 0);
    assert.ok(buttonByText(m.container, /^Hoàn thành$/));
    await menuItem(m.container, /^Đề xuất chuyển/);
    assert.match(text(modal(m.container)), /chưa có danh sách người cùng phòng/);
  } finally { await m.unmount(); }
});

test('tab Hoạt động của khách: mục Công việc có nút Hoàn thành; xong => dòng thời gian đọc lại', async () => {
  const f = server(); const m = await mount(f, { ...SALES, can: (p) => p === 'contact.read' ? false : SALES.can(p) }, (ui) => React.createElement(CustomerApiDetail, { ui, id: CID }));
  try {
    await doAct(() => click(findAll(m.container, (e) => e.attributes.role === 'tab' && /^Hoạt động/.test(text(e)))[0]));
    const nTl = f.calls.filter((c) => c.p === '/customers/' + CID + '/activities').length;
    await doAct(() => click(buttonByText(m.container, /^Hoàn thành$/)));
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Hoàn thành')[0]));
    assert.equal(f.writes()[0].p, '/activities/t1/complete');
    assert.ok(f.calls.filter((c) => c.p === '/customers/' + CID + '/activities').length > nTl);
  } finally { await m.unmount(); }
});

test('drawer Ghi nhận (admin có assign_external): bật "Giao cho người phòng khác" => ứng viên external, POST kèm external:true', async () => {
  const f = server(); const m = await mount(f, ADMIN, (ui) => React.createElement(CustomerApiDetail, { ui, id: CID }));
  try {
    await doAct(() => click(findAll(m.container, (e) => e.attributes.role === 'tab' && /^Hoạt động/.test(text(e)))[0]));
    await doAct(() => click(findAll(m.container, (e) => e.tagName === 'BUTTON' && e.attributes['aria-label'] === 'Ghi nhận hoạt động')[0]));
    const dlg = () => findAll(m.container, (e) => e.attributes.role === 'dialog' && e.attributes['aria-label'] === 'Ghi nhận hoạt động')[0];
    await doAct(() => click(findAll(dlg(), (e) => e.attributes.role === 'radio' && text(e) === 'Công việc')[0]));
    const sw = findAll(dlg(), (e) => e.tagName === 'INPUT' && e.attributes.role === 'switch')[0]; assert.ok(sw);
    sw.checked = true; await doAct(() => click(sw));
    assert.equal(f.calls.filter((c) => c.p === '/activities/assignee-candidates').at(-1).q.get('external'), 'true');
    await pick(dlg(), /^Người phụ trách/, /Lê Thị Hai/);
    type(inputByLabel(dlg(), /^Nội dung/), 'Khảo sát mặt bằng'); await flush();
    type(inputByLabel(dlg(), /^Hạn/), '2026-12-01T09:00'); await flush();
    await doAct(() => click(buttonByText(dlg(), /^Lưu$/)));
    const w = f.writes().find((c) => c.p === '/customers/' + CID + '/activities');
    assert.deepEqual(w.body, { type: 'TASK', content: 'Khảo sát mặt bằng', dueAt: '2026-12-01T09:00:00+07:00', performedById: 'e2', external: true });
  } finally { await m.unmount(); }
});

test('thẻ việc: hoàn thành xong mà quyền theo việc kết thúc (đọc lại 404) => báo đã xong, không hiện lỗi đỏ', async () => {
  let n = 0;
  const f = server({ get: (p) => (p === '/activities/t1' ? (++n === 1 ? res(200, { data: task({ access: 'TASK', accessExpiresAt: future }) }) : res(404, { error: { code: 'ACTIVITY_NOT_FOUND', message: 'Không tìm thấy hoạt động.' } })) : null) });
  const m = await mount(f, TECH_TASK, (ui) => React.createElement(TaskView, { ui, id: 't1' }));
  try {
    await doAct(() => click(buttonByText(m.container, /^Hoàn thành$/)));
    await doAct(() => click(findAll(modal(m.container), (e) => e.tagName === 'BUTTON' && text(e) === 'Hoàn thành')[0]));
    assert.equal(f.writes()[0].p, '/activities/t1/complete');
    const t = text(m.container);
    assert.match(t, /Việc đã được cập nhật; quyền theo việc của bạn đã kết thúc/);
    assert.equal(findAll(m.container, (e) => e.attributes.role === 'alert').length, 0);
  } finally { await m.unmount(); }
});
