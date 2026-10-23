// Run: node --test tests/   Ngữ nghĩa lỗi xác thực: (trạng thái HTTP, mã lỗi, ngữ cảnh) -> lớp lỗi + thông điệp người dùng.
// fetch giả lập; không mạng, không DB, không bí mật thật. Chỉ test: KHÔNG đổi mã nguồn, không kích hoạt backend.
// Không gian mã backend (đã xác minh ở backend PR #84, auth-frontend-contract.spec.ts): login=LOGIN_INVALID, me/logout=AUTH_REQUIRED,
// guard mặc định=UNAUTHENTICATED, 429=LOGIN_THROTTLED, 503=AUTH_UNAVAILABLE.
// GIỚI HẠN: đây là mô hình phản hồi giả lập phía frontend, không chạy backend thật. Hành vi LỆCH-4 (backend trả 401 LOGIN_INVALID
// khi kho credential lỗi) KHÔNG thể sửa từ frontend; xem test 'LIMIT-1'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient, AuthHttpError } from '../src/auth/authClient.js';
import { createLoginSession, classifyAuthError, LOGIN_ERRORS } from '../src/auth/loginSession.js';

const TOKEN = 'sid_' + 'B'.repeat(43);
const PW = 'pw-gia-lap-cho-test';
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const err = (status, code) => resp(status, { error: { code, message: 'thông điệp máy chủ không được hiển thị' } });
const cfg = { enabled: true, baseUrl: 'http://api.test' };
function mk(handler) {
  const calls = [];
  const client = createAuthClient(cfg, async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); });
  return { client, calls, session: createLoginSession(client) };
}
const loginOk = resp(200, { token: TOKEN, expiresAt: '2026-10-24T00:00:00.000Z' });
const meOk = resp(200, { employeeId: 7 });
const WRONG_PASSWORD_MSG = LOGIN_ERRORS.INVALID_CREDENTIALS;

// Mọi lớp lỗi ngoài INVALID_CREDENTIALS KHÔNG được dùng thông điệp "sai thông tin đăng nhập".
const notWrongPassword = (s) => assert.notEqual(LOGIN_ERRORS[s.error], WRONG_PASSWORD_MSG, 'không được báo sai mật khẩu: ' + s.error);

// Quan sát mọi ghi storage/cookie trong suốt test.
function spyStorage() {
  const writes = [];
  const mkStore = (n) => ({ getItem: () => null, setItem: (k) => writes.push(n + '.setItem:' + k), removeItem: () => {}, clear: () => {}, key: () => null, length: 0 });
  const saved = { l: globalThis.localStorage, s: globalThis.sessionStorage, d: globalThis.document };
  Object.defineProperty(globalThis, 'localStorage', { value: mkStore('local'), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: mkStore('session'), configurable: true, writable: true });
  const doc = { set cookie(v) { writes.push('cookie:' + v); }, get cookie() { return ''; } };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  return { writes, restore() { for (const [k, v] of [['localStorage', saved.l], ['sessionStorage', saved.s], ['document', saved.d]]) { if (v === undefined) delete globalThis[k]; else Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } } };
}

