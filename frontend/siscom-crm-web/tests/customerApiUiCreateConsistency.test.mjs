// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// Sau khi tạo khách hàng ở chế độ API, danh sách/phân trang phải do MÁY CHỦ quyết định (server-authoritative):
// không chèn bản ghi vào đầu trang hiện tại, không tự cộng total, không giữ totalPages cũ, không để phản hồi cũ đè phản hồi mới.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const uid = (n) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(n).padStart(12, '0');
const row = (n, name) => ({ id: uid(n), code: 'KH-' + String(n).padStart(5, '0'), name: name || 'Công ty ' + n, phone: '0901234567', version: 1 });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const INPUT = { name: 'Zeta Mới', phone: '0901234567', short: '', taxId: '' };

// Máy chủ giả có trạng thái: sắp xếp theo mã tăng dần (bản ghi mới nằm CUỐI danh sách), lọc search theo tên, totalPages = ceil(total/pageSize).
// `gate(n)` (tuỳ chọn) cho phép giữ phản hồi GET thứ n để dựng tình huống đua; `mutate(body)` ghi đè phản hồi GET.
function fakeServer(initial, { gate, mutate } = {}) {
  const store = Array.from({ length: initial }, (_, i) => row(i + 1));
  const calls = []; let gets = 0;
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (init.method === 'POST') { const n = store.length + 1; const r = row(n, JSON.parse(init.body).name); store.push(r); return res(201, { data: r }); }
    const n = ++gets; const p = Object.fromEntries(new URL(url).searchParams);
    const page = Number(p.page || 1); const size = Number(p.pageSize || 20);
    const all = p.search ? store.filter((c) => c.name.toLowerCase().includes(p.search.toLowerCase())) : store.slice();
    const body = { items: all.slice((page - 1) * size, page * size), page, pageSize: size, total: all.length, totalPages: Math.ceil(all.length / size) };
    const snapshot = JSON.parse(JSON.stringify(body));
    if (gate && gate(n)) await gate(n).promise;
    return res(200, { data: mutate ? mutate(snapshot, n) : snapshot });
  };
  f.calls = calls; f.store = store; f.gets = () => calls.filter((c) => c.method === 'GET');
  return f;
}
const ctl = (f) => createCustomerApiUi({ env: ON, fetchImpl: f });

test('create khi đang ở trang 2: danh sách = trang 2 do máy chủ trả; bản ghi mới không chen vào đầu trang 2; total/totalPages theo máy chủ', async () => {
  const f = fakeServer(45); const c = ctl(f);
  await c.load({ page: 2 });
  const r = await c.submit(INPUT); assert.equal(r.ok, true);
  const l = c.getState().list;
  assert.equal(l.status, 'ready');
  assert.deepEqual(l.items.map((x) => x.code), Array.from({ length: 20 }, (_, i) => 'KH-' + String(21 + i).padStart(5, '0')), 'đúng 20 dòng của trang 2 theo máy chủ');
  assert.equal(l.items.some((x) => x.name === 'Zeta Mới'), false, 'bản ghi mới thuộc trang 3, không được hiện ở trang 2');
  assert.equal(l.paging.page, 2); assert.equal(l.paging.total, 46); assert.equal(l.paging.totalPages, 3);
});

test('create khi đang tìm kiếm: bản ghi không khớp từ khoá không được hiện trong kết quả tìm kiếm', async () => {
  const f = fakeServer(45); const c = ctl(f);
  await c.search('Công ty 1');
  const before = c.getState().list.paging.total;
  assert.ok(before > 0);
  await c.submit(INPUT);
  const l = c.getState().list;
  assert.equal(l.params.search, 'Công ty 1', 'giữ nguyên từ khoá');
  assert.ok(l.items.every((x) => x.name.includes('Công ty 1')), 'mọi dòng phải khớp từ khoá do máy chủ lọc');
  assert.equal(l.paging.total, before, 'total tìm kiếm không đổi vì bản ghi mới không khớp');
});

test('create khi trang đã đầy (pageSize=20, 20 dòng): không vượt quá pageSize', async () => {
  const f = fakeServer(45); const c = ctl(f);
  await c.load({ page: 1, pageSize: 20 });
  assert.equal(c.getState().list.items.length, 20);
  await c.submit(INPUT);
  const l = c.getState().list;
  assert.ok(l.items.length <= l.paging.pageSize, 'số dòng ' + l.items.length + ' > pageSize ' + l.paging.pageSize);
  assert.equal(l.paging.pageSize, 20);
});

