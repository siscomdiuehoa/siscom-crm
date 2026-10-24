// Smoke test TRÌNH DUYỆT THẬT (Chrome/Edge headless qua CDP) với API GIẢ — không backend, không DB, không phụ thuộc mới.
// Chạy tay (KHÔNG thuộc kiểm tra mặc định): node tests/browser/browserSmoke.mjs <thư-mục-dist-gốc>
//   <thư-mục-dist-gốc> chứa 3 bản build: off/ (cờ tắt), login/ (VITE_CRM_LOGIN_PREVIEW_ENABLED=true),
//   api/ (VITE_CRM_API_ENABLED=true, VITE_CRM_API_BASE=http://127.0.0.1:4599). Xem tests/browser/README.md.
// Máy chủ giả chỉ lắng nghe 127.0.0.1; không có xác thực thật, "đăng nhập" luôn bị từ chối.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler, busyPorts, listenOnLoopback, withTimeout, createCleanup, spawnChrome, rmDirBestEffort } from './harnessGuard.mjs';

const CDP_CALL_MS = 15000, GLOBAL_DEADLINE_MS = 600000;
const DIST = path.resolve(process.argv[2] || '');
const API_PORT = 4599, WEB_PORT = 4600, CDP_PORT = 9333;
const CHROMES = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
const chrome = process.env.BROWSER_EXE || CHROMES.find((p) => fs.existsSync(p));
if (!chrome || !fs.existsSync(DIST)) { console.log('BLOCKED: thiếu trình duyệt hoặc thư mục dist'); process.exit(2); }

// ---------------- API giả ----------------
const mk = (i) => ({ id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), code: 'KH-' + String(i).padStart(4, '0'), name: 'Công ty Thử ' + i, shortName: 'Thử ' + i, phone: '0900000' + String(i).padStart(3, '0'),
  tier: { code: 'B', label: 'Hạng B' }, status: { code: 'ACTIVE', label: 'Đang giao dịch' }, industry: { code: 'IT', label: 'CNTT' }, source: null, province: { code: 'HCM', label: 'TP.HCM' }, owner: { id: 'o1', fullName: 'NV Giả' }, version: 1, createdAt: '2026-10-01T00:00:00Z', tags: [] });
const DB = Array.from({ length: 45 }, (_, i) => mk(i + 1));
const S = {}; const LOG = [];
const reset = () => { for (const k of Object.keys(S)) delete S[k]; LOG.length = 0; DB.splice(0, DB.length, ...Array.from({ length: 45 }, (_, i) => mk(i + 1))); };
const lookups = { customer_tier: [{ code: 'A', label: 'Hạng A' }, { code: 'B', label: 'Hạng B' }], customer_status: [{ code: 'ACTIVE', label: 'Đang giao dịch' }], industry: [{ code: 'IT', label: 'CNTT' }], source: [{ code: 'WEB', label: 'Website' }], province: [{ code: 'HCM', label: 'TP.HCM' }] };
const err = (res, st, code, message) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code, message } })); };
const ok = (res, data, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };
const apiServer = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', '*'); res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (u.pathname === '/__set') { for (const [k, v] of u.searchParams) S[k] = v; return ok(res, S); }
    if (u.pathname === '/__reset') { reset(); return ok(res, true); }
    if (u.pathname === '/__log') return ok(res, LOG);
    LOG.push({ m: req.method, p: u.pathname, q: u.search, auth: req.headers.authorization || null, cookie: req.headers.cookie || null, body: body ? JSON.parse(body) : null });
    const gate = S[req.method + ':' + u.pathname.split('/')[1]] || S[req.method];
    if (gate === '401') return err(res, 401, 'AUTH_REQUIRED', 'Chưa đăng nhập');
    if (gate === '403') return err(res, 403, 'FORBIDDEN', 'Không đủ quyền');
    if (gate === '429') return err(res, 429, 'TOO_MANY_REQUESTS', 'Quá nhiều yêu cầu');
    if (u.pathname === '/lookups') return ok(res, lookups);
    if (u.pathname === '/customers' && req.method === 'GET') {
      const page = Number(u.searchParams.get('page') || 1), ps = Number(u.searchParams.get('pageSize') || 20), q = (u.searchParams.get('search') || '').toLowerCase();
      const all = q ? DB.filter((c) => (c.name + c.code).toLowerCase().includes(q)) : DB;
      return ok(res, { items: all.slice((page - 1) * ps, page * ps), page, pageSize: ps, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / ps)) });
    }
    if (u.pathname === '/customers' && req.method === 'POST') { const b = JSON.parse(body); const c = { ...mk(DB.length + 1), name: b.name, shortName: b.shortName || null, phone: b.phone }; DB.unshift(c); return ok(res, c, 201); }
    const m = u.pathname.match(/^\/customers\/([^/]+)$/);
    if (m) {
      const c = DB.find((x) => x.id === m[1]); if (!c) return err(res, 404, 'NOT_FOUND', 'Không có');
      if (req.method === 'GET') return ok(res, c);
      if (req.method === 'PATCH') {
        const b = JSON.parse(body);
        if (S.patch === '409' || b.version !== c.version) return err(res, 409, 'CUSTOMER_VERSION_CONFLICT', 'Phiên bản đã cũ');
        Object.assign(c, { name: b.name, phone: b.phone, version: c.version + 1 }); return ok(res, c);
      }
    }
    err(res, 404, 'NOT_FOUND', 'route');
  });
});