// ---------- Ma trận login: [mô tả, phản hồi, lớp lỗi kỳ vọng] ----------
const LOGIN_MATRIX = [
  ['sai mật khẩu 401 LOGIN_INVALID', () => err(401, 'LOGIN_INVALID'), 'INVALID_CREDENTIALS'],
  ['429 LOGIN_THROTTLED', () => err(429, 'LOGIN_THROTTLED'), 'RATE_LIMITED'],
  ['429 thân không phải JSON', () => ({ ok: false, status: 429, json: async () => { throw new Error('html'); } }), 'RATE_LIMITED'],
  ['hạ tầng 503 AUTH_UNAVAILABLE', () => err(503, 'AUTH_UNAVAILABLE'), 'SERVICE_UNAVAILABLE'],
  ['hạ tầng 500 INTERNAL', () => err(500, 'INTERNAL_ERROR'), 'SERVICE_UNAVAILABLE'],
  ['proxy 502 HTML', () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('<html>'); } }), 'SERVICE_UNAVAILABLE'],
  ['proxy 504 HTML', () => ({ ok: false, status: 504, json: async () => { throw new SyntaxError('<html>'); } }), 'SERVICE_UNAVAILABLE'],
  ['503 nhưng mã LOGIN_INVALID (không được tin mã khi status là sự cố)', () => err(503, 'LOGIN_INVALID'), 'SERVICE_UNAVAILABLE'],
  ['500 nhưng mã LOGIN_INVALID', () => err(500, 'LOGIN_INVALID'), 'SERVICE_UNAVAILABLE'],
  ['mạng lỗi (fetch ném)', () => { throw new TypeError('Failed to fetch'); }, 'NETWORK'],
  ['xác thực malformed 401 AUTH_REQUIRED ở login', () => err(401, 'AUTH_REQUIRED'), 'SESSION_EXPIRED'],
  ['guard 401 UNAUTHENTICATED ở login', () => err(401, 'UNAUTHENTICATED'), 'SESSION_EXPIRED'],
  ['401 thân rỗng/không JSON', () => ({ ok: false, status: 401, json: async () => { throw new Error('x'); } }), 'SESSION_EXPIRED'],
  ['400 REQUEST_INVALID', () => err(400, 'REQUEST_INVALID'), 'REQUEST_INVALID'],
  ['404 route chưa có', () => err(404, 'NOT_FOUND'), 'ENDPOINT_UNAVAILABLE'],
  ['200 thân hỏng', () => resp(200, { token: 5 }), 'UNKNOWN'],
  ['403', () => err(403, 'FORBIDDEN'), 'UNKNOWN'],
];

for (const [name, handler, kind] of LOGIN_MATRIX) {
  test(`LOGIN: ${name} -> ${kind}; không token, không storage, người dùng không thấy "sai thông tin" nếu không phải sai mật khẩu`, async () => {
    const spy = spyStorage();
    try {
      const { session, calls } = mk(handler);
      const s = await session.submit('a@b.vn', PW);
      assert.equal(s.status, 'ERROR');
      assert.equal(s.error, kind);
      assert.ok(LOGIN_ERRORS[kind], 'có thông điệp tiếng Việt');
      if (kind !== 'INVALID_CREDENTIALS') notWrongPassword(s);
      assert.equal(session.getAuthHeader(), null, 'token phải sạch ở mọi trạng thái lỗi');
      assert.equal(s.employeeId, null);
      assert.equal(s.expiresAt, null);
      const dump = JSON.stringify(s) + JSON.stringify(calls.map((c) => c.url));
      assert.ok(!dump.includes(TOKEN) && !dump.includes(PW), 'trạng thái/URL không chứa token hay mật khẩu');
      assert.ok(!JSON.stringify(s).includes('máy chủ không được hiển thị'), 'thân lỗi máy chủ không vào state');
      assert.deepEqual(spy.writes, [], 'không ghi localStorage/sessionStorage/cookie');
    } finally { spy.restore(); }
  });
}

test('HẠ TẦNG KHÔNG BỊ HIỂN THỊ LÀ SAI MẬT KHẨU: mọi 5xx/mạng/429/route-thiếu => thông điệp khác "Thông tin đăng nhập không đúng."', async () => {
  const downs = [500, 502, 503, 504, 599].map((st) => () => err(st, 'LOGIN_INVALID')).concat([() => { throw new TypeError('x'); }, () => err(429, 'LOGIN_INVALID'), () => err(404, 'LOGIN_INVALID')]);
  for (const h of downs) {
    const { session } = mk(h);
    const s = await session.submit('a@b.vn', PW);
    notWrongPassword(s);
  }
});

// ---------- Chống dò tài khoản ----------
test('ANTI-ENUM-1: tài khoản không tồn tại ≡ sai mật khẩu ở phía frontend (cùng lớp, cùng thông điệp, cùng trạng thái công khai)', async () => {
  // Backend trả CÙNG 401 LOGIN_INVALID cho cả hai (đã khóa ở PR #84); thân khác nhau của máy chủ không được lộ ra.
  const unknown = mk(() => resp(401, { error: { code: 'LOGIN_INVALID', message: 'NV-9999 không tồn tại' } }));
  const wrong = mk(() => resp(401, { error: { code: 'LOGIN_INVALID', message: 'sai mật khẩu' } }));
  const a = await unknown.session.submit('nv-0007@siscom.vn', PW);
  const b = await wrong.session.submit('nv-0007@siscom.vn', PW);
  assert.deepEqual(a, b);
  assert.equal(LOGIN_ERRORS[a.error], WRONG_PASSWORD_MSG);
  assert.ok(!/tồn tại|không có tài khoản|not found|exist/i.test(LOGIN_ERRORS[a.error]), 'thông điệp không nói về sự tồn tại tài khoản');
});

