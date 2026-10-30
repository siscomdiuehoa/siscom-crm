import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { applyTrustProxy, TrustProxySetting } from '../../app.setup';
import { clientAddress } from './client-address';

// B1.4 P1: chống giả mạo IP qua X-Forwarded-For. Chạy trên Express thật (proxy-addr) để kiểm đúng ngữ nghĩa 'trust proxy':
//   false     => luôn là địa chỉ socket, header bị bỏ qua hoàn toàn (mặc định an toàn khi không có reverse proxy).
//   loopback  => chỉ tin proxy ở 127.0.0.1/::1 (nginx cùng máy); địa chỉ khách = hop gần proxy nhất KHÔNG được tin,
//                nên phần header do khách tự thêm vào (bên trái) không có tác dụng.
//   n (1..5)  => tin đúng n hop tính từ socket.
// Header không phải IP hợp lệ => rơi về địa chỉ socket (không đưa chuỗi tuỳ ý vào hạn mức / nhật ký phiên).
@Controller('echo')
class EchoController { @Get() get(@Req() req: Request) { return clientAddress(req); } }
@Module({ controllers: [EchoController] })
class EchoModule {}

async function appWith(setting: TrustProxySetting): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [EchoModule] }).compile();
  const app = mod.createNestApplication();
  app.useLogger(false);
  applyTrustProxy(app, setting);
  await app.init();
  return app;
}
const get = (app: INestApplication, xff?: string) => {
  const r = request(app.getHttpServer()).get('/echo');
  return xff === undefined ? r : r.set('X-Forwarded-For', xff);
};
const SPOOF = '203.0.113.5'; // địa chỉ khách tự khai
const REAL = '198.51.100.9'; // địa chỉ nginx nối thêm (khách thật)

describe('clientAddress + applyTrustProxy (B1.4 P1, chống giả mạo X-Forwarded-For)', () => {
  let socketIp = '';
  let appOff: INestApplication; let appLoop: INestApplication; let app1: INestApplication; let app2: INestApplication;
  beforeAll(async () => {
    appOff = await appWith(false); appLoop = await appWith('loopback'); app1 = await appWith(1); app2 = await appWith(2);
    const base = await get(appOff);
    expect(base.status).toBe(200);
    socketIp = base.body.ip; // địa chỉ socket thật của supertest (127.0.0.1 hoặc ::ffff:127.0.0.1)
    expect(typeof socketIp).toBe('string');
  });
  afterAll(async () => { await Promise.all([appOff, appLoop, app1, app2].map((a) => a?.close())); });

  it('TRUST_PROXY=false (mặc định): X-Forwarded-For bị bỏ qua, nguồn = địa chỉ socket', async () => {
    const r = await get(appOff, SPOOF);
    expect(r.body).toEqual({ source: socketIp, ip: socketIp });
    expect(r.body.ip).not.toBe(SPOOF);
  });
  it('loopback: không có header => địa chỉ socket', async () => {
    expect((await get(appLoop)).body).toEqual({ source: socketIp, ip: socketIp });
  });
  it('loopback: header một địa chỉ (nginx cùng máy đặt) => dùng địa chỉ đó', async () => {
    expect((await get(appLoop, REAL)).body).toEqual({ source: REAL, ip: REAL });
  });
  it('loopback: khách tự khai "SPOOF", nginx nối thêm khách thật => lấy khách thật (hop gần proxy nhất), bỏ phần giả', async () => {
    const r = await get(appLoop, SPOOF + ', ' + REAL);
    expect(r.body).toEqual({ source: REAL, ip: REAL });
  });
  it('loopback: header không phải IP hợp lệ => rơi về địa chỉ socket, không nhận chuỗi lạ', async () => {
    for (const bad of ['khong-phai-ip', '203.0.113.5:8080', 'x'.repeat(300), '203.0.113.5, abc']) {
      const r = await get(appLoop, bad);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ source: socketIp, ip: socketIp });
    }
  });
  it('số hop: 1 => địa chỉ cuối header; 2 => địa chỉ kế cuối (hop ngoài phạm vi tin bị bỏ)', async () => {
    expect((await get(app1, SPOOF + ', ' + REAL)).body.ip).toBe(REAL);
    expect((await get(app2, SPOOF + ', ' + REAL)).body.ip).toBe(SPOOF);
    expect((await get(app2, '192.0.2.1, ' + SPOOF + ', ' + REAL)).body.ip).toBe(SPOOF);
  });
  it('clientAddress thuần: không có req.ip và socket => "unknown"/null', () => {
    expect(clientAddress({ ip: undefined, socket: {} } as unknown as Request)).toEqual({ source: 'unknown', ip: null });
  });
});
