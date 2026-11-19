import { OPPORTUNITY_STAGE, OPPORTUNITY_STAGE_DEFAULT_PROBABILITY, OPPORTUNITY_TYPE } from '../lookups/sales.catalog';

// Sales S7 — quy tắc phụ thuộc MÃ danh mục (docs/SALES_DESIGN.md §4.1 R-S1..R-S3, §4.2). Hàm THUẦN, kiểm trên TRẠNG THÁI SAU KHI CẬP NHẬT
// (giá trị mới gộp với giá trị đang có). Mọi đường ghi (tạo, sửa, đổi giai đoạn; S8: tạm hoãn, tiếp tục, mở lại) phải gọi cùng hàm này.
// Chỉ tham chiếu `code` — không dùng tên hiển thị hay thứ tự (PR234-R1-DB-01): đổi tên / đổi thứ tự danh mục không đổi luật.

export interface RuleState {
  status: string; // OPEN | ON_HOLD | WON | LOST
  stageCode: string;
  typeCode: string;
  needSummary: string | null;
  expectedAmountVnd: bigint | null;
  isProjectLinked: boolean;
  projectName: string | null;
  offerScope: string | null;
}
export interface FieldError { field: string; message: string }

const AMOUNT_REQUIRED_STAGES: ReadonlySet<string> = new Set([OPPORTUNITY_STAGE.QUOTATION, OPPORTUNITY_STAGE.NEGOTIATION]);
const CONSTRUCTION_TYPES: ReadonlySet<string> = new Set([OPPORTUNITY_TYPE.INSTALLATION, OPPORTUNITY_TYPE.SUPPLY_INSTALLATION]);
const blank = (v: string | null): boolean => v === null || v.trim() === '';

export const isConstructionType = (typeCode: string): boolean => CONSTRUCTION_TYPES.has(typeCode);
// Xác suất mặc định của giai đoạn; undefined = giai đoạn mà mã nguồn không biết (thêm tay ở DB) => service phải từ chối.
export const defaultProbability = (stageCode: string): number | undefined => OPPORTUNITY_STAGE_DEFAULT_PROBABILITY[stageCode];

// Lý do thua bắt buộc kèm ghi chú (§4.3 "Khác (kèm ghi chú)"). Một nguồn cho /lose và cho danh mục trả về giao diện (S10a).
export const lostReasonNeedsNote = (reasonCode: string): boolean => reasonCode === 'OTHER';

export function ruleViolations(s: RuleState): FieldError[] {
  const e: FieldError[] = [];
  // R-S1: từ Báo giá trở đi VÀ đang mở => bắt buộc có giá trị dự kiến (không áp khi ON_HOLD / WON / LOST).
  if (AMOUNT_REQUIRED_STAGES.has(s.stageCode) && s.status === 'OPEN' && s.expectedAmountVnd === null) {
    e.push({ field: 'expectedAmountVnd', message: 'Từ giai đoạn Báo giá trở đi phải có giá trị dự kiến.' });
  }
  // R-S2: khác Tiếp cận => bắt buộc có nhu cầu của khách.
  if (s.stageCode !== OPPORTUNITY_STAGE.PROSPECTING && blank(s.needSummary)) {
    e.push({ field: 'needSummary', message: 'Phải ghi nhu cầu của khách trước khi rời giai đoạn Tiếp cận.' });
  }
  // R-S3: Thi công / Cung cấp và thi công => luôn gắn dự án/công trình.
  if (CONSTRUCTION_TYPES.has(s.typeCode) && !s.isProjectLinked) {
    e.push({ field: 'isProjectLinked', message: 'Loại Thi công hoặc Cung cấp và thi công luôn gắn với dự án/công trình.' });
  }
  // Gắn dự án => bắt buộc tên dự án + phạm vi SISCOM chào (cũng là CHECK ck_opp_project ở DB); không gắn => không lưu hai trường này.
  if (s.isProjectLinked) {
    if (blank(s.projectName)) e.push({ field: 'projectName', message: 'Vui lòng nhập tên dự án/công trình.' });
    if (blank(s.offerScope)) e.push({ field: 'offerScope', message: 'Vui lòng nhập phạm vi SISCOM đang chào.' });
  } else {
    if (!blank(s.projectName)) e.push({ field: 'projectName', message: 'Chỉ nhập tên dự án khi cơ hội gắn với dự án/công trình.' });
    if (!blank(s.offerScope)) e.push({ field: 'offerScope', message: 'Chỉ nhập phạm vi chào khi cơ hội gắn với dự án/công trình.' });
  }
  return e;
}
