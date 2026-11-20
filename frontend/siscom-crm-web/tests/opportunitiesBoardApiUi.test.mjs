// Run: node --test tests/opportunitiesBoardApiUi.test.mjs   (Node >= 18; vite + react đã có). Fetch giả lập; không mạng, không DB, không trình duyệt.
// Sales S11: kanban theo giai đoạn, tab "Cơ hội" trong chi tiết khách hàng, bản điện thoại (thanh chọn giai đoạn + nút Chuyển giai đoạn).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, byTag, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';
import { sumAmounts, moneyShortVN, columnTotalLabel, buildListQuery, BOARD_PAGE_SIZE } from '../src/features/opportunities/opportunitiesModel.js';
import { createOpportunitiesController } from '../src/features/opportunities/opportunitiesUi.js';
import { describeRepoError } from '../src/features/customers/customerApiUi.js';
import { CustomerRepoError } from '../src/data/api/customerRepository.js';

// ───── Hàm thuần ─────
const F = (v) => ({ access: 'FULL', expectedAmountVnd: v });
test('sumAmounts: cộng bằng BigInt trên chuỗi; thẻ "chưa rõ" đếm riêng, KHÔNG cộng như 0; không có thẻ có giá trị => sum = null; bản kỹ thuật không tính', () => {
  assert.deepEqual(sumAmounts([F('1200000000'), F(null), F('0'), F(undefined), F('300000000')]), { sum: '1500000000', known: 3, unknown: 2 });
  assert.deepEqual(sumAmounts([F(null), F(null)]), { sum: null, known: 0, unknown: 2 });
  assert.deepEqual(sumAmounts([]), { sum: null, known: 0, unknown: 0 });
  assert.deepEqual(sumAmounts([F('0')]), { sum: '0', known: 1, unknown: 0 }); // số 0 thật vẫn là 0
  assert.deepEqual(sumAmounts([{ access: 'TASK' }, F('5')]), { sum: '5', known: 1, unknown: 0 });
  assert.equal(sumAmounts([F('999999999999999'), F('999999999999999')]).sum, '1999999999999998'); // vượt Number.MAX_SAFE_INTEGER vẫn đúng
  assert.deepEqual(sumAmounts([F('12abc')]), { sum: null, known: 0, unknown: 1 });
  assert.deepEqual(sumAmounts(null), { sum: null, known: 0, unknown: 0 });
});

test('moneyShortVN + columnTotalLabel: tỷ / triệu một chữ số thập phân (cắt); null => "Chưa rõ"; nhãn cột tách "chưa rõ"; cột toàn chưa rõ KHÔNG ghi 0', () => {
  assert.equal(moneyShortVN('7200000000'), '7,2 tỷ'); assert.equal(moneyShortVN('12600000000'), '12,6 tỷ'); assert.equal(moneyShortVN('1000000000'), '1 tỷ');
  assert.equal(moneyShortVN('1990000000'), '1,9 tỷ'); assert.equal(moneyShortVN('850000000'), '850 triệu'); assert.equal(moneyShortVN('1500000'), '1,5 triệu');
  assert.equal(moneyShortVN('999999'), '999.999 đ'); assert.equal(moneyShortVN('0'), '0 đ'); assert.equal(moneyShortVN(null), 'Chưa rõ'); assert.equal(moneyShortVN('x'), 'Chưa rõ');
  assert.equal(moneyShortVN('1234000000000'), '1.234 tỷ');
  assert.equal(columnTotalLabel([F('1200000000'), F(null), F(null)]), '1,2 tỷ + 2 chưa rõ');
  assert.equal(columnTotalLabel([F('3400000000')]), '3,4 tỷ');
  assert.equal(columnTotalLabel([F(null), F(null)]), '2 chưa rõ');
  assert.equal(columnTotalLabel([]), '');
});

// PR250-R1-01: tổng của NHIỀU cơ hội có thể dài hơn 15 chữ số (giới hạn 15 chữ số chỉ áp cho giá trị của MỘT cơ hội).
test('PR250-R1-01 (ca của reviewer): hai thẻ 999.999.999.999.999 đ => tổng 16 chữ số vẫn hiện bằng tiền, KHÔNG thành "Chưa rõ"', () => {
  const two = [F('999999999999999'), F('999999999999999')];
  assert.deepEqual(sumAmounts(two), { sum: '1999999999999998', known: 2, unknown: 0 });
  assert.equal(columnTotalLabel(two), '1.999.999,9 tỷ');
  assert.equal(moneyShortVN('1999999999999998'), '1.999.999,9 tỷ');
});

