// Run: node --test tests/loginV3.test.mjs   (Node >= 18; vite + react đã có). Không mạng, không DB, không bí mật thật.
// SISCOM Login V3 (05/11/2026): thiết kế lại GIAO DIỆN đăng nhập (chia đôi màn hình + kính mờ). Kiểm: cấu trúc/trợ năng, các chức năng giữ nguyên
// (email, mật khẩu + hiện/ẩn, Remember Me 90 ngày mặc định KHÔNG tích, quên mật khẩu không gọi API, loading/lỗi), không có thông tin đăng nhập mẫu,
// và các luật CSS đáp ứng 320–430 px / tablet / PC. Đo pixel thật (không tràn ngang) làm bằng harness Edge/Chrome — xem PR.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, byTag, inputByLabel, buttonByText, click, type, submit } from './helpers/miniDom.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CONFIG = new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let vite; let dom; let act; let createRoot; let LoginScreen; let LOGIN_IDS; let LOGIN_V3_TEXT; let LOGIN_HERO_PHOTO; let renderToString; let createLoginPreviewSession;

before(async () => {
  dom = installDom();
  // miniDom chưa có getElementById/focus: LoginScreen dùng chúng để đưa focus về ô lỗi sau khi gửi
  dom.doc.getElementById = (id) => { const el = dom.doc.body.querySelectorAll((e) => e.attributes && e.attributes.id === id)[0] || null; if (el && !el.focus) el.focus = () => {}; return el; };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: CONFIG, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ default: LoginScreen, LOGIN_IDS, LOGIN_V3_TEXT, LOGIN_HERO_PHOTO } = await vite.ssrLoadModule('/src/features/auth/LoginScreen.jsx'));
  ({ createLoginPreviewSession } = await vite.ssrLoadModule('/src/auth/loginPreview.js'));
  ({ createRoot } = await import('react-dom/client')); ({ act } = await import('react'));
  ({ renderToString } = await import('react-dom/server'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

async function mount(session = createLoginPreviewSession()) {
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(LoginScreen, { session, enabled: true })); });
  return { container, unmount: async () => { await act(async () => root.unmount()); } };
}

test('cấu trúc: <main class="login-shell"> chứa khung trái (aside) + khung phải (form kính), logo gốc SISCOM, một h1 "Đăng nhập"', () => {
  const html = renderToString(React.createElement(LoginScreen, { session: createLoginPreviewSession(), enabled: true }));
  assert.match(html, /<main class="login-shell" data-login="v3"/);
  assert.match(html, /<aside class="lg3-hero"/);
  assert.match(html, /<form class="lg3-card"[^>]*aria-labelledby="login-title"/);
  assert.match(html, /<img class="lg3-logo"[^>]*alt="SISCOM"/);
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /<h1 id="login-title"[^>]*>Đăng nhập<\/h1>/);
  assert.match(html, /<svg class="lg3-scene"[^>]*aria-hidden="true"/); // cảnh HVAC/MEP trang trí, ẩn với trình đọc màn hình
  assert.equal(LOGIN_HERO_PHOTO, null, 'mặc định dùng cảnh SVG; ảnh thật do owner cung cấp');
});

test('chức năng giữ nguyên: ô email/mã NV, mật khẩu (che), nút hiện/ẩn, Remember Me 90 ngày KHÔNG tích mặc định, nút gửi, tự điền đúng', () => {
  const html = renderToString(React.createElement(LoginScreen, { session: createLoginPreviewSession(), enabled: true }));
  assert.match(html, /Email hoặc mã nhân viên/);
  assert.match(html, /id="login-identifier"[^>]*autoComplete="username"|autocomplete="username"/i);
  assert.match(html, /type="password"[^>]*/);
  assert.match(html, /autoComplete="current-password"|autocomplete="current-password"/i);
  assert.match(html, /Hiện mật khẩu/); // chữ vẫn có (sr-only) cho trình đọc màn hình + test cũ
  assert.match(html, /id="login-remember"[^>]*type="checkbox"|type="checkbox"[^>]*id="login-remember"/);
  assert.doesNotMatch(html, /id="login-remember"[^>]*checked/);
  assert.match(html, /tối đa 90 ngày/);
  assert.match(html, /type="submit"/);
  assert.match(html, /Quên mật khẩu\?/);
});

