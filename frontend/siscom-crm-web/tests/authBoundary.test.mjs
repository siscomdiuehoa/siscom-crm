// Run: node --test tests/   Ranh giới yêu cầu xác thực, fail-closed. fetch giả lập; không mạng, không DB, không bí mật thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthConfig, createAuthClient, AuthUnavailableError, AuthHttpError, AuthNetworkError } from '../src/auth/authClient.js';
import { createLoginSession, classifyAuthError, LOGIN_ERRORS } from '../src/auth/loginSession.js';

const TOKEN = 'sid_' + 'A'.repeat(43);
const PW = 'pw-gia-lap-cho-test';
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cfg = { enabled: true, baseUrl: 'http://api.test' };
function mk(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  const client = createAuthClient(cfg, fetchImpl);
  return { client, calls, session: createLoginSession(client) };
}
const okHandler = (url) => {
  if (url.endsWith('/auth/login')) return resp(200, { token: TOKEN, expiresAt: '2026-10-24T00:00:00.000Z' });
  if (url.endsWith('/auth/me')) return resp(200, { employeeId: 7 });
  if (url.endsWith('/auth/logout')) return resp(200, { ok: true });
};

test('cổng cờ: base URL không phải http(s) tuyệt đối => TẮT; cờ khác "true" => TẮT', () => {
  const on = (b) => readAuthConfig({ VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: b }).enabled;
  for (const bad of ['/api', 'api.test', 'javascript:alert(1)', 'ftp://x', 'data:text/plain,x', '   ', ''])
    assert.equal(on(bad), false, bad);
  assert.equal(on('https://api.test'), true);
  for (const flag of ['TRUE', '1', 'yes', true, undefined, ' true'])
    assert.equal(readAuthConfig({ VITE_CRM_AUTH_ENABLED: flag, VITE_CRM_API_BASE: 'http://x' }).enabled, false, String(flag));
  assert.equal(readAuthConfig(null).enabled, false);
});

test('client tắt: login/me/logout đều ném AuthUnavailableError, không gọi fetch', async () => {
  let called = 0;
  const client = createAuthClient({ enabled: false, baseUrl: 'http://x' }, async () => { called++; return resp(200, {}); });
  await assert.rejects(client.login('a@b.vn', PW), AuthUnavailableError);
  await assert.rejects(client.me(TOKEN), AuthUnavailableError);
  await assert.rejects(client.logout(TOKEN), AuthUnavailableError);
  assert.equal(createAuthClient(undefined, async () => { called++; }).enabled, false);
  assert.equal(called, 0);
});

test('hình dạng yêu cầu: đường dẫn, phương thức, header, body, credentials omit, bí mật không nằm trong URL', async () => {
  const { client, calls } = mk(okHandler);
  await client.login('a@b.vn', PW);
  await client.me(TOKEN);
  await client.logout(TOKEN);
  const [l, m, o] = calls;
  assert.equal(l.url, 'http://api.test/auth/login'); assert.equal(l.init.method, 'POST');
  assert.deepEqual(JSON.parse(l.init.body), { login: 'a@b.vn', password: PW });
  assert.equal(l.init.headers.Authorization, undefined);
  assert.equal(m.url, 'http://api.test/auth/me'); assert.equal(m.init.method, 'GET'); assert.equal(m.init.body, undefined);
  assert.equal(m.init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(o.url, 'http://api.test/auth/logout'); assert.equal(o.init.method, 'POST');
  assert.equal(o.init.headers.Authorization, 'Bearer ' + TOKEN);
  for (const c of calls) {
    assert.equal(c.init.credentials, 'omit');
    assert.ok(!c.url.includes(PW) && !c.url.includes(TOKEN));
    assert.ok(!JSON.stringify(c.init.headers).includes(PW));
  }
});

test('thiếu đầu vào/token: chặn tại client, không gọi mạng', async () => {
  const { client, calls } = mk(okHandler);
  for (const [l, p] of [['', PW], ['a@b.vn', ''], [null, PW], ['a@b.vn', 5]])
    await assert.rejects(client.login(l, p), (e) => e instanceof AuthHttpError && e.status === 400);
  for (const t of ['', null, undefined, 42]) {
    await assert.rejects(client.me(t), (e) => e instanceof AuthHttpError && e.status === 401);
    await assert.rejects(client.logout(t), (e) => e instanceof AuthHttpError && e.status === 401);
  }
  assert.equal(calls.length, 0);
});

test('phân biệt: route chưa có (404/405/501) / cờ tắt ≠ sai mật khẩu ≠ 429 ≠ mạng ≠ 503', async () => {
  for (const st of [404, 405, 501]) {
    const { session } = mk(() => resp(st, { error: { code: 'NOT_FOUND' } }));
    const s = await session.submit('a@b.vn', PW);
    assert.equal(s.error, 'ENDPOINT_UNAVAILABLE', String(st));
  }
  const { session: html } = mk(() => ({ ok: false, status: 404, json: async () => { throw new Error('html'); } }));
  assert.equal((await html.submit('a@b.vn', PW)).error, 'ENDPOINT_UNAVAILABLE');
  const kinds = [
    classifyAuthError(new AuthUnavailableError()),
    classifyAuthError(new AuthHttpError(404, 'X')),
    classifyAuthError(new AuthHttpError(401, 'LOGIN_INVALID')),
    classifyAuthError(new AuthHttpError(429, 'LOGIN_THROTTLED')),
    classifyAuthError(new AuthNetworkError()),
    classifyAuthError(new AuthHttpError(503, 'AUTH_UNAVAILABLE')),
  ];
  assert.deepEqual(kinds, ['ENDPOINT_UNAVAILABLE', 'ENDPOINT_UNAVAILABLE', 'INVALID_CREDENTIALS', 'RATE_LIMITED', 'NETWORK', 'SERVICE_UNAVAILABLE']);
  for (const k of kinds) assert.ok(LOGIN_ERRORS[k], 'có thông điệp cho ' + k);
});

test('không rò thông tin: thân lỗi của server không vào state; thông điệp chung', async () => {
  const { session } = mk(() => resp(401, { error: { code: 'LOGIN_INVALID', message: 'user not found ' + PW } }));
  const s = await session.submit('a@b.vn', PW);
  assert.equal(s.error, 'INVALID_CREDENTIALS');
  assert.ok(!JSON.stringify(s).includes(PW));
  assert.equal(LOGIN_ERRORS[s.error], 'Thông tin đăng nhập không đúng.');
});

test('200 nhưng thân hỏng/thiếu trường => không AUTHENTICATED, không giữ token', async () => {
  const bad = [
    () => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } }),
    () => resp(200, { token: '', expiresAt: 'x' }),
    () => resp(200, 'chuoi'),
  ];
  for (const h of bad) {
    const { session } = mk(h);
    const s = await session.submit('a@b.vn', PW);
    assert.equal(s.status, 'ERROR');
    assert.equal(session.getAuthHeader(), null);
  }
});