test('ranh giới totalPages: 40 bản ghi (2 trang) + 1 => totalPages=3, hasNext=true (không giữ totalPages cũ)', async () => {
  const f = fakeServer(40); const c = ctl(f);
  await c.load({ page: 2 });
  assert.equal(c.getState().list.paging.totalPages, 2); assert.equal(c.getState().list.paging.hasNext, false);
  await c.submit(INPUT);
  const g = c.getState().list.paging;
  assert.equal(g.total, 41); assert.equal(g.totalPages, 3); assert.equal(g.hasNext, true);
});

test('đua: GET danh sách khởi động TRƯỚC create và trả về SAU create không được đè dữ liệu mới', async () => {
  const slow = deferred(); const f = fakeServer(45, { gate: (n) => (n === 2 ? slow : null) });
  const c = ctl(f);
  await c.load({ page: 1 });
  const late = c.load({ page: 1 });                  // GET #2 bị giữ, sẽ trả total=45 (trước create)
  const r = await c.submit(INPUT);                   // create xong, kéo theo làm mới danh sách (GET #3)
  assert.equal(r.ok, true);
  slow.resolve(); await late;
  const l = c.getState().list;
  assert.equal(l.status, 'ready');
  assert.equal(l.paging.total, 46, 'phản hồi cũ (total=45) không được ghi đè trạng thái sau create');
});

test('phản hồi phân trang sai dạng sau create: không bịa total (paging=null), không giữ total cộng tay', async () => {
  const f = fakeServer(45, { mutate: (b, n) => (n >= 2 ? { items: b.items } : b) });
  const c = ctl(f);
  await c.load({ page: 1 });
  assert.equal(c.getState().list.paging.total, 45);
  const r = await c.submit(INPUT);
  assert.equal(r.ok, true, 'máy chủ đã nhận bản ghi; kết quả tạo không bị biến thành lỗi vì phản hồi danh sách');
  assert.equal(c.getState().list.paging, null, 'không tự suy total=46 từ giá trị cũ');
});

test('làm mới sau create thất bại: create vẫn báo thành công, danh sách ở trạng thái lỗi có thể thử lại, không chèn bản ghi giả', async () => {
  const f = fakeServer(45); const base = f; let fail = false;
  const g = async (url, init) => { if (fail && (!init || !init.method || init.method === 'GET')) return res(500, { error: { code: 'X', message: 'lỗi' } }); return base(url, init); };
  const c = ctl(g);
  await c.load({ page: 1 });
  fail = true;
  const r = await c.submit(INPUT);
  assert.equal(r.ok, true); assert.equal(c.getState().submit.status, 'idle');
  const l = c.getState().list;
  assert.equal(l.status, 'error'); assert.equal(l.error.retryable, true); assert.deepEqual(l.items, []);
  fail = false; await c.reload();
  assert.equal(c.getState().list.status, 'ready'); assert.equal(c.getState().list.paging.total, 46);
});

test('create thất bại: không làm mới danh sách, không đổi total, nhập liệu do giao diện giữ (không có GET thừa)', async () => {
  const f = fakeServer(45); const base = f;
  const g = async (url, init) => (init && init.method === 'POST' ? res(400, { error: { code: 'VALIDATION', message: 'sai', details: [] } }) : base(url, init));
  const c = ctl(g);
  await c.load({ page: 2 });
  const before = c.getState().list;
  const r = await c.submit(INPUT);
  assert.equal(r.ok, false); assert.equal(c.getState().submit.status, 'error');
  assert.equal(c.getState().list, before, 'danh sách giữ nguyên tham chiếu');
  assert.equal(base.gets().length, 1, 'chỉ GET lúc load, không làm mới sau create lỗi');
});

test('làm mới sau create dùng đúng tham số hiện tại (page/pageSize/search) và chỉ gọi API khách hàng', async () => {
  const f = fakeServer(45); const c = ctl(f);
  await c.load({ page: 2, pageSize: 10 });
  await c.submit(INPUT);
  const gets = f.gets();
  assert.equal(gets.length, 2);
  const p = Object.fromEntries(new URL(gets[1].url).searchParams);
  assert.deepEqual(p, { page: '2', pageSize: '10' });
  assert.equal(f.calls.filter((x) => x.method === 'POST').length, 1);
});
