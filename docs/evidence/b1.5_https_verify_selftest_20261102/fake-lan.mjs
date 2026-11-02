// May chu GIA LAP Caddy+backend cho tu kiem demo-lan-tls-verify.mjs. Chi 127.0.0.1. MODE: ok | tls10 | csrf-lenient | open-port
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
const dir = new URL('./', import.meta.url);
const mode = process.argv[2] || 'ok';
const PORT = 18443, ORIGIN = 'https://127.0.0.1:' + PORT;
const opts = { key: fs.readFileSync(new URL('leaf-key.pem', dir)), cert: fs.readFileSync(new URL('leaf.pem', dir)), minVersion: 'TLSv1.2' };
if (mode === 'tls10') { opts.minVersion = 'TLSv1'; opts.ciphers = 'DEFAULT@SECLEVEL=0'; }
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
https.createServer(opts, (req, res) => {
  if (req.method === 'GET' && req.url === '/') return send(res, 200, 'text/html', '<!doctype html><div id="root"></div>');
  if (req.method === 'GET' && req.url === '/api/v1/health') return send(res, 200, 'application/json', '{"status":"ok"}');
  if (req.method === 'GET' && req.url === '/manifest.webmanifest') return send(res, 200, 'application/manifest+json', '{"name":"SISCOM CRM"}');
  if (req.method === 'POST' && req.url === '/api/v1/auth/login') {
    const o = req.headers.origin;
    if (mode !== 'csrf-lenient' && o !== undefined && o !== ORIGIN) return send(res, 403, 'application/json', '{"error":{"code":"CSRF_FAILED"}}');
    return send(res, 400, 'application/json', '{"error":{"code":"VALIDATION_FAILED"}}');
  }
  return send(res, 404, 'application/json', '{"error":{"code":"NOT_FOUND"}}');
}).listen(PORT, '127.0.0.1', () => console.log('fake-lan ' + mode + ' ' + ORIGIN));
if (mode === 'open-port') net.createServer((s) => s.end()).listen(18999, '127.0.0.1');
