import { createHash, randomBytes } from 'node:crypto';

// Phiên server-side bằng cookie (thiết kế đã chốt 28/10/2026, Issue #8): token đục 256-bit base64url (43 ký tự) đặt trong cookie
// HttpOnly; DB chỉ lưu SHA-256 hex (auth_session.refresh_hash — tái dùng bảng M1). CSRF token cùng hình dạng, băm vào csrf_hash.
// Hàm thuần: không DB, không log. Không bao giờ in token.
export const SESSION_COOKIE_NAME = 'siscom_sid';
export const SESSION_COOKIE_PATH = '/api/v1';
export const CSRF_HEADER = 'x-csrf-token';
const B64URL_256 = /^[A-Za-z0-9_-]{43}$/;

export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const isOpaqueToken = (v: unknown): v is string => typeof v === 'string' && B64URL_256.test(v);
export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export interface CookieOptions { secure: boolean; maxAgeSeconds: number }

// SameSite=Lax: FE cùng origin qua proxy /api (quyết định C2); kèm kiểm Origin + X-CSRF-Token cho mọi ghi (CsrfOriginGuard).
export function buildSessionCookie(token: string, o: CookieOptions): string {
  if (!isOpaqueToken(token)) throw new Error('SESSION_TOKEN_FORMAT_INVALID');
  const maxAge = Math.max(1, Math.floor(o.maxAgeSeconds));
  return `${SESSION_COOKIE_NAME}=${token}; Path=${SESSION_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${o.secure ? '; Secure' : ''}`;
}
// Cookie CSRF double-submit (PR 4): KHÔNG HttpOnly để FE đọc lại sau khi tải trang; không phải bí mật phiên (cookie phiên vẫn HttpOnly).
// Server chỉ tin header X-CSRF-Token khớp csrf_hash; cookie này chỉ là nơi FE lấy giá trị. Cùng Path/SameSite/Secure/Max-Age với cookie phiên.
export const CSRF_COOKIE_NAME = 'siscom_csrf';
export function buildCsrfCookie(token: string, o: CookieOptions): string {
  if (!isOpaqueToken(token)) throw new Error('CSRF_TOKEN_FORMAT_INVALID');
  const maxAge = Math.max(1, Math.floor(o.maxAgeSeconds));
  return `${CSRF_COOKIE_NAME}=${token}; Path=${SESSION_COOKIE_PATH}; SameSite=Lax; Max-Age=${maxAge}${o.secure ? '; Secure' : ''}`;
}
export function buildCsrfCookieClear(o: Pick<CookieOptions, 'secure'>): string {
  return `${CSRF_COOKIE_NAME}=; Path=${SESSION_COOKIE_PATH}; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${o.secure ? '; Secure' : ''}`;
}
export function buildSessionCookieClear(o: Pick<CookieOptions, 'secure'>): string {
  return `${SESSION_COOKIE_NAME}=; Path=${SESSION_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${o.secure ? '; Secure' : ''}`;
}

// Đọc cookie phiên từ header Cookie (không thêm dependency cookie-parser). Chỉ nhận đúng định dạng token; sai/thiếu/trùng => null.
export function readSessionCookie(cookieHeader: unknown): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0 || cookieHeader.length > 8192) return null;
  let found: string | null = null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE_NAME) continue;
    const v = part.slice(eq + 1).trim();
    if (found !== null) return null; // hai cookie cùng tên => không rõ ràng => từ chối
    found = v;
  }
  return found !== null && isOpaqueToken(found) ? found : null;
}
