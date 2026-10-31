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
  // M-4: sở hữu bảng/sequence/hàm trong public (kể cả qua thành viên nhóm) — điều kiện thật để tắt trigger/sửa hàm.
  ownsObjectsInPublic: boolean;
  // M-4: CREATEROLE / CREATEDB / BYPASSRLS.
  hasAdminAttributes: boolean;
  // QA I-2: dấu hiệu quyền rộng kiểu APP_GRANTS V1 (chạy nhầm V1 => S2/S3 mở lại): ghi bảng RBAC, UPDATE password_hash,
  // hoặc EXECUTE bất kỳ hàm SECURITY DEFINER nào trong public ngoài fn_auth_api_change_own_password (QA N6: so theo tập, không đếm).
  // CI chạy nhánh TRUE thật sau khi cấp V1 (pg-temp-db.sh grants v1, QA N4).
  hasBroadGrants: boolean;
  // QA Minor 4: là thành viên của role khác (nhóm cũ siscom_auth_rt, pg_write_all_data…) — V2 chỉ gỡ quyền cấp trực tiếp.
  isMemberOfOtherRoles: boolean;
  // B1.4 P3c: "quyền xác thực" = SELECT auth_session, hoặc SELECT employee_credential.password_hash, hoặc EXECUTE
  // fn_auth_api_change_own_password. Pool nghiệp vụ (siscom_app) sau APP_GRANTS_V3 KHÔNG được có; pool auth (siscom_auth) PHẢI có.
  hasAuthGrants: boolean;
  // B1.4 P3c: INSERT customer — pool auth không được ghi nghiệp vụ (phát hiện hai URL đổi chỗ).
  canWriteBusiness: boolean;
}

export interface DbRoleAssessment {
  leastPrivilege: boolean;
  problems: string[];
  enforce: boolean;
}

// B1.4 P3c: pool đang kiểm. authSeparate = AUTH_DATABASE_URL đã đặt (pool auth tách riêng). Mặc định = pool app chưa tách (P3b).
export interface DbRolePool { pool: 'app' | 'auth'; authSeparate: boolean }
const APP_SHARED: DbRolePool = { pool: 'app', authSeparate: false };

// Một câu truy vấn, chỉ catalog, không tham số, chạy được bằng chính role ứng dụng ($queryRaw tagged template theo quy ước src —
// không dùng biến thể "Unsafe"). Cột snake_case khớp dbRoleFactsFromRow.
export async function fetchDbRoleFacts(client: Pick<PrismaClient, '$queryRaw'>): Promise<DbRoleFacts> {
  // M-4: chủ sở hữu DB/đối tượng so theo THÀNH VIÊN (pg_has_role MEMBER), không chỉ theo tên.
  const rows = await client.$queryRaw<Record<string, unknown>[]>`SELECT current_user::text AS "user",
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
    (SELECT pg_has_role(current_user, datdba, 'MEMBER') FROM pg_database WHERE datname = current_database()) AS is_db_owner,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
    (CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_migrator') THEN pg_has_role(current_user, 'siscom_migrator', 'MEMBER') ELSE false END) AS is_migrator_member,
    (EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND pg_has_role(current_user, c.relowner, 'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND pg_has_role(current_user, p.proowner, 'MEMBER')
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'))) AS owns_objects_in_public,
    (SELECT rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS has_admin_attributes,
    (CASE WHEN to_regclass('public.employee_role') IS NULL OR to_regclass('public.employee_credential') IS NULL THEN false
          ELSE has_any_column_privilege(current_user, 'public.employee_role', 'INSERT')
               OR has_column_privilege(current_user, 'public.employee_credential', 'password_hash', 'UPDATE')
               OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.prosecdef AND p.proname <> 'fn_auth_api_change_own_password'
                     AND has_function_privilege(current_user, p.oid, 'EXECUTE')) END) AS has_broad_grants,
    EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = current_user) AS is_member_of_other_roles,
    (CASE WHEN to_regclass('public.auth_session') IS NULL OR to_regclass('public.employee_credential') IS NULL THEN false
          ELSE has_any_column_privilege(current_user, 'public.auth_session', 'SELECT')
               OR has_column_privilege(current_user, 'public.employee_credential', 'password_hash', 'SELECT')
               OR (CASE WHEN to_regprocedure('public.fn_auth_api_change_own_password(uuid, integer, text, text, jsonb)') IS NULL THEN false
                        ELSE has_function_privilege(current_user, 'public.fn_auth_api_change_own_password(uuid, integer, text, text, jsonb)', 'EXECUTE') END) END) AS has_auth_grants,
    (CASE WHEN to_regclass('public.customer') IS NULL THEN false ELSE has_any_column_privilege(current_user, 'public.customer', 'INSERT') END) AS can_write_business`;
  return dbRoleFactsFromRow(rows[0] ?? {});
}

