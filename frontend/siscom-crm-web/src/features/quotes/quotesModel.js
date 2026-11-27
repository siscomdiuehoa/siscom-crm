// Báo giá Q7 — model THUẦN của giao diện (docs/QUOTES_DESIGN.md mục 6, 10). Không React / DOM / mạng / bộ nhớ trình duyệt.
// Tiền và số lượng luôn là CHUỖI (API trả chuỗi vì tổng có thể vượt số nguyên an toàn của JavaScript); mọi phép tính dùng BigInt, không Number.
// Tạm tính ở đây CHỈ để người soạn thấy ngay; số chính thức luôn là số máy chủ trả về sau khi lưu (máy chủ bỏ qua mọi tổng của trình duyệt).

const QTY_RE = /^([0-9]{1,6})(?:\.([0-9]{1,3}))?$/;
const VND_RE = /^[0-9]{1,12}$/;
export const MAX_LINES = 300;
const MAX_SUBTOTAL = 9000000000000000n;

// Ô số lượng kiểu Việt Nam: có dấu phẩy => phẩy là thập phân, chấm là hàng nghìn; không có phẩy => chấm là thập phân. Trả chuỗi theo mẫu API.
// Có dấu phẩy => phẩy là thập phân; phần nguyên chỉ được bỏ dấu chấm khi tách ĐÚNG từng nhóm 3 chữ số ('1.234,5').
// Sai nhóm ('1.2,5', '1.2.3,5') hoặc nhiều dấu phẩy => giữ nguyên để kiểm dữ liệu báo lỗi, không âm thầm hiểu thành số khác (Q7-R1-01).
export function normQty(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, '');
  const m = /^(\d+|\d{1,3}(?:\.\d{3})+),(\d*)$/.exec(t);
  return m ? m[1].replace(/\./g, '') + '.' + m[2] : t;
}
// Ô tiền: bỏ dấu phân cách nghìn (chấm, phẩy, khoảng trắng) CHỈ khi nó tách đúng từng nhóm 3 chữ số ('1.636.000'); '1.5' giữ nguyên => báo lỗi,
// không âm thầm hiểu thành 15.
export function normVnd(s) {
  const t = String(s == null ? '' : s).trim();
  return /^\d{1,3}([.,\s]\d{3})+$/.test(t) ? t.replace(/[.,\s]/g, '') : t;
}

// Nhóm nghìn trên CHUỖI chữ số (không qua Number).
const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export function fmtVnd(v) {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v); const neg = s.startsWith('-');
  return (neg ? '-' : '') + group(neg ? s.slice(1) : s);
}
// Số lượng chuỗi '2.5' => '2,5'; '8000' => '8.000'.
export function fmtQty(v) {
  if (v === null || v === undefined || v === '') return '—';
  const [w, f] = String(v).split('.');
  return group(w) + (f ? ',' + f : '');
}

const qtyOf = (s) => { const m = QTY_RE.exec(normQty(s)); if (!m) return null; const q = BigInt(m[1]) * 1000n + BigInt((m[2] || '').padEnd(3, '0')); return q > 0n ? q : null; };
const vndOf = (s) => { const t = normVnd(s); return VND_RE.test(t) ? BigInt(t) : null; };
const vatOf = (base, p) => (base * BigInt(p) + 50n) / 100n;

// Tạm tính (cùng công thức với máy chủ, mục 6). vatMode QUOTE: mọi dòng hàng dùng topVat. Dòng còn sai => thành tiền null, không tính, ok=false.
export function previewTotals(lines, vatMode, topVat) {
  let base8 = 0n; let base10 = 0n; let ok = true;
  const amounts = (lines || []).map((l) => {
    if (l.kind !== 'ITEM') return null;
    const q = qtyOf(l.quantity); const p = vndOf(l.unitPriceVnd);
    const vat = vatMode === 'QUOTE' ? topVat : l.vatPercent;
    if (q === null || p === null || (vat !== 8 && vat !== 10)) { ok = false; return null; }
    const a = (q * p + 500n) / 1000n;
    if (vat === 8) base8 += a; else base10 += a;
    return a.toString();
  });
  const subtotal = base8 + base10;
  if (subtotal > MAX_SUBTOTAL) ok = false;
  const vat8 = vatOf(base8, 8); const vat10 = vatOf(base10, 10);
  return { ok, base8: base8.toString(), base10: base10.toString(), vat8: vat8.toString(), vat10: vat10.toString(), subtotal: subtotal.toString(), total: (subtotal + vat8 + vat10).toString(), amounts };
}

