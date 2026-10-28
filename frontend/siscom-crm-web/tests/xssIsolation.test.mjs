// Run: node --test tests/xssIsolation.test.mjs   (Node >= 18; vite + react only. Injected fetch, in-memory DOM; no network, no DB, no browser, no .env.)
// M02 — hồi quy ÂM TÍNH cho XSS / cô lập dữ liệu API khỏi localStorage demo, trên <App> thật ở chế độ API BẬT:
//   (A) văn bản/thuộc tính/URL/Unicode độc hại trong phản hồi API giả (tên, tên ngắn, email, website, ghi chú, địa chỉ, người phụ trách, thông điệp lỗi)
//       -> hiển thị NGUYÊN VĂN dạng text; không sinh <script>/<iframe>/…, không thuộc tính on*, mọi href chỉ mailto:/https://; payload không thực thi.
//   (B) hash độc hại (#/customers/<script>…, %-escape lỗi, ../, id lạ) -> không sập, không gọi API với id không phải UUID, không chèn DOM.
//   (C) dữ liệu API không lọt vào localStorage (không ghi/đọc DB demo); khoá/giá trị lưu không chứa payload hay token.
//   (D) chuyển actor A->B / đăng xuất ở mức module (loginSession + customerApiClient thật): phản hồi độc hại muộn của A bị bỏ, không có token trong lỗi/trạng thái/storage.
// PHẠM VI TRUNG THỰC: DOM giả (miniDom) KHÔNG có engine HTML/JS => "không thực thi" được chứng minh bằng cấu trúc DOM (không có phần tử/thuộc tính thực thi được)
// + cờ globalThis.__XSS__ không bao giờ bị đặt. Chưa kiểm chứng trên Chrome thật (NOT_RUN). App.jsx chưa nối loginSession => (D) ở mức module.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text } from './helpers/miniDom.mjs';
import { createCustomerApi, StaleSessionError } from '../src/data/api/customerApiClient.js';
import { createLoginSession } from '../src/auth/loginSession.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LOOKUPS = { customer_tier: [], customer_status: [], industry: [], source: [], province: [] };
const CONFIG = new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FLAG = () => globalThis.__XSS__;

// Payload độc hại: text, thoát thuộc tính, URL scheme, và Unicode (RTL override, NUL, toàn chiều rộng, zero-width, emoji, tổ hợp).
const PAYLOADS = [
  '<script>globalThis.__XSS__=1</script>',
  '<img src=x onerror=globalThis.__XSS__=2>',
  '" autofocus onfocus="globalThis.__XSS__=3" x="',
  "'><svg/onload=globalThis.__XSS__=4>",
  'javascript:globalThis.__XSS__=5',
  '</h2><script>globalThis.__XSS__=6</script><h2>',
  '‮<script>globalThis.__XSS__=7</script>',
  '＜script＞globalThis.__XSS__=8＜/script＞',
  'a\u0000b​ć 😀 <b>đậm</b>',
  '{{constructor.constructor("globalThis.__XSS__=9")()}}',
];
const MARK = /__XSS__/;

let dom; let act; let createRoot;
const servers = []; let store; let writes; let reads; let fetchCalls; let fetchImpl;

