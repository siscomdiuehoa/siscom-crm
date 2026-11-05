// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// Covers repository get(id) + update(id, ui, version): flag OFF/misconfigured, success, unknown id, validation, no credentials, strict fail-closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerRepository, CustomerRepoError } from '../src/data/api/customerRepository.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const LOOKUPS = {
  customer_tier: [{ code: 'VIP', label: 'VIP' }], customer_status: [{ code: 'ACTIVE', label: 'Đang giao dịch' }],
  industry: [{ code: 'REAL_ESTATE', label: 'Bất động sản' }], source: [{ code: 'REFERRAL', label: 'Giới thiệu' }], province: [{ code: 'HCM', label: 'TP. Hồ Chí Minh' }],
};
const apiCust = (over = {}) => ({
  id: ID, code: 'KH-00007', name: 'Công ty A', phone: '0901234567', tier: { code: 'VIP', label: 'VIP' }, province: { code: 'HCM', label: 'TP. Hồ Chí Minh' },
  owner: { id: 'e1', fullName: 'Trần Minh Khoa' }, version: 2, ...over,
});
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no json'); return body; } });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const throwingFetch = () => { throw new Error('fetch không được gọi'); };
const noCreds = (calls) => { for (const c of calls) { assert.equal(c.init.credentials, 'omit'); assert.equal(Object.keys(c.init.headers).some((k) => /authorization|cookie/i.test(k)), false); } };

// ---- flag OFF / misconfigured ----
test('cờ TẮT: get/update đi vào local, không bao giờ gọi fetch', async () => {
  for (const env of [undefined, {}, { VITE_CRM_API_ENABLED: 'false', VITE_CRM_API_BASE: BASE }, { VITE_CRM_API_BASE: BASE }]) {
    const seen = [];
    const local = { get: (id) => { seen.push(['get', id]); return { id, name: 'Demo' }; }, update: (id, ui, v) => { seen.push(['update', id, ui.name, v]); return { id, ...ui }; } };
    const repo = createCustomerRepository({ env, fetchImpl: throwingFetch, local });
    assert.equal(repo.mode, 'local');
    assert.equal((await repo.get('KH-00001')).name, 'Demo');
    assert.equal((await repo.update('KH-00001', { name: 'Mới', phone: '1' }, 3)).name, 'Mới');
    assert.deepEqual(seen, [['get', 'KH-00001'], ['update', 'KH-00001', 'Mới', 3]]);
  }
});
test('cờ TẮT: local thiếu get/update → lỗi config, lỗi của local giữ nguyên, không fetch', async () => {
  const bare = createCustomerRepository({ env: {}, fetchImpl: throwingFetch, local: { list: () => [], create: () => {} } });
  await assert.rejects(() => bare.get('x'), (e) => e instanceof CustomerRepoError && e.kind === 'config');
  await assert.rejects(() => bare.update('x', {}, 1), (e) => e.kind === 'config');
  const boom = new Error('local lỗi');
  const repo = createCustomerRepository({ env: {}, fetchImpl: throwingFetch, local: { get: () => { throw boom; }, update: () => { throw boom; } } });
  await assert.rejects(() => repo.get('x'), (e) => e === boom);
  await assert.rejects(() => repo.update('x', {}, 1), (e) => e === boom);
});
test('cờ BẬT thiếu base URL: get/update lỗi config, KHÔNG rơi về local, không fetch', async () => {
  let touched = 0;
  const local = { get: () => { touched++; }, update: () => { touched++; } };
  const repo = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: throwingFetch, local });
  assert.equal(repo.mode, 'misconfigured');
  await assert.rejects(() => repo.get(ID), (e) => e.kind === 'config');
  await assert.rejects(() => repo.update(ID, { name: 'A', phone: '1' }, 1), (e) => e.kind === 'config');
  assert.equal(touched, 0);
});

