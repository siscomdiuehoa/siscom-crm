// Run: node --test tests/ — Customer API client ở chế độ PHIÊN COOKIE (options.session). fetch giả, không mạng.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApi, AuthRequiredError, StaleSessionError } from '../src/data/api/customerApiClient.js';
import { createCustomerRepository } from '../src/data/api/customerRepository.js';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';

const CSRF = 'c'.repeat(43);
const UUID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const apiCust = (over = {}) => ({ id: UUID, code: 'KH-00007', name: 'Công ty A', phone: '0901234567', version: 1, ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cfg = { enabled: true, baseUrl: '/api/v1' };
const ENV = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: '/api/v1' };

// Phiên giả tối thiểu cùng giao diện với createCookieSession.
function fakeSession(status = 'AUTHENTICATED', csrf = CSRF) {
  let st = { status, employeeId: status === 'AUTHENTICATED' ? 'e1' : null, me: null };
  const calls = { unauthorized: 0 };
  return {
    calls,
    getState: () => st,
    getCsrfToken: () => (st.status === 'AUTHENTICATED' ? csrf : null),
    getAuthHeader: () => null,
    subscribe: () => () => {},
    handleUnauthorized() { calls.unauthorized++; st = { status: 'ERROR', employeeId: null, me: null }; },
    setState(s) { st = s; },
  };
}
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };

test('GET: credentials include, KHÔNG X-CSRF-Token, không Authorization', async () => {
  const f = mockFetch(() => res(200, { data: { items: [apiCust()], total: 1 } }));
  const api = createCustomerApi(cfg, f, { session: fakeSession() });
  await api.list({ page: 1 });
  assert.equal(f.calls[0].init.credentials, 'include');
  assert.equal(f.calls[0].init.headers['X-CSRF-Token'], undefined);
  assert.equal(f.calls[0].init.headers.Authorization, undefined);
});

test('POST/PATCH: kèm X-CSRF-Token từ phiên; thiếu CSRF => AuthRequiredError trước khi gọi mạng', async () => {
  const f = mockFetch((url, init) => res(init.method === 'POST' ? 201 : 200, { data: apiCust() }));
  const api = createCustomerApi(cfg, f, { session: fakeSession() });
  await api.create({ name: 'A', phone: '0901234567' }, null);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers['X-CSRF-Token'], CSRF);
  await api.update(UUID, { name: 'A', phone: '0901234567' }, null, 1);
  assert.equal(f.calls[1].init.headers['X-CSRF-Token'], CSRF);
  const noCsrf = createCustomerApi(cfg, mockFetch(() => { throw new Error('không được gọi'); }), { session: fakeSession('AUTHENTICATED', null) });
  await assert.rejects(() => noCsrf.create({ name: 'A', phone: '0901234567' }, null), AuthRequiredError);
});

test('chưa AUTHENTICATED => AuthRequiredError, không gọi mạng', async () => {
  const f = mockFetch(() => { throw new Error('không được gọi'); });
  for (const st of ['IDLE', 'LOADING', 'ERROR', 'UNAVAILABLE']) {
    const api = createCustomerApi(cfg, f, { session: fakeSession(st) });
    await assert.rejects(() => api.list({}), AuthRequiredError, st);
  }
  assert.equal(f.calls.length, 0);
});

test('401 từ API => session.handleUnauthorized() được gọi, lỗi 401 vẫn ném; 403 không hủy phiên', async () => {
  const s = fakeSession();
  const api = createCustomerApi(cfg, mockFetch(() => res(401, { error: { code: 'UNAUTHENTICATED' } })), { session: s });
  await assert.rejects(() => api.list({}), (e) => e.status === 401);
  assert.equal(s.calls.unauthorized, 1);
  const s2 = fakeSession();
  const api2 = createCustomerApi(cfg, mockFetch(() => res(403, { error: { code: 'FORBIDDEN' } })), { session: s2 });
  await assert.rejects(() => api2.list({}), (e) => e.status === 403);
  assert.equal(s2.calls.unauthorized, 0);
});

test('phiên đổi (đăng xuất/đăng nhập người khác) trong lúc chờ => StaleSessionError, không trả dữ liệu cũ', async () => {
  const s = fakeSession();
  const api = createCustomerApi(cfg, mockFetch(async () => { s.setState({ status: 'AUTHENTICATED', employeeId: 'e2', me: null }); return res(200, { data: { items: [], total: 0 } }); }), { session: s });
  await assert.rejects(() => api.list({}), StaleSessionError);
});

test('repository + createCustomerApiUi chuyển tiếp session (không cần auth bearer)', async () => {
  const f = mockFetch(() => res(200, { data: { items: [apiCust()], total: 1 } }));
  const repo = createCustomerRepository({ env: ENV, fetchImpl: f, session: fakeSession() });
  await repo.list({});
  assert.equal(f.calls[0].init.credentials, 'include');
  const off = createCustomerRepository({ env: ENV, fetchImpl: mockFetch(() => { throw new Error('x'); }), session: fakeSession('IDLE') });
  await assert.rejects(() => off.list({}), (e) => e.kind === 'unauthenticated');
  const ctl = createCustomerApiUi({ env: ENV, fetchImpl: f, session: fakeSession() });
  await ctl.load();
  assert.equal(ctl.getState().list.status, 'ready');
  assert.equal(f.calls.every((c) => c.init.credentials === 'include'), true);
});

test('không session và không auth: hành vi cũ giữ nguyên (credentials omit, không header)', async () => {
  const f = mockFetch(() => res(200, { data: { items: [], total: 0 } }));
  await createCustomerApi(cfg, f).list({});
  assert.equal(f.calls[0].init.credentials, 'omit');
  assert.equal(f.calls[0].init.headers['X-CSRF-Token'], undefined);
});