export function dbRoleFactsFromRow(row: Record<string, unknown>): DbRoleFacts {
  return {
    user: String(row.user ?? ''),
    isSuperuser: row.is_superuser === true,
    isDbOwner: row.is_db_owner === true,
    canCreateInPublic: row.can_create_in_public === true,
    isMigratorMember: row.is_migrator_member === true,
    ownsObjectsInPublic: row.owns_objects_in_public === true,
    hasAdminAttributes: row.has_admin_attributes === true,
    hasBroadGrants: row.has_broad_grants === true,
    isMemberOfOtherRoles: row.is_member_of_other_roles === true,
    hasAuthGrants: row.has_auth_grants === true,
    canWriteBusiness: row.can_write_business === true,
  };
}

export function assessDbRole(f: DbRoleFacts, nodeEnv: string | undefined, pool: DbRolePool = APP_SHARED): DbRoleAssessment {
  const problems: string[] = [];
  if (pool.pool === 'app' && pool.authSeparate && f.hasAuthGrants) problems.push('tài khoản "' + f.user + '" (pool nghiệp vụ) còn quyền xác thực (auth_session / password_hash / fn_auth_api_change_own_password) dù đã tách pool auth — chạy B1.3_S1_APP_GRANTS_V3.sql.txt');
  if (pool.pool === 'auth' && !f.hasAuthGrants) problems.push('tài khoản "' + f.user + '" (pool auth) KHÔNG có quyền xác thực — AUTH_DATABASE_URL trỏ nhầm tài khoản hoặc B1.3_S1_APP_GRANTS_V3.sql.txt chưa áp');
  if (pool.pool === 'auth' && f.canWriteBusiness) problems.push('tài khoản "' + f.user + '" (pool auth) ghi được bảng nghiệp vụ (customer) — AUTH_DATABASE_URL và DATABASE_URL đổi chỗ?');
  if (f.isDbOwner) problems.push('tài khoản "' + f.user + '" là chủ sở hữu database (có thể tắt trigger, sửa nhật ký) — mô hình cũ B1.1, chưa tách role S1');
  if (f.isSuperuser) problems.push('tài khoản "' + f.user + '" là superuser');
  if (f.canCreateInPublic) problems.push('tài khoản "' + f.user + '" có quyền CREATE trên schema public (DDL)');
  if (f.isMigratorMember || f.user === 'siscom_migrator') problems.push('tài khoản "' + f.user + '" là siscom_migrator hoặc thành viên của siscom_migrator (DATABASE_URL đang trỏ tài khoản migrate?)');
  if (f.user.toLowerCase() === 'postgres') problems.push('tài khoản là postgres');
  if (f.ownsObjectsInPublic) problems.push('tài khoản "' + f.user + '" sở hữu bảng/sequence/hàm trong schema public (có thể tắt trigger, sửa hàm)');
  if (f.hasAdminAttributes) problems.push('tài khoản "' + f.user + '" có CREATEROLE/CREATEDB/BYPASSRLS');
  if (f.hasBroadGrants) problems.push('tài khoản "' + f.user + '" có quyền rộng kiểu APP_GRANTS V1 (ghi bảng RBAC / UPDATE password_hash / EXECUTE hàm SECURITY DEFINER ngoài fn_auth_api_change_own_password) — chạy B1.3_S1_APP_GRANTS_V2.sql.txt');
  if (f.isMemberOfOtherRoles) problems.push('tài khoản "' + f.user + '" là thành viên của role khác (quyền thừa qua nhóm)');
  return { leastPrivilege: problems.length === 0, problems, enforce: nodeEnv === 'production' };
}

