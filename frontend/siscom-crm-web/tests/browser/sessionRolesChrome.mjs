// E2E TRÌNH DUYỆT THẬT (Chrome/Edge headless qua CDP) + BACKEND THẬT + DATABASE THỬ: đăng nhập phiên cookie cho 4 vai trò (PR 5/5 MVP).
// Chạy tay, KHÔNG thuộc node --test mặc định, không dependency mới (Node >= 22: fetch + WebSocket toàn cục).
//   node tests/browser/sessionRolesChrome.mjs
// Điều kiện trước khi chạy (xem docs/B1.3_DEMO_PACK.md):
//   1. Backend thật đang chạy trên DB THỬ đã migrate + bootstrap: backend\scripts\windows\auth-demo-stack.bat -Step start -DatabaseName siscom_crm_test_…
//   2. FE build với VITE_CRM_AUTH_ENABLED=true + VITE_CRM_API_ENABLED=true (+ VITE_CRM_API_BASE=/api/v1) và phục vụ bằng `npm run preview`
//      (vite preview có proxy /api -> backend => cùng origin http://127.0.0.1:4173).
// Biến môi trường: BOOTSTRAP_PASSWORD_ADMIN / _SALE / _TECHNICIAN / _ACCOUNTANT (bắt buộc, giống lúc bootstrap; KHÔNG in ra),
//   E2E_WEB (mặc định http://127.0.0.1:4173), E2E_API (http://127.0.0.1:3000), E2E_EMAIL_DOMAIN (siscom.local),
//   E2E_EVIDENCE (đường dẫn JSON bằng chứng; mặc định docs/evidence/b1.3_e2e_session_roles_<thời điểm>.json), E2E_CDP_PORT (9355), BROWSER_EXE.
// Phạm vi ghi: tạo 1 khách hàng trong DB THỬ (bằng crm_admin) để chứng minh phạm vi đọc OWN/DEPARTMENT/ALL. Mọi socket chỉ 127.0.0.1;
// hostname của E2E_WEB/E2E_API bắt buộc 127.0.0.1 (Chrome chạy với host-resolver chỉ cho loopback). Không bao giờ trỏ siscom_crm_dev
// (harness không biết DB; backend do auth-demo-stack.ps1 khởi động đã kiểm tra tên DB thử).
// Mã thoát: 0 = đạt (có thể có KNOWN), 1 = có FAIL, 2 = BLOCKED (thiếu trình duyệt / backend / FE / mật khẩu).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { busyPorts, withTimeout, createCleanup, spawnChrome, rmDirBestEffort } from './harnessGuard.mjs';

