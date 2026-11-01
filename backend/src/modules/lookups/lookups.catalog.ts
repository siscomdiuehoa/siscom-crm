// Danh mục CHUẨN (D3) của khách hàng + hàm seed idempotent. Thuần dữ liệu + Prisma, không Nest, không log, không bí mật.
// Nguồn: danh sách giao diện B1.1 (frontend demoData.js: TIERS/STATUSES/SOURCES/INDUSTRIES) + kế hoạch B1.2.3_CUSTOMER_API_PLAN §D3
// + mã enum đề xuất ở B1.2_PLAN. Mã ổn định UPPER_SNAKE (ck_lookup_code_fmt), (type, code) là khoá duy nhất và trigger cấm đổi;
// đổi tên = sửa label_vi; ngừng dùng = is_active=false (KHÔNG xoá). is_system = true chỉ cho giá trị mà mã nguồn dựa vào
// (customers.defaults.ts: tier/status mặc định POTENTIAL khi POST không gửi).
// province (B1.4, owner duyệt 2026-11-01): 34 đơn vị hành chính cấp tỉnh có hiệu lực từ 01/07/2025 (6 thành phố trực thuộc trung ương
// + 28 tỉnh). Thứ tự hiển thị: Hà Nội, TP. Hồ Chí Minh, Đà Nẵng (10/20/30), còn lại ABC tiếng Việt (từ 100, bước 10). Chỉ là DỮ LIỆU
// (bảng lookup_item có sẵn), không đổi cấu trúc. Mã ASCII cố định (trigger cấm đổi); đổi tên hiển thị = sửa label_vi.
import { DEFAULT_STATUS_CODE, DEFAULT_TIER_CODE } from '../customers/customers.defaults';
import { LOOKUP_ALLOWED_TYPES } from './lookups.service';

export interface LookupSeedItem { type: string; code: string; labelVi: string; sortOrder: number; isSystem: boolean }
const it = (type: string, code: string, labelVi: string, sortOrder: number, isSystem = false): LookupSeedItem => ({ type, code, labelVi, sortOrder, isSystem });

