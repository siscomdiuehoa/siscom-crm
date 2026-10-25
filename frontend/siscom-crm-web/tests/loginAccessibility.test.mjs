// Run: node --test tests/loginAccessibility.test.mjs   (Node >= 18; phần render cần `vite` đã cài sẵn, nếu không sẽ bỏ qua có ghi rõ).
// Trợ năng + kiểm tra hình dạng + trạng thái lỗi 401/429/mạng/không khả dụng của màn hình đăng nhập.
// fetch và bộ điều khiển đều GIẢ LẬP; không mạng, không DB, không bí mật thật; mật khẩu trong test là chuỗi giả.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveLoginView, submitLogin, createLoginSubmitter, focusTargetAfterSubmit, describeIdentifierProblem,
  IDENTIFIER_ERRORS, LOGIN_UI_TEXT,
} from '../src/auth/loginScreenModel.js';
import { createLoginSession, LOGIN_ERRORS } from '../src/auth/loginSession.js';
import { createAuthClient, readAuthConfig } from '../src/auth/authClient.js';
import { LOGIN_PREVIEW_ERROR, LOGIN_PREVIEW_UNAVAILABLE_TEXT } from '../src/auth/loginPreview.js';

const PW = 'pw-gia-lap-cho-test';
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cfg = { enabled: true, baseUrl: 'http://api.test' };
function realSession(handler) {
  const calls = [];
  const client = createAuthClient(cfg, async (url, init) => { calls.push(url); return handler(url, init); });
  return { calls, session: createLoginSession(client) };
}

test('kiểm tra email/mã NV: thông báo tiếng Việt theo từng trường hợp, đúng với quy tắc loginIdentifier (không thêm quy tắc mới)', () => {
  assert.equal(describeIdentifierProblem('a@b.vn'), null);
  assert.equal(describeIdentifierProblem('  NV-0001 '), null);
  assert.equal(describeIdentifierProblem(''), IDENTIFIER_ERRORS.REQUIRED);
  assert.equal(describeIdentifierProblem('   '), IDENTIFIER_ERRORS.REQUIRED);
  assert.equal(describeIdentifierProblem(undefined), IDENTIFIER_ERRORS.REQUIRED);
  assert.equal(describeIdentifierProblem('x'.repeat(300)), IDENTIFIER_ERRORS.TOO_LONG);
  assert.equal(describeIdentifierProblem('a b@c.vn'), IDENTIFIER_ERRORS.HAS_SPACE);
  for (const bad of ['a@', '@b.vn', 'a@@b.vn']) assert.equal(describeIdentifierProblem(bad), IDENTIFIER_ERRORS.EMAIL_FORMAT, bad);
  for (const bad of ['nv-0001', 'NV-1', 'NV-12', 'abc', 'NV0001']) assert.equal(describeIdentifierProblem(bad), IDENTIFIER_ERRORS.EMPLOYEE_CODE_FORMAT, bad);
  assert.match(IDENTIFIER_ERRORS.EMPLOYEE_CODE_FORMAT, /NV-0001/);
});

test('lỗi trường chỉ hiện sau khi chạm/gửi; firstInvalid chọn danh tính trước mật khẩu', () => {
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: 'abc', password: '', touched: {} }).identifierError, null);
  const v = deriveLoginView({ status: 'IDLE', identifier: 'abc', password: '', touched: { identifier: true, password: true } });
  assert.equal(v.identifierError, IDENTIFIER_ERRORS.EMPLOYEE_CODE_FORMAT);
  assert.equal(v.passwordError, LOGIN_ERRORS.PASSWORD_REQUIRED);
  assert.equal(v.firstInvalid, 'identifier');
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: 'a@b.vn', password: '' }).firstInvalid, 'password');
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: 'a@b.vn', password: PW }).firstInvalid, null);
});

test('nút gửi không bị vô hiệu vì dữ liệu sai (Enter vẫn kiểm tra + báo lỗi), nhưng bị chặn khi LOADING/UNAVAILABLE/AUTHENTICATED', () => {
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: '', password: '' }).submitBlocked, false);
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: '', password: '' }).submitDisabled, true); // nghĩa cũ giữ nguyên
  for (const s of ['LOADING', 'UNAVAILABLE', 'AUTHENTICATED']) assert.equal(deriveLoginView({ status: s, identifier: 'a@b.vn', password: PW }).submitBlocked, true, s);
});

