// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// Covers remote customer-edit failure recovery: 409 stale version (no silent overwrite, explicit refresh/choice), 401/403 (no retry), 404, network, validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi, diffAgainstServer } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const apiCust = (over = {}) => ({ id: ID, code: 'KH-00007', name: 'Công ty A', phone: '0901234567', version: 2, owner: { id: 'e1', fullName: 'Trần Minh Khoa' }, ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const err = (status, code, message = 'x', details) => res(status, { error: { code, message, details } });
// patch(n) -> response (or Error to throw) for the n-th PATCH (1-based). get(n) -> same for the n-th GET (default: 200 customer v2).
const server = ({ patch, get }) => {
  const calls = []; let np = 0; let ng = 0;
  const f = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, credentials: init.credentials });
    const r = init.method === 'PATCH' ? patch(++np) : (get ? get(++ng) : res(200, { data: apiCust() }));
    if (r instanceof Error) throw r;
    return r;
  };
  f.calls = calls; f.patches = () => calls.filter((c) => c.method === 'PATCH'); f.gets = () => calls.filter((c) => c.method === 'GET');
  return f;
};
const input = { name: 'Công ty A mới', phone: '0901234567', short: '', taxId: '' };
const loaded = async (f) => { const c = createCustomerApiUi({ env: ON, fetchImpl: f }); await c.loadDetail(ID); return c; };
const VERSION_409 = () => err(409, 'CUSTOMER_VERSION_CONFLICT', 'Khách hàng đã được người khác cập nhật. Vui lòng tải lại.', { currentVersion: 5 });

test('409 version stale: không lưu đè, không tự thử lại, giữ nguyên detail, mở trạng thái conflict', async () => {
  const f = server({ patch: VERSION_409 }); const c = await loaded(f);
  const before = c.getState().detail.customer;
  const r = await c.update(ID, input, before.version);
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'conflict'); assert.equal(r.error.staleVersion, true);
  assert.equal(f.patches().length, 1); assert.equal(f.patches()[0].body.version, 2);
  const s = c.getState(); assert.equal(s.update.status, 'error'); assert.deepEqual(s.update.conflict, { status: 'idle', server: null, error: null });
  assert.equal(s.detail.customer, before); assert.equal(s.detail.customer.version, 2);
});

test('409 trùng dữ liệu (mã khác) không phải stale: không mở luồng conflict, nêu lỗi 409', async () => {
  const f = server({ patch: () => err(409, 'CUSTOMER_TAX_ID_DUPLICATE', 'MST đã tồn tại') }); const c = await loaded(f);
  const r = await c.update(ID, input, 2);
  assert.equal(r.error.kind, 'conflict'); assert.equal(r.error.staleVersion, false); assert.equal(c.getState().update.conflict, null);
});

test('refreshConflict: chỉ GET bản máy chủ, KHÔNG đổi detail, KHÔNG PATCH; diff theo bản nháp', async () => {
  const f = server({ patch: VERSION_409, get: (n) => res(200, { data: n === 1 ? apiCust() : apiCust({ version: 5, name: 'Công ty A (người khác sửa)', phone: '0999' }) }) }); const c = await loaded(f);
  await c.update(ID, input, 2);
  const r = await c.refreshConflict(ID);
  assert.equal(r.ok, true);
  const s = c.getState();
  assert.equal(f.gets().length, 2); assert.equal(f.patches().length, 1);
  assert.equal(s.update.conflict.status, 'ready'); assert.equal(s.update.conflict.server.version, 5);
  assert.equal(s.detail.customer.version, 2); assert.equal(s.detail.customer.name, 'Công ty A');
  const d = diffAgainstServer({ ...input }, s.update.conflict.server);
  assert.deepEqual(d.map((x) => x.field), ['name', 'phone']); assert.equal(d[0].mine, 'Công ty A mới'); assert.equal(d[0].server, 'Công ty A (người khác sửa)');
});

test('"Dùng bản máy chủ": detail cập nhật theo máy chủ, conflict đóng, không có PATCH thứ hai', async () => {
  const f = server({ patch: VERSION_409, get: (n) => res(200, { data: n === 1 ? apiCust() : apiCust({ version: 5, name: 'Máy chủ' }) }) }); const c = await loaded(f);
  await c.update(ID, input, 2); await c.refreshConflict(ID);
  const sv = c.acceptServerCopy();
  assert.equal(sv.version, 5); const s = c.getState();
  assert.equal(s.detail.customer.name, 'Máy chủ'); assert.equal(s.detail.customer.version, 5); assert.equal(s.update.conflict, null); assert.equal(s.update.status, 'idle');
  assert.equal(f.patches().length, 1);
});

test('acceptServerCopy khi chưa tải bản máy chủ: không làm gì', async () => {
  const f = server({ patch: VERSION_409 }); const c = await loaded(f);
  await c.update(ID, input, 2);
  assert.equal(c.acceptServerCopy(), null); assert.equal(c.getState().detail.customer.version, 2); assert.equal(c.getState().update.conflict.status, 'idle');
});

