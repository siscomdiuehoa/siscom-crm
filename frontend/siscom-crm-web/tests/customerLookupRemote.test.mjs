// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLookupMaps } from '../src/data/api/customerAdapter.js';
import { createCustomerRepository } from '../src/data/api/customerRepository.js';
import { createCustomerApiUi, lookupFieldView, lookupFormErrors } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const UUID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const LOOKUPS = {
  customer_tier: [{ code: 'vip', label: 'VIP' }, { code: 'std', label: 'Tiêu chuẩn' }],
  customer_status: [{ code: 'active', label: 'Đang hoạt động' }],
  industry: [{ code: 'IND-1', label: 'Xây dựng' }, { code: 'IND-2', label: 'Cơ khí' }],
  source: [{ code: 'web', label: 'Website' }],
  province: [{ code: 'HCM', label: 'TP. Hồ Chí Minh' }, { code: 'HN', label: 'Hà Nội' }],
};
const server = (over = {}) => mockFetch((url, init) => {
  if (url.startsWith(BASE + '/lookups')) return res(200, { data: { ...LOOKUPS, ...over } });
  if (init.method === 'POST') return res(201, { data: { id: UUID, code: 'KH-1', name: 'A', phone: '0901234567', version: 1 } });
  return res(200, { data: { items: [], total: 0 } });
});

test('buildLookupMaps: options giữ đúng thứ tự máy chủ, không bịa lựa chọn; hàng sai cấu trúc bị bỏ', () => {
  const m = buildLookupMaps({ ...LOOKUPS, industry: [{ code: 'A', label: 'Xây dựng' }, null, { code: '', label: 'x' }, { code: 'B' }, { code: 'C', label: '  ' }, { code: 'D', label: 'Cơ khí' }] });
  assert.deepEqual(m.industry.options, ['Xây dựng', 'Cơ khí']);
  assert.equal(m.industry.toCode('Cơ khí'), 'D'); assert.equal(m.industry.toCode('Khác'), undefined);
  assert.deepEqual(m.city.options, ['TP. Hồ Chí Minh', 'Hà Nội']); assert.equal(m.city.missing, false);
});

test('buildLookupMaps: thiếu loại danh mục → missing=true, options rỗng (không rơi về dữ liệu demo)', () => {
  for (const data of [null, undefined, {}, { customer_tier: null, industry: 'x' }]) {
    const m = buildLookupMaps(data);
    for (const f of ['tier', 'status', 'industry', 'source', 'city']) { assert.equal(m[f].missing, true); assert.deepEqual(m[f].options, []); }
  }
});

test('repository: cờ TẮT lookups() = null và không gọi fetch; cấu hình thiếu base → lỗi config', async () => {
  const f = mockFetch(() => { throw new Error('không được gọi'); });
  const off = createCustomerRepository({ env: {}, fetchImpl: f, local: { list: () => [] } });
  assert.equal(await off.lookups(), null); assert.equal(f.calls.length, 0);
  const mis = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f });
  await assert.rejects(() => mis.lookups(), (e) => e.kind === 'config'); assert.equal(f.calls.length, 0);
});

test('controller: loadLookups → loading rồi ready với lựa chọn máy chủ; lần 2 dùng cache (không gọi lại)', async () => {
  const f = server(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  assert.equal(c.getState().lookups.status, 'idle');
  const seen = []; c.subscribe(() => seen.push(c.getState().lookups.status));
  await c.loadLookups(); await c.loadLookups();
  assert.deepEqual(seen, ['loading', 'ready']);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'GET'); assert.equal(f.calls[0].init.credentials, 'omit');
  assert.match(f.calls[0].url, /\/lookups\?type=/);
  assert.deepEqual(c.getState().lookups.maps.tier.options, ['VIP', 'Tiêu chuẩn']);
  await c.loadLookups(true); assert.equal(f.calls.length, 2);
});

