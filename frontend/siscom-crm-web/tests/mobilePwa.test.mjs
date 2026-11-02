// Run: node --test tests/mobilePwa.test.mjs — B1.5 bước 4 (thuần, không trình duyệt): PWA "Thêm vào màn hình chính" và 2 lỗi bố cục ở 390 px.
// Bố cục thật đã đo bằng Chrome (docs/evidence/b1.5_pwa_mobile_layout_*); test này giữ các điều kiện CSS/HTML đã sửa không bị gỡ lại.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const css = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');

// Kích thước PNG đọc từ khối IHDR (byte 16..23), không cần thư viện ảnh.
function pngSize(p) {
  const b = readFileSync(new URL(p, root));
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', p + ' không phải PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('index.html: manifest, apple-touch-icon, meta apple-*, theme-color — đường dẫn tương đối (base ./), không service worker', () => {
  const h = read('index.html');
  assert.match(h, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(h, /<link rel="apple-touch-icon" sizes="180x180" href="\.\/icons\/apple-touch-icon\.png">/);
  assert.match(h, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(h, /<meta name="apple-mobile-web-app-title" content="SISCOM CRM">/);
  assert.match(h, /<meta name="theme-color"/);
  assert.match(h, /name="viewport" content="width=device-width,initial-scale=1"/); // không chặn phóng to (trợ năng)
  assert.doesNotMatch(h, /user-scalable=no|maximum-scale=1/);
  assert.doesNotMatch(h, /serviceWorker|sw\.js/); // cố ý: không cache /api (dữ liệu khách hàng, phiên) trên thiết bị
  assert.ok(!existsSync(new URL('public/sw.js', root)));
});

test('manifest.webmanifest: hợp lệ, standalone, phạm vi tương đối, đủ biểu tượng 192/512/maskable đúng kích thước', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(m.name, 'SISCOM CRM');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './'); assert.equal(m.scope, './');
  for (const k of ['start_url', 'scope', 'id']) assert.ok(!/^(https?:)?\/\//.test(m[k]), k + ' phải tương đối, không trỏ ra ngoài');
  const bySize = (s, purpose) => m.icons.find((i) => i.sizes === s && i.purpose === purpose);
  for (const [s, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    const icon = bySize(s, purpose);
    assert.ok(icon, 'thiếu biểu tượng ' + s + ' ' + purpose);
    assert.equal(icon.type, 'image/png');
    assert.ok(!icon.src.startsWith('/') && !/^https?:/.test(icon.src), 'src phải tương đối: ' + icon.src);
    const [w, h] = pngSize('public/' + icon.src);
    assert.deepEqual([w, h].map(String), s.split('x'), icon.src + ' sai kích thước');
  }
  assert.deepEqual(pngSize('public/icons/apple-touch-icon.png'), [180, 180]);
});

test('lỗi 1 (390 px): màn hình đăng nhập / đổi mật khẩu bắt buộc không tràn — cột lưới minmax(0,1fr), ô nhập co được', () => {
  const a = css(read('src/styles/app.css'));
  assert.ok(a.includes('.login-shell{grid-template-columns:minmax(0,1fr);justify-items:center}'));
  assert.ok(a.includes('.login-shellform{grid-template-columns:minmax(0,1fr)}'));
  assert.ok(a.includes('.login-shell.sg-control,.login-shell.sg-input{min-width:0}'));
  // Cả hai màn hình dùng đúng lớp này (nếu đổi tên lớp thì CSS trên mất tác dụng).
  assert.match(read('src/features/auth/LoginScreen.jsx'), /<main className="login-shell"/);
  assert.match(read('src/features/auth/ChangePasswordScreen.jsx'), /<main className="login-shell"/);
});

test('lỗi 2 (390 px): thanh trên cùng — nút Đổi mật khẩu/Đăng xuất chỉ còn biểu tượng ≤ 768 px, vẫn có tên truy cập; ẩn avatar ≤ 480 px', () => {
  const c = css(read('src/styles/components/components.css'));
  const mq768 = c.match(/@media\(max-width:768px\)\{(.*?)\}\}/);
  assert.ok(mq768, 'thiếu khối @media (max-width:768px)');
  assert.ok(mq768[1].includes('.sg-topbar__actions.sg-tb-label{display:none}'));
  assert.ok(mq768[1].includes('.sg-topbar__actions{gap:4px;flex-shrink:0}'));
  assert.ok(c.includes('@media(max-width:480px){.sg-topbar__actions.sg-avatar{display:none}}'));
  const app = read('src/App.jsx');
  // Nút chỉ còn biểu tượng phải giữ tên đọc được bằng trình đọc màn hình và chú giải khi chạm/giữ.
  assert.ok(app.includes('icon="log-out" className="sg-tb-btn" aria-label="Đăng xuất" title="Đăng xuất" onClick={() => session.logout()}><span className="sg-tb-label">Đăng xuất</span>'));
  assert.ok(app.includes('icon="key-round" className="sg-tb-btn" aria-label={CHANGE_PASSWORD_UI_TEXT.title} title={CHANGE_PASSWORD_UI_TEXT.title} onClick={() => setPwOpen(true)}><span className="sg-tb-label">{CHANGE_PASSWORD_UI_TEXT.title}</span>'));
  // Hành vi không đổi: đăng xuất vẫn gọi session.logout(), đổi mật khẩu vẫn mở hộp thoại.
  assert.match(app, /onClick=\{\(\) => session\.logout\(\)\}/);
  assert.match(app, /onClick=\{\(\) => setPwOpen\(true\)\}/);
});
