import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures } from './helpers/fixtures';

const U = '/api/v1/lookups';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

describe('Lookup API chỉ đọc', () => {
  it('chỉ mục đang hoạt động, đúng thứ tự sortOrder, không lộ id/isSystem; loại rỗng vẫn có mảng', async () => {
    const r = await as(t.app, 'all').get(U + '?type=customer_tier,customer_status,province');
    expect(r.status).toBe(200);
    const tiers = r.body.data.customer_tier as { code: string }[];
    const codes = tiers.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['STRATEGIC', 'POTENTIAL', 'VIP']));
    expect(codes).not.toContain('LEGACY'); // đã ngừng dùng
    expect(codes.indexOf('STRATEGIC')).toBeLessThan(codes.indexOf('POTENTIAL'));
    expect(codes.indexOf('POTENTIAL')).toBeLessThan(codes.indexOf('VIP'));
    for (const g of Object.values(r.body.data) as Record<string, unknown>[][]) for (const it of g) { expect(Object.keys(it).sort()).toEqual(['code', 'isActive', 'label', 'sortOrder']); expect(it.isActive).toBe(true); }
    expect(JSON.stringify(r.body)).not.toMatch(/"id"|isSystem/);
  });
  it('type thiếu/lạ/includeInactive -> 400', async () => {
    const g = as(t.app, 'all');
    expect((await g.get(U)).status).toBe(400);
    expect((await g.get(U + '?type=employee')).status).toBe(400);
    expect((await g.get(U + '?type=industry,role')).status).toBe(400);
    expect((await g.get(U + '?type=industry&includeInactive=true')).status).toBe(400);
  });
  it('quyền: không quyền -> 403; thiếu danh tính -> 401; ghi (POST/PATCH/DELETE) không tồn tại -> 404', async () => {
    expect((await as(t.app, 'none').get(U + '?type=industry')).status).toBe(403);
    expect((await as(t.app).get(U + '?type=industry')).status).toBe(401);
    for (const m of ['post', 'patch', 'delete'] as const) expect((await as(t.app, 'all')[m](U)).status).toBe(404);
  });
});
