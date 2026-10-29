// Run: node --test tests/changePassword.test.mjs   (Node >= 18, không dependency, không mạng/DOM/storage).
// PR 8 (B1.3.3): chính sách mật khẩu FE đối chiếu vector của backend, model view thuần, client + session đổi mật khẩu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkPasswordPolicy, passwordStrength, PASSWORD_MIN, PASSWORD_MAX, POLICY_MESSAGES } from '../src/auth/passwordPolicy.js';
import { CHANGE_PASSWORD_UI_TEXT, CHANGE_PASSWORD_ERRORS, describeChangePasswordError, deriveChangePasswordView, validateChangePasswordInput, createChangePasswordSubmitter } from '../src/auth/changePasswordModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(readFileSync(path.join(HERE, '..', '..', '..', 'backend', 'src', 'common', 'auth', 'login', 'password-policy.vectors.json'), 'utf8')).cases
  .map((v) => ({ ...v, password: v.password ?? (v.repeat ? v.repeat[0].repeat(v.repeat[1]) + (v.suffix || '') : '') })); // repeat: chuỗi dài (xem spec BE)
const ME = { employeeId: 'e1', code: 'NV-0003', fullName: 'Sale A', roles: ['sales'], permissions: {}, mustChangePassword: false };
const CUR = 'Demo-Cu#301085'; const NEW = 'Demo-Moi#301085'; // giá trị tổng hợp cho test, không phải mật khẩu demo/thật

test('passwordPolicy FE: cùng kết quả với vector của backend (ok + strength) và cùng hằng số', () => {
  assert.equal(PASSWORD_MIN, 12); assert.equal(PASSWORD_MAX, 128);
  assert.ok(VECTORS.length >= 14);
  for (const v of VECTORS) {
    const ctx = { email: v.email, code: v.code };
    assert.equal(checkPasswordPolicy(v.password, ctx).length === 0, v.ok, 'ok: ' + v.note);
    assert.equal(passwordStrength(v.password, ctx), v.strength, 'strength: ' + v.note);
  }
  assert.deepEqual(checkPasswordPolicy('Password12345', {}), [POLICY_MESSAGES.common]);
  assert.deepEqual(checkPasswordPolicy(undefined, {}), [POLICY_MESSAGES.length]);
});

test('F6: hộp thoại không được đóng (Esc/nền) trong lúc đang gửi — canCloseDialog', async () => {
  const { canCloseDialog } = await import('../src/auth/changePasswordModel.js');
  assert.equal(canCloseDialog({ submitting: true }), false);
  assert.equal(canCloseDialog({ submitting: false }), true);
  assert.equal(canCloseDialog(null), true);
});

