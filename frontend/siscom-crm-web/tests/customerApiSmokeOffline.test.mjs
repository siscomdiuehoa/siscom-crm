// Run: node --test tests/customerApiSmokeOffline.test.mjs   (Node >= 18, no dependencies, no browser, no network, no DB.)
// OFFLINE SMOKE harness for the frontend customer core, end to end through controller -> repository -> api client -> adapter with an injected fake `fetch`.
//   Flag OFF : zero fetch (injected AND global), localStorage untouched, local demo repository unchanged.
//   Flag ON  : list / create / get / PATCH / paging / lookups against a mocked server; 400/401/403/404/409/5xx/network surfaced for EVERY operation,
//              no localStorage fallback, no fake success, `owner` never sent, no credentials (credentials:'omit', no Authorization header).
// This is NOT a browser run and NOT a real-login / PostgreSQL test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';
import { createCustomerRepository } from '../src/data/api/customerRepository.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const err = (status, code, message = 'x', details) => res(status, { error: { code, message, details } });
const LOOKUPS = {
  customer_tier: [{ code: 'vip', label: 'VIP' }], customer_status: [{ code: 'active', label: 'Đang hoạt động' }],
  industry: [{ code: 'IND-1', label: 'Xây dựng' }], source: [{ code: 'web', label: 'Website' }], province: [{ code: 'HCM', label: 'TP. Hồ Chí Minh' }],
};
const uid = (i) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(i).padStart(12, '0');
const apiCust = (i, over = {}) => ({ id: uid(i), code: 'KH-' + String(i).padStart(5, '0'), name: 'Công ty ' + i, phone: '0901234567', version: 2, owner: { id: uid(900), fullName: 'Chủ sở hữu' }, ...over });
const INPUT = { name: 'Công ty mới', phone: '0901234567', short: '', taxId: '', industry: 'Xây dựng', tier: 'VIP', owner: 'Hacker', ownerId: uid(999), cName: 'x', cPhone: 'y' };

// Mock server. `fail` = { [op]: Response | Error | (n)=>Response } where op ∈ lookups|list|create|get|update (lookups served OK unless overridden).
function mockServer(fail = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url);
    calls.push({ url, method, init, body: init.body ? JSON.parse(init.body) : null });
    const path = u.pathname.replace('/api/v1', '');
    const op = path === '/lookups' ? 'lookups' : method === 'POST' ? 'create' : method === 'PATCH' ? 'update' : path === '/customers' ? 'list' : 'get';
    const o = fail[op];
    if (o) { const r = typeof o === 'function' ? o(calls.filter((c) => c.method === method && c.url.includes(path)).length) : o; if (r instanceof Error) throw r; return r; }
    if (op === 'lookups') return res(200, { data: LOOKUPS });
    if (op === 'create') return res(201, { data: apiCust(77, { name: JSON.parse(init.body).name }) });
    if (op === 'update') return res(200, { data: apiCust(5, { name: JSON.parse(init.body).name, version: JSON.parse(init.body).version + 1 }) });
    if (op === 'get') return res(200, { data: apiCust(5) });
    const page = Number(u.searchParams.get('page') || 1); const size = Number(u.searchParams.get('pageSize') || 20); const items = [];
    for (let i = (page - 1) * size + 1; i <= Math.min(page * size, 45); i++) items.push(apiCust(i));
    return res(200, { data: { items, page, pageSize: size, total: 45, totalPages: Math.ceil(45 / size) } });
  };
  f.calls = calls; f.mutations = () => calls.filter((c) => c.method !== 'GET'); return f;
}

// Guards: any use of global fetch or localStorage in a scenario fails it.
async function guarded(fn) {
  const touched = []; const globalFetch = []; const prevLS = globalThis.localStorage; const prevFetch = globalThis.fetch;
  globalThis.localStorage = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); return () => null; } });
  globalThis.fetch = (...a) => { globalFetch.push(a[0]); throw new Error('global fetch must not be used offline'); };
  try { return await fn({ touched, globalFetch }); }
  finally {
    assert.deepEqual(touched, [], 'localStorage không được đụng'); assert.deepEqual(globalFetch, [], 'không gọi fetch toàn cục');
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
    if (prevFetch === undefined) delete globalThis.fetch; else globalThis.fetch = prevFetch;
  }
}