test('Enter/gửi dữ liệu sai: không gọi submit, trả trường lỗi đầu tiên để focus', async () => {
  const calls = [];
  const s = { getState: () => ({ status: 'IDLE' }), submit: async (...a) => { calls.push(a); } };
  const r1 = await submitLogin(s, 'nv-1', PW);
  assert.deepEqual([r1.submitted, r1.firstInvalid, r1.reason], [false, 'identifier', 'INVALID']);
  const r2 = await submitLogin(s, 'a@b.vn', '');
  assert.deepEqual([r2.submitted, r2.firstInvalid], [false, 'password']);
  assert.equal(focusTargetAfterSubmit(r1, s.getState()), 'identifier');
  assert.equal(focusTargetAfterSubmit(r2, s.getState()), 'password');
  assert.equal(calls.length, 0);
});

test('chặn gửi trùng: nhiều Enter liên tiếp trong lúc đang gửi chỉ tạo đúng 1 lần session.submit', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const calls = [];
  // Phiên giả KHÔNG chuyển LOADING (như phiên preview) để chứng minh bộ gửi tự chặn.
  const s = { getState: () => ({ status: 'IDLE' }), submit: async (i, p) => { calls.push([i, p]); await gate; } };
  const submit = createLoginSubmitter(s);
  const first = submit('a@b.vn', PW);
  const dup1 = await submit('a@b.vn', PW);
  const dup2 = await submit('a@b.vn', PW);
  assert.equal(dup1.reason, 'IN_FLIGHT');
  assert.equal(dup2.submitted, false);
  release();
  assert.equal((await first).submitted, true);
  assert.deepEqual(calls, [['a@b.vn', PW]]);
  const again = await submit('a@b.vn', PW); // sau khi xong thì gửi lại được
  assert.equal(again.submitted, true);
  assert.equal(calls.length, 2);
});

test('bộ gửi vẫn nhả khóa khi submit ném lỗi (không kẹt)', async () => {
  let n = 0;
  const s = { getState: () => ({ status: 'IDLE' }), submit: async () => { n++; if (n === 1) throw new Error('boom'); } };
  const submit = createLoginSubmitter(s);
  await assert.rejects(() => submit('a@b.vn', PW));
  assert.equal((await submit('a@b.vn', PW)).submitted, true);
});

test('focus sau gửi: lỗi từ máy chủ => ô mật khẩu; thành công/không lỗi => không ép focus', () => {
  assert.equal(focusTargetAfterSubmit({ submitted: true }, { status: 'ERROR' }), 'password');
  assert.equal(focusTargetAfterSubmit({ submitted: true }, { status: 'AUTHENTICATED' }), null);
  assert.equal(focusTargetAfterSubmit({ submitted: false, firstInvalid: null }, { status: 'LOADING' }), null);
});

