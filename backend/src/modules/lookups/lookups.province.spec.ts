import { catalogProblems, LOOKUP_CATALOG } from './lookups.catalog';

// B1.4 (owner duyệt 2026-11-01): danh mục Tỉnh/Thành = 34 đơn vị hành chính cấp tỉnh có hiệu lực từ 01/07/2025 (6 thành phố trực thuộc
// trung ương + 28 tỉnh). Thứ tự: Hà Nội, TP. Hồ Chí Minh, Đà Nẵng lên đầu; còn lại theo ABC tiếng Việt. API sắp theo (sortOrder, labelVi).
const CITIES = ['Hà Nội', 'Huế', 'Hải Phòng', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Cần Thơ'];
const PROVINCES = [
  'Lai Châu', 'Điện Biên', 'Sơn La', 'Lạng Sơn', 'Quảng Ninh', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Cao Bằng',
  'Tuyên Quang', 'Lào Cai', 'Thái Nguyên', 'Phú Thọ', 'Bắc Ninh', 'Hưng Yên', 'Ninh Bình', 'Quảng Trị', 'Quảng Ngãi', 'Gia Lai',
  'Khánh Hòa', 'Lâm Đồng', 'Đắk Lắk', 'Đồng Nai', 'Tây Ninh', 'Vĩnh Long', 'Đồng Tháp', 'Cà Mau', 'An Giang',
];
const TOP = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng'];
const prov = () => LOOKUP_CATALOG.filter((x) => x.type === 'province');
const ordered = () => [...prov()].sort((a, b) => a.sortOrder - b.sortOrder || a.labelVi.localeCompare(b.labelVi, 'vi'));

describe('lookups.catalog — Tỉnh/Thành (34 đơn vị từ 01/07/2025)', () => {
  it('đúng 34 mục: 6 thành phố trực thuộc trung ương + 28 tỉnh, không thừa không thiếu', () => {
    expect(CITIES).toHaveLength(6); expect(PROVINCES).toHaveLength(28);
    expect(prov().map((x) => x.labelVi).sort()).toEqual([...CITIES, ...PROVINCES].sort());
  });
  it('không còn tên đơn vị đã sáp nhập (vd. Bình Dương, Hà Giang, Quảng Nam, Thừa Thiên Huế)', () => {
    const labels = prov().map((x) => x.labelVi);
    for (const old of ['Bình Dương', 'Bà Rịa - Vũng Tàu', 'Hà Giang', 'Quảng Nam', 'Thừa Thiên Huế', 'Kiên Giang', 'Long An', 'Bình Định']) expect(labels).not.toContain(old);
  });
  it('mã ASCII UPPER_SNAKE, duy nhất; không is_system; catalog vẫn hợp lệ', () => {
    const codes = prov().map((x) => x.code);
    for (const c of codes) expect(c).toMatch(/^[A-Z][A-Z_]*$/);
    expect(new Set(codes).size).toBe(codes.length);
    expect(prov().every((x) => !x.isSystem)).toBe(true);
    expect(catalogProblems()).toEqual([]);
  });
  it('mã cố định cho 3 thành phố ưu tiên', () => {
    const code = (l: string) => prov().find((x) => x.labelVi === l)?.code;
    expect([code('Hà Nội'), code('TP. Hồ Chí Minh'), code('Đà Nẵng')]).toEqual(['HA_NOI', 'HO_CHI_MINH', 'DA_NANG']);
  });
  it('thứ tự: Hà Nội, TP. Hồ Chí Minh, Đà Nẵng lên đầu; còn lại ABC tiếng Việt; sortOrder không trùng (không phụ thuộc collation DB)', () => {
    const labels = ordered().map((x) => x.labelVi);
    expect(labels.slice(0, 3)).toEqual(TOP);
    const rest = [...CITIES, ...PROVINCES].filter((l) => !TOP.includes(l)).sort(new Intl.Collator('vi').compare);
    expect(labels.slice(3)).toEqual(rest);
    const so = prov().map((x) => x.sortOrder);
    expect(new Set(so).size).toBe(so.length);
  });
});
