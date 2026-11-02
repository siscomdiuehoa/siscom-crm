// 127.0.0.1:18555 — /ok 200 day du; /trunc gui header 200 Content-Length 1000 roi cat; /hang gui header 200 roi treo; /e500 500 day du.
import http from 'node:http';
http.createServer((q, r) => {
  if (q.url === '/ok') { r.writeHead(200, { 'content-length': 2 }); return r.end('ok'); }
  if (q.url === '/e500') { r.writeHead(500, { 'content-length': 1 }); return r.end('x'); }
  if (q.url === '/trunc') { r.writeHead(200, { 'content-length': 1000 }); r.write('partial'); return setTimeout(() => q.socket.destroy(), 100); }
  if (q.url === '/hang') { r.writeHead(200, { 'content-length': 1000 }); r.write('partial'); return; }
}).listen(18555, '127.0.0.1', () => console.log('ready'));