// Lãi gộp tạm tính (mục 6, QB23): chỉ trên dòng hàng ĐÃ NHẬP giá vốn; cùng làm tròn với thành tiền. amounts = kết quả previewTotals.
export function previewMargin(lines, amounts) {
  let itemLines = 0; let costedLines = 0; let costed = 0n; let cost = 0n;
  (lines || []).forEach((l, i) => {
    if (l.kind !== 'ITEM') return;
    itemLines++;
    const c = String(l.costPriceVnd || '').trim() === '' ? null : vndOf(l.costPriceVnd); const q = qtyOf(l.quantity); const a = amounts[i];
    if (c === null || q === null || a === null || a === undefined) return;
    costedLines++; costed += BigInt(a); cost += (q * c + 500n) / 1000n;
  });
  return { itemLines, costedLines, costedAmountVnd: costed.toString(), costVnd: cost.toString(), grossProfitVnd: (costed - cost).toString() };
}

// Kiểm tại chỗ (máy chủ vẫn kiểm lại đầy đủ). Khoá lỗi trùng khoá của máy chủ (lines[i].field) để một chỗ hiển thị cho cả hai. Không lặp lại giá trị.
export function validateDraft(f) {
  const e = {};
  const lines = f.lines || [];
  if (lines.length > MAX_LINES) { e.lines = 'Tối đa ' + MAX_LINES + ' dòng mỗi phiên bản.'; return e; }
  if (f.vatMode === 'QUOTE' && f.vatPercent !== 8 && f.vatPercent !== 10 && lines.some((l) => l.kind === 'ITEM')) e.vatPercent = 'Chọn mức VAT cho cả báo giá.';
  lines.forEach((l, i) => {
    const k = 'lines[' + i + '].';
    if (!String(l.description || '').trim()) e[k + 'description'] = 'Nhập nội dung dòng.';
    if (l.kind !== 'ITEM') return;
    if (qtyOf(l.quantity) === null) e[k + 'quantity'] = 'Số lượng > 0, tối đa 3 chữ số thập phân.';
    if (vndOf(l.unitPriceVnd) === null) e[k + 'unitPriceVnd'] = 'Đơn giá là số nguyên đồng, tối đa 12 chữ số.';
    if (String(l.costPriceVnd || '').trim() !== '' && vndOf(l.costPriceVnd) === null) e[k + 'costPriceVnd'] = 'Giá vốn là số nguyên đồng, tối đa 12 chữ số.';
    if (f.vatMode === 'LINE' && l.vatPercent !== 8 && l.vatPercent !== 10) e[k + 'vatPercent'] = 'Chọn VAT của dòng.';
  });
  return e;
}

const txt = (v) => { const t = String(v == null ? '' : v).trim(); return t === '' ? null : t; };
const HEAD = ['clientName', 'clientContact', 'clientCompany', 'clientPhone', 'clientEmail', 'clientAddress', 'projectName', 'quoterTitle', 'quoterPhone', 'quoterEmail', 'note'];

