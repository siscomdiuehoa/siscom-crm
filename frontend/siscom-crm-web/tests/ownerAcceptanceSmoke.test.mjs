// Run: node --test tests/ownerAcceptanceSmoke.test.mjs   (Node >= 18; không phụ thuộc mới, không trình duyệt, không mạng, không DB, không .env.)
// OWNER SMOKE (MOCK) — hành trình khách hàng + đăng nhập qua `fetch` GIẢ mô phỏng hợp đồng backend đã chốt:
//   /auth/login|me|logout (hợp đồng A4, GIẢ ĐỊNH chưa có AuthController thật) và /customers, /lookups FAIL-CLOSED: thiếu Bearer hợp lệ => 401 UNAUTHENTICATED (giống DenyAll).
// KHÔNG phải E2E thật: máy chủ ở đây là mô phỏng trong bộ nhớ. Đăng nhập nhân viên thật + PostgreSQL chưa được kiểm chứng (xem docs/OWNER_SMOKE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiConfig, createCustomerApi, AuthRequiredError, ApiError } from '../src/data/api/customerApiClient.js';
import { createAuthClient, readAuthConfig } from '../src/auth/authClient.js';
import { createLoginSession } from '../src/auth/loginSession.js';
import { createLoginPreviewSession } from '../src/auth/loginPreview.js';
import { createCustomerRepository } from '../src/data/api/customerRepository.js';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const GOOD = { login: 'nv.demo@example.test', password: 'Demo-Only-Pass-1' }; // dữ liệu tổng hợp, KHÔNG phải tài khoản thật
const TOKEN = 'sid_' + 'D'.repeat(43);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const E401 = { error: { code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' } };
const uid = (i) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(i).padStart(12, '0');
const LOOKUPS = { customer_tier: [{ code: 'vip', label: 'VIP' }], customer_status: [{ code: 'active', label: 'Đang hoạt động' }], industry: [{ code: 'IND-1', label: 'Xây dựng' }], source: [{ code: 'web', label: 'Website' }], province: [{ code: 'HCM', label: 'TP. Hồ Chí Minh' }] };
const row = (i, over = {}) => ({ id: uid(i), code: 'KH-' + String(i).padStart(5, '0'), name: 'Công ty ' + i, phone: '0901234567', version: 1, owner: { id: uid(900), fullName: 'Chủ sở hữu' }, ...over });

// Backend giả: fail-closed. `calls` ghi lại mọi yêu cầu để kiểm tra; không ghi gì ra ngoài bộ nhớ.
function mockBackend() {
  const calls = []; const db = [row(1), row(2)]; let revoked = false;
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const path = u.pathname.replace('/api/v1', '');
    const body = init.body ? JSON.parse(init.body) : null; const bearer = (init.headers || {}).Authorization;
    calls.push({ method, path, bearer, body, credentials: init.credentials });
    if (path === '/auth/login') return body && body.login === GOOD.login && body.password === GOOD.password ? res(200, { data: { token: TOKEN, expiresAt: '2099-01-01T00:00:00Z' } }) : res(401, { error: { code: 'LOGIN_INVALID', message: 'x' } });
    const authed = bearer === 'Bearer ' + TOKEN && !revoked;
    if (path === '/auth/me') return authed ? res(200, { data: { employeeId: 'e-1' } }) : res(401, { error: { code: 'AUTH_REQUIRED', message: 'x' } });
    if (path === '/auth/logout') { if (!authed) return res(401, { error: { code: 'AUTH_REQUIRED', message: 'x' } }); revoked = true; return res(200, { data: { ok: true } }); }
    if (!authed) return res(401, E401); // /customers, /lookups: mặc định từ chối
    if (path === '/lookups') return res(200, { data: LOOKUPS });
    if (path === '/customers' && method === 'GET') return res(200, { data: { items: db, page: 1, pageSize: 20, total: db.length, totalPages: 1 } });
    if (path === '/customers' && method === 'POST') { const c = row(db.length + 1, { name: body.name }); db.push(c); return res(201, { data: c }); }
    const m = /^\/customers\/([^/]+)$/.exec(path);
    const hit = m && db.find((c) => c.id === decodeURIComponent(m[1]));
    if (!hit) return res(404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'x' } });
    if (method === 'PATCH') { Object.assign(hit, { name: body.name ?? hit.name, version: hit.version + 1 }); return res(200, { data: hit }); }
    return res(200, { data: hit });
  };
  f.calls = calls; f.customerCalls = () => calls.filter((c) => c.path.startsWith('/customers') || c.path === '/lookups'); return f;
}
// Mọi kịch bản chạy với localStorage + fetch toàn cục bị canh: đụng vào là FAIL.
async function guarded(fn) {
  const touched = []; const g = []; const pl = globalThis.localStorage; const pf = globalThis.fetch;
  globalThis.localStorage = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); return () => null; } });
  globalThis.fetch = (...a) => { g.push(a[0]); throw new Error('fetch toàn cục không được dùng'); };
  try { return await fn(); } finally {
    if (pl === undefined) delete globalThis.localStorage; else globalThis.localStorage = pl;
    if (pf === undefined) delete globalThis.fetch; else globalThis.fetch = pf;
    assert.deepEqual(touched, [], 'localStorage không được đụng'); assert.deepEqual(g, [], 'fetch toàn cục không được gọi');
  }
}
const sessionOver = (f) => createLoginSession(createAuthClient(readAuthConfig(ON), f));