test('describeChangePasswordError: mã máy chủ -> trường/banner tiếng Việt, không lộ mật khẩu', () => {
  assert.deepEqual(describeChangePasswordError('PASSWORD_CURRENT_INVALID'), { field: 'current', message: 'Mật khẩu hiện tại không đúng.', kind: 'credentials' });
  const v = describeChangePasswordError('VALIDATION_FAILED', [POLICY_MESSAGES.classes]);
  assert.equal(v.field, 'next'); assert.equal(v.message, POLICY_MESSAGES.classes);
  assert.equal(describeChangePasswordError('VALIDATION_FAILED', ['Mật khẩu xác nhận không khớp']).field, 'confirm');
  assert.equal(describeChangePasswordError('VALIDATION_FAILED').field, 'next');
  assert.deepEqual(describeChangePasswordError('PASSWORD_CHANGE_THROTTLED'), { field: null, message: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.', kind: 'throttled' });
  assert.equal(describeChangePasswordError('CSRF_FAILED').kind, 'csrf');
  assert.equal(describeChangePasswordError('SESSION_EXPIRED').kind, 'session');
  assert.equal(describeChangePasswordError('NETWORK').kind, 'network');
  assert.equal(describeChangePasswordError('WHATEVER').kind, 'other');
});

test('deriveChangePasswordView: lỗi trường sau khi chạm, thanh độ mạnh theo chính sách (có mã NV), chặn khi không AUTHENTICATED/đang gửi', () => {
  const base = { status: 'AUTHENTICATED', submitting: false, serverError: null, current: '', next: '', confirm: '', touched: {}, me: ME };
  let v = deriveChangePasswordView(base);
  assert.equal(v.currentError, null); assert.equal(v.nextError, null); assert.equal(v.confirmError, null);
  assert.equal(v.strength, 0); assert.equal(v.strengthLabel, CHANGE_PASSWORD_UI_TEXT.strength[0]);
  assert.equal(v.submitBlocked, false); assert.equal(v.inputsDisabled, false); assert.equal(v.firstInvalid, 'current');
  v = deriveChangePasswordView({ ...base, touched: { current: true, next: true, confirm: true } });
  assert.equal(v.currentError, CHANGE_PASSWORD_ERRORS.CURRENT_REQUIRED); assert.equal(v.nextError, CHANGE_PASSWORD_ERRORS.NEXT_REQUIRED); assert.equal(v.confirmError, CHANGE_PASSWORD_ERRORS.CONFIRM_REQUIRED);
  v = deriveChangePasswordView({ ...base, current: CUR, next: 'Nv-0003-Strong!', confirm: 'x', touched: { next: true, confirm: true } });
  assert.equal(v.nextError, POLICY_MESSAGES.identifier); assert.equal(v.strength, 1); assert.equal(v.confirmError, CHANGE_PASSWORD_ERRORS.CONFIRM_MISMATCH); assert.equal(v.firstInvalid, 'next');
  v = deriveChangePasswordView({ ...base, current: CUR, next: NEW, confirm: NEW });
  assert.equal(v.nextError, null); assert.equal(v.strength, 3); assert.equal(v.firstInvalid, null);
  v = deriveChangePasswordView({ ...base, current: CUR, next: NEW, confirm: NEW, serverError: describeChangePasswordError('PASSWORD_CURRENT_INVALID') });
  assert.equal(v.currentError, 'Mật khẩu hiện tại không đúng.'); assert.equal(v.bannerError, null);
  v = deriveChangePasswordView({ ...base, serverError: describeChangePasswordError('PASSWORD_CHANGE_THROTTLED') });
  assert.match(v.bannerError, /quá nhiều lần/); assert.equal(v.bannerKind, 'throttled');
  v = deriveChangePasswordView({ ...base, submitting: true });
  assert.equal(v.loading, true); assert.equal(v.submitBlocked, true);
  v = deriveChangePasswordView({ ...base, status: 'IDLE' });
  assert.equal(v.inputsDisabled, true); assert.equal(v.submitBlocked, true);
  assert.equal(validateChangePasswordInput(CUR, NEW, NEW, ME), null);
  assert.equal(validateChangePasswordInput('', NEW, NEW, ME), 'current');
  assert.equal(validateChangePasswordInput(CUR, 'x'.repeat(1025), 'x', ME), 'next');
});

test('createChangePasswordSubmitter: chặn khi chưa AUTHENTICATED, không gọi khi dữ liệu sai, gọi session.changePassword đúng tham số, chặn gửi trùng, trả lỗi máy chủ', async () => {
  const calls = []; let resolveNext;
  const session = { getState: () => ({ status: 'AUTHENTICATED', me: ME }), changePassword: (c, n, f) => { calls.push([c, n, f]); return new Promise((r) => { resolveNext = r; }); } };
  const submit = createChangePasswordSubmitter(session);
  assert.deepEqual(await submit('', NEW, NEW), { submitted: false, ok: false, reason: 'INVALID', firstInvalid: 'current', error: null });
  assert.equal(calls.length, 0);
  const p1 = submit(CUR, NEW, NEW); const p2 = submit(CUR, NEW, NEW);
  assert.equal((await p2).reason, 'IN_FLIGHT');
  resolveNext({ ok: true });
  assert.deepEqual(await p1, { submitted: true, ok: true, reason: null, firstInvalid: null, error: null });
  assert.deepEqual(calls, [[CUR, NEW, NEW]]);
  const p3 = submit(CUR, NEW, NEW); resolveNext({ ok: false, error: { code: 'PASSWORD_CURRENT_INVALID' } });
  const r3 = await p3; assert.equal(r3.ok, false); assert.equal(r3.error.field, 'current');
  const blocked = createChangePasswordSubmitter({ getState: () => ({ status: 'IDLE', me: null }), changePassword: () => { throw new Error('không được gọi'); } });
  assert.equal((await blocked(CUR, NEW, NEW)).reason, 'BLOCKED');
});

// ---------- Task 7: cổng bắt buộc đổi mật khẩu (AuthGate) ----------
import { gateDecision } from '../src/auth/authGateModel.js';
test('gateDecision: AUTHENTICATED + mustChangePassword => forced (không vào App); AUTHENTICATED => app; LOADING khi đang khôi phục => restoring; còn lại => login', () => {
  assert.equal(gateDecision({ status: 'AUTHENTICATED', me: { ...ME, mustChangePassword: true } }, false), 'forced');
  assert.equal(gateDecision({ status: 'AUTHENTICATED', me: { ...ME, mustChangePassword: false } }, false), 'app');
  assert.equal(gateDecision({ status: 'AUTHENTICATED', me: null }, false), 'app'); // me thiếu => không ép (server quyết định ở lần /auth/me sau)
  assert.equal(gateDecision({ status: 'LOADING', me: null }, true), 'restoring');
  assert.equal(gateDecision({ status: 'LOADING', me: null }, false), 'login');
  assert.equal(gateDecision({ status: 'IDLE', me: null }, false), 'login');
  assert.equal(gateDecision({ status: 'ERROR', error: 'SESSION_EXPIRED', me: null }, false), 'login');
  assert.equal(gateDecision({ status: 'UNAVAILABLE', me: null }, false), 'login');
  assert.equal(gateDecision(null, false), 'login');
});

// ---------- Task 5: client + session ----------
import { createCookieAuthClient } from '../src/auth/cookieAuthClient.js';
import { createCookieSession } from '../src/auth/cookieSession.js';
const BASE = '/api/v1';
const CSRF1 = 'c'.repeat(43); const CSRF2 = 'd'.repeat(43);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const err = (status, code, details) => res(status, { statusCode: status, error: { code, message: 'x', details } });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const meOf = (over = {}) => ({ ...ME, ...over });
const loginOk = (url, init) => (url === BASE + '/auth/login' ? res(200, { data: { me: meOf({ mustChangePassword: true }), csrfToken: CSRF1 } }) : null);
async function authedSession(handler) {
  const f = mockFetch((url, init) => loginOk(url, init) || handler(url, init));
  const session = createCookieSession(createCookieAuthClient({ enabled: true, baseUrl: BASE }, f), { readCookie: () => '' });
  await session.submit('sale@siscom.local', CUR);
  assert.equal(session.getState().status, 'AUTHENTICATED');
  return { session, f };
}

test('client.changePassword: POST /auth/change-password credentials include + X-CSRF-Token + 3 trường; trả me + csrfToken; thiếu csrf => không gọi mạng; lỗi giữ code + details', async () => {
  const f = mockFetch((url) => (url === BASE + '/auth/change-password' ? res(200, { data: { me: meOf(), csrfToken: CSRF2 } }) : res(404, {})));
  const client = createCookieAuthClient({ enabled: true, baseUrl: BASE }, f);
  const r = await client.changePassword(CUR, NEW, NEW, CSRF1);
  assert.equal(r.csrfToken, CSRF2); assert.equal(r.me.employeeId, 'e1');
  const c = f.calls[0]; assert.equal(c.init.method, 'POST'); assert.equal(c.init.credentials, 'include');
  assert.equal(c.init.headers['X-CSRF-Token'], CSRF1); assert.deepEqual(JSON.parse(c.init.body), { currentPassword: CUR, newPassword: NEW, confirmPassword: NEW });
  await assert.rejects(client.changePassword(CUR, NEW, NEW, null), (e) => e.code === 'CSRF_FAILED' && e.status === 403);
  assert.equal(f.calls.length, 1);
  const bad = createCookieAuthClient({ enabled: true, baseUrl: BASE }, mockFetch(() => err(400, 'VALIDATION_FAILED', ['Mật khẩu xác nhận không khớp'])));
  await assert.rejects(bad.changePassword(CUR, NEW, NEW, CSRF1), (e) => e.code === 'VALIDATION_FAILED' && Array.isArray(e.details) && e.details[0] === 'Mật khẩu xác nhận không khớp');
  const malformed = createCookieAuthClient({ enabled: true, baseUrl: BASE }, mockFetch(() => res(200, { data: { me: meOf(), csrfToken: 'short' } })));
  await assert.rejects(malformed.changePassword(CUR, NEW, NEW, CSRF1), (e) => e.code === 'BAD_RESPONSE');
});

test('session.changePassword: thành công => csrf mới + me mới (mustChangePassword=false), vẫn AUTHENTICATED; chưa đăng nhập => {ok:false, BLOCKED}', async () => {
  const { session, f } = await authedSession((url) => (url === BASE + '/auth/change-password' ? res(200, { data: { me: meOf({ mustChangePassword: false }), csrfToken: CSRF2 } }) : res(404, {})));
  assert.equal(session.getState().me.mustChangePassword, true); assert.equal(session.getCsrfToken(), CSRF1);
  const r = await session.changePassword(CUR, NEW, NEW);
  assert.deepEqual(r, { ok: true });
  assert.equal(session.getState().status, 'AUTHENTICATED'); assert.equal(session.getState().me.mustChangePassword, false); assert.equal(session.getCsrfToken(), CSRF2);
  assert.equal(f.calls.at(-1).init.headers['X-CSRF-Token'], CSRF1);
  const fresh = createCookieSession(createCookieAuthClient({ enabled: true, baseUrl: BASE }, mockFetch(() => { throw new Error('không được gọi'); })), { readCookie: () => '' });
  assert.deepEqual(await fresh.changePassword(CUR, NEW, NEW), { ok: false, error: { code: 'BLOCKED', details: null } });
});

test('session.changePassword: 400 => {ok:false, error{code,details}} và phiên/csrf giữ nguyên; 401 => ERROR SESSION_EXPIRED; lỗi mạng => NETWORK', async () => {
  let mode = 'bad';
  const { session } = await authedSession((url) => {
    if (url !== BASE + '/auth/change-password') return res(404, {});
    if (mode === 'bad') return err(400, 'PASSWORD_CURRENT_INVALID');
    if (mode === 'net') throw new TypeError('fetch failed');
    return err(401, 'UNAUTHENTICATED');
  });
  assert.deepEqual(await session.changePassword('sai', NEW, NEW), { ok: false, error: { code: 'PASSWORD_CURRENT_INVALID', details: null } });
  assert.equal(session.getState().status, 'AUTHENTICATED'); assert.equal(session.getCsrfToken(), CSRF1);
  mode = 'net';
  assert.equal((await session.changePassword(CUR, NEW, NEW)).error.code, 'NETWORK');
  assert.equal(session.getState().status, 'AUTHENTICATED');
  mode = '401';
  const r = await session.changePassword(CUR, NEW, NEW);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'SESSION_EXPIRED');
  assert.equal(session.getState().status, 'ERROR'); assert.equal(session.getState().error, 'SESSION_EXPIRED'); assert.equal(session.getCsrfToken(), null);
});