export const LOOKUP_CATALOG: readonly LookupSeedItem[] = [
  // customer_tier — phân hạng (FE: Chiến lược, VIP, Tiềm năng, Thường)
  it('customer_tier', 'STRATEGIC', 'Chiến lược', 10),
  it('customer_tier', 'VIP', 'VIP', 20),
  it('customer_tier', DEFAULT_TIER_CODE, 'Tiềm năng', 30, true),
  it('customer_tier', 'REGULAR', 'Thường', 40),
  // customer_status — trạng thái (FE: Đang giao dịch, Tiềm năng, Tạm ngưng, Ngừng giao dịch)
  it('customer_status', 'ACTIVE', 'Đang giao dịch', 10),
  it('customer_status', DEFAULT_STATUS_CODE, 'Tiềm năng', 20, true),
  it('customer_status', 'SUSPENDED', 'Tạm ngưng', 30),
  it('customer_status', 'INACTIVE', 'Ngừng giao dịch', 40),
  // source — nguồn khách (FE: Giới thiệu, Đấu thầu, Website, Hội chợ triển lãm, Khác)
  it('source', 'REFERRAL', 'Giới thiệu', 10),
  it('source', 'TENDER', 'Đấu thầu', 20),
  it('source', 'WEBSITE', 'Website', 30),
  it('source', 'EXHIBITION', 'Hội chợ triển lãm', 40),
  it('source', 'OTHER', 'Khác', 90),
  // industry — ngành (FE: 10 ngành)
  it('industry', 'CONSTRUCTION', 'Tổng thầu xây dựng', 10),
  it('industry', 'REAL_ESTATE', 'Bất động sản', 20),
  it('industry', 'FACTORY_IZ', 'Nhà máy – KCN', 30),
  it('industry', 'HEALTHCARE', 'Y tế', 40),
  it('industry', 'PHARMA', 'Dược phẩm', 50),
  it('industry', 'DATA_CENTER', 'Trung tâm dữ liệu', 60),
  it('industry', 'HOTEL_RESORT', 'Khách sạn – Resort', 70),
  it('industry', 'EDUCATION', 'Giáo dục', 80),
  it('industry', 'RETAIL', 'Thương mại – Bán lẻ', 90),
  it('industry', 'ELECTRONICS', 'Điện tử', 100),
  // province — tỉnh/thành (34 đơn vị từ 01/07/2025): 3 thành phố ưu tiên, rồi ABC tiếng Việt
  it('province', 'HA_NOI', 'Hà Nội', 10),
  it('province', 'HO_CHI_MINH', 'TP. Hồ Chí Minh', 20),
  it('province', 'DA_NANG', 'Đà Nẵng', 30),
  it('province', 'AN_GIANG', 'An Giang', 100),
  it('province', 'BAC_NINH', 'Bắc Ninh', 110),
  it('province', 'CA_MAU', 'Cà Mau', 120),
  it('province', 'CAO_BANG', 'Cao Bằng', 130),
  it('province', 'CAN_THO', 'Cần Thơ', 140),
  it('province', 'DAK_LAK', 'Đắk Lắk', 150),
  it('province', 'DIEN_BIEN', 'Điện Biên', 160),
  it('province', 'DONG_NAI', 'Đồng Nai', 170),
  it('province', 'DONG_THAP', 'Đồng Tháp', 180),
  it('province', 'GIA_LAI', 'Gia Lai', 190),
  it('province', 'HA_TINH', 'Hà Tĩnh', 200),
  it('province', 'HAI_PHONG', 'Hải Phòng', 210),
  it('province', 'HUE', 'Huế', 220),
  it('province', 'HUNG_YEN', 'Hưng Yên', 230),
  it('province', 'KHANH_HOA', 'Khánh Hòa', 240),
  it('province', 'LAI_CHAU', 'Lai Châu', 250),
  it('province', 'LANG_SON', 'Lạng Sơn', 260),
  it('province', 'LAO_CAI', 'Lào Cai', 270),
  it('province', 'LAM_DONG', 'Lâm Đồng', 280),
  it('province', 'NGHE_AN', 'Nghệ An', 290),
  it('province', 'NINH_BINH', 'Ninh Bình', 300),
  it('province', 'PHU_THO', 'Phú Thọ', 310),
  it('province', 'QUANG_NGAI', 'Quảng Ngãi', 320),
  it('province', 'QUANG_NINH', 'Quảng Ninh', 330),
  it('province', 'QUANG_TRI', 'Quảng Trị', 340),
  it('province', 'SON_LA', 'Sơn La', 350),
  it('province', 'TAY_NINH', 'Tây Ninh', 360),
  it('province', 'THAI_NGUYEN', 'Thái Nguyên', 370),
  it('province', 'THANH_HOA', 'Thanh Hóa', 380),
  it('province', 'TUYEN_QUANG', 'Tuyên Quang', 390),
  it('province', 'VINH_LONG', 'Vĩnh Long', 400),
];
// Loại bắt buộc để tạo được khách hàng (customer.tier_id/status_id NOT NULL) + nguồn (chủ dự án yêu cầu kiểm tra).
export const REQUIRED_SEED_TYPES: readonly string[] = ['customer_tier', 'customer_status', 'source'];
export const LOOKUP_CODE_RE = /^[A-Z0-9][A-Z0-9_]*$/;

// ── Bảo vệ đích seed (AGENTS.md): chỉ DB thử; không bao giờ siscom_crm_dev hay baseline đã khoá. ──
export const TEST_DB_RE = /^siscom_crm_(restore|test)_\d{8}_\d{6}$/;
export const NEVER_SEED_DBS: readonly string[] = ['siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948'];
export const SEED_ALLOW_ENV = 'SEED_LOOKUPS_ALLOW_DB';
// Trả về lý do từ chối (chuỗi) hoặc null nếu được phép. env[SEED_ALLOW_ENV] = đúng tên DB => cho DB ngoài regex (phê duyệt bằng văn bản,
// ví dụ DB demo có tên khác); KHÔNG BAO GIỜ mở cho NEVER_SEED_DBS.
export function seedTargetRefusal(dbName: string, env: Record<string, string | undefined>): string | null {
  if (NEVER_SEED_DBS.includes(dbName)) return 'TU CHOI: "' + dbName + '" la database chinh / baseline da khoa. Seed danh muc vao day can quy trinh phe duyet rieng.';
  if (TEST_DB_RE.test(dbName)) return null;
  if (env[SEED_ALLOW_ENV] === dbName) return null;
  return 'TU CHOI: "' + dbName + '" khong phai database thu (siscom_crm_test_YYYYMMDD_HHMMSS / siscom_crm_restore_...). Dat ' + SEED_ALLOW_ENV + '=' + dbName + ' neu da duoc phe duyet.';
}

