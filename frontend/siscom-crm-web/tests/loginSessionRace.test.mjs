// Run: node --test tests/*.test.mjs   (Node >= 18). Client giả có promise điều khiển được (deferred); không mạng/DB/bí mật thật.
// Mục tiêu: kết quả async CŨ (stale) không được ghi đè logout / 401 / lần thử mới hơn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginSession } from '../src/auth/loginSession.js';
import { createAuthClient, AuthHttpError } from '../src/auth/authClient.js';

const PW = 'pw-gia-lap-cho-test';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));

// Mỗi lần gọi login/me/logout tạo một deferred riêng để test tự quyết thứ tự hoàn tất.
function ctl() {
  const q = { login: [], me: [], logout: [] };
  const mk = (k, args) => { const d = deferred(); d.args = args; q[k].push(d); return d.promise; };
  const client = { enabled: true, login: (...a) => mk('login', a), me: (...a) => mk('me', a), logout: (...a) => mk('logout', a) };
  return { q, client, session: createLoginSession(client) };
}
const issued = (t) => ({ token: t, expiresAt: '2026-10-24T00:00:00.000Z' });

test('RACE-1: logout() khi đang LOADING — submit cũ hoàn tất KHÔNG được đăng nhập lại', async () => {
  const { q, session } = ctl();
  const p = session.submit('a@b.vn', PW);
  assert.equal(session.getState().status, 'LOADING');
  await session.logout();
  assert.equal(session.getState().status, 'IDLE');
  q.login[0].resolve(issued('TOK-A')); await tick();
  q.me[0]?.resolve({ employeeId: 7 }); await p;
  assert.equal(session.getState().status, 'IDLE');
  assert.equal(session.getAuthHeader(), null);
});

test('RACE-2: handleUnauthorized() sau khi đã đăng nhập, rồi submit cũ không còn — 401 vẫn giữ SESSION_EXPIRED', async () => {
  const { q, session } = ctl();
  const p = session.submit('a@b.vn', PW);
  q.login[0].resolve(issued('TOK-A')); await tick(); q.me[0].resolve({ employeeId: 7 }); await p;
  assert.equal(session.getState().status, 'AUTHENTICATED');
  session.handleUnauthorized();
  assert.equal(session.getState().status, 'ERROR');
  assert.equal(session.getState().error, 'SESSION_EXPIRED');
  assert.equal(session.getAuthHeader(), null);
});

test('RACE-3: đăng nhập lại khi đang AUTHENTICATED rồi 401 của phiên cũ — lần thử cũ/401 không phục hồi token cũ', async () => {
  const { q, session } = ctl();
  const p1 = session.submit('a@b.vn', PW);
  q.login[0].resolve(issued('TOK-A')); await tick(); q.me[0].resolve({ employeeId: 7 }); await p1;
  const p2 = session.submit('a@b.vn', PW); // thử đăng nhập lại trong lúc đang có phiên
  assert.equal(session.getState().status, 'LOADING');
  assert.equal(session.getAuthHeader(), null, 'LOADING không được giữ token cũ');
  q.login[1].reject(new AuthHttpError(401, 'LOGIN_INVALID')); await p2;
  assert.equal(session.getState().error, 'INVALID_CREDENTIALS');
  assert.equal(session.getAuthHeader(), null);
});

test('RACE-4: hai lần thử — sau logout rồi submit mới, lần cũ về MUỘN không ghi đè lần mới', async () => {
  const { q, session } = ctl();
  const pA = session.submit('a@b.vn', PW);
  await session.logout();                       // hủy A
  const pB = session.submit('b@b.vn', PW);      // B mới
  q.login[1].resolve(issued('TOK-B')); await tick(); q.me[0 + 0]?.resolve({ employeeId: 2 }); await pB;
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getState().employeeId, 2);
  assert.equal(session.getAuthHeader(), 'Bearer TOK-B');
  q.login[0].resolve(issued('TOK-A')); await tick();
  if (q.me[1]) q.me[1].resolve({ employeeId: 1 });
  await pA;
  assert.equal(session.getState().employeeId, 2, 'B phải còn nguyên');
  assert.equal(session.getAuthHeader(), 'Bearer TOK-B', 'token A cũ không được ghi đè');
});

