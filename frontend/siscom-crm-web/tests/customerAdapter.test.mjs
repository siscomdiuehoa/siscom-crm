// Run: node --test tests/   (Node >= 18, no dependencies). Pure functions + mocked fetch; no network, no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toApiCustomer, fromApiCustomer, buildLookupMaps, AdapterError } from '../src/data/api/customerAdapter.js';
import { createCustomerApi, readApiConfig, ApiError, ApiDisabledError } from '../src/data/api/customerApiClient.js';

const LOOKUPS = {
  customer_tier: [{ code: 'VIP', label: 'VIP' }, { code: 'POTENTIAL', label: 'Tiềm năng' }],
  customer_status: [{ code: 'ACTIVE', label: 'Đang giao dịch' }, { code: 'POTENTIAL', label: 'Tiềm năng' }],
  industry: [{ code: 'REAL_ESTATE', label: 'Bất động sản' }],
  source: [{ code: 'REFERRAL', label: 'Giới thiệu' }],
  province: [{ code: 'HCM', label: 'TP. Hồ Chí Minh' }],
};
const maps = buildLookupMaps(LOOKUPS);
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const detail = (over = {}) => ({
  id: ID, code: 'KH-00007', name: 'Công ty CP Phú An', shortName: 'Phú An', taxId: '0123456789',
  tier: { code: 'VIP', label: 'VIP', isActive: true }, status: { code: 'ACTIVE', label: 'Đang giao dịch', isActive: true },
  industry: { code: 'REAL_ESTATE', label: 'Bất động sản', isActive: true }, source: { code: 'REFERRAL', label: 'Giới thiệu', isActive: true },
  province: { code: 'HCM', label: 'TP. Hồ Chí Minh', isActive: true },
  address: '1 Lê Lợi', phone: '0283822123', phoneE164: '+84283822123', email: 'a@b.vn', website: 'b.vn',
  owner: { id: 'e1', code: 'NV-001', fullName: 'Trần Minh Khoa' }, note: 'ghi chú', tags: ['x'], revenueVnd: '1500000000', revenueBasis: 'MANUAL',
  version: 3, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null, restoredAt: null, ...over,
});