test('ANTI-ENUM-2: không có mã/thông điệp riêng cho "không có tài khoản" trong bảng thông điệp; mã lạ ở login không tạo thông điệp tiết lộ', async () => {
  for (const m of Object.values(LOGIN_ERRORS)) assert.ok(!/không tồn tại|không tìm thấy tài khoản|chưa đăng ký|bị khóa|locked|not found/i.test(m), m);
  for (const code of ['USER_NOT_FOUND', 'ACCOUNT_LOCKED', 'ACCOUNT_DISABLED', 'WRONG_PASSWORD']) {
    const { session } = mk(() => err(401, code));
    const s = await session.submit('a@b.vn', PW);
    assert.equal(s.error, 'SESSION_EXPIRED', code + ': mã lạ không được diễn giải thành thông tin về tài khoản'); // không tiết lộ, không là INVALID
    assert.ok(!JSON.stringify(s).includes(code));
  }
});

test('ANTI-ENUM-3: số lần gọi mạng & dạng yêu cầu giống hệt nhau cho định danh tồn tại/không tồn tại (client không rẽ nhánh theo danh tính)', async () => {
  const shapes = [];
  for (const id of ['NV-0007', 'NV-9999', 'x@y.vn']) {
    const { session, calls } = mk(() => err(401, 'LOGIN_INVALID'));
    await session.submit(id, PW);
    shapes.push(calls.map((c) => [c.init.method, c.url.replace(/^http:\/\/api\.test/, ''), Object.keys(c.init.headers).sort().join(',')]));
  }
  assert.deepEqual(shapes[0], shapes[1]);
  assert.deepEqual(shapes[0], shapes[2]);
  assert.equal(shapes[0].length, 1);
});

// ---------- Token cũ / stale / phiên ----------
test('STALE-1: /me 401 AUTH_REQUIRED sau login (token vừa cấp bị thu hồi) -> SESSION_EXPIRED, token sạch, không AUTHENTICATED', async () => {
  const { session } = mk((url) => (url.endsWith('/auth/login') ? loginOk : err(401, 'AUTH_REQUIRED')));
  const s = await session.submit('a@b.vn', PW);
  assert.equal(s.status, 'ERROR');
  assert.equal(s.error, 'SESSION_EXPIRED');
  assert.equal(session.getAuthHeader(), null);
});

test('STALE-2: phiên đang AUTHENTICATED, API khác trả 401 UNAUTHENTICATED/AUTH_REQUIRED -> handleUnauthorized xóa token, SESSION_EXPIRED, không tự đăng nhập lại', async () => {
  for (const code of ['UNAUTHENTICATED', 'AUTH_REQUIRED']) {
    const { session, calls } = mk((url) => (url.endsWith('/auth/login') ? loginOk : meOk));
    await session.submit('a@b.vn', PW);
    assert.equal(session.getState().status, 'AUTHENTICATED', code);
    const before = calls.length;
    const s = session.handleUnauthorized('Bearer ' + TOKEN);
    assert.deepEqual([s.status, s.error], ['ERROR', 'SESSION_EXPIRED'], code);
    assert.equal(session.getAuthHeader(), null);
    assert.equal(calls.length, before, 'không gọi lại login');
    notWrongPassword(s);
  }
});

test('STALE-3: logout với token cũ bị 401 AUTH_REQUIRED -> token cục bộ vẫn bị xóa; lỗi báo SESSION_EXPIRED, không báo sai mật khẩu', async () => {
  const { session } = mk((url) => (url.endsWith('/auth/login') ? loginOk : url.endsWith('/auth/me') ? meOk : err(401, 'AUTH_REQUIRED')));
  await session.submit('a@b.vn', PW);
  const s = await session.logout();
  assert.equal(session.getAuthHeader(), null);
  assert.equal(s.error, 'SESSION_EXPIRED');
  notWrongPassword(s);
});

