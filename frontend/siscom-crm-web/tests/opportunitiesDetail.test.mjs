// Run: node --test tests/opportunitiesDetail.test.mjs   (Node >= 18, không dependency). Sales S10c: hàm thuần + controller cho phần còn lại của
// màn hình Cơ hội — Sửa (PATCH), Lịch sử thay đổi, Tài liệu, Hoạt động theo cơ hội, danh sách đã xoá + Khôi phục. Không mạng, không DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  opportunityActions, holdsUpdate, canRestore, initEdit, validateEdit, toPatchBody, probabilityChanged, describeChange, CHANGE_LABEL,
  DOC_KINDS, EMPTY_DOC, validateDocument, toDocumentBody, safeHttps, validateReason, buildListQuery, rebaseEdit, editTouched,
} from '../src/features/opportunities/opportunitiesModel.js';
import { createOpportunitiesController } from '../src/features/opportunities/opportunitiesUi.js';
import { describeRepoError } from '../src/features/customers/customerApiUi.js';
import { CustomerRepoError } from '../src/data/api/customerRepository.js';

const ME = 'e-me';
const scopes = (m) => (p) => m[p];
const META = {
  stages: [{ id: 's1', code: 'PROSPECTING', label: 'Tiếp cận', defaultProbability: 10 }, { id: 's3', code: 'QUOTATION', label: 'Báo giá', defaultProbability: 45 }],
  types: [{ id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư', requiresProject: false }, { id: 't-install', code: 'INSTALLATION', label: 'Thi công', requiresProject: true }],
  lostReasons: [],
};
const opp = (over = {}) => ({
  id: 'o1', code: 'CH-0001', title: 'Bán 120 FCU', status: 'OPEN', access: 'FULL', version: 3, deletedAt: null, type: { id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư' },
  stage: { id: 's1', code: 'PROSPECTING', label: 'Tiếp cận' }, owner: { id: ME, code: 'NV-0003', fullName: 'Trần Bình' }, customer: { id: 'c1', code: 'KH-1', name: 'Công ty A' }, contact: null,
  isProjectLinked: false, projectName: null, offerScope: null, needSummary: 'Cần 2 chiller', expectedAmountVnd: null, expectedCloseDate: null, probability: 10, probabilityOverridden: false, ...over,
});

// ───── Quyền ─────
test('nút Sửa: chỉ khi cơ hội đang mở / tạm hoãn và người dùng đạt opportunity.update; đã Thắng / Thua, bản kỹ thuật, đã xoá => không có', () => {
  const sales = { scopeOf: scopes({ 'opportunity.update': 'OWN' }), meId: ME };
  assert.deepEqual(opportunityActions(opp(), sales), ['edit']);
  assert.deepEqual(opportunityActions(opp({ status: 'ON_HOLD' }), sales), ['edit']);
  assert.deepEqual(opportunityActions(opp({ status: 'WON' }), sales), []);
  assert.deepEqual(opportunityActions(opp({ status: 'LOST' }), sales), []);
  assert.deepEqual(opportunityActions(opp({ owner: { id: 'e-other' } }), sales), []);
  assert.deepEqual(opportunityActions(opp({ access: 'TASK' }), sales), []);
  assert.deepEqual(opportunityActions(opp({ deletedAt: '2026-11-18T00:00:00.000Z' }), sales), []);
});

test('holdsUpdate (thêm hoạt động / tài liệu): theo opportunity.update trên cơ hội, kể cả khi đã đóng; DEPARTMENT / không có mã / bản kỹ thuật / đã xoá => false', () => {
  const own = { scopeOf: scopes({ 'opportunity.update': 'OWN' }), meId: ME };
  assert.equal(holdsUpdate(opp(), own), true);
  assert.equal(holdsUpdate(opp({ status: 'WON' }), own), true);
  assert.equal(holdsUpdate(opp({ owner: { id: 'e-other' } }), own), false);
  assert.equal(holdsUpdate(opp({ owner: { id: 'e-other' } }), { scopeOf: scopes({ 'opportunity.update': 'ALL' }), meId: ME }), true);
  assert.equal(holdsUpdate(opp(), { scopeOf: scopes({ 'opportunity.update': 'DEPARTMENT' }), meId: ME }), false);
  assert.equal(holdsUpdate(opp(), { scopeOf: scopes({ 'opportunity.read': 'ALL' }), meId: ME }), false);
  assert.equal(holdsUpdate(opp({ access: 'TASK' }), own), false);
  assert.equal(holdsUpdate(opp({ deletedAt: 'x' }), own), false);
  assert.equal(holdsUpdate(null, own), false);
  assert.equal(holdsUpdate(opp(), { scopeOf: () => { throw new Error('x'); }, meId: ME }), false);
});

test('canRestore: cần opportunity.restore phạm vi ALL VÀ có opportunity.read; thiếu một trong hai => false', () => {
  assert.equal(canRestore(scopes({ 'opportunity.restore': 'ALL', 'opportunity.read': 'ALL' })), true);
  assert.equal(canRestore(scopes({ 'opportunity.restore': 'OWN', 'opportunity.read': 'ALL' })), false);
  assert.equal(canRestore(scopes({ 'opportunity.restore': 'ALL' })), false);
  assert.equal(canRestore(scopes({ 'opportunity.read': 'ALL' })), false);
  assert.equal(canRestore(undefined), false);
  assert.equal(buildListQuery({ deleted: 'only' }).deleted, 'only');
  assert.equal('deleted' in buildListQuery({ deleted: 'all' }), false);
});

// ───── Sửa cơ hội ─────
test('initEdit: điền sẵn từ chi tiết; giá trị trống là ô rỗng (KHÔNG phải 0); số 0 thật vẫn là "0"', () => {
  const f = initEdit(opp());
  assert.equal(f.expectedAmount, ''); assert.equal(f.probability, '10'); assert.equal(f.title, 'Bán 120 FCU'); assert.equal(f.contactId, ''); assert.equal(f.probabilityReason, '');
  assert.equal(initEdit(opp({ expectedAmountVnd: '0' })).expectedAmount, '0');
  assert.equal(initEdit(opp({ expectedAmountVnd: '7200000000', contact: { id: 'k1', fullName: 'An' } })).contactId, 'k1');
});

test('toPatchBody: không đổi gì => {}; chỉ gửi trường thực sự đổi; không bao giờ gửi version / giai đoạn / trạng thái / người phụ trách / khách hàng', () => {
  const o = opp({ expectedAmountVnd: '7200000000', expectedCloseDate: '2026-12-20' });
  assert.deepEqual(toPatchBody(o, initEdit(o), META), {});
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), title: '  Bán 150 FCU ' }, META), { title: 'Bán 150 FCU' });
  const b = toPatchBody(o, { ...initEdit(o), needSummary: 'Cần 3 chiller', expectedCloseDate: '2027-01-15' }, META);
  assert.deepEqual(b, { needSummary: 'Cần 3 chiller', expectedCloseDate: '2027-01-15' });
  for (const k of ['version', 'stageId', 'status', 'ownerId', 'customerId']) assert.equal(k in b, false);
});

