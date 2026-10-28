import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AUTH_CONFIG, AuthConfig } from '../../common/auth/auth.config';
import { Argon2PasswordHasher, ARGON2_ALGO } from '../../common/auth/login/argon2.hasher';
import { parseLoginIdentifier } from '../../common/auth/login/login-identifier';
import { ResolvedSession, SessionActorProvider } from '../../common/auth/session/session-actor.provider';
import { newOpaqueToken, SESSION_COOKIE_NAME, sha256Hex } from '../../common/auth/session/session-token';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginLimiter } from './login-limiter';

export interface LoginInput { login: string; password: string; source: string; ip: string | null; userAgent: string | null; requestId?: string }
export interface LoginResult { sessionToken: string; csrfToken: string; maxAgeSeconds: number; me: MeView }
export interface MeView { employeeId: string; code: string; fullName: string; departmentId: string | null; roles: readonly string[]; permissions: Readonly<Record<string, string>>; mustChangePassword: boolean }

const LOGIN_FAILED = () => new DomainException(401, 'LOGIN_INVALID', 'Tên đăng nhập hoặc mật khẩu không đúng.');
const THROTTLED = () => new DomainException(429, 'LOGIN_THROTTLED', 'Quá nhiều lần thử, vui lòng thử lại sau.');

