import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsEmailB1 } from '../validators/vn-email';
import { IsVnPhone } from '../validators/vn-phone';
import { SkipIfBlank, Trim } from './dto-helpers';

// 04/11/2026 (owner, PR #203): chỉ họ tên bắt buộc; phone/email KHÔNG bắt buộc (bỏ CHECK ck_contact_reach). Có giá trị thì vẫn kiểm định dạng.
export class CreateContactDto {
  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập họ tên người liên hệ' }) @MaxLength(200)
  fullName!: string;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(40) @IsVnPhone()
  phone?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(254) @IsEmailB1()
  email?: string | null;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(120)
  title?: string | null;

  @IsOptional() @IsBoolean({ message: 'isPrimary phải là true/false' })
  isPrimary?: boolean;

  @SkipIfBlank() @Trim() @IsString() @MaxLength(5000)
  note?: string | null;
}
