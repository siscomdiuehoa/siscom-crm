// B1.4 P3b (M-d, rà soát P3): backend chỉ được chạy bằng role ứng dụng đặc quyền tối thiểu (siscom_app sau S1 + APP_GRANTS_V2).
// Chạy bằng chủ sở hữu DB / siscom_migrator / superuser / role có CREATE trên public làm mất tác dụng tách role (tắt trigger, sửa nhật ký).
// NODE_ENV=production: từ chối khởi động khi CÓ BẰNG CHỨNG sai cấu hình. Không kết nối được lúc khởi động: không chặn (giữ hành vi
// "backend vẫn chạy khi DB tạm tắt", prisma.service.ts) — chỉ cảnh báo; lần kiểm tiếp theo là /health/database.
// Môi trường khác (development/test — máy Windows chưa tách role, siscom_app còn là chủ sở hữu): chỉ cảnh báo. Hàm thuần, không đọc .env.
import type { PrismaClient } from '../generated/prisma/client';

export interface DbRoleFacts {
  user: string;
  isSuperuser: boolean;
  isDbOwner: boolean;
  canCreateInPublic: boolean;
  isMigratorMember: boolean;
}

export interface DbRoleAssessment {
  leastPrivilege: boolean;
  problems: string[];
  enforce: boolean;
}

// Một câu truy vấn, chỉ catalog, không tham số, chạy được bằng chính role ứng dụng ($queryRaw tagged template theo quy ước src —
// không dùng biến thể "Unsafe"). Cột snake_case khớp dbRoleFactsFromRow.
export async function fetchDbRoleFacts(client: Pick<PrismaClient, '$queryRaw'>): Promise<DbRoleFacts> {
  const rows = await client.$queryRaw<Record<string, unknown>[]>`SELECT current_user::text AS "user",
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
    (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = current_user::text AS is_db_owner,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
    (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_migrator') AND pg_has_role(current_user, 'siscom_migrator', 'MEMBER')) AS is_migrator_member`;
  return dbRoleFactsFromRow(rows[0] ?? {});
}

export function dbRoleFactsFromRow(row: Record<string, unknown>): DbRoleFacts {
  return {
    user: String(row.user ?? ''),
    isSuperuser: row.is_superuser === true,
    isDbOwner: row.is_db_owner === true,
    canCreateInPublic: row.can_create_in_public === true,
    isMigratorMember: row.is_migrator_member === true,
  };
}

export function assessDbRole(f: DbRoleFacts, nodeEnv: string | undefined): DbRoleAssessment {
  const problems: string[] = [];
  if (f.isDbOwner) problems.push('tài khoản "' + f.user + '" là chủ sở hữu database (có thể tắt trigger, sửa nhật ký) — mô hình cũ B1.1, chưa tách role S1');
  if (f.isSuperuser) problems.push('tài khoản "' + f.user + '" là superuser');
  if (f.canCreateInPublic) problems.push('tài khoản "' + f.user + '" có quyền CREATE trên schema public (DDL)');
  if (f.isMigratorMember || f.user === 'siscom_migrator') problems.push('tài khoản "' + f.user + '" là siscom_migrator hoặc thành viên của siscom_migrator (DATABASE_URL đang trỏ tài khoản migrate?)');
  if (f.user.toLowerCase() === 'postgres') problems.push('tài khoản là postgres');
  return { leastPrivilege: problems.length === 0, problems, enforce: nodeEnv === 'production' };
}

export interface DbRoleLogger { warn(msg: string): void; error(msg: string): void }

// Gọi lúc khởi động ứng dụng (PrismaService.onApplicationBootstrap). Ném lỗi => main.ts thoát 1. Không in URL/mật khẩu/lỗi driver.
export async function enforceDbRoleAtStartup(
  query: () => Promise<DbRoleFacts>, nodeEnv: string | undefined, log: DbRoleLogger,
): Promise<{ checked: boolean; leastPrivilege: boolean | null }> {
  let facts: DbRoleFacts;
  try { facts = await query(); } catch {
    log.warn('Chưa kiểm được role database lúc khởi động (database chưa kết nối được); sẽ kiểm qua /health/database.');
    return { checked: false, leastPrivilege: null };
  }
  const a = assessDbRole(facts, nodeEnv);
  if (a.leastPrivilege) return { checked: true, leastPrivilege: true };
  const text = 'Role database không phải đặc quyền tối thiểu: ' + a.problems.join('; ') + '.';
  if (a.enforce) {
    log.error(text + ' NODE_ENV=production => từ chối khởi động. Dùng DATABASE_URL của siscom_app (sau S1 + APP_GRANTS_V2); MIGRATE_DATABASE_URL chỉ cho migrate.');
    throw new Error(text);
  }
  log.warn(text + ' Chỉ cảnh báo ngoài production (máy phát triển chưa tách role).');
  return { checked: true, leastPrivilege: false };
}
