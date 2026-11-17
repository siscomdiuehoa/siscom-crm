// Sales S4 — danh mục cơ hội kinh doanh (docs/SALES_DESIGN.md §4.2, §4.3). Thuần dữ liệu, không Nest, không Prisma, không bí mật.
// Nạp bằng lệnh seed sẵn có (src/cli/seed-lookups.ts → seedLookupCatalog: INSERT ... ON CONFLICT (type, code) DO NOTHING) nên chạy lại
// KHÔNG tạo trùng, KHÔNG ghi đè nhãn/thứ tự đã tuỳ chỉnh, KHÔNG bật lại mục đã ẩn (is_active = false).
// Tên type khớp trigger fn_opportunity_lookups của migration S2 (20261117000000_sales_opportunity). Mã ổn định UPPER_SNAKE
// (ck_lookup_code_fmt; trigger cấm đổi type/code) — đổi tên hiển thị = sửa label_vi, ngừng dùng = is_active=false (không xoá).
// is_system = true chỉ cho mục mà mã nguồn dựa vào theo MÃ: 4 giai đoạn (xác suất mặc định bên dưới + quy tắc R-S1/R-S2 ở S7) và 2 loại
// có thi công (R-S3 ở S7). Không có danh mục lĩnh vực (HVAC mặc định, §1.3).
import type { LookupSeedItem } from './lookups.catalog';

export const SALES_LOOKUP_TYPES: readonly string[] = ['opportunity_type', 'opportunity_stage', 'opportunity_lost_reason'];

// Mã giai đoạn / loại mà service (S7) dùng để kiểm quy tắc. Một nguồn duy nhất cho catalog và service.
export const OPPORTUNITY_STAGE = { PROSPECTING: 'PROSPECTING', SURVEY: 'SURVEY', QUOTATION: 'QUOTATION', NEGOTIATION: 'NEGOTIATION' } as const;
export const OPPORTUNITY_TYPE = { SUPPLY: 'SUPPLY', INSTALLATION: 'INSTALLATION', SUPPLY_INSTALLATION: 'SUPPLY_INSTALLATION' } as const;

// Xác suất mặc định theo giai đoạn (§4.2) — HẰNG SỐ THEO MÃ trong mã nguồn, KHÔNG lưu ở DB (không cần migration):
// §4.2 chỉ cho sửa tên/thứ tự không cần sửa mã; xác suất là quy tắc nghiệp vụ mà service áp khi tạo/đổi giai đoạn và
// probability_overridden = false. Đổi giá trị = PR sửa mã + review. Giai đoạn mới thêm ở DB mà không có ở đây => service (S7) phải từ chối/báo lỗi.
export const OPPORTUNITY_STAGE_DEFAULT_PROBABILITY: Readonly<Record<string, number>> = Object.freeze({
  [OPPORTUNITY_STAGE.PROSPECTING]: 10,
  [OPPORTUNITY_STAGE.SURVEY]: 25,
  [OPPORTUNITY_STAGE.QUOTATION]: 45,
  [OPPORTUNITY_STAGE.NEGOTIATION]: 70,
});

const it = (type: string, code: string, labelVi: string, sortOrder: number, isSystem = false): LookupSeedItem => ({ type, code, labelVi, sortOrder, isSystem });

export const SALES_LOOKUP_CATALOG: readonly LookupSeedItem[] = [
  // opportunity_stage — 4 giai đoạn đang mở; Thắng/Thua nằm ở opportunity.status, không ở danh mục này (§4.2)
  it('opportunity_stage', OPPORTUNITY_STAGE.PROSPECTING, 'Tiếp cận', 10, true),
  it('opportunity_stage', OPPORTUNITY_STAGE.SURVEY, 'Khảo sát', 20, true),
  it('opportunity_stage', OPPORTUNITY_STAGE.QUOTATION, 'Báo giá', 30, true),
  it('opportunity_stage', OPPORTUNITY_STAGE.NEGOTIATION, 'Đàm phán', 40, true),
  // opportunity_type — đúng 3 loại [C1]
  it('opportunity_type', OPPORTUNITY_TYPE.SUPPLY, 'Cung cấp thiết bị, vật tư', 10),
  it('opportunity_type', OPPORTUNITY_TYPE.INSTALLATION, 'Thi công', 20, true),
  it('opportunity_type', OPPORTUNITY_TYPE.SUPPLY_INSTALLATION, 'Cung cấp và thi công', 30, true),
  // opportunity_lost_reason — 9 lý do [C2] (§4.3)
  it('opportunity_lost_reason', 'PRICE_HIGHER', 'Giá cao hơn đối thủ', 10),
  it('opportunity_lost_reason', 'CHOSE_COMPETITOR', 'Khách chọn đối thủ khác', 20),
  it('opportunity_lost_reason', 'NO_RESPONSE', 'Khách không phản hồi', 30),
  it('opportunity_lost_reason', 'PROJECT_CANCELLED', 'Khách hủy dự án/nhu cầu', 40),
  it('opportunity_lost_reason', 'NO_BUDGET', 'Khách không đủ ngân sách', 50),
  it('opportunity_lost_reason', 'SCHEDULE_UNMET', 'Không đáp ứng tiến độ giao hàng/thi công', 60),
  it('opportunity_lost_reason', 'TERMS_DISAGREED', 'Không thống nhất điều kiện thanh toán/hợp đồng', 70),
  it('opportunity_lost_reason', 'SISCOM_WITHDREW', 'SISCOM chủ động không tiếp tục theo đuổi', 80),
  it('opportunity_lost_reason', 'OTHER', 'Khác (kèm ghi chú)', 90),
];

// Kiểm tĩnh phần Sales (gọi trong catalogProblems): đủ 3 type, mỗi giai đoạn có xác suất và ngược lại, đủ mã loại mà service dựa vào.
export function salesCatalogProblems(catalog: readonly LookupSeedItem[]): string[] {
  const p: string[] = [];
  for (const t of SALES_LOOKUP_TYPES) if (!catalog.some((x) => x.type === t)) p.push('thieu loai Sales: ' + t);
  const stages = catalog.filter((x) => x.type === 'opportunity_stage').map((x) => x.code);
  for (const s of stages) if (OPPORTUNITY_STAGE_DEFAULT_PROBABILITY[s] === undefined) p.push('giai doan khong co xac suat mac dinh: ' + s);
  for (const s of Object.keys(OPPORTUNITY_STAGE_DEFAULT_PROBABILITY)) if (!stages.includes(s)) p.push('xac suat cho giai doan khong co trong catalog: ' + s);
  for (const [s, v] of Object.entries(OPPORTUNITY_STAGE_DEFAULT_PROBABILITY)) if (!Number.isInteger(v) || v < 0 || v > 100) p.push('xac suat ngoai 0..100: ' + s);
  for (const c of Object.values(OPPORTUNITY_TYPE)) if (!catalog.some((x) => x.type === 'opportunity_type' && x.code === c)) p.push('thieu loai co hoi: ' + c);
  return p;
}
