// Guard THUẦN cho đích database thử (F-03, NHÁP). Không import gì, không đọc process.env, không kết nối DB, không Prisma.
// Mặc định từ chối: mọi đầu vào thiếu/sai kiểu/không khớp đúng một hồ sơ (profile) đều bị từ chối. Lý do chỉ gồm mã cố định, KHÔNG phản chiếu URL/mật khẩu/tên role.
// Giữ cú pháp "erasable" (không enum/namespace) để node --test chạy được trực tiếp file .ts này.

export type TestDbProfile = 'legacy-shared-app' | 'disposable';
export interface TestDbReason { code: string; message: string }
export interface TestDbVerdict { ok: boolean; name: string | null; reasons: TestDbReason[] }

const STAMP = '\\d{8}_\\d{6}';
const LOOPBACK_HOST = '127.0.0.1';
const SHARED_CLUSTER_PORT = 5432;
// Database cấm tuyệt đối với mọi hồ sơ: dev, baseline đã khóa (docs/PROGRESS_B1.2.3-B2.md), và DB hệ thống. Đồng bộ với scripts/guards/forbidden-db.mjs (khóa bằng scripts/guards/forbidden-db.test.mjs; file này cố ý không import).
export const FORBIDDEN_DB_NAMES: readonly string[] = [
  'siscom_crm_dev',
  'siscom_crm_restore_20261014_214105',
  'siscom_crm_restore_20261015_214948',
  'postgres',
  'template0',
  'template1',
  'siscom_app',
  'siscom_crm',
  'siscom_crm_prod',
  'siscom_crm_production',
];
const RESERVED_ROLES: readonly string[] = ['siscom_app', 'postgres'];

// legacy-shared-app: luồng hiện hữu run-customers-tests.ps1 (siscom_app@127.0.0.1:5432, DB bản sao restore/test). Chỉ giữ để tương thích, đã siết thêm.
const LEGACY_DB_RE = new RegExp('^siscom_crm_(restore|test)_' + STAMP + '$');
// disposable: cụm PG cô lập (F-02): DB siscom_crm_test_<stamp>, role siscom_t_(app|owner)_<stamp> cùng stamp, cổng khác 5432.
const DISPOSABLE_DB_RE = new RegExp('^siscom_crm_test_(' + STAMP + ')$');
const DISPOSABLE_ROLE_RE = new RegExp('^siscom_t_(?:app|owner)_(' + STAMP + ')$');

