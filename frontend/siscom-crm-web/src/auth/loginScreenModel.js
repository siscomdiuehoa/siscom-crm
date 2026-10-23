// Mô hình view THUẦN cho màn hình đăng nhập (không React, không DOM) — kiểm thử được bằng node --test.
// - Cờ giao diện đăng nhập MẶC ĐỊNH TẮT (VITE_CRM_LOGIN_UI_ENABLED === 'true' mới bật). Cờ này chỉ hiện giao diện;
//   đăng nhập thật vẫn phụ thuộc bộ điều khiển headless (UNAVAILABLE khi VITE_CRM_AUTH_ENABLED tắt).
// - Không đọc/ghi storage, không giữ token; mật khẩu chỉ nằm trong state của component và bị xóa sau mỗi lần gửi.
// - Không có đường lui sang demo/đăng nhập giả: UNAVAILABLE => nút gửi bị vô hiệu, không gọi session.submit.
import { parseLoginIdentifier, validatePassword } from './loginIdentifier.js';
import { LOGIN_ERRORS } from './loginSession.js';
import { LOGIN_PREVIEW_ERROR, LOGIN_PREVIEW_UNAVAILABLE_TEXT } from './loginPreview.js';

export const LOGIN_UI_TEXT = {
  title: 'Đăng nhập',
  identifierLabel: 'Email hoặc mã nhân viên',
  passwordLabel: 'Mật khẩu',
  submit: 'Đăng nhập',
  unavailable: 'Đăng nhập chưa khả dụng: máy chủ xác thực chưa được bật.',
};

export function readLoginUiFlag(env) {
  return !!env && env.VITE_CRM_LOGIN_UI_ENABLED === 'true';
}

// touched: { identifier: boolean, password: boolean } — chỉ báo lỗi trường sau khi người dùng đã chạm/gửi.
export function deriveLoginView({ status, error, identifier = '', password = '', touched = {} }) {
  const unavailable = status === 'UNAVAILABLE';
  const loading = status === 'LOADING';
  const authenticated = status === 'AUTHENTICATED';
  const idErr = parseLoginIdentifier(identifier).kind === 'INVALID' ? 'IDENTIFIER_INVALID' : null;
  const pwErr = validatePassword(password);
  const identifierError = touched.identifier && idErr ? LOGIN_ERRORS[idErr] : null;
  const passwordError = touched.password && pwErr ? LOGIN_ERRORS[pwErr] : null;
  const fieldCovered = error === 'IDENTIFIER_INVALID' || error === 'PASSWORD_REQUIRED' || error === 'PASSWORD_TOO_LONG';
  return {
    unavailable,
    loading,
    authenticated,
    inputsDisabled: unavailable || loading || authenticated,
    submitDisabled: unavailable || loading || authenticated || !!idErr || !!pwErr,
    identifierError,
    passwordError,
    notice: unavailable ? LOGIN_UI_TEXT.unavailable : null,
    // Lỗi do máy chủ/mạng (không trùng lỗi trường) hiển thị thành banner.
    bannerError: status === 'ERROR' && error && !fieldCovered ? (error === LOGIN_PREVIEW_ERROR ? LOGIN_PREVIEW_UNAVAILABLE_TEXT : (LOGIN_ERRORS[error] || LOGIN_ERRORS.UNKNOWN)) : null,
  };
}

// Gửi qua bộ điều khiển headless (có thể là mock). Trả về { submitted, touched }.
// Không gọi submit khi UNAVAILABLE/LOADING/AUTHENTICATED hoặc dữ liệu sai hình dạng (bộ điều khiển vẫn tự kiểm tra lại).
export async function submitLogin(session, identifier, password) {
  const status = session.getState().status;
  const touched = { identifier: true, password: true };
  if (status === 'UNAVAILABLE' || status === 'LOADING' || status === 'AUTHENTICATED') return { submitted: false, touched };
  if (parseLoginIdentifier(identifier).kind === 'INVALID' || validatePassword(password)) return { submitted: false, touched };
  await session.submit(identifier, password);
  return { submitted: true, touched };
}