test('SMOKE-1 cờ mặc định TẮT: không cấu hình API/Auth, không UI API, repository cục bộ, zero fetch', () => guarded(async () => {
  assert.equal(readApiConfig({}).enabled, false);
  assert.equal(readAuthConfig({}).enabled, false);
  assert.equal(readApiConfig({ VITE_CRM_API_ENABLED: 'TRUE', VITE_CRM_API_BASE: BASE }).enabled, false, 'chỉ đúng chuỗi "true" mới bật');
  assert.equal(createCustomerApiUi({ env: {} }), null);
  const repo = createCustomerRepository({ env: {}, local: { list: () => [{ id: 'KH-001', name: 'Demo cục bộ' }] } });
  assert.equal(repo.mode, 'local');
  assert.deepEqual((await repo.list({})).items.map((c) => c.name), ['Demo cục bộ']);
  const sess = createLoginSession(createAuthClient(readAuthConfig({}), async () => { throw new Error('no net'); }));
  assert.equal(sess.getState().status, 'UNAVAILABLE');
  assert.equal((await sess.submit(GOOD.login, GOOD.password)).status, 'UNAVAILABLE');
}));

test('SMOKE-2 hành trình đăng nhập (mô phỏng): sai mật khẩu bị từ chối và vẫn không xem được khách hàng; đúng thì AUTHENTICATED, logout xoá token', () => guarded(async () => {
  const f = mockBackend(); const s = sessionOver(f);
  assert.equal((await s.submit(GOOD.login, 'Sai-mat-khau-1')).error, 'INVALID_CREDENTIALS');
  assert.equal(s.getAuthHeader(), null);
  const api = createCustomerApi(readApiConfig(ON), f, { auth: s });
  await assert.rejects(() => api.list({}), (e) => e instanceof AuthRequiredError);
  assert.equal(f.customerCalls().length, 0, 'chưa đăng nhập: không gửi yêu cầu khách hàng nào');
  const st = await s.submit(GOOD.login, GOOD.password);
  assert.equal(st.status, 'AUTHENTICATED'); assert.equal(st.employeeId, 'e-1');
  assert.equal(s.getAuthHeader(), 'Bearer ' + TOKEN);
  assert.ok(f.calls.every((c) => c.credentials === 'omit'));
  assert.equal((await s.logout()).status, 'IDLE');
  assert.equal(s.getAuthHeader(), null);
}));