// Đăng nhập / đăng xuất / thông tin phiên. Mọi thất bại đăng nhập trả cùng 401 LOGIN_INVALID (không lộ tài khoản có tồn tại hay bị khoá).
// Nhật ký: auth.login_ok / auth.login_failed / auth.logout vào audit_log (không ghi mật khẩu, token, email thô).
@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  private readonly hasher = new Argon2PasswordHasher();
  private readonly limiter: LoginLimiter;

  constructor(private readonly prisma: PrismaService, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig, private readonly sessions: SessionActorProvider) {
    this.limiter = new LoginLimiter({ windowMs: cfg.loginWindowMinutes * 60_000, maxPerSource: cfg.loginMaxPerSource, maxPerIdentifier: cfg.loginMaxPerIdentifier });
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const id = parseLoginIdentifier(input.login);
    const norm = id.kind === 'EMAIL' ? 'e:' + id.value.toLowerCase() : id.kind === 'EMPLOYEE_CODE' ? 'c:' + id.value : null;
    if (!this.limiter.allow(input.source, norm)) throw THROTTLED();
    if (id.kind === 'INVALID') { await this.hasher.verify(null, input.password); throw LOGIN_FAILED(); }

    const emp = id.kind === 'EMAIL'
      ? await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM employee WHERE lower(email) = lower(${id.value}) AND deleted_at IS NULL ORDER BY created_at LIMIT 2`
      : await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM employee WHERE code = ${id.value} AND deleted_at IS NULL LIMIT 2`;
    // Email trùng (không thể với uq_employee_email_active, phòng hờ) hoặc không có => thất bại chung sau khi băm giả.
    const employeeId = emp.length === 1 ? emp[0].id : null;
    const now = new Date();
    const row = employeeId === null ? null : await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, code: true, fullName: true, status: true, departmentId: true,
        credential: { select: { passwordHash: true, passwordAlgo: true, status: true, lockedUntil: true, failedCount: true, windowStartedAt: true, lockLevel: true, mustChangePassword: true } } },
    });
    const cred = row?.credential ?? null;
    const usable = row !== null && row.status === 'ACTIVE' && cred !== null && cred.status === 'ACTIVE' && cred.passwordAlgo === ARGON2_ALGO
      && (cred.lockedUntil === null || cred.lockedUntil <= now);
    const ok = await this.hasher.verify(usable ? cred!.passwordHash : null, input.password);
    if (!usable || !ok) {
      if (row !== null && cred !== null) await this.recordFailure(row.id, cred, now, input.requestId);
      throw LOGIN_FAILED();
    }

    const sessionToken = newOpaqueToken();
    const csrfToken = newOpaqueToken();
    const idle = new Date(now.getTime() + this.cfg.sessionIdleMinutes * 60_000);
    const abs = new Date(now.getTime() + this.cfg.sessionAbsHours * 3_600_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeCredential.update({ where: { employeeId: row!.id }, data: { failedCount: 0, windowStartedAt: null, lockedUntil: null, lockLevel: 0, lastLoginAt: now } });
      await tx.authSession.create({ data: {
        employeeId: row!.id, familyId: randomUUID(), refreshHash: sha256Hex(sessionToken), csrfHash: sha256Hex(csrfToken),
        issuedAt: now, lastUsedAt: now, idleExpiresAt: idle < abs ? idle : abs, absExpiresAt: abs,
        ipPrefix: ipPrefix(input.ip), uaShort: input.userAgent ? input.userAgent.slice(0, 200) : null,
      } });
      await tx.auditLog.create({ data: { actorType: 'USER', actorId: row!.id, action: 'auth.login_ok', entityType: 'employee', entityId: row!.id, entityCode: row!.code, summary: 'Đăng nhập thành công', requestId: rid(input.requestId) } });
    });
    const me = await this.me(await this.sessions.lookup(sessionCookieFor(sessionToken)), row!);
    return { sessionToken, csrfToken, maxAgeSeconds: Math.min(abs.getTime() - now.getTime(), this.cfg.sessionIdleMinutes * 60_000) / 1000, me };
  }

  // Tăng đếm sai trong cửa sổ; đủ ngưỡng => khoá tạm (leo thang theo lock_level). CHECK ck_cred_window: failed_count > 0 cần window_started_at.
  private async recordFailure(employeeId: string, cred: { failedCount: number; windowStartedAt: Date | null; lockLevel: number }, now: Date, requestId?: string): Promise<void> {
    const windowMs = this.cfg.loginWindowMinutes * 60_000;
    const inWindow = cred.windowStartedAt !== null && now.getTime() - cred.windowStartedAt.getTime() < windowMs;
    const failed = (inWindow ? cred.failedCount : 0) + 1;
    const lock = failed >= this.cfg.lockAfterFailures;
    const level = lock ? Math.min(10, cred.lockLevel + 1) : cred.lockLevel;
    const lockedUntil = lock ? new Date(now.getTime() + this.cfg.lockMinutes * 60_000 * Math.pow(2, Math.max(0, level - 1))) : null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeCredential.update({ where: { employeeId }, data: lock
          ? { failedCount: 0, windowStartedAt: null, lockedUntil, lockLevel: level }
          : { failedCount: failed, windowStartedAt: inWindow ? cred.windowStartedAt! : now } });
        await tx.auditLog.create({ data: { actorType: 'ANONYMOUS', action: lock ? 'auth.login_locked' : 'auth.login_failed', entityType: 'employee', entityId: employeeId, summary: lock ? 'Khoá tạm sau nhiều lần sai' : 'Đăng nhập sai', requestId: rid(requestId) } });
      });
    } catch (e) {
      this.log.warn('Không ghi được lần đăng nhập sai: ' + (e instanceof Error ? e.message : 'lỗi'));
    }
  }

  async logout(s: ResolvedSession, requestId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({ where: { id: s.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } });
      await tx.auditLog.create({ data: { actorType: 'USER', actorId: s.actor.employeeId, action: 'auth.logout', entityType: 'employee', entityId: s.actor.employeeId, summary: 'Đăng xuất', requestId: rid(requestId) } });
    });
  }

  async me(s: ResolvedSession | null, emp?: { id: string; code: string; fullName: string; departmentId: string | null; credential: { mustChangePassword: boolean } | null }): Promise<MeView> {
    if (!s) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    const e = emp ?? await this.prisma.employee.findUniqueOrThrow({ where: { id: s.actor.employeeId }, select: { id: true, code: true, fullName: true, departmentId: true, credential: { select: { mustChangePassword: true } } } });
    return { employeeId: e.id, code: e.code, fullName: e.fullName, departmentId: e.departmentId, roles: s.roles, permissions: { ...s.scopes } as Record<string, string>, mustChangePassword: e.credential?.mustChangePassword ?? false };
  }
}

const rid = (r?: string): string | null => (typeof r === 'string' && r.length > 0 ? r.slice(0, 64) : null);
const sessionCookieFor = (token: string): string => SESSION_COOKIE_NAME + '=' + token;
// Chỉ lưu tiền tố IP (IPv4 /24, IPv6 /48) để nhận diện phiên bất thường mà không lưu địa chỉ đầy đủ.
function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::/48';
  return null;
}
