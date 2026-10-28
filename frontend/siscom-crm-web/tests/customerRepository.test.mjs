// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
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
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00007', name: 'Công ty A', phone: '0901234567', tier: { code: 'VIP', label: 'VIP' }, owner: { id: 'e1', fullName: 'Trần Minh Khoa' }, version: 1, ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no json'); return body; } });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const throwingFetch = () => { throw new Error('fetch không được gọi khi cờ TẮT'); };

// ---- flag OFF / misconfigured ----
test('cờ TẮT (mặc định/thiếu/khác "true"): dùng local, không bao giờ gọi fetch', async () => {
  for (const env of [undefined, {}, { VITE_CRM_API_ENABLED: 'false', VITE_CRM_API_BASE: BASE }, { VITE_CRM_API_ENABLED: '1', VITE_CRM_API_BASE: BASE }, { VITE_CRM_API_BASE: BASE }]) {
    const created = [];
    const local = { list: () => [{ id: 'KH-00001' }], create: (ui) => { created.push(ui); return { ...ui, id: 'KH-00002' }; } };
    const repo = createCustomerRepository({ env, fetchImpl: throwingFetch, local });
    assert.equal(repo.mode, 'local');
    assert.deepEqual(await repo.list(), { items: [{ id: 'KH-00001' }], source: 'local' });
    assert.equal((await repo.create({ name: 'A', phone: '1' })).id, 'KH-00002');
    assert.equal(created.length, 1);
  }
});
test('cờ TẮT: lỗi của local được giữ nguyên (không bọc), vẫn không gọi fetch', async () => {
  const boom = new Error('local lỗi');
  const repo = createCustomerRepository({ env: {}, fetchImpl: throwingFetch, local: { list: () => [], create: () => { throw boom; } } });
  await assert.rejects(() => repo.create({}), (e) => e === boom);
});
test('cờ BẬT nhưng thiếu base URL: lỗi config, KHÔNG rơi về local, không fetch', async () => {
  let touched = 0;
  const local = { list: () => { touched++; return []; }, create: () => { touched++; } };
  const repo = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: throwingFetch, local });
  assert.equal(repo.mode, 'misconfigured');
  await assert.rejects(() => repo.list(), (e) => e instanceof CustomerRepoError && e.kind === 'config');
  await assert.rejects(() => repo.create({ name: 'A', phone: '1' }), (e) => e.kind === 'config');
  assert.equal(touched, 0);
});

// ---- flag ON: list ----
test('cờ BẬT list: GET /customers qua client, giữ uuid + mã hiển thị, không credentials/Authorization', async () => {
  const f = mockFetch(() => res(200, { data: { items: [apiCust()], total: 1, page: 1 } }));
  const local = { list: throwingFetch, create: throwingFetch };
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local });
  assert.equal(repo.mode, 'api');
  const out = await repo.list({ page: 1 });
  assert.equal(out.source, 'api'); assert.equal(out.total, 1);
  assert.equal(out.items[0].id, ID); assert.equal(out.items[0].code, 'KH-00007'); assert.equal(out.items[0].tier, 'VIP'); assert.equal(out.items[0].owner, 'Trần Minh Khoa');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, BASE + '/customers?page=1');
  assert.equal(f.calls[0].init.method, 'GET'); assert.equal(f.calls[0].init.credentials, 'omit');
  assert.equal(Object.keys(f.calls[0].init.headers).some((k) => /authorization|cookie/i.test(k)), false);
});
test('cờ BẬT list: 401/403 → lỗi rõ, không rơi về local', async () => {
  for (const [status, kind] of [[401, 'unauthenticated'], [403, 'forbidden']]) {
    let localTouched = 0;
    const local = { list: () => { localTouched++; return []; }, create: () => { localTouched++; } };
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(status, { error: { code: 'X', message: 'từ chối' } })), local });
    await assert.rejects(() => repo.list(), (e) => e instanceof CustomerRepoError && e.kind === kind && e.status === status && /không được lưu|Chưa đăng nhập|không có quyền/.test(e.message));
    assert.equal(localTouched, 0);
  }
});
test('cờ BẬT list: lỗi mạng → kind network; 500 → server', async () => {
  const net = createCustomerRepository({ env: ON, fetchImpl: async () => { throw new TypeError('fetch failed'); }, local: {} });
  await assert.rejects(() => net.list(), (e) => e.kind === 'network');
  const srv = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(500, { error: { code: 'INTERNAL', message: 'x' } })), local: {} });
  await assert.rejects(() => srv.list(), (e) => e.kind === 'server' && e.status === 500);
});
test('cờ BẬT list: phản hồi sai cấu trúc → malformed', async () => {
  for (const body of [{ data: null }, { data: {} }, { data: { items: 'x' } }, { data: { items: [{ name: 'thiếu id' }] } }, undefined]) {
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(200, body)), local: {} });
    await assert.rejects(() => repo.list(), (e) => e instanceof CustomerRepoError && e.kind === 'malformed', JSON.stringify(body));
  }
});

