// F-02 (PR #15–#24 review): bằng chứng "DB đã thật sự khóa" phải do CHÍNH PostgreSQL xác nhận cho chính kết nối đang dùng,
// không phải do cờ cấu hình. File này chỉ chứa: (1) một câu SELECT cố định chỉ đọc catalog, (2) bộ đánh giá thuần (không I/O).
// CHƯA CHẠY TRÊN POSTGRESQL (không có DB trong phiên soạn). Test DB cần chạy: docs/B1.3_F01_PHASE2_ARCHITECTURE.md (mục 7).
//
// Nguyên tắc fail-closed: thiếu cột / sai kiểu / NULL (đối tượng không tồn tại => không chứng minh được) / giá trị lạ => KHÔNG sẵn sàng.

export const EVIDENCE_VERSION = 1;
export type ProbeProfile = 'GENERAL' | 'AUTH';

// has_*_privilege tính cả quyền PUBLIC lẫn quyền kế thừa theo vai trò => đúng thứ PostgreSQL sẽ thi hành.
// to_regclass/to_regprocedure trả NULL khi thiếu đối tượng => hàm STRICT trả NULL => đánh giá coi là "không chứng minh được".
const T = (t: string) => `pg_catalog.to_regclass('public.${t}')`;
const WRITE = `'INSERT,UPDATE,DELETE,TRUNCATE'`;
const API11 = [
  'fn_auth_api_request_create(uuid, public.privileged_change_type, uuid, uuid, jsonb, integer)',
  'fn_auth_api_request_decide(uuid, uuid, boolean)',
  'fn_auth_api_request_expire(uuid)',
  'fn_auth_api_role_grant(uuid, uuid)',
  'fn_auth_api_role_revoke(uuid, uuid, uuid, uuid)',
  'fn_auth_api_role_permission_change(uuid, uuid)',
  'fn_auth_api_reset_token_issue(uuid, uuid, text, integer)',
  'fn_auth_api_reset_password(uuid, text, text, text, jsonb)',
  'fn_auth_api_change_own_password(uuid, integer, text, text, jsonb)',
  'fn_auth_api_credential_create(uuid, uuid)',
  'fn_auth_api_credential_disable(uuid, uuid, text)',
];
const INTERNAL4 = [
  'fn_auth_api_actor(uuid, text)',
  'fn_auth_api_audit(text, uuid, text, text, uuid, text, jsonb)',
  'fn_auth_api_check_secret(text, text, jsonb)',
  'fn_auth_bootstrap_close(text)',
];
const proc = (f: string) => `pg_catalog.to_regprocedure('public.${f}')`;
const execCount = (fns: string[]) =>
  '(' + fns.map((f) => `(CASE WHEN pg_catalog.has_function_privilege(current_user, ${proc(f)}, 'EXECUTE') THEN 1 ELSE 0 END)`).join(' + ') + ')';
// Có hàm không tồn tại => NULL => tổng NULL (không chứng minh được; test đánh giá đòi đúng 11 / 4).
const presentCount = (fns: string[]) =>
  '(' + fns.map((f) => `(CASE WHEN ${proc(f)} IS NULL THEN NULL ELSE 1 END)`).join(' + ') + ')';

// Một câu lệnh, không tham số, chỉ SELECT (catalog + một EXISTS đọc app_meta). Chạy trên kết nối của CHÍNH pool cần kiểm.
export const EVIDENCE_SQL = `SELECT
  ${EVIDENCE_VERSION}::int AS evidence_version,
  current_user::text AS db_user,
  (session_user = current_user) AS session_is_current,
  (SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication) FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS role_unprivileged,
  (SELECT pg_catalog.pg_has_role(current_user, m.oid, 'MEMBER') FROM pg_catalog.pg_roles m WHERE m.rolname = 'siscom_migrator') AS is_migrator_member,
  (SELECT pg_catalog.pg_has_role(current_user, d.datdba, 'MEMBER') FROM pg_catalog.pg_database d WHERE d.datname = current_database()) AS is_database_owner,
  (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER')) AS owned_public_relations,
  (${['employee_role', 'role_permission', 'role', 'permission', 'privileged_change_request']
    .map((t) => `pg_catalog.has_table_privilege(current_user, ${T(t)}, ${WRITE})`).join(' OR ')}) AS can_write_rbac,
  pg_catalog.has_table_privilege(current_user, ${T('password_reset_token')}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS can_touch_reset_tokens,
  pg_catalog.has_column_privilege(current_user, ${T('employee_credential')}, 'password_hash', 'SELECT') AS can_read_password_hash,
  (pg_catalog.has_column_privilege(current_user, ${T('employee_credential')}, 'password_hash', 'INSERT,UPDATE')
    OR pg_catalog.has_table_privilege(current_user, ${T('employee_credential')}, 'INSERT,DELETE,TRUNCATE')) AS can_write_credential_secret,
  pg_catalog.has_table_privilege(current_user, ${T('audit_log')}, 'UPDATE,DELETE,TRUNCATE') AS can_tamper_audit,
  ${presentCount(API11)}::int AS api_function_count,
  ${execCount(API11)}::int AS api_exec_count,
  ${presentCount(INTERNAL4)}::int AS internal_function_count,
  ${execCount(INTERNAL4)}::int AS internal_exec_count,
  EXISTS (SELECT 1 FROM public.app_meta WHERE key = 'auth_bootstrap_done') AS bootstrap_closed`;