// ---------------- Máy chủ tĩnh ----------------
const webServer = http.createServer(createStaticHandler(DIST));

// ---------------- CDP tối thiểu ----------------
let ws, nextId = 1; const pending = new Map(); const events = []; let sessionId;
const send = (method, params = {}, sess = sessionId) => withTimeout(new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sess ? { sessionId: sess } : {}) })); }), CDP_CALL_MS, 'CDP ' + method);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const netReqs = []; const consoleErrors = [];
async function launch(profile) {
  spawnChrome(cleanup, chrome, ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1400,900', 'about:blank']);
  let info; for (let i = 0; i < 50 && !info; i++) { await sleep(200); try { info = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(1000) })).json(); } catch (e) { /* chưa sẵn sàng */ } }
  if (!info) throw new Error('Không kết nối được CDP');
  ws = new WebSocket(info.webSocketDebuggerUrl); await withTimeout(new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }), CDP_CALL_MS, 'mở WebSocket CDP');
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('CDP đóng kết nối')); pending.clear(); };
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } else if (d.method) {
    if (d.method === 'Network.requestWillBeSent') netReqs.push({ method: d.params.request.method, url: d.params.request.url });
    if (d.method === 'Runtime.exceptionThrown') consoleErrors.push(d.params.exceptionDetails.text + ' ' + ((d.params.exceptionDetails.exception || {}).description || ''));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErrors.push(d.params.args.map((a) => a.value || a.description).join(' '));
  } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
}
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description)); return r.result.value; };
// about:blank trước để luôn tải lại tài liệu (điều hướng chỉ khác phần #hash sẽ KHÔNG tải lại, giữ nguyên state React cũ)
const goto = async (url) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(150); await send('Page.navigate', { url }); await sleep(900); };
const waitFor = async (expr, label, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) { /* trang đang tải */ } await sleep(100); } throw new Error('Hết hạn chờ: ' + label); };
const focusSel = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.focus();return document.activeElement===e})()`);
const typeInto = async (sel, text) => { if (!(await focusSel(sel))) throw new Error('Không focus được ' + sel); await send('Input.insertText', { text }); };
const key = (k, extra = {}) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27 }[k], text: k === 'Enter' ? '\r' : undefined, ...extra }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27 }[k] }));
const clickText = (txt, sel = 'button') => ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().includes(${JSON.stringify(txt)})&&!x.disabled);if(!b)return false;b.click();return true})()`);
const setApi = (k, v) => fetch(`http://127.0.0.1:${API_PORT}/__set?${k}=${v}`);
const apiLog = async () => (await (await fetch(`http://127.0.0.1:${API_PORT}/__log`)).json()).data;
const text = () => ev('document.body.innerText');
const flat = async () => (await text()).replace(/\s+/g, ' ');