test('SMOKE-3 hành trình khách hàng (mô phỏng): list/create/get/update gắn Bearer, không gửi owner, logout => fail-closed không gọi mạng', () => guarded(async () => {
  const f = mockBackend(); const s = sessionOver(f); await s.submit(GOOD.login, GOOD.password);
  const api = createCustomerApi(readApiConfig(ON), f, { auth: s });
  const maps = await api.getLookupMaps();
  const l1 = await api.list({}); assert.equal(l1.total, 2);
  const made = await api.create({ name: 'Công ty mới', phone: '0901234567', industry: 'Xây dựng', tier: 'VIP', owner: 'Hacker', ownerId: uid(999) }, maps);
  assert.equal(made.name, 'Công ty mới');
  assert.equal((await api.list({})).total, 3, 'danh sách đọc lại từ máy chủ giả');
  const got = await api.get(made.id); assert.equal(got.id, made.id);
  const upd = await api.update(made.id, { name: 'Đã sửa', phone: '0901234567' }, maps, got.version); assert.equal(upd.name, 'Đã sửa');
  const post = f.calls.find((c) => c.method === 'POST' && c.path === '/customers');
  assert.ok(!('owner' in post.body) && !('ownerId' in post.body) && !('owner_id' in post.body), 'owner do máy chủ suy ra, không lấy từ request');
  assert.ok(f.customerCalls().every((c) => c.bearer === 'Bearer ' + TOKEN));
  await s.logout();
  const before = f.calls.length;
  await assert.rejects(() => api.list({}), (e) => e instanceof AuthRequiredError);
  assert.equal(f.calls.length, before, 'sau logout không có yêu cầu nào tới máy chủ');
}));

test('SMOKE-4 token hết hạn/bị thu hồi phía máy chủ: 401 => phiên SESSION_EXPIRED, không tự thử lại, không dữ liệu cũ', () => guarded(async () => {
  const f = mockBackend(); const s = sessionOver(f); await s.submit(GOOD.login, GOOD.password);
  const api = createCustomerApi(readApiConfig(ON), f, { auth: s });
  await f('http://x/api/v1/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN } }); // máy chủ thu hồi token
  const n = f.customerCalls().length;
  await assert.rejects(() => api.list({}), (e) => e instanceof ApiError && e.status === 401);
  assert.equal(f.customerCalls().length, n + 1, 'đúng 1 yêu cầu, không tự thử lại');
  assert.equal(s.getState().status, 'ERROR'); assert.equal(s.getState().error, 'SESSION_EXPIRED');
  assert.equal(s.getAuthHeader(), null);
}));

test('SMOKE-5 chế độ API bật qua UI hiện tại (CHƯA nối phiên đăng nhập): máy chủ fail-closed => lỗi "Chưa đăng nhập", không dữ liệu demo/localStorage', () => guarded(async () => {
  const f = mockBackend();
  const ui = createCustomerApiUi({ env: ON, fetchImpl: f });
  await ui.load({});
  const st = ui.getState().list;
  assert.equal(st.status, 'error'); assert.deepEqual(st.items, []);
  assert.match(st.error.title || st.error.message || JSON.stringify(st.error), /Chưa đăng nhập/);
  assert.equal(f.calls.filter((c) => c.path === '/customers')[0].bearer, undefined, 'KNOWN GAP: UI chưa gắn Authorization (chưa nối createLoginSession vào customerRepository)');
}));

test('SMOKE-6 màn xem thử đăng nhập: không bao giờ AUTHENTICATED, không có header', () => guarded(async () => {
  const p = createLoginPreviewSession();
  const st = await p.submit(GOOD.login, GOOD.password);
  assert.equal(st.status, 'ERROR'); assert.equal(st.error, 'BACKEND_AUTH_UNAVAILABLE'); assert.equal(p.getAuthHeader(), null);
}));
