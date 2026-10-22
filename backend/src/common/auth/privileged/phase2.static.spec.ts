import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Kiểm tra TĨNH (chỉ đọc văn bản; không SQL, không DB) bản nháp giai đoạn 2: migration P2, script role/grant, bộ test DB, và việc KHÔNG đăng ký mặc định.
// Đây KHÔNG phải bằng chứng hành vi PostgreSQL: chỉ chặn hồi quy văn bản (ví dụ ai đó thêm p_actor vào hàm *_v2, hoặc cấp quyền cho siscom_app).
const BACKEND = join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(BACKEND, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const mig = read('docs/drafts/B1.3_P2_SESSION_BOUND_MIGRATION_DRAFT.sql.txt');
const migCode = stripComments(mig);
const split = read('docs/B1.3_P2_ROLE_SPLIT.sql.txt');
const grants = read('docs/B1.3_P2_GRANTS.sql.txt');
const rollback = read('docs/B1.3_P2_ROLLBACK.sql.txt');
const dbTests = read('docs/B1.3_P2_DB_TESTS.sql.txt');

// Tách thân từng hàm: từ "CREATE FUNCTION public.<name>(" tới "END $$;" hoặc "$$;" kết thúc hàm SQL.
function fn(name: string): string {
  const start = migCode.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migCode.indexOf('$$;', migCode.indexOf('AS $$', start) + 5);
  return migCode.slice(start, end + 3);
}
const V2_IDENTITY = [
  'fn_auth_api_request_create_v2', 'fn_auth_api_request_decide_v2', 'fn_auth_api_role_grant_v2', 'fn_auth_api_role_revoke_v2',
  'fn_auth_api_role_permission_change_v2', 'fn_auth_api_reset_token_issue_v2', 'fn_auth_api_change_own_password_v2',
  'fn_auth_api_credential_create_v2', 'fn_auth_api_credential_disable_v2',
];

describe('migration P2 (DRAFT, chưa áp) — cấu trúc', () => {
  it('nằm ở docs/drafts (.sql.txt), ASCII, KHÔNG nằm trong prisma/migrations; M1..M1.3 không đổi tên/số lượng', () => {
    expect(mig).toMatch(/DRAFT/);
    expect(mig).not.toMatch(/[^\x00-\x7F]/);
    const dirs = readdirSync(join(BACKEND, 'prisma', 'migrations')).filter((n) => n !== 'migration_lock.toml');
    expect(dirs).toEqual([
      '20261011000000_init', '20261012000000_b1_2_crm_core', '20261020000000_b1_3_auth_core', '20261020120000_b1_3_auth_m1_1_guards',
      '20261020180000_b1_3_auth_m1_2_priv_api', '20261021000000_b1_3_auth_m1_3_reset_revocation',
    ]);
  });
  it('chỉ cộng thêm: không CREATE OR REPLACE, không DROP/GRANT/TRUNCATE/ALTER TABLE trong phần mã chạy được', () => {
    expect(migCode).not.toMatch(/CREATE OR REPLACE/i);
    // Phân biệt hoa/thường: câu lệnh viết HOA; chữ thường trong chuỗi COMMENT/thông điệp không tính.
    expect(migCode).not.toMatch(/\b(DROP|GRANT|ALTER\s+TABLE|ALTER\s+ROLE|CREATE\s+ROLE)\b|^TRUNCATE\b/m); // BEFORE TRUNCATE (sự kiện trigger chặn) là hợp lệ
    expect(migCode).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
  it('mọi hàm có search_path cố định (pg_temp cuối) và bị REVOKE ALL FROM PUBLIC', () => {
    const creates = migCode.match(/CREATE FUNCTION public\.\w+\(/g) ?? [];
    expect(creates.length).toBe(17); // 7 (2 apg + 2 nội bộ + issue/actor/login) + 9 *_v2 + reset_password_v2
    const searchPaths = migCode.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? [];
    expect(searchPaths.length).toBeGreaterThanOrEqual(creates.length);
    const revokes = migCode.match(/REVOKE ALL ON FUNCTION public\.\w+\(/g) ?? [];
    expect(revokes.length).toBe(creates.length);
    expect(migCode).not.toMatch(/search_path = (?!pg_catalog, public, pg_temp)/);
    expect(migCode).toMatch(/REVOKE ALL ON TABLE public\.auth_priv_grant FROM PUBLIC;/);
  });
  it('mọi hàm API/hỗ trợ là SECURITY DEFINER; hàm nội bộ (resolve, actor) KHÔNG phải DEFINER', () => {
    for (const n of [...V2_IDENTITY, 'fn_auth_api_reset_password_v2', 'fn_auth_priv_grant_issue', 'fn_auth_priv_grant_actor', 'fn_auth_credential_for_login', 'fn_apg_revoke_on_session']) {
      expect(fn(n)).toMatch(/SECURITY DEFINER/);
    }
    for (const n of ['fn_auth_priv_resolve', 'fn_auth_priv_actor']) expect(fn(n)).not.toMatch(/SECURITY DEFINER/);
  });
  it('bảng auth_priv_grant: băm hex, TTL <= 10 phút, 1..5 lượt, FK RESTRICT, bất biến, không xóa/truncate', () => {
    expect(migCode).toMatch(/grant_hash\s+varchar\(64\)/);
    expect(migCode).toMatch(/CHECK \(grant_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(migCode).toMatch(/expires_at <= issued_at \+ interval '10 minutes'/);
    expect(migCode).toMatch(/max_uses BETWEEN 1 AND 5/);
    expect(migCode.match(/ON DELETE RESTRICT/g)?.length).toBe(2);
    expect(migCode).toMatch(/trg_apg_no_delete[\s\S]*fn_block_mutation/);
    expect(migCode).toMatch(/trg_apg_no_truncate[\s\S]*fn_block_mutation/);
    expect(fn('fn_apg_before_update')).toMatch(/use_count < OLD\.use_count/);
  });
});

describe('F-01 — hàm *_v2 không nhận danh tính từ ứng dụng', () => {
  it.each(V2_IDENTITY)('%s: tham số đầu (p_session uuid, p_grant text), KHÔNG p_actor/p_employee làm danh tính, gọi fn_auth_priv_actor(p_session, p_grant)', (n) => {
    const f = fn(n);
    const sig = f.slice(0, f.indexOf(' RETURNS'));
    expect(sig).toMatch(/\(p_session uuid, p_grant text/);
    expect(sig).not.toMatch(/p_actor/);
    expect(f).toMatch(/public\.fn_auth_priv_actor\(p_session, p_grant\)/);
    expect(f).not.toMatch(/set_config|current_setting/i); // không đụng GUC danh tính ở lớp bọc
  });
  it('khóa danh tính: không hàm nào của P2 đặt hoặc đọc GUC app.* ở lớp P2', () => {
    expect(migCode).not.toMatch(/set_config\('app\./);
    expect(migCode).not.toMatch(/current_setting\('app\./);
  });
  it('resolve: tra theo băm + ĐÚNG phiên, khóa dòng khi tiêu thụ, hết hạn/thu hồi/hết lượt/phiên/credential/token_version đều từ chối, tăng use_count', () => {
    const f = fn('fn_auth_priv_resolve');
    for (const re of [
      /grant_hash = v_hash AND session_id = p_session FOR UPDATE/, /g\.revoked_at IS NOT NULL/, /g\.expires_at <= clock_timestamp\(\)/, /g\.use_count >= g\.max_uses/,
      /s\.revoked_at IS NULL AND s\.rotated_at IS NULL/, /s\.idle_expires_at > clock_timestamp\(\) AND s\.abs_expires_at > clock_timestamp\(\)/,
      /c\.status = 'ACTIVE' AND c\.token_version = g\.token_version/, /e\.status = 'ACTIVE' AND e\.deleted_at IS NULL/,
      /s\.employee_id = g\.employee_id/, /UPDATE public\.auth_priv_grant SET use_count = use_count \+ 1/, /sha256\(convert_to\(p_grant, 'UTF8'\)\)/,
      /p_grant !~ '\^\[A-Za-z0-9_-\]\{43,128\}\$'/,
    ]) expect(f).toMatch(re);
    expect(f).not.toMatch(/p_actor/);
  });
  it('priv_actor: RAISE 42501 SESSION_PROOF_INVALID với thông điệp cố định (không lộ lý do)', () => {
    const f = fn('fn_auth_priv_actor');
    expect(f).toMatch(/fn_auth_priv_resolve\(p_session, p_grant, true\)/);
    expect(f).toMatch(/RAISE EXCEPTION 'SESSION_PROOF_INVALID: bang chung phien khong hop le\.' USING ERRCODE = 'insufficient_privilege'/);
  });
  it('grant_issue: khoi tao dong, dinh dang bang chung, ttl/luot, phien con hieu luc, credential ACTIVE, gioi han grant, audit khong chua bi mat', () => {
    const f = fn('fn_auth_priv_grant_issue');
    for (const re of [
      /fn_auth_bootstrap_open\(\)/, /p_refresh_proof !~/, /p_grant_hash !~ '\^\[0-9a-f\]\{64\}\$'/, /p_ttl_seconds NOT BETWEEN 30 AND 600/, /p_max_uses NOT BETWEEN 1 AND 5/,
      /refresh_hash = encode\(sha256\(convert_to\(p_refresh_proof, 'UTF8'\)\), 'hex'\)/, /revoked_at IS NULL AND rotated_at IS NULL/, /c\.status = 'ACTIVE'/, />= 5 THEN/,
      /pg_advisory_xact_lock/,
    ]) expect(f).toMatch(re);
    const audit = f.slice(f.indexOf('fn_auth_api_audit'));
    expect(audit).not.toMatch(/p_refresh_proof|p_grant_hash/);
  });
  it('grant_actor: chỉ resolve KHÔNG tiêu thụ', () => {
    expect(fn('fn_auth_priv_grant_actor')).toMatch(/fn_auth_priv_resolve\(p_session, p_grant, false\)/);
  });
  it('revoke theo phiên: trigger AFTER UPDATE OF revoked_at, rotated_at chỉ khi chuyển từ NULL', () => {
    expect(migCode).toMatch(/CREATE TRIGGER trg_apg_session_revoke AFTER UPDATE OF revoked_at, rotated_at ON public\.auth_session/);
    expect(migCode).toMatch(/NEW\.revoked_at IS NOT NULL AND OLD\.revoked_at IS NULL/);
    expect(migCode).toMatch(/NEW\.rotated_at IS NOT NULL AND OLD\.rotated_at IS NULL/);
  });
});

describe('F-03 — hash chỉ qua hàm hẹp', () => {
  it('credential_for_login: chỉ credential ACTIVE (không algo none) của nhân viên ACTIVE; STABLE', () => {
    const f = fn('fn_auth_credential_for_login');
    expect(f).toMatch(/STABLE SECURITY DEFINER/);
    expect(f).toMatch(/c\.status = 'ACTIVE' AND c\.password_algo <> 'none' AND e\.status = 'ACTIVE' AND e\.deleted_at IS NULL/);
  });
  it('GRANTS: cột employee_credential cấp cho auth_rt KHÔNG gồm password_*; không GRANT SELECT cả bảng; REVOKE ALL trước', () => {
    const sel = grants.match(/GRANT SELECT \(([^)]*)\)\s+ON public\.employee_credential TO siscom_auth_rt;/);
    expect(sel).not.toBeNull();
    expect(sel?.[1]).not.toMatch(/password_(hash|algo|params)/);
    expect(grants).not.toMatch(/GRANT SELECT ON (TABLE )?public\.employee_credential/);
    expect(grants).toMatch(/REVOKE ALL ON TABLE public\.employee_credential FROM siscom_auth_rt, siscom_auth;/);
    expect(grants).not.toMatch(/GRANT UPDATE \([^)]*password_/);
  });
});

describe('F-04 — reset_password_v2 chung, không DoS, không dò', () => {
  const f = () => fn('fn_auth_api_reset_password_v2');
  it('chữ ký không nhận danh tính tài khoản; tra theo băm của mã', () => {
    const sig = f().slice(0, f().indexOf(' RETURNS'));
    expect(sig).toMatch(/\(p_token text, p_hash text, p_algo text, p_params jsonb\)/);
    expect(f()).toMatch(/WHERE token_hash = v_hash AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE/);
  });
  it('mọi đường thất bại trả duy nhất INVALID; không có NO_TOKEN/EXPIRED/LOCKED/EMPLOYEE_INACTIVE trong giá trị trả về', () => {
    expect(f()).not.toMatch(/RETURN '(NO_TOKEN|EXPIRED|LOCKED|EMPLOYEE_INACTIVE)'/);
    const returns = f().match(/RETURN '[A-Z]+'/g) ?? [];
    expect(new Set(returns)).toEqual(new Set(["RETURN 'INVALID'", "RETURN 'OK'"]));
  });
  it('mã sai/lạ không có tác dụng phụ (không UPDATE attempts, không thu hồi) — chỉ thu hồi khi mã ĐÚNG hash nhưng hết hạn/nhân viên khóa', () => {
    const body = f();
    expect(body).not.toMatch(/attempts/);
    const beforeLookup = body.slice(0, body.indexOf('SELECT * INTO t'));
    expect(beforeLookup).not.toMatch(/UPDATE/);
    const afterNotFound = body.slice(body.indexOf('IF NOT FOUND THEN RETURN'), body.indexOf('IF NOT FOUND THEN RETURN') + 60);
    expect(afterNotFound).toMatch(/RETURN 'INVALID'/);
    expect(body).toMatch(/p_token !~ '\^\[A-Za-z0-9_-\]\{43,128\}\$'/);
  });
  it('mật khẩu mới bị kiểm (algo none bị chặn) và credential cập nhật kèm token_version + used_at đặt TRƯỚC khi tăng token_version', () => {
    const body = f();
    expect(body).toMatch(/fn_auth_api_check_secret\(p_hash, p_algo, p_params\)/);
    expect(body.indexOf('SET used_at = now()')).toBeGreaterThan(-1);
    expect(body.indexOf('token_version = token_version + 1')).toBeGreaterThan(body.indexOf('SET used_at = now()'));
  });
  it('issue_v2: kiểm định dạng băm mã TRƯỚC khi tiêu thụ grant (không đốt grant vì đầu vào sai)', () => {
    const body = fn('fn_auth_api_reset_token_issue_v2');
    expect(body).toMatch(/p_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(body.indexOf("p_token_hash !~")).toBeLessThan(body.indexOf('fn_auth_priv_actor'));
  });
});

describe('Script role/grant (DRAFT, chưa chạy)', () => {
  it.each([['ROLE_SPLIT', split], ['GRANTS', grants], ['ROLLBACK', rollback], ['DB_TESTS', dbTests]])('%s: ASCII, không bí mật, có guard bản sao thử và tên DB khóa', (_n, s) => {
    expect(s).not.toMatch(/[^\x00-\x7F]/);
    expect(s).not.toMatch(/\bPASSWORD\s+'|ENCRYPTED PASSWORD|postgres:\/\/|DATABASE_URL|JWT_/i);
    expect(s).toContain("'^siscom_crm_(restore|test)_[0-9]{8}_[0-9]{6}$'");
    expect(s).toContain('siscom_crm_restore_20261014_214105');
    expect(s).toContain('siscom_crm_restore_20261015_214948');
  });
  it('ROLE_SPLIT: siscom_auth NOINHERIT, thành viên INHERIT TRUE/SET FALSE, thu siscom_auth_rt khỏi siscom_app, KHÔNG cấp lại', () => {
    expect(split).toMatch(/CREATE ROLE siscom_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT/);
    expect(split).toMatch(/GRANT siscom_auth_rt TO siscom_auth WITH INHERIT TRUE, SET FALSE;/);
    expect(split).toMatch(/REVOKE siscom_auth_rt FROM siscom_app;/);
    expect(stripComments(split)).not.toMatch(/GRANT siscom_auth_rt TO siscom_app/);
    expect(stripComments(split)).not.toMatch(/GRANT siscom_migrator/);
    expect(split).toMatch(/server_version_num/);
  });
  it('GRANTS: khóa 10 hàm cũ với siscom_auth_rt/siscom_app/siscom_auth; hàm mới chỉ cấp cho siscom_auth_rt; không cấp gì cho siscom_app', () => {
    const code = stripComments(grants);
    const revokeLegacy = code.slice(code.indexOf('REVOKE ALL ON FUNCTION'), code.indexOf('FROM PUBLIC, siscom_app, siscom_auth_rt, siscom_auth;') + 60);
    expect((revokeLegacy.match(/public\.fn_auth_api_[a-z_]+\(/g) ?? []).length).toBe(10);
    expect(revokeLegacy).not.toMatch(/_v2\(/);
    const grantLines = code.match(/GRANT [^;]*;/g) ?? [];
    for (const g of grantLines) {
      if (/^GRANT USAGE/.test(g)) continue;
      expect(g).not.toMatch(/\bsiscom_app\b/);
      expect(g).not.toMatch(/\bTO PUBLIC\b/);
    }
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.auth_priv_grant FROM PUBLIC, siscom_app, siscom_auth_rt, siscom_auth;/);
    expect(code).toMatch(/auth_goi_duoc_ham_moi <> 13/);
  });
  it('ROLLBACK: cảnh báo rõ trạng thái không an toàn, chỉ bản sao thử, KHÔNG DROP ROLE/TABLE', () => {
    expect(rollback).toMatch(/KHONG an toan/);
    expect(stripComments(rollback)).not.toMatch(/\bDROP\b/i);
  });
  it('DB_TESTS: kết thúc bằng ROLLBACK (không COMMIT), đủ các nhóm ca âm tính, đủ số phép kiểm', () => {
    const code = stripComments(dbTests);
    expect(code.trim().endsWith('ROLLBACK;')).toBe(true);
    expect(code).not.toMatch(/\bCOMMIT\b/);
    const checks = dbTests.split('\n').filter((l) => /^SELECT pg_temp\.(expect|as)_(ok|err|true|cap)\(/.test(l));
    expect(checks.length).toBeGreaterThanOrEqual(95);
    for (const kw of ['FORGED', 'EXPIRED', 'REPLAY', 'SPOOF p_actor', 'DISABLED CREDENTIAL', 'LEO THANG', 'REVOKED SESSION', 'RESET ABUSE', 'bad bootstrap', 'CROSS-SESSION'])
      expect(dbTests).toContain(kw);
    expect(dbTests).toMatch(/siscom_app/);
    expect(dbTests).toMatch(/siscom_auth/);
  });
});

describe('Không đăng ký mặc định (cổng PR #25 vẫn đóng)', () => {
  const dir = join(BACKEND, 'src', 'common', 'auth', 'privileged');
  it('PrivilegedModule không đăng ký verifier/runner/client/probe giai đoạn 2 (chỉ khi triển khai được duyệt)', () => {
    const m = readFileSync(join(dir, 'privileged.module.ts'), 'utf8');
    expect(m).not.toMatch(/SessionGrantVerifier|AUTH_SQL_RUNNER|PrivilegedApiClient|PasswordResetService|GENERAL_DB_PROBE|AUTH_DB_PROBE|ACTOR_BINDING_VERIFIER/);
  });
  it('mã nguồn giai đoạn 2 không có p_actor, không có provider/verifier giả, không import pg/prisma (không tự mở kết nối)', () => {
    for (const f of ['session-grant.verifier.ts', 'privileged-api.client.ts', 'password-reset.service.ts', 'reset-abuse.policy.ts', 'grant-token.ts']) {
      // Bỏ chú thích // (chú thích được phép nhắc tới p_actor để giải thích vì sao KHÔNG dùng).
      const s = readFileSync(join(dir, f), 'utf8').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
      expect(s).not.toMatch(/p_actor/);
      expect(s).not.toMatch(/from 'pg'|from '@prisma|require\('pg'\)|process\.env|DATABASE_URL/);
      expect(s).not.toMatch(/Fake|Mock|Stub/i);
    }
  });
  it('không thêm migration P2 và không đổi schema.prisma trong PR này', () => {
    expect(existsSync(join(BACKEND, 'prisma', 'migrations', '20261022000000_b1_3_p2_session_bound'))).toBe(false);
    expect(readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8')).not.toMatch(/auth_priv_grant|AuthPrivGrant/);
  });
});
