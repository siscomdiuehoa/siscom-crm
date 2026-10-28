import { IsString, MaxLength, MinLength } from 'class-validator';

// Body đăng nhập: CHÍNH XÁC { login, password } (ValidationPipe whitelist + forbidNonWhitelisted từ chối trường lạ).
// login = email công ty HOẶC mã nhân viên NV-xxxx (phân loại bởi parseLoginIdentifier, không lộ lý do sai).
export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(254)
  login!: string;

  @IsString() @MinLength(1) @MaxLength(1024)
  password!: string;
}
