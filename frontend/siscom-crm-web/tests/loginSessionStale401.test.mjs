// Run: node --test tests/*.test.mjs   (Node >= 18). Client giả có promise điều khiển được; không mạng/DB/bí mật thật.
// Mục tiêu: 401 muộn của yêu cầu dùng token phiên CŨ (A) không được hủy phiên MỚI (B); 401 của phiên hiện tại VẪN xóa token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginSession } from '../src/auth/loginSession.js';

const PW = 'pw-gia-lap-cho-test';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));
function ctl() {
  const q = { login: [], me: [], logout: [] };
  const mk = (k) => { const d = deferred(); q[k].push(d); return d.promise; };
  const client = { enabled: true, login: () => mk('login'), me: () => mk('me'), logout: () => mk('logout') };
  return { q, session: createLoginSession(client) };
}
const issued = (t) => ({ token: t, expiresAt: '2026-10-24T00:00:00.000Z' });
async function loginAs(c, n, tok) {
  const p = c.session.submit('a@b.vn', PW);
  c.q.login[n].resolve(issued(tok)); await tick(); c.q.me[n].resolve({ employeeId: 7 }); await p;
}

test('STALE401-1: 401 mang header token A đến muộn sau khi B đã AUTHENTICATED — KHÔNG hủy B', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  const headerA = c.session.getAuthHeader(); // yêu cầu API dùng token A
  await loginAs(c, 1, 'TOK-B');
  c.session.handleUnauthorized(headerA);
  assert.equal(c.session.getState().status, 'AUTHENTICATED');
  assert.equal(c.session.getAuthHeader(), 'Bearer TOK-B');
});

test('STALE401-2: 401 mang header của phiên HIỆN TẠI (B) — vẫn xóa token, SESSION_EXPIRED', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A'); await loginAs(c, 1, 'TOK-B');
  c.session.handleUnauthorized(c.session.getAuthHeader());
  assert.equal(c.session.getState().status, 'ERROR');
  assert.equal(c.session.getState().error, 'SESSION_EXPIRED');
  assert.equal(c.session.getAuthHeader(), null);
});

test('STALE401-3: gọi không đối số (hành vi cũ) vẫn vô hiệu hóa phiên hiện tại — fail-closed', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  c.session.handleUnauthorized();
  assert.equal(c.session.getState().error, 'SESSION_EXPIRED');
  assert.equal(c.session.getAuthHeader(), null);
});

test('STALE401-4: 401 header cũ (A) khi đăng nhập B còn LOADING — không hủy lần đăng nhập đang chạy; B hoàn tất vẫn AUTHENTICATED', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  const headerA = c.session.getAuthHeader();
  const p = c.session.submit('a@b.vn', PW); // B đang chờ
  c.session.handleUnauthorized(headerA);
  assert.equal(c.session.getState().status, 'LOADING');
  c.q.login[1].resolve(issued('TOK-B')); await tick(); c.q.me[1].resolve({ employeeId: 7 }); await p;
  assert.equal(c.session.getState().status, 'AUTHENTICATED');
  assert.equal(c.session.getAuthHeader(), 'Bearer TOK-B');
});

test('STALE401-5: 401 header cũ khi đã logout (IDLE) — không đổi trạng thái sang ERROR', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  const headerA = c.session.getAuthHeader();
  const p = c.session.logout(); c.q.logout[0].resolve(); await p;
  c.session.handleUnauthorized(headerA);
  assert.equal(c.session.getState().status, 'IDLE');
});

test('STALE401-6: header không khớp token hiện tại — không hủy nhầm phiên, không ném lỗi', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  assert.doesNotThrow(() => c.session.handleUnauthorized('Bearer WRONG'));
  assert.equal(c.session.getState().status, 'AUTHENTICATED');
});

test('STALE401-7: trạng thái công khai không chứa token sau 401 (không rò credential)', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  c.session.handleUnauthorized(c.session.getAuthHeader());
  assert.ok(!JSON.stringify(c.session.getState()).includes('TOK-A'));
});
