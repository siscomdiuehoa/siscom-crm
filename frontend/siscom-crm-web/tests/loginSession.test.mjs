// Run: node --test tests/   (Node >= 18, không phụ thuộc). fetch giả lập; không mạng, không DB, không bí mật thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLoginIdentifier, validatePassword } from '../src/auth/loginIdentifier.js';
import { readAuthConfig, createAuthClient, AuthUnavailableError } from '../src/auth/authClient.js';
import { createLoginSession } from '../src/auth/loginSession.js';

const TOKEN = 'sid_' + 'A'.repeat(43);
const PW = 'pw-gia-lap-cho-test';
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cfg = { enabled: true, baseUrl: 'http://api.test' };
function mk(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  const client = createAuthClient(cfg, fetchImpl);
  return { client, calls, session: createLoginSession(client) };
}
const okHandler = (url, init) => {
  if (url.endsWith('/auth/login')) return resp(200, { token: TOKEN, expiresAt: '2026-10-24T00:00:00.000Z' });
  if (url.endsWith('/auth/me')) return resp(200, { employeeId: 7 });
  if (url.endsWith('/auth/logout')) return resp(200, { ok: true });
};

test('identifier: email hoặc mã NV; từ chối dạng sai', () => {
  assert.deepEqual(parseLoginIdentifier('  a@b.vn '), { kind: 'EMAIL', value: 'a@b.vn' });
  assert.deepEqual(parseLoginIdentifier('NV-0001'), { kind: 'EMPLOYEE_CODE', value: 'NV-0001' });
  for (const bad of ['', 'nv-0001', 'NV-1', 'a@@b', '@b', 'a@', 'a b@c.vn', 'a​@b.vn', 5, null, 'x'.repeat(300)])
    assert.equal(parseLoginIdentifier(bad).kind, 'INVALID', String(bad));
});

test('password: bắt buộc, không trim, giới hạn độ dài', () => {
  assert.equal(validatePassword(''), 'PASSWORD_REQUIRED');
  assert.equal(validatePassword(undefined), 'PASSWORD_REQUIRED');
  assert.equal(validatePassword('  '), null);
  assert.equal(validatePassword('x'.repeat(1025)), 'PASSWORD_TOO_LONG');
});

test('mặc định TẮT: cấu hình thiếu cờ/base => UNAVAILABLE, không gọi fetch, không đăng nhập giả', async () => {
  assert.equal(readAuthConfig({}).enabled, false);
  assert.equal(readAuthConfig({ VITE_CRM_AUTH_ENABLED: 'true' }).enabled, false);
  assert.equal(readAuthConfig({ VITE_CRM_API_BASE: 'http://x' }).enabled, false);
  assert.equal(readAuthConfig({ VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: 'http://x/' }).baseUrl, 'http://x');
  let called = 0;
  const client = createAuthClient(readAuthConfig({}), async () => { called++; return resp(200, {}); });
  await assert.rejects(client.login('a@b.vn', PW), AuthUnavailableError);
  const s = createLoginSession(client);
  assert.equal(s.getState().status, 'UNAVAILABLE');
  assert.equal((await s.submit('a@b.vn', PW)).status, 'UNAVAILABLE');
  assert.equal(s.getAuthHeader(), null);
  assert.equal(called, 0);
});

test('đăng nhập thành công: LOADING -> AUTHENTICATED, employeeId từ /me, state không chứa token/mật khẩu', async () => {
  const { session, calls } = mk(okHandler);
  const seen = [];
  session.subscribe((s) => seen.push(s.status));
  const st = await session.submit(' NV-0001 ', PW);
  assert.deepEqual(seen, ['LOADING', 'AUTHENTICATED']);
  assert.equal(st.employeeId, 7);
  assert.equal(JSON.stringify(st).includes(TOKEN), false);
  assert.equal(JSON.stringify(st).includes(PW), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), { login: 'NV-0001', password: PW });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(session.getAuthHeader(), 'Bearer ' + TOKEN);
  assert.equal(st.role, undefined);
});

