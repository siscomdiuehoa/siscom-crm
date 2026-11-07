// Run: node --test tests/activityApiUi.test.mjs   (Node >= 18; vite + react đã có). Fetch giả lập; không mạng, không DB, không trình duyệt.
// B3 A7: tab Hoạt động trên trang chi tiết khách (API mode) + drawer "Ghi nhận hoạt động" — chỉ dùng API A5 (GET/POST /customers/:id/activities,
// GET /activities/assignee-candidates). Quyền giao diện fail-closed theo can(); máy chủ luôn kiểm lại.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, buttonByText, inputByLabel, click, type, keydown } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const apiCust = () => ({ id: ID, code: 'KH-00007', name: 'Công ty A', short: 'A', phone: '028 3822 1234', version: 2 });
const act1 = (over = {}) => ({ id: 'a1', code: 'HD-000001', customerId: ID, type: 'CALL', title: null, content: 'Gọi chào giá máy lạnh', outcome: 'Hẹn gửi báo giá', occurredAt: '2026-11-05T02:30:00.000Z', dueAt: null, remindAt: null, status: 'DONE', completedAt: null, completedById: null, performedBy: { id: 'e1', code: 'NV-001', fullName: 'Trần Sale' }, contact: null, createdById: 'e1', version: 1, createdAt: '2026-11-05T02:30:00.000Z', updatedAt: '2026-11-05T02:30:00.000Z', ...over });
const page = (items, over = {}) => ({ data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over } });

// list(q): body cho GET /activities (q = URLSearchParams). post(body): response cho POST.
const server = ({ list = () => page([act1()]), post, cands = () => res(200, { data: { items: [{ id: 'e2', code: 'NV-002', fullName: 'Lê Kỹ Thuật', departmentCode: 'KT' }] } }), contacts = () => [] } = {}) => {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname; const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, q: u.searchParams, body });
    if (p.endsWith('/activities/assignee-candidates')) return cands(u.searchParams);
    if (p.endsWith('/activities') && method === 'GET') { const r = list(u.searchParams); return typeof r.status === 'number' ? r : res(200, r); }
    if (p.endsWith('/activities') && method === 'POST') return post ? post(body) : res(201, { data: act1({ id: 'a9', type: body.type, content: body.content }) });
    if (p.endsWith('/contacts')) return res(200, { data: { items: contacts() } });
    return res(200, { data: apiCust() });
  };
  f.calls = calls;
  f.gets = () => calls.filter((c) => c.method === 'GET' && c.p.endsWith('/customers/' + ID + '/activities'));
  f.posts = () => calls.filter((c) => c.method === 'POST' && c.p.endsWith('/activities'));
  f.candGets = () => calls.filter((c) => c.p.endsWith('/activities/assignee-candidates'));
  return f;
};

let vite; let dom; let createCustomerApiUi; let CustomerApiDetail; let createRoot; let act;
before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
  ({ default: CustomerApiDetail } = await vite.ssrLoadModule('/src/features/customers/CustomerApiDetail.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const grants = (...keys) => (a) => keys.includes(a);
const SALES = grants('customer.read', 'customer.update', 'contact.read', 'activity.read', 'activity.create', 'activity.update_own');
const TECH = grants('customer.read', 'activity.read', 'activity.create_tech');
const ACCT = grants('customer.read', 'activity.read');
const ADMIN = grants('customer.read', 'customer.update', 'contact.read', 'activity.read', 'activity.create', 'activity.assign');

async function mount(fetchImpl, can, extra = {}) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const confirms = [];
  const ui = { can, customerApi: ctl, toast: (t) => toasts.push(t), confirm: (o) => confirms.push(o), db: { customers: [] }, navigate() {}, ...extra };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(React.createElement(CustomerApiDetail, { ui, id: ID })); }); await flush(); await flush();
  return { ctl, toasts, confirms, container, unmount: () => act(async () => root.unmount()) };
}
const tab = (root, re) => findAll(root, (e) => e.attributes.role === 'tab' && re.test(text(e)))[0];
const byAria = (root, label) => findAll(root, (e) => e.attributes['aria-label'] === label);
const dialog = (root) => findAll(root, (e) => e.attributes.role === 'dialog' && e.attributes['aria-label'] === 'Ghi nhận hoạt động')[0];
const openTab = async (m) => { await doAct(() => click(tab(m.container, /^Hoạt động/))); };
const openDrawer = async (m) => { const b = byAria(m.container, 'Ghi nhận hoạt động').find((e) => e.tagName === 'BUTTON'); assert.ok(b, 'có nút Ghi nhận hoạt động'); await doAct(() => click(b)); };
const chips = (d) => findAll(d, (e) => e.attributes.role === 'radio').map((e) => text(e));
// Select của DS: bấm nút mở rồi bấm option theo chữ. Ô có nhãn (Field) hoặc nút có aria-label.
async function pick(root, labelRe, optionRe) {
  const field = findAll(root, (e) => e.attributes.class === 'sg-field' && findAll(e, (l) => l.tagName === 'LABEL' && labelRe.test(text(l))).length)[0];
  const trigger = field ? findAll(field, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]
    : findAll(root, (e) => e.attributes['aria-label'] && labelRe.test(e.attributes['aria-label']) && findAll(e, (b) => b.tagName === 'BUTTON').length).map((w) => findAll(w, (b) => b.tagName === 'BUTTON')[0])[0];
  assert.ok(trigger, 'có ô chọn ' + labelRe);
  await doAct(() => click(trigger));
  const opt = findAll(root, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0];
  assert.ok(opt, 'có lựa chọn ' + optionRe);
  await doAct(() => click(opt));
}

