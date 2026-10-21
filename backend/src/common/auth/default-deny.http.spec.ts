import 'reflect-metadata';
import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { HealthController } from '../../health/health.controller';
import { HealthService } from '../../health/health.service';
import { LookupsModule } from '../../modules/lookups/lookups.module';
import { CustomersModule } from '../../modules/customers/customers.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from './auth.module';
import { ACTOR_PROVIDER, Actor, ActorProvider } from './actor';

// B1.3 M1.3 — cấu hình MẶC ĐỊNH (DenyAllActorProvider thật, AccessGuard thật) và xử lý lỗi. Không database, không .env.
const ID = '11111111-1111-4111-8111-111111111111';
const ME: Actor = { employeeId: 'e-me', departmentId: 'd1' };

// Controller chỉ có trong test: quên khai báo quyền.
@Controller('undeclared')
class UndeclaredController {
  @Get() hit() { return { leaked: true }; }
}
function makePrisma() {
  const fn = () => jest.fn().mockResolvedValue(null);
  return { $transaction: jest.fn(), customer: { findFirst: fn(), findMany: fn(), count: fn() }, lookupItem: { findMany: fn() }, contact: { findMany: fn() } };
}
async function boot(imports: unknown[], controllers: unknown[], providers: unknown[], configure?: (b: ReturnType<typeof Test.createTestingModule>) => ReturnType<typeof Test.createTestingModule>) {
  let b = Test.createTestingModule({ imports: imports as never[], controllers: controllers as never[], providers: providers as never[] });
  if (configure) b = configure(b);
  const app = (await b.compile()).createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
const http = (app: INestApplication) => request(app.getHttpServer());

describe('mặc định production: DenyAllActorProvider + AccessGuard thật', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof makePrisma>;
  beforeEach(async () => {
    prisma = makePrisma();
    app = await boot([CustomersModule, LookupsModule, AuthModule], [UndeclaredController, HealthController], [{ provide: HealthService, useValue: { liveness: () => ({ status: 'ok' }) } }], (b) => b.overrideProvider(PrismaService).useValue(prisma));
  });
  afterEach(async () => { await app.close(); });

  it('mọi route nghiệp vụ -> 401 UNAUTHENTICATED dù có header/Authorization giả; không chạm DB', async () => {
    const forged = { 'x-actor-id': 'admin', 'x-employee-id': 'admin', Authorization: 'Bearer forged' };
    const calls = [
      () => http(app).get('/api/v1/customers'), () => http(app).get('/api/v1/customers/' + ID), () => http(app).post('/api/v1/customers').send({ name: 'A' }),
      () => http(app).patch('/api/v1/customers/' + ID).send({ version: 1 }), () => http(app).delete('/api/v1/customers/' + ID), () => http(app).post('/api/v1/customers/' + ID + '/restore'),
      () => http(app).get('/api/v1/customers/' + ID + '/contacts'), () => http(app).post('/api/v1/customers/' + ID + '/contacts').send({ fullName: 'A' }), () => http(app).get('/api/v1/lookups?type=industry'),
    ];
    for (const c of calls) {
      const res = await c().set(forged);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    for (const fn of [prisma.customer.findFirst, prisma.customer.findMany, prisma.customer.count, prisma.lookupItem.findMany, prisma.contact.findMany]) expect(fn).not.toHaveBeenCalled();
  });
  it('route quên khai báo quyền -> 403 và handler KHÔNG chạy (không lộ dữ liệu)', async () => {
    const res = await http(app).get('/api/v1/undeclared');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toContain('leaked');
  });
  it('health @Public() vẫn truy cập được khi chưa đăng nhập', async () => {
    expect((await http(app).get('/api/v1/health')).status).toBe(200);
  });
  it('guard chạy TRƯỚC pipe: id sai định dạng khi chưa đăng nhập -> 401 (không lộ 400 validation)', async () => {
    expect((await http(app).get('/api/v1/customers/not-a-uuid')).status).toBe(401);
    expect((await http(app).get('/api/v1/customers?unknown=1')).status).toBe(401);
  });
  it('đường dẫn không tồn tại -> 404 chung, không lộ cấu trúc', async () => {
    const res = await http(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('xử lý lỗi của provider/scope (fail-closed, không lộ chi tiết)', () => {
  async function appWith(provider: ActorProvider) {
    return boot([CustomersModule, LookupsModule], [], [], (b) => b.overrideProvider(PrismaService).useValue(makePrisma()).overrideProvider(ACTOR_PROVIDER).useValue(provider));
  }
  it('provider.resolve ném lỗi -> 500 chung, không chứa nội dung lỗi nội bộ', async () => {
    const app = await appWith({ resolve: async () => { throw new Error('secret-internal-detail'); }, scopeFor: () => 'ALL' });
    try {
      const res = await http(app).get('/api/v1/customers');
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('secret-internal-detail');
    } finally { await app.close(); }
  });
  it('provider.scopeFor ném lỗi -> 500 (không mặc định cho qua)', async () => {
    const app = await appWith({ resolve: async () => ME, scopeFor: () => { throw new Error('boom'); } });
    try { expect((await http(app).get('/api/v1/customers')).status).toBe(500); } finally { await app.close(); }
  });
  it('scope lạ ("ADMIN"/true/chuỗi rỗng) hoặc actor thiếu employeeId -> bị từ chối, không chạm DB', async () => {
    for (const scope of ['ADMIN', true, '', 1]) {
      const prisma = makePrisma();
      const app = await boot([CustomersModule, LookupsModule], [], [], (b) => b.overrideProvider(PrismaService).useValue(prisma).overrideProvider(ACTOR_PROVIDER).useValue({ resolve: async () => ME, scopeFor: () => scope } as unknown as ActorProvider));
      try {
        expect((await http(app).get('/api/v1/customers')).status).toBe(403);
        expect(prisma.customer.findMany).not.toHaveBeenCalled();
      } finally { await app.close(); }
    }
    for (const bad of [{ employeeId: '', departmentId: null }, { departmentId: 'd1' }, { employeeId: 42 }]) {
      const prisma = makePrisma();
      const app = await boot([CustomersModule, LookupsModule], [], [], (b) => b.overrideProvider(PrismaService).useValue(prisma).overrideProvider(ACTOR_PROVIDER).useValue({ resolve: async () => bad, scopeFor: () => 'ALL' } as unknown as ActorProvider));
      try {
        expect((await http(app).get('/api/v1/customers')).status).toBe(401);
        expect(prisma.customer.findMany).not.toHaveBeenCalled();
      } finally { await app.close(); }
    }
  });
});
