// Chrome THẬT (headless, CDP) + máy chủ HTTP GIẢ trên loopback: stale-401 khi actor A -> B ở MỨC MODULE.
// Chạy tay (KHÔNG thuộc node --test mặc định):  node tests/browser/stale401ChromeModule.mjs [--mutant]
// PHẠM VI TRUNG THỰC: trang thử (test layer) nạp NGUYÊN VĂN src/auth/{authClient,loginSession,loginIdentifier}.js và
// src/data/api/{customerApiClient,customerAdapter}.js làm ES module trong Chrome, tự ghép createLoginSession -> createCustomerApi({auth})
// rồi gọi qua fetch/CORS thật tới máy chủ giả. KHÔNG phải bản build ứng dụng: App.jsx chưa nối phiên đăng nhập vào Customer API
// và không có nguồn actor trong src (AGENTS.md cấm provider giả trong src) => stale-401 A->B trên UI build vẫn NOT_RUN.
// Không sửa src, không bật route auth thật, không DB/.env; mọi socket chỉ 127.0.0.1; token là chuỗi giả.
// --mutant: phục vụ loginSession.js bị bỏ cổng "usedAuthHeader" (chỉ ở bộ nhớ máy chủ giả) để chứng minh K1 thật sự bắt được lỗi (kỳ vọng FAIL).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const MUTANT = process.argv.includes('--mutant');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // frontend/siscom-crm-web
const WEB_PORT = 4611, API_PORT = 4612, CDP_PORT = 9344;
const WEB = `http://127.0.0.1:${WEB_PORT}`, API = `http://127.0.0.1:${API_PORT}`;
const CHROMES = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
const chrome = process.env.BROWSER_EXE || CHROMES.find((p) => fs.existsSync(p));
if (!chrome) { console.log('BLOCKED: thiếu trình duyệt'); process.exit(2); }

const TOK_A = 'sid_' + 'A'.repeat(43), TOK_B = 'sid_' + 'B'.repeat(43);
const EMP = { [TOK_A]: 7, [TOK_B]: 8 };
const ALLOWED = ['src/auth/authClient.js', 'src/auth/loginSession.js', 'src/auth/loginIdentifier.js', 'src/data/api/customerApiClient.js', 'src/data/api/customerAdapter.js'];

// ---------------- Máy chủ giả: API ----------------
const holds = {}; // tên -> { release(), arrived }  : giữ phản hồi cho tới khi test nhả
const LOG = []; let holdPlan = {}; let customersMode = {}; // customersMode[token] = 'hold401' | 'hold200' | '401' | '200'
const json = (res, st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
let sessionLoginCount = 0; // login lần 1 -> A, lần 2 -> B (mỗi vòng reset)
const apiServer = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', WEB); res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,accept'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, API); let body = ''; req.on('data', (c) => (body += c));
  req.on('end', async () => {
    if (u.pathname === '/__reset') { for (const k of Object.keys(holds)) delete holds[k]; LOG.length = 0; customersMode = {}; holdPlan = {}; sessionLoginCount = 0; return json(res, 200, { ok: true }); }
    if (u.pathname === '/__log') return json(res, 200, LOG);
    if (u.pathname === '/__mode') { for (const [k, v] of u.searchParams) { if (k === 'holdMe') holdPlan.me = v; else customersMode[k] = v; } return json(res, 200, { customersMode, holdPlan }); }
    if (u.pathname === '/__arrived') return json(res, 200, { arrived: Object.keys(holds).filter((k) => holds[k].arrived) });
    if (u.pathname === '/__release') { const h = holds[u.searchParams.get('name')]; if (h) h.release(); return json(res, 200, { released: !!h }); }
    const auth = req.headers.authorization || null, tok = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    LOG.push({ m: req.method, p: u.pathname, auth, cookie: req.headers.cookie || null });
    const hold = (name) => new Promise((resolve) => { holds[name] = { arrived: true, release: resolve }; });
    if (u.pathname === '/auth/login' && req.method === 'POST') { sessionLoginCount++; return json(res, 200, { data: { token: sessionLoginCount === 1 ? TOK_A : TOK_B, expiresAt: '2026-10-25T00:00:00.000Z' } }); }
    if (u.pathname === '/auth/me') {
      if (holdPlan.me && tok === holdPlan.me) await hold('me:' + tok.slice(4, 5));
      return EMP[tok] ? json(res, 200, { data: { employeeId: EMP[tok] } }) : json(res, 401, { error: { code: 'AUTH_REQUIRED', message: 'x' } });
    }
    if (u.pathname === '/customers' && req.method === 'GET') {
      if (!EMP[tok]) return json(res, 401, { error: { code: 'AUTH_REQUIRED', message: 'x' } });
      const mode = customersMode[tok.slice(4, 5)] || '200';
      if (mode.startsWith('hold')) await hold('customers:' + tok.slice(4, 5));
      if (mode === '401' || mode === 'hold401') return json(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
      return json(res, 200, { data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 } });
    }
    json(res, 404, { error: { code: 'NOT_FOUND', message: 'route' } });
  });
});

