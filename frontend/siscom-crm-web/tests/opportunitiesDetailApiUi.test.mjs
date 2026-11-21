// Run: node --test tests/opportunitiesDetailApiUi.test.mjs   (Node >= 18; vite + react đã có). Fetch giả lập; không mạng, không DB, không trình duyệt.
// Sales S10c: Sửa cơ hội, ba tab ở chi tiết (Hoạt động & công việc, Lịch sử thay đổi, Tài liệu), danh sách đã xoá + Khôi phục — chỉ qua API Sales.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, byTag, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const CID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const ME = 'e-me';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fail = (status, code, message, details) => res(status, { error: { code, message, details } });
const NOW = '2026-11-18T03:00:00.000Z';
const META = {
  stages: [{ id: 's1', code: 'PROSPECTING', label: 'Tiếp cận', defaultProbability: 10 }, { id: 's3', code: 'QUOTATION', label: 'Báo giá', defaultProbability: 45 }],
  types: [{ id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư', requiresProject: false }, { id: 't-install', code: 'INSTALLATION', label: 'Thi công', requiresProject: true }],
  lostReasons: [{ id: 'r-price', code: 'PRICE_HIGHER', label: 'Giá cao hơn đối thủ', requiresNote: false }],
};
const item = (n, over = {}) => ({ id: 'o' + n, code: 'CH-' + String(n).padStart(4, '0'), title: 'Cơ hội số ' + n, status: 'OPEN', access: 'FULL', type: { id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư' }, stage: { id: 's1', code: 'PROSPECTING', label: 'Tiếp cận' },
  customer: { id: CID, code: 'KH-00478', name: 'Công ty A' }, owner: { id: ME, code: 'NV-0003', fullName: 'Trần Bình' }, isProjectLinked: false, projectName: null, expectedAmountVnd: null, probability: 10, expectedCloseDate: null,
  holdUntil: null, wonAmountVnd: null, closedAt: null, deletedAt: null, version: 3, createdAt: NOW, updatedAt: NOW, ...over });
const detail = (over = {}) => ({ ...item(1), customerReadable: true, contact: null, needSummary: 'Cần 2 chiller', offerScope: null, probabilityOverridden: false, holdReason: null, wonDocType: null, wonDocNo: null, wonDocDate: null, wonDocUrl: null, wonDocFileName: null, lostReason: null, lostNote: null, ...over });
const techDetail = () => ({ id: 'o1', code: 'CH-0001', title: 'Lắp FCU khách sạn', access: 'TASK', type: { id: 't-install', code: 'INSTALLATION', label: 'Thi công' }, stage: { id: 's1', code: 'PROSPECTING', label: 'Tiếp cận' }, customer: { id: CID, code: 'KH-00478', name: 'Công ty A' }, isProjectLinked: true, projectName: 'KS Biển Xanh', expectedCloseDate: '2026-12-20', needSummary: 'Lắp 120 FCU', offerScope: 'Thi công', version: 1, createdAt: NOW, updatedAt: NOW });
const page = (items, over = {}) => res(200, { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over } });
const activity = (n, over = {}) => ({ id: 'a' + n, code: 'HD-' + String(n).padStart(4, '0'), customerId: CID, opportunityId: 'o1', type: 'CALL', title: null, content: 'Nội dung hoạt động ' + n, outcome: null, occurredAt: NOW, dueAt: null, remindAt: null,
  status: 'DONE', completedAt: null, completedById: null, performedBy: { id: ME, code: 'NV-0003', fullName: 'Trần Bình' }, contact: null, createdById: ME, version: 1, createdAt: NOW, updatedAt: NOW, autoKind: null, ...over });
const actPage = (items, over = {}) => res(200, { data: { items, access: 'FULL', page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over } });
const doc = (id, kind, fileName, url) => ({ id, kind, fileName, url, createdAt: NOW, createdBy: { id: ME, code: 'NV-0003', fullName: 'Trần Bình' } });

const server = (h = {}) => {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', ''); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, q: u.searchParams, body });
    const n = calls.filter((c) => c.method === method && c.p === p).length;
    if (method !== 'GET') return (h.write && h.write(p, body, method, n)) || res(200, { data: detail({ version: 4 }) });
    if (p === '/opportunities/meta') return res(200, { data: META });
    if (p === '/opportunities') return (h.list || (() => page([item(1)])))(u.searchParams, n);
    if (p === '/opportunities/o1/activities') return (h.activities || (() => actPage([])))(u.searchParams, n);
    if (p === '/opportunities/o1/changes') return (h.changes || (() => res(200, { data: { items: [] } })))(n, u.searchParams);
    if (p === '/opportunities/o1/documents') return (h.documents || (() => res(200, { data: { items: [], access: 'FULL' } })))(n);
    if (p === '/customers/' + CID + '/contacts') return res(200, { data: { items: [{ id: 'k1', code: 'LH-1', fullName: 'Nguyễn An', isPrimary: true }, { id: 'k2', code: 'LH-2', fullName: 'Lê Bình', isPrimary: false }] } });
    if (p === '/opportunities/o1') return (h.get || (() => res(200, { data: detail() })))(n);
    return res(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  };
  f.calls = calls;
  f.gets = (p) => calls.filter((c) => c.method === 'GET' && c.p === p);
  f.writes = () => calls.filter((c) => c.method !== 'GET');
  return f;
};

let vite; let dom; let createCustomerApiUi; let OpportunitiesPage; let OpportunityView; let createRoot; let act;
before(async () => {
  dom = installDom();
  dom.doc.querySelectorAll = () => []; // như test S10b: React tra nhóm radio cùng name qua gốc tài liệu; miniDom không có
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
  ({ default: OpportunitiesPage, OpportunityView } = await vite.ssrLoadModule('/src/features/opportunities/OpportunitiesPage.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const role = (perms) => ({ can: (p) => p in perms, me: { employeeId: ME, permissions: perms } });
const SALES = role({ 'customer.read': 'OWN', 'contact.read': 'OWN', 'activity.read': 'OWN', 'activity.create': 'OWN', 'opportunity.read': 'OWN', 'opportunity.create': 'OWN', 'opportunity.update': 'OWN', 'opportunity.move_stage': 'OWN', 'opportunity.close': 'OWN', 'opportunity.assign': 'OWN' });
const ADMIN = role(Object.fromEntries(['customer.read', 'contact.read', 'activity.read', 'activity.create', 'opportunity.read', 'opportunity.create', 'opportunity.update', 'opportunity.move_stage', 'opportunity.close', 'opportunity.assign', 'opportunity.reopen', 'opportunity.delete', 'opportunity.restore'].map((k) => [k, 'ALL'])));
const ACCT = role({ 'customer.read': 'ALL', 'opportunity.read': 'ALL' });
const TECH = role({ 'activity.read': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT', 'activity.create_tech': 'DEPARTMENT', 'opportunity.read_assigned': 'OWN' });

async function mount(fetchImpl, r, el, extra = {}) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const nav = [];
  const ui = { ...r, ...extra, customerApi: ctl, toast: (t) => toasts.push(t), confirm: () => {}, db: { customers: [] }, navigate: (p) => nav.push(p) };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(el(ui)); }); await flush(); await flush();
  return { ctl, ui, toasts, nav, container, unmount: () => act(async () => root.unmount()) };
}
const listPage = (f, r, extra) => mount(f, r, (ui) => React.createElement(OpportunitiesPage, { ui }), extra);
const viewPage = (f, r) => mount(f, r, (ui) => React.createElement(OpportunityView, { ui, id: 'o1' }));
const modal = (root) => findAll(root, (e) => e.attributes.role === 'dialog')[0];
const rows = (root) => byTag(root, 'tr').slice(1);
const alerts = (root) => findAll(root, (e) => e.attributes.role === 'alert').map((e) => text(e));
const tabs = (root) => findAll(root, (e) => e.attributes.role === 'tab').map((e) => text(e));
const panel = (root) => findAll(root, (e) => e.attributes.role === 'tabpanel')[0];
const actionButtons = (root) => { const g = findAll(root, (e) => e.attributes['aria-label'] === 'Thao tác trên cơ hội')[0]; return g ? byTag(g, 'button').map((b) => text(b)) : []; };
const fill = async (root, labelRe, value) => { const el = inputByLabel(root, labelRe); assert.ok(el, 'có ô ' + labelRe); await doAct(() => type(el, value)); };
const press = async (root, re) => { const b = buttonByText(root, re); assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };
const openTab = async (root, re) => { const t = findAll(root, (e) => e.attributes.role === 'tab' && re.test(text(e)))[0]; assert.ok(t, 'có tab ' + re); await doAct(() => click(t)); };
async function pickIn(scope, optionRe) {
  await doAct(() => click(findAll(scope, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]));
  const opt = findAll(scope, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]; assert.ok(opt, 'có lựa chọn ' + optionRe);
  await doAct(() => click(opt));
}
const pickGroup = (root, groupLabel, optionRe) => { const g = findAll(root, (e) => e.attributes['aria-label'] === groupLabel)[0]; assert.ok(g, 'có bộ lọc ' + groupLabel); return pickIn(g, optionRe); };
const pickField = (root, labelRe, optionRe) => { const field = findAll(root, (e) => e.attributes.class === 'sg-field' && findAll(e, (l) => l.tagName === 'LABEL' && labelRe.test(text(l))).length)[0]; assert.ok(field, 'có ô ' + labelRe); return pickIn(field, optionRe); };
const noZero = (s) => assert.doesNotMatch(s, /(^|\D)0 đ/);

// ───── Sửa cơ hội ─────
test('Sửa: biểu mẫu điền sẵn; đổi tiêu đề + xoá giá trị => PATCH chỉ trường đổi kèm version, giá trị là null (KHÔNG phải 0); lưu xong đọc lại chi tiết', async () => {
  const f = server({ get: (n) => res(200, { data: detail(n === 1 ? { expectedAmountVnd: '7200000000' } : { version: 4, title: 'Bán 150 FCU' }) }) });
  const m = await viewPage(f, SALES);
  try {
    assert.deepEqual(actionButtons(m.container).slice(0, 1), ['Sửa']);
    await press(m.container, /^Sửa$/); const d = modal(m.container); assert.ok(d, 'hộp thoại Sửa mở');
    assert.equal(inputByLabel(d, /Tiêu đề/).value, 'Cơ hội số 1'); assert.equal(inputByLabel(d, /Giá trị dự kiến/).value, '7.200.000.000'); assert.equal(inputByLabel(d, /^Xác suất/).value, '10');
    assert.equal(inputByLabel(d, /Lý do sửa xác suất/), null); // chỉ hiện khi đổi xác suất
    await fill(d, /Tiêu đề/, 'Bán 150 FCU'); await fill(d, /Giá trị dự kiến/, ''); await press(d, /Lưu thay đổi/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.deepEqual([w[0].method, w[0].p, w[0].body], ['PATCH', '/opportunities/o1', { version: 3, title: 'Bán 150 FCU', expectedAmountVnd: null }]);
    assert.equal(modal(m.container), undefined);
    assert.equal(m.toasts.pop().title, 'Đã lưu cơ hội');
    assert.equal(f.gets('/opportunities/o1').length, 2);
    assert.match(text(m.container), /Bán 150 FCU/); assert.match(text(m.container), /Chưa rõ/); noZero(text(m.container));
  } finally { await m.unmount(); }
});

test('Sửa: không đổi gì => không gọi mạng, báo "Không có thay đổi"; Huỷ => không gọi mạng', async () => {
  const f = server();
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); await press(modal(m.container), /Lưu thay đổi/);
    assert.equal(f.writes().length, 0); assert.equal(modal(m.container), undefined); assert.equal(m.toasts.pop().title, 'Không có thay đổi');
    assert.equal(f.gets('/opportunities/o1').length, 1);
    await press(m.container, /^Sửa$/); await fill(modal(m.container), /Tiêu đề/, 'Khác'); await press(modal(m.container), /^Huỷ$/);
    assert.equal(f.writes().length, 0); assert.equal(modal(m.container), undefined);
  } finally { await m.unmount(); }
});

test('Sửa xác suất bằng tay: bắt buộc lý do (thiếu => không gọi mạng); đủ => gửi probability là số + probabilityReason', async () => {
  const f = server();
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); const d = modal(m.container);
    await fill(d, /^Xác suất/, '60'); await press(d, /Lưu thay đổi/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Sửa xác suất phải ghi lý do/);
    await fill(d, /^Xác suất/, '160'); await press(d, /Lưu thay đổi/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Xác suất là số nguyên từ 0 đến 100/);
    await fill(d, /^Xác suất/, '60'); await fill(d, /Lý do sửa xác suất/, 'Khách duyệt ngân sách'); await press(d, /Lưu thay đổi/);
    assert.deepEqual(f.writes()[0].body, { version: 3, probability: 60, probabilityReason: 'Khách duyệt ngân sách' });
  } finally { await m.unmount(); }
});

test('Sửa: đổi sang loại có thi công => tự gắn dự án, bắt buộc tên dự án + phạm vi chào (thiếu => không gọi mạng); người liên hệ lấy từ API của khách', async () => {
  const f = server();
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); const d = modal(m.container);
    assert.equal(f.gets('/customers/' + CID + '/contacts').length, 1);
    await pickField(d, /Loại cơ hội/, /^Thi công$/);
    assert.match(text(d), /Loại có thi công luôn gắn với dự án/);
    await press(d, /Lưu thay đổi/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Vui lòng nhập tên dự án/); assert.match(text(d), /Vui lòng nhập phạm vi SISCOM đang chào/);
    await fill(d, /Tên dự án/, 'KS Biển Xanh'); await fill(d, /Phạm vi SISCOM đang chào/, 'Lắp 120 FCU');
    await pickField(d, /Người liên hệ/, /Lê Bình/);
    await press(d, /Lưu thay đổi/);
    assert.deepEqual(f.writes()[0].body, { version: 3, typeId: 't-install', isProjectLinked: true, projectName: 'KS Biển Xanh', offerScope: 'Lắp 120 FCU', contactId: 'k2' });
  } finally { await m.unmount(); }
});

