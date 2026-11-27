// Run: node --test tests/quotesListPrintUi.test.mjs   (cũng chạy trong CI qua import ở tests/quotesApiUi.test.mjs — không đổi danh sách tệp của CI).
// Báo giá Q8a: trang danh sách (#/quotes) và bản in (#/quotes/:id/print/:no) trên API /quotes. Máy chủ giả trả đúng hình dạng của backend Q4.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, byTag, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const QID = 'aaaaaaaa-0000-4000-8000-000000000001';
const row = (n, latest, extra = {}) => ({
  id: 'aaaaaaaa-0000-4000-8000-00000000000' + n, code: 'BG-000' + n, itemName: 'Hạng mục ' + n, isPrimary: false, version: 1, createdAt: '2026-11-20T01:00:00.000Z', updatedAt: '2026-11-25T01:00:00.000Z',
  template: { id: 't-gio', code: 'ong-gio', name: 'Ống gió vải' }, opportunity: { id: 'o' + n, code: 'CH-000' + n, title: 'Cơ hội ' + n, status: 'OPEN', ownerId: 'e-me' },
  customer: { id: 'c' + n, code: 'KH-' + n, name: 'Công ty ' + n }, createdBy: { id: 'e-me', code: 'NV-1', fullName: 'Tôi' }, latest, ...extra,
});
const sum = (no, state, extra = {}) => ({ versionNo: no, status: state === 'EXPIRED' ? 'SENT' : state, state, daysLeft: null, quoteDate: '2026-11-20', validUntil: '2026-12-05', subtotalVnd: '18926364', totalVnd: '20819000', sentAt: null, decidedAt: null, ...extra });
const PAGE1 = [row(1, sum(2, 'SENT', { daysLeft: 5 }), { isPrimary: true }), row(2, sum(1, 'EXPIRED', { daysLeft: -2 })), row(3, sum(1, 'DRAFT', { quoteDate: null, validUntil: null, subtotalVnd: '0' })), row(4, null)];
const TPL = [{ id: 't-gio', code: 'ong-gio', name: 'Ống gió vải', isActive: true }, { id: 't-gas', code: 'gas', name: 'Gas lạnh', isActive: true }];

const line = (no, kind, extra = {}) => ({ lineNo: no, kind, description: 'Dòng ' + no, unit: kind === 'ITEM' ? 'm' : '', note: null, extra: {}, quantity: kind === 'ITEM' ? '2.5' : null, unitPriceVnd: kind === 'ITEM' ? '1636000' : null, vatPercent: kind === 'ITEM' ? 10 : null, amountVnd: kind === 'ITEM' ? '4090000' : null, ...extra });
const version = (no, status, extra = {}) => ({
  versionNo: no, status, state: status, daysLeft: null, codeSnapshot: 'BG-0001', itemName: 'Ống gió xưởng B', printTemplate: 'siscom-v1', templateName: 'Ống gió vải', title: 'BẢNG BÁO GIÁ ỐNG GIÓ VẢI',
  columns: [{ key: 'dk', label: 'Đường kính', unit: 'mm' }], vatMode: 'QUOTE', quoteDate: '2026-11-20', validUntil: '2026-12-05',
  client: { name: 'Chị Bình', contact: 'Anh Cường', company: 'Công ty A', phone: '0900000001', email: 'binh@example.test', address: 'Số 1 Đường X' }, projectName: 'Xưởng B',
  quoter: { name: 'Nguyễn Văn Soạn', title: 'Kỹ sư bán hàng', phone: '0900000002', email: 'soan@example.test' },
  intro: 'Kính gửi Quý khách', terms: 'Giá chưa gồm vận chuyển\nThanh toán 50 %', paymentInfo: 'STK 000111 — Ngân hàng Z',
  subtotalVnd: '4090000', base8Vnd: '0', base10Vnd: '4090000', vat8Vnd: '0', vat10Vnd: '409000', totalVnd: '4499000', note: 'ghi chú nội bộ', rejectReason: null,
  suggestedFileName: '20261120_BG-0001_CongTyA_OngGioXuongB' + (status === 'DRAFT' ? '_NHAP' : ''), costVisible: false,
  lines: [line(1, 'SECTION', { description: 'THIẾT BỊ THÔNG GIÓ' }), line(2, 'ITEM', { description: 'Ống gió D400', extra: { dk: '400' }, note: 'Màu xám' })], ...extra,
});
const DETAIL = (versions) => ({ ...row(1, null), id: QID, code: 'BG-0001', versions, can: { update: true, send: true, decide: true, delete: true, export: true } });

