// Run: node --test tests/   — B1.4 Remember Me (Issue #177) phía FE: fetch giả, không mạng, không storage, không bí mật thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCookieAuthClient } from '../src/auth/cookieAuthClient.js';
import { createCookieSession } from '../src/auth/cookieSession.js';
import { submitLogin, LOGIN_UI_TEXT } from '../src/auth/loginScreenModel.js';

const CSRF = 'c'.repeat(43);
const CSRF2 = 'd'.repeat(43);
const ME = { employeeId: '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f', code: 'NV-0003', fullName: 'Sale A', departmentId: null, roles: ['sales'], permissions: { 'customer.read': 'OWN' }, mustChangePassword: false };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cfg = { enabled: true, baseUrl: '/api/v1' };
function mk(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  const client = createCookieAuthClient(cfg, fetchImpl);
  return { client, calls, session: createCookieSession(client, { readCookie: () => '' }) };
}
const err = (status, code) => resp(status, { error: { code, message: 'x' } });

test('login: chỉ gửi remember:true khi tích; không tích => body đúng {login,password} như cũ (backend cũ vẫn chạy)', async () => {
  const { client, calls } = mk(() => resp(200, { data: { me: ME, csrfToken: CSRF } }));
  await client.login('a@b.vn', 'pw-gia-lap');
  await client.login('a@b.vn', 'pw-gia-lap', false);
  await client.login('a@b.vn', 'pw-gia-lap', 'true');
  await client.login('a@b.vn', 'pw-gia-lap', true);
  const bodies = calls.map((c) => JSON.parse(c.init.body));
  assert.deepEqual(bodies.slice(0, 3).map((b) => Object.keys(b).sort()), [['login', 'password'], ['login', 'password'], ['login', 'password']]);
  assert.deepEqual(bodies[3], { login: 'a@b.vn', password: 'pw-gia-lap', remember: true });
});

test('restoreRemembered: POST /auth/remember/restore, credentials:include, header X-Remember-Restore: 1, không body, không CSRF', async () => {
  const { client, calls } = mk(() => resp(200, { data: { me: ME, csrfToken: CSRF } }));
  const r = await client.restoreRemembered();
  assert.deepEqual(r, { me: ME, csrfToken: CSRF });
  const c = calls[0];
  assert.equal(c.url, '/api/v1/auth/remember/restore');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.credentials, 'include');
  assert.equal(c.init.headers['X-Remember-Restore'], '1');
  assert.equal(c.init.body, undefined);
  assert.equal(c.init.headers['X-CSRF-Token'], undefined);
});

test('session.restore: /auth/me 401 => thử restore MỘT lần; thành công => AUTHENTICATED, CSRF mới trong bộ nhớ', async () => {
  const { session, calls } = mk((url) => {
    if (url.endsWith('/auth/me')) return err(401, 'UNAUTHENTICATED');
    if (url.endsWith('/auth/remember/restore')) return resp(200, { data: { me: ME, csrfToken: CSRF2 } });
    return resp(404, {});
  });
  await session.restore();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getState().me.code, 'NV-0003');
  assert.equal(session.getCsrfToken(), CSRF2);
  assert.deepEqual(calls.map((c) => c.url.replace('/api/v1', '')), ['/auth/me', '/auth/remember/restore']);
});

test('session.restore: phiên còn hiệu lực => KHÔNG gọi restore', async () => {
  const { session, calls } = mk(() => resp(200, { data: { me: ME, csrfToken: null } }));
  await session.restore();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(calls.length, 1);
});

test('session.restore: restore 401 REMEMBER_INVALID / 403 / 429 / mạng => IDLE (đăng nhập bằng mật khẩu), không lặp', async () => {
  for (const r of [err(401, 'REMEMBER_INVALID'), err(403, 'CSRF_FAILED'), err(429, 'REMEMBER_THROTTLED'), null]) {
    const { session, calls } = mk((url) => {
      if (url.endsWith('/auth/me')) return err(401, 'UNAUTHENTICATED');
      if (r === null) throw new Error('mạng');
      return r;
    });
    await session.restore();
    assert.equal(session.getState().status, 'IDLE');
    assert.equal(calls.length, 2);
  }
});

test('session.restore: REMEMBER_RACE (tab khác vừa xoay vòng) => hỏi lại /auth/me một lần', async () => {
  let meCalls = 0;
  const { session, calls } = mk((url) => {
    if (url.endsWith('/auth/me')) { meCalls++; return meCalls === 1 ? err(401, 'UNAUTHENTICATED') : resp(200, { data: { me: ME, csrfToken: null } }); }
    return err(401, 'REMEMBER_RACE');
  });
  await session.restore();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(calls.length, 3);
});

test('session.restore: /auth/me lỗi mạng hoặc 500 => KHÔNG thử restore (chỉ 401 mới thử)', async () => {
  const { session, calls } = mk(() => err(500, 'INTERNAL'));
  await session.restore();
  assert.equal(session.getState().status, 'IDLE');
  assert.equal(calls.length, 1);
});

test('submit/submitLogin chuyển cờ ghi nhớ: chỉ đúng true; mặc định false', async () => {
  const { session, calls } = mk(() => resp(200, { data: { me: ME, csrfToken: CSRF } }));
  await submitLogin(session, 'a@b.vn', 'pw-gia-lap');
  await session.logout();
  await submitLogin(session, 'a@b.vn', 'pw-gia-lap', true);
  const logins = calls.filter((c) => c.url.endsWith('/auth/login')).map((c) => JSON.parse(c.init.body));
  assert.equal(logins[0].remember, undefined);
  assert.equal(logins[1].remember, true);
});

test('màn hình đăng nhập: ô ghi nhớ mặc định KHÔNG tích, có nhãn + gợi ý; JS không đọc cookie siscom_rmb/không ghi storage', () => {
  const jsx = readFileSync(new URL('../src/features/auth/LoginScreen.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /React\.useState\(false\); \/\/ B1\.4 Remember Me: mặc định KHÔNG tích/);
  assert.match(jsx, /type="checkbox" checked=\{remember\}/);
  assert.ok(LOGIN_UI_TEXT.rememberLabel.includes('90 ngày'));
  for (const f of ['../src/auth/cookieAuthClient.js', '../src/auth/cookieSession.js', '../src/features/auth/LoginScreen.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /siscom_rmb/, f);
    assert.doesNotMatch(src, /localStorage|sessionStorage/, f);
  }
});
