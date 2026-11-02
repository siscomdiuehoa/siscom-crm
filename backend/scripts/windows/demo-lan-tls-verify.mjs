// SISCOM CRM B1.5 - KIEM HTTPS CUA BAN DEMO LAN VOI XAC THUC TLS THAT (docs/B1.5_PHONE_HTTPS_GUIDE.md muc G).
// Chay: node backend\scripts\windows\demo-lan-tls-verify.mjs --origin https://<IP Wi-Fi>:8443 --ca <...\lan-certs\CA\rootCA.pem>
// KHONG bo qua kiem chung chi: chi tin DUNG CA mkcert (rootCA.pem - chung chi CONG KHAI), rejectUnauthorized luon bat, kiem IP/ten trong SAN.
// Co ca DOI CHUNG phai THAT BAI (khong co CA => tu choi; ep TLS 1.1 => tu choi) de chung minh viec xac thuc co hieu luc.
// Khong doc .env, khong dang nhap, khong gui mat khau; chi GET va 2 POST /auth/login KHONG thong tin dang nhap (bi chan o CSRF/validation,
// khong vao bo dem han muc). Khong thay doi gi tren may. In SPKI (sha256, base64) cua chung chi de Chrome thu nghiem chi chap nhan DUNG khoa nay.
// Ma thoat: 0 = dat het; 1 = co FAIL; 2 = BLOCKED (tham so sai / khong ket noi duoc).
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
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
const t4 = await handshake({});
rec('T4 doi chung: khong co CA mkcert => bi tu choi', !t4.ok ? 'PASS' : 'FAIL', t4.ok ? 'BAT TAY THANH CONG khi khong co CA - CA mkcert dang nam trong kho tin cay he thong?' : String(t4.code));
// T5 - doi chung: ep TLS <= 1.1 => phai bi tu choi; giao thuc thuc te >= 1.2.
// SECLEVEL=0 chi o PHIA THU (client) de chinh client khong tu chan TLS 1.0/1.1 (OpenSSL 3) - neu khong, ca nay se "dat" gia.
const t5 = await handshake({ ca: [caPem], minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
rec('T5 doi chung: TLS 1.0/1.1 bi tu choi; giao thuc thuc te >= TLS 1.2', !t5.ok && /^TLSv1\.[23]$/.test(t1.protocol) ? 'PASS' : 'FAIL', t5.ok ? 'chap nhan ' + t5.protocol : 'tu choi (' + t5.code + '); thuc te ' + t1.protocol);
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