// Biểu mẫu => thân PUT /quotes/:id/versions/:no. version = version của BÁO GIÁ đã tải (khoá lạc quan). Không bao giờ có trường tổng.
export function toSaveBody(f, version) {
  const b = { version };
  if (f.vatMode === 'QUOTE') b.vatPercent = f.vatPercent;
  b.quoteDate = txt(f.quoteDate); b.validUntil = txt(f.validUntil);
  for (const k of HEAD) b[k] = txt(f[k]);
  if (f.quoterName !== undefined) b.quoterName = String(f.quoterName).trim();
  for (const k of ['intro', 'terms', 'paymentInfo']) if (f[k] !== undefined) b[k] = String(f[k] == null ? '' : f[k]);
  b.lines = (f.lines || []).map((l) => {
    if (l.kind !== 'ITEM') return { kind: 'SECTION', description: String(l.description || '').trim(), ...(txt(l.note) ? { note: txt(l.note) } : {}) };
    const o = { kind: 'ITEM', description: String(l.description || '').trim(), unit: String(l.unit || '').trim(), quantity: normQty(l.quantity), unitPriceVnd: normVnd(l.unitPriceVnd) };
    if (f.vatMode === 'LINE') o.vatPercent = l.vatPercent;
    if (f.costVisible) o.costPriceVnd = String(l.costPriceVnd || '').trim() === '' ? null : normVnd(l.costPriceVnd);
    if (txt(l.note)) o.note = txt(l.note);
    const extra = Object.fromEntries(Object.entries(l.extra || {}).filter(([, v]) => String(v == null ? '' : v).trim() !== '').map(([k, v]) => [k, String(v).trim()]));
    if (Object.keys(extra).length) o.extra = extra;
    return o;
  });
  return b;
}

export const emptyLine = (kind = 'ITEM') => ({ kind, description: '', unit: '', note: '', extra: {}, quantity: '', unitPriceVnd: '', vatPercent: null, costPriceVnd: '' });
export const moveLine = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const n = arr.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; };

// Phiên bản của API => biểu mẫu soạn. Loại "một mức VAT": mức chung = mức của dòng hàng đầu (bản chép trong phiên bản);
// chưa có dòng hàng => ĐỂ TRỐNG, người soạn phải chọn — không lấy VAT mặc định của loại hiện tại vì loại có thể đã sửa / ngừng dùng (Q7-R1-03, Owner chốt 26/11/2026).
export function fromVersion(v) {
  const items = (v.lines || []).filter((l) => l.kind === 'ITEM');
  const c = v.client || {}; const q = v.quoter || {};
  return {
    vatMode: v.vatMode, costVisible: !!v.costVisible, vatPercent: v.vatMode === 'QUOTE' && items[0] ? items[0].vatPercent : null,
    quoteDate: v.quoteDate || '', validUntil: v.validUntil || '',
    clientName: c.name || '', clientContact: c.contact || '', clientCompany: c.company || '', clientPhone: c.phone || '', clientEmail: c.email || '', clientAddress: c.address || '',
    projectName: v.projectName || '', quoterName: q.name || '', quoterTitle: q.title || '', quoterPhone: q.phone || '', quoterEmail: q.email || '',
    intro: v.intro || '', terms: v.terms || '', paymentInfo: v.paymentInfo || '', note: v.note || '',
    lines: (v.lines || []).map((l) => ({
      kind: l.kind, description: l.description || '', unit: l.unit || '', note: l.note || '', extra: { ...(l.extra || {}) },
      quantity: l.quantity == null ? '' : fmtQty(l.quantity).replace(/\./g, ''), unitPriceVnd: l.unitPriceVnd == null ? '' : String(l.unitPriceVnd),
      vatPercent: l.vatPercent == null ? null : l.vatPercent, costPriceVnd: l.costPriceVnd == null ? '' : String(l.costPriceVnd),
    })),
  };
}

// Nhãn trạng thái của phiên bản (state do máy chủ tính, gồm EXPIRED = đã gửi nhưng quá hạn).
export const STATE_META = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  SENT: { label: 'Đã gửi', tone: 'blue' },
  EXPIRED: { label: 'Hết hiệu lực', tone: 'warning' },
  ACCEPTED: { label: 'Được chấp nhận', tone: 'success' },
  REJECTED: { label: 'Bị từ chối', tone: 'error' },
};

