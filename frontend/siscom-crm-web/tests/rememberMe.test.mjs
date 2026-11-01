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
function mk(handler, opts = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  const client = createCookieAuthClient(cfg, fetchImpl);
  return { client, calls, session: createCookieSession(client, { readCookie: () => '', raceDelayMs: 0, ...opts }) };
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

// QA lần 3 Minor-2: tab thua RACE hỏi /auth/me quá sớm (tab thắng chưa kịp nhận Set-Cookie) => chờ ngắn trước khi hỏi lại.
test('RACE khi tải trang: chờ raceDelayMs trước khi hỏi lại /auth/me', async () => {
  let t0 = 0; let meAt = 0; let meCalls = 0;
  const { session } = mk((url) => {
    if (url.endsWith('/auth/me')) { meCalls++; if (meCalls === 1) return err(401, 'UNAUTHENTICATED'); meAt = Date.now(); return resp(200, { data: { me: ME, csrfToken: null } }); }
    t0 = Date.now(); return err(401, 'REMEMBER_RACE');
  }, { raceDelayMs: 120 });
  await session.restore();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.ok(meAt - t0 >= 100, 'phải chờ trước khi hỏi lại /auth/me');
});

// QA lần 3 Minor-3: request gửi bằng cookie CŨ trả 401 SAU khi tự khôi phục thành công => không được đưa UI về "hết hạn" khi phiên mới vẫn tốt.
test('401 muộn ngay sau khi vừa khôi phục: hỏi /auth/me; phiên mới còn tốt => giữ AUTHENTICATED', async () => {
  const { session } = await authedSession(resp(200, { data: { me: ME, csrfToken: CSRF2 } }));
  session.handleUnauthorized();
  await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  session.handleUnauthorized(); // 401 muộn của request cũ
  await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getCsrfToken(), CSRF2);
});
test('401 muộn sau khôi phục mà /auth/me cũng 401 => SESSION_EXPIRED thật', async () => {
  let restored = false;
  const env = mk((url) => {
    if (url.endsWith('/auth/login')) return resp(200, { data: { me: ME, csrfToken: CSRF } });
    if (url.endsWith('/auth/remember/restore')) { restored = true; return resp(200, { data: { me: ME, csrfToken: CSRF2 } }); }
    if (url.endsWith('/auth/me')) return restored ? err(401, 'UNAUTHENTICATED') : resp(200, { data: { me: ME, csrfToken: null } });
    return resp(404, {});
  });
  await env.session.submit('a@b.vn', 'pw-gia-lap', true);
  env.session.handleUnauthorized();
  await tick(); await tick(); await tick();
  assert.equal(env.session.getState().status, 'AUTHENTICATED');
  env.session.handleUnauthorized();
  await tick(); await tick(); await tick();
  assert.equal(env.session.getState().error, 'SESSION_EXPIRED');
});

// QA lần 3b Minor-A: NHIỀU request cũ cùng trả 401 muộn sau khi tự khôi phục => gộp vào MỘT lần kiểm /auth/me, không về "hết hạn".
test('hai 401 muộn liên tiếp sau khi vừa khôi phục: một lần kiểm /auth/me, vẫn AUTHENTICATED', async () => {
  const { session, calls } = await authedSession(resp(200, { data: { me: ME, csrfToken: CSRF2 } }));
  session.handleUnauthorized();
  await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  const before = calls.filter((c) => c.url.endsWith('/auth/me')).length;
  session.handleUnauthorized();
  session.handleUnauthorized();
  await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  assert.equal(session.getCsrfToken(), CSRF2);
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/me')).length - before, 1);
});

// QA lần 3c Minor-3: đăng xuất / đăng nhập lại xoá trạng thái "vừa khôi phục" => 401 thật sau đó báo hết hạn NGAY (không kiểm /auth/me thêm).
test('sau khi tự khôi phục rồi đăng xuất + đăng nhập lại: 401 kế tiếp => SESSION_EXPIRED ngay', async () => {
  const { session, calls } = await authedSession(resp(200, { data: { me: ME, csrfToken: CSRF2 } }));
  session.handleUnauthorized();
  await tick(); await tick(); await tick();
  assert.equal(session.getState().status, 'AUTHENTICATED');
  await session.logout();
  await session.submit('a@b.vn', 'pw-gia-lap', false);
  const meBefore = calls.filter((c) => c.url.endsWith('/auth/me')).length;
  session.handleUnauthorized();
  assert.equal(session.getState().error, 'SESSION_EXPIRED');
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/me')).length, meBefore);
});
// QA lần 3c Minor-3: lần kiểm /auth/me của 401 muộn bị treo => hết thời gian chờ thì không còn gộp mãi (401 sau đó được xử lý).
test('kiểm /auth/me treo quá thời gian chờ => giải phóng, 401 sau đó lại được kiểm', async () => {
  let meCalls = 0;
  const env = mk((url) => {
    if (url.endsWith('/auth/login')) return resp(200, { data: { me: ME, csrfToken: CSRF } });
    if (url.endsWith('/auth/remember/restore')) return resp(200, { data: { me: ME, csrfToken: CSRF2 } });
    if (url.endsWith('/auth/me')) { meCalls++; return new Promise(() => {}); } // treo
    return resp(404, {});
  }, { lateCheckTimeoutMs: 20 });
  await env.session.submit('a@b.vn', 'pw-gia-lap', true);
  env.session.handleUnauthorized();
  await tick(); await tick(); await tick();
  env.session.handleUnauthorized();
  await new Promise((r) => setTimeout(r, 40));
  env.session.handleUnauthorized();
  await tick();
  assert.equal(meCalls, 2);
});
