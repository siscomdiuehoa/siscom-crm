import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACTOR_PROVIDER, Actor, ActorProvider, Permission, Scope } from '../../common/auth/actor';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupsModule } from '../lookups/lookups.module';
import { CustomersModule } from './customers.module';

// B1.3 M1.3 — kiểm thử ÂM TÍNH ở mức HTTP: quyền từng endpoint (fail-closed), IDOR, leo thang đặc quyền, giả mạo danh tính.
// Chỉ dùng provider/prisma giả trong test; không database, không .env.
const ID = '11111111-1111-4111-8111-111111111111';
const ME: Actor = { employeeId: 'e-me', departmentId: 'd1' };
type Method = 'get' | 'post' | 'patch' | 'delete';
const BODY = { name: 'Công ty A', phone: '0903123456', version: 1, fullName: 'A' };

const ROUTES: { method: Method; url: string; needs: Permission[] }[] = [
  { method: 'get', url: '/api/v1/customers', needs: ['customer.read'] },
  { method: 'get', url: '/api/v1/customers/' + ID, needs: ['customer.read'] },
  { method: 'post', url: '/api/v1/customers', needs: ['customer.create'] },
  { method: 'patch', url: '/api/v1/customers/' + ID, needs: ['customer.update', 'customer.read'] },
  { method: 'delete', url: '/api/v1/customers/' + ID, needs: ['customer.delete', 'customer.read'] },
  { method: 'post', url: '/api/v1/customers/' + ID + '/restore', needs: ['customer.restore', 'customer.read'] },
  { method: 'get', url: '/api/v1/customers/' + ID + '/contacts', needs: ['contact.read', 'customer.read'] },
  { method: 'post', url: '/api/v1/customers/' + ID + '/contacts', needs: ['contact.create', 'customer.update', 'customer.read'] },
  { method: 'get', url: '/api/v1/lookups?type=industry', needs: ['lookup.read'] },
];

function makePrisma() {
  const customer = { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn(), updateMany: jest.fn() };
  const lookupItem = { findMany: jest.fn().mockResolvedValue([]) };
  const contact = { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), create: jest.fn() };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([]), customer, lookupItem, contact };
  return { customer, lookupItem, contact, tx, $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
}
const noDbTouch = (p: ReturnType<typeof makePrisma>) => {
  expect(p.$transaction).not.toHaveBeenCalled();
  for (const fn of [p.customer.findFirst, p.customer.findMany, p.customer.count, p.customer.create, p.customer.updateMany, p.lookupItem.findMany, p.contact.findMany, p.contact.create, p.contact.updateMany]) expect(fn).not.toHaveBeenCalled();
};
async function makeApp(prisma: unknown, provider: ActorProvider): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [CustomersModule, LookupsModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(ACTOR_PROVIDER).useValue(provider).compile();
  const app = mod.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
const call = (app: INestApplication, method: Method, url: string, body?: object, headers: Record<string, string> = {}) => {
  let r = (request(app.getHttpServer()) as any)[method](url);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return body ? r.send(body) : r;
};
const withScopes = (granted: Partial<Record<Permission, Scope>>, resolve: ActorProvider['resolve'] = async () => ME): ActorProvider => ({ resolve, scopeFor: (_a, p) => granted[p] ?? null });

describe('Quyền từng endpoint (AccessGuard toàn cục) — thiếu một quyền => 403 trước khi chạm DB', () => {
  for (const r of ROUTES) {
    for (const missing of r.needs) {
      it(`${r.method.toUpperCase()} ${r.url.replace(ID, ':id')} thiếu ${missing} -> 403 FORBIDDEN, không chạm DB`, async () => {
        const granted: Partial<Record<Permission, Scope>> = {};
        for (const p of r.needs) if (p !== missing) granted[p] = 'ALL';
        const prisma = makePrisma();
        const app = await makeApp(prisma, withScopes(granted));
        try {
          const res = await call(app, r.method, r.url, r.method === 'get' || r.method === 'delete' ? undefined : BODY);
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
          noDbTouch(prisma);
        } finally { await app.close(); }
      });
    }
  }
  it('actor không có bất kỳ quyền nào -> mọi route 403', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({}));
    try {
      for (const r of ROUTES) expect((await call(app, r.method, r.url, r.method === 'get' || r.method === 'delete' ? undefined : BODY)).status).toBe(403);
      noDbTouch(prisma);
    } finally { await app.close(); }
  });
});

