// Run: node --test tests/opportunitiesModel.test.mjs   (Node >= 18, không dependency). Sales S10: hàm thuần cho màn hình Cơ hội
// (tiền "Chưa rõ", ngày, truy vấn danh sách, route, thao tác theo quyền, biểu mẫu Tạo cơ hội). Không mạng, không DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moneyVN, parseAmountInput, AMOUNT_UNKNOWN, dateVN, isValidYmd, todayVN, isCloseOverdue, buildListQuery, parseOpportunitiesRoute, opportunityActions,
  canCreate, canSeeOpportunities, typeRequiresProject, projectLinked, validateCreate, toCreateBody, serverFieldErrors, statusLabel, EMPTY_CREATE, TYPE_HINT,
  initAction, validateAction, toActionRequest, ACTION_TITLE, ACTION_LABEL, ACTION_CANDIDATES, ACTION_FIELDS, unplacedErrors, groupAmountText, amountTyping,
  actionBaseKey, rebaseAction, customerLacksOwner, CUSTOMER_NO_OWNER_MESSAGE,
} from '../src/features/opportunities/opportunitiesModel.js';
// Báo giá Q7: model báo giá chạy cùng tệp này trong CI (danh sách tệp FE của CI không đổi).
import './quotesModel.test.mjs';

test('unplacedErrors: lỗi theo trường của máy chủ cho ô KHÔNG có trong hộp thao tác => thành câu hiển thị; ô có trong hộp thì để ô tự báo', () => {
  const NEED = 'Phải ghi nhu cầu của khách trước khi rời giai đoạn Tiếp cận.';
  assert.deepEqual(unplacedErrors('stage', { needSummary: NEED }), { messages: [NEED], editable: true });
  assert.deepEqual(unplacedErrors('stage', { stageId: 'Giai đoạn không hợp lệ' }), { messages: [], editable: false });
  assert.deepEqual(unplacedErrors('stage', { expectedAmount: 'Từ Báo giá phải có giá trị dự kiến.', stageId: 'x' }, ['Lỗi chung']), { messages: ['Từ Báo giá phải có giá trị dự kiến.', 'Lỗi chung'], editable: true });
  assert.deepEqual(unplacedErrors('win', { wonAmount: 'x', handoverToId: 'y' }), { messages: [], editable: false });
  assert.deepEqual(unplacedErrors('lose', { someServerField: 'Khác' }), { messages: ['Khác'], editable: false });
  assert.deepEqual(unplacedErrors('stage', { needSummary: NEED }, [NEED]), { messages: [NEED], editable: true }); // không lặp
  assert.deepEqual(unplacedErrors('stage', null, null), { messages: [], editable: false });
  for (const k of Object.keys(ACTION_TITLE)) if (k !== 'edit') assert.ok(Array.isArray(ACTION_FIELDS[k]), 'có danh sách ô cho ' + k);
});

// ───── Ô nhập số tiền: dấu chấm ngăn nhóm hàng nghìn khi gõ (cách ghi số trong văn bản hành chính / kế toán Việt Nam) ─────
test('groupAmountText: chèn dấu chấm ngăn nhóm hàng nghìn; chỉ khi nội dung là số nguyên, còn lại giữ nguyên để báo lỗi', () => {
  const cases = [['', ''], ['1', '1'], ['12', '12'], ['123', '123'], ['1234', '1.234'], ['123000000', '123.000.000'], ['999999999999999', '999.999.999.999.999'],
    ['1.234.5678', '12.345.678'], ['0', '0'], ['000123', '123'], ['00', '0'], [' 123 000 đ', '123.000'], ['7.200.000.000 VNĐ', '7.200.000.000'], ['1,234', '1.234'], ['.', '']];
  for (const [input, want] of cases) assert.equal(groupAmountText(input), want, JSON.stringify(input));
  // Không phải số nguyên => KHÔNG đoán, giữ nguyên chữ người dùng gõ (validate báo "Giá trị chỉ gồm chữ số").
  for (const bad of ['1 tỷ', '12abc', '-5', '1e6']) assert.equal(groupAmountText(bad), bad, bad);
  // Định dạng không đổi giá trị gửi lên máy chủ.
  for (const s of ['123000000', '7200000000', '0', '000123', '999999999999999', '1000000000000000']) assert.deepEqual(parseAmountInput(groupAmountText(s)), parseAmountInput(s), s);
  assert.equal(groupAmountText(null), ''); assert.equal(groupAmountText(undefined), '');
});