// ---------------- Flag OFF ----------------
test('SMOKE cờ TẮT: không fetch (inject + toàn cục), localStorage nguyên, repository cục bộ giữ nguyên demo', () => guarded(async () => {
  const f = mockServer();
  for (const env of [undefined, {}, { VITE_CRM_API_ENABLED: 'false' }, { VITE_CRM_API_ENABLED: 'TRUE' }, { VITE_CRM_API_ENABLED: '1' }, { VITE_CRM_API_BASE: BASE }]) assert.equal(createCustomerApiUi({ env, fetchImpl: f }), null);
  const demo = [{ id: 'd1', name: 'Demo 1' }]; const seen = [];
  const local = { list: (p) => { seen.push(['list', p]); return demo; }, create: (ui) => { seen.push(['create', ui]); return { id: 'd2', ...ui }; }, get: (id) => ({ id }), update: (id, ui) => ({ id, ...ui }) };
  const repo = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'false', VITE_CRM_API_BASE: BASE }, fetchImpl: f, local });
  assert.equal(repo.mode, 'local'); assert.equal(await repo.lookups(), null);
  assert.deepEqual((await repo.list({ page: 1 })).items, demo); assert.equal((await repo.list()).source, 'local');
  assert.equal((await repo.create({ name: 'N', phone: '1' })).id, 'd2'); assert.equal((await repo.get('d1')).id, 'd1'); assert.equal((await repo.update('d1', { name: 'Z' }, 3)).name, 'Z');
  assert.equal(f.calls.length, 0, 'zero fetch khi cờ TẮT');
}));

test('SMOKE cờ BẬT nhưng thiếu BASE: lỗi cấu hình ở mọi thao tác, không lùi về localStorage, không fetch', () => guarded(async () => {
  const f = mockServer(); const local = { list: () => { throw new Error('local must not be used'); }, create: () => { throw new Error('local must not be used'); } };
  const repo = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f, local });
  assert.equal(repo.mode, 'misconfigured');
  for (const op of [() => repo.lookups(), () => repo.list(), () => repo.create(INPUT), () => repo.get(uid(1)), () => repo.update(uid(1), INPUT, 1)]) await assert.rejects(op, (e) => e.kind === 'config');
  assert.equal(f.calls.length, 0);
}));

// ---------------- Flag ON: happy path ----------------
test('SMOKE cờ BẬT: lookups + list + paging + search + get + create + PATCH chạy trên máy chủ giả', () => guarded(async () => {
  const f = mockServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadLookups(); assert.equal(c.getState().lookups.status, 'ready');
  await c.load({ page: 1, pageSize: 20 }); let s = c.getState();
  assert.equal(s.list.status, 'ready'); assert.equal(s.list.items.length, 20); assert.equal(s.list.paging.total, 45); assert.equal(s.list.paging.totalPages, 3);
  await c.nextPage(); await c.nextPage(); s = c.getState(); assert.equal(s.list.paging.page, 3); assert.equal(s.list.items.length, 5); assert.equal(s.list.paging.hasNext, false);
  await c.nextPage(); assert.equal(c.getState().list.paging.page, 3, 'hết trang: không gọi thêm');
  await c.prevPage(); assert.equal(c.getState().list.paging.page, 2);
  await c.search(' a '); assert.equal(c.getState().list.params.search, undefined, '<2 ký tự: không gửi search');
  await c.search('Công ty'); assert.equal(c.getState().list.params.search, 'Công ty'); assert.equal(c.getState().list.params.page, 1);
  await c.loadDetail(uid(5)); assert.equal(c.getState().detail.status, 'ready'); assert.equal(c.getState().detail.customer.id, uid(5));
  const u = await c.update(uid(5), { name: 'Tên mới', phone: '0901234567', short: '', taxId: '' }, 2);
  assert.equal(u.ok, true); assert.equal(u.customer.version, 3); assert.equal(c.getState().detail.customer.name, 'Tên mới');
  const cr = await c.submit({ name: 'Công ty mới', phone: '0901234567', short: '', taxId: '', industry: 'Xây dựng', tier: 'VIP' });
  assert.equal(cr.ok, true); assert.equal(cr.customer.id, uid(77)); assert.equal(c.getState().list.items[0].id, uid(77));
  assert.deepEqual(f.calls.filter((x) => x.method === 'GET' && x.url.includes('/customers?')).map((x) => new URL(x.url).searchParams.get('page')), ['1', '2', '3', '2', '1', '1']);
  assert.deepEqual(f.mutations().map((m) => m.method), ['PATCH', 'POST']);
  assert.equal(f.mutations()[0].url, BASE + '/customers/' + uid(5)); assert.equal(f.mutations()[1].body.industry, 'IND-1');
}));

