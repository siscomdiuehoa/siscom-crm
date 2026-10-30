import { Client } from 'pg';
import { PrismaService } from '../src/prisma/prisma.service';
import { ensureFixtures, Fixtures, makeCustomer } from './helpers/fixtures';
import { assertTestConnection, createTestPrisma, setDatabaseDefaultTimeZone, testDatabase } from './helpers/test-db';

// D.0 — LƯU VÀ XỬ LÝ MỐC THỜI GIAN THEO UTC, bất kể múi giờ mặc định của máy chủ PostgreSQL.
// Mô phỏng máy chủ tại VN: DB thử đặt timezone mặc định Asia/Ho_Chi_Minh (+07) trước khi mở kết nối của ứng dụng.
// So sánh bằng epoch (thời điểm tuyệt đối, không phụ thuộc múi giờ phiên) giữa giá trị trong DB, now() của DB và đồng hồ Node.
const VN = 'Asia/Ho_Chi_Minh';
const TOL = 60_000; // CI: DB container và tiến trình test cùng đồng hồ máy chạy
let prisma: PrismaService; let name = ''; let fx: Fixtures;

beforeAll(async () => {
  const setup = createTestPrisma(); name = setup.name;
  await assertTestConnection(setup.prisma, name);
  await setup.prisma.$disconnect();
  await setDatabaseDefaultTimeZone(name, VN); // B1.4 P3: ALTER DATABASE qua kết nối chủ sở hữu (siscom_migrator sau S1)
  prisma = createTestPrisma().prisma; // pool mới => phiên mới nhận mặc định +07 của DB (trừ khi ứng dụng tự đặt UTC)
  await assertTestConnection(prisma, name);
  fx = await ensureFixtures(prisma);
}, 60000);
afterAll(async () => {
  // Trả múi giờ mặc định của DB thử về như cũ kể cả khi beforeAll lỗi giữa chừng; luôn đóng kết nối.
  try { if (name) await setDatabaseDefaultTimeZone(name, null); } finally { await prisma?.$disconnect(); }
});

describe('D.0 — phiên DB và mốc thời gian (DB mặc định +07)', () => {
  it('mô phỏng có hiệu lực: kết nối pg thô (không qua ứng dụng) nhận múi giờ mặc định Asia/Ho_Chi_Minh', async () => {
    const c = new Client({ connectionString: testDatabase().url });
    await c.connect();
    try { expect((await c.query<{ TimeZone: string }>('SHOW TimeZone')).rows[0].TimeZone).toBe(VN); } finally { await c.end(); }
  });

  it('phiên của ứng dụng (PrismaService) luôn chạy UTC, định dạng ngày ISO', async () => {
    const r = await prisma.$queryRaw<{ tz: string; ds: string }[]>`SELECT current_setting('TimeZone') AS tz, current_setting('DateStyle') AS ds`;
    expect(r[0].tz).toBe('UTC');
    expect(r[0].ds).toMatch(/^ISO/);
  });

  it('Date do ứng dụng ghi (giá trị truyền vào và @default(now()) Prisma sinh phía ứng dụng) lưu đúng thời điểm thật trong DB', async () => {
    const t = Date.now();
    const c = await makeCustomer(prisma, fx, { deleted: true }); // deletedAt: new Date(); createdAt/updatedAt: Prisma tự sinh
    const r = await prisma.$queryRaw<{ created: number; updated: number; deleted: number }[]>`
      SELECT extract(epoch FROM created_at)::float8 * 1000 AS created, extract(epoch FROM updated_at)::float8 * 1000 AS updated,
             extract(epoch FROM deleted_at)::float8 * 1000 AS deleted FROM customer WHERE id = ${c.id}::uuid`;
    expect(Math.abs(r[0].created - t)).toBeLessThan(TOL);
    expect(Math.abs(r[0].updated - t)).toBeLessThan(TOL);
    expect(Math.abs(r[0].deleted - t)).toBeLessThan(TOL);
  });

  it('thời điểm do DB sinh (now()) đọc qua Prisma đúng thời điểm thật', async () => {
    const r = await prisma.$queryRaw<{ t: Date }[]>`SELECT now() AS t`;
    expect(r[0].t).toBeInstanceOf(Date);
    expect(Math.abs(r[0].t.getTime() - Date.now())).toBeLessThan(TOL);
  });

  it('ghi rồi đọc lại qua Prisma giữ nguyên thời điểm (không cộng/trừ giờ)', async () => {
    const at = new Date(Date.UTC(2026, 9, 29, 17, 30, 0)); // 2026-10-30 00:30 giờ VN: ngày VN khác ngày UTC
    const c = await makeCustomer(prisma, fx, { deleted: true });
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: at } });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, select: { deletedAt: true } });
    expect(row.deletedAt!.toISOString()).toBe('2026-10-29T17:30:00.000Z');
    const db = await prisma.$queryRaw<{ utc: string; vn: string }[]>`
      SELECT to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS utc, to_char(deleted_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI') AS vn
      FROM customer WHERE id = ${c.id}::uuid`;
    expect(db[0]).toEqual({ utc: '2026-10-29 17:30', vn: '2026-10-30 00:30' });
  });
});
