import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsEmailB1 } from '../validators/vn-email';
import { IsVnPhone } from '../validators/vn-phone';
import { SkipIfBlank, SkipIfUndefined, Trim } from './dto-helpers';

// FV-3 (08/11/2026): bảng contact KHÔNG có cột version => khoá lạc quan bằng updatedAt (Timestamptz(3)) đã tải về.
const UPDATED_AT_MESSAGE = 'Thiếu hoặc sai mốc cập nhật (updatedAt) của người liên hệ';

// Sửa: không gửi = giữ nguyên; trường tuỳ chọn gửi rỗng/null = xoá giá trị. Họ tên nếu gửi thì không được rỗng.
export class UpdateContactDto {
  @IsString({ message: UPDATED_AT_MESSAGE }) @IsISO8601({ strict: true }, { message: UPDATED_AT_MESSAGE })
  updatedAt!: string;

  @SkipIfUndefined() @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập họ tên người liên hệ' }) @MaxLength(200)
  fullName?: string;

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

// Xoá mềm: phải gửi updatedAt đang thấy để không xoá nhầm bản người khác vừa sửa.
export class DeleteContactDto {
  @IsString({ message: UPDATED_AT_MESSAGE }) @IsISO8601({ strict: true }, { message: UPDATED_AT_MESSAGE })
  updatedAt!: string;
}
