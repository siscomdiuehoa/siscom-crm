// Kiem thu danh muc "Tinh / Thanh pho" trong Chrome that (headless, CDP) tren ban demo (cum 55433, backend 3100, web 4173).
// Luc chay (2026-11-01) web 4173 phuc vu ban build nhanh feat/b1.4-customer-contact-person (PR #188); PR nay KHONG doi frontend, o Tinh/Thanh doc
// GET /lookups?type=province tu backend, nen ket qua ap dung cho main. Anh chup duoc ghi voi ten province_*.png, da doi ten khi luu: 03_*.png.
// Mat khau doc tu BOOTSTRAP_PASSWORD_ADMIN/_SALE/_TECHNICIAN/_ACCOUNTANT, khong in. Dang nhap bang MA NV (khong tron han muc dang nhap theo email).
// Chay lai: node docs/evidence/b1.4_province_catalog_20261101/02_provinceChrome.mjs (tu goc kho). Ma thoat: 0 dat, 1 co FAIL, 2 BLOCKED.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const G = await import(new URL('../../../frontend/siscom-crm-web/tests/browser/harnessGuard.mjs', import.meta.url).href);
const { withTimeout, createCleanup, spawnChrome, rmDirBestEffort, busyPorts } = G;
const WEB = 'http://127.0.0.1:4173'; const CDP_PORT = 9357; const EVIDENCE = process.env.E2E_EVIDENCE; const SHOTS = process.env.E2E_SHOTS;
const ACC = { admin: ['NV-0002', process.env.BOOTSTRAP_PASSWORD_ADMIN], sale: ['NV-0003', process.env.BOOTSTRAP_PASSWORD_SALE], kythuat: ['NV-0004', process.env.BOOTSTRAP_PASSWORD_TECHNICIAN], ketoan: ['NV-0005', process.env.BOOTSTRAP_PASSWORD_ACCOUNTANT] };
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
const STAMP = Date.now().toString(36).toUpperCase();
const results = []; const rec = (id, ok, d) => { const s = ok ? 'PASS' : 'FAIL'; results.push({ id, status: s, detail: d || '' }); console.log('[' + s + '] ' + id + (d ? ' — ' + d : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!chrome || Object.values(ACC).some((a) => !a[1])) { console.log('BLOCKED: thieu Chrome hoac mat khau'); process.exit(2); }
if ((await busyPorts([CDP_PORT])).length) { console.log('BLOCKED: cong CDP ban'); process.exit(2); }

const cleanup = createCleanup({ deadlineMs: 240000 });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'siscom-e2e-contact-')); cleanup.add(() => rmDirBestEffort(profile));
let ws, nextId = 1, sessionId; const pending = new Map();
const send = (method, params = {}, sess = sessionId) => withTimeout(new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sess ? { sessionId: sess } : {}) })); }), 15000, 'CDP ' + method);
spawnChrome(cleanup, chrome, ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1400,1000', 'about:blank']);
let info; for (let i = 0; i < 50 && !info; i++) { await sleep(200); try { info = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).json(); } catch (e) { /* cho */ } }
ws = new WebSocket(info.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } };
const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '')); return r.result.value; };
const goto = async (url) => { await send('Page.navigate', { url }); await sleep(900); };
const waitFor = async (expr, label, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) { /* dang tai */ } await sleep(150); } throw new Error('Het han cho: ' + label); };
const J = JSON.stringify;
const bodyText = () => ev("document.body.innerText.replace(/\\s+/g, ' ')");
const hasText = (t) => ev('document.body.innerText.replace(/\\s+/g, " ").includes(' + J(t) + ')');
const labelEl = (prefix) => `[...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${J(prefix)}))`;
const hasField = (prefix) => ev(`(() => { const l = ${labelEl(prefix)}; return !!(l && document.getElementById(l.htmlFor)); })()`);
const fieldValue = (prefix) => ev(`(() => { const l = ${labelEl(prefix)}; const e = l && document.getElementById(l.htmlFor); return e ? e.value : null; })()`);
const fill = (prefix, v) => ev(`(() => { const l = ${labelEl(prefix)}; const e = l && document.getElementById(l.htmlFor); if (!e) return false; const p = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(e, ${J(v)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
const pickFirstOption = (prefix) => ev(`(() => { const l = ${labelEl(prefix)}; const e = l && document.getElementById(l.htmlFor); if (!e || e.tagName !== 'SELECT') return null; const o = [...e.options].find((x) => x.value); if (!o) return null; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, o.value); e.dispatchEvent(new Event('change', { bubbles: true })); return o.textContent; })()`);
const clickBtn = (t) => ev(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim().includes(${J(t)}) && !x.disabled).pop(); if (!b) return false; b.click(); return true; })()`);
const btnState = (t) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(${J(t)})); return b ? (b.disabled ? 'disabled' : 'enabled') : 'none'; })()`);
const pageFetch = (p, init) => ev(`fetch(${J('/api/v1' + p)}, Object.assign({credentials:'include'}, ${J(init || {})})).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const csrf = () => ev("(document.cookie.match(/(?:^|;\\s*)siscom_csrf=([^;]+)/) || [])[1] || null");
const postContact = async (cid, body) => pageFetch('/customers/' + cid + '/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrf() }, body: J(body) });
const LOGIN_FORM = "!!document.querySelector('#login-identifier')"; const LOGGED_IN = "document.body.textContent.includes('Đang đăng nhập:')";
const typeInto = async (sel, text) => { await ev(`document.querySelector(${J(sel)}).focus()`); await send('Input.insertText', { text }); };
async function login(who) {
  await goto(WEB + '/#/customers'); await waitFor(LOGIN_FORM, 'man hinh dang nhap');
  await typeInto('#login-identifier', ACC[who][0]); await typeInto('#login-password', ACC[who][1]);
  await ev("[...document.querySelectorAll('button[type=submit]')].find(b=>b.textContent.includes('Đăng nhập')).click()");
  await waitFor(LOGGED_IN, 'dang nhap ' + who);
}
async function logout() { await clickBtn('Đăng xuất'); await waitFor(LOGIN_FORM, 've man hinh dang nhap'); }
const idByName = async (name) => { const r = await pageFetch('/customers?search=' + encodeURIComponent(name)); const it = r.body && r.body.data && r.body.data.items && r.body.data.items.find((c) => c.name === name); return it ? it.id : null; };
const openDetail = async (cid) => { await goto(WEB + '/#/customers/' + cid); await waitFor("document.body.innerText.includes('Thông tin doanh nghiệp') || document.body.innerText.includes('Không tìm thấy') || document.body.innerText.includes('không tồn tại')", 'trang chi tiet'); await sleep(700); };
const shot = async (name) => { if (!SHOTS) return; const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); };
async function createViaForm(company, phone, contactName, needOwner) {
  await goto(WEB + '/#/customers'); await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Thêm khách hàng') && !b.disabled)", 'nut Them khach hang');
  await clickBtn('Thêm khách hàng'); await waitFor(`!!(${labelEl('Tên công ty')})`, 'bieu mau them');
  await sleep(600);
  await fill('Tên công ty', company); await fill('Điện thoại', phone);
  const hasContact = await hasField('Tên người liên hệ');
  if (hasContact && contactName) await fill('Tên người liên hệ', contactName);
  let owner = null; if (needOwner) owner = await pickFirstOption('Nhân viên phụ trách');
  await sleep(300); await clickBtn('Thêm khách hàng');
  await waitFor(`document.body.innerText.includes('Đã thêm khách hàng')`, 'toast da them', 15000);
  await sleep(500);
  return { hasContact, owner, toast: await ev("(document.body.innerText.match(/Đã thêm khách hàng[^\\n]*/) || [''])[0]") };
}

