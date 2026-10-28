// Run: node --test tests/apiStateErrorRegression.test.mjs   (Node >= 18; vite + react only. Injected fetch, in-memory DOM; no network, no DB, no browser.)
// K05 — bổ sung hồi quy trạng thái API ở tầng test cho các ca CHƯA có ở mức UI/phiên:
//   (1) <App> thật, API ON: 429 / 500 / timeout (TimeoutError, AbortError) / fetch treo -> không rơi về demo localStorage, không đọc/ghi DB demo,
//       không dữ liệu khách API bị ghi vào localStorage, KHÔNG tự thử lại (số request ổn định sau khi chờ thêm).
//   (2) actor A -> B: lỗi MUỘN không phải 401 của A (403 / 429 / 500 / timeout) không đổi phiên B, không tự thử lại, không gửi lại bằng token B.
// Đã có sẵn (không lặp lại): 401/403/network ở UI (apiModeDemoIsolation), 429 ở repository/controller (customerApi429), 401 muộn A->B (sessionCompositionActorSwitch, loginSessionStale401).
// Mocked fetch only — KHÔNG phải backend/trình duyệt thật. Không bật xác thực thật, không đổi mặc định OFF.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text } from './helpers/miniDom.mjs';
import { createCustomerApi, ApiError } from '../src/data/api/customerApiClient.js';
import { createLoginSession } from '../src/auth/loginSession.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LOOKUPS = { customer_tier: [], customer_status: [], industry: [], source: [], province: [] };
const CONFIG = new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const timeoutErr = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const abortErr = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let dom; let act; let createRoot; let seedV2; let DB_KEY;
const servers = []; let store; let writes; let reads; let fetchCalls; let fetchImpl;

async function loadApp() {
  const prev = { f: process.env.VITE_CRM_API_ENABLED, b: process.env.VITE_CRM_API_BASE };
  process.env.VITE_CRM_API_ENABLED = 'true'; process.env.VITE_CRM_API_BASE = BASE;
  const vite = await createServer({ configFile: CONFIG, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  servers.push(vite);
  const mod = await vite.ssrLoadModule('/src/App.jsx');
  if (prev.f === undefined) delete process.env.VITE_CRM_API_ENABLED; else process.env.VITE_CRM_API_ENABLED = prev.f;
  if (prev.b === undefined) delete process.env.VITE_CRM_API_BASE; else process.env.VITE_CRM_API_BASE = prev.b;
  return { App: mod.default, vite };
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
  const probe = await loadApp();
  ({ seedV2, DB_KEY } = await probe.vite.ssrLoadModule('/src/data/repository/index.js'));
});
after(async () => { for (const s of servers) await s.close(); if (dom) dom.restore(); delete globalThis.localStorage; delete globalThis.location; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
beforeEach(() => { store = {}; writes = []; reads = []; fetchCalls = []; fetchImpl = async () => { throw new TypeError('network down'); }; });

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await sleep(0); }); };
async function mount(hash) {
  globalThis.location.hash = hash;
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  const app = await loadApp(); // controller là singleton module: module graph mới cho mỗi lần mount
  await act(async () => { root.render(React.createElement(app.App)); });
  await settle();
  return { container, unmount: async () => { await act(async () => root.unmount()); } };
}
function demoMarkers() {
  const db = seedV2(); const m = new Set();
  for (const c of db.customers) [c.name, c.short, c.taxId].forEach((v) => v && String(v).length > 5 && m.add(String(v)));
  for (const c of db.contacts) [c.name, c.email, c.phone].forEach((v) => v && String(v).length > 5 && m.add(String(v)));
  return [...m];
}
const assertNoDemo = (el, where) => { const t = text(el); for (const mk of demoMarkers()) assert.ok(!t.includes(mk), `${where}: demo marker "${mk}" leaked`); };
const allowedWrite = (k) => k === 'siscom-crm-theme';
const apiCalls = () => fetchCalls.filter((a) => !new URL(a[0]).pathname.endsWith('/lookups')).length;
const PLANTED = JSON.stringify({ planted: 'Khách Cắm Sẵn Nguyễn Văn Bí Mật' });

const UI_FAILS = {
  '429': () => res(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'x' } }),
  '500': () => res(500, { error: { code: 'INTERNAL', message: 'x' } }),
  'timeout (TimeoutError)': () => { throw timeoutErr(); },
  'abort (AbortError)': () => { throw abortErr(); },
};

for (const [name, mk] of Object.entries(UI_FAILS)) {
  for (const [where, hash] of [['list', '#/customers'], ['detail', '#/customers/' + ID]]) {
    test(`ON + ${name}: ${where} — không demo, không localStorage fallback, không tự thử lại`, async () => {
      store[DB_KEY] = PLANTED;
      fetchImpl = async (url) => (new URL(url).pathname.endsWith('/lookups') ? res(200, { data: LOOKUPS }) : mk());
      const v = await mount(hash);
      assertNoDemo(v.container, `${where} ${name}`);
      assert.ok(!text(v.container).includes('Bí Mật'), 'bản ghi cắm sẵn trong localStorage không được hiển thị');
      assert.ok(apiCalls() > 0, 'đã thử gọi API');
      assert.ok(!reads.includes(DB_KEY), 'không đọc DB demo');
      assert.ok(!writes.filter((k) => !allowedWrite(k)).length, 'không ghi storage: ' + writes.join(','));
      assert.equal(store[DB_KEY], PLANTED, 'giá trị cắm sẵn không bị đổi');
      const n = apiCalls();
      await sleep(60); await settle();
      assert.equal(apiCalls(), n, 'không tự thử lại sau khi chờ thêm');
      await v.unmount();
    });
  }
}