async function loadApp() {
  const prev = { f: process.env.VITE_CRM_API_ENABLED, b: process.env.VITE_CRM_API_BASE };
  process.env.VITE_CRM_API_ENABLED = 'true'; process.env.VITE_CRM_API_BASE = BASE;
  const vite = await createServer({ configFile: CONFIG, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  servers.push(vite);
  const mod = await vite.ssrLoadModule('/src/App.jsx');
  if (prev.f === undefined) delete process.env.VITE_CRM_API_ENABLED; else process.env.VITE_CRM_API_ENABLED = prev.f;
  if (prev.b === undefined) delete process.env.VITE_CRM_API_BASE; else process.env.VITE_CRM_API_BASE = prev.b;
  return mod.default;
}

before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.innerWidth = 1440;
  document.querySelector = () => null;
  Object.getPrototypeOf(document.createElement('x')).getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
  globalThis.location = { search: '', hash: '' }; window.location = globalThis.location;
  globalThis.localStorage = {
    getItem: (k) => { reads.push(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: (k, v) => { writes.push(k); store[k] = String(v); },
    removeItem: (k) => { writes.push('remove:' + k); delete store[k]; },
    key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: (...a) => { fetchCalls.push(a); return fetchImpl(...a); } });
  ({ createRoot } = await import('react-dom/client')); ({ act } = await import('react'));
});
after(async () => { for (const s of servers) await s.close(); if (dom) dom.restore(); delete globalThis.localStorage; delete globalThis.location; delete globalThis.IS_REACT_ACT_ENVIRONMENT; delete globalThis.__XSS__; });
beforeEach(() => { store = {}; writes = []; reads = []; fetchCalls = []; delete globalThis.__XSS__; fetchImpl = async () => { throw new TypeError('network down'); }; });

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function mount(hash) {
  globalThis.location.hash = hash;
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  const App = await loadApp(); // module mới mỗi lần: controller là singleton theo module
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
  return { container, unmount: async () => { await act(async () => root.unmount()); } };
}

// ---- bất biến DOM: không có gì thực thi được ----
const FORBIDDEN_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'STYLE', 'FRAME', 'FRAMESET', 'APPLET']);
const SAFE_HREF = /^(mailto:|https:\/\/)/i;
function allElements(root) { return root.querySelectorAll(() => true); }
function assertInert(root, where) {
  for (const el of allElements(root)) {
    assert.ok(!FORBIDDEN_TAGS.has(el.tagName), `${where}: phần tử thực thi được <${el.tagName}>`);
    for (const [k, v] of Object.entries(el.attributes)) {
      assert.ok(!/^on/i.test(k), `${where}: thuộc tính sự kiện "${k}" trên <${el.tagName}>`);
      assert.ok(!/^\s*(javascript|vbscript|data\s*:\s*text\/html)/i.test(v), `${where}: scheme nguy hiểm trong ${k}="${v}"`);
      if (k === 'href' || k === 'src' || k === 'action' || k === 'formaction' || k === 'xlink:href') {
        assert.ok(k === 'src' || SAFE_HREF.test(v), `${where}: ${k}="${v}" không thuộc mailto:/https://`);
      }
      assert.ok(!(el.tagName === 'IMG' && k === 'src' && MARK.test(v)), `${where}: <img src> mang payload`);
    }
  }
  assert.equal(FLAG(), undefined, `${where}: payload đã thực thi (__XSS__=${FLAG()})`);
}
const allowedWrite = (k) => k === 'siscom-crm-theme';
function assertStorageClean(where, secrets = []) {
  assert.ok(!writes.filter((k) => !allowedWrite(k)).length, `${where}: ghi storage ngoài theme: ${writes.join(',')}`);
  const blob = JSON.stringify(store);
  assert.ok(!MARK.test(blob), `${where}: payload lọt vào localStorage`);
  for (const s of secrets) assert.ok(!blob.includes(s), `${where}: bí mật lọt vào localStorage`);
}

function hostileRow(p, id = ID) {
  return { id, code: 'KH-00009', name: 'Công ty ' + p, shortName: 'Ngắn ' + p, phone: '0901234567', email: 'x' + p, website: p, address: p, note: p, taxId: '0100000000', version: 1,
    owner: { id: '0b9f1c52-3a0e-4c3e-9d6f-000000000900', fullName: 'Chủ ' + p } };
}
const server = (customers, customer) => async (url) => {
  const p = new URL(url).pathname;
  if (p.endsWith('/lookups')) return res(200, { data: LOOKUPS });
  return p.endsWith('/customers') ? customers : customer;
};