test('có activity.read: hiện tab "Hoạt động (n)", tải trang 1 (pageSize 20) và hiển thị mục theo giờ VN', async () => {
  const f = server(); const m = await mount(f, SALES);
  try {
    assert.ok(tab(m.container, /^Thông tin/));
    assert.match(text(tab(m.container, /^Hoạt động/)), /Hoạt động\s*1/);
    assert.equal(f.gets().length, 1);
    assert.equal(f.gets()[0].q.get('page'), '1'); assert.equal(f.gets()[0].q.get('pageSize'), '20');
    await openTab(m);
    const t = text(m.container);
    assert.match(t, /Cuộc gọi/); assert.match(t, /Gọi chào giá máy lạnh/); assert.match(t, /Hẹn gửi báo giá/);
    assert.match(t, /09:30 05\/11\/2026/); assert.match(t, /Trần Sale/);
    assert.doesNotMatch(t, /Mã số thuế/); // tab Thông tin đã ẩn
  } finally { await m.unmount(); }
});

test('không có activity.read: không có tab, không gọi /activities (trang như trước)', async () => {
  const f = server(); const m = await mount(f, grants('customer.read', 'customer.update'));
  try {
    assert.equal(tab(m.container, /^Hoạt động/), undefined);
    assert.equal(f.gets().length, 0);
    assert.match(text(m.container), /Mã số thuế/);
  } finally { await m.unmount(); }
});

test('kế toán (chỉ activity.read): nút "Ghi nhận hoạt động" bị mờ, không mở được drawer', async () => {
  const f = server(); const m = await mount(f, ACCT);
  try {
    await openTab(m);
    const b = byAria(m.container, 'Ghi nhận hoạt động').find((e) => e.tagName === 'BUTTON');
    assert.ok(b && b.disabled);
    click(b); await flush();
    assert.equal(dialog(m.container), undefined);
  } finally { await m.unmount(); }
});

test('kỹ thuật (chỉ create_tech): drawer chỉ có 3 loại; không có ô người phụ trách; không gọi ứng viên', async () => {
  const f = server(); const m = await mount(f, TECH);
  try {
    await openTab(m); await openDrawer(m);
    const d = dialog(m.container); assert.ok(d);
    assert.deepEqual(chips(d), ['Khảo sát hiện trường', 'Ghi chú', 'Công việc']);
    assert.doesNotMatch(text(d), /Người phụ trách/);
    assert.equal(f.candGets().length, 0);
  } finally { await m.unmount(); }
});

test('sale ghi nhận cuộc gọi: POST đúng thân (không người tạo/khách), đọc lại danh sách, đóng drawer, báo toast', async () => {
  const f = server(); const m = await mount(f, SALES);
  try {
    await openTab(m); await openDrawer(m);
    const d = dialog(m.container);
    assert.deepEqual(chips(d), ['Cuộc gọi', 'Email', 'Gặp mặt', 'Khảo sát hiện trường', 'Ghi chú', 'Công việc']);
    type(inputByLabel(d, /^Nội dung/), 'Gọi xác nhận lịch khảo sát'); await flush();
    type(inputByLabel(d, /^Kết quả/), 'Khách đồng ý thứ 6'); await flush();
    type(inputByLabel(d, /^Thời điểm/), '2026-11-05T09:30'); await flush();
    await doAct(() => click(buttonByText(d, /^Lưu$/)));
    assert.equal(f.posts().length, 1);
    assert.deepEqual(f.posts()[0].body, { type: 'CALL', content: 'Gọi xác nhận lịch khảo sát', outcome: 'Khách đồng ý thứ 6', occurredAt: '2026-11-05T09:30:00+07:00' });
    assert.equal(f.gets().length, 2); // đọc lại từ máy chủ, không tự chèn
    assert.equal(dialog(m.container), undefined);
    assert.equal(m.toasts.length, 1); assert.match(m.toasts[0].title || m.toasts[0].message || '', /Đã ghi nhận/);
  } finally { await m.unmount(); }
});

