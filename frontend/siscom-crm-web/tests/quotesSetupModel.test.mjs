// Run: node --test tests/quotesSetupModel.test.mjs   (cũng chạy trong CI qua import ở tests/quotesListPrintModel.test.mjs — không đổi danh sách tệp của CI).
// Báo giá Q8b — model thuần của màn hình "Loại báo giá" (#/quotes/templates) và "Mặc định của tôi" (#/quotes/my-defaults): docs/QUOTES_DESIGN.md mục 4.1, 9, 10, 23.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_TEMPLATE_COLUMNS, parseQuotesRoute, quotesSubnav, templateForm, columnKey, moveItem, validateTemplateForm, toTemplateBody, previewHeaders,
  myDefaultsForm, validateMyDefaults, toMyDefaultsBody,
} from '../src/features/quotes/quotesModel.js';

const T = { id: 't1', code: 'ong-gio', name: 'Ống gió vải', title: 'BẢNG BÁO GIÁ ỐNG GIÓ VẢI', intro: 'Kính gửi', defaultTerms: 'Giá chưa gồm vận chuyển', defaultValidDays: 15, defaultVat: 10, vatMode: 'QUOTE', columns: [{ key: 'duong_kinh', label: 'Đường kính', unit: 'mm' }, { key: 'chieu_dai', label: 'Chiều dài', unit: 'm' }], isActive: true, sortOrder: 0, version: 3 };