// ---------------- Kết quả ----------------
const R = [];
// known=true: lỗi ĐÃ BIẾT đã có PR sửa riêng (không tính vào FAIL, chỉ in KNOWN để không che giấu).
const check = (name, pass, detail = '', known = false) => { R.push({ name, pass: !!pass || known, detail }); console.log((pass ? 'PASS ' : known ? 'KNOWN ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const base = (d) => `http://127.0.0.1:${WEB_PORT}/${d}/index.html`;
const apiNetCount = () => netReqs.filter((r) => r.url.startsWith(`http://127.0.0.1:${API_PORT}`) && !r.url.includes('/__')).length;

async function scenarioOff() {
  console.log('--- A. Cờ TẮT (mặc định) ---');
  netReqs.length = 0; await fetch(`http://127.0.0.1:${API_PORT}/__reset`);
  await goto(base('off') + '#/customers'); await waitFor(`document.body.innerText.includes('Quản lý khách hàng')`, 'trang khách hàng demo');
  check('A1 cờ TẮT: ứng dụng demo hiển thị danh sách khách hàng', true);
  check('A2 cờ TẮT: không có yêu cầu mạng tới API', apiNetCount() === 0, 'số yêu cầu tới API = ' + apiNetCount());
  check('A3 cờ TẮT: không có màn hình đăng nhập, có biểu ngữ dữ liệu minh hoạ', !(await ev(`!!document.querySelector('#login-identifier')`)) && (await text()).includes('dữ liệu minh hoạ'));
  check('A4 cờ TẮT: dữ liệu demo nằm ở localStorage (hành vi cũ giữ nguyên)', await ev(`!!localStorage.getItem('siscom-crm-db-v2')`));
}

async function scenarioLogin() {
  console.log('--- B. Xem thử đăng nhập (cờ BẬT) ---');
  netReqs.length = 0; await fetch(`http://127.0.0.1:${API_PORT}/__reset`);
  await goto(base('login')); await waitFor(`!!document.querySelector('#login-identifier')`, 'form đăng nhập');
  check('B1 form đăng nhập hiển thị, không có shell CRM', !(await text()).includes('Quản lý khách hàng') && !!(await ev(`!!document.querySelector('form')`)));
  check('B2 mật khẩu mặc định bị che (type=password)', (await ev(`document.querySelector('#login-password').type`)) === 'password');
  // Bàn phím: Tab từ định danh -> mật khẩu
  await focusSel('#login-identifier'); await key('Tab');
  check('B3 Tab chuyển focus sang ô mật khẩu', (await ev(`document.activeElement.id`)) === 'login-password', 'activeElement=' + (await ev(`document.activeElement.id`)));
  // Enter với dữ liệu rỗng
  await focusSel('#login-identifier'); await key('Enter'); await sleep(300);
  check('B4 Enter khi trống: hiện lỗi, focus về trường lỗi đầu, aria-invalid', (await ev(`document.querySelector('#login-identifier').getAttribute('aria-invalid')`)) === 'true' && (await ev(`document.activeElement.id`)) === 'login-identifier', 'text=' + (await text()).replace(/\s+/g, ' ').slice(0, 160));
  // Định danh hợp lệ + mật khẩu, Enter từ ô mật khẩu
  await typeInto('#login-identifier', 'nv001@siscom.vn'); await typeInto('#login-password', 'MatKhau-Gia-123');
  await key('Enter'); await sleep(500);
  const t = await text();
  check('B5 Enter từ ô mật khẩu gửi form; luôn bị từ chối "chưa khả dụng" (không đăng nhập)', /chưa khả dụng|chưa đăng nhập được/i.test(t), t.replace(/\s+/g, ' ').slice(0, 200));
  check('B6 sau khi gửi, ô mật khẩu được xoá và vẫn che', (await ev(`document.querySelector('#login-password').value`)) === '' && (await ev(`document.querySelector('#login-password').type`)) === 'password');
  check('B7 không có shell CRM / dữ liệu khách hàng sau khi gửi (luôn chưa xác thực)', !(await text()).includes('Quản lý khách hàng') && !(await text()).includes('Công ty'));
  // Nút hiện/ẩn mật khẩu
  await typeInto('#login-password', 'abc'); await clickText('Hiện');
  const shown = await ev(`document.querySelector('#login-password').type`); await clickText('Ẩn');
  check('B8 nút Hiện đổi type=text, Ẩn trả về password', shown === 'text' && (await ev(`document.querySelector('#login-password').type`)) === 'password', 'sau Hiện: ' + shown);
  const store = await ev(`JSON.stringify([localStorage,sessionStorage].map(s=>Object.keys(s).map(k=>k+'='+s.getItem(k))))`);
  check('B9 không lưu mật khẩu/định danh vào localStorage/sessionStorage/cookie', !/MatKhau|nv001|abc/.test(store + (await ev('document.cookie'))), store.slice(0, 120));
  check('B10 màn hình đăng nhập không gọi API nào', apiNetCount() === 0, 'số yêu cầu = ' + apiNetCount());
  // B11: lỗi hiển thị mâu thuẫn sau khi gửi hợp lệ (tải lại sạch để không dính trạng thái B4)
  await goto(base('login')); await waitFor(`!!document.querySelector('#login-identifier')`, 'form đăng nhập 2');
  await typeInto('#login-identifier', 'nv001@siscom.vn'); await typeInto('#login-password', 'MatKhau-Gia-123'); await key('Enter'); await sleep(500);
  const pwState = await ev(`JSON.stringify({invalid: document.querySelector('#login-password').getAttribute('aria-invalid'), err: !!document.querySelector('#login-password-error'), banner: !!document.querySelector('#login-banner')})`);
  check('B11 sau khi gửi hợp lệ, ô mật khẩu đã xoá KHÔNG bị báo lỗi "Vui lòng nhập mật khẩu" (chỉ banner máy chủ)', JSON.parse(pwState).banner && !JSON.parse(pwState).err && JSON.parse(pwState).invalid === 'false', pwState + ' | ' + (await flat()).slice(0, 220));
}

async function openCustomerApp() {
  netReqs.length = 0; await fetch(`http://127.0.0.1:${API_PORT}/__reset`);
  await ev(`localStorage.clear()`).catch(() => {});
}

async function scenarioApi() {
  console.log('--- C. Khách hàng qua API giả (cờ BẬT) ---');
  await goto(base('api')); await ev(`localStorage.clear()`); await fetch(`http://127.0.0.1:${API_PORT}/__reset`); netReqs.length = 0;
  await goto(base('api') + '#/customers'); await waitFor(`document.body.innerText.includes('Trang 1/3')`, 'danh sách trang 1');
  let log = await apiLog();
  check('C1 danh sách tải từ API (GET /customers?page=1&pageSize=20), phân trang 45 bản ghi / 3 trang', log.some((l) => l.p === '/customers' && l.q.includes('page=1') && l.q.includes('pageSize=20')) && (await text()).includes('45 khách hàng'));
  check('C2 yêu cầu API không gửi Authorization/cookie (ranh giới hiện tại)', log.every((l) => !l.auth && !l.cookie));
  await clickText('Sau'); await waitFor(`document.body.innerText.includes('Trang 2/3')`, 'trang 2');
  check('C3 bấm "Sau" -> yêu cầu page=2', (await apiLog()).some((l) => l.q.includes('page=2')));
  await clickText('Trước'); await waitFor(`document.body.innerText.includes('Trang 1/3')`, 'về trang 1');
  // Tìm kiếm: 1 ký tự không gửi; Enter với 2+ ký tự gửi
  await typeInto('form[role=search]:has(button[type=submit]) input', 'T'); const before = (await apiLog()).length; await key('Enter'); await sleep(300);
  check('C4 tìm 1 ký tự: không gửi yêu cầu, hiện gợi ý tối thiểu 2 ký tự', (await apiLog()).length === before && (await text()).includes('ít nhất 2 ký tự'), 'form=' + (await ev('document.querySelector("form[role=search]:has(button[type=submit])").innerText')).replace(/\s+/g, ' '));
  await typeInto('form[role=search]:has(button[type=submit]) input', 'hử 4'); await key('Enter'); await sleep(800);
  check('C5 Enter trong ô tìm kiếm (≥2 ký tự) gửi search="Thử 4" về trang 1', (await apiLog()).some((l) => decodeURIComponent(l.q.replace(/\+/g, ' ')).includes('search=Thử 4') && l.q.includes('page=1')), ((await text()).match(/Kết quả tìm[^\n]*/) || ['không thấy "Kết quả tìm"'])[0]);
  await waitFor(`document.body.innerText.includes('Kết quả tìm')`, 'kết quả tìm kiếm');
  await clickText('Bỏ tìm kiếm'); await waitFor(`document.body.innerText.includes('Trang 1/3')`, 'bỏ tìm kiếm');

  // Tạo mới / Sửa: bản build thật KHÔNG có actor máy chủ (chưa có nguồn cấp quyền) -> UI fail-closed (PR #94). Luồng ghi 401/403/409 + tạo/sửa thành công
  // được kiểm trong test jsdom (customerApiUiNavigation/Components) bằng actor có quyền chỉ tồn tại trong tests/. Ở đây chỉ khẳng định bị khoá và KHÔNG gọi ghi.
  const writesBefore = (await apiLog()).filter((l) => l.m !== 'GET').length;
  const createDisabled = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes('Thêm khách hàng'));return !!b&&b.disabled})()`);
  check('C6 API không có actor máy chủ: nút "Thêm khách hàng" bị khoá (fail-closed)', createDisabled === true);
  const clickedCreate = await clickText('Thêm khách hàng'); await sleep(400);
  check('C7 bấm "Thêm khách hàng" khi bị khoá: không mở form, không gọi /lookups ghi hay POST', clickedCreate === false && !(await ev(`!!document.querySelector('[role=dialog]')`)) && (await apiLog()).filter((l) => l.m !== 'GET').length === writesBefore);
  const id = '00000000-0000-4000-8000-000000000005';
  await fetch(`http://127.0.0.1:${API_PORT}/__set?patch=ok`);
  await goto(base('api') + '#/customers/' + id); await waitFor(`document.body.innerText.includes('Công ty Thử 5')`, 'chi tiết');
  check('C13 chi tiết khách hàng tải từ GET /customers/:id', (await apiLog()).some((l) => l.p === '/customers/' + id));
  const editDisabled = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes('Sửa thông tin'));return !!b&&b.disabled})()`);
  const clickedEdit = await clickText('Sửa thông tin'); await sleep(400);
  check('C14 "Sửa thông tin" bị khoá khi chưa có actor máy chủ: bấm không mở form, không PATCH', editDisabled === true && clickedEdit === false && !(await ev(`!!document.querySelector('[role=dialog]')`)) && !(await apiLog()).some((l) => l.m === 'PATCH'));
  check('C16 chi tiết/danh sách không ghi dữ liệu API vào localStorage', !(await ev(`JSON.stringify(Object.entries(localStorage))`)).includes('Công ty Thử'));
  await setApi('patch', 'ok');
  // 401/403 trên danh sách
  await setApi('GET', '401'); await goto(base('api') + '#/customers'); await sleep(900);
  const t401 = await text();
  check('C17 401 trên danh sách: hiện lỗi "Chưa đăng nhập", KHÔNG hiện dữ liệu demo/cũ', t401.includes('Chưa đăng nhập') && !t401.includes('Công ty Thử 1') && !/Trang \d+\/\d+/.test(t401), t401.replace(/\s+/g, ' ').slice(0, 500));
  await setApi('GET', '403'); await goto(base('api') + '#/customers'); await sleep(900);
  check('C18 403 trên danh sách: hiện "Không đủ quyền"', (await text()).includes('Không đủ quyền'), (await flat()).slice(0, 500));
  await setApi('GET', 'ok');
  check('C19 không có lỗi JS chưa bắt trong console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
}

async function scenarioBothFlags() {
  console.log('--- D. Cả hai cờ BẬT (đăng nhập xem thử + API): đăng nhập không thành công khi chưa có backend ---');
  await goto(base('both')); await ev(`localStorage.clear()`); await fetch(`http://127.0.0.1:${API_PORT}/__reset`); netReqs.length = 0;
  await goto(base('both') + '#/customers'); await waitFor(`!!document.querySelector('#login-identifier')`, 'form đăng nhập (cờ kép)');
  check('D1 cả hai cờ: vào thẳng #/customers vẫn chỉ thấy form đăng nhập, không thấy khách hàng', !(await text()).includes('Quản lý khách hàng') && !(await text()).includes('Công ty'));
  for (const [tag, ident] of [['mã nhân viên NV-0001', 'NV-0001'], ['email', 'nv001@siscom.vn']]) {
    await goto(base('both')); await waitFor(`!!document.querySelector('#login-identifier')`, 'form ' + tag);
    await typeInto('#login-identifier', ident); await typeInto('#login-password', 'MatKhau-Gia-123'); await key('Enter'); await sleep(500);
    const t = await text();
    check('D2 (' + tag + ') luôn bị từ chối, không vào CRM', /chưa khả dụng|chưa đăng nhập được/i.test(t) && !t.includes('Quản lý khách hàng'), t.replace(/\s+/g, ' ').slice(0, 120));
    check('D3 (' + tag + ') mật khẩu đã xoá khỏi ô nhập, không báo lỗi trường mật khẩu', (await ev(`document.querySelector('#login-password').value`)) === '' && !(await ev(`!!document.querySelector('#login-password-error')`)));
  }
  await clickText('Đăng nhập'); await clickText('Đăng nhập'); await sleep(300);
  check('D4 bấm Đăng nhập lặp lại vẫn không vào CRM', !(await text()).includes('Quản lý khách hàng'));
  const store = (await ev(`JSON.stringify([localStorage,sessionStorage].map(s=>Object.entries(s)))`)) + (await ev('document.cookie'));
  check('D5 không lưu mật khẩu/NV-0001/email/token vào storage hoặc cookie', !/MatKhau|NV-0001|nv001|token|bearer/i.test(store), store.slice(0, 100));
  check('D6 không có yêu cầu mạng tới API (đăng nhập xem thử không gọi mạng)', apiNetCount() === 0 && (await apiLog()).length === 0, 'số yêu cầu = ' + apiNetCount());
}

