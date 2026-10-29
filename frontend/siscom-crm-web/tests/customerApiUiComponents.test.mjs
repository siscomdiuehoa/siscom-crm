// Run: node --test tests/   (Node >= 18; uses only vite + react already in package.json). Injected fetch only; no network, no DB, no browser.
// Component-level regression for CustomerFormDrawer + CustomerApiDetail on ONE real controller (real React rendering via a tiny in-memory DOM, tests/helpers/miniDom.mjs):
//   409 stale version -> unsaved draft kept, server copy shown on request, user chooses; never auto-overwrite; no localStorage in API mode.
//   401/403 -> access-denied state with NO retry/save bypass; 404 -> not-found state.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, byTag, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const err = (status, code, message = 'x', details) => res(status, { error: { code, message, details } });
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00007', name: 'Công ty A', short: 'A', phone: '0901234567', version: 2, ...over });
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

// patch(n)/get(n): response (or Error to throw) for the n-th PATCH / GET /customers/:id (1-based). Lookups are served empty-but-valid.
const server = ({ patch, get }) => {
  const calls = []; let np = 0; let ng = 0;
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    let r;
    if (new URL(url).pathname.endsWith('/lookups')) r = res(200, { data: LOOKUPS });
    else if (new URL(url).pathname.endsWith('/customers/owner-candidates')) r = res(200, { data: { scope: 'ALL', items: [] } }); // PR 7: biểu mẫu tải ứng viên phụ trách khi mở; không tính vào gets()
    else if (method === 'PATCH') r = patch(++np);
    else r = get ? get(++ng) : res(200, { data: apiCust() });
    if (r instanceof Error) throw r;
    return r;
  };
  f.calls = calls; f.patches = () => calls.filter((c) => c.method === 'PATCH'); f.gets = () => calls.filter((c) => c.method === 'GET' && !new URL(c.url).pathname.endsWith('/lookups') && !new URL(c.url).pathname.endsWith('/customers/owner-candidates'));
  return f;
};
const VERSION_409 = () => err(409, 'CUSTOMER_VERSION_CONFLICT', 'Khách hàng đã được người khác cập nhật.', { currentVersion: 5 });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// Mount CustomerFormDrawer (edit) on a loaded controller. Returns helpers; `toasts` records ui.toast calls, `confirms` ui.confirm calls.
async function mountForm(fetchImpl, { onClose = () => {}, onSaved = () => {} } = {}) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl });
  await ctl.loadDetail(ID);
  const toasts = []; const confirms = [];
  const ui = { can: () => true /* simulates a server-granted actor */, customerApi: ctl, toast: (t) => toasts.push(t), confirm: (c) => confirms.push(c), db: { customers: [] }, navigate: () => {} };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  const initial = ctl.getState().detail.customer;
  await act(async () => { root.render(React.createElement(CustomerFormDrawer, { open: true, initial, ui, onClose, onSaved })); });
  await flush();
  return { ctl, ui, toasts, confirms, container, root, unmount: () => act(async () => root.unmount()) };
}
const act_ = async (fn) => { await act(async () => { await fn(); }); await flush(); };

test('409: bản nháp chưa lưu được giữ nguyên trong ô nhập; hiện panel xung đột; không lưu đè', async () => {
  const f = server({ patch: VERSION_409 }); const m = await mountForm(f);
  try {
    await act_(() => type(inputByLabel(m.container, /^Tên công ty/), 'Công ty A — bản nháp của tôi'));
    await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '0988888888'));
    await act_(() => click(buttonByText(m.container, /Lưu thay đổi/)));
    assert.equal(f.patches().length, 1); assert.equal(f.patches()[0].body.version, 2);
    assert.match(text(m.container), /Khách hàng đã được người khác cập nhật/);
    assert.equal(inputByLabel(m.container, /^Tên công ty/).value, 'Công ty A — bản nháp của tôi');
    assert.equal(inputByLabel(m.container, /^Điện thoại/).value, '0988888888');
    await flush(); assert.equal(f.patches().length, 1); // nothing retried on its own
    assert.equal(m.ctl.getState().detail.customer.name, 'Công ty A');
  } finally { await m.unmount(); }
});

const draftOf = (m) => ({ name: inputByLabel(m.container, /^Tên công ty/).value, phone: inputByLabel(m.container, /^Điện thoại/).value });
const typeDraft = async (m) => { await act_(() => type(inputByLabel(m.container, /^Tên công ty/), 'Công ty A — bản nháp của tôi')); await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '0988888888')); };
const saveClick = (m) => act_(() => click(buttonByText(m.container, /Lưu thay đổi/)));
const newer = (n) => res(200, { data: n === 1 ? apiCust() : apiCust({ version: 5, name: 'Công ty A (người khác sửa)', phone: '0999000111' }) });

