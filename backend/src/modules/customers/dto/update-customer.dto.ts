import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { IsTaxId } from '../validators/vn-tax-id';
import { CODE_MESSAGE, CODE_RE, SkipIfBlank, SkipIfUndefined, Trim, TrimEach } from './dto-helpers';

// PATCH một phần. Không gửi = giữ nguyên; null hoặc '' ở trường tuỳ chọn = xoá giá trị.
// Định dạng phone/email/website được kiểm trong service (bỏ qua khi giá trị KHÔNG đổi so với bản đang lưu, như frontend B1.1).
// B-3: ownerId (uuid | null = bỏ chủ sở hữu) + ownerReason: chỉ khi khác hiện tại => đóng/mở phân công OWNER cùng transaction (hợp đồng §3.7).
// `version` bắt buộc (khoá lạc quan).
export class UpdateCustomerDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @SkipIfBlank() @Trim() @IsUUID(undefined, { message: 'ownerId phải là uuid của nhân viên' })
  ownerId?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(500, { message: 'Lý do phân công tối đa 500 ký tự' })
  ownerReason?: string | null;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập tên công ty' }) @MinLength(2, { message: 'Tên công ty quá ngắn' }) @MaxLength(300)
  name?: string;

  // 04/11/2026: không gửi = giữ nguyên; null/'' = xoá số (khách chưa có số); có số => định dạng kiểm ở service.
  @SkipIfBlank() @Trim() @IsString() @MaxLength(40)
  phone?: string | null;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Phân hạng không được để trống' }) @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  tier?: string;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Trạng thái không được để trống' }) @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  status?: string;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(120)
  shortName?: string | null;

  @SkipIfBlank() @Trim() @IsString() @IsTaxId()
  taxId?: string | null;

  @SkipIfBlank() @Trim() @IsString() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  industry?: string | null;

  @SkipIfBlank() @Trim() @IsString() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  source?: string | null;

  @SkipIfBlank() @Trim() @IsString() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  province?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(500)
  address?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(5000)
  note?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(254)
  email?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(255)
  website?: string | null;

  @IsOptional() @TrimEach() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) @Matches(/\S/, { each: true, message: 'Thẻ không được để trống' })
  tags?: string[];
}
