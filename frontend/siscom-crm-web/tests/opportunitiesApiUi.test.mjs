// Run: node --test tests/opportunitiesApiUi.test.mjs   (Node >= 18; vite + react đã có). Fetch giả lập; không mạng, không DB, không trình duyệt.
// Sales S10b: trang danh sách Cơ hội, bộ lọc, tải thêm, biểu mẫu Tạo cơ hội, chi tiết và thao tác theo quyền — chỉ qua API Sales.
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
  stages: [{ id: 's1', code: 'PROSPECTING', label: 'Tiếp cận', defaultProbability: 10 }, { id: 's2', code: 'SURVEY', label: 'Khảo sát', defaultProbability: 25 }, { id: 's3', code: 'QUOTATION', label: 'Báo giá', defaultProbability: 45 }, { id: 's4', code: 'NEGOTIATION', label: 'Đàm phán', defaultProbability: 70 }],
  types: [{ id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư', requiresProject: false }, { id: 't-install', code: 'INSTALLATION', label: 'Thi công', requiresProject: true }, { id: 't-both', code: 'SUPPLY_INSTALLATION', label: 'Cung cấp và thi công', requiresProject: true }],
  lostReasons: [{ id: 'r-price', code: 'PRICE_HIGHER', label: 'Giá cao hơn đối thủ', requiresNote: false }, { id: 'r-other', code: 'OTHER', label: 'Khác (kèm ghi chú)', requiresNote: true }],
};
const item = (n, over = {}) => ({ id: 'o' + n, code: 'CH-' + String(n).padStart(4, '0'), title: 'Cơ hội số ' + n, status: 'OPEN', access: 'FULL', type: { id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư' }, stage: { id: 's1', code: 'PROSPECTING', label: 'Tiếp cận' },
  customer: { id: CID, code: 'KH-00478', name: 'Công ty A' }, owner: { id: ME, code: 'NV-0003', fullName: 'Trần Bình' }, isProjectLinked: false, projectName: null, expectedAmountVnd: null, probability: 10, expectedCloseDate: null,
  holdUntil: null, wonAmountVnd: null, closedAt: null, deletedAt: null, version: 3, createdAt: NOW, updatedAt: NOW, ...over });
const detail = (over = {}) => ({ ...item(1), customerReadable: true, contact: null, needSummary: 'Cần 2 chiller', offerScope: null, probabilityOverridden: false, holdReason: null, wonDocType: null, wonDocNo: null, wonDocDate: null, wonDocUrl: null, wonDocFileName: null, lostReason: null, lostNote: null, ...over });
const techItem = (over = {}) => ({ id: 'o9', code: 'CH-0009', title: 'Lắp FCU khách sạn', access: 'TASK', type: { id: 't-install', code: 'INSTALLATION', label: 'Thi công' }, stage: { id: 's2', code: 'SURVEY', label: 'Khảo sát' }, customer: { id: CID, code: 'KH-00478', name: 'Công ty A' }, isProjectLinked: true, projectName: 'KS Biển Xanh', expectedCloseDate: '2026-12-20', version: 1, createdAt: NOW, updatedAt: NOW, ...over });
const page = (items, over = {}) => res(200, { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...over } });
const PEOPLE = [{ id: 'e2', code: 'NV-0002', fullName: 'Lê Thị Hai', departmentCode: 'KD' }, { id: 'e7', code: 'NV-0007', fullName: 'Phạm Kỹ Thuật', departmentCode: 'KT' }];

const server = ({ list = () => page([item(1)]), meta = () => res(200, { data: META }), get = () => res(200, { data: detail() }), write, people = () => res(200, { data: { items: PEOPLE } }) } = {}) => {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', ''); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, q: u.searchParams, body });
    if (method !== 'GET') return (write && write(p, body, method)) || res(200, { data: detail({ version: 4 }) });
    if (p === '/opportunities/meta') return meta();
    if (p === '/opportunities') return list(u.searchParams, calls.filter((c) => c.method === 'GET' && c.p === '/opportunities').length);
    if (/-candidates$/.test(p)) return people(p);
    if (/^\/opportunities\/[^/]+$/.test(p)) return get(p, calls.filter((c) => c.method === 'GET' && c.p === p).length);
    if (p === '/customers') return res(200, { data: { items: [{ id: CID, code: 'KH-00478', name: 'Công ty A', shortName: 'Cty A', version: 1 }], page: 1, pageSize: 8, total: 1, totalPages: 1 } });
    return res(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  };
  f.calls = calls;
  f.lists = () => calls.filter((c) => c.method === 'GET' && c.p === '/opportunities');
  f.writes = () => calls.filter((c) => c.method !== 'GET');
  f.count = (p) => calls.filter((c) => c.p === p).length;
  return f;
};

let vite; let dom; let createCustomerApiUi; let OpportunitiesPage; let OpportunityView; let createRoot; let act;
before(async () => {
  dom = installDom();
  dom.doc.querySelectorAll = () => []; // React tìm các radio cùng `name` qua querySelectorAll(chuỗi) của gốc tài liệu; miniDom không có => trả rỗng (nhóm do React điều khiển bằng `checked`)
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
const wait = async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const role = (perms) => ({ can: (p) => p in perms, me: { employeeId: ME, permissions: perms } });
const SALES = role({ 'customer.read': 'OWN', 'opportunity.read': 'OWN', 'opportunity.create': 'OWN', 'opportunity.update': 'OWN', 'opportunity.move_stage': 'OWN', 'opportunity.close': 'OWN', 'opportunity.assign': 'OWN' });
const ADMIN = role(Object.fromEntries(['customer.read', 'opportunity.read', 'opportunity.create', 'opportunity.update', 'opportunity.move_stage', 'opportunity.close', 'opportunity.assign', 'opportunity.reopen', 'opportunity.delete', 'opportunity.restore'].map((k) => [k, 'ALL'])));
const ACCT = role({ 'customer.read': 'ALL', 'opportunity.read': 'ALL' });
const TECH = role({ 'activity.read': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT', 'opportunity.read_assigned': 'OWN' });

async function mount(fetchImpl, r, el, extra = {}) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = []; const nav = [];
  const ui = { ...r, ...extra, customerApi: ctl, toast: (t) => toasts.push(t), confirm: () => {}, db: { customers: [] }, navigate: (p) => nav.push(p) };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(el(ui)); }); await flush(); await flush();
  return { ctl, ui, toasts, nav, container, unmount: () => act(async () => root.unmount()) };
}
const listPage = (f, r, extra) => mount(f, r, (ui) => React.createElement(OpportunitiesPage, { ui }), extra);
const viewPage = (f, r, id = 'o1') => mount(f, r, (ui) => React.createElement(OpportunityView, { ui, id }));
const modal = (root) => findAll(root, (e) => e.attributes.role === 'dialog')[0];
const rows = (root) => byTag(root, 'tr').slice(1);
const alerts = (root) => findAll(root, (e) => e.attributes.role === 'alert').map((e) => text(e));
const actionButtons = (root) => { const g = findAll(root, (e) => e.attributes['aria-label'] === 'Thao tác trên cơ hội')[0]; return g ? byTag(g, 'button').map((b) => text(b)) : []; };
async function pickGroup(root, groupLabel, optionRe) {
  const g = findAll(root, (e) => e.attributes['aria-label'] === groupLabel)[0]; assert.ok(g, 'có bộ lọc ' + groupLabel);
  await doAct(() => click(findAll(g, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]));
  await doAct(() => click(findAll(document.body, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]));
}
async function pickField(root, labelRe, optionRe) {
  const field = findAll(root, (e) => e.attributes.class === 'sg-field' && findAll(e, (l) => l.tagName === 'LABEL' && labelRe.test(text(l))).length)[0]; assert.ok(field, 'có ô ' + labelRe);
  await doAct(() => click(findAll(field, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]));
  const opt = findAll(document.body, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]; assert.ok(opt, 'có lựa chọn ' + optionRe);
  await doAct(() => click(opt));
}
const fill = async (root, labelRe, value) => { const el = inputByLabel(root, labelRe); assert.ok(el, 'có ô ' + labelRe); await doAct(() => type(el, value)); };
const press = async (root, re) => { const b = buttonByText(root, re); assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };

// ───── Danh sách ─────
test('danh sách (Kinh doanh): gọi GET /opportunities mặc định; hiện mã, tiêu đề, khách, giai đoạn, phụ trách, trạng thái; giá trị trống là "Chưa rõ", KHÔNG phải 0', async () => {
  const f = server({ list: () => page([item(1), item(2, { expectedAmountVnd: '7200000000', probability: 45, expectedCloseDate: '2020-01-05', stage: { id: 's3', code: 'QUOTATION', label: 'Báo giá' }, projectName: 'TTDL GĐ1' }), item(3, { expectedAmountVnd: '0', status: 'ON_HOLD', holdUntil: '2026-12-01' })]) });
  const m = await listPage(f, SALES);
  try {
    const q = f.lists()[0].q;
    assert.deepEqual([q.get('page'), q.get('pageSize'), q.get('sortBy'), q.get('sortOrder'), q.get('status'), q.get('q')], ['1', '20', 'updatedAt', 'desc', null, null]);
    assert.equal(f.count('/opportunities/meta'), 1);
    const r = rows(m.container); assert.equal(r.length, 3);
    const t1 = text(r[0]); const t2 = text(r[1]); const t3 = text(r[2]);
    assert.match(t1, /CH-0001/); assert.match(t1, /Cơ hội số 1/); assert.match(t1, /Công ty A/); assert.match(t1, /Tiếp cận/); assert.match(t1, /Trần Bình/); assert.match(t1, /Đang mở/);
    assert.match(t1, /Chưa rõ/); assert.doesNotMatch(t1, /(^|\D)0 đ/); assert.match(t1, /10%/);
    assert.match(t2, /7\.200\.000\.000 đ/); assert.match(t2, /45%/); assert.match(t2, /05\/01\/2020/); assert.match(t2, /Quá hạn chốt/); assert.match(t2, /TTDL GĐ1/); assert.match(t2, /Báo giá/);
    assert.match(t3, /(^|\D)0 đ/); assert.doesNotMatch(t3, /Chưa rõ/); assert.match(t3, /Tạm hoãn/); assert.match(t3, /Liên hệ lại 01\/12\/2026/); // số 0 thật khác với "chưa rõ"
    assert.match(text(m.container), /3 \/ 3 cơ hội/);
    assert.ok(buttonByText(m.container, /Tạo cơ hội/));
    for (const g of ['Lọc theo trạng thái', 'Lọc theo giai đoạn', 'Lọc theo loại', 'Sắp xếp']) assert.ok(findAll(m.container, (e) => e.attributes['aria-label'] === g)[0], g);
  } finally { await m.unmount(); }
});

test('không có dữ liệu: chưa lọc => "Chưa có cơ hội nào" kèm nút tạo (người có quyền tạo); đang lọc => "Không có cơ hội khớp bộ lọc"', async () => {
  const f = server({ list: () => page([]) });
  const m = await listPage(f, SALES);
  try {
    assert.match(text(m.container), /Chưa có cơ hội nào/);
    assert.equal(byTag(m.container, 'table').length, 0);
    assert.equal(byTag(m.container, 'button').filter((b) => /Tạo cơ hội/.test(text(b))).length, 2);
    await pickGroup(m.container, 'Lọc theo trạng thái', /^Thua$/);
    assert.equal(f.lists()[1].q.get('status'), 'LOST');
    assert.match(text(m.container), /Không có cơ hội khớp bộ lọc/);
  } finally { await m.unmount(); }
  const acct = await listPage(server({ list: () => page([]) }), ACCT);
  try { assert.match(text(acct.container), /Chưa có cơ hội nào/); assert.equal(buttonByText(acct.container, /Tạo cơ hội/), undefined); } finally { await acct.unmount(); }
});

test('dữ liệu lớn: 45 cơ hội / 3 trang — "Tải thêm" nối trang kế, không trùng dòng, hết trang thì ẩn nút; lỗi khi tải thêm giữ nguyên dòng đã có', async () => {
  const many = (from, n) => Array.from({ length: n }, (_, i) => item(from + i));
  let failNext = false;
  const f = server({ list: (q) => { const p = Number(q.get('page')); if (p === 3 && failNext) { failNext = false; return fail(500, 'INTERNAL', 'Máy chủ lỗi'); } return page(p === 1 ? many(1, 20) : p === 2 ? [item(20), ...many(21, 19)] : many(40, 6), { page: p, total: 45, totalPages: 3 }); } });
  const m = await listPage(f, ADMIN);
  try {
    assert.equal(rows(m.container).length, 20); assert.match(text(m.container), /20 \/ 45 cơ hội/);
    await press(m.container, /Tải thêm/);
    assert.equal(rows(m.container).length, 39); // dòng o20 lặp ở trang 2 không bị nhân đôi
    failNext = true; await press(m.container, /Tải thêm/);
    assert.equal(rows(m.container).length, 39); assert.ok(alerts(m.container).some((t) => /Lỗi máy chủ/.test(t)));
    await press(m.container, /Tải thêm/);
    assert.equal(rows(m.container).length, 45); assert.equal(new Set(rows(m.container).map((r) => text(r).slice(0, 7))).size, 45);
    assert.equal(buttonByText(m.container, /Tải thêm/), undefined);
  } finally { await m.unmount(); }
});

test('lỗi API: danh sách 500 => báo lỗi + "Thử lại" tải lại được; danh mục lỗi không làm mất danh sách; 403 => báo không đủ quyền, không có dòng nào', async () => {
  let n = 0;
  const f = server({ list: () => (++n === 1 ? fail(500, 'INTERNAL', 'Máy chủ lỗi') : page([item(1)])), meta: () => fail(500, 'INTERNAL', 'Máy chủ lỗi') });
  const m = await listPage(f, SALES);
  try {
    assert.equal(rows(m.container).length, 0);
    assert.equal(alerts(m.container).filter((t) => /Lỗi máy chủ/.test(t)).length, 2); // danh sách + danh mục
    await doAct(() => click(byTag(m.container, 'button').filter((b) => /Thử lại/.test(text(b))).pop()));
    assert.equal(rows(m.container).length, 1);
    assert.equal(findAll(m.container, (e) => e.attributes['aria-label'] === 'Lọc theo giai đoạn').length, 0); // danh mục chưa có => không bày bộ lọc rỗng
  } finally { await m.unmount(); }
  const denied = await listPage(server({ list: () => fail(403, 'FORBIDDEN', 'Không có quyền xem cơ hội.') }), SALES);
  try { assert.ok(alerts(denied.container).some((t) => /Không đủ quyền/.test(t))); assert.equal(rows(denied.container).length, 0); assert.equal(buttonByText(denied.container, /^Thử lại$/), undefined); } finally { await denied.unmount(); }
  const offline = await listPage(Object.assign(async () => { throw new TypeError('fetch failed'); }, {}), SALES);
  try { assert.ok(alerts(offline.container).some((t) => /Lỗi kết nối/.test(t))); } finally { await offline.unmount(); }
});

test('bộ lọc: trạng thái / giai đoạn / loại / sắp xếp gửi đúng tham số; tìm kiếm chờ gõ xong và cần ít nhất 2 ký tự', async () => {
  const f = server(); const m = await listPage(f, SALES);
  try {
    await pickGroup(m.container, 'Lọc theo trạng thái', /^Thắng$/);
    await pickGroup(m.container, 'Lọc theo giai đoạn', /Báo giá/);
    await pickGroup(m.container, 'Lọc theo loại', /^Thi công$/);
    await pickGroup(m.container, 'Sắp xếp', /Dự kiến chốt gần nhất/);
    const q = f.lists().pop().q;
    assert.deepEqual([q.get('status'), q.get('stageId'), q.get('typeId'), q.get('sortBy'), q.get('sortOrder'), q.get('page')], ['WON', 's3', 't-install', 'expectedCloseDate', 'asc', '1']);
    const box = findAll(m.container, (e) => e.tagName === 'INPUT' && e.attributes['aria-label'] === 'Tìm cơ hội')[0];
    const before = f.lists().length;
    await doAct(() => type(box, 'c')); await wait(350);
    assert.equal(f.lists().length, before); assert.match(text(m.container), /Gõ ít nhất 2 ký tự/);
    await doAct(() => type(box, 'chiller')); await wait(350);
    assert.equal(f.lists().length, before + 1); assert.equal(f.lists().pop().q.get('q'), 'chiller'); assert.equal(f.lists().pop().q.get('status'), 'WON');
  } finally { await m.unmount(); }
});

test('điện thoại: danh sách dạng thẻ (không bảng), vẫn "Chưa rõ" cho giá trị trống và mở được chi tiết', async () => {
  const f = server({ list: () => page([item(1), item(2, { expectedAmountVnd: '1250000' })]) });
  const m = await listPage(f, SALES, { mobile: true });
  try {
    assert.equal(byTag(m.container, 'table').length, 0);
    const cards = byTag(m.container, 'li'); assert.equal(cards.length, 2);
    assert.match(text(cards[0]), /Chưa rõ/); assert.doesNotMatch(text(cards[0]), /(^|\D)0 đ/); assert.match(text(cards[1]), /1\.250\.000 đ/);
    await doAct(() => click(byTag(cards[0], 'a')[0]));
    assert.deepEqual(m.nav, ['/pipeline/view/o1']);
  } finally { await m.unmount(); }
});

// ───── Quyền ─────
test('Kế toán (chỉ đọc): thấy đủ số liệu, KHÔNG có nút tạo; chi tiết không có thao tác nào', async () => {
  const f = server({ list: () => page([item(2, { expectedAmountVnd: '7200000000', owner: { id: 'e-other', code: 'NV-9', fullName: 'Người khác' } })]), get: () => res(200, { data: detail({ owner: { id: 'e-other', code: 'NV-9', fullName: 'Người khác' } }) }) });
  const m = await listPage(f, ACCT);
  try { assert.match(text(m.container), /7\.200\.000\.000 đ/); assert.equal(buttonByText(m.container, /Tạo cơ hội/), undefined); } finally { await m.unmount(); }
  const v = await viewPage(f, ACCT);
  try { assert.match(text(v.container), /Cần 2 chiller/); assert.deepEqual(actionButtons(v.container), []); } finally { await v.unmount(); }
});

test('Kỹ thuật (đường theo việc): không gọi danh mục, không có bộ lọc trạng thái / nút tạo; dòng và chi tiết KHÔNG có giá trị, xác suất, người phụ trách, thao tác', async () => {
  const f = server({ list: () => page([techItem()]), get: () => res(200, { data: techItem({ needSummary: 'Cần 120 FCU', offerScope: 'Lắp đặt FCU tầng 3–9' }) }) });
  const m = await listPage(f, TECH);
  try {
    assert.equal(f.count('/opportunities/meta'), 0);
    assert.equal(findAll(m.container, (e) => e.attributes['aria-label'] === 'Lọc theo trạng thái').length, 0);
    assert.equal(buttonByText(m.container, /Tạo cơ hội/), undefined);
    const t = text(rows(m.container)[0]);
    assert.match(t, /Lắp FCU khách sạn/); assert.match(t, /Khảo sát/); assert.match(t, /Theo việc/); assert.match(t, /20\/12\/2026/);
    assert.doesNotMatch(t, /đ\b|%|Chưa rõ|Đang mở/);
    assert.match(text(m.container), /không hiển thị giá trị, xác suất/);
  } finally { await m.unmount(); }
  const v = await viewPage(f, TECH, 'o9');
  try {
    const t = text(v.container);
    assert.match(t, /Cần 120 FCU/); assert.match(t, /Lắp đặt FCU tầng 3–9/); assert.match(t, /KS Biển Xanh/); assert.match(t, /chỉ có thông tin kỹ thuật/);
    assert.doesNotMatch(t, /Giá trị dự kiến|Xác suất|Phụ trách|Chưa rõ/);
    assert.deepEqual(actionButtons(v.container), []);
    assert.equal(byTag(v.container, 'a').filter((a) => /customers/.test(a.attributes.href || '')).length, 0); // không có đường mở hồ sơ khách
    assert.equal(f.count('/opportunities/meta'), 0);
  } finally { await v.unmount(); }
});

test('Kinh doanh: đủ thao tác trên cơ hội MÌNH phụ trách, không thao tác nào trên cơ hội của người khác; Quản trị CRM có thêm Xoá và Mở lại khi đã đóng', async () => {
  const mine = await viewPage(server(), SALES);
  try { assert.deepEqual(actionButtons(mine.container), ['Sửa', 'Chuyển giai đoạn', 'Tạm hoãn', 'Thắng', 'Thua', 'Chuyển người phụ trách']); assert.match(text(mine.container), /Chưa rõ/); } finally { await mine.unmount(); }
  const other = { owner: { id: 'e-other', code: 'NV-9', fullName: 'Người khác' } };
  const theirs = await viewPage(server({ get: () => res(200, { data: detail(other) }) }), SALES);
  try { assert.deepEqual(actionButtons(theirs.container), []); } finally { await theirs.unmount(); }
  const admin = await viewPage(server({ get: () => res(200, { data: detail(other) }) }), ADMIN);
  try { assert.deepEqual(actionButtons(admin.container), ['Sửa', 'Chuyển giai đoạn', 'Tạm hoãn', 'Thắng', 'Thua', 'Chuyển người phụ trách', 'Xoá']); } finally { await admin.unmount(); }
  const lost = await viewPage(server({ get: () => res(200, { data: detail({ ...other, status: 'LOST', lostReason: { id: 'r-price', code: 'PRICE_HIGHER', label: 'Giá cao hơn đối thủ' }, closedAt: NOW }) }) }), ADMIN);
  try { assert.deepEqual(actionButtons(lost.container), ['Chuyển người phụ trách', 'Mở lại', 'Xoá']); assert.match(text(lost.container), /Giá cao hơn đối thủ/); } finally { await lost.unmount(); }
  const held = await viewPage(server({ get: () => res(200, { data: detail({ status: 'ON_HOLD', holdUntil: '2026-12-01', holdReason: 'Chờ ngân sách' }) }) }), SALES);
  try { assert.deepEqual(actionButtons(held.container), ['Sửa', 'Đổi hạn hoãn', 'Tiếp tục', 'Thắng', 'Thua', 'Chuyển người phụ trách']); assert.match(text(held.container), /Chờ ngân sách/); } finally { await held.unmount(); }
});

// ───── Tạo cơ hội ─────
async function openCreate(f, r = SALES) {
  const m = await listPage(f, r);
  await press(m.container, /Tạo cơ hội/);
  const d = modal(m.container); assert.ok(d, 'hộp thoại mở');
  return { m, d };
}
async function chooseCustomer(d) {
  await fill(d, /Khách hàng/, 'Cô'); await wait(300);
  const opt = findAll(document.body, (e) => e.attributes.role === 'option')[0]; assert.ok(opt, 'có khách tìm thấy');
  await doAct(() => click(opt));
}
const chooseType = async (d, re) => { const lab = byTag(d, 'label').find((l) => re.test(text(l)) && byTag(l, 'input').some((i) => i.attributes.type === 'radio')); const input = byTag(lab, 'input')[0]; input.checked = true; await doAct(() => click(input)); };
const projectBox = (d) => byTag(d, 'input').find((i) => i.attributes.type === 'checkbox');

test('tạo cơ hội thành công: dùng 3 loại từ danh mục, câu hướng dẫn hiện sẵn; loại Thi công tự bật và khoá "Gắn với dự án"; giá trị trống KHÔNG gửi (không thành 0)', async () => {
  const f = server({ write: (p, body) => res(201, { data: detail({ id: 'o77', code: 'CH-0077', title: body.title }) }) });
  const { m, d } = await openCreate(f);
  try {
    assert.match(text(d), /PHẠM VI SISCOM CHÀO/); assert.match(text(d), /FCU cho khách sạn/); // 1c: hướng dẫn ở trạng thái mặc định
    assert.deepEqual(byTag(d, 'input').filter((i) => i.attributes.type === 'radio').length, 3);
    for (const name of ['Cung cấp thiết bị, vật tư', 'Thi công', 'Cung cấp và thi công']) assert.ok(text(d).includes(name), name);
    assert.equal(inputByLabel(d, /Tên dự án/), null);
    // Thiếu mọi thứ => lỗi theo ô, không gọi mạng.
    await press(d, /^Tạo cơ hội$/);
    assert.equal(f.writes().length, 0);
    for (const msg of [/Chọn khách hàng/, /Vui lòng nhập tiêu đề cơ hội/, /Chọn loại cơ hội/]) assert.match(text(d), msg);
    await chooseCustomer(d);
    assert.match(text(d), /KH-00478/);
    await fill(d, /Tiêu đề/, '  Lắp FCU khách sạn  ');
    await chooseType(d, /^Thi công$/);
    assert.equal(projectBox(d).checked, true); assert.equal(projectBox(d).disabled, true);
    assert.ok(inputByLabel(d, /Tên dự án/)); assert.ok(inputByLabel(d, /Phạm vi SISCOM/));
    await press(d, /^Tạo cơ hội$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Vui lòng nhập tên dự án/); assert.match(text(d), /Vui lòng nhập phạm vi SISCOM đang chào/);
    await fill(d, /Tên dự án/, 'KS Biển Xanh'); await fill(d, /Phạm vi SISCOM/, 'Lắp 120 FCU'); await fill(d, /Dự kiến chốt/, '2026-12-20');
    await press(d, /^Tạo cơ hội$/);
    assert.deepEqual(f.writes().map((c) => [c.method, c.p, c.body]), [['POST', '/opportunities', { customerId: CID, title: 'Lắp FCU khách sạn', typeId: 't-install', isProjectLinked: true, projectName: 'KS Biển Xanh', offerScope: 'Lắp 120 FCU', expectedCloseDate: '2026-12-20' }]]);
    assert.equal(modal(m.container), undefined);
    assert.deepEqual(m.toasts.map((t) => [t.tone, t.title]), [['success', 'Đã tạo cơ hội']]);
    assert.deepEqual(m.nav, ['/pipeline/view/o77']);
    assert.equal(f.lists().length, 2); // danh sách đọc lại từ máy chủ sau khi tạo
  } finally { await m.unmount(); }
});

test('tạo cơ hội: loại Cung cấp không bắt gắn dự án (O5) và gửi giá trị dạng chuỗi số; tiền nhập sai bị chặn tại chỗ', async () => {
  const f = server({ write: () => res(201, { data: detail({ id: 'o78', code: 'CH-0078' }) }) });
  const { m, d } = await openCreate(f);
  try {
    await chooseCustomer(d); await fill(d, /Tiêu đề/, 'Bán 120 FCU'); await chooseType(d, /^Cung cấp thiết bị, vật tư$/);
    assert.equal(projectBox(d).checked, false); assert.equal(projectBox(d).disabled, false); assert.equal(inputByLabel(d, /Tên dự án/), null);
    await fill(d, /Giá trị dự kiến/, '1 tỷ'); await press(d, /^Tạo cơ hội$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Giá trị chỉ gồm chữ số/);
    await fill(d, /Giá trị dự kiến/, '7200000000');
    assert.equal(inputByLabel(d, /Giá trị dự kiến/).value, '7.200.000.000'); // gõ liền chữ số => tự chèn dấu chấm ngăn nhóm hàng nghìn
    await press(d, /^Tạo cơ hội$/);
    assert.deepEqual(f.writes()[0].body, { customerId: CID, title: 'Bán 120 FCU', typeId: 't-supply', isProjectLinked: false, expectedAmountVnd: '7200000000' });
  } finally { await m.unmount(); }
});

test('tạo cơ hội thất bại: 400 theo trường gắn vào đúng ô; 403 báo không đủ quyền; hộp thoại và nội dung đã nhập được giữ, không điều hướng, không báo thành công', async () => {
  let mode = 400;
  const f = server({ write: () => (mode === 400 ? fail(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', [{ field: 'title', message: 'Tiêu đề đã bị máy chủ từ chối' }, { field: 'expectedAmountVnd', message: 'Giá trị không hợp lệ theo máy chủ' }]) : fail(403, 'FORBIDDEN', 'Không có quyền tạo cơ hội cho khách hàng này.')) });
  const { m, d } = await openCreate(f);
  try {
    await chooseCustomer(d); await fill(d, /Tiêu đề/, 'Bán 120 FCU'); await chooseType(d, /^Cung cấp thiết bị, vật tư$/);
    await press(d, /^Tạo cơ hội$/);
    assert.equal(f.writes().length, 1);
    assert.match(text(d), /Tiêu đề đã bị máy chủ từ chối/); assert.match(text(d), /Giá trị không hợp lệ theo máy chủ/);
    assert.equal(inputByLabel(d, /Tiêu đề/).value, 'Bán 120 FCU');
    mode = 403; await press(d, /^Tạo cơ hội$/);
    assert.ok(alerts(d).some((t) => /Không đủ quyền/.test(t) && /Không có quyền tạo cơ hội cho khách hàng này/.test(t)));
    assert.ok(modal(m.container)); assert.deepEqual(m.toasts, []); assert.deepEqual(m.nav, []); assert.equal(f.lists().length, 1);
  } finally { await m.unmount(); }
  const noMeta = await openCreate(server({ meta: () => fail(500, 'INTERNAL', 'Máy chủ lỗi') }));
  try { assert.ok(alerts(noMeta.d).some((t) => /Lỗi máy chủ/.test(t))); assert.equal(buttonByText(noMeta.d, /^Tạo cơ hội$/).disabled, true); } finally { await noMeta.m.unmount(); }
});

// ───── Thao tác trên chi tiết ─────
test('chuyển giai đoạn: gửi POST /stage với version đã tải, đọc lại chi tiết; 409 => báo xung đột, đọc lại, không báo thành công', async () => {
  let conflict = false;
  const f = server({ write: () => (conflict ? fail(409, 'OPPORTUNITY_VERSION_CONFLICT', 'Cơ hội đã được người khác thay đổi.') : res(201, { data: detail({ version: 4 }) })) });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Chuyển giai đoạn$/);
    let d = modal(m.container);
    await press(d, /^Chuyển giai đoạn$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Chọn giai đoạn/);
    assert.equal(findAll(document.body, (e) => e.attributes.role === 'option').length, 0);
    await pickField(d, /Giai đoạn mới/, /Khảo sát · mặc định 25%/);
    await press(d, /^Chuyển giai đoạn$/);
    assert.deepEqual(f.writes().map((c) => [c.method, c.p, c.body]), [['POST', '/opportunities/o1/stage', { version: 3, stageId: 's2' }]]);
    assert.equal(modal(m.container), undefined); assert.equal(f.count('/opportunities/o1'), 2);
    assert.deepEqual(m.toasts.map((t) => t.title), ['Đã chuyển giai đoạn']);
    conflict = true;
    await press(m.container, /^Chuyển giai đoạn$/); d = modal(m.container);
    await pickField(d, /Giai đoạn mới/, /Báo giá/); await press(d, /^Chuyển giai đoạn$/);
    assert.ok(alerts(d).some((t) => /Xung đột dữ liệu/.test(t) && /Dữ liệu đã được tải lại/.test(t)));
    assert.equal(f.count('/opportunities/o1'), 3); assert.equal(m.toasts.length, 1);
  } finally { await m.unmount(); }
});

// T-10: sau 409, chi tiết được đọc lại (version mới) nhưng hộp KHÔNG tạo lại (giữ hộp báo lỗi) — lựa chọn xác suất cũ phải về mặc định của bản mới.
test('T-10 chuyển giai đoạn: chọn "Về xác suất mặc định" rồi 409 => hộp vẫn báo xung đột, lựa chọn xác suất về "Giữ"; lưu lại gửi version mới + KEEP', async () => {
  let saved = 0;
  const f = server({
    get: (p, n) => res(200, { data: detail({ probabilityOverridden: true, probability: 33, version: n === 1 ? 3 : 5 }) }),
    write: () => { saved += 1; return saved === 1 ? fail(409, 'OPPORTUNITY_VERSION_CONFLICT', 'Cơ hội đã được người khác thay đổi.') : res(201, { data: detail({ version: 6 }) }); },
  });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Chuyển giai đoạn$/); let d = modal(m.container);
    await pickField(d, /Giai đoạn mới/, /Khảo sát/);
    await pickField(d, /Xác suất đang được nhập tay/, /Về xác suất mặc định/);
    await press(d, /^Chuyển giai đoạn$/);
    assert.deepEqual(f.writes()[0].body, { version: 3, stageId: 's2', probability: 'RESET' });
    d = modal(m.container); assert.ok(d, 'hộp còn mở sau 409');
    assert.equal(f.count('/opportunities/o1'), 2, 'đã đọc lại chi tiết');
    assert.ok(alerts(d).some((t) => /Xung đột dữ liệu/.test(t)), 'hộp báo lỗi vẫn còn');
    const field = findAll(d, (e) => e.attributes.class === 'sg-field' && findAll(e, (l) => l.tagName === 'LABEL' && /Xác suất đang được nhập tay/.test(text(l))).length)[0];
    assert.match(text(field), /Giữ xác suất đang nhập tay/); assert.doesNotMatch(text(field), /Về xác suất mặc định/);
    await press(d, /^Chuyển giai đoạn$/);
    assert.deepEqual(f.writes()[1].body, { version: 5, stageId: 's2', probability: 'KEEP' });
  } finally { await m.unmount(); }
});

// Lỗi nghiệm thu staging 19/11/2026: rời Tiếp cận khi chưa ghi nhu cầu => máy chủ 400 gắn lỗi vào needSummary (ô KHÔNG có trong hộp Chuyển giai đoạn).
// Trước sửa: hộp chỉ hiện câu chung "Sửa các trường được đánh dấu" mà không trường nào được đánh dấu. Sau sửa: hiện đúng câu lý do của máy chủ.
test('chuyển giai đoạn bị máy chủ từ chối vì ô không có trong hộp (nhu cầu của khách) => hiện đúng lý do, chỉ cách sửa; không báo thành công', async () => {
  const MSG = 'Phải ghi nhu cầu của khách trước khi rời giai đoạn Tiếp cận.';
  const f = server({ write: () => fail(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', [{ field: 'needSummary', message: MSG }, { message: 'Ghi chú khác của máy chủ' }]) });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Chuyển giai đoạn$/); const d = modal(m.container);
    await pickField(d, /Giai đoạn mới/, /Báo giá/); await press(d, /^Chuyển giai đoạn$/);
    assert.equal(f.writes().length, 1);
    const box = alerts(d).join(' | ');
    assert.ok(box.includes(MSG), 'hiện lý do của máy chủ: ' + box);
    assert.match(box, /Ghi chú khác của máy chủ/); // lỗi không gắn trường cũng hiện
    assert.match(box, /nút Sửa/); // chỉ cách sửa: ô này nằm ở hộp Sửa cơ hội
    assert.doesNotMatch(box, /Sửa các trường được đánh dấu/); // không còn câu chung gây hiểu nhầm
    assert.ok(modal(m.container), 'hộp vẫn mở'); assert.equal(m.toasts.length, 0);
  } finally { await m.unmount(); }
});

test('Thua: lý do lấy từ danh mục; lý do "Khác" bắt buộc ghi chú. Tạm hoãn: bắt buộc ngày + lý do. Xoá (Quản trị CRM): bắt buộc lý do, xong về danh sách', async () => {
  const f = server();
  const m = await viewPage(f, ADMIN);
  try {
    await press(m.container, /^Thua$/); let d = modal(m.container);
    await pickField(d, /Lý do thua/, /Khác/); await press(d, /^Thua$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /Lý do này phải kèm ghi chú/);
    await fill(d, /Ghi chú/, 'Khách dừng dự án'); await press(d, /^Thua$/);
    assert.deepEqual(f.writes().pop().body, { version: 3, lostReasonId: 'r-other', lostNote: 'Khách dừng dự án' }); assert.equal(f.writes().pop().p, '/opportunities/o1/lose');
    await press(m.container, /^Tạm hoãn$/); d = modal(m.container);
    await press(d, /^Tạm hoãn$/);
    assert.match(text(d), /Chọn ngày liên hệ lại/); assert.match(text(d), /Tạm hoãn phải ghi lý do/); assert.equal(f.writes().length, 1);
    await fill(d, /Ngày liên hệ lại/, '2026-12-15'); await fill(d, /Lý do tạm hoãn/, 'Chờ ngân sách'); await press(d, /^Tạm hoãn$/);
    assert.deepEqual([f.writes().pop().p, f.writes().pop().body], ['/opportunities/o1/hold', { version: 3, holdUntil: '2026-12-15', holdReason: 'Chờ ngân sách' }]);
    await press(m.container, /^Xoá$/); d = modal(m.container);
    await press(d, /^Xoá$/); assert.match(text(d), /Xoá cơ hội phải ghi lý do/);
    await fill(d, /Lý do xoá/, 'Nhập nhầm'); await press(d, /^Xoá$/);
    assert.deepEqual([f.writes().pop().method, f.writes().pop().p, f.writes().pop().body], ['DELETE', '/opportunities/o1', { version: 3, reason: 'Nhập nhầm' }]);
    assert.deepEqual(m.nav, ['/pipeline']);
  } finally { await m.unmount(); }
});

test('chuyển người phụ trách và Thắng: người nhận lấy từ đúng API ứng viên của thao tác; chuyển xong không còn thấy => về danh sách; Thắng gửi giá trị chốt dạng chuỗi', async () => {
  const f = server({ write: (p) => (/\/assign$/.test(p) ? res(201, { data: { id: 'o1', code: 'CH-0001', version: 4, transferred: true } }) : res(200, { data: detail({ status: 'WON', version: 4 }) })), get: () => res(200, { data: detail({ expectedAmountVnd: '7200000000' }) }) });
  const m = await viewPage(f, SALES);
  try {
    await press(m.container, /^Thắng$/); let d = modal(m.container);
    assert.equal(f.count('/opportunities/o1/handover-candidates'), 1); assert.equal(f.count('/opportunities/o1/owner-candidates'), 0);
    assert.equal(inputByLabel(d, /Giá trị chốt/).value, '7.200.000.000'); // gợi ý từ giá trị dự kiến, có dấu chấm ngăn nhóm, sửa được
    await press(d, /^Thắng$/);
    assert.equal(f.writes().length, 0);
    for (const msg of [/Vui lòng nhập số chứng từ/, /Chọn ngày chứng từ/, /Vui lòng nhập đường dẫn chứng từ/, /Chọn người nhận bàn giao/]) assert.match(text(d), msg);
    await fill(d, /Giá trị chốt/, '7000000000'); assert.equal(inputByLabel(d, /Giá trị chốt/).value, '7.000.000.000');
    await fill(d, /Số chứng từ/, 'HD-2026-118'); await fill(d, /Ngày chứng từ/, '2026-11-10');
    await fill(d, /Đường dẫn chứng từ/, 'http://drive.example.com/x'); await pickField(d, /Người nhận/, /Phạm Kỹ Thuật \(NV-0007\) · KT/);
    await press(d, /^Thắng$/);
    assert.equal(f.writes().length, 0); assert.match(text(d), /https hợp lệ/);
    await fill(d, /Đường dẫn chứng từ/, 'https://drive.example.com/hd-118'); await press(d, /^Thắng$/);
    assert.deepEqual([f.writes()[0].p, f.writes()[0].body], ['/opportunities/o1/win', { version: 3, wonAmountVnd: '7000000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-2026-118', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/hd-118', handoverToId: 'e7' }]);
    await press(m.container, /^Chuyển người phụ trách$/); d = modal(m.container);
    assert.equal(f.count('/opportunities/o1/owner-candidates'), 1);
    await pickField(d, /Người phụ trách mới/, /Lê Thị Hai/); await press(d, /^Chuyển người phụ trách$/);
    assert.match(text(d), /Chuyển người phụ trách phải ghi lý do/);
    await fill(d, /Lý do chuyển/, 'Bàn giao địa bàn'); await press(d, /^Chuyển người phụ trách$/);
    assert.deepEqual([f.writes()[1].p, f.writes()[1].body], ['/opportunities/o1/assign', { version: 3, ownerId: 'e2', reason: 'Bàn giao địa bàn' }]);
    assert.deepEqual(m.nav, ['/pipeline']);
  } finally { await m.unmount(); }
  const none = await viewPage(server({ people: () => res(200, { data: { items: [] } }) }), SALES);
  try { await press(none.container, /^Chuyển người phụ trách$/); assert.match(text(modal(none.container)), /Không có người nào đủ điều kiện nhận/); } finally { await none.unmount(); }
});

test('chi tiết: 404 => "Không tìm thấy cơ hội" (không nhắc khách hàng); cơ hội Thắng hiện giá trị chốt + chứng từ, liên kết chỉ khi là https', async () => {
  const gone = await viewPage(server({ get: () => fail(404, 'OPPORTUNITY_NOT_FOUND', 'Không tìm thấy cơ hội.') }), SALES, 'missing');
  try { const a = alerts(gone.container).join(' '); assert.match(a, /Không tìm thấy cơ hội/); assert.doesNotMatch(a, /khách hàng/); } finally { await gone.unmount(); }
  const won = (url) => server({ get: () => res(200, { data: detail({ status: 'WON', probability: 100, wonAmountVnd: '7000000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-118', wonDocDate: '2026-11-10', wonDocUrl: url, wonDocFileName: 'hd-118.pdf', closedAt: NOW }) }) });
  const ok = await viewPage(won('https://drive.example.com/hd-118'), SALES);
  try {
    const t = text(ok.container); assert.match(t, /7\.000\.000\.000 đ/); assert.match(t, /Hợp đồng · HD-118 · 10\/11\/2026/); assert.match(t, /100%/);
    assert.deepEqual(byTag(ok.container, 'a').filter((a) => /drive/.test(a.attributes.href || '')).map((a) => [a.attributes.href, a.attributes.rel, text(a)]), [['https://drive.example.com/hd-118', 'noopener noreferrer', 'hd-118.pdf']]);
  } finally { await ok.unmount(); }
  const bad = await viewPage(won('javascript:alert(1)'), SALES);
  try { assert.equal(byTag(bad.container, 'a').filter((a) => /javascript/i.test(a.attributes.href || '')).length, 0); assert.match(text(bad.container), /hd-118\.pdf/); } finally { await bad.unmount(); }
});
