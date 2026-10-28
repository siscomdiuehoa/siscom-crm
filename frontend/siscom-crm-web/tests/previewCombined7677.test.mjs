// Run: node --test tests/*.test.mjs   (Node >= 18). Một máy chủ giả DUY NHẤT (fetch tiêm vào) phục vụ cả /auth/* lẫn /customers; không mạng/DB/bí mật thật.
// Hồi quy chéo chuỗi cho nhánh preview kết hợp #76 (tạo KH ở trang >1 không làm bẩn trang) + #77 (logout khi login đang chờ không đăng nhập lại).
// Cờ TẮT: không gọi mạng, không tạo controller. Cờ BẬT: hai hành vi trên đúng, và không ảnh hưởng chéo nhau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';
import { createLoginSession } from '../src/auth/loginSession.js';
import { createAuthClient, readAuthConfig } from '../src/auth/authClient.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const OFF = { VITE_CRM_API_BASE: BASE };
const PW = 'pw-gia-lap-cho-test';
const uid = (n) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(n).padStart(12, '0');
const row = (n, name) => ({ id: uid(n), code: 'KH-' + String(n).padStart(5, '0'), name: name || 'Công ty ' + n, phone: '0901234567', version: 1 });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setImmediate(r));

// `holdLogin` = deferred giữ phản hồi POST /auth/login để dựng tình huống "login đang chờ".
function server(initial, { holdLogin } = {}) {
  const store = Array.from({ length: initial }, (_, i) => row(i + 1));
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const path = String(url).replace(BASE, '').split('?')[0];
    calls.push({ method, path });
    if (path === '/auth/login') { if (holdLogin) await holdLogin.promise; return res(200, { data: { token: 'TOK-A', expiresAt: '2026-10-24T00:00:00.000Z' } }); }
    if (path === '/auth/me') return res(200, { data: { employeeId: 7 } });
    if (path === '/auth/logout') return res(204, {});
    if (method === 'POST') { const r = row(store.length + 1, JSON.parse(init.body).name); store.push(r); return res(201, { data: r }); }
    const p = Object.fromEntries(new URL(url).searchParams); const page = Number(p.page || 1); const size = Number(p.pageSize || 20);
    return res(200, { data: { items: store.slice((page - 1) * size, page * size), page, pageSize: size, total: store.length, totalPages: Math.ceil(store.length / size) } });
  };
  f.calls = calls;
  return f;
}
const session = (env, f) => createLoginSession(createAuthClient(readAuthConfig(env), f));

test('cờ TẮT: không có controller khách hàng, đăng nhập không gọi mạng', async () => {
  const f = server(5);
  assert.equal(createCustomerApiUi({ env: OFF, fetchImpl: f }), null);
  const s = session(OFF, f);
  await s.submit('a@b.vn', PW);
  assert.notEqual(s.getState().status, 'AUTHENTICATED');
  assert.equal(s.getAuthHeader(), null);
  assert.equal(f.calls.length, 0, 'zero fetch khi cờ tắt');
});

test('CHÉO-1 (cờ BẬT): tạo KH ở trang 2 trong lúc phiên đang đăng nhập — trang 2 không bị chèn bản ghi mới, total theo máy chủ', async () => {
  const f = server(45); const s = session(ON, f); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await s.submit('a@b.vn', PW);
  assert.equal(s.getState().status, 'AUTHENTICATED');
  await c.load({ page: 2 });
  const r = await c.submit({ name: 'Zeta Mới', phone: '0901234567', short: '', taxId: '' });
  assert.equal(r.ok, true);
  const l = c.getState().list;
  assert.equal(l.paging.page, 2); assert.equal(l.paging.total, 46); assert.equal(l.paging.totalPages, 3);
  assert.equal(l.items.length, 20);
  assert.equal(l.items.some((x) => x.name === 'Zeta Mới'), false, 'bản ghi mới thuộc trang 3');
  assert.equal(s.getState().status, 'AUTHENTICATED', 'tạo KH không đụng tới phiên');
});

test('CHÉO-2 (cờ BẬT): logout khi login đang chờ, rồi login về muộn — không đăng nhập lại; danh sách KH vẫn đúng', async () => {
  const hold = deferred(); const f = server(45, { holdLogin: hold });
  const s = session(ON, f); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const p = s.submit('a@b.vn', PW); await tick();
  assert.equal(s.getState().status, 'LOADING');
  await c.load({ page: 2 });
  await s.logout();
  hold.resolve(); await p; await tick();
  assert.equal(s.getState().status, 'IDLE', 'login cũ không được phục hồi phiên');
  assert.equal(s.getAuthHeader(), null);
  assert.equal(f.calls.filter((x) => x.path === '/auth/me').length, 0, 'không xác minh /me cho login đã bị hủy');
  const r = await c.submit({ name: 'Zeta Mới', phone: '0901234567', short: '', taxId: '' });
  assert.equal(r.ok, true);
  const l = c.getState().list;
  assert.equal(l.paging.page, 2); assert.equal(l.items.some((x) => x.name === 'Zeta Mới'), false);
  assert.equal(s.getState().status, 'IDLE', 'tạo KH sau logout vẫn không làm phiên sống lại');
});