// ---- Các trạng thái lỗi tường minh: chạy qua bộ điều khiển THẬT + fetch giả ----
const CASES = [
  { name: '401 LOGIN_INVALID', handler: () => resp(401, { error: { code: 'LOGIN_INVALID' } }), error: 'INVALID_CREDENTIALS', kind: 'credentials' },
  { name: '429 LOGIN_THROTTLED', handler: () => resp(429, { error: { code: 'LOGIN_THROTTLED' } }), error: 'RATE_LIMITED', kind: 'rate-limited' },
  { name: 'mạng đứt', handler: () => { throw new TypeError('network down'); }, error: 'NETWORK', kind: 'network' },
  { name: '503 AUTH_UNAVAILABLE', handler: () => resp(503, { error: { code: 'AUTH_UNAVAILABLE' } }), error: 'SERVICE_UNAVAILABLE', kind: 'unavailable' },
  { name: '500', handler: () => resp(500, {}), error: 'SERVICE_UNAVAILABLE', kind: 'unavailable' },
];
for (const c of CASES) {
  test(`trạng thái ${c.name}: banner tiếng Việt đúng loại, ô nhập mở lại, nhập lại được, focus về mật khẩu`, async () => {
    const { session, calls } = realSession(c.handler);
    const submit = createLoginSubmitter(session);
    const r = await submit('NV-0001', PW);
    assert.equal(r.submitted, true);
    const st = session.getState();
    assert.equal(st.status, 'ERROR');
    assert.equal(st.error, c.error);
    assert.doesNotMatch(JSON.stringify(st), new RegExp(PW)); // trạng thái không giữ mật khẩu
    const v = deriveLoginView({ status: st.status, error: st.error, identifier: 'NV-0001', password: '', touched: {} });
    assert.equal(v.bannerError, LOGIN_ERRORS[c.error]);
    assert.ok(v.bannerError && /[À-ỹ]/.test(v.bannerError), 'banner là tiếng Việt có dấu');
    assert.equal(v.bannerKind, c.kind);
    assert.equal(v.inputsDisabled, false);
    assert.equal(v.authenticated, false);
    assert.equal(focusTargetAfterSubmit(r, st), 'password');
    assert.equal(calls.filter((u) => u.endsWith('/auth/me')).length, 0); // không có /me khi login lỗi
    assert.equal(session.getAuthHeader(), null);
  });
}

test('429 không bị gộp với 401: hai thông báo khác nhau', () => {
  assert.notEqual(LOGIN_ERRORS.RATE_LIMITED, LOGIN_ERRORS.INVALID_CREDENTIALS);
  assert.notEqual(LOGIN_ERRORS.NETWORK, LOGIN_ERRORS.SERVICE_UNAVAILABLE);
});

test('không khả dụng (cờ xác thực tắt): UNAVAILABLE, thông báo, ô nhập khóa, không gọi mạng', async () => {
  let fetched = 0;
  const session = createLoginSession(createAuthClient(readAuthConfig({}), async () => { fetched++; }));
  const v = deriveLoginView({ status: session.getState().status, identifier: 'a@b.vn', password: PW });
  assert.equal(v.notice, LOGIN_UI_TEXT.unavailable);
  assert.equal(v.inputsDisabled, true);
  assert.equal(v.submitBlocked, true);
  const r = await createLoginSubmitter(session)('a@b.vn', PW);
  assert.deepEqual([r.submitted, r.reason], [false, 'BLOCKED']);
  assert.equal(fetched, 0);
});

test('preview "máy chủ chưa khả dụng": banner kind=unavailable, nội dung rõ ràng', () => {
  const v = deriveLoginView({ status: 'ERROR', error: LOGIN_PREVIEW_ERROR });
  assert.equal(v.bannerError, LOGIN_PREVIEW_UNAVAILABLE_TEXT);
  assert.equal(v.bannerKind, 'unavailable');
});

test('lỗi trường không bị lặp thành banner (bannerKind null)', () => {
  const v = deriveLoginView({ status: 'ERROR', error: 'PASSWORD_REQUIRED' });
  assert.equal(v.bannerError, null);
  assert.equal(v.bannerKind, null);
});

