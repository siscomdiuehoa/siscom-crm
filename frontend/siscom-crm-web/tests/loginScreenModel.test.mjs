// Run: node --test tests/loginScreenModel.test.mjs   (Node >= 18). Bộ điều khiển headless được GIẢ LẬP; không mạng, không DB, không bí mật thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLoginUiFlag, deriveLoginView, submitLogin, LOGIN_UI_TEXT } from '../src/auth/loginScreenModel.js';
import { LOGIN_ERRORS } from '../src/auth/loginSession.js';

function mockSession(status = 'IDLE') {
  const calls = [];
  return { calls, getState: () => ({ status, error: null }), subscribe: () => () => {}, submit: async (i, p) => { calls.push([i, p]); } };
}
const both = { identifier: true, password: true };

test('cờ giao diện MẶC ĐỊNH TẮT', () => {
  assert.equal(readLoginUiFlag(undefined), false);
  assert.equal(readLoginUiFlag({}), false);
  assert.equal(readLoginUiFlag({ VITE_CRM_LOGIN_UI_ENABLED: '1' }), false);
  assert.equal(readLoginUiFlag({ VITE_CRM_LOGIN_UI_ENABLED: 'true' }), true);
});

test('UNAVAILABLE: vô hiệu hóa đăng nhập thật, có thông báo, không gọi submit', async () => {
  const v = deriveLoginView({ status: 'UNAVAILABLE', identifier: 'a@b.vn', password: 'x', touched: both });
  assert.equal(v.submitDisabled, true);
  assert.equal(v.inputsDisabled, true);
  assert.equal(v.notice, LOGIN_UI_TEXT.unavailable);
  const s = mockSession('UNAVAILABLE');
  const r = await submitLogin(s, 'a@b.vn', 'x');
  assert.equal(r.submitted, false);
  assert.equal(s.calls.length, 0);
});

test('validation bắt buộc: danh tính sai/ trống và mật khẩu trống', async () => {
  const v = deriveLoginView({ status: 'IDLE', identifier: '', password: '', touched: both });
  assert.match(v.identifierError, /Vui lòng nhập email hoặc mã nhân viên/);
  assert.equal(v.passwordError, LOGIN_ERRORS.PASSWORD_REQUIRED);
  assert.equal(v.submitDisabled, true);
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: '', password: '', touched: {} }).identifierError, null); // chưa chạm => chưa báo
  const s = mockSession();
  assert.equal((await submitLogin(s, 'nv-1', '')).submitted, false);
  assert.equal((await submitLogin(s, 'a@b.vn', '')).submitted, false);
  assert.equal(s.calls.length, 0);
});

test('hợp lệ (email hoặc NV-xxxx): bật nút và gọi submit đúng một lần với giá trị gốc', async () => {
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: 'NV-0001', password: 'pw-gia-lap' }).submitDisabled, false);
  const s = mockSession();
  const r = await submitLogin(s, 'NV-0001', ' pw ');
  assert.equal(r.submitted, true);
  assert.deepEqual(s.calls, [['NV-0001', ' pw ']]); // mật khẩu không bị trim
});

test('LOADING: nút ở trạng thái loading/vô hiệu, không gửi trùng', async () => {
  const v = deriveLoginView({ status: 'LOADING', identifier: 'a@b.vn', password: 'x' });
  assert.equal(v.loading, true);
  assert.equal(v.submitDisabled, true);
  const s = mockSession('LOADING');
  assert.equal((await submitLogin(s, 'a@b.vn', 'x')).submitted, false);
  assert.equal(s.calls.length, 0);
});

test('ERROR từ máy chủ/mạng hiện banner; lỗi trường không lặp thành banner; không có lỗi thì không banner', () => {
  for (const code of ['INVALID_CREDENTIALS', 'RATE_LIMITED', 'NETWORK', 'SERVICE_UNAVAILABLE', 'SESSION_EXPIRED'])
    assert.equal(deriveLoginView({ status: 'ERROR', error: code, identifier: 'a@b.vn', password: 'x' }).bannerError, LOGIN_ERRORS[code]);
  assert.equal(deriveLoginView({ status: 'ERROR', error: 'PASSWORD_REQUIRED' }).bannerError, null);
  assert.equal(deriveLoginView({ status: 'ERROR', error: 'LẠ' , identifier: 'a@b.vn', password: 'x' }).bannerError, LOGIN_ERRORS.UNKNOWN);
  assert.equal(deriveLoginView({ status: 'IDLE', identifier: 'a@b.vn', password: 'x' }).bannerError, null);
});

test('AUTHENTICATED: không cho gửi lại; không rơi về demo', async () => {
  const v = deriveLoginView({ status: 'AUTHENTICATED', identifier: 'a@b.vn', password: 'x' });
  assert.equal(v.submitDisabled, true);
  const s = mockSession('AUTHENTICATED');
  assert.equal((await submitLogin(s, 'a@b.vn', 'x')).submitted, false);
});

test('tích hợp với bộ điều khiển thật khi cờ xác thực tắt: UNAVAILABLE, không gọi fetch', async () => {
  const { createLoginSession } = await import('../src/auth/loginSession.js');
  const { createAuthClient, readAuthConfig } = await import('../src/auth/authClient.js');
  let fetched = 0;
  const session = createLoginSession(createAuthClient(readAuthConfig({}), async () => { fetched++; }));
  assert.equal(session.getState().status, 'UNAVAILABLE');
  assert.equal((await submitLogin(session, 'a@b.vn', 'x')).submitted, false);
  assert.equal(fetched, 0);
});