test('PR250-R1-01 — biên 15 / 16 / 17 chữ số, số 0, cột toàn null, cột lẫn tiền và null; không dùng Number', () => {
  assert.equal(moneyShortVN('999999999999999'), '999.999,9 tỷ'); // 15 chữ số
  assert.equal(moneyShortVN('1000000000000000'), '1.000.000 tỷ'); // 16 chữ số
  assert.equal(moneyShortVN('99999999999999999'), '99.999.999,9 tỷ'); // 17 chữ số
  assert.equal(moneyShortVN('9007199254740993'), '9.007.199,2 tỷ'); // > Number.MAX_SAFE_INTEGER: không lệch do số thực
  assert.equal(moneyShortVN('123456789012345678901234567890'), '123.456.789.012.345.678.901,2 tỷ'); // tổng rất lớn vẫn đúng từng chữ số
  assert.equal(moneyShortVN('0'), '0 đ'); assert.equal(columnTotalLabel([F('0')]), '0 đ'); // số 0 thật
  assert.equal(columnTotalLabel([F(null), F(null)]), '2 chưa rõ'); // toàn null: không có tiền, không ghi 0
  assert.equal(columnTotalLabel([F('999999999999999'), F(null), F('999999999999999'), F('2')]), '2.000.000 tỷ + 1 chưa rõ');
  const hundred = Array.from({ length: 100 }, () => F('999999999999999'));
  assert.equal(sumAmounts(hundred).sum, '99999999999999900'); assert.equal(columnTotalLabel(hundred), '99.999.999,9 tỷ'); // 100 thẻ tối đa của một lần tải
  // Vẫn từ chối thứ không phải số nguyên không âm (không đoán): số âm, số thực, chữ, số có 0 đứng đầu.
  for (const bad of ['-5', '1.5', '12abc', '007', ' ', 'NaN']) assert.equal(moneyShortVN(bad), 'Chưa rõ', bad);
  // Giới hạn 15 chữ số của MỘT cơ hội giữ nguyên: thẻ có giá trị 16 chữ số (không hợp lệ theo API) được coi là chưa rõ, không cộng vào tổng.
  assert.deepEqual(sumAmounts([F('1000000000000000'), F('5')]), { sum: '5', known: 1, unknown: 1 });
});

test('buildListQuery: pageSize mặc định 20; kanban xin 100; giá trị ngoài 1..100 hoặc không nguyên => về 20', () => {
  assert.equal(buildListQuery({}).pageSize, 20); assert.equal(buildListQuery({ pageSize: BOARD_PAGE_SIZE }).pageSize, 100);
  for (const bad of [0, 101, 2.5, '50', null]) assert.equal(buildListQuery({ pageSize: bad }).pageSize, 20, String(bad));
});

const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
test('controller board / byCustomer: board chỉ lấy cơ hội ĐANG MỞ của một giai đoạn, 100 thẻ, kèm lọc loại + từ khoá; byCustomer gọi đường theo khách; lỗi được trả về', async () => {
  const calls = [];
  const repo = { qs, opportunities: async (m, path) => { calls.push(path); if (path.includes('/customers/gone/')) throw new CustomerRepoError('not_found', 'Không tìm thấy khách hàng.', { status: 404 }); return { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }; } };
  const ctl = createOpportunitiesController(repo, describeRepoError);
  assert.equal((await ctl.board('s/1', { typeId: 't1', q: 'fcu' }, 2)).ok, true);
  const u = new URLSearchParams(calls[0].split('?')[1]);
  assert.deepEqual([calls[0].split('?')[0], u.get('status'), u.get('stageId'), u.get('typeId'), u.get('q'), u.get('page'), u.get('pageSize'), u.get('deleted')], ['/opportunities', 'OPEN', 's/1', 't1', 'fcu', '2', '100', null]);
  assert.equal((await ctl.byCustomer('c/1')).ok, true);
  assert.match(calls[1], /^\/customers\/c%2F1\/opportunities\?/); assert.doesNotMatch(calls[1], /customerId=/);
  const miss = await ctl.byCustomer('gone');
  assert.deepEqual([miss.ok, miss.error.kind], [false, 'not_found']); assert.match(miss.error.message, /khách hàng/);
});

