// B1.4 P3 (S1 tách role): URL cho Prisma CLI (migrate deploy/status/diff) và các CLI vận hành (bootstrap-auth) ƯU TIÊN MIGRATE_DATABASE_URL
// (role chủ sở hữu siscom_migrator), rơi về DATABASE_URL (role ứng dụng siscom_app) khi không đặt — tương thích máy Windows chưa tách role.
// Backend chạy LUÔN dùng DATABASE_URL (env.validation.ts), không bao giờ đọc MIGRATE_DATABASE_URL. Hàm thuần, không đọc .env, không in URL.
export type PrismaCliUrlSource = 'MIGRATE_DATABASE_URL' | 'DATABASE_URL';

export function pickPrismaCliUrl(env: Record<string, string | undefined>): { url: string; source: PrismaCliUrlSource } {
  const migrate = (env.MIGRATE_DATABASE_URL ?? '').trim();
  const app = (env.DATABASE_URL ?? '').trim();
  const chosen: { url: string; source: PrismaCliUrlSource } = migrate ? { url: migrate, source: 'MIGRATE_DATABASE_URL' } : { url: app, source: 'DATABASE_URL' };
  if (!chosen.url) throw new Error('Thiếu DATABASE_URL (hoặc MIGRATE_DATABASE_URL cho migrate deploy sau khi tách role).');
  let u: URL;
  try { u = new URL(chosen.url); } catch { throw new Error(chosen.source + ' sai định dạng (mật khẩu chứa ký tự đặc biệt chưa mã hoá URL?).'); }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new Error(chosen.source + ' phải bắt đầu bằng postgresql://');
  if (!u.username) throw new Error(chosen.source + ' thiếu tên tài khoản.');
  if (decodeURIComponent(u.username).toLowerCase() === 'postgres') throw new Error(chosen.source + ' không được dùng tài khoản postgres (superuser).');
  if (u.pathname.length < 2) throw new Error(chosen.source + ' thiếu tên database.');
  return chosen;
}
