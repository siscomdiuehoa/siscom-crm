import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SkipIfBlank, Trim } from './dto-helpers';

export const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'SITE_SURVEY', 'NOTE', 'TASK'] as const;
export type ActivityTypeCode = (typeof ACTIVITY_TYPES)[number];
// Người chỉ có activity.create_tech được tạo 3 loại này (kiểm ở SERVICE theo quyền, không ở DTO — thiết kế §6).
export const TECH_TYPES: readonly ActivityTypeCode[] = ['SITE_SURVEY', 'NOTE', 'TASK'];
// Mốc thời gian: CHỈ dạng mở rộng YYYY-MM-DDThh:mm[:ss[.sss]] + múi giờ tường minh (Z hoặc ±hh:mm) — thiết kế §7.
// Rà soát #209 I-1: IsISO8601 nhận cả dạng tuần (2026-W45-3), ngày-trong-năm (2026-310), dạng gọn, năm mở rộng (+2026) mà new Date()
// không đọc được (Invalid Date => 500). Regex chặt dưới đây chỉ cho dạng Date.parse đọc chắc chắn; service còn kiểm NaN + khoảng năm.
export const TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
export const TZ_MESSAGE = 'Thời điểm phải ở dạng YYYY-MM-DDThh:mm[:ss] có múi giờ (ví dụ 2026-11-05T09:00:00+07:00).';

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

  // B3 A6 (§5.4): true => cho phép giao TASK cho người KHÔNG đọc được khách bằng quyền theo việc (cần activity.assign_external).
  // Không gửi/false => hành vi A5 giữ nguyên (người nhận không đọc được khách => 400 ACTIVITY_ASSIGNEE_NO_ACCESS).
  @IsOptional() @IsBoolean()
  external?: boolean;

  // Bắt buộc với TASK (kiểm ở service + CHECK ck_activity_task_due).
  @IsOptional() @IsISO8601({ strict: true }) @Matches(TZ_RE, { message: TZ_MESSAGE })
  dueAt?: string;

  @IsOptional() @IsISO8601({ strict: true }) @Matches(TZ_RE, { message: TZ_MESSAGE })
  remindAt?: string;
}
