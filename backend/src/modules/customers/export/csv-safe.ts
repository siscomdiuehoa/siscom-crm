// FV-4A §4.2 (đặc tả bản 5 + đính chính 5.1 §2): chống CSV / formula injection và chống Excel tự đổi kiểu.
// Dữ liệu GỐC nằm trong DB, không bao giờ bị sửa; dấu ' chỉ là ký hiệu bảo vệ trong file CSV, unprefix() là hàm nghịch đảo duy nhất.

const NEWLINES = /\r\n|[\r\n\u0085\u2028\u2029]/g;
// C0 trừ TAB (\n, \r đã đổi thành dấu cách ở bước trước), DEL, C1, ký tự định hướng.
const CONTROLS = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
// Ký tự đầu bị bỏ qua (KHÔNG xoá) khi tìm ký tự có nghĩa đầu tiên.
const LEADING_WS = /^[ \t\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]*/;
// Ký tự kích hoạt công thức (gồm biến thể toàn chiều rộng, nhỏ, dấu trừ/gạch Unicode).
const TRIGGER = /^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20\uFE62\uFE63\u2212\u2010-\u2015]/;
// Bước 5b: giá trị Excel sẽ đổi thành số / số mũ / ngày.
const COERCIBLE = /^[0-9][0-9.,/:-]*$/;

function needsGuard(s: string): boolean {
  if (s.startsWith('\t')) return true;
  const rest = s.slice((LEADING_WS.exec(s)?.[0] ?? '').length);
  if (rest.length > 0 && TRIGGER.test(rest)) return true;
  return COERCIBLE.test(s);
}

// Bước 1\u20133: chuẩn hoá (NFC, xuống dòng => dấu cách, bỏ ký tự điều khiển / định hướng).
export function normalizeCell(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').replace(NEWLINES, ' ').replace(CONTROLS, '');
}

export function csvSafeServer(value: string | null | undefined): string {
  const s = normalizeCell(value);
  if (needsGuard(s)) return "'" + s;
  // Giá trị gốc bắt đầu bằng ' mà phần sau thuộc dạng được bảo vệ: thêm một ' để unprefix() trả đúng giá trị gốc.
  if (s.startsWith("'") && needsGuard(s.slice(1))) return "'" + s;
  return s;
}

export function unprefix(cell: string): string {
  // Nghịch đảo chính xác: chỉ bỏ ' khi chính csvSafeServer đã thêm nó (ô đã chuẩn hoá thì csvSafeServer không đổi phần còn lại).
  return cell.startsWith("'") && csvSafeServer(cell.slice(1)) === cell ? cell.slice(1) : cell;
}

export interface ExportRow {
  code: string; name: string; taxId: string | null; industry: string | null; tier: string | null; status: string | null;
  owner: string | null; address: string | null; province: string | null; phone: string | null; email: string | null;
}
export const EXPORT_COLUMNS_VERSION = 1;
export const EXPORT_COLUMNS: ReadonlyArray<{ key: keyof ExportRow; header: string }> = [
  { key: 'code', header: 'Mã KH' }, { key: 'name', header: 'Tên công ty' }, { key: 'taxId', header: 'Mã số thuế' },
  { key: 'industry', header: 'Ngành nghề' }, { key: 'tier', header: 'Phân hạng' }, { key: 'status', header: 'Trạng thái' },
  { key: 'owner', header: 'Phụ trách' }, { key: 'address', header: 'Địa chỉ' }, { key: 'province', header: 'Tỉnh/Thành phố' },
  { key: 'phone', header: 'Điện thoại' }, { key: 'email', header: 'Email' },
];

const quote = (s: string): string => '"' + s.replace(/"/g, '""') + '"';

export function buildCsv(rows: readonly ExportRow[]): { text: string; rows: number; prefixedCells: number; bytes: number } {
  let prefixedCells = 0;
  const lines = [EXPORT_COLUMNS.map((c) => quote(c.header)).join(',')];
  for (const r of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => {
      const raw = normalizeCell(r[c.key]);
      const safe = csvSafeServer(r[c.key]);
      if (safe !== raw) prefixedCells++;
      return quote(safe);
    }).join(','));
  }
  const text = '\uFEFF' + lines.join('\r\n') + '\r\n';
  return { text, rows: rows.length, prefixedCells, bytes: Buffer.byteLength(text, 'utf8') };
}
