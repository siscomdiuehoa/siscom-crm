import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SORT_FIELDS } from '../customers.defaults';
import { CODE_MESSAGE, CODE_RE, Trim } from './dto-helpers';

// `search`: 2–100 ký tự sau trim (dưới 2 => 400). `sortBy=relevance` chỉ dùng khi có `search` (kiểm ở service).
export class QueryCustomersDto {
  @IsOptional() @Trim() @IsString() @MinLength(2, { message: 'search phải có ít nhất 2 ký tự' }) @MaxLength(100)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'page phải là số nguyên' }) @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'pageSize phải là số nguyên' }) @Min(1) @Max(100)
  pageSize?: number;

  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  status?: string;

  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  tier?: string;

  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  industry?: string;

  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  source?: string;

  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  province?: string;

  @IsOptional() @IsUUID()
  ownerId?: string;

  @IsOptional() @IsIn(['exclude', 'only'])
  deleted?: 'exclude' | 'only';

  @IsOptional() @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number];

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
