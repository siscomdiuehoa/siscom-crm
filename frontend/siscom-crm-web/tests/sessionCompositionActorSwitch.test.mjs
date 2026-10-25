// Run: node --test tests/sessionCompositionActorSwitch.test.mjs   (Node >= 18). Test-only; fetch/client giả, token giả, không mạng/DB.
// Cổng ghép #81 (stale-401) + #83 (Authorization opt-in) + #95 (hết hạn/submit sai). #98 (fail-closed quyền UI) không đọc phiên nên không giao nhau ở mức mã.
// actor A -> B (đăng nhập thẳng, không logout) khi yêu cầu của A còn bay; 401 muộn của A không được hủy phiên B.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApi, ApiError, StaleSessionError } from '../src/data/api/customerApiClient.js';
import { createLoginSession } from '../src/auth/loginSession.js';

const TOK_A = 'sid_' + 'A'.repeat(43);
const TOK_B = 'sid_' + 'B'.repeat(43);
const cfg = { enabled: true, baseUrl: 'http://api.test' };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const E401 = { error: { code: 'UNAUTHENTICATED', message: 'x' } };
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

// Hai actor khác nhau (employeeId 7 -> 8), token khác nhau; me() trả danh tính theo token.
function twoActorSession() {
  const byToken = { [TOK_A]: 7, [TOK_B]: 8 }; const order = [TOK_A, TOK_B]; let n = 0;
  return createLoginSession({
    enabled: true,
    login: async () => ({ token: order[Math.min(n++, 1)], expiresAt: '2026-10-25T00:00:00.000Z' }),
    me: async (t) => ({ employeeId: byToken[t] }),
    logout: async () => ({}),
  });
}
function lateRequest(session) {
  const gate = deferred(); const seen = [];
  const api = createCustomerApi(cfg, async (url, init) => { seen.push(init.headers.Authorization); return gate.p; }, { auth: session });
  return { api, gate, seen };
}

test('COMP-1: A→B trực tiếp (không logout); 401 muộn mang Bearer A KHÔNG hủy phiên B (client + loginSession thật)', async () => {
  const s = twoActorSession();
  await s.submit('a@b.vn', 'pw-gia-lap');
  assert.equal(s.getState().employeeId, 7);
  const { api, gate, seen } = lateRequest(s);
  const settled = api.list({}).catch((e) => e);
  assert.deepEqual(seen, ['Bearer ' + TOK_A]);
  await s.submit('a@b.vn', 'pw-gia-lap'); // chuyển sang actor B
  assert.equal(s.getState().employeeId, 8);
  gate.resolve(resp(401, E401));
  const err = await settled;
  assert.ok(err instanceof ApiError && err.status === 401);
  assert.equal(s.getState().status, 'AUTHENTICATED');
  assert.equal(s.getState().employeeId, 8);
  assert.equal(s.getAuthHeader(), 'Bearer ' + TOK_B);
});

test('COMP-2: 401 muộn của A đến khi B còn LOADING — B hoàn tất vẫn AUTHENTICATED', async () => {
  const s = twoActorSession();
  await s.submit('a@b.vn', 'pw-gia-lap');
  const { api, gate } = lateRequest(s);
  const settled = api.get('00000000-0000-4000-8000-000000000001').catch((e) => e);
  const pB = s.submit('a@b.vn', 'pw-gia-lap');
  gate.resolve(resp(401, E401)); await settled;
  await pB;
  assert.equal(s.getState().status, 'AUTHENTICATED');
  assert.equal(s.getState().employeeId, 8);
});

test('COMP-3: 2xx muộn của A sau khi chuyển sang B bị bỏ (StaleSessionError), phiên B giữ nguyên', async () => {
  const s = twoActorSession();
  await s.submit('a@b.vn', 'pw-gia-lap');
  const { api, gate } = lateRequest(s);
  const settled = api.list({}).catch((e) => e);
  await s.submit('a@b.vn', 'pw-gia-lap');
  gate.resolve(resp(200, { data: { items: [], total: 0, page: 1, pageSize: 20 } }));
  assert.ok((await settled) instanceof StaleSessionError);
  assert.equal(s.getAuthHeader(), 'Bearer ' + TOK_B);
});

test('COMP-4: 401 của chính B (header B) vẫn hủy phiên B một lần; yêu cầu kế tiếp bị chặn trước mạng (không gửi Bearer cũ)', async () => {
  const s = twoActorSession();
  await s.submit('a@b.vn', 'pw-gia-lap'); await s.submit('a@b.vn', 'pw-gia-lap');
  const seen = [];
  const api = createCustomerApi(cfg, async (u, init) => { seen.push(init.headers.Authorization); return resp(401, E401); }, { auth: s });
  assert.ok((await api.list({}).catch((e) => e)) instanceof ApiError);
  assert.equal(s.getState().error, 'SESSION_EXPIRED');
  assert.equal(s.getAuthHeader(), null);
  await api.list({}).catch(() => {});
  assert.deepEqual(seen, ['Bearer ' + TOK_B]);
});

test('COMP-5 (#95): B nhập sai (submit không hợp lệ) xóa token B; 401 muộn của A sau đó không đổi gì, không ném lỗi', async () => {
  const s = twoActorSession();
  await s.submit('a@b.vn', 'pw-gia-lap');
  const headerA = s.getAuthHeader();
  await s.submit('a@b.vn', 'pw-gia-lap');
  await s.submit('', ''); // sai khi AUTHENTICATED => ERROR + xóa token
  assert.equal(s.getState().status, 'ERROR');
  assert.equal(s.getAuthHeader(), null);
  const before = JSON.stringify(s.getState());
  assert.doesNotThrow(() => s.handleUnauthorized(headerA));
  assert.equal(JSON.stringify(s.getState()), before);
});
