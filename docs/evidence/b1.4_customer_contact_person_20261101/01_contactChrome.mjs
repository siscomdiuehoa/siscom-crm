// Kiem thu "Nguoi lien he" trong Chrome that (headless, CDP) tren ban demo (cum 55433, backend 3100, web 4173 = build nhanh feat/b1.4-customer-contact-person).
// Mat khau doc tu BOOTSTRAP_PASSWORD_ADMIN/_SALE/_TECHNICIAN/_ACCOUNTANT, khong in. Dang nhap bang MA NV (khong tron han muc dang nhap theo email).
// Ma thoat: 0 dat, 1 co FAIL, 2 BLOCKED.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const G = await import('file:///D:/SISCOM-CRM-contact/frontend/siscom-crm-web/tests/browser/harnessGuard.mjs');
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
let adminCid = null;
try {
  // ---------- crm_admin ----------
  await login('admin');
  const compA = 'Cty LH Admin ' + STAMP;
  const ca = await createViaForm(compA, PHONE, 'Nguyễn Văn Liên Hệ', false);
  rec('A1 crm_admin: bieu mau them khach co o "Ten nguoi lien he" (khong co o SDT rieng)', ca.hasContact && !(await hasField('Điện thoại người liên hệ')));
  rec('A2 crm_admin: them khach + nguoi lien he => thong bao thanh cong (khong canh bao)', /Đã thêm khách hàng KH-/.test(ca.toast) && !/chưa lưu người liên hệ/.test(ca.toast), ca.toast);
  adminCid = await idByName(compA);
  rec('A3 khach vua tao tim thay qua API', !!adminCid);
  await openDetail(adminCid);
  await waitFor("document.body.innerText.includes('Nguyễn Văn Liên Hệ')", 'ten nguoi lien he tren chi tiet');
  const t1 = await bodyText();
  rec('A4 trang chi tiet hien "Nguoi lien he: Nguyen Van Lien He · <SDT cong ty> (SĐT công ty)"', t1.includes('Người liên hệ') && t1.includes('Nguyễn Văn Liên Hệ · ' + PHONE + ' (SĐT công ty)'), (t1.match(/Người liên hệ[^Đ]*/) || [''])[0].slice(0, 90));
  await shot('contact_admin_detail.png');
  const l1 = await pageFetch('/customers/' + adminCid + '/contacts');
  const it1 = l1.body && l1.body.data && l1.body.data.items || [];
  rec('A5 API: 1 nguoi lien he, isPrimary, phone = SDT cong ty (khong truong SDT moi)', l1.status === 200 && it1.length === 1 && it1[0].isPrimary === true && it1[0].phone === PHONE, 'status=' + l1.status + ' n=' + it1.length);
  // Sua: doi ten
  await clickBtn('Sửa thông tin'); await waitFor(`!!(${labelEl('Tên người liên hệ')})`, 'o ten nguoi lien he khi sua');
  rec('A6 sua: o "Ten nguoi lien he" dien san ten hien tai', (await fieldValue('Tên người liên hệ')) === 'Nguyễn Văn Liên Hệ');
  await fill('Tên người liên hệ', 'Trần Liên Hệ Mới'); await sleep(300); await clickBtn('Lưu thay đổi');
  await waitFor("document.body.innerText.includes('Trần Liên Hệ Mới · ')", 'ten moi tren chi tiet', 15000);
  rec('A7 sua ten => chi tiet hien ten moi (van SDT cong ty)', (await bodyText()).includes('Trần Liên Hệ Mới · ' + PHONE + ' (SĐT công ty)'));
  const l2 = await pageFetch('/customers/' + adminCid + '/contacts'); const it2 = l2.body.data.items;
  rec('A8 API: dung 1 nguoi chinh (ten moi), ban cu go co chinh', it2.filter((c) => c.isPrimary).length === 1 && it2.find((c) => c.isPrimary).fullName === 'Trần Liên Hệ Mới', 'n=' + it2.length);
  await shot('contact_admin_after_edit.png');
  await logout();

  // ---------- sales (OWN) ----------
  await login('sale');
  const compS = 'Cty LH Sale ' + STAMP;
  const cs = await createViaForm(compS, '0901 234 567', 'Lê Thị Sale', true);
  rec('S1 sales: tao khach cua minh + nguoi lien he qua bieu mau', cs.hasContact && /Đã thêm khách hàng KH-/.test(cs.toast) && !/chưa lưu/.test(cs.toast), cs.toast);
  const saleCid = await idByName(compS);
  await openDetail(saleCid);
  await waitFor("document.body.innerText.includes('Lê Thị Sale')", 'ten nguoi lien he sales');
  rec('S2 sales: chi tiet khach cua minh hien nguoi lien he + SDT cong ty', (await bodyText()).includes('Lê Thị Sale · 0901 234 567 (SĐT công ty)'));
  const sg = await pageFetch('/customers/' + adminCid + '/contacts');
  rec('S3 sales: GET contacts khach cua nguoi khac => 404 (khong lo ton tai)', sg.status === 404, 'status=' + sg.status);
  const sp = await postContact(adminCid, { fullName: 'Hack', isPrimary: true, phone: PHONE });
  rec('S4 sales: POST contacts khach cua nguoi khac => 404', sp.status === 404, 'status=' + sp.status);
  await logout();

  // ---------- accountant (doc tat ca, khong tao) ----------
  await login('ketoan');
  await openDetail(adminCid);
  await waitFor("document.body.innerText.includes('Trần Liên Hệ Mới')", 'ketoan thay nguoi lien he', 15000);
  rec('K1 accountant: xem chi tiet khach bat ky thay nguoi lien he + SDT cong ty', (await bodyText()).includes('Trần Liên Hệ Mới · ' + PHONE));
  rec('K2 accountant: nut "Sua thong tin" bi khoa (khong customer.update)', (await btnState('Sửa thông tin')) === 'disabled', await btnState('Sửa thông tin'));
  const kp = await postContact(adminCid, { fullName: 'Ke toan them', isPrimary: true, phone: PHONE });
  rec('K3 accountant: POST contacts => 403', kp.status === 403, 'status=' + kp.status);
  await shot('contact_accountant_detail.png');
  await logout();

  // ---------- technician (doc theo phong, khong tao) ----------
  await login('kythuat');
  const tg = await pageFetch('/customers/' + adminCid + '/contacts');
  rec('T1 technician: GET contacts khach ngoai phong (khong chu so huu) => 404', tg.status === 404, 'status=' + tg.status);
  const tp = await postContact(adminCid, { fullName: 'Ky thuat them', isPrimary: true, phone: PHONE });
  rec('T2 technician: POST contacts => 403 hoac 404 (khong co contact.create)', tp.status === 403 || tp.status === 404, 'status=' + tp.status);
  await openDetail(adminCid);
  rec('T3 technician: trang chi tiet khong hien ten nguoi lien he cua khach ngoai pham vi', !(await hasText('Trần Liên Hệ Mới')));
  await logout();
} catch (e) { rec('LOI kich ban', false, e.message); try { await shot('contact_error.png'); } catch (x) { /* */ } }
finally { try { ws.close(); } catch (e) { /* */ } }
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`TONG: PASS=${results.length - fail} FAIL=${fail}`);
if (EVIDENCE) fs.writeFileSync(EVIDENCE, JSON.stringify({ at: new Date().toISOString(), web: WEB, stamp: STAMP, results }, null, 2));
process.exit(fail ? 1 : 0);