test('công việc thiếu hạn: báo tại ô, KHÔNG gửi POST', async () => {
  const f = server(); const m = await mount(f, SALES);
  try {
    await openTab(m); await openDrawer(m);
    const d0 = dialog(m.container);
    await doAct(() => click(findAll(d0, (e) => e.attributes.role === 'radio' && text(e) === 'Công việc')[0]));
    const d = dialog(m.container);
    assert.ok(inputByLabel(d, /^Tiêu đề/)); assert.ok(inputByLabel(d, /^Hạn/)); assert.equal(inputByLabel(d, /^Thời điểm/), null);
    type(inputByLabel(d, /^Nội dung/), 'Gửi báo giá'); await flush();
    await doAct(() => click(buttonByText(d, /^Lưu$/)));
    assert.equal(f.posts().length, 0);
    assert.match(text(dialog(m.container)), /Công việc phải có hạn/);
  } finally { await m.unmount(); }
});

test('máy chủ trả 400: lỗi gắn đúng ô, drawer giữ nguyên nội dung; 403 hiện hộp lỗi', async () => {
  let n = 0;
  const f = server({ post: () => (++n === 1
    ? res(400, { error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu gửi lên không hợp lệ.', details: ['Thời điểm diễn ra không được quá 1 ngày sau hiện tại (trừ lịch hẹn MEETING).'] } })
    : res(403, { error: { code: 'ACTIVITY_TYPE_NOT_ALLOWED', message: 'Không được tạo loại hoạt động này.' } })) });
  const m = await mount(f, SALES);
  try {
    await openTab(m); await openDrawer(m);
    let d = dialog(m.container);
    type(inputByLabel(d, /^Nội dung/), 'Gọi'); await flush();
    type(inputByLabel(d, /^Thời điểm/), '2026-12-30T09:30'); await flush();
    await doAct(() => click(buttonByText(d, /^Lưu$/)));
    d = dialog(m.container); assert.ok(d);
    assert.match(text(d), /không được quá 1 ngày/);
    assert.equal(inputByLabel(d, /^Nội dung/).value, 'Gọi');
    await doAct(() => click(buttonByText(d, /^Lưu$/)));
    d = dialog(m.container);
    assert.ok(findAll(d, (e) => e.attributes.role === 'alert').length >= 1);
    assert.match(text(d), /Không đủ quyền/);
  } finally { await m.unmount(); }
});

test('có activity.assign: ô "Người phụ trách" lấy ứng viên của khách; chọn người => gửi performedById', async () => {
  const f = server(); const m = await mount(f, ADMIN);
  try {
    await openTab(m); await openDrawer(m);
    assert.equal(f.candGets().length, 1); assert.equal(f.candGets()[0].q.get('customerId'), ID);
    const d = dialog(m.container);
    await pick(d, /^Người phụ trách/, /Lê Kỹ Thuật/);
    type(inputByLabel(dialog(m.container), /^Nội dung/), 'Ghi chú bàn giao'); await flush();
    await doAct(() => click(buttonByText(dialog(m.container), /^Lưu$/)));
    assert.equal(f.posts()[0].body.performedById, 'e2');
  } finally { await m.unmount(); }
});

test('bộ lọc loại => tải lại trang 1 với type; "Tải thêm" nối trang 2', async () => {
  const many = Array.from({ length: 20 }, (_, i) => act1({ id: 'p1-' + i, content: 'Mục ' + i }));
  const f = server({ list: (q) => (q.get('page') === '2' ? page([act1({ id: 'p2-0', content: 'Mục trang hai' })], { page: 2, total: 21, totalPages: 2 }) : page(q.get('type') ? [act1()] : many, q.get('type') ? {} : { total: 21, totalPages: 2 })) });
  const m = await mount(f, SALES);
  try {
    await openTab(m);
    await doAct(() => click(buttonByText(m.container, /^Tải thêm/)));
    assert.equal(f.gets().at(-1).q.get('page'), '2');
    assert.match(text(m.container), /Mục trang hai/);
    assert.equal(buttonByText(m.container, /^Tải thêm/), undefined);
    await pick(m.container, /^Lọc theo loại/, /^Cuộc gọi$/);
    assert.equal(f.gets().at(-1).q.get('type'), 'CALL'); assert.equal(f.gets().at(-1).q.get('page'), '1');
  } finally { await m.unmount(); }
});

test('danh sách rỗng => "Chưa có hoạt động"; lỗi tải => hộp lỗi + Thử lại', async () => {
  let fail = true;
  const f = server({ list: () => (fail ? res(500, { error: { code: 'INTERNAL', message: 'x' } }) : page([])) });
  const m = await mount(f, SALES);
  try {
    await openTab(m);
    assert.ok(findAll(m.container, (e) => e.attributes.role === 'alert').length >= 1);
    fail = false;
    await doAct(() => click(buttonByText(m.container, /^Thử lại/)));
    assert.match(text(m.container), /Chưa có hoạt động/);
  } finally { await m.unmount(); }
});

test('điện thoại (ui.mobile): nút "+" nổi mở drawer dạng bottom sheet', async () => {
  const f = server(); const m = await mount(f, SALES, { mobile: true });
  try {
    await openTab(m);
    const fab = byAria(m.container, 'Ghi nhận hoạt động').find((e) => e.tagName === 'BUTTON');
    assert.ok(fab); assert.equal(fab.style.position, 'fixed');
    await doAct(() => click(fab));
    const d = dialog(m.container); assert.ok(d); assert.equal(d.style.width, '100%');
  } finally { await m.unmount(); }
});

test('R2 F-1 trợ năng: mở drawer => focus vào loại đang chọn; Tab/Shift+Tab vòng trong dialog; đóng => focus trả về nút mở', async () => {
  const m = await mount(server(), SALES);
  try {
    await openTab(m);
    const opener = byAria(m.container, 'Ghi nhận hoạt động').find((e) => e.tagName === 'BUTTON');
    opener.focus(); assert.equal(dom.doc.activeElement, opener);
    await doAct(() => click(opener));
    const d = dialog(m.container); assert.ok(d);
    const a0 = dom.doc.activeElement;
    assert.ok(d.contains(a0), 'focus phải nằm trong dialog khi mở');
    assert.equal(a0.attributes.role, 'radio'); assert.equal(a0.attributes['aria-checked'], 'true');
    const tabbable = findAll(d, (e) => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) && !e.disabled && e.attributes.tabindex !== '-1');
    const first = tabbable[0]; const last = tabbable[tabbable.length - 1];
    assert.ok(tabbable.length >= 4 && first !== last);
    last.focus();
    let ev; await doAct(() => { ev = keydown(last, 'Tab'); });
    assert.equal(dom.doc.activeElement, first, 'Tab ở phần tử cuối => về phần tử đầu'); assert.equal(ev.defaultPrevented, true);
    await doAct(() => { ev = keydown(first, 'Tab', { shiftKey: true }); });
    assert.equal(dom.doc.activeElement, last, 'Shift+Tab ở phần tử đầu => về phần tử cuối'); assert.equal(ev.defaultPrevented, true);
    const mid = tabbable[1]; mid.focus();
    await doAct(() => { ev = keydown(mid, 'Tab'); });
    assert.equal(ev.defaultPrevented, false, 'Tab ở giữa: để trình duyệt tự chuyển'); assert.equal(dom.doc.activeElement, mid);
    await doAct(() => click(byAria(d, 'Đóng').find((e) => e.tagName === 'BUTTON') || buttonByText(d, /^Huỷ$/)));
    assert.equal(dialog(m.container), undefined);
    assert.equal(dom.doc.activeElement, opener, 'đóng => focus trả về nút mở');
  } finally { await m.unmount(); }
});

test('đóng drawer khi đã nhập => hỏi xác nhận (ui.confirm); chưa nhập => đóng ngay', async () => {
  const f = server(); const m = await mount(f, SALES);
  try {
    await openTab(m); await openDrawer(m);
    await doAct(() => click(buttonByText(dialog(m.container), /^Huỷ$/)));
    assert.equal(dialog(m.container), undefined); assert.equal(m.confirms.length, 0);
    await openDrawer(m);
    type(inputByLabel(dialog(m.container), /^Nội dung/), 'Đang viết dở'); await flush();
    await doAct(() => click(buttonByText(dialog(m.container), /^Huỷ$/)));
    assert.equal(m.confirms.length, 1); assert.ok(dialog(m.container));
  } finally { await m.unmount(); }
});

test('điện thoại (ui.mobile): hàng tab không biểu tượng, nhãn ngắn để vừa 320 px; PC giữ biểu tượng', async () => {
  const icons = (m) => findAll(m.container, (e) => e.attributes.role === 'tab').map((t) => findAll(t, (i) => i.tagName === 'I').length);
  const f = server(); const pc = await mount(f, SALES);
  try { assert.deepEqual(icons(pc), [1, 1, 1]); } finally { await pc.unmount(); }
  const mob = await mount(server(), SALES, { mobile: true });
  try {
    assert.deepEqual(icons(mob), [0, 0, 0]);
    assert.deepEqual(findAll(mob.container, (e) => e.attributes.role === 'tab').map((t) => text(t)), ['Thông tin', 'Hoạt động1', 'Liên hệ']); // 320 px: nhãn ngắn
  } finally { await mob.unmount(); }
});