test('toPatchBody — giá trị dự kiến: xoá ô => null ("Chưa rõ"), KHÔNG bao giờ thành 0 hay "0"; nhập có dấu chấm => chuỗi chữ số; từ trống sang 0 là thay đổi thật', () => {
  const o = opp({ expectedAmountVnd: '7200000000' });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), expectedAmount: '' }, META), { expectedAmountVnd: null });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), expectedAmount: '8.500.000.000' }, META), { expectedAmountVnd: '8500000000' });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), expectedAmount: '7.200.000.000 đ' }, META), {});
  const unknown = opp();
  assert.deepEqual(toPatchBody(unknown, initEdit(unknown), META), {}); // trống giữ trống: không gửi gì, không tự điền 0
  assert.deepEqual(toPatchBody(unknown, { ...initEdit(unknown), expectedAmount: '0' }, META), { expectedAmountVnd: '0' });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), expectedAmount: '12abc' }, META), {}); // sai dạng: validateEdit chặn, không gửi rác
});

test('toPatchBody — xoá chữ / ngày / người liên hệ => null; xác suất chỉ gửi khi đổi và luôn kèm lý do', () => {
  const o = opp({ expectedCloseDate: '2026-12-20', contact: { id: 'k1', fullName: 'An' } });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), needSummary: ' ', expectedCloseDate: '', contactId: '' }, META), { needSummary: null, expectedCloseDate: null, contactId: null });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), contactId: 'k2' }, META), { contactId: 'k2' });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), probability: '60', probabilityReason: ' Khách đã duyệt ngân sách ' }, META), { probability: 60, probabilityReason: 'Khách đã duyệt ngân sách' });
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), probability: '10', probabilityReason: 'thừa' }, META), {}); // không đổi xác suất => không gửi lý do (máy chủ từ chối lý do thừa)
  assert.equal(probabilityChanged({ probability: '10' }, o), false); assert.equal(probabilityChanged({ probability: ' 11 ' }, o), true); assert.equal(probabilityChanged({ probability: 'abc' }, o), false);
});

