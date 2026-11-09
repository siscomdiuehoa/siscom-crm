import { buildCsv, csvSafeServer, EXPORT_COLUMNS, unprefix } from './csv-safe';

// FV-4A U-03 / U-13: bộ vectơ V-CSV (đặc tả bản 5 §11 MAJOR-3 + §12 yêu cầu 3; đính chính 5.1 §2).
// [đầu vào, đầu ra mong đợi trước khi bọc ngoặc kép]
const V: Array<[string | null | undefined, string]> = [
  ['=1+1', "'=1+1"],
  ['+1+1', "'+1+1"],
  ['-1-1', "'-1-1"],
  ['@SUM(A1)', "'@SUM(A1)"],
  ['=HYPERLINK("http://x","a")', "'=HYPERLINK(\"http://x\",\"a\")"],
  ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
  [' =1+1', "' =1+1"],
  ['\u00A0=1+1', "'\u00A0=1+1"],
  ['\u200B=1+1', "'\u200B=1+1"],
  ['\uFEFF=1+1', "'\uFEFF=1+1"],
  ['\u3000=1+1', "'\u3000=1+1"],
  ['\t=1+1', "'\t=1+1"],
  ['\r=1+1', "' =1+1"],
  ['\n=1+1', "' =1+1"],
  ['abc\r\n=1+1', 'abc =1+1'],
  ['\uFF1D1+1', "'\uFF1D1+1"],
  ['\uFF0B1', "'\uFF0B1"],
  ['\uFF0D1', "'\uFF0D1"],
  ['\uFF20x', "'\uFF20x"],
  ['\uFE621', "'\uFE621"],
  ['\uFE631', "'\uFE631"],
  ['\u22121', "'\u22121"],
  ['\u20101', "'\u20101"],
  ['+84 909 123 456', "'+84 909 123 456"],
  ['0903 123 456', '0903 123 456'],
  ['Công ty "ABC"', 'Công ty "ABC"'],
  ['a\u0000b', 'ab'],
  ['\u0007=1', "'=1"],
  ['\u202E=1+1', "'=1+1"],
  ['\u0085=1', "' =1"],
  ['\u2028x', ' x'],
  [null, ''],
  ['   ', '   '],
  ['=', "'="],
  ['a=1', 'a=1'],
  ['e\u0301', 'é'],
  ['\u007F=1', "'=1"],
  // Vectơ 38 (quyết định khi làm mã): giá trị GỐC bắt đầu bằng ' mà phần sau là dạng được bảo vệ => thêm một ' nữa, để unprefix trả đúng giá trị gốc.
  ["'=1", "''=1"],
  ['\t', "'\t"],
  ['-', "'-"],
  ['=' + 'x'.repeat(4999), "'=" + 'x'.repeat(4999)],
  ['\u2060\u00A0+1', "'\u2060\u00A0+1"],
  ['0903123456', "'0903123456"],
  ['0101234567', "'0101234567"],
  ['0101234567-001', "'0101234567-001"],
  ['1/2', "'1/2"],
  ['1-2', "'1-2"],
  ['12345678901234567', "'12345678901234567"],
  ['KH-00012', 'KH-00012'],
  ['0903 123 456', '0903 123 456'],
  ['12:30', "'12:30"],
];

describe('FV-4A csvSafeServer (U-03)', () => {
  it('đủ 51 vectơ V-CSV, so khớp từng ký tự', () => {
    expect(V).toHaveLength(51);
    for (const [input, want] of V) expect({ input, got: csvSafeServer(input) }).toEqual({ input, got: want });
  });
  it('undefined giống null => chuỗi rỗng', () => {
    expect(csvSafeServer(undefined)).toBe('');
  });
});

describe('FV-4A unprefix (U-13)', () => {
  it('unprefix(csvSafeServer(x)) == x sau chuẩn hoá bước 1\u20133 (NFC, xuống dòng, ký tự điều khiển), cho cả 51 vectơ', () => {
    const norm = (s: string | null | undefined) => (s ?? '').normalize('NFC').replace(/\r\n|[\r\n\u0085\u2028\u2029]/g, ' ')
      .replace(/[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    for (const [input] of V) expect({ input, back: unprefix(csvSafeServer(input)) }).toEqual({ input, back: norm(input) });
  });
  it('không bỏ dấu \' của ô không được bảo vệ', () => {
    expect(unprefix("'abc")).toBe("'abc");
    expect(unprefix('abc')).toBe('abc');
  });
});

describe('FV-4A buildCsv (U-04)', () => {
  it('BOM UTF-8, 11 cột đúng thứ tự, CRLF, mọi ô bọc ngoặc kép, " nhân đôi, đếm ô có tiền tố', () => {
    const r = buildCsv([{ code: 'KH-00001', name: 'A "B"', taxId: '0101234567', industry: null, tier: 'VIP', status: 'Đang giao dịch', owner: 'Nguyễn Văn A', address: 'Q1\r\nHCM', province: null, phone: '+84 909', email: 'a@b.vn' }]);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    const lines = r.text.slice(1).split('\r\n');
    expect(lines).toHaveLength(3); // tiêu đề, 1 dòng, dòng rỗng sau CRLF cuối
    expect(lines[0]).toBe(EXPORT_COLUMNS.map((c) => '"' + c.header + '"').join(','));
    expect(EXPORT_COLUMNS.map((c) => c.header)).toEqual(['Mã KH', 'Tên công ty', 'Mã số thuế', 'Ngành nghề', 'Phân hạng', 'Trạng thái', 'Phụ trách', 'Địa chỉ', 'Tỉnh/Thành phố', 'Điện thoại', 'Email']);
    expect(lines[1]).toBe('"KH-00001","A ""B""","\'0101234567","","VIP","Đang giao dịch","Nguyễn Văn A","Q1 HCM","","\'+84 909","a@b.vn"');
    expect(r.prefixedCells).toBe(2);
    expect(r.rows).toBe(1);
  });
});
