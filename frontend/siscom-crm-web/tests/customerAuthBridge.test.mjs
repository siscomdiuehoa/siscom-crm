// Run: node --test tests/   S02: cầu nối tùy chọn auth createCustomerApiUi -> createCustomerRepository -> createCustomerApi.
// fetch + phiên giả lập; không mạng/DB/bí mật thật. Không chọn cơ chế đăng nhập (JWT vs sid_): chỉ chuyển tiếp phiên do thành phần tin cậy cấp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';
import { createCustomerRepository } from '../src/data/api/customerRepository.js';

const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: 'http://api.test' };
const TOKEN_A = 'sid_' + 'A'.repeat(43);
const TOKEN_B = 'sid_' + 'B'.repeat(43);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LIST = { data: { items: [], total: 0, page: 1, pageSize: 20 } };
const E401 = { error: { code: 'UNAUTHENTICATED', message: 'x' } };
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init); }; f.calls = calls; return f; };
const hdr = (c) => Object.entries(c.init.headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
function fakeSession(token) {
  let t = token; const revoked = [];
  return { getState: () => ({ status: t ? 'AUTHENTICATED' : 'IDLE' }), getAuthHeader: () => (t ? 'Bearer ' + t : null), handleUnauthorized: (h) => { revoked.push(h); }, set(v) { t = v; }, revoked };
}
const dump = (x) => JSON.stringify(x, Object.getOwnPropertyNames(x instanceof Error ? x : {})) + String(x && x.message) + String(x && x.stack);

test('không cấp auth: không gửi Authorization; backend 401 => kind unauthenticated (default deny giữ nguyên)', async () => {
  const f = mockFetch(() => res(401, E401));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f });
  await assert.rejects(() => repo.list({}), (e) => e.kind === 'unauthenticated' && e.status === 401);
  assert.equal(f.calls.length, 1); assert.equal(hdr(f.calls[0]), undefined); assert.equal(f.calls[0].init.credentials, 'omit');
});

test('auth không hợp lệ/ANONYMOUS: fail-closed 401 TRƯỚC khi gọi mạng, qua cả repository và UI controller', async () => {
  for (const auth of [fakeSession(null), { getState: () => ({ status: 'AUTHENTICATED' }), getAuthHeader: () => 'Bearer a b\r\nX: y', handleUnauthorized() {} }, { getState() { throw new Error('boom'); } }, {}]) {
    const f = mockFetch(() => res(200, LIST));
    const repo = createCustomerRepository({ env: ON, fetchImpl: f, auth });
    await assert.rejects(() => repo.list({}), (e) => e.kind === 'unauthenticated');
    const ui = createCustomerApiUi({ env: ON, fetchImpl: f, auth });
    await ui.load({});
    assert.equal(ui.getState().list.status, 'error');
    assert.equal(f.calls.length, 0);
  }
});

test('auth cấp đúng kiểu: list/lookups/create/get/update đều mang Bearer của phiên, qua createCustomerApiUi', async () => {
  const s = fakeSession(TOKEN_A);
  const f = mockFetch(() => res(200, LIST));
  const ui = createCustomerApiUi({ env: ON, fetchImpl: f, auth: s });
  await ui.load({});
  assert.equal(f.calls.length, 1); assert.equal(hdr(f.calls[0]), 'Bearer ' + TOKEN_A);
  assert.equal(ui.getState().list.status, 'ready');
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, auth: s });
  await repo.lookups().catch(() => {});
  assert.equal(hdr(f.calls[f.calls.length - 1]), 'Bearer ' + TOKEN_A);
});

test('401 từ server với auth: gọi handleUnauthorized đúng header đã dùng; lỗi vẫn là unauthenticated', async () => {
  const s = fakeSession(TOKEN_A);
  const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(401, E401)), auth: s });
  await assert.rejects(() => repo.list({}), (e) => e.kind === 'unauthenticated');
  assert.deepEqual(s.revoked, ['Bearer ' + TOKEN_A]);
});

test('chuyển actor A->B: yêu cầu sau dùng token B, không dùng token cũ; kết quả muộn của A bị bỏ', async () => {
  const s = fakeSession(TOKEN_A);
  const f = mockFetch(() => res(200, LIST));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, auth: s });
  await repo.list({});
  s.set(TOKEN_B);
  await repo.list({});
  assert.deepEqual(f.calls.map(hdr), ['Bearer ' + TOKEN_A, 'Bearer ' + TOKEN_B]);
  let release; const gate = new Promise((r) => { release = r; });
  const slow = mockFetch(async () => { await gate; return res(200, LIST); });
  const s2 = fakeSession(TOKEN_A);
  const p = createCustomerRepository({ env: ON, fetchImpl: slow, auth: s2 }).list({});
  const settled = p.then(() => 'ok', (e) => e);
  s2.set(TOKEN_B); release();
  const out = await settled;
  assert.notEqual(out, 'ok'); // không trả dữ liệu của phiên cũ
  assert.equal(dump(out).includes(TOKEN_A), false);
});