const CDP_CALL_MS = 15000, GLOBAL_DEADLINE_MS = 300000;
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9355);
const WEB = (process.env.E2E_WEB || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const API = (process.env.E2E_API || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const DOMAIN = process.env.E2E_EMAIL_DOMAIN || 'siscom.local';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const EVIDENCE = process.env.E2E_EVIDENCE || path.join(REPO, 'docs', 'evidence', 'b1.3_e2e_session_roles_' + STAMP + '.json');
const CHROMES = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
const chrome = process.env.BROWSER_EXE || CHROMES.find((p) => fs.existsSync(p));

// Ma trận V2 đã duyệt (bootstrap.ts BIZ). Thứ tự chạy: crm_admin tạo khách trước để các vai trò sau chứng minh phạm vi đọc/ghi.
// onCreated = mã HTTP kỳ vọng khi vai trò đó xem (GET /customers/:id) / sửa (PATCH) khách do crm_admin tạo (KHÔNG có chủ sở hữu, B3 chưa có):
//   xem ngoài phạm vi => 404 (không lộ sự tồn tại); sửa không có quyền customer.update => 403; có quyền OWN nhưng ngoài phạm vi => 404.
const BIZ_KEYS = ['customer.read', 'customer.create', 'customer.update', 'customer.delete', 'customer.restore', 'contact.read', 'contact.create', 'lookup.read'];
const ROLES = [
  { key: 'admin', local: 'admin', dbRole: 'crm_admin', label: 'Quản trị CRM', expect: { 'customer.read': 'ALL', 'customer.create': 'ALL', 'customer.update': 'ALL', 'customer.delete': 'ALL', 'customer.restore': 'ALL', 'contact.read': 'ALL', 'contact.create': 'ALL', 'lookup.read': 'ALL' }, seesCreated: true, onCreated: { view: 200, update: 200 }, candidates: { status: 200, scope: 'ALL', min: 5 } },
  { key: 'accountant', local: 'ketoan', dbRole: 'accountant', label: 'Kế toán', expect: { 'customer.read': 'ALL', 'contact.read': 'ALL', 'lookup.read': 'ALL' }, seesCreated: true, onCreated: { view: 200, update: 403 }, candidates: { status: 403 } },
  { key: 'technician', local: 'kythuat', dbRole: 'technician', label: 'Kỹ thuật', expect: { 'customer.read': 'DEPARTMENT', 'contact.read': 'DEPARTMENT', 'lookup.read': 'ALL' }, seesCreated: false, onCreated: { view: 404, update: 403 }, candidates: { status: 403 } },
  { key: 'sale', local: 'sale', dbRole: 'sales', label: 'Kinh doanh', expect: { 'customer.read': 'OWN', 'customer.create': 'OWN', 'customer.update': 'OWN', 'contact.read': 'OWN', 'contact.create': 'OWN', 'lookup.read': 'ALL' }, seesCreated: false, onCreated: { view: 404, update: 404 }, candidates: { status: 200, scope: 'OWN', min: 1, max: 1, self: true } },
];
const pwOf = (r) => process.env['BOOTSTRAP_PASSWORD_' + r.key.toUpperCase()];

// ---------------- Kết quả ----------------
const results = []; const roleEvidence = {}; let createdCode = null; let createdId = null; let createdVersion = null; let adminEmployeeId = null;
const rec = (id, status, detail) => { results.push({ id, status, detail: detail || '' }); console.log('[' + status + '] ' + id + (detail ? ' — ' + detail : '')); };
const check = (id, ok, detail) => rec(id, ok ? 'PASS' : 'FAIL', detail);
const blocked = (msg) => { console.log('BLOCKED: ' + msg); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Tiền kiểm ----------------
for (const u of [WEB, API]) { const h = new URL(u).hostname; if (h !== '127.0.0.1') blocked('E2E_WEB/E2E_API phải dùng hostname 127.0.0.1 (đang là ' + h + ')'); }
if (!chrome) blocked('thiếu trình duyệt (Chrome/Edge) — đặt BROWSER_EXE');
const missing = ROLES.filter((r) => !pwOf(r)).map((r) => 'BOOTSTRAP_PASSWORD_' + r.key.toUpperCase());
if (missing.length) blocked('thiếu biến môi trường mật khẩu thử: ' + missing.join(', '));
const busy = await busyPorts([CDP_PORT]);
if (busy.length) blocked('cổng CDP ' + busy.join(',') + ' đang bị chiếm');
try { const h = await fetch(API + '/api/v1/health', { signal: AbortSignal.timeout(3000) }); if (!h.ok) blocked('backend /api/v1/health trả ' + h.status); } catch (e) { blocked('không tới được backend ' + API + ' (' + e.message + ') — chạy auth-demo-stack.bat -Step start'); }
try { const w = await fetch(WEB + '/', { signal: AbortSignal.timeout(3000) }); if (!w.ok) blocked('FE trả ' + w.status); } catch (e) { blocked('không tới được FE ' + WEB + ' (' + e.message + ') — build + npm run preview'); }
try { const p = await fetch(WEB + '/api/v1/health', { signal: AbortSignal.timeout(3000) }); if (!p.ok) blocked('proxy /api của FE trả ' + p.status + ' (vite preview phải có proxy /api)'); } catch (e) { blocked('proxy /api của FE không hoạt động: ' + e.message); }

// ---------------- CDP tối thiểu (như browserSmoke.mjs) ----------------
const cleanup = createCleanup({ deadlineMs: GLOBAL_DEADLINE_MS });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'siscom-e2e-roles-'));
cleanup.add(() => rmDirBestEffort(profile));
let ws, nextId = 1; const pending = new Map(); let sessionId; const consoleErrors = [];
const send = (method, params = {}, sess = sessionId) => withTimeout(new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sess ? { sessionId: sess } : {}) })); }), CDP_CALL_MS, 'CDP ' + method);
async function launch() {
  spawnChrome(cleanup, chrome, ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1400,900', 'about:blank']);
  let info; for (let i = 0; i < 50 && !info; i++) { await sleep(200); try { info = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(1000) })).json(); } catch (e) { /* chưa sẵn sàng */ } }
  if (!info) throw new Error('Không kết nối được CDP');
  ws = new WebSocket(info.webSocketDebuggerUrl); await withTimeout(new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }), CDP_CALL_MS, 'mở WebSocket CDP');
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('CDP đóng kết nối')); pending.clear(); };
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } else if (d.method) {
    if (d.method === 'Runtime.exceptionThrown') consoleErrors.push(d.params.exceptionDetails.text + ' ' + ((d.params.exceptionDetails.exception || {}).description || ''));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErrors.push(d.params.args.map((a) => a.value || a.description).join(' '));
  } };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
}
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description)); return r.result.value; };
const goto = async (url) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(150); await send('Page.navigate', { url }); await sleep(700); };
const waitFor = async (expr, label, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) { /* đang tải */ } await sleep(120); } throw new Error('Hết hạn chờ: ' + label); };
const focusSel = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.focus();return document.activeElement===e})()`);
const typeInto = async (sel, text) => { if (!(await focusSel(sel))) throw new Error('Không focus được ' + sel); await send('Input.insertText', { text }); };
const clickText = (txt, sel = 'button') => ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().includes(${JSON.stringify(txt)})&&!x.disabled);if(!b)return false;b.click();return true})()`);
const bodyHas = (txt) => ev(`document.body.textContent.includes(${JSON.stringify(txt)})`);
// fetch từ TRONG trang (cùng origin, cookie thật của trình duyệt). Trả {status, body}.
const pageFetch = (p, init) => ev(`fetch(${JSON.stringify('/api/v1' + p)}, Object.assign({credentials:'include'}, ${JSON.stringify(init || {})})).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const csrfCookie = () => ev("(document.cookie.match(/(?:^|;\\s*)siscom_csrf=([^;]+)/) || [])[1] || null");
const bannerUser = () => ev('(document.body.textContent.match(/Đang đăng nhập: (.+?) \\((NV-\\d+)\\)/) || []).slice(1, 3)');
const cookies = async () => (await send('Network.getCookies', { urls: [WEB + '/api/v1/'] })).cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, path: c.path }));

const LOGIN_FORM = "!!document.querySelector('#login-identifier') && !!document.querySelector('#login-password')";
const LOGGED_IN = "document.body.textContent.includes('Đang đăng nhập:')";
async function login(email, pw) {
  await waitFor(LOGIN_FORM, 'màn hình đăng nhập');
  await typeInto('#login-identifier', email); await typeInto('#login-password', pw);
  if (!(await clickText('Đăng nhập', 'button[type=submit]'))) throw new Error('không bấm được nút Đăng nhập');
}
async function logout() { if (!(await clickText('Đăng xuất'))) throw new Error('không thấy nút Đăng xuất'); await waitFor(LOGIN_FORM, 'về màn hình đăng nhập sau đăng xuất'); }
const bizOf = (perms) => { const o = {}; for (const k of BIZ_KEYS) if (perms && perms[k] !== undefined) o[k] = perms[k]; return o; };
const same = (a, b) => JSON.stringify(Object.fromEntries(Object.entries(a).sort())) === JSON.stringify(Object.fromEntries(Object.entries(b).sort()));

// ---------------- Kịch bản ----------------
try {
  await launch();
  // S0 — chưa đăng nhập: màn hình đăng nhập, /auth/me 401, không có cookie.
  await goto(WEB + '/');
  await waitFor(LOGIN_FORM, 'màn hình đăng nhập (VITE_CRM_AUTH_ENABLED=true?)');
  rec('S0.1 chưa đăng nhập => màn hình đăng nhập (AuthGate)', 'PASS');
  const me0 = await pageFetch('/auth/me');
  check('S0.2 GET /auth/me khi chưa đăng nhập => 401', me0.status === 401, 'status=' + me0.status);
  check('S0.3 không có cookie phiên trước khi đăng nhập', (await cookies()).length === 0);

  // S1 — sai mật khẩu: 401 LOGIN_INVALID, vẫn ở màn hình đăng nhập (1 lần, dưới ngưỡng khoá 5).
  const sale = ROLES.find((r) => r.key === 'sale');
  await login(sale.local + '@' + DOMAIN, 'sai-mat-khau-' + STAMP);
  await waitFor("!!document.querySelector('#login-banner')", 'banner lỗi đăng nhập');
  const bannerKind = await ev("(document.querySelector('#login-banner')||{}).getAttribute ? document.querySelector('#login-banner').getAttribute('data-kind') : null");
  check('S1.1 sai mật khẩu => banner lỗi (role=alert), vẫn màn hình đăng nhập', (await ev(LOGIN_FORM)) && !!bannerKind, 'data-kind=' + bannerKind);
  check('S1.2 sai mật khẩu => /auth/me vẫn 401', (await pageFetch('/auth/me')).status === 401);

  for (const r of ROLES) {
    const email = r.local + '@' + DOMAIN;
    await goto(WEB + '/');
    await login(email, pwOf(r));
    await waitFor(LOGGED_IN, 'đăng nhập ' + r.key);
    const [fullName, code] = await bannerUser();
    const me = await pageFetch('/auth/me');
    const meData = me.body && me.body.data && me.body.data.me;
    const roles = (meData && meData.roles) || [];
    check(`S2.${r.key} đăng nhập ${email} => App hiện "Đang đăng nhập: ${fullName} (${code})"`, !!fullName && /^NV-\d+$/.test(code || ''), 'me=' + (meData ? meData.code : 'null'));
    check(`S2.${r.key}.roles /auth/me 200, vai trò = [${r.dbRole}]`, me.status === 200 && roles.length === 1 && roles[0] === r.dbRole, 'roles=' + JSON.stringify(roles));
    check(`S2.${r.key}.perms quyền customer.*/contact.*/lookup.read đúng ma trận V2`, same(bizOf(meData && meData.permissions), r.expect), 'thực tế=' + JSON.stringify(bizOf(meData && meData.permissions)));
    check(`S2.${r.key}.label nhãn vai trò trên Topbar = "${r.label}"`, await bodyHas(r.label));
    check(`S2.${r.key}.csrf cookie siscom_csrf đọc được từ JS sau đăng nhập`, typeof (await csrfCookie()) === 'string');
    if (r.key === 'admin') {
      const cs = await cookies();
      const sid = cs.find((c) => c.name === 'siscom_sid'); const csrf = cs.find((c) => c.name === 'siscom_csrf');
      check('S2.admin.cookies siscom_sid HttpOnly+SameSite=Lax+Path=/api/v1; siscom_csrf KHÔNG HttpOnly, Path=/', !!sid && sid.httpOnly && sid.sameSite === 'Lax' && sid.path === '/api/v1' && !!csrf && !csrf.httpOnly && csrf.path === '/', JSON.stringify(cs));
    }

    // S3 — danh sách khách hàng từ máy chủ (UI + API).
    await ev("location.hash = '/customers'"); await sleep(300);
    await waitFor("!document.body.textContent.includes('Đang tải danh sách khách hàng')", 'danh sách khách hàng tải xong');
    const uiErr = await bodyHas('Yêu cầu thất bại');
    const list = await pageFetch('/customers?page=1&pageSize=20');
    const total = list.body && list.body.data ? list.body.data.total : null;
    check(`S3.${r.key} danh sách khách hàng: UI không lỗi, GET /customers 200`, !uiErr && list.status === 200, 'total=' + total);

    // S4 — danh mục D3 (lookup.read ALL cho mọi vai trò) + tạo/xem/sửa + CSRF + phân quyền ghi.
    const lk = await pageFetch('/lookups?type=customer_tier,customer_status,source');
    const lkd = (lk.body && lk.body.data) || {};
    const hasLk = (t, c) => Array.isArray(lkd[t]) && lkd[t].some((x) => x.code === c);
    check(`S4.${r.key}.lookups GET /lookups => 200, danh mục D3 có POTENTIAL (tier/status) và WEBSITE (source)`, lk.status === 200 && hasLk('customer_tier', 'POTENTIAL') && hasLk('customer_status', 'POTENTIAL') && hasLk('source', 'WEBSITE'), 'status=' + lk.status + ' tier=' + (lkd.customer_tier || []).length + ' status=' + (lkd.customer_status || []).length + ' source=' + (lkd.source || []).length);
    // PR 7 (D15): ứng viên chủ sở hữu theo phạm vi customer.create/update — không cần employee.read; không có cả hai quyền => 403.
    const oc = await pageFetch('/customers/owner-candidates');
    const ocd = (oc.body && oc.body.data) || {};
    const ocItems = Array.isArray(ocd.items) ? ocd.items : [];
    const exp = r.candidates;
    const ocOk = oc.status === exp.status && (exp.status !== 200 || (ocd.scope === exp.scope && ocItems.length >= exp.min && (exp.max === undefined || ocItems.length <= exp.max) && (!exp.self || (ocItems[0] && ocItems[0].id === (meData && meData.employeeId))) && ocItems.every((x) => x.id && x.code && x.fullName && !('email' in x) && !('phone' in x))));
    check(`S4.${r.key}.owners GET /customers/owner-candidates => ${exp.status}${exp.status === 200 ? ' scope ' + exp.scope + (exp.self ? ' (chỉ chính mình)' : ' (>= ' + exp.min + ' nhân viên)') : ' FORBIDDEN'}`, ocOk, 'status=' + oc.status + ' scope=' + ocd.scope + ' n=' + ocItems.length + (oc.body && oc.body.error ? ' code=' + oc.body.error.code : ''));
    if (r.key === 'admin') {
      // UI: biểu mẫu "Thêm khách hàng" ở chế độ API có ô "Nhân viên phụ trách" với lựa chọn từ máy chủ (không còn ẩn).
      await ev("location.hash = '/customers'"); await sleep(300);
      await waitFor("!document.body.textContent.includes('Đang tải danh sách khách hàng')", 'danh sách khách hàng tải xong (trước khi mở biểu mẫu)');
      if (!(await clickText('Thêm khách hàng'))) throw new Error('không bấm được nút Thêm khách hàng');
      await waitFor("!!document.querySelector('[role=dialog][aria-label=\"Thêm khách hàng\"]') && document.body.textContent.includes('Nhân viên phụ trách') && !document.body.textContent.includes('Đang tải danh sách nhân viên')", 'biểu mẫu có ô Nhân viên phụ trách đã tải');
      const btnOk = await ev("(()=>{const d=document.querySelector('[role=dialog][aria-label=\"Thêm khách hàng\"]');const lbl=[...d.querySelectorAll('label, span, div')].find(e=>e.textContent.trim()==='Nhân viên phụ trách');const b=lbl&&lbl.closest('div')&&(lbl.closest('div').querySelector('button.sg-select__trigger')||lbl.parentElement.querySelector('button.sg-select__trigger'));if(!b)return 'no-trigger';if(b.disabled)return 'disabled';b.click();return 'opened'})()");
      const nOpts = btnOk === 'opened' ? await ev("document.querySelectorAll('[role=dialog][aria-label=\"Thêm khách hàng\"] [role=option], [role=dialog][aria-label=\"Thêm khách hàng\"] [role=listbox] li, [role=dialog][aria-label=\"Thêm khách hàng\"] [role=listbox] button').length") : 0;
      check('S4.admin.ownersUi biểu mẫu Thêm khách hàng có ô "Nhân viên phụ trách" bật, danh sách >= 5 + mục Chưa phân công', btnOk === 'opened' && nOpts >= 6, 'trigger=' + btnOk + ' options=' + nOpts);
      await ev("(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>x.getAttribute('aria-label')==='Đóng');if(b)b.click();return true})()"); await sleep(200);
      await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Huỷ thay đổi');if(b)b.click();return true})()"); await sleep(200);
    }
    const JSONH = { 'content-type': 'application/json' };
    const hdr = async () => Object.assign({}, JSONH, { 'x-csrf-token': await csrfCookie() });
    const errOf = (res) => (res.body && res.body.error ? res.body.error.code : null);
    const body = JSON.stringify({ name: 'E2E ' + r.key + ' ' + STAMP, phone: '0901234567', source: 'WEBSITE' }); // không gửi tier/status => mặc định POTENTIAL (D3)
    const noCsrf = await pageFetch('/customers', { method: 'POST', headers: JSONH, body });
    check(`S4.${r.key}.1 POST /customers KHÔNG X-CSRF-Token => 403 CSRF_FAILED`, noCsrf.status === 403 && errOf(noCsrf) === 'CSRF_FAILED', 'status=' + noCsrf.status);
    const badCsrf = await pageFetch('/customers', { method: 'POST', headers: Object.assign({}, JSONH, { 'x-csrf-token': 'x'.repeat(43) }), body });
    check(`S4.${r.key}.2 POST /customers X-CSRF-Token SAI => 403`, badCsrf.status === 403, 'status=' + badCsrf.status);
    const ok = await pageFetch('/customers', { method: 'POST', headers: await hdr(), body });
    if (r.key === 'admin') {
      const c = ok.body && ok.body.data;
      createdCode = c ? c.code : null; createdId = c ? c.id : null; createdVersion = c ? c.version : null; adminEmployeeId = meData ? meData.employeeId : null;
      check('S4.admin.3 tạo: POST /customers CSRF đúng => 201, mã KH-xxxxx, tier/status mặc định POTENTIAL, source WEBSITE (D3 đã seed)', ok.status === 201 && /^KH-\d{5,}$/.test(createdCode || '') && !!c && c.tier && c.tier.code === 'POTENTIAL' && c.status && c.status.code === 'POTENTIAL' && c.source && c.source.code === 'WEBSITE' && c.version === 1, 'status=' + ok.status + ' code=' + createdCode + (errOf(ok) ? ' error=' + errOf(ok) + ' ' + JSON.stringify(ok.body.error.details || null) : ''));
      if (!createdId) throw new Error('crm_admin không tạo được khách => không kiểm được xem/sửa/phạm vi (status ' + ok.status + ' ' + errOf(ok) + ')');
      // Danh sách FE tải một lần rồi giữ trong bộ nhớ (CustomerList: chỉ load khi status 'idle'); khách tạo ngoài biểu mẫu UI chỉ hiện sau khi
      // tải lại trang => tải lại (đồng thời kiểm khôi phục phiên) rồi mở danh sách.
      await send('Page.reload', { ignoreCache: true }); await sleep(500);
      await waitFor(LOGGED_IN, 'khôi phục phiên sau tải lại (trước khi xem danh sách)');
      await ev("location.hash = '/customers'"); await sleep(300);
      await waitFor("!document.body.textContent.includes('Đang tải danh sách khách hàng')", 'danh sách khách hàng tải xong');
      await waitFor(`document.body.textContent.includes(${JSON.stringify(createdCode)})`, 'khách vừa tạo hiện trên danh sách UI');
      rec('S4.admin.4 khách vừa tạo hiện trên danh sách UI (sau tải lại trang)', 'PASS', createdCode);
      const g = await pageFetch('/customers/' + createdId);
      check('S4.admin.5 xem: GET /customers/:id => 200, đúng mã, version 1', g.status === 200 && g.body.data.code === createdCode && g.body.data.version === 1, 'status=' + g.status);
      const newName = 'E2E admin ' + STAMP + ' (đã sửa)';
      const up = await pageFetch('/customers/' + createdId, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ version: 1, name: newName, tier: 'VIP', status: 'ACTIVE' }) });
      const u = up.body && up.body.data;
      check('S4.admin.6 sửa: PATCH /customers/:id (version 1; tên, tier VIP, status ACTIVE) => 200, version 2, giá trị mới', up.status === 200 && !!u && u.name === newName && u.tier.code === 'VIP' && u.status.code === 'ACTIVE' && u.version === 2, 'status=' + up.status + (errOf(up) ? ' error=' + errOf(up) : ''));
      createdVersion = u ? u.version : createdVersion;
      const stale = await pageFetch('/customers/' + createdId, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ version: 1, name: newName + ' x' }) });
      check('S4.admin.7 sửa với version cũ => 409 (khoá lạc quan)', stale.status === 409, 'status=' + stale.status + ' code=' + errOf(stale));
      const upNoCsrf = await pageFetch('/customers/' + createdId, { method: 'PATCH', headers: JSONH, body: JSON.stringify({ version: 2, name: newName + ' y' }) });
      check('S4.admin.8 PATCH KHÔNG X-CSRF-Token => 403 CSRF_FAILED', upNoCsrf.status === 403 && errOf(upNoCsrf) === 'CSRF_FAILED', 'status=' + upNoCsrf.status);
      const badTier = await pageFetch('/customers/' + createdId, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ version: 2, tier: 'KHONG_CO_TRONG_DANH_MUC' }) });
      check('S4.admin.9 PATCH tier ngoài danh mục => 400 LOOKUP_INVALID (field tier)', badTier.status === 400 && errOf(badTier) === 'LOOKUP_INVALID' && badTier.body.error.details && badTier.body.error.details.field === 'tier', 'status=' + badTier.status + ' code=' + errOf(badTier));
      await ev("location.hash = '/customers/" + createdId + "'");
      await waitFor(`document.body.textContent.includes(${JSON.stringify(newName)})`, 'trang chi tiết (#/customers/:id) hiện tên đã sửa');
      rec('S4.admin.10 trang chi tiết (#/customers/:id) hiện tên đã sửa', 'PASS');
      await ev("location.hash = '/customers'"); await sleep(300);
    } else if (r.key === 'sale') {
      // B3 (PR 6, đóng D12): sales tạo với phạm vi OWN => 201, chủ sở hữu = chính mình (D14), có phân công OWNER; xem/sửa khách của mình; không được bàn giao.
      const c = ok.body && ok.body.data;
      const saleCode = c ? c.code : null; const saleId = c ? c.id : null;
      check('S4.sale.3 tạo (B3): POST /customers phạm vi OWN => 201, chủ sở hữu = chính mình', ok.status === 201 && !!c && !!c.owner && c.owner.id === (meData && meData.employeeId) && c.version === 1, 'status=' + ok.status + ' code=' + saleCode + (errOf(ok) ? ' error=' + errOf(ok) : '') + ' owner=' + (c && c.owner ? c.owner.code : null));
      if (saleId) {
        const g = await pageFetch('/customers/' + saleId);
        check('S4.sale.4 xem khách của mình: GET /customers/:id => 200', g.status === 200 && g.body.data.code === saleCode, 'status=' + g.status);
        const up = await pageFetch('/customers/' + saleId, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ version: 1, note: 'ghi chú của sales' }) });
        check('S4.sale.5 sửa khách của mình (OWN) => 200, version 2', up.status === 200 && up.body.data.version === 2, 'status=' + up.status + (errOf(up) ? ' code=' + errOf(up) : ''));
        const give = await pageFetch('/customers/' + saleId, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ version: 2, ownerId: adminEmployeeId || '00000000-0000-4000-8000-000000000000' }) });
        check('S4.sale.6 bàn giao cho người khác (OWN) => 403 FORBIDDEN', give.status === 403 && errOf(give) === 'FORBIDDEN', 'status=' + give.status + ' code=' + errOf(give));
        const l3 = await pageFetch('/customers?page=1&pageSize=50');
        const items3 = (l3.body && l3.body.data && l3.body.data.items) || [];
        check('S4.sale.7 danh sách OWN: THẤY khách của mình, KHÔNG thấy khách crm_admin', items3.some((x) => x.code === saleCode) && !items3.some((x) => x.code === createdCode), 'total=' + (l3.body && l3.body.data ? l3.body.data.total : null));
        await send('Page.reload', { ignoreCache: true }); await sleep(500);
        await waitFor(LOGGED_IN, 'khôi phục phiên sau tải lại (sales)');
        await ev("location.hash = '/customers'"); await sleep(300);
        await waitFor("!document.body.textContent.includes('Đang tải danh sách khách hàng')", 'danh sách khách hàng tải xong (sales)');
        await waitFor(`document.body.textContent.includes(${JSON.stringify(saleCode)})`, 'khách của sales hiện trên danh sách UI');
        rec('S4.sale.8 khách của mình hiện trên danh sách UI (sau tải lại trang)', 'PASS', saleCode);
      }
    } else {
      check(`S4.${r.key}.3 POST /customers (không có customer.create) => 403 FORBIDDEN`, ok.status === 403 && errOf(ok) === 'FORBIDDEN', 'status=' + ok.status + ' code=' + errOf(ok));
    }

    // S5 — phân quyền trên khách do crm_admin tạo (chưa có chủ sở hữu): danh sách + xem + sửa + xoá theo ma trận V2.
    if (createdId) {
      const l2 = await pageFetch('/customers?page=1&pageSize=50');
      const items = (l2.body && l2.body.data && l2.body.data.items) || [];
      const sees = items.some((c) => c.code === createdCode);
      check(`S5.${r.key}.list phạm vi ${r.expect['customer.read']}: ${r.seesCreated ? 'THẤY' : 'KHÔNG thấy'} khách ${createdCode}`, sees === r.seesCreated, 'total=' + (l2.body && l2.body.data ? l2.body.data.total : null));
      if (r.key !== 'admin') {
        const g2 = await pageFetch('/customers/' + createdId);
        check(`S5.${r.key}.view xem GET /customers/:id => ${r.onCreated.view}`, g2.status === r.onCreated.view, 'status=' + g2.status + ' code=' + errOf(g2));
        const u2 = await pageFetch('/customers/' + createdId, { method: 'PATCH', headers: await hdr(), body: JSON.stringify({ version: createdVersion, name: 'E2E ' + r.key + ' sửa trái phép' }) });
        check(`S5.${r.key}.update sửa PATCH /customers/:id => ${r.onCreated.update}`, u2.status === r.onCreated.update, 'status=' + u2.status + ' code=' + errOf(u2));
        const d2 = await pageFetch('/customers/' + createdId, { method: 'DELETE', headers: await hdr() });
        check(`S5.${r.key}.delete xoá DELETE /customers/:id (không có customer.delete) => 403 FORBIDDEN`, d2.status === 403 && errOf(d2) === 'FORBIDDEN', 'status=' + d2.status + ' code=' + errOf(d2));
        const g3 = await pageFetch('/customers/' + createdId, { headers: {} });
        if (r.onCreated.view === 200) check(`S5.${r.key}.intact sau sửa/xoá trái phép khách không đổi (version ${createdVersion})`, g3.status === 200 && g3.body.data.version === createdVersion, 'version=' + (g3.body && g3.body.data ? g3.body.data.version : null));
      }
    }

    // S6 — tải lại trang: phiên khôi phục qua /auth/me, CSRF lấy lại từ cookie.
    await send('Page.reload', { ignoreCache: true }); await sleep(500);
    await waitFor(LOGGED_IN, 'khôi phục phiên sau tải lại');
    check(`S6.${r.key} tải lại trang => vẫn đăng nhập (restore), /auth/me 200, có siscom_csrf`, (await pageFetch('/auth/me')).status === 200 && typeof (await csrfCookie()) === 'string');

    roleEvidence[r.key] = { email, code, fullName, dbRole: roles[0] || null, permissions: meData ? meData.permissions : null, customersTotal: total };

    // S7 — đăng xuất: về màn hình đăng nhập, /auth/me 401, cookie xoá.
    await logout();
    const meAfter = await pageFetch('/auth/me');
    check(`S7.${r.key} đăng xuất => màn hình đăng nhập, /auth/me 401, cookie đã xoá`, meAfter.status === 401 && (await csrfCookie()) === null && (await cookies()).length === 0, 'status=' + meAfter.status);
  }
  check('S8 không có lỗi console/ngoại lệ JS trong suốt kịch bản', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  rec('HARNESS', 'FAIL', (e && e.message) || String(e));
}

// ---------------- Bằng chứng ----------------
const summary = { pass: results.filter((x) => x.status === 'PASS').length, fail: results.filter((x) => x.status === 'FAIL').length, known: results.filter((x) => x.status === 'KNOWN').length };
const evidence = { at: new Date().toISOString(), web: WEB, api: API, browser: path.basename(chrome), node: process.version, summary, createdCustomerCode: createdCode, roles: roleEvidence, results };
fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
console.log('\n| Kết quả | Số |\n|---|---|\n| PASS | ' + summary.pass + ' |\n| FAIL | ' + summary.fail + ' |\n| KNOWN | ' + summary.known + ' |');
console.log('Bằng chứng: ' + EVIDENCE);
cleanup.cancelDeadline(); cleanup.run();
process.exit(summary.fail > 0 ? 1 : 0);
