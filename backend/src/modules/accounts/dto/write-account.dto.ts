import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { GRANTABLE_ROLE_CODES } from './query-accounts.dto';
import type { GrantableRoleCode } from './query-accounts.dto';

// P1 — thân yêu cầu của các API ghi (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.3). ValidationPipe toàn cục: whitelist + forbidNonWhitelisted
// => trường lạ (id, code, isDemo, status…) bị từ chối 400. Ở đây chỉ kiểm KIỂU và độ dài trần; quy tắc nghiệp vụ (cắt khoảng trắng, định dạng
// email, chính sách mật khẩu) kiểm ở service để trả đúng câu tiếng Việt, và database kiểm lại lần nữa.
// tempPassword: trần 128 ký tự theo chính sách mật khẩu; KHÔNG bao giờ được ghi log hay trả lại.
const NAME_MAX = 200;
const EMAIL_MAX = 254;
const TITLE_MAX = 120;
const PASSWORD_MAX_LEN = 128;

export class CreateAccountDto {
  @IsString() @MaxLength(NAME_MAX)
  fullName!: string;

  @IsString() @MaxLength(EMAIL_MAX)
  email!: string;

  @IsOptional() @IsUUID()
  departmentId?: string | null;

  @IsOptional() @IsString() @MaxLength(TITLE_MAX)
  positionTitle?: string | null;

  @IsIn(GRANTABLE_ROLE_CODES, { message: 'Vai trò không hợp lệ.' })
  role!: GrantableRoleCode;

  @IsString() @MaxLength(PASSWORD_MAX_LEN)
  tempPassword!: string;
}

export class UpdateAccountDto {
  // Mốc updatedAt của dòng mà người dùng đang sửa (khoá lạc quan).
  @IsISO8601({ strict: true })
  updatedAt!: string;

  @IsString() @MaxLength(NAME_MAX)
  fullName!: string;

  @IsString() @MaxLength(EMAIL_MAX)
  email!: string;

  @IsOptional() @IsUUID()
  departmentId?: string | null;

  @IsOptional() @IsString() @MaxLength(TITLE_MAX)
  positionTitle?: string | null;
}

export class ChangeRoleDto {
  @IsIn(GRANTABLE_ROLE_CODES, { message: 'Vai trò không hợp lệ.' })
  role!: GrantableRoleCode;
}

export class TempPasswordDto {
  @IsString() @MaxLength(PASSWORD_MAX_LEN)
  tempPassword!: string;
}

export class DisableAccountDto {
  @IsString() @MaxLength(200)
  reason!: string;
}