// ---- flag ON: get ----
test('cờ BẬT get: GET /customers/:uuid, giữ uuid + mã hiển thị + owner từ server + version; không credentials', async () => {
  const f = mockFetch(() => res(200, { data: apiCust() }));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: { get: throwingFetch } });
  const c = await repo.get(ID);
  assert.equal(c.id, ID); assert.equal(c.code, 'KH-00007'); assert.equal(c.owner, 'Trần Minh Khoa'); assert.equal(c.ownerId, 'e1');
  assert.equal(c.tier, 'VIP'); assert.equal(c.city, 'TP. Hồ Chí Minh'); assert.equal(c.version, 2);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, BASE + '/customers/' + ID); assert.equal(f.calls[0].init.method, 'GET');
  noCreds(f.calls);
});
test('cờ BẬT get: id lạ → 404 not_found (không fallback local, không dữ liệu giả)', async () => {
  let localTouched = 0;
  const f = mockFetch(() => res(404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Không tìm thấy khách hàng.' } }));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: { get: () => { localTouched++; return { id: 'KH-1' }; } } });
  await assert.rejects(() => repo.get('11111111-2222-4333-8444-555555555555'), (e) => e instanceof CustomerRepoError && e.kind === 'not_found' && e.status === 404 && e.code === 'CUSTOMER_NOT_FOUND');
  assert.equal(localTouched, 0);
});
test('cờ BẬT get: id rỗng / mã hiển thị / không phải UUID → validation, không gọi mạng', async () => {
  const repo = createCustomerRepository({ env: ON, fetchImpl: throwingFetch, local: {} });
  for (const id of [undefined, null, '', 'KH-00007', '../customers', ID + '/x', 42]) {
    await assert.rejects(() => repo.get(id), (e) => e.kind === 'validation' && e.field === 'id', String(id));
  }
});
test('cờ BẬT get: 400/401/403/500/mạng → kind tương ứng, không fallback', async () => {
  for (const [status, kind] of [[400, 'bad_request'], [401, 'unauthenticated'], [403, 'forbidden'], [500, 'server']]) {
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(status, { error: { code: 'E', message: 'x' } })), local: { get: throwingFetch } });
    await assert.rejects(() => repo.get(ID), (e) => e.kind === kind && e.status === status);
  }
  const net = createCustomerRepository({ env: ON, fetchImpl: async () => { throw new TypeError('fetch failed'); }, local: {} });
  await assert.rejects(() => net.get(ID), (e) => e.kind === 'network');
});
test('cờ BẬT get: phản hồi sai (null / thiếu id / không JSON / id khác id yêu cầu) → malformed', async () => {
  for (const body of [{ data: null }, { data: { name: 'thiếu id' } }, undefined, { data: apiCust({ id: '99999999-2222-4333-8444-555555555555' }) }]) {
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(200, body)), local: {} });
    await assert.rejects(() => repo.get(ID), (e) => e.kind === 'malformed', JSON.stringify(body));
  }
});

