import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

// Kiểm tra bảo mật phụ thuộc (npm audit 2026-11-02).
// GHSA-27r3-jxmh-p828 (body-parser < 2.4.0, CVSS 7.5): body có Content-Encoding gồm một khung nén hợp lệ + byte thừa có thể làm bộ giải nén
// phát lỗi KHÔNG được bắt ⇒ tiến trình thoát; không cần đăng nhập, parse chạy trước định tuyến. Trên Node 24.15.0 + body-parser 2.3.0 KHÔNG
// tái hiện được bằng 6 biến thể dưới đây (đều trả 400/200, tiến trình sống) — test giữ làm chốt hồi quy hành vi trên app Nest THẬT
// (NestFactory.create với body parser mặc định như src/main.ts) và một chốt "sàn phiên bản" để lockfile không lùi về bản có lỗ hổng.
const CHILD = `
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
class M {}
Module({})(M);
(async () => {
  const app = await NestFactory.create(M, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  process.stdout.write('PORT=' + app.getHttpServer().address().port + '\\n');
})().catch((e) => { process.stderr.write(String(e)); process.exit(3); });
`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gửi request thô qua TCP để điều khiển được việc tách lần ghi (byte thừa đến SAU khung nén).
function rawPost(port: number, encoding: string, frame: Buffer, tail: Buffer, split: boolean): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const s = connect(port, '127.0.0.1', async () => {
      s.write('POST /api/v1/auth/login HTTP/1.1\r\nHost: t\r\nContent-Type: application/json\r\nContent-Encoding: ' + encoding + '\r\nContent-Length: ' + (frame.length + tail.length) + '\r\nConnection: close\r\n\r\n');
      if (split) { s.write(frame); await sleep(250); s.write(tail); } else s.write(Buffer.concat([frame, tail]));
    });
    s.on('data', (d) => { data += d; });
    s.on('close', () => resolve(data.split('\r\n')[0]));
    s.on('error', () => resolve('SOCKET_ERROR'));
    setTimeout(() => s.destroy(), 3000);
  });
}

describe('phụ thuộc HTTP: body nén kèm byte thừa không được làm sập backend (GHSA-27r3-jxmh-p828)', () => {
  let child: ChildProcess | undefined;
  afterEach(() => { if (child && child.exitCode === null) child.kill(); });

  it('app Nest mặc định: gzip/deflate/br × (1 lần ghi | tách 2 lần ghi) — tiến trình còn sống, request kế tiếp vẫn được trả lời', async () => {
    child = spawn(process.execPath, ['-e', CHILD], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let exited: number | null = null; child.on('exit', (code) => { exited = code ?? -1; });
    const port = await new Promise<number>((resolve, reject) => {
      let buf = ''; const t = setTimeout(() => reject(new Error('child không lên kịp')), 15000);
      child!.stdout!.on('data', (d) => { buf += d; const m = /PORT=(\d+)/.exec(buf); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    });
    const tail = Buffer.from('TRAILING-GARBAGE');
    const body = Buffer.from('{}');
    for (const [enc, frame] of [['gzip', gzipSync(body)], ['deflate', deflateSync(body)], ['br', brotliCompressSync(body)]] as const) {
      for (const split of [false, true]) {
        const status = await rawPost(port, enc, frame, tail, split);
        await sleep(400); // lỗi của bộ giải nén (nếu có) phát SAU khi đã trả lời
        expect({ enc, split, alive: exited === null }).toEqual({ enc, split, alive: true });
        expect(status).toMatch(/^HTTP\/1\.1 (400|404|413|415)/); // không 5xx; route thử không tồn tại ⇒ 404 nếu body hợp lệ
      }
    }
    expect(await rawPost(port, 'identity', Buffer.from('{}'), Buffer.alloc(0), false)).toMatch(/^HTTP\/1\.1 404/);
  }, 60000);

  it('sàn phiên bản: body-parser >= 2.4.0, multer >= 2.5.0, qs >= 6.17.0, prisma/@prisma/* = 7.10.1 (không lùi về bản có advisory)', () => {
    const v = (pkg: string) => (JSON.parse(readFileSync(join(process.cwd(), 'node_modules', pkg, 'package.json'), 'utf8')) as { version: string }).version;
    const ge = (a: string, b: string) => { const [x, y] = [a, b].map((s) => s.split('-')[0].split('.').map(Number)); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return true; };
    expect({ bodyParser: ge(v('body-parser'), '2.4.0'), multer: ge(v('multer'), '2.5.0'), qs: ge(v('qs'), '6.17.0') }).toEqual({ bodyParser: true, multer: true, qs: true });
    expect([v('@prisma/client'), v('@prisma/adapter-pg'), v('prisma')]).toEqual(['7.10.1', '7.10.1', '7.10.1']);
  });
});
