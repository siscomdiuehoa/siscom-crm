// Run: node --test tests/loginPreview.test.mjs   (Node >= 18; phần render cần `vite` đã cài sẵn, nếu không sẽ bỏ qua có ghi rõ).
// Không mạng, không DB, không bí mật thật; mật khẩu trong test là chuỗi giả lập.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLoginPreviewFlag, selectRootKind, createLoginPreviewSession, LOGIN_PREVIEW_ERROR, LOGIN_PREVIEW_UNAVAILABLE_TEXT } from '../src/auth/loginPreview.js';
import { deriveLoginView, submitLogin } from '../src/auth/loginScreenModel.js';
import { LOGIN_ERRORS } from '../src/auth/loginSession.js';

test('cờ preview MẶC ĐỊNH TẮT; chỉ đúng chuỗi "true" mới bật; không lẫn với cờ UI/auth khác', () => {
  assert.equal(readLoginPreviewFlag(undefined), false);
  assert.equal(readLoginPreviewFlag({}), false);
  for (const v of ['1', 'TRUE', 'yes', '', ' true']) assert.equal(readLoginPreviewFlag({ VITE_CRM_LOGIN_PREVIEW_ENABLED: v }), false);
  assert.equal(readLoginPreviewFlag({ VITE_CRM_LOGIN_UI_ENABLED: 'true', VITE_CRM_AUTH_ENABLED: 'true' }), false);
  assert.equal(readLoginPreviewFlag({ VITE_CRM_LOGIN_PREVIEW_ENABLED: 'true' }), true);
});

test('chọn gốc render: tắt => app (giữ nguyên CRM), bật => preview', () => {
  assert.equal(selectRootKind(undefined), 'app');
  assert.equal(selectRootKind({}), 'app');
  assert.equal(selectRootKind({ VITE_CRM_LOGIN_PREVIEW_ENABLED: 'false' }), 'app');
  assert.equal(selectRootKind({ VITE_CRM_LOGIN_PREVIEW_ENABLED: 'true' }), 'preview');
});

test('phiên preview: nhận email hoặc mã NV + mật khẩu hợp lệ nhưng LUÔN báo máy chủ xác thực chưa khả dụng', async () => {
  for (const id of ['a@b.vn', 'NV-0001']) {
    const s = createLoginPreviewSession();
    assert.equal(s.getState().status, 'IDLE');
    const r = await submitLogin(s, id, 'pw-gia-lap');
    assert.equal(r.submitted, true);
    const st = s.getState();
    assert.equal(st.status, 'ERROR');
    assert.equal(st.error, LOGIN_PREVIEW_ERROR);
    assert.equal(st.employeeId, null);
    assert.equal(st.expiresAt, null);
    assert.equal(s.getAuthHeader(), null);
  }
});

test('banner hiển thị thông báo "chưa khả dụng" rõ ràng, không rơi về UNKNOWN', () => {
  const v = deriveLoginView({ status: 'ERROR', error: LOGIN_PREVIEW_ERROR, identifier: 'a@b.vn', password: 'x' });
  assert.equal(v.bannerError, LOGIN_PREVIEW_UNAVAILABLE_TEXT);
  assert.notEqual(v.bannerError, LOGIN_ERRORS.UNKNOWN);
  assert.equal(v.authenticated, false);
  assert.match(LOGIN_PREVIEW_UNAVAILABLE_TEXT, /chưa khả dụng/);
});

test('dữ liệu sai hình dạng bị chặn trước; trạng thái không chứa mật khẩu/token; không phát sinh người dùng giả', async () => {
  const s = createLoginPreviewSession();
  assert.equal((await submitLogin(s, 'khong-hop-le', 'x')).submitted, false);
  assert.equal((await submitLogin(s, 'a@b.vn', '')).submitted, false);
  assert.equal(s.getState().status, 'IDLE');
  await s.submit('a@b.vn', 'mat-khau-bi-mat-gia-lap');
  assert.doesNotMatch(JSON.stringify(s.getState()), /mat-khau-bi-mat-gia-lap|token/i);
  await s.submit('a@b.vn', 'x'); await s.logout(); s.handleUnauthorized();
  assert.notEqual(s.getState().status, 'AUTHENTICATED');
});

test('không ghi storage / không gọi mạng khi gửi', async () => {
  const g = globalThis; const saved = { fetch: g.fetch, localStorage: g.localStorage };
  let touched = 0;
  g.fetch = () => { touched++; };
  Object.defineProperty(g, 'localStorage', { configurable: true, value: { getItem() { touched++; }, setItem() { touched++; }, removeItem() { touched++; } } });
  try { await createLoginPreviewSession().submit('NV-0001', 'x'); } finally {
    g.fetch = saved.fetch;
    if (saved.localStorage === undefined) delete g.localStorage; else Object.defineProperty(g, 'localStorage', { configurable: true, value: saved.localStorage });
  }
  assert.equal(touched, 0);
});

// ---- Render thật (SSR) qua Vite ssrLoadModule: kiểm tra route/entry và DOM ban đầu ----
let vite = null;
try { ({ createServer: vite } = await import('vite')); } catch { vite = null; }

test('render LoginPreviewEntry (SSR): có ô email/mã NV + mật khẩu, nút gửi, KHÔNG có dữ liệu CRM/khách hàng', async (t) => {
  if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
  const server = await vite({ configFile: false, root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    const React = (await import('react')).default;
    const { renderToString } = await import('react-dom/server');
    const Entry = (await server.ssrLoadModule('/src/features/auth/LoginPreviewEntry.jsx')).default;
    const html = renderToString(React.createElement(Entry));
    assert.match(html, /Email hoặc mã nhân viên/);
    assert.match(html, /Mật khẩu/);
    assert.match(html, /type="password"/);
    assert.match(html, /type="submit"/);
    assert.match(html, /autoComplete|autocomplete="username"/i);
    assert.doesNotMatch(html, /Khách hàng|Dashboard|Tổng quan|u-director/i);
    // LoginScreen khi enabled=false (mặc định) không render gì
    const LoginScreen = (await server.ssrLoadModule('/src/features/auth/LoginScreen.jsx')).default;
    const off = renderToString(React.createElement(LoginScreen, { session: createLoginPreviewSession() }));
    assert.equal(off, '');
  } finally { await server.close(); }
});
