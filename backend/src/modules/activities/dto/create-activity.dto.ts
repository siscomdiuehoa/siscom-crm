import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SkipIfBlank, Trim } from './dto-helpers';

export const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'SITE_SURVEY', 'NOTE', 'TASK'] as const;
export type ActivityTypeCode = (typeof ACTIVITY_TYPES)[number];
// Người chỉ có activity.create_tech được tạo 3 loại này (kiểm ở SERVICE theo quyền, không ở DTO — thiết kế §6).
export const TECH_TYPES: readonly ActivityTypeCode[] = ['SITE_SURVEY', 'NOTE', 'TASK'];
// Mốc thời gian phải có múi giờ tường minh (Z hoặc ±hh:mm) — tránh máy chủ tự hiểu theo giờ cục bộ (thiết kế §7).
const TZ_RE = /(Z|[+-]\d{2}:\d{2})$/;
const TZ_MESSAGE = 'Thời điểm phải ở dạng ISO 8601 có múi giờ (ví dụ 2026-11-05T09:00:00+07:00).';

export class CreateActivityDto {
  @IsIn(ACTIVITY_TYPES, { message: 'type phải là một trong ' + ACTIVITY_TYPES.join(', ') })
  type!: ActivityTypeCode;

  // Rỗng = không có tiêu đề (UI hiện 80 ký tự đầu của content).
  @IsOptional() @Trim() @SkipIfBlank() @IsString() @MaxLength(200)
  title?: string | null;

  @Trim() @IsString() @MinLength(1, { message: 'Vui lòng nhập nội dung' }) @MaxLength(4000)
  content!: string;

  @IsOptional() @Trim() @SkipIfBlank() @IsString() @MaxLength(2000)
  outcome?: string | null;

  // TASK: KHÔNG nhận (server đặt = thời điểm tạo — thiết kế §6, rà soát lần 5 M-2). Loại khác: mặc định now, không quá +1 ngày trừ MEETING.
  @IsOptional() @IsISO8601({ strict: true }) @Matches(TZ_RE, { message: TZ_MESSAGE })
  occurredAt?: string;

  @IsOptional() @IsUUID()
  contactId?: string;

  // Mặc định = người tạo. Khác người tạo => cần activity.assign + người nhận ACTIVE, cùng phòng (phạm vi ALL: mọi phòng), ĐỌC ĐƯỢC KHÁCH.
  @IsOptional() @IsUUID()
  performedById?: string;

  // Bắt buộc với TASK (kiểm ở service + CHECK ck_activity_task_due).
  @IsOptional() @IsISO8601({ strict: true }) @Matches(TZ_RE, { message: TZ_MESSAGE })
  dueAt?: string;

  @IsOptional() @IsISO8601({ strict: true }) @Matches(TZ_RE, { message: TZ_MESSAGE })
  remindAt?: string;
}