test('STALE-4: logout gặp 503/mạng -> token cục bộ xóa trước, trạng thái ERROR không báo sai mật khẩu', async () => {
  for (const h of [() => err(503, 'AUTH_UNAVAILABLE'), () => { throw new TypeError('x'); }]) {
    const { session } = mk((url) => (url.endsWith('/auth/login') ? loginOk : url.endsWith('/auth/me') ? meOk : h()));
    await session.submit('a@b.vn', PW);
    const s = await session.logout();
    assert.equal(session.getAuthHeader(), null);
    assert.equal(s.status, 'ERROR');
    notWrongPassword(s);
  }
});

test('CLEANUP-1: thử lại sau lỗi -> thành công; rồi mỗi loại lỗi lần sau đều xóa token cũ (không giữ token phiên trước trong lúc/ sau lỗi)', async () => {
  let mode = 'ok';
  const { session } = mk((url) => {
    if (mode === 'ok') return url.endsWith('/auth/login') ? loginOk : meOk;
    if (mode === 'net') throw new TypeError('x');
    return err(Number(mode), 'X');
  });
  await session.submit('a@b.vn', PW);
  assert.equal(session.getAuthHeader(), 'Bearer ' + TOKEN);
  for (const m of ['net', '401', '429', '503']) {
    await session.submit('a@b.vn', PW); // đăng nhập lại khi đang AUTHENTICATED
    mode = 'ok'; await session.submit('a@b.vn', PW); assert.equal(session.getAuthHeader(), 'Bearer ' + TOKEN, 'khôi phục');
    mode = m;
    const s = await session.submit('a@b.vn', PW);
    assert.equal(s.status, 'ERROR', m);
    assert.equal(session.getAuthHeader(), null, 'token sạch sau lỗi ' + m);
  }
});

// ---------- classifyAuthError thuần: bảng đóng ----------
test('CLASSIFY: lỗi không phải lỗi auth đã biết -> UNKNOWN, không ném, không dùng thông điệp sai mật khẩu', () => {
  for (const e of [new Error('boom'), null, undefined, 'str', { status: 401, code: 'LOGIN_INVALID' }, new AuthHttpError(200, 'BAD_RESPONSE'), new AuthHttpError(403, 'FORBIDDEN'), new AuthHttpError(409, 'X')]) {
    assert.equal(classifyAuthError(e), 'UNKNOWN');
  }
});

test('CLASSIFY: INVALID_CREDENTIALS chỉ xuất hiện cho đúng (401, LOGIN_INVALID); mọi tổ hợp khác không bao giờ cho lớp này', () => {
  const statuses = [200, 400, 401, 403, 404, 405, 409, 429, 500, 501, 502, 503, 504];
  const codes = ['LOGIN_INVALID', 'AUTH_REQUIRED', 'UNAUTHENTICATED', 'LOGIN_THROTTLED', 'AUTH_UNAVAILABLE', 'REQUEST_INVALID', 'REQUEST_FAILED', 'BAD_RESPONSE', ''];
  for (const st of statuses) for (const c of codes) {
    const k = classifyAuthError(new AuthHttpError(st, c));
    assert.equal(k === 'INVALID_CREDENTIALS', st === 401 && c === 'LOGIN_INVALID', `${st}/${c} -> ${k}`);
  }
});

test('LIMIT-1 (GIỚI HẠN ĐÃ BIẾT, LỆCH-4): nếu backend trả 401 LOGIN_INVALID khi kho credential lỗi, frontend KHÔNG phân biệt được với sai mật khẩu', async () => {
  // Đây là hợp đồng backend, không phải lỗi frontend: chống dò tài khoản yêu cầu 401 đồng nhất; muốn hiển thị "dịch vụ lỗi"
  // backend phải trả 503 AUTH_UNAVAILABLE (quyết định chủ sở hữu, PR #84 OWNER_DECISIONS LỆCH-4). Test khóa hành vi hiện tại.
  const { session } = mk(() => err(401, 'LOGIN_INVALID'));
  const s = await session.submit('a@b.vn', PW);
  assert.equal(LOGIN_ERRORS[s.error], WRONG_PASSWORD_MSG);
});
