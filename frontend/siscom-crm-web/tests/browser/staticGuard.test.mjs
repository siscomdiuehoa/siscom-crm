// Test chống path traversal của máy chủ tĩnh trong harness Chrome (KHÔNG cần Chrome, KHÔNG build, chỉ loopback):
//   node --test tests/browser/staticGuard.test.mjs
// Kịch bản âm tính: thư mục anh em cùng tiền tố (dist-evil), ../, mã hóa %2e%2e, %2f, %5c, gạch chéo lẫn lộn,
// NUL, %-hỏng, ổ đĩa tuyệt đối, ADS (:), symlink/junction trỏ ra ngoài. Mọi yêu cầu thoát khỏi DIST phải bị 403/404, không rò nội dung.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler } from './harnessGuard.mjs';

const SECRET = 'TOP-SECRET-OUTSIDE-DIST';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'k01-static-'));
const DIST = path.join(base, 'dist');
const EVIL = path.join(base, 'dist-evil'); // anh em cùng tiền tố: startsWith(DIST) vẫn đúng
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.mkdirSync(EVIL);
fs.writeFileSync(path.join(DIST, 'index.html'), '<html>OK</html>');
fs.writeFileSync(path.join(DIST, 'assets', 'a.js'), 'console.log(1)');
fs.writeFileSync(path.join(EVIL, 'secret.txt'), SECRET);
fs.writeFileSync(path.join(base, 'secret.txt'), SECRET);

let linkOk = false;
try { fs.symlinkSync(EVIL, path.join(DIST, 'link-out'), 'junction'); linkOk = true; } catch (e) { /* môi trường không cho tạo link: bỏ qua ca symlink */ }

// Bản cũ (lỗ hổng) giữ lại làm đối chứng: chứng minh bộ test thật sự bắt được lỗi.
const legacy = (req, res) => {
  const u = new URL(req.url, 'http://x'); let f = path.join(DIST, decodeURIComponent(u.pathname));
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200); fs.createReadStream(f).pipe(res);
};

const serve = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
// http.request giữ nguyên đường dẫn thô (fetch/URL sẽ tự chuẩn hóa ../ nên không dùng).
const get = (server, rawPath) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: server.address().port, path: rawPath, method: 'GET' }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject); req.end();
});
const close = (s) => new Promise((r) => s.close(r));

const ATTACKS = [
  ['sibling-prefix ../dist-evil', '/../dist-evil/secret.txt'],
  ['sibling-prefix ..%2f (giải mã sau chuẩn hóa URL)', '/..%2fdist-evil%2fsecret.txt'],
  ['sibling-prefix ..%5c', '/..%5cdist-evil%5csecret.txt'],
  ['../ thuần', '/../secret.txt'],
  ['../ lặp sâu', '/../../../../../../../../secret.txt'],
  ['%2e%2e%2f', '/%2e%2e%2fsecret.txt'],
  ['%2E%2E/ hoa', '/%2E%2E/secret.txt'],
  ['..%5c (dấu \ mã hóa)', '/..%5csecret.txt'],
  ['lẫn / và \ mã hóa', '/assets/..%5c..%5csecret.txt'],
  ['lẫn / và ..%5c sang dist-evil','/assets/../..%5cdist-evil%5csecret.txt'],
  ['lẫn / và \ thô sau thư mục', '/assets/..\..\secret.txt'],
  ['mã hóa kép %252e', '/%252e%252e/secret.txt'],
  ['NUL', '/index.html%00.png'],
  ['NUL + ../', '/..%00/secret.txt'],
  ['%-hỏng', '/%E0%A4%A'],
  ['ổ đĩa tuyệt đối', '/C:/Windows/win.ini'],
  ['ổ đĩa tuyệt đối mã hóa', '/%43%3a%5cWindows%5cwin.ini'],
  ['UNC //host/share', '//127.0.0.1/c$/Windows/win.ini'],
  ['ADS', '/index.html::$DATA'],
];

test('đối chứng: logic startsWith(DIST) cũ RÒ thư mục anh em cùng tiền tố (chứng minh lỗi có thật)', async () => {
  const s = await serve(legacy);
  try {
    const r = await get(s, '/..%2fdist-evil%2fsecret.txt');
    assert.equal(r.status, 200); assert.equal(r.body, SECRET);
  } finally { await close(s); }
});

test('createStaticHandler: phục vụ bình thường file và thư mục trong DIST', async () => {
  const s = await serve(createStaticHandler(DIST));
  try {
    assert.equal((await get(s, '/index.html')).body, '<html>OK</html>');
    assert.equal((await get(s, '/')).body, '<html>OK</html>');
    assert.equal((await get(s, '/assets/a.js?x=1')).status, 200);
    assert.equal((await get(s, '/assets/../index.html')).status, 200); // ../ vẫn nằm trong DIST: được phép
    assert.equal((await get(s, '/nope.js')).status, 404);
  } finally { await close(s); }
});

for (const [name, raw] of ATTACKS) {
  test(`createStaticHandler: từ chối ${name}`, async () => {
    const s = await serve(createStaticHandler(DIST));
    try {
      const r = await get(s, raw);
      assert.ok([400, 403, 404].includes(r.status), `status=${r.status}`);
      assert.ok(!r.body.includes(SECRET), 'không được rò nội dung ngoài DIST');
    } finally { await close(s); }
  });
}

test('createStaticHandler: từ chối junction/symlink trỏ ra ngoài DIST', { skip: !linkOk && 'không tạo được link trong môi trường này' }, async () => {
  const s = await serve(createStaticHandler(DIST));
  try {
    for (const p of ['/link-out/secret.txt', '/link-out']) {
      const r = await get(s, p);
      assert.ok([403, 404].includes(r.status), `${p} status=${r.status}`);
      assert.ok(!r.body.includes(SECRET));
    }
  } finally { await close(s); }
});

test.after(() => { try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* bỏ qua */ } });