// ───── Giao diện ─────
const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const CID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const ME = 'e-me';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fail = (status, code, message, details) => res(status, { error: { code, message, details } });
const NOW = '2026-11-18T03:00:00.000Z';
const STAGES = [{ id: 's1', code: 'PROSPECTING', label: 'Tiếp cận', defaultProbability: 10 }, { id: 's2', code: 'SURVEY', label: 'Khảo sát', defaultProbability: 25 }, { id: 's3', code: 'QUOTATION', label: 'Báo giá', defaultProbability: 45 }, { id: 's4', code: 'NEGOTIATION', label: 'Đàm phán', defaultProbability: 70 }];
const META = { stages: STAGES, types: [{ id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư', requiresProject: false }, { id: 't-install', code: 'INSTALLATION', label: 'Thi công', requiresProject: true }], lostReasons: [] };
const stageOf = (id) => { const s = STAGES.find((x) => x.id === id); return { id: s.id, code: s.code, label: s.label }; };
const item = (n, over = {}) => ({ id: 'o' + n, code: 'CH-' + String(n).padStart(4, '0'), title: 'Cơ hội số ' + n, status: 'OPEN', access: 'FULL', type: { id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư' }, stage: stageOf('s1'),
  customer: { id: CID, code: 'KH-00478', name: 'Công ty A' }, owner: { id: ME, code: 'NV-0003', fullName: 'Trần Bình' }, isProjectLinked: false, projectName: null, expectedAmountVnd: null, probability: 10, expectedCloseDate: null,
  holdUntil: null, wonAmountVnd: null, closedAt: null, deletedAt: null, version: 3, createdAt: NOW, updatedAt: NOW, ...over });
const detailOf = (o, over = {}) => ({ ...o, customerReadable: true, contact: null, needSummary: 'Cần 2 chiller', offerScope: null, probabilityOverridden: false, holdReason: null, wonDocType: null, wonDocNo: null, wonDocDate: null, wonDocUrl: null, wonDocFileName: null, lostReason: null, lostNote: null, ...over });
const page = (items, over = {}) => res(200, { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over } });
const apiCust = () => ({ id: CID, code: 'KH-00478', name: 'Công ty A', short: 'Cty A', phone: '028 3822 1234', version: 2 });

// board: { stageId: [items] } cho các truy vấn kanban (status=OPEN&stageId=…); list: truy vấn danh sách thường.
const server = (h = {}) => {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', ''); const body = init.body ? JSON.parse(init.body) : null; const q = u.searchParams;
    calls.push({ p, method, q, body });
    const n = calls.filter((c) => c.method === method && c.p === p).length;
    if (method !== 'GET') return (h.write && h.write(p, body, method, n)) || res(200, { data: detailOf(item(1), { version: 4 }) });
    if (p === '/opportunities/meta') return res(200, { data: META });
    if (p === '/opportunities/board-summary') return h.summary ? h.summary(q, n) : res(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    if (p === '/opportunities') {
      if (q.get('pageSize') === '100') return h.board ? h.board(q, n) : page([]);
      return (h.list || (() => page([item(1)])))(q, n);
    }
    if (p === '/customers/' + CID + '/opportunities') return (h.byCustomer || (() => page([])))(q, n);
    const m = /^\/opportunities\/(o\d+)$/.exec(p);
    if (m) return (h.get || ((id) => res(200, { data: detailOf(item(Number(id.slice(1)))) })))(m[1], n);
    if (/-candidates$/.test(p)) return res(200, { data: { items: [] } });
    if (/\/activities$/.test(p)) return page([]);
    if (/\/contacts$/.test(p)) return res(200, { data: { items: [] } });
    if (p === '/customers') return res(200, { data: { items: [apiCust()], page: 1, pageSize: 8, total: 1, totalPages: 1 } });
    if (p === '/customers/' + CID) return res(200, { data: apiCust() });
    return res(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  };
  f.calls = calls;
  f.boards = () => calls.filter((c) => c.method === 'GET' && c.p === '/opportunities' && c.q.get('pageSize') === '100');
  f.lists = () => calls.filter((c) => c.method === 'GET' && c.p === '/opportunities' && c.q.get('pageSize') !== '100');
  f.gets = (p) => calls.filter((c) => c.method === 'GET' && c.p === p);
  f.summaries = () => calls.filter((c) => c.method === 'GET' && c.p === '/opportunities/board-summary');
  f.writes = () => calls.filter((c) => c.method !== 'GET');
  return f;
};

let vite; let dom; let createCustomerApiUi; let OpportunitiesPage; let CustomerApiDetail; let createRoot; let act;
before(async () => {
  dom = installDom();
  dom.doc.querySelectorAll = () => [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
  ({ default: OpportunitiesPage } = await vite.ssrLoadModule('/src/features/opportunities/OpportunitiesPage.jsx'));
  ({ default: CustomerApiDetail } = await vite.ssrLoadModule('/src/features/customers/CustomerApiDetail.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const role = (perms) => ({ can: (p) => p in perms, me: { employeeId: ME, permissions: perms } });
const SALES = role({ 'customer.read': 'OWN', 'opportunity.read': 'OWN', 'opportunity.create': 'OWN', 'opportunity.update': 'OWN', 'opportunity.move_stage': 'OWN', 'opportunity.close': 'OWN', 'opportunity.assign': 'OWN' });
const ACCT = role({ 'customer.read': 'ALL', 'opportunity.read': 'ALL' });
const TECH = role({ 'activity.read': 'DEPARTMENT', 'opportunity.read_assigned': 'OWN' });
const NO_OPP = role({ 'customer.read': 'OWN', 'customer.update': 'OWN' });

async function mount(fetchImpl, r, el, extra = {}) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const nav = [];
  const ui = { ...r, ...extra, customerApi: ctl, toast: (t) => toasts.push(t), confirm: () => {}, db: { customers: [] }, navigate: (p) => nav.push(p) };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(el(ui)); }); await flush(); await flush();
  return { ctl, ui, toasts, nav, container, unmount: () => act(async () => root.unmount()) };
}
const listPage = (f, r, extra) => mount(f, r, (ui) => React.createElement(OpportunitiesPage, { ui }), extra);
const custPage = (f, r, extra) => mount(f, r, (ui) => React.createElement(CustomerApiDetail, { ui, id: CID }), extra);
const modal = (root) => findAll(root, (e) => e.attributes.role === 'dialog')[0];
const tabBtn = (root, re) => findAll(root, (e) => e.attributes.role === 'tab' && re.test(text(e)))[0];
const press = async (root, re) => { const b = buttonByText(root, re); assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };
const columns = (root) => findAll(root, (e) => e.tagName === 'SECTION' && /^Giai đoạn /.test(e.attributes['aria-label'] || ''));
const cards = (col) => byTag(col, 'article');
// Tiêu đề cột: [dòng "tên · số thẻ", dòng tổng].
const headOf = (col) => byTag(byTag(col, 'header')[0], 'div').map((d) => text(d));
const toKanban = async (m) => { const t = tabBtn(m.container, /^Kanban$/); assert.ok(t, 'có nút Kanban'); await doAct(() => click(t)); };
async function pickIn(scope, optionRe) {
  await doAct(() => click(findAll(scope, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]));
  const opt = findAll(scope, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]; assert.ok(opt, 'có lựa chọn ' + optionRe);
  await doAct(() => click(opt));
}
const BOARD = {
  s1: [item(1), item(2, { expectedAmountVnd: '1200000000' }), item(3)],
  s2: [item(4, { stage: stageOf('s2'), expectedAmountVnd: '3400000000', probability: 25 })],
  s3: [item(5, { stage: stageOf('s3'), expectedAmountVnd: '7200000000', probability: 45, expectedCloseDate: '2020-01-05', owner: { id: 'e-other', code: 'NV-9', fullName: 'Người khác' } })],
  s4: [],
};
const boardOf = (data) => (q) => { const rows = data[q.get('stageId')] || []; return page(rows, { pageSize: 100 }); };

test('kanban: mặc định là Bảng; bấm Kanban => mỗi giai đoạn MỘT truy vấn status=OPEN, 100 thẻ; cột hiện số thẻ + tổng tách "chưa rõ" (không ghi 0); thẻ có mã, khách, giá trị, xác suất, quá hạn', async () => {
  const f = server({ board: boardOf(BOARD) });
  const m = await listPage(f, SALES);
  try {
    assert.equal(f.boards().length, 0); assert.equal(f.lists().length, 1); assert.equal(columns(m.container).length, 0);
    await toKanban(m);
    const b = f.boards(); assert.equal(b.length, 4);
    assert.deepEqual(b.map((c) => c.q.get('stageId')).sort(), ['s1', 's2', 's3', 's4']);
    assert.ok(b.every((c) => c.q.get('status') === 'OPEN' && c.q.get('pageSize') === '100' && c.q.get('deleted') === null));
    assert.equal(f.lists().length, 1, 'kanban không tải lại danh sách bảng');
    const cols = columns(m.container); assert.equal(cols.length, 4);
    assert.deepEqual(headOf(cols[0]), ['Tiếp cận· 3', '1,2 tỷ + 2 chưa rõ']);
    assert.deepEqual(headOf(cols[1]), ['Khảo sát· 1', '3,4 tỷ']);
    assert.deepEqual(headOf(cols[2]), ['Báo giá· 1', '7,2 tỷ']);
    assert.deepEqual(headOf(cols[3]), ['Đàm phán· 0', '']); assert.match(text(cols[3]), /Không có cơ hội đang mở/); // cột trống: KHÔNG ghi "0 đ"
    assert.equal(cards(cols[0]).length, 3);
    const c1 = text(cards(cols[0])[0]); assert.match(c1, /CH-0001/); assert.match(c1, /Công ty A/); assert.match(c1, /Chưa rõ · 10%/); assert.doesNotMatch(c1, /(^|\D)0 đ/);
    const c5 = text(cards(cols[2])[0]); assert.match(c5, /7\.200\.000\.000 đ · 45%/); assert.match(c5, /Quá hạn chốt 05\/01\/2020/);
    assert.equal(findAll(m.container, (e) => e.attributes['aria-label'] === 'Lọc theo trạng thái').length, 0, 'kanban không có lọc trạng thái');
    assert.match(text(m.container), /Kanban chỉ gồm cơ hội đang mở/);
  } finally { await m.unmount(); }
});

test('PR250-R1-01 — nhãn cột trên giao diện: cột có tổng vượt 15 chữ số hiện đúng số tiền; cột lẫn tiền lớn và thẻ chưa rõ tách riêng', async () => {
  const max = '999999999999999';
  const data = { s1: [item(1, { expectedAmountVnd: max }), item(2, { expectedAmountVnd: max })], s2: [item(3, { stage: stageOf('s2'), expectedAmountVnd: max }), item(4, { stage: stageOf('s2'), expectedAmountVnd: max }), item(5, { stage: stageOf('s2') })], s3: [], s4: [] };
  const m = await listPage(server({ board: boardOf(data) }), SALES);
  try {
    await toKanban(m); const cols = columns(m.container);
    assert.deepEqual(headOf(cols[0]), ['Tiếp cận· 2', '1.999.999,9 tỷ']);
    assert.deepEqual(headOf(cols[1]), ['Khảo sát· 3', '1.999.999,9 tỷ + 1 chưa rõ']);
    assert.doesNotMatch(headOf(cols[0])[1], /Chưa rõ/);
    assert.match(text(cards(cols[0])[0]), /999\.999\.999\.999\.999 đ/); // thẻ vẫn hiện đủ số
  } finally { await m.unmount(); }
});

test('kanban — quyền trên thẻ: Kinh doanh chỉ kéo / chuyển được thẻ MÌNH phụ trách; Kế toán không thẻ nào; Kỹ thuật và điện thoại không có nút Kanban', async () => {
  const m = await listPage(server({ board: boardOf(BOARD) }), SALES);
  try {
    await toKanban(m); const cols = columns(m.container);
    const mine = cards(cols[0])[0]; const theirs = cards(cols[2])[0];
    assert.equal(mine.attributes.draggable, 'true'); assert.ok(buttonByText(mine, /Chuyển giai đoạn/));
    assert.notEqual(theirs.attributes.draggable, 'true'); assert.equal(buttonByText(theirs, /Chuyển giai đoạn/), undefined);
  } finally { await m.unmount(); }
  const a = await listPage(server({ board: boardOf(BOARD) }), ACCT);
  try { await toKanban(a); const all = findAll(a.container, (e) => e.tagName === 'ARTICLE'); assert.equal(all.length, 5); assert.ok(all.every((x) => x.attributes.draggable !== 'true' && !buttonByText(x, /Chuyển giai đoạn/))); } finally { await a.unmount(); }
  const t = await listPage(server(), TECH);
  try { assert.equal(tabBtn(t.container, /^Kanban$/), undefined); } finally { await t.unmount(); }
  const ph = await listPage(server(), SALES, { mobile: true });
  try { assert.equal(tabBtn(ph.container, /^Kanban$/), undefined); } finally { await ph.unmount(); }
});

test('kanban — chuyển giai đoạn từ thẻ: đọc chi tiết mới nhất rồi mở hộp xác nhận; gửi stageId + version của CHI TIẾT; xong thì các cột đọc lại', async () => {
  const f = server({ board: boardOf(BOARD), get: (id) => res(200, { data: detailOf(item(Number(id.slice(1))), { version: 7 }) }) });
  const m = await listPage(f, SALES);
  try {
    await toKanban(m);
    await press(cards(columns(m.container)[0])[0], /Chuyển giai đoạn/);
    assert.equal(f.gets('/opportunities/o1').length, 1);
    const d = modal(m.container); assert.ok(d, 'hộp Chuyển giai đoạn mở'); assert.match(text(d), /CH-0001/);
    await pickIn(d, /Khảo sát/); await press(d, /^Chuyển giai đoạn$/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.deepEqual([w[0].p, w[0].body], ['/opportunities/o1/stage', { version: 7, stageId: 's2' }]);
    assert.equal(modal(m.container), undefined); assert.equal(f.boards().length, 8, 'bốn cột đọc lại sau khi chuyển');
  } finally { await m.unmount(); }
});

test('kanban — lỗi và dữ liệu lớn: một cột lỗi 500 chỉ báo ở cột đó, cột khác vẫn hiện; cột 230 thẻ ghi rõ "tính trên 100 / 230" và có Tải thêm (không trùng thẻ); không đọc được chi tiết => báo, không mở hộp', async () => {
  const big = Array.from({ length: 100 }, (_, i) => item(100 + i, { expectedAmountVnd: '1000000000' }));
  const f = server({
    board: (q) => (q.get('stageId') === 's2' ? fail(500, 'INTERNAL', 'Máy chủ lỗi') : q.get('stageId') === 's1' ? page(q.get('page') === '2' ? [big[99], item(900, { expectedAmountVnd: null })] : big, { page: Number(q.get('page')), pageSize: 100, total: 230, totalPages: 3 }) : page([])),
    get: () => fail(404, 'OPPORTUNITY_NOT_FOUND', 'Không tìm thấy cơ hội.'),
  });
  const m = await listPage(f, SALES);
  try {
    await toKanban(m); const cols = columns(m.container);
    assert.ok(findAll(cols[1], (e) => e.attributes.role === 'alert').length, 'cột lỗi có báo lỗi'); assert.equal(findAll(cols[0], (e) => e.attributes.role === 'alert').length, 0);
    const head = () => headOf(columns(m.container)[0]);
    assert.deepEqual(head(), ['Tiếp cận· 230', '100 tỷ · tính trên 100 / 230 thẻ đã tải']);
    await press(columns(m.container)[0], /Tải thêm/);
    assert.equal(cards(columns(m.container)[0]).length, 101); assert.deepEqual(head(), ['Tiếp cận· 230', '100 tỷ + 1 chưa rõ · tính trên 101 / 230 thẻ đã tải']);
    await press(cards(columns(m.container)[0])[0], /Chuyển giai đoạn/);
    assert.equal(modal(m.container), undefined); assert.equal(m.toasts.pop().tone, 'error'); assert.equal(f.writes().length, 0);
  } finally { await m.unmount(); }
});

// ───── T-04: tổng chính xác theo cột + số Tạm hoãn (GET /opportunities/board-summary) ─────
const SUMMARY = { stages: [
  { stageId: 's1', count: 230, knownAmountCount: 225, unknownAmountCount: 5, sumExpectedAmountVnd: '230000000000' },
  { stageId: 's3', count: 1, knownAmountCount: 1, unknownAmountCount: 0, sumExpectedAmountVnd: '7200000000' },
], onHoldCount: 4 };
test('T-04 summaryTotalLabel / summaryOf: cùng định dạng với tổng theo thẻ; cột không có cơ hội => ""; chưa rõ tách riêng, KHÔNG cộng như 0; dữ liệu lạ => ""', async () => {
  const { summaryTotalLabel, summaryOf } = await import('../src/features/opportunities/opportunitiesModel.js');
  assert.equal(summaryTotalLabel(summaryOf(SUMMARY, 's1')), '230 tỷ + 5 chưa rõ');
  assert.equal(summaryTotalLabel(summaryOf(SUMMARY, 's3')), '7,2 tỷ');
  assert.equal(summaryTotalLabel(summaryOf(SUMMARY, 's4')), ''); // giai đoạn không có dòng => cột rỗng
  assert.equal(summaryTotalLabel({ count: 2, knownAmountCount: 0, unknownAmountCount: 2, sumExpectedAmountVnd: null }), '2 chưa rõ');
  assert.equal(summaryTotalLabel({ count: 1, knownAmountCount: 1, unknownAmountCount: 0, sumExpectedAmountVnd: '1999999999999998' }), '1.999.999,9 tỷ');
  for (const bad of [null, undefined, {}, { count: '3' }, { count: -1 }]) assert.equal(summaryTotalLabel(bad), '', JSON.stringify(bad));
  assert.deepEqual(summaryOf(null, 's1'), { stageId: 's1', count: 0, knownAmountCount: 0, unknownAmountCount: 0, sumExpectedAmountVnd: null });
});

test('T-04 kanban: tổng của cột lấy từ board-summary (đúng trên MỌI thẻ, không ghi "tính trên x / y"); nút "Tạm hoãn" có số; đổi loại => đọc lại tổng với typeId', async () => {
  const big = Array.from({ length: 100 }, (_, i) => item(100 + i, { expectedAmountVnd: '1000000000' }));
  const f = server({
    board: (q) => (q.get('stageId') === 's1' ? page(big, { page: 1, pageSize: 100, total: 230, totalPages: 3 }) : q.get('stageId') === 's3' ? page([item(5, { stage: stageOf('s3'), expectedAmountVnd: '7200000000' })], { pageSize: 100 }) : page([])),
    summary: () => res(200, { data: SUMMARY }),
  });
  const m = await listPage(f, SALES);
  try {
    assert.equal(f.summaries().length, 0, 'bảng không gọi tổng kanban');
    await toKanban(m);
    assert.equal(f.summaries().length, 1);
    const cols = columns(m.container);
    assert.deepEqual(headOf(cols[0]), ['Tiếp cận· 230', '230 tỷ + 5 chưa rõ']);
    assert.deepEqual(headOf(cols[2]), ['Báo giá· 1', '7,2 tỷ']);
    assert.deepEqual(headOf(cols[1]), ['Khảo sát· 0', '']);
    assert.doesNotMatch(text(m.container), /tính trên/);
    const hold = buttonByText(m.container, /^Tạm hoãn/); assert.ok(hold); assert.match(text(hold), /Tạm hoãn\s*4/); assert.equal(hold.attributes['aria-label'], 'Tạm hoãn (4 cơ hội)');
    await pickIn(findAll(m.container, (e) => e.attributes['aria-label'] === 'Lọc theo loại')[0], /Thi công/);
    const s = f.summaries(); assert.equal(s.at(-1).q.get('typeId'), 't-install'); assert.equal(s.at(-1).q.get('status'), null);
  } finally { await m.unmount(); }
});

test('T-04 kanban: không đọc được tổng (lỗi 500 / 403) => quay về tổng trên thẻ đã tải kèm "tính trên x / y"; nút Tạm hoãn không có số', async () => {
  const big = Array.from({ length: 100 }, (_, i) => item(100 + i, { expectedAmountVnd: '1000000000' }));
  const f = server({ board: (q) => (q.get('stageId') === 's1' ? page(big, { page: 1, pageSize: 100, total: 230, totalPages: 3 }) : page([])), summary: () => fail(500, 'INTERNAL', 'Máy chủ lỗi') });
  const m = await listPage(f, SALES);
  try {
    await toKanban(m);
    assert.deepEqual(headOf(columns(m.container)[0]), ['Tiếp cận· 230', '100 tỷ · tính trên 100 / 230 thẻ đã tải']);
    assert.equal(text(buttonByText(m.container, /^Tạm hoãn/)).trim(), 'Tạm hoãn');
  } finally { await m.unmount(); }
});

test('kanban — bộ lọc loại áp cho mọi cột; nút "Tạm hoãn" đưa về Bảng với lọc trạng thái ON_HOLD', async () => {
  const f = server({ board: boardOf(BOARD) });
  const m = await listPage(f, SALES);
  try {
    await toKanban(m);
    await pickIn(findAll(m.container, (e) => e.attributes['aria-label'] === 'Lọc theo loại')[0], /Thi công/);
    const last4 = f.boards().slice(-4); assert.ok(last4.every((c) => c.q.get('typeId') === 't-install'));
    await press(m.container, /^Tạm hoãn$/);
    assert.equal(columns(m.container).length, 0); const q = f.lists().pop().q; assert.deepEqual([q.get('status'), q.get('pageSize')], ['ON_HOLD', '20']);
  } finally { await m.unmount(); }
});

test('điện thoại (§8.5): thanh chọn giai đoạn ngang lọc danh sách; thẻ có nút "Chuyển giai đoạn" chỉ khi được phép; bấm => đọc chi tiết rồi mở hộp', async () => {
  const f = server({ list: () => page([item(1), item(2, { owner: { id: 'e-other', code: 'NV-9', fullName: 'Người khác' } })]) });
  const m = await listPage(f, SALES, { mobile: true });
  try {
    const bar = findAll(m.container, (e) => e.attributes['aria-label'] === 'Lọc theo giai đoạn')[0]; assert.ok(bar);
    assert.deepEqual(byTag(bar, 'button').map((b) => text(b)), ['Mọi giai đoạn', 'Tiếp cận', 'Khảo sát', 'Báo giá', 'Đàm phán']);
    await doAct(() => click(byTag(bar, 'button')[3]));
    assert.equal(f.lists().pop().q.get('stageId'), 's3');
    const lis = byTag(m.container, 'li');
    assert.ok(buttonByText(lis[0], /Chuyển giai đoạn/)); assert.equal(buttonByText(lis[1], /Chuyển giai đoạn/), undefined);
    await press(lis[0], /Chuyển giai đoạn/);
    assert.equal(f.gets('/opportunities/o1').length, 1); assert.ok(modal(m.container));
  } finally { await m.unmount(); }
});

// ───── Tab "Cơ hội" trong chi tiết khách hàng ─────
test('chi tiết khách — tab Cơ hội: chỉ khi có opportunity.read; mở tab mới gọi GET /customers/:id/opportunities; dòng có mã, giai đoạn, trạng thái, "Chưa rõ" (không phải 0); bấm tiêu đề mở chi tiết cơ hội', async () => {
  const f = server({ byCustomer: () => page([item(1), item(2, { expectedAmountVnd: '7200000000', probability: 45, status: 'ON_HOLD', stage: stageOf('s3'), projectName: 'TTDL GĐ1' })]) });
  const m = await custPage(f, SALES);
  try {
    assert.equal(f.gets('/customers/' + CID + '/opportunities').length, 0);
    const t = tabBtn(m.container, /^Cơ hội$/); assert.ok(t, 'có tab Cơ hội'); await doAct(() => click(t));
    const g = f.gets('/customers/' + CID + '/opportunities'); assert.equal(g.length, 1); assert.equal(g[0].q.get('customerId'), null); assert.equal(g[0].q.get('page'), '1');
    const rows = byTag(findAll(m.container, (e) => e.attributes['aria-label'] === 'Cơ hội của khách hàng')[0], 'li'); assert.equal(rows.length, 2);
    assert.match(text(rows[0]), /CH-0001/); assert.match(text(rows[0]), /Đang mở/); assert.match(text(rows[0]), /Tiếp cận/); assert.match(text(rows[0]), /Chưa rõ · 10%/); assert.doesNotMatch(text(rows[0]), /(^|\D)0 đ/);
    assert.match(text(rows[1]), /7\.200\.000\.000 đ · 45%/); assert.match(text(rows[1]), /Tạm hoãn/); assert.match(text(rows[1]), /TTDL GĐ1/);
    await doAct(() => click(byTag(rows[1], 'a')[0]));
    assert.deepEqual(m.nav, ['/pipeline/view/o2']);
  } finally { await m.unmount(); }
});

test('chi tiết khách — tab Cơ hội: Tạo cơ hội mở biểu mẫu với KHÁCH CHỌN SẴN và khoá; gửi customerId của khách đang xem. Kế toán không có nút tạo', async () => {
  const f = server({ write: (p, body) => res(201, { data: detailOf(item(77), { title: body.title }) }) });
  const m = await custPage(f, SALES);
  try {
    await doAct(() => click(tabBtn(m.container, /^Cơ hội$/)));
    assert.match(text(m.container), /Chưa có cơ hội nào/);
    await press(m.container, /Tạo cơ hội/); const d = modal(m.container); assert.ok(d);
    assert.match(text(d), /KH-00478/); assert.ok(buttonByText(d, /^Đổi$/).disabled, 'không đổi được khách');
    const title = inputByLabel(d, /Tiêu đề/); assert.ok(title, 'có ô Tiêu đề'); await doAct(() => type(title, 'Bán 50 FCU'));
    const radio = byTag(d, 'input').find((i) => i.attributes.type === 'radio'); radio.checked = true; await doAct(() => click(radio));
    await press(d, /^Tạo cơ hội$/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.deepEqual([w[0].p, w[0].body.customerId, w[0].body.title, w[0].body.typeId], ['/opportunities', CID, 'Bán 50 FCU', 't-supply']);
    assert.equal('expectedAmountVnd' in w[0].body, false);
  } finally { await m.unmount(); }
  const a = await custPage(server(), ACCT);
  try { await doAct(() => click(tabBtn(a.container, /^Cơ hội$/))); assert.equal(buttonByText(a.container, /Tạo cơ hội/), undefined); assert.match(text(a.container), /trong phạm vi của bạn/); } finally { await a.unmount(); }
});

test('chi tiết khách — không có opportunity.read: KHÔNG có tab Cơ hội, không gọi API cơ hội, trang như trước; lỗi API ở tab => báo lỗi + Thử lại', async () => {
  const f = server();
  const m = await custPage(f, NO_OPP);
  try {
    assert.equal(tabBtn(m.container, /^Cơ hội$/), undefined); assert.equal(findAll(m.container, (e) => e.attributes.role === 'tab').length, 0);
    assert.match(text(m.container), /Thông tin doanh nghiệp/);
    assert.equal(f.calls.filter((c) => /opportunit/.test(c.p)).length, 0);
  } finally { await m.unmount(); }
  const g = server({ byCustomer: (q, n) => (n === 1 ? fail(500, 'INTERNAL', 'Máy chủ lỗi') : page([item(1)])) });
  const e = await custPage(g, ACCT);
  try {
    await doAct(() => click(tabBtn(e.container, /^Cơ hội$/)));
    assert.ok(findAll(e.container, (x) => x.attributes.role === 'alert').length);
    await press(e.container, /Thử lại/);
    assert.match(text(e.container), /CH-0001/);
  } finally { await e.unmount(); }
});
