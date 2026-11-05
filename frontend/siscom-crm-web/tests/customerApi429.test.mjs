// Run: node --test tests/customerApi429.test.mjs   (Node >= 18, không cần dependency. Injected fetch only; no network, no DB, no storage.)
// Hồi quy đường lỗi HTTP 429 (rate limit) của Customer API: kind 'http' (KHÔNG phải validation/bad_request/server/denied),
// không rơi về dữ liệu cục bộ, không tự thử lại, không hủy phiên như 401, và không gửi request khi chưa có actor (fail-closed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiController, describeRepoError } from '../src/features/customers/customerApiUi.js';
import { createCustomerRepository, CustomerRepoError } from '../src/data/api/customerRepository.js';
import { createCustomerApi, AuthRequiredError } from '../src/data/api/customerApiClient.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const THROTTLED = () => res(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'Quá nhiều yêu cầu' } });
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00007', name: 'Công ty A', phone: '0901234567', version: 1, ...over });
const mockFetch = (handler) => { const calls = []; const f = async (url, init = {}) => { calls.push({ url, method: init.method || 'GET' }); return handler(url, init, calls); }; f.calls = calls; return f; };
const ctl = (f) => createCustomerApiController(createCustomerRepository({ env: ON, fetchImpl: f }));

test('429 ở mọi thao tác repository -> CustomerRepoError kind "http" (status 429), không bị gộp với validation/bad_request/server/401/403', async () => {
  const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(THROTTLED) });
  const ops = [() => repo.list({ page: 1, pageSize: 20 }), () => repo.get(ID), () => repo.create({ name: 'Công ty A', phone: '0901234567' }), () => repo.update(ID, { name: 'B', phone: '0901234567' }, 1)];
  for (const op of ops) {
    await assert.rejects(op, (e) => {
      assert.ok(e instanceof CustomerRepoError);
      assert.equal(e.kind, 'http'); assert.equal(e.status, 429); assert.equal(e.code, 'TOO_MANY_REQUESTS');
      assert.ok(e.message.includes('429'));
      assert.ok(!['validation', 'bad_request', 'server', 'unauthenticated', 'forbidden', 'conflict'].includes(e.kind));
      return true;
    });
  }
});

test('429 body không phải JSON / thiếu error: vẫn kind "http", mã REQUEST_FAILED', async () => {
  const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => ({ ok: false, status: 429, json: async () => { throw new SyntaxError('Unexpected token <'); } })) });
  await assert.rejects(() => repo.list({}), (e) => e.kind === 'http' && e.status === 429 && e.code === 'REQUEST_FAILED');
});

test('describeRepoError(429): retryable thủ công, KHÔNG denied, không field error, không staleVersion; khác validation (lỗi phía client, không retry)', async () => {
  const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(THROTTLED) });
  const d429 = describeRepoError(await repo.list({}).catch((e) => e));
  assert.equal(d429.kind, 'http'); assert.equal(d429.status, 429); assert.equal(d429.title, 'Yêu cầu thất bại');
  assert.equal(d429.retryable, true); assert.equal(d429.denied, false); assert.equal(d429.staleVersion, false);
  assert.deepEqual(d429.fieldErrors, {}); assert.deepEqual(d429.extra, []);
  const dVal = describeRepoError(new CustomerRepoError('validation', 'Tên bắt buộc', { field: 'name' }));
  assert.equal(dVal.kind, 'validation'); assert.equal(dVal.retryable, false); assert.deepEqual(dVal.fieldErrors, { name: 'Tên bắt buộc' });
  assert.notEqual(d429.kind, dVal.kind);
  // 429 không bao giờ sinh fieldErrors dù details có hình dạng giống 400
  const sneaky = describeRepoError(new CustomerRepoError('http', 'x', { status: 429, details: ['name must not be empty'] }));
  assert.deepEqual(sneaky.fieldErrors, {}); assert.deepEqual(sneaky.extra, []);
});

test('controller: list 429 -> lỗi hiển thị, items rỗng (không dữ liệu cục bộ), KHÔNG tự thử lại; bấm tải lại mới gọi lại với đúng params và hồi phục', async () => {
  let n = 0;
  const f = mockFetch(() => (++n === 1 ? THROTTLED() : res(200, { data: { items: [apiCust()], total: 1 } })));
  const c = ctl(f);
  await c.load({ page: 2, pageSize: 10, search: 'abc' });
  const s = c.getState().list;
  assert.equal(s.status, 'error'); assert.deepEqual(s.items, []); assert.equal(s.paging, null);
  assert.equal(s.error.kind, 'http'); assert.equal(s.error.retryable, true); assert.equal(s.error.denied, false);
  assert.equal(f.calls.length, 1); // không tự thử lại
  await c.reload();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].url, f.calls[0].url);
  assert.equal(c.getState().list.status, 'ready'); assert.equal(c.getState().list.items.length, 1);
});

