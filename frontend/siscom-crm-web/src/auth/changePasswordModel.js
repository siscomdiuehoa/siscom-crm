// Mô hình view THUẦN cho màn hình đổi mật khẩu (PR 8, B1.3.3) — không React/DOM, kiểm bằng node --test.
// - Mật khẩu chỉ nằm trong state của component và bị xoá sau mỗi lần gửi; không storage, không log.
// - Lỗi trường báo sớm theo cùng chính sách D17 (passwordPolicy.js); máy chủ vẫn quyết định (lỗi máy chủ map về trường/banner).
// - Gửi chỉ khi phiên AUTHENTICATED; chặn gửi trùng (IN_FLIGHT).
import { checkPasswordPolicy, passwordStrength } from './passwordPolicy.js';

const MAX_LEN = 1024; // giới hạn DTO backend

export const CHANGE_PASSWORD_UI_TEXT = {
  title: 'Đổi mật khẩu',
  currentLabel: 'Mật khẩu hiện tại',
  nextLabel: 'Mật khẩu mới',
  confirmLabel: 'Xác nhận mật khẩu mới',
  submit: 'Đổi mật khẩu',
  close: 'Đóng',
  logout: 'Đăng xuất',
  showPassword: 'Hiện mật khẩu',
  hidePassword: 'Ẩn mật khẩu',
  hint: 'Từ 12 đến 128 ký tự, gồm ít nhất 3 trong 4 nhóm: chữ thường, chữ HOA, chữ số, ký tự đặc biệt.',
  success: 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.',
  forcedNotice: 'Bạn cần đổi mật khẩu trước khi tiếp tục.',
  strength: ['Quá ngắn', 'Chưa đạt', 'Đạt', 'Khá mạnh', 'Mạnh'],
};

export const CHANGE_PASSWORD_ERRORS = {
  CURRENT_REQUIRED: 'Vui lòng nhập mật khẩu hiện tại.',
  NEXT_REQUIRED: 'Vui lòng nhập mật khẩu mới.',
  CONFIRM_REQUIRED: 'Vui lòng nhập lại mật khẩu mới.',
  CONFIRM_MISMATCH: 'Mật khẩu xác nhận không khớp.',
  TOO_LONG: 'Mật khẩu quá dài (tối đa 1024 ký tự).',
};