test('toPatchBody — loại / gắn dự án: đổi sang loại có thi công => tự gắn dự án + gửi tên dự án, phạm vi; bỏ gắn dự án => chỉ gửi isProjectLinked=false (máy chủ tự xoá hai trường)', () => {
  const o = opp();
  assert.deepEqual(toPatchBody(o, { ...initEdit(o), typeId: 't-install', projectName: 'KS Biển Xanh', offerScope: 'Lắp 120 FCU' }, META),
    { typeId: 't-install', isProjectLinked: true, projectName: 'KS Biển Xanh', offerScope: 'Lắp 120 FCU' });
  const linked = opp({ isProjectLinked: true, projectName: 'KS Biển Xanh', offerScope: 'Cấp FCU' });
  assert.deepEqual(toPatchBody(linked, { ...initEdit(linked), isProjectLinked: false }, META), { isProjectLinked: false });
  assert.deepEqual(toPatchBody(linked, { ...initEdit(linked), offerScope: 'Cấp 150 FCU' }, META), { offerScope: 'Cấp 150 FCU' });
});

test('validateEdit: tiêu đề bắt buộc; loại có thi công bắt buộc tên dự án + phạm vi; xác suất 0–100 nguyên; đổi xác suất bắt buộc lý do; giá trị sai dạng bị chặn', () => {
  const o = opp();
  assert.deepEqual(validateEdit(initEdit(o), META, o), {});
  assert.equal(validateEdit({ ...initEdit(o), title: ' ' }, META, o).title, 'Vui lòng nhập tiêu đề cơ hội');
  const e = validateEdit({ ...initEdit(o), typeId: 't-install' }, META, o);
  assert.ok(e.projectName && e.offerScope); assert.equal('customerId' in e, false);
  for (const bad of ['', 'abc', '101', '-1', '5.5', '1000']) assert.equal(validateEdit({ ...initEdit(o), probability: bad }, META, o).probability, 'Xác suất là số nguyên từ 0 đến 100', bad);
  assert.equal(validateEdit({ ...initEdit(o), probability: '60' }, META, o).probabilityReason, 'Sửa xác suất phải ghi lý do');
  assert.deepEqual(validateEdit({ ...initEdit(o), probability: '60', probabilityReason: 'Khách duyệt' }, META, o), {});
  assert.deepEqual(validateEdit({ ...initEdit(o), probability: '0', probabilityReason: 'Khách dừng' }, META, o), {});
  assert.ok(validateEdit({ ...initEdit(o), expectedAmount: '12abc' }, META, o).expectedAmount);
  assert.ok(validateEdit({ ...initEdit(o), expectedCloseDate: '2026-02-30' }, META, o).expectedCloseDate);
});

// ───── Lịch sử ─────
test('describeChange: giá trị trống của số tiền là "Chưa rõ" (không phải 0); giai đoạn hiện tên theo danh mục; trạng thái, ngày, xác suất đúng dạng', () => {
  const d = (c) => describeChange(c, { meta: META, o: opp() });
  assert.deepEqual(d({ field: 'AMOUNT', oldValue: null, newValue: '7200000000' }), { label: 'Giá trị dự kiến', text: 'Chưa rõ → 7.200.000.000 đ' });
  assert.deepEqual(d({ field: 'AMOUNT', oldValue: '7200000000', newValue: null }), { label: 'Giá trị dự kiến', text: '7.200.000.000 đ → Chưa rõ' });
  assert.equal(d({ field: 'AMOUNT', oldValue: null, newValue: '0' }).text, 'Chưa rõ → 0 đ');
  assert.equal(d({ field: 'STAGE', oldValue: 'PROSPECTING', newValue: 'QUOTATION' }).text, 'Tiếp cận → Báo giá');
  assert.equal(d({ field: 'STAGE', oldValue: 'PROSPECTING', newValue: 'MA_LA' }).text, 'Tiếp cận → MA_LA');
  assert.equal(d({ field: 'STATUS', oldValue: 'OPEN', newValue: 'ON_HOLD' }).text, 'Đang mở → Tạm hoãn');
  assert.equal(d({ field: 'PROBABILITY', oldValue: '10', newValue: '60' }).text, '10% → 60%');
  assert.equal(d({ field: 'CLOSE_DATE', oldValue: null, newValue: '2026-12-20' }).text, '— → 20/12/2026');
  assert.deepEqual(d({ field: 'HOLD', oldValue: null, newValue: '2026-12-01' }), { label: 'Ngày liên hệ lại', text: '— → 01/12/2026' });
  assert.deepEqual(d({ field: 'KHAC', oldValue: 'a', newValue: 'b' }), { label: 'KHAC', text: 'a → b' });
  assert.equal(describeChange({ field: 'STAGE', oldValue: 'PROSPECTING', newValue: 'QUOTATION' }).text, 'PROSPECTING → QUOTATION'); // chưa có danh mục: hiện mã, không sập
  assert.equal(Object.keys(CHANGE_LABEL).length, 7);
});

