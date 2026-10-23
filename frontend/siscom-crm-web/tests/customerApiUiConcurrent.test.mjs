// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// Yêu cầu chồng chéo trên controller khách hàng (API): list reload / search / create / update / detail / 409 / bản ghi bị xoá.
// Mọi phản hồi do test giữ bằng promise có kiểm soát (gate) để dựng đúng thứ tự đến của phản hồi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const uid = (n) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(n).padStart(12, '0');
const row = (n, over = {}) => ({ id: uid(n), code: 'KH-' + String(n).padStart(5, '0'), name: 'Công ty ' + n, phone: '0901234567', version: 1, ...over });
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const errRes = (status, code) => res(status, { error: { code, message: 'x' } });
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setImmediate(r));

// Máy chủ giả có trạng thái. Mỗi yêu cầu được chụp phản hồi NGAY khi đến máy chủ (snapshot), rồi mới chờ gate (nếu có).
//   hold(match) -> trả deferred; phản hồi của yêu cầu đầu tiên khớp match(method,url) bị giữ đến khi deferred.resolve().
//   Ghi (POST/PATCH) áp dụng lên store NGAY khi đến; hold cho ghi chỉ giữ phản hồi tới client.
function fakeServer(initial) {
  const store = Array.from({ length: initial }, (_, i) => row(i + 1));
  const calls = []; const holds = [];
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url);
    calls.push({ url, method, params: Object.fromEntries(u.searchParams) });
    let out;
    const m = u.pathname.match(/\/customers\/([^/]+)$/);
    if (method === 'POST') { const r = row(store.length + 1, { name: JSON.parse(init.body).name }); store.push(r); out = res(201, { data: r }); }
    else if (method === 'PATCH') {
      const i = store.findIndex((c) => c.id === m[1]);
      if (i < 0) out = errRes(404, 'CUSTOMER_NOT_FOUND');
      else if (f.patchStatus) out = errRes(f.patchStatus, f.patchCode);
      else { store[i] = { ...store[i], ...JSON.parse(init.body), version: store[i].version + 1 }; out = res(200, { data: store[i] }); }
    } else if (m) { const c = store.find((x) => x.id === m[1]); out = c ? res(200, { data: JSON.parse(JSON.stringify(c)) }) : errRes(404, 'CUSTOMER_NOT_FOUND'); }
    else {
      const page = Number(u.searchParams.get('page') || 1); const size = Number(u.searchParams.get('pageSize') || 20);
      out = res(200, { data: JSON.parse(JSON.stringify({ items: store.slice((page - 1) * size, page * size), page, pageSize: size, total: store.length, totalPages: Math.max(1, Math.ceil(store.length / size)) })) });
    }
    const h = holds.find((x) => !x.used && x.match(method, url));
    if (h) { h.used = true; h.seen.resolve(); await h.gate.promise; }
    return out;
  };
  f.calls = calls; f.store = store; f.gets = () => calls.filter((c) => c.method === 'GET');
  f.hold = (match) => { const h = { match, used: false, gate: deferred(), seen: deferred() }; holds.push(h); return { release: () => h.gate.resolve(), seen: h.seen.promise }; };
  return f;
}
const ctl = (f) => createCustomerApiUi({ env: ON, fetchImpl: f });
const isList = (method, url) => method === 'GET' && !/\/customers\/[^/?]+(\?|$)/.test(url);
const isDetail = (id) => (method, url) => method === 'GET' && url.includes('/customers/' + id);
const INPUT = { name: 'Zeta Mới', phone: '0901234567', short: '', taxId: '' };
const UPD = { name: 'Công ty sửa', phone: '0901234567', short: '', taxId: '' };

test('điều hướng trang trong lúc làm mới sau create đang bay: trang người dùng chọn thắng, phản hồi làm mới cũ bị bỏ', async () => {
  const f = fakeServer(45); const c = ctl(f);
  await c.load({ page: 2 });
  const h = f.hold(isList);
  const p = c.submit(INPUT);
  await h.seen; // làm mới sau create đã tới máy chủ (page 2), phản hồi đang bị giữ
  const nav = c.goToPage(3); await nav;
  assert.equal(c.getState().list.paging.page, 3);
  h.release(); const r = await p;
  assert.equal(r.ok, true, 'create vẫn thành công');
  const l = c.getState().list;
  assert.equal(l.paging.page, 3, 'không bị kéo lại trang 2 bởi phản hồi cũ');
  assert.deepEqual(l.params, { page: 3, pageSize: 20 });
  assert.equal(l.items.every((x) => Number(x.code.slice(3)) > 40), true);
});

test('đổi từ khoá tìm kiếm trong lúc làm mới sau create đang bay: kết quả tìm kiếm mới thắng', async () => {
  const f = fakeServer(45); const c = ctl(f);
  await c.load({ page: 1 });
  const h = f.hold(isList);
  const p = c.submit(INPUT); await h.seen;
  await c.search('Công ty 4');
  h.release(); await p;
  const l = c.getState().list;
  assert.equal(l.params.search, 'Công ty 4'); assert.equal(l.params.page, 1);
  assert.equal(l.status, 'ready');
});

