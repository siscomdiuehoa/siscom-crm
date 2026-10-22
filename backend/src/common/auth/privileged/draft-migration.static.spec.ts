import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Kiểm tra TĨNH (chỉ đọc văn bản; không SQL, không DB) bản nháp migration F-01/F-03/F-04 và quy tắc "không tự áp".
const BACKEND = join(__dirname, '..', '..', '..', '..');
const draft = readFileSync(join(BACKEND, 'docs', 'drafts', 'B1.3_F01_F03_F04_DRAFT_MIGRATION.sql.txt'), 'utf8');
const code = draft.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('bản nháp migration F-01/F-03/F-04 (DRAFT, chưa áp)', () => {
  it('nằm trong docs/drafts dưới đuôi .sql.txt, KHÔNG nằm trong prisma/migrations (migrate deploy không nhặt được)', () => {
    expect(draft).toMatch(/DRAFT/);
    expect(existsSync(join(BACKEND, 'prisma', 'migrations'))).toBe(true);
    expect(readdirSync(join(BACKEND, 'prisma', 'migrations')).filter((n) => /f01|f03|f04/i.test(n))).toEqual([]);
  });
  it('chỉ cộng thêm: không DROP/DELETE/TRUNCATE/ALTER/INSERT/GRANT trong phần mã chạy được', () => {
    expect(code).not.toMatch(/\b(DROP|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|INSERT\s+INTO|GRANT)\b/i);
  });
  it('mỗi hàm SECURITY DEFINER có search_path cố định (pg_temp cuối) và bị REVOKE ALL FROM PUBLIC (hàm mới)', () => {
    const defs = code.match(/SECURITY DEFINER/g) ?? [];
    expect(defs.length).toBe(3);
    expect((code.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? []).length).toBe(3);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.fn_auth_session_actor\(uuid, text\) FROM PUBLIC;/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.fn_auth_credential_for_login\(uuid\) FROM PUBLIC;/);
  });
  it('F-04: hàm reset giữ nguyên chữ ký M1.2, mọi đường thất bại trả duy nhất INVALID, không thu hồi mã khi sai', () => {
    const f = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.fn_auth_api_reset_password'));
    expect(f).toMatch(/fn_auth_api_reset_password\(p_employee uuid, p_token text, p_hash text, p_algo text, p_params jsonb\) RETURNS text/);
    expect(f).not.toMatch(/RETURN '(NO_TOKEN|EXPIRED|LOCKED|EMPLOYEE_INACTIVE)'/);
    const mismatch = f.slice(f.indexOf('<> t.token_hash'), f.indexOf('EMPLOYEE_INACTIVE'));
    expect(mismatch).toMatch(/SET attempts = attempts \+ 1 WHERE/);
    expect(mismatch).not.toMatch(/revoked_at/);
  });
  it('F-01: hàm phiên không chạm dữ liệu (STABLE, chỉ SELECT) và so băm SHA-256, không so chuỗi gốc/p_actor', () => {
    const f = code.slice(code.indexOf('fn_auth_session_actor'), code.indexOf('REVOKE ALL ON FUNCTION public.fn_auth_session_actor'));
    expect(f).toMatch(/STABLE/);
    expect(f).toMatch(/sha256\(convert_to\(p_proof/);
    expect(f).not.toMatch(/p_actor/);
  });
});