test('Sửa thất bại: 400 theo trường hiện đúng ô và GIỮ nội dung đã nhập; 409 => báo xung đột, đọc lại chi tiết, lần lưu sau dùng version mới; 403 hiện lỗi', async () => {
  let mode = 400;
  const f = server({
    get: (n) => res(200, { data: detail({ version: n === 1 ? 3 : 5 }) }),
    write: () => (mode === 400 ? fail(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', [{ field: 'needSummary', message: 'Phải ghi nhu cầu của khách trước khi rời giai đoạn Tiếp cận.' }])
      : mode === 409 ? fail(409, 'OPPORTUNITY_VERSION_CONFLICT', 'Cơ hội đã được người khác thay đổi.') : mode === 403 ? fail(403, 'FORBIDDEN', 'Bạn không có quyền sửa cơ hội này.') : res(200, { data: detail({ version: 6 }) })),
  });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); const d = modal(m.container);
    await fill(d, /Nhu cầu của khách/, ''); await fill(d, /Tiêu đề/, 'Tiêu đề mới'); await press(d, /Lưu thay đổi/);
    assert.match(text(d), /Phải ghi nhu cầu của khách trước khi rời giai đoạn Tiếp cận/);
    assert.equal(inputByLabel(d, /Tiêu đề/).value, 'Tiêu đề mới'); assert.ok(modal(m.container));
    mode = 409; await fill(d, /Nhu cầu của khách/, 'Cần 3 chiller'); await press(modal(m.container), /Lưu thay đổi/);
    assert.equal(f.writes().pop().body.version, 3);
    assert.ok(alerts(m.container).some((t) => /người khác thay đổi|Nội dung bạn nhập vẫn còn/.test(t)), alerts(m.container).join(' | '));
    assert.equal(f.gets('/opportunities/o1').length, 2);
    assert.equal(inputByLabel(modal(m.container), /Tiêu đề/).value, 'Tiêu đề mới');
    mode = 403; await press(modal(m.container), /Lưu thay đổi/);
    assert.equal(f.writes().pop().body.version, 5); // lần sau dùng version vừa đọc lại
    assert.ok(alerts(m.container).some((t) => /không có quyền sửa/.test(t)));
    mode = 200; await press(modal(m.container), /Lưu thay đổi/);
    assert.equal(modal(m.container), undefined);
  } finally { await m.unmount(); }
});

