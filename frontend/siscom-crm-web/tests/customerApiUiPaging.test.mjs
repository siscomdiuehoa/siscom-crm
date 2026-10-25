// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// Covers server paging (page/pageSize/search -> GET /customers, total/totalPages/next/prev), server search rules, loading/error states, stale responses, no fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi, buildListParams, normalizePaging } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const uid = (n) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(n).padStart(12, '0');
const apiCust = (n) => ({ id: uid(n), code: 'KH-' + String(n).padStart(5, '0'), name: 'Công ty ' + n, phone: '0901234567', version: 1 });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mockFetch = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls); }; f.calls = calls; return f; };
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const q = (url) => Object.fromEntries(new URL(url).searchParams);
// Fake server: 45 customers, honours page/pageSize like the backend (totalPages = ceil(total/pageSize)).
const pagedServer = (total = 45) => mockFetch((url) => {
  const p = q(url); const page = Number(p.page || 1); const size = Number(p.pageSize || 20);
  const n = p.search ? 3 : total;
  const items = []; for (let i = (page - 1) * size + 1; i <= Math.min(page * size, n); i++) items.push(apiCust(i));
  return res(200, { data: { items, page, pageSize: size, total: n, totalPages: Math.ceil(n / size) } });
});

test('buildListParams: mặc định page=1/pageSize=20; chặn giá trị sai; search <2 ký tự không được gửi', () => {
  assert.deepEqual(buildListParams(), { page: 1, pageSize: 20 });
  assert.deepEqual(buildListParams({ page: 0, pageSize: 500 }), { page: 1, pageSize: 100 });
  assert.deepEqual(buildListParams({ page: 'x', pageSize: -3 }), { page: 1, pageSize: 1 });
  assert.deepEqual(buildListParams({ page: 3.9, pageSize: 10, search: '  ab ' }), { page: 3, pageSize: 10, search: 'ab' });
  assert.deepEqual(buildListParams({ search: ' a ' }), { page: 1, pageSize: 20 });
  assert.deepEqual(buildListParams({ search: '   ' }), { page: 1, pageSize: 20 });
  assert.equal(buildListParams({ search: 'x'.repeat(150) }).search.length, 100);
});

test('normalizePaging: lấy total/totalPages từ máy chủ; thiếu total => null (không bịa)', () => {
  assert.deepEqual(normalizePaging({ page: 2, pageSize: 20, total: 45, totalPages: 3 }, { page: 2, pageSize: 20 }), { page: 2, pageSize: 20, total: 45, totalPages: 3, hasPrev: true, hasNext: true, search: '' });
  const last = normalizePaging({ page: 3, pageSize: 20, total: 45, totalPages: 3 }, { page: 3, pageSize: 20, search: 'ab' });
  assert.equal(last.hasNext, false); assert.equal(last.search, 'ab');
  assert.equal(normalizePaging({ items: [] }, { page: 1, pageSize: 20 }), null);
  assert.equal(normalizePaging({ total: -1 }, {}), null);
  assert.equal(normalizePaging({ total: 0, totalPages: 0 }, { page: 1, pageSize: 20 }).totalPages, 1);
});

test('load: gửi đúng page/pageSize, state loading → ready kèm paging; mặc định không có search', async () => {
  const f = pagedServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  const seen = []; c.subscribe(() => seen.push(c.getState().list.status));
  await c.load();
  assert.deepEqual(seen, ['loading', 'ready']);
  assert.deepEqual(q(f.calls[0].url), { page: '1', pageSize: '20' });
  assert.equal(f.calls[0].init.credentials, 'omit');
  const l = c.getState().list;
  assert.equal(l.items.length, 20); assert.equal(l.paging.total, 45); assert.equal(l.paging.totalPages, 3);
  assert.equal(l.paging.hasPrev, false); assert.equal(l.paging.hasNext, true);
});

test('nextPage/prevPage: đi đúng trang, giữ nguyên UUID ổn định từ máy chủ, dừng ở biên', async () => {
  const f = pagedServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.load();
  await c.prevPage(); assert.equal(f.calls.length, 1, 'trang 1 không có Trước');
  await c.nextPage(); assert.equal(q(f.calls[1].url).page, '2');
  assert.equal(c.getState().list.items[0].id, uid(21)); assert.equal(c.getState().list.items[0].code, 'KH-00021');
  await c.nextPage(); assert.equal(c.getState().list.items.length, 5); assert.equal(c.getState().list.paging.hasNext, false);
  await c.nextPage(); assert.equal(f.calls.length, 3, 'trang cuối không có Sau');
  await c.prevPage(); assert.equal(q(f.calls[3].url).page, '2'); assert.equal(c.getState().list.paging.page, 2);
});

