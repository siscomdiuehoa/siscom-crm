import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// P1 — GET /accounts (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.5). Năm vai trò của hệ thống; bốn vai trò cấp được qua giao diện (không bao giờ `admin`).
export const ACCOUNT_ROLE_CODES = ['admin', 'crm_admin', 'sales', 'technician', 'accountant'] as const;
export type AccountRoleCode = (typeof ACCOUNT_ROLE_CODES)[number];
export const GRANTABLE_ROLE_CODES = ['crm_admin', 'sales', 'technician', 'accountant'] as const;
export type GrantableRoleCode = (typeof GRANTABLE_ROLE_CODES)[number];
// Bộ lọc trạng thái đăng nhập: ACTIVE = đang dùng (kể cả đang chờ đổi mật khẩu), DISABLED = đã khoá.
export const ACCOUNT_STATUS_FILTERS = ['ACTIVE', 'DISABLED'] as const;
export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTERS)[number];

export const ACCOUNTS_PAGE_SIZE_DEFAULT = 50;
export const ACCOUNTS_PAGE_SIZE_MAX = 100;

// Độ dài tối thiểu của q được kiểm SAU khi cắt khoảng trắng ở service (cùng cách với danh sách cơ hội).
export class QueryAccountsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(ACCOUNTS_PAGE_SIZE_MAX)
  pageSize?: number;

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsIn(ACCOUNT_ROLE_CODES)
  role?: AccountRoleCode;

  @IsOptional() @IsIn(ACCOUNT_STATUS_FILTERS)
  status?: AccountStatusFilter;
}