test('RACE-5: logout() đang chờ server, người dùng đăng nhập lại — logout cũ hoàn tất KHÔNG xóa phiên mới', async () => {
  const { q, session } = ctl();
  const p1 = session.submit('a@b.vn', PW);
  q.login[0].resolve(issued('TOK-A')); await tick(); q.me[0].resolve({ employeeId: 7 }); await p1;
  const lo = session.logout();                  // chờ server
  assert.equal(session.getAuthHeader(), null);
  const p2 = session.submit('a@b.vn', PW);
  q.login[1].resolve(issued('TOK-B')); await tick(); q.me[1].resolve({ employeeId: 7 }); await p2;
  assert.equal(session.getState().status, 'AUTHENTICATED');
  q.logout[0].resolve({ ok: true }); await lo;
  assert.equal(session.getState().status, 'AUTHENTICATED', 'logout cũ không được đưa về IDLE');
  assert.equal(session.getAuthHeader(), 'Bearer TOK-B');
});

test('RACE-6: logout() cũ thất bại SAU khi đã đăng nhập mới — không ghi ERROR đè phiên mới', async () => {
  const { q, session } = ctl();
  const p1 = session.submit('a@b.vn', PW);
  q.login[0].resolve(issued('TOK-A')); await tick(); q.me[0].resolve({ employeeId: 7 }); await p1;
  const lo = session.logout();
  const p2 = session.submit('a@b.vn', PW);
  q.login[1].resolve(issued('TOK-B')); await tick(); q.me[1].resolve({ employeeId: 7 }); await p2;
  q.logout[0].reject(new AuthHttpError(503, 'AUTH_UNAVAILABLE')); await lo;
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getAuthHeader(), 'Bearer TOK-B');
});

test('RACE-7: me() thất bại — không giữ token, không AUTHENTICATED (token không rò vào trạng thái)', async () => {
  const { q, session } = ctl();
  const p = session.submit('a@b.vn', PW);
  q.login[0].resolve(issued('TOK-A')); await tick();
  q.me[0].reject(new AuthHttpError(401, 'AUTH_REQUIRED')); await p;
  assert.equal(session.getState().status, 'ERROR');
  assert.equal(session.getState().error, 'SESSION_EXPIRED'); // token hết hạn/không hợp lệ ≠ sai mật khẩu
  assert.equal(session.getAuthHeader(), null);
  assert.ok(!JSON.stringify(session.getState()).includes('TOK-A'));
});

test('RACE-8: 401 LOGIN_INVALID (sai mật khẩu) khác 401 AUTH_REQUIRED (phiên hết hạn)', async () => {
  const a = ctl();
  const pa = a.session.submit('a@b.vn', PW); a.q.login[0].reject(new AuthHttpError(401, 'LOGIN_INVALID')); await pa;
  assert.equal(a.session.getState().error, 'INVALID_CREDENTIALS');
  const b = ctl();
  const pb = b.session.submit('a@b.vn', PW); b.q.login[0].resolve(issued('T')); await tick(); b.q.me[0].reject(new AuthHttpError(401, 'AUTH_REQUIRED')); await pb;
  assert.equal(b.session.getState().error, 'SESSION_EXPIRED');
});

test('RACE-9: logout() thất bại (503) khi không có lần thử nào khác — token cục bộ vẫn bị xóa, báo lỗi', async () => {
  const { q, session } = ctl();
  const p = session.submit('a@b.vn', PW);
  q.login[0].resolve(issued('TOK-A')); await tick(); q.me[0].resolve({ employeeId: 7 }); await p;
  const lo = session.logout();
  q.logout[0].reject(new AuthHttpError(503, 'AUTH_UNAVAILABLE')); await lo;
  assert.equal(session.getState().status, 'ERROR');
  assert.equal(session.getState().error, 'SERVICE_UNAVAILABLE');
  assert.equal(session.getAuthHeader(), null);
});

