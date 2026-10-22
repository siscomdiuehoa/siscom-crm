import { createHash, randomBytes } from 'node:crypto';

// Tiện ích mật mã tĩnh (không chứa khóa/bí mật thật). Tên tệp cố ý KHÔNG chứa "secret" để không bị .gitignore chặn.
// Định dạng khớp hàm SQL: p_grant / p_token ~ '^[A-Za-z0-9_-]{43,128}$'.
export const SECRET_RE = /^[A-Za-z0-9_-]{43,128}$/;
// UUID 8-4-4-4-12 hex, không phân biệt hoa thường (bên gọi tự chuẩn hóa chữ thường).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 256 bit ngẫu nhiên từ CSPRNG của Node => base64url đúng 43 ký tự, không padding.
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

// SHA-256 dạng hex thường 64 ký tự (khớp CHECK grant_hash ~ '^[0-9a-f]{64}$'). Chỉ nhận chuỗi.
export function sha256Hex(value: string): string {
  if (typeof value !== 'string') throw new TypeError('sha256Hex: value must be a string');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