test('GET lỗi sau POST thành công rồi thử lại: create không bị coi là thất bại; thử lại dùng đúng tham số; total do máy chủ', async () => {
  const f = fakeServer(45); const c = ctl(f);
  await c.load({ page: 3 });
  const orig = f; let failNext = false;
  const wrapped = async (url, init = {}) => { if (failNext && (init.method || 'GET') === 'GET') { failNext = false; throw new TypeError('network'); } return orig(url, init); };
  const c2 = createCustomerApiUi({ env: ON, fetchImpl: wrapped }); await c2.load({ page: 3 });
  failNext = true;
  const r = await c2.submit(INPUT);
  assert.equal(r.ok, true);
  assert.equal(c2.getState().list.status, 'error');
  assert.equal(c2.getState().submit.status, 'idle');
  assert.deepEqual(c2.getState().list.params, { page: 3, pageSize: 20 });
  await c2.reload();
  assert.equal(c2.getState().list.status, 'ready'); assert.equal(c2.getState().list.paging.total, 46);
  assert.equal(orig.calls.filter((x) => x.method === 'POST').length, 1, 'không POST lại');
});

test('gửi trùng: hai lần submit đồng thời chỉ POST một lần; sau khi xong có thể gửi lại', async () => {
  const f = fakeServer(3); const c = ctl(f); await c.load();
  const h = f.hold((m) => m === 'POST');
  const a = c.submit(INPUT); await h.seen;
  const b = await c.submit(INPUT);
  assert.deepEqual(b, { ok: false, duplicate: true });
  h.release(); assert.equal((await a).ok, true);
  assert.equal(f.calls.filter((x) => x.method === 'POST').length, 1);
  assert.equal((await c.submit(INPUT)).ok, true);
  assert.equal(f.calls.filter((x) => x.method === 'POST').length, 2);
});

test('409 làm mới chi tiết đang bay rồi người dùng mở id khác: phản hồi cũ bị bỏ, chi tiết id mới không bị đụng', async () => {
  const f = fakeServer(5); const c = ctl(f);
  await c.loadDetail(uid(1));
  f.patchStatus = 409; f.patchCode = 'CUSTOMER_VERSION_CONFLICT';
  await c.update(uid(1), UPD, 1);
  assert.equal(c.getState().update.conflict.status, 'idle');
  const h = f.hold(isDetail(uid(1)));
  const rc = c.refreshConflict(uid(1)); await h.seen;
  await c.loadDetail(uid(2));
  h.release(); const r = await rc;
  assert.equal(r.ok, false); assert.equal(r.stale, true);
  const s = c.getState();
  assert.equal(s.detail.id, uid(2)); assert.equal(s.detail.status, 'ready');
  assert.equal(s.update.conflict, null, 'không hiện xung đột của id cũ trên id mới');
});

test('kết quả update id A về muộn sau khi người dùng đã mở id B: lỗi/xung đột của A không được gắn vào B', async () => {
  const f = fakeServer(5); const c = ctl(f);
  await c.loadDetail(uid(1));
  f.patchStatus = 409; f.patchCode = 'CUSTOMER_VERSION_CONFLICT';
  const h = f.hold((m) => m === 'PATCH');
  const up = c.update(uid(1), UPD, 1); await h.seen;
  await c.loadDetail(uid(2));
  h.release(); const r = await up;
  assert.equal(r.ok, false, 'người gọi A vẫn nhận kết quả của A');
  const s = c.getState();
  assert.equal(s.detail.id, uid(2));
  assert.equal(s.update.status, 'idle', 'trạng thái cập nhật thuộc id B phải sạch');
  assert.equal(s.update.error, null); assert.equal(s.update.conflict, null);
});

test('update thành công trong lúc list reload đang bay (GET chụp trước khi ghi): danh sách không được quay về bản cũ', async () => {
  const f = fakeServer(5); const c = ctl(f);
  await c.load();
  const h = f.hold(isList);
  const reload = c.reload(); await h.seen; // snapshot trước khi ghi
  const r = await c.update(uid(2), { ...UPD, name: 'Tên đã sửa' }, 1);
  assert.equal(r.ok, true);
  h.release(); await reload; await tick();
  const l = c.getState().list;
  assert.equal(l.status, 'ready');
  const x = l.items.find((i) => i.id === uid(2));
  assert.equal(x.name, 'Tên đã sửa'); assert.equal(x.version, 2);
});

test('bản ghi đã bị xoá trên máy chủ nhưng còn trên trang cũ: mở chi tiết 404 phải làm mới danh sách từ máy chủ (không xoá tay, không giữ dòng ma)', async () => {
  const f = fakeServer(5); const c = ctl(f);
  await c.load();
  assert.equal(c.getState().list.items.length, 5);
  f.store.splice(2, 1); // người khác xoá KH-00003
  await c.loadDetail(uid(3));
  assert.equal(c.getState().detail.status, 'error'); assert.equal(c.getState().detail.error.kind, 'not_found');
  const l = c.getState().list;
  assert.equal(l.status, 'ready');
  assert.equal(l.items.some((i) => i.id === uid(3)), false, 'dòng đã xoá không còn trong danh sách');
  assert.equal(l.paging.total, 4, 'total do máy chủ');
});

test('bản ghi bị xoá khi đang sửa (PATCH 404): báo not_found, nhập liệu giữ nguyên ở UI, danh sách được làm mới từ máy chủ', async () => {
  const f = fakeServer(5); const c = ctl(f);
  await c.load(); await c.loadDetail(uid(3));
  f.store.splice(2, 1);
  const r = await c.update(uid(3), UPD, 1);
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'not_found');
  assert.equal(c.getState().list.items.some((i) => i.id === uid(3)), false);
  assert.equal(c.getState().detail.customer.id, uid(3), 'không bịa kết quả: chi tiết cũ giữ nguyên');
});

test('404 khi danh sách chưa tải (idle): không phát sinh GET danh sách thừa', async () => {
  const f = fakeServer(2); const c = ctl(f);
  await c.loadDetail(uid(9));
  assert.equal(c.getState().detail.error.kind, 'not_found');
  assert.equal(f.gets().filter((g) => !/\/customers\/[^/?]+/.test(g.url)).length, 0);
});
