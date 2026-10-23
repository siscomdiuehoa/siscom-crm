// Mô hình view THUẦN cho màn hình đăng nhập (không React, không DOM) — kiểm thử được bằng node --test.
// - Cờ giao diện đăng nhập MẶC ĐỊNH TẮT (VITE_CRM_LOGIN_UI_ENABLED === 'true' mới bật). Cờ này chỉ hiện giao diện;
//   đăng nhập thật vẫn phụ thuộc bộ điều khiển headless (UNAVAILABLE khi VITE_CRM_AUTH_ENABLED tắt).
// - Không đọc/ghi storage, không giữ token; mật khẩu chỉ nằm trong state của component và bị xóa sau mỗi lần gửi.
// - Không có đường lui sang demo/đăng nhập giả: UNAVAILABLE => nút gửi bị vô hiệu, không gọi session.submit.
// - Thông báo kiểm tra hình dạng (email / mã NV) chỉ phản chiếu quy tắc đã có ở loginIdentifier.js (PR #36/#38); không thêm quy tắc backend.
import { parseLoginIdentifier, validatePassword, LOGIN_MAX_LEN } from './loginIdentifier.js';
import { LOGIN_ERRORS } from './loginSession.js';
import { LOGIN_PREVIEW_ERROR, LOGIN_PREVIEW_UNAVAILABLE_TEXT } from './loginPreview.js';

export const LOGIN_UI_TEXT = {
  title: 'Đăng nhập',
  identifierLabel: 'Email hoặc mã nhân viên',
  passwordLabel: 'Mật khẩu',
  submit: 'Đăng nhập',
  unavailable: 'Đăng nhập chưa khả dụng: máy chủ xác thực chưa được bật.',
  showPassword: 'Hiện mật khẩu',
  hidePassword: 'Ẩn mật khẩu',
};

// Thông báo lỗi trường chi tiết hơn LOGIN_ERRORS.IDENTIFIER_INVALID (giữ nguyên hằng này cho bộ điều khiển headless).
export const IDENTIFIER_ERRORS = {
  REQUIRED: 'Vui lòng nhập email hoặc mã nhân viên.',
  TOO_LONG: `Email hoặc mã nhân viên quá dài (tối đa ${LOGIN_MAX_LEN} ký tự).`,
  HAS_SPACE: 'Email hoặc mã nhân viên không được chứa khoảng trắng hay ký tự điều khiển.',
  EMAIL_FORMAT: 'Email không hợp lệ. Ví dụ: ten@congty.vn.',
  EMPLOYEE_CODE_FORMAT: 'Mã nhân viên không hợp lệ. Định dạng: NV- theo sau là ít nhất 4 chữ số, ví dụ NV-0001.',
};

