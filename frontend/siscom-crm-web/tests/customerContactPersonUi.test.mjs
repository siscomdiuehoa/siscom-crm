// Run: node --test tests/   (Node >= 18; vite + react đã có). Injected fetch only; no network, no DB, no browser.
// B1.4 Người liên hệ trên giao diện thật (React + miniDom): trang chi tiết hiển thị MỘT người liên hệ + SĐT công ty; biểu mẫu có ô "Tên người liên hệ"
// chỉ khi server cấp contact.create; không có contact.read => không gọi /contacts, không hiện dòng; không có ô SĐT riêng.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00007', name: 'Công ty A', short: 'A', phone: '028 3822 1234', version: 2, ...over });
const contact = (over = {}) => ({ id: 'c1', code: 'LH-000001', fullName: 'Nguyễn Văn A', title: null, phone: '028 3822 1234', email: null, isPrimary: true, note: null, createdAt: '2026-11-01T00:00:00.000Z', ...over });
const LOOKUPS = { customer_tier: [], customer_status: [], industry: [], source: [], province: [] };

let vite; let dom; let createCustomerApiUi; let CustomerFormDrawer; let CustomerApiDetail; let createRoot; let act;
before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
  ({ CustomerFormDrawer } = await vite.ssrLoadModule('/src/features/customers/CustomerForm.jsx'));
  ({ default: CustomerApiDetail } = await vite.ssrLoadModule('/src/features/customers/CustomerApiDetail.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

// contacts(): items cho GET /contacts (hoặc response). post(n): response cho lần POST /contacts thứ n.
const server = ({ contacts = () => [contact()], post, patch, cust = apiCust() } = {}) => {
  const calls = []; let npost = 0;
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const p = new URL(url).pathname; calls.push({ p, method, body: init.body ? JSON.parse(init.body) : null });
    if (p.endsWith('/lookups')) return res(200, { data: LOOKUPS });
    if (p.endsWith('/customers/owner-candidates')) return res(200, { data: { scope: 'ALL', items: [] } });
    if (p.endsWith('/contacts') && method === 'GET') { const c = contacts(); return c && (typeof c.status === 'number' || typeof c.then === 'function') ? c : res(200, { data: { items: c } }); }
    if (p.endsWith('/contacts') && method === 'POST') return post ? post(++npost, calls[calls.length - 1].body) : res(201, { data: contact({ id: 'c2', fullName: calls[calls.length - 1].body.fullName }) });
    if (method === 'PATCH') return patch ? patch() : res(200, { data: apiCust({ version: 3 }) });
    return res(200, { data: cust });
  };
  f.calls = calls; f.contactGets = () => calls.filter((c) => c.method === 'GET' && c.p.endsWith('/contacts')); f.contactPosts = () => calls.filter((c) => c.method === 'POST' && c.p.endsWith('/contacts'));
  return f;
};
// Chuỗi PATCH -> POST /contacts (hoặc GET -> lỗi) cần vài vòng sự kiện; chờ tối đa 5 vòng trong act.
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const act_ = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const grants = (...keys) => (a) => keys.includes(a);
const ALL = grants('customer.read', 'customer.update', 'contact.read', 'contact.create');

async function mountDetail(fetchImpl, can = ALL) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = [];
  const ui = { can, customerApi: ctl, toast: (t) => toasts.push(t), confirm() {}, db: { customers: [] }, navigate() {} };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(React.createElement(CustomerApiDetail, { ui, id: ID })); }); await flush(); await flush();
  return { ctl, toasts, container, unmount: () => act(async () => root.unmount()) };
}
async function mountNew(fetchImpl, can = ALL) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = [];
  const ui = { can, customerApi: ctl, toast: (t) => toasts.push(t), confirm() {}, db: { customers: [] }, navigate() {} };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(React.createElement(CustomerFormDrawer, { open: true, initial: null, ui, onClose() {}, onSaved() {} })); }); await flush();
  return { ctl, toasts, container, unmount: () => act(async () => root.unmount()) };
}

test('chi tiết: hiện "Người liên hệ" = tên người chính + SĐT công ty (không dùng SĐT của bản ghi liên hệ)', async () => {
  const f = server({ contacts: () => [contact({ phone: '0999 999 999' })] }); const m = await mountDetail(f);
  try {
    const t = text(m.container);
    assert.match(t, /Người liên hệ\s*Nguyễn Văn A · 028 3822 1234 \(SĐT công ty\)/);
    assert.doesNotMatch(t, /0999 999 999/);
    assert.equal(f.contactGets().length, 1);
  } finally { await m.unmount(); }
});