test('ON + fetch treo (không bao giờ settle): list không rơi về demo, không đọc/ghi DB demo, không tự thử lại', async () => {
  fetchImpl = async (url) => (new URL(url).pathname.endsWith('/lookups') ? res(200, { data: LOOKUPS }) : new Promise(() => {}));
  const v = await mount('#/customers');
  assertNoDemo(v.container, 'pending');
  assert.ok(!reads.includes(DB_KEY));
  assert.ok(!writes.filter((k) => !allowedWrite(k)).length, 'không ghi storage: ' + writes.join(','));
  const n = apiCalls(); await sleep(60); await settle();
  assert.equal(apiCalls(), n, 'không tự thử lại khi treo');
  await v.unmount();
});

test('ON + 200 rồi 429 ở lần mount sau: không ghi dữ liệu khách API vào localStorage, không rơi về demo', async () => {
  const NAME = 'Khách API Máy Chủ Một';
  const row = { id: ID, code: 'KH-00007', name: NAME, shortName: 'Máy Chủ Một', phone: '0901234567', version: 2, owner: { id: '0b9f1c52-3a0e-4c3e-9d6f-000000000900', fullName: 'Chủ sở hữu' } };
  let mode = 200;
  fetchImpl = async (url) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/lookups')) return res(200, { data: LOOKUPS });
    if (mode === 200) return res(200, { data: { items: [row], page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    return res(mode, { error: { code: 'X', message: 'x' } });
  };
  const v = await mount('#/customers');
  assert.match(text(v.container), /Máy Chủ Một/, 'đối chứng: dữ liệu API 200 được hiển thị');
  assert.ok(!writes.filter((k) => !allowedWrite(k)).length, 'dữ liệu khách API không được ghi vào localStorage: ' + writes.join(','));
  assert.ok(!reads.includes(DB_KEY));
  await v.unmount();
  mode = 429;
  const v2 = await mount('#/customers');
  assertNoDemo(v2.container, 'sau 429');
  assert.ok(!Object.values(store).some((s) => String(s).includes(NAME)), 'không có dữ liệu khách API trong storage');
  assert.ok(!writes.filter((k) => !allowedWrite(k)).length, 'không ghi storage: ' + writes.join(','));
  await v2.unmount();
});

// ---- actor A -> B: lỗi muộn không phải 401 của A ----
const TOK_A = 'sid_' + 'A'.repeat(43);
const TOK_B = 'sid_' + 'B'.repeat(43);
const cfg = { enabled: true, baseUrl: 'http://api.test' };
const deferred = () => { let resolve; let reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
function twoActorSession() {
  const byToken = { [TOK_A]: 7, [TOK_B]: 8 }; const order = [TOK_A, TOK_B]; let n = 0;
  return createLoginSession({
    enabled: true,
    login: async () => ({ token: order[Math.min(n++, 1)], expiresAt: '2026-10-25T00:00:00.000Z' }),
    me: async (t) => ({ employeeId: byToken[t] }),
    logout: async () => ({}),
  });
}
const LATE = {
  '403': (g) => g.resolve(res(403, { error: { code: 'FORBIDDEN', message: 'x' } })),
  '429': (g) => g.resolve(res(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'x' } })),
  '500': (g) => g.resolve(res(500, { error: { code: 'INTERNAL', message: 'x' } })),
  'timeout': (g) => g.reject(timeoutErr()),
};
for (const [name, fire] of Object.entries(LATE)) {
  test(`A→B: ${name} MUỘN của A không đổi phiên B, không tự thử lại, không gửi lại bằng token B`, async () => {
    const s = twoActorSession();
    await s.submit('a@b.vn', 'pw-gia-lap');
    const gate = deferred(); const seen = [];
    const api = createCustomerApi(cfg, async (url, init) => { seen.push(init.headers.Authorization); return gate.p; }, { auth: s });
    const settled = api.list({}).then(() => null, (e) => e);
    assert.deepEqual(seen, ['Bearer ' + TOK_A]);
    await s.submit('a@b.vn', 'pw-gia-lap');
    assert.equal(s.getState().employeeId, 8);
    fire(gate);
    const err = await settled;
    assert.ok(err, 'lỗi của A được báo cho chính người gọi A');
    if (err instanceof ApiError) assert.equal(String(err.status), name);
    await sleep(30);
    assert.equal(s.getState().status, 'AUTHENTICATED', 'phiên B không bị hủy');
    assert.equal(s.getState().employeeId, 8);
    assert.equal(s.getAuthHeader(), 'Bearer ' + TOK_B, 'token B còn nguyên');
    assert.deepEqual(seen, ['Bearer ' + TOK_A], 'không tự thử lại (cũng không bằng token B)');
    const pub = JSON.stringify(s.getState());
    assert.ok(!pub.includes(TOK_A) && !pub.includes(TOK_B), 'trạng thái công khai không chứa token');
  });
}
