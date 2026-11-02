// May chu GIA LAP Caddy+backend cho tu kiem demo-lan-tls-verify.mjs. Chi 127.0.0.1.
// MODE: ok | tls10 | no-tls11 | csrf-lenient | open-port | reset-2nd | reset-after-1st
//   tls10     : nhan TLS 1.0-1.3 (phai bi T5 bat)
//   no-tls11  : nhan TLS 1.0 + 1.2/1.3 nhung TAT RIENG TLS 1.1 (gop y Codex #199: T5 cu PASS gia voi ERR_SSL_INAPPROPRIATE_FALLBACK)
//   reset-2nd : ket noi TCP thu 2 (doi chung T4) bi dong ngay (gop y Codex #199: T4 cu PASS gia voi ECONNRESET); cac ket noi sau binh thuong
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import { constants } from 'node:crypto';
const dir = new URL('./', import.meta.url);
const mode = process.argv[2] || 'ok';
const PORT = 18443, ORIGIN = 'https://127.0.0.1:' + PORT;
const opts = { key: fs.readFileSync(new URL('leaf-key.pem', dir)), cert: fs.readFileSync(new URL('leaf.pem', dir)), minVersion: 'TLSv1.2' };
if (mode === 'tls10' || mode === 'no-tls11') { opts.minVersion = 'TLSv1'; opts.ciphers = 'DEFAULT@SECLEVEL=0'; }
if (mode === 'no-tls11') opts.secureOptions = constants.SSL_OP_NO_TLSv1_1;
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
const srv = https.createServer(opts, (req, res) => {
  if (req.method === 'GET' && req.url === '/') return send(res, 200, 'text/html', '<!doctype html><div id="root"></div>');
  if (req.method === 'GET' && req.url === '/api/v1/health') return send(res, 200, 'application/json', '{"status":"ok"}');
  if (req.method === 'GET' && req.url === '/manifest.webmanifest') return send(res, 200, 'application/manifest+json', '{"name":"SISCOM CRM"}');
  if (req.method === 'POST' && req.url === '/api/v1/auth/login') {
    const o = req.headers.origin;
    if (mode !== 'csrf-lenient' && o !== undefined && o !== ORIGIN) return send(res, 403, 'application/json', '{"error":{"code":"CSRF_FAILED"}}');
    return send(res, 400, 'application/json', '{"error":{"code":"VALIDATION_FAILED"}}');
  }
  return send(res, 404, 'application/json', '{"error":{"code":"NOT_FOUND"}}');
});
let n = 0;
if (mode === 'reset-2nd') srv.prependListener('connection', (sock) => { n++; if (n === 2) sock.destroy(); });
// reset-after-1st: moi ket noi sau lan dau deu bi dong (loi mang KEO DAI) => T4 phai 'khong ket luan duoc', khong PASS
if (mode === 'reset-after-1st') srv.prependListener('connection', (sock) => { n++; if (n >= 2) sock.destroy(); });
srv.listen(PORT, '127.0.0.1', () => console.log('fake-lan ' + mode + ' ' + ORIGIN));
if (mode === 'open-port') net.createServer((s) => s.end()).listen(18999, '127.0.0.1');