test('409 → "Tải bản mới nhất": hiện phiên bản/giá trị máy chủ + khác biệt, bản nháp vẫn nguyên, không PATCH thêm', async () => {
  const f = server({ patch: VERSION_409, get: newer }); const m = await mountForm(f);
  try {
    await typeDraft(m); await saveClick(m);
    await act_(() => click(buttonByText(m.container, /Tải bản mới nhất từ máy chủ/)));
    const t = text(m.container);
    assert.match(t, /Của bạn \(chưa lưu\)/); assert.match(t, /Trên máy chủ/);
    assert.match(t, /Công ty A \(người khác sửa\)/); assert.match(t, /Công ty A — bản nháp của tôi/); assert.match(t, /0999000111/); assert.match(t, /0988888888/);
    assert.deepEqual(draftOf(m), { name: 'Công ty A — bản nháp của tôi', phone: '0988888888' });
    assert.equal(f.patches().length, 1); assert.equal(m.ctl.getState().detail.customer.version, 2);
    assert.ok(buttonByText(m.container, /Dùng bản máy chủ/)); assert.ok(buttonByText(m.container, /Giữ thay đổi của tôi/));
  } finally { await m.unmount(); }
});

test('409 → "Dùng bản máy chủ" (qua trang chi tiết thật): ô nhập chuyển sang giá trị máy chủ (chủ động bỏ nháp), không PATCH thêm', async () => {
  const f = server({ patch: VERSION_409, get: newer }); const m = await mountDetail(f);
  try {
    await act_(() => click(buttonByText(m.container, /Sửa thông tin/)));
    await typeDraft(m); await saveClick(m);
    await act_(() => click(buttonByText(m.container, /Tải bản mới nhất từ máy chủ/)));
    assert.deepEqual(draftOf(m), { name: 'Công ty A — bản nháp của tôi', phone: '0988888888' }); // still the draft until the user chooses
    await act_(() => click(buttonByText(m.container, /Dùng bản máy chủ/)));
    assert.deepEqual(draftOf(m), { name: 'Công ty A (người khác sửa)', phone: '0999000111' });
    assert.doesNotMatch(text(m.container), /Khách hàng đã được người khác cập nhật/);
    assert.equal(f.patches().length, 1); assert.equal(m.ctl.getState().detail.customer.version, 5);
  } finally { await m.unmount(); }
});
test('409 → "Giữ thay đổi của tôi": giữ nháp, KHÔNG ghi ngay; chỉ khi bấm Lưu mới PATCH với version máy chủ', async () => {
  const f = server({ patch: (n) => (n === 1 ? VERSION_409() : res(200, { data: apiCust({ version: 6, name: 'Công ty A — bản nháp của tôi', phone: '0988888888' }) })), get: newer });
  let saved = null; const m = await mountForm(f, { onSaved: (c) => { saved = c; } });
  try {
    await typeDraft(m); await saveClick(m);
    await act_(() => click(buttonByText(m.container, /Tải bản mới nhất từ máy chủ/)));
    await act_(() => click(buttonByText(m.container, /Giữ thay đổi của tôi/)));
    assert.equal(f.patches().length, 1); // choosing alone never writes
    assert.deepEqual(draftOf(m), { name: 'Công ty A — bản nháp của tôi', phone: '0988888888' });
    assert.doesNotMatch(text(m.container), /Khách hàng đã được người khác cập nhật/);
    await saveClick(m);
    assert.equal(f.patches().length, 2); assert.equal(f.patches()[1].body.version, 5); assert.equal(f.patches()[1].body.name, 'Công ty A — bản nháp của tôi');
    assert.equal(saved.version, 6);
  } finally { await m.unmount(); }
});

test('409 → không tự thử lại; gõ tiếp vào bản nháp không làm mất panel xung đột', async () => {
  const f = server({ patch: VERSION_409 }); const m = await mountForm(f);
  try {
    await typeDraft(m); await saveClick(m);
    await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '0977777777'));
    assert.match(text(m.container), /Khách hàng đã được người khác cập nhật/);
    assert.equal(inputByLabel(m.container, /^Điện thoại/).value, '0977777777');
    assert.equal(f.patches().length, 1);
  } finally { await m.unmount(); }
});

test('409 → tải bản máy chủ lỗi 403: báo từ chối truy cập, giữ nháp, nút tải lại bị khoá', async () => {
  const f = server({ patch: VERSION_409, get: (n) => (n === 1 ? res(200, { data: apiCust() }) : err(403, 'FORBIDDEN')) }); const m = await mountForm(f);
  try {
    await typeDraft(m); await saveClick(m);
    await act_(() => click(buttonByText(m.container, /Tải bản mới nhất từ máy chủ/)));
    assert.match(text(m.container), /Không đủ quyền/); assert.match(text(m.container), /Không tự động thử lại/);
    assert.equal(buttonByText(m.container, /Thử tải lại/).disabled, true);
    assert.equal(click(buttonByText(m.container, /Thử tải lại/)), false);
    assert.equal(f.gets().length, 2); assert.equal(draftOf(m).name, 'Công ty A — bản nháp của tôi');
  } finally { await m.unmount(); }
});

