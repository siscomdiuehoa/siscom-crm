import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { ACTIVITY_TYPES, ActivityTypeCode, TZ_MESSAGE, TZ_RE } from './create-activity.dto';
import { SkipIfBlank, Trim } from './dto-helpers';

// B3 A6 (thiết kế §6). Mọi DTO dùng chung ValidationPipe whitelist + forbidNonWhitelisted (trường lạ => 400).
const VERSION = () => applyDecorators(Type(() => Number), IsInt({ message: 'version phải là số nguyên' }), Min(1));
// null = xoá giá trị (trường tuỳ chọn); undefined = không đổi.
const NullableInstant = () => applyDecorators(IsOptional(), ValidateIf((_o: unknown, v: unknown) => v !== null), IsISO8601({ strict: true }), Matches(TZ_RE, { message: TZ_MESSAGE }));

export class UpdateActivityDto {
  @VERSION()
  version!: number;

  // null/'' = bỏ tiêu đề.
  @IsOptional() @Trim() @SkipIfBlank() @IsString() @MaxLength(200)
  title?: string | null;

  @IsOptional() @Trim() @IsString() @MinLength(1, { message: 'Vui lòng nhập nội dung' }) @MaxLength(4000)
  content?: string;

  @IsOptional() @Trim() @SkipIfBlank() @IsString() @MaxLength(2000)
  outcome?: string | null;

  // TASK: không sửa được (server đặt lúc tạo). Loại khác: không quá +1 ngày trừ MEETING.
  @IsOptional() @IsISO8601({ strict: true }) @Matches(TZ_RE, { message: TZ_MESSAGE })
  occurredAt?: string;

  // TASK: không được null (CHECK ck_activity_task_due).
  @NullableInstant()
  dueAt?: string | null;

  @NullableInstant()
  remindAt?: string | null;

  @IsOptional() @ValidateIf((_o: unknown, v: unknown) => v !== null) @IsUUID()
  contactId?: string | null;

  // Khác người hiện tại => cần activity.assign (audit activity.assign riêng). external=true => giao ra NGOÀI phạm vi (§5.4).
  @IsOptional() @IsUUID()
  performedById?: string;

  @IsOptional() @IsBoolean()
  external?: boolean;

  // Chỉ nhận 'CANCELLED' (huỷ TASK). DONE/OPEN qua /complete, /reopen.
  @IsOptional() @Equals('CANCELLED', { message: "status chỉ nhận 'CANCELLED' (hoàn thành/mở lại dùng /complete, /reopen)" })
  status?: 'CANCELLED';
}

export class AssignActivityDto {
  @IsUUID()
  performedById!: string;

  @VERSION()
  version!: number;

  // true => cho phép giao cho người KHÔNG đọc được khách bằng quyền theo việc (cần activity.assign_external; chỉ TASK OPEN).
  @IsOptional() @IsBoolean()
  external?: boolean;
}

export class CompleteActivityDto {
  @VERSION()
  version!: number;

  // Người được giao (kể cả chỉ có quyền theo việc) ghi kết quả khi hoàn thành.
  @IsOptional() @Trim() @SkipIfBlank() @IsString() @MaxLength(2000)
  outcome?: string | null;
}

export class VersionDto {
  @VERSION()
  version!: number;
}

export class DeleteActivityDto {
  // Lý do ở BODY (không qua query để không lọt vào URL/access log), ≤200, che trong nhật ký.
  @IsOptional() @Trim() @SkipIfBlank() @IsString() @MaxLength(200)
  reason?: string | null;
}

export class RevokeAccessDto {
  @IsUUID()
  employeeId!: string;
}

// GET /activities (danh sách việc).
export class QueryTasksDto {
  // 'me' hoặc uuid nhân viên. Áp SAU vị từ phạm vi đọc.
  @IsOptional() @ValidateIf((_o: unknown, v: unknown) => v !== 'me') @IsUUID(undefined, { message: "assignee phải là 'me' hoặc uuid" })
  assignee?: string;

  @IsOptional() @IsIn(['OPEN', 'DONE', 'CANCELLED'])
  status?: 'OPEN' | 'DONE' | 'CANCELLED';

  // overdue | today | week theo giờ VN (§7); khác 'all' và không gửi status => chỉ việc OPEN (trùng định nghĩa chuông).
  @IsOptional() @IsIn(['overdue', 'today', 'week', 'all'])
  due?: 'overdue' | 'today' | 'week' | 'all';

  @IsOptional() @IsIn(ACTIVITY_TYPES)
  type?: ActivityTypeCode;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'page phải là số nguyên' }) @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'pageSize phải là số nguyên' }) @Min(1) @Max(100)
  pageSize?: number;

  @IsOptional() @IsIn(['dueAt', 'occurredAt'])
  sortBy?: 'dueAt' | 'occurredAt';

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class CreateTransferRequestDto {
  @IsUUID()
  toEmployeeId!: string;

  @Trim() @IsString() @MinLength(1, { message: 'Vui lòng nhập lý do' }) @MaxLength(200)
  reason!: string;
}

export class DecideTransferDto {
  // Phiên bản của HOẠT ĐỘNG (khoá lạc quan). Bắt buộc khi duyệt; tuỳ chọn khi từ chối/rút.
  @IsOptional() @Type(() => Number) @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version?: number;

  @IsOptional() @Trim() @SkipIfBlank() @IsString() @MaxLength(200)
  decisionNote?: string | null;
}

// Rút đề xuất: chỉ version (tuỳ chọn) — không nhận decisionNote (rà soát A6 M-8).
export class WithdrawTransferDto {
  @IsOptional() @Type(() => Number) @IsInt({ message: 'version phải là số nguyên' }) @Min(1)
  version?: number;
}

export class QueryTransferBoxDto {
  @IsIn(['inbox', 'outbox'])
  box!: 'inbox' | 'outbox';
}