// Trả thông báo (tiếng Việt) cho danh tính sai hình dạng, hoặc null nếu hợp lệ. Chỉ để báo lỗi sớm.
export function describeIdentifierProblem(input) {
  if (parseLoginIdentifier(input).kind !== 'INVALID') return null;
  if (typeof input !== 'string') return IDENTIFIER_ERRORS.REQUIRED;
  const s = input.trim();
  if (s.length === 0) return IDENTIFIER_ERRORS.REQUIRED;
  if (s.length > LOGIN_MAX_LEN) return IDENTIFIER_ERRORS.TOO_LONG;
  if (/[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(s)) return IDENTIFIER_ERRORS.HAS_SPACE;
  return s.includes('@') ? IDENTIFIER_ERRORS.EMAIL_FORMAT : IDENTIFIER_ERRORS.EMPLOYEE_CODE_FORMAT;
}

export function readLoginUiFlag(env) {
  return !!env && env.VITE_CRM_LOGIN_UI_ENABLED === 'true';
}

// Phân loại banner để giao diện chọn ngữ nghĩa (không đổi nội dung thông báo).
const BANNER_KIND = {
  INVALID_CREDENTIALS: 'credentials', // 401
  SESSION_EXPIRED: 'credentials', // 401 không phải LOGIN_INVALID (theo classifyAuthError hiện có)
  RATE_LIMITED: 'rate-limited', // 429
  NETWORK: 'network',
  SERVICE_UNAVAILABLE: 'unavailable', // 5xx
  [LOGIN_PREVIEW_ERROR]: 'unavailable',
};

// touched: { identifier: boolean, password: boolean } — chỉ báo lỗi trường sau khi người dùng đã chạm/gửi.
export function deriveLoginView({ status, error, identifier = '', password = '', touched = {} }) {
  const unavailable = status === 'UNAVAILABLE';
  const loading = status === 'LOADING';
  const authenticated = status === 'AUTHENTICATED';
  const idMsg = describeIdentifierProblem(identifier);
  const pwErr = validatePassword(password);
  const identifierError = touched.identifier && idMsg ? idMsg : null;
  const passwordError = touched.password && pwErr ? LOGIN_ERRORS[pwErr] : null;
  const fieldCovered = error === 'IDENTIFIER_INVALID' || error === 'PASSWORD_REQUIRED' || error === 'PASSWORD_TOO_LONG';
  const hasBanner = status === 'ERROR' && error && !fieldCovered;
  const blocked = unavailable || loading || authenticated;
  return {
    unavailable,
    loading,
    authenticated,
    inputsDisabled: blocked,
    // submitDisabled: giữ nguyên nghĩa cũ (gồm cả dữ liệu chưa hợp lệ).
    submitDisabled: blocked || !!idMsg || !!pwErr,
    // submitBlocked: chỉ chặn theo trạng thái. Nút gửi KHÔNG bị vô hiệu vì dữ liệu sai, để Enter/click vẫn
    // kích hoạt kiểm tra, hiện lỗi và đưa focus về trường lỗi đầu tiên (nút disabled sẽ chặn Enter một cách im lặng).
    submitBlocked: blocked,
    firstInvalid: idMsg ? 'identifier' : pwErr ? 'password' : null,
    identifierError,
    passwordError,
    notice: unavailable ? LOGIN_UI_TEXT.unavailable : null,
    // Lỗi do máy chủ/mạng (không trùng lỗi trường) hiển thị thành banner.
    bannerError: hasBanner ? (error === LOGIN_PREVIEW_ERROR ? LOGIN_PREVIEW_UNAVAILABLE_TEXT : (LOGIN_ERRORS[error] || LOGIN_ERRORS.UNKNOWN)) : null,
    bannerKind: hasBanner ? (BANNER_KIND[error] || 'other') : null,
  };
}

// Gửi qua bộ điều khiển headless (có thể là mock). Trả về { submitted, touched, firstInvalid, reason }.
// Không gọi submit khi UNAVAILABLE/LOADING/AUTHENTICATED hoặc dữ liệu sai hình dạng (bộ điều khiển vẫn tự kiểm tra lại).
export async function submitLogin(session, identifier, password) {
  const status = session.getState().status;
  const touched = { identifier: true, password: true };
  if (status === 'UNAVAILABLE' || status === 'LOADING' || status === 'AUTHENTICATED') return { submitted: false, touched, firstInvalid: null, reason: 'BLOCKED' };
  const firstInvalid = describeIdentifierProblem(identifier) ? 'identifier' : validatePassword(password) ? 'password' : null;
  if (firstInvalid) return { submitted: false, touched, firstInvalid, reason: 'INVALID' };
  await session.submit(identifier, password);
  return { submitted: true, touched, firstInvalid: null, reason: null };
}

// Bộ gửi có chặn gửi trùng: Enter/click liên tiếp trong lúc một lần gửi đang chạy (kể cả khi phiên chưa kịp
// chuyển LOADING) chỉ tạo đúng một lần session.submit. Các lần bị bỏ trả reason 'IN_FLIGHT'.
export function createLoginSubmitter(session) {
  let inFlight = false;
  return async function submit(identifier, password) {
    if (inFlight) return { submitted: false, touched: { identifier: true, password: true }, firstInvalid: null, reason: 'IN_FLIGHT' };
    inFlight = true;
    try { return await submitLogin(session, identifier, password); } finally { inFlight = false; }
  };
}

// Trường nhận focus sau một lần gửi: trường lỗi đầu tiên; nếu máy chủ/mạng từ chối thì ô mật khẩu (đã bị xóa) để nhập lại.
export function focusTargetAfterSubmit(result, state) {
  if (!result.submitted) return result.firstInvalid;
  return state && state.status === 'ERROR' ? 'password' : null;
}
