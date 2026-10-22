import { DomainException } from '../../errors/domain.exception';
import { MAX_LOGIN_LEN, MAX_PASSWORD_LEN } from '../login/password-login.service';

// Hợp đồng HTTP xác thực (Sprint A4, chỉ mã nguồn, offline). CHƯA gắn route/module; không nhận token qua query.
//   POST login : body JSON CHÍNH XÁC { login: string, password: string }  -> 200 { token, expiresAt(ISO) } | 400 REQUEST_INVALID | 401 LOGIN_INVALID
//   POST logout: header Authorization: Bearer sid_<43>                    -> 200 { ok: true }             | 401 AUTH_REQUIRED | 503 AUTH_UNAVAILABLE
//   GET  me    : header Authorization: Bearer sid_<43>                    -> 200 { employeeId }           | 401 AUTH_REQUIRED
export const LOGIN_BODY_KEYS: readonly string[] = ['login', 'password'];
export const MAX_AUTH_HEADER_LEN = 128;
// Scheme không phân biệt hoa thường (RFC 7235), đúng một khoảng trắng, token đúng định dạng sid_ + 43 ký tự base64url.
const BEARER_RE = /^bearer (sid_[A-Za-z0-9_-]{43})$/i;
// Danh tính chỉ đến từ phiên phía server: mọi header cố tình mang danh tính bị từ chối.
const SPOOF_HEADER_RE = /^x-(actor|employee|user|auth|impersonat|forwarded-user|remote-user)/;

export type HeaderBag = Record<string, string | string[] | undefined>;

export const requestInvalid = (): DomainException =>
  new DomainException(400, 'REQUEST_INVALID', 'Yêu cầu không hợp lệ.');
export const authRequired = (): DomainException =>
  new DomainException(401, 'AUTH_REQUIRED', 'Cần đăng nhập hợp lệ.');
export const authUnavailable = (): DomainException =>
  new DomainException(503, 'AUTH_UNAVAILABLE', 'Dịch vụ xác thực tạm thời không khả dụng.');

export function rejectSpoofHeaders(headers: HeaderBag | undefined): void {
  if (headers === null || typeof headers !== 'object') return;
  for (const name of Object.keys(headers)) if (SPOOF_HEADER_RE.test(name.toLowerCase())) throw requestInvalid();
}

export function parseLoginBody(body: unknown): { login: string; password: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw requestInvalid();
  const keys = Object.keys(body);
  if (keys.length !== LOGIN_BODY_KEYS.length || keys.some((k) => !LOGIN_BODY_KEYS.includes(k))) throw requestInvalid();
  const { login, password } = body as Record<string, unknown>;
  if (typeof login !== 'string' || typeof password !== 'string') throw requestInvalid();
  if (login.length === 0 || login.length > MAX_LOGIN_LEN || password.length === 0 || password.length > MAX_PASSWORD_LEN) throw requestInvalid();
  return { login, password };
}

// Trả token hoặc ném 401 chung; không phân biệt thiếu/sai scheme/sai định dạng/quá dài.
export function parseBearer(header: unknown): string {
  if (typeof header !== 'string' || header.length === 0 || header.length > MAX_AUTH_HEADER_LEN) throw authRequired();
  const m = BEARER_RE.exec(header);
  if (m === null) throw authRequired();
  return m[1];
}
