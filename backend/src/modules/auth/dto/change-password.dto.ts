import { IsString, MaxLength, MinLength } from 'class-validator';

// B1.3.3 (PR 8, D16): body CHÍNH XÁC { currentPassword, newPassword, confirmPassword } (whitelist + forbidNonWhitelisted => trường lạ 400).
// Không trim, không log. Chính sách mật khẩu mới (D17) và so khớp xác nhận kiểm ở AuthService.changePassword.
export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(1024)
  currentPassword!: string;

  @IsString() @MinLength(1) @MaxLength(1024)
  newPassword!: string;

  @IsString() @MinLength(1) @MaxLength(1024)
  confirmPassword!: string;
}