test('amountTyping: giữ đúng vị trí con trỏ theo chữ số khi chèn dấu chấm; Backspace / Delete trên dấu chấm xoá chữ số bên cạnh', () => {
  assert.deepEqual(amountTyping('123.000', '1230000', 7), { text: '1.230.000', caret: 9 }); // gõ ở cuối
  assert.deepEqual(amountTyping('1.234', '1.2534', 4), { text: '12.534', caret: 4 }); // chèn giữa: con trỏ sau chữ số vừa gõ (12.5|34)
  assert.deepEqual(amountTyping('12.534', '12.34', 3, 'deleteContentBackward'), { text: '1.234', caret: 3 }); // xoá "5" (12.5|34) => con trỏ sau "1.2" (1.2|34)
  assert.deepEqual(amountTyping('1.234', '1234', 1, 'deleteContentBackward'), { text: '234', caret: 0 }); // Backspace ngay sau dấu chấm => xoá "1"
  assert.deepEqual(amountTyping('1.234', '1234', 1, 'deleteContentForward'), { text: '134', caret: 1 }); // Delete ngay trước dấu chấm => xoá "2"
  assert.deepEqual(amountTyping('', '5', null), { text: '5', caret: 1 }); // không biết con trỏ => cuối
  assert.deepEqual(amountTyping('1 t', '1 tỷ', 4), { text: '1 tỷ', caret: 4 }); // không phải số: không đổi chữ, không dời con trỏ
  assert.deepEqual(amountTyping('', '0005', 4), { text: '5', caret: 1 }); // bỏ số 0 đứng đầu
  assert.deepEqual(amountTyping('', '123.000.000 đ', 13), { text: '123.000.000', caret: 11 }); // dán kèm "đ"
  assert.deepEqual(amountTyping('1.234', '', 0, 'deleteContentBackward'), { text: '', caret: 0 }); // xoá hết => trống ("Chưa rõ"), không phải 0
  // Gõ từng phím có dấu cách (thử trên trình duyệt thật): dấu cách KHÔNG bị nuốt, chữ giữ nguyên để báo lỗi.
  let v = ''; for (const ch of '1 tỷ') v = amountTyping(v, v + ch, v.length + 1).text;
  assert.equal(v, '1 tỷ');
  assert.deepEqual(amountTyping('1 ', '1 0', 3), { text: '10', caret: 2 }); // dấu cách rồi gõ tiếp chữ số => vẫn là số, định dạng lại
});

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
  assert.deepEqual(opportunityActions(opp({ status: 'WON' }), ctx), ['assign']); // S10c: đã đóng => không sửa trường (máy chủ từ chối)
  assert.deepEqual(opportunityActions(opp({ owner: { id: 'e-other' } }), ctx), []);
  assert.deepEqual(opportunityActions(opp(), { scopeOf: scopes(SALES) }), []); // chưa biết mình là ai => không hiện
});