// ---- Mã nguồn: không log / không analytics / không storage trong luồng đăng nhập UI ----
test('mã nguồn UI đăng nhập không có console/analytics/storage (nút hiện mật khẩu không để lại dấu vết)', () => {
  for (const f of ['../src/features/auth/LoginScreen.jsx', '../src/auth/loginScreenModel.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /console\.|gtag|analytics|dataLayer|localStorage|sessionStorage|document\.cookie|\bfetch\(|sendBeacon/i, f);
  }
});

// ---- Render thật (SSR) qua Vite ssrLoadModule: thuộc tính trợ năng của DOM ----
let vite = null;
try { ({ createServer: vite } = await import('vite')); } catch { vite = null; }

async function withServer(fn) {
  const server = await vite({ configFile: false, root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    const React = (await import('react')).default;
    const { renderToString } = await import('react-dom/server');
    const LoginScreen = (await server.ssrLoadModule('/src/features/auth/LoginScreen.jsx')).default;
    return await fn({ React, renderToString, LoginScreen });
  } finally { await server.close(); }
}
const fakeSession = (state) => ({ getState: () => state, subscribe: () => () => {}, submit: async () => {} });
const attr = (html, name) => { const m = html.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? m[1] : null; };
function tag(html, id) { const m = html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`)); return m ? m[0] : ''; }

test('SSR: form có tên/nhãn, username/current-password, required, nút hiện mật khẩu là button (không submit) + aria-pressed', async (t) => {
  if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
  await withServer(({ React, renderToString, LoginScreen }) => {
    const html = renderToString(React.createElement(LoginScreen, { enabled: true, session: fakeSession({ status: 'IDLE', error: null }) }));
    assert.match(html, /<form[^>]*aria-labelledby="login-title"/);
    assert.match(html, /<h1 id="login-title"/);
    const idTag = tag(html, 'login-identifier');
    const pwTag = tag(html, 'login-password');
    assert.match(idTag, /autoComplete="username"|autocomplete="username"/i);
    assert.match(pwTag, /autoComplete="current-password"|autocomplete="current-password"/i);
    assert.match(pwTag, /type="password"/);
    assert.match(idTag, /aria-required="true"/);
    assert.match(idTag, /aria-invalid="false"/);
    assert.doesNotMatch(idTag, /aria-describedby/); // chưa có lỗi => không trỏ tới phần tử không tồn tại
    assert.match(html, /<label[^>]*for="login-identifier"/);
    assert.match(html, /<label[^>]*for="login-password"/);
    const toggle = html.match(/<button[^>]*aria-controls="login-password"[^>]*>/)[0];
    assert.match(toggle, /type="button"/);
    assert.match(toggle, /aria-pressed="false"/);
    assert.match(html, />Hiện mật khẩu</);
    assert.equal((html.match(/type="submit"/g) || []).length, 1); // một nút gửi duy nhất
    assert.doesNotMatch(html, /role="alert"/);
    assert.doesNotMatch(html, /value="[^"]+"[^>]*type="password"|type="password"[^>]*value="[^"]+"/); // không có mật khẩu điền sẵn
  });
});

test('SSR: nút gửi không disabled khi IDLE (để Enter kích hoạt kiểm tra); disabled khi UNAVAILABLE/LOADING', async (t) => {
  if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
  await withServer(({ React, renderToString, LoginScreen }) => {
    const submitTag = (st) => renderToString(React.createElement(LoginScreen, { enabled: true, session: fakeSession(st) })).match(/<button[^>]*type="submit"[^>]*>/)[0];
    assert.doesNotMatch(submitTag({ status: 'IDLE', error: null }), /disabled/);
    assert.match(submitTag({ status: 'UNAVAILABLE', error: null }), /disabled/);
    assert.match(submitTag({ status: 'LOADING', error: null }), /disabled/);
  });
});

for (const c of CASES.slice(0, 3)) {
  test(`SSR ${c.name}: banner role=alert, id login-banner, hai ô nhập trỏ aria-describedby tới banner`, async (t) => {
    if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
    await withServer(({ React, renderToString, LoginScreen }) => {
      const html = renderToString(React.createElement(LoginScreen, { enabled: true, session: fakeSession({ status: 'ERROR', error: c.error }) }));
      assert.match(tag(html, 'login-banner'), /role="alert"/);
      assert.ok(html.includes(LOGIN_ERRORS[c.error]));
      assert.equal(attr(tag(html, 'login-identifier'), 'aria-describedby'), 'login-banner');
      assert.equal(attr(tag(html, 'login-password'), 'aria-describedby'), 'login-banner');
    });
  });
}

test('SSR UNAVAILABLE: thông báo role=status, ô nhập và nút hiện mật khẩu bị khóa', async (t) => {
  if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
  await withServer(({ React, renderToString, LoginScreen }) => {
    const html = renderToString(React.createElement(LoginScreen, { enabled: true, session: fakeSession({ status: 'UNAVAILABLE', error: null }) }));
    assert.match(html, /role="status"[^>]*>Đăng nhập chưa khả dụng/);
    assert.match(tag(html, 'login-identifier'), /disabled/);
    assert.match(tag(html, 'login-password'), /disabled/);
    assert.match(html.match(/<button[^>]*aria-controls="login-password"[^>]*>/)[0], /disabled/);
  });
});