test('describeChange — người phụ trách: KHÔNG bao giờ hiện id thô; chỉ hiện tên khi trùng người phụ trách hiện tại', () => {
  const o = opp();
  assert.deepEqual(describeChange({ field: 'OWNER', oldValue: 'e-old', newValue: ME }, { o }), { label: 'Người phụ trách', text: 'Chuyển cho Trần Bình' });
  const other = describeChange({ field: 'OWNER', oldValue: 'e-old-uuid', newValue: 'e-new-uuid' }, { o });
  assert.equal(other.text, 'Đã chuyển người phụ trách'); assert.doesNotMatch(other.text, /uuid/);
});

// ───── Tài liệu ─────
test('tài liệu: chỉ https không khoảng trắng; tên tệp bắt buộc ≤ 255; nhóm TECHNICAL / COMMERCIAL; thân yêu cầu đã cắt khoảng trắng', () => {
  assert.deepEqual(DOC_KINDS.map((x) => x.value), ['TECHNICAL', 'COMMERCIAL']); assert.equal(EMPTY_DOC.kind, 'TECHNICAL');
  assert.deepEqual(validateDocument({ kind: 'TECHNICAL', fileName: 'bv.pdf', url: 'https://drive.example.com/a' }), {});
  const e = validateDocument({ kind: 'KHAC', fileName: ' ', url: '' });
  assert.deepEqual(Object.keys(e).sort(), ['fileName', 'kind', 'url']);
  for (const bad of ['http://a.example/x', 'javascript:alert(1)', 'https://a.example/x y', 'ftp://a', 'https://' + 'a'.repeat(1000)]) assert.ok(validateDocument({ kind: 'TECHNICAL', fileName: 'a', url: bad }).url, bad);
  assert.ok(validateDocument({ kind: 'TECHNICAL', fileName: 'a'.repeat(256), url: 'https://a.example/x' }).fileName);
  assert.deepEqual(toDocumentBody({ kind: 'COMMERCIAL', fileName: ' bg.pdf ', url: ' https://a.example/x ' }), { kind: 'COMMERCIAL', fileName: 'bg.pdf', url: 'https://a.example/x' });
  assert.equal(safeHttps('https://a.example/x'), 'https://a.example/x');
  for (const bad of ['javascript:alert(1)', 'http://a.example', 'data:text/html,x', '', null, undefined, 5, 'https://a b']) assert.equal(safeHttps(bad), null, String(bad));
  assert.deepEqual(validateReason(' ', 'Phải ghi lý do'), { reason: 'Phải ghi lý do' }); assert.deepEqual(validateReason('ok', 'x'), {}); assert.ok(validateReason('a'.repeat(501), 'x').reason);
});

// ───── Controller ─────
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
const repoOf = (handler, extra = {}) => { const calls = []; return { calls, qs, ...extra, opportunities: async (method, path, body) => { calls.push({ method, path, body }); return handler(method, path, body, calls.length); } }; };
const pageOf = (items) => ({ items, page: 1, pageSize: 20, total: items.length, totalPages: 1 });
const conflict = () => new CustomerRepoError('conflict', 'Xung đột dữ liệu', { status: 409, code: 'OPPORTUNITY_VERSION_CONFLICT' });

test('update: thiếu trường / không đổi gì => KHÔNG gọi mạng; đổi => PATCH đúng đường dẫn, kèm version, chỉ trường đổi; đọc lại danh sách + gọi hook', async () => {
  const changed = [];
  const repo = repoOf((m, path) => (m === 'GET' ? (path === '/opportunities/meta' ? META : pageOf([opp()])) : opp({ version: 4, title: 'Bán 150 FCU' })));
  const ctl = createOpportunitiesController(repo, describeRepoError, { onChanged: (o) => changed.push(o.version) });
  await ctl.loadMeta(); await ctl.load({});
  const o = opp({ id: 'o/1', expectedAmountVnd: '7200000000' }); const before = repo.calls.length;
  const bad = await ctl.update(o, { ...initEdit(o), title: '' });
  assert.deepEqual([bad.ok, bad.invalid, bad.fieldErrors.title], [false, true, 'Vui lòng nhập tiêu đề cơ hội']);
  const same = await ctl.update(o, initEdit(o));
  assert.deepEqual([same.ok, same.unchanged], [true, true]);
  assert.equal(repo.calls.length, before);
  const r = await ctl.update(o, { ...initEdit(o), title: 'Bán 150 FCU', expectedAmount: '' });
  assert.equal(r.ok, true);
  assert.deepEqual(repo.calls[before], { method: 'PATCH', path: '/opportunities/o%2F1', body: { version: 3, title: 'Bán 150 FCU', expectedAmountVnd: null } });
  assert.equal(repo.calls[before + 1].method, 'GET'); // danh sách được đọc lại
  assert.deepEqual(changed, [4]); assert.equal(ctl.getState().busy, null);
});

