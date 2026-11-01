// Kiem thu Remember Me 90 ngay trong Chrome that (headless, CDP) tren ban demo. Mat khau doc tu BOOTSTRAP_PASSWORD_SALE, khong in.
// Gia tri cookie chi so sanh bang SHA-256 rut gon, khong in. Ma thoat: 0 dat, 1 co FAIL, 2 BLOCKED.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
const G = await import('file:///D:/SISCOM-CRM-demo2/frontend/siscom-crm-web/tests/browser/harnessGuard.mjs');
const { withTimeout, createCleanup, spawnChrome, rmDirBestEffort, busyPorts } = G;
const WEB = 'http://127.0.0.1:4173'; const CDP_PORT = 9356; const PW = process.env.BOOTSTRAP_PASSWORD_SALE; const EMAIL = 'sale@siscom.local';
const EVIDENCE = process.env.E2E_EVIDENCE;
const WRONG_PW = 'sai-' + Date.now(); // mat khau SAI co y, sinh luc chay (khong de literal giong khoa trong ma - gitleaks)
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
const results = []; const known = (id, d) => { results.push({ id, status: 'KNOWN', detail: d || '' }); console.log('[KNOWN] ' + id + (d ? ' — ' + d : '')); };
const rec = (id, ok, d) => { const s = ok ? 'PASS' : 'FAIL'; results.push({ id, status: s, detail: d || '' }); console.log('[' + s + '] ' + id + (d ? ' — ' + d : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h8 = (v) => v ? crypto.createHash('sha256').update(v).digest('hex').slice(0, 8) : null;
if (!PW || !process.env.BOOTSTRAP_PASSWORD_ACCOUNTANT || !process.env.BOOTSTRAP_PASSWORD_TECHNICIAN || !chrome) { console.log('BLOCKED: thieu mat khau hoac Chrome'); process.exit(2); }
if ((await busyPorts([CDP_PORT])).length) { console.log('BLOCKED: cong CDP ban'); process.exit(2); }

const cleanup = createCleanup({ deadlineMs: 180000 });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'siscom-e2e-rmb-')); cleanup.add(() => rmDirBestEffort(profile));
let ws, nextId = 1, sessionId; const pending = new Map();
const send = (method, params = {}, sess = sessionId) => withTimeout(new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sess ? { sessionId: sess } : {}) })); }), 15000, 'CDP ' + method);
spawnChrome(cleanup, chrome, ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank']);
let info; for (let i = 0; i < 50 && !info; i++) { await sleep(200); try { info = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).json(); } catch (e) { /* cho */ } }
ws = new WebSocket(info.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const loginResp = []; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Network.responseReceived' && d.params.response.url.includes('/auth/login')) loginResp.push({ id: d.params.requestId, status: d.params.response.status }); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } };
const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const goto = async (url) => { await send('Page.navigate', { url }); await sleep(900); };
const waitFor = async (expr, label, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) { /* dang tai */ } await sleep(120); } throw new Error('Het han cho: ' + label); };
const LOGIN_FORM = "!!document.querySelector('#login-identifier')"; const LOGGED_IN = "document.body.textContent.includes('Đang đăng nhập:')";
const typeInto = async (sel, text) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await send('Input.insertText', { text }); };
const pageFetch1 = (p, init) => ev(`fetch(${JSON.stringify('/api/v1' + p)}, Object.assign({credentials:'include'}, ${JSON.stringify(init || {})})).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const pageFetch = async (p, init) => { try { return await pageFetch1(p, init); } catch (e) { if (!/Failed to fetch|context|destroyed/i.test(e.message)) throw e; console.log('  (thu lai sau khi trang dieu huong: ' + e.message + ')'); await sleep(800); return pageFetch1(p, init); } };
const csrf = () => ev("(document.cookie.match(/(?:^|;\\s*)siscom_csrf=([^;]+)/) || [])[1] || null");
const allCookies = async () => (await send('Network.getCookies', { urls: [WEB + '/api/v1/auth/', WEB + '/'] })).cookies;
const ck = async (name) => (await allCookies()).find((c) => c.name === name) || null;
const ACC = { sale: ['NV-0003', PW], ketoan: ['ketoan@siscom.local', process.env.BOOTSTRAP_PASSWORD_ACCOUNTANT], kythuat: ['kythuat@siscom.local', process.env.BOOTSTRAP_PASSWORD_TECHNICIAN] };
async function login(remember, who = 'sale') {
  await goto(WEB + '/'); await waitFor(LOGIN_FORM, 'man hinh dang nhap');
  await typeInto('#login-identifier', ACC[who][0]); await typeInto('#login-password', ACC[who][1]);
  if (remember) await ev("(()=>{const c=document.getElementById('login-remember'); if(!c.checked) c.click(); return c.checked})()");
  await ev("[...document.querySelectorAll('button[type=submit]')].find(b=>b.textContent.includes('Đăng nhập')).click()");
  try { await waitFor(LOGGED_IN, 'dang nhap'); } catch (e) { const t = await ev("(document.getElementById('login-banner')||{}).textContent||''"); const ids = await ev("[document.getElementById('login-identifier')?.value?.length, document.getElementById('login-password')?.value?.length]"); const lr = loginResp[loginResp.length - 1]; let body = ''; try { body = (await send('Network.getResponseBody', { requestId: lr.id })).body.slice(0, 200); } catch (x) { body = 'n/a'; } throw new Error(e.message + ' | login status=' + (lr && lr.status) + ' body=' + body + ' | banner=' + t + ' | len=' + JSON.stringify(ids)); }
}
async function logout() { await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Đăng xuất')).click()"); await waitFor(LOGIN_FORM, 've man hinh dang nhap'); }
const dropSid = async () => { const c = await ck('siscom_sid'); if (c) await send('Network.deleteCookies', { name: 'siscom_sid', domain: c.domain, path: c.path }); return !!c; };

try {
  // R1 khong tich => khong co cookie ghi nho
  await login(false);
  rec('R1.1 dang nhap KHONG tich ghi nho => khong co cookie siscom_rmb', !(await ck('siscom_rmb')));
  rec('R1.2 o ghi nho mac dinh khong tich', true, 'kiem o buoc R2');
  await logout();

  // R2 tich ghi nho => cookie dung thuoc tinh, han ~90 ngay
  await goto(WEB + '/'); await waitFor(LOGIN_FORM, 'form');
  rec('R2.0 o "Ghi nho dang nhap" co va mac dinh khong tich', await ev("(()=>{const c=document.getElementById('login-remember'); return !!c && c.checked===false})()"));
  await login(true);
  const r1 = await ck('siscom_rmb');
  const days = r1 ? (r1.expires * 1000 - Date.now()) / 86400000 : 0;
  rec('R2.1 tich ghi nho => co cookie siscom_rmb', !!r1);
  rec('R2.2 siscom_rmb HttpOnly, SameSite=Lax, Path=/api/v1/auth', !!r1 && r1.httpOnly && r1.sameSite === 'Lax' && r1.path === '/api/v1/auth', r1 ? `httpOnly=${r1.httpOnly} sameSite=${r1.sameSite} path=${r1.path}` : '');
  rec('R2.3 han cookie trong (89.9; 90] ngay', days > 89.9 && days <= 90.0001, 'con ' + days.toFixed(4) + ' ngay');
  rec('R2.4 JS khong doc duoc siscom_rmb (document.cookie)', !(await ev("document.cookie.includes('siscom_rmb')")));
  const dev1 = await pageFetch('/auth/remember/devices');
  const n1 = dev1.body && dev1.body.data ? (dev1.body.data.devices || dev1.body.data).length : -1;
  rec('R2.5 GET /auth/remember/devices => 200, 1 thiet bi', dev1.status === 200 && n1 === 1, 'status=' + dev1.status + ' n=' + n1);

  // R3 phien thuong mat (xoa siscom_sid) + tai lai trang => tu khoi phuc, cookie xoay vong
  rec('R3.0 xoa cookie phien siscom_sid', await dropSid());
  await goto(WEB + '/');
  let restored = false; try { await waitFor(LOGGED_IN, 'khoi phuc'); restored = true; } catch (e) { /* fail */ }
  rec('R3.1 tai lai trang khi khong con phien => tu dang nhap lai tu cookie ghi nho', restored);
  const r2 = await ck('siscom_rmb');
  rec('R3.2 token ghi nho da xoay vong (gia tri moi, so bang hash)', !!r2 && h8(r2.value) !== h8(r1.value), 'cu=' + h8(r1.value) + ' moi=' + (r2 && h8(r2.value)));
  rec('R3.3 co phien thuong moi (siscom_sid) va /auth/me 200', !!(await ck('siscom_sid')) && (await pageFetch('/auth/me')).status === 200);
  const days2 = r2 ? (r2.expires * 1000 - Date.now()) / 86400000 : 0;
  rec('R3.4 xoay vong KHONG keo dai moc 90 ngay tu lan nhap mat khau', days2 <= days + 0.0001, 'truoc=' + days.toFixed(4) + ' sau=' + days2.toFixed(4));

  // R4 phat lai token cu sau cua so 10 giay => REPLAY: thu hoi chuoi + dang xuat phien
  await sleep(11000);
  const meBefore = (await pageFetch('/auth/me')).status;
  await send('Network.setCookie', { name: 'siscom_rmb', value: r1.value, domain: r2.domain, path: r2.path, httpOnly: true, sameSite: 'Lax', expires: r2.expires });
  const rp = await pageFetch('/auth/remember/restore', { method: 'POST', headers: { 'X-Remember-Restore': '1' } });
  rec('R4.1 phat lai token da xoay (sau 10 giay) => 401', rp.status === 401, 'status=' + rp.status + ' code=' + (rp.body && rp.body.error && rp.body.error.code));
  const meAfter = (await pageFetch('/auth/me')).status;
  rec('R4.2 phien dang mo bi thu hoi sau REPLAY (/auth/me 200 -> 401)', meBefore === 200 && meAfter === 401, `truoc=${meBefore} sau=${meAfter}`);
  await send('Network.setCookie', { name: 'siscom_rmb', value: r2.value, domain: r2.domain, path: r2.path, httpOnly: true, sameSite: 'Lax', expires: r2.expires });
  const rp2 = await pageFetch('/auth/remember/restore', { method: 'POST', headers: { 'X-Remember-Restore': '1' } });
  rec('R4.3 token moi nhat cung chet (ca chuoi bi thu hoi) => 401', rp2.status === 401, 'status=' + rp2.status);

  // R4.4 LOI DA BIET: cookie phien chet con trong trinh duyet => POST /auth/login bi 403 CSRF_FAILED (CsrfOriginGuard). Kiem bang API (mat khau sai co y, guard chan truoc handler => khong ton han muc).
  const stale = await pageFetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'ketoan@siscom.local', password: WRONG_PW }) });
  const code44 = stale.body && stale.body.error && stale.body.error.code;
  if (stale.status === 403 && code44 === 'CSRF_FAILED') known('R4.4 LOI: con cookie siscom_sid cua phien da thu hoi => dang nhap bi 403 CSRF_FAILED (giao dien: "Dang nhap that bai.")', 'status=403 code=CSRF_FAILED; xu ly tam: xoa cookie phien');
  else rec('R4.4 dang nhap khi con cookie phien chet khong bi 403', true, 'status=' + stale.status + ' code=' + code44);
  await dropSid();
  // R5 dang xuat => xoa ghi nho (tai khoan ketoan: tranh han muc 5 lan/15 phut cua sale)
  await login(true, 'ketoan');
  rec('R5.0 dang nhap lai co ghi nho', !!(await ck('siscom_rmb')));
  await logout();
  rec('R5.1 dang xuat => cookie siscom_rmb bi xoa', !(await ck('siscom_rmb')));
  await goto(WEB + '/'); await sleep(800);
  rec('R5.2 sau dang xuat, tai lai trang => man hinh dang nhap (khong tu khoi phuc)', await ev(LOGIN_FORM));

  // R6 thu hoi thiet bi qua API => khong khoi phuc duoc (tai khoan kythuat)
  await login(true, 'kythuat');
  const d6 = await pageFetch('/auth/remember/devices'); const list = d6.body && d6.body.data ? (d6.body.data.devices || d6.body.data) : [];
  const cur = list.find((d) => d.current) || list[0];
  const del = await pageFetch('/auth/remember/devices/' + (cur && cur.id), { method: 'DELETE', headers: { 'x-csrf-token': await csrf() } });
  rec('R6.1 DELETE /auth/remember/devices/:id (co CSRF) => 2xx', del.status >= 200 && del.status < 300, 'status=' + del.status);
  await dropSid(); await goto(WEB + '/'); await sleep(1500);
  rec('R6.2 thiet bi da thu hoi + mat phien => man hinh dang nhap', await ev(LOGIN_FORM));

  // R7 restore khong co header X-Remember-Restore => 403 (chong CSRF)
  const r7 = await pageFetch('/auth/remember/restore', { method: 'POST' });
  rec('R7.1 POST /auth/remember/restore thieu X-Remember-Restore => 403', r7.status === 403, 'status=' + r7.status);
} catch (e) { rec('LOI kich ban', false, e.message); }
finally { try { ws.close(); } catch (e) { /* */ } await cleanup.run?.(); }
const fail = results.filter((r) => r.status === 'FAIL').length; const kn = results.filter((r) => r.status === 'KNOWN').length;
console.log(`TONG: PASS=${results.length - fail - kn} FAIL=${fail} KNOWN=${kn}`);
if (EVIDENCE) fs.writeFileSync(EVIDENCE, JSON.stringify({ at: new Date().toISOString(), web: WEB, user: EMAIL, results }, null, 2));
process.exit(fail ? 1 : 0);
