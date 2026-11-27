// Run: node --test tests/quotesSetupUi.test.mjs   (cũng chạy trong CI qua import ở tests/quotesListPrintUi.test.mjs — không đổi danh sách tệp của CI).
// Báo giá Q8b: màn hình "Loại báo giá" (#/quotes/templates) và "Mặc định của tôi" (#/quotes/my-defaults). Máy chủ giả trả đúng hình dạng của backend Q4 / Q6.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, byTag, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const T1 = { id: 'bbbbbbbb-0000-4000-8000-000000000001', code: 'ong-gio', name: 'Ống gió vải', title: 'BẢNG BÁO GIÁ ỐNG GIÓ VẢI', intro: 'Kính gửi', defaultTerms: 'Giá chưa gồm vận chuyển', defaultValidDays: 15, defaultVat: 10, vatMode: 'QUOTE', columns: [{ key: 'duong_kinh', label: 'Đường kính', unit: 'mm' }, { key: 'chieu_dai', label: 'Chiều dài', unit: 'm' }], isActive: true, sortOrder: 0, version: 3 };
const T2 = { id: 'bbbbbbbb-0000-4000-8000-000000000002', code: 'gas', name: 'Gas lạnh', title: 'BẢNG BÁO GIÁ GAS LẠNH', intro: '', defaultTerms: '', defaultValidDays: 7, defaultVat: 8, vatMode: 'LINE', columns: [], isActive: false, sortOrder: 1, version: 1 };
const MINE = { saved: true, quoterTitle: 'Kỹ sư bán hàng', quoterPhone: '0900000002', quoterEmail: 'soan@example.test', paymentInfo: 'STK 000111', updatedAt: '2026-11-20T01:00:00.000Z' };

// write: (method, path, body) => phản hồi cho yêu cầu ghi (mặc định 200 trả lại thân kèm id).
const server = ({ items = [T1, T2], mine = MINE, write = null, failList = 0 } = {}) => {
  const calls = []; let failures = failList;
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ p, method, query: Object.fromEntries(u.searchParams), body });
    if (method !== 'GET') return write ? write(method, p, body) : res(200, { data: { ...T1, ...body } });
    if (p === '/quotes/templates') {
      if (failures > 0) { failures--; return res(500, { error: { code: 'INTERNAL', message: 'lỗi' } }); }
      return res(200, { data: { items, canManage: true } });
    }
    if (p === '/quotes/my-defaults') return res(200, { data: mine });
    return res(404, { error: { code: 'NOT_FOUND', message: 'không có' } });
  };
  f.calls = calls; f.writes = () => calls.filter((c) => c.method !== 'GET'); f.reads = (p) => calls.filter((c) => c.method === 'GET' && c.p === p);
  return f;
};

