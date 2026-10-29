// Run: node --test tests/changePasswordScreen.test.mjs   (Node >= 18; phần render SSR cần `vite` đã cài, nếu không sẽ bỏ qua có ghi rõ).
// PR 8: màn hình/hộp thoại đổi mật khẩu (Liquid Glass) — vệ sinh mã nguồn + thuộc tính trợ năng của DOM (render tĩnh qua react-dom/server).
// Tương tác (gửi, lỗi trường, xoá ô) được kiểm ở model (tests/changePassword.test.mjs) và harness Chrome thật (S9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANGE_PASSWORD_UI_TEXT } from '../src/auth/changePasswordModel.js';

const FILES = ['../src/features/auth/ChangePasswordScreen.jsx', '../src/features/auth/ChangePasswordDialog.jsx'];
test('mã nguồn màn hình đổi mật khẩu: không log, không storage, không cookie, không fetch trực tiếp', () => {
  for (const f of FILES) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /console\.|gtag|analytics|dataLayer|localStorage|sessionStorage|document\.cookie|\bfetch\(|sendBeacon/i, f);
  }
});

let vite = null;
try { ({ createServer: vite } = await import('vite')); } catch { vite = null; }
async function withServer(fn) {
  const server = await vite({ configFile: false, root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    const React = (await import('react')).default;
    const { renderToString } = await import('react-dom/server');
    const screen = await server.ssrLoadModule('/src/features/auth/ChangePasswordScreen.jsx');
    const dialog = await server.ssrLoadModule('/src/features/auth/ChangePasswordDialog.jsx');
    return await fn({ React, renderToString, ChangePasswordForm: screen.ChangePasswordForm, ChangePasswordScreen: screen.default, CHANGE_PASSWORD_IDS: screen.CHANGE_PASSWORD_IDS, ChangePasswordDialog: dialog.default });
  } finally { await server.close(); }
}
const ME = { employeeId: 'e1', code: 'NV-0003', fullName: 'Sale A', roles: ['sales'], permissions: {}, mustChangePassword: false };
const fakeSession = (state) => ({ getState: () => state, subscribe: () => () => {}, changePassword: async () => ({ ok: true }), logout: async () => {} });
function tag(html, id) { const m = html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`)); return m ? m[0] : ''; }
const attr = (html, name) => { const m = html.match(new RegExp(`\\b${name}="([^"]*)"`, 'i')); return m ? m[1] : null; }; // SSR giữ autoComplete nguyên dạng

test('render hộp thoại: 3 ô mật khẩu đúng nhãn/autocomplete/type, thanh độ mạnh role=meter, gợi ý chính sách, nút Đổi mật khẩu + Đóng, không có Đăng xuất, khung Liquid Glass', async (t) => {
  if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
  await withServer(({ React, renderToString, ChangePasswordForm, CHANGE_PASSWORD_IDS }) => {
    const html = renderToString(React.createElement(ChangePasswordForm, { session: fakeSession({ status: 'AUTHENTICATED', me: ME }), onClose: () => {}, onDone: () => {} }));
    assert.match(html, /class="[^"]*sg-glass-strong/);
    for (const [id, auto, label] of [[CHANGE_PASSWORD_IDS.current, 'current-password', CHANGE_PASSWORD_UI_TEXT.currentLabel], [CHANGE_PASSWORD_IDS.next, 'new-password', CHANGE_PASSWORD_UI_TEXT.nextLabel], [CHANGE_PASSWORD_IDS.confirm, 'new-password', CHANGE_PASSWORD_UI_TEXT.confirmLabel]]) {
      const el = tag(html, id); assert.ok(el, 'thiếu ô ' + id);
      assert.equal(attr(el, 'type'), 'password'); assert.equal(attr(el, 'autocomplete'), auto); assert.equal(attr(el, 'aria-invalid'), 'false');
      assert.ok(html.includes(label), 'thiếu nhãn ' + label);
      assert.ok(new RegExp(`<label[^>]*for="${id}"`).test(html), 'nhãn chưa gắn for=' + id);
    }
    const meter = tag(html, CHANGE_PASSWORD_IDS.strength);
    assert.equal(attr(meter, 'role'), 'meter'); assert.equal(attr(meter, 'aria-valuemin'), '0'); assert.equal(attr(meter, 'aria-valuemax'), '4'); assert.equal(attr(meter, 'aria-valuenow'), '0');
    assert.ok(html.includes(CHANGE_PASSWORD_UI_TEXT.hint));
    assert.match(html, /<button[^>]*type="submit"[^>]*>[^<]*(<[^>]+>[^<]*)*Đổi mật khẩu/);
    assert.ok(html.includes(CHANGE_PASSWORD_UI_TEXT.close)); assert.ok(!html.includes(CHANGE_PASSWORD_UI_TEXT.logout));
    assert.ok(!html.includes(CHANGE_PASSWORD_UI_TEXT.forcedNotice));
    assert.doesNotMatch(html, /value="[^"]+"/); // không có mật khẩu nào trong HTML
  });
});

test('render bắt buộc (forced): thông báo bắt buộc, chỉ có Đăng xuất (không Đóng), vỏ login-shell; render Dialog: role=dialog aria-modal + aria-label', async (t) => {
  if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
  await withServer(({ React, renderToString, ChangePasswordScreen, ChangePasswordDialog }) => {
    const forced = renderToString(React.createElement(ChangePasswordScreen, { session: fakeSession({ status: 'AUTHENTICATED', me: { ...ME, mustChangePassword: true } }) }));
    assert.ok(forced.includes(CHANGE_PASSWORD_UI_TEXT.forcedNotice)); assert.match(forced, /role="status"/);
    assert.ok(forced.includes(CHANGE_PASSWORD_UI_TEXT.logout)); assert.ok(!forced.includes('>' + CHANGE_PASSWORD_UI_TEXT.close + '<'));
    assert.match(forced, /class="login-shell/);
    const dlg = renderToString(React.createElement(ChangePasswordDialog, { open: true, session: fakeSession({ status: 'AUTHENTICATED', me: ME }), onClose: () => {}, onDone: () => {} }));
    assert.match(dlg, /role="dialog"[^>]*aria-modal="true"[^>]*aria-label="Đổi mật khẩu"|aria-label="Đổi mật khẩu"[^>]*role="dialog"/);
    assert.equal(renderToString(React.createElement(ChangePasswordDialog, { open: false, session: fakeSession({ status: 'AUTHENTICATED', me: ME }), onClose: () => {} })), '');
  });
});

test('render khi phiên không AUTHENTICATED: ô nhập và nút gửi bị vô hiệu (không gửi được)', async (t) => {
  if (!vite) return t.skip('chưa cài vite — chưa kiểm chứng render');
  await withServer(({ React, renderToString, ChangePasswordForm, CHANGE_PASSWORD_IDS }) => {
    const html = renderToString(React.createElement(ChangePasswordForm, { session: fakeSession({ status: 'IDLE', me: null }), onClose: () => {} }));
    for (const id of [CHANGE_PASSWORD_IDS.current, CHANGE_PASSWORD_IDS.next, CHANGE_PASSWORD_IDS.confirm]) assert.match(tag(html, id), /\bdisabled=""/);
    assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);
  });
});
