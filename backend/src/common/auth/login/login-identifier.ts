// Bộ phân tích danh tính đăng nhập (thuần, không I/O): email công ty HOẶC mã nhân viên.
// Chỉ phân loại + chuẩn hóa hình dạng; KHÔNG tra DB, KHÔNG quyết định trạng thái tài khoản (ON_LEAVE, email tùy chọn, xác minh email…).
//
// Hợp đồng:
// - Đầu vào không phải chuỗi => INVALID (không ép kiểu).
// - Cắt khoảng trắng hai đầu, rồi chuẩn hóa Unicode NFC (không NFKC: không biến "＠" thành "@").
// - Từ chối khoảng trắng/ký tự điều khiển (Cc), ký tự định dạng (Cf: zero-width, bidi, BOM), dấu phân dòng/đoạn (Zl/Zp), surrogate lẻ (Cs).
// - Có "@" => phải là email: đúng một "@", phần cục bộ và phần miền không rỗng.
// - Không có "@" => phải khớp CHÍNH XÁC /^NV-[0-9]{4,}$/ (CHECK của PostgreSQL trên employee.code); không tự viết hoa.
// - Email GIỮ NGUYÊN chữ hoa/thường: DB so khớp bằng lower(email)=lower($1) ở cả hai vế (chỉ mục uq_employee_email_active),
//   nên lower() phía JS có thể lệch với lower() của PostgreSQL ở ký tự ngoài ASCII. Không xử lý Gmail (dấu chấm/+tag).
// - Mọi lý do từ chối cho cùng một kết quả INVALID (không lộ lý do, tránh dò tài khoản). Không log, không giữ đầu vào thô.
export const LOGIN_IDENTIFIER_MAX_LENGTH = 254;

export type ParsedLoginIdentifier =
  | { readonly kind: 'EMAIL'; readonly value: string }
  | { readonly kind: 'EMPLOYEE_CODE'; readonly value: string }
  | { readonly kind: 'INVALID' };

const INVALID: ParsedLoginIdentifier = Object.freeze({ kind: 'INVALID' as const });

const FORBIDDEN_CHARS_RE = /[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
const EMPLOYEE_CODE_RE = /^NV-[0-9]{4,}$/;

export const parseLoginIdentifier = (input: unknown): ParsedLoginIdentifier => {
  if (typeof input !== 'string') return INVALID;
  // Chặn sớm trước khi trim/NFC để chuỗi rất dài không tốn CPU.
  if (input.length > LOGIN_IDENTIFIER_MAX_LENGTH * 4) return INVALID;
  const s = input.trim().normalize('NFC');
  if (s.length === 0 || s.length > LOGIN_IDENTIFIER_MAX_LENGTH) return INVALID;
  if (FORBIDDEN_CHARS_RE.test(s)) return INVALID;

  const at = s.indexOf('@');
  if (at === -1) return EMPLOYEE_CODE_RE.test(s) ? { kind: 'EMPLOYEE_CODE', value: s } : INVALID;
  if (at === 0 || at === s.length - 1 || s.indexOf('@', at + 1) !== -1) return INVALID;
  return { kind: 'EMAIL', value: s };
};