test('không có thông tin đăng nhập mẫu / mật khẩu mặc định / token trong giao diện hoặc mã nguồn', () => {
  const html = renderToString(React.createElement(LoginScreen, { session: createLoginPreviewSession(), enabled: true }));
  assert.doesNotMatch(html, /\bvalue="[^"]+"/, 'ô nhập không được điền sẵn giá trị');
  assert.doesNotMatch(html, /Khách hàng|Dashboard|Tổng quan|u-director/i, 'không có nội dung CRM trên màn hình đăng nhập');
  for (const f of ['src/features/auth/LoginScreen.jsx', 'src/features/auth/LoginHeroScene.jsx', 'src/styles/login-v3.css']) {
    const s = read(f);
    assert.doesNotMatch(s, /@siscom\.local|(?:password|matkhau)\s*[:=]\s*['"](?!login-)[^'"]{6,}['"]|Bearer |localStorage|sessionStorage|document\.cookie|\bfetch\(|console\./i, f);
  }
  // mật khẩu mẫu duy nhất được phép là placeholder chữ
  assert.match(read('src/features/auth/LoginScreen.jsx'), /placeholder="Nhập mật khẩu"/);
});

test('không đổi logic/API: LoginScreen chỉ dùng bộ điều khiển headless + mô hình có sẵn; không import client/backend mới', () => {
  const s = read('src/features/auth/LoginScreen.jsx');
  const imports = [...s.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['react', '../../ds/index.js', '../../ds/core/Icon.jsx', '../../auth/loginScreenModel.js', './LoginHeroScene.jsx', '../../assets/logo-siscom.png']);
  assert.match(s, /createLoginSubmitter\(session\)/);
  assert.match(s, /submitter\(identifier, password, remember\)/);
  assert.match(s, /useState\(false\); \/\/ B1\.4 Remember Me: mặc định KHÔNG tích/);
});

test('tương tác: hiện/ẩn mật khẩu đổi type; quên mật khẩu mở/đóng ghi chú (aria-expanded) và KHÔNG gọi mạng; Remember Me bật/tắt được', async () => {
  const calls = []; const prevFetch = globalThis.fetch; globalThis.fetch = (...a) => { calls.push(a); return Promise.reject(new Error('không được gọi mạng')); };
  const m = await mount();
  try {
    const pw = () => inputByLabel(m.container, /^Mật khẩu/);
    assert.equal(pw().type, 'password');
    const eye = byTag(m.container, 'button').find((b) => /Hiện mật khẩu/.test(text(b)));
    await act(async () => { click(eye); });
    assert.equal(pw().type, 'text');
    assert.match(text(byTag(m.container, 'button').find((b) => /Ẩn mật khẩu/.test(text(b)))), /Ẩn mật khẩu/);
    await act(async () => { click(byTag(m.container, 'button').find((b) => /Ẩn mật khẩu/.test(text(b)))); });
    assert.equal(pw().type, 'password');

    const forgot = buttonByText(m.container, /Quên mật khẩu\?/);
    assert.equal(forgot.getAttribute('aria-expanded'), 'false');
    assert.equal(m.container.querySelectorAll((e) => e.attributes && e.attributes.id === LOGIN_IDS.forgotPanel).length, 0);
    await act(async () => { click(forgot); });
    assert.equal(buttonByText(m.container, /Quên mật khẩu\?/).getAttribute('aria-expanded'), 'true');
    assert.match(text(m.container), /liên hệ quản trị viên CRM/);
    await act(async () => { click(buttonByText(m.container, /Quên mật khẩu\?/)); });
    assert.doesNotMatch(text(m.container), /liên hệ quản trị viên CRM/);
    assert.equal(calls.length, 0, 'quên mật khẩu không gọi API');

    const cb = m.container.querySelectorAll((e) => e.attributes && e.attributes.id === LOGIN_IDS.remember)[0];
    assert.ok(!cb.checked);
    await act(async () => { click(cb); });
  } finally { globalThis.fetch = prevFetch; await m.unmount(); }
});

test('lỗi trường + loading: gửi rỗng ⇒ báo lỗi từng trường, KHÔNG gọi mạng; ô lỗi gắn aria-invalid', async () => {
  const calls = []; const prevFetch = globalThis.fetch; globalThis.fetch = (...a) => { calls.push(a); return Promise.reject(new Error('không được gọi mạng')); };
  const m = await mount();
  try {
    const form = byTag(m.container, 'form')[0];
    await act(async () => { submit(form); });
    assert.match(text(m.container), /Vui lòng nhập email hoặc mã nhân viên/);
    assert.equal(inputByLabel(m.container, /^Email hoặc mã nhân viên/).getAttribute('aria-invalid'), 'true');
    await act(async () => { type(inputByLabel(m.container, /^Email hoặc mã nhân viên/), 'abc'); });
    await act(async () => { submit(form); });
    assert.match(text(m.container), /Mã nhân viên không hợp lệ/);
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = prevFetch; await m.unmount(); }
});

test('CSS đáp ứng: hai cột từ 900 px, banner dọc dưới 900, tablet 600, điện thoại nhỏ 380; co về 0 (không tràn ngang); giảm chuyển động; phạm vi chỉ main[data-login=v3]', () => {
  const css = read('src/styles/login-v3.css');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const q of ['@media (min-width:900px)', '@media (min-width:600px)', '@media (max-width:380px)', '@media (min-width:1280px)', '@media (prefers-reduced-motion:reduce)', '@media (forced-colors:active)']) assert.ok(css.includes(q), q);
  assert.match(css, /\.lg3\{width:100%/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.lg3-card \.sg-control\{[^}]*min-width:0/);
  assert.match(css, /\.lg3-card \.sg-input\{min-width:0;font-size:16px/); // 16px: iOS không tự phóng to khi focus
  assert.match(css, /backdrop-filter:blur\(22px\)/);
  assert.match(css, /@supports not \(\(backdrop-filter:blur\(1px\)\)/); // có phương án dự phòng khi trình duyệt không hỗ trợ kính mờ
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height:44px/); // vùng chạm >= 44 px
  assert.ok(!/font:[^;}]*inherit/.test(css), 'không dùng shorthand font có "inherit" (không hợp lệ => bị bỏ)');
  // mọi luật đều nằm trong phạm vi V3 (không rò sang các màn khác)
  const selectors = [...bare.matchAll(/(?:^|\})\s*([^{}@][^{}]*)\{/g)].map((m) => m[1].trim()).filter(Boolean).join(',').split(',').map((s) => s.trim()).filter(Boolean);
  const outside = selectors.filter((s) => !s.startsWith('@')).filter((s) => !/^(main\[data-login="v3"\]|\.lg3|from|to)/.test(s) && !/^[0-9.]+%$/.test(s));
  assert.deepEqual(outside, [], 'selector ngoài phạm vi V3: ' + outside.join(' | '));
});

test('app.css (luật B1.5 cho login-shell / đổi mật khẩu) KHÔNG bị sửa', () => {
  const a = read('src/styles/app.css').replace(/\s+/g, '');
  assert.ok(a.includes('.login-shell{grid-template-columns:minmax(0,1fr);justify-items:center}'.replace(/\s+/g, '')));
  assert.match(read('src/features/auth/ChangePasswordScreen.jsx'), /<main className="login-shell"/);
});
