// Chính sách cookie refresh (P-A, Sprint PA6). Hàm thuần, offline: KHÔNG controller/route/DI, KHÔNG đọc env/bí mật, KHÔNG DB, KHÔNG ký JWT.
// Nguồn: B1.3.1_DETAILED_DESIGN mục 6.3 (hiệu lực theo FINAL_DESIGN mục 6): cookie `siscom_rt`, HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth.
// CHƯA CHỐT (cố ý bỏ, không bịa): Max-Age/Expires của cookie đặt (idle 7 ngày trượt/abs 30 ngày do người gọi quyết định ở lớp sau),
// ý nghĩa của COOKIE_SECURE (ở đây Secure luôn bật), Domain (không bao giờ đặt => cookie host-only).
export const REFRESH_COOKIE_NAME = 'siscom_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

// Refresh token = 256-bit base64url (43 ký tự, không padding) theo mục 6.3.
const B64URL_256 = /^[A-Za-z0-9_-]{43}$/;

const ATTRS = `Path=${REFRESH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict`;

export class RefreshCookiePolicyError extends Error {
  constructor(readonly code: 'COOKIE_OVERRIDE_REJECTED' | 'REFRESH_TOKEN_FORMAT_INVALID') {
    super(code); // thông điệp chỉ là mã; KHÔNG chứa giá trị token
    this.name = 'RefreshCookiePolicyError';
  }
}

// Mọi ghi đè (domain/path/secure/httpOnly/sameSite/name/...) đều bị từ chối: chính sách cố định, không có cấu hình.
function rejectOverrides(overrides: unknown): void {
  if (overrides === undefined) return;
  if (typeof overrides !== 'object' || overrides === null || Object.keys(overrides).length > 0) {
    throw new RefreshCookiePolicyError('COOKIE_OVERRIDE_REJECTED');
  }
}

/** Giá trị Set-Cookie cho refresh token mới. Không Domain; không Max-Age (chưa chốt). */
export function buildRefreshCookie(refreshToken: unknown, overrides?: unknown): string {
  rejectOverrides(overrides);
  if (typeof refreshToken !== 'string' || !B64URL_256.test(refreshToken)) {
    throw new RefreshCookiePolicyError('REFRESH_TOKEN_FORMAT_INVALID');
  }
  return `${REFRESH_COOKIE_NAME}=${refreshToken}; ${ATTRS}`;
}

/** Set-Cookie xóa cookie: phải trùng Name + Path (và không Domain) với cookie đặt, nếu không trình duyệt giữ bản cũ. */
export function buildRefreshCookieClear(overrides?: unknown): string {
  rejectOverrides(overrides);
  return `${REFRESH_COOKIE_NAME}=; ${ATTRS}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