// PR249-R1-01 — chuỗi đầy đủ qua hộp Sửa + fetch giả có thứ tự: A sửa, B sửa trước, A nhận 409, bản mới được tải, A lưu lại.
test('PR249-R1-01: A chỉ đổi nhu cầu, B đã đổi tiền 100 -> 200; A nhận 409 rồi lưu lại => thân PATCH chỉ có nhu cầu + version mới; tiền của B còn nguyên 200', async () => {
  let saved = 0;
  const f = server({
    get: (n) => res(200, { data: n === 1 ? detail({ expectedAmountVnd: '100', needSummary: 'old', version: 3 }) : n === 2 ? detail({ expectedAmountVnd: '200', needSummary: 'old', version: 5 }) : detail({ expectedAmountVnd: '200', needSummary: 'my edit', version: 6 }) }),
    write: () => { saved += 1; return saved === 1 ? fail(409, 'OPPORTUNITY_VERSION_CONFLICT', 'Cơ hội đã được người khác thay đổi.') : res(200, { data: detail({ expectedAmountVnd: '200', needSummary: 'my edit', version: 6 }) }); },
  });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); let d = modal(m.container);
    await fill(d, /Nhu cầu của khách/, 'my edit'); await press(d, /Lưu thay đổi/);
    assert.deepEqual(f.writes()[0].body, { version: 3, needSummary: 'my edit' });
    d = modal(m.container); assert.ok(d, 'hộp thoại còn mở sau 409');
    assert.equal(f.gets('/opportunities/o1').length, 2, 'bản mới đã được tải');
    assert.equal(inputByLabel(d, /Giá trị dự kiến/).value, '200', 'ô chưa sửa nhận giá trị mới của B');
    assert.equal(inputByLabel(d, /Nhu cầu của khách/).value, 'my edit', 'ô đã sửa giữ nội dung của A');
    assert.match(text(d), /chưa sửa đã được cập nhật theo bản mới/);
    await press(d, /Lưu thay đổi/);
    assert.equal(f.writes().length, 2);
    assert.deepEqual(f.writes()[1].body, { version: 5, needSummary: 'my edit' }); // KHÔNG có expectedAmountVnd => không đưa tiền về 100
    assert.equal(modal(m.container), undefined);
  } finally { await m.unmount(); }
});