const PHONE = '028 3822 1234';
try {
  await login('admin');
  const lk = await pageFetch('/lookups?type=province');
  const api = (lk.body && lk.body.data && lk.body.data.province || []).map((x) => x.label);
  rec('P1 API /lookups?type=province: 34 muc, 3 dau = Ha Noi, TP. Ho Chi Minh, Da Nang', lk.status === 200 && api.length === 34 && api[0] === 'Hà Nội' && api[1] === 'TP. Hồ Chí Minh' && api[2] === 'Đà Nẵng', 'n=' + api.length + ' dau=' + api.slice(0, 4).join(', '));
  await goto(WEB + '/#/customers'); await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Thêm khách hàng') && !b.disabled)", 'nut them');
  await clickBtn('Thêm khách hàng'); await waitFor('!!(' + labelEl('Tên công ty') + ')', 'form them'); await sleep(1200);
  // Select tuỳ biến: nút (aria-haspopup=listbox) trong cùng khối với nhãn; mở ra danh sách role=listbox.
  const trig = '(() => { const l = ' + labelEl('Tỉnh / Thành phố') + '; let n = l; for (let i = 0; i < 4 && n; i++) { n = n.parentElement; const b = n && n.querySelector("button[aria-haspopup=listbox]"); if (b) return b; } return null; })()';
  await ev(trig + '.click()'); await sleep(500);
  const opts = await ev('[...document.querySelectorAll("[role=listbox] [role=option], [role=listbox] button, [role=listbox] > *")].map((o) => o.textContent.trim())');
  const real = [...new Set((opts || []).filter((o) => o && !o.startsWith('—')))];
  await shot('province_dropdown.png');
  await ev('(() => { const o = [...document.querySelectorAll("[role=listbox] *")].find((x) => x.children.length === 0 && x.textContent.trim() === "Đà Nẵng") || [...document.querySelectorAll("[role=listbox] > *")].find((x) => x.textContent.trim() === "Đà Nẵng"); (o.closest("button,[role=option]") || o).click(); })()'); await sleep(400);
  rec('P2 o "Tinh / Thanh pho" tren bieu mau: 34 lua chon, dung thu tu API (3 thanh pho dau, con lai ABC)', real.length === 34 && JSON.stringify(real) === JSON.stringify(api), 'dau=' + real.slice(0, 5).join(', ') + ' ... cuoi=' + real.slice(-2).join(', '));
  rec('P3 khong con thong bao "May chu chua co danh muc nay"', !(await hasText('Máy chủ chưa có danh mục này')));
  const comp = 'Cty Tinh Thanh ' + STAMP;
  await fill('Tên công ty', comp); await fill('Điện thoại', PHONE); await sleep(400);
  rec('P2b chon "Da Nang" tren o => hien "Da Nang"', await ev(trig + '.textContent.trim() === "Đà Nẵng"'));
  await shot('province_form.png');
  await clickBtn('Thêm khách hàng');
  await waitFor("document.body.innerText.includes('Đã thêm khách hàng')", 'toast them', 15000);
  const id = await idByName(comp);
  await openDetail(id);
  rec('P4 luu khach voi Tinh/Thanh = Da Nang => chi tiet hien "Da Nang"', (await bodyText()).includes('Đà Nẵng'));
  await shot('province_detail.png');
  await logout();
} catch (e) { rec('LOI', false, e.message); try { await shot('province_error.png'); } catch (x) { /* */ } }
finally { try { ws.close(); } catch (e) { /* */ } }
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`TONG: PASS=${results.length - fail} FAIL=${fail}`);
if (EVIDENCE) fs.writeFileSync(EVIDENCE, JSON.stringify({ at: new Date().toISOString(), web: WEB, stamp: STAMP, results }, null, 2));
process.exit(fail ? 1 : 0);
