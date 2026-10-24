import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../../filters/all-exceptions.filter';
import { HealthController } from '../../../health/health.controller';
import { HealthService } from '../../../health/health.service';
import { LookupsModule } from '../../../modules/lookups/lookups.module';
import { CustomersModule } from '../../../modules/customers/customers.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthModule } from '../auth.module';
import { ACTOR_PROVIDER, ActorProvider } from '../actor';
import { DenyAllActorProvider } from '../deny-all-actor.provider';

// I06 — 3 khoảng trống hợp đồng còn NOT_ACTIVE: (1) POST /auth/login, (2) GET /auth/me, (3) token -> /customers.
// Mục tiêu: khóa trạng thái "chưa kích hoạt" ở cấu hình PRODUCTION THẬT (AuthModule + DenyAllActorProvider + AccessGuard + CustomersModule,
// tiền tố api/v1, không controller/provider giả), qua HTTP thật. Phân biệt NOT_IMPLEMENTED (404/405/501: endpoint chưa tồn tại)
// với lỗi thật (401 từ chối xác thực, 403 từ chối quyền, 5xx sự cố). KHÔNG chọn JWT hay sid_, KHÔNG bật AuthController/actor provider thật.
// Không DB (Prisma giả), không .env, không AppModule. Đổi các khẳng định này chỉ trong PR triển khai được duyệt.

const ID = '11111111-1111-4111-8111-111111111111';
const NOW_S = Math.floor(Date.UTC(2026, 9, 24) / 1000);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SID_SHAPED = 'sid_' + randomBytes(32).toString('base64url'); // 4 + 43 ký tự, ứng viên A
const JWT_SHAPED = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: ID, iat: NOW_S, exp: NOW_S + 600 }), randomBytes(32).toString('base64url')].join('.'); // ứng viên B, chữ ký ngẫu nhiên
const EXPIRED_JWT_SHAPED = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: ID, iat: NOW_S - 1200, exp: NOW_S - 600 }), randomBytes(32).toString('base64url')].join('.');
const ALG_NONE_JWT = [b64({ alg: 'none', typ: 'JWT' }), b64({ sub: ID, exp: NOW_S + 600 }), ''].join('.');

type Kind = 'NOT_IMPLEMENTED' | 'AUTH_DENIED' | 'FORBIDDEN' | 'SERVER_ERROR' | 'OK' | 'OTHER';
// Cách một client (frontend authClient.js coi 404/405/501 là ENDPOINT_UNAVAILABLE) phân loại phản hồi.
const classify = (status: number): Kind => {
  if ([404, 405, 501].includes(status)) return 'NOT_IMPLEMENTED';
  if (status === 401) return 'AUTH_DENIED';
  if (status === 403) return 'FORBIDDEN';
  if (status >= 500) return 'SERVER_ERROR';
  if (status >= 200 && status < 300) return 'OK';
  return 'OTHER';
};

function makePrisma() {
  const fn = () => jest.fn().mockResolvedValue(null);
  return { $transaction: jest.fn(), customer: { findFirst: fn(), findMany: fn(), count: fn() }, lookupItem: { findMany: fn() }, contact: { findMany: fn() } };
}
const prismaCalls = (p: ReturnType<typeof makePrisma>) =>
  [p.$transaction, p.customer.findFirst, p.customer.findMany, p.customer.count, p.lookupItem.findMany, p.contact.findMany].reduce((n, f) => n + f.mock.calls.length, 0);

async function boot(provider?: ActorProvider) {
  const prisma = makePrisma();
  let b = Test.createTestingModule({
    imports: [CustomersModule, LookupsModule, AuthModule],
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: { liveness: () => ({ status: 'ok' }) } }],
  }).overrideProvider(PrismaService).useValue(prisma);
  if (provider) b = b.overrideProvider(ACTOR_PROVIDER).useValue(provider);
  const app = (await b.compile()).createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, prisma };
}
const http = (app: INestApplication) => request(app.getHttpServer());

