// Hợp đồng + bộ kiểm tra hàng `auth_session` (P-A, Sprint PA1). Hàm thuần, offline: KHÔNG DB, KHÔNG đăng ký DI/route, KHÔNG đọc cấu hình.
// Bám ĐÚNG cột trong schema.prisma (model AuthSession) và CHECK ck_sess_* của migration M1. Hàng đến từ kho = ranh giới không tin cậy => fail-closed.
// Chưa chốt (người gọi truyền tường minh, KHÔNG có mặc định production ở đây): cửa sổ phát lại refresh `reuseGraceMs`,
// JWT/opaque access token, kênh CSRF. Hàm này không băm/so sánh token; chỉ kiểm hình dạng băm đã lưu.
import { isCanonicalUuid } from '../uuid';

export interface RefreshSessionRow {
  readonly id: string;
  readonly employeeId: string;
  readonly familyId: string;
  readonly refreshHash: string; // SHA-256 hex (ck_sess_refresh_hex)
  readonly csrfHash: string; // SHA-256 hex (ck_sess_csrf_hex)
  readonly issuedAt: Date;
  readonly lastUsedAt: Date;
  readonly idleExpiresAt: Date;
  readonly absExpiresAt: Date;
  readonly rotatedAt: Date | null;
  readonly replacedById: string | null;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const REASON = /^[A-Z][A-Z0-9_]*$/;
const isDate = (v: unknown): v is Date => v instanceof Date && Number.isFinite(v.getTime());
const isNullOr = <T>(v: unknown, guard: (x: unknown) => x is T): v is T | null => v === null || guard(v);
const isReason = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && REASON.test(v);

export type RowParseResult = { ok: true; row: RefreshSessionRow } | { ok: false; problems: readonly string[] };

// Kiểm hình dạng + bất biến CHECK của DB. Trả danh sách tên trường/ràng buộc lỗi (không chứa giá trị => không rò băm/ID vào log).
export function parseRefreshSessionRow(raw: unknown): RowParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, problems: ['row'] };
  const r = raw as Record<string, unknown>;
  const p: string[] = [];
  if (!isCanonicalUuid(r.id)) p.push('id');
  if (!isCanonicalUuid(r.employeeId)) p.push('employeeId');
  if (!isCanonicalUuid(r.familyId)) p.push('familyId');
  if (typeof r.refreshHash !== 'string' || !HEX64.test(r.refreshHash)) p.push('refreshHash');
  if (typeof r.csrfHash !== 'string' || !HEX64.test(r.csrfHash)) p.push('csrfHash');
  for (const k of ['issuedAt', 'lastUsedAt', 'idleExpiresAt', 'absExpiresAt'] as const) if (!isDate(r[k])) p.push(k);
  if (!isNullOr(r.rotatedAt, isDate)) p.push('rotatedAt');
  if (!isNullOr(r.replacedById, isCanonicalUuid)) p.push('replacedById');
  if (!isNullOr(r.revokedAt, isDate)) p.push('revokedAt');
  if (!isNullOr(r.revokeReason, isReason)) p.push('revokeReason');
  if (p.length) return { ok: false, problems: p };

  const row = r as unknown as RefreshSessionRow;
  if (row.absExpiresAt < row.issuedAt) p.push('ck_sess_abs');
  if (row.idleExpiresAt > row.absExpiresAt) p.push('ck_sess_idle');
  if (row.replacedById !== null && row.rotatedAt === null) p.push('ck_sess_rotation');
  if (row.replacedById !== null && row.replacedById === row.id) p.push('ck_sess_not_self');
  if ((row.revokedAt === null) !== (row.revokeReason === null)) p.push('ck_sess_revoke');
  return p.length ? { ok: false, problems: p } : { ok: true, row };
}

export type RefreshRowStatus =
  | 'USABLE'
  | 'MALFORMED'
  | 'WRONG_EMPLOYEE'
  | 'REVOKED'
  | 'ROTATED_RECENT' // đã xoay, còn trong cửa sổ phát lại (theo tham số người gọi): từ chối, chưa kết luận là tấn công
  | 'ROTATED_REUSE' // đã xoay, ngoài cửa sổ: người gọi quyết định thu hồi cả family
  | 'ABS_EXPIRED'
  | 'IDLE_EXPIRED';

export interface RefreshRowCheckInput {
  readonly row: unknown;
  readonly expectedEmployeeId: string; // phía server cung cấp (không từ request); sai định dạng => MALFORMED
  readonly now: Date;
  readonly reuseGraceMs: number; // BẮT BUỘC, chưa có mặc định được duyệt; số nguyên an toàn >= 0
}

// Thứ tự ưu tiên (an toàn trước): MALFORMED > WRONG_EMPLOYEE > REVOKED > ROTATED_* > ABS_EXPIRED > IDLE_EXPIRED > USABLE.
// Hết hạn là nửa mở: now >= hạn => hết hạn. Không đổi hàng, không tác dụng phụ.
export function checkRefreshSessionRow(input: RefreshRowCheckInput): RefreshRowStatus {
  const { now, reuseGraceMs, expectedEmployeeId } = input;
  if (!isDate(now) || !Number.isSafeInteger(reuseGraceMs) || reuseGraceMs < 0 || !isCanonicalUuid(expectedEmployeeId)) return 'MALFORMED';
  const parsed = parseRefreshSessionRow(input.row);
  if (!parsed.ok) return 'MALFORMED';
  const row = parsed.row;
  if (row.employeeId !== expectedEmployeeId) return 'WRONG_EMPLOYEE';
  if (row.revokedAt !== null) return 'REVOKED';
  if (row.rotatedAt !== null) return now.getTime() - row.rotatedAt.getTime() < reuseGraceMs ? 'ROTATED_RECENT' : 'ROTATED_REUSE';
  if (now >= row.absExpiresAt) return 'ABS_EXPIRED';
  if (now >= row.idleExpiresAt) return 'IDLE_EXPIRED';
  return 'USABLE';
}
