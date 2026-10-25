// Test độ tin cậy của harness Chrome (KHÔNG cần Chrome, KHÔNG build, chỉ loopback): node --test tests/browser/harnessGuard.test.mjs
// Kịch bản âm tính: cổng bị chiếm, bước CDP treo, Chrome con/cháu không bị dọn, hạn chót toàn cục, rò mạng ngoài loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { busyPorts, listenOnLoopback, withTimeout, killTree, LOOPBACK_ONLY_FLAGS } from './harnessGuard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD_URL = new URL('./harnessGuard.mjs', import.meta.url).href;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitDead = async (pid, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (!alive(pid)) return true; await sleep(100); } return !alive(pid); };
const occupy = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => resolve(s)); });

test('busyPorts: phát hiện cổng đang bị chiếm và báo rảnh khi đã nhả', async () => {
  const s = await occupy(); const port = s.address().port;
  assert.deepEqual(await busyPorts([port]), [port]);
  await new Promise((r) => s.close(r));
  assert.deepEqual(await busyPorts([port]), []);
});

test('listenOnLoopback: EADDRINUSE được reject (không ném sự kiện error không bắt)', async () => {
  const s = await occupy(); const port = s.address().port;
  await assert.rejects(listenOnLoopback(http.createServer(), port), (e) => e.code === 'EADDRINUSE');
  await new Promise((r) => s.close(r));
});

test('listenOnLoopback: chỉ nghe 127.0.0.1, không nghe mọi giao diện', async () => {
  const srv = http.createServer(); await listenOnLoopback(srv, 0);
  assert.equal(srv.address().address, '127.0.0.1'); await new Promise((r) => srv.close(r));
});

test('withTimeout: bước treo bị reject đúng hạn; bước nhanh không bị ảnh hưởng', async () => {
  const t0 = Date.now();
  await assert.rejects(withTimeout(new Promise(() => {}), 150, 'treo'), /Hết hạn \(150ms\): treo/);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(await withTimeout(Promise.resolve(7), 150, 'nhanh'), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error('x')), 150, 'lỗi'), /x/);
});

test('killTree: giết cả tiến trình cháu (Chrome renderer/gpu), không chỉ tiến trình cha', async () => {
  const grandchild = 'setInterval(()=>{},1000)';
  const parentSrc = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`;
  const parent = spawn(process.execPath, ['-e', parentSrc], { stdio: ['ignore', 'pipe', 'ignore'] });
  const gpid = Number(await new Promise((r) => parent.stdout.once('data', (d) => r(String(d).trim()))));
  assert.ok(alive(parent.pid) && alive(gpid));
  killTree(parent);
  assert.ok(await waitDead(parent.pid), 'tiến trình cha còn sống');
  assert.ok(await waitDead(gpid), 'tiến trình cháu còn sống (rò Chrome con)');
});

test('killTree: tiến trình đã thoát hoặc undefined không ném lỗi', async () => {
  killTree(undefined); killTree({});
  const p = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' }); await new Promise((r) => p.once('exit', r)); killTree(p);
});

const runScript = (src) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.once('exit', (code) => resolve({ code, out }));
});
const SLEEPER = `const {spawn}=await import('node:child_process');import {createCleanup,killTree} from ${JSON.stringify(GUARD_URL)};`;

test('createCleanup: hạn chót toàn cục thoát mã 1 và giết tiến trình đã đăng ký dù mã chính treo', async () => {
  const src = SLEEPER + `const cl=createCleanup({deadlineMs:400});const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});cl.add(()=>killTree(c));console.log('PID='+c.pid);await new Promise(()=>{});`;
  const r = await runScript(src);
  assert.equal(r.code, 1); assert.match(r.out, /HẾT HẠN CHÓT TOÀN CỤC 400ms/);
  const pid = Number(/PID=(\d+)/.exec(r.out)[1]); assert.ok(await waitDead(pid), 'tiến trình đăng ký còn sống sau hạn chót');
});

test('createCleanup: ngoại lệ chưa bắt vẫn dọn tiến trình đã đăng ký (lỗi sớm sau khi spawn Chrome)', async () => {
  const src = SLEEPER + `const cl=createCleanup();const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});cl.add(()=>killTree(c));console.log('PID='+c.pid);setTimeout(()=>{throw new Error('boom')},100);await new Promise(()=>{});`;
  const r = await runScript(src);
  assert.equal(r.code, 1); assert.match(r.out, /NGOẠI LỆ CHƯA BẮT: boom/);
  assert.ok(await waitDead(Number(/PID=(\d+)/.exec(r.out)[1])));
});

test('createCleanup: chạy đúng 1 lần dù gọi nhiều lần (idempotent)', async () => {
  const src = SLEEPER + `let n=0;const cl=createCleanup();cl.add(()=>{n++});cl.run();cl.run();console.log('N='+n);`;
  const r = await runScript(src); assert.equal(r.code, 0); assert.match(r.out, /N=1/);
});

test('cờ Chrome: chặn mạng nền và mọi tên miền ngoài 127.0.0.1', () => {
  const flags = LOOPBACK_ONLY_FLAGS.join(' ');
  assert.match(flags, /--disable-background-networking/); assert.match(flags, /--disable-component-update/);
  assert.match(flags, /host-resolver-rules=MAP \* ~NOTFOUND, EXCLUDE 127\.0\.0\.1/);
});

// Hồi quy tĩnh: harness phải dùng helper, không quay lại mẫu cũ (spawn trần, listen trần, proc.kill() trần, fetch CDP không hạn chót).
for (const file of ['browserSmoke.mjs', 'stale401ChromeModule.mjs']) {
  test(`${file}: dùng harnessGuard, không còn mẫu rò rỉ/treo`, () => {
    const src = fs.readFileSync(path.join(HERE, file), 'utf8');
    assert.match(src, /from '\.\/harnessGuard\.mjs'/);
    assert.match(src, /busyPorts\(/); assert.match(src, /spawnChrome\(/); assert.match(src, /createCleanup\(\{ deadlineMs/);
    assert.doesNotMatch(src, /\bspawn\(/, 'spawn trần: Chrome không đăng ký dọn khi lỗi sớm');
    assert.doesNotMatch(src, /\.listen\(/, 'listen trần: EADDRINUSE thành lỗi không bắt');
    assert.doesNotMatch(src, /proc\.kill\(\)/, 'kill() trần chỉ giết tiến trình cha');
    assert.doesNotMatch(src, /\bproc = await launch/, 'launch lỗi giữa chừng làm mất tham chiếu Chrome');
    assert.match(src, /AbortSignal\.timeout\(/, 'fetch CDP /json/version thiếu hạn chót');
    assert.match(src, /withTimeout\(new Promise\(\(resolve, reject\) => \{ const id = nextId\+\+/, 'send() CDP thiếu hạn chót');
    assert.match(src, /ws\.onclose\s*=/, 'đóng kết nối CDP không reject yêu cầu treo');
    assert.doesNotMatch(src, /https?:\/\/(?!127\.0\.0\.1|x['"`/])[a-z0-9.-]+\.[a-z]{2,}/i, 'harness không được tham chiếu URL ngoài loopback');
  });
}
