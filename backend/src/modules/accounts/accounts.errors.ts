import { DomainException } from '../../common/errors/domain.exception';

// P1 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.5): mã lỗi ổn định của module quản lý tài khoản. Thông điệp tiếng Việt an toàn để trả về client
// (không lộ chi tiết database, không bao giờ chứa mật khẩu).
export const accountErrors = {
  // Không có access.approve (không phải Quản trị CRM).
  forbidden: () => new DomainException(403, 'FORBIDDEN', 'Không có quyền quản lý tài khoản.'),
  // Thiếu ACCT_DATABASE_URL / chưa đóng khởi tạo: chức năng chưa bật trên máy chủ. Bộ lọc lỗi chung cho phép hai mã 503 này đi ra ngoài.
  unavailable: () => new DomainException(503, 'ACCOUNT_ADMIN_UNAVAILABLE', 'Chức năng quản lý tài khoản chưa được bật trên máy chủ.'),
  // Không có (hoặc có hơn một) tài khoản hệ thống đang hoạt động để đứng tên yêu cầu.
  noSystemRequester: () => new DomainException(503, 'SYSTEM_REQUESTER_UNAVAILABLE', 'Thiếu tài khoản hệ thống, chưa quản lý tài khoản được. Hãy báo người quản trị máy chủ.'),
  validation: (details: unknown[]) => new DomainException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', details),
  notFound: () => new DomainException(404, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản.'),
  selfModification: () => new DomainException(403, 'SELF_MODIFICATION', 'Bạn không tự làm thao tác này trên tài khoản của mình được.'),
  systemAccount: () => new DomainException(403, 'SYSTEM_ACCOUNT', 'Không thao tác được trên tài khoản hệ thống.'),
  lastAdmin: () => new DomainException(409, 'LAST_ADMIN', 'Không thể khoá hoặc gỡ quyền của tài khoản hệ thống cuối cùng.'),
  lastApprover: () => new DomainException(409, 'LAST_APPROVER', 'Không thể khoá hoặc gỡ quyền của Quản trị CRM cuối cùng.'),
  emailTaken: () => new DomainException(409, 'EMAIL_TAKEN', 'Email này đã có người dùng.'),
  versionConflict: () => new DomainException(409, 'VERSION_CONFLICT', 'Thông tin vừa được người khác sửa. Hãy tải lại rồi thử lại.'),
  multiRole: () => new DomainException(409, 'MULTI_ROLE_UNSUPPORTED', 'Tài khoản có nhiều vai trò, cần xử lý riêng.'),
  // Thao tác không hợp với trạng thái hiện tại (khoá tài khoản đã khoá, mở lại tài khoản đang dùng…).
  state: (message: string) => new DomainException(409, 'ACCOUNT_STATE', message),
  rateLimited: () => new DomainException(429, 'RATE_LIMITED', 'Thao tác quá nhanh. Hãy chờ một phút rồi thử lại.'),
};

// Tiền tố thông báo do database ném (fn_auth_* và trigger M1 / M1.2 / P1) => lỗi nghiệp vụ. Thứ tự không quan trọng (tiền tố không trùng nhau).
const PREFIX: ReadonlyArray<readonly [string, () => DomainException]> = [
  ['LAST_ADMIN', accountErrors.lastAdmin],
  ['LAST_APPROVER', accountErrors.lastApprover],
  ['SELF_MODIFICATION', accountErrors.selfModification],
  // TWO_PERSON: người duyệt trùng người yêu cầu hoặc trùng đối tượng — với P1 nghĩa là người bấm thao tác lên chính mình.
  ['TWO_PERSON', accountErrors.selfModification],
  ['SYSTEM_ACCOUNT', accountErrors.systemAccount],
  ['EMAIL_TAKEN', accountErrors.emailTaken],
  ['VERSION_CONFLICT', accountErrors.versionConflict],
  ['APPROVAL_REQUIRED', accountErrors.forbidden],
  ['BOOTSTRAP_OPEN', accountErrors.unavailable],
];

// Lấy các chuỗi có thể chứa thông báo của PostgreSQL (Prisma 7 + adapter-pg gắn ở nhiều chỗ). Chỉ dùng để so khớp nội bộ, KHÔNG trả ra ngoài.
function dbMessages(e: unknown): string[] {
  if (typeof e !== 'object' || e === null) return [];
  const out: string[] = [];
  const push = (v: unknown): void => { if (typeof v === 'string' && v.length > 0) out.push(v); };
  const o = e as { message?: unknown; meta?: { message?: unknown; driverAdapterError?: { cause?: { message?: unknown; originalMessage?: unknown } } }; cause?: { message?: unknown } };
  push(o.meta?.driverAdapterError?.cause?.originalMessage);
  push(o.meta?.driverAdapterError?.cause?.message);
  push(o.meta?.message);
  push(o.cause?.message);
  push(o.message);
  return out;
}

// Trả lỗi nghiệp vụ khi thông báo của database BẮT ĐẦU bằng một tiền tố đã biết (sau "ERROR: " nếu có, hoặc ngay sau "Message: `ERROR: " của
// Prisma). Không khớp => null: bên gọi ném lại lỗi gốc để bộ lọc chung xử lý (500 / 409 chung), không đoán.
export function mapAccountDbError(e: unknown): DomainException | null {
  if (e instanceof DomainException) return e;
  for (const text of dbMessages(e)) {
    for (const [prefix, make] of PREFIX) {
      const re = new RegExp('(?:^|ERROR:\\s+|Message:\\s+`(?:ERROR:\\s+)?)' + prefix + ':');
      if (re.test(text)) return make();
    }
  }
  return null;
}