test('update: 409 => stale + đọc lại danh sách; 400 theo trường gắn đúng ô (expectedAmountVnd -> ô giá trị); 403 không đọc lại; bấm đúp chỉ gửi một lần', async () => {
  let mode = 409; let release; const gate = new Promise((x) => { release = x; });
  const repo = repoOf(async (m) => {
    if (m === 'GET') return pageOf([opp()]);
    if (mode === 409) throw conflict();
    if (mode === 400) throw new CustomerRepoError('bad_request', 'Dữ liệu gửi lên không hợp lệ.', { status: 400, details: [{ field: 'expectedAmountVnd', message: 'Từ giai đoạn Báo giá phải có giá trị dự kiến.' }, { field: 'probabilityReason', message: 'Sửa xác suất phải ghi lý do.' }] });
    if (mode === 403) throw new CustomerRepoError('forbidden', 'Không có quyền', { status: 403, code: 'FORBIDDEN' });
    await gate; return opp({ version: 4 });
  });
  const ctl = createOpportunitiesController(repo, describeRepoError);
  await ctl.load({});
  const o = opp(); const form = { ...initEdit(o), title: 'Mới' };
  const stale = await ctl.update(o, form);
  assert.deepEqual([stale.ok, stale.stale, stale.error.code], [false, true, 'OPPORTUNITY_VERSION_CONFLICT']);
  assert.equal(repo.calls.filter((c) => c.method === 'GET').length, 2);
  mode = 400;
  assert.deepEqual((await ctl.update(o, form)).fieldErrors, { expectedAmount: 'Từ giai đoạn Báo giá phải có giá trị dự kiến.', probabilityReason: 'Sửa xác suất phải ghi lý do.' });
  mode = 403;
  const denied = await ctl.update(o, form);
  assert.deepEqual([denied.ok, denied.stale, denied.error.kind], [false, false, 'forbidden']);
  assert.equal(repo.calls.filter((c) => c.method === 'GET').length, 2);
  mode = 200;
  const a = ctl.update(o, form); const b = await ctl.update(o, form);
  assert.deepEqual(b, { ok: false, duplicate: true });
  release(); assert.equal((await a).ok, true);
  assert.equal(repo.calls.filter((c) => c.method === 'PATCH').length, 4);
});

test('restore: POST /restore kèm version của dòng đã xoá; thành công => đọc lại danh sách (vẫn deleted=only); 409 khách còn bị xoá được trả nguyên thông báo', async () => {
  let fail = false;
  const repo = repoOf((m) => { if (m === 'GET') return pageOf([opp({ deletedAt: 'x' })]); if (fail) throw new CustomerRepoError('conflict', 'Khách hàng của cơ hội đang bị xoá; hãy khôi phục khách hàng trước.', { status: 409, code: 'OPPORTUNITY_CUSTOMER_DELETED' }); return opp({ version: 4 }); });
  const ctl = createOpportunitiesController(repo, describeRepoError);
  await ctl.load({ deleted: 'only' });
  assert.match(repo.calls[0].path, /deleted=only/);
  const r = await ctl.restore(opp({ id: 'o/9', version: 7, deletedAt: 'x' }));
  assert.equal(r.ok, true);
  assert.deepEqual(repo.calls[1], { method: 'POST', path: '/opportunities/o%2F9/restore', body: { version: 7 } });
  assert.match(repo.calls[2].path, /deleted=only/);
  fail = true;
  const bad = await ctl.restore(opp({ version: 7 }));
  assert.deepEqual([bad.ok, bad.error.code], [false, 'OPPORTUNITY_CUSTOMER_DELETED']);
  assert.match(bad.error.message, /khôi phục khách hàng trước/);
});

test('activities: GET theo cơ hội với trang + bộ lọc (bộ lọc rỗng không gửi); 404 => thông báo của cơ hội', async () => {
  const repo = repoOf((m, path) => { if (path.includes('/gone/')) throw new CustomerRepoError('not_found', 'Không tìm thấy khách hàng.', { status: 404 }); return { items: [], access: 'FULL', page: 1, pageSize: 20, total: 0, totalPages: 0 }; });
  const ctl = createOpportunitiesController(repo, describeRepoError);
  assert.equal((await ctl.activities('o/1')).ok, true);
  assert.equal(repo.calls[0].path, '/opportunities/o%2F1/activities?page=1&pageSize=20');
  await ctl.activities('o1', { type: 'TASK', status: 'OPEN' }, 2);
  assert.equal(repo.calls[1].path, '/opportunities/o1/activities?page=2&pageSize=20&type=TASK&status=OPEN');
  const miss = await ctl.activities('gone');
  assert.equal(miss.error.title, 'Không tìm thấy cơ hội');
});

test('createActivity: thiếu nội dung / công việc thiếu hạn => không gọi mạng; đủ => POST đúng thân (giờ +07:00, không gửi người thực hiện / người liên hệ), báo tab đọc lại; lỗi 400 dạng chuỗi gắn đúng ô', async () => {
  let fail = false; const changed = [];
  const repo = repoOf((m) => { if (fail) throw new CustomerRepoError('bad_request', 'Dữ liệu gửi lên không hợp lệ.', { status: 400, details: ['Thời điểm nhắc phải không sau hạn.'] }); return { id: 'a1', code: 'HD-1', type: 'TASK' }; });
  const ctl = createOpportunitiesController(repo, describeRepoError, { onChanged: () => changed.push(1) });
  const draft = { type: 'TASK', title: 'Gửi báo giá', content: '', outcome: '', occurredAt: '', dueAt: '', remindAt: '', contactId: '', performedById: '', external: false };
  const bad = await ctl.createActivity('o1', draft);
  assert.deepEqual([bad.ok, bad.invalid], [false, true]); assert.ok(bad.fieldErrors.content && bad.fieldErrors.dueAt);
  assert.equal(repo.calls.length, 0);
  const t0 = ctl.getState().activityTick;
  const r = await ctl.createActivity('o/1', { ...draft, content: 'Gửi trước thứ 6', dueAt: '2026-11-20T17:00' });
  assert.equal(r.ok, true);
  assert.deepEqual(repo.calls[0], { method: 'POST', path: '/opportunities/o%2F1/activities', body: { type: 'TASK', content: 'Gửi trước thứ 6', title: 'Gửi báo giá', dueAt: '2026-11-20T17:00:00+07:00' } });
  assert.equal(ctl.getState().activityTick, t0 + 1); assert.deepEqual(changed, [1]); // hook: chuông Công việc đọc lại
  fail = true;
  const e = await ctl.createActivity('o1', { ...draft, content: 'x', dueAt: '2026-11-20T17:00' });
  assert.equal(e.ok, false); assert.equal(e.fieldErrors.remindAt, 'Thời điểm nhắc phải không sau hạn.');
  assert.equal(ctl.getState().activityTick, t0 + 1);
  ctl.touchActivities(); assert.equal(ctl.getState().activityTick, t0 + 2);
});

test('changes / documents: đọc đúng đường dẫn; lỗi 403 được trả về (không ném)', async () => {
  const repo = repoOf((m, path) => { if (path.endsWith('/changes')) throw new CustomerRepoError('forbidden', 'Lịch sử thay đổi chỉ dành cho người xem đầy đủ cơ hội.', { status: 403, code: 'FORBIDDEN' }); return { items: [], access: 'TASK' }; });
  const ctl = createOpportunitiesController(repo, describeRepoError);
  const h = await ctl.changes('o/1');
  assert.deepEqual([h.ok, h.error.kind], [false, 'forbidden']); assert.equal(repo.calls[0].path, '/opportunities/o%2F1/changes');
  const d = await ctl.documents('o/1');
  assert.deepEqual([d.ok, d.data.access], [true, 'TASK']); assert.equal(repo.calls[1].path, '/opportunities/o%2F1/documents');
});

test('addDocument / removeDocument: kiểm tại chỗ trước (không gọi mạng); thân yêu cầu đúng; không đọc lại danh sách cơ hội, không gọi hook', async () => {
  const changed = [];
  const repo = repoOf((m) => (m === 'GET' ? pageOf([opp()]) : m === 'DELETE' ? { id: 'd1', deleted: true } : { id: 'd1', kind: 'TECHNICAL', fileName: 'bv.pdf', url: 'https://a.example/x' }));
  const ctl = createOpportunitiesController(repo, describeRepoError, { onChanged: () => changed.push(1) });
  await ctl.load({});
  const bad = await ctl.addDocument('o1', { kind: 'TECHNICAL', fileName: 'bv.pdf', url: 'http://a.example/x' });
  assert.deepEqual([bad.ok, bad.invalid], [false, true]); assert.ok(bad.fieldErrors.url);
  assert.equal(repo.calls.length, 1);
  assert.equal((await ctl.addDocument('o/1', { kind: 'TECHNICAL', fileName: ' bv.pdf ', url: 'https://a.example/x' })).ok, true);
  assert.deepEqual(repo.calls[1], { method: 'POST', path: '/opportunities/o%2F1/documents', body: { kind: 'TECHNICAL', fileName: 'bv.pdf', url: 'https://a.example/x' } });
  const noReason = await ctl.removeDocument('o1', 'd1', '  ');
  assert.deepEqual(noReason.fieldErrors, { reason: 'Xoá tài liệu phải ghi lý do' });
  assert.equal((await ctl.removeDocument('o/1', 'd/1', ' Nhầm tệp ')).ok, true);
  assert.deepEqual(repo.calls[2], { method: 'DELETE', path: '/opportunities/o%2F1/documents/d%2F1', body: { reason: 'Nhầm tệp' } });
  assert.equal(repo.calls.length, 3); assert.deepEqual(changed, []);
});

test('contacts: dùng API người liên hệ của khách; lỗi được trả về (biểu mẫu Sửa vẫn dùng được, chỉ thiếu ô chọn)', async () => {
  const ok = createOpportunitiesController(repoOf(() => ({}), { contacts: async (id) => [{ id: 'k1', fullName: 'An', customerId: id }] }), describeRepoError);
  assert.deepEqual((await ok.contacts('c1')).items.map((x) => x.id), ['k1']);
  const bad = createOpportunitiesController(repoOf(() => ({}), { contacts: async () => { throw new CustomerRepoError('forbidden', 'Không có quyền', { status: 403 }); } }), describeRepoError);
  const r = await bad.contacts('c1');
  assert.deepEqual([r.ok, r.error.kind], [false, 'forbidden']);
});

test('tab Hoạt động không đọc lại thừa: hook chuông gọi touchActivities() bị bỏ qua khi sửa trường / khôi phục / xoá; ghi nhận hoạt động báo đúng MỘT lần; thao tác vòng đời (tạm hoãn…) vẫn báo', async () => {
  let ctl;
  const repo = repoOf((m, path) => (m === 'GET' ? (path === '/opportunities/meta' ? META : pageOf([opp()])) : path.endsWith('/activities') ? { id: 'a1', code: 'HD-1', type: 'CALL' } : opp({ version: 4 })));
  ctl = createOpportunitiesController(repo, describeRepoError, { onChanged: async () => { await Promise.resolve(); ctl.touchActivities(); } }); // mô phỏng: hook chuông => tasks.refreshAll => touchActivities
  await ctl.loadMeta();
  const tick = () => ctl.getState().activityTick; const t0 = tick();
  const o = opp();
  assert.equal((await ctl.update(o, { ...initEdit(o), title: 'Mới' })).ok, true); assert.equal(tick(), t0);
  assert.equal((await ctl.restore(opp({ deletedAt: 'x' }))).ok, true); assert.equal(tick(), t0);
  assert.equal((await ctl.act('delete', o, { reason: 'Nhập nhầm' })).ok, true); assert.equal(tick(), t0);
  const draft = { type: 'CALL', title: '', content: 'Đã gọi', outcome: '', occurredAt: '', dueAt: '', remindAt: '', contactId: '', performedById: '', external: false };
  assert.equal((await ctl.createActivity('o1', draft)).ok, true); assert.equal(tick(), t0 + 1);
  assert.equal((await ctl.act('hold', o, { holdUntil: '2026-12-01', holdReason: 'Chờ ngân sách' })).ok, true); assert.equal(tick(), t0 + 2); // tạm hoãn tự tạo công việc nhắc => tab phải đọc lại
  ctl.touchActivities(); assert.equal(tick(), t0 + 3); // sau các thao tác trên, lời báo bình thường vẫn hoạt động
});

// ───── PR249-R1-01: lưu lại sau xung đột (409) không được ghi đè trường người dùng CHƯA sửa ─────
test('PR249-R1-01 (ca của reviewer): A chỉ sửa nhu cầu, B đổi tiền 100 -> 200; sau khi tải bản mới, thân PATCH của A KHÔNG chứa tiền', () => {
  const base = opp({ expectedAmountVnd: '100', needSummary: 'old' });
  const latest = opp({ expectedAmountVnd: '200', needSummary: 'old', version: 4 });
  const form = { ...initEdit(base), needSummary: 'my edit' };
  assert.deepEqual(editTouched(base, form), ['needSummary']);
  const r = rebaseEdit(base, latest, form);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.form.expectedAmount, '200'); assert.equal(r.form.needSummary, 'my edit');
  assert.deepEqual(toPatchBody(latest, r.form, META), { needSummary: 'my edit' });
});

test('PR249-R1-01: hai người cùng sửa MỘT trường => báo xung đột (không tự ghi đè); cùng sửa thành cùng giá trị => không xung đột, không gửi lại', () => {
  const base = opp({ expectedAmountVnd: '100', title: 'Cũ' });
  const latest = opp({ expectedAmountVnd: '200', title: 'Cũ', version: 4 });
  const r = rebaseEdit(base, latest, { ...initEdit(base), expectedAmount: '300', title: 'Của tôi' });
  assert.deepEqual(r.conflicts, [{ k: 'expectedAmount', mine: '300', theirs: '200' }]);
  assert.equal(r.form.expectedAmount, '300'); assert.equal(r.form.title, 'Của tôi'); // giữ nội dung đang nhập, chờ người dùng quyết
  const same = rebaseEdit(base, latest, { ...initEdit(base), expectedAmount: '200' });
  assert.deepEqual(same.conflicts, []); assert.deepEqual(toPatchBody(latest, same.form, META), {});
  assert.equal(rebaseEdit(base, latest, { ...initEdit(base), expectedAmount: '200.000' }).conflicts.length, 1); // 200.000 khác 200 => xung đột thật
  assert.deepEqual(rebaseEdit(base, latest, { ...initEdit(base), expectedAmount: ' 200 đ' }).conflicts, []); // cùng số, khác cách gõ => không xung đột
});

