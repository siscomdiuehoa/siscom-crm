// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi, createCustomerApiController, describeRepoError, customerDisplayCode, formToCustomerInput } from '../src/features/customers/customerApiUi.js';
import { createCustomerRepository, CustomerRepoError } from '../src/data/api/customerRepository.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const UUID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const apiCust = (over = {}) => ({ id: UUID, code: 'KH-00007', name: 'Công ty A', phone: '0901234567', version: 1, ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const apiOk = (over) => mockFetch((url, init) => (init.method === 'POST' ? res(201, { data: apiCust(over) }) : res(200, { data: { items: [apiCust()], total: 1 } })));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('cờ TẮT: createCustomerApiUi trả null và không bao giờ gọi fetch', () => {
  for (const env of [undefined, {}, { VITE_CRM_API_ENABLED: 'false', VITE_CRM_API_BASE: BASE }, { VITE_CRM_API_ENABLED: '1', VITE_CRM_API_BASE: BASE }, { VITE_CRM_API_BASE: BASE }]) {
    const f = mockFetch(() => { throw new Error('không được gọi'); });
    assert.equal(createCustomerApiUi({ env, fetchImpl: f }), null);
    assert.equal(f.calls.length, 0);
  }
});

test('cờ BẬT: load → loading rồi ready với dữ liệu server; mã hiển thị tách khỏi UUID', async () => {
  const f = apiOk();
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const seen = []; c.subscribe(() => seen.push(c.getState().list.status));
  await c.load();
  assert.deepEqual(seen, ['loading', 'ready']);
  const [row] = c.getState().list.items;
  assert.equal(row.id, UUID); assert.equal(customerDisplayCode(row), 'KH-00007'); assert.notEqual(customerDisplayCode(row), row.id);
  assert.equal(customerDisplayCode({ id: UUID }), '—');
  assert.equal(f.calls[0].init.credentials, 'omit'); assert.equal(f.calls[0].url, BASE + '/customers?page=1&pageSize=20');
});

test('cờ BẬT: lỗi list (401/403/network/config) hiện rõ, KHÔNG rơi về dữ liệu cục bộ, items rỗng', async () => {
  for (const [mk, kind] of [[() => mockFetch(() => res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })), 'unauthenticated'], [() => mockFetch(() => res(403, { error: { code: 'FORBIDDEN', message: 'x' } })), 'forbidden'], [() => mockFetch(() => { throw new TypeError('Failed to fetch'); }), 'network']]) {
    const f = mk(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
    await c.load();
    const s = c.getState().list;
    assert.equal(s.status, 'error'); assert.equal(s.error.kind, kind); assert.deepEqual(s.items, []);
    assert.equal(f.calls.length, 1, 'không thử lại/đi đường khác');
  }
  const f = mockFetch(() => { throw new Error('không được gọi'); });
  const c = createCustomerApiUi({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f });
  await c.load();
  assert.equal(c.getState().list.error.kind, 'config'); assert.equal(f.calls.length, 0);
});

test('create thành công: POST không gửi owner, chèn bản ghi server vào đầu danh sách, trả mã KH', async () => {
  const f = apiOk({ id: 'aaaaaaaa-0000-4000-8000-000000000001', code: 'KH-00008' });
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.load();
  const r = await c.submit(formToCustomerInput({ name: ' Công ty B ', phone: '0909', owner: 'Ai Đó', cName: 'X', cPhone: '1', tier: '', status: '', short: '', taxId: '' }));
  assert.equal(r.ok, true); assert.equal(r.customer.code, 'KH-00008');
  const post = f.calls.find((x) => x.init.method === 'POST');
  const body = JSON.parse(post.init.body);
  assert.equal(body.name, 'Công ty B'); assert.equal('owner' in body, false); assert.equal('cName' in body, false);
  assert.equal(c.getState().list.items[0].code, 'KH-00008'); assert.equal(c.getState().list.items.length, 2);
  assert.equal(c.getState().submit.status, 'idle');
});

