import { createHash, randomBytes } from 'crypto';
import { DomainException } from '../../errors/domain.exception';
import {
  Clock, IssuedSession, SessionStore, SessionTokenHasher, TokenVersionSource, ValidatedSession,
} from './session.types';

export const TOKEN_PREFIX = 'sid_';
export const TOKEN_BYTES = 32;
export const MAX_TTL_MS = 24 * 60 * 60 * 1000;
// sid_ + 43 ký tự base64url (32 byte). Sai định dạng bị loại trước khi chạm bộ lưu trữ.
const TOKEN_RE = /^sid_[A-Za-z0-9_-]{43}$/;

// Token có 256 bit ngẫu nhiên nên SHA-256 đủ làm băm lưu trữ (không cần băm chậm như mật khẩu).
export class Sha256TokenHasher implements SessionTokenHasher {
  hash(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }
}
export const systemClock: Clock = { now: () => new Date() };

// Bộ lưu trữ mặc định "chưa nối": mọi thao tác ném lỗi => fail-closed cho đến khi PR sau cấp bản DB được duyệt.
export class UnwiredSessionStore implements SessionStore, TokenVersionSource {
  private fail(): never { throw new Error('SESSION_STORE_NOT_WIRED'); }
  insert(): Promise<void> { return this.fail(); }
  findByHash(): Promise<null> { return this.fail(); }
  revokeByHash(): Promise<void> { return this.fail(); }
  currentTokenVersion(): Promise<number | null> { return this.fail(); }
}

const invalid = (): never => {
  throw new DomainException(401, 'SESSION_INVALID', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
};

// Hợp đồng: validate() thành công => { employeeId, tokenVersion } lấy từ bản ghi phiên phía server. MỌI thất bại (sai định dạng, không biết,
// giả mạo, hết hạn, đã thu hồi, token_version lệch, tài khoản không dùng được, lỗi bộ lưu trữ) => cùng DomainException(401, SESSION_INVALID).
// Service CHƯA gắn vào controller/guard/route nào và không mở API đặc quyền.
export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly versions: TokenVersionSource,
    private readonly hasher: SessionTokenHasher = new Sha256TokenHasher(),
    private readonly clock: Clock = systemClock,
    private readonly ttlMs: number = 8 * 60 * 60 * 1000,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) throw new Error('SESSION_TTL_INVALID');
  }

  // Chỉ gọi SAU khi xác minh mật khẩu thành công (employeeId từ PasswordLoginService, không từ request).
  async issue(employeeId: number): Promise<IssuedSession> {
    if (!Number.isInteger(employeeId) || employeeId <= 0) throw new Error('SESSION_EMPLOYEE_INVALID');
    const tokenVersion = await this.versions.currentTokenVersion(employeeId);
    if (tokenVersion === null) return invalid();
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(this.clock.now().getTime() + this.ttlMs);
    await this.store.insert({ tokenHash: this.hasher.hash(token), employeeId, tokenVersion, expiresAt, revokedAt: null });
    return { token, expiresAt };
  }

  async validate(token: unknown): Promise<ValidatedSession> {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return invalid();
    let rec: Awaited<ReturnType<SessionStore['findByHash']>>;
    let current: number | null;
    try {
      rec = await this.store.findByHash(this.hasher.hash(token));
      if (rec === null) return invalid();
      current = await this.versions.currentTokenVersion(rec.employeeId);
    } catch (e) {
      if (e instanceof DomainException) throw e;
      return invalid();
    }
    if (rec.revokedAt !== null || rec.expiresAt.getTime() <= this.clock.now().getTime()) return invalid();
    if (current === null || current !== rec.tokenVersion) return invalid();
    return { employeeId: rec.employeeId, tokenVersion: rec.tokenVersion };
  }

  // Logout: idempotent; token lạ/sai định dạng cũng thành công im lặng (không lộ phiên có tồn tại hay không). Lỗi bộ lưu trữ vẫn ném (không báo thành công giả).
  async revoke(token: unknown): Promise<void> {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return;
    await this.store.revokeByHash(this.hasher.hash(token), this.clock.now());
  }
}
