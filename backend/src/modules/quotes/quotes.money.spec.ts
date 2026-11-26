// Báo giá Q5 — bộ tính tiền (docs/QUOTES_DESIGN.md mục 6, bảng 6.1; nghiệm thu A1–A14). Kiểm thuần, không DB.
// Mọi số đi vào / ra ở dạng CHUỖI hoặc BigInt — không có Number ở bất kỳ bước nào.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeTotals, costSummary, lineAmount, MAX_SUBTOTAL, parseQuantity, parseVnd, qtyText, vatOf } from './quotes.money';

const q = (s: string) => { const r = parseQuantity(s); if (r === null) throw new Error('bad qty ' + s); return r; };
const v = (s: string) => { const r = parseVnd(s); if (r === null) throw new Error('bad vnd ' + s); return r; };
const item = (qty: string, price: string, vat: 8 | 10, cost?: string) => ({ kind: 'ITEM' as const, q: q(qty), price: v(price), vat, cost: cost === undefined ? null : v(cost) });
const SECTION = { kind: 'SECTION' as const };
const str = (t: ReturnType<typeof computeTotals>) => ({
  base8: t.base8.toString(), base10: t.base10.toString(), vat8: t.vat8.toString(), vat10: t.vat10.toString(), subtotal: t.subtotal.toString(), total: t.total.toString(),
});

describe('Báo giá — đường nhập không qua số thực (A11, A14)', () => {
  it('số lượng: chuỗi thập phân tối đa 6 chữ số nguyên + 3 chữ số thập phân => phần nghìn (BigInt)', () => {
    expect(parseQuantity('5')).toBe(5000n);
    expect(parseQuantity('2.5')).toBe(2500n);
    expect(parseQuantity('1.005')).toBe(1005n);
    expect(parseQuantity('0.001')).toBe(1n);
    expect(parseQuantity('999999.999')).toBe(999999999n);
  });
  it('số lượng sai dạng, quá 3 chữ số thập phân, bằng 0, âm, số mũ, dấu phân cách, khoảng trắng => null (API trả 400)', () => {
    for (const s of ['0', '0.000', '1.0005', '-1', '+5', ' 5', '5 ', '1e3', '1,000', '1.000,5', '1000000', '.5', '5.', '', 'abc', '0x10', '١']) expect(parseQuantity(s)).toBeNull();
  });
  it('tiền (đơn giá, giá vốn): chuỗi 1–12 chữ số => BigInt; 0 được phép (hàng tặng kèm)', () => {
    expect(parseVnd('0')).toBe(0n);
    expect(parseVnd('999999999999')).toBe(999999999999n);
    expect(parseVnd('000123')).toBe(123n);
  });
  it('tiền sai dạng / vượt 12 chữ số / số lẻ / âm => null', () => {
    for (const s of ['1000000000000', '-1', '+1', '1.5', '1e3', '1,000', ' 1', '1 ', '', 'mười']) expect(parseVnd(s)).toBeNull();
  });
  it('chỉ nhận chuỗi: số JSON và các kiểu khác => null', () => {
    for (const x of [5, 1000, 1.5, null, undefined, true, [], {}] as unknown[]) {
      expect(parseQuantity(x)).toBeNull();
      expect(parseVnd(x)).toBeNull();
    }
  });
  it('qtyText trả lại chuỗi đúng 3 chữ số thập phân để ghi cột numeric(12,3)', () => {
    expect(qtyText(2500n)).toBe('2.500');
    expect(qtyText(1n)).toBe('0.001');
    expect(qtyText(999999999n)).toBe('999999.999');
  });
});

describe('Báo giá — làm tròn tới đồng, 0,5 lên (mục 6)', () => {
  it('thành tiền dòng = (q × đơn giá + 500) div 1000', () => {
    expect(lineAmount(q('2.5'), 333333n)).toBe(833333n); // 833 332,5
    expect(lineAmount(q('1.005'), 999n)).toBe(1004n); // 1 003,995
    expect(lineAmount(q('0.001'), 499n)).toBe(0n); // 0,499
    expect(lineAmount(q('0.001'), 500n)).toBe(1n); // 0,5
  });
  it('VAT = (tiền hàng × mức + 50) div 100', () => {
    expect(vatOf(18926364n, 10)).toBe(1892636n);
    expect(vatOf(833333n, 8)).toBe(66667n);
    expect(vatOf(125n, 10)).toBe(13n);
    expect(vatOf(32n, 8)).toBe(3n);
    expect(vatOf(15n, 10)).toBe(2n);
  });
});

