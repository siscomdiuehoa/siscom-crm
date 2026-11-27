// Run: node --test tests/quotesListPrintModel.test.mjs   (cũng chạy trong CI qua import ở tests/quotesModel.test.mjs — không đổi danh sách tệp của CI).
// Báo giá Q8a — model thuần của trang danh sách (#/quotes) và bản in (#/quotes/:id/print/:no): docs/QUOTES_DESIGN.md mục 4.2, 4.4, 9, 10.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import './quotesSetupModel.test.mjs'; // Q8b: chạy kèm trong CI (không đổi danh sách tệp của CI)
import {
  LIST_STATE_FILTERS, buildQuoteListQuery, validityLabel, quotesNav, parseQuotesRoute, printLayout,
} from '../src/features/quotes/quotesModel.js';

describe('Báo giá Q8a — model danh sách và bản in', () => {
  it('bộ lọc trạng thái đúng các giá trị máy chủ nhận (gồm "sắp hết hạn" và "hết hiệu lực")', () => {
    assert.deepEqual(LIST_STATE_FILTERS.map((x) => x.value), ['', 'DRAFT', 'SENT', 'EXPIRING', 'EXPIRED', 'ACCEPTED', 'REJECTED']);
    for (const x of LIST_STATE_FILTERS) assert.ok(x.label, 'có nhãn ' + x.value);
  });
  it('dựng truy vấn danh sách: bỏ ô trống, cắt khoảng trắng từ khoá, từ khoá dưới 2 ký tự không gửi; không bao giờ có tham số lạ', () => {
    assert.deepEqual(buildQuoteListQuery({}), { page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
    assert.deepEqual(buildQuoteListQuery({ state: 'EXPIRING', templateId: 't1', q: '  ong gio ', page: 3, sort: 'code:asc' }),
      { state: 'EXPIRING', templateId: 't1', q: 'ong gio', page: 3, pageSize: 20, sortBy: 'code', sortOrder: 'asc' });
    assert.equal('q' in buildQuoteListQuery({ q: ' a ' }), false);
    assert.equal('state' in buildQuoteListQuery({ state: 'LA' }), false, 'trạng thái lạ không gửi');
    assert.deepEqual(buildQuoteListQuery({ sort: 'costPriceVnd:desc' }), { page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' }, 'không sắp xếp theo giá vốn');
  });
  it('nhãn hạn hiệu lực: "Còn n ngày" / "Hết hạn hôm nay" / "Hết hiệu lực"; nháp và đã có kết quả thì không có nhãn', () => {
    assert.deepEqual(validityLabel({ state: 'SENT', daysLeft: 10 }), { text: 'Còn 10 ngày', tone: 'neutral' });
    assert.deepEqual(validityLabel({ state: 'SENT', daysLeft: 7 }), { text: 'Còn 7 ngày', tone: 'warning' });
    assert.deepEqual(validityLabel({ state: 'SENT', daysLeft: 0 }), { text: 'Hết hạn hôm nay', tone: 'warning' });
    assert.deepEqual(validityLabel({ state: 'EXPIRED', daysLeft: -3 }), { text: 'Hết hiệu lực', tone: 'error' });
    for (const s of ['DRAFT', 'ACCEPTED', 'REJECTED']) assert.equal(validityLabel({ state: s, daysLeft: null }), null);
    assert.equal(validityLabel(null), null);
    assert.equal(validityLabel({ state: 'SENT', daysLeft: null }), null);
  });
  it('thanh bên: chế độ API mà không có quote.read => không có mục "Báo giá"; có quyền hoặc chế độ minh hoạ => giữ nguyên', () => {
    const nav = [{ id: 'customers' }, { id: 'quotes' }, { id: 'hr' }];
    assert.deepEqual(quotesNav(nav, true, false).map((n) => n.id), ['customers', 'hr']);
    assert.equal(quotesNav(nav, true, true), nav);
    assert.equal(quotesNav(nav, false, false), nav);
  });
  it('đọc địa chỉ: #/quotes, #/quotes/:id, #/quotes/:id/print, #/quotes/:id/print/:no (số phiên bản sai => bản mới nhất)', () => {
    assert.deepEqual(parseQuotesRoute(['quotes']), { page: 'quotes' });
    assert.deepEqual(parseQuotesRoute(['quotes', '']), { page: 'quotes' });
    assert.deepEqual(parseQuotesRoute(['quotes', 'abc']), { page: 'quotes', id: 'abc' });
    assert.deepEqual(parseQuotesRoute(['quotes', 'abc', 'print']), { page: 'quotes', id: 'abc', print: 'latest' });
    assert.deepEqual(parseQuotesRoute(['quotes', 'abc', 'print', '2']), { page: 'quotes', id: 'abc', print: '2' });
    for (const bad of ['0', '-1', '1.5', 'x', '1e3', '1234567']) assert.deepEqual(parseQuotesRoute(['quotes', 'abc', 'print', bad]), { page: 'quotes', id: 'abc', print: 'latest' }, bad);
    assert.deepEqual(parseQuotesRoute(['quotes', 'a%2Fb']), { page: 'quotes', id: 'a/b' });
    assert.deepEqual(parseQuotesRoute(['quotes', '%E0%A4%A']), { page: 'quotes', id: '%E0%A4%A' }, 'mã hoá hỏng: giữ nguyên, không sập');
  });

  const V = (extra = {}) => ({ versionNo: 1, status: 'SENT', vatMode: 'QUOTE', columns: [], base8Vnd: '0', base10Vnd: '1000', vat8Vnd: '0', vat10Vnd: '100', subtotalVnd: '1000', totalVnd: '1100', lines: [], ...extra });
  const item = (no, vat = 10) => ({ lineNo: no, kind: 'ITEM', description: 'D' + no, unit: 'm', quantity: '1', unitPriceVnd: '1000', vatPercent: vat, amountVnd: '1000', extra: {} });
  it('bố cục bản in: A4 dọc khi tối đa 3 cột riêng, A4 ngang khi nhiều hơn', () => {
    const cols = (n) => Array.from({ length: n }, (_, i) => ({ key: 'k' + i, label: 'Cột ' + i }));
    assert.equal(printLayout(V()).landscape, false);
    assert.equal(printLayout(V({ columns: cols(3) })).landscape, false);
    assert.equal(printLayout(V({ columns: cols(4) })).landscape, true);
    assert.equal(printLayout(V({ columns: cols(10) })).landscape, true);
    assert.equal(printLayout(V({ columns: null })).columns.length, 0);
  });
  it('E10: có cả hai mức VAT (loại theo từng dòng) => cột "VAT %" và hai dòng VAT; một mức => không có cột, một dòng VAT', () => {
    const two = printLayout(V({ vatMode: 'LINE', base8Vnd: '500', base10Vnd: '500', vat8Vnd: '40', vat10Vnd: '50' }));
    assert.equal(two.vatColumn, true);
    assert.deepEqual(two.vatRows, [{ percent: 8, value: '40' }, { percent: 10, value: '50' }]);
    const one = printLayout(V({ vatMode: 'LINE', base8Vnd: '1000', base10Vnd: '0', vat8Vnd: '80', vat10Vnd: '0' }));
    assert.equal(one.vatColumn, false);
    assert.deepEqual(one.vatRows, [{ percent: 8, value: '80' }]);
    const quote = printLayout(V());
    assert.equal(quote.vatColumn, false);
    assert.deepEqual(quote.vatRows, [{ percent: 10, value: '100' }]);
    assert.deepEqual(printLayout(V({ base10Vnd: '0', vat10Vnd: '0', subtotalVnd: '0', totalVnd: '0' })).vatRows, [], 'chưa có dòng hàng => không có dòng VAT');
  });
  it('E6: nháp có chữ chìm; bản đã gửi / có kết quả không có. Số thứ tự chỉ đếm dòng hàng (dòng nhóm không có số)', () => {
    assert.equal(printLayout(V({ status: 'DRAFT' })).draft, true);
    for (const s of ['SENT', 'ACCEPTED', 'REJECTED']) assert.equal(printLayout(V({ status: s })).draft, false);
    const l = printLayout(V({ lines: [{ lineNo: 1, kind: 'SECTION', description: 'NHÓM A' }, item(2), item(3), { lineNo: 4, kind: 'SECTION', description: 'NHÓM B' }, item(5)] }));
    assert.deepEqual(l.rows.map((r) => r.no), [null, 1, 2, null, 3]);
    assert.equal(l.rows[1].line.description, 'D2');
  });
  it('mã in: kèm "(v n)" từ phiên bản 2 trở đi', () => {
    assert.equal(printLayout(V({ codeSnapshot: 'BG-0012' })).codeLabel, 'BG-0012');
    assert.equal(printLayout(V({ codeSnapshot: 'BG-0012', versionNo: 2 })).codeLabel, 'BG-0012 (v2)');
    assert.equal(printLayout(V({ codeSnapshot: null, versionNo: 3 }), 'BG-0009').codeLabel, 'BG-0009 (v3)');
  });
  it('mục 4.3: bố cục in đã có mã thì không sửa — chốt mã băm của tệp bố cục siscom-v1 (đổi mẫu / logo = thêm bố cục mới với mã mới)', () => {
    const src = readFileSync(new URL('../src/features/quotes/print/siscom-v1.jsx', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('');
    assert.equal(createHash('sha256').update(src).digest('hex'), 'bf9a362a2a8c18a53874031e63411f0cd12a0459af5e57dc4dc4079adfdd8a25');
  });
  it('kiểm tĩnh: màn hình Q8a không dùng Number( / parseFloat( / parseInt(, không ghi bộ nhớ trình duyệt, không chèn HTML thô', () => {
    for (const f of ['QuotesPage.jsx', 'QuotePrint.jsx']) {
      const src = readFileSync(new URL('../src/features/quotes/' + f, import.meta.url), 'utf8');
      assert.ok(!/\b(Number|parseFloat|parseInt)\(/.test(src), f + ' dùng số thực');
      assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), f + ' ghi bộ nhớ trình duyệt');
      assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(src), f + ' chèn HTML thô');
    }
  });
});