test('PR249-R1-01 — null / 0 sau đồng bộ: trường chưa sửa nhận đúng bản mới (null vẫn là ô trống, 0 vẫn là "0"); người dùng xoá tiền trong khi người khác đặt tiền => xung đột', () => {
  const n0 = opp({ expectedAmountVnd: null });
  const a = rebaseEdit(n0, opp({ expectedAmountVnd: '0', version: 4 }), { ...initEdit(n0), title: 'Mới' });
  assert.equal(a.form.expectedAmount, '0'); assert.deepEqual(a.conflicts, []);
  assert.deepEqual(toPatchBody(opp({ expectedAmountVnd: '0', version: 4 }), a.form, META), { title: 'Mới' });
  const h = opp({ expectedAmountVnd: '100' });
  const b = rebaseEdit(h, opp({ expectedAmountVnd: null, version: 4 }), { ...initEdit(h), title: 'Mới' });
  assert.equal(b.form.expectedAmount, ''); assert.deepEqual(toPatchBody(opp({ expectedAmountVnd: null, version: 4 }), b.form, META), { title: 'Mới' });
  const c = rebaseEdit(h, opp({ expectedAmountVnd: '200', version: 4 }), { ...initEdit(h), expectedAmount: '' });
  assert.deepEqual(c.conflicts, [{ k: 'expectedAmount', mine: '', theirs: '200' }]);
  const d = rebaseEdit(n0, opp({ expectedAmountVnd: '0', version: 4 }), { ...initEdit(n0), expectedAmount: '0' });
  assert.deepEqual(d.conflicts, []); // cả hai cùng đặt 0
  const e = rebaseEdit(n0, opp({ expectedAmountVnd: '0', version: 4 }), { ...initEdit(n0), expectedAmount: '5' });
  assert.deepEqual(e.conflicts, [{ k: 'expectedAmount', mine: '5', theirs: '0' }]); // 0 thật của người khác vẫn là một giá trị, không coi như trống
});

test('PR249-R1-01 — xác suất + lý do: người khác đã đổi xác suất về đúng số mình nhập => bỏ lý do (không gửi lý do thừa); đổi sang số khác => xung đột, giữ lý do', () => {
  const base = opp({ probability: 10 });
  const mine = { ...initEdit(base), probability: '60', probabilityReason: 'Khách duyệt' };
  const same = rebaseEdit(base, opp({ probability: 60, probabilityOverridden: true, version: 4 }), mine);
  assert.deepEqual(same.conflicts, []); assert.equal(same.form.probabilityReason, '');
  assert.deepEqual(toPatchBody(opp({ probability: 60, version: 4 }), same.form, META), {});
  const diff = rebaseEdit(base, opp({ probability: 40, version: 4 }), mine);
  assert.deepEqual(diff.conflicts, [{ k: 'probability', mine: '60', theirs: '40' }]); assert.equal(diff.form.probabilityReason, 'Khách duyệt');
  const untouched = rebaseEdit(base, opp({ probability: 40, version: 4 }), { ...initEdit(base), title: 'Mới' });
  assert.equal(untouched.form.probability, '40'); assert.deepEqual(toPatchBody(opp({ probability: 40, version: 4 }), untouched.form, META), { title: 'Mới' });
});

test('PR249-R1-01 — các trường khác: loại, gắn dự án, ngày, người liên hệ đồng bộ khi chưa sửa; xung đột khi cùng sửa', () => {
  const base = opp({ expectedCloseDate: '2026-12-20', contact: { id: 'k1', fullName: 'An' } });
  const latest = opp({ expectedCloseDate: '2027-01-15', contact: { id: 'k2', fullName: 'Bình' }, type: { id: 't-install', code: 'INSTALLATION', label: 'Thi công' }, isProjectLinked: true, projectName: 'KS', offerScope: 'Lắp', version: 4 });
  const r = rebaseEdit(base, latest, { ...initEdit(base), title: 'Mới' });
  assert.deepEqual([r.form.expectedCloseDate, r.form.contactId, r.form.typeId, r.form.isProjectLinked, r.form.projectName, r.form.offerScope], ['2027-01-15', 'k2', 't-install', true, 'KS', 'Lắp']);
  assert.deepEqual(r.conflicts, []); assert.deepEqual(toPatchBody(latest, r.form, META), { title: 'Mới' });
  const c = rebaseEdit(base, latest, { ...initEdit(base), expectedCloseDate: '2026-12-31', contactId: '' });
  assert.deepEqual(c.conflicts.map((x) => x.k), ['expectedCloseDate', 'contactId']);
});
