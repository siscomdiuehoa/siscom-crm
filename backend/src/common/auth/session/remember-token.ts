import { isOpaqueToken, CookieOptions } from './session-token';

// Remember Me 90 ngày (Issue #177, thiết kế docs/B1.4_REMEMBER_ME_90D_DESIGN.md). Hàm thuần: không DB, không log, không in token.
// Token ghi nhớ = token đục 256-bit như token phiên; DB chỉ lưu SHA-256 (remember_device.token_hash). Cookie RIÊNG, không phải siscom_sid.
export const REMEMBER_COOKIE_NAME = 'siscom_rmb';
// Path hẹp nhất vẫn tới được login (thay/huỷ token cũ), restore và logout.
export const REMEMBER_COOKIE_PATH = '/api/v1/auth';
export const REMEMBER_MAX_DAYS = 90;
export const REMEMBER_MAX_DEVICES = 5;
// Hai yêu cầu song song với cùng token: kẻ thua trong cửa sổ này KHÔNG bị coi là replay (không thu hồi, không đổi cookie).
export const REMEMBER_RACE_GRACE_MS = 10_000;
export const REMEMBER_RESTORE_HEADER = 'x-remember-restore';
const MAX_AGE_CAP_SECONDS = REMEMBER_MAX_DAYS * 86_400;

// Mốc tuyệt đối = lần nhập MẬT KHẨU + 90 × 24h tính bằng mili-giây UTC (không dùng lịch/múi giờ ⇒ không lệch giữa UTC và Asia/Ho_Chi_Minh).
export function rememberAbsExpiry(passwordAuthAt: Date): Date {
  const t = passwordAuthAt.getTime();
  if (!Number.isFinite(t)) throw new Error('REMEMBER_TIME_INVALID');
  return new Date(t + MAX_AGE_CAP_SECONDS * 1000);
}

export function buildRememberCookie(token: string, o: CookieOptions): string {
  if (!isOpaqueToken(token)) throw new Error('REMEMBER_TOKEN_FORMAT_INVALID');
  const maxAge = Math.min(MAX_AGE_CAP_SECONDS, Math.max(1, Math.floor(o.maxAgeSeconds)));
  return `${REMEMBER_COOKIE_NAME}=${token}; Path=${REMEMBER_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${o.secure ? '; Secure' : ''}`;
}
export function buildRememberCookieClear(o: Pick<CookieOptions, 'secure'>): string {
  return `${REMEMBER_COOKIE_NAME}=; Path=${REMEMBER_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${o.secure ? '; Secure' : ''}`;
}

// Chỉ nhận đúng MỘT cookie siscom_rmb đúng định dạng; trùng/sai/thiếu => null (không phân biệt để không lộ gì).
export function readRememberCookie(cookieHeader: unknown): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0 || cookieHeader.length > 8192) return null;
  let found: string | null = null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REMEMBER_COOKIE_NAME) continue;
    if (found !== null) return null;
    found = part.slice(eq + 1).trim();
  }
  return found !== null && isOpaqueToken(found) ? found : null;
}

export type RememberFailure = 'INVALID' | 'RACE' | 'REPLAY';
export interface RememberRowState { revokedAt: Date | null; rotatedAt: Date | null; absExpiresAt: Date }

// Gọi SAU KHI compare-and-set (rotated_at IS NULL AND revoked_at IS NULL AND abs_expires_at > now) thua. Mặc định fail-closed (INVALID).
export function classifyRememberFailure(row: RememberRowState | null, now: Date): RememberFailure {
  if (row === null) return 'INVALID';
  if (row.revokedAt !== null) return 'INVALID';
  if (row.absExpiresAt.getTime() <= now.getTime()) return 'INVALID';
  if (row.rotatedAt === null) return 'INVALID';
  return Math.abs(now.getTime() - row.rotatedAt.getTime()) <= REMEMBER_RACE_GRACE_MS ? 'RACE' : 'REPLAY';
}