export interface DbRoleLogger { warn(msg: string): void; error(msg: string): void }

// I-2 (rà soát P3b): production không được bỏ qua vĩnh viễn khi lần kiểm đầu lỗi (backend lên trước PostgreSQL sau khi VPS khởi động lại,
// hoặc lỗi SQL của chính câu kiểm). Kiểm lại mỗi retryMs tới khi đọc được; vi phạm phát hiện ở lần kiểm lại => exit(1) (systemd ghi lỗi).
export interface DbRoleRetry {
  retryMs: number;
  schedule: (fn: () => Promise<void>, ms: number) => void;
  exit: (code: number) => void;
  // QA Minor 7: true khi ứng dụng đang tắt (onModuleDestroy) => bỏ lần kiểm lại đã hẹn (không mở lại pool).
  isStopped?: () => boolean;
}
export const DEFAULT_RETRY: DbRoleRetry = {
  retryMs: 15000,
  schedule: (fn, ms) => { setTimeout(() => { void fn(); }, ms).unref(); },
  exit: (code) => process.exit(code),
};

// Gọi lúc khởi động ứng dụng (PrismaService.onApplicationBootstrap). Vi phạm lúc khởi động => ném lỗi (main.ts thoát 1).
// Không in URL/mật khẩu/lỗi driver.
export async function enforceDbRoleAtStartup(
  query: () => Promise<DbRoleFacts>, nodeEnv: string | undefined, log: DbRoleLogger, retry: DbRoleRetry = DEFAULT_RETRY, pool: DbRolePool = APP_SHARED,
): Promise<{ checked: boolean; leastPrivilege: boolean | null }> {
  let facts: DbRoleFacts;
  try { facts = await query(); } catch {
    const again = nodeEnv === 'production';
    log.warn('Chưa kiểm được role database lúc khởi động (database chưa kết nối được hoặc câu kiểm lỗi)'
      + (again ? '; production: kiểm lại mỗi ' + Math.round(retry.retryMs / 1000) + ' giây.' : '; sẽ báo qua /health/database.'));
    if (again) scheduleRecheck(query, nodeEnv, log, retry, 2, pool);
    return { checked: false, leastPrivilege: null };
  }
  const a = assessDbRole(facts, nodeEnv, pool);
  if (a.leastPrivilege) return { checked: true, leastPrivilege: true };
  const text = 'Role database không phải đặc quyền tối thiểu: ' + a.problems.join('; ') + '.';
  if (a.enforce) {
    log.error(text + ' NODE_ENV=production => từ chối khởi động. Dùng DATABASE_URL của siscom_app (sau S1 + APP_GRANTS_V2); MIGRATE_DATABASE_URL chỉ cho migrate.');
    throw new Error(text);
  }
  log.warn(text + ' Chỉ cảnh báo ngoài production (máy phát triển chưa tách role).');
  return { checked: true, leastPrivilege: false };
}

function scheduleRecheck(query: () => Promise<DbRoleFacts>, nodeEnv: string | undefined, log: DbRoleLogger, retry: DbRoleRetry, attempt: number, pool: DbRolePool): void {
  retry.schedule(async () => {
    if (retry.isStopped?.()) return;
    let facts: DbRoleFacts;
    try { facts = await query(); } catch {
      // Cảnh báo lần đầu và mỗi 20 lần (tránh ngập log khi DB tắt lâu); luôn lên lịch tiếp — không bỏ cuộc.
      if (attempt === 2 || attempt % 20 === 0) log.warn('Vẫn chưa kiểm được role database (lần ' + attempt + '); tiếp tục kiểm lại.');
      scheduleRecheck(query, nodeEnv, log, retry, attempt + 1, pool);
      return;
    }
    const a = assessDbRole(facts, nodeEnv, pool);
    if (a.leastPrivilege) return;
    log.error('Role database không phải đặc quyền tối thiểu: ' + a.problems.join('; ') + '. NODE_ENV=production => dừng tiến trình.');
    retry.exit(1);
  }, retry.retryMs);
}
