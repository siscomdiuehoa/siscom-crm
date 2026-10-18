import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { IsTaxId } from '../validators/vn-tax-id';
import { CODE_MESSAGE, CODE_RE, SkipIfBlank, SkipIfUndefined, Trim, TrimEach } from './dto-helpers';

// PATCH một phần. Không gửi = giữ nguyên; null hoặc '' ở trường tuỳ chọn = xoá giá trị.
// Định dạng phone/email/website được kiểm trong service (bỏ qua khi giá trị KHÔNG đổi so với bản đang lưu, như frontend B1.1).
// Không có ownerId (B-3). `version` bắt buộc (khoá lạc quan).
export class UpdateCustomerDto {
  @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version!: number;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập tên công ty' }) @MinLength(2, { message: 'Tên công ty quá ngắn' }) @MaxLength(300)
  name?: string;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập số điện thoại' }) @MaxLength(40)
  phone?: string;

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