export interface ReadinessResult { ready: boolean; reasons: string[] }

type Row = Record<string, unknown>;
const isBool = (v: unknown, want: boolean) => v === want;
// Chỉ nhận number nguyên (đã ép ::int). bigint/string/NULL/undefined => từ chối.
const isInt = (v: unknown, want: number) => typeof v === 'number' && Number.isInteger(v) && v === want;

export function evaluateEvidence(profile: ProbeProfile, row: unknown): ReadinessResult {
  const p = profile === 'GENERAL' ? 'G' : 'A';
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return { ready: false, reasons: [`${p}_EVIDENCE_MISSING`] };
  const r = row as Row;
  const reasons: string[] = [];
  const need = (code: string, ok: boolean) => { if (!ok) reasons.push(`${p}_${code}`); };

  need('EVIDENCE_VERSION', isInt(r.evidence_version, EVIDENCE_VERSION));
  need('DB_USER', typeof r.db_user === 'string' && r.db_user.length > 0 && r.db_user.toLowerCase() !== 'postgres');
  need('SESSION_SWITCHED', isBool(r.session_is_current, true));
  need('ROLE_PRIVILEGED', isBool(r.role_unprivileged, true));
  need('IS_MIGRATOR_MEMBER', isBool(r.is_migrator_member, false));
  need('IS_DATABASE_OWNER', isBool(r.is_database_owner, false));
  need('OWNS_PUBLIC_OBJECTS', isInt(r.owned_public_relations, 0));
  need('CAN_WRITE_RBAC', isBool(r.can_write_rbac, false));
  need('CAN_TOUCH_RESET_TOKENS', isBool(r.can_touch_reset_tokens, false));
  need('CAN_WRITE_CREDENTIAL_SECRET', isBool(r.can_write_credential_secret, false));
  need('CAN_TAMPER_AUDIT', isBool(r.can_tamper_audit, false));
  need('API_FUNCTIONS_MISSING', isInt(r.api_function_count, 11));
  need('INTERNAL_FUNCTIONS_MISSING', isInt(r.internal_function_count, 4));
  need('INTERNAL_EXEC', isInt(r.internal_exec_count, 0));
  need('BOOTSTRAP_OPEN', isBool(r.bootstrap_closed, true));
  if (profile === 'GENERAL') {
    // F-01/F-03: pool nghiệp vụ KHÔNG gọi được 11 hàm API đặc quyền và KHÔNG đọc được password_hash.
    need('CAN_EXEC_PRIVILEGED_API', isInt(r.api_exec_count, 0));
    need('CAN_READ_PASSWORD_HASH', isBool(r.can_read_password_hash, false));
  } else {
    // Pool auth phải gọi được đúng 11 hàm API (nếu không, cấu hình sai chứ không phải "an toàn").
    need('API_EXEC_INCOMPLETE', isInt(r.api_exec_count, 11));
    need('CAN_READ_PASSWORD_HASH_UNKNOWN', typeof r.can_read_password_hash === 'boolean');
  }
  return { ready: reasons.length === 0, reasons };
}

// Hai pool phải là hai danh tính DB khác nhau (tách pool = điều kiện của F-01).
export function evaluatePoolSeparation(general: unknown, auth: unknown): ReadinessResult {
  const g = (general as Row | null)?.db_user;
  const a = (auth as Row | null)?.db_user;
  const ok = typeof g === 'string' && typeof a === 'string' && g.length > 0 && a.length > 0 && g.toLowerCase() !== a.toLowerCase();
  return ok ? { ready: true, reasons: [] } : { ready: false, reasons: ['POOLS_NOT_SEPARATED'] };
}