test('controller: gọi đồng thời chỉ gửi một request lookups', async () => {
  const f = server(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await Promise.all([c.loadLookups(), c.loadLookups()]); assert.equal(f.calls.length, 1);
});

test('controller: 401 → error unauthenticated, maps null, KHÔNG dữ liệu demo; thử lại thành công sau đó', async () => {
  let authed = false;
  const f = mockFetch(() => (authed ? res(200, { data: LOOKUPS }) : res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadLookups();
  let l = c.getState().lookups;
  assert.equal(l.status, 'error'); assert.equal(l.error.kind, 'unauthenticated'); assert.equal(l.error.status, 401); assert.equal(l.maps, null);
  assert.equal(lookupFieldView(l, 'tier', '').disabled, true); assert.deepEqual(lookupFieldView(l, 'tier', '').options, []);
  authed = true; await c.loadLookups(true);
  l = c.getState().lookups; assert.equal(l.status, 'ready'); assert.equal(l.error, null);
});

test('controller: lỗi mạng / 500 / phản hồi sai cấu trúc → error có thể thử lại', async () => {
  for (const [h, kind] of [[() => { throw new TypeError('Failed to fetch'); }, 'network'], [() => res(500, {}), 'server']]) {
    const c = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(h) });
    await c.loadLookups(); const l = c.getState().lookups;
    assert.equal(l.status, 'error'); assert.equal(l.error.kind, kind); assert.equal(l.error.retryable, true);
  }
});

test('controller: thiếu một loại danh mục → ready nhưng trường đó missing/disabled, các trường khác bình thường', async () => {
  const c = createCustomerApiUi({ env: ON, fetchImpl: server({ industry: undefined }) });
  await c.loadLookups(); const l = c.getState().lookups;
  assert.equal(l.status, 'ready');
  const v = lookupFieldView(l, 'industry', ''); assert.equal(v.disabled, true); assert.deepEqual(v.options, []); assert.match(v.hint, /chưa có danh mục/);
  assert.equal(lookupFieldView(l, 'tier', '').disabled, false);
  assert.match(lookupFormErrors(l, { industry: 'Xây dựng' }).industry, /không có trong danh mục/);
  assert.deepEqual(lookupFormErrors(l, { industry: '' }), {});
});

test('controller: phản hồi data=null → tất cả missing (không lỗi, không bịa)', async () => {
  const c = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(() => res(200, { data: null })) });
  await c.loadLookups(); const l = c.getState().lookups;
  assert.equal(l.status, 'ready');
  for (const f of ['tier', 'status', 'industry', 'source', 'city']) assert.deepEqual(lookupFieldView(l, f, '').options, []);
});

test('lookupFieldView: loading → disabled + gợi ý; ready → chỉ lựa chọn máy chủ; giá trị lạ → lỗi kiểm soát', async () => {
  const c = createCustomerApiUi({ env: ON, fetchImpl: server() });
  assert.equal(lookupFieldView(c.getState().lookups, 'city', '').disabled, true);
  assert.match(lookupFieldView(c.getState().lookups, 'city', '').hint, /Đang tải/);
  await c.loadLookups(); const l = c.getState().lookups;
  assert.deepEqual(lookupFieldView(l, 'city', 'Hà Nội'), { options: ['TP. Hồ Chí Minh', 'Hà Nội'], disabled: false, hint: '', error: '' });
  assert.match(lookupFieldView(l, 'city', 'Đà Nẵng').error, /"Đà Nẵng" không có trong danh mục máy chủ/);
  assert.deepEqual(lookupFormErrors(l, { tier: 'Tiềm năng', status: 'Đang hoạt động', industry: '', city: 'Hà Nội' }), { tier: lookupFieldView(l, 'tier', 'Tiềm năng').error });
});

test('lookupFormErrors: danh mục chưa tải mà đã có giá trị → chặn (không gửi nhãn chưa xác thực)', () => {
  assert.match(lookupFormErrors({ status: 'loading' }, { tier: 'VIP' }).tier, /chưa tải/);
  assert.match(lookupFormErrors({ status: 'error' }, { tier: 'VIP' }).tier, /chưa tải/);
  assert.deepEqual(lookupFormErrors({ status: 'error' }, { tier: '', city: '  ' }), {});
});

test('gửi tạo: nhãn tiếng Việt → đúng mã máy chủ trong body POST; không có UUID/nhãn lọt vào; không đụng localStorage', async () => {
  const touched = []; const prev = globalThis.localStorage;
  globalThis.localStorage = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); return () => null; } });
  try {
    const f = server(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
    await c.loadLookups();
    const r = await c.submit({ name: 'A', phone: '0901234567', industry: 'Cơ khí', city: 'Hà Nội', source: 'Website', tier: 'VIP', status: 'Đang hoạt động' });
    assert.equal(r.ok, true);
    const post = f.calls.find((x) => x.init.method === 'POST'); const body = JSON.parse(post.init.body);
    assert.equal(body.industry, 'IND-2'); assert.equal(body.province, 'HN'); assert.equal(body.source, 'web'); assert.equal(body.tier, 'vip'); assert.equal(body.status, 'active');
    assert.equal('city' in body, false);
    assert.deepEqual(touched, []);
  } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
});

test('gửi tạo: nhãn không có trong danh mục máy chủ → lỗi validation theo trường, KHÔNG gửi POST', async () => {
  const f = server(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const r = await c.submit({ name: 'A', phone: '0901234567', city: 'Đà Nẵng' });
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'validation'); assert.match(r.error.fieldErrors.city, /không có trong danh mục/);
  assert.equal(f.calls.some((x) => x.init.method === 'POST'), false);
});

test('gửi tạo: lookups 401 → lỗi unauthenticated, không POST; chỉ name+phone thì không cần lookups', async () => {
  const f401 = mockFetch((url) => (url.includes('/lookups') ? res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }) : res(201, { data: { id: UUID, name: 'A', phone: '1', version: 1 } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f401 });
  const r = await c.submit({ name: 'A', phone: '0901234567', tier: 'VIP' });
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'unauthenticated'); assert.equal(f401.calls.some((x) => x.init.method === 'POST'), false);
  const r2 = await c.submit({ name: 'A', phone: '0901234567' });
  assert.equal(r2.ok, true); assert.equal(f401.calls.filter((x) => x.url.includes('/lookups')).length, 1);
});
