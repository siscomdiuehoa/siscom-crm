import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// T-02 — GET /opportunities/:id/changes: phân trang lịch sử thay đổi (mới nhất trước). Mặc định 50 dòng / trang, tối đa 100.
export class QueryOpportunityChangesDto {
  @IsOptional() @Type(() => Number) @IsInt({ message: 'page phải là số nguyên' }) @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'pageSize phải là số nguyên' }) @Min(1) @Max(100)
  pageSize?: number;
}