test('SMOKE cờ BẬT: owner/ownerId/id/code/liên hệ KHÔNG gửi; không cookie/Authorization', () => guarded(async () => {
  const f = mockServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  assert.equal((await c.submit(INPUT)).ok, true);
  await c.loadDetail(uid(5)); assert.equal((await c.update(uid(5), { ...INPUT, id: uid(5), code: 'KH-1' }, 2)).ok, true);
  assert.equal(f.mutations().length, 2);
  for (const m of f.mutations()) {
    for (const k of ['owner', 'ownerId', 'ownerUserId', 'id', 'code', 'cName', 'cPhone', 'cTitle', 'cEmail']) assert.equal(k in m.body, false, k + ' không được gửi (' + m.method + ')');
    assert.equal(m.body.industry, 'IND-1'); assert.equal(m.body.tier, 'vip');
  }
  for (const call of f.calls) {
    assert.equal(call.init.credentials, 'omit'); assert.equal(call.url.startsWith(BASE), true);
    assert.deepEqual(Object.keys(call.init.headers).map((h) => h.toLowerCase()).filter((h) => !['accept', 'content-type'].includes(h)), [], 'không header lạ (Authorization/Cookie)');
  }
}));

// ---------------- Flag ON: error matrix on every operation ----------------
const KIND = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 500: 'server', 502: 'server', 503: 'server' };
const OPS = {
  lookups: (c) => c.loadLookups(true).then(() => ({ st: c.getState().lookups, mut: false })),
  list: (c) => c.load({ page: 2 }).then(() => ({ st: c.getState().list, mut: false })),
  get: (c) => c.loadDetail(uid(5)).then(() => ({ st: c.getState().detail, mut: false })),
  create: (c) => c.submit(INPUT).then((r) => ({ st: c.getState().submit, r, mut: true })),
  update: (c) => c.update(uid(5), { name: 'Tên mới', phone: '0901234567', short: '', taxId: '' }, 2).then((r) => ({ st: c.getState().update, r, mut: true })),
};
for (const [status, kind] of Object.entries(KIND)) {
  for (const op of Object.keys(OPS)) {
    test(`SMOKE ${status} trên ${op}: lỗi "${kind}" hiển thị, không thành công giả, không localStorage`, () => guarded(async () => {
      const f = mockServer({ [op]: err(Number(status), 'E_' + status, 'lỗi giả ' + status) });
      const c = createCustomerApiUi({ env: ON, fetchImpl: f });
      if (op === 'update' || op === 'get') await c.loadLookups(); // keep fixtures independent of the failing op
      const before = c.getState().list.items.length;
      const { st, r, mut } = await OPS[op](c);
      assert.equal(st.status, 'error', op + ' phải ở trạng thái lỗi'); assert.equal(st.error.kind, kind); assert.equal(st.error.status, Number(status));
      if (mut) { assert.equal(r.ok, false); assert.equal(r.error.kind, kind); }
      assert.equal(c.getState().list.items.length, before, 'không thêm/sửa dòng nào trong danh sách khi lỗi');
      if (op === 'get') assert.equal(c.getState().detail.customer, null, 'không hiển thị khách hàng cũ/giả');
      if (op === 'list') assert.deepEqual(c.getState().list.items, []);
      assert.equal(st.error.denied, status === '401' || status === '403');
      assert.equal(st.error.retryable, Number(status) >= 500 ? true : false);
    }));
  }
}

test('SMOKE 400 có details: lỗi gắn đúng trường form; backend không bị bỏ qua', () => guarded(async () => {
  const f = mockServer({ create: err(400, 'VALIDATION_ERROR', 'invalid', ['phone must be a valid phone', 'email must be an email', 'khác lạ']) });
  const c = createCustomerApiUi({ env: ON, fetchImpl: f }); const r = await c.submit(INPUT);
  assert.equal(r.ok, false); assert.match(r.error.fieldErrors.phone, /phone/); assert.match(r.error.fieldErrors.email, /email/); assert.deepEqual(r.error.extra, ['khác lạ']);
}));

