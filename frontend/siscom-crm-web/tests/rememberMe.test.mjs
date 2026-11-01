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

// Phiên hết hạn GIỮA CHỪNG (tab đang mở): API khác trả 401 => handleUnauthorized => thử restore MỘT lần (tối đa 1 lần / 60 giây).
const tick = () => new Promise((r) => setTimeout(r, 0));
async function authedSession(restoreResp) {
  const env = mk((url) => {
    if (url.endsWith('/auth/login')) return resp(200, { data: { me: ME, csrfToken: CSRF } });
    if (url.endsWith('/auth/logout')) return resp(200, { data: { ok: true } });
    if (url.endsWith('/auth/remember/restore')) return typeof restoreResp === 'function' ? restoreResp() : restoreResp;
    return resp(404, {});
  });
  await env.session.submit('a@b.vn', 'pw-gia-lap', true);
  assert.equal(env.session.getState().status, 'AUTHENTICATED');
  return env;
}
const restoreCalls = (calls) => calls.filter((c) => c.url.endsWith('/auth/remember/restore')).length;

test('giữa chừng: 401 => SESSION_EXPIRED rồi tự khôi phục từ cookie ghi nhớ => AUTHENTICATED, CSRF mới', async () => {
  const { session, calls } = await authedSession(resp(200, { data: { me: ME, csrfToken: CSRF2 } }));
  session.handleUnauthorized();
  assert.equal(session.getState().error, 'SESSION_EXPIRED');
  await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getCsrfToken(), CSRF2);
  assert.equal(restoreCalls(calls), 1);
});

test('giữa chừng: restore thất bại => giữ SESSION_EXPIRED; 401 lần hai trong 60 giây KHÔNG gọi restore nữa', async () => {
  const { session, calls } = await authedSession(err(401, 'REMEMBER_INVALID'));
  session.handleUnauthorized();
  await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'ERROR');
  assert.equal(session.getState().error, 'SESSION_EXPIRED');
  await session.submit('a@b.vn', 'pw-gia-lap', false);
  session.handleUnauthorized();
  await tick(); await tick();
  assert.equal(restoreCalls(calls), 1);
});

test('giữa chừng: người dùng đăng xuất/đăng nhập lại trước khi restore trả về => bỏ kết quả restore', async () => {
  let release; const pending = new Promise((r) => { release = r; });
  const { session } = await authedSession(() => pending.then(() => resp(200, { data: { me: { ...ME, code: 'NV-9999' }, csrfToken: CSRF2 } })));
  session.handleUnauthorized();
  await session.logout();
  release(); await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'IDLE');
});

// QA lần 2 Important-1: nhiều request cùng nhận 401 (danh sách + tìm kiếm) => handleUnauthorized gọi nhiều lần; lần sau KHÔNG được huỷ kết quả restore.
test('giữa chừng: hai 401 song song => vẫn khôi phục được (lần 401 thứ hai không huỷ restore đang chạy), chỉ một lần restore', async () => {
  let release; const pending = new Promise((r) => { release = r; });
  const { session, calls } = await authedSession(() => pending.then(() => resp(200, { data: { me: ME, csrfToken: CSRF2 } })));
  session.handleUnauthorized();
  session.handleUnauthorized();
  release(); await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getCsrfToken(), CSRF2);
  assert.equal(restoreCalls(calls), 1);
});

// QA lần 2 Minor-6: auto-restore gặp REMEMBER_RACE (tab khác vừa khôi phục) => hỏi lại /auth/me một lần.
test('giữa chừng: restore REMEMBER_RACE => hỏi lại /auth/me; phiên tab khác còn => AUTHENTICATED', async () => {
  const env = mk((url) => {
    if (url.endsWith('/auth/login')) return resp(200, { data: { me: ME, csrfToken: CSRF } });
    if (url.endsWith('/auth/remember/restore')) return err(401, 'REMEMBER_RACE');
    if (url.endsWith('/auth/me')) return resp(200, { data: { me: ME, csrfToken: null } });
    return resp(404, {});
  });
  await env.session.submit('a@b.vn', 'pw-gia-lap', true);
  env.session.handleUnauthorized();
  await tick(); await tick(); await tick(); await tick();
  assert.equal(env.session.getState().status, 'AUTHENTICATED');
});