let vite; let dom; let ownDom = false; let createCustomerApiUi; let S; let createRoot; let act;
const doc = () => globalThis.document;
describe('Báo giá Q8b — loại báo giá và mặc định của tôi', () => {
  before(async () => {
    if (!globalThis.document) { dom = installDom(); ownDom = true; }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
    ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
    S = await vite.ssrLoadModule('/src/features/quotes/QuoteSetup.jsx');
    ({ createRoot } = await import('react-dom/client'));
    ({ act } = await import('react'));
  });
  after(async () => { if (vite) await vite.close(); if (ownDom && dom) dom.restore(); });

  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
  const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
  async function mount(fetchImpl, el, over = {}) {
    const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const nav = [];
    const ui = { customerApi: ctl, toast: (t) => toasts.push(t), navigate: (p) => nav.push(p), mobile: !!over.mobile, me: { employeeId: 'e-me' }, can: over.can || (() => true) };
    const container = doc().createElement('div'); doc().body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(el(ui)); }); await flush(); await flush();
    return { ui, toasts, nav, container, unmount: async () => { await act(async () => root.unmount()); doc().body.removeChild(container); } };
  }
  const press = async (root, re) => { const b = buttonByText(root, re); assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };
  const byAria = (root, re) => findAll(root, (e) => re.test(e.attributes['aria-label'] || ''));
  const pressAria = async (root, re) => { const b = byAria(root, re)[0]; assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };
  const fill = async (root, re, v) => { const i = inputByLabel(root, re) || byAria(root, re)[0]; assert.ok(i, 'có ô ' + re); await doAct(() => type(i, v)); };
  const tplEl = (ui) => React.createElement(S.QuoteTemplatesPage, { ui });
  const mineEl = (ui) => React.createElement(S.MyQuoteDefaultsPage, { ui });

  // ───── Loại báo giá ─────
  it('danh sách loại: gọi GET /quotes/templates?all=1; hiện cả loại đang dùng và đã ngừng dùng với mã, số cột riêng, VAT, số ngày', async () => {
    const f = server(); const m = await mount(f, tplEl);
    assert.deepEqual(f.reads('/quotes/templates')[0].query, { all: '1' });
    const t = text(m.container);
    for (const s of ['Ống gió vải', 'ong-gio', '2 cột riêng', 'VAT 10 %', '15 ngày', 'Đang dùng', 'Gas lạnh', 'gas', 'Không có cột riêng', 'VAT 8 %', 'theo từng dòng', 'Ngừng dùng']) assert.ok(t.includes(s), 'có ' + s);
    await m.unmount();
  });
  it('lỗi tải danh sách => hộp lỗi có "Thử lại"; thử lại thành công thì hiện danh sách', async () => {
    const f = server({ failList: 1 }); const m = await mount(f, tplEl);
    assert.ok(!text(m.container).includes('Ống gió vải'));
    await press(m.container, /Thử lại/);
    assert.ok(text(m.container).includes('Ống gió vải'));
    await m.unmount();
  });
  it('sửa loại: biểu mẫu điền sẵn, mã không sửa được; lưu => PATCH kèm version, không có code; xong thì về danh sách và đọc lại', async () => {
    const f = server(); const m = await mount(f, tplEl);
    await pressAria(m.container, /^Sửa loại Ống gió vải$/);
    assert.equal(inputByLabel(m.container, /Tên loại báo giá/).value, 'Ống gió vải');
    assert.equal(inputByLabel(m.container, /Mã loại/), null, 'không có ô sửa mã');
    assert.ok(text(m.container).includes('ong-gio'));
    await fill(m.container, /Tên loại báo giá/, 'Ống gió vải 2026');
    await fill(m.container, /Số ngày hiệu lực/, '30');
    const n0 = f.reads('/quotes/templates').length;
    await press(m.container, /^Lưu loại báo giá$/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.equal(w[0].method, 'PATCH'); assert.equal(w[0].p, '/quotes/templates/' + T1.id);
    assert.equal(w[0].body.version, 3); assert.equal(w[0].body.name, 'Ống gió vải 2026'); assert.equal(w[0].body.defaultValidDays, 30); assert.equal('code' in w[0].body, false);
    assert.deepEqual(w[0].body.columns, T1.columns);
    assert.equal(f.reads('/quotes/templates').length, n0 + 1, 'đọc lại danh sách');
    assert.equal(inputByLabel(m.container, /Tên loại báo giá/), null, 'đã về danh sách');
    assert.equal(m.toasts.length, 1);
    await m.unmount();
  });
  it('bảng cột riêng: thêm, đổi tên, đổi thứ tự, xoá; xem trước bố cục cập nhật theo; cột mới được gán key khi lưu', async () => {
    const f = server(); const m = await mount(f, tplEl);
    await pressAria(m.container, /^Sửa loại Ống gió vải$/);
    const heads = () => byTag(findAll(m.container, (e) => e.attributes['data-preview'] === 'true')[0], 'th').map(text);
    assert.deepEqual(heads(), ['TT', 'Nội dung công việc', 'Đường kính (mm)', 'Chiều dài (m)', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền', 'Ghi chú']);
    await press(m.container, /^Thêm cột$/);
    await fill(m.container, /^Tên cột 3$/, 'Màu vải');
    await pressAria(m.container, /^Đưa cột 3 lên$/);
    await pressAria(m.container, /^Xoá cột 1$/);
    assert.deepEqual(heads(), ['TT', 'Nội dung công việc', 'Màu vải', 'Chiều dài (m)', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền', 'Ghi chú']);
    await press(m.container, /^Lưu loại báo giá$/);
    assert.deepEqual(f.writes()[0].body.columns, [{ key: 'mau_vai', label: 'Màu vải', unit: '' }, { key: 'chieu_dai', label: 'Chiều dài', unit: 'm' }]);
    await m.unmount();
  });
  it('tối đa 10 cột riêng: đủ 10 thì nút "Thêm cột" tắt', async () => {
    const cols = Array.from({ length: 10 }, (_, i) => ({ key: 'c' + i, label: 'Cột ' + i, unit: '' }));
    const f = server({ items: [{ ...T1, columns: cols }] }); const m = await mount(f, tplEl);
    await pressAria(m.container, /^Sửa loại Ống gió vải$/);
    assert.equal(buttonByText(m.container, /^Thêm cột$/).disabled, true);
    await m.unmount();
  });
  it('thêm loại: thiếu mã / tên / tiêu đề => báo tại ô, KHÔNG gọi máy chủ; đủ => POST có code, không có version', async () => {
    const f = server(); const m = await mount(f, tplEl);
    await press(m.container, /^Thêm loại báo giá$/);
    await press(m.container, /^Lưu loại báo giá$/);
    assert.equal(f.writes().length, 0);
    const t = text(m.container);
    for (const s of ['Mã loại:', 'Nhập tên loại báo giá.', 'Nhập dòng tiêu đề in.']) assert.ok(t.includes(s), 'có ' + s);
    await fill(m.container, /Mã loại/, 'quat');
    await fill(m.container, /Tên loại báo giá/, 'Quạt thông gió');
    await fill(m.container, /Dòng tiêu đề in/, 'BẢNG BÁO GIÁ QUẠT');
    await press(m.container, /^Lưu loại báo giá$/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.equal(w[0].method, 'POST'); assert.equal(w[0].p, '/quotes/templates');
    assert.deepEqual(w[0].body, { code: 'quat', name: 'Quạt thông gió', title: 'BẢNG BÁO GIÁ QUẠT', intro: '', defaultTerms: '', defaultValidDays: 15, defaultVat: 10, vatMode: 'QUOTE', isActive: true, columns: [] });
    await m.unmount();
  });
  it('máy chủ từ chối (mã trùng 409) => hiện thông báo của máy chủ, giữ nguyên nội dung đang gõ', async () => {
    const f = server({ write: () => res(409, { error: { code: 'TEMPLATE_CODE_EXISTS', message: 'Mã loại báo giá đã tồn tại.' } }) });
    const m = await mount(f, tplEl);
    await press(m.container, /^Thêm loại báo giá$/);
    await fill(m.container, /Mã loại/, 'gas'); await fill(m.container, /Tên loại báo giá/, 'Gas 2'); await fill(m.container, /Dòng tiêu đề in/, 'BÁO GIÁ GAS');
    await press(m.container, /^Lưu loại báo giá$/);
    assert.ok(text(m.container).includes('Mã loại báo giá đã tồn tại.'));
    assert.equal(inputByLabel(m.container, /Tên loại báo giá/).value, 'Gas 2');
    assert.equal(m.toasts.length, 0);
    await m.unmount();
  });
  it('người khác vừa sửa (409 VERSION_CONFLICT) => báo rõ và có nút tải lại; không tự ghi đè', async () => {
    const f = server({ write: () => res(409, { error: { code: 'VERSION_CONFLICT', message: 'Dữ liệu đã thay đổi.' } }) });
    const m = await mount(f, tplEl);
    await pressAria(m.container, /^Sửa loại Ống gió vải$/);
    await press(m.container, /^Lưu loại báo giá$/);
    assert.equal(f.writes().length, 1);
    assert.ok(/người khác vừa sửa/i.test(text(m.container)));
    const n0 = f.reads('/quotes/templates').length;
    await press(m.container, /^Tải lại danh sách$/);
    assert.equal(f.reads('/quotes/templates').length, n0 + 1);
    assert.equal(f.writes().length, 1, 'không ghi lại');
    assert.equal(inputByLabel(m.container, /Tên loại báo giá/), null, 'đã về danh sách');
    await m.unmount();
  });
  it('ngừng dùng / dùng lại từ danh sách: PATCH chỉ gồm version + isActive; máy chủ từ chối (loại cuối cùng đang dùng) => hiện lý do', async () => {
    const f = server(); const m = await mount(f, tplEl);
    await pressAria(m.container, /^Dùng lại loại Gas lạnh$/);
    assert.deepEqual(f.writes()[0].body, { version: 1, isActive: true });
    assert.equal(f.writes()[0].p, '/quotes/templates/' + T2.id);
    await m.unmount();
    const g = server({ write: () => res(422, { error: { code: 'TEMPLATE_LAST_ACTIVE', message: 'Phải còn ít nhất một loại báo giá đang dùng.' } }) });
    const m2 = await mount(g, tplEl);
    await pressAria(m2.container, /^Ngừng dùng loại Ống gió vải$/);
    assert.deepEqual(g.writes()[0].body, { version: 3, isActive: false });
    assert.ok(text(m2.container).includes('Phải còn ít nhất một loại báo giá đang dùng.'));
    await m2.unmount();
  });
  it('điện thoại: danh sách và biểu mẫu vẫn dùng được (không có bảng danh sách rộng)', async () => {
    const f = server(); const m = await mount(f, tplEl, { mobile: true });
    assert.ok(text(m.container).includes('Ống gió vải'));
    assert.equal(byTag(m.container, 'table').length, 0);
    await pressAria(m.container, /^Sửa loại Ống gió vải$/);
    assert.equal(inputByLabel(m.container, /Tên loại báo giá/).value, 'Ống gió vải');
    await m.unmount();
  });

  // ───── Mặc định của tôi ─────
  it('mặc định của tôi: đọc GET /quotes/my-defaults, điền sẵn 4 ô; lưu => PUT thay toàn bộ, ô trống không gửi, không có employeeId', async () => {
    const f = server(); const m = await mount(f, mineEl);
    assert.equal(f.reads('/quotes/my-defaults').length, 1);
    assert.equal(inputByLabel(m.container, /Chức vụ/).value, 'Kỹ sư bán hàng');
    assert.equal(inputByLabel(m.container, /Thông tin tài khoản/).value, 'STK 000111');
    await fill(m.container, /Điện thoại/, '');
    await fill(m.container, /Chức vụ/, ' Trưởng nhóm ');
    await press(m.container, /^Lưu mặc định$/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.equal(w[0].method, 'PUT'); assert.equal(w[0].p, '/quotes/my-defaults');
    assert.deepEqual(w[0].body, { quoterTitle: 'Trưởng nhóm', quoterEmail: 'soan@example.test', paymentInfo: 'STK 000111' });
    assert.equal(m.toasts.length, 1);
    await m.unmount();
  });
  it('mặc định của tôi: email sai => báo tại ô, KHÔNG gọi máy chủ; chưa từng lưu => ô trống và có ghi chú', async () => {
    const f = server({ mine: { saved: false, quoterTitle: null, quoterPhone: null, quoterEmail: null, paymentInfo: '', updatedAt: null } }); const m = await mount(f, mineEl);
    assert.equal(inputByLabel(m.container, /Chức vụ/).value, '');
    assert.ok(/chưa lưu mặc định/i.test(text(m.container)));
    await fill(m.container, /^Email/, 'khong-phai-email');
    await press(m.container, /^Lưu mặc định$/);
    assert.equal(f.writes().length, 0);
    assert.ok(text(m.container).includes('Email không hợp lệ.'));
    await m.unmount();
  });

  // ───── Quyền và thanh trang con ─────
  it('C4: không có quyền => trang "không có quyền", KHÔNG gọi máy chủ (cả hai trang con)', async () => {
    const f = server();
    const m = await mount(f, (ui) => React.createElement(S.QuoteTemplatesRoute, { ui, allowed: false }));
    assert.ok(/Không có quyền/.test(text(m.container)));
    await m.unmount();
    const m2 = await mount(f, (ui) => React.createElement(S.MyQuoteDefaultsRoute, { ui, allowed: false }));
    assert.ok(/Không có quyền/.test(text(m2.container)));
    await m2.unmount();
    assert.equal(f.calls.length, 0);
  });
  it('thanh trang con: hiện theo quyền, đánh dấu trang đang mở, bấm thì chuyển trang; không có quyền nào thêm => không hiện thanh', async () => {
    const f = server();
    const m = await mount(f, (ui) => React.createElement(S.QuotesSubnav, { ui, current: 'templates' }));
    const tabs = findAll(m.container, (e) => e.attributes.role === 'tab');
    assert.deepEqual(tabs.map(text), ['Danh sách', 'Loại báo giá', 'Mặc định của tôi']);
    assert.equal(tabs[1].attributes['aria-selected'], 'true');
    await doAct(() => click(tabs[2])); await doAct(() => click(tabs[0]));
    assert.deepEqual(m.nav, ['/quotes/my-defaults', '/quotes']);
    await m.unmount();
    const m2 = await mount(f, (ui) => React.createElement(S.QuotesSubnav, { ui, current: 'list' }), { can: (p) => p === 'quote.read' });
    assert.equal(findAll(m2.container, (e) => e.attributes.role === 'tab').length, 0);
    await m2.unmount();
    assert.equal(f.calls.length, 0);
  });
});
