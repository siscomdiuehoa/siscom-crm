// Run: node --test tests/   Adapter Authorization opt-in (IN-MEMORY) cho customerApiClient. fetch + phiên giả lập; không mạng/DB/bí mật thật.
// GIẢ ĐỊNH (chưa chốt hợp đồng máy chủ): bearer chỉ là điểm nối thử; KHÔNG khẳng định đã được duyệt cho production.
// Nếu máy chủ chốt cookie HttpOnly + CSRF thì credentials:'omit' và header phải đổi theo hợp đồng đó.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApi, ApiError, AuthRequiredError, StaleSessionError } from '../src/data/api/customerApiClient.js';
import { createLoginSession } from '../src/auth/loginSession.js';

const TOKEN = 'sid_' + 'B'.repeat(43);
const TOKEN2 = 'sid_' + 'C'.repeat(43);
const ID = '00000000-0000-4000-8000-000000000001';
const cfg = { enabled: true, baseUrl: 'http://api.test' };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LIST = { data: { items: [], total: 0, page: 1, pageSize: 20 } };
const E401 = { error: { code: 'UNAUTHENTICATED', message: 'x' } };

// Phiên giả: trạng thái + header điều khiển trực tiếp (không đi qua mạng đăng nhập).
function fakeSession(token) {
  let t = token; const calls401 = [];
  return {
    getState: () => ({ status: t ? 'AUTHENTICATED' : 'IDLE' }),
    getAuthHeader: () => (t ? 'Bearer ' + t : null),
    handleUnauthorized: (h) => { calls401.push(h); },
    set(v) { t = v; }, calls401,
  };
}
function mk(session, handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { api: createCustomerApi(cfg, fetchImpl, session ? { auth: session } : undefined), calls };
}
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const realSession = (tokens) => {
  let n = 0;
  return createLoginSession({ enabled: true, login: async () => ({ token: tokens[Math.min(n++, tokens.length - 1)], expiresAt: 'x' }), me: async () => ({ employeeId: 7 }), logout: async () => ({}) });
};

test('không bật auth: hành vi cũ — không Authorization, credentials omit', async () => {
  const { api, calls } = mk(null, () => resp(200, LIST));
  await api.list({});
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal('Authorization' in calls[0].init.headers, false);
});

