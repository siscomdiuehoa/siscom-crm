// SISCOM CRM B1.5 - KIEM HTTPS CUA BAN DEMO LAN VOI XAC THUC TLS THAT (docs/B1.5_PHONE_HTTPS_GUIDE.md muc G).
// Chay: node backend\scripts\windows\demo-lan-tls-verify.mjs --origin https://<IP Wi-Fi>:8443 --ca <...\lan-certs\CA\rootCA.pem>
// KHONG bo qua kiem chung chi: chi tin DUNG CA mkcert (rootCA.pem - chung chi CONG KHAI), rejectUnauthorized luon bat, kiem IP/ten trong SAN.
// Co ca DOI CHUNG phai THAT BAI (khong co CA => tu choi; ep TLS 1.0/1.1 => tu choi) de chung minh viec xac thuc co hieu luc.
// T4 con DOC (chi doc) kho Root cua Windows qua PowerShell de chac CA mkcert KHONG nam trong kho tin cay he thong. Tu kiem: demo-lan-tls-verify.selftest.mjs
// Khong doc .env, khong dang nhap, khong gui mat khau; chi GET va 2 POST /auth/login KHONG thong tin dang nhap (bi chan o CSRF/validation,
// khong vao bo dem han muc). Khong thay doi gi tren may. In SPKI (sha256, base64) cua chung chi de Chrome thu nghiem chi chap nhan DUNG khoa nay.
// Ma thoat: 0 = dat het; 1 = co FAIL; 2 = BLOCKED (tham so sai / khong ket noi duoc).
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- Kho CA tin cay cua WINDOWS (T4) - doc TRUC TIEP, CHI DOC, khong phu thuoc NODE_USE_SYSTEM_CA ----
// Node 24 mac dinh CHI tin kho CA rieng cua Node; kho Windows chi duoc dung khi dat NODE_USE_SYSTEM_CA=1 / --use-system-ca.
// Vi vay handshake khong CA (T4 cu) KHONG chung minh duoc CA mkcert vang mat khoi kho Windows. Ham duoi doi chieu SHA-256 cua
// rootCA.pem voi TUNG chung chi trong cac kho Root cua Windows (Get-ChildItem Cert:\..., chi doc; khong them/xoa/sua chung chi nao).
export const WINDOWS_ROOT_STORES = ['Cert:\\CurrentUser\\Root', 'Cert:\\LocalMachine\\Root', 'Cert:\\LocalMachine\\AuthRoot'];
const PS_READ_STORES = "$ErrorActionPreference='Stop'; foreach ($s in @(" + WINDOWS_ROOT_STORES.map((s) => "'" + s + "'").join(',') + ")) { Get-ChildItem -LiteralPath $s | ForEach-Object { 'C ' + $s + ' ' + [Convert]::ToBase64String($_.RawData) } }; 'END'";
export function defaultPowerShellPath() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
// Tra { ok: true, certs: [{ store, der }] } hoac { ok: false, code: 'TIMEOUT' | 'READ_ERROR' | 'NOT_WINDOWS', detail }.
export function readWindowsRootStore({ timeoutMs = 20000, psPath = defaultPowerShellPath(), exec = execFile, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.resolve({ ok: false, code: 'NOT_WINDOWS', detail: 'he dieu hanh ' + platform });
  return new Promise((resolve) => {
    exec(psPath, ['-NoProfile', '-NonInteractive', '-Command', PS_READ_STORES], { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed || err.signal || err.code === 'ETIMEDOUT') return resolve({ ok: false, code: 'TIMEOUT', detail: 'qua ' + timeoutMs + ' ms' });
        return resolve({ ok: false, code: 'READ_ERROR', detail: String((stderr || err.message || err.code || '')).split(/\r?\n/).find((l) => l.trim()) || String(err.code) });
      }
      const lines = String(stdout).split(/\r?\n/);
      if (!lines.some((l) => l.trim() === 'END')) return resolve({ ok: false, code: 'READ_ERROR', detail: 'dau ra thieu dong END (bi cat)' });
      const certs = [];
      for (const l of lines) { const m = /^C (\S+) ([A-Za-z0-9+/=]+)$/.exec(l.trim()); if (m) certs.push({ store: m[1], der: Buffer.from(m[2], 'base64') }); }
      resolve({ ok: true, certs });
    });
  });
}
// Tra { ok, status: 'NOT_PRESENT' | 'PRESENT' | 'ERROR', detail }. ok=true CHI khi doc duoc kho va KHONG co chung chi nao trung SHA-256.
// So bang dau van tay SHA-256 cua toan bo chung chi (khong so ten/subject: CA khac khoa cung ten => khong trung).
export async function checkCaNotInWindowsStore(caPem, { reader = readWindowsRootStore } = {}) {
  let caFp;
  try { caFp = new crypto.X509Certificate(caPem).fingerprint256; } catch { return { ok: false, status: 'ERROR', detail: 'khong doc duoc rootCA.pem' }; }
  const r = await reader();
  if (!r.ok) return { ok: false, status: 'ERROR', detail: 'khong ket luan duoc: khong doc duoc kho CA Windows (' + r.code + (r.detail ? ': ' + r.detail : '') + ')' };
  let parsed = 0; const hits = new Set();
  for (const c of r.certs) {
    let fp; try { fp = new crypto.X509Certificate(c.der).fingerprint256; } catch { continue; }
    parsed++; if (fp === caFp) hits.add(c.store);
  }
  if (!parsed) return { ok: false, status: 'ERROR', detail: 'khong ket luan duoc: kho CA Windows doc ra 0 chung chi hop le' };
  if (hits.size) return { ok: false, status: 'PRESENT', detail: 'CA mkcert (SHA-256 ' + caFp + ') CO trong kho Windows: ' + [...hits].join(', ') };
  return { ok: true, status: 'NOT_PRESENT', detail: 'SHA-256 ' + caFp.slice(0, 23) + '... khong trung voi ' + parsed + ' chung chi trong ' + WINDOWS_ROOT_STORES.join(', ') };
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) await main();

