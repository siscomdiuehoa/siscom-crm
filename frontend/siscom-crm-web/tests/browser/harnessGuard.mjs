// Tiện ích độ tin cậy dùng chung cho harness Chrome thật (browserSmoke.mjs, stale401ChromeModule.mjs). CHỈ test-only, không đụng src.
// Mục tiêu: cổng cố định nhưng phát hiện bị chiếm (BLOCKED thay vì treo/đính nhầm Chrome cũ), có hạn chót cho mọi bước CDP,
// dọn TOÀN BỘ cây tiến trình Chrome (kể cả khi lỗi sớm/Ctrl-C), Chrome không ra mạng ngoài loopback. Không mạng, không DB, không .env.
import net from 'node:net';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

// Cờ chặn Chrome tự ra mạng (cập nhật thành phần, đồng bộ, ping...) và mọi tên miền khác 127.0.0.1.
export const LOOPBACK_ONLY_FLAGS = [
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings', '--disable-default-apps',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
];

// Trả về danh sách cổng đang bị chiếm trên 127.0.0.1 (rỗng = tất cả rảnh).
export async function busyPorts(ports) {
  const busy = [];
  for (const port of ports) {
    const free = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (!free) busy.push(port);
  }
  return busy;
}

// listen() có xử lý lỗi (EADDRINUSE...) -> reject, không ném sự kiện 'error' không bắt.
export const listenOnLoopback = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
});

export const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Hết hạn (' + ms + 'ms): ' + label)), ms);
  promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

// Giết cả cây tiến trình (Windows: taskkill /T /F; nơi khác: SIGKILL). Đồng bộ để chạy được trong handler thoát.
export function killTree(proc) {
  if (!proc || proc.pid === undefined || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill('SIGKILL');
  } catch (e) { /* tiến trình đã thoát */ }
}

// Sổ dọn dẹp: đăng ký ngay khi tạo tài nguyên; chạy đúng 1 lần (kể cả Ctrl-C, ngoại lệ, hạn chót toàn cục).
export function createCleanup({ deadlineMs, onDeadline } = {}) {
  const fns = []; let done = false;
  const run = () => { if (done) return; done = true; for (const fn of fns.reverse()) { try { fn(); } catch (e) { /* tiếp tục dọn */ } } };
  const bail = (code, msg) => () => { if (msg) console.log(msg); run(); process.exit(code); };
  process.once('SIGINT', bail(130, 'NGẮT (SIGINT): đã dọn Chrome')); process.once('SIGTERM', bail(143, 'NGẮT (SIGTERM): đã dọn Chrome'));
  process.once('uncaughtException', (e) => bail(1, 'NGOẠI LỆ CHƯA BẮT: ' + (e && e.message))());
  process.once('unhandledRejection', (e) => bail(1, 'REJECTION CHƯA BẮT: ' + (e && e.message))());
  process.once('exit', run);
  let timer;
  if (deadlineMs) { timer = setTimeout(() => { if (onDeadline) onDeadline(); bail(1, 'HẾT HẠN CHÓT TOÀN CỤC ' + deadlineMs + 'ms: đã dọn Chrome')(); }, deadlineMs); }
  return { add: (fn) => { fns.push(fn); }, run, cancelDeadline: () => clearTimeout(timer) };
}

// Chạy Chrome, ĐĂNG KÝ NGAY để dọn cả khi bước kết nối CDP sau đó lỗi.
export function spawnChrome(cleanup, chromeExe, args) {
  const proc = spawn(chromeExe, [...LOOPBACK_ONLY_FLAGS, ...args], { stdio: 'ignore' });
  cleanup.add(() => killTree(proc));
  return proc;
}

export const rmDirBestEffort = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* bỏ qua */ } };