test('PR249-R1-01: A và B cùng đổi tiền (A 300, B 200) => sau 409 nút Lưu bị chặn tới khi A chọn rõ; "Giữ nội dung của tôi" => gửi 300 với version mới; "Dùng bản mới" => không ghi gì', async () => {
  const mk = () => { let saved = 0; return server({
    get: (n) => res(200, { data: n === 1 ? detail({ expectedAmountVnd: '100', version: 3 }) : detail({ expectedAmountVnd: '200', version: 5 }) }),
    write: () => { saved += 1; return saved === 1 ? fail(409, 'OPPORTUNITY_VERSION_CONFLICT', 'Cơ hội đã được người khác thay đổi.') : res(200, { data: detail({ expectedAmountVnd: '300', version: 6 }) }); },
  }); };
  const conflictBox = (d) => findAll(d, (e) => e.attributes['aria-label'] === 'Trường bị sửa đồng thời')[0];
  let f = mk(); let m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); let d = modal(m.container);
    await fill(d, /Giá trị dự kiến/, '300'); await press(d, /Lưu thay đổi/);
    d = modal(m.container); const box = conflictBox(d); assert.ok(box, 'có khối xung đột');
    assert.match(text(box), /Giá trị dự kiến/); assert.match(text(box), /200 đ/); assert.match(text(box), /300 đ/);
    assert.equal(inputByLabel(d, /Giá trị dự kiến/).value, '300');
    assert.ok(buttonByText(d, /Lưu thay đổi/).disabled, 'Lưu bị chặn khi còn xung đột');
    await doAct(() => click(buttonByText(d, /Lưu thay đổi/))); assert.equal(f.writes().length, 1, 'không có lần ghi thứ hai khi chưa xác nhận');
    await press(box, /Giữ nội dung của tôi/);
    d = modal(m.container); assert.equal(conflictBox(d), undefined); assert.equal(!!buttonByText(d, /Lưu thay đổi/).disabled, false);
    await press(d, /Lưu thay đổi/);
    assert.deepEqual(f.writes()[1].body, { version: 5, expectedAmountVnd: '300' });
  } finally { await m.unmount(); }
  f = mk(); m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); let d = modal(m.container);
    await fill(d, /Giá trị dự kiến/, '300'); await press(d, /Lưu thay đổi/);
    d = modal(m.container); await press(conflictBox(d), /Dùng bản mới/);
    d = modal(m.container); assert.equal(inputByLabel(d, /Giá trị dự kiến/).value, '200');
    await press(d, /Lưu thay đổi/);
    assert.equal(f.writes().length, 1, 'không còn gì để ghi'); assert.equal(m.toasts.pop().title, 'Không có thay đổi');
  } finally { await m.unmount(); }
});

test('PR249-R1-01 — null và xác suất qua hộp Sửa: B xoá tiền (null) trong lúc A đổi xác suất có lý do => lưu lại chỉ gửi xác suất + lý do, không gửi tiền (không đưa tiền về giá trị cũ, không thành 0)', async () => {
  let saved = 0;
  const f = server({
    get: (n) => res(200, { data: n === 1 ? detail({ expectedAmountVnd: '100', version: 3 }) : detail({ expectedAmountVnd: null, version: 5 }) }),
    write: () => { saved += 1; return saved === 1 ? fail(409, 'OPPORTUNITY_VERSION_CONFLICT', 'Cơ hội đã được người khác thay đổi.') : res(200, { data: detail({ expectedAmountVnd: null, probability: 60, version: 6 }) }); },
  });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Sửa$/); let d = modal(m.container);
    await fill(d, /^Xác suất/, '60'); await fill(d, /Lý do sửa xác suất/, 'Khách duyệt'); await press(d, /Lưu thay đổi/);
    d = modal(m.container); assert.equal(inputByLabel(d, /Giá trị dự kiến/).value, '');
    await press(d, /Lưu thay đổi/);
    assert.deepEqual(f.writes()[1].body, { version: 5, probability: 60, probabilityReason: 'Khách duyệt' });
  } finally { await m.unmount(); }
});

test('quyền: cơ hội đã Thắng không có nút Sửa; Kế toán không có nút nào; Kỹ thuật (bản theo việc) không có Sửa, không có tab Lịch sử, không gọi API lịch sử', async () => {
  const won = await viewPage(server({ get: () => res(200, { data: detail({ status: 'WON', wonAmountVnd: '980000000', closedAt: NOW }) }) }), SALES);
  try { assert.equal(actionButtons(won.container).includes('Sửa'), false); assert.deepEqual(tabs(won.container), ['Hoạt động & công việc', 'Lịch sử thay đổi', 'Tài liệu']); } finally { await won.unmount(); }
  const acct = await viewPage(server(), ACCT);
  try {
    assert.deepEqual(actionButtons(acct.container), []);
    assert.equal(buttonByText(acct.container, /Ghi nhận hoạt động/), undefined);
    await openTab(acct.container, /Tài liệu/); assert.equal(buttonByText(acct.container, /Thêm tài liệu/), undefined);
  } finally { await acct.unmount(); }
  const ft = server({ get: () => res(200, { data: techDetail() }), activities: () => actPage([activity(1, { type: 'TASK', title: 'Khảo sát', status: 'OPEN', dueAt: '2026-12-01T03:00:00.000Z' })], { access: 'TASK' }), documents: () => res(200, { data: { items: [doc('d1', 'TECHNICAL', 'ban-ve.pdf', 'https://drive.example.com/bv')], access: 'TASK' } }) });
  const tech = await viewPage(ft, TECH);
  try {
    assert.deepEqual(actionButtons(tech.container), []);
    assert.deepEqual(tabs(tech.container), ['Hoạt động & công việc', 'Tài liệu']);
    assert.match(text(panel(tech.container)), /chỉ hiện công việc của chính bạn/); assert.match(text(panel(tech.container)), /Khảo sát/);
    assert.equal(buttonByText(tech.container, /Ghi nhận hoạt động/), undefined); // có create_tech nhưng không đạt opportunity.update
    await openTab(tech.container, /Tài liệu/);
    const p = text(panel(tech.container));
    assert.match(p, /Kỹ thuật/); assert.match(p, /ban-ve\.pdf/); assert.doesNotMatch(p, /Thương mại/); assert.equal(buttonByText(tech.container, /Thêm tài liệu/), undefined);
    assert.equal(ft.gets('/opportunities/o1/changes').length, 0); assert.equal(ft.gets('/opportunities/meta').length, 0);
    assert.doesNotMatch(text(tech.container), /Giá trị|Xác suất/);
  } finally { await tech.unmount(); }
});