test('search: gửi tham số search (đã trim) của máy chủ, về trang 1, giữ pageSize; <2 ký tự = không gửi search', async () => {
  const f = pagedServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.load(); await c.nextPage();
  await c.search('  công ty  ');
  assert.deepEqual(q(f.calls[2].url), { page: '1', pageSize: '20', search: 'công ty' });
  assert.equal(c.getState().list.paging.total, 3); assert.equal(c.getState().list.paging.search, 'công ty');
  await c.search('a');
  assert.equal('search' in q(f.calls[3].url), false);
  assert.equal(c.getState().list.paging.total, 45);
  await c.search('');
  assert.equal('search' in q(f.calls[4].url), false);
});

test('trang sau khi tìm kiếm vẫn mang theo search; reload dùng lại đúng tham số', async () => {
  const f = mockFetch((url) => { const p = q(url); return res(200, { data: { items: [apiCust(1)], page: Number(p.page), pageSize: 20, total: 50, totalPages: 3 } }); });
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.search('abc'); await c.nextPage();
  assert.deepEqual(q(f.calls[1].url), { page: '2', pageSize: '20', search: 'abc' });
  await c.reload();
  assert.deepEqual(q(f.calls[2].url), { page: '2', pageSize: '20', search: 'abc' });
});

test('lỗi 401/403/400/mạng khi tải trang: state error, không items, không rơi về demo, giữ params để thử lại', async () => {
  for (const [h, kind] of [[() => res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }), 'unauthenticated'], [() => res(403, { error: { code: 'FORBIDDEN', message: 'x' } }), 'forbidden'],
    [() => res(400, { error: { code: 'VALIDATION', message: 'page × pageSize vượt quá 100000.' } }), 'bad_request'], [() => { throw new TypeError('Failed to fetch'); }, 'network']]) {
    let fail = true;
    const f = mockFetch((u, i, calls) => (fail ? h() : res(200, { data: { items: [apiCust(1)], page: 4, pageSize: 20, total: 90, totalPages: 5 } })));
    const c = createCustomerApiUi({ env: ON, fetchImpl: f });
    await c.load({ page: 4 });
    const l = c.getState().list;
    assert.equal(l.status, 'error'); assert.equal(l.error.kind, kind); assert.deepEqual(l.items, []); assert.equal(l.paging, null); assert.equal(l.params.page, 4);
    assert.equal(f.calls.length, 1);
    fail = false; await c.reload();
    assert.equal(q(f.calls[1].url).page, '4'); assert.equal(c.getState().list.status, 'ready');
  }
});

test('phản hồi cũ bị bỏ: bấm Sau liên tiếp, chỉ kết quả mới nhất được hiển thị', async () => {
  const d1 = deferred(); const d2 = deferred(); let n = 0;
  const f = mockFetch(() => { n++; if (n === 1) return res(200, { data: { items: [apiCust(1)], page: 1, pageSize: 20, total: 60, totalPages: 3 } }); return (n === 2 ? d1 : d2).promise; });
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.load();
  const a = c.goToPage(2); const b = c.goToPage(3);
  d2.resolve(res(200, { data: { items: [apiCust(41)], page: 3, pageSize: 20, total: 60, totalPages: 3 } })); await b;
  d1.resolve(res(200, { data: { items: [apiCust(21)], page: 2, pageSize: 20, total: 60, totalPages: 3 } })); await a;
  assert.equal(c.getState().list.paging.page, 3); assert.equal(c.getState().list.items[0].id, uid(41));
});

test('máy chủ không trả total: không có paging (không bịa tổng), danh sách vẫn hiển thị', async () => {
  const f = mockFetch(() => res(200, { data: { items: [apiCust(1)] } }));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.load();
  assert.equal(c.getState().list.status, 'ready'); assert.equal(c.getState().list.paging, null);
  await c.nextPage(); assert.equal(f.calls.length, 1);
});

test('cờ TẮT: không có controller, không fetch; cờ BẬT cấu hình thiếu base: lỗi, không rơi về demo', async () => {
  const f = mockFetch(() => { throw new Error('không được gọi'); });
  assert.equal(createCustomerApiUi({ env: {}, fetchImpl: f }), null);
  const c = createCustomerApiUi({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f });
  await c.load();
  assert.equal(c.getState().list.status, 'error'); assert.deepEqual(c.getState().list.items, []); assert.equal(f.calls.length, 0);
});

test('tạo mới thành công khi đang có phân trang: total/items lấy từ lần đọc lại của máy chủ, không tự cộng/chèn', async () => {
  const f = mockFetch((url, init) => (init.method === 'POST' ? res(201, { data: apiCust(99) }) : res(200, { data: { items: [apiCust(1)], page: 1, pageSize: 20, total: 5, totalPages: 1 } })));
  const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.load();
  const r = await c.submit({ name: 'Công ty 99', phone: '0901234567' });
  assert.equal(r.ok, true);
  assert.equal(c.getState().list.paging.total, 5, 'total do máy chủ báo, không +1 tại máy khách'); assert.deepEqual(c.getState().list.items.map((x) => x.id), [uid(1)]);
});
