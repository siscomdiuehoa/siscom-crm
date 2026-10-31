import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeEmployee } from './helpers/fixtures';

// PR 7 (D15): GET /customers/owner-candidates — theo phạm vi customer.create/update, không cần employee.read.
const U = '/api/v1/customers/owner-candidates';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

const ids = (r: { body: { data: { items: { id: string }[] } } }) => r.body.data.items.map((x) => x.id);

describe('Ứng viên chủ sở hữu', () => {
  it('ALL: thấy mọi nhân viên ACTIVE chưa xoá (A, B, C), không thấy nhân viên nghỉ việc; chỉ trả id/code/fullName/departmentCode', async () => {
    const resigned = await makeEmployee({ fullName: 'TEST NV nghỉ OC', departmentId: fx.d1, status: 'RESIGNED', deletedAt: new Date() });
    const r = await as(t.app, 'all').get(U);
    expect(r.status).toBe(200);
    expect(r.body.data.scope).toBe('ALL');
    expect(ids(r)).toEqual(expect.arrayContaining([fx.empA, fx.empB, fx.empC]));
    expect(ids(r)).not.toContain(resigned.id);
    for (const it of r.body.data.items as Record<string, unknown>[]) expect(Object.keys(it).sort()).toEqual(['code', 'departmentCode', 'fullName', 'id']);
    expect(JSON.stringify(r.body)).not.toMatch(/email|phone|hireDate/);
    const a = (r.body.data.items as { id: string; departmentCode: string | null }[]).find((x) => x.id === fx.empA);
    expect(a?.departmentCode).toBe('T_D1');
  });
  it('DEPARTMENT: chỉ cùng phòng (A, B; không C); OWN: chỉ chính mình', async () => {
    const d = await as(t.app, 'deptA').get(U);
    expect(d.status).toBe(200); expect(d.body.data.scope).toBe('DEPARTMENT');
    expect(ids(d)).toEqual(expect.arrayContaining([fx.empA, fx.empB])); expect(ids(d)).not.toContain(fx.empC);
    const o = await as(t.app, 'ownB').get(U);
    expect(o.status).toBe(200); expect(o.body.data.scope).toBe('OWN'); expect(ids(o)).toEqual([fx.empB]);
    const c = await as(t.app, 'createReadOwn').get(U); // create=ALL, update=ALL => ALL dù read=OWN
    expect(c.status).toBe(200); expect(c.body.data.scope).toBe('ALL');
  });
  it('không có customer.create lẫn customer.update -> 403; thiếu danh tính -> 401; ghi: POST 404 (không có route), PATCH/DELETE 400 (":id" không phải uuid), không đổi dữ liệu', async () => {
    expect((await as(t.app, 'readonly').get(U)).status).toBe(403);
    expect((await as(t.app, 'none').get(U)).status).toBe(403);
    expect((await as(t.app).get(U)).status).toBe(401);
    const before = await prisma.customer.count();
    expect((await as(t.app, 'all').post(U)).status).toBe(404);
    expect((await as(t.app, 'all').patch(U, { version: 1 })).status).toBe(400); // khớp PATCH ':id' => ParseUUIDPipe từ chối
    expect((await as(t.app, 'all').delete(U)).status).toBe(400);
    expect(await prisma.customer.count()).toBe(before);
  });
});
