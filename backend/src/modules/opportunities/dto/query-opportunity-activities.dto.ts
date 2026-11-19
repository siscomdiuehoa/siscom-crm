import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ACTIVITY_TYPES, ActivityTypeCode } from '../../activities/dto/create-activity.dto';

// GET /opportunities/:id/activities (docs/SALES_DESIGN.md §5.5(a)).
export class QueryOpportunityActivitiesDto {
  @IsOptional() @IsIn(ACTIVITY_TYPES)
  type?: ActivityTypeCode;

  @IsOptional() @IsIn(['OPEN', 'DONE', 'CANCELLED'])
  status?: 'OPEN' | 'DONE' | 'CANCELLED';

  @IsOptional() @Type(() => Number) @IsInt({ message: 'page phải là số nguyên' }) @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'pageSize phải là số nguyên' }) @Min(1) @Max(100)
  pageSize?: number;

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
