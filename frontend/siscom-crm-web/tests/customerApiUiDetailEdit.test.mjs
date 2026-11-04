// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// Covers the UI controller for customer detail + edit + client-side search: loading/saving/error states, 401/403/404/409/network, no fallback, no fake save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi, searchCustomers } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const ID2 = '1c0a2d63-4b1f-4d4f-8e7a-1b2c3d4e5f60';
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00007', name: 'Công ty A', phone: '0901234567', version: 2, owner: { id: 'e1', fullName: 'Trần Minh Khoa' }, ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const okServer = (over) => mockFetch((url, init) => (init.method === 'PATCH' ? res(200, { data: apiCust({ version: 3, ...over }) }) : new URL(url).pathname.endsWith('/customers') ? res(200, { data: { items: [apiCust()], total: 1 } }) : res(200, { data: apiCust() })));

test('cờ TẮT: không có controller, không gọi fetch (đường localStorage giữ nguyên)', () => {
  const f = mockFetch(() => { throw new Error('không được gọi'); });
  assert.equal(createCustomerApiUi({ env: {}, fetchImpl: f }), null);
  assert.equal(createCustomerApiUi({ env: { VITE_CRM_API_ENABLED: 'false', VITE_CRM_API_BASE: BASE }, fetchImpl: f }), null);
  assert.equal(f.calls.length, 0);
});

test('loadDetail: loading → ready, GET theo UUID, không gửi credential, giữ id/version/code', async () => {
  const f = okServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const seen = []; c.subscribe(() => seen.push(c.getState().detail.status));
  await c.loadDetail(ID);
  assert.deepEqual(seen, ['loading', 'ready']);
  const d = c.getState().detail;
  assert.equal(d.customer.id, ID); assert.equal(d.customer.code, 'KH-00007'); assert.equal(d.customer.version, 2);
  assert.equal(f.calls[0].url, BASE + '/customers/' + ID); assert.equal(f.calls[0].init.method, 'GET'); assert.equal(f.calls[0].init.credentials, 'omit');
});

test('loadDetail: 401/403/404/409/network hiện đúng loại lỗi, không có customer, không fallback', async () => {
  const cases = [[() => res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }), 'unauthenticated', 401], [() => res(403, { error: { code: 'FORBIDDEN', message: 'x' } }), 'forbidden', 403],
    [() => res(404, { error: { code: 'NOT_FOUND', message: 'x' } }), 'not_found', 404], [() => res(409, { error: { code: 'CONFLICT', message: 'x' } }), 'conflict', 409], [() => { throw new TypeError('Failed to fetch'); }, 'network', undefined]];
  for (const [h, kind, status] of cases) {
    const f = mockFetch(h); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
    await c.loadDetail(ID);
    const d = c.getState().detail;
    assert.equal(d.status, 'error'); assert.equal(d.error.kind, kind); assert.equal(d.error.status, status); assert.equal(d.customer, null);
    assert.equal(f.calls.length, 1);
  }
});

test('loadDetail: id không phải UUID bị từ chối trước khi gọi mạng; sai cờ/thiếu base → config, không fetch', async () => {
  const f = okServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadDetail('KH-00007');
  assert.equal(c.getState().detail.status, 'error'); assert.equal(f.calls.length, 0);
  const f2 = mockFetch(() => { throw new Error('không được gọi'); });
  const c2 = createCustomerApiUi({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f2 });
  await c2.loadDetail(ID);
  assert.equal(c2.getState().detail.error.kind, 'config'); assert.equal(f2.calls.length, 0);
});

