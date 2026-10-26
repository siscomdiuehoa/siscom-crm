// Run: node --test tests/customerInvisibleChars.test.mjs   (Node >= 18). Injected fetch only; no network, no DB, no browser.
// S03/OVN03: phạm vi ký tự vô hình. blank() của customerRepository dùng cho name, phone và needsLookups (create + update);
// validateCustomer (customerRules) dùng chung form demo/CSV. Chỉ kiểm hành vi hiện có; không đổi hợp đồng Unicode/độ dài.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerRepository, CustomerRepoError } from '../src/data/api/customerRepository.js';
import { validateCustomer, normalizeCustomer, MSG } from '../src/data/customerRules.js';
import { parseCsv, norm } from '../src/data/util.js';
import { importCustomers, RepoError } from '../src/data/repository/mutations.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LOOKUPS = { customer_tier: [{ code: 'VIP', label: 'VIP' }], customer_status: [], industry: [], source: [], province: [] };
const mockFetch = () => {
  const calls = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (new URL(url).pathname.endsWith('/lookups')) return res(200, { data: LOOKUPS });
    return res(method === 'POST' ? 201 : 200, { data: { id: ID, code: 'KH-00001', name: 'X', phone: '0901234567', version: 2 } });
  };
  f.calls = calls; f.writes = () => calls.filter((c) => c.method !== 'GET'); return f;
};
const repoOf = (f) => createCustomerRepository({ env: ON, fetchImpl: f, local: {} });

const CHARS = { ZWSP: '\u200B', ZWNJ: '\u200C', ZWJ: '\u200D', WJ: '\u2060', BOM: '\uFEFF' };
const INVISIBLE_ONLY = [...Object.values(CHARS), ...Object.values(CHARS).map((c) => c.repeat(3)), ' \u200B \t\u200C\u2060 \uFEFF\u200D ', '\u200B   \u2060'];
const rejected = (e) => e instanceof Error && !(e instanceof CustomerRepoError && e.kind === 'config');

test('repo.create: name chỉ ký tự vô hình/trộn khoảng trắng → bị từ chối, KHÔNG fetch (kể cả lookup)', async () => {
  for (const v of INVISIBLE_ONLY) {
    const f = mockFetch();
    await assert.rejects(() => repoOf(f).create({ name: v, phone: '0901234567' }), rejected, JSON.stringify(v));
    assert.equal(f.calls.length, 0, 'name ' + JSON.stringify(v));
  }
});
test('repo.create: phone chỉ ký tự vô hình/trộn khoảng trắng → bị từ chối, KHÔNG fetch', async () => {
  for (const v of INVISIBLE_ONLY) {
    const f = mockFetch();
    await assert.rejects(() => repoOf(f).create({ name: 'Công ty A', phone: v }), rejected, JSON.stringify(v));
    assert.equal(f.calls.length, 0, 'phone ' + JSON.stringify(v));
  }
});
test('repo.update: name/phone chỉ ký tự vô hình → bị từ chối, KHÔNG fetch', async () => {
  for (const v of INVISIBLE_ONLY) {
    const f1 = mockFetch();
    await assert.rejects(() => repoOf(f1).update(ID, { name: v, phone: '0901234567' }, 1), rejected, 'name ' + JSON.stringify(v));
    const f2 = mockFetch();
    await assert.rejects(() => repoOf(f2).update(ID, { name: 'Công ty A', phone: v }, 1), rejected, 'phone ' + JSON.stringify(v));
    assert.equal(f1.calls.length + f2.calls.length, 0);
  }
});
// Quan sát: blank() coi tier chỉ-vô-hình là trống nên needsLookups=false (không GET /lookups), nhưng adapter không coi nó là trống
// → bị từ chối an toàn (validation, field=tier) TRƯỚC khi POST/PUT. Không lọt dữ liệu; chỉ thông báo lỗi hơi khó hiểu (đề xuất riêng, không sửa ở đây).
test('needsLookups: tier/status chỉ ký tự vô hình → không gọi /lookups và bị từ chối an toàn (không ghi); giá trị thật vẫn gọi lookup', async () => {
  const isTierRejected = (e) => e instanceof CustomerRepoError && e.kind === 'validation' && e.field === 'tier';
  const f = mockFetch();
  await assert.rejects(() => repoOf(f).create({ name: 'Công ty A', phone: '0901234567', tier: '​' }), isTierRejected);
  assert.equal(f.calls.length, 0, 'create: không lookup, không ghi');
  const h = mockFetch();
  await assert.rejects(() => repoOf(h).update(ID, { name: 'Công ty A', phone: '0901234567', tier: '⁠' }, 1), isTierRejected);
  assert.equal(h.calls.length, 0, 'update: không lookup, không ghi');
  const g = mockFetch();
  await repoOf(g).create({ name: 'Công ty A', phone: '0901234567', tier: 'VIP' });
  assert.equal(g.calls.filter((c) => c.method === 'GET').length, 1, 'có lookup khi tier thật');
  assert.equal(g.writes().length, 1);
});
test('tên hợp lệ tiếng Việt (NFC/NFD) và tên có ký tự vô hình GIỮA chữ: vẫn được gửi, blank() không xoá/không đổi nội dung', async () => {
  const names = ['Công ty TNHH Đại Phát', 'Cong\u0302 ty \u0110a\u0323i Pha\u0301t', 'Công\u200Bty', 'ABC\u200D\u200C'];
  for (const name of names) {
    const f = mockFetch();
    await repoOf(f).create({ name, phone: '0901234567' });
    const post = f.writes()[0];
    assert.equal(post.method, 'POST');
    assert.equal(post.body.name, name, 'tên giữ nguyên từng điểm mã (hợp đồng hiện tại: không xoá ký tự vô hình giữa tên)');
  }
});