describe('Báo giá — bảng ví dụ 6.1 (A1–A10)', () => {
  it('A1: bốn dòng 10 %', () => {
    const t = computeTotals([item('5', '1636000', 10), item('5', '1722000', 10), item('1', '636364', 10), item('1', '1500000', 10)], 'QUOTE');
    expect(t.amounts).toEqual([8180000n, 8610000n, 636364n, 1500000n]);
    expect(str(t)).toEqual({ base8: '0', base10: '18926364', vat8: '0', vat10: '1892636', subtotal: '18926364', total: '20819000' });
  });
  it('A2: hai mức thuế (loại VAT theo dòng)', () => {
    const t = computeTotals([item('2.5', '333333', 8), item('1.005', '999', 10), item('237', '17000', 10)], 'LINE');
    expect(t.amounts).toEqual([833333n, 1004n, 4029000n]);
    expect(str(t)).toEqual({ base8: '833333', base10: '4030004', vat8: '66667', vat10: '403000', subtotal: '4863337', total: '5333004' });
  });
  it('A3, A4: làm tròn VAT 0,5 lên', () => {
    expect(str(computeTotals([item('1', '125', 10)], 'QUOTE'))).toEqual({ base8: '0', base10: '125', vat8: '0', vat10: '13', subtotal: '125', total: '138' });
    expect(str(computeTotals([item('1', '32', 8)], 'QUOTE'))).toEqual({ base8: '32', base10: '0', vat8: '3', vat10: '0', subtotal: '32', total: '35' });
  });
  it('A5: VAT tính trên TỔNG của mức thuế, không làm tròn từng dòng rồi cộng (2, không phải 3)', () => {
    expect(str(computeTotals([item('1', '5', 10), item('1', '5', 10), item('1', '5', 10)], 'QUOTE'))).toEqual({ base8: '0', base10: '15', vat8: '0', vat10: '2', subtotal: '15', total: '17' });
  });
  it('A6: số lượng nhỏ nhất', () => {
    const t = computeTotals([item('0.001', '499', 10), item('0.001', '500', 10)], 'QUOTE');
    expect(t.amounts).toEqual([0n, 1n]);
    expect(str(t)).toEqual({ base8: '0', base10: '1', vat8: '0', vat10: '0', subtotal: '1', total: '1' });
  });
  it('A7: vượt giới hạn subtotal => lỗi AMOUNT_OUT_OF_RANGE', () => {
    expect(() => computeTotals([item('999999.999', '999999999999', 10)], 'QUOTE')).toThrow('AMOUNT_OUT_OF_RANGE');
    expect(MAX_SUBTOTAL).toBe(9000000000000000n);
  });
  it('A8: chỉ có dòng tiêu đề nhóm => mọi tổng 0 (lưu nháp được; gửi bị chặn ở Q5b / DB)', () => {
    const t = computeTotals([SECTION], 'QUOTE');
    expect(str(t)).toEqual({ base8: '0', base10: '0', vat8: '0', vat10: '0', subtotal: '0', total: '0' });
    expect(t.amounts).toEqual([null]);
    expect(t.itemCount).toBe(0);
  });
  it('A9: dòng nhóm không ảnh hưởng tổng', () => {
    expect(str(computeTotals([SECTION, item('1', '100', 10)], 'QUOTE'))).toEqual({ base8: '0', base10: '100', vat8: '0', vat10: '10', subtotal: '100', total: '110' });
  });
  it('A10: loại một mức VAT mà các dòng khác mức => lỗi QUOTE_VAT_MIXED; loại theo dòng => tính được', () => {
    expect(() => computeTotals([item('1', '100', 8), item('1', '100', 10)], 'QUOTE')).toThrow('QUOTE_VAT_MIXED');
    expect(str(computeTotals([item('1', '100', 8), item('1', '100', 10)], 'LINE'))).toEqual({ base8: '100', base10: '100', vat8: '8', vat10: '10', subtotal: '200', total: '218' });
  });
  it('A12 / A14: tổng sau VAT vượt số nguyên an toàn của JavaScript vẫn đúng từng chữ số', () => {
    const t = computeTotals([item('9000', '999999999999', 10)], 'QUOTE');
    expect(t.subtotal.toString()).toBe('8999999999991000');
    expect(t.vat10.toString()).toBe('899999999999100');
    expect(t.total.toString()).toBe('9899999999990100');
    expect(t.total > 9007199254740991n).toBe(true);
  });
});

describe('Báo giá — giá vốn và lãi gộp tạm tính (A11 của bảng 6.1, A13)', () => {
  it('chỉ tính trên các dòng đã nhập giá vốn; ghi rõ số dòng; không đổi các tổng của báo giá', () => {
    const lines = [item('2.5', '333333', 10, '300000'), item('1', '100', 10)];
    const t = computeTotals(lines, 'QUOTE');
    expect(t.subtotal).toBe(833433n);
    expect(costSummary(lines, t.amounts)).toEqual({ itemLines: 2, costedLines: 1, costedAmountVnd: '833333', costVnd: '750000', grossProfitVnd: '83333' });
  });
  it('giá vốn dòng làm tròn như thành tiền; lãi gộp có thể âm', () => {
    const lines = [item('0.001', '0', 10, '500')];
    expect(costSummary(lines, computeTotals(lines, 'QUOTE').amounts)).toEqual({ itemLines: 1, costedLines: 1, costedAmountVnd: '0', costVnd: '1', grossProfitVnd: '-1' });
  });
  it('không dòng nào có giá vốn => các số bằng 0, costedLines 0', () => {
    const lines = [SECTION, item('1', '100', 10)];
    expect(costSummary(lines, computeTotals(lines, 'QUOTE').amounts)).toEqual({ itemLines: 1, costedLines: 0, costedAmountVnd: '0', costVnd: '0', grossProfitVnd: '0' });
  });
});

describe('Báo giá — kiểm tĩnh: mã tính tiền / ghi không dùng số thực (A14)', () => {
  it('quotes.money.ts và quotes.write.service.ts không gọi Number( / parseFloat( / parseInt( / Math.round(', () => {
    for (const f of ['quotes.money.ts', 'quotes.write.service.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/\bNumber\s*\(|parseFloat\s*\(|parseInt\s*\(|Math\.round\s*\(/);
    }
  });
});