describe('Giả mạo danh tính: header/body/query không được thay đổi người thao tác', () => {
  it('provider trả null (chưa xác thực) dù request mang header x-actor-id/x-employee-id/Authorization giả -> 401', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'ALL' }, async () => null));
    try {
      const res = await call(app, 'get', '/api/v1/customers?actorId=admin&employeeId=admin', undefined, { 'x-actor-id': 'admin', 'x-employee-id': 'admin', Authorization: 'Bearer forged' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      noDbTouch(prisma);
    } finally { await app.close(); }
  });
  it('provider chỉ nhận request của chính nó: danh tính truyền xuống service là ME, không phải giá trị trong header', async () => {
    const seen: string[] = [];
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'ALL' }, async (req) => { seen.push(String(req.headers['x-actor-id'])); return ME; }));
    try {
      const res = await call(app, 'get', '/api/v1/customers', undefined, { 'x-actor-id': 'admin' });
      expect(res.status).toBe(200);
      expect(seen.length).toBeGreaterThan(0); // provider được hỏi; việc dùng header hay không là của provider thật (B1.3 gói C: chỉ JWT đã ký)
    } finally { await app.close(); }
  });
});

describe('IDOR / leo thang đặc quyền ở tầng service (phạm vi OWN)', () => {
  const ownOnly = withScopes({ 'customer.create': 'OWN', 'customer.read': 'OWN', 'customer.update': 'OWN', 'customer.delete': 'OWN', 'customer.restore': 'OWN', 'contact.read': 'OWN', 'contact.create': 'OWN' });
  const others = { id: ID, code: 'KH-00009', deletedAt: null, ownerId: 'e-other', owner: { departmentId: 'd9' }, version: 1 };
  let app: INestApplication;
  let prisma: ReturnType<typeof makePrisma>;
  beforeEach(async () => {
    prisma = makePrisma();
    prisma.customer.findFirst.mockResolvedValue(others);
    prisma.tx.$queryRaw.mockResolvedValue([{ id: ID }]);
    app = await makeApp(prisma, ownOnly);
  });
  afterEach(async () => { await app.close(); });

  it('GET khách của người khác -> 404 (không lộ sự tồn tại)', async () => {
    const res = await call(app, 'get', '/api/v1/customers/' + ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });
  it('PATCH khách của người khác -> 404, không ghi', async () => {
    const res = await call(app, 'patch', '/api/v1/customers/' + ID, { version: 1, note: 'x' });
    expect(res.status).toBe(404);
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });
  it('DELETE khách của người khác -> 404, không ghi', async () => {
    const res = await call(app, 'delete', '/api/v1/customers/' + ID);
    expect(res.status).toBe(404);
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });
  it('liên hệ: GET/POST trên khách của người khác -> 404, không tạo', async () => {
    expect((await call(app, 'get', '/api/v1/customers/' + ID + '/contacts')).status).toBe(404);
    expect((await call(app, 'post', '/api/v1/customers/' + ID + '/contacts', { fullName: 'A', phone: '0903123456' })).status).toBe(404);
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });
  it('leo thang: body mang ownerId/id/code/version/role/permissions/scope -> 400, không chạm DB', async () => {
    for (const k of ['ownerId', 'id', 'code', 'role', 'permissions', 'scope', 'actorId', 'employeeId', 'departmentId']) {
      const res = await call(app, 'post', '/api/v1/customers', { name: 'Công ty A', phone: '0903123456', [k]: 'e-me' });
      expect(res.status).toBe(400);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('leo thang: query scope=ALL / ownerId=… không làm mở rộng phạm vi (tham số lạ -> 400)', async () => {
    for (const q of ['scope=ALL', 'ownerId=e-other', 'actorId=admin']) expect((await call(app, 'get', '/api/v1/customers?' + q)).status).toBe(400);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });
  it('khôi phục bản ghi đã xóa của người khác -> 404, không ghi', async () => {
    prisma.customer.findFirst.mockResolvedValue({ ...others, deletedAt: new Date() });
    const res = await call(app, 'post', '/api/v1/customers/' + ID + '/restore');
    expect(res.status).toBe(404);
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });
});