// ---- flag ON: update ----
const lookupsOr = (updated) => (url) => (url.includes('/lookups') ? res(200, { data: LOOKUPS }) : res(200, { data: updated }));
test('cờ BẬT update: GET /lookups rồi PATCH /customers/:uuid; nhãn→mã; không gửi id/code/owner; version gửi kèm; trả bản server', async () => {
  const f = mockFetch(lookupsOr(apiCust({ version: 3, tier: { code: 'VIP', label: 'VIP' }, industry: { code: 'REAL_ESTATE', label: 'Bất động sản' } })));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: { update: throwingFetch } });
  const c = await repo.update(ID, { id: 'KH-9', code: 'KH-HACK', owner: 'Ai đó', ownerId: 'x', name: ' Công ty A ', phone: '0901234567', tier: 'VIP', industry: 'Bất động sản' }, 2);
  assert.equal(c.id, ID); assert.equal(c.code, 'KH-00007'); assert.equal(c.owner, 'Trần Minh Khoa'); assert.equal(c.version, 3);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /\/lookups\?type=/); assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[1].url, BASE + '/customers/' + ID); assert.equal(f.calls[1].init.method, 'PATCH');
  const body = JSON.parse(f.calls[1].init.body);
  assert.equal(body.version, 2); assert.equal(body.name, 'Công ty A'); assert.equal(body.tier, 'VIP'); assert.equal(body.industry, 'REAL_ESTATE');
  for (const k of ['id', 'code', 'owner', 'ownerId']) assert.equal(k in body, false, k);
  noCreds(f.calls);
});
test('cờ BẬT update: trường tuỳ chọn để trống → null (xoá); tier/status trống → không gửi; chỉ name+phone → không cần /lookups', async () => {
  const f = mockFetch(() => res(200, { data: apiCust({ version: 3 }) }));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: {} });
  await repo.update(ID, { name: 'Công ty A', phone: '0901234567', short: '', taxId: '', address: '', email: '', website: '', note: '', industry: '', source: '', city: '' }, 2);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'PATCH');
  const body = JSON.parse(f.calls[0].init.body);
  for (const k of ['shortName', 'taxId', 'address', 'email', 'website', 'note', 'industry', 'source', 'province']) assert.equal(body[k], null, k);
  assert.equal('tier' in body, false); assert.equal('status' in body, false);
});
test('cờ BẬT update: thiếu tên/version/uuid hợp lệ → validation, không gọi mạng (04/11/2026: điện thoại không bắt buộc)', async () => {
  const repo = createCustomerRepository({ env: ON, fetchImpl: throwingFetch, local: {} });
  const ok = { name: 'A', phone: '1' };
  await assert.rejects(() => repo.update(ID, { ...ok, name: '  ' }, 1), (e) => e.kind === 'validation' && e.field === 'name');
  await assert.rejects(() => repo.update(ID, null, 1), (e) => e.kind === 'validation');
  for (const v of [undefined, null, 0, -1, 1.5, '2']) await assert.rejects(() => repo.update(ID, ok, v), (e) => e.kind === 'validation' && e.field === 'version', String(v));
  for (const id of ['KH-00007', '', undefined]) await assert.rejects(() => repo.update(id, ok, 1), (e) => e.kind === 'validation' && e.field === 'id');
});
test('cờ BẬT update: nhãn lạ → validation có field, KHÔNG PATCH, không đoán mã', async () => {
  const f = mockFetch(lookupsOr(apiCust()));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: {} });
  await assert.rejects(() => repo.update(ID, { name: 'A', phone: '1', source: 'Nhãn demo lạ' }, 1), (e) => e.kind === 'validation' && e.field === 'source');
  assert.equal(f.calls.every((c) => c.init.method === 'GET'), true);
});
test('cờ BẬT update: 400/401/403/404/409 → kind tương ứng; 409 giữ code + currentVersion; không fallback local', async () => {
  for (const [status, kind] of [[400, 'bad_request'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict']]) {
    let localTouched = 0;
    const details = status === 409 ? { currentVersion: 5 } : [{ field: 'phone' }];
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(status, { error: { code: 'CUSTOMER_VERSION_CONFLICT', message: 'chi tiết máy chủ', details } })), local: { update: () => { localTouched++; } } });
    await assert.rejects(() => repo.update(ID, { name: 'A', phone: '1' }, 2), (e) => e instanceof CustomerRepoError && e.kind === kind && e.status === status && e.message.length > 10 && e.code === 'CUSTOMER_VERSION_CONFLICT' && (status !== 409 || e.details.currentVersion === 5));
    assert.equal(localTouched, 0);
  }
});
test('cờ BẬT update: lỗi mạng (PATCH hoặc /lookups) → network; không báo thành công', async () => {
  const net = createCustomerRepository({ env: ON, fetchImpl: async () => { throw new TypeError('fetch failed'); }, local: {} });
  await assert.rejects(() => net.update(ID, { name: 'A', phone: '1' }, 1), (e) => e.kind === 'network');
  await assert.rejects(() => net.update(ID, { name: 'A', phone: '1', tier: 'VIP' }, 1), (e) => e.kind === 'network');
  const lk = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })), local: {} });
  await assert.rejects(() => lk.update(ID, { name: 'A', phone: '1', tier: 'VIP' }, 1), (e) => e.kind === 'unauthenticated');
});
test('cờ BẬT update: 200 nhưng thân sai (null / thiếu id / không JSON / id khác) → malformed, không báo thành công', async () => {
  for (const body of [{ data: null }, { data: { name: 'thiếu id' } }, undefined, { data: apiCust({ id: '99999999-2222-4333-8444-555555555555' }) }]) {
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(200, body)), local: {} });
    await assert.rejects(() => repo.update(ID, { name: 'A', phone: '1' }, 1), (e) => e.kind === 'malformed', JSON.stringify(body));
  }
});
test('cờ BẬT: không có fetch khả dụng → network (không im lặng)', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    const repo = createCustomerRepository({ env: ON, local: {} });
    await assert.rejects(() => repo.get(ID), (e) => e instanceof CustomerRepoError && e.kind === 'network');
    await assert.rejects(() => repo.update(ID, { name: 'A', phone: '1' }, 1), (e) => e.kind === 'network');
  } finally { globalThis.fetch = saved; }
});
