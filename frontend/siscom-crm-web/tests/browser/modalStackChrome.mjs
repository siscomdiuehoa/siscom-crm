// TRÌNH DUYỆT THẬT (Edge/Chrome headless qua CDP) — Modal chồng nhau, PR #236 (PR236-R2 MAJOR). Chạy tay, KHÔNG thuộc node --test / CI:
//   node tests/browser/modalStackChrome.mjs            (mặc định ưu tiên Microsoft Edge; BROWSER_EXE để chỉ định)
// Không backend, không DB, không mạng ngoài: vite (middleware dev, chỉ 127.0.0.1) phục vụ tests/browser/fixtures/modal-stack.html, trang này dùng
// NGUYÊN VĂN src/ds/feedback/Modal.jsx. Phím thật qua Input.dispatchKeyEvent (đi đủ pha capture → target → bubble của trình duyệt, khác miniDom).
// Kịch bản: mở A, từ A mở B (B render ở nhánh DOM riêng). Đưa focus vào phần tử của hộp DƯỚI (A) rồi Tab / Shift+Tab / Escape phát từ chính phần tử đó.
// Kỳ vọng: focus luôn ở hộp TRÊN CÙNG (B); Escape chỉ đóng B; đóng B => focus về nút "Mở B"; A trở thành hộp trên cùng và vòng Tab trong A.
// Mã thoát: 0 = đạt, 1 = có FAIL, 2 = BLOCKED (thiếu trình duyệt / cổng bận).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { busyPorts, withTimeout, createCleanup, spawnChrome, rmDirBestEffort } from './harnessGuard.mjs';

const CDP_CALL_MS = 15000, GLOBAL_DEADLINE_MS = 120000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // frontend/siscom-crm-web
const WEB_PORT = 4621, CDP_PORT = 9366;
const PAGE = `http://127.0.0.1:${WEB_PORT}/tests/browser/fixtures/modal-stack.html`;
const BROWSERS = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
const browser = process.env.BROWSER_EXE || BROWSERS.find((p) => fs.existsSync(p));
if (!browser) { console.log('BLOCKED: thiếu trình duyệt'); process.exit(2); }
const busy = await busyPorts([WEB_PORT, CDP_PORT]);
if (busy.length) { console.log('BLOCKED: cổng đang bận ' + busy.join(', ')); process.exit(2); }

const cleanup = createCleanup({ deadlineMs: GLOBAL_DEADLINE_MS, onDeadline: () => { console.log('FAIL hết hạn toàn cục'); } });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-stack-'));
cleanup.add(() => rmDirBestEffort(profile));
const vite = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'silent', clearScreen: false,
  server: { host: '127.0.0.1', port: WEB_PORT, strictPort: true, open: false, hmr: false, watch: null } });
await vite.listen();
cleanup.add(() => vite.close());

let ws, nextId = 1, sessionId; const pending = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (method, params = {}, sess = sessionId) => withTimeout(new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sess ? { sessionId: sess } : {}) })); }), CDP_CALL_MS, 'CDP ' + method);
async function launch() {
  spawnChrome(cleanup, browser, ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1000,700', 'about:blank']);
  let info; for (let i = 0; i < 50 && !info; i++) { await sleep(200); try { info = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(1000) })).json(); } catch (e) { /* chưa sẵn sàng */ } }
  if (!info) throw new Error('Không kết nối được CDP');
  ws = new WebSocket(info.webSocketDebuggerUrl); await withTimeout(new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }), CDP_CALL_MS, 'mở WebSocket CDP');
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
  await send('Page.enable'); await send('Runtime.enable');
  return info.Browser;
}
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const VK = { Tab: 9, Escape: 27, Enter: 13 };
async function key(k, shift = false) {
  const base = { key: k, code: k, windowsVirtualKeyCode: VK[k], nativeVirtualKeyCode: VK[k], modifiers: shift ? 8 : 0 };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(60);
}
const dlg = (label) => `[...document.querySelectorAll('[role=dialog]')].find((d) => d.getAttribute('aria-label') === '${label}')`;
const state = () => ev(`(() => { const a = document.activeElement; const A = ${dlg('Hộp A')}; const B = ${dlg('Hộp B')};
  return { active: a.id || a.getAttribute('aria-label') || a.tagName, inA: !!A && A.contains(a), inB: !!B && B.contains(a), aOpen: !!A, bOpen: !!B }; })()`);
