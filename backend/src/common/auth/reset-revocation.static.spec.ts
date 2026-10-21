import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// B1.3 M1.3 — kiểm tra TĨNH (chỉ đọc văn bản, KHÔNG chạy SQL, không database) các bất biến của cơ chế thu hồi mã reset.
// Không thay thế test hành vi trên PostgreSQL (docs/B1.3_M1_3_STRUCTURE_TESTS.sql.txt, chờ duyệt chạy trên bản sao thử).
const BACKEND = join(__dirname, '..', '..', '..');
const MIG = join(BACKEND, 'prisma', 'migrations');
const read = (rel: string) => readFileSync(join(BACKEND, rel), 'utf8');
const dir = (prefix: string) => readdirSync(MIG).find((n) => n.startsWith(prefix));
const m13 = read(join('prisma', 'migrations', dir('20261021000000') as string, 'migration.sql'));
const m12 = read(join('prisma', 'migrations', dir('20261020180000') as string, 'migration.sql'));
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const sql13 = code(m13);

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('END $$;', start);
  return sql.slice(start, end);
}

describe('M1.3 thu hồi mã reset khi token_version tăng (kiểm tra tĩnh)', () => {
  it('migration M1.3 tồn tại, đúng một thư mục, chỉ cộng thêm 1 hàm + 1 trigger', () => {
    expect(readdirSync(MIG).filter((n) => n.startsWith('20261021000000'))).toHaveLength(1);
    expect(sql13.match(/CREATE (OR REPLACE )?FUNCTION/g)).toHaveLength(1);
    expect(sql13.match(/CREATE TRIGGER/g)).toHaveLength(1);
    expect(sql13).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER TABLE|INSERT)\b/i);
    expect(sql13).not.toMatch(/CREATE OR REPLACE/i);
  });
  it('kiểm tra tiền điều kiện M1.2 trước khi tạo đối tượng', () => {
    expect(sql13.indexOf('RAISE EXCEPTION')).toBeGreaterThan(-1);
    expect(sql13.indexOf('RAISE EXCEPTION')).toBeLessThan(sql13.indexOf('CREATE FUNCTION'));
  });
  it('hàm SECURITY DEFINER có search_path cố định, thu hồi quyền PUBLIC', () => {
    const f = fnBody(sql13, 'fn_cred_revoke_reset_tokens');
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(sql13).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
    expect(sql13).toMatch(/REVOKE ALL ON FUNCTION public\.fn_cred_revoke_reset_tokens\(\) FROM PUBLIC;/);
  });
  it('chỉ thu hồi mã CHƯA dùng và CHƯA thu hồi, đúng nhân viên bị đổi, không xóa dữ liệu', () => {
    const f = fnBody(sql13, 'fn_cred_revoke_reset_tokens');
    expect(f).toMatch(/UPDATE public\.password_reset_token SET revoked_at = now\(\)/);
    expect(f).toMatch(/WHERE employee_id = NEW\.employee_id AND used_at IS NULL AND revoked_at IS NULL/);
    expect(f).not.toMatch(/\bDELETE\b/i);
  });
  it('trigger: AFTER UPDATE OF token_version, mỗi dòng, chỉ khi token_version TĂNG', () => {
    expect(sql13).toMatch(/CREATE TRIGGER trg_cred_revoke_reset_tokens AFTER UPDATE OF token_version ON employee_credential FOR EACH ROW\s+WHEN \(NEW\.token_version > OLD\.token_version\) EXECUTE FUNCTION public\.fn_cred_revoke_reset_tokens\(\);/);
  });
  it('luồng reset hợp lệ (M1.2): đánh dấu used_at TRƯỚC khi tăng token_version; không có đường tăng token_version trước used_at', () => {
    const f = fnBody(m12, 'fn_auth_api_reset_password');
    const used = f.indexOf('SET used_at = now()');
    const bump = f.indexOf('token_version = token_version + 1');
    expect(used).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(used);
  });
  it('tăng token_version ở M1.2 luôn kèm trigger thu hồi phiên; M1.3 không đổi hàm nào của M1.2', () => {
    expect(m12).toMatch(/fn_cred_revoke_sessions/);
    expect(sql13).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.(fn_auth_api_|fn_cred_revoke_sessions)/);
  });
  it('rollback và kiểm cấu trúc đã viết sẵn (.sql.txt, không phải .sql chạy được)', () => {
    const rb = read(join('docs', 'B1.3_M1_3_ROLLBACK.sql.txt'));
    expect(rb).toMatch(/DROP TRIGGER IF EXISTS trg_cred_revoke_reset_tokens/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.fn_cred_revoke_reset_tokens\(\)/);
    expect(read(join('docs', 'B1.3_M1_3_STRUCTURE_TESTS.sql.txt'))).toMatch(/trg_cred_revoke_reset_tokens/);
  });
});
