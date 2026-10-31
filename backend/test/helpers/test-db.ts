import { Client } from 'pg';
import { AuthPrismaService } from '../../src/prisma/auth-prisma.service';
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

// B1.4 P3 (S1 tách role): thao tác cần CHỦ SỞ HỮU database (ALTER DATABASE, fn_auth_bootstrap_close khi bootstrap) dùng
// TEST_MIGRATE_DATABASE_URL (siscom_migrator) nếu có — CI sau khi tách role; không có => rơi về URL ứng dụng (máy Windows chưa tách,
// siscom_app vẫn là chủ sở hữu). Cùng host 127.0.0.1 và CÙNG tên database thử với TEST_DATABASE_URL (không bao giờ là siscom_crm_dev).
export function adminTestDatabase(): { url: string; name: string; split: boolean } {
  const app = testDatabase();
  const url = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!url) return { ...app, split: false };
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('TEST_MIGRATE_DATABASE_URL không hợp lệ.'); }
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (name !== app.name) throw new Error('Từ chối: TEST_MIGRATE_DATABASE_URL trỏ "' + name + '" khác database thử "' + app.name + '".');
  if (u.hostname !== '127.0.0.1') throw new Error('Từ chối: host của TEST_MIGRATE_DATABASE_URL phải là 127.0.0.1.');
  if (decodeURIComponent(u.username) !== 'siscom_migrator') throw new Error('Từ chối: tài khoản của TEST_MIGRATE_DATABASE_URL phải là siscom_migrator.');
  return { url, name, split: true };
}

export function createTestPrisma(): { prisma: PrismaService; name: string } {
  const { url, name } = testDatabase();
  // PrismaService chỉ cần ConfigService.getOrThrow('DATABASE_URL'); cấp trực tiếp URL thử, không đọc .env.
  const prisma = new PrismaService({ getOrThrow: () => url } as never);
  return { prisma, name };
}

// Kết nối chủ sở hữu (siscom_migrator sau S1; siscom_app khi chưa tách). Chỉ dùng cho bootstrap trong test, đóng ngay sau khi xong.
export function createAdminTestPrisma(): { prisma: PrismaService; name: string; split: boolean } {
  const { url, name, split } = adminTestDatabase();
  const prisma = new PrismaService({ getOrThrow: () => url } as never);
  return { prisma, name, split };
}

// Chạy TRƯỚC mọi thao tác ghi: xác nhận kết nối thật sự đang trỏ DB thử và đã có schema B1.2.
export async function assertTestConnection(prisma: PrismaService, name: string): Promise<void> {
  const r = await prisma.$queryRaw<{ db: string; migrated: boolean }[]>`SELECT current_database() AS db, (to_regclass('public.customer') IS NOT NULL AND to_regclass('public.lookup_item') IS NOT NULL AND to_regclass('public.audit_log') IS NOT NULL) AS migrated`;
  if (r[0]?.db !== name) throw new Error('current_database() = "' + String(r[0]?.db) + '" khác database thử mong đợi "' + name + '". DỪNG.');
  if (!r[0]?.migrated) throw new Error('Database thử chưa có schema B1.2 (chạy release-b122.bat -Target scratch -Step deploy).');
}

// D.0: mô phỏng máy chủ PostgreSQL có múi giờ mặc định khác UTC (máy Windows tại VN mặc định Asia/Ho_Chi_Minh, +07).
// Đặt ở mức DATABASE (chỉ áp cho phiên MỚI) = ghi cấu hình catalog, nên CHỈ trên DB thử dùng một lần siscom_crm_test_*
// (không nhận bản siscom_crm_restore_* đã khoá baseline); tz=null => RESET về mặc định máy chủ.
// ALTER DATABASE cần CHỦ SỞ HỮU => kết nối pg thô theo adminTestDatabase() (B1.4 P3 S1), không qua pool của ứng dụng.
export async function setDatabaseDefaultTimeZone(name: string, tz: string | null): Promise<void> {
  if (!/^siscom_crm_test_\d{8}_\d{6}$/.test(name)) throw new Error('Từ chối đổi múi giờ: "' + name + '" không phải database thử siscom_crm_test_*.');
  if (tz !== null && !/^[A-Za-z_]+(\/[A-Za-z_]+)*$/.test(tz)) throw new Error('Tên múi giờ không hợp lệ: ' + tz);
  const admin = adminTestDatabase();
  if (admin.name !== name) throw new Error('Từ chối đổi múi giờ: kết nối chủ sở hữu trỏ "' + admin.name + '" khác "' + name + '".');
  const c = new Client({ connectionString: admin.url });
  await c.connect();
  try {
    const cur = await c.query<{ db: string }>('SELECT current_database() AS db');
    if (cur.rows[0]?.db !== name) throw new Error('current_database() khác database thử mong đợi. DỪNG.');
    await c.query(tz === null ? 'ALTER DATABASE "' + name + '" RESET timezone' : 'ALTER DATABASE "' + name + '" SET timezone TO \'' + tz + '\'');
  } finally { await c.end(); }
}

export const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
export async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}

// B1.4 P3c: POOL XÁC THỰC (siscom_auth) qua TEST_AUTH_DATABASE_URL — CI sau khi áp APP_GRANTS_V3; không có => rơi về URL ứng dụng
// (máy Windows chưa tách; AuthPrismaService cũng rơi về DATABASE_URL khi không có AUTH_DATABASE_URL). Cùng host 127.0.0.1, cùng DB thử.
export function authTestDatabase(): { url: string; name: string; separate: boolean } {
  const app = testDatabase();
  const url = process.env.TEST_AUTH_DATABASE_URL;
  if (!url) return { ...app, separate: false };
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('TEST_AUTH_DATABASE_URL không hợp lệ.'); }
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (name !== app.name) throw new Error('Từ chối: TEST_AUTH_DATABASE_URL trỏ "' + name + '" khác database thử "' + app.name + '".');
  if (u.hostname !== '127.0.0.1') throw new Error('Từ chối: host của TEST_AUTH_DATABASE_URL phải là 127.0.0.1.');
  if (decodeURIComponent(u.username) !== 'siscom_auth') throw new Error('Từ chối: tài khoản của TEST_AUTH_DATABASE_URL phải là siscom_auth.');
  return { url, name, separate: true };
}

// AuthPrismaService thử: constructor chỉ cần getOrThrow('DATABASE_URL') + get('AUTH_DATABASE_URL'/'NODE_ENV').
export function createAuthTestPrisma(): { prisma: AuthPrismaService; name: string; separate: boolean } {
  const app = testDatabase();
  const a = authTestDatabase();
  const cfg = { getOrThrow: () => app.url, get: (k: string) => (k === 'AUTH_DATABASE_URL' ? (a.separate ? a.url : undefined) : k === 'NODE_ENV' ? 'test' : undefined) };
  return { prisma: new AuthPrismaService(cfg as never), name: a.name, separate: a.separate };
}