async function main() {
const arg =(name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const origin = arg('origin', '');
const caPath = arg('ca', '');
// Cong noi bo phai KHONG mo ra Wi-Fi (backend 3100, web 4173, PG demo 55433, PG that 5432) - thu ket noi qua chinh IP Wi-Fi.
const closedPorts = arg('closed-ports', '3100,4173,55433,5432').split(',').map((s) => Number(s.trim())).filter((n) => n > 0 && n < 65536);
const results = [];
const rec = (id, status, detail = '') => { results.push({ id, status, detail }); console.log('[' + status + '] ' + id + (detail ? ' - ' + detail : '')); };
const blocked = (msg) => { console.log('BLOCKED: ' + msg); process.exit(2); };

let u;
try { u = new URL(origin); } catch { blocked('--origin phai la https://<IP>:<cong> (vi du https://192.168.1.10:8443)'); }
if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password) blocked('--origin chi gom https://<host>:<cong>, khong duong dan/tham so');
const host = u.hostname.replace(/^\[|\]$/g, ''); const port = Number(u.port || 443);
if (!caPath || !fs.existsSync(caPath)) blocked('--ca phai tro toi CA\\rootCA.pem (chung chi CONG KHAI cua CA mkcert)');
if (/key/i.test(caPath.split(/[\\/]/).pop())) blocked('--ca khong duoc la file khoa (ten co chu "key"). Chi dung rootCA.pem.');
const caPem = fs.readFileSync(caPath, 'utf8');
if (/PRIVATE KEY/.test(caPem)) blocked('file --ca chua KHOA RIENG - tu choi doc. Chi dung rootCA.pem.');
if (!/BEGIN CERTIFICATE/.test(caPem)) blocked('file --ca khong phai chung chi PEM');
console.log('Kiem ' + origin + ' voi CA ' + caPath + ' (chi tin CA nay; xac thuc TLS bat)');
const sni = net.isIP(host) ? undefined : host;

// Bat tay TLS. opts.ca khong dat => dung kho tin cay mac dinh cua Node (KHONG co CA mkcert).
function handshake(opts) {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port, servername: sni, rejectUnauthorized: true, ALPNProtocols: ['h2', 'http/1.1'], ...opts }, () => {
      const cert = s.getPeerCertificate(true);
      resolve({ ok: true, protocol: s.getProtocol(), cipher: s.getCipher()?.name, alpn: s.alpnProtocol, cert, authorized: s.authorized });
      s.end();
    });
    s.setTimeout(5000, () => { s.destroy(); resolve({ ok: false, code: 'TIMEOUT' }); });
    s.on('error', (e) => resolve({ ok: false, code: e.code || e.message }));
  });
}
function request(method, path, headers = {}, body) {
  return new Promise((resolve) => {
    const req = https.request({ host, port, method, path, headers: { 'user-agent': 'siscom-tls-verify', ...headers }, ca: [caPem], rejectUnauthorized: true, servername: sni, timeout: 8000 }, (res) => {
      let data = ''; res.setEncoding('utf8'); res.on('data', (c) => { if (data.length < 20000) data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('timeout', () => { req.destroy(new Error('TIMEOUT')); });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.code || e.message }));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const tcpOpen = (p) => new Promise((resolve) => { const s = net.connect({ host, port: p }); const done = (v) => { s.destroy(); resolve(v); }; s.setTimeout(2500, () => done('timeout')); s.on('connect', () => done('open')); s.on('error', (e) => done(e.code || 'error')); });
const json = (b) => { try { return JSON.parse(b); } catch { return null; } };

// T1 - chuoi tin cay: chi CA mkcert, xac thuc day du (chuoi + IP/ten trong SAN).
const t1 = await handshake({ ca: [caPem] });
if (!t1.ok) blocked('khong bat tay TLS duoc voi CA da cho (' + t1.code + '). Kiem Caddy dang chay (-Step start), dung IP/cong, dung rootCA.pem.');
rec('T1 TLS hop le voi DUNG CA mkcert (rejectUnauthorized, kiem SAN)', t1.authorized ? 'PASS' : 'FAIL', t1.protocol + ' ' + t1.cipher + ' ALPN=' + (t1.alpn || '-'));
const leaf = t1.cert;
const sans = String(leaf.subjectaltname || '');
const want = net.isIP(host) ? 'IP Address:' + host : 'DNS:' + host;
rec('T2 SAN cua chung chi chua dung ' + want, sans.split(/,\s*/).includes(want) ? 'PASS' : 'FAIL', sans);
const daysLeft = Math.floor((new Date(leaf.valid_to) - Date.now()) / 86400000);
rec('T3 chung chi con han >= 7 ngay', daysLeft >= 7 ? 'PASS' : 'FAIL', 'het han ' + leaf.valid_to + ' (' + daysLeft + ' ngay)');
// T4 - doi chung: KHONG co CA mkcert => phai bi tu choi (chung minh xac thuc co hieu luc va CA KHONG nam trong kho tin cay chung).
// Doi chung CHI dat khi bi tu choi DUNG LY DO. Loi mang (reset/timeout/tu choi ket noi) KHONG chung minh gi => thu lai, van loi => FAIL
// "khong ket luan duoc" (QA Codex PR #199: ECONNRESET o T4, ERR_SSL_INAPPROPRIATE_FALLBACK o T5 tung bi tinh PASS gia).
const CERT_REJECT = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_UNTRUSTED']);
const VERSION_REJECT = /PROTOCOL_VERSION|UNSUPPORTED_PROTOCOL|WRONG_VERSION_NUMBER|VERSION_TOO_LOW/;
const NETWORK = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'TIMEOUT', 'ECONNABORTED', 'EHOSTUNREACH']);
async function handshakeRetry(opts) { let r; for (let i = 0; i < 3; i++) { r = await handshake(opts); if (r.ok || !NETWORK.has(r.code)) return r; } return r; }
// T4 - doi chung, PASS chi khi CA HAI dieu cung dung:
//  (a) Node KHONG kem CA mkcert => bat tay bi tu choi VI LOI XAC THUC CHUNG CHI (xac thuc co hieu luc; CA khong o kho Node/NODE_EXTRA_CA_CERTS);
//  (b) CA mkcert KHONG co trong kho Root cua Windows - doc truc tiep, so SHA-256 (khong dua vao NODE_USE_SYSTEM_CA).
//  Loi doc kho / qua thoi gian => FAIL "khong ket luan duoc", khong bao gio PASS.
const T4_ID = 'T4 doi chung: CA mkcert KHONG duoc tin ngoai script (Node tu choi vi loi xac thuc + khong co trong kho CA Windows theo SHA-256)';
const t4 = await handshakeRetry({});
const t4n = t4.ok ? { ok: false, d: 'BAT TAY THANH CONG khi khong co CA - CA mkcert dang duoc Node tin (kho he thong hoac NODE_EXTRA_CA_CERTS)?' }
  : CERT_REJECT.has(t4.code) ? { ok: true, d: t4.code } : { ok: false, d: 'khong ket luan duoc: ' + t4.code + ' khong phai loi xac thuc chung chi' };
const t4w = await checkCaNotInWindowsStore(caPem);
rec(T4_ID, t4n.ok && t4w.ok ? 'PASS' : 'FAIL', 'Node: ' + t4n.d + ' | Windows: ' + t4w.detail);
// T5 - doi chung: thu RIENG TLS 1.0 va TLS 1.1 (minVersion = maxVersion moi luot); moi luot phai bi tu choi vi LOI PHIEN BAN; thuc te >= 1.2.
// SECLEVEL=0 chi o PHIA THU (client) de chinh client khong tu chan TLS 1.0/1.1 (OpenSSL 3); client khong thu duoc (NO_PROTOCOLS_AVAILABLE...) => FAIL, khong PASS.
const t5 = [];
for (const v of ['TLSv1', 'TLSv1.1']) {
  const r = await handshakeRetry({ ca: [caPem], minVersion: v, maxVersion: v, ciphers: 'DEFAULT@SECLEVEL=0' });
  t5.push({ v, ok: !r.ok && VERSION_REJECT.test(String(r.code)), detail: r.ok ? 'CHAP NHAN ' + r.protocol : String(r.code) });
}
rec('T5 doi chung: TLS 1.0 va TLS 1.1 (thu rieng) deu bi tu choi vi loi phien ban; thuc te >= TLS 1.2', t5.every((x) => x.ok) && /^TLSv1\.[23]$/.test(t1.protocol) ? 'PASS' : 'FAIL', t5.map((x) => x.v + ': ' + x.detail).join('; ') + '; thuc te ' + t1.protocol);
const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(leaf.raw).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
console.log('SPKI sha256 (base64) cua chung chi may chu: ' + spki);

// T6..T8 - ung dung qua HTTPS (xac thuc TLS bat).
const r6 = await request('GET', '/');
rec('T6 GET / => 200 HTML (giao dien qua proxy)', r6.status === 200 && /<div id="root">/.test(r6.body) ? 'PASS' : 'FAIL', 'status=' + r6.status);
const r7 = await request('GET', '/api/v1/health');
rec('T7 GET /api/v1/health => 200 (backend qua proxy)', r7.status === 200 ? 'PASS' : 'FAIL', 'status=' + r7.status);
const mf = await request('GET', '/manifest.webmanifest');
if (mf.status === 200) rec('T8 PWA manifest qua HTTPS', /manifest\+json|application\/json/.test(String(mf.headers['content-type'])) && json(mf.body)?.name ? 'PASS' : 'FAIL', String(mf.headers['content-type']));
else rec('T8 PWA manifest qua HTTPS', 'WARN', 'status=' + mf.status + ' (ban demo chua co PR #197?)');
// T9 - CSRF/Origin: Origin la => 403 CSRF_FAILED (khong gui thong tin dang nhap; bi chan truoc khi vao dich vu dang nhap).
const bodyJ = JSON.stringify({});
const r9 = await request('POST', '/api/v1/auth/login', { 'content-type': 'application/json', origin: 'https://evil.example' }, bodyJ);
rec('T9 POST /auth/login voi Origin la => 403 CSRF_FAILED', r9.status === 403 && json(r9.body)?.error?.code === 'CSRF_FAILED' ? 'PASS' : 'FAIL', 'status=' + r9.status + ' code=' + (json(r9.body)?.error?.code || '-'));
// T10 - Origin dung (= origin cau hinh) qua duoc lop CSRF: body rong => 400 (validation), KHONG phai 403.
const r10 = await request('POST', '/api/v1/auth/login', { 'content-type': 'application/json', origin }, bodyJ);
rec('T10 POST /auth/login voi Origin dung => qua lop Origin (400 validation, khong 403)', r10.status === 400 ? 'PASS' : 'FAIL', 'status=' + r10.status + ' code=' + (json(r10.body)?.error?.code || '-'));
// T11 - HTTP thuong tren cong HTTPS khong phuc vu ung dung.
const r11 = await new Promise((resolve) => { let d = ''; const s = net.connect({ host, port }, () => s.write('GET / HTTP/1.1\r\nHost: ' + host + '\r\nConnection: close\r\n\r\n')); s.setTimeout(4000, () => { s.destroy(); resolve(d); }); s.on('data', (c) => { d += c; }); s.on('end', () => resolve(d)); s.on('error', () => resolve(d)); });
rec('T11 http:// (khong TLS) tren cong ' + port + ' khong tra giao dien', !/^HTTP\/1\.[01] 200/.test(r11) && !/<div id="root">/.test(r11) ? 'PASS' : 'FAIL', (r11.split('\r\n')[0] || 'dong ket noi').slice(0, 80));
// T12 - cac cong noi bo khong mo tren IP Wi-Fi.
for (const p of closedPorts) { const st = await tcpOpen(p); rec('T12 cong ' + p + ' KHONG mo tren ' + host, st !== 'open' ? 'PASS' : 'FAIL', st); }
console.log('[INFO] Strict-Transport-Security (backend): ' + (r7.headers?.['strict-transport-security'] || '(khong co)'));

const fail = results.filter((r) => r.status === 'FAIL').length;
console.log('TONG: PASS=' + results.filter((r) => r.status === 'PASS').length + ' FAIL=' + fail + ' WARN=' + results.filter((r) => r.status === 'WARN').length);
console.log('GIOI HAN: script kiem tu CHINH may tinh. Dien thoai tin CA va mo duoc trang phai kiem tren dien thoai that (checklist muc 10).');
process.exit(fail ? 1 : 0);
}
