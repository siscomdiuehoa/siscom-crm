// Run: node --test tests/   — phiên cookie (PR 4): fetch giả, không mạng, không storage, không bí mật thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readCookieAuthConfig, createCookieAuthClient, readCsrfCookie, CSRF_COOKIE_NAME } from '../src/auth/cookieAuthClient.js';
import { createCookieSession } from '../src/auth/cookieSession.js';

const CSRF = 'c'.repeat(43);
const ME = { employeeId: '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f', code: 'NV-0003', fullName: 'Sale A', departmentId: null, roles: ['sales'], permissions: { 'customer.read': 'OWN', 'lookup.read': 'ALL' }, mustChangePassword: false };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cfg = { enabled: true, baseUrl: '/api/v1' };
function mk(handler, readCookie) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  const client = createCookieAuthClient(cfg, fetchImpl);
  return { client, calls, session: createCookieSession(client, { readCookie: readCookie || (() => '') }) };
}
const okHandler = (url, init) => {
  if (url.endsWith('/auth/login')) return resp(200, { data: { me: ME, csrfToken: CSRF } });
  if (url.endsWith('/auth/me')) return resp(200, { data: { me: ME, csrfToken: null } });
  if (url.endsWith('/auth/logout')) return resp(200, { data: { ok: true } });
  return resp(404, {});
};

test('cấu hình: bật khi VITE_CRM_AUTH_ENABLED=true; base mặc định /api/v1 (cùng origin); từ chối base rác/javascript:', () => {
  assert.equal(readCookieAuthConfig({}).enabled, false);
  assert.deepEqual(readCookieAuthConfig({ VITE_CRM_AUTH_ENABLED: 'true' }), { enabled: true, baseUrl: '/api/v1' });
  assert.deepEqual(readCookieAuthConfig({ VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: 'http://127.0.0.1:3000/api/v1/' }), { enabled: true, baseUrl: 'http://127.0.0.1:3000/api/v1' });
  for (const bad of ['javascript:alert(1)', '//evil', 'ftp://x', 'rac']) assert.equal(readCookieAuthConfig({ VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: bad }).enabled, false, bad);
});

test('đọc cookie siscom_csrf: đúng định dạng; trùng/thiếu/sai => null', () => {
  assert.equal(readCsrfCookie(`a=1; ${CSRF_COOKIE_NAME}=${CSRF}; b=2`), CSRF);
  assert.equal(readCsrfCookie(`${CSRF_COOKIE_NAME}=abc`), null);
  assert.equal(readCsrfCookie(`${CSRF_COOKIE_NAME}=${CSRF}; ${CSRF_COOKIE_NAME}=${CSRF}`), null);
  assert.equal(readCsrfCookie(''), null);
  assert.equal(readCsrfCookie(undefined), null);
});

test('client: mọi yêu cầu credentials:include; login trả me + csrfToken; logout gửi X-CSRF-Token; không Bearer', async () => {
  const { client, calls } = mk(okHandler);
  const r = await client.login('a@b.vn', 'pw-x');
  assert.deepEqual(r, { me: ME, csrfToken: CSRF });
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  await client.logout(CSRF);
  assert.equal(calls[1].init.headers['X-CSRF-Token'], CSRF);
  await assert.rejects(() => client.logout(''), (e) => e.code === 'CSRF_FAILED');
  assert.equal(calls.length, 2); // thiếu CSRF không gọi mạng
});

test('client: phản hồi thiếu me/csrfToken sai dạng => BAD_RESPONSE; 401 LOGIN_INVALID giữ mã', async () => {
  const bad = mk(() => resp(200, { data: { me: { employeeId: 'x' }, csrfToken: 'short' } }));
  await assert.rejects(() => bad.client.login('a@b.vn', 'pw'), (e) => e.code === 'BAD_RESPONSE');
  const inv = mk(() => resp(401, { error: { code: 'LOGIN_INVALID' } }));
  await assert.rejects(() => inv.client.login('a@b.vn', 'pw'), (e) => e.status === 401 && e.code === 'LOGIN_INVALID');
});

test('session: submit đúng => AUTHENTICATED với me từ server; CSRF chỉ trong bộ nhớ (không nằm trong state)', async () => {
  const { session } = mk(okHandler);
  assert.equal(session.getState().status, 'IDLE');
  const seen = []; session.subscribe((s) => seen.push(s.status));
  await session.submit('NV-0003', 'pw-x');
  assert.deepEqual(seen, ['LOADING', 'AUTHENTICATED']);
  assert.equal(session.getState().me.code, 'NV-0003');
  assert.equal(session.getCsrfToken(), CSRF);
  assert.equal(JSON.stringify(session.getState()).includes(CSRF), false);
  assert.equal(session.getAuthHeader(), null);
});

test('session: sai mật khẩu => ERROR INVALID_CREDENTIALS; sai định dạng => không gọi mạng', async () => {
  const { session, calls } = mk(() => resp(401, { error: { code: 'LOGIN_INVALID' } }));
  await session.submit('a@b.vn', 'sai');
  assert.equal(session.getState().error, 'INVALID_CREDENTIALS');
  assert.equal(session.getCsrfToken(), null);
  await session.submit('khong hop le', 'x');
  assert.equal(session.getState().error, 'IDENTIFIER_INVALID');
  assert.equal(calls.length, 1);
});

test('session: restore() khi tải lại trang — /auth/me 200 => AUTHENTICATED, CSRF đọc từ cookie siscom_csrf; 401 => IDLE', async () => {
  const ok = mk(okHandler, () => `${CSRF_COOKIE_NAME}=${CSRF}`);
  await ok.session.restore();
  assert.equal(ok.session.getState().status, 'AUTHENTICATED');
  assert.equal(ok.session.getCsrfToken(), CSRF);
  const gone = mk(() => resp(401, { error: { code: 'UNAUTHENTICATED' } }));
  await gone.session.restore();
  assert.equal(gone.session.getState().status, 'IDLE');
});

test('session: logout gửi CSRF rồi về IDLE; handleUnauthorized khi đang AUTHENTICATED => SESSION_EXPIRED, CSRF bị bỏ', async () => {
  const { session, calls } = mk(okHandler);
  await session.submit('a@b.vn', 'pw');
  await session.logout();
  assert.equal(session.getState().status, 'IDLE');
  assert.equal(calls[1].init.headers['X-CSRF-Token'], CSRF);
  await session.submit('a@b.vn', 'pw');
  session.handleUnauthorized();
  assert.equal(session.getState().error, 'SESSION_EXPIRED');
  assert.equal(session.getCsrfToken(), null);
});

test('session: cờ tắt => UNAVAILABLE, submit/restore không gọi mạng', async () => {
  const calls = [];
  const client = createCookieAuthClient({ enabled: false, baseUrl: '' }, async () => { calls.push(1); return resp(200, {}); });
  const session = createCookieSession(client, { readCookie: () => '' });
  assert.equal(session.getState().status, 'UNAVAILABLE');
  await session.submit('a@b.vn', 'pw'); await session.restore();
  assert.equal(calls.length, 0);
});

test('session: đua — logout trong lúc submit đang chờ: kết quả login cũ bị bỏ', async () => {
  let resolveLogin;
  const { session } = mk((url) => (url.endsWith('/auth/login') ? new Promise((r) => { resolveLogin = () => r(resp(200, { data: { me: ME, csrfToken: CSRF } })); }) : okHandler(url)));
  const p = session.submit('a@b.vn', 'pw');
  await session.logout();
  resolveLogin();
  await p;
  assert.equal(session.getState().status, 'IDLE');
  assert.equal(session.getCsrfToken(), null);
});
