import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { ACTIVITY_TYPES, ActivityTypeCode } from './create-activity.dto';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YMD_MESSAGE = 'Ngày phải ở dạng YYYY-MM-DD (ngày giờ Việt Nam).';

// GET /customers/:customerId/activities (timeline). Thiết kế §6.
export class QueryTimelineDto {
  @IsOptional() @IsIn(ACTIVITY_TYPES)
  type?: ActivityTypeCode;

  @IsOptional() @IsIn(['OPEN', 'DONE', 'CANCELLED'])
  status?: 'OPEN' | 'DONE' | 'CANCELLED';

  // Ngày VN, nửa mở, lọc theo occurredAt (thiết kế §7).
  @IsOptional() @Matches(YMD, { message: YMD_MESSAGE })
  from?: string;

  @IsOptional() @Matches(YMD, { message: YMD_MESSAGE })
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'page phải là số nguyên' }) @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'pageSize phải là số nguyên' }) @Min(1) @Max(100)
  pageSize?: number;

  @IsOptional() @IsIn(['occurredAt', 'dueAt'])
  sortBy?: 'occurredAt' | 'dueAt';

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  // Khách đã xoá mềm: chỉ khi có thêm customer.restore ∧ phạm vi đọc khách (thiết kế §5); không có => 404.
  @IsOptional() @IsIn(['true', 'false'])
  includeDeleted?: 'true' | 'false';
}

// GET /activities/assignee-candidates?customerId= (A5: ứng viên NỘI BỘ). A6: external=true => ứng viên NGOÀI phạm vi (activity.assign_external).
export class QueryAssigneeCandidatesDto {
  @IsUUID()
  customerId!: string;

  @IsOptional() @IsIn(['true', 'false'])
  external?: 'true' | 'false';
}