for (const [st, code, title] of [[401, 'UNAUTHENTICATED', /Chưa đăng nhập/], [403, 'FORBIDDEN', /Không đủ quyền/]]) {
  test(`${st}: trạng thái từ chối truy cập, giữ nháp, không có đường vòng thử lại (Lưu bị khoá, gõ không xoá thông báo)`, async () => {
    const f = server({ patch: () => err(st, code) }); const m = await mountForm(f);
    try {
      await typeDraft(m); await saveClick(m);
      assert.equal(f.patches().length, 1);
      assert.match(text(m.container), title); assert.match(text(m.container), new RegExp('\\(' + st + '\\)')); assert.match(text(m.container), /Không tự động thử lại/);
      assert.equal(buttonByText(m.container, /^Thử lại$/), undefined);
      assert.deepEqual(draftOf(m), { name: 'Công ty A — bản nháp của tôi', phone: '0988888888' });
      await act_(() => type(inputByLabel(m.container, /^Điện thoại/), '0966666666')); // editing must not dismiss the notice
      assert.match(text(m.container), title);
      const saveBtn = buttonByText(m.container, /Lưu thay đổi/);
      assert.equal(saveBtn.disabled, true); assert.equal(click(saveBtn), false);
      await flush(); assert.equal(f.patches().length, 1); assert.equal(m.toasts.filter((t) => t.tone === 'success').length, 0);
    } finally { await m.unmount(); }
  });
}

test('404 khi lưu: hiện không tìm thấy, giữ nháp, không báo thành công', async () => {
  const f = server({ patch: () => err(404, 'NOT_FOUND', 'Không tìm thấy khách hàng') }); const m = await mountForm(f);
  try {
    await typeDraft(m); await saveClick(m);
    assert.match(text(m.container), /Không tìm thấy khách hàng \(404\)/); assert.match(text(m.container), /đã bị xoá hoặc bạn không còn quyền/);
    assert.equal(buttonByText(m.container, /^Thử lại$/), undefined);
    assert.equal(draftOf(m).name, 'Công ty A — bản nháp của tôi');
    assert.equal(m.toasts.some((t) => t.tone === 'success'), false);
  } finally { await m.unmount(); }
});

test('toàn bộ luồng 409 ở chế độ API không ghi localStorage', async () => {
  const writes = []; const prev = globalThis.localStorage;
  globalThis.localStorage = { setItem: (...a) => writes.push(a), removeItem: (...a) => writes.push(a), getItem: () => null, clear: () => writes.push('clear') };
  try {
    const f = server({ patch: (n) => (n === 1 ? VERSION_409() : res(200, { data: apiCust({ version: 6 }) })), get: newer }); const m = await mountForm(f);
    try {
      await typeDraft(m); await saveClick(m);
      await act_(() => click(buttonByText(m.container, /Tải bản mới nhất từ máy chủ/)));
      await act_(() => click(buttonByText(m.container, /Giữ thay đổi của tôi/))); await saveClick(m);
    } finally { await m.unmount(); }
  } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
  assert.deepEqual(writes, []);
});

// ---- CustomerApiDetail (page level): access-denied / not-found states, no retry bypass ----
async function mountDetail(fetchImpl) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const nav = [];
  const ui = { can: () => true /* simulates a server-granted actor */, customerApi: ctl, toast() {}, confirm() {}, db: { customers: [] }, navigate: (p) => nav.push(p) };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(React.createElement(CustomerApiDetail, { ui, id: ID })); }); await flush();
  return { ctl, nav, container, unmount: () => act(async () => root.unmount()) };
}
for (const [st, code, title] of [[401, 'UNAUTHENTICATED', /Chưa đăng nhập/], [403, 'FORBIDDEN', /Không đủ quyền/]]) {
  test(`chi tiết ${st}: trạng thái từ chối truy cập, không nút thử lại, không hiện dữ liệu cũ, gọi API đúng 1 lần`, async () => {
    const f = server({ patch: () => { throw new Error('no'); }, get: () => err(st, code) }); const m = await mountDetail(f);
    try {
      assert.match(text(m.container), title); assert.match(text(m.container), /Không tự động thử lại/);
      assert.equal(buttonByText(m.container, /Thử lại/), undefined); assert.equal(buttonByText(m.container, /Sửa thông tin/), undefined);
      assert.equal(f.gets().length, 1);
    } finally { await m.unmount(); }
  });
}
test('chi tiết 404: trạng thái không tìm thấy + quay lại danh sách, không nút thử lại, không sửa được', async () => {
  const f = server({ patch: () => { throw new Error('no'); }, get: () => err(404, 'NOT_FOUND', 'Không tìm thấy') }); const m = await mountDetail(f);
  try {
    assert.match(text(m.container), /Không tìm thấy khách hàng \(404\)/); assert.match(text(m.container), /không tồn tại hoặc không còn truy cập được/);
    assert.equal(buttonByText(m.container, /Thử lại/), undefined); assert.equal(buttonByText(m.container, /Sửa thông tin/), undefined);
    await act_(() => click(buttonByText(m.container, /Danh sách khách hàng/))); assert.deepEqual(m.nav, ['/customers']);
  } finally { await m.unmount(); }
});