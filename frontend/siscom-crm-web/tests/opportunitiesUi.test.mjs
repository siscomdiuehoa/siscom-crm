// Run: node --test tests/opportunitiesUi.test.mjs   (Node >= 18, không dependency). Sales S10: controller màn hình Cơ hội với repository giả
// (danh mục, danh sách + tải thêm + đọc lại không phá, tạo cơ hội, phân loại lỗi). Không mạng, không DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunitiesController } from '../src/features/opportunities/opportunitiesUi.js';
import { describeRepoError } from '../src/features/customers/customerApiUi.js';
import { CustomerRepoError } from '../src/data/api/customerRepository.js';

const META = { stages: [{ id: 's1', code: 'PROSPECTING', label: 'Tiếp cận', defaultProbability: 10 }], types: [{ id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư', requiresProject: false }, { id: 't-install', code: 'INSTALLATION', label: 'Thi công', requiresProject: true }], lostReasons: [] };
const opp = (n) => ({ id: 'o' + n, code: 'CH-000' + n, title: 'Cơ hội ' + n, status: 'OPEN', access: 'FULL', version: 1 });
const pageOf = (items, page, totalPages, total) => ({ items, page, pageSize: 20, total, totalPages });
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
const repoOf = (handler) => { const calls = []; return { calls, qs, opportunities: async (method, path, body) => { calls.push({ method, path, body }); return handler(method, path, body, calls.length); } }; };
const FORM = { customerId: 'c1', title: 'Bán 120 FCU', typeId: 't-supply', isProjectLinked: false, projectName: '', offerScope: '', needSummary: '', expectedAmount: '', expectedCloseDate: '' };

test('loadMeta: gọi GET /opportunities/meta một lần; đã có thì không gọi lại; force thì gọi lại; lỗi 403 được báo', async () => {
  const repo = repoOf(() => META); const ctl = createOpportunitiesController(repo, describeRepoError);
  await ctl.loadMeta(); await ctl.loadMeta();
  assert.equal(repo.calls.length, 1);
  assert.deepEqual(repo.calls[0], { method: 'GET', path: '/opportunities/meta', body: undefined });
  assert.equal(ctl.getState().meta.status, 'ready');
  await ctl.loadMeta(true);
  assert.equal(repo.calls.length, 2);
  const denied = createOpportunitiesController(repoOf(() => { throw new CustomerRepoError('forbidden', 'Bạn không có quyền', { status: 403, code: 'FORBIDDEN' }); }), describeRepoError);
  await denied.loadMeta();
  assert.equal(denied.getState().meta.status, 'error');
  assert.equal(denied.getState().meta.error.kind, 'forbidden');
});

test('load + loadMore: truy vấn đúng bộ lọc, trang kế nối thêm không trùng dòng; hết trang thì không gọi nữa', async () => {
  const repo = repoOf((m, path) => (path.includes('page=2') ? pageOf([opp(2), opp(3)], 2, 2, 3) : pageOf([opp(1), opp(2)], 1, 2, 3)));
  const ctl = createOpportunitiesController(repo, describeRepoError);
  await ctl.load({ status: 'OPEN', q: 'chiller' });
  assert.equal(repo.calls[0].path, '/opportunities?status=OPEN&q=chiller&page=1&pageSize=20&sortBy=updatedAt&sortOrder=desc');
  assert.deepEqual(ctl.getState().list.items.map((o) => o.id), ['o1', 'o2']);
  await ctl.loadMore();
  assert.match(repo.calls[1].path, /status=OPEN&q=chiller&page=2/);
  assert.deepEqual(ctl.getState().list.items.map((o) => o.id), ['o1', 'o2', 'o3']);
  await ctl.loadMore();
  assert.equal(repo.calls.length, 2);
});

test('load: lỗi => trạng thái error, không còn dòng cũ; phản hồi cũ đến muộn bị bỏ (chỉ giữ kết quả của lần lọc sau cùng)', async () => {
  let release; const slow = new Promise((r) => { release = r; });
  const repo = repoOf(async (m, path) => { if (path.includes('status=WON')) { await slow; return pageOf([opp(9)], 1, 1, 1); } return pageOf([opp(1)], 1, 1, 1); });
  const ctl = createOpportunitiesController(repo, describeRepoError);
  const first = ctl.load({ status: 'WON' });
  await ctl.load({ status: 'OPEN' });
  release(); await first;
  assert.deepEqual(ctl.getState().list.items.map((o) => o.id), ['o1']);
  assert.equal(ctl.getState().list.query.status, 'OPEN');
  const bad = createOpportunitiesController(repoOf(() => { throw new CustomerRepoError('network', 'Không kết nối được máy chủ.'); }), describeRepoError);
  await bad.load({});
  assert.equal(bad.getState().list.status, 'error');
  assert.equal(bad.getState().list.error.retryable, true);
  assert.deepEqual(bad.getState().list.items, []);
});

test('reload: đọc lại không phá — lỗi thì GIỮ dòng đang hiển thị và ghi refreshError; thành công thì thay bằng dữ liệu mới', async () => {
  let mode = 'ok';
  const repo = repoOf(() => { if (mode === 'fail') throw new CustomerRepoError('server', 'Máy chủ lỗi', { status: 500 }); return pageOf(mode === 'new' ? [opp(5)] : [opp(1)], 1, 1, 1); });
  const ctl = createOpportunitiesController(repo, describeRepoError);
  await ctl.load({});
  mode = 'fail'; await ctl.reload();
  assert.equal(ctl.getState().list.status, 'ready');
  assert.deepEqual(ctl.getState().list.items.map((o) => o.id), ['o1']);
  assert.equal(ctl.getState().list.refreshError.kind, 'server');
  mode = 'new'; await ctl.reload();
  assert.deepEqual(ctl.getState().list.items.map((o) => o.id), ['o5']);
  assert.equal(ctl.getState().list.refreshError, null);
});

test('create: thiếu trường => KHÔNG gọi mạng, trả lỗi theo ô; đủ => POST đúng thân, đọc lại danh sách, gọi hook', async () => {
  const changed = [];
  const repo = repoOf((m, path) => (m === 'POST' ? { ...opp(7), id: 'o7' } : path === '/opportunities/meta' ? META : pageOf([opp(1)], 1, 1, 1)));
  const ctl = createOpportunitiesController(repo, describeRepoError, { onChanged: (o) => changed.push(o.id) });
  await ctl.loadMeta(); await ctl.load({});
  const before = repo.calls.length;
  const invalid = await ctl.create({ ...FORM, title: '  ', typeId: 't-install' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(Object.keys(invalid.fieldErrors).sort(), ['offerScope', 'projectName', 'title']);
  assert.equal(repo.calls.length, before);
  const r = await ctl.create({ ...FORM, expectedAmount: '7.200.000.000' });
  assert.equal(r.ok, true);
  const post = repo.calls.find((c) => c.method === 'POST');
  assert.deepEqual(post, { method: 'POST', path: '/opportunities', body: { customerId: 'c1', title: 'Bán 120 FCU', typeId: 't-supply', isProjectLinked: false, expectedAmountVnd: '7200000000' } });
  assert.equal(repo.calls[repo.calls.length - 1].method, 'GET'); // đọc lại danh sách sau khi tạo
  assert.deepEqual(changed, ['o7']);
  assert.equal(ctl.getState().busy, null);
});

test('create: 400 của máy chủ gắn lỗi vào đúng ô, giữ nguyên danh sách; bấm hai lần liền nhau chỉ gửi MỘT yêu cầu', async () => {
  const refuse = repoOf((m, path) => { if (m === 'POST') throw new CustomerRepoError('bad_request', 'Dữ liệu gửi lên không hợp lệ.', { status: 400, code: 'VALIDATION_FAILED', details: [{ field: 'projectName', message: 'Vui lòng nhập tên dự án/công trình.' }, { field: 'expectedAmountVnd', message: 'Giá trị phải là chuỗi số nguyên không âm (VNĐ), tối đa 15 chữ số.' }] }); return path === '/opportunities/meta' ? META : pageOf([opp(1)], 1, 1, 1); });
  const ctl = createOpportunitiesController(refuse, describeRepoError);
  await ctl.loadMeta(); await ctl.load({});
  const r = await ctl.create(FORM);
  assert.equal(r.ok, false);
  assert.deepEqual(r.fieldErrors, { projectName: 'Vui lòng nhập tên dự án/công trình.', expectedAmount: 'Giá trị phải là chuỗi số nguyên không âm (VNĐ), tối đa 15 chữ số.' });
  assert.deepEqual(ctl.getState().list.items.map((o) => o.id), ['o1']);
  let release; const gate = new Promise((x) => { release = x; });
  const slow = repoOf(async (m) => { if (m === 'POST') { await gate; return opp(8); } return META; });
  const c2 = createOpportunitiesController(slow, describeRepoError);
  await c2.loadMeta();
  const a = c2.create(FORM); const b = await c2.create(FORM);
  assert.deepEqual(b, { ok: false, duplicate: true });
  release(); assert.equal((await a).ok, true);
  assert.equal(slow.calls.filter((c) => c.method === 'POST').length, 1);
});

test('get: 404 => thông báo của CƠ HỘI (không phải "không tìm thấy khách hàng"); thành công trả dữ liệu; id được mã hoá trong đường dẫn', async () => {
  const repo = repoOf((m, path) => { if (path.endsWith('/gone')) throw new CustomerRepoError('not_found', 'Không tìm thấy khách hàng.', { status: 404 }); return opp(1); });
  const ctl = createOpportunitiesController(repo, describeRepoError);
  const miss = await ctl.get('gone');
  assert.equal(miss.ok, false);
  assert.equal(miss.error.title, 'Không tìm thấy cơ hội');
  assert.doesNotMatch(miss.error.message, /khách hàng/);
  assert.equal((await ctl.get('a/b')).ok, true);
  assert.equal(repo.calls[1].path, '/opportunities/a%2Fb');
});
