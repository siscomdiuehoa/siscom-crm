// Chính sách mật khẩu D17 (B1.3.3, PR 8) — hàm THUẦN, không log, không bí mật. Cùng quy tắc + thông điệp với
// frontend/siscom-crm-web/src/auth/passwordPolicy.js; cả hai được kiểm bằng password-policy.vectors.json.
//   1. 12–128 ký tự (đếm code point Unicode); không khoảng trắng đầu/cuối.
//   2. Ít nhất 3 trong 4 nhóm: chữ thường, chữ HOA, chữ số, ký tự khác.
//   3. Không chứa phần trước "@" của email đăng nhập hoặc mã nhân viên (>= 4 ký tự, không phân biệt hoa/thường).
//   4. Không lặp một ký tự > 3 lần liên tiếp; không là mật khẩu phổ biến (danh sách ngắn; khớp nguyên chuỗi, cho phép đuôi chữ số).
//   (Quy tắc "khác mật khẩu hiện tại" cần Argon2 => kiểm ở AuthService, không ở đây.)
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const COMMON_PASSWORDS: readonly string[] = [
  'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'matkhau', 'mat khau', 'qwerty', 'qwertyuiop', 'azerty', '123456', '12345678', '123456789',
  '1234567890', '111111', '000000', '654321', 'abcdef', 'abc123', 'letmein', 'welcome', 'admin', 'admin123', 'administrator', 'iloveyou',
  'dragon', 'monkey', 'football', 'baseball', 'master', 'sunshine', 'princess', 'trustno1', 'changeme', 'secret', 'login',
  'siscom', 'siscomcrm', 'crm', // tên công ty/sản phẩm (spec §3.4): khớp nguyên chuỗi hoặc + đuôi số (siscom2026); "Tên@số" vẫn đạt
];
export const POLICY_MESSAGES = {
  length: 'Mật khẩu phải có từ 12 đến 128 ký tự',
  whitespace: 'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng',
  classes: 'Mật khẩu cần ít nhất 3 trong 4 nhóm: chữ thường, chữ HOA, chữ số, ký tự đặc biệt',
  identifier: 'Mật khẩu không được chứa email hoặc mã nhân viên',
  repeat: 'Mật khẩu không được lặp một ký tự quá 3 lần liên tiếp',
  common: 'Mật khẩu quá phổ biến, hãy chọn mật khẩu khác',
} as const;

export interface PolicyContext { email?: string | null; code?: string | null }

const MIN_IDENT = 4;
function classCount(pw: string): number {
  let n = 0;
  if (/\p{Ll}/u.test(pw)) n++;
  if (/\p{Lu}/u.test(pw)) n++;
  if (/\p{Nd}/u.test(pw)) n++;
  if (/[^\p{L}\p{Nd}]/u.test(pw)) n++;
  return n;
}
function identifiers(ctx: PolicyContext): string[] {
  const out: string[] = [];
  const email = typeof ctx.email === 'string' ? ctx.email.trim().toLowerCase() : '';
  const local = email.includes('@') ? email.slice(0, email.indexOf('@')) : email;
  if (local.length >= MIN_IDENT) out.push(local);
  const code = typeof ctx.code === 'string' ? ctx.code.trim().toLowerCase() : '';
  if (code.length >= MIN_IDENT) out.push(code);
  return out;
}
function isCommon(pw: string): boolean {
  const low = pw.toLowerCase();
  return COMMON_PASSWORDS.some((c) => low === c || (low.startsWith(c) && /^[0-9]+$/.test(low.slice(c.length))));
}

// Trả về danh sách thông điệp vi phạm (rỗng = đạt). Không bao giờ chứa mật khẩu.
export function checkPasswordPolicy(password: string, ctx: PolicyContext = {}): string[] {
  if (typeof password !== 'string') return [POLICY_MESSAGES.length];
  const problems: string[] = [];
  const len = [...password].length;
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) problems.push(POLICY_MESSAGES.length);
  if (/^\s|\s$/u.test(password)) problems.push(POLICY_MESSAGES.whitespace);
  if (classCount(password) < 3) problems.push(POLICY_MESSAGES.classes);
  const low = password.toLowerCase();
  if (identifiers(ctx).some((id) => low.includes(id))) problems.push(POLICY_MESSAGES.identifier);
  if (/(.)\1{3,}/u.test(password)) problems.push(POLICY_MESSAGES.repeat);
  if (isCommon(password)) problems.push(POLICY_MESSAGES.common);
  return problems;
}

// 0 = quá ngắn; 1 = vi phạm chính sách; 2 = đạt (3 nhóm); 3 = đạt + (4 nhóm hoặc >= 16); 4 = đạt + 4 nhóm + >= 16. Chỉ để gợi ý trên giao diện.
export function passwordStrength(password: string, ctx: PolicyContext = {}): 0 | 1 | 2 | 3 | 4 {
  if (typeof password !== 'string') return 0;
  const len = [...password].length;
  if (len < PASSWORD_MIN) return 0;
  if (checkPasswordPolicy(password, ctx).length > 0) return 1;
  const four = classCount(password) === 4; const long = len >= 16;
  if (four && long) return 4;
  if (four || long) return 3;
  return 2;
}