test('đăng xuất giữa chừng: không còn gửi Bearer, fail-closed không gọi mạng', async () => {
  const s = fakeSession(TOKEN_A);
  const f = mockFetch(() => res(200, LIST));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, auth: s });
  await repo.list({}); s.set(null);
  await assert.rejects(() => repo.list({}), (e) => e.kind === 'unauthenticated');
  assert.equal(f.calls.length, 1);
});

test('không rò Bearer qua lỗi/state/log/DOM-model: 401, 500, lỗi mạng', async () => {
  const logs = []; const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => logs.push(a.map(String).join(' '));
  try {
    for (const h of [() => res(401, E401), () => res(500, { error: { code: 'X', message: 'lỗi' } }), () => { throw new Error('mất mạng'); }]) {
      const s = fakeSession(TOKEN_A);
      const ui = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(h), auth: s });
      await ui.load({});
      const st = ui.getState();
      assert.equal(st.list.status, 'error');
      assert.equal(JSON.stringify(st).includes(TOKEN_A), false);
      assert.equal(dump(st.list.error).includes(TOKEN_A), false);
    }
  } finally { Object.assign(console, orig); }
  assert.equal(logs.join('\n').includes(TOKEN_A), false);
});

test('chế độ demo (cờ TẮT): auth bị bỏ qua, controller null, fetch/auth không được chạm', () => {
  let touched = 0;
  const auth = new Proxy({}, { get() { touched++; return () => null; } });
  const f = mockFetch(() => { throw new Error('không được gọi'); });
  assert.equal(createCustomerApiUi({ env: {}, fetchImpl: f, auth }), null);
  const local = { list: () => [{ id: 'KH-00001' }] };
  const repo = createCustomerRepository({ env: {}, fetchImpl: f, local, auth });
  assert.equal(repo.mode, 'local');
  assert.equal(touched, 0); assert.equal(f.calls.length, 0);
});

test('cờ BẬT thiếu base + auth: vẫn misconfigured, không rơi về local, không mạng', async () => {
  const f = mockFetch(() => res(200, LIST));
  const repo = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f, local: { list: () => [] }, auth: fakeSession(TOKEN_A) });
  assert.equal(repo.mode, 'misconfigured');
  await assert.rejects(() => repo.list({}), (e) => e.kind === 'config');
  assert.equal(f.calls.length, 0);
});

test('token/credential không bị lưu vào localStorage/sessionStorage/cookie bởi cầu nối', async () => {
  const w = []; const mk = () => ({ setItem: (...a) => w.push(a), getItem: () => null, removeItem() {}, clear() {} });
  const saved = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  globalThis.localStorage = mk(); globalThis.sessionStorage = mk();
  try {
    const ui = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(() => res(200, LIST)), auth: fakeSession(TOKEN_A) });
    await ui.load({});
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
  assert.deepEqual(w, []);
});

// S05: ca còn thiếu ở tầng cầu nối. Phiên mô phỏng đúng ngữ nghĩa loginSession: chỉ hủy khi header được báo KHỚP phiên hiện tại.
function revokingSession(token) {
  let t = token; const calls401 = [];
  return { getState: () => ({ status: t ? 'AUTHENTICATED' : 'IDLE' }), getAuthHeader: () => (t ? 'Bearer ' + t : null), handleUnauthorized: (h) => { calls401.push(h); if (h === (t ? 'Bearer ' + t : null)) t = null; }, set(v) { t = v; }, calls401, token: () => t };
}

for (const [name, drive] of [
  ['createCustomerRepository', (auth, f) => createCustomerRepository({ env: ON, fetchImpl: f, auth }).list({}).catch((e) => e)],
  ['createCustomerApiUi', async (auth, f) => { const ui = createCustomerApiUi({ env: ON, fetchImpl: f, auth }); await ui.load({}); return ui.getState().list; }],
]) {
  test(`401 muộn của A sau khi chuyển sang B qua ${name}: handleUnauthorized nhận header CŨ của A, phiên B giữ nguyên và yêu cầu kế tiếp dùng B`, async () => {
    const s = revokingSession(TOKEN_A);
    let release; const gate = new Promise((r) => { release = r; });
    let n = 0;
    const f = mockFetch(async () => { if (n++ === 0) { await gate; return res(401, E401); } return res(200, LIST); });
    const pending = drive(s, f);
    await new Promise((r) => setImmediate(r));
    assert.equal(f.calls.length, 1); assert.equal(hdr(f.calls[0]), 'Bearer ' + TOKEN_A); // yêu cầu A đã đi với token A
    s.set(TOKEN_B); release();
    await pending;
    assert.deepEqual(s.calls401, ['Bearer ' + TOKEN_A]);   // báo đúng header đã dùng, không phải header hiện tại
    assert.equal(s.token(), TOKEN_B);                       // phiên B KHÔNG bị hủy bởi 401 của A
    assert.equal(s.getState().status, 'AUTHENTICATED');
    await createCustomerRepository({ env: ON, fetchImpl: f, auth: s }).list({});
    assert.equal(hdr(f.calls[f.calls.length - 1]), 'Bearer ' + TOKEN_B);
  });
}
