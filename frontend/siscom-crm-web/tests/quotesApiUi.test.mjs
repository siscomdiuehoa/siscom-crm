// Run: node --test tests/quotesApiUi.test.mjs   (cũng chạy trong CI qua import ở tests/opportunitiesDetailApiUi.test.mjs — không đổi danh sách tệp của CI).
// Báo giá Q7: tab "Báo giá" ở chi tiết cơ hội và màn hình soạn (#/quotes/:id) trên API /quotes. Máy chủ giả trả đúng hình dạng của backend Q4–Q5b.
// Chạy kèm tệp khác: dùng lại DOM giả đã cài (nếu có) thay vì cài thêm một bản.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const OPP = { id: '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e51', code: 'CH-0001', title: 'Ống gió tầng 3', status: 'OPEN', access: 'FULL', ownerId: 'e-me', owner: { id: 'e-me' }, version: 3, customer: { id: 'c1', code: 'KH-1', name: 'Công ty A' } };
const Q1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const Q2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const TPL = [{ id: 't-gio', code: 'ong-gio', name: 'Ống gió vải', title: 'BẢNG BÁO GIÁ', vatMode: 'QUOTE', defaultVat: 10, columns: [{ key: 'dk', label: 'Đường kính', unit: 'mm' }], isActive: true, version: 1 }];
const head = (id, code, extra = {}) => ({ id, code, itemName: 'Hạng mục ' + code, isPrimary: false, version: 2, template: { id: 't-gio', code: 'ong-gio', name: 'Ống gió vải' }, opportunity: { id: OPP.id, code: OPP.code, title: OPP.title, status: 'OPEN', ownerId: 'e-me' }, customer: OPP.customer, createdBy: { id: 'e-me', code: 'NV-1', fullName: 'Tôi' }, ...extra });
const sum = (no, status, state, subtotal, extra = {}) => ({ versionNo: no, status, state, daysLeft: null, quoteDate: '2026-11-20', validUntil: '2026-12-05', subtotalVnd: subtotal, totalVnd: subtotal, sentAt: null, decidedAt: null, ...extra });
const BY_OPP = {
  items: [head(Q1, 'BG-0001', { isPrimary: true, versions: [sum(1, 'SENT', 'SENT', '18926364', { daysLeft: 10 })] }), head(Q2, 'BG-0002', { versions: [sum(1, 'DRAFT', 'DRAFT', '0', { quoteDate: null, validUntil: null })] })],
  amountSource: { quoteId: Q1, code: 'BG-0001', versionNo: 1, subtotalVnd: '18926364', matchesOpportunity: true },
  can: { create: true, export: true },
};
const line = (no, kind, extra = {}) => ({ lineNo: no, kind, description: 'Dòng ' + no, unit: kind === 'ITEM' ? 'm' : '', note: null, extra: {}, quantity: null, unitPriceVnd: null, vatPercent: null, amountVnd: null, ...extra });
const version = (no, status, extra = {}) => ({
  versionNo: no, status, state: status, daysLeft: null, codeSnapshot: 'BG-0002', itemName: 'Hạng mục BG-0002', printTemplate: 'siscom-v1', templateName: 'Ống gió vải', title: 'BẢNG BÁO GIÁ',
  columns: [{ key: 'dk', label: 'Đường kính', unit: 'mm' }], vatMode: 'QUOTE', quoteDate: '2026-11-20', validUntil: '2026-12-05',
  client: { name: 'Chị B', contact: null, company: 'Công ty A', phone: null, email: null, address: null }, projectName: null, quoter: { name: 'Tôi', title: null, phone: null, email: null },
  intro: 'Kính gửi', terms: 'Điều khoản', paymentInfo: '', subtotalVnd: '0', base8Vnd: '0', base10Vnd: '0', vat8Vnd: '0', vat10Vnd: '0', totalVnd: '0', note: null, rejectReason: null,
  createdBy: { id: 'e-me', code: 'NV-1', fullName: 'Tôi' }, createdAt: '2026-11-25T01:00:00.000Z', updatedAt: '2026-11-25T01:00:00.000Z', sentBy: null, sentAt: null, decidedBy: null, decidedAt: null,
  suggestedFileName: '20261120_BG-0002_CongTyA_HangMuc_NHAP', costVisible: true, lines: [], margin: { itemLines: 0, costedLines: 0, costedAmountVnd: '0', costVnd: '0', grossProfitVnd: '0' }, ...extra,
});
const DETAIL = (versions, extra = {}) => ({ ...head(Q2, 'BG-0002'), versions, can: { update: true, send: true, decide: true, delete: true, export: true }, ...extra });

