import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, uniq } from './helpers/fixtures';

// B1.3.2-B — kiểm thử TÍCH HỢP cách ly quyền/danh tính (AccessGuard toàn cục + service + DB thật) trên DATABASE THỬ.
// CHỈ chạy qua scripts\windows\run-auth-int-tests.bat (đã kiểm tên DB + xác nhận). Không chạy trong `npm run test:unit`.
// Ghi vào DB thử (khách/nhân viên/danh mục mang tiền tố TEST/“KH thử”, is_demo = true); DB thử bỏ đi sau khi xong.
// Provider/actor chỉ tồn tại trong test (test-app.ts); không có provider giả trong src.
const URL = '/api/v1/customers';
const NIL = '00000000-0000-4000-8000-000000000000';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let td: TestApp;
const a = (who?: string, app: INestApplication = t.app) => as(app, who);
const countCustomers = (): Promise<number> => prisma.customer.count();

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  td = await makeApp(prisma, fx, { denyAll: true });
});
afterAll(async () => { await t.app.close(); await td.app.close(); await prisma.$disconnect(); });

describe('mặc định từ chối (DenyAll) — không đọc/ghi DB', () => {
  it('mọi route khách/lookups => 401 dù mang header danh tính giả', async () => {
    const before = await countCustomers();
    const forged = { 'x-actor-id': fx.empA, 'x-employee-id': fx.empA, Authorization: 'Bearer forged', 'x-test-actor': 'all' };
    const { default: request } = await import('supertest');
    const send = (m: 'get' | 'post' | 'patch' | 'delete', u: string, body?: object) => {
      let r = (request(td.app.getHttpServer()) as any)[m](u);
      for (const [k, v] of Object.entries(forged)) r = r.set(k, v);
      return body ? r.send(body) : r;
    };
    expect((await send('get', URL)).status).toBe(401);
    expect((await send('get', URL + '/' + NIL)).status).toBe(401);
    expect((await send('post', URL, { name: 'KH thử ' + uniq(), phone: '0903123456' })).status).toBe(401);
    expect((await send('patch', URL + '/' + NIL, { version: 1 })).status).toBe(401);
    expect((await send('delete', URL + '/' + NIL)).status).toBe(401);
    expect((await send('get', '/api/v1/lookups?type=industry')).status).toBe(401);
    expect(await countCustomers()).toBe(before);
    expect(td.audit.entries).toHaveLength(0);
  });
});

describe('thiếu quyền => 403, DB và nhật ký không đổi', () => {
  it('actor không có quyền nào: mọi route 403, không tạo khách, không ghi audit', async () => {
    const before = await countCustomers(); const audits = t.audit.entries.length;
    expect((await a('none').get(URL)).status).toBe(403);
    expect((await a('none').post(URL, { name: 'KH thử ' + uniq(), phone: '0903123456' })).status).toBe(403);
    expect((await a('none').patch(URL + '/' + NIL, { version: 1 })).status).toBe(403);
    expect((await a('none').delete(URL + '/' + NIL)).status).toBe(403);
    expect((await a('none').get('/api/v1/lookups?type=industry')).status).toBe(403);
    expect(await countCustomers()).toBe(before);
    expect(t.audit.entries.length).toBe(audits);
  });
  it('actor chỉ đọc: đọc được, tạo/sửa/xóa/khôi phục => 403; bản ghi không đổi', async () => {
    const c = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    expect((await a('readonly').get(URL + '/' + c.id)).status).toBe(200);
    expect((await a('readonly').post(URL, { name: 'KH thử ' + uniq(), phone: '0903123456' })).status).toBe(403);
    expect((await a('readonly').patch(URL + '/' + c.id, { version: c.version, note: 'x' })).status).toBe(403);
    expect((await a('readonly').delete(URL + '/' + c.id)).status).toBe(403);
    expect((await a('readonly').post(URL + '/' + c.id + '/restore')).status).toBe(403);
    const row = await prisma.customer.findUnique({ where: { id: c.id } });
    expect(row?.version).toBe(c.version);
    expect(row?.deletedAt).toBeNull();
  });
});

describe('IDOR / cách ly theo phạm vi trên DB thật', () => {
  it('OWN: khách của người khác => 404 cho GET/PATCH/DELETE, bản ghi không đổi', async () => {
    const other = await makeCustomer(prisma, fx, { ownerId: fx.empB });
    expect((await a('ownA').get(URL + '/' + other.id)).status).toBe(404);
    expect((await a('ownA').patch(URL + '/' + other.id, { version: other.version, note: 'chiếm quyền' })).status).toBe(404);
    expect((await a('ownA').delete(URL + '/' + other.id)).status).toBe(404);
    expect((await a('ownA').post(URL + '/' + other.id + '/contacts', { fullName: 'A', phone: '0903123456' })).status).toBe(404);
    const row = await prisma.customer.findUnique({ where: { id: other.id } });
    expect(row?.version).toBe(other.version);
    expect(row?.deletedAt).toBeNull();
    expect(await prisma.contact.count({ where: { customerId: other.id } })).toBe(0);
  });
  it('OWN: danh sách chỉ chứa khách của chính mình', async () => {
    const mine = await makeCustomer(prisma, fx, { ownerId: fx.empA, name: 'KH thử cách ly ' + uniq() });
    const theirs = await makeCustomer(prisma, fx, { ownerId: fx.empB, name: 'KH thử cách ly ' + uniq() });
    const res = await a('ownA').get(URL + '?pageSize=100&q=' + encodeURIComponent('KH thử cách ly'));
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });
  it('DEPARTMENT: khách thuộc phòng khác => 404', async () => {
    const c = await makeCustomer(prisma, fx, { ownerId: fx.empC });
    expect((await a('deptA').get(URL + '/' + c.id)).status).toBe(404);
    expect((await a('deptC').get(URL + '/' + c.id)).status).toBe(200);
  });
  it('khôi phục khách đã xóa của người khác => 404, vẫn ở trạng thái đã xóa', async () => {
    const c = await makeCustomer(prisma, fx, { ownerId: fx.empB, deleted: true });
    expect((await a('ownA').post(URL + '/' + c.id + '/restore')).status).toBe(404);
    const row = await prisma.customer.findUnique({ where: { id: c.id } });
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe('leo thang đặc quyền qua body/query bị chặn trước khi ghi', () => {
  it('body mang ownerId/role/permissions/scope/actorId/employeeId/departmentId => 400, không tạo khách', async () => {
    const before = await countCustomers();
    for (const k of ['ownerId', 'role', 'permissions', 'scope', 'actorId', 'employeeId', 'departmentId', 'createdById']) {
      expect((await a('ownA').post(URL, { name: 'KH thử ' + uniq(), phone: '0903123456', [k]: fx.empB })).status).toBe(400);
    }
    expect(await countCustomers()).toBe(before);
  });
  it('query scope=ALL / ownerId / actorId không mở rộng phạm vi => 400', async () => {
    for (const q of ['scope=ALL', 'ownerId=' + fx.empB, 'actorId=' + fx.empB]) expect((await a('ownA').get(URL + '?' + q)).status).toBe(400);
  });
  it('header danh tính giả không thay được actor: không có x-test-actor => 401 dù có x-actor-id', async () => {
    const { default: request } = await import('supertest');
    const res = await request(t.app.getHttpServer()).get(URL).set('x-actor-id', fx.empA).set('x-employee-id', fx.empA);
    expect(res.status).toBe(401);
  });
});