// ───── Q8a: trang danh sách (#/quotes) và bản in (#/quotes/:id/print/:no) — mục 4.2, 4.4, 9, 10 ─────
// Trạng thái lọc = trạng thái của phiên bản MỚI NHẤT (máy chủ tính; EXPIRING = còn hiệu lực, hết hạn trong 7 ngày).
export const LIST_STATE_FILTERS = [
  { value: '', label: 'Mọi trạng thái' }, { value: 'DRAFT', label: 'Nháp' }, { value: 'SENT', label: 'Đã gửi, còn hiệu lực' },
  { value: 'EXPIRING', label: 'Sắp hết hạn (trong 7 ngày)' }, { value: 'EXPIRED', label: 'Hết hiệu lực' },
  { value: 'ACCEPTED', label: 'Được chấp nhận' }, { value: 'REJECTED', label: 'Bị từ chối' },
];
export const LIST_SORTS = [{ value: 'updatedAt:desc', label: 'Mới cập nhật' }, { value: 'createdAt:desc', label: 'Mới tạo' }, { value: 'code:asc', label: 'Theo mã' }];
export const LIST_PAGE_SIZE = 20;
// Chỉ gửi tham số máy chủ nhận (tham số lạ => 400). Từ khoá dưới 2 ký tự không gửi. Không có lọc / sắp xếp theo giá vốn (mục 7.2).
export function buildQuoteListQuery(f = {}) {
  const q = {};
  if (LIST_STATE_FILTERS.some((x) => x.value && x.value === f.state)) q.state = f.state;
  if (f.templateId) q.templateId = f.templateId;
  const term = String(f.q == null ? '' : f.q).trim();
  if (term.length >= 2) q.q = term.slice(0, 100);
  const sort = LIST_SORTS.some((x) => x.value === f.sort) ? f.sort : LIST_SORTS[0].value;
  const [sortBy, sortOrder] = sort.split(':');
  return { ...q, page: f.page || 1, pageSize: LIST_PAGE_SIZE, sortBy, sortOrder };
}
// Nhãn ở cột hạn hiệu lực. daysLeft do máy chủ tính (chỉ có ở bản đã gửi).
export function validityLabel(latest) {
  if (!latest) return null;
  if (latest.state === 'EXPIRED') return { text: 'Hết hiệu lực', tone: 'error' };
  if (latest.state !== 'SENT' || latest.daysLeft === null || latest.daysLeft === undefined) return null;
  if (latest.daysLeft === 0) return { text: 'Hết hạn hôm nay', tone: 'warning' };
  return { text: 'Còn ' + latest.daysLeft + ' ngày', tone: latest.daysLeft <= 7 ? 'warning' : 'neutral' };
}
// Thanh bên: chế độ API mà không có quote.read => bỏ mục "Báo giá" (mục 10). Chế độ minh hoạ giữ nguyên.
export function quotesNav(nav, apiOn, allowed) {
  if (!apiOn || allowed || !Array.isArray(nav)) return nav;
  return nav.filter((n) => n.id !== 'quotes');
}
// p = các phần của địa chỉ sau '#/'. Số phiên bản không hợp lệ => 'latest' (không báo lỗi; trang in tự lấy bản mới nhất).
export function parseQuotesRoute(p) {
  if (!p[1]) return { page: 'quotes' };
  let id = p[1]; try { id = decodeURIComponent(id); } catch (e) { /* giữ nguyên; máy chủ trả 404 */ }
  if (p[2] !== 'print') return { page: 'quotes', id };
  return { page: 'quotes', id, print: /^[1-9][0-9]{0,5}$/.test(p[3] || '') ? p[3] : 'latest' };
}
const nonZero = (s) => s !== null && s !== undefined && String(s) !== '0';
// Bố cục bản in của MỘT phiên bản (mọi thứ đọc từ chính phiên bản — mục 4.3). quoteCode chỉ dùng khi phiên bản chưa có mã chép.
export function printLayout(v, quoteCode = '') {
  const columns = Array.isArray(v.columns) ? v.columns : [];
  const vatRows = [];
  if (nonZero(v.base8Vnd)) vatRows.push({ percent: 8, value: v.vat8Vnd });
  if (nonZero(v.base10Vnd)) vatRows.push({ percent: 10, value: v.vat10Vnd });
  let n = 0;
  const rows = (v.lines || []).map((line) => ({ line, no: line.kind === 'ITEM' ? ++n : null }));
  return {
    columns, landscape: columns.length > 3, vatColumn: v.vatMode === 'LINE' && vatRows.length === 2, vatRows, draft: v.status === 'DRAFT', rows,
    codeLabel: (v.codeSnapshot || quoteCode) + (v.versionNo > 1 ? ' (v' + v.versionNo + ')' : ''),
  };
}