describe('Báo giá Q8b — model loại báo giá và mặc định của tôi', () => {
  it('đọc địa chỉ: #/quotes/templates và #/quotes/my-defaults là trang con, không phải mã báo giá; địa chỉ Q8a giữ nguyên', () => {
    assert.deepEqual(parseQuotesRoute(['quotes', 'templates']), { page: 'quotes', sub: 'templates' });
    assert.deepEqual(parseQuotesRoute(['quotes', 'my-defaults']), { page: 'quotes', sub: 'my-defaults' });
    assert.deepEqual(parseQuotesRoute(['quotes', 'templates', 'print']), { page: 'quotes', sub: 'templates' });
    assert.deepEqual(parseQuotesRoute(['quotes']), { page: 'quotes' });
    assert.deepEqual(parseQuotesRoute(['quotes', 'abc', 'print', '2']), { page: 'quotes', id: 'abc', print: '2' });
  });
  it('thanh trang con: "Loại báo giá" chỉ khi có quote.template; "Mặc định của tôi" chỉ khi có quote.create; chỉ còn "Danh sách" => không hiện thanh', () => {
    const can = (...ok) => (p) => ok.includes(p);
    assert.deepEqual(quotesSubnav(can('quote.template', 'quote.create')).map((x) => [x.id, x.path]), [['list', '/quotes'], ['templates', '/quotes/templates'], ['my-defaults', '/quotes/my-defaults']]);
    assert.deepEqual(quotesSubnav(can('quote.create')).map((x) => x.id), ['list', 'my-defaults']);
    assert.deepEqual(quotesSubnav(can()), []);
    for (const x of quotesSubnav(can('quote.template', 'quote.create'))) assert.ok(x.label);
  });
  it('biểu mẫu loại: từ loại có sẵn chép đúng giá trị (số ngày thành chữ); loại mới có mặc định 15 ngày, VAT 10 %, một mức cho cả báo giá, đang dùng', () => {
    const f = templateForm(T);
    assert.deepEqual(f, { code: 'ong-gio', name: 'Ống gió vải', title: 'BẢNG BÁO GIÁ ỐNG GIÓ VẢI', intro: 'Kính gửi', defaultTerms: 'Giá chưa gồm vận chuyển', defaultValidDays: '15', defaultVat: 10, vatMode: 'QUOTE', columns: T.columns, isActive: true });
    assert.notEqual(f.columns, T.columns, 'chép mảng cột, không dùng chung');
    assert.deepEqual(templateForm(null), { code: '', name: '', title: '', intro: '', defaultTerms: '', defaultValidDays: '15', defaultVat: 10, vatMode: 'QUOTE', columns: [], isActive: true });
    assert.deepEqual(templateForm({ ...T, columns: null }).columns, []);
  });
  it('key của cột tự sinh từ tên: bỏ dấu, chữ thường, gạch dưới, bắt đầu bằng chữ, tối đa 20 ký tự, không trùng key đã có', () => {
    const KEY = /^[a-z][a-z0-9_]{0,19}$/;
    assert.equal(columnKey('Đường kính', []), 'duong_kinh');
    assert.equal(columnKey('Lưu lượng (m³/h)', []), 'luu_luong_m_h');
    assert.equal(columnKey('Nhà sản xuất / Xuất xứ', []), 'nha_san_xuat_xuat_xu');
    assert.equal(columnKey('2 lớp', []), 'c_2_lop');
    assert.equal(columnKey('###', []), 'cot');
    assert.equal(columnKey('Model', ['model']), 'model_2');
    assert.equal(columnKey('Model', ['model', 'model_2']), 'model_3');
    const long = columnKey('Nhà sản xuất / Xuất xứ', ['nha_san_xuat_xuat_xu']);
    assert.ok(KEY.test(long) && long !== 'nha_san_xuat_xuat_xu', long);
    for (const s of ['Đường kính', '2 lớp', '###', 'Áp lực (Pa)', 'ĐK cánh (mm)', '   ', 'x'.repeat(60)]) assert.ok(KEY.test(columnKey(s, [])), s);
  });
  it('đổi thứ tự: lên / xuống một bậc, ra ngoài biên thì giữ nguyên; không sửa mảng gốc', () => {
    const a = ['x', 'y', 'z'];
    assert.deepEqual(moveItem(a, 0, 1), ['y', 'x', 'z']);
    assert.deepEqual(moveItem(a, 2, -1), ['x', 'z', 'y']);
    assert.equal(moveItem(a, 0, -1), a);
    assert.equal(moveItem(a, 2, 1), a);
    assert.deepEqual(a, ['x', 'y', 'z']);
  });
  it('kiểm biểu mẫu loại: đúng giới hạn của máy chủ (tên 120, tiêu đề 200, câu chào 300, điều khoản 4000, ngày 1–365, VAT 8 / 10, tối đa 10 cột, tên cột 1–40, đơn vị 20)', () => {
    const ok = templateForm(T);
    assert.deepEqual(validateTemplateForm(ok, false), {});
    assert.deepEqual(Object.keys(validateTemplateForm(templateForm(null), true)).sort(), ['code', 'name', 'title']);
    assert.ok(validateTemplateForm({ ...ok, code: 'Ống Gió' }, true).code, 'mã có dấu / chữ hoa');
    assert.equal(validateTemplateForm({ ...ok, code: 'Ống Gió' }, false).code, undefined, 'sửa: không kiểm mã (mã không đổi được)');
    assert.deepEqual(validateTemplateForm({ ...ok, code: 'gas-lanh-2' }, true), {});
    assert.ok(validateTemplateForm({ ...ok, name: 'x'.repeat(121) }).name);
    assert.ok(validateTemplateForm({ ...ok, title: '  ' }).title);
    assert.ok(validateTemplateForm({ ...ok, title: 'x'.repeat(201) }).title);
    assert.ok(validateTemplateForm({ ...ok, intro: 'x'.repeat(301) }).intro);
    assert.ok(validateTemplateForm({ ...ok, defaultTerms: 'x'.repeat(4001) }).defaultTerms);
    for (const bad of ['', '0', '366', '1.5', '-3', 'abc', '015', '1e2']) assert.ok(validateTemplateForm({ ...ok, defaultValidDays: bad }).defaultValidDays, 'ngày ' + bad);
    for (const good of ['1', '30', '365']) assert.equal(validateTemplateForm({ ...ok, defaultValidDays: good }).defaultValidDays, undefined);
    assert.ok(validateTemplateForm({ ...ok, defaultVat: 5 }).defaultVat);
    assert.ok(validateTemplateForm({ ...ok, vatMode: 'X' }).vatMode);
    const col = (label, unit = '') => ({ key: '', label, unit });
    assert.ok(validateTemplateForm({ ...ok, columns: Array.from({ length: MAX_TEMPLATE_COLUMNS + 1 }, (_, i) => col('Cột ' + i)) }).columns);
    assert.deepEqual(validateTemplateForm({ ...ok, columns: Array.from({ length: MAX_TEMPLATE_COLUMNS }, (_, i) => col('Cột ' + i)) }), {});
    const e = validateTemplateForm({ ...ok, columns: [col('Model'), col('  '), col('x'.repeat(41)), col('Áp lực', 'x'.repeat(21)), col('model')] });
    assert.deepEqual(Object.keys(e).sort(), ['columns[1].label', 'columns[2].label', 'columns[3].unit', 'columns[4].label']);
    assert.match(e['columns[4].label'], /trùng/i);
  });
  it('thân yêu cầu loại: thêm => có code, không có version; sửa => có version, KHÔNG có code; số ngày là số nguyên; cột mới được gán key, cột cũ giữ key', () => {
    const f = { ...templateForm(T), name: '  Ống gió vải mới ', defaultValidDays: '30', columns: [T.columns[1], { key: '', label: ' Chiều dài ', unit: '' }, { key: '', label: 'Màu', unit: ' ' }] };
    const upd = toTemplateBody(f, 3);
    assert.deepEqual(upd, {
      version: 3, name: 'Ống gió vải mới', title: 'BẢNG BÁO GIÁ ỐNG GIÓ VẢI', intro: 'Kính gửi', defaultTerms: 'Giá chưa gồm vận chuyển', defaultValidDays: 30, defaultVat: 10, vatMode: 'QUOTE', isActive: true,
      columns: [{ key: 'chieu_dai', label: 'Chiều dài', unit: 'm' }, { key: 'chieu_dai_2', label: 'Chiều dài', unit: '' }, { key: 'mau', label: 'Màu', unit: '' }],
    });
    assert.equal(typeof upd.defaultValidDays, 'number');
    const add = toTemplateBody({ ...templateForm(null), code: ' gas ', name: 'Gas lạnh', title: 'BẢNG BÁO GIÁ GAS' }, null);
    assert.deepEqual(add, { code: 'gas', name: 'Gas lạnh', title: 'BẢNG BÁO GIÁ GAS', intro: '', defaultTerms: '', defaultValidDays: 15, defaultVat: 10, vatMode: 'QUOTE', isActive: true, columns: [] });
    assert.equal('sortOrder' in upd || 'sortOrder' in add || 'id' in upd, false, 'không gửi thứ tự sắp xếp / id');
  });
  it('xem trước bố cục bảng hàng: cột chung + cột riêng (kèm đơn vị) đúng vị trí; cột "VAT %" chỉ khi tính VAT theo từng dòng', () => {
    assert.deepEqual(previewHeaders(templateForm(T)), ['TT', 'Nội dung công việc', 'Đường kính (mm)', 'Chiều dài (m)', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền', 'Ghi chú']);
    assert.deepEqual(previewHeaders({ ...templateForm(null), vatMode: 'LINE', columns: [{ key: '', label: ' Model ', unit: '' }, { key: '', label: '', unit: 'mm' }] }), ['TT', 'Nội dung công việc', 'Model', '(chưa đặt tên)', 'ĐVT', 'SL', 'Đơn giá', 'VAT %', 'Thành tiền', 'Ghi chú']);
  });
  it('mặc định của tôi: biểu mẫu từ máy chủ (null => rỗng); kiểm giới hạn 120 / 30 / 254 / 2000 và dạng email; ô trống không gửi, thông tin tài khoản luôn gửi', () => {
    assert.deepEqual(myDefaultsForm({ saved: false, quoterTitle: null, quoterPhone: null, quoterEmail: null, paymentInfo: '', updatedAt: null }), { quoterTitle: '', quoterPhone: '', quoterEmail: '', paymentInfo: '' });
    assert.deepEqual(myDefaultsForm(null), { quoterTitle: '', quoterPhone: '', quoterEmail: '', paymentInfo: '' });
    const f = { quoterTitle: ' Kỹ sư bán hàng ', quoterPhone: '0900 000 002', quoterEmail: ' soan@example.test ', paymentInfo: 'STK 000111\nNgân hàng Z' };
    assert.deepEqual(validateMyDefaults(f), {});
    assert.deepEqual(validateMyDefaults(myDefaultsForm(null)), {}, 'để trống hết vẫn hợp lệ');
    assert.deepEqual(toMyDefaultsBody(f), { quoterTitle: 'Kỹ sư bán hàng', quoterPhone: '0900 000 002', quoterEmail: 'soan@example.test', paymentInfo: 'STK 000111\nNgân hàng Z' });
    assert.deepEqual(toMyDefaultsBody({ quoterTitle: '  ', quoterPhone: '', quoterEmail: '', paymentInfo: '' }), { paymentInfo: '' });
    assert.equal('employeeId' in toMyDefaultsBody(f), false);
    assert.ok(validateMyDefaults({ ...f, quoterTitle: 'x'.repeat(121) }).quoterTitle);
    assert.ok(validateMyDefaults({ ...f, quoterPhone: '0'.repeat(31) }).quoterPhone);
    for (const bad of ['abc', 'a@b', 'a b@c.d', '@c.d']) assert.ok(validateMyDefaults({ ...f, quoterEmail: bad }).quoterEmail, bad);
    assert.ok(validateMyDefaults({ ...f, quoterEmail: 'a@' + 'b'.repeat(250) + '.vn' }).quoterEmail);
    assert.ok(validateMyDefaults({ ...f, paymentInfo: 'x'.repeat(2001) }).paymentInfo);
  });
  it('kiểm tĩnh: màn hình Q8b không dùng Number( / parseFloat( / parseInt(, không ghi bộ nhớ trình duyệt, không chèn HTML thô', () => {
    const src = readFileSync(new URL('../src/features/quotes/QuoteSetup.jsx', import.meta.url), 'utf8');
    assert.ok(!/\b(Number|parseFloat|parseInt)\(/.test(src), 'dùng số thực');
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), 'ghi bộ nhớ trình duyệt');
    assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(src), 'chèn HTML thô');
  });
});