test('toApiCustomer(create): chỉ name + phone bắt buộc, trường rỗng bị bỏ', () => {
  const body = toApiCustomer({ name: '  Công ty A  ', phone: ' 0901234567 ', short: '', taxId: '', industry: '', tier: '', status: '', source: '', address: '', city: '', email: '', website: '', note: '', owner: '' }, maps);
  assert.deepEqual(body, { name: 'Công ty A', phone: '0901234567' });
});
test('toApiCustomer: thiếu name hoặc phone => AdapterError có field', () => {
  assert.throws(() => toApiCustomer({ name: ' ', phone: '0901234567' }, maps), (e) => e instanceof AdapterError && e.field === 'name');
  assert.throws(() => toApiCustomer({ name: 'Công ty A', phone: '' }, maps), (e) => e instanceof AdapterError && e.field === 'phone');
});
test('toApiCustomer: nhãn -> mã lookup, short->shortName, city->province; không gửi owner/id/code', () => {
  const body = toApiCustomer({ id: 'KH-1', code: 'KH-1', name: 'Công ty A', phone: '0901234567', short: 'A', tier: 'VIP', status: 'Đang giao dịch', industry: 'Bất động sản', source: 'Giới thiệu', city: 'TP. Hồ Chí Minh', owner: 'Trần Minh Khoa', ownerId: 'e1', revenue: 5, tags: [' t ', ''] }, maps);
  assert.deepEqual(body, { name: 'Công ty A', phone: '0901234567', shortName: 'A', industry: 'REAL_ESTATE', source: 'REFERRAL', province: 'HCM', tier: 'VIP', status: 'ACTIVE', tags: ['t'] });
  for (const k of ['owner', 'ownerId', 'id', 'code', 'revenue', 'city', 'short']) assert.equal(k in body, false);
});
test('toApiCustomer: nhãn lạ không có trong danh mục => AdapterError (không đoán mã)', () => {
  assert.throws(() => toApiCustomer({ name: 'Công ty A', phone: '0901234567', tier: 'Không tồn tại' }, maps), (e) => e instanceof AdapterError && e.field === 'tier');
});
test('toApiCustomer(update): bắt buộc version; trường tuỳ chọn rỗng => null; tier/status rỗng không bị gửi', () => {
  assert.throws(() => toApiCustomer({ name: 'Công ty A', phone: '0901234567' }, maps, { mode: 'update' }), (e) => e.field === 'version');
  const body = toApiCustomer({ name: 'Công ty A', phone: '0901234567', short: '', email: '' }, maps, { mode: 'update', version: 3 });
  assert.equal(body.version, 3); assert.equal(body.shortName, null); assert.equal(body.email, null); assert.equal(body.province, null);
  assert.equal('tier' in body, false); assert.equal('status' in body, false);
});
test('fromApiCustomer: id ổn định = uuid backend, code giữ riêng, trường rỗng -> chuỗi rỗng', () => {
  const ui = fromApiCustomer(detail());
  assert.equal(ui.id, ID); assert.equal(ui.code, 'KH-00007'); assert.equal(ui.short, 'Phú An'); assert.equal(ui.city, 'TP. Hồ Chí Minh');
  assert.equal(ui.owner, 'Trần Minh Khoa'); assert.equal(ui.revenue, 1500000000); assert.equal(ui.version, 3);
  const min = fromApiCustomer({ id: ID, code: 'KH-00008', name: 'B', phone: '0901234567', shortName: null, taxId: null, tier: { code: 'VIP', label: 'VIP' }, status: { code: 'ACTIVE', label: 'Đang giao dịch' }, industry: null, source: null, province: null, owner: null, email: null, version: 1 });
  for (const k of ['short', 'taxId', 'industry', 'source', 'city', 'owner', 'address', 'email', 'website', 'note']) assert.equal(min[k], '');
  assert.deepEqual(min.tags, []); assert.equal(min.revenue, 0); assert.equal(min.ownerId, null);
  assert.equal(fromApiCustomer(detail()).id, fromApiCustomer(detail()).id);
});
test('fromApiCustomer: thiếu id => AdapterError; list item (ít trường) vẫn map được', () => {
  assert.throws(() => fromApiCustomer({ name: 'x' }), AdapterError);
  const li = fromApiCustomer({ id: ID, code: 'KH-1', name: 'A', phone: '0901234567', tier: { code: 'VIP', label: 'VIP' }, status: { code: 'ACTIVE', label: 'Đang giao dịch' }, version: 1 });
  assert.equal(li.name, 'A');
});
test('round trip API -> UI -> API(update) giữ nguyên các trường ghi được', () => {
  const api = detail();
  const body = toApiCustomer(fromApiCustomer(api), maps, { mode: 'update', version: api.version });
  assert.deepEqual(body, { name: api.name, phone: api.phone, version: 3, shortName: 'Phú An', taxId: '0123456789', address: '1 Lê Lợi', email: 'a@b.vn', website: 'b.vn', note: 'ghi chú',
    industry: 'REAL_ESTATE', source: 'REFERRAL', province: 'HCM', tier: 'VIP', status: 'ACTIVE', tags: ['x'] });
});
test('round trip UI -> API(create) -> (giả lập server) -> UI giữ nguyên dữ liệu người dùng nhập', () => {
  const ui = { name: 'Công ty CP Phú An', short: 'Phú An', phone: '0283822123', taxId: '0123456789', city: 'TP. Hồ Chí Minh', tier: 'VIP', status: 'Đang giao dịch', industry: 'Bất động sản', source: 'Giới thiệu', address: '1 Lê Lợi', email: 'a@b.vn', website: 'b.vn', note: 'n', tags: [] };
  const body = toApiCustomer(ui, maps);
  const lk = (type, c) => { const r = LOOKUPS[type].find((x) => x.code === c); return r ? { code: r.code, label: r.label } : null; };
  const echoed = fromApiCustomer({ id: ID, code: 'KH-1', ...body, tier: lk('customer_tier', body.tier), status: lk('customer_status', body.status), industry: lk('industry', body.industry), source: lk('source', body.source), province: lk('province', body.province), owner: null, version: 1 });
  for (const k of Object.keys(ui)) assert.deepEqual(echoed[k], ui[k], k);
});

