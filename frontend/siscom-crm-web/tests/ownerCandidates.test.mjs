// Run: node --test tests/ownerCandidates.test.mjs (Node >= 18, no dependencies). PR 7: ô "Nhân viên phụ trách" ở chế độ API.
// Injected fetch only; no network, no DB, no storage, no React.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toApiCustomer, normalizeOwnerCandidates, buildLookupMaps, AdapterError } from '../src/data/api/customerAdapter.js';
import { createCustomerApi } from '../src/data/api/customerApiClient.js';
import { createCustomerRepository } from '../src/data/api/customerRepository.js';
import { createCustomerApiController, formToCustomerInput, ownerFieldView } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const E1 = '11111111-1111-4111-8111-111111111111'; const E2 = '22222222-2222-4222-8222-222222222222';
const maps = buildLookupMaps({ customer_tier: [], customer_status: [], industry: [], source: [], province: [] });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const CANDS = { scope: 'ALL', items: [{ id: E1, code: 'NV-0001', fullName: 'An', departmentCode: 'KD' }, { id: E2, code: 'NV-0002', fullName: 'Bình', departmentCode: null }] };

test('toApiCustomer(create): ownerId chỉ gửi khi chọn; rỗng => không gửi (máy chủ áp D14)', () => {
  assert.equal(toApiCustomer({ name: 'A', phone: '0901234567' }, maps).ownerId, undefined);
  assert.equal(toApiCustomer({ name: 'A', phone: '0901234567', ownerId: '' }, maps).ownerId, undefined);
  assert.equal(toApiCustomer({ name: 'A', phone: '0901234567', ownerId: ' ' + E1 + ' ' }, maps).ownerId, E1);
});

test('toApiCustomer(update): ownerId chỉ gửi khi KHÁC ownerIdBefore; bỏ chọn => null; không có ownerIdBefore => không bao giờ gửi', () => {
  const base = { name: 'A', phone: '0901234567' }; const o = { mode: 'update', version: 3 };
  assert.ok(!('ownerId' in toApiCustomer({ ...base, ownerId: E1, ownerIdBefore: E1 }, maps, o)));
  assert.equal(toApiCustomer({ ...base, ownerId: E2, ownerIdBefore: E1 }, maps, o).ownerId, E2);
  assert.equal(toApiCustomer({ ...base, ownerId: '', ownerIdBefore: E1 }, maps, o).ownerId, null);
  assert.equal(toApiCustomer({ ...base, ownerId: E1, ownerIdBefore: '' }, maps, o).ownerId, E1);
  assert.ok(!('ownerId' in toApiCustomer({ ...base, ownerId: E2 }, maps, o)));
});

test('formToCustomerInput: giữ ownerId, bỏ owner (nhãn demo); kèm original => ownerIdBefore', () => {
  const f = { name: ' A ', phone: '0901234567', owner: 'Nguyễn Văn A', ownerId: E1, cName: 'x', short: '', taxId: '' };
  const c = formToCustomerInput(f);
  assert.equal(c.ownerId, E1); assert.ok(!('owner' in c)); assert.ok(!('cName' in c)); assert.ok(!('ownerIdBefore' in c));
  assert.equal(formToCustomerInput(f, { ownerId: E2 }).ownerIdBefore, E2);
  assert.equal(formToCustomerInput(f, { ownerId: null }).ownerIdBefore, '');
});

test('normalizeOwnerCandidates: giữ đúng thứ tự, nhãn "Tên (NV-xxxx)", bỏ hàng sai cấu trúc; scope lạ => OWN; thiếu items => AdapterError', () => {
  const r = normalizeOwnerCandidates({ ...CANDS, items: [...CANDS.items, null, { id: '', fullName: 'x' }, { id: 'e9', fullName: '  ' }] });
  assert.equal(r.scope, 'ALL');
  assert.deepEqual(r.items.map((x) => x.label), ['An (NV-0001)', 'Bình (NV-0002)']);
  assert.equal(r.items[1].departmentCode, null);
  assert.equal(normalizeOwnerCandidates({ scope: 'ROOT', items: [] }).scope, 'OWN');
  assert.throws(() => normalizeOwnerCandidates({ scope: 'ALL' }), AdapterError);
  assert.throws(() => normalizeOwnerCandidates(null), AdapterError);
});

test('client: getOwnerCandidates gọi đúng route GET /customers/owner-candidates và chuẩn hoá', async () => {
  const f = mockFetch((url) => (url === BASE + '/customers/owner-candidates' ? res(200, { data: CANDS }) : res(404, {})));
  const api = createCustomerApi({ enabled: true, baseUrl: BASE }, f);
  const r = await api.getOwnerCandidates();
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(r.items.length, 2);
});

test('ownerFieldView: đang tải/lỗi => disabled; ALL có "— Chưa phân công —"; OWN/DEPARTMENT không; giá trị hiện tại ngoài danh sách được giữ', () => {
  assert.equal(ownerFieldView({ status: 'loading' }, '').disabled, true);
  assert.equal(ownerFieldView({ status: 'error' }, '').disabled, true);
  const all = ownerFieldView({ status: 'ready', scope: 'ALL', items: normalizeOwnerCandidates(CANDS).items }, '');
  assert.deepEqual(all.options.map((o) => o.value), ['', E1, E2]); assert.equal(all.allowNone, true);
  const own = ownerFieldView({ status: 'ready', scope: 'OWN', items: [{ id: E1, label: 'An (NV-0001)' }] }, E1);
  assert.deepEqual(own.options.map((o) => o.value), [E1]); assert.equal(own.allowNone, false);
  const kept = ownerFieldView({ status: 'ready', scope: 'DEPARTMENT', items: [{ id: E1, label: 'An' }] }, E2);
  assert.deepEqual(kept.options.map((o) => o.value), [E2, E1]);
  assert.equal(kept.options[0].label, 'Người phụ trách hiện tại');
});

test('controller.loadOwners: idle -> loading -> ready (cache; force tải lại); 403 => error.denied và không tự thử lại; repo local => idle', async () => {
  let n = 0;
  const f = mockFetch((url) => { if (url.endsWith('/customers/owner-candidates')) { n++; return res(200, { data: CANDS }); } return res(200, { data: { items: [], total: 0 } }); });
  const c = createCustomerApiController(createCustomerRepository({ env: ON, fetchImpl: f }));
  const seen = []; c.subscribe(() => seen.push(c.getState().owners.status));
  await c.loadOwners(); await c.loadOwners();
  assert.deepEqual(seen, ['loading', 'ready']); assert.equal(n, 1);
  assert.equal(c.getState().owners.scope, 'ALL'); assert.equal(c.getState().owners.items[0].label, 'An (NV-0001)');
  await c.loadOwners(true); assert.equal(n, 2);
  const denied = createCustomerApiController(createCustomerRepository({ env: ON, fetchImpl: mockFetch(() => res(403, { error: { code: 'FORBIDDEN', message: 'x' } })) }));
  await denied.loadOwners();
  assert.equal(denied.getState().owners.status, 'error'); assert.equal(denied.getState().owners.error.denied, true);
  const local = createCustomerApiController({ mode: 'local', async ownerCandidates() { return null; } });
  await local.loadOwners(); assert.equal(local.getState().owners.status, 'idle');
});