export function evaluateTestDatabaseTarget(url: unknown, profile: unknown): TestDbVerdict {
  const reasons: TestDbReason[] = [];
  const deny = (code: string, message: string): TestDbVerdict => {
    reasons.push({ code, message });
    return { ok: false, name: null, reasons };
  };
  if (profile !== 'legacy-shared-app' && profile !== 'disposable') return deny('PROFILE_INVALID', 'Hồ sơ đích không hợp lệ.');
  if (typeof url !== 'string' || url.length === 0) return deny('URL_MISSING', 'Thiếu URL database thử.');
  let u: URL;
  try { u = new URL(url); } catch { return deny('URL_INVALID', 'URL database thử không hợp lệ.'); }
  if (u.protocol !== 'postgresql:') return deny('PROTOCOL_NOT_ALLOWED', 'Giao thức phải là postgresql://.');
  // Tham số truy vấn có thể ghi đè host/port/dbname/options của driver → cấm hoàn toàn.
  if (u.search !== '' || u.hash !== '' || url.includes('?') || url.includes('#')) return deny('QUERY_NOT_ALLOWED', 'URL không được chứa query hoặc fragment.');
  if (u.hostname !== LOOPBACK_HOST) return deny('HOST_NOT_ALLOWED', 'Host phải là 127.0.0.1.');

  let name: string;
  let user: string;
  try {
    name = decodeURIComponent(u.pathname.replace(/^\//, ''));
    user = decodeURIComponent(u.username);
  } catch { return deny('URL_INVALID', 'URL database thử không hợp lệ.'); }
  if (name.includes('/')) return deny('DB_NAME_INVALID', 'Tên database không hợp lệ.');
  if (FORBIDDEN_DB_NAMES.includes(name.trim().toLowerCase())) return deny('DB_FORBIDDEN', 'Database nằm trong danh sách cấm (dev/baseline/hệ thống).');

  const port = u.port === '' ? SHARED_CLUSTER_PORT : Number(u.port);
  if (profile === 'legacy-shared-app') {
    if (!LEGACY_DB_RE.test(name)) return deny('DB_NAME_NOT_TEST', 'Tên database không phải siscom_crm_restore_* / siscom_crm_test_*.');
    if (user !== 'siscom_app') return deny('ROLE_NOT_ALLOWED', 'Hồ sơ legacy yêu cầu tài khoản siscom_app.');
    if (port !== SHARED_CLUSTER_PORT) return deny('PORT_NOT_ALLOWED', 'Hồ sơ legacy yêu cầu cổng 5432.');
    return { ok: true, name, reasons };
  }
  // disposable
  const dm = DISPOSABLE_DB_RE.exec(name);
  if (!dm) return deny('DB_NAME_NOT_DISPOSABLE', 'Tên database phải là siscom_crm_test_<stamp>.');
  if (RESERVED_ROLES.includes(user)) return deny('ROLE_RESERVED', 'Không dùng role dùng chung/hệ thống cho DB cô lập.');
  const rm = DISPOSABLE_ROLE_RE.exec(user);
  if (!rm) return deny('ROLE_NOT_DISPOSABLE', 'Role phải là siscom_t_app_<stamp> hoặc siscom_t_owner_<stamp>.');
  if (rm[1] !== dm[1]) return deny('STAMP_MISMATCH', 'Stamp của role và database không khớp.');
  if (u.port === '' || !Number.isInteger(port) || port < 1024 || port > 65535) return deny('PORT_NOT_DECLARED', 'DB cô lập phải khai báo cổng rõ ràng (1024-65535).');
  if (port === SHARED_CLUSTER_PORT) return deny('PORT_SHARED_CLUSTER', 'Cổng 5432 là cụm dùng chung; DB cô lập không được dùng.');
  return { ok: true, name, reasons };
}

export interface TestEnvLike { [key: string]: string | undefined }

/**
 * Đọc đích thử từ env được TIÊM (không đụng process.env). Luôn xóa DATABASE_URL khỏi env tiêm; từ chối nếu TEST_DATABASE_URL trùng DATABASE_URL.
 * Ném Error với mã cố định khi từ chối; không bao giờ chứa URL.
 */
export function resolveTestDatabase(env: TestEnvLike, profile: TestDbProfile): { url: string; name: string } {
  if (env === null || typeof env !== 'object') throw new Error('Từ chối [ENV_NOT_PROVIDED]: thiếu env.');
  // PG* (PGHOST, PGDATABASE, PGSERVICE, PGOPTIONS, …) có thể đổi đích kết nối ngầm. Từ chối thay vì tự xóa/đoán; undefined coi như không đặt. Thông điệp cố định, không nêu giá trị.
  if (Object.keys(env).some((k) => /^PG/i.test(k) && env[k] !== undefined)) throw new Error('Từ chối [ENV_PG_REDIRECT]: env chứa biến PG* có thể đổi đích kết nối; bỏ biến đó khỏi env tiêm.');
  const devUrl = env.DATABASE_URL;
  delete env.DATABASE_URL;
  const url = env.TEST_DATABASE_URL;
  if (devUrl !== undefined && devUrl === url) throw new Error('Từ chối [SAME_AS_DATABASE_URL]: TEST_DATABASE_URL trùng DATABASE_URL.');
  const v = evaluateTestDatabaseTarget(url, profile);
  if (!v.ok || v.name === null || typeof url !== 'string') {
    throw new Error('Từ chối [' + v.reasons.map((r) => r.code).join(',') + ']: ' + v.reasons.map((r) => r.message).join(' '));
  }
  return { url, name: v.name };
}
