// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// B1.4 Người liên hệ (một người / khách hàng doanh nghiệp): dùng API Contact có sẵn (GET/POST /customers/:id/contacts), không trường SĐT mới:
// người liên hệ chính mang SĐT công ty (ràng buộc ck_contact_reach), trang chi tiết hiển thị SĐT công ty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi, formToCustomerInput, pickPrimaryContact, contactNameError, CONTACT_NAME_MAX } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const ID2 = '1c0a2d63-4b1f-4d4f-8e7a-1b2c3d4e5f60';
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00007', name: 'Công ty A', phone: '028 3822 1234', version: 2, ...over });
const contact = (over = {}) => ({ id: 'c1', code: 'LH-000001', fullName: 'Nguyễn Văn A', title: null, phone: '028 3822 1234', email: null, isPrimary: true, note: null, createdAt: '2026-11-01T00:00:00.000Z', ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); return handler(url, init, calls); }; f.calls = calls; return f; };
const path = (url) => new URL(url).pathname.replace('/api/v1', '');
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };

test('pickPrimaryContact: ưu tiên isPrimary, rồi người đầu tiên, rỗng => null', () => {
  assert.equal(pickPrimaryContact([]), null);
  assert.equal(pickPrimaryContact(null), null);
  assert.equal(pickPrimaryContact([contact({ id: 'a', isPrimary: false }), contact({ id: 'b', isPrimary: true })]).id, 'b');
  assert.equal(pickPrimaryContact([contact({ id: 'a', isPrimary: false }), contact({ id: 'b', isPrimary: false })]).id, 'a');
});

test('contactNameError: rỗng hợp lệ (không bắt buộc); quá 200 ký tự báo lỗi', () => {
  assert.equal(CONTACT_NAME_MAX, 200);
  assert.equal(contactNameError(''), '');
  assert.equal(contactNameError('  '), '');
  assert.equal(contactNameError('Nguyễn Văn A'), '');
  assert.match(contactNameError('x'.repeat(201)), /200/);
});

test('formToCustomerInput: không đưa contactName vào dữ liệu khách hàng (PATCH/POST /customers)', () => {
  const out = formToCustomerInput({ name: 'Công ty A', phone: '0901234567', contactName: 'Nguyễn Văn A' });
  assert.equal('contactName' in out, false);
});

test('loadContact: GET /customers/:id/contacts → ready với người liên hệ chính', async () => {
  const f = mockFetch(() => res(200, { data: { items: [contact({ id: 'x', isPrimary: false, fullName: 'Phụ' }), contact()] } }));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const seen = []; c.subscribe(() => seen.push(c.getState().contact.status));
  await c.loadContact(ID);
  assert.deepEqual(seen, ['loading', 'ready']);
  const s = c.getState().contact;
  assert.equal(s.id, ID); assert.equal(s.item.fullName, 'Nguyễn Văn A');
  assert.equal(path(f.calls[0].url), '/customers/' + ID + '/contacts'); assert.equal(f.calls[0].init.method, 'GET');
});

test('loadContact: chưa có người liên hệ => ready, item null', async () => {
  const c = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(() => res(200, { data: { items: [] } })) });
  await c.loadContact(ID);
  assert.equal(c.getState().contact.status, 'ready'); assert.equal(c.getState().contact.item, null);
});

test('loadContact: 403/404/network => error, không có item; id không phải UUID không gọi mạng', async () => {
  for (const [h, kind] of [[() => res(403, { error: { code: 'FORBIDDEN', message: 'x' } }), 'forbidden'], [() => res(404, { error: { code: 'CUSTOMER_NOT_FOUND', message: 'x' } }), 'not_found'], [() => { throw new TypeError('Failed to fetch'); }, 'network']]) {
    const c = createCustomerApiUi({ env: ON, fetchImpl: mockFetch(h) });
    await c.loadContact(ID);
    const s = c.getState().contact;
    assert.equal(s.status, 'error'); assert.equal(s.error.kind, kind); assert.equal(s.item, null);
  }
  const f = mockFetch(() => res(200, { data: { items: [] } })); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadContact('KH-00007');
  assert.equal(c.getState().contact.status, 'error'); assert.equal(f.calls.length, 0);
});

