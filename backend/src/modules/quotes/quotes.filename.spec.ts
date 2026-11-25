// Báo giá Q4 — ca E7 (docs/QUOTES_DESIGN.md mục 11): tên tệp gợi ý đúng mục 4.4 [QB2, QB8, QB9].
import { fileNamePart, suggestedFileName } from './quotes.filename';

const base = { quoteDate: '2026-11-24', code: 'BG-0012', versionNo: 1, clientName: 'Công ty TNHH Điện lạnh Đông Á', itemName: 'Ống gió vải', draft: false };

describe('Báo giá — tên tệp gợi ý (E7)', () => {
  it('bỏ dấu, đ/Đ => d/D, viết liền PascalCase, giữ nguyên chữ hoa có sẵn', () => {
    expect(fileNamePart('Công ty TNHH Điện lạnh Đông Á')).toBe('CongTyTNHHDienLanhDongA');
    expect(fileNamePart('ống gió vải đường kính 400')).toBe('OngGioVaiDuongKinh400');
    expect(fileNamePart('Đường Đ đ')).toBe('DuongDD');
  });
  it('ký tự gộp (NFD) cho cùng kết quả với ký tự dựng sẵn (NFC)', () => {
    expect(fileNamePart('Ống gió'.normalize('NFD'))).toBe(fileNamePart('Ống gió'.normalize('NFC')));
  });
  it('ký tự cấm trong tên tệp và ký tự lạ bị bỏ', () => {
    expect(fileNamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('ABCDEFGHIJ');
    expect(fileNamePart('Quạt 🌀 Nedfon (m³/h)')).toBe('QuatNedfonMH');
    expect(fileNamePart('../../etc/passwd')).toBe('EtcPasswd');
  });
  it('rỗng sau chuẩn hoá => KhongTen', () => {
    for (const v of ['', '   ', '///', '***', null, undefined, '🌀']) expect(fileNamePart(v)).toBe('KhongTen');
  });
  it('mỗi phần tối đa 40 ký tự', () => {
    expect(fileNamePart('a'.repeat(300))).toHaveLength(40);
  });
  it('phiên bản 1: không có hậu tố phiên bản; phiên bản 2: _v2', () => {
    expect(suggestedFileName(base)).toBe('20261124_BG-0012_CongTyTNHHDienLanhDongA_OngGioVai');
    expect(suggestedFileName({ ...base, versionNo: 2 })).toBe('20261124_BG-0012_v2_CongTyTNHHDienLanhDongA_OngGioVai');
  });
  it('bản nháp thêm _NHAP; bản đã gửi không có', () => {
    expect(suggestedFileName({ ...base, draft: true })).toBe('20261124_BG-0012_CongTyTNHHDienLanhDongA_OngGioVai_NHAP');
    expect(suggestedFileName(base)).not.toMatch(/NHAP/);
  });
  it('tên khách / hạng mục rỗng => KhongTen', () => {
    expect(suggestedFileName({ ...base, clientName: null, itemName: '   ' })).toBe('20261124_BG-0012_KhongTen_KhongTen');
  });
  it('tên 300 ký tự: cả tên không quá 120, chỉ gồm A–Z a–z 0–9 _ -', () => {
    const n = suggestedFileName({ ...base, code: 'BG-123456789', versionNo: 999, clientName: 'Ấ'.repeat(300), itemName: 'Ơ'.repeat(300), draft: true });
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(n.endsWith('_NHAP')).toBe(true);
    expect(n.startsWith('20261124_BG-123456789_v999_')).toBe(true);
  });
  it('mọi đầu vào chỉ ra ký tự an toàn (không dấu chấm, không khoảng trắng, không dấu gạch chéo)', () => {
    for (const s of ['<script>alert(1)</script>', '=HYPERLINK("x")', 'a b\tc\nd', 'CON', 'x.pdf.exe']) {
      expect(suggestedFileName({ ...base, clientName: s, itemName: s })).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
  it('ngày sai dạng không làm hỏng tên (không ném lỗi)', () => {
    expect(suggestedFileName({ ...base, quoteDate: 'abc' })).toMatch(/^00000000_BG-0012_/);
  });
});