describe('I06 — cấu hình production: auth routes NOT_IMPLEMENTED, Customers default-deny (fail-closed)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof makePrisma>;
  beforeEach(async () => { ({ app, prisma } = await boot()); });
  afterEach(async () => { await app.close(); });

  it('xác nhận cấu hình là production thật: ACTOR_PROVIDER là DenyAllActorProvider', () => {
    expect(app.get(ACTOR_PROVIDER)).toBeInstanceOf(DenyAllActorProvider);
  });

  // TODO #1 — login
  it('TODO login: POST /api/v1/auth/login (thân hợp lệ, mã NV hoặc email) -> NOT_IMPLEMENTED 404, không token, không Set-Cookie, không chạm DB', async () => {
    for (const body of [{ login: 'NV-0007', password: 'Mat-khau-thu-nghiem-1' }, { login: 'nv7@siscom.vn', password: 'Mat-khau-thu-nghiem-1' }, {}]) {
      const r = await http(app).post('/api/v1/auth/login').send(body);
      expect([r.status, classify(r.status)]).toEqual([404, 'NOT_IMPLEMENTED']);
      expect(r.body.error.code).toBe('NOT_FOUND');
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toMatch(/token|expiresAt|csrf/i);
      expect(JSON.stringify(r.body)).not.toContain('NV-0007'); // không phản chiếu đầu vào
    }
    expect(prismaCalls(prisma)).toBe(0);
  });

  // TODO #2 — /auth/me
  it('TODO /auth/me: mọi dạng Bearer (sid_, JWT, hết hạn, alg=none, rác) -> vẫn NOT_IMPLEMENTED 404, KHÔNG 200 và KHÔNG 401 (không giả vờ có phiên)', async () => {
    const auth = ['Bearer ' + SID_SHAPED, 'Bearer ' + JWT_SHAPED, 'Bearer ' + EXPIRED_JWT_SHAPED, 'Bearer ' + ALG_NONE_JWT, 'Bearer ', 'Basic YWRtaW46YWRtaW4=', 'garbage'];
    for (const a of auth) {
      const r = await http(app).get('/api/v1/auth/me').set('Authorization', a);
      expect([r.status, classify(r.status)]).toEqual([404, 'NOT_IMPLEMENTED']);
      expect(JSON.stringify(r.body)).not.toContain('employeeId');
    }
    const noAuth = await http(app).get('/api/v1/auth/me');
    expect(classify(noAuth.status)).toBe('NOT_IMPLEMENTED');
    expect(prismaCalls(prisma)).toBe(0);
  });

  it('logout/refresh cũng chưa kích hoạt và không ghi cookie; tiền tố sai (thiếu /api/v1) vẫn 404', async () => {
    for (const [m, p] of [['post', '/api/v1/auth/logout'], ['post', '/api/v1/auth/refresh'], ['post', '/auth/login'], ['get', '/auth/me']] as const) {
      const r = await http(app)[m](p).set('Authorization', 'Bearer ' + SID_SHAPED);
      expect([p, classify(r.status)]).toEqual([p, 'NOT_IMPLEMENTED']);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
  });

  it('header giả danh tính không mở khóa auth routes: vẫn NOT_IMPLEMENTED, không bao giờ 2xx', async () => {
    const forged = { 'x-actor-id': 'admin', 'x-employee-id': 'admin', Authorization: 'Bearer ' + JWT_SHAPED };
    for (const [m, p] of [['post', '/api/v1/auth/login'], ['get', '/api/v1/auth/me'], ['post', '/api/v1/auth/logout']] as const) {
      const r = await http(app)[m](p).set(forged);
      expect(classify(r.status)).toBe('NOT_IMPLEMENTED');
    }
  });

  // TODO #3 — token -> /customers
  it('TODO token -> /customers: mọi dạng token (sid_, JWT, hết hạn, alg=none, rác) -> AUTH_DENIED 401 UNAUTHENTICATED, tuyệt đối không NOT_IMPLEMENTED/2xx, không chạm DB', async () => {
    const tokens = ['Bearer ' + SID_SHAPED, 'Bearer ' + JWT_SHAPED, 'Bearer ' + EXPIRED_JWT_SHAPED, 'Bearer ' + ALG_NONE_JWT, 'Bearer ', 'Basic YWRtaW46YWRtaW4=', 'garbage'];
    for (const a of tokens) {
      for (const call of [() => http(app).get('/api/v1/customers'), () => http(app).get('/api/v1/customers/' + ID), () => http(app).post('/api/v1/customers').send({ name: 'A' })]) {
        const r = await call().set('Authorization', a);
        expect([r.status, classify(r.status), r.body.error.code]).toEqual([401, 'AUTH_DENIED', 'UNAUTHENTICATED']);
        expect(r.headers['set-cookie']).toBeUndefined();
        expect(JSON.stringify(r.body)).not.toContain(a.replace('Bearer ', '') || '\u0000'); // không phản chiếu token
      }
    }
    expect(prismaCalls(prisma)).toBe(0);
  });

  it('token đặt sai chỗ (query/cookie/header phụ) -> vẫn 401, không chạm DB', async () => {
    for (const r of [
      await http(app).get('/api/v1/customers?access_token=' + SID_SHAPED),
      await http(app).get('/api/v1/customers').set('Cookie', 'siscom_rt=' + SID_SHAPED),
      await http(app).get('/api/v1/customers').set('X-Access-Token', JWT_SHAPED),
    ]) expect([r.status, r.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);
    expect(prismaCalls(prisma)).toBe(0);
  });

  it('phân biệt rõ hai lớp: auth route chưa có = NOT_IMPLEMENTED, nhưng customers bị từ chối = AUTH_DENIED (client không được nhầm default-deny thành "endpoint chưa có")', async () => {
    const me = await http(app).get('/api/v1/auth/me').set('Authorization', 'Bearer ' + SID_SHAPED);
    const cust = await http(app).get('/api/v1/customers').set('Authorization', 'Bearer ' + SID_SHAPED);
    expect([classify(me.status), classify(cust.status)]).toEqual(['NOT_IMPLEMENTED', 'AUTH_DENIED']);
  });

  it('health @Public vẫn 200 (đường không-auth không bị ảnh hưởng)', async () => {
    expect((await http(app).get('/api/v1/health')).status).toBe(200);
  });
});

describe('I06 — lỗi thật KHÁC NOT_IMPLEMENTED: provider hỏng -> 5xx chung, không bị giấu thành 404/401', () => {
  it('ActorProvider.resolve ném lỗi khi có token -> SERVER_ERROR 500 INTERNAL_ERROR, không lộ nội dung lỗi, không chạm DB', async () => {
    const { app, prisma } = await boot({ resolve: async () => { throw new Error('secret-internal-detail'); }, scopeFor: () => 'ALL' });
    try {
      const r = await http(app).get('/api/v1/customers').set('Authorization', 'Bearer ' + SID_SHAPED);
      expect([r.status, classify(r.status), r.body.error.code]).toEqual([500, 'SERVER_ERROR', 'INTERNAL_ERROR']);
      expect(JSON.stringify(r.body)).not.toContain('secret-internal-detail');
      expect(prismaCalls(prisma)).toBe(0);
    } finally { await app.close(); }
  });

  it('provider trả actor nhưng scope không hợp lệ -> FORBIDDEN 403 (lỗi thật, không phải NOT_IMPLEMENTED), không chạm DB', async () => {
    const { app, prisma } = await boot({ resolve: async () => ({ employeeId: 'e-me', departmentId: 'd1' }), scopeFor: () => null } as unknown as ActorProvider);
    try {
      const r = await http(app).get('/api/v1/customers').set('Authorization', 'Bearer ' + JWT_SHAPED);
      expect([classify(r.status)]).toEqual(['FORBIDDEN']);
      expect(prismaCalls(prisma)).toBe(0);
    } finally { await app.close(); }
  });

  it('auth routes vẫn NOT_IMPLEMENTED ngay cả khi provider bị thay (route không tồn tại độc lập với provider): không bật AuthController qua provider', async () => {
    const { app } = await boot({ resolve: async () => ({ employeeId: 'e-me', departmentId: 'd1' }), scopeFor: () => 'ALL' });
    try {
      for (const [m, p] of [['post', '/api/v1/auth/login'], ['get', '/api/v1/auth/me']] as const) {
        expect(classify((await http(app)[m](p).set('Authorization', 'Bearer ' + SID_SHAPED)).status)).toBe('NOT_IMPLEMENTED');
      }
    } finally { await app.close(); }
  });
});