test('bật auth + phiên đã xác thực: gắn Authorization từ bộ nhớ, credentials omit, không header lạ', async () => {
  const s = fakeSession(TOKEN);
  const { api, calls } = mk(s, () => resp(200, LIST));
  await api.list({ q: 'x' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Accept', 'Authorization']);
  assert.ok(!calls[0].url.includes(TOKEN));
});

test('chưa xác thực / header rỗng / sai dạng / ném lỗi => AuthRequiredError TRƯỚC mạng, mọi phương thức', async () => {
  const mkS = (status, header) => ({ getState: () => ({ status }), getAuthHeader: typeof header === 'function' ? header : () => header, handleUnauthorized() {} });
  const bads = [fakeSession(null), mkS('AUTHENTICATED', null), mkS('LOADING', 'Bearer ' + TOKEN), mkS('AUTHENTICATED', 'Basic abc'),
    mkS('AUTHENTICATED', 'Bearer a\r\nX-Actor: 1'), mkS('AUTHENTICATED', () => { throw new Error('boom'); }), {}];
  for (const s of bads) {
    const { api, calls } = mk(s, () => resp(200, LIST));
    for (const fn of [() => api.list({}), () => api.get(ID), () => api.getLookupMaps(), () => api.create({ name: 'A', phone: '0900000000' }, {}), () => api.update(ID, { name: 'A', phone: '0900000000' }, {}, 1)]) {
      await assert.rejects(fn, (e) => e instanceof AuthRequiredError && e instanceof ApiError && e.status === 401 && e.code === 'AUTH_REQUIRED');
    }
    assert.equal(calls.length, 0);
  }
});

test('API tắt: vẫn ApiDisabledError trước mọi thứ (không đọc phiên)', async () => {
  let touched = false;
  const s = { getState() { touched = true; return {}; }, getAuthHeader() { touched = true; return null; }, handleUnauthorized() {} };
  const api = createCustomerApi({ enabled: false, baseUrl: '' }, async () => { throw new Error('no net'); }, { auth: s });
  await assert.rejects(() => api.list({}), (e) => e.name === 'ApiDisabledError');
  assert.equal(touched, false);
});

test('401: handleUnauthorized đúng 1 lần với header đã dùng; lỗi vẫn là ApiError 401; không tự thử lại', async () => {
  const s = fakeSession(TOKEN);
  const { api, calls } = mk(s, () => resp(401, E401));
  await assert.rejects(() => api.list({}), (e) => e instanceof ApiError && e.status === 401);
  assert.equal(calls.length, 1);
  assert.deepEqual(s.calls401, ['Bearer ' + TOKEN]);
});

test('403: bị từ chối, KHÔNG hủy phiên, không thử lại', async () => {
  const s = fakeSession(TOKEN);
  const { api, calls } = mk(s, () => resp(403, { error: { code: 'FORBIDDEN', message: 'x' } }));
  await assert.rejects(() => api.get(ID), (e) => e instanceof ApiError && e.status === 403);
  assert.equal(calls.length, 1);
  assert.deepEqual(s.calls401, []);
});

test('đua: 401 muộn của yêu cầu cũ KHÔNG hủy phiên MỚI (loginSession thật)', async () => {
  const session = realSession([TOKEN, TOKEN2]);
  await session.submit('a@b.vn', 'pw-gia-lap');
  const gate = deferred();
  const { api } = mk(session, () => gate.p);
  const settled = api.list({}).catch((e) => e);
  await session.logout();
  await session.submit('a@b.vn', 'pw-gia-lap'); // phiên mới TOKEN2
  gate.resolve(resp(401, E401));
  const err = await settled;
  assert.ok(err instanceof ApiError || err instanceof StaleSessionError);
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getAuthHeader(), 'Bearer ' + TOKEN2);
});

test('401 của phiên HIỆN TẠI hủy phiên 1 lần (loginSession thật); yêu cầu kế tiếp bị chặn trước mạng', async () => {
  const session = realSession([TOKEN]);
  await session.submit('a@b.vn', 'pw-gia-lap');
  const { api, calls } = mk(session, () => resp(401, E401));
  await assert.rejects(() => api.list({}), (e) => e.status === 401);
  assert.equal(session.getState().status, 'ERROR');
  assert.equal(session.getAuthHeader(), null);
  await assert.rejects(() => api.list({}), (e) => e instanceof AuthRequiredError);
  assert.equal(calls.length, 1);
});

test('2xx của phiên cũ sau logout bị bỏ (không trả dữ liệu)', async () => {
  const s = fakeSession(TOKEN); const gate = deferred();
  const { api } = mk(s, () => gate.p);
  const p = api.list({}).catch((e) => e);
  s.set(null);
  gate.resolve(resp(200, { data: { items: [{ id: 'leak' }], total: 1, page: 1, pageSize: 20 } }));
  assert.ok((await p) instanceof StaleSessionError);
});

test('2xx sau khi đổi sang phiên khác (token khác) cũng bị bỏ', async () => {
  const s = fakeSession(TOKEN); const gate = deferred();
  const { api } = mk(s, () => gate.p);
  const p = api.list({}).catch((e) => e);
  s.set(TOKEN2);
  gate.resolve(resp(200, LIST));
  assert.ok((await p) instanceof StaleSessionError);
});

test('401 muộn sau khi phiên đã đổi: handleUnauthorized nhận header CŨ (loginSession tự bỏ qua)', async () => {
  const s = fakeSession(TOKEN); const gate = deferred();
  const { api } = mk(s, () => gate.p);
  const p = api.list({}).catch((e) => e);
  s.set(TOKEN2);
  gate.resolve(resp(401, E401));
  await p;
  assert.deepEqual(s.calls401, ['Bearer ' + TOKEN]);
});

test('không rò token: không storage/cookie/console, không trong thông báo lỗi', async () => {
  const store = []; const sink = []; const cookieWrites = [];
  const fakeStore = { setItem: (k, v) => store.push(k + '=' + v), getItem: () => null, removeItem() {} };
  const saved = { ls: globalThis.localStorage, ss: globalThis.sessionStorage, doc: globalThis.document, log: console.log, warn: console.warn, error: console.error };
  globalThis.localStorage = fakeStore; globalThis.sessionStorage = fakeStore;
  globalThis.document = { get cookie() { return ''; }, set cookie(v) { cookieWrites.push(v); } };
  console.log = console.warn = console.error = (...a) => sink.push(a.join(' '));
  try {
    const s = fakeSession(TOKEN);
    for (const status of [200, 401, 403, 500]) {
      const { api } = mk(s, () => resp(status, status === 200 ? LIST : { error: { code: 'X', message: 'm' } }));
      const e = await api.list({}).then(() => null, (x) => x);
      if (e) assert.ok(!JSON.stringify({ m: e.message, d: e.details, c: e.code }).includes(TOKEN));
    }
    const { api } = mk(fakeSession(null), () => resp(200, LIST));
    const e2 = await api.list({}).catch((x) => x);
    assert.ok(!String(e2.message).includes(TOKEN));
  } finally {
    globalThis.localStorage = saved.ls; globalThis.sessionStorage = saved.ss; globalThis.document = saved.doc;
    console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
  }
  assert.deepEqual(store, []); assert.deepEqual(cookieWrites, []); assert.deepEqual(sink, []);
});

test('không fallback: lỗi xác thực KHÔNG chạm localStorage', async () => {
  let reads = 0;
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { reads++; return null; }, setItem() { reads++; }, removeItem() {} };
  try {
    const { api } = mk(fakeSession(null), () => resp(200, LIST));
    await api.list({}).catch(() => {});
  } finally { globalThis.localStorage = saved; }
  assert.equal(reads, 0);
});