// ---------------- Máy chủ giả: trang + module nguyên văn ----------------
const PAGE = `<!doctype html><meta charset=utf-8><title>stale401</title><script type=module>
import { createAuthClient } from '/src/auth/authClient.js';
import { createLoginSession } from '/src/auth/loginSession.js';
import { createCustomerApi, ApiError, StaleSessionError, AuthRequiredError } from '/src/data/api/customerApiClient.js';
window.H = {
  fresh() {
    const client = createAuthClient({ enabled: true, baseUrl: '${API}' });
    const session = createLoginSession(client);
    const api = createCustomerApi({ enabled: true, baseUrl: '${API}' }, undefined, { auth: session });
    window.S = session; window.A = api; return session.getState().status;
  },
  login() { return window.S.submit('nv001@siscom.vn', 'mat-khau-gia-lap').then((s) => ({ status: s.status, employeeId: s.employeeId })); },
  startList(name) { window.P = window.P || {}; window.P[name] = window.A.list({}).then((r) => ({ ok: true, total: r.total }), (e) => ({ ok: false, cls: e.constructor.name, status: e.status || null })); return true; },
  settle(name) { return window.P[name]; },
  state() { const s = window.S.getState(); return { status: s.status, employeeId: s.employeeId, error: s.error, header: window.S.getAuthHeader() }; },
};
window.READY = true;
</script>`;
const webServer = http.createServer((req, res) => {
  const u = new URL(req.url, WEB);
  if (u.pathname === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  const rel = u.pathname.slice(1);
  if (!ALLOWED.includes(rel)) { res.writeHead(404); return res.end(); }
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (MUTANT && rel === 'src/auth/loginSession.js') {
    const needle = "if (usedAuthHeader !== undefined && (token === null || usedAuthHeader !== 'Bearer ' + token)) return state;";
    if (!src.includes(needle)) { console.log('BLOCKED: không tìm thấy cổng usedAuthHeader để tạo mutant'); process.exit(2); }
    src = src.replace(needle, '');
  }
  res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end(src);
});

// ---------------- CDP tối thiểu ----------------
let ws, nextId = 1; const pending = new Map(); let sessionId; const netReqs = []; const consoleErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (method, params = {}, sess = sessionId) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sess ? { sessionId: sess } : {}) })); });
async function launch(profile) {
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1000,700', 'about:blank'], { stdio: 'ignore' });
  let info; for (let i = 0; i < 50 && !info; i++) { await sleep(200); try { info = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).json(); } catch (e) { /* chưa sẵn sàng */ } }
  if (!info) throw new Error('Không kết nối được CDP');
  ws = new WebSocket(info.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } else if (d.method) {
    if (d.method === 'Network.requestWillBeSent') netReqs.push(d.params.request.url);
    if (d.method === 'Runtime.exceptionThrown') consoleErrors.push(d.params.exceptionDetails.text);
  } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  return proc;
}
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description)); return r.result.value; };
const ctl = async (p) => (await fetch(API + p)).json();
const waitFor = async (fn, label, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(50); } throw new Error('Hết hạn chờ: ' + label); };
const arrived = async (name) => (await ctl('/__arrived')).arrived.includes(name);
const serverLog = () => ctl('/__log');