// ---- flag ON: create ----
test('cờ BẬT create: GET /lookups rồi POST /customers; nhãn→mã; không gửi owner/id/code; trả uuid + mã hiển thị', async () => {
  const f = mockFetch((url, init) => (url.includes('/lookups') ? res(200, { data: LOOKUPS }) : res(201, { data: apiCust({ tier: { code: 'VIP', label: 'VIP' }, province: { code: 'HCM', label: 'TP. Hồ Chí Minh' } }) })));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: { create: throwingFetch } });
  const c = await repo.create({ id: 'KH-9', code: 'KH-9', owner: 'Ai đó', ownerId: 'x', name: ' Công ty A ', phone: '0901234567', tier: 'VIP', city: 'TP. Hồ Chí Minh' });
  assert.equal(c.id, ID); assert.equal(c.code, 'KH-00007'); assert.equal(c.city, 'TP. Hồ Chí Minh');
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /\/lookups\?type=/); assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[1].url, BASE + '/customers'); assert.equal(f.calls[1].init.method, 'POST');
  const body = JSON.parse(f.calls[1].init.body);
  assert.deepEqual(body, { name: 'Công ty A', phone: '0901234567', tier: 'VIP', province: 'HCM' });
  for (const call of f.calls) { assert.equal(call.init.credentials, 'omit'); assert.equal(Object.keys(call.init.headers).some((k) => /authorization|cookie/i.test(k)), false); }
});
test('cờ BẬT create: chỉ name+phone → không cần gọi /lookups', async () => {
  const f = mockFetch(() => res(201, { data: apiCust() }));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: {} });
  await repo.create({ name: 'Công ty A', phone: '0901234567' });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'POST');
});
test('cờ BẬT create: thiếu tên/điện thoại → validation, không gọi mạng', async () => {
  const repo = createCustomerRepository({ env: ON, fetchImpl: throwingFetch, local: {} });
  await assert.rejects(() => repo.create({ name: '  ', phone: '0901234567' }), (e) => e.kind === 'validation' && e.field === 'name');
  await assert.rejects(() => repo.create({ name: 'A', phone: '' }), (e) => e.kind === 'validation' && e.field === 'phone');
  await assert.rejects(() => repo.create(null), (e) => e.kind === 'validation');
});
test('cờ BẬT create: nhãn demo lạ → validation có field, KHÔNG POST, không đoán mã', async () => {
  const f = mockFetch((url) => (url.includes('/lookups') ? res(200, { data: LOOKUPS }) : res(201, { data: apiCust() })));
  const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: {} });
  await assert.rejects(() => repo.create({ name: 'A', phone: '1', industry: 'Xây dựng (nhãn demo lạ)' }), (e) => e.kind === 'validation' && e.field === 'industry');
  assert.equal(f.calls.every((c) => c.init.method === 'GET'), true);
});
test('cờ BẬT create: 400/401/403/409 → kind tương ứng, thông điệp rõ; không fallback local', async () => {
  for (const [status, kind] of [[400, 'bad_request'], [401, 'unauthenticated'], [403, 'forbidden'], [409, 'conflict']]) {
    let localTouched = 0;
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(status, { error: { code: 'E', message: 'chi tiết máy chủ', details: [{ field: 'phone' }] } })), local: { create: () => { localTouched++; } } });
    await assert.rejects(() => repo.create({ name: 'A', phone: '1' }), (e) => e instanceof CustomerRepoError && e.kind === kind && e.status === status && e.message.length > 10 && (status !== 400 || e.details[0].field === 'phone'));
    assert.equal(localTouched, 0);
  }
});
test('cờ BẬT create: lỗi mạng khi POST → network (không giả thành công); lookups lỗi cũng dừng', async () => {
  const net = createCustomerRepository({ env: ON, fetchImpl: async () => { throw new TypeError('fetch failed'); }, local: {} });
  await assert.rejects(() => net.create({ name: 'A', phone: '1' }), (e) => e.kind === 'network');
  const lk = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })), local: {} });
  await assert.rejects(() => lk.create({ name: 'A', phone: '1', tier: 'VIP' }), (e) => e.kind === 'unauthenticated');
});
test('cờ BẬT create: 201 nhưng thân sai (null / thiếu id / không phải JSON) → malformed, không báo thành công', async () => {
  for (const body of [{ data: null }, { data: { name: 'thiếu id' } }, undefined]) {
    const repo = createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(201, body)), local: {} });
    await assert.rejects(() => repo.create({ name: 'A', phone: '1' }), (e) => e.kind === 'malformed', JSON.stringify(body));
  }
});