async function scenarioApiRepeat() {
  console.log('--- E. API giả: sửa thành công + yêu cầu lặp ---');
  await goto(base('api')); await ev(`localStorage.clear()`); await fetch(`http://127.0.0.1:${API_PORT}/__reset`); netReqs.length = 0;
  await goto(base('api') + '#/customers'); await waitFor(`document.body.innerText.includes('Trang 1/3')`, 'danh sách E');
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes('Sau')&&!x.disabled);b.click();b.click();b.click();return true})()`); await sleep(900);
  const pg = (await text()).match(/Trang (\d+)\/(\d+)/);
  const first = await ev(`(document.querySelector('tbody tr')||{innerText:''}).innerText`);
  check('E1 bấm Sau nhiều lần liên tiếp: giao diện nhất quán (trang hợp lệ, có dòng dữ liệu)', pg && Number(pg[1]) >= 2 && Number(pg[1]) <= 3 && first.length > 0, (pg && pg[0]) + ' | ' + first.replace(/\s+/g, ' ').slice(0, 60));
  const id = '00000000-0000-4000-8000-000000000007';
  await setApi('patch', 'ok'); await goto(base('api') + '#/customers/' + id); await waitFor(`document.body.innerText.includes('Công ty Thử 7')`, 'chi tiết E');
  const editDisabledE = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes('Sửa thông tin'));return !!b&&b.disabled})()`);
  await clickText('Sửa thông tin'); await sleep(400);
  const patches = (await apiLog()).filter((l) => l.m === 'PATCH');
  check('E2 "Sửa thông tin" bị khoá (fail-closed): không mở form, không có PATCH nào', editDisabledE === true && !(await ev(`!!document.querySelector('[role=dialog]')`)) && patches.length === 0, 'PATCH = ' + patches.length);
  check('E3 tên cũ từ máy chủ vẫn hiển thị, không ghi vào localStorage', (await text()).includes('Công ty Thử 7') && !(await ev(`JSON.stringify(Object.entries(localStorage))`)).includes('Công ty Thử 7'));
  check('E4 không có lỗi JS chưa bắt trong console (kịch bản D/E)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
}