test('opportunityActions — Quản trị CRM (ALL): thao tác trên mọi cơ hội; mở lại chỉ khi đã Thắng / Thua; có xoá', () => {
  const ctx = { scopeOf: scopes(ADMIN), meId: ME };
  assert.deepEqual(opportunityActions(opp({ owner: { id: 'e-other' } }), ctx), ['edit', 'stage', 'hold', 'win', 'lose', 'assign', 'delete']);
  assert.deepEqual(opportunityActions(opp({ status: 'LOST', owner: { id: 'e-other' } }), ctx), ['assign', 'reopen', 'delete']);
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

// ───── Hộp thoại thao tác ─────
const O = { id: 'o1', version: 5, stage: { id: 's1' }, probabilityOverridden: false, expectedAmountVnd: '7200000000', holdUntil: '2026-12-01', holdReason: 'Chờ ngân sách' };
const LOST_META = { lostReasons: [{ id: 'r-price', requiresNote: false }, { id: 'r-other', requiresNote: true }] };

test('thao tác: mỗi loại có tiêu đề + nhãn nút; chỉ Chuyển người và Thắng cần danh sách người nhận từ máy chủ', () => {
  const kinds = ['stage', 'hold', 'holdEdit', 'resume', 'win', 'lose', 'assign', 'reopen', 'delete'];
  for (const k of kinds) { assert.ok(ACTION_TITLE[k], k); assert.ok(ACTION_LABEL[k], k); }
  assert.deepEqual(ACTION_CANDIDATES, { assign: 'owner-candidates', win: 'handover-candidates' });
  assert.deepEqual(Object.keys(validateAction('khong-co', {}, {})), ['_']);
  assert.equal(toActionRequest('khong-co', {}, O), null);
});

test('initAction: đổi hạn hoãn lấy hạn + lý do đang có; Thắng gợi ý giá trị chốt từ giá trị dự kiến (trống thì để trống, không thành 0)', () => {
  assert.deepEqual([initAction('holdEdit', O).holdUntil, initAction('holdEdit', O).holdReason], ['2026-12-01', 'Chờ ngân sách']);
  assert.equal(initAction('hold', O).holdUntil, '');
  assert.equal(initAction('win', O).wonAmount, '7.200.000.000'); // gợi ý giá trị chốt hiển thị có dấu chấm ngăn nhóm
  assert.equal(initAction('win', { ...O, expectedAmountVnd: null }).wonAmount, '');
});

test('chuyển giai đoạn: bắt buộc chọn, không chọn lại giai đoạn hiện tại; chỉ gửi KEEP / RESET khi xác suất đang nhập tay', () => {
  assert.deepEqual(validateAction('stage', { stageId: '' }, { o: O }), { stageId: 'Chọn giai đoạn' });
  assert.deepEqual(validateAction('stage', { stageId: 's1' }, { o: O }), { stageId: 'Cơ hội đang ở giai đoạn này' });
  assert.deepEqual(validateAction('stage', { stageId: 's2' }, { o: O }), {});
  assert.deepEqual(toActionRequest('stage', { stageId: 's2', probability: 'RESET' }, O), { method: 'POST', suffix: '/stage', body: { version: 5, stageId: 's2' } });
  assert.deepEqual(toActionRequest('stage', { stageId: 's2', probability: 'RESET' }, { ...O, probabilityOverridden: true }).body, { version: 5, stageId: 's2', probability: 'RESET' });
  assert.deepEqual(toActionRequest('stage', { stageId: 's2', probability: 'lạ' }, { ...O, probabilityOverridden: true }).body.probability, 'KEEP');
});

test('T-10 rebaseAction / actionBaseKey: bản mới (version hoặc cờ nhập tay đổi) => xác suất về mặc định, các ô khác giữ nguyên', () => {
  assert.equal(actionBaseKey(O), '5:0');
  assert.equal(actionBaseKey({ ...O, probabilityOverridden: true }), '5:1');
  assert.notEqual(actionBaseKey({ ...O, version: 6 }), actionBaseKey(O));
  assert.equal(actionBaseKey(null), '');
  const form = { ...initAction('stage', O), stageId: 's2', probability: 'RESET' };
  assert.deepEqual(rebaseAction('stage', { ...O, version: 6, probabilityOverridden: true }, form), { ...form, probability: 'KEEP' });
  const hold = { ...initAction('holdEdit', O), holdUntil: '2026-12-20', holdReason: 'Khách đi công tác' };
  assert.deepEqual(rebaseAction('holdEdit', { ...O, version: 6, holdUntil: '2027-01-05' }, hold), hold); // không ghi đè ô người dùng đã nhập
});

test('T-08 customerLacksOwner: chỉ chặn khi biết chắc khách chưa có người phụ trách (ownerId === null)', () => {
  assert.equal(customerLacksOwner({ id: 'c1', ownerId: null }), true);
  assert.equal(customerLacksOwner({ id: 'c1', ownerId: 'e1' }), false);
  assert.equal(customerLacksOwner({ id: 'c1' }), false); // không có thông tin => không chặn, máy chủ quyết
  assert.equal(customerLacksOwner(null), false);
  assert.match(CUSTOMER_NO_OWNER_MESSAGE, /^Khách hàng chưa có người phụ trách — hãy phân công người phụ trách trước khi tạo cơ hội\.$/);
});

test('tạm hoãn / tiếp tục / mở lại / xoá / chuyển người: lý do bắt buộc đúng chỗ (chỉ khoảng trắng vẫn bị chặn), giới hạn 500 ký tự, thân yêu cầu đúng', () => {
  assert.deepEqual(Object.keys(validateAction('hold', { holdUntil: '2026-02-30', holdReason: '   ' })).sort(), ['holdReason', 'holdUntil']);
  assert.deepEqual(toActionRequest('holdEdit', { holdUntil: '2026-12-15', holdReason: ' Chờ ngân sách ' }, O), { method: 'POST', suffix: '/hold', body: { version: 5, holdUntil: '2026-12-15', holdReason: 'Chờ ngân sách' } });
  assert.deepEqual(validateAction('resume', { reason: '' }), {});
  assert.deepEqual(Object.keys(validateAction('resume', { reason: 'x'.repeat(501) })), ['reason']);
  assert.deepEqual(toActionRequest('resume', { reason: '  ' }, O).body, { version: 5 });
  assert.deepEqual(toActionRequest('resume', { reason: ' Khách liên hệ lại ' }, O).body, { version: 5, reason: 'Khách liên hệ lại' });
  for (const k of ['reopen', 'delete']) { assert.deepEqual(Object.keys(validateAction(k, { reason: ' ' })), ['reason']); assert.deepEqual(validateAction(k, { reason: 'Nhập nhầm' }), {}); }
  assert.deepEqual(toActionRequest('delete', { reason: 'Nhập nhầm' }, O), { method: 'DELETE', suffix: '', body: { version: 5, reason: 'Nhập nhầm' } });
  assert.deepEqual(toActionRequest('reopen', { reason: 'Ký lại' }, O), { method: 'POST', suffix: '/reopen', body: { version: 5, reason: 'Ký lại' } });
  assert.deepEqual(Object.keys(validateAction('assign', { ownerId: '', reason: '' })).sort(), ['ownerId', 'reason']);
  assert.deepEqual(toActionRequest('assign', { ownerId: 'e2', reason: ' Bàn giao ' }, O).body, { version: 5, ownerId: 'e2', reason: 'Bàn giao' });
});

test('Thua: bắt buộc lý do; lý do có cờ requiresNote bắt buộc ghi chú; ghi chú trống không gửi', () => {
  assert.deepEqual(validateAction('lose', { lostReasonId: '' }, { meta: LOST_META }), { lostReasonId: 'Chọn lý do thua' });
  assert.deepEqual(validateAction('lose', { lostReasonId: 'r-other', lostNote: '  ' }, { meta: LOST_META }), { lostNote: 'Lý do này phải kèm ghi chú' });
  assert.deepEqual(validateAction('lose', { lostReasonId: 'r-price', lostNote: '' }, { meta: LOST_META }), {});
  assert.deepEqual(toActionRequest('lose', { lostReasonId: 'r-price', lostNote: ' ' }, O).body, { version: 5, lostReasonId: 'r-price' });
});

test('Thắng: thiếu giá trị chốt / chứng từ / người nhận bị chặn; đường dẫn phải https; giá trị gửi dạng chuỗi số, 0 là số hợp lệ còn trống thì không', () => {
  const ok = { wonAmount: '7.000.000.000', wonDocType: 'HOP_DONG', wonDocNo: ' HD-118 ', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/hd', wonDocFileName: '', handoverToId: 'e7', handoverDueDate: '' };
  assert.deepEqual(validateAction('win', ok), {});
  assert.deepEqual(Object.keys(validateAction('win', { ...ok, wonAmount: '', wonDocType: 'KHAC', wonDocNo: '', wonDocDate: '', wonDocUrl: '', handoverToId: '' })).sort(), ['handoverToId', 'wonAmount', 'wonDocDate', 'wonDocNo', 'wonDocType', 'wonDocUrl']);
  for (const url of ['http://drive.example.com/x', 'javascript:alert(1)', 'drive.example.com/x', 'https://a b']) assert.deepEqual(Object.keys(validateAction('win', { ...ok, wonDocUrl: url })), ['wonDocUrl'], url);
  assert.deepEqual(validateAction('win', { ...ok, wonAmount: '0' }), {});
  assert.deepEqual(Object.keys(validateAction('win', { ...ok, handoverDueDate: '2026-02-30' })), ['handoverDueDate']);
  assert.deepEqual(toActionRequest('win', ok, O), { method: 'POST', suffix: '/win', body: { version: 5, wonAmountVnd: '7000000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-118', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/hd', handoverToId: 'e7' } });
  assert.deepEqual(toActionRequest('win', { ...ok, wonDocFileName: ' hd.pdf ', handoverDueDate: '2026-11-20' }, O).body.wonDocFileName, 'hd.pdf');
});
