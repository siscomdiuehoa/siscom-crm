import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACTOR_PROVIDER, Actor, ActorProvider } from '../../common/auth/actor';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupsModule } from '../lookups/lookups.module';
import { CustomersModule } from './customers.module';

const ID = '11111111-1111-4111-8111-111111111111';
const actor: Actor = { employeeId: 'e1', departmentId: 'd1' };
const allProvider: ActorProvider = { resolve: async () => actor, scopeFor: () => 'ALL' };

function makePrisma() {
  const customer = { findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), updateMany: jest.fn() };
  const lookupItem = { findMany: jest.fn().mockResolvedValue([]) };
  const contact = { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), create: jest.fn() };
  const employee = { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([]), customer, lookupItem, contact, employee };
  return { customer, lookupItem, contact, employee, tx, $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
}
async function makeApp(prisma: unknown, provider?: ActorProvider): Promise<INestApplication> {
  let b = Test.createTestingModule({ imports: [CustomersModule, LookupsModule] }).overrideProvider(PrismaService).useValue(prisma);
  if (provider) b = b.overrideProvider(ACTOR_PROVIDER).useValue(provider);
  const mod = await b.compile();
  const app = mod.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
const call = (app: INestApplication, method: 'get' | 'post' | 'patch' | 'delete', url: string, body?: object) => {
  const r = (request(app.getHttpServer()) as any)[method](url);
  return body ? r.send(body) : r;
};

describe('Customer API — cấu hình thật (DenyAll): mặc định 401', () => {
  const routes: ['get' | 'post' | 'patch' | 'delete', string][] = [
    ['get', '/api/v1/customers'], ['get', '/api/v1/customers/' + ID], ['post', '/api/v1/customers'],
    ['patch', '/api/v1/customers/' + ID], ['delete', '/api/v1/customers/' + ID], ['post', '/api/v1/customers/' + ID + '/restore'],
    ['get', '/api/v1/customers/' + ID + '/contacts'], ['post', '/api/v1/customers/' + ID + '/contacts'], ['get', '/api/v1/lookups?type=industry'],
    ['get', '/api/v1/customers/owner-candidates'],
  ];
  it.each(routes)('%s %s -> 401 UNAUTHENTICATED và không chạm database', async (method, url) => {
    const prisma = makePrisma();
    const app = await makeApp(prisma);
    try {
      const res = await call(app, method, url, method === 'get' || method === 'delete' ? undefined : { name: 'Công ty A', phone: '0903123456', version: 1 });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.customer.create).not.toHaveBeenCalled();
      expect(prisma.customer.updateMany).not.toHaveBeenCalled();
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(prisma.customer.count).not.toHaveBeenCalled();
      expect(prisma.contact.findMany).not.toHaveBeenCalled();
      expect(prisma.contact.create).not.toHaveBeenCalled();
      expect(prisma.lookupItem.findMany).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

describe('Customer API — có danh tính giả (CHỈ trong test)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof makePrisma>;
  beforeEach(async () => { prisma = makePrisma(); app = await makeApp(prisma, allProvider); });
  afterEach(async () => { await app.close(); });

  it('POST thiếu trường -> 400 VALIDATION_FAILED với thông điệp tiếng Việt', async () => {
    const res = await call(app, 'post', '/api/v1/customers', {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.details).toEqual(expect.arrayContaining(['Vui lòng nhập tên công ty', 'Vui lòng nhập số điện thoại']));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['id', 'code', 'version', 'isDemo', 'revenueVnd'])('POST kèm trường lạ "%s" -> 400', async (k) => {
    const res = await call(app, 'post', '/api/v1/customers', { name: 'Công ty A', phone: '0903123456', [k]: 'x' });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('POST hợp lệ nhưng AuditLog chưa có (B-1): thao tác ghi bị chặn, trả 500 chung, không lộ nội dung', async () => {
    prisma.lookupItem.findMany.mockResolvedValue([{ id: 't1', type: 'customer_tier', code: 'POTENTIAL', isActive: true }, { id: 's1', type: 'customer_status', code: 'POTENTIAL', isActive: true }]);
    prisma.customer.create.mockResolvedValue({ id: ID, code: 'KH-00001' });
    const res = await call(app, 'post', '/api/v1/customers', { name: 'Công ty A', phone: '0903123456' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/AuditLog|stack|prisma/i);
  });
  it('PATCH không có version / có trường cấm -> 400', async () => {
    expect((await call(app, 'patch', '/api/v1/customers/' + ID, { note: 'x' })).status).toBe(400);
    expect((await call(app, 'patch', '/api/v1/customers/' + ID, { version: 1, code: 'KH-9' })).status).toBe(400);
  });
  it('tham số sai: uuid hỏng, search (B-2), sortBy ngoài bảng trắng, pageSize > 100 -> 400', async () => {
    expect((await call(app, 'get', '/api/v1/customers/khong-phai-uuid')).status).toBe(400);
    expect((await call(app, 'get', '/api/v1/customers?search=a')).status).toBe(400);
    expect((await call(app, 'get', '/api/v1/customers?sortBy=relevance')).status).toBe(400); // relevance cần search
    expect((await call(app, 'get', '/api/v1/customers?sortBy=password')).status).toBe(400);
    expect((await call(app, 'get', '/api/v1/customers?pageSize=101')).status).toBe(400);
  });
  it('GET danh sách rỗng -> data.items = [] và phân trang đúng', async () => {
    const res = await call(app, 'get', '/api/v1/customers');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });
  it('GET không tồn tại -> 404 CUSTOMER_NOT_FOUND', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    const res = await call(app, 'get', '/api/v1/customers/' + ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });
  it('search hợp lệ -> 200 (truy vấn tham số hoá, tổng chính xác)', async () => {
    prisma.tx.$queryRaw.mockResolvedValueOnce([{ t: 'abc' }]).mockResolvedValueOnce([{ n: 0 }]);
    const res = await call(app, 'get', '/api/v1/customers?search=abc&sortBy=relevance');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });
  it('liên hệ: POST thiếu họ tên / không có SĐT-email / trường lạ -> 400', async () => {
    const url = '/api/v1/customers/' + ID + '/contacts';
    expect((await call(app, 'post', url, {})).status).toBe(400);
    expect((await call(app, 'post', url, { fullName: 'A' })).status).toBe(400);
    expect((await call(app, 'post', url, { fullName: 'A', phone: '0903123456', customerId: ID })).status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('liên hệ: GET khách không tồn tại -> 404; uuid hỏng -> 400', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    expect((await call(app, 'get', '/api/v1/customers/' + ID + '/contacts')).status).toBe(404);
    expect((await call(app, 'get', '/api/v1/customers/khong-phai-uuid/contacts')).status).toBe(400);
  });
  it('liên hệ: POST hợp lệ nhưng AuditLog chưa có -> 500 chung, không lộ nội dung', async () => {
    prisma.tx.$queryRaw.mockResolvedValue([{ id: ID }]);
    prisma.customer.findFirst.mockResolvedValue({ id: ID, code: 'KH-00001', deletedAt: null, ownerId: null, owner: null });
    prisma.contact.create.mockResolvedValue({ id: 'c1', code: 'LH-000001', fullName: 'A', title: null, phone: '0903123456', email: null, isPrimary: false, note: null, createdAt: new Date() });
    const res = await call(app, 'post', '/api/v1/customers/' + ID + '/contacts', { fullName: 'A', phone: '0903123456' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/AuditLog|stack|prisma/i);
  });
  it('lookups: thiếu type / loại lạ / includeInactive -> 400; hợp lệ -> 200 nhóm theo loại', async () => {
    expect((await call(app, 'get', '/api/v1/lookups')).status).toBe(400);
    expect((await call(app, 'get', '/api/v1/lookups?type=employee')).status).toBe(400);
    expect((await call(app, 'get', '/api/v1/lookups?type=industry&includeInactive=true')).status).toBe(400);
    const res = await call(app, 'get', '/api/v1/lookups?type=industry,source');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ industry: [], source: [] });
  });
  it('DELETE luôn bị khoá: 409 DELETE_LINKS_UNVERIFIED, không ghi', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: ID, ownerId: null, owner: null });
    const res = await call(app, 'delete', '/api/v1/customers/' + ID);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DELETE_LINKS_UNVERIFIED');
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
