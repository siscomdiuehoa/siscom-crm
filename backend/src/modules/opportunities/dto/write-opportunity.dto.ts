import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { SkipIfBlank, SkipIfUndefined, Trim } from '../../customers/dto/dto-helpers';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YMD_MESSAGE = 'Ngày phải ở dạng YYYY-MM-DD.';
// Số tiền VNĐ: chuỗi chữ số, không âm, tối đa 15 chữ số (JSON không có bigint; không nhận số thực để khỏi mất chính xác).
const AMOUNT = /^(0|[1-9]\d{0,14})$/;
const AMOUNT_MESSAGE = 'Giá trị phải là chuỗi số nguyên không âm (VNĐ), tối đa 15 chữ số.';

// POST /opportunities (docs/SALES_DESIGN.md §6.1). Trường tuỳ chọn: không gửi / null / '' = không có.
// Không nhận ownerId, stageId, status, probability: người phụ trách mặc định = người phụ trách khách; giai đoạn = Tiếp cận; trạng thái = Đang mở.
export class CreateOpportunityDto {
  @IsUUID(undefined, { message: 'customerId phải là uuid của khách hàng' })
  customerId!: string;

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập tiêu đề cơ hội' }) @MaxLength(200)
  title!: string;

  @IsUUID(undefined, { message: 'typeId phải là uuid của loại cơ hội' })
  typeId!: string;

  @SkipIfUndefined() @IsBoolean({ message: 'isProjectLinked phải là true hoặc false' })
  isProjectLinked?: boolean;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(200)
  projectName?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(2000)
  offerScope?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(4000)
  needSummary?: string | null;

  @SkipIfBlank() @IsString() @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  expectedAmountVnd?: string | null;

  @SkipIfBlank() @Matches(YMD, { message: YMD_MESSAGE })
  expectedCloseDate?: string | null;

  @SkipIfBlank() @IsUUID(undefined, { message: 'contactId phải là uuid của người liên hệ' })
  contactId?: string | null;
}

// PATCH /opportunities/:id (§6.3). Không gửi = giữ nguyên; null hoặc '' ở trường tuỳ chọn = xoá giá trị. `version` bắt buộc (khoá lạc quan).
// Không nhận stageId (dùng /stage), status (S8), ownerId (S8).
export class UpdateOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Tiêu đề không được để trống' }) @MaxLength(200)
  title?: string;

  @SkipIfUndefined() @IsUUID(undefined, { message: 'typeId phải là uuid của loại cơ hội' })
  typeId?: string;

  @SkipIfUndefined() @IsBoolean({ message: 'isProjectLinked phải là true hoặc false' })
  isProjectLinked?: boolean;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(200)
  projectName?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(2000)
  offerScope?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(4000)
  needSummary?: string | null;

  @SkipIfBlank() @IsString() @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  expectedAmountVnd?: string | null;

  @SkipIfBlank() @Matches(YMD, { message: YMD_MESSAGE })
  expectedCloseDate?: string | null;

  @SkipIfBlank() @IsUUID(undefined, { message: 'contactId phải là uuid của người liên hệ' })
  contactId?: string | null;

  // Sửa xác suất bằng tay: bắt buộc kèm probabilityReason (§6.3); lưu lịch sử.
  @SkipIfUndefined() @IsInt({ message: 'probability phải là số nguyên' }) @Min(0) @Max(100)
  probability?: number;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  probabilityReason?: string | null;
}

// POST /opportunities/:id/stage (§6.2). probability: chỉ cần khi xác suất đang được sửa tay — KEEP = giữ, RESET = về mặc định của giai đoạn mới.
export class MoveStageDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @IsUUID(undefined, { message: 'stageId phải là uuid của giai đoạn' })
  stageId!: string;

  @SkipIfUndefined() @IsIn(['KEEP', 'RESET'], { message: 'probability phải là KEEP hoặc RESET' })
  probability?: 'KEEP' | 'RESET';
}

// POST /opportunities/:id/assign (§6.8). Lý do bắt buộc.
export class AssignOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @IsUUID(undefined, { message: 'ownerId phải là uuid của nhân viên' })
  ownerId!: string;

  @Trim() @IsString() @IsNotEmpty({ message: 'Chuyển người phụ trách phải ghi lý do' }) @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  reason!: string;
}

// DELETE /opportunities/:id (§6.9) — xoá mềm, lý do bắt buộc (cột delete_reason ≤ 500).
export class DeleteOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @Trim() @IsString() @IsNotEmpty({ message: 'Xoá cơ hội phải ghi lý do' }) @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  reason!: string;
}

// POST /opportunities/:id/restore (§5.4).
export class RestoreOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;
}

// ───── S8b: vòng đời trạng thái (§6.4–6.7) ─────
// POST /opportunities/:id/hold — Tạm hoãn, hoặc đổi hạn / lý do khi đang tạm hoãn. Cả hai trường bắt buộc.
export class HoldOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @Matches(YMD, { message: YMD_MESSAGE })
  holdUntil!: string;

  @Trim() @IsString() @IsNotEmpty({ message: 'Tạm hoãn phải ghi lý do' }) @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  holdReason!: string;
}

// POST /opportunities/:id/resume — Tạm hoãn → Đang mở. Lý do tuỳ chọn.
export class ResumeOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  reason?: string | null;
}

// POST /opportunities/:id/win — Thắng: giá trị chốt + chứng từ (loại, số, ngày, đường dẫn https) + người nhận bàn giao. Hạn bàn giao tuỳ chọn (mặc định 7 ngày).
export class WinOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @IsString() @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  wonAmountVnd!: string;

  @IsIn(['HOP_DONG', 'DON_DAT_HANG'], { message: 'wonDocType phải là HOP_DONG hoặc DON_DAT_HANG' })
  wonDocType!: 'HOP_DONG' | 'DON_DAT_HANG';

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập số chứng từ' }) @MaxLength(100)
  wonDocNo!: string;

  @Matches(YMD, { message: YMD_MESSAGE })
  wonDocDate!: string;

  @IsString() @MaxLength(1000) @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Đường dẫn chứng từ phải là địa chỉ https hợp lệ' })
  wonDocUrl!: string;

  @IsUUID(undefined, { message: 'handoverToId phải là uuid của nhân viên' })
  handoverToId!: string;

  @SkipIfBlank() @Matches(YMD, { message: YMD_MESSAGE })
  handoverDueDate?: string | null;
}

// POST /opportunities/:id/lose — Thua: lý do theo danh mục; lý do "Khác" phải kèm ghi chú.
export class LoseOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @IsUUID(undefined, { message: 'lostReasonId phải là uuid của lý do thua' })
  lostReasonId!: string;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(2000)
  lostNote?: string | null;
}

// POST /opportunities/:id/reopen — Mở lại cơ hội đã Thắng / Thua. Lý do bắt buộc.
export class ReopenOpportunityDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @Trim() @IsString() @IsNotEmpty({ message: 'Mở lại cơ hội phải ghi lý do' }) @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  reason!: string;
}
