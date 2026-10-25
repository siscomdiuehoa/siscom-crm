// Run: node --test tests/loginSessionExpiryRevoke.test.mjs   (Node >= 18). Offline: client giả + promise điều khiển được + đồng hồ giả; không mạng/DB/bí mật thật.
// Cổng chất lượng phiên: hết hạn access token, thu hồi phía server, logout giữa chừng, nhiều tab, 401 muộn.
// Chạy MÃ THẬT createLoginSession (epoch + token trong bộ nhớ). KHÔNG có refresh trong src => KHÔNG bịa hợp đồng refresh; phần refresh chỉ kiểm
// rằng credential refresh (nếu server lỡ trả) không bao giờ trở thành Bearer/không lọt vào state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginSession } from '../src/auth/loginSession.js';
import { AuthHttpError } from '../src/auth/authClient.js';

const PW = 'pw-gia-lap-cho-test';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));
const issued = (t, extra = {}) => ({ token: t, expiresAt: '2026-10-24T00:00:00.000Z', ...extra });
function ctl() {
  const q = { login: [], me: [], logout: [] };
  const mk = (k) => { const d = deferred(); q[k].push(d); return d.promise; };
  const client = { enabled: true, login: () => mk('login'), me: () => mk('me'), logout: () => mk('logout') };
  const session = createLoginSession(client);
  const seen = []; // mọi trạng thái đã phát cho người nghe: dùng chứng minh "không sống lại"
  session.subscribe((s) => seen.push(s.status));
  return { q, session, seen };
}
async function loginAs(c, n, tok, extra) {
  const p = c.session.submit('a@b.vn', PW);
  c.q.login[n].resolve(issued(tok, extra)); await tick(); c.q.me[n].resolve({ employeeId: 7 }); await p;
}

// ---- Lỗi thật (RED trước khi sửa): nhập sai khi đang AUTHENTICATED để lại token sống trong trạng thái ERROR ----
for (const [name, id, pw] of [['mã/email sai', 'khong hop le', PW], ['mật khẩu rỗng', 'a@b.vn', ''], ['mật khẩu quá dài', 'a@b.vn', 'x'.repeat(5000)]]) {
  test(`EXP-1 (${name}): submit không hợp lệ khi đang AUTHENTICATED — ERROR đi cùng token đã xóa (không "ERROR nhưng vẫn gửi Bearer")`, async () => {
    const c = ctl();
    await loginAs(c, 0, 'TOK-A');
    await c.session.submit(id, pw);
    assert.equal(c.session.getState().status, 'ERROR');
    assert.equal(c.session.getAuthHeader(), null);
  });
}

test('EXP-2: submit không hợp lệ khi logout đang chờ server — logout trễ hoàn tất không làm token sống lại, không AUTHENTICATED', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  const lp = c.session.logout();
  await c.session.submit('', PW);
  c.q.logout[0].resolve(); await lp;
  assert.equal(c.session.getAuthHeader(), null);
  assert.notEqual(c.session.getState().status, 'AUTHENTICATED');
});

// ---- Hết hạn access token (đồng hồ giả) ----
test('EXP-3: expiresAt được công khai để người gọi so với đồng hồ; 401 từ server khi token hết hạn xóa token và báo SESSION_EXPIRED', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  const exp = Date.parse(c.session.getState().expiresAt);
  let now = Date.parse('2026-10-23T12:00:00.000Z'); // đồng hồ giả
  assert.ok(now < exp);
  now = exp + 1; // hết hạn
  assert.ok(now > exp);
  c.session.handleUnauthorized(c.session.getAuthHeader()); // server trả 401 cho yêu cầu mang token hết hạn
  assert.equal(c.session.getState().error, 'SESSION_EXPIRED');
  assert.equal(c.session.getAuthHeader(), null);
  assert.equal(c.session.getState().expiresAt, null);
});

test('EXP-4 (GAP hiện trạng, KHÔNG phải chính sách đã chốt): loginSession không có đồng hồ — quá expiresAt vẫn AUTHENTICATED/còn Bearer cho tới khi server trả 401', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse(c.session.getState().expiresAt) + 3_600_000; // 1 giờ sau hạn
    assert.equal(c.session.getState().status, 'AUTHENTICATED');
    assert.equal(c.session.getAuthHeader(), 'Bearer TOK-A');
  } finally { Date.now = realNow; }
});

// ---- Thu hồi phía server / không sống lại ----
test('EXP-5: hai yêu cầu song song cùng nhận 401 (token bị thu hồi) — idempotent, không ném, vẫn ERROR/SESSION_EXPIRED', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  const h = c.session.getAuthHeader();
  c.session.handleUnauthorized(h);
  assert.doesNotThrow(() => c.session.handleUnauthorized(h));
  assert.equal(c.session.getState().status, 'ERROR');
  assert.equal(c.session.getState().error, 'SESSION_EXPIRED');
  assert.equal(c.session.getAuthHeader(), null);
});

