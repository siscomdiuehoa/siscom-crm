// Chính sách mật khẩu D17 (PR 8) — bản FE THUẦN, cùng quy tắc + thông điệp với backend/src/common/auth/login/password-policy.ts.
// Kiểm đối chiếu bằng vector của backend (tests/changePassword.test.mjs). Máy chủ vẫn là nơi quyết định; đây chỉ để báo sớm + thanh độ mạnh.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const COMMON_PASSWORDS = [
  'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'matkhau', 'mat khau', 'qwerty', 'qwertyuiop', 'azerty', '123456', '12345678', '123456789',
  '1234567890', '111111', '000000', '654321', 'abcdef', 'abc123', 'letmein', 'welcome', 'admin', 'admin123', 'administrator', 'iloveyou',
  'dragon', 'monkey', 'football', 'baseball', 'master', 'sunshine', 'princess', 'trustno1', 'changeme', 'secret', 'login',
  'siscom', 'siscomcrm', 'crm',
];
export const POLICY_MESSAGES = {
  length: 'Mật khẩu phải có từ 12 đến 128 ký tự',
  whitespace: 'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng',
  classes: 'Mật khẩu cần ít nhất 3 trong 4 nhóm: chữ thường, chữ HOA, chữ số, ký tự đặc biệt',
  identifier: 'Mật khẩu không được chứa email hoặc mã nhân viên',
  repeat: 'Mật khẩu không được lặp một ký tự quá 3 lần liên tiếp',
  common: 'Mật khẩu quá phổ biến, hãy chọn mật khẩu khác',
};

const MIN_IDENT = 4;
function classCount(pw) {
  let n = 0;
  if (/\p{Ll}/u.test(pw)) n++;
  if (/\p{Lu}/u.test(pw)) n++;
  if (/\p{Nd}/u.test(pw)) n++;
  if (/[^\p{L}\p{Nd}]/u.test(pw)) n++;
  return n;
}
function identifiers(ctx) {
  const out = [];
  const email = typeof ctx.email === 'string' ? ctx.email.trim().toLowerCase() : '';
  const local = email.includes('@') ? email.slice(0, email.indexOf('@')) : email;
  if (local.length >= MIN_IDENT) out.push(local);
  const code = typeof ctx.code === 'string' ? ctx.code.trim().toLowerCase() : '';
  if (code.length >= MIN_IDENT) out.push(code);
  return out;
}
function isCommon(pw) {
  const low = pw.toLowerCase();
  return COMMON_PASSWORDS.some((c) => low === c || (low.startsWith(c) && /^[0-9]+$/.test(low.slice(c.length))));
}

// Danh sách thông điệp vi phạm (rỗng = đạt). Không bao giờ chứa mật khẩu.
export function checkPasswordPolicy(password, ctx = {}) {
  if (typeof password !== 'string') return [POLICY_MESSAGES.length];
  const problems = [];
  const len = [...password].length;
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) problems.push(POLICY_MESSAGES.length);
  if (/^\s|\s$/u.test(password)) problems.push(POLICY_MESSAGES.whitespace);
  if (classCount(password) < 3) problems.push(POLICY_MESSAGES.classes);
  const low = password.toLowerCase();
  if (identifiers(ctx || {}).some((id) => low.includes(id))) problems.push(POLICY_MESSAGES.identifier);
  if (/(.)\1{3,}/u.test(password)) problems.push(POLICY_MESSAGES.repeat);
  if (isCommon(password)) problems.push(POLICY_MESSAGES.common);
  return problems;
}

// 0 quá ngắn; 1 vi phạm; 2 đạt (3 nhóm); 3 đạt + (4 nhóm hoặc >= 16); 4 đạt + 4 nhóm + >= 16.
export function passwordStrength(password, ctx = {}) {
  if (typeof password !== 'string') return 0;
  const len = [...password].length;
  if (len < PASSWORD_MIN) return 0;
  if (checkPasswordPolicy(password, ctx).length > 0) return 1;
  const four = classCount(password) === 4; const long = len >= 16;
  if (four && long) return 4;
  if (four || long) return 3;
  return 2;
}
