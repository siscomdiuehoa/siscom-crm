// Run: node --test tests/opportunitiesModel.test.mjs   (Node >= 18, không dependency). Sales S10: hàm thuần cho màn hình Cơ hội
// (tiền "Chưa rõ", ngày, truy vấn danh sách, route, thao tác theo quyền, biểu mẫu Tạo cơ hội). Không mạng, không DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moneyVN, parseAmountInput, AMOUNT_UNKNOWN, dateVN, isValidYmd, todayVN, isCloseOverdue, buildListQuery, parseOpportunitiesRoute, opportunityActions,
  canCreate, canSeeOpportunities, typeRequiresProject, projectLinked, validateCreate, toCreateBody, serverFieldErrors, statusLabel, EMPTY_CREATE, TYPE_HINT,
} from '../src/features/opportunities/opportunitiesModel.js';

const ME = 'e-me';
const scopes = (m) => (p) => m[p];
const SALES = { 'opportunity.read': 'OWN', 'opportunity.create': 'OWN', 'opportunity.update': 'OWN', 'opportunity.move_stage': 'OWN', 'opportunity.close': 'OWN', 'opportunity.assign': 'OWN' };
const ADMIN = { ...Object.fromEntries(Object.keys(SALES).map((k) => [k, 'ALL'])), 'opportunity.reopen': 'ALL', 'opportunity.delete': 'ALL', 'opportunity.restore': 'ALL' };
const opp = (over = {}) => ({ id: 'o1', code: 'CH-0007', status: 'OPEN', access: 'FULL', owner: { id: ME, code: 'NV-1', fullName: 'Tôi' }, expectedAmountVnd: null, expectedCloseDate: null, deletedAt: null, version: 1, ...over });
const META = { types: [{ id: 't-supply', code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư', requiresProject: false }, { id: 't-install', code: 'INSTALLATION', label: 'Thi công', requiresProject: true }] };

test('moneyVN: null / rỗng / sai dạng => "Chưa rõ" (không bao giờ thành 0 đ); chuỗi số => ngăn nhóm, giữ nguyên độ chính xác 15 chữ số', () => {
  for (const v of [null, undefined, '', 'abc', '-5', '1.5', '0012']) assert.equal(moneyVN(v), AMOUNT_UNKNOWN);
  assert.equal(moneyVN('0'), '0 đ');
  assert.equal(moneyVN('7200000000'), '7.200.000.000 đ');
  assert.equal(moneyVN('999999999999999'), '999.999.999.999.999 đ');
  assert.equal(moneyVN(1250000), '1.250.000 đ');
});

test('parseAmountInput: trống => null (không phải 0); nhận dấu ngăn nhóm và hậu tố đ; từ chối chữ, số âm, quá 15 chữ số', () => {
  assert.deepEqual(parseAmountInput(''), { value: null });
  assert.deepEqual(parseAmountInput('   '), { value: null });
  assert.deepEqual(parseAmountInput('7.200.000.000'), { value: '7200000000' });
  assert.deepEqual(parseAmountInput(' 1,250,000 đ '), { value: '1250000' });
  assert.deepEqual(parseAmountInput('007'), { value: '7' });
  assert.deepEqual(parseAmountInput('0'), { value: '0' });
  for (const bad of ['1 tỷ', '-5', '1e9', 'abc']) assert.ok(parseAmountInput(bad).error, bad);
  assert.ok(parseAmountInput('1234567890123456').error);
  assert.deepEqual(parseAmountInput('999999999999999'), { value: '999999999999999' });
});

test('ngày: dateVN đổi YYYY-MM-DD sang dd/mm/yyyy; isValidYmd từ chối ngày không có thật / ngoài 2000–2100; todayVN theo UTC+7', () => {
  assert.equal(dateVN('2026-12-20'), '20/12/2026');
  assert.equal(dateVN(null), '—');
  assert.equal(dateVN('20/12/2026'), '—');
  assert.equal(isValidYmd('2026-02-28'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '1999-12-31', '2101-01-01', '2026-1-1', '', null]) assert.equal(isValidYmd(bad), false, String(bad));
  assert.equal(todayVN(Date.parse('2026-11-18T16:59:59Z')), '2026-11-18');
  assert.equal(todayVN(Date.parse('2026-11-18T17:00:00Z')), '2026-11-19'); // 00:00 giờ Việt Nam
});

test('isCloseOverdue: chỉ khi ĐANG MỞ và ngày dự kiến chốt đã qua; hôm nay chưa quá hạn; tạm hoãn / đã đóng / chưa có ngày => không', () => {
  const today = '2026-11-18';
  assert.equal(isCloseOverdue(opp({ expectedCloseDate: '2026-11-17' }), today), true);
  assert.equal(isCloseOverdue(opp({ expectedCloseDate: '2026-11-18' }), today), false);
  assert.equal(isCloseOverdue(opp({ expectedCloseDate: null }), today), false);
  for (const status of ['ON_HOLD', 'WON', 'LOST']) assert.equal(isCloseOverdue(opp({ status, expectedCloseDate: '2026-01-01' }), today), false);
  assert.equal(isCloseOverdue(null, today), false);
});

test('buildListQuery: mặc định trang 1, 20 dòng, mới cập nhật trước; bộ lọc rỗng / sai không gửi; từ khoá < 2 ký tự không gửi', () => {
  assert.deepEqual(buildListQuery(), { page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
  assert.deepEqual(buildListQuery({ status: 'OPEN', stageId: ' s1 ', typeId: '', ownerId: 'e2', q: '  chiller ', closeFrom: '2026-12-01', closeTo: '2026-12-31', page: 3, sortBy: 'expectedCloseDate', sortOrder: 'asc' }),
    { status: 'OPEN', stageId: 's1', ownerId: 'e2', closeFrom: '2026-12-01', closeTo: '2026-12-31', q: 'chiller', page: 3, pageSize: 20, sortBy: 'expectedCloseDate', sortOrder: 'asc' });
  const q = buildListQuery({ status: 'XOÁ', q: 'a', closeFrom: '2026-02-30', sortBy: 'expectedAmountVnd', sortOrder: 'x', page: 0, deleted: 'all' });
  assert.deepEqual(q, { page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
  assert.equal(buildListQuery({ deleted: 'only' }).deleted, 'only');
  assert.equal(buildListQuery({ q: 'x'.repeat(150) }).q.length, 100);
});

test('parseOpportunitiesRoute: #/pipeline => danh sách; #/pipeline/view/:id => chi tiết; %-escape hỏng không làm sập', () => {
  assert.deepEqual(parseOpportunitiesRoute(['pipeline']), { page: 'pipeline' });
  assert.deepEqual(parseOpportunitiesRoute(['pipeline', 'view', 'abc-123']), { page: 'pipeline', id: 'abc-123' });
  assert.deepEqual(parseOpportunitiesRoute(['pipeline', 'view', '%E0%A4%A']), { page: 'pipeline', id: '%E0%A4%A' });
  assert.deepEqual(parseOpportunitiesRoute(['pipeline', 'view']), { page: 'pipeline' });
  assert.deepEqual(parseOpportunitiesRoute(['pipeline', 'khac']), { page: 'pipeline' });
});

test('opportunityActions — Kinh doanh (phạm vi OWN): đủ thao tác trên cơ hội MÌNH phụ trách; không thao tác nào trên cơ hội của người khác; không mở lại / xoá', () => {
  const ctx = { scopeOf: scopes(SALES), meId: ME };
  assert.deepEqual(opportunityActions(opp(), ctx), ['edit', 'stage', 'hold', 'win', 'lose', 'assign']);
  assert.deepEqual(opportunityActions(opp({ status: 'ON_HOLD' }), ctx), ['edit', 'holdEdit', 'resume', 'win', 'lose', 'assign']);
  assert.deepEqual(opportunityActions(opp({ status: 'WON' }), ctx), ['edit', 'assign']);
  assert.deepEqual(opportunityActions(opp({ owner: { id: 'e-other' } }), ctx), []);
  assert.deepEqual(opportunityActions(opp(), { scopeOf: scopes(SALES) }), []); // chưa biết mình là ai => không hiện
});

test('opportunityActions — Quản trị CRM (ALL): thao tác trên mọi cơ hội; mở lại chỉ khi đã Thắng / Thua; có xoá', () => {
  const ctx = { scopeOf: scopes(ADMIN), meId: ME };
  assert.deepEqual(opportunityActions(opp({ owner: { id: 'e-other' } }), ctx), ['edit', 'stage', 'hold', 'win', 'lose', 'assign', 'delete']);
  assert.deepEqual(opportunityActions(opp({ status: 'LOST', owner: { id: 'e-other' } }), ctx), ['edit', 'assign', 'reopen', 'delete']);
});

test('opportunityActions — fail-closed: bản kỹ thuật (TASK), cơ hội đã xoá, phạm vi DEPARTMENT, không quyền, scopeOf ném lỗi => không thao tác nào', () => {
  const admin = { scopeOf: scopes(ADMIN), meId: ME };
  assert.deepEqual(opportunityActions(opp({ access: 'TASK' }), admin), []);
  assert.deepEqual(opportunityActions(opp({ deletedAt: '2026-11-01T00:00:00Z' }), admin), []);
  assert.deepEqual(opportunityActions(opp(), { scopeOf: scopes(Object.fromEntries(Object.keys(ADMIN).map((k) => [k, 'DEPARTMENT']))), meId: ME }), []);
  assert.deepEqual(opportunityActions(opp(), { scopeOf: scopes({ 'opportunity.read': 'ALL' }), meId: ME }), []);
  assert.deepEqual(opportunityActions(opp(), { scopeOf: () => { throw new Error('x'); }, meId: ME }), []);
  assert.deepEqual(opportunityActions(null, admin), []);
  // Chỉ có update, không có close / assign / move_stage (TC 9a(iii)): chỉ hiện Sửa.
  assert.deepEqual(opportunityActions(opp(), { scopeOf: scopes({ 'opportunity.update': 'OWN' }), meId: ME }), ['edit']);
});

test('cổng mục thanh bên và nút tạo: cần mã đọc (đầy đủ hoặc theo việc) / mã tạo; không quyền => ẩn', () => {
  assert.equal(canSeeOpportunities(scopes(SALES)), true);
  assert.equal(canSeeOpportunities(scopes({ 'opportunity.read_assigned': 'OWN' })), true);
  assert.equal(canSeeOpportunities(scopes({ 'customer.read': 'ALL' })), false);
  assert.equal(canSeeOpportunities(undefined), false);
  assert.equal(canCreate(scopes(SALES)), true);
  assert.equal(canCreate(scopes({ 'opportunity.read': 'ALL' })), false);
});

test('biểu mẫu Tạo cơ hội [O4]: loại Thi công tự gắn dự án và bắt buộc tên dự án + phạm vi chào; loại Cung cấp không bắt', () => {
  assert.equal(typeRequiresProject(META, 't-install'), true);
  assert.equal(typeRequiresProject(META, 't-supply'), false);
  assert.equal(typeRequiresProject(null, 't-install'), false);
  const supply = { ...EMPTY_CREATE, customerId: 'c1', title: ' Bán 120 FCU ', typeId: 't-supply' };
  assert.deepEqual(validateCreate(supply, META), {});
  assert.deepEqual(toCreateBody(supply, META), { customerId: 'c1', title: 'Bán 120 FCU', typeId: 't-supply', isProjectLinked: false });
  const install = { ...supply, typeId: 't-install' };
  assert.equal(projectLinked(install, META), true); // tự bật dù người dùng chưa tick
  assert.deepEqual(Object.keys(validateCreate(install, META)).sort(), ['offerScope', 'projectName']);
  assert.deepEqual(Object.keys(validateCreate({ ...install, projectName: '   ', offerScope: 'x' }, META)), ['projectName']); // chỉ khoảng trắng vẫn bị chặn
  const full = { ...install, projectName: ' TTDL GĐ1 ', offerScope: ' Chiller + lắp đặt ', needSummary: ' Cần 2 chiller ', expectedAmount: '7.200.000.000', expectedCloseDate: '2026-12-20' };
  assert.deepEqual(validateCreate(full, META), {});
  assert.deepEqual(toCreateBody(full, META), { customerId: 'c1', title: 'Bán 120 FCU', typeId: 't-install', isProjectLinked: true, projectName: 'TTDL GĐ1', offerScope: 'Chiller + lắp đặt', needSummary: 'Cần 2 chiller', expectedAmountVnd: '7200000000', expectedCloseDate: '2026-12-20' });
  // Cung cấp nhưng người dùng tự gắn dự án: cũng bắt buộc hai trường; bỏ gắn => không gửi hai trường dù còn chữ trong ô.
  assert.deepEqual(Object.keys(validateCreate({ ...supply, isProjectLinked: true }, META)).sort(), ['offerScope', 'projectName']);
  assert.deepEqual(toCreateBody({ ...supply, projectName: 'còn sót', offerScope: 'còn sót' }, META), { customerId: 'c1', title: 'Bán 120 FCU', typeId: 't-supply', isProjectLinked: false });
});

test('biểu mẫu Tạo cơ hội: thiếu khách / tiêu đề / loại, tiêu đề quá dài, tiền sai, ngày sai => lỗi theo trường; giá trị trống KHÔNG gửi (không thành 0)', () => {
  assert.deepEqual(Object.keys(validateCreate(EMPTY_CREATE, META)).sort(), ['customerId', 'title', 'typeId']);
  const base = { ...EMPTY_CREATE, customerId: 'c1', title: 'x', typeId: 't-supply' };
  assert.deepEqual(Object.keys(validateCreate({ ...base, title: 'x'.repeat(201) }, META)), ['title']);
  assert.deepEqual(Object.keys(validateCreate({ ...base, expectedAmount: '1 tỷ' }, META)), ['expectedAmount']);
  assert.deepEqual(Object.keys(validateCreate({ ...base, expectedCloseDate: '2026-02-30' }, META)), ['expectedCloseDate']);
  assert.equal('expectedAmountVnd' in toCreateBody(base, META), false);
  assert.equal('needSummary' in toCreateBody(base, META), false);
  assert.match(TYPE_HINT, /PHẠM VI SISCOM CHÀO/);
  assert.match(TYPE_HINT, /FCU cho khách sạn/);
});

test('serverFieldErrors: lỗi 400 theo trường của máy chủ gắn đúng ô (expectedAmountVnd -> ô giá trị); phần không gắn được giữ ở extra', () => {
  assert.deepEqual(serverFieldErrors([{ field: 'expectedAmountVnd', message: 'Từ giai đoạn Báo giá trở đi phải có giá trị dự kiến.' }, { field: 'needSummary', message: 'Phải ghi nhu cầu' }, 'Lỗi chung']),
    { fieldErrors: { expectedAmount: 'Từ giai đoạn Báo giá trở đi phải có giá trị dự kiến.', needSummary: 'Phải ghi nhu cầu' }, extra: ['Lỗi chung'] });
  assert.deepEqual(serverFieldErrors(undefined), { fieldErrors: {}, extra: [] });
  assert.equal(statusLabel('ON_HOLD'), 'Tạm hoãn');
  assert.equal(statusLabel('LẠ'), 'LẠ');
});
