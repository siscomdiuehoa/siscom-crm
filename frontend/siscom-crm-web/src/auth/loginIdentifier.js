// Kiểm tra hình dạng danh tính đăng nhập phía client (thuần, không I/O). Phản chiếu parseLoginIdentifier của backend (PR #36):
// email HOẶC mã nhân viên /^NV-[0-9]{4,}$/. Chỉ để báo lỗi sớm; backend vẫn là nơi quyết định. Không log, không lưu.
export const LOGIN_MAX_LEN = 254;
export const PASSWORD_MAX_LEN = 1024;
const FORBIDDEN = /[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
const EMPLOYEE_CODE = /^NV-[0-9]{4,}$/;

export function parseLoginIdentifier(input) {
  if (typeof input !== 'string' || input.length > LOGIN_MAX_LEN * 4) return { kind: 'INVALID' };
  const s = input.trim().normalize('NFC');
  if (s.length === 0 || s.length > LOGIN_MAX_LEN || FORBIDDEN.test(s)) return { kind: 'INVALID' };
  const at = s.indexOf('@');
  if (at === -1) return EMPLOYEE_CODE.test(s) ? { kind: 'EMPLOYEE_CODE', value: s } : { kind: 'INVALID' };
  if (at === 0 || at === s.length - 1 || s.indexOf('@', at + 1) !== -1) return { kind: 'INVALID' };
  return { kind: 'EMAIL', value: s };
}

// Mật khẩu KHÔNG được trim/chuẩn hóa. Trả mã lỗi hoặc null.
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length === 0) return 'PASSWORD_REQUIRED';
  if (pw.length > PASSWORD_MAX_LEN) return 'PASSWORD_TOO_LONG';
  return null;
}
