// Run: node --test tests/loginPasswordClearedAfterSubmit.test.mjs   (không mạng, không DB; mật khẩu là chuỗi giả).
// Lỗi tái hiện trên Chrome thật (tests/browser/browserSmoke.mjs, B11): sau khi gửi biểu mẫu HỢP LỆ, LoginScreen xoá ô mật khẩu
// (không giữ mật khẩu) nhưng vẫn đặt touched.password = true => hiện thêm "Vui lòng nhập mật khẩu." + aria-invalid="true"
// bên cạnh banner "máy chủ chưa khả dụng": thông báo mâu thuẫn, người dùng không hề bỏ trống mật khẩu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveLoginView, createLoginSubmitter, touchedAfterSubmit } from '../src/auth/loginScreenModel.js';
import { createLoginPreviewSession, LOGIN_PREVIEW_UNAVAILABLE_TEXT } from '../src/auth/loginPreview.js';

const PW = 'pw-gia-lap-cho-test';

// Mô phỏng đúng onSubmit của LoginScreen: gửi -> setTouched(...) -> mật khẩu bị xoá khi đã gửi.
async function submitAndView(identifier, password) {
  const session = createLoginPreviewSession();
  const r = await createLoginSubmitter(session)(identifier, password);
  const state = session.getState();
  const passwordAfter = r.submitted ? '' : password;
  const view = deriveLoginView({ status: state.status, error: state.error, identifier, password: passwordAfter, touched: touchedAfterSubmit(r) });
  return { r, view };
}

test('gửi hợp lệ rồi mật khẩu bị xoá: chỉ có banner máy chủ, KHÔNG có lỗi trường mật khẩu mâu thuẫn', async () => {
  const { r, view } = await submitAndView('nv001@siscom.vn', PW);
  assert.equal(r.submitted, true);
  assert.equal(view.bannerError, LOGIN_PREVIEW_UNAVAILABLE_TEXT);
  assert.equal(view.passwordError, null);
  assert.equal(view.identifierError, null);
});

test('gửi không hợp lệ (mật khẩu trống, chưa gửi): vẫn báo lỗi trường như cũ', async () => {
  const { r, view } = await submitAndView('nv001@siscom.vn', '');
  assert.equal(r.submitted, false);
  assert.match(view.passwordError, /mật khẩu/i);
  assert.equal(touchedAfterSubmit(r).password, true);
});

test('định danh sai hình dạng: lỗi định danh vẫn hiện, không đổi', async () => {
  const { r, view } = await submitAndView('abc', PW);
  assert.equal(r.submitted, false);
  assert.ok(view.identifierError);
  assert.equal(touchedAfterSubmit(r).identifier, true);
});

test('LoginScreen dùng touchedAfterSubmit (không setTouched(r.touched) trực tiếp)', () => {
  const src = readFileSync(new URL('../src/features/auth/LoginScreen.jsx', import.meta.url), 'utf8');
  assert.match(src, /setTouched\(touchedAfterSubmit\(r\)\)/);
  assert.doesNotMatch(src, /setTouched\(r\.touched\)/);
});
