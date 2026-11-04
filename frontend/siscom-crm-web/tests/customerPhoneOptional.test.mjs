// OWNER DECISION 04/11/2026 - CUSTOMER PHONE OPTIONAL. Run: node --test tests/ (no network, no DB, no storage).
// Tên vẫn bắt buộc; số điện thoại trống = không có số (không gửi / gửi null để xoá), KHÔNG tạo số giả; có số thì vẫn kiểm định dạng.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerRepository } from '../src/data/api/customerRepository.js';
import { validateCustomer, REQUIRED_FIELDS, MSG } from '../src/data/customerRules.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00009', name: 'Công ty Không SĐT', phone: null, phoneE164: null, version: 1, ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };

test('quy tắc: chỉ tên bắt buộc; trống điện thoại không lỗi; có số sai định dạng vẫn lỗi', () => {
  assert.deepEqual(REQUIRED_FIELDS, ['name']);
  for (const phone of ['', '   ', null, undefined]) assert.equal(validateCustomer({ name: 'Công ty A', phone }).phone, undefined);
  assert.equal(validateCustomer({ name: '', phone: '' }).name, MSG.name);
  assert.equal(validateCustomer({ name: 'Công ty A', phone: '123' }).phone, MSG.phoneFmt);
  assert.equal(validateCustomer({ name: 'Công ty A', phone: '0903 123 456' }).phone, undefined);
  // dữ liệu cũ: số sai định dạng KHÔNG đổi khi sửa thì không báo lỗi (như trước)
  assert.equal(validateCustomer({ name: 'Công ty A', phone: '123' }, { original: { phone: '123' } }).phone, undefined);
});
test('quy tắc: hai khách cùng không có số không bị coi là trùng', () => {
  const customers = [{ id: 'KH-1', short: 'B', name: 'Công ty B', phone: '', taxId: '' }];
  assert.deepEqual(validateCustomer({ name: 'Công ty A', phone: '' }, { customers }), {});
});
test('API create không có số: POST không chứa phone (không tạo số giả), kết quả phone rỗng', async () => {
  for (const phone of ['', '  ', undefined, null]) {
    const f = mockFetch(() => res(201, { data: apiCust() }));
    const repo = createCustomerRepository({ env: ON, fetchImpl: f, local: {} });
    const c = await repo.create({ name: ' Công ty Không SĐT ', phone });
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { name: 'Công ty Không SĐT' });
    assert.equal(c.phone, '');
  }
});
test('API update: thêm số sau gửi số đã trim; xoá số gửi phone null', async () => {
  const add = mockFetch(() => res(200, { data: apiCust({ phone: '0903 123 456', phoneE164: '+84903123456', version: 2 }) }));
  const c = await createCustomerRepository({ env: ON, fetchImpl: add, local: {} }).update(ID, { name: 'Công ty Không SĐT', phone: ' 0903 123 456 ' }, 1);
  assert.equal(add.calls[0].init.method, 'PATCH');
  assert.equal(JSON.parse(add.calls[0].init.body).phone, '0903 123 456');
  assert.equal(c.phone, '0903 123 456');
  const clr = mockFetch(() => res(200, { data: apiCust({ version: 3 }) }));
  await createCustomerRepository({ env: ON, fetchImpl: clr, local: {} }).update(ID, { name: 'Công ty Không SĐT', phone: '' }, 2);
  const body = JSON.parse(clr.calls[0].init.body);
  assert.equal(body.phone, null); assert.equal(body.version, 2);
});