test('chi tiết: chưa có người liên hệ => dòng hiện "—"', async () => {
  const f = server({ contacts: () => [] }); const m = await mountDetail(f);
  try { assert.match(text(m.container), /Người liên hệ\s*—/); } finally { await m.unmount(); }
});

test('chi tiết: không có contact.read => không gọi /contacts, không có dòng Người liên hệ', async () => {
  const f = server(); const m = await mountDetail(f, grants('customer.read', 'customer.update'));
  try { assert.equal(f.contactGets().length, 0); assert.doesNotMatch(text(m.container), /Người liên hệ/); } finally { await m.unmount(); }
});

test('chi tiết: /contacts 403 => "Không có quyền xem người liên hệ", trang khách vẫn hiển thị', async () => {
  const f = server({ contacts: () => res(403, { error: { code: 'FORBIDDEN', message: 'x' } }) }); const m = await mountDetail(f);
  try { const t = text(m.container); assert.match(t, /Không có quyền xem người liên hệ/); assert.match(t, /Công ty A/); } finally { await m.unmount(); }
});

test('sửa: ô "Tên người liên hệ" điền sẵn tên hiện tại; không có ô SĐT người liên hệ; đổi tên => PATCH rồi POST contacts với SĐT công ty', async () => {
  const f = server(); const m = await mountDetail(f);
  try {
    await act_(() => click(buttonByText(m.container, /Sửa thông tin/)));
    const inp = inputByLabel(m.container, /^Tên người liên hệ/);
    assert.equal(inp.value, 'Nguyễn Văn A');
    assert.match(text(m.container), /Để trống = giữ người liên hệ hiện tại/);
    await act_(() => type(inp, 'Lê Văn C'));
    await act_(() => click(buttonByText(m.container, /Lưu thay đổi/)));
    assert.equal(f.calls.filter((c) => c.method === 'PATCH').length, 1);
    assert.equal('contactName' in f.calls.find((c) => c.method === 'PATCH').body, false);
    assert.deepEqual(f.contactPosts().map((c) => c.body), [{ fullName: 'Lê Văn C', isPrimary: true, phone: '028 3822 1234' }]);
    assert.match(text(m.container), /Lê Văn C · 028 3822 1234/);
  } finally { await m.unmount(); }
});

test('sửa: không đổi tên => không POST contacts', async () => {
  const f = server(); const m = await mountDetail(f);
  try {
    await act_(() => click(buttonByText(m.container, /Sửa thông tin/)));
    await act_(() => type(inputByLabel(m.container, /^Tên công ty/), 'Công ty A mới'));
    await act_(() => click(buttonByText(m.container, /Lưu thay đổi/)));
    assert.equal(f.calls.filter((c) => c.method === 'PATCH').length, 1); assert.equal(f.contactPosts().length, 0);
  } finally { await m.unmount(); }
});

test('sửa: có customer.update nhưng KHÔNG có contact.create (vd. vai trò chỉ đọc liên hệ) => không có ô Tên người liên hệ', async () => {
  const f = server(); const m = await mountDetail(f, grants('customer.read', 'customer.update', 'contact.read'));
  try {
    await act_(() => click(buttonByText(m.container, /Sửa thông tin/)));
    assert.ok(!inputByLabel(m.container, /^Tên người liên hệ/));
  } finally { await m.unmount(); }
});

test('sửa: người liên hệ lỗi tải (403) => không có ô (không biết tên hiện tại, tránh tạo trùng)', async () => {
  const f = server({ contacts: () => res(403, { error: { code: 'FORBIDDEN', message: 'x' } }) }); const m = await mountDetail(f);
  try {
    await act_(() => click(buttonByText(m.container, /Sửa thông tin/)));
    assert.ok(!inputByLabel(m.container, /^Tên người liên hệ/));
  } finally { await m.unmount(); }
});

test('thêm mới: có ô Tên người liên hệ; lưu => POST /customers rồi POST contacts (SĐT công ty do máy chủ trả)', async () => {
  const f = server(); const m = await mountNew(f);
  try {
    await act_(() => type(inputByLabel(m.container, /^Tên công ty/), 'Công ty A'));
    await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '028 3822 1234'));
    await act_(() => type(inputByLabel(m.container, /^Tên người liên hệ/), 'Trần Thị B'));
    await act_(() => click(buttonByText(m.container, /Thêm khách hàng/)));
    const posts = f.calls.filter((c) => c.method === 'POST');
    assert.deepEqual(posts.map((c) => c.p.replace('/api/v1', '')), ['/customers', '/customers/' + ID + '/contacts']);
    assert.deepEqual(f.contactPosts()[0].body, { fullName: 'Trần Thị B', isPrimary: true, phone: '028 3822 1234' });
    assert.equal(m.toasts.at(-1).tone, 'success');
  } finally { await m.unmount(); }
});

