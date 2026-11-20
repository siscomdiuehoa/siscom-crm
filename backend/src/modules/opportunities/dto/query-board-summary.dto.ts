import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// T-04 — GET /opportunities/board-summary: tổng theo cột kanban. CHỈ nhận đúng hai bộ lọc mà kanban dùng (loại, từ khoá), cùng ràng buộc với
// QueryOpportunitiesDto; bộ lọc được dựng bằng CHÍNH hàm dựng bộ lọc của danh sách (OpportunitiesService.plan) nên tổng luôn khớp các cột.
export class QueryBoardSummaryDto {
  @IsOptional() @IsUUID()
  typeId?: string;

  @IsOptional() @IsString() @MinLength(2, { message: 'Từ khoá tìm kiếm cần ít nhất 2 ký tự.' }) @MaxLength(100)
  q?: string;
}