// ---- client boundary ----
const resp = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
test('readApiConfig: mặc định TẮT; chỉ bật khi flag === "true" và có base', () => {
  assert.equal(readApiConfig(undefined).enabled, false);
  assert.equal(readApiConfig({ VITE_CRM_API_ENABLED: 'true' }).enabled, false);
  assert.equal(readApiConfig({ VITE_CRM_API_BASE: 'http://x/api/v1' }).enabled, false);
  assert.equal(readApiConfig({ VITE_CRM_API_ENABLED: '1', VITE_CRM_API_BASE: 'http://x/api/v1' }).enabled, false);
  assert.deepEqual(readApiConfig({ VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: 'http://x/api/v1/' }), { enabled: true, baseUrl: 'http://x/api/v1' });
});
test('client TẮT: mọi lời gọi ném ApiDisabledError và KHÔNG gọi fetch', async () => {
  let calls = 0; const api = createCustomerApi(readApiConfig({}), async () => { calls++; return resp(200, {}); });
  await assert.rejects(() => api.list(), ApiDisabledError); await assert.rejects(() => api.get(ID), ApiDisabledError);
  await assert.rejects(() => api.create({ name: 'A', phone: '1' }, maps), ApiDisabledError);
  assert.equal(calls, 0);
});
test('client BẬT: không gửi Authorization/cookie; 401 của backend được giữ nguyên (không bypass)', async () => {
  let seen;
  const api = createCustomerApi({ enabled: true, baseUrl: 'http://x/api/v1' }, async (url, init) => { seen = { url, init }; return resp(401, { statusCode: 401, error: { code: 'UNAUTHENTICATED', message: 'Chưa xác thực.' } }); });
  await assert.rejects(() => api.list({ search: 'phu', page: 1 }), (e) => e instanceof ApiError && e.status === 401 && e.code === 'UNAUTHENTICATED');
  assert.equal(seen.url, 'http://x/api/v1/customers?search=phu&page=1');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(Object.keys(seen.init.headers).some((h) => h.toLowerCase() === 'authorization'), false);
});
test('client BẬT: list/get/create/update dùng đúng route, envelope {data} và adapter', async () => {
  const log = [];
  const api = createCustomerApi({ enabled: true, baseUrl: 'http://x/api/v1' }, async (url, init) => {
    log.push([init.method, url, init.body && JSON.parse(init.body)]);
    if (url.includes('/lookups')) return resp(200, { data: LOOKUPS });
    if (init.method === 'GET' && url.endsWith('/customers?pageSize=5')) return resp(200, { data: { items: [detail()], page: 1, pageSize: 5, total: 1, totalPages: 1 } });
    return resp(200, { data: detail() });
  });
  const m = await api.getLookupMaps(); assert.equal(m.tier.toCode('VIP'), 'VIP');
  const l = await api.list({ pageSize: 5 }); assert.equal(l.items[0].id, ID); assert.equal(l.total, 1);
  assert.equal((await api.get(ID)).code, 'KH-00007');
  await api.create({ name: 'Công ty A', phone: '0901234567' }, m);
  await api.update(ID, { name: 'Công ty A', phone: '0901234567' }, m, 3);
  assert.deepEqual(log[3], ['POST', 'http://x/api/v1/customers', { name: 'Công ty A', phone: '0901234567' }]);
  assert.equal(log[4][0], 'PATCH'); assert.equal(log[4][2].version, 3);
  assert.ok(log[0][1].includes('/lookups?type=customer_tier%2Ccustomer_status'));
});
test('client: lỗi 409 giữ code + details từ backend', async () => {
  const api = createCustomerApi({ enabled: true, baseUrl: 'http://x/api/v1' }, async () => resp(409, { error: { code: 'VERSION_CONFLICT', message: 'Đã bị sửa.', details: ['d'] } }));
  await assert.rejects(() => api.get(ID), (e) => e.status === 409 && e.code === 'VERSION_CONFLICT' && e.details[0] === 'd');
});