test('SMOKE 409 trùng (create) và 409 version (PATCH) phân biệt; PATCH 409 giữ detail cũ, không ghi đè', () => guarded(async () => {
  const f = mockServer({ create: err(409, 'CUSTOMER_DUPLICATE', 'trùng'), update: err(409, 'CUSTOMER_VERSION_CONFLICT', 'stale', { currentVersion: 5 }) });
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const a = await c.submit(INPUT); assert.equal(a.error.kind, 'conflict'); assert.equal(a.error.staleVersion, false);
  await c.loadDetail(uid(5)); const b = await c.update(uid(5), { name: 'X', phone: '0901234567', short: '', taxId: '' }, 2);
  assert.equal(b.error.staleVersion, true); assert.equal(c.getState().detail.customer.version, 2, 'detail không bị ghi đè'); assert.equal(c.getState().detail.customer.name, 'Công ty 5');
  assert.equal(f.mutations().length, 2, 'không tự thử lại');
}));

test('SMOKE lỗi mạng (fetch ném lỗi) trên mọi thao tác: kind network, retryable, không thành công giả, không thử lại tự động', () => guarded(async () => {
  for (const op of Object.keys(OPS)) {
    const f = mockServer({ [op]: new TypeError('Failed to fetch') }); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
    if (op === 'update' || op === 'get') await c.loadLookups();
    const n0 = f.calls.length; const { st, r } = await OPS[op](c);
    assert.equal(st.status, 'error', op); assert.equal(st.error.kind, 'network', op); assert.equal(st.error.retryable, true);
    if (r) assert.equal(r.ok, false);
    assert.equal(f.calls.length - n0, op === 'create' ? 2 : 1, op + ': đúng số lần gọi (create: lookups + POST; còn lại 1), không tự thử lại');
  }
}));

test('SMOKE phản hồi sai cấu trúc / 200 rỗng / JSON hỏng: lỗi malformed hoặc rõ ràng, không thành công giả', () => guarded(async () => {
  const bad = [res(200, { data: null }), res(200, { data: { items: 'x' } }), { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }];
  for (const b of bad) {
    const c = createCustomerApiUi({ env: ON, fetchImpl: mockServer({ list: b }) }); await c.load({});
    assert.equal(c.getState().list.status, 'error'); assert.deepEqual(c.getState().list.items, []);
  }
  const c = createCustomerApiUi({ env: ON, fetchImpl: mockServer({ create: res(201, { data: null }) }) });
  const r = await c.submit(INPUT); assert.equal(r.ok, false); assert.equal(c.getState().list.items.length, 0);
}));

test('SMOKE 5xx rồi bấm thử lại thủ công (reload) thành công; lỗi không tự thử lại', () => guarded(async () => {
  const f = mockServer({ list: (n) => (n === 1 ? err(503, 'UNAVAILABLE') : null) });
  const base = mockServer(); // successful fallback body
  const flaky = async (url, init) => { const r = await f(url, init); return r === null ? base(url, init) : r; };
  const c = createCustomerApiUi({ env: ON, fetchImpl: flaky });
  await c.load({ page: 2 }); assert.equal(c.getState().list.status, 'error'); assert.equal(c.getState().list.params.page, 2);
  assert.equal(f.calls.length, 1, 'không tự thử lại');
  await c.reload(); assert.equal(c.getState().list.status, 'ready'); assert.equal(c.getState().list.paging.page, 2);
}));

test('SMOKE tính toàn vẹn đầu vào: UUID sai / thiếu tên / thiếu version bị chặn TRƯỚC khi gửi (không request)', () => guarded(async () => {
  const f = mockServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadDetail('not-a-uuid'); assert.equal(c.getState().detail.error.kind, 'validation');
  assert.equal((await c.submit({ name: '', phone: '1' })).error.kind, 'validation'); assert.equal((await c.submit({ name: 'A', phone: '' })).error.kind, 'validation');
  assert.equal((await c.update(uid(5), { name: 'A', phone: '1' }, undefined)).error.kind, 'validation');
  assert.equal(f.calls.length, 0);
}));

test('SMOKE chống gửi đôi: submit/update đồng thời chỉ phát một yêu cầu ghi', () => guarded(async () => {
  const f = mockServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const [a, b] = await Promise.all([c.submit(INPUT), c.submit(INPUT)]); assert.equal([a, b].filter((x) => x.duplicate).length, 1);
  const inp = { name: 'A', phone: '0901234567', short: '', taxId: '' };
  const [x, y] = await Promise.all([c.update(uid(5), inp, 2), c.update(uid(5), inp, 2)]); assert.equal([x, y].filter((z) => z.duplicate).length, 1);
  assert.equal(f.mutations().length, 2);
}));
