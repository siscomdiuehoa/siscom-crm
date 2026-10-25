// Run: node --test tests/customerApiUiNavigation.test.mjs   (Node >= 18; vite + react only. Injected fetch, in-memory DOM; no network, no DB, no browser.)
// REAL <App> (src/App.jsx) in customer API mode driven through hash navigation: list <-> detail <-> edit drawer, quick switches between customers,
// 409 draft, 401/403 and display code vs backend UUID. Mocked fetch only — NOT a real backend / browser E2E.
// Limits of miniDom (tests/helpers/miniDom.mjs): no layout/CSS/focus, no real History/back button (hashchange is simulated by assigning location.hash),
// no beforeunload/tab close, timers are real. Browser back == a hash change to the previous hash; that is exactly what App listens to.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, byTag, findAll, buttonByText, inputByLabel, click, type, submit } from './helpers/miniDom.mjs';

// src/ API mode is fail-closed (PR #94: no server actor -> every write action denied). These navigation/draft tests need the edit drawer, so they run with a
// TEST-ONLY granted actor swapped in via vite alias (create+update only). `mount(h, { granted: false })` keeps the real fail-closed module.
const GRANTED = new URL('./helpers/grantedApiModePermissions.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = 'http://127.0.0.1:3000/api/v1';
const IDA = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const IDB = '1c0a2d63-4b1f-4d4f-8e7a-1b2c3d4e5f60';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LOOKUPS = { customer_tier: [], customer_status: [], industry: [], source: [], province: [] };
const CONFIG = new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cust = (id, code, name, version = 1) => ({ id, code, name, shortName: name, phone: '0901234567', version, createdAt: '2026-10-01T00:00:00.000Z' });
const A = cust(IDA, 'KH-00001', 'Công ty Alpha Server');
const B = cust(IDB, 'KH-00002', 'Công ty Beta Server');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const err = (status, code) => res(status, { error: { code, message: 'x' } });

let dom; let act; let createRoot; let DB_KEY;
const servers = []; let store; let reads; let writes; let calls; let handler; let listeners; let hash; let apps;

async function loadApp(granted = true) {
  const prev = { f: process.env.VITE_CRM_API_ENABLED, b: process.env.VITE_CRM_API_BASE };
  process.env.VITE_CRM_API_ENABLED = 'true'; process.env.VITE_CRM_API_BASE = BASE;
  const vite = await createServer({ configFile: CONFIG, resolve: granted ? { alias: [{ find: /^.*\/auth\/apiModePermissions\.js$/, replacement: GRANTED }] } : {}, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  servers.push(vite);
  const mod = await vite.ssrLoadModule('/src/App.jsx');
  ({ DB_KEY } = await vite.ssrLoadModule('/src/data/repository/index.js'));
  if (prev.f === undefined) delete process.env.VITE_CRM_API_ENABLED; else process.env.VITE_CRM_API_ENABLED = prev.f;
  if (prev.b === undefined) delete process.env.VITE_CRM_API_BASE; else process.env.VITE_CRM_API_BASE = prev.b;
  return mod.default;
}

before(async () => {
  dom = installDom(); apps = [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  listeners = {};
  window.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
  window.removeEventListener = (t, f) => { listeners[t] = (listeners[t] || []).filter((x) => x !== f); };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.innerWidth = 1440;
  document.querySelector = () => null;
  Object.getPrototypeOf(document.createElement('x')).getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
  // Assigning location.hash behaves like the browser: updates the hash and fires `hashchange` to the registered listeners.
  const loc = { search: '', get hash() { return hash; }, set hash(v) { hash = String(v).startsWith('#') ? String(v) : '#' + v; (listeners.hashchange || []).slice().forEach((f) => f({ type: 'hashchange' })); } };
  globalThis.location = loc; window.location = loc;
  globalThis.localStorage = {
    getItem: (k) => { reads.push(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: (k, v) => { writes.push(k); store[k] = String(v); },
    removeItem: (k) => { writes.push('remove:' + k); delete store[k]; },
    key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: (url, init = {}) => { calls.push({ url, method: init.method || 'GET', path: new URL(url).pathname, search: new URL(url).search }); return handler(url, init); } });
  ({ createRoot } = await import('react-dom/client')); ({ act } = await import('react'));
});
// dom.restore() is deliberately NOT called: App toasts auto-dismiss on a 4.5 s timer that may fire after the last test; one process per test file, so globals die with it.
after(async () => { for (const s of servers) await s.close(); delete globalThis.localStorage; delete globalThis.location; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
beforeEach(() => { store = {}; reads = []; writes = []; calls = []; listeners = { ...listeners, hashchange: [], keydown: [] }; handler = defaultServer(); });

function defaultServer(over = {}) {
  return async (url, init = {}) => {
    const p = new URL(url).pathname; const m = init.method || 'GET';
    if (over[m + ' ' + p]) return over[m + ' ' + p](url, init);
    if (p.endsWith('/lookups')) return res(200, { data: LOOKUPS });
    if (p.endsWith('/customers')) return res(200, { data: { items: [A, B], total: 2, page: 1, pageSize: 20, totalPages: 1 } });
    if (m === 'PATCH') return res(200, { data: { ...(p.endsWith(IDA) ? A : B), version: 2 } });
    if (p.endsWith(IDA)) return res(200, { data: A });
    if (p.endsWith(IDB)) return res(200, { data: B });
    return err(404, 'NOT_FOUND');
  };
}
const getsOf = (id) => calls.filter((c) => c.method === 'GET' && c.path.endsWith('/customers/' + id));
const patches = () => calls.filter((c) => c.method === 'PATCH');
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function mount(h, { granted = true } = {}) {
  hash = h;
  const App = await loadApp(granted); // fresh module graph: the controller is a module singleton
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
  return { container, unmount: async () => { await act(async () => root.unmount()); }, nav: async (to) => { await act(async () => { globalThis.location.hash = to; }); await settle(); } };
}
const press = async (el) => { assert.ok(el, 'element exists'); await act(async () => { click(el); }); await settle(); };
const typeInto = async (el, v) => { assert.ok(el, 'input exists'); await act(async () => { type(el, v); }); };
const pressEscape = async () => { await act(async () => { (listeners.keydown || []).slice().forEach((f) => f({ key: 'Escape' })); }); await settle(); };
const rowOf = (c, re) => findAll(c, (e) => e.tagName === 'TR').find((r) => re.test(text(r)));
const main = (c) => text(byTag(c, 'main')[0]);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test('đường dẫn dùng UUID, màn hình chỉ hiện mã KH: bấm dòng danh sách → #/customers/<UUID>, GET theo UUID, không lộ UUID trên giao diện', async () => {
  const d = await mount('#/customers');
  assert.match(main(d.container), /KH-00001/); assert.doesNotMatch(text(d.container), UUID_RE, 'list shows no uuid');
  await press(rowOf(d.container, /Alpha/));
  assert.equal(hash, '#/customers/' + IDA, 'path uses uuid, not display code');
  assert.equal(getsOf(IDA).length, 1); assert.equal(getsOf('KH-00001').length, 0);
  assert.match(main(d.container), /KH-00001/); assert.match(main(d.container), /Công ty Alpha Server/);
  assert.doesNotMatch(text(d.container), UUID_RE, 'detail shows no uuid');
  await d.unmount();
});

test('mở thẳng bằng MÃ HIỂN THỊ (#/customers/KH-00001): bị từ chối trước khi gọi mạng, không hiện khách hàng nào, không fallback', async () => {
  const d = await mount('#/customers/KH-00001');
  assert.equal(calls.filter((c) => /\/customers\/KH-00001/.test(c.path)).length, 0, 'display code never sent as path id');
  assert.equal(calls.filter((c) => c.method === 'GET' && /\/customers\/[^/]+$/.test(c.path) && !c.path.endsWith('/lookups')).length, 0);
  assert.doesNotMatch(main(d.container), /Alpha|Beta/); assert.match(text(byTag(d.container, 'main')[0]), /UUID|không hợp lệ|Không tìm thấy|Lỗi/);
  assert.ok(!reads.includes(DB_KEY) && !writes.includes(DB_KEY), 'no localStorage demo fallback');
  await d.unmount();
});

test('đường dẫn có mã hoá phần trăm sai (#/customers/%E0%A4%A) không làm sập ứng dụng', async () => {
  let d; let threw = null;
  try { d = await mount('#/customers/%E0%A4%A'); } catch (e) { threw = e; }
  assert.equal(threw, null, 'malformed hash must not crash render: ' + (threw && threw.message));
  assert.ok(d, 'app mounted'); assert.equal(calls.filter((c) => /%E0/.test(c.path)).length, 0);
  assert.ok(byTag(d.container, 'main').length, 'shell still rendered');
  await d.unmount();
});

test('đổi hash sang đường dẫn sai mã hoá khi đang chạy: không ném lỗi, giữ trang hiện tại có thể thao tác', async () => {
  const d = await mount('#/customers/' + IDA);
  let threw = null;
  try { await d.nav('#/customers/%'); } catch (e) { threw = e; }
  assert.equal(threw, null, 'hashchange with malformed encoding must not throw: ' + (threw && threw.message));
  await d.nav('#/customers');
  assert.match(main(d.container), /Công ty Alpha Server/, 'user can still navigate back to the list');
  await d.unmount();
});

test('chuyển nhanh A → B khi A chưa tải xong: A trả lời muộn không ghi đè B; không còn dữ liệu A trên màn hình', async () => {
  const dA = deferred();
  handler = defaultServer({ ['GET /api/v1/customers/' + IDA]: () => dA.promise });
  const d = await mount('#/customers/' + IDA);
  assert.match(main(d.container), /Đang tải thông tin khách hàng/);
  await d.nav('#/customers/' + IDB);
  assert.match(main(d.container), /Công ty Beta Server/);
  await act(async () => { dA.resolve(res(200, { data: A })); }); await settle();
  assert.match(main(d.container), /Công ty Beta Server/); assert.doesNotMatch(main(d.container), /Alpha/);
  assert.match(main(d.container), /KH-00002/); assert.doesNotMatch(main(d.container), /KH-00001/);
  await d.unmount();
});

test('đang sửa A (đã gõ nháp) rồi chuyển sang B: B chỉ hiện dữ liệu máy chủ của B, ngăn sửa đóng, form B không lấy nháp/dữ liệu cũ của A', async () => {
  const d = await mount('#/customers/' + IDA);
  await press(buttonByText(d.container, /Sửa thông tin/));
  await typeInto(inputByLabel(d.container, /Tên công ty/), 'NHÁP CHƯA LƯU CỦA A');
  assert.equal(inputByLabel(d.container, /Tên công ty/).value, 'NHÁP CHƯA LƯU CỦA A', 'draft is in the open editor');
  await d.nav('#/customers/' + IDB);
  assert.equal(findAll(d.container, (e) => e.attributes.role === 'dialog').length, 0, 'drawer of A is gone');
  assert.doesNotMatch(text(d.container), /NHÁP CHƯA LƯU CỦA A|Alpha/);
  assert.match(main(d.container), /Công ty Beta Server/);
  await press(buttonByText(d.container, /Sửa thông tin/));
  assert.equal(inputByLabel(d.container, /Tên công ty/).value, 'Công ty Beta Server', 'editor of B starts from B server data');
  assert.equal(patches().length, 0, 'nothing was saved while switching');
  await d.unmount();
});

test('quay lại A sau khi sửa dở A rồi sang B: tải lại A từ máy chủ, ngăn sửa đóng, nháp cũ không được khôi phục ngầm', async () => {
  const d = await mount('#/customers/' + IDA);
  await press(buttonByText(d.container, /Sửa thông tin/));
  await typeInto(inputByLabel(d.container, /Tên công ty/), 'NHÁP CŨ');
  await d.nav('#/customers/' + IDB); await d.nav('#/customers/' + IDA);
  assert.equal(getsOf(IDA).length, 2, 'A is re-read from the server');
  assert.equal(findAll(d.container, (e) => e.attributes.role === 'dialog').length, 0);
  assert.doesNotMatch(text(d.container), /NHÁP CŨ/); assert.match(main(d.container), /Công ty Alpha Server/);
  await d.unmount();
});

test('nháp chưa lưu: Esc/Huỷ khi đã sửa → hỏi xác nhận; "Tiếp tục chỉnh sửa" giữ nháp; "Huỷ thay đổi" đóng; chưa sửa thì đóng thẳng', async () => {
  const d = await mount('#/customers/' + IDA);
  await press(buttonByText(d.container, /Sửa thông tin/));
  await pressEscape();
  assert.equal(findAll(d.container, (e) => e.attributes.role === 'dialog').length, 0, 'pristine form closes without prompt');
  await press(buttonByText(d.container, /Sửa thông tin/));
  await typeInto(inputByLabel(d.container, /Tên công ty/), 'Tên đã sửa');
  await pressEscape();
  assert.match(text(d.container), /Huỷ các thay đổi\?/, 'dirty draft asks before discarding');
  await press(buttonByText(d.container, /Tiếp tục chỉnh sửa/));
  assert.equal(inputByLabel(d.container, /Tên công ty/).value, 'Tên đã sửa', 'draft kept after "continue editing"');
  await press(buttonByText(d.container, /^Huỷ$/));
  await press(buttonByText(d.container, /Huỷ thay đổi/));
  assert.equal(findAll(d.container, (e) => e.attributes.role === 'dialog' && /Sửa thông tin/.test(e.attributes['aria-label'] || '')).length, 0, 'drawer closed after explicit discard');
  assert.equal(patches().length, 0);
  await d.unmount();
});

test('409 phiên bản: nháp được giữ cùng bảng xung đột; sang B rồi về A không còn bảng 409/nháp cũ; không có PATCH tự gửi lại', async () => {
  handler = defaultServer({ ['PATCH /api/v1/customers/' + IDA]: () => err(409, 'CUSTOMER_VERSION_CONFLICT') });
  const d = await mount('#/customers/' + IDA);
  await press(buttonByText(d.container, /Sửa thông tin/));
  await typeInto(inputByLabel(d.container, /Tên công ty/), 'Bản của tôi');
  await press(buttonByText(d.container, /Lưu thay đổi/));
  assert.match(text(d.container), /đã được người khác cập nhật/); assert.equal(inputByLabel(d.container, /Tên công ty/).value, 'Bản của tôi');
  assert.equal(patches().length, 1);
  await d.nav('#/customers/' + IDB); await d.nav('#/customers/' + IDA);
  assert.doesNotMatch(text(d.container), /đã được người khác cập nhật|Bản của tôi/);
  assert.equal(patches().length, 1, 'no implicit PATCH retry after navigation');
  assert.match(main(d.container), /Công ty Alpha Server/);
  await d.unmount();
});

test('401 khi tải chi tiết: đúng 1 lần GET dù đổi hash cùng id / vẽ lại; không tự thử lại, không hiện dữ liệu, không đụng localStorage demo', async () => {
  handler = defaultServer({ ['GET /api/v1/customers/' + IDA]: () => err(401, 'UNAUTHENTICATED') });
  const d = await mount('#/customers/' + IDA);
  assert.match(main(d.container), /Chưa đăng nhập/);
  await d.nav('#/customers/' + IDA); await settle(); await settle();
  assert.equal(getsOf(IDA).length, 1, 'no implicit retry');
  assert.doesNotMatch(main(d.container), /Alpha/);
  assert.ok(!reads.includes(DB_KEY) && !writes.includes(DB_KEY));
  await d.unmount();
});

for (const [status, code, re] of [[401, 'UNAUTHENTICATED', /Chưa đăng nhập/], [403, 'FORBIDDEN', /Không đủ quyền/]]) {
  test(`${status} khi lưu: giữ nháp, khoá nút Lưu, bấm lại không gửi PATCH thứ hai; sang B không rò dữ liệu/nháp của A`, async () => {
    handler = defaultServer({ ['PATCH /api/v1/customers/' + IDA]: () => err(status, code) });
    const d = await mount('#/customers/' + IDA);
    await press(buttonByText(d.container, /Sửa thông tin/));
    await typeInto(inputByLabel(d.container, /Tên công ty/), 'Nháp bị từ chối');
    await press(buttonByText(d.container, /Lưu thay đổi/));
    assert.match(text(d.container), re); assert.equal(patches().length, 1);
    await press(buttonByText(d.container, /Lưu thay đổi/)); await press(buttonByText(d.container, /Lưu thay đổi/));
    assert.equal(patches().length, 1, 'denied save is never re-sent implicitly');
    assert.equal(inputByLabel(d.container, /Tên công ty/).value, 'Nháp bị từ chối');
    await d.nav('#/customers/' + IDB);
    assert.doesNotMatch(main(d.container), /Nháp bị từ chối|Chưa đăng nhập|Không đủ quyền/, 'denied notice of A is not shown on B (the toast of the failed save is separate)');
    assert.match(main(d.container), /Công ty Beta Server/);
    assert.equal(patches().length, 1);
    await d.unmount();
  });
}

test('lookups bị 401 khi mở form: mở lại ngăn sửa không tự gọi lại /lookups (chỉ nút "Tải lại danh mục" mới thử lại)', async () => {
  handler = defaultServer({ ['GET /api/v1/lookups']: () => err(401, 'UNAUTHENTICATED') });
  const d = await mount('#/customers/' + IDA);
  const lk = () => calls.filter((c) => c.path.endsWith('/lookups')).length;
  await press(buttonByText(d.container, /Sửa thông tin/));
  assert.equal(lk(), 1);
  await press(buttonByText(d.container, /^Huỷ$/));
  await press(buttonByText(d.container, /Sửa thông tin/));
  assert.equal(lk(), 1, 'a 401 on lookups must not be silently retried when the drawer is reopened');
  await d.unmount();
});

test('danh sách: tìm "abc" + sang trang 2 → mở chi tiết → quay lại: ô tìm kiếm, trang và hàng khớp nhau, không có dòng của tìm kiếm khác', async () => {
  const page = (s, p) => ({ items: [cust(p === 2 ? IDB : IDA, p === 2 ? 'KH-00002' : 'KH-00001', (p === 2 ? 'Beta' : 'Alpha') + (s ? ' khớp ' + s : ' toàn bộ'))], total: 40, page: p, pageSize: 20, totalPages: 2 });
  handler = defaultServer({ ['GET /api/v1/customers']: (url) => { const u = new URL(url); return res(200, { data: page(u.searchParams.get('search'), Number(u.searchParams.get('page') || 1)) }); } });
  const d = await mount('#/customers');
  const serverBox = () => findAll(d.container, (e) => e.tagName === 'INPUT' && /trên máy chủ/.test(e.attributes['aria-label'] || ''))[0];
  await typeInto(serverBox(), 'abc');
  await act(async () => { let f = serverBox(); while (f && f.tagName !== 'FORM') f = f.parentNode; submit(f); }); await settle();
  assert.ok(calls.some((c) => /search=abc/.test(c.search)), 'server search was sent');
  await press(buttonByText(d.container, /^Sau$/));
  assert.match(main(d.container), /Trang 2\/2/); assert.match(main(d.container), /Beta khớp abc/);
  await press(rowOf(d.container, /Beta/));
  assert.match(main(d.container), /Công ty Beta|Beta khớp abc/); assert.doesNotMatch(main(d.container), /Danh sách đang lấy từ máy chủ/);
  await d.nav('#/customers');
  const t = main(d.container);
  const box = serverBox();
  const shownPage = Number((t.match(/Trang (\d+)\/\d+/) || [])[1]);
  const searchLabel = /Kết quả tìm "abc"/.test(t);
  assert.equal(box.value === 'abc', searchLabel, 'search box and pager label agree');
  assert.equal(/Beta khớp abc/.test(t) || /Alpha khớp abc/.test(t) || /(Alpha|Beta) toàn bộ/.test(t), true);
  assert.equal(shownPage === 2, /Beta/.test(t), 'rows belong to the page the pager says');
  assert.equal(/(Alpha|Beta) toàn bộ/.test(t), !searchLabel, 'rows belong to the search the box says');
  await d.unmount();
});

test('cập nhật A còn đang bay rồi sang B: lưu B không bị nuốt âm thầm (phải có phản hồi, hoặc PATCH của B được gửi)', async () => {
  const dA = deferred();
  handler = defaultServer({ ['PATCH /api/v1/customers/' + IDA]: () => dA.promise });
  const d = await mount('#/customers/' + IDA);
  await press(buttonByText(d.container, /Sửa thông tin/));
  await typeInto(inputByLabel(d.container, /Tên công ty/), 'A đang lưu');
  await press(buttonByText(d.container, /Lưu thay đổi/));
  assert.equal(patches().length, 1);
  await d.nav('#/customers/' + IDB);
  await press(buttonByText(d.container, /Sửa thông tin/));
  await typeInto(inputByLabel(d.container, /Tên công ty/), 'B sửa');
  const before = text(d.container);
  await press(buttonByText(d.container, /Lưu thay đổi/));
  const after_ = text(d.container);
  const toastShown = /Máy chủ đang bận|đang lưu|chờ|Đang lưu/i.test(after_) && after_ !== before;
  assert.ok(patches().filter((p) => p.path.endsWith(IDB)).length === 1 || toastShown, 'save of B was silently swallowed (no PATCH, no message)');
  await act(async () => { dA.resolve(res(200, { data: { ...A, version: 2 } })); }); await settle();
  assert.match(main(d.container), /Công ty Beta Server|B sửa/); assert.doesNotMatch(main(d.container), /A đang lưu/);
  await d.unmount();
});

test('hồi quy phân quyền: cùng máy chủ giả — actor test-only có quyền mở được ngăn Thêm/Sửa; không actor (src thật, fail-closed) thì khoá và không gửi POST/PATCH', async () => {
  const isOff = (c, re) => { const b = buttonByText(c, re); return !!b && !!b.disabled; };
  const dialogs = (c) => findAll(c, (e) => e.attributes.role === 'dialog').length;
  const g = await mount('#/customers/' + IDA);
  assert.equal(isOff(g.container, /Sửa thông tin/), false, 'granted actor: edit enabled');
  await press(buttonByText(g.container, /Sửa thông tin/)); assert.equal(dialogs(g.container), 1, 'granted actor: edit drawer opens');
  await g.unmount();
  const u = await mount('#/customers/' + IDA, { granted: false });
  assert.equal(isOff(u.container, /Sửa thông tin/), true, 'no actor: edit disabled (default-deny)');
  const b = buttonByText(u.container, /Sửa thông tin/); if (b) await press(b);
  assert.equal(dialogs(u.container), 0, 'no actor: edit drawer never opens');
  await u.nav('#/customers');
  assert.equal(isOff(u.container, /Thêm khách hàng/), true, 'no actor: create disabled');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, 'no write request without an actor');
  await u.unmount();
});
