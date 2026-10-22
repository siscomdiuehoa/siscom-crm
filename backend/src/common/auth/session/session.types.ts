// Cổng (port) cho vòng đời phiên (Sprint A2, chỉ mã nguồn, offline). CHƯA có triển khai DB, CHƯA gắn vào route/DI/guard:
// lược đồ hiện chưa được duyệt cho bảng phiên + pool có thông tin xác thực, nên SessionStore/TokenVersionSource do PR sau cung cấp.

export interface SessionRecord {
  // Chỉ lưu BĂM của token (hash-at-rest); token gốc không bao giờ được lưu hay log.
  readonly tokenHash: string;
  readonly employeeId: string;
  readonly tokenVersion: number;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface SessionStore {
  insert(record: SessionRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<SessionRecord | null>;
  // Đánh dấu thu hồi (idempotent). Không có phiên => không làm gì.
  revokeByHash(tokenHash: string, at: Date): Promise<void>;
}
export const SESSION_STORE = Symbol('SESSION_STORE');

export interface TokenVersionSource {
  // token_version hiện hành của credential; null = tài khoản không còn dùng được (khóa/không có) => phiên bị từ chối.
  currentTokenVersion(employeeId: string): Promise<number | null>;
}
export const TOKEN_VERSION_SOURCE = Symbol('TOKEN_VERSION_SOURCE');

export interface SessionTokenHasher {
  hash(token: string): string;
}
export const SESSION_TOKEN_HASHER = Symbol('SESSION_TOKEN_HASHER');

export interface Clock { now(): Date }

export interface IssuedSession { readonly token: string; readonly expiresAt: Date }
// Danh tính phiên đã xác thực phía server — nguồn DUY NHẤT của actor; không bao giờ lấy từ nội dung request.
export interface ValidatedSession { readonly employeeId: string; readonly tokenVersion: number }
