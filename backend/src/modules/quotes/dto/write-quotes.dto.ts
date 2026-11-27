import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { SkipIfBlank, SkipIfUndefined, Trim } from '../../customers/dto/dto-helpers';

// Báo giá Q5a — thân yêu cầu ghi (docs/QUOTES_DESIGN.md mục 6, 7.3, 9). ValidationPipe toàn cục: whitelist + forbidNonWhitelisted
// => mọi thuộc tính lạ (createdBy, createdById, subtotalVnd, amountVnd…) bị từ chối 400: người gọi KHÔNG đặt được người tạo, KHÔNG gửi được tổng.
// Tiền và số lượng chỉ nhận CHUỖI (@IsString): số JSON => 400. Mẫu chữ số / thập phân kiểm ở service (quotes.money.ts) để báo lỗi theo số dòng,
// không bao giờ lặp lại giá trị (mục 7.3).

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YMD_MESSAGE = 'Ngày phải ở dạng YYYY-MM-DD.';
const VERSION_MESSAGE = 'version phải là số nguyên ≥ 1 (phiên bản của báo giá lúc mở form).';
// Chỉ bỏ qua khi không gửi hoặc gửi null (trường được phép xoá về trống).
const SkipIfNil = () => ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null);

// POST /opportunities/:opportunityId/quotes
export class CreateQuoteDto {
  @IsUUID(undefined, { message: 'templateId phải là uuid của loại báo giá' })
  templateId!: string;

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập hạng mục' }) @MaxLength(120)
  itemName!: string;
}

// PATCH /quotes/:id — đổi hạng mục.
export class UpdateQuoteDto {
  @IsInt({ message: VERSION_MESSAGE }) @Min(1, { message: VERSION_MESSAGE })
  version!: number;

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập hạng mục' }) @MaxLength(120)
  itemName!: string;
}

// POST /quotes/:id/versions (tạo bản mới) · DELETE /quotes/:id/versions/:no (xoá nháp)
export class QuoteVersionRefDto {
  @IsInt({ message: VERSION_MESSAGE }) @Min(1, { message: VERSION_MESSAGE })
  version!: number;
}

// DELETE /quotes/:id — xoá mềm báo giá chưa gửi; bắt buộc lý do.
export class DeleteQuoteDto {
  @IsInt({ message: VERSION_MESSAGE }) @Min(1, { message: VERSION_MESSAGE })
  version!: number;

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng ghi lý do xoá' }) @MaxLength(500)
  reason!: string;
}

// Một dòng của bản nháp. ITEM: quantity + unitPriceVnd bắt buộc; vatPercent ở dòng chỉ với loại "VAT theo từng dòng". SECTION: chỉ có chữ.
// Không có amountVnd: thành tiền luôn do máy chủ tính.
export class QuoteLineDto {
  @IsIn(['ITEM', 'SECTION'], { message: 'kind phải là ITEM hoặc SECTION' })
  kind!: 'ITEM' | 'SECTION';

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập nội dung dòng' }) @MaxLength(500)
  description!: string;

  @SkipIfUndefined() @Trim() @IsString() @MaxLength(30)
  unit?: string;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(200)
  note?: string | null;

  // { <key của cột riêng>: chữ ≤ 200 ký tự } — khoá và giá trị kiểm ở service theo danh sách cột của phiên bản.
  @SkipIfUndefined() @IsObject({ message: 'extra phải là đối tượng { key: chữ }' })
  extra?: Record<string, unknown>;

  @SkipIfNil() @IsString({ message: 'quantity phải là chuỗi số (ví dụ "2.5")' })
  quantity?: string | null;

  @SkipIfNil() @IsString({ message: 'unitPriceVnd phải là chuỗi chữ số' })
  unitPriceVnd?: string | null;

  @SkipIfNil() @IsIn([8, 10], { message: 'vatPercent chỉ nhận 8 hoặc 10' })
  vatPercent?: 8 | 10 | null;

  // Giá vốn một đơn vị [QB23]: không gửi / null = chưa nhập.
  @SkipIfNil() @IsString({ message: 'costPriceVnd phải là chuỗi chữ số' })
  costPriceVnd?: string | null;
}

// PUT /quotes/:id/versions/:no — lưu CẢ bản nháp trong một transaction. lines = toàn bộ danh sách dòng (thay thế).
// Ô đầu trang: không gửi = giữ nguyên; null / '' = để trống (trừ quoterName — bắt buộc có chữ).
export class SaveQuoteDraftDto {
  @IsInt({ message: VERSION_MESSAGE }) @Min(1, { message: VERSION_MESSAGE })
  version!: number;

  // Loại "một mức VAT" [QB18]: mức chung cho mọi dòng hàng (bắt buộc khi có dòng hàng). Loại "theo từng dòng": không gửi.
  @SkipIfNil() @IsIn([8, 10], { message: 'vatPercent chỉ nhận 8 hoặc 10' })
  vatPercent?: 8 | 10 | null;

  @SkipIfBlank() @Matches(YMD, { message: YMD_MESSAGE })
  quoteDate?: string | null;

  @SkipIfBlank() @Matches(YMD, { message: YMD_MESSAGE })
  validUntil?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(200)
  clientName?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(200)
  clientContact?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(200)
  clientCompany?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(30)
  clientPhone?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(254)
  clientEmail?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(500)
  clientAddress?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(200)
  projectName?: string | null;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập tên người báo giá' }) @MaxLength(200)
  quoterName?: string;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(120)
  quoterTitle?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(30)
  quoterPhone?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(254)
  quoterEmail?: string | null;

  @SkipIfUndefined() @IsString() @MaxLength(300)
  intro?: string;

  @SkipIfUndefined() @IsString() @MaxLength(4000)
  terms?: string;

  @SkipIfUndefined() @IsString() @MaxLength(2000)
  paymentInfo?: string;

  // Ghi chú nội bộ, không in.
  @SkipIfBlank() @Trim() @IsString() @MaxLength(2000)
  note?: string | null;

  @IsArray({ message: 'lines phải là mảng' }) @ArrayMaxSize(300, { message: 'Tối đa 300 dòng mỗi phiên bản.' })
  @ValidateNested({ each: true }) @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];
}

// ───── Q5b ─────
// POST /quotes/:id/versions/:no/send — đánh dấu đã gửi [QB1]. Ngày báo giá / hạn hiệu lực: không gửi = dùng giá trị đã lưu ở bản nháp.
export class SendQuoteDto {
  @IsInt({ message: VERSION_MESSAGE }) @Min(1, { message: VERSION_MESSAGE })
  version!: number;

  @SkipIfUndefined() @Matches(YMD, { message: YMD_MESSAGE })
  quoteDate?: string;

  @SkipIfUndefined() @Matches(YMD, { message: YMD_MESSAGE })
  validUntil?: string;
}

// POST /quotes/:id/versions/:no/reject — bắt buộc lý do.
export class RejectQuoteDto {
  @IsInt({ message: VERSION_MESSAGE }) @Min(1, { message: VERSION_MESSAGE })
  version!: number;

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng ghi lý do khách từ chối' }) @MaxLength(500)
  reason!: string;
}