const server = ({ pages = [{ items: PAGE1, page: 1, pageSize: 20, total: 4, totalPages: 1 }], detail = DETAIL([version(1, 'SENT')]), fail = 0 } = {}) => {
  const calls = []; let failures = fail;
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', '');
    calls.push({ p, method, query: Object.fromEntries(u.searchParams) });
    if (p === '/quotes/templates') return res(200, { data: { items: TPL, canManage: false } });
    if (p === '/quotes') {
      if (failures > 0) { failures--; return res(500, { error: { code: 'INTERNAL', message: 'lỗi' } }); }
      const page = u.searchParams.get('page') || '1';
      return res(200, { data: pages[page === '1' ? 0 : 1] || pages[0] });
    }
    if (p.startsWith('/quotes/')) return detail ? res(200, { data: detail }) : res(404, { error: { code: 'NOT_FOUND', message: 'không có' } });
    return res(404, { error: { code: 'NOT_FOUND', message: 'không có' } });
  };
  f.calls = calls; f.lists = () => calls.filter((c) => c.p === '/quotes');
  return f;
};

let vite; let dom; let ownDom = false; let createCustomerApiUi; let QuotesPage; let QuotesListRoute; let QuotePrint; let QuotePrintRoute; let createRoot; let act;
const doc = () => globalThis.document;
describe('Báo giá Q8a — trang danh sách và bản in', () => {
  before(async () => {
    if (!globalThis.document) { dom = installDom(); ownDom = true; }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
    ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
    ({ QuotesPage, QuotesListRoute } = await vite.ssrLoadModule('/src/features/quotes/QuotesPage.jsx'));
    ({ QuotePrint, QuotePrintRoute } = await vite.ssrLoadModule('/src/features/quotes/QuotePrint.jsx'));
    ({ createRoot } = await import('react-dom/client'));
    ({ act } = await import('react'));
  });
  after(async () => { if (vite) await vite.close(); if (ownDom && dom) dom.restore(); });

  const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
  const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
  async function mount(fetchImpl, el, over = {}) {
    const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const nav = [];
    const ui = { customerApi: ctl, toast: (t) => toasts.push(t), navigate: (p) => nav.push(p), mobile: !!over.mobile, me: { employeeId: 'e-me', permissions: { 'quote.read': 'OWN' } }, can: () => true };
    const container = doc().createElement('div'); doc().body.appendChild(container); const root = createRoot(container);
    await act(async () => { root.render(el(ui)); }); await flush(); await flush();
    return { ui, toasts, nav, container, unmount: async () => { await act(async () => root.unmount()); doc().body.removeChild(container); } };
  }
  const press = async (root, re) => { const b = buttonByText(root, re); assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };
  async function pick(root, labelRe, optionRe) {
    const btn = findAll(root, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox' && labelRe.test(e.attributes['aria-label'] || ''))[0];
    assert.ok(btn, 'có ô chọn ' + labelRe);
    await doAct(() => click(btn));
    await doAct(() => click(findAll(doc().body, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]));
  }
  const listEl = (ui) => React.createElement(QuotesPage, { ui });
  const printEl = (no = 'latest') => (ui) => React.createElement(QuotePrint, { ui, id: QID, no });
  const sheet = (root) => findAll(root, (e) => (e.attributes.class || '').split(' ').includes('qp-sheet'))[0];

  // ───── Trang danh sách ─────
  it('danh sách: gọi GET /quotes với trang 1; mỗi báo giá một dòng (mã, hạng mục, khách, loại, bản mới nhất, trạng thái, tổng trước VAT, nhãn hạn)', async () => {
    const f = server(); const m = await mount(f, listEl);
    assert.deepEqual(f.lists()[0].query, { page: '1', pageSize: '20', sortBy: 'updatedAt', sortOrder: 'desc' });
    const t = text(m.container);
    for (const s of ['BG-0001', 'Hạng mục 1', 'Công ty 1', 'Ống gió vải', 'v2', 'Đã gửi', '18.926.364', 'Còn 5 ngày', 'Hết hiệu lực', 'Nháp', 'Đang theo đuổi', '05/12/2026', '4 / 4 báo giá']) assert.ok(t.includes(s), 'có ' + s);
    assert.ok(/Chưa có phiên bản/.test(t), 'báo giá chưa có phiên bản vẫn hiện');
    assert.equal(byTag(m.container, 'table').length, 1);
    await m.unmount();
  });
  it('bấm mã => mở báo giá; "Bản in" => mở bản in của phiên bản mới nhất', async () => {
    const f = server(); const m = await mount(f, listEl);
    const a = byTag(m.container, 'a').find((x) => text(x) === 'BG-0001'); assert.equal(a.attributes.href, '#/quotes/' + PAGE1[0].id);
    await doAct(() => click(a));
    await doAct(() => click(findAll(m.container, (e) => e.tagName === 'BUTTON' && e.attributes['aria-label'] === 'Xem bản in BG-0001')[0]));
    assert.deepEqual(m.nav, ['/quotes/' + PAGE1[0].id, '/quotes/' + PAGE1[0].id + '/print/2']);
    assert.equal(findAll(m.container, (e) => e.tagName === 'BUTTON' && e.attributes['aria-label'] === 'Xem bản in BG-0004').length, 0, 'chưa có phiên bản => không có nút bản in');
    await m.unmount();
  });
  it('lọc trạng thái và loại: gọi lại từ trang 1 với đúng tham số', async () => {
    const f = server(); const m = await mount(f, listEl);
    await pick(m.container, /Trạng thái/, /Sắp hết hạn/);
    assert.equal(f.lists().at(-1).query.state, 'EXPIRING'); assert.equal(f.lists().at(-1).query.page, '1');
    await pick(m.container, /Loại báo giá/, /Gas lạnh/);
    assert.equal(f.lists().at(-1).query.templateId, 't-gas'); assert.equal(f.lists().at(-1).query.state, 'EXPIRING');
    await m.unmount();
  });
  it('tìm: dưới 2 ký tự => không gọi máy chủ và có nhắc; đủ => gửi q đã cắt khoảng trắng', async () => {
    const f = server(); const m = await mount(f, listEl);
    const box = inputByLabel(m.container, /Tìm báo giá/); const n0 = f.lists().length;
    await doAct(() => type(box, 'a')); await press(m.container, /^Tìm$/);
    assert.equal(f.lists().length, n0); assert.match(text(m.container), /ít nhất 2 ký tự/);
    await doAct(() => type(box, '  ong gio ')); await press(m.container, /^Tìm$/);
    assert.equal(f.lists().at(-1).query.q, 'ong gio');
    await m.unmount();
  });
  it('"Tải thêm": gọi trang 2 và nối vào danh sách đang có', async () => {
    const f = server({ pages: [{ items: PAGE1.slice(0, 2), page: 1, pageSize: 20, total: 3, totalPages: 2 }, { items: [row(5, sum(1, 'ACCEPTED'))], page: 2, pageSize: 20, total: 3, totalPages: 2 }] });
    const m = await mount(f, listEl);
    await press(m.container, /^Tải thêm$/);
    assert.equal(f.lists().at(-1).query.page, '2');
    const t = text(m.container);
    for (const s of ['BG-0001', 'BG-0002', 'BG-0005', 'Được chấp nhận', '3 / 3 báo giá']) assert.ok(t.includes(s), 'có ' + s);
    assert.equal(buttonByText(m.container, /^Tải thêm$/), undefined);
    await m.unmount();
  });
  it('chưa có báo giá nào => trạng thái trống có hướng dẫn; lỗi máy chủ => hộp lỗi và "Thử lại" tải được', async () => {
    const empty = server({ pages: [{ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }] }); const m = await mount(empty, listEl);
    assert.match(text(m.container), /Chưa có báo giá nào/); assert.match(text(m.container), /Cơ hội kinh doanh/);
    await m.unmount();
    const bad = server({ fail: 1 }); const m2 = await mount(bad, listEl);
    assert.equal(findAll(m2.container, (e) => e.attributes.role === 'alert').length > 0, true);
    await press(m2.container, /Thử lại/);
    assert.ok(text(m2.container).includes('BG-0001'));
    await m2.unmount();
  });
  it('điện thoại: mỗi báo giá một thẻ, không có bảng rộng', async () => {
    const f = server(); const m = await mount(f, listEl, { mobile: true });
    assert.equal(byTag(m.container, 'table').length, 0);
    assert.ok(text(m.container).includes('BG-0001') && text(m.container).includes('Còn 5 ngày'));
    await m.unmount();
  });
  it('C4: không có quote.read (gõ thẳng địa chỉ) => trang "không có quyền", KHÔNG gọi máy chủ — cả danh sách lẫn bản in', async () => {
    const f = server();
    const m = await mount(f, (ui) => React.createElement(QuotesListRoute, { ui, allowed: false }));
    assert.match(text(m.container), /Không có quyền xem báo giá/); await m.unmount();
    const m2 = await mount(f, (ui) => React.createElement(QuotePrintRoute, { ui, id: QID, no: 'latest', allowed: false }));
    assert.match(text(m2.container), /Không có quyền xem báo giá/); await m2.unmount();
    assert.equal(f.calls.length, 0);
  });

  // ───── Bản in ─────
  it('bản in: đủ các khối của mục 4.2, mọi chữ lấy từ chính phiên bản; số tiền định dạng VN; không có ghi chú nội bộ', async () => {
    const f = server(); const m = await mount(f, printEl());
    const s = sheet(m.container); assert.ok(s, 'có tờ in'); const t = text(s);
    for (const x of ['Khách hàng / Client', 'Chị Bình', 'Dự án / Project', 'Xưởng B', 'Công ty / Company', 'Công ty A', 'Địa chỉ / Address', 'Số 1 Đường X', '0900000001', 'binh@example.test',
      'Báo giá bởi / Quotation by', 'Nguyễn Văn Soạn', 'Chức vụ / Position', 'Kỹ sư bán hàng', '0900000002', 'soan@example.test', 'Ngày báo giá / Date', '20/11/2026', 'Mã báo giá / Seri no.', 'BG-0001',
      'BẢNG BÁO GIÁ ỐNG GIÓ VẢI', 'Kính gửi Quý khách', 'TT', 'Nội dung công việc', 'Đường kính (mm)', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền', 'Ghi chú', 'THIẾT BỊ THÔNG GIÓ', 'Ống gió D400', '400', '2,5', '1.636.000', '4.090.000', 'Màu xám',
      'Tổng giá trị trước VAT', 'VAT 10 %', '409.000', 'Tổng giá trị sau VAT', '4.499.000', 'Giá chưa gồm vận chuyển', 'Thanh toán 50 %', 'Hiệu lực đến', '05/12/2026', 'Thông tin tài khoản', 'STK 000111', 'XÁC NHẬN ĐẶT HÀNG', 'XÁC NHẬN CÔNG TY']) assert.ok(t.includes(x), 'có ' + x);
    assert.ok(!t.includes('VAT 8 %'), 'một mức VAT => một dòng VAT');
    assert.ok(!t.includes('ghi chú nội bộ'), 'ghi chú nội bộ không lên bản in');
    assert.ok(!t.includes('BẢN NHÁP'), 'bản đã gửi không có chữ chìm');
    await m.unmount();
  });
  it('E5: tờ in luôn nền trắng chữ đen (không dùng biến màu của giao diện sáng / tối)', async () => {
    const f = server(); const m = await mount(f, printEl());
    const s = sheet(m.container);
    assert.equal(s.style.background, '#fff'); assert.equal(s.style.color, '#000');
    await m.unmount();
  });
  it('E6: bản nháp có chữ chìm "BẢN NHÁP"; tên tệp gợi ý (kèm _NHAP) thành tiêu đề trang để lưu PDF đúng tên, rời trang thì trả lại tiêu đề cũ', async () => {
    doc().title = 'SISCOM CRM';
    const f = server({ detail: DETAIL([version(1, 'DRAFT')]) }); const m = await mount(f, printEl());
    assert.ok(text(sheet(m.container)).includes('BẢN NHÁP'));
    assert.equal(doc().title, '20261120_BG-0001_CongTyA_OngGioXuongB_NHAP');
    await m.unmount();
    assert.equal(doc().title, 'SISCOM CRM');
    const f2 = server(); const m2 = await mount(f2, printEl());
    assert.equal(doc().title, '20261120_BG-0001_CongTyA_OngGioXuongB'); await m2.unmount();
  });
  it('E8: <script> và thẻ HTML trong mọi ô chữ hiện NGUYÊN VĂN, không thành phần tử', async () => {
    const X = '<script>alert(1)</script><b>x</b>';
    const v = version(1, 'SENT', { title: 'T' + X, intro: 'I' + X, terms: 'D' + X, paymentInfo: 'P' + X, projectName: 'J' + X, client: { name: 'C' + X, contact: null, company: 'Co' + X, phone: null, email: null, address: 'A' + X }, quoter: { name: 'Q' + X, title: 'QT' + X, phone: null, email: null },
      columns: [{ key: 'dk', label: 'L' + X, unit: null }], lines: [line(1, 'SECTION', { description: 'S' + X }), line(2, 'ITEM', { description: 'N' + X, unit: 'U' + X, note: 'G' + X, extra: { dk: 'E' + X } })] });
    const f = server({ detail: DETAIL([v]) }); const m = await mount(f, printEl());
    const s = sheet(m.container); const t = text(s);
    for (const p of ['T', 'I', 'D', 'P', 'J', 'C', 'Co', 'A', 'Q', 'QT', 'L', 'S', 'N', 'U', 'G', 'E']) assert.ok(t.includes(p + X), 'nguyên văn: ' + p);
    assert.equal(byTag(s, 'script').length, 0); assert.equal(byTag(s, 'b').filter((b) => text(b) === 'x').length, 0);
    await m.unmount();
  });
  it('E10: hai mức VAT => bảng có cột "VAT %" và hai dòng VAT; chỉ một mức => không có cột "VAT %"', async () => {
    const two = version(1, 'SENT', { vatMode: 'LINE', base8Vnd: '4090000', base10Vnd: '4090000', vat8Vnd: '327200', vat10Vnd: '409000', subtotalVnd: '8180000', totalVnd: '8916200', lines: [line(1, 'ITEM', { vatPercent: 8 }), line(2, 'ITEM')] });
    const f = server({ detail: DETAIL([two]) }); const m = await mount(f, printEl());
    const heads = byTag(sheet(m.container), 'th').map(text);
    assert.ok(heads.includes('VAT %')); const t = text(sheet(m.container));
    assert.ok(t.includes('VAT 8 %') && t.includes('327.200') && t.includes('VAT 10 %') && t.includes('409.000'));
    await m.unmount();
    const one = version(1, 'SENT', { vatMode: 'LINE', base8Vnd: '4090000', base10Vnd: '0', vat8Vnd: '327200', vat10Vnd: '0', lines: [line(1, 'ITEM', { vatPercent: 8 })] });
    const f1 = server({ detail: DETAIL([one]) }); const m1 = await mount(f1, printEl());
    assert.ok(!byTag(sheet(m1.container), 'th').map(text).includes('VAT %')); assert.ok(!text(sheet(m1.container)).includes('VAT 10 %'));
    await m1.unmount();
  });
  it('khổ giấy: tối đa 3 cột riêng => A4 dọc; nhiều hơn => A4 ngang', async () => {
    const css = (root) => byTag(root, 'style').map((x) => x.textContent).join('\n');
    const f = server(); const m = await mount(f, printEl());
    assert.match(css(m.container), /size:\s*A4 portrait/); await m.unmount();
    const wide = version(1, 'SENT', { columns: ['a', 'b', 'c', 'd'].map((k) => ({ key: k, label: 'Cột ' + k, unit: null })) });
    const f2 = server({ detail: DETAIL([wide]) }); const m2 = await mount(f2, printEl());
    assert.match(css(m2.container), /size:\s*A4 landscape/); await m2.unmount();
  });
  it('E2 / E3 (thấy khi in bằng Chrome thật): các dòng tổng nằm chung một khối không bị tách qua hai trang; ô TT không xuống dòng khi số có 3 chữ số', async () => {
    const f = server(); const m = await mount(f, printEl());
    const s = sheet(m.container);
    const tb = findAll(s, (e) => e.tagName === 'TBODY' && (e.attributes.class || '').split(' ').includes('qp-totals'));
    assert.equal(tb.length, 1, 'có đúng một khối tổng');
    assert.equal(byTag(tb[0], 'tr').length, 3, 'trước VAT, VAT, sau VAT');
    assert.ok(/Tổng giá trị trước VAT/.test(text(tb[0])) && /Tổng giá trị sau VAT/.test(text(tb[0])));
    const css = byTag(m.container, 'style').map((x) => x.textContent).join('\n');
    assert.match(css, /\.qp-totals\s*\{[^}]*break-inside:\s*avoid/);
    assert.match(css, /\.qp-totals tr \+ tr\s*\{[^}]*break-before:\s*avoid/);
    const tt = byTag(s, 'td').find((td) => text(td) === '1');
    assert.equal(tt.style.whiteSpace, 'nowrap');
    await m.unmount();
  });
  it('giá vốn KHÔNG BAO GIỜ lên bản in, kể cả khi người xem được thấy giá vốn', async () => {
    const v = version(1, 'SENT', { costVisible: true, margin: { itemLines: 1, costedLines: 1, costedAmountVnd: '4090000', costVnd: '2777777', grossProfitVnd: '1312223' }, lines: [line(1, 'ITEM', { costPriceVnd: '1111111' })] });
    const f = server({ detail: DETAIL([v]) }); const m = await mount(f, printEl());
    const t = text(m.container);
    for (const x of ['1.111.111', '2.777.777', '1.312.223', 'Giá vốn', 'Lãi gộp']) assert.ok(!t.includes(x), 'không có ' + x);
    await m.unmount();
  });
  it('chọn phiên bản theo địa chỉ; số không tồn tại => báo không có phiên bản; nút "In / Lưu PDF" gọi lệnh in của trình duyệt', async () => {
    const d = DETAIL([version(1, 'SENT', { title: 'TIÊU ĐỀ BẢN 1' }), version(2, 'SENT', { title: 'TIÊU ĐỀ BẢN 2' })]);
    const f = server({ detail: d });
    const m1 = await mount(f, printEl('1')); assert.ok(text(sheet(m1.container)).includes('TIÊU ĐỀ BẢN 1')); await m1.unmount();
    const m2 = await mount(f, printEl('latest')); const t2 = text(sheet(m2.container));
    assert.ok(t2.includes('TIÊU ĐỀ BẢN 2') && t2.includes('BG-0001 (v2)'));
    let printed = 0; const prev = globalThis.window.print; globalThis.window.print = () => { printed++; };
    try { await press(m2.container, /In \/ Lưu PDF/); } finally { globalThis.window.print = prev; }
    assert.equal(printed, 1);
    await press(m2.container, /Quay lại báo giá/); assert.deepEqual(m2.nav, ['/quotes/' + QID]);
    await m2.unmount();
    const m3 = await mount(f, printEl('9')); assert.equal(sheet(m3.container), undefined); assert.match(text(m3.container), /Không có phiên bản 9/); await m3.unmount();
  });
  it('báo giá ngoài phạm vi / đã xoá => hộp lỗi "không tìm thấy", không có tờ in', async () => {
    const f = server({ detail: null }); const m = await mount(f, printEl());
    assert.equal(sheet(m.container), undefined); assert.match(text(m.container), /Không tìm thấy báo giá/);
    await m.unmount();
  });
});