for (const [i, p] of PAYLOADS.entries()) {
  test(`A${i + 1}: payload #${i + 1} trong list + detail (tên/email/website/ghi chú/địa chỉ/owner) chỉ là text; không thực thi, không ghi storage`, async () => {
    const row = hostileRow(p);
    fetchImpl = server(res(200, { data: { items: [row], page: 1, pageSize: 20, total: 1, totalPages: 1 } }), res(200, { data: row }));
    const l = await mount('#/customers');
    assert.ok(fetchCalls.length > 0, 'API được gọi');
    assert.ok(text(l.container).includes(p.replace(/\s+/g, ' ').trim().slice(0, 12)) || text(l.container).includes('KH-'), 'dữ liệu máy chủ được hiển thị');
    assertInert(l.container, 'list #' + (i + 1));
    assertStorageClean('list #' + (i + 1));
    await l.unmount();
    const d = await mount('#/customers/' + ID);
    assert.ok(text(d.container).includes(('Công ty ' + p).replace(/\s+/g, ' ').trim()), 'tên hiển thị NGUYÊN VĂN dạng text (không bị diễn giải)');
    assertInert(d.container, 'detail #' + (i + 1));
    assertInert(dom.doc.body, 'body #' + (i + 1));
    assertStorageClean('detail #' + (i + 1));
    await d.unmount();
  });
}

test('A-ERR: thông điệp lỗi độc hại từ máy chủ (400/403/409/500) hiển thị dạng text, không tạo phần tử thực thi', async () => {
  for (const st of [400, 403, 409, 500]) {
    const body = { error: { code: 'X', message: PAYLOADS[0] + PAYLOADS[1] + PAYLOADS[2], details: [{ field: PAYLOADS[3], message: PAYLOADS[4] }] } };
    fetchImpl = async (url) => (new URL(url).pathname.endsWith('/lookups') ? res(200, { data: LOOKUPS }) : res(st, body));
    const l = await mount('#/customers');
    assertInert(l.container, 'list ' + st);
    await l.unmount();
    const d = await mount('#/customers/' + ID);
    assertInert(d.container, 'detail ' + st);
    assertStorageClean('lỗi ' + st);
    await d.unmount();
  }
});

// R01: phản hồi vi phạm hợp đồng (website là object…) từng làm CustomerApiDetail ném 'c.website.replace is not a function' và sập cả cây. Đã vá ở customerAdapter (không phải chuỗi -> '').
test('A-KIND: giá trị sai kiểu từ máy chủ (object/mảng/số/null thay cho chuỗi) không sập và không sinh DOM thực thi', async () => {
  const row = { ...hostileRow(PAYLOADS[1]), name: { toString: 'x', html: PAYLOADS[0] }, shortName: [PAYLOADS[0]], email: 12345, website: { a: 1 }, note: null, address: ['a', PAYLOADS[2]] };
  fetchImpl = server(res(200, { data: { items: [row], page: 1, pageSize: 20, total: 1, totalPages: 1 } }), res(200, { data: row }));
  for (const h of ['#/customers', '#/customers/' + ID]) {
    let m;
    try { m = await mount(h); } catch (e) { assert.fail('App sập khi dữ liệu sai kiểu ở ' + h + ': ' + e.message); }
    assertInert(m.container, 'sai kiểu ' + h);
    assertStorageClean('sai kiểu ' + h);
    await m.unmount();
  }
});