test('validateCustomer (form demo/CSV dùng chung): name chỉ ký tự vô hình → lỗi name; trộn khoảng trắng cũng vậy', () => {
  for (const v of INVISIBLE_ONLY) assert.equal(validateCustomer({ name: v, phone: '0901234567' }).name, MSG.name, JSON.stringify(v));
});
test('validateCustomer: phone chỉ ký tự vô hình → có lỗi phone (không lọt)', () => {
  for (const v of INVISIBLE_ONLY) assert.ok(validateCustomer({ name: 'Công ty A', phone: v }).phone, JSON.stringify(v));
});
test('validateCustomer: dữ liệu tiếng Việt hợp lệ → không lỗi; tên 1 ký tự thật → nameShort (hợp đồng độ dài giữ nguyên)', () => {
  assert.deepEqual(validateCustomer({ name: 'Công ty TNHH Đại Phát', phone: '0901234567' }), {});
  assert.deepEqual(validateCustomer({ name: 'Cong\u0302 ty \u0110a\u0323i Pha\u0301t', phone: '0901234567' }), {});
  assert.equal(validateCustomer({ name: 'A', phone: '0901234567' }).name, MSG.nameShort);
});
test('đường CSV: normalizeCustomer + validateCustomer (như CustomerIO) cũng từ chối name vô hình', () => {
  for (const v of INVISIBLE_ONLY) {
    const errs = Object.values(validateCustomer(normalizeCustomer({ name: v, phone: '0901234567' }), { customers: [] }));
    assert.ok(errs.includes(MSG.name), JSON.stringify(v));
  }
});

// S05: đường nhập CSV thật ở tầng dữ liệu. Chạy U.parseCsv THẬT -> ánh xạ cột (sao chép từ CustomerIO.take: nằm trong component JSX nên không import được
// offline) -> importCustomers THẬT (data/repository/mutations.js: normalizeCustomer + validateCustomer + quyền customer.import). KHÔNG chạy component React,
// không đọc File/FileReader, không trình duyệt: đây KHÔNG phải E2E nhập CSV trên giao diện.
const csvRows = (text) => {
  const data = parseCsv(text); const head = (data[0] || []).map((h) => norm(h.trim()));
  const col = (label) => head.indexOf(norm(label));
  const map = { name: col('Tên công ty'), taxId: col('Mã số thuế'), industry: col('Ngành nghề'), city: col('Tỉnh/Thành phố'), address: col('Địa chỉ'), phone: col('Điện thoại'), email: col('Email'), tier: col('Phân hạng') };
  return data.slice(1).map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i >= 0 ? (r[i] || '').trim() : '']))).filter((r) => Object.values(r).some(Boolean));
};
const HEADER = 'Tên công ty,Mã số thuế,Ngành nghề,Tỉnh/Thành phố,Địa chỉ,Điện thoại,Email,Phân hạng';
const DB0 = { customers: [], contacts: [], auditLog: [] };
const ADMIN = { user: { name: 'Quản trị', role: 'admin' } };

test('đường nhập CSV thật (parseCsv -> importCustomers): name chỉ ký tự vô hình/trộn khoảng trắng -> RepoError, không thêm khách, DB không đổi', () => {
  for (const v of INVISIBLE_ONLY) {
    const rows = csvRows(HEADER + '\n"' + v + '",,,,,0901234567,,');
    assert.equal(rows.length, 1, JSON.stringify(v));
    const d = structuredClone(DB0);
    assert.throws(() => importCustomers(d, rows, ADMIN), (e) => e instanceof RepoError && e.title === 'Dữ liệu nhập chưa hợp lệ' && Boolean(e.fields.name), JSON.stringify(v));
    assert.deepEqual(d, DB0, 'DB không bị thay đổi');
  }
});
test('đường nhập CSV thật: phone chỉ ký tự vô hình -> RepoError có fields.phone, không thêm khách', () => {
  for (const v of INVISIBLE_ONLY) {
    const rows = csvRows(HEADER + '\n"Công ty A",,,,,"' + v + '",,');
    const d = structuredClone(DB0);
    assert.throws(() => importCustomers(d, rows, ADMIN), (e) => e instanceof RepoError && Boolean(e.fields.phone), JSON.stringify(v));
    assert.deepEqual(d, DB0);
  }
});
test('đường nhập CSV thật: tên tiếng Việt hợp lệ (NFC/NFD) được nhập, giữ nguyên từng điểm mã; có audit import', () => {
  const names = ['Công ty TNHH Đại Phát', 'Cong\u0302 ty \u0110a\u0323i Pha\u0301t'];
  const rows = csvRows(HEADER + '\n' + names.map((n) => '"' + n + '",,,,,0901234567,,').join('\n'));
  const out = importCustomers(structuredClone(DB0), rows, ADMIN);
  assert.deepEqual(out.customers.map((c) => c.name), names);
  assert.equal(out.auditLog[0].action, 'import');
});