test('không ghi localStorage/sessionStorage/cookie', async () => {
  const writes = [];
  const store = { setItem: (...a) => writes.push(a), getItem: () => null, removeItem: () => {} };
  globalThis.localStorage = store; globalThis.sessionStorage = store;
  try {
    const { session } = mk(okHandler);
    await session.submit('a@b.vn', PW); await session.logout();
  } finally { delete globalThis.localStorage; delete globalThis.sessionStorage; }
  assert.deepEqual(writes, []);
});

test('xác thực phía client chặn trước khi gọi mạng', async () => {
  const { session, calls } = mk(okHandler);
  assert.equal((await session.submit('khong-hop-le', PW)).error, 'IDENTIFIER_INVALID');
  assert.equal((await session.submit('a@b.vn', '')).error, 'PASSWORD_REQUIRED');
  assert.equal(calls.length, 0);
});

test('lỗi: 401 LOGIN_INVALID, 429, 400, 503, mạng', async () => {
  const cases = [
    [() => resp(401, { error: { code: 'LOGIN_INVALID' } }), 'INVALID_CREDENTIALS'],
    [() => resp(429, { error: { code: 'LOGIN_THROTTLED' } }), 'RATE_LIMITED'],
    [() => resp(400, { error: { code: 'REQUEST_INVALID' } }), 'REQUEST_INVALID'],
    [() => resp(503, { error: { code: 'AUTH_UNAVAILABLE' } }), 'SERVICE_UNAVAILABLE'],
    [() => { throw new TypeError('fetch failed'); }, 'NETWORK'],
  ];
  for (const [h, expected] of cases) {
    const { session } = mk(h);
    const st = await session.submit('a@b.vn', PW);
    assert.equal(st.status, 'ERROR'); assert.equal(st.error, expected);
    assert.equal(session.getAuthHeader(), null);
  }
});

test('/me trả 401 sau khi login => không AUTHENTICATED, token bị bỏ', async () => {
  const { session } = mk((url) => (url.endsWith('/auth/login') ? resp(200, { token: TOKEN, expiresAt: 'x' }) : resp(401, { error: { code: 'AUTH_REQUIRED' } })));
  const st = await session.submit('a@b.vn', PW);
  assert.equal(st.status, 'ERROR'); assert.equal(st.error, 'SESSION_EXPIRED');
  assert.equal(session.getAuthHeader(), null);
});

test('phản hồi sai hình dạng => lỗi, không AUTHENTICATED', async () => {
  const { session } = mk(() => resp(200, { token: 5 }));
  assert.equal((await session.submit('a@b.vn', PW)).status, 'ERROR');
});

test('chống gửi trùng khi đang LOADING', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { session, calls } = mk(async (url, init) => { if (url.endsWith('/auth/login')) await gate; return okHandler(url, init); });
  const p1 = session.submit('a@b.vn', PW);
  assert.equal(session.getState().status, 'LOADING');
  await session.submit('a@b.vn', PW);
  release(); await p1;
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 1);
});

test('logout: gọi server với Bearer, xóa token, về IDLE', async () => {
  const { session, calls } = mk(okHandler);
  await session.submit('a@b.vn', PW);
  const st = await session.logout();
  assert.equal(st.status, 'IDLE'); assert.equal(session.getAuthHeader(), null);
  const last = calls[calls.length - 1];
  assert.equal(last.init.method, 'POST'); assert.equal(last.init.headers.Authorization, 'Bearer ' + TOKEN);
});

test('logout lỗi 503: token cục bộ vẫn bị xóa và báo lỗi (không báo thành công giả)', async () => {
  const { session } = mk((url) => (url.endsWith('/auth/logout') ? resp(503, { error: { code: 'AUTH_UNAVAILABLE' } }) : okHandler(url)));
  await session.submit('a@b.vn', PW);
  const st = await session.logout();
  assert.equal(st.status, 'ERROR'); assert.equal(st.error, 'SERVICE_UNAVAILABLE');
  assert.equal(session.getAuthHeader(), null);
});

test('handleUnauthorized: bỏ token, SESSION_EXPIRED, không tự đăng nhập lại', async () => {
  const { session, calls } = mk(okHandler);
  await session.submit('a@b.vn', PW);
  const n = calls.length;
  const st = session.handleUnauthorized();
  assert.equal(st.error, 'SESSION_EXPIRED'); assert.equal(session.getAuthHeader(), null);
  assert.equal(calls.length, n);
});