// ---- (B) hash/URL ----
const HASHES = [
  '#/customers/<script>globalThis.__XSS__=1</script>',
  '#/customers/%3Cimg%20src%3Dx%20onerror%3Dglobalthis.__XSS__%3D2%3E',
  '#/customers/%E0%A4%A',
  '#/customers/..',
  '#/customers/..%2F..%2Fadmin',
  '#/customers/%2e%2e',
  '#/customers/' + ID + '/../../auth/me',
  '#/customers/' + ID + '?x=<script>globalThis.__XSS__=3</script>',
  '#/customers/' + ID + '%00',
  '#/"><svg onload=globalThis.__XSS__=4>',
  '#/customers/javascript:globalThis.__XSS__=5',
  '#/customers/' + encodeURIComponent('‮<script>'),
  '#//evil.example/customers/x',
  '#/customers/' + 'A'.repeat(5000),
];
test('B: hash độc hại — không sập, không thực thi, không gọi API với id không phải UUID, không ra ngoài BASE, không ghi storage', async () => {
  fetchImpl = async (url) => { const p = new URL(url).pathname; return p.endsWith('/lookups') ? res(200, { data: LOOKUPS }) : res(404, { error: { code: 'NOT_FOUND', message: 'x' } }); };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const h of HASHES) {
    fetchCalls = []; writes = [];
    let m;
    try { m = await mount(h); } catch (e) { assert.fail('App sập với hash ' + h.slice(0, 60) + ': ' + e.message); }
    assertInert(m.container, 'hash ' + h.slice(0, 40));
    for (const [url] of fetchCalls) {
      assert.ok(String(url).startsWith(BASE + '/'), 'URL ra ngoài BASE: ' + url);
      const u = new URL(url);
      assert.ok(u.origin === 'http://127.0.0.1:3000', 'origin lạ: ' + url);
      assert.ok(!/[<>"'\\\s]/.test(url) && !/\.\./.test(u.pathname), 'URL chứa ký tự nguy hiểm/traversal: ' + url);
      const seg = u.pathname.replace(/^\/api\/v1\/customers\/?/, '');
      if (u.pathname.includes('/customers/')) assert.ok(UUID.test(decodeURIComponent(seg)) , 'gọi API với id không phải UUID: ' + url);
    }
    assertStorageClean('hash ' + h.slice(0, 40));
    await m.unmount();
  }
});

// ---- (C) cô lập storage / token ----
test('C: DB demo cắm sẵn trong localStorage không được đọc/ghi/hiển thị; không khoá nào mới ngoài theme; dữ liệu API không bị lưu', async () => {
  const DB_KEY_GUESS = ['siscom-crm-db', 'siscom-crm-db-v2', 'siscom-crm-demo-user'];
  store['siscom-crm-db-v2'] = JSON.stringify({ planted: 'Khách Cắm Sẵn <b>demo</b>' });
  const nonTheme = () => JSON.stringify(Object.fromEntries(Object.entries(store).filter(([k]) => !allowedWrite(k))));
  const baseline = nonTheme();
  const row = hostileRow(PAYLOADS[0]);
  fetchImpl = server(res(200, { data: { items: [row], page: 1, pageSize: 20, total: 1, totalPages: 1 } }), res(200, { data: row }));
  for (const h of ['#/customers', '#/customers/' + ID, '#/dashboard']) {
    const m = await mount(h);
    assert.ok(!text(m.container).includes('Cắm Sẵn'), 'bản ghi cắm sẵn không được hiển thị ở ' + h);
    assertInert(m.container, h);
    await m.unmount();
  }
  assert.ok(!reads.some((k) => DB_KEY_GUESS.includes(k)), 'đọc khoá demo: ' + reads.join(','));
  assert.equal(nonTheme(), baseline, 'storage ngoài theme không đổi');
  assertStorageClean('C');
});

// ---- (D) actor switch / logout ở mức module ----
const TOK_A = 'sid_' + 'A'.repeat(43);
const TOK_B = 'sid_' + 'B'.repeat(43);
const cfg = { enabled: true, baseUrl: 'http://127.0.0.1:3000/api/v1' };
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
function twoActorSession() {
  const byToken = { [TOK_A]: 7, [TOK_B]: 8 }; const order = [TOK_A, TOK_B]; let n = 0;
  return createLoginSession({
    enabled: true,
    login: async () => ({ token: order[Math.min(n++, 1)], expiresAt: '2026-10-25T00:00:00.000Z' }),
    me: async (t) => ({ employeeId: byToken[t] }),
    logout: async () => ({}),
  });
}
const leaks = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v, Object.getOwnPropertyNames(Object(v))); return s.includes(TOK_A) || s.includes(TOK_B) || /Bearer\s/.test(s); };

