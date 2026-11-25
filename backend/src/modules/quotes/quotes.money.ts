// Báo giá Q5 — bộ tính tiền (docs/QUOTES_DESIGN.md mục 6). THUẦN, không DB, không Number.
// Đơn vị: đồng, số nguyên (BigInt). Số lượng lưu ở PHẦN NGHÌN (q = SL × 1000) để không bao giờ cần số thực.
// Đường nhập: chỉ nhận CHUỖI đúng mẫu; số JSON, số mũ, dấu, khoảng trắng, dấu phân cách => null (tầng API trả 400).
// Làm tròn tới đồng, 0,5 lên (cùng quy tắc với round() của numeric trong CHECK C-1 và ROUND của Excel ở Q10):
//   thành tiền = (q × đơn giá + 500) div 1000;   VAT = (tiền hàng × mức + 50) div 100, tính trên TỔNG của từng mức.

export const MAX_SUBTOTAL = 9000000000000000n; // C-2
const QTY_RE = /^([0-9]{1,6})(?:\.([0-9]{1,3}))?$/;
const VND_RE = /^[0-9]{1,12}$/;

// Số lượng => phần nghìn; 0 < SL ≤ 999 999,999; tối đa 3 chữ số thập phân (không tự làm tròn).
export function parseQuantity(s: unknown): bigint | null {
  if (typeof s !== 'string') return null;
  const m = QTY_RE.exec(s);
  if (!m) return null;
  const q = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
  return q > 0n ? q : null;
}
// Đơn giá / giá vốn: 0 ≤ x ≤ 999 999 999 999.
export function parseVnd(s: unknown): bigint | null {
  return typeof s === 'string' && VND_RE.test(s) ? BigInt(s) : null;
}
// Phần nghìn => chuỗi 'n.nnn' cho cột numeric(12,3).
export function qtyText(q: bigint): string {
  return (q / 1000n).toString() + '.' + (q % 1000n).toString().padStart(3, '0');
}
// Chuỗi từ cột numeric(12,3) (Decimal của Prisma .toString(): '2.5', '1', '0.001') => phần nghìn. Dữ liệu đã qua CHECK nên luôn đúng dạng.
export function qtyFromDb(s: string): bigint {
  const r = parseQuantity(s);
  if (r === null) throw new Error('quantity in DB out of shape');
  return r;
}

export const lineAmount = (q: bigint, price: bigint): bigint => (q * price + 500n) / 1000n;
export const vatOf = (base: bigint, percent: 8 | 10): bigint => (base * BigInt(percent) + 50n) / 100n;

export type VatMode = 'QUOTE' | 'LINE';
export interface ItemIn { kind: 'ITEM'; q: bigint; price: bigint; vat: 8 | 10; cost: bigint | null }
export interface SectionIn { kind: 'SECTION' }
export type LineIn = ItemIn | SectionIn;

export class MoneyError extends Error {
  constructor(readonly code: 'AMOUNT_OUT_OF_RANGE' | 'QUOTE_VAT_MIXED') { super(code); }
}

export interface Totals {
  amounts: (bigint | null)[]; // theo thứ tự dòng; dòng nhóm = null
  itemCount: number;
  base8: bigint; base10: bigint; subtotal: bigint; vat8: bigint; vat10: bigint; total: bigint;
}

// Tính mọi tổng từ dòng hàng (máy chủ bỏ qua mọi tổng do trình duyệt gửi). vatMode QUOTE: mọi dòng hàng phải cùng một mức (R-Q1 / QB18).
export function computeTotals(lines: readonly LineIn[], vatMode: VatMode): Totals {
  let base8 = 0n; let base10 = 0n; let itemCount = 0;
  const rates = new Set<number>();
  const amounts = lines.map((l) => {
    if (l.kind !== 'ITEM') return null;
    itemCount++;
    rates.add(l.vat);
    const a = lineAmount(l.q, l.price);
    if (l.vat === 8) base8 += a; else base10 += a;
    return a;
  });
  if (vatMode === 'QUOTE' && rates.size > 1) throw new MoneyError('QUOTE_VAT_MIXED');
  const subtotal = base8 + base10;
  if (subtotal > MAX_SUBTOTAL) throw new MoneyError('AMOUNT_OUT_OF_RANGE');
  const vat8 = vatOf(base8, 8);
  const vat10 = vatOf(base10, 10);
  return { amounts, itemCount, base8, base10, subtotal, vat8, vat10, total: subtotal + vat8 + vat10 };
}

// Lãi gộp tạm tính [QB23] (mục 6): chỉ trên các dòng ĐÃ NHẬP giá vốn; không lưu, tính lúc đọc; chỉ trả cho người được xem giá vốn (7.3).
// Tiền trả dạng chuỗi (lãi gộp có thể âm).
export interface CostSummary { itemLines: number; costedLines: number; costedAmountVnd: string; costVnd: string; grossProfitVnd: string }
export function costSummary(lines: readonly LineIn[], amounts: readonly (bigint | null)[]): CostSummary {
  let itemLines = 0; let costedLines = 0; let costedAmount = 0n; let cost = 0n;
  lines.forEach((l, i) => {
    if (l.kind !== 'ITEM') return;
    itemLines++;
    if (l.cost === null) return;
    costedLines++;
    costedAmount += amounts[i] ?? 0n;
    cost += lineAmount(l.q, l.cost);
  });
  return { itemLines, costedLines, costedAmountVnd: costedAmount.toString(), costVnd: cost.toString(), grossProfitVnd: (costedAmount - cost).toString() };
}