const R = [];
const check = (name, pass, detail = '') => { R.push({ name, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const begin = async () => { await ctl('/__reset'); await ev('H.fresh()'); };
const loginA = async () => { const r = await ev('H.login()'); return r; };

async function K1() { // 401 muộn của A sau khi B đăng nhập thẳng
  await begin(); await ctl('/__mode?A=hold401');
  const a = await loginA(); check('K1.0 actor A đăng nhập (employeeId 7)', a.status === 'AUTHENTICATED' && a.employeeId === 7, JSON.stringify(a));
  await ev(`H.startList('a')`); await waitFor(() => arrived('customers:A'), 'yêu cầu của A tới máy chủ');
  const b = await ev('H.login()'); check('K1.1 actor B đăng nhập thẳng, không logout (employeeId 8)', b.status === 'AUTHENTICATED' && b.employeeId === 8, JSON.stringify(b));
  await ctl('/__release?name=customers:A'); const ra = await ev(`H.settle('a')`);
  check('K1.2 yêu cầu của A nhận 401 muộn (ApiError 401)', ra.ok === false && ra.cls === 'ApiError' && ra.status === 401, JSON.stringify(ra));
  const st = await ev('H.state()');
  check('K1.3 phiên B KHÔNG bị thu hồi: AUTHENTICATED, employeeId 8, Bearer B còn nguyên', st.status === 'AUTHENTICATED' && st.employeeId === 8 && st.header === 'Bearer ' + TOK_B, JSON.stringify({ ...st, header: st.header && st.header.slice(0, 11) + '…' }));
  const rb = await (async () => { await ev(`H.startList('b')`); return ev(`H.settle('b')`); })();
  check('K1.4 sau 401 muộn, yêu cầu của B vẫn thành công (200) bằng Bearer B', rb.ok === true, JSON.stringify(rb));
  const log = (await serverLog()).filter((x) => x.p === '/customers');
  check('K1.5 máy chủ thấy đúng thứ tự: A mang Bearer A, B mang Bearer B, không cookie', log.length === 2 && log[0].auth === 'Bearer ' + TOK_A && log[1].auth === 'Bearer ' + TOK_B && log.every((x) => x.cookie === null), log.map((x) => (x.auth || '').slice(7, 12)).join(','));
}
async function K2() { // 2xx muộn của A bị bỏ
  await begin(); await ctl('/__mode?A=hold200'); await loginA();
  await ev(`H.startList('a')`); await waitFor(() => arrived('customers:A'), 'yêu cầu A');
  await ev('H.login()'); await ctl('/__release?name=customers:A'); const ra = await ev(`H.settle('a')`);
  check('K2.1 2xx muộn của A bị bỏ (StaleSessionError), không trả dữ liệu phiên cũ', ra.ok === false && ra.cls === 'StaleSessionError', JSON.stringify(ra));
  const st = await ev('H.state()'); check('K2.2 phiên B giữ nguyên', st.status === 'AUTHENTICATED' && st.employeeId === 8);
}
async function K3() { // 401 muộn của A đến khi B còn LOADING
  await begin(); await ctl('/__mode?A=hold401'); await loginA();
  await ev(`H.startList('a')`); await waitFor(() => arrived('customers:A'), 'yêu cầu A');
  await ctl('/__mode?holdMe=' + TOK_B); const pB = ev('H.login()'); // không await: me() của B bị giữ => B đang LOADING
  await waitFor(() => arrived('me:B'), 'me() của B bị giữ');
  check('K3.0 B đang LOADING khi 401 muộn của A đến', (await ev('H.state()')).status === 'LOADING');
  await ctl('/__release?name=customers:A'); await ev(`H.settle('a')`);
  check('K3.1 401 muộn của A không hủy lần đăng nhập đang chạy (vẫn LOADING)', (await ev('H.state()')).status === 'LOADING');
  await ctl('/__release?name=me:B'); const b = await pB;
  check('K3.2 B hoàn tất: AUTHENTICATED, employeeId 8', b.status === 'AUTHENTICATED' && b.employeeId === 8, JSON.stringify(b));
}
async function K4() { // đối chứng: 401 hợp lệ vẫn hủy phiên (chống test rỗng)
  await begin(); await ctl('/__mode?A=401'); await loginA();
  await ev(`H.startList('a')`); const ra = await ev(`H.settle('a')`);
  const st = await ev('H.state()');
  check('K4.1 đối chứng: 401 của CHÍNH phiên hiện tại vẫn thu hồi phiên (SESSION_EXPIRED, không còn Bearer)', ra.status === 401 && st.status === 'ERROR' && st.error === 'SESSION_EXPIRED' && st.header === null, JSON.stringify({ ...st, header: st.header }));
  const before = (await serverLog()).filter((x) => x.p === '/customers').length; await ev(`H.startList('a2')`); const r2 = await ev(`H.settle('a2')`);
  const after = (await serverLog()).filter((x) => x.p === '/customers').length;
  check('K4.2 sau thu hồi, yêu cầu kế tiếp bị chặn trước mạng (AuthRequiredError, không thêm request)', r2.cls === 'AuthRequiredError' && after === before, JSON.stringify(r2));
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'siscom-g06-'));
let proc;
try {
  await new Promise((r) => apiServer.listen(API_PORT, '127.0.0.1', r)); await new Promise((r) => webServer.listen(WEB_PORT, '127.0.0.1', r));
  proc = await launch(profile);
  await send('Page.navigate', { url: WEB + '/page' });
  await waitFor(() => ev('window.READY === true').catch(() => false), 'trang thử nạp module');
  console.log('Trình duyệt: ' + (await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).json()).Browser + (MUTANT ? ' | CHẾ ĐỘ MUTANT (kỳ vọng FAIL ở K1.3)' : ''));
  for (const k of [K1, K2, K3, K4]) { try { await k(); } catch (e) { check(k.name + ' (ngoại lệ harness)', false, String(e.message).slice(0, 200)); } }
  const offLoop = netReqs.filter((u) => /^https?:/.test(u) && !/^http:\/\/127\.0\.0\.1:(4611|4612)\//.test(u));
  check('Z1 mọi yêu cầu mạng của Chrome chỉ tới loopback 127.0.0.1:4611/4612', offLoop.length === 0, offLoop.slice(0, 3).join(' '));
  check('Z2 không có ngoại lệ JS chưa bắt trong trang', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
} catch (e) { console.log('LỖI HARNESS: ' + e.message); R.push({ name: 'harness', pass: false }); }
finally {
  try { ws && ws.close(); } catch (e) { /* bỏ qua */ } if (proc) proc.kill(); apiServer.close(); webServer.close();
  await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* bỏ qua */ }
}
const failed = R.filter((r) => !r.pass);
console.log(`\nTỔNG: ${R.length - failed.length}/${R.length} PASS${MUTANT ? ' (mutant)' : ''}` + (failed.length ? ' | FAIL: ' + failed.map((f) => f.name.split(' ')[0]).join(', ') : ''));
process.exit(failed.length ? 1 : 0);