// ── Seed idempotent: INSERT ... ON CONFLICT (type, code) DO NOTHING (createMany skipDuplicates). Không sửa/xoá dòng có sẵn. ──
export interface SeedDb {
  lookupItem: {
    createMany(args: { data: LookupSeedItem[]; skipDuplicates: boolean }): Promise<{ count: number }>;
    findMany(args: { where: { OR: { type: string; code: string }[] }; select: { type: true; code: true; isActive: true } }): Promise<{ type: string; code: string; isActive: boolean }[]>;
  };
}
export interface SeedReport {
  total: number; inserted: number; existing: number;
  byType: Record<string, { total: number; present: number }>;
  missing: string[];           // type/code có trong catalog nhưng sau seed vẫn không có (không mong đợi)
  inactive: string[];          // type/code có sẵn nhưng is_active=false (giữ nguyên; cảnh báo)
  defaultsOk: boolean;         // tier/status mặc định tồn tại và đang hoạt động => POST /customers không gửi tier/status sẽ chạy
}
export async function seedLookupCatalog(db: SeedDb, catalog: readonly LookupSeedItem[] = LOOKUP_CATALOG): Promise<SeedReport> {
  const r = await db.lookupItem.createMany({ data: catalog.map((x) => ({ ...x })), skipDuplicates: true });
  const rows = await db.lookupItem.findMany({ where: { OR: catalog.map((x) => ({ type: x.type, code: x.code })) }, select: { type: true, code: true, isActive: true } });
  const key = (t: string, c: string) => t + '/' + c;
  const have = new Map(rows.map((x) => [key(x.type, x.code), x.isActive]));
  const byType: Record<string, { total: number; present: number }> = {};
  const missing: string[] = []; const inactive: string[] = [];
  for (const x of catalog) {
    const bt = (byType[x.type] ??= { total: 0, present: 0 }); bt.total++;
    const k = key(x.type, x.code);
    if (!have.has(k)) { missing.push(k); continue; }
    bt.present++;
    if (have.get(k) === false) inactive.push(k);
  }
  const defaultsOk = have.get(key('customer_tier', DEFAULT_TIER_CODE)) === true && have.get(key('customer_status', DEFAULT_STATUS_CODE)) === true;
  return { total: catalog.length, inserted: r.count, existing: catalog.length - r.count, byType, missing, inactive, defaultsOk };
}
// Kiểm tra tĩnh catalog (dùng trong unit test và CLI trước khi ghi).
export function catalogProblems(catalog: readonly LookupSeedItem[] = LOOKUP_CATALOG): string[] {
  const p: string[] = []; const seen = new Set<string>();
  for (const x of catalog) {
    if (!LOOKUP_ALLOWED_TYPES.includes(x.type)) p.push('type ngoai bang trang: ' + x.type);
    if (!LOOKUP_CODE_RE.test(x.code) || x.code.length > 60) p.push('code sai dinh dang: ' + x.type + '/' + x.code);
    if (x.labelVi.trim() === '' || x.labelVi.length > 200) p.push('label rong/qua dai: ' + x.type + '/' + x.code);
    if (!Number.isInteger(x.sortOrder)) p.push('sortOrder khong phai so nguyen: ' + x.type + '/' + x.code);
    const k = x.type + '/' + x.code; if (seen.has(k)) p.push('trung (type, code): ' + k); seen.add(k);
  }
  for (const t of REQUIRED_SEED_TYPES) if (!catalog.some((x) => x.type === t)) p.push('thieu loai bat buoc: ' + t);
  if (!catalog.some((x) => x.type === 'customer_tier' && x.code === DEFAULT_TIER_CODE)) p.push('thieu tier mac dinh ' + DEFAULT_TIER_CODE);
  if (!catalog.some((x) => x.type === 'customer_status' && x.code === DEFAULT_STATUS_CODE)) p.push('thieu status mac dinh ' + DEFAULT_STATUS_CODE);
  return p;
}