test('"Giữ thay đổi của tôi": chỉ ghi khi người dùng bấm lưu lại, với version máy chủ; thành công = phản hồi máy chủ', async () => {
  const f = server({ patch: (n) => (n === 1 ? VERSION_409() : res(200, { data: apiCust({ version: 6, name: input.name }) })), get: (n) => res(200, { data: apiCust({ version: n === 1 ? 2 : 5 }) }) }); const c = await loaded(f);
  await c.update(ID, input, 2); const r0 = await c.refreshConflict(ID);
  assert.equal(f.patches().length, 1); // refresh alone never writes
  c.clearSubmitError(); // what the "keep mine" button does
  const r = await c.update(ID, input, r0.server.version);
  assert.equal(r.ok, true); assert.equal(f.patches().length, 2); assert.equal(f.patches()[1].body.version, 5);
  assert.equal(c.getState().detail.customer.version, 6); assert.equal(c.getState().update.conflict, null);
});

test('refreshConflict lỗi (network / 404 / 403): báo lỗi, không đổi detail, không tự thử lại', async () => {
  for (const [g, kind] of [[() => new TypeError('Failed to fetch'), 'network'], [() => err(404, 'NOT_FOUND'), 'not_found'], [() => err(403, 'FORBIDDEN'), 'forbidden']]) {
    const f = server({ patch: VERSION_409, get: (n) => (n === 1 ? res(200, { data: apiCust() }) : g()) }); const c = await loaded(f);
    await c.update(ID, input, 2); await c.refreshConflict(ID);
    const s = c.getState();
    assert.equal(s.update.conflict.status, 'error'); assert.equal(s.update.conflict.error.kind, kind); assert.ok(s.update.conflict.error.hint);
    assert.equal(s.detail.customer.version, 2); assert.equal(f.gets().length, 2); assert.equal(f.patches().length, 1);
  }
});

test('401/403: báo từ chối truy cập, không tự thử lại/bypass, giữ detail, có hướng dẫn', async () => {
  for (const [st, code, kind] of [[401, 'UNAUTHENTICATED', 'unauthenticated'], [403, 'FORBIDDEN', 'forbidden']]) {
    const f = server({ patch: () => err(st, code) }); const c = await loaded(f);
    const r = await c.update(ID, input, 2);
    assert.equal(r.ok, false); assert.equal(r.error.kind, kind); assert.equal(r.error.status, st); assert.equal(r.error.denied, true); assert.equal(r.error.retryable, false);
    assert.match(r.error.hint, /Không tự động thử lại/); assert.equal(f.calls.length, 2); // 1 GET (detail) + 1 PATCH only
    assert.equal(f.calls.every((x) => x.credentials === 'omit'), true); assert.equal(c.getState().detail.customer.version, 2); assert.equal(c.getState().update.conflict, null);
  }
});

test('404: tiêu đề + hướng dẫn riêng, giữ detail', async () => {
  const f = server({ patch: () => err(404, 'NOT_FOUND', 'Không tìm thấy') }); const c = await loaded(f);
  const r = await c.update(ID, input, 2);
  assert.equal(r.error.kind, 'not_found'); assert.equal(r.error.title, 'Không tìm thấy khách hàng'); assert.ok(r.error.hint); assert.equal(r.error.denied, false);
});

test('mạng lỗi khi lưu: có thể thử lại, hướng dẫn giữ nội dung, không báo thành công', async () => {
  const f = server({ patch: () => new TypeError('Failed to fetch') }); const c = await loaded(f);
  const r = await c.update(ID, input, 2);
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'network'); assert.equal(r.error.retryable, true); assert.match(r.error.hint, /Lưu lại/);
  assert.equal(c.getState().update.status, 'error'); assert.equal(c.getState().detail.customer.name, 'Công ty A');
});

test('validation 400: lỗi theo trường + hướng dẫn', async () => {
  const f = server({ patch: () => err(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', ['phone must be a valid phone number']) }); const c = await loaded(f);
  const r = await c.update(ID, input, 2);
  assert.equal(r.error.kind, 'bad_request'); assert.ok(r.error.fieldErrors.phone); assert.match(r.error.hint, /Sửa các trường/);
});

test('không ghi localStorage ở chế độ API (kể cả luồng conflict)', async () => {
  const writes = []; const prev = globalThis.localStorage;
  globalThis.localStorage = { setItem: (...a) => writes.push(a), removeItem: (...a) => writes.push(a), getItem: () => null, clear: () => writes.push('clear') };
  try {
    const f = server({ patch: VERSION_409, get: (n) => res(200, { data: apiCust({ version: n === 1 ? 2 : 5 }) }) }); const c = await loaded(f);
    await c.update(ID, input, 2); await c.refreshConflict(ID); c.acceptServerCopy();
  } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
  assert.deepEqual(writes, []);
});

test('cờ TẮT: không controller, không fetch (demo localStorage giữ nguyên)', () => {
  const f = server({ patch: () => { throw new Error('không được gọi'); } });
  assert.equal(createCustomerApiUi({ env: {}, fetchImpl: f }), null); assert.equal(f.calls.length, 0);
});
