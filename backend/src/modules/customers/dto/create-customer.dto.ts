import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsEmailB1 } from '../validators/vn-email';
import { IsVnPhone } from '../validators/vn-phone';
import { IsTaxId } from '../validators/vn-tax-id';
import { IsWebsite } from '../validators/vn-website';
import { CODE_MESSAGE, CODE_RE, SkipIfBlank, Trim, TrimEach } from './dto-helpers';

// B-1: KHÔNG có ownerId/ownerReason (gán chủ sở hữu + CustomerAssignment làm ở B-3); trường lạ => 400.
export class CreateCustomerDto {
  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập tên công ty' }) @MinLength(2, { message: 'Tên công ty quá ngắn' }) @MaxLength(300)
  name!: string;

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập số điện thoại' }) @MaxLength(40) @IsVnPhone()
  phone!: string;

  @SkipIfBlank() @Trim() @IsString() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  tier?: string | null;

  @SkipIfBlank() @Trim() @IsString() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  status?: string | null;

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

  @SkipIfBlank() @Trim() @IsString() @MaxLength(254) @IsEmailB1()
  email?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(255) @IsWebsite()
  website?: string | null;

  @IsOptional() @TrimEach() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) @Matches(/\S/, { each: true, message: 'Thẻ không được để trống' })
  tags?: string[];
}