test('D1: A->B khi yêu cầu của A còn bay; 2xx độc hại muộn của A bị bỏ (StaleSessionError), không trả dữ liệu, không lộ token/ghi storage', async () => {
  const s = twoActorSession(); await s.submit('a@b.vn', 'pw-gia-lap');
  const gate = deferred(); const api = createCustomerApi(cfg, async () => gate.p, { auth: s });
  const settled = api.list({}).catch((e) => e);
  await s.submit('a@b.vn', 'pw-gia-lap'); assert.equal(s.getState().employeeId, 8);
  gate.resolve(res(200, { data: { items: [hostileRow(PAYLOADS[0])], page: 1, pageSize: 20, total: 1, totalPages: 1 } }));
  const out = await settled;
  assert.ok(out instanceof StaleSessionError, 'kết quả của A phải bị bỏ');
  assert.ok(!leaks(out) && !leaks(out.message) && !leaks(s.getState()), 'token không lộ ở lỗi/trạng thái');
  assert.equal(s.getState().status, 'AUTHENTICATED', 'phiên B giữ nguyên');
  assert.equal(writes.length, 0); assert.equal(FLAG(), undefined);
});

test('D2: đăng xuất khi yêu cầu còn bay; phản hồi độc hại muộn bị bỏ, token biến mất, không gửi Bearer sau logout, trạng thái công khai sạch', async () => {
  const s = twoActorSession(); await s.submit('a@b.vn', 'pw-gia-lap');
  const gate = deferred(); const sent = [];
  const api = createCustomerApi(cfg, async (u, init) => { sent.push(init.headers.Authorization || null); return gate.p; }, { auth: s });
  const settled = api.get(ID).catch((e) => e);
  await s.logout();
  gate.resolve(res(200, { data: hostileRow(PAYLOADS[1]) }));
  const out = await settled;
  assert.ok(out instanceof StaleSessionError);
  assert.equal(s.getAuthHeader(), null);
  assert.ok(!leaks(s.getState()), 'trạng thái công khai không chứa token');
  const after = await api.get(ID).catch((e) => e);
  assert.equal(after.code, 'AUTH_REQUIRED', 'sau logout: fail-closed, không gọi mạng');
  assert.equal(sent.length, 1, 'không có yêu cầu mới sau logout');
  assert.equal(writes.length, 0); assert.equal(FLAG(), undefined);
});

test('D3: 401 độc hại muộn của A (thông điệp chứa payload + token giả) không hủy phiên B và không đưa token vào lỗi ném ra', async () => {
  const s = twoActorSession(); await s.submit('a@b.vn', 'pw-gia-lap');
  const gate = deferred(); const api = createCustomerApi(cfg, async () => gate.p, { auth: s });
  const settled = api.list({}).catch((e) => e);
  await s.submit('a@b.vn', 'pw-gia-lap');
  gate.resolve(res(401, { error: { code: 'UNAUTHENTICATED', message: PAYLOADS[0] } }));
  const out = await settled;
  assert.equal(s.getState().status, 'AUTHENTICATED'); assert.equal(s.getState().employeeId, 8);
  assert.equal(s.getAuthHeader(), 'Bearer ' + TOK_B);
  assert.ok(!leaks(out) || out instanceof StaleSessionError || out.message === PAYLOADS[0], 'lỗi không chứa token');
  assert.ok(!leaks(out.message), 'message lỗi không chứa token');
  assert.equal(FLAG(), undefined);
});