test('chống gửi trùng: submit lần 2 khi đang lưu không gọi repo.create thêm lần nào', async () => {
  const d = deferred(); let creates = 0;
  const c = createCustomerApiController({ mode: 'api', list: async () => ({ items: [] }), create: () => { creates++; return d.promise; } });
  const p1 = c.submit({ name: 'A', phone: '1' });
  assert.equal(c.getState().submit.status, 'saving');
  assert.deepEqual(await c.submit({ name: 'A', phone: '1' }), { ok: false, duplicate: true });
  d.resolve(apiCust());
  assert.equal((await p1).ok, true); assert.equal(creates, 1);
  // sau khi xong có thể lưu lại bình thường
  d.promise.then(() => {}); assert.equal((await c.submit({ name: 'B', phone: '2' })).ok, true); assert.equal(creates, 2);
});

test('lỗi create: 400 theo trường, 401, 403, 409, mạng, cấu hình — không có fallback, không mất dữ liệu danh sách', async () => {
  const cases = [
    [400, { error: { code: 'VALIDATION', message: 'Dữ liệu không hợp lệ', details: ['phone must be a valid phone number', 'shortName must be shorter than 50', 'lạ: không rõ trường'] } }, 'bad_request'],
    [401, { error: { code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' } }, 'unauthenticated'],
    [403, { error: { code: 'FORBIDDEN', message: 'Không có quyền' } }, 'forbidden'],
    [409, { error: { code: 'DUPLICATE', message: 'Trùng MST' } }, 'conflict'],
  ];
  for (const [status, body, kind] of cases) {
    const f = mockFetch((url, init) => (init.method === 'POST' ? res(status, body) : res(200, { data: { items: [apiCust()] } })));
    const c = createCustomerApiUi({ env: ON, fetchImpl: f }); await c.load();
    const r = await c.submit({ name: 'A', phone: '1' });
    assert.equal(r.ok, false); assert.equal(r.error.kind, kind); assert.equal(r.error.status, status);
    assert.equal(c.getState().submit.status, 'error'); assert.equal(c.getState().list.items.length, 1, 'không thêm bản ghi giả');
    if (status === 400) { assert.equal(r.error.fieldErrors.phone.startsWith('phone'), true); assert.ok(r.error.fieldErrors.short); assert.deepEqual(r.error.extra, ['lạ: không rõ trường']); }
    if (status === 409) assert.match(r.error.message, /Xung đột/);
    c.clearSubmitError(); assert.equal(c.getState().submit.status, 'idle');
  }
  const net = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(() => { throw new TypeError('x'); }) });
  const rn = await net.submit({ name: 'A', phone: '1' }); assert.equal(rn.error.kind, 'network'); assert.equal(rn.error.retryable, true);
  const cfg = createCustomerApiUi({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: mockFetch(() => { throw new Error('không được gọi'); }) });
  assert.equal((await cfg.submit({ name: 'A', phone: '1' })).error.kind, 'config');
});

test('lỗi validation phía client (nhãn danh mục lạ) gắn đúng trường và không gọi POST', async () => {
  const f = mockFetch((url) => (url.includes('/lookups') ? res(200, { data: { customer_tier: [], customer_status: [], industry: [], source: [], province: [] } }) : res(201, { data: apiCust() })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const r = await c.submit({ name: 'A', phone: '1', industry: 'Ngành lạ' });
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'validation'); assert.ok(r.error.fieldErrors.industry);
  assert.equal(f.calls.some((x) => x.init.method === 'POST'), false);
  const r2 = await createCustomerApiUi({ env: ON, fetchImpl: f }).submit({ name: '', phone: '1' });
  assert.ok(r2.error.fieldErrors.name);
});

test('không có localStorage nào bị chạm khi ON (thành công hoặc lỗi)', async () => {
  const touched = []; globalThis.localStorage = new Proxy({}, { get: (_, k) => { touched.push(k); return () => null; } });
  try {
    const c = createCustomerApiUi({ env: ON, fetchImpl: apiOk() });
    await c.load(); await c.submit({ name: 'A', phone: '1' });
    const bad = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(() => res(401, {})) });
    await bad.load(); await bad.submit({ name: 'A', phone: '1' });
  } finally { delete globalThis.localStorage; }
  assert.deepEqual(touched, []);
});

test('describeRepoError: lỗi lạ → unknown, không ném', () => {
  assert.equal(describeRepoError(new Error('boom')).kind, 'unknown');
  assert.equal(describeRepoError(new CustomerRepoError('forbidden', 'm', { status: 403 })).title, 'Không đủ quyền');
});