test('controller: create 429 -> submit.error kind http, không reload danh sách, không tạo trùng; gửi lại được sau lỗi', async () => {
  let posts = 0;
  const f = mockFetch((url, init) => {
    if (init.method === 'POST') return ++posts === 1 ? THROTTLED() : res(201, { data: apiCust() });
    return res(200, { data: { items: [], total: 0 } });
  });
  const c = ctl(f);
  await c.load();
  const gets = f.calls.length;
  const input = { name: 'Công ty A', phone: '0901234567' };
  const r1 = await c.submit(input);
  assert.equal(r1.ok, false); assert.equal(r1.error.kind, 'http'); assert.equal(r1.error.status, 429);
  assert.equal(c.getState().submit.status, 'error'); assert.equal(f.calls.length, gets + 1); // đúng 1 POST, chưa reload
  const r2 = await c.submit(input);
  assert.equal(r2.ok, true); assert.equal(posts, 2);
});

test('controller: update 429 -> giữ nguyên bản ghi cũ, không mở luồng xung đột 409, không reload', async () => {
  const f = mockFetch((url, init) => (init.method === 'PATCH' ? THROTTLED() : res(200, { data: apiCust() })));
  const c = ctl(f);
  await c.loadDetail(ID);
  const before = c.getState().detail.customer; const calls = f.calls.length;
  const r = await c.update(ID, { name: 'Tên mới', phone: '0901234567' }, before.version);
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'http'); assert.equal(r.error.staleVersion, false);
  const u = c.getState().update;
  assert.equal(u.status, 'error'); assert.equal(u.conflict, null);
  assert.equal(c.getState().detail.customer, before); assert.equal(f.calls.length, calls + 1);
});

test('controller: lookups 429 không phải "denied" nên mở lại biểu mẫu được thử tải lại (khác 401/403 bị chặn tự thử lại)', async () => {
  const mk = (status) => { const f = mockFetch(() => res(status, { error: { code: 'X', message: 'x' } })); return [f, ctl(f)]; };
  const [f429, c429] = mk(429);
  await c429.loadLookups(); assert.equal(c429.getState().lookups.error.kind, 'http'); assert.equal(c429.getState().lookups.error.denied, false);
  const n = f429.calls.length; await c429.loadLookups(); assert.ok(f429.calls.length > n);
  const [f401, c401] = mk(401);
  await c401.loadLookups(); assert.equal(c401.getState().lookups.error.denied, true);
  const m = f401.calls.length; await c401.loadLookups(); assert.equal(f401.calls.length, m);
});

test('fail-closed: chưa có actor/phiên -> KHÔNG gọi fetch (AuthRequiredError); 429 không hủy phiên như 401 và không cấp quyền', async () => {
  const cfg = { enabled: true, baseUrl: BASE };
  // không có phiên xác thực: không request, không tới được 429
  const f0 = mockFetch(THROTTLED);
  const anon = createCustomerApi(cfg, f0, { auth: { getState: () => ({ status: 'ANONYMOUS' }), getAuthHeader: () => null, handleUnauthorized() { throw new Error('không được gọi'); } } });
  await assert.rejects(() => anon.list({}), (e) => e instanceof AuthRequiredError);
  assert.equal(f0.calls.length, 0);
  // có phiên: 429 là lỗi http thường, KHÔNG gọi handleUnauthorized (401 mới hủy phiên)
  let revoked = 0; const H = 'Bearer test.token-value';
  const auth = { getState: () => ({ status: 'AUTHENTICATED' }), getAuthHeader: () => H, handleUnauthorized() { revoked++; } };
  const f1 = mockFetch(THROTTLED);
  await assert.rejects(() => createCustomerApi(cfg, f1, { auth }).list({}), (e) => e.status === 429 && e.code === 'TOO_MANY_REQUESTS');
  assert.equal(f1.calls.length, 1); assert.equal(revoked, 0);
  // đối chứng: 401 thì có hủy phiên
  await assert.rejects(() => createCustomerApi(cfg, mockFetch(() => res(401, { error: { code: 'UNAUTHENTICATED' } })), { auth }).list({}), (e) => e.status === 401);
  assert.equal(revoked, 1);
});

test('cờ TẮT / cấu hình thiếu: không fetch, không sinh 429 (kind disabled/config, không phải http)', async () => {
  const f = mockFetch(THROTTLED);
  const off = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'false', VITE_CRM_API_BASE: BASE }, fetchImpl: f, local: { list: () => [] } });
  assert.equal(off.mode, 'local'); await off.list({});
  const mis = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f });
  await assert.rejects(() => mis.list({}), (e) => e.kind === 'config');
  assert.equal(f.calls.length, 0);
});

test('phân biệt: dữ liệu thiếu (tên) -> kind "validation" phía client, KHÔNG gửi request nên không thể là 429', async () => {
  const f = mockFetch(THROTTLED);
  const repo = createCustomerRepository({ env: ON, fetchImpl: f });
  await assert.rejects(() => repo.create({ name: '', phone: '0901234567' }), (e) => e.kind === 'validation' && e.field === 'name' && e.status === undefined);
  await assert.rejects(() => repo.update(ID, { name: ' ', phone: '' }, 1), (e) => e.kind === 'validation' && e.field === 'name'); // 04/11/2026: phone không bắt buộc
  assert.equal(f.calls.length, 0);
});
