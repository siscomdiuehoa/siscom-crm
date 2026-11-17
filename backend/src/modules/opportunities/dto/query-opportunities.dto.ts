import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YMD_MESSAGE = 'Ngày phải ở dạng YYYY-MM-DD.';
export const OPPORTUNITY_STATUSES = ['OPEN', 'ON_HOLD', 'WON', 'LOST'] as const;
export type OpportunityStatusCode = (typeof OPPORTUNITY_STATUSES)[number];
export const OPPORTUNITY_SORTS = ['updatedAt', 'createdAt', 'expectedCloseDate', 'code'] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];

// GET /opportunities và GET /customers/:customerId/opportunities (docs/SALES_DESIGN.md §7). Mọi bộ lọc áp SAU vị từ phạm vi đọc.
export class QueryOpportunitiesDto {
  @IsOptional() @IsIn(OPPORTUNITY_STATUSES)
  status?: OpportunityStatusCode;

  @IsOptional() @IsUUID()
  stageId?: string;

  @IsOptional() @IsUUID()
  typeId?: string;

  @IsOptional() @IsUUID()
  ownerId?: string;

  // Chỉ dùng ở GET /opportunities; ở đường theo khách, khách lấy từ URL (gửi kèm => 400).
  @IsOptional() @IsUUID()
  customerId?: string;

  // Lọc theo ngày dự kiến chốt (expected_close_date, kiểu ngày — không có múi giờ), khoảng ĐÓNG hai đầu.
  @IsOptional() @Matches(YMD, { message: YMD_MESSAGE })
  closeFrom?: string;

  @IsOptional() @Matches(YMD, { message: YMD_MESSAGE })
  closeTo?: string;

  // Tìm theo tiêu đề hoặc tên dự án/công trình (chứa, không phân biệt hoa thường).
  @IsOptional() @IsString() @MinLength(2, { message: 'Từ khoá tìm kiếm cần ít nhất 2 ký tự.' }) @MaxLength(100)
  q?: string;

  // deleted=only: danh sách cơ hội ĐÃ XOÁ MỀM — cần opportunity.restore phạm vi ALL và opportunity.read (§5.4); thiếu => không trả dòng nào.
  @IsOptional() @IsIn(['only'])
  deleted?: 'only';

  @IsOptional() @Type(() => Number) @IsInt({ message: 'page phải là số nguyên' }) @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'pageSize phải là số nguyên' }) @Min(1) @Max(100)
  pageSize?: number;

  @IsOptional() @IsIn(OPPORTUNITY_SORTS)
  sortBy?: OpportunitySort;

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