test('EXP-6: logout khi login() còn chờ rồi login() cũ thành công — không phát AUTHENTICATED nào, token null, về IDLE', async () => {
  const c = ctl();
  const p = c.session.submit('a@b.vn', PW);
  await c.session.logout();
  c.q.login[0].resolve(issued('TOK-OLD')); await tick();
  c.q.me[0]?.resolve({ employeeId: 7 }); // nếu /me bị gọi bằng token cũ thì cũng không được tạo phiên
  await p;
  assert.ok(!c.seen.includes('AUTHENTICATED'));
  assert.equal(c.session.getAuthHeader(), null);
  assert.equal(c.session.getState().status, 'IDLE');
});

test('EXP-7: logout khi me() còn chờ — me() cũ thành công muộn KHÔNG tạo phiên; token cũ không được giữ', async () => {
  const c = ctl();
  const p = c.session.submit('a@b.vn', PW);
  c.q.login[0].resolve(issued('TOK-OLD')); await tick();
  await c.session.logout();
  c.q.me[0].resolve({ employeeId: 7 }); await p;
  assert.ok(!c.seen.includes('AUTHENTICATED'));
  assert.equal(c.session.getAuthHeader(), null);
});

test('EXP-8: 401 muộn của lần đăng nhập CŨ (phiên bị thu hồi) khi đăng nhập mới đang LOADING — lần mới không bị hủy, vẫn AUTHENTICATED', async () => {
  const c = ctl();
  const p1 = c.session.submit('a@b.vn', PW);
  c.q.login[0].resolve(issued('TOK-1')); await tick();
  await c.session.logout();
  const p2 = c.session.submit('a@b.vn', PW);
  c.q.me[0].reject(new AuthHttpError(401, 'AUTH_REQUIRED')); await p1;
  assert.equal(c.session.getState().status, 'LOADING');
  c.q.login[1].resolve(issued('TOK-2')); await tick(); c.q.me[1].resolve({ employeeId: 7 }); await p2;
  assert.equal(c.session.getState().status, 'AUTHENTICATED');
  assert.equal(c.session.getAuthHeader(), 'Bearer TOK-2');
});

// ---- Nhiều tab: mỗi tab một bộ nhớ riêng ----
test('EXP-9: hai tab = hai session độc lập — token riêng; 401 của tab bị thu hồi không làm mất phiên tab kia', async () => {
  const a = ctl(); const b = ctl();
  await loginAs(a, 0, 'TOK-TAB-A'); await loginAs(b, 0, 'TOK-TAB-B');
  assert.notEqual(a.session.getAuthHeader(), b.session.getAuthHeader());
  a.session.handleUnauthorized(a.session.getAuthHeader());
  assert.equal(a.session.getAuthHeader(), null);
  assert.equal(b.session.getState().status, 'AUTHENTICATED');
  assert.equal(b.session.getAuthHeader(), 'Bearer TOK-TAB-B');
});

test('EXP-10: tab A logout (server thu hồi) — tab B chưa biết (không có kênh liên tab): 401 thì tự dọn, không tự đăng nhập lại', async () => {
  const a = ctl(); const b = ctl();
  await loginAs(a, 0, 'TOK-SHARED'); await loginAs(b, 0, 'TOK-SHARED');
  const lp = a.session.logout(); a.q.logout[0].resolve(); await lp;
  assert.equal(b.session.getAuthHeader(), 'Bearer TOK-SHARED'); // hành vi hiện tại: B chỉ biết khi server trả 401
  b.session.handleUnauthorized(b.session.getAuthHeader());
  assert.equal(b.session.getAuthHeader(), null);
  assert.equal(b.q.login.length, 1, 'không tự gọi login lại');
});

// ---- Credential refresh không phải Bearer ----
test('EXP-11: server lỡ trả refreshToken/csrf trong thân login — Bearer chỉ là access token; refresh không lọt vào state/header', async () => {
  const c = ctl();
  const RT = 'RT-' + 'x'.repeat(40);
  await loginAs(c, 0, 'TOK-ACCESS', { refreshToken: RT, csrfToken: 'CSRF-FAKE', refresh_token: RT });
  assert.equal(c.session.getAuthHeader(), 'Bearer TOK-ACCESS');
  const dump = JSON.stringify(c.session.getState());
  assert.ok(!dump.includes(RT) && !dump.includes('CSRF-FAKE'));
  c.session.handleUnauthorized(c.session.getAuthHeader());
  assert.notEqual(c.session.getAuthHeader(), 'Bearer ' + RT);
  assert.equal(c.session.getAuthHeader(), null);
});

test('EXP-12: chuỗi thao tác hỗn hợp (401, logout, 401 không đối số, submit sai) — không còn đường nào trả Bearer, state không chứa token', async () => {
  const c = ctl();
  await loginAs(c, 0, 'TOK-A');
  c.session.handleUnauthorized(c.session.getAuthHeader());
  await c.session.logout();
  c.session.handleUnauthorized();
  await c.session.submit('', '');
  assert.equal(c.session.getAuthHeader(), null);
  assert.ok(!JSON.stringify(c.session.getState()).includes('TOK-A'));
});