test('loadDetail: phản hồi cũ của id khác bị bỏ; lỗi tải mới không hiện khách hàng trước đó', async () => {
  const d1 = deferred();
  const f = mockFetch((url) => (url.endsWith(ID) ? d1.promise : res(200, { data: apiCust({ id: ID2, code: 'KH-00008' }) })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const p1 = c.loadDetail(ID); await c.loadDetail(ID2);
  d1.resolve(res(200, { data: apiCust() })); await p1;
  assert.equal(c.getState().detail.customer.id, ID2);
  const f3 = mockFetch(() => res(404, { error: { code: 'NOT_FOUND', message: 'x' } })); const c3 = createCustomerApiUi({ env: ON, fetchImpl: f3 });
  await c3.loadDetail(ID); await c3.loadDetail(ID);
  assert.equal(c3.getState().detail.customer, null);
});

test('update thành công: PATCH theo UUID với version đã tải, KHÔNG gửi owner/code/id; hiển thị bản ghi server, cập nhật list', async () => {
  const f = okServer({ name: 'Công ty A mới' }); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.load(); await c.loadDetail(ID);
  const seen = []; c.subscribe(() => seen.push(c.getState().update.status));
  const r = await c.update(ID, { name: 'Công ty A mới', phone: '0909999999', owner: 'Hacker', code: 'KH-99999', id: 'x' }, 2);
  assert.equal(r.ok, true); assert.deepEqual(seen, ['saving', 'idle']);
  const patch = f.calls.find((x) => x.init.method === 'PATCH');
  assert.equal(patch.url, BASE + '/customers/' + ID);
  const body = JSON.parse(patch.init.body);
  assert.equal(body.version, 2); assert.equal(body.name, 'Công ty A mới'); assert.equal(body.phone, '0909999999');
  for (const k of ['owner', 'ownerId', 'code', 'id']) assert.equal(k in body, false, k);
  assert.equal(patch.init.credentials, 'omit');
  const s = c.getState();
  assert.equal(s.detail.customer.version, 3); assert.equal(s.detail.customer.name, 'Công ty A mới'); assert.equal(s.list.items[0].name, 'Công ty A mới');
});

test('update: thiếu tên/version bị chặn (04/11/2026: điện thoại không bắt buộc), không gọi PATCH; dữ liệu cũ giữ nguyên', async () => {
  const f = okServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadDetail(ID); const before = c.getState().detail.customer; f.calls.length = 0;
  for (const [input, version, field] of [[{ name: ' ', phone: '1' }, 2, 'name'], [{ name: ' ', phone: '' }, 2, 'name'], [{ name: 'A', phone: '1' }, undefined, 'version']]) {
    const r = await c.update(ID, input, version);
    assert.equal(r.ok, false); assert.equal(r.error.kind, 'validation'); assert.ok(r.error.fieldErrors[field]);
    assert.equal(c.getState().update.status, 'error');
  }
  assert.equal(f.calls.length, 0); assert.equal(c.getState().detail.customer, before);
});

test('update lỗi 401/403/404/409/network: báo lỗi rõ, KHÔNG đổi detail/list, không ghi nhận lưu giả', async () => {
  for (const [h, kind] of [[() => res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }), 'unauthenticated'], [() => res(403, { error: { code: 'FORBIDDEN', message: 'x' } }), 'forbidden'],
    [() => res(404, { error: { code: 'NOT_FOUND', message: 'x' } }), 'not_found'], [() => res(409, { error: { code: 'CONFLICT', message: 'x' } }), 'conflict'], [() => { throw new TypeError('Failed to fetch'); }, 'network']]) {
    const f = mockFetch((url, init) => (init.method === 'PATCH' ? h() : new URL(url).pathname.endsWith('/customers') ? res(200, { data: { items: [apiCust()], total: 1 } }) : res(200, { data: apiCust() })));
    const c = createCustomerApiUi({ env: ON, fetchImpl: f });
    await c.load(); await c.loadDetail(ID);
    const r = await c.update(ID, { name: 'Tên mới', phone: '0909999999' }, 2);
    assert.equal(r.ok, false); assert.equal(r.error.kind, kind);
    const s = c.getState();
    assert.equal(s.update.status, 'error'); assert.equal(s.update.error.kind, kind);
    assert.equal(s.detail.customer.name, 'Công ty A'); assert.equal(s.list.items[0].name, 'Công ty A');
    assert.equal(f.calls.filter((x) => x.init.method === 'PATCH').length, 1, 'không retry/đường khác');
    c.clearSubmitError(); assert.equal(c.getState().update.status, 'idle');
  }
});

test('update: bấm lưu trùng khi đang lưu chỉ gửi một PATCH', async () => {
  const d = deferred();
  const f = mockFetch((url, init) => (init.method === 'PATCH' ? d.promise : res(200, { data: apiCust() })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadDetail(ID);
  const p1 = c.update(ID, { name: 'A', phone: '1' }, 2); const r2 = await c.update(ID, { name: 'A', phone: '1' }, 2);
  assert.equal(r2.duplicate, true); assert.equal(c.getState().update.status, 'saving');
  d.resolve(res(200, { data: apiCust({ version: 3 }) })); assert.equal((await p1).ok, true);
  assert.equal(f.calls.filter((x) => x.init.method === 'PATCH').length, 1);
});

test('update: server trả id khác → malformed, không thay detail', async () => {
  const f = mockFetch((url, init) => (init.method === 'PATCH' ? res(200, { data: apiCust({ id: ID2 }) }) : res(200, { data: apiCust() })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadDetail(ID);
  const r = await c.update(ID, { name: 'A', phone: '1' }, 2);
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'malformed'); assert.equal(c.getState().detail.customer.id, ID);
});

test('searchCustomers: lọc cục bộ không dấu/không phân biệt hoa thường theo tên, mã, MST, SĐT, email, phụ trách; nhiều từ = AND', () => {
  const items = [{ id: ID, code: 'KH-00007', name: 'Công ty Đầu tư Phú An', short: 'Phú An', taxId: '0312345678', phone: '0901234567', email: 'a@pa.vn', owner: 'Trần Minh Khoa', city: 'TP. Hồ Chí Minh' },
    { id: ID2, code: 'KH-00008', name: 'Xây dựng Hòa Bình', short: 'Hòa Bình', taxId: '', phone: '0987654321', email: '', owner: '', city: 'Hà Nội' }];
  assert.equal(searchCustomers(items, '').length, 2); assert.equal(searchCustomers(items, '   ').length, 2);
  assert.deepEqual(searchCustomers(items, 'dau tu').map((c) => c.code), ['KH-00007']);
  assert.deepEqual(searchCustomers(items, 'HOA BINH').map((c) => c.code), ['KH-00008']);
  assert.deepEqual(searchCustomers(items, 'kh-00008').map((c) => c.code), ['KH-00008']);
  assert.deepEqual(searchCustomers(items, '0312345678').map((c) => c.code), ['KH-00007']);
  assert.deepEqual(searchCustomers(items, '0987').map((c) => c.code), ['KH-00008']);
  assert.deepEqual(searchCustomers(items, 'khoa').map((c) => c.code), ['KH-00007']);
  assert.deepEqual(searchCustomers(items, 'phu an ha noi'), []);
  assert.equal(searchCustomers(items, ID).length, 0, 'UUID không phải khoá tìm kiếm');
});