const server = ({ detail = DETAIL([version(1, 'DRAFT')]), write } = {}) => {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', ''); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, body });
    if (method === 'GET' && p === '/opportunities/' + OPP.id + '/quotes') return res(200, { data: BY_OPP });
    if (method === 'GET' && p === '/quotes/templates') return res(200, { data: { items: TPL, canManage: false } });
    if (method === 'GET' && p.startsWith('/quotes/')) return res(200, { data: typeof detail === 'function' ? detail(calls) : detail });
    if (method !== 'GET') { const r = write && write(p, method, body); if (r) return r; return res(200, { data: typeof detail === 'function' ? detail(calls) : detail }); }
    return res(404, { error: { code: 'NOT_FOUND', message: 'không có' } });
  };
  f.calls = calls; f.writes = () => calls.filter((c) => c.method !== 'GET');
  return f;
};

let vite; let dom; let ownDom = false; let createCustomerApiUi; let QuotesTab; let QuoteView; let OpportunityTabs; let createRoot; let act;
const doc = () => globalThis.document;
describe('Báo giá Q7 — giao diện', () => {
  before(async () => {
    if (!globalThis.document) { dom = installDom(); ownDom = true; }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
    ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
    ({ QuotesTab } = await vite.ssrLoadModule('/src/features/quotes/QuotesTab.jsx'));
    ({ QuoteView } = await vite.ssrLoadModule('/src/features/quotes/QuoteView.jsx'));
    ({ OpportunityTabs } = await vite.ssrLoadModule('/src/features/opportunities/OpportunityDetailTabs.jsx'));
    ({ createRoot } = await import('react-dom/client'));
    ({ act } = await import('react'));
  });
  after(async () => { if (vite) await vite.close(); if (ownDom && dom) dom.restore(); });

  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
  const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
  const PERMS = { 'quote.read': 'OWN', 'quote.create': 'OWN', 'quote.update': 'OWN', 'quote.send': 'OWN', 'quote.decide': 'OWN', 'quote.delete': 'OWN', 'opportunity.read': 'OWN', 'opportunity.update': 'OWN' };
  async function mount(fetchImpl, el, over = {}) {
    const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const nav = []; let reloads = 0;
    const perms = over.perms || PERMS;
    const ui = { customerApi: ctl, toast: (t) => toasts.push(t), navigate: (p) => nav.push(p), mobile: !!over.mobile, me: { employeeId: 'e-me', permissions: perms }, can: (p) => !!perms[p] };
    const container = doc().createElement('div'); doc().body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(el(ui, () => { reloads++; })); }); await flush(); await flush();
    return { ui, toasts, nav, container, reloads: () => reloads, unmount: async () => { await act(async () => root.unmount()); doc().body.removeChild(container); } };
  }
  const modal = (root) => findAll(root, (e) => e.attributes.role === 'dialog')[0];
  const press = async (root, re) => { const b = buttonByText(root, re); assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };
  const fill = async (root, labelRe, value) => { const el = inputByLabel(root, labelRe); assert.ok(el, 'có ô ' + labelRe); await doAct(() => type(el, value)); };
  const cell = (root, label) => findAll(root, (e) => (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && e.attributes['aria-label'] === label)[0];
  const fillCell = async (root, label, value) => { const el = cell(root, label); assert.ok(el, 'có ô ' + label); await doAct(() => type(el, value)); };
  async function pick(root, labelRe, optionRe) {
    const field = findAll(root, (e) => (e.attributes.class === 'sg-field' && findAll(e, (l) => l.tagName === 'LABEL' && labelRe.test(text(l))).length) || (e.attributes.role === 'group' && labelRe.test(e.attributes['aria-label'] || '')))[0];
    assert.ok(field, 'có ô chọn ' + labelRe);
    await doAct(() => click(findAll(field, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]));
    await doAct(() => click(findAll(doc().body, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]));
  }
  const tabEl = (ui, reload) => React.createElement(QuotesTab, { ui, o: OPP, onReload: reload });
  const viewEl = (ui) => React.createElement(QuoteView, { ui, id: Q2 });

  it('tab Báo giá: mỗi báo giá một khối (mã, loại, hạng mục, "Đang theo đuổi", phiên bản, tổng trước VAT định dạng VN); nhãn giá trị theo báo giá', async () => {
    const f = server(); const m = await mount(f, tabEl);
    const t = text(m.container);
    for (const s of ['BG-0001', 'BG-0002', 'Ống gió vải', 'Hạng mục BG-0001', 'Đang theo đuổi', 'Đã gửi', 'Nháp', '18.926.364']) assert.ok(t.includes(s), 'có ' + s);
    assert.match(t, /Giá trị cơ hội đang theo báo giá BG-0001 v1/);
    await m.unmount();
  });
  it('nhãn "đã sửa tay" khi giá trị cơ hội khác báo giá đang theo đuổi', async () => {
    const f = server(); const orig = BY_OPP.amountSource; BY_OPP.amountSource = { ...orig, matchesOpportunity: false };
    try { const m = await mount(f, tabEl); assert.match(text(m.container), /đã sửa tay, khác báo giá BG-0001 v1/); await m.unmount(); } finally { BY_OPP.amountSource = orig; }
  });
  it('Thêm báo giá: chọn loại + hạng mục => POST đúng thân => mở màn hình soạn của báo giá mới', async () => {
    const f = server({ write: (p, method) => (method === 'POST' && p === '/opportunities/' + OPP.id + '/quotes' ? res(201, { data: DETAIL([version(1, 'DRAFT')]) }) : undefined) });
    const m = await mount(f, tabEl);
    await press(m.container, /^Thêm báo giá$/);
    const dlg = modal(doc().body); assert.ok(dlg, 'có hộp thoại');
    await press(dlg, /^Tạo báo giá$/);
    assert.equal(f.writes().length, 0, 'thiếu dữ liệu => không gọi mạng');
    await pick(dlg, /Loại báo giá/, /Ống gió vải/);
    await fill(dlg, /Hạng mục/, '  Ống gió tầng 3  ');
    await press(dlg, /^Tạo báo giá$/);
    assert.deepEqual(f.writes().map((c) => [c.method, c.p, c.body]), [['POST', '/opportunities/' + OPP.id + '/quotes', { templateId: 't-gio', itemName: 'Ống gió tầng 3' }]]);
    assert.deepEqual(m.nav, ['/quotes/' + Q2]);
    await m.unmount();
  });
  it('Đánh dấu đã gửi: hộp thoại chọn ngày => POST /send kèm version; xong => trang cơ hội đọc lại', async () => {
    const f = server(); const m = await mount(f, tabEl);
    const block = findAll(m.container, (e) => e.tagName === 'SECTION' && /BG-0002/.test(e.attributes['aria-label'] || ''))[0];
    assert.ok(block, 'có khối BG-0002');
    await press(block, /Đánh dấu đã gửi/);
    const dlg = modal(doc().body);
    await fill(dlg, /Ngày báo giá/, '2026-11-25');
    await fill(dlg, /Hạn hiệu lực/, '2026-12-10');
    await press(dlg, /^Đánh dấu đã gửi$/);
    assert.deepEqual(f.writes().map((c) => [c.method, c.p, c.body]), [['POST', '/quotes/' + Q2 + '/versions/1/send', { version: 2, quoteDate: '2026-11-25', validUntil: '2026-12-10' }]]);
    assert.equal(m.reloads(), 1);
    await m.unmount();
  });
  it('Kết quả: từ chối bắt buộc lý do (không gọi mạng khi trống); chấp nhận gửi đúng đường', async () => {
    const f = server(); const m = await mount(f, tabEl);
    const block = findAll(m.container, (e) => e.tagName === 'SECTION' && /BG-0001/.test(e.attributes['aria-label'] || ''))[0];
    await press(block, /Ghi kết quả/);
    let dlg = modal(doc().body);
    await press(dlg, /^Bị từ chối$/);
    assert.equal(f.writes().length, 0);
    assert.match(text(dlg), /Ghi lý do khách từ chối/);
    await press(dlg, /^Được chấp nhận$/);
    assert.deepEqual(f.writes().map((c) => [c.method, c.p]), [['POST', '/quotes/' + Q1 + '/versions/1/accept']]);
    await m.unmount();
  });
  it('quyền: không có quote.read => KHÔNG có tab Báo giá, không gọi API báo giá; có quote.read => có tab', async () => {
    const f = server();
    const tabsEl = (ui) => React.createElement(OpportunityTabs, { ui, o: OPP, meta: null });
    const noRead = await mount(f, tabsEl, { perms: { 'opportunity.read': 'OWN' } });
    assert.ok(!/Báo giá/.test(text(noRead.container)));
    assert.equal(f.calls.filter((c) => c.p.includes('quotes')).length, 0);
    await noRead.unmount();
    const withRead = await mount(f, tabsEl);
    assert.ok(buttonByText(withRead.container, /^Báo giá$/) || /Báo giá/.test(text(withRead.container)));
    await withRead.unmount();
  });
  it('màn hình soạn: thêm dòng nhóm + dòng hàng; tạm tính ngay (BigInt, định dạng VN); cột riêng của loại; Lưu => PUT đúng thân, KHÔNG có tổng; hiện tổng máy chủ trả về', async () => {
    let saved = null;
    const f = server({
      detail: (calls) => (saved ? DETAIL([version(1, 'DRAFT', { lines: [line(1, 'SECTION'), line(2, 'ITEM', { quantity: '2.5', unitPriceVnd: '333333', vatPercent: 10, amountVnd: '833333', costPriceVnd: '300000', extra: { dk: '400' } })], subtotalVnd: '833333', base10Vnd: '833333', vat10Vnd: '83333', totalVnd: '916666' })], { version: 3 }) : DETAIL([version(1, 'DRAFT')])),
      write: (p, method, body) => { if (method === 'PUT') { saved = body; } return undefined; },
    });
    const m = await mount(f, viewEl);
    assert.match(text(m.container), /Đường kính/);
    await press(m.container, /Thêm dòng nhóm/);
    await press(m.container, /Thêm dòng hàng/);
    await fillCell(m.container, 'Dòng 1: Nội dung', 'THIẾT BỊ');
    await fillCell(m.container, 'Dòng 2: Nội dung', 'Ống gió vải D400');
    await fillCell(m.container, 'Dòng 2: Đường kính', '400');
    await fillCell(m.container, 'Dòng 2: Số lượng', '2,5');
    await fillCell(m.container, 'Dòng 2: Đơn giá', '333.333');
    await fillCell(m.container, 'Dòng 2: Giá vốn', '300.000');
    const tmp = text(m.container);
    assert.ok(tmp.includes('833.333'), 'tạm tính thành tiền'); assert.ok(tmp.includes('916.666'), 'tạm tính tổng sau VAT');
    assert.match(tmp, /Lãi gộp tạm tính/);
    await press(m.container, /^Lưu nháp$/);
    const put = f.writes().find((c) => c.method === 'PUT');
    assert.ok(put, 'đã gọi PUT');
    assert.equal(put.p, '/quotes/' + Q2 + '/versions/1');
    assert.deepEqual(put.body.lines, [{ kind: 'SECTION', description: 'THIẾT BỊ' }, { kind: 'ITEM', description: 'Ống gió vải D400', unit: '', quantity: '2.5', unitPriceVnd: '333333', costPriceVnd: '300000', extra: { dk: '400' } }]);
    assert.equal(put.body.vatPercent, 10);
    assert.equal(put.body.version, 2);
    assert.ok(!JSON.stringify(put.body).match(/subtotal|total|amount/i));
    assert.match(text(m.container), /Đã lưu/);
    await m.unmount();
  });
  it('màn hình soạn: dòng sai => báo ngay tại ô, không gọi mạng; lỗi 409 VERSION_CONFLICT => báo tải lại, giữ nội dung đang gõ', async () => {
    const f = server({ write: (p, method) => (method === 'PUT' ? res(409, { error: { code: 'VERSION_CONFLICT', message: 'Báo giá đã được người khác cập nhật. Vui lòng tải lại.', details: { currentVersion: 5 } } }) : undefined) });
    const m = await mount(f, viewEl);
    await press(m.container, /Thêm dòng hàng/);
    await fillCell(m.container, 'Dòng 1: Nội dung', 'Hàng');
    await fillCell(m.container, 'Dòng 1: Số lượng', '1,0005');
    await fillCell(m.container, 'Dòng 1: Đơn giá', '100');
    await press(m.container, /^Lưu nháp$/);
    assert.equal(f.writes().length, 0);
    assert.match(text(m.container), /tối đa 3 chữ số thập phân/);
    await fillCell(m.container, 'Dòng 1: Số lượng', '1');
    await press(m.container, /^Lưu nháp$/);
    assert.equal(f.writes().length, 1);
    assert.match(text(m.container), /người khác cập nhật/);
    assert.equal(cell(m.container, 'Dòng 1: Nội dung').value, 'Hàng');
    await m.unmount();
  });
  it('màn hình soạn: không được xem giá vốn => không có cột Giá vốn, không có lãi gộp; phiên bản đã gửi => chỉ xem, có "Tạo bản mới"', async () => {
    const f = server({ detail: DETAIL([version(1, 'SENT', { costVisible: false, margin: undefined, lines: [line(1, 'ITEM', { quantity: '1', unitPriceVnd: '100', vatPercent: 10, amountVnd: '100' })], subtotalVnd: '100', totalVnd: '110' })]) });
    const m = await mount(f, viewEl);
    const t = text(m.container);
    assert.ok(!/Giá vốn|Lãi gộp/.test(t));
    assert.equal(findAll(m.container, (e) => e.tagName === 'INPUT' && /^Dòng /.test(e.attributes['aria-label'] || '')).length, 0, 'chỉ xem: không có ô nhập');
    assert.ok(buttonByText(m.container, /Tạo bản mới/));
    assert.ok(t.includes('110'));
    await m.unmount();
  });
  it('điện thoại: mỗi dòng một thẻ (không có bảng rộng)', async () => {
    const f = server({ detail: DETAIL([version(1, 'DRAFT', { lines: [line(1, 'ITEM', { quantity: '1', unitPriceVnd: '100', vatPercent: 10, amountVnd: '100' })] })]) });
    const m = await mount(f, viewEl, { mobile: true });
    assert.equal(findAll(m.container, (e) => e.tagName === 'TABLE').length, 0);
    assert.equal(findAll(m.container, (e) => e.attributes['data-line-card'] === '1').length, 1);
    await m.unmount();
  });
});
