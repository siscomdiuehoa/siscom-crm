import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Body đăng nhập: { login, password, remember? } (ValidationPipe whitelist + forbidNonWhitelisted từ chối trường lạ).
// login = email công ty HOẶC mã nhân viên NV-xxxx (phân loại bởi parseLoginIdentifier, không lộ lý do sai).
// remember (Issue #177): checkbox "Ghi nhớ đăng nhập trên thiết bị này"; tuỳ chọn, CHỈ boolean thật, thiếu = false (client cũ vẫn chạy).
export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(254)
  login!: string;

  @IsString() @MinLength(1) @MaxLength(1024)
  password!: string;

  @IsOptional() @IsBoolean()
  remember?: boolean;
}