test('RACE-10: submit khi đang LOADING bị từ chối, không tạo lần gọi mạng thứ hai', async () => {
  const { q, session } = ctl();
  const p = session.submit('a@b.vn', PW);
  const again = await session.submit('c@b.vn', PW);
  assert.equal(again.status, 'LOADING');
  assert.equal(q.login.length, 1);
  q.login[0].resolve(issued('T')); await tick(); q.me[0].resolve({ employeeId: 1 }); await p;
  assert.equal(session.getState().status, 'AUTHENTICATED');
});

test('RACE-11: handleUnauthorized() khi đang LOADING — không phục hồi token cũ, không làm hỏng lần đăng nhập đang chạy', async () => {
  const { q, session } = ctl();
  const p = session.submit('a@b.vn', PW);
  session.handleUnauthorized(); // 401 muộn từ yêu cầu khác (phiên cũ)
  q.login[0].resolve(issued('TOK-A')); await tick(); q.me[0].resolve({ employeeId: 7 }); await p;
  // Lần đăng nhập mới do máy chủ xác nhận hợp lệ: được phép AUTHENTICATED; không được kẹt ở LOADING.
  assert.notEqual(session.getState().status, 'LOADING');
});

test('RACE-12: cờ TẮT — UNAVAILABLE, logout/handleUnauthorized không đổi trạng thái, không gọi client', async () => {
  const calls = [];
  const client = { enabled: false, login: () => calls.push('login'), me: () => calls.push('me'), logout: () => calls.push('logout') };
  const s = createLoginSession(client);
  await s.submit('a@b.vn', PW); await s.logout(); s.handleUnauthorized();
  assert.equal(s.getState().status, 'UNAVAILABLE');
  assert.equal(s.getAuthHeader(), null);
  assert.deepEqual(calls, []);
});

test('RACE-13: authClient thật + fetch giả có điều khiển — logout giữa chừng, phản hồi login cũ bị bỏ', async () => {
  const gates = [];
  const fetchImpl = (url) => { const d = deferred(); gates.push({ url, d }); return d.promise; };
  const client = createAuthClient({ enabled: true, baseUrl: 'http://api.test' }, fetchImpl);
  const s = createLoginSession(client);
  const p = s.submit('a@b.vn', PW);
  await s.logout();
  gates[0].d.resolve({ ok: true, status: 200, json: async () => ({ token: 'sid_' + 'B'.repeat(43), expiresAt: '2026-10-24T00:00:00.000Z' }) });
  await tick();
  if (gates[1]) gates[1].d.resolve({ ok: true, status: 200, json: async () => ({ employeeId: 9 }) });
  await p;
  assert.equal(s.getState().status, 'IDLE');
  assert.equal(s.getAuthHeader(), null);
});

test('RACE-14: submit cũ THẤT BẠI muộn (login/me) sau logout hoặc sau lần đăng nhập mới — không ghi ERROR đè', async () => {
  const a = ctl();
  const pa = a.session.submit('a@b.vn', PW);
  await a.session.logout();
  a.q.login[0].reject(new AuthHttpError(401, 'LOGIN_INVALID')); await pa;
  assert.equal(a.session.getState().status, 'IDLE');
  assert.equal(a.session.getState().error, null);

  const b = ctl();
  const pA = b.session.submit('a@b.vn', PW);
  b.q.login[0].resolve(issued('TOK-A')); await tick(); // A đang chờ me()
  await b.session.logout();
  const pB = b.session.submit('b@b.vn', PW);
  b.q.login[1].resolve(issued('TOK-B')); await tick(); b.q.me[1].resolve({ employeeId: 2 }); await pB;
  b.q.me[0].reject(new AuthHttpError(401, 'AUTH_REQUIRED')); await pA;
  assert.equal(b.session.getState().status, 'AUTHENTICATED');
  assert.equal(b.session.getAuthHeader(), 'Bearer TOK-B');
});