const BANNERS = {
  PASSWORD_CHANGE_THROTTLED: { message: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.', kind: 'throttled' },
  CSRF_FAILED: { message: 'Phiên không hợp lệ (kiểm tra nguồn gốc). Hãy tải lại trang rồi thử lại.', kind: 'csrf' },
  SESSION_EXPIRED: { message: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.', kind: 'session' },
  UNAUTHENTICATED: { message: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.', kind: 'session' },
  NETWORK: { message: 'Không kết nối được máy chủ. Mật khẩu chưa được đổi.', kind: 'network' },
};

// Mã lỗi máy chủ/phiên -> { field: 'current'|'next'|'confirm'|null, message, kind }. Không bao giờ chứa mật khẩu.
export function describeChangePasswordError(code, details) {
  if (code === 'PASSWORD_CURRENT_INVALID') return { field: 'current', message: 'Mật khẩu hiện tại không đúng.', kind: 'credentials' };
  if (code === 'VALIDATION_FAILED') {
    const list = Array.isArray(details) ? details.filter((d) => typeof d === 'string' && d) : [];
    const msg = list.length ? list.join(' ') : 'Mật khẩu mới chưa hợp lệ.';
    const field = list.some((d) => /xác nhận/i.test(d)) ? 'confirm' : 'next';
    return { field, message: msg, kind: 'validation' };
  }
  const b = BANNERS[code];
  if (b) return { field: null, message: b.message, kind: b.kind };
  return { field: null, message: 'Đổi mật khẩu thất bại. Vui lòng thử lại.', kind: 'other' };
}

const ctxOf = (me) => ({ code: me && me.code ? me.code : null });

// F6: hộp thoại không được đóng (Esc/bấm nền) trong lúc đang gửi — máy chủ vẫn hoàn tất đổi mật khẩu, người dùng sẽ tưởng đã huỷ.
export function canCloseDialog(formState) {
  return !(formState && formState.submitting === true);
}

// Trường sai đầu tiên theo thứ tự hiển thị, hoặc null nếu hợp lệ phía máy khách.
export function validateChangePasswordInput(current, next, confirm, me) {
  if (typeof current !== 'string' || !current) return 'current';
  if (current.length > MAX_LEN) return 'current';
  if (typeof next !== 'string' || !next || next.length > MAX_LEN || checkPasswordPolicy(next, ctxOf(me)).length) return 'next';
  if (typeof confirm !== 'string' || !confirm || confirm !== next) return 'confirm';
  return null;
}

export function deriveChangePasswordView({ status, submitting = false, serverError = null, current = '', next = '', confirm = '', touched = {}, me = null }) {
  const authenticated = status === 'AUTHENTICATED';
  const loading = !!submitting;
  const ctx = ctxOf(me);
  const policy = next ? checkPasswordPolicy(next, ctx) : [];
  const currentLocal = !current ? CHANGE_PASSWORD_ERRORS.CURRENT_REQUIRED : current.length > MAX_LEN ? CHANGE_PASSWORD_ERRORS.TOO_LONG : null;
  const nextLocal = !next ? CHANGE_PASSWORD_ERRORS.NEXT_REQUIRED : next.length > MAX_LEN ? CHANGE_PASSWORD_ERRORS.TOO_LONG : policy[0] || null;
  const confirmLocal = !confirm ? CHANGE_PASSWORD_ERRORS.CONFIRM_REQUIRED : confirm !== next ? CHANGE_PASSWORD_ERRORS.CONFIRM_MISMATCH : null;
  const se = serverError && typeof serverError === 'object' ? serverError : null;
  const strength = passwordStrength(next, ctx);
  return {
    authenticated,
    loading,
    inputsDisabled: !authenticated || loading,
    submitBlocked: !authenticated || loading,
    firstInvalid: currentLocal ? 'current' : nextLocal ? 'next' : confirmLocal ? 'confirm' : null,
    currentError: (touched.current && currentLocal) || (se && se.field === 'current' ? se.message : null),
    nextError: (touched.next && nextLocal) || (se && se.field === 'next' ? se.message : null),
    confirmError: (touched.confirm && confirmLocal) || (se && se.field === 'confirm' ? se.message : null),
    strength,
    strengthLabel: CHANGE_PASSWORD_UI_TEXT.strength[strength],
    bannerError: se && se.field === null ? se.message : null,
    bannerKind: se && se.field === null ? se.kind : null,
  };
}

// Bộ gửi: chặn khi chưa AUTHENTICATED, kiểm dữ liệu phía máy khách, chặn gửi trùng; gọi session.changePassword(current, next, confirm)
// trả { ok: true } | { ok: false, error: { code, details } }. Kết quả: { submitted, ok, reason, firstInvalid, error }.
export function createChangePasswordSubmitter(session) {
  let inFlight = false;
  return async function submit(current, next, confirm) {
    const base = { submitted: false, ok: false, reason: null, firstInvalid: null, error: null };
    if (inFlight) return { ...base, reason: 'IN_FLIGHT' };
    const st = session.getState();
    if (!st || st.status !== 'AUTHENTICATED') return { ...base, reason: 'BLOCKED' };
    const firstInvalid = validateChangePasswordInput(current, next, confirm, st.me);
    if (firstInvalid) return { ...base, reason: 'INVALID', firstInvalid };
    inFlight = true;
    try {
      const r = await session.changePassword(current, next, confirm);
      if (r && r.ok) return { ...base, submitted: true, ok: true };
      const e = r && r.error ? r.error : { code: 'UNKNOWN' };
      return { ...base, submitted: true, ok: false, error: describeChangePasswordError(e.code, e.details) };
    } finally { inFlight = false; }
  };
}