test('loadContact: phản hồi cũ của khách khác bị bỏ', async () => {
  const d1 = deferred();
  const f = mockFetch((url) => (path(url).includes(ID) ? d1.promise : res(200, { data: { items: [contact({ fullName: 'Của KH2' })] } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const p1 = c.loadContact(ID); await c.loadContact(ID2);
  d1.resolve(res(200, { data: { items: [contact({ fullName: 'Của KH1' })] } })); await p1;
  assert.equal(c.getState().contact.id, ID2); assert.equal(c.getState().contact.item.fullName, 'Của KH2');
});

test('submit kèm tên người liên hệ: tạo khách rồi POST contacts {fullName, isPrimary:true, phone = SĐT công ty do máy chủ trả}', async () => {
  const f = mockFetch((url, init) => (path(url) === '/customers' ? res(201, { data: apiCust({ phone: '0283 822 1234' }) }) : res(201, { data: contact({ fullName: 'Trần Thị B' }) })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const r = await c.submit({ name: 'Công ty A', phone: '028 3822 1234' }, '  Trần Thị B  ');
  assert.equal(r.ok, true); assert.equal(r.contactError, undefined);
  assert.equal(f.calls.length, 2);
  assert.equal(path(f.calls[1].url), '/customers/' + ID + '/contacts'); assert.equal(f.calls[1].init.method, 'POST');
  assert.deepEqual(f.calls[1].body, { fullName: 'Trần Thị B', isPrimary: true, phone: '0283 822 1234' });
  assert.equal('contactName' in f.calls[0].body, false);
});

test('submit không có tên người liên hệ: chỉ tạo khách, không gọi contacts', async () => {
  const f = mockFetch(() => res(201, { data: apiCust() }));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  for (const name of [undefined, '', '   ']) { f.calls.length = 0; const r = await c.submit({ name: 'Công ty A', phone: '0901234567' }, name); assert.equal(r.ok, true); assert.equal(f.calls.length, 1); }
});

test('submit: khách đã lưu nhưng người liên hệ lỗi => ok:true + contactError (không giả thành công, không thử lại, không xoá khách)', async () => {
  const f = mockFetch((url) => (path(url) === '/customers' ? res(201, { data: apiCust() }) : res(400, { error: { code: 'VALIDATION_FAILED', message: 'Số điện thoại chưa hợp lệ' } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const r = await c.submit({ name: 'Công ty A', phone: '0901234567' }, 'Nguyễn Văn A');
  assert.equal(r.ok, true); assert.equal(r.customer.id, ID);
  assert.equal(r.contactError.kind, 'bad_request');
  assert.equal(f.calls.length, 2); assert.ok(f.calls.every((x) => x.init.method !== 'DELETE'));
});

test('update kèm tên mới khác tên hiện tại: PATCH rồi POST contacts (người chính mới), cập nhật state.contact', async () => {
  const f = mockFetch((url, init) => {
    if (init.method === 'PATCH') return res(200, { data: apiCust({ version: 3 }) });
    if (init.method === 'POST') return res(201, { data: contact({ id: 'c2', fullName: 'Lê Văn C' }) });
    return res(200, { data: { items: [contact()] } });
  });
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadContact(ID);
  const r = await c.update(ID, { name: 'Công ty A', phone: '028 3822 1234' }, 2, 'Lê Văn C');
  assert.equal(r.ok, true); assert.equal(r.contactError, undefined);
  const post = f.calls.find((x) => x.init.method === 'POST');
  assert.deepEqual(post.body, { fullName: 'Lê Văn C', isPrimary: true, phone: '028 3822 1234' });
  assert.equal(c.getState().contact.item.fullName, 'Lê Văn C');
});

test('update: tên không đổi (kể cả khác khoảng trắng) hoặc để trống => không POST contacts', async () => {
  const f = mockFetch((url, init) => (init.method === 'PATCH' ? res(200, { data: apiCust({ version: 3 }) }) : res(200, { data: { items: [contact()] } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadContact(ID);
  for (const name of [' Nguyễn Văn A ', '', undefined]) { const r = await c.update(ID, { name: 'Công ty A', phone: '0901234567' }, 2, name); assert.equal(r.ok, true); }
  assert.equal(f.calls.filter((x) => x.init.method === 'POST').length, 0);
});

test('update: chưa tải được người liên hệ hiện tại (lỗi) => không POST (tránh tạo trùng khi không biết tên hiện tại)', async () => {
  const f = mockFetch((url, init) => (init.method === 'PATCH' ? res(200, { data: apiCust({ version: 3 }) }) : res(403, { error: { code: 'FORBIDDEN', message: 'x' } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadContact(ID);
  const r = await c.update(ID, { name: 'Công ty A', phone: '0901234567' }, 2, 'Tên mới');
  assert.equal(r.ok, true); assert.equal(f.calls.filter((x) => x.init.method === 'POST').length, 0);
});

test('update: PATCH lỗi => không gọi contacts', async () => {
  const f = mockFetch((url, init) => (init.method === 'PATCH' ? res(403, { error: { code: 'FORBIDDEN', message: 'x' } }) : res(200, { data: { items: [] } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadContact(ID);
  const r = await c.update(ID, { name: 'Công ty A', phone: '0901234567' }, 2, 'Tên mới');
  assert.equal(r.ok, false); assert.equal(f.calls.filter((x) => x.init.method === 'POST').length, 0);
});

test('update: người liên hệ lỗi sau khi PATCH thành công => ok:true + contactError, state.contact giữ tên cũ', async () => {
  const f = mockFetch((url, init) => {
    if (init.method === 'PATCH') return res(200, { data: apiCust({ version: 3 }) });
    if (init.method === 'POST') return res(403, { error: { code: 'FORBIDDEN', message: 'x' } });
    return res(200, { data: { items: [contact()] } });
  });
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadContact(ID);
  const r = await c.update(ID, { name: 'Công ty A', phone: '0901234567' }, 2, 'Tên mới');
  assert.equal(r.ok, true); assert.equal(r.contactError.kind, 'forbidden');
  assert.equal(c.getState().contact.item.fullName, 'Nguyễn Văn A');
});