const focus = (id) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}) || ${dlg('Hộp A')}.querySelector('[aria-label="Đóng"]'); e.focus(); return document.activeElement === e; })()`);

const R = [];
const check = (name, pass, detail = '') => { R.push({ name, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };

try {
  const ver = await launch();
  console.log('Trình duyệt: ' + ver + ' (' + path.basename(browser) + '), trang: ' + PAGE);
  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 100 && !(await ev('window.READY === true').catch(() => false)); i++) await sleep(100);

  await focus('openA'); await key('Enter'); let s = await state();
  check('S0 Enter trên "Mở A" => A mở, focus trong A', s.aOpen && s.inA, JSON.stringify(s));
  await focus('openB'); await key('Enter'); s = await state();
  check('S1 Enter trên "Mở B" (trong A) => B mở, focus trong B', s.bOpen && s.inB, JSON.stringify(s));

  // S2: focus bị đưa vào hộp DƯỚI, phím phát từ chính phần tử đó.
  for (const id of ['A1', 'A2', 'openB', 'DONG_A']) {
    for (const shift of [false, true]) {
      await ev(`${dlg('Hộp B')}.querySelector('#B1').focus()`);
      const ok = await focus(id === 'DONG_A' ? '__none__' : id);
      await key('Tab', shift); s = await state();
      check(`S2 focus ở ${id === 'DONG_A' ? 'nút Đóng của A' : id} (hộp dưới) + ${shift ? 'Shift+Tab' : 'Tab'} => focus ở B`, ok && s.inB && !s.inA && s.aOpen && s.bOpen, JSON.stringify(s));
    }
  }
  // S3: focus ở nền trang / <body>.
  await focus('behind'); await key('Tab'); s = await state();
  check('S3a focus ở nút phía sau + Tab => focus ở B', s.inB, JSON.stringify(s));
  await ev('document.activeElement.blur()'); await key('Tab', true); s = await state();
  check('S3b focus ở <body> + Shift+Tab => focus ở B', s.inB, JSON.stringify(s));
  // S4: vòng Tab trong B (12 Tab + 12 Shift+Tab).
  await ev(`${dlg('Hộp B')}.querySelector('#B1').focus()`);
  let inside = 0, total = 0;
  for (const shift of [false, true]) for (let i = 0; i < 12; i++) { await key('Tab', shift); s = await state(); total++; if (s.inB) inside++; }
  check('S4 12 Tab + 12 Shift+Tab bắt đầu trong B => mọi bước ở B', inside === total, inside + '/' + total);
  // S5: Escape phát từ phần tử của hộp dưới => chỉ B đóng; A còn; focus về "Mở B".
  await focus('A1'); await key('Escape'); await sleep(100); s = await state();
  check('S5 focus ở A1 (hộp dưới) + Escape => chỉ B đóng, A còn, focus về "Mở B"', !s.bOpen && s.aOpen && s.active === 'openB', JSON.stringify(s));
  // S6: mở lại B, Escape trong B => chỉ B đóng.
  await key('Enter'); s = await state();
  check('S6a mở lại B => focus trong B', s.bOpen && s.inB, JSON.stringify(s));
  await key('Escape'); await sleep(100); s = await state();
  check('S6b Escape trong B => chỉ B đóng, focus về "Mở B"', !s.bOpen && s.aOpen && s.active === 'openB', JSON.stringify(s));
  // S7: A là hộp trên cùng => vòng Tab trong A.
  inside = 0; total = 0;
  for (const shift of [false, true]) for (let i = 0; i < 8; i++) { await key('Tab', shift); s = await state(); total++; if (s.inA) inside++; }
  check('S7 A là hộp trên cùng: 8 Tab + 8 Shift+Tab => mọi bước ở A', inside === total, inside + '/' + total);
  // S8: Escape trong A => A đóng, focus về "Mở A".
  await key('Escape'); await sleep(100); s = await state();
  check('S8 Escape trong A => A đóng, focus về "Mở A"', !s.aOpen && !s.bOpen && s.active === 'openA', JSON.stringify(s));
} catch (e) {
  check('Không lỗi khi chạy', false, String(e && e.message || e));
} finally {
  const fail = R.filter((r) => !r.pass).length;
  console.log(`Kết quả: ${R.length - fail} đạt, ${fail} lỗi.`);
  cleanup.cancelDeadline(); cleanup.run();
  process.exit(fail ? 1 : 0);
}