// ───── Tab Hoạt động & công việc ─────
test('tab Hoạt động: tải theo cơ hội (page=1, pageSize=20); lọc theo loại gửi type; "Tải thêm" nối trang không trùng dòng; dữ liệu lớn 45 dòng / 3 trang', async () => {
  const all = Array.from({ length: 45 }, (_, i) => activity(i + 1));
  const f = server({ activities: (q) => { const pg = Number(q.get('page')); const rowsOf = q.get('type') ? [activity(99, { type: 'TASK', title: 'Gửi báo giá', status: 'OPEN', dueAt: '2027-01-01T03:00:00.000Z' })] : all.slice((pg - 1) * 20, pg * 20).concat(pg === 2 ? [all[19]] : []); return actPage(rowsOf, { page: pg, total: q.get('type') ? 1 : 45, totalPages: q.get('type') ? 1 : 3 }); } });
  const m = await viewPage(f, SALES);
  try {
    const q = f.gets('/opportunities/o1/activities')[0].q;
    assert.deepEqual([q.get('page'), q.get('pageSize'), q.get('type'), q.get('status')], ['1', '20', null, null]);
    assert.match(text(panel(m.container)), /20 \/ 45 hoạt động/); assert.match(text(panel(m.container)), /Nội dung hoạt động 1/);
    await press(panel(m.container), /Tải thêm/);
    assert.match(text(panel(m.container)), /40 \/ 45 hoạt động/); // dòng trùng (a20) không bị nhân đôi
    await press(panel(m.container), /Tải thêm/);
    assert.match(text(panel(m.container)), /45 \/ 45 hoạt động/); assert.equal(buttonByText(panel(m.container), /Tải thêm/), undefined);
    assert.equal(byTag(panel(m.container), 'li').length, 45);
    await pickGroup(m.container, 'Lọc hoạt động theo loại', /Công việc/);
    const last = f.gets('/opportunities/o1/activities').pop().q;
    assert.deepEqual([last.get('type'), last.get('page')], ['TASK', '1']);
    assert.match(text(panel(m.container)), /Gửi báo giá/); assert.match(text(panel(m.container)), /1 \/ 1 hoạt động/);
  } finally { await m.unmount(); }
});

test('tab Hoạt động: không có dữ liệu => trạng thái trống có hướng dẫn; lỗi API 500 => báo lỗi + Thử lại; mất mạng => báo lỗi', async () => {
  const empty = await viewPage(server(), SALES);
  try { assert.match(text(panel(empty.container)), /Chưa có hoạt động nào/); assert.match(text(panel(empty.container)), /Bấm "Ghi nhận hoạt động"/); } finally { await empty.unmount(); }
  const f = server({ activities: (q, n) => (n === 1 ? fail(500, 'INTERNAL', 'Máy chủ lỗi') : actPage([activity(1)])) });
  const m = await viewPage(f, SALES);
  try {
    assert.ok(findAll(panel(m.container), (e) => e.attributes.role === 'alert').length, 'có báo lỗi'); assert.doesNotMatch(text(panel(m.container)), /Nội dung hoạt động 1/);
    await press(panel(m.container), /Thử lại/);
    assert.match(text(panel(m.container)), /Nội dung hoạt động 1/); assert.equal(findAll(panel(m.container), (e) => e.attributes.role === 'alert').length, 0);
  } finally { await m.unmount(); }
  const down = server(); const net = async (url, init) => { if (/\/activities/.test(url)) throw new TypeError('fetch failed'); return down(url, init); };
  const off = await viewPage(net, SALES);
  try { assert.ok(findAll(panel(off.container), (e) => e.attributes.role === 'alert').length, 'mất mạng có báo lỗi'); } finally { await off.unmount(); }
});

