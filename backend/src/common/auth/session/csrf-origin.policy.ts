// Chính sách CSRF/Origin (P-A, Sprint PA6). Hàm thuần, offline: KHÔNG controller/route/DI, KHÔNG đọc env/bí mật, KHÔNG DB, KHÔNG log.
// Nguồn: B1.3.1_DETAILED_DESIGN mục 6.4: chỉ /auth/refresh và /auth/logout dùng cookie => chỉ hai route này bị kiểm.
// Điều kiện (1) Origin có và thuộc AUTH_ALLOWED_ORIGINS (thiếu => từ chối); (2) X-CSRF-Token khớp băm gắn phiên, so sánh hằng thời gian.
// Điều kiện (3) SameSite=Strict nằm ở refresh-cookie.policy. Sai => 403 CSRF_FAILED, không đổi trạng thái phiên (việc của lớp gọi).
// Allowlist do NGƯỜI GỌI truyền tường minh; không có mặc định; thiếu/sai cấu hình => từ chối (fail-closed).
// CHƯA CHỐT (đã chọn tối thiểu, cần chủ sở hữu xác nhận): (a) hình dạng CSRF token = 256-bit base64url (43 ký tự) giống refresh token;
// (b) csrf_hash = SHA-256 hex của CHÍNH CHUỖI token (UTF-8) như gửi trong header, không phải byte đã giải mã.
import { createHash, timingSafeEqual } from 'node:crypto';

export const CSRF_FAILED = 'CSRF_FAILED';
export type CsrfProtectedRoute = 'refresh' | 'logout';
export type CsrfFailReason =
  | 'ROUTE_NOT_PROTECTED'
  | 'ORIGIN_CONFIG_INVALID'
  | 'ORIGIN_MISSING'
  | 'ORIGIN_INVALID'
  | 'ORIGIN_NOT_ALLOWED'
  | 'CSRF_HEADER_MISSING'
  | 'CSRF_HEADER_INVALID'
  | 'CSRF_HASH_INVALID'
  | 'CSRF_MISMATCH';
// Kết quả chỉ chứa mã cố định; tuyệt đối không phản chiếu Origin/token/băm.
export type CsrfCheckResult = { ok: true } | { ok: false; code: typeof CSRF_FAILED; reason: CsrfFailReason };

const fail = (reason: CsrfFailReason): CsrfCheckResult => ({ ok: false, code: CSRF_FAILED, reason });

const B64URL_256 = /^[A-Za-z0-9_-]{43}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Trả origin chuẩn của chuỗi nếu chuỗi CHÍNH LÀ một origin (http/https, không path/query/userinfo), ngược lại null. */
function canonicalOrigin(s: string): string | null {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.origin === s ? s : null;
}

export function checkOrigin(originHeader: unknown, allowedOrigins: unknown): CsrfCheckResult {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) return fail('ORIGIN_CONFIG_INVALID');
  const allowed = new Set<string>();
  for (const a of allowedOrigins) {
    const c = typeof a === 'string' ? canonicalOrigin(a) : null;
    if (c === null) return fail('ORIGIN_CONFIG_INVALID'); // một mục hỏng => cả cấu hình hỏng
    allowed.add(c);
  }
  if (originHeader === undefined || originHeader === '') return fail('ORIGIN_MISSING');
  if (typeof originHeader !== 'string') return fail('ORIGIN_INVALID'); // vd. header lặp => mảng
  const o = canonicalOrigin(originHeader);
  if (o === null) return fail('ORIGIN_INVALID'); // gồm "null", file:, có path, sai định dạng
  return allowed.has(o) ? { ok: true } : fail('ORIGIN_NOT_ALLOWED');
}

export function checkCsrfToken(csrfHeader: unknown, storedCsrfHash: unknown): CsrfCheckResult {
  if (typeof storedCsrfHash !== 'string' || !HEX64.test(storedCsrfHash)) return fail('CSRF_HASH_INVALID');
  if (csrfHeader === undefined || csrfHeader === '') return fail('CSRF_HEADER_MISSING');
  if (typeof csrfHeader !== 'string' || !B64URL_256.test(csrfHeader)) return fail('CSRF_HEADER_INVALID');
  const got = createHash('sha256').update(csrfHeader, 'utf8').digest(); // 32 byte
  const want = Buffer.from(storedCsrfHash, 'hex'); // 32 byte (đã kiểm HEX64)
  return got.length === want.length && timingSafeEqual(got, want) ? { ok: true } : fail('CSRF_MISMATCH');
}

export interface CsrfCheckInput {
  readonly route: string;
  readonly originHeader: unknown;
  readonly csrfHeader: unknown;
  readonly allowedOrigins: unknown;
  readonly storedCsrfHash: unknown; // csrf_hash của phiên hiện hành (sau rotate = của hàng con)
}

/** Origin trước, rồi CSRF token. Route ngoài {refresh, logout} => từ chối (chính sách không áp cho route khác). */
export function checkRefreshLogoutCsrf(input: CsrfCheckInput): CsrfCheckResult {
  if (input.route !== 'refresh' && input.route !== 'logout') return fail('ROUTE_NOT_PROTECTED');
  const o = checkOrigin(input.originHeader, input.allowedOrigins);
  if (!o.ok) return o;
  return checkCsrfToken(input.csrfHeader, input.storedCsrfHash);
}
