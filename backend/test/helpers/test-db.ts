import { PrismaService } from '../../src/prisma/prisma.service';
import { resolveTestDatabase, type TestEnvLike } from './test-db-guard';

export const TEST_DB_RE = /^siscom_crm_(restore|test)_\d{8}_\d{6}$/;

// Luồng hiện hữu (run-customers-tests.ps1): chỉ chấp nhận DB thử + siscom_app@127.0.0.1:5432. F-03: logic kiểm tra nằm ở test-db-guard.ts (thuần, có test); thêm từ chối DB baseline đã khóa và URL có query.
export function testDatabase(env: TestEnvLike = process.env): { url: string; name: string } {
  return resolveTestDatabase(env, 'legacy-shared-app');
}

// DB cô lập (F-02/E-03): siscom_crm_test_<stamp>, role siscom_t_*_<stamp>, cổng khác 5432. Chưa nối vào luồng nào; cần chủ repo duyệt riêng trước khi dùng.
export function disposableTestDatabase(env: TestEnvLike = process.env): { url: string; name: string } {
  return resolveTestDatabase(env, 'disposable');
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

export const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
export async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}