async function scenarioCustomer429() {
  console.log('--- F. Customer API 429 (API giả): fail-closed, không retry/logout/demo, nút Thử lại ---');
  await goto(base('api')); await ev(`localStorage.clear()`); await fetch(`http://127.0.0.1:${API_PORT}/__reset`); netReqs.length = 0; consoleErrors.length = 0;
  const listCalls = async () => (await apiLog()).filter((l) => l.p === '/customers').length;
  await setApi('GET', '429'); await goto(base('api') + '#/customers'); await sleep(1500);
  const t = await flat(); const n1 = await listCalls(); await sleep(2500); const n2 = await listCalls();
  check('X1 429 trên danh sách: hiện "Yêu cầu thất bại (429)", KHÔNG hiện dữ liệu demo/cũ', t.includes('Yêu cầu thất bại (429)') && !t.includes('Công ty Thử 1') && !/Trang \d+\/\d+/.test(t), t.slice(0, 300));
  check('X2 429: đúng 1 yêu cầu danh sách, không tự thử lại sau 2,5 giây', n1 === 1 && n2 === n1, n1 + ' -> ' + n2);
  check('X3 429: không rơi về demo (localStorage không có dữ liệu khách hàng)', !(await ev(`JSON.stringify(Object.entries(localStorage))`)).includes('Công ty'));
  check('X4 429: không chuyển sang đăng nhập, không hiện lỗi 401 "Chưa đăng nhập"', !(await ev(`!!document.querySelector('#login-identifier')`)) && !t.includes('Chưa đăng nhập'));
  await setApi('GET', 'ok'); const clickedRetry = await clickText('Thử lại'); await sleep(1200);
  check('X5 hết 429: bấm "Thử lại" tải lại được danh sách (đúng 1 yêu cầu mới)', clickedRetry === true && /Trang 1\/3/.test(await flat()) && (await listCalls()) === n2 + 1, 'clickedRetry=' + clickedRetry);
  check('X6 kịch bản 429 không có lỗi JS chưa bắt trong console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
}

const busy = await busyPorts([API_PORT, WEB_PORT, CDP_PORT]);
if (busy.length) { console.log('BLOCKED: cổng loopback đang bị chiếm (có thể Chrome/harness cũ còn treo): ' + busy.join(', ')); process.exit(2); }
const cleanup = createCleanup({ deadlineMs: GLOBAL_DEADLINE_MS });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-browser-'));
cleanup.add(() => rmDirBestEffort(profile));
try {
  await listenOnLoopback(apiServer, API_PORT); await listenOnLoopback(webServer, WEB_PORT);
  cleanup.add(() => { apiServer.close(); webServer.close(); });
  await launch(profile);
  console.log('Trình duyệt:', chrome, '|', (await send('Browser.getVersion', {}, undefined)).product);
  for (const s of [scenarioOff, scenarioLogin, scenarioApi, scenarioBothFlags, scenarioApiRepeat, scenarioCustomer429]) { try { await s(); } catch (e) { check('LỖI KỊCH BẢN ' + s.name, false, e.message); } }
} finally {
  try { ws && ws.close(); } catch (e) { /* bỏ qua */ }
  cleanup.run(); cleanup.cancelDeadline();
}
const failed = R.filter((r) => !r.pass);
console.log(`\nTỔNG: ${R.length - failed.length}/${R.length} đạt`); failed.forEach((f) => console.log('  FAIL: ' + f.name + ' — ' + f.detail));
process.exit(failed.length ? 1 : 0);
