import { PrismaService } from '../../src/prisma/prisma.service';

export const TEST_DB_RE = /^siscom_crm_(restore|test)_\d{8}_\d{6}$/;

// Chỉ chấp nhận database thử. Xoá DATABASE_URL khỏi tiến trình test để URL của siscom_crm_dev không bao giờ lọt vào.
export function testDatabase(): { url: string; name: string } {
  delete process.env.DATABASE_URL;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Thiếu TEST_DATABASE_URL. Chạy qua scripts\\windows\\run-customers-tests.bat (đã kiểm tra tên database).');
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('TEST_DATABASE_URL không hợp lệ.'); }
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (name === 'siscom_crm_dev' || !TEST_DB_RE.test(name)) throw new Error('Từ chối: "' + name + '" không phải database thử (siscom_crm_restore_* / siscom_crm_test_*).');
  if (u.hostname !== '127.0.0.1') throw new Error('Từ chối: host phải là 127.0.0.1.');
  if (decodeURIComponent(u.username) !== 'siscom_app') throw new Error('Từ chối: tài khoản phải là siscom_app.');
  return { url, name };
}

export function createTestPrisma(): { prisma: PrismaService; name: string } {
  const { url, name } = testDatabase();
  // PrismaService chỉ cần ConfigService.getOrThrow('DATABASE_URL'); cấp trực tiếp URL thử, không đọc .env.
  const prisma = new PrismaService({ getOrThrow: () => url } as never);
  return { prisma, name };
}

// Chạy TRƯỚC mọi thao tác ghi: xác nhận kết nối thật sự đang trỏ DB thử và đã có schema B1.2.
export async function assertTestConnection(prisma: PrismaService, name: string): Promise<void> {
  const r = await prisma.$queryRaw<{ db: string; migrated: boolean }[]>`SELECT current_database() AS db, (to_regclass('public.customer') IS NOT NULL AND to_regclass('public.lookup_item') IS NOT NULL AND to_regclass('public.audit_log') IS NOT NULL) AS migrated`;
  if (r[0]?.db !== name) throw new Error('current_database() = "' + String(r[0]?.db) + '" khác database thử mong đợi "' + name + '". DỪNG.');
  if (!r[0]?.migrated) throw new Error('Database thử chưa có schema B1.2 (chạy release-b122.bat -Target scratch -Step deploy).');
}

// D.0: mô phỏng máy chủ PostgreSQL có múi giờ mặc định khác UTC (máy Windows tại VN mặc định Asia/Ho_Chi_Minh, +07).
// Đặt ở mức DATABASE (chỉ áp cho phiên MỚI). CHỈ trên DB thử (tên khớp TEST_DB_RE); tz=null => trả về mặc định máy chủ.
export async function setDatabaseDefaultTimeZone(prisma: PrismaService, name: string, tz: string | null): Promise<void> {
  if (name === 'siscom_crm_dev' || !TEST_DB_RE.test(name)) throw new Error('Từ chối đổi múi giờ: "' + name + '" không phải database thử.');
  if (tz !== null && !/^[A-Za-z_]+(\/[A-Za-z_]+)*$/.test(tz)) throw new Error('Tên múi giờ không hợp lệ: ' + tz);
  await prisma.$executeRawUnsafe(tz === null ? 'ALTER DATABASE "' + name + '" RESET timezone' : 'ALTER DATABASE "' + name + '" SET timezone TO \'' + tz + '\'');
}

export const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
export async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}