test('Ghi nhận hoạt động cho cơ hội: thiếu nội dung / công việc thiếu hạn => không gọi mạng; đủ => POST /opportunities/:id/activities, danh sách đọc lại; 400 hiện lỗi và giữ nội dung', async () => {
  let bad = false;
  const f = server({ activities: (q, n) => actPage(n === 1 ? [] : [activity(7, { content: 'Đã gọi anh An' })]), write: (p) => (bad ? fail(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', ['Thời điểm diễn ra không được quá 1 ngày sau hiện tại (trừ lịch hẹn MEETING).']) : res(201, { data: activity(7, { content: 'Đã gọi anh An' }) })) });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /Ghi nhận hoạt động/); let d = modal(m.container); assert.ok(d);
    assert.deepEqual(findAll(d, (e) => e.attributes.role === 'radio').map((e) => text(e)), ['Cuộc gọi', 'Email', 'Gặp mặt', 'Khảo sát hiện trường', 'Ghi chú', 'Công việc']);
    await press(d, /^Lưu$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Vui lòng nhập nội dung/);
    await doAct(() => click(findAll(d, (e) => e.attributes.role === 'radio' && text(e) === 'Công việc')[0]));
    assert.match(text(d), /được giao cho chính bạn/); assert.match(text(d), /không phụ trách khách hàng này/); // R1 MINOR #249: chỉ dẫn rõ giới hạn tự nhận việc
    await fill(d, /Nội dung/, 'Gửi báo giá'); await press(d, /^Lưu$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Công việc phải có hạn/);
    await doAct(() => click(findAll(d, (e) => e.attributes.role === 'radio' && text(e) === 'Cuộc gọi')[0]));
    await fill(d, /Nội dung/, 'Đã gọi anh An'); await press(d, /^Lưu$/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.deepEqual([w[0].method, w[0].p, w[0].body], ['POST', '/opportunities/o1/activities', { type: 'CALL', content: 'Đã gọi anh An' }]);
    assert.equal(modal(m.container), undefined); assert.match(m.toasts.pop().title, /Đã ghi nhận cuộc gọi/);
    assert.ok(f.gets('/opportunities/o1/activities').length >= 2); assert.match(text(panel(m.container)), /Đã gọi anh An/);
    bad = true;
    await press(m.container, /Ghi nhận hoạt động/); d = modal(m.container);
    await fill(d, /Nội dung/, 'Thử lỗi'); await press(d, /^Lưu$/);
    assert.match(text(d), /không được quá 1 ngày sau hiện tại/); assert.equal(inputByLabel(d, /Nội dung/).value, 'Thử lỗi'); assert.ok(modal(m.container));
  } finally { await m.unmount(); }
});

test('Ghi nhận hoạt động: Kinh doanh không thấy nút trên cơ hội của người khác; Quản trị CRM thấy', async () => {
  const other = () => res(200, { data: detail({ owner: { id: 'e-other', code: 'NV-9', fullName: 'Người khác' } }) });
  const s = await viewPage(server({ get: other }), SALES);
  try { assert.equal(buttonByText(s.container, /Ghi nhận hoạt động/), undefined); await openTab(s.container, /Tài liệu/); assert.equal(buttonByText(s.container, /Thêm tài liệu/), undefined); } finally { await s.unmount(); }
  const a = await viewPage(server({ get: other }), ADMIN);
  try { assert.ok(buttonByText(a.container, /Ghi nhận hoạt động/)); await openTab(a.container, /Tài liệu/); assert.ok(buttonByText(a.container, /Thêm tài liệu/)); } finally { await a.unmount(); }
});

// ───── Tab Lịch sử thay đổi ─────
test('tab Lịch sử: chỉ gọi API khi mở tab; giá trị trống hiện "Chưa rõ" (KHÔNG phải 0); giai đoạn hiện tên; có lý do, người sửa; không lộ id người phụ trách', async () => {
  const by = { id: 'e2', code: 'NV-0002', fullName: 'Lê Thị Hai' };
  const f = server({ changes: () => res(200, { data: { items: [
    { id: 'c1', field: 'AMOUNT', oldValue: null, newValue: '7200000000', reason: null, changedAt: NOW, changedBy: by },
    { id: 'c2', field: 'STAGE', oldValue: 'PROSPECTING', newValue: 'QUOTATION', reason: null, changedAt: NOW, changedBy: by },
    { id: 'c3', field: 'PROBABILITY', oldValue: '10', newValue: '60', reason: 'Khách duyệt ngân sách', changedAt: NOW, changedBy: by },
    { id: 'c4', field: 'OWNER', oldValue: 'uuid-cu-1111', newValue: 'uuid-moi-2222', reason: 'Đổi địa bàn', changedAt: NOW, changedBy: by },
    { id: 'c5', field: 'AMOUNT', oldValue: '7200000000', newValue: null, reason: null, changedAt: NOW, changedBy: by },
  ] } }) });
  const m = await viewPage(f, SALES);
  try {
    assert.equal(f.gets('/opportunities/o1/changes').length, 0);
    await openTab(m.container, /Lịch sử thay đổi/);
    assert.equal(f.gets('/opportunities/o1/changes').length, 1);
    const p = text(panel(m.container));
    assert.match(p, /Giá trị dự kiến\s*Chưa rõ → 7\.200\.000\.000 đ/); assert.match(p, /7\.200\.000\.000 đ → Chưa rõ/); noZero(p);
    assert.match(p, /Giai đoạn\s*Tiếp cận → Báo giá/); assert.match(p, /10% → 60%/); assert.match(p, /Lý do: Khách duyệt ngân sách/); assert.match(p, /Lê Thị Hai/);
    assert.match(p, /Đã chuyển người phụ trách/); assert.match(p, /Lý do: Đổi địa bàn/); assert.doesNotMatch(p, /uuid-/);
    assert.equal(byTag(panel(m.container), 'li').length, 5);
  } finally { await m.unmount(); }
});

test('T-02 + T-03 tab Lịch sử: trang đầu + "Tải thêm" nối trang kế tiếp (không trùng dòng), hết trang thì không còn nút; người phụ trách hiện "Chuyển từ <cũ> sang <mới>"', async () => {
  const by = { id: 'e2', code: 'NV-0002', fullName: 'Lê Thị Hai' };
  const ch = (id, over = {}) => ({ id, field: 'PROBABILITY', oldValue: '10', newValue: '20', reason: null, changedAt: NOW, changedBy: by, ...over });
  const owner = ch('c1', { field: 'OWNER', oldValue: 'uuid-cu', newValue: 'uuid-moi', oldOwner: { id: 'uuid-cu', code: 'NV-0007', fullName: 'Phạm Cũ' }, newOwner: { id: 'uuid-moi', code: 'NV-0008', fullName: 'Võ Mới' } });
  const f = server({ changes: (n, q) => (q.get('page') === '2'
    ? res(200, { data: { items: [ch('c2'), ch('c3')], page: 2, pageSize: 50, total: 3, totalPages: 2 } })
    : res(200, { data: { items: [owner, ch('c2')], page: 1, pageSize: 50, total: 3, totalPages: 2 } })) });
  const m = await viewPage(f, SALES);
  try {
    await openTab(m.container, /Lịch sử thay đổi/);
    const first = f.gets('/opportunities/o1/changes'); assert.equal(first.length, 1);
    assert.deepEqual([first[0].q.get('page'), first[0].q.get('pageSize')], ['1', '50']);
    assert.equal(byTag(panel(m.container), 'li').length, 2);
    const p = text(panel(m.container));
    assert.match(p, /Chuyển từ Phạm Cũ sang Võ Mới/); assert.doesNotMatch(p, /uuid-/); assert.match(p, /2 \/ 3 thay đổi/);
    await press(panel(m.container), /Tải thêm/);
    const all = f.gets('/opportunities/o1/changes'); assert.equal(all.length, 2); assert.equal(all[1].q.get('page'), '2');
    assert.equal(byTag(panel(m.container), 'li').length, 3, 'nối trang 2, bỏ dòng trùng c2');
    assert.equal(buttonByText(panel(m.container), /Tải thêm/), undefined);
  } finally { await m.unmount(); }
});

// Review Astra #259 (HIGH): đã tải trang 2/3; sửa cơ hội => version đổi => tải lại trang 1 (đang chờ). Bấm "Tải thêm" lúc này KHÔNG được xin trang 3
// (nếu không: trang 1 mới + trang 3 cũ, mất trang 2, nút biến mất). Tải lại xong => danh sách là trang 1 mới, "Tải thêm" dùng lại được.
test('T-02 tab Lịch sử: đang tải lại trang 1 sau khi sửa (version đổi) thì "Tải thêm" bị khoá, không xin trang kế của dữ liệu cũ', async () => {
  const by = { id: 'e2', code: 'NV-0002', fullName: 'Lê Thị Hai' };
  const ch = (id) => ({ id, field: 'PROBABILITY', oldValue: '10', newValue: '20', reason: null, changedAt: NOW, changedBy: by });
  let release; let page1Calls = 0;
  const f = server({
    get: (n) => res(200, { data: detail(n === 1 ? {} : { version: 4, title: 'Bán 150 FCU' }) }),
    changes: (n, q) => {
      const pg = q.get('page');
      if (pg === '1') { page1Calls += 1; if (page1Calls === 2) return new Promise((r) => { release = () => r(res(200, { data: { items: [ch('c0'), ch('c1')], page: 1, pageSize: 50, total: 7, totalPages: 4 } })); }); return res(200, { data: { items: [ch('c1'), ch('c2')], page: 1, pageSize: 50, total: 6, totalPages: 3 } }); }
      if (pg === '2') return res(200, { data: { items: [ch('c3'), ch('c4')], page: 2, pageSize: 50, total: 6, totalPages: 3 } });
      return res(200, { data: { items: [ch('c5'), ch('c6')], page: Number(pg), pageSize: 50, total: 6, totalPages: 3 } });
    },
  });
  const m = await viewPage(f, SALES);
  try {
    await openTab(m.container, /Lịch sử thay đổi/);
    await press(panel(m.container), /Tải thêm/);
    assert.equal(byTag(panel(m.container), 'li').length, 4, 'đã tải trang 1 + 2');
    await press(m.container, /^Sửa$/); await fill(modal(m.container), /Tiêu đề/, 'Bán 150 FCU'); await press(modal(m.container), /Lưu thay đổi/);
    assert.equal(page1Calls, 2, 'version đổi => đọc lại trang 1 (đang chờ)');
    const more = buttonByText(panel(m.container), /Tải thêm/); assert.ok(more, 'vẫn hiện nút trong lúc tải lại');
    assert.equal(more.disabled, true, 'nút Tải thêm bị khoá khi đang tải lại');
    await doAct(() => click(more));
    assert.deepEqual(f.gets('/opportunities/o1/changes').map((c) => c.q.get('page')), ['1', '2', '1'], 'KHÔNG xin trang 3 của dữ liệu cũ');
    await doAct(async () => { release(); });
    assert.deepEqual(byTag(panel(m.container), 'li').length, 2, 'danh sách = trang 1 mới');
    const again = buttonByText(panel(m.container), /Tải thêm/); assert.ok(again); assert.notEqual(again.disabled, true, 'tải lại xong => mở khoá');
  } finally { await m.unmount(); }
});

test('tab Lịch sử: chưa có thay đổi => trạng thái trống; máy chủ từ chối 403 => báo lỗi, không hiện dữ liệu', async () => {
  const empty = await viewPage(server(), SALES);
  try { await openTab(empty.container, /Lịch sử thay đổi/); assert.match(text(panel(empty.container)), /Chưa có thay đổi nào được ghi lại/); } finally { await empty.unmount(); }
  const denied = await viewPage(server({ changes: () => fail(403, 'FORBIDDEN', 'Lịch sử thay đổi chỉ dành cho người xem đầy đủ cơ hội.') }), SALES);
  try { await openTab(denied.container, /Lịch sử thay đổi/); assert.ok(alerts(denied.container).length); assert.equal(byTag(panel(denied.container), 'li').length, 0); } finally { await denied.unmount(); }
});

// ───── Tab Tài liệu ─────
test('tab Tài liệu: chia nhóm Kỹ thuật / Thương mại; chỉ đường dẫn https thành liên kết (javascript: thì không); Kế toán chỉ xem', async () => {
  const docs = () => res(200, { data: { items: [doc('d1', 'TECHNICAL', 'ban-ve.pdf', 'https://drive.example.com/bv'), doc('d2', 'COMMERCIAL', 'bao-gia.xlsx', 'https://drive.example.com/bg'), doc('d3', 'COMMERCIAL', 'xau.pdf', 'javascript:alert(1)')], access: 'FULL' } });
  const m = await viewPage(server({ documents: docs }), ACCT);
  try {
    await openTab(m.container, /Tài liệu/);
    const p = panel(m.container); const t = text(p);
    assert.match(t, /Kỹ thuật\s*1/); assert.match(t, /Thương mại\s*2/); assert.match(t, /ban-ve\.pdf/); assert.match(t, /xau\.pdf/);
    const links = byTag(p, 'a').map((a) => [text(a), a.attributes.href, a.attributes.rel, a.attributes.target]);
    assert.deepEqual(links, [['ban-ve.pdf', 'https://drive.example.com/bv', 'noopener noreferrer', '_blank'], ['bao-gia.xlsx', 'https://drive.example.com/bg', 'noopener noreferrer', '_blank']]);
    assert.equal(findAll(p, (e) => /^Xoá tài liệu/.test(e.attributes['aria-label'] || '')).length, 0);
    assert.equal(buttonByText(p, /Thêm tài liệu/), undefined);
  } finally { await m.unmount(); }
});

test('tab Tài liệu: thêm — đường dẫn không phải https bị chặn tại chỗ; đủ => POST đúng thân, danh sách đọc lại. Xoá — bắt buộc lý do, DELETE kèm lý do ở thân', async () => {
  let n = 0;
  const f = server({ documents: () => { n += 1; return res(200, { data: { items: n === 1 ? [] : n === 2 ? [doc('d1', 'COMMERCIAL', 'bao-gia.xlsx', 'https://drive.example.com/bg')] : [], access: 'FULL' } }); },
    write: (p, body, method) => (method === 'DELETE' ? res(200, { data: { id: 'd1', deleted: true } }) : res(201, { data: doc('d1', body.kind, body.fileName, body.url) })) });
  const m = await viewPage(f, SALES);
  try {
    await openTab(m.container, /Tài liệu/);
    assert.match(text(panel(m.container)), /Chưa có tài liệu nào/);
    await press(panel(m.container), /Thêm tài liệu/); let d = modal(m.container);
    await fill(d, /Tên tệp/, 'bao-gia.xlsx'); await fill(d, /Đường dẫn/, 'http://drive.example.com/bg'); await press(d, /^Thêm tài liệu$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /https hợp lệ/);
    await fill(d, /Đường dẫn/, 'https://drive.example.com/bg'); await pickField(d, /Nhóm tài liệu/, /Thương mại/); await press(d, /^Thêm tài liệu$/);
    assert.deepEqual([f.writes()[0].method, f.writes()[0].p, f.writes()[0].body], ['POST', '/opportunities/o1/documents', { kind: 'COMMERCIAL', fileName: 'bao-gia.xlsx', url: 'https://drive.example.com/bg' }]);
    assert.equal(modal(m.container), undefined); assert.equal(f.gets('/opportunities/o1/documents').length, 2); assert.match(text(panel(m.container)), /bao-gia\.xlsx/);
    await doAct(() => click(findAll(panel(m.container), (e) => e.attributes['aria-label'] === 'Xoá tài liệu bao-gia.xlsx')[0])); d = modal(m.container); assert.ok(d);
    await press(d, /^Xoá tài liệu$/);
    assert.equal(f.writes().length, 1); assert.match(text(d), /Xoá tài liệu phải ghi lý do/);
    await fill(d, /Lý do xoá/, 'Nhầm tệp'); await press(d, /^Xoá tài liệu$/);
    assert.deepEqual([f.writes()[1].method, f.writes()[1].p, f.writes()[1].body], ['DELETE', '/opportunities/o1/documents/d1', { reason: 'Nhầm tệp' }]);
    assert.equal(f.gets('/opportunities/o1/documents').length, 3); assert.match(text(panel(m.container)), /Chưa có tài liệu nào/);
    assert.equal(f.gets('/opportunities').length, 0); // không đụng danh sách cơ hội
  } finally { await m.unmount(); }
});

test('tab Tài liệu: lỗi API khi tải => báo lỗi + Thử lại; thêm bị máy chủ từ chối 403 => hiện lỗi, giữ hộp thoại', async () => {
  const f = server({ documents: (n) => (n === 1 ? fail(500, 'INTERNAL', 'Máy chủ lỗi') : res(200, { data: { items: [], access: 'FULL' } })), write: () => fail(403, 'FORBIDDEN', 'Bạn không có quyền thêm tài liệu.') });
  const m = await viewPage(f, SALES);
  try {
    await openTab(m.container, /Tài liệu/);
    assert.ok(findAll(panel(m.container), (e) => e.attributes.role === 'alert').length);
    await press(panel(m.container), /Thử lại/);
    assert.match(text(panel(m.container)), /Chưa có tài liệu nào/);
    await press(panel(m.container), /Thêm tài liệu/); const d = modal(m.container);
    await fill(d, /Tên tệp/, 'a.pdf'); await fill(d, /Đường dẫn/, 'https://a.example/x'); await press(d, /^Thêm tài liệu$/);
    assert.ok(modal(m.container)); assert.ok(alerts(m.container).some((t) => /không có quyền thêm tài liệu/.test(t)));
  } finally { await m.unmount(); }
});

// ───── Danh sách đã xoá + Khôi phục ─────
test('đã xoá (Quản trị CRM): nút "Đã xoá" gọi deleted=only; dòng không mở được chi tiết, có "Khôi phục"; khôi phục gửi version, đọc lại danh sách; "Về danh sách" bỏ deleted', async () => {
  const f = server({ list: (q, n) => (q.get('deleted') ? page(n <= 2 ? [item(1, { deletedAt: NOW, expectedAmountVnd: null }), item(2, { deletedAt: NOW, version: 9 })] : [item(1, { deletedAt: NOW })]) : page([item(5)])) });
  const m = await listPage(f, ADMIN);
  try {
    assert.equal(f.gets('/opportunities')[0].q.get('deleted'), null);
    assert.ok(byTag(rows(m.container)[0], 'a').length, 'danh sách thường: tiêu đề là liên kết');
    await press(m.container, /^Đã xoá$/);
    assert.equal(f.gets('/opportunities').pop().q.get('deleted'), 'only');
    const r = rows(m.container); assert.equal(r.length, 2);
    assert.equal(byTag(r[0], 'a').length, 0); assert.match(text(r[0]), /Chưa rõ/); noZero(text(r[0])); assert.match(text(r[1]), /Khôi phục/);
    assert.equal(buttonByText(m.container, /Tạo cơ hội/), undefined); assert.match(text(m.container), /Đang xem các cơ hội đã xoá/);
    await press(r[1], /^Khôi phục$/); const d = modal(m.container); assert.ok(d); assert.match(text(d), /CH-0002/);
    await press(d, /^Khôi phục$/);
    assert.deepEqual([f.writes()[0].method, f.writes()[0].p, f.writes()[0].body], ['POST', '/opportunities/o2/restore', { version: 9 }]);
    assert.equal(modal(m.container), undefined); assert.equal(m.toasts.pop().title, 'Đã khôi phục cơ hội');
    assert.equal(f.gets('/opportunities').pop().q.get('deleted'), 'only'); assert.equal(rows(m.container).length, 1);
    await press(m.container, /^Về danh sách$/);
    assert.equal(f.gets('/opportunities').pop().q.get('deleted'), null); assert.match(text(rows(m.container)[0]), /CH-0005/);
  } finally { await m.unmount(); }
});

test('đã xoá: không có cơ hội đã xoá => trạng thái trống riêng; khách còn bị xoá (409) => hiện đúng thông báo của máy chủ, giữ hộp thoại; bản điện thoại có nút Khôi phục', async () => {
  const empty = await listPage(server({ list: (q) => page(q.get('deleted') ? [] : [item(1)]) }), ADMIN);
  try { await press(empty.container, /^Đã xoá$/); assert.match(text(empty.container), /Không có cơ hội đã xoá/); } finally { await empty.unmount(); }
  const f = server({ list: (q) => page(q.get('deleted') ? [item(1, { deletedAt: NOW })] : [item(5)]), write: () => fail(409, 'OPPORTUNITY_CUSTOMER_DELETED', 'Khách hàng của cơ hội đang bị xoá; hãy khôi phục khách hàng trước.') });
  const m = await listPage(f, ADMIN, { mobile: true });
  try {
    await press(m.container, /^Đã xoá$/);
    assert.equal(byTag(m.container, 'table').length, 0); assert.equal(byTag(m.container, 'a').length, 0);
    await press(m.container, /^Khôi phục$/); const d = modal(m.container);
    await press(d, /^Khôi phục$/);
    assert.ok(modal(m.container)); assert.ok(alerts(m.container).some((t) => /khôi phục khách hàng trước/.test(t)), alerts(m.container).join(' | '));
  } finally { await m.unmount(); }
});

test('đã xoá: Kinh doanh, Kế toán, Kỹ thuật KHÔNG có nút "Đã xoá" và không bao giờ gọi deleted=only', async () => {
  for (const r of [SALES, ACCT, TECH]) {
    const f = server();
    const m = await listPage(f, r);
    try { assert.equal(buttonByText(m.container, /^Đã xoá$/), undefined); assert.ok(f.gets('/opportunities').every((c) => c.q.get('deleted') === null)); } finally { await m.unmount(); }
  }
});