test('thêm mới: người liên hệ lỗi => cảnh báo "chưa lưu người liên hệ" (khách vẫn đã thêm), không thử lại', async () => {
  const f = server({ post: () => res(400, { error: { code: 'VALIDATION_FAILED', message: 'Số điện thoại chưa hợp lệ' } }) }); const m = await mountNew(f);
  try {
    await act_(() => type(inputByLabel(m.container, /^Tên công ty/), 'Công ty A'));
    await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '028 3822 1234'));
    await act_(() => type(inputByLabel(m.container, /^Tên người liên hệ/), 'Trần Thị B'));
    await act_(() => click(buttonByText(m.container, /Thêm khách hàng/)));
    const t = m.toasts.at(-1);
    assert.equal(t.tone, 'warning'); assert.match(t.title, /Đã thêm khách hàng KH-00007, chưa lưu người liên hệ/);
    assert.equal(f.contactPosts().length, 1);
  } finally { await m.unmount(); }
});

test('thêm mới: không có contact.create => không có ô, chỉ POST /customers', async () => {
  const f = server(); const m = await mountNew(f, grants('customer.create'));
  try {
    assert.ok(!inputByLabel(m.container, /^Tên người liên hệ/));
    await act_(() => type(inputByLabel(m.container, /^Tên công ty/), 'Công ty A'));
    await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '028 3822 1234'));
    await act_(() => click(buttonByText(m.container, /Thêm khách hàng/)));
    assert.equal(f.contactPosts().length, 0);
  } finally { await m.unmount(); }
});

test('tên quá 200 ký tự => lỗi tại ô, không gửi', async () => {
  const f = server(); const m = await mountNew(f);
  try {
    await act_(() => type(inputByLabel(m.container, /^Tên công ty/), 'Công ty A'));
    await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '028 3822 1234'));
    await act_(() => type(inputByLabel(m.container, /^Tên người liên hệ/), 'x'.repeat(201)));
    await act_(() => click(buttonByText(m.container, /Thêm khách hàng/)));
    assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
    assert.match(text(m.container), /Tên người liên hệ tối đa 200 ký tự/);
  } finally { await m.unmount(); }
});

test('QA I-1: nút "Sửa thông tin" khoá cho tới khi tải xong người liên hệ (không mất bản nháp khi tên tải về muộn)', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const f = server({ contacts: () => gate });
  const m = await mountDetail(f);
  try {
    assert.equal(buttonByText(m.container, /Sửa thông tin/).disabled, true);
    await act_(async () => { release(res(200, { data: { items: [contact()] } })); });
    assert.equal(buttonByText(m.container, /Sửa thông tin/).disabled, false);
  } finally { await m.unmount(); }
});

test('QA I-1: không có contact.read => nút Sửa không phải chờ người liên hệ', async () => {
  const f = server(); const m = await mountDetail(f, grants('customer.read', 'customer.update'));
  try { assert.equal(buttonByText(m.container, /Sửa thông tin/).disabled, false); } finally { await m.unmount(); }
});

test('QA M-4: SĐT công ty cũ không hợp lệ + nhập tên người liên hệ mới => lỗi ngay tại ô, không PATCH/POST', async () => {
  const f = server({ cust: apiCust({ phone: '12345' }), contacts: () => [] }); const m = await mountDetail(f);
  try {
    await act_(() => click(buttonByText(m.container, /Sửa thông tin/)));
    await act_(() => type(inputByLabel(m.container, /^Tên người liên hệ/), 'Lê Văn C'));
    await act_(() => click(buttonByText(m.container, /Lưu thay đổi/)));
    assert.equal(f.calls.filter((c) => c.method === 'PATCH' || c.method === 'POST').length, 0);
    assert.match(text(m.container), /Số điện thoại công ty chưa hợp lệ/);
  } finally { await m.unmount(); }
});

test('owner 2026-11-01: mục "Người liên hệ" nằm ngay sau "Thông tin doanh nghiệp", trước "Địa chỉ & liên hệ"', async () => {
  const f = server(); const m = await mountNew(f);
  try {
    const legends = [...m.container.querySelectorAll((e) => e.tagName === 'LEGEND')].map((e) => text(e));
    const i = (re) => legends.findIndex((t) => re.test(t));
    assert.ok(i(/Thông tin doanh nghiệp/) >= 0 && i(/^Người liên hệ$/) === i(/Thông tin doanh nghiệp/) + 1 && i(/Địa chỉ & liên hệ/) === i(/^Người liên hệ$/) + 1, JSON.stringify(legends));
  } finally { await m.unmount(); }
});
