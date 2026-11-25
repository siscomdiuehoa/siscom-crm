import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { QUOTE_STATES, QuoteStateFilter } from '../quotes.state';

export const QUOTE_SORTS = ['updatedAt', 'createdAt', 'code'] as const;
export type QuoteSort = (typeof QUOTE_SORTS)[number];

// GET /quotes (docs/QUOTES_DESIGN.md mục 9). Mọi bộ lọc áp SAU vị từ phạm vi đọc; total / totalPages chỉ tính trên dòng người gọi được xem.
// KHÔNG có tham số lọc / sắp xếp theo giá vốn hay lãi gộp (mục 7.2): tham số lạ => 400 (ValidationPipe forbidNonWhitelisted).
export class QueryQuotesDto {
  // Trạng thái của phiên bản MỚI NHẤT: SENT = đã gửi và còn hiệu lực; EXPIRED = đã gửi, quá hạn; EXPIRING = còn hiệu lực, hết hạn trong 7 ngày.
  @IsOptional() @IsIn(QUOTE_STATES)
  state?: QuoteStateFilter;

  @IsOptional() @IsUUID()
  templateId?: string;

  // Người phụ trách CƠ HỘI của báo giá.
  @IsOptional() @IsUUID()
  ownerId?: string;

  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsUUID()
  opportunityId?: string;

  // Tìm theo mã, hạng mục hoặc tên khách (chứa; không phân biệt dấu, hoa thường).
  @IsOptional() @IsString() @MinLength(2, { message: 'Từ khoá tìm kiếm cần ít nhất 2 ký tự.' }) @MaxLength(100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'page phải là số nguyên' }) @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'pageSize phải là số nguyên' }) @Min(1) @Max(100)
  pageSize?: number;

  @IsOptional() @IsIn(QUOTE_SORTS)
  sortBy?: QuoteSort;

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

// GET /quotes/templates: all=1 => kể cả loại đã ngừng dùng (cần quote.template).
export class QueryTemplatesDto {
  @IsOptional() @IsIn(['1'])
  all?: '1';
}

// GET /opportunities/:opportunityId/quotes/defaults
export class QueryQuoteDefaultsDto {
  @IsUUID()
  templateId!: string;
}
