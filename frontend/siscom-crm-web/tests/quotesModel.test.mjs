// Run: node --test tests/quotesModel.test.mjs   (cũng chạy trong CI qua import ở tests/opportunitiesModel.test.mjs — không đổi danh sách tệp của CI).
// Báo giá Q7 — model thuần của giao diện (docs/QUOTES_DESIGN.md mục 6, 10): đọc ô nhập kiểu Việt Nam, định dạng tiền, tạm tính bằng BigInt
// (giống công thức máy chủ — chỉ để hiển thị; số chính thức luôn là của máy chủ), kiểm dòng tại chỗ, dựng thân yêu cầu lưu nháp.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normQty, normVnd, fmtVnd, fmtQty, previewTotals, validateDraft, toSaveBody, fromVersion, emptyLine, STATE_META, moveLine,
} from '../src/features/quotes/quotesModel.js';

describe('Báo giá Q7 — model giao diện', () => {
  it('đọc số lượng kiểu Việt Nam: dấu phẩy thập phân, dấu chấm hàng nghìn; trả chuỗi theo mẫu API', () => {
    assert.equal(normQty('2,5'), '2.5');
    assert.equal(normQty('1.005'), '1.005');      // không có dấu phẩy => dấu chấm là thập phân
    assert.equal(normQty('1.000,5'), '1000.5');
    assert.equal(normQty(' 5 '), '5');
    assert.equal(normQty(''), '');
  });
  it('Q7-R1-01: số lượng sai nhóm nghìn KHÔNG bị âm thầm đổi thành số khác — giữ nguyên để kiểm dữ liệu báo lỗi', () => {
    assert.equal(normQty('1.2,5'), '1.2,5');
    assert.equal(normQty('1.2.3,5'), '1.2.3,5');
    assert.equal(normQty('12.34,5'), '12.34,5');
    assert.equal(normQty('1,2,5'), '1,2,5');
    assert.equal(normQty('.234,5'), '.234,5');
    // định dạng đúng vẫn đọc như cũ
    assert.equal(normQty('1.234,5'), '1234.5');
    assert.equal(normQty('2,5'), '2.5');
    assert.equal(normQty('1.005'), '1.005');
    assert.equal(normQty('12.345.678,125'), '12345678.125');
    // dòng hàng mang số lượng sai => báo lỗi ở ô số lượng, không tính thành tiền
    for (const bad of ['1.2,5', '1.2.3,5']) {
      const d = { vatMode: 'QUOTE', vatPercent: 10, quoteDate: '2026-11-25', validUntil: '2026-12-10',
        lines: [{ ...emptyLine(), description: 'Ống gió', unit: 'm', quantity: bad, unitPriceVnd: '100000' }] };
      assert.equal(validateDraft(d)['lines[0].quantity'] !== undefined, true, bad);
      const t = previewTotals(d.lines, 'QUOTE', 10);
      assert.equal(t.ok, false, bad);
    }
  });
  it('đọc tiền: bỏ dấu chấm / phẩy / khoảng trắng phân cách nghìn; giữ nguyên chữ số', () => {
    assert.equal(normVnd('1.636.000'), '1636000');
    assert.equal(normVnd('1 636 000'), '1636000');
    assert.equal(normVnd('999999999999'), '999999999999');
    assert.equal(normVnd(''), '');
  });
  it('định dạng tiền từ chuỗi (không qua Number): nhóm nghìn bằng dấu chấm, giữ đúng từng chữ số vượt 2^53, số âm', () => {
    assert.equal(fmtVnd('18926364'), '18.926.364');
    assert.equal(fmtVnd('9899999999990100'), '9.899.999.999.990.100');
    assert.equal(fmtVnd('-83333'), '-83.333');
    assert.equal(fmtVnd('0'), '0');
    assert.equal(fmtVnd(null), '—');
    assert.equal(fmtQty('2.5'), '2,5');
    assert.equal(fmtQty('8000'), '8.000');
    assert.equal(fmtQty('999999.999'), '999.999,999');
  });
  it('tạm tính khớp bảng 6.1 (A1, A2, A5, A9) — chỉ để hiển thị', () => {
    const it = (q, p, vat) => ({ kind: 'ITEM', quantity: q, unitPriceVnd: p, vatPercent: vat });
    assert.deepEqual(previewTotals([it('5', '1636000'), it('5', '1722000'), it('1', '636364'), it('1', '1500000')], 'QUOTE', 10),
      { ok: true, base8: '0', base10: '18926364', vat8: '0', vat10: '1892636', subtotal: '18926364', total: '20819000', amounts: ['8180000', '8610000', '636364', '1500000'] });
    const a2 = previewTotals([it('2.5', '333333', 8), it('1.005', '999', 10), it('237', '17000', 10)], 'LINE');
    assert.deepEqual([a2.base8, a2.base10, a2.vat8, a2.vat10, a2.total], ['833333', '4030004', '66667', '403000', '5333004']);
    assert.equal(previewTotals([it('1', '5'), it('1', '5'), it('1', '5')], 'QUOTE', 10).vat10, '2');
    const a9 = previewTotals([{ kind: 'SECTION', description: 'NHÓM' }, it('1', '100')], 'QUOTE', 10);
    assert.deepEqual([a9.amounts, a9.total], [[null, '100'], '110']);
  });
  it('tạm tính: dòng còn sai => thành tiền null, tổng không tính dòng đó, ok=false', () => {
    const r = previewTotals([{ kind: 'ITEM', quantity: '1,5a', unitPriceVnd: '100' }, { kind: 'ITEM', quantity: '1', unitPriceVnd: '100' }], 'QUOTE', 10);
    assert.deepEqual([r.ok, r.amounts, r.subtotal], [false, [null, '100'], '100']);
  });
  it('kiểm tại chỗ: lỗi theo đúng khoá của máy chủ (lines[i].field), không lặp lại giá trị', () => {
    const errs = validateDraft({ vatMode: 'QUOTE', vatPercent: 10, lines: [
      { kind: 'ITEM', description: 'A', quantity: '1.0005', unitPriceVnd: '1' },
      { kind: 'ITEM', description: '', quantity: '1', unitPriceVnd: '1.5' },
      { kind: 'ITEM', description: 'C', quantity: '1', unitPriceVnd: '1', costPriceVnd: '7777777777777' },
      { kind: 'SECTION', description: 'NHÓM' },
    ] });
    assert.deepEqual(Object.keys(errs).sort(), ['lines[0].quantity', 'lines[1].description', 'lines[1].unitPriceVnd', 'lines[2].costPriceVnd'].sort());
    assert.ok(!JSON.stringify(errs).includes('7777777777777'));
    assert.deepEqual(validateDraft({ vatMode: 'QUOTE', vatPercent: null, lines: [{ kind: 'ITEM', description: 'A', quantity: '1', unitPriceVnd: '1' }] }), { vatPercent: 'Chọn mức VAT cho cả báo giá.' });
    assert.deepEqual(Object.keys(validateDraft({ vatMode: 'LINE', lines: [{ kind: 'ITEM', description: 'A', quantity: '1', unitPriceVnd: '1' }] })), ['lines[0].vatPercent']);
    assert.deepEqual(Object.keys(validateDraft({ vatMode: 'QUOTE', vatPercent: 10, lines: Array.from({ length: 301 }, () => ({ kind: 'SECTION', description: 'x' })) })), ['lines']);
  });
  it('dựng thân yêu cầu: chuỗi đã chuẩn hoá; VAT chung chỉ ở loại một mức; dòng nhóm không mang số; giá vốn chỉ khi được xem; không có trường tổng', () => {
    const form = {
      vatMode: 'QUOTE', vatPercent: 8, costVisible: false, quoteDate: '2026-11-25', validUntil: '', clientCompany: ' Công ty A ', note: '',
      lines: [{ kind: 'SECTION', description: 'NHÓM', quantity: '9', unitPriceVnd: '9' }, { kind: 'ITEM', description: 'Quạt', unit: 'cái', quantity: '2,5', unitPriceVnd: '1.000', costPriceVnd: '800', extra: { model: 'X1', bo: '' }, vatPercent: 10 }],
    };
    const b = toSaveBody(form, 7);
    assert.equal(b.version, 7);
    assert.equal(b.vatPercent, 8);
    assert.deepEqual(b.lines, [{ kind: 'SECTION', description: 'NHÓM' }, { kind: 'ITEM', description: 'Quạt', unit: 'cái', quantity: '2.5', unitPriceVnd: '1000', extra: { model: 'X1' } }]);
    assert.equal(b.validUntil, null);
    assert.equal(b.clientCompany, 'Công ty A');
    assert.ok(!('subtotalVnd' in b) && !('totalVnd' in b));
    const withCost = toSaveBody({ ...form, vatMode: 'LINE', costVisible: true }, 7);
    assert.equal(withCost.vatPercent, undefined);
    assert.deepEqual(withCost.lines[1], { kind: 'ITEM', description: 'Quạt', unit: 'cái', quantity: '2.5', unitPriceVnd: '1000', vatPercent: 10, costPriceVnd: '800', extra: { model: 'X1' } });
    const noCost = toSaveBody({ ...form, costVisible: true, lines: [{ kind: 'ITEM', description: 'A', quantity: '1', unitPriceVnd: '1', costPriceVnd: '' }] }, 1);
    assert.equal(noCost.lines[0].costPriceVnd, null);
  });
  it('fromVersion: dựng biểu mẫu từ phiên bản của API; mức VAT chung lấy từ dòng hàng đầu (loại một mức)', () => {
    const v = { vatMode: 'QUOTE', costVisible: true, quoteDate: '2026-11-20', validUntil: null, client: { name: 'A', contact: null, company: 'C', phone: null, email: null, address: null }, projectName: null,
      quoter: { name: 'N', title: null, phone: null, email: null }, intro: 'i', terms: 't', paymentInfo: 'p', note: null, columns: [{ key: 'dk', label: 'ĐK', unit: 'mm' }],
      lines: [{ lineNo: 1, kind: 'SECTION', description: 'S', unit: '', note: null, extra: {}, quantity: null, unitPriceVnd: null, vatPercent: null, amountVnd: null, costPriceVnd: null },
        { lineNo: 2, kind: 'ITEM', description: 'I', unit: 'm', note: 'n', extra: { dk: '400' }, quantity: '2.5', unitPriceVnd: '100', vatPercent: 8, amountVnd: '250', costPriceVnd: '90' }] };
    const f = fromVersion(v, 10);
    assert.equal(f.vatPercent, 8);
    assert.equal(f.lines[1].quantity, '2,5');
    assert.equal(f.lines[1].unitPriceVnd, '100');
    assert.equal(f.lines[1].costPriceVnd, '90');
    assert.equal(f.clientCompany, 'C');
    assert.equal(fromVersion({ ...v, lines: [] }, 10).vatPercent, 10);   // chưa có dòng => VAT mặc định của loại
  });
  it('emptyLine, moveLine, nhãn trạng thái', () => {
    assert.deepEqual(emptyLine('SECTION'), { kind: 'SECTION', description: '', unit: '', note: '', extra: {}, quantity: '', unitPriceVnd: '', vatPercent: null, costPriceVnd: '' });
    assert.deepEqual(moveLine(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
    assert.deepEqual(moveLine(['a', 'b'], 0, -1), ['a', 'b']);
    assert.deepEqual(Object.keys(STATE_META).sort(), ['ACCEPTED', 'DRAFT', 'EXPIRED', 'REJECTED', 'SENT']);
  });
  it('kiểm tĩnh: model / controller / màn hình báo giá không dùng Number( / parseFloat( / parseInt( và không ghi bộ nhớ trình duyệt', () => {
    for (const f of ['quotesModel.js', 'quotesUi.js', 'QuotesTab.jsx', 'QuoteEditor.jsx', 'QuoteView.jsx']) {
      const src = readFileSync(new URL('../src/features/quotes/' + f, import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
      assert.ok(!/\b(Number|parseFloat|parseInt)\(/.test(src), f + ' dùng số thực');
      assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), f + ' ghi bộ nhớ trình duyệt');
    }
  });
});
