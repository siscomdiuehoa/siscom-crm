import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AUTH_CONFIG, AuthConfig } from '../../common/auth/auth.config';
import { Argon2PasswordHasher, ARGON2_ALGO, ARGON2_PARAMS } from '../../common/auth/login/argon2.hasher';
import { parseLoginIdentifier } from '../../common/auth/login/login-identifier';
import { ResolvedSession, SessionActorProvider } from '../../common/auth/session/session-actor.provider';
import { newOpaqueToken, SESSION_COOKIE_NAME, sha256Hex } from '../../common/auth/session/session-token';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthPrismaService } from '../../prisma/auth-prisma.service';
import { LoginLimiter } from './login-limiter';
import { checkPasswordPolicy } from '../../common/auth/login/password-policy';
import { ipPrefix } from './client-hints';
import { RememberDevices } from './remember-devices';

// remember: checkbox "Ghi nhớ đăng nhập trên thiết bị này" (mặc định false). previousRememberToken: cookie siscom_rmb đã có trên thiết bị (nếu có).
export interface LoginInput { login: string; password: string; source: string; ip: string | null; userAgent: string | null; requestId?: string; remember?: boolean; previousRememberToken?: string | null }
export interface RememberCookieGrant { token: string; maxAgeSeconds: number }
export interface RestoreInput { token: string | null; source: string; ip: string | null; userAgent: string | null; requestId?: string }
// ABSENT: không có cookie hợp lệ; INVALID: từ chối (xoá cookie); RACE: yêu cầu song song vừa rotate (giữ cookie, thử lại /auth/me).
export type RestoreOutcome = { kind: 'ABSENT' } | { kind: 'INVALID' } | { kind: 'RACE' } | ({ kind: 'OK'; remember: RememberCookieGrant } & Omit<LoginResult, 'remember'>);
// B1.3.3 (PR 8): đổi mật khẩu của chính mình — D16 hợp đồng, D18 A hạn mức, D19 thu hồi mọi phiên rồi cấp phiên mới.
export interface ChangePasswordInput { currentPassword: string; newPassword: string; confirmPassword: string; source: string; ip: string | null; userAgent: string | null; requestId?: string }
export interface LoginResult { sessionToken: string; csrfToken: string; maxAgeSeconds: number; me: MeView; remember?: RememberCookieGrant }
export interface MeView { employeeId: string; code: string; fullName: string; departmentId: string | null; roles: readonly string[]; permissions: Readonly<Record<string, string>>; mustChangePassword: boolean }

const LOGIN_FAILED = () => new DomainException(401, 'LOGIN_INVALID', 'Tên đăng nhập hoặc mật khẩu không đúng.');
const THROTTLED = () => new DomainException(429, 'LOGIN_THROTTLED', 'Quá nhiều lần thử, vui lòng thử lại sau.');
const PASSWORD_CURRENT_INVALID = () => new DomainException(400, 'PASSWORD_CURRENT_INVALID', 'Mật khẩu hiện tại không đúng.');
const PASSWORD_CHANGE_THROTTLED = () => new DomainException(429, 'PASSWORD_CHANGE_THROTTLED', 'Bạn đã thử quá nhiều lần, vui lòng thử lại sau.');
const VALIDATION = (details: string[]) => new DomainException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', details);
const PASSWORD_CHANGE_CONFLICT = () => new DomainException(409, 'PASSWORD_CHANGE_CONFLICT', 'Thông tin đăng nhập vừa thay đổi ở nơi khác. Vui lòng đăng nhập lại rồi thử lại.');
const CP_EMPLOYEE_FACTOR = 4; // F4: trần theo NHÂN VIÊN (mọi nguồn) = 4 x LOGIN_MAX_PER_IDENTIFIER, chặn xoay IP mà không để nguồn khác bị lây sớm

// Đăng nhập / đăng xuất / thông tin phiên. Mọi thất bại đăng nhập trả cùng 401 LOGIN_INVALID (không lộ tài khoản có tồn tại hay bị khoá).
// Nhật ký: auth.login_ok / auth.login_failed / auth.logout vào audit_log (không ghi mật khẩu, token, email thô).
@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  private readonly hasher = new Argon2PasswordHasher();
  private readonly limiter: LoginLimiter;
  private readonly cpLimiter: LoginLimiter; // D18 A: hạn mức đổi mật khẩu theo (nguồn + nhân viên), cùng cấu hình với đăng nhập, không khoá tài khoản
  private readonly cpEmployeeLimiter: LoginLimiter; // D18 A (F4): trần theo nhân viên bất kể nguồn
  private readonly restoreLimiter: LoginLimiter; // Issue #177: hạn mức tái lập phiên từ token ghi nhớ theo nguồn (chỉ tính khi có cookie đúng định dạng)
  readonly rememberDevices = new RememberDevices();

  // B1.4 P3c: moi truy van xac thuc di qua POOL AUTH (siscom_auth); pool nghiep vu khong con quyen. remember_device cung chi thuoc pool auth (V3).
  constructor(private readonly prisma: AuthPrismaService, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig, private readonly sessions: SessionActorProvider) {
    this.restoreLimiter = new LoginLimiter({ windowMs: cfg.loginWindowMinutes * 60_000, maxPerSource: cfg.loginMaxPerSource, maxPerIdentifier: cfg.loginMaxPerIdentifier });
    this.limiter = new LoginLimiter({ windowMs: cfg.loginWindowMinutes * 60_000, maxPerSource: cfg.loginMaxPerSource, maxPerIdentifier: cfg.loginMaxPerIdentifier });
    this.cpLimiter = new LoginLimiter({ windowMs: cfg.loginWindowMinutes * 60_000, maxPerSource: cfg.loginMaxPerSource, maxPerIdentifier: cfg.loginMaxPerIdentifier });
    this.cpEmployeeLimiter = new LoginLimiter({ windowMs: cfg.loginWindowMinutes * 60_000, maxPerSource: 1_000_000_000, maxPerIdentifier: cfg.loginMaxPerIdentifier * CP_EMPLOYEE_FACTOR });
  }

  // Dữ liệu một phiên mới (token đục 256-bit, DB chỉ lưu SHA-256). Dùng chung cho login và changePassword.
  private newSession(employeeId: string, now: Date, ip: string | null, userAgent: string | null) {
    const sessionToken = newOpaqueToken();
    const csrfToken = newOpaqueToken();
    const idle = new Date(now.getTime() + this.cfg.sessionIdleMinutes * 60_000);
    const abs = new Date(now.getTime() + this.cfg.sessionAbsHours * 3_600_000);
    const data = {
      employeeId, familyId: randomUUID(), refreshHash: sha256Hex(sessionToken), csrfHash: sha256Hex(csrfToken),
      issuedAt: now, lastUsedAt: now, idleExpiresAt: idle < abs ? idle : abs, absExpiresAt: abs,
      ipPrefix: ipPrefix(ip), uaShort: userAgent ? userAgent.slice(0, 200) : null,
    };
    const maxAgeSeconds = Math.min(abs.getTime() - now.getTime(), this.cfg.sessionIdleMinutes * 60_000) / 1000;
    return { sessionToken, csrfToken, data, maxAgeSeconds };
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
        credential: { select: { passwordHash: true, passwordAlgo: true, status: true, lockedUntil: true, failedCount: true, windowStartedAt: true, lockLevel: true, mustChangePassword: true, tokenVersion: true } } },
    });
    const cred = row?.credential ?? null;
    const usable = row !== null && row.status === 'ACTIVE' && cred !== null && cred.status === 'ACTIVE' && cred.passwordAlgo === ARGON2_ALGO
      && (cred.lockedUntil === null || cred.lockedUntil <= now);
    const ok = await this.hasher.verify(usable ? cred!.passwordHash : null, input.password);
    if (!usable || !ok) {
      if (row !== null && cred !== null) await this.recordFailure(row.id, cred, now, input.requestId);
      throw LOGIN_FAILED();
    }

    const ns = this.newSession(row!.id, now, input.ip, input.userAgent);
    const { sessionToken, csrfToken } = ns;
    // Issue #177: chỉ cấp token ghi nhớ khi người dùng CHỦ ĐỘNG tích (mặc định false) và không bị buộc đổi mật khẩu (token sẽ vô dụng: restore từ chối).
    const wantRemember = input.remember === true && !cred!.mustChangePassword;
    const remember = await this.prisma.$transaction(async (tx) => {
      await tx.employeeCredential.update({ where: { employeeId: row!.id }, data: { failedCount: 0, windowStartedAt: null, lockedUntil: null, lockLevel: 0, lastLoginAt: now } });
      await tx.authSession.create({ data: ns.data });
      await tx.auditLog.create({ data: { actorType: 'USER', actorId: row!.id, action: 'auth.login_ok', entityType: 'employee', entityId: row!.id, entityCode: row!.code, summary: 'Đăng nhập thành công', requestId: rid(input.requestId) } });
      // Thiết bị đã có cookie nhớ cũ: luôn thu hồi chuỗi cũ (đăng nhập lại bằng mật khẩu = thiết lập lại lựa chọn), rồi cấp mới nếu được tích.
      if (input.previousRememberToken) await this.rememberDevices.revokeByToken(tx, input.previousRememberToken, null, 'LOGIN_NO_REMEMBER', now);
      if (!wantRemember) return undefined;
      const g = await this.rememberDevices.issue(tx, { employeeId: row!.id, tokenVersion: cred!.tokenVersion, passwordAuthAt: now, now, ip: input.ip, userAgent: input.userAgent });
      await tx.auditLog.create({ data: { actorType: 'USER', actorId: row!.id, action: 'auth.remember_issued', entityType: 'employee', entityId: row!.id, entityCode: row!.code, summary: 'Bật ghi nhớ đăng nhập trên thiết bị', requestId: rid(input.requestId) } });
      return { token: g.token, maxAgeSeconds: g.maxAgeSeconds };
    });
    const me = await this.me(await this.sessions.lookup(sessionCookieFor(sessionToken)), row!);
    return { sessionToken, csrfToken, maxAgeSeconds: ns.maxAgeSeconds, me, ...(remember ? { remember } : {}) };
  }

  // Tái lập một phiên THƯỜNG (8h idle/12h abs) từ token ghi nhớ (Issue #177). Một transaction: compare-and-set rotated_at => kiểm tài khoản
  // => token con (cùng family, cùng mốc 90 ngày) + auth_session mới + nhật ký. Mọi kết quả từ chối được commit trước khi trả (thu hồi không bị rollback).
  async restoreRemembered(input: RestoreInput): Promise<RestoreOutcome> {
    if (input.token === null) return { kind: 'ABSENT' };
    if (!this.restoreLimiter.allow(input.source, null)) throw new DomainException(429, 'REMEMBER_THROTTLED', 'Quá nhiều lần thử, vui lòng thử lại sau.');
    const token = input.token;
    const now = new Date();
    const out = await this.prisma.$transaction(async (tx) => {
      const c = await this.rememberDevices.consume(tx, token, now);
      if (c.kind === 'REPLAY' && c.row) {
        await this.rememberDevices.revokeFamily(tx, c.row.familyId, 'REPLAY', now);
        await tx.auditLog.create({ data: { actorType: 'ANONYMOUS', action: 'auth.remember_replay', entityType: 'employee', entityId: c.row.employeeId, summary: 'Phát hiện dùng lại token ghi nhớ đã xoay vòng; thu hồi thiết bị', requestId: rid(input.requestId) } });
        return { kind: 'INVALID' as const };
      }
      if (c.kind !== 'OK') return { kind: (c.kind === 'RACE' ? 'RACE' : 'INVALID') as 'RACE' | 'INVALID' };
      const emp = await tx.employee.findUnique({
        where: { id: c.row.employeeId },
        select: { id: true, code: true, fullName: true, status: true, deletedAt: true, departmentId: true, credential: { select: { status: true, mustChangePassword: true, tokenVersion: true } } },
      });
      const cred = emp?.credential ?? null;
      // Fail-closed: không ACTIVE / đã xoá / bị buộc đổi mật khẩu / token_version đã đổi => thu hồi chuỗi, KHÔNG cấp phiên.
      if (!emp || emp.status !== 'ACTIVE' || emp.deletedAt !== null || cred === null || cred.status !== 'ACTIVE' || cred.mustChangePassword || cred.tokenVersion !== c.row.tokenVersion) {
        await this.rememberDevices.revokeFamily(tx, c.row.familyId, 'INVALID_STATE', now);
        return { kind: 'INVALID' as const };
      }
      const ns = this.newSession(emp.id, now, input.ip, input.userAgent);
      const next = await this.rememberDevices.rotate(tx, c.row, { now, ip: input.ip, userAgent: input.userAgent });
      await tx.authSession.create({ data: ns.data });
      await tx.auditLog.create({ data: { actorType: 'USER', actorId: emp.id, action: 'auth.remember_restored', entityType: 'employee', entityId: emp.id, entityCode: emp.code, summary: 'Khôi phục phiên từ thiết bị ghi nhớ', requestId: rid(input.requestId) } });
      return { kind: 'OK' as const, ns, next, emp };
    });
    if (out.kind !== 'OK') return { kind: out.kind };
    const { ns, next, emp } = out;
    const me = await this.me(await this.sessions.lookup(sessionCookieFor(ns.sessionToken)), { id: emp.id, code: emp.code, fullName: emp.fullName, departmentId: emp.departmentId, credential: { mustChangePassword: false } });
    return { kind: 'OK', sessionToken: ns.sessionToken, csrfToken: ns.csrfToken, maxAgeSeconds: ns.maxAgeSeconds, me, remember: { token: next.token, maxAgeSeconds: next.maxAgeSeconds } };
  }

  async listRememberDevices(s: ResolvedSession, currentToken: string | null) {
    return this.rememberDevices.list(this.prisma, s.actor.employeeId, currentToken, new Date());
  }

  // false => không có thiết bị đó của chính mình (controller trả 404, không phân biệt "của người khác" với "không tồn tại").
  async revokeRememberDevice(s: ResolvedSession, familyId: string, requestId?: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const ok = await this.rememberDevices.revokeOne(tx, s.actor.employeeId, familyId, 'REVOKED_BY_USER', new Date());
      if (ok) await tx.auditLog.create({ data: { actorType: 'USER', actorId: s.actor.employeeId, action: 'auth.remember_revoked', entityType: 'employee', entityId: s.actor.employeeId, summary: 'Thu hồi một thiết bị ghi nhớ', requestId: rid(requestId) } });
      return ok;
    });
  }

  async revokeAllRememberDevices(s: ResolvedSession, requestId?: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const n = await this.rememberDevices.revokeAll(tx, s.actor.employeeId, 'REVOKE_ALL', new Date());
      await tx.auditLog.create({ data: { actorType: 'USER', actorId: s.actor.employeeId, action: 'auth.remember_revoked', entityType: 'employee', entityId: s.actor.employeeId, summary: 'Thu hồi mọi thiết bị ghi nhớ', changes: { devices: n }, requestId: rid(requestId) } });
      return n;
    });
  }

  // Đổi mật khẩu của chính mình (B1.3.3). Thứ tự: hạn mức (D18 A: nguồn+nhân viên, và trần theo nhân viên) -> xác nhận khớp -> tải nhân viên/credential
  // -> chính sách (D17, có email/mã NV) -> so mật khẩu hiện tại (sai => nhật ký + 400, KHÔNG cộng vào bộ đếm khoá) -> mới ≠ hiện tại
  // -> transaction (D19): cột bí mật + token_version qua fn_auth_api_change_own_password của M1.2 (SECURITY DEFINER, khoá lạc quan token_version,
  // trigger DB thu hồi MỌI phiên + mã reset, audit PASSWORD_CHANGE), Prisma chỉ cập nhật cột không bí mật (bộ đếm khoá, password_changed_at),
  // phiên mới cho thiết bị này, nhật ký auth.password_changed {sessionsRevoked, tokenVersion}. Không ghi mật khẩu.
  async changePassword(s: ResolvedSession, input: ChangePasswordInput): Promise<LoginResult> {
    const employeeId = s.actor.employeeId;
    const okSource = this.cpLimiter.allow(input.source, 'cp:' + employeeId);
    const okEmployee = this.cpEmployeeLimiter.allow('employee', 'cp:' + employeeId);
    if (!okSource || !okEmployee) throw PASSWORD_CHANGE_THROTTLED();
    if (input.confirmPassword !== input.newPassword) throw VALIDATION(['Mật khẩu xác nhận không khớp']);
    const row = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, code: true, fullName: true, email: true, departmentId: true, status: true,
        credential: { select: { passwordHash: true, passwordAlgo: true, status: true, mustChangePassword: true, tokenVersion: true } } },
    });
    const problems = checkPasswordPolicy(input.newPassword, { email: row?.email ?? null, code: row?.code ?? null });
    if (problems.length) throw VALIDATION(problems);
    const cred = row?.credential ?? null;
    const usable = row !== null && row.status === 'ACTIVE' && cred !== null && cred.status === 'ACTIVE' && cred.passwordAlgo === ARGON2_ALGO;
    const ok = await this.hasher.verify(usable ? cred!.passwordHash : null, input.currentPassword);
    if (!usable || !ok) {
      await this.recordPasswordChangeFailure(employeeId, input.requestId);
      throw PASSWORD_CURRENT_INVALID();
    }
    if (await this.hasher.verify(cred!.passwordHash, input.newPassword)) throw VALIDATION(['Mật khẩu mới phải khác mật khẩu hiện tại']);
    const passwordHash = await this.hasher.hash(input.newPassword);
    const now = new Date();
    const ns = this.newSession(employeeId, now, input.ip, input.userAgent);
    let tokenVersion = -1;
    try {
      await this.prisma.$transaction(async (tx) => {
        const sessionsRevoked = await tx.authSession.count({ where: { employeeId, revokedAt: null } });
        // Cột bí mật + token_version: ứng dụng CHỈ đi qua hàm đặc quyền M1.2 (có audit). B1.4 P3b (APP_GRANTS_V2): siscom_app chỉ còn UPDATE
        // 7 cột đếm/khoá/thời điểm; password_hash/token_version không ghi trực tiếp được. S3 mới GIẢM THIỂU: hàm tin p_actor do ứng dụng truyền
        // (xem B1.4_P3B_APP_GRANTS_V2.md §7). Khoá lạc quan: token_version phải bằng giá trị vừa đọc; lệch => STALE_TOKEN_VERSION => 409.
        const r = await tx.$queryRaw<{ tv: number }[]>`SELECT public.fn_auth_api_change_own_password(${employeeId}::uuid, ${cred!.tokenVersion}, ${passwordHash}, ${ARGON2_ALGO}, ${JSON.stringify({ ...ARGON2_PARAMS })}::jsonb) AS tv`;
        tokenVersion = Number(r[0]?.tv ?? -1);
        await tx.employeeCredential.update({ where: { employeeId }, data: { failedCount: 0, windowStartedAt: null, lockedUntil: null, lockLevel: 0, passwordChangedAt: now } });
        await tx.authSession.create({ data: ns.data });
        await tx.auditLog.create({ data: { actorType: 'USER', actorId: employeeId, action: 'auth.password_changed', entityType: 'employee', entityId: employeeId, entityCode: row!.code, summary: 'Đổi mật khẩu; thu hồi các phiên cũ', changes: { sessionsRevoked, tokenVersion }, requestId: rid(input.requestId) } });
      });
    } catch (e) {
      if (isStaleTokenVersion(e)) throw PASSWORD_CHANGE_CONFLICT();
      throw e;
    }
    // F8: transaction đã commit (mật khẩu đổi, phiên cũ thu hồi). Tra cứu phiên mới thất bại thoáng qua => vẫn trả cookie mới với me từ phiên cũ
    // (vai trò/quyền không đổi trong transaction), tránh 500 sau khi đã đổi.
    const emp = { ...row!, credential: { mustChangePassword: false } };
    let me: MeView;
    try { me = await this.me(await this.sessions.lookup(sessionCookieFor(ns.sessionToken)), emp); }
    catch (e) { this.log.warn('Không tra cứu được phiên mới sau đổi mật khẩu: ' + (e instanceof Error ? e.message : 'lỗi')); me = await this.me(s, emp); }
    return { sessionToken: ns.sessionToken, csrfToken: ns.csrfToken, maxAgeSeconds: ns.maxAgeSeconds, me };
  }

  private async recordPasswordChangeFailure(employeeId: string, requestId?: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: { actorType: 'USER', actorId: employeeId, action: 'auth.password_change_failed', entityType: 'employee', entityId: employeeId, summary: 'Đổi mật khẩu thất bại (mật khẩu hiện tại sai)', requestId: rid(requestId) } });
    } catch (e) {
      this.log.warn('Không ghi được lần đổi mật khẩu sai: ' + (e instanceof Error ? e.message : 'lỗi'));
    }
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

  // Đăng xuất thiết bị hiện tại: hủy phiên VÀ chuỗi token ghi nhớ của thiết bị này (chỉ khi token thuộc đúng nhân viên đang đăng xuất).
  async logout(s: ResolvedSession, requestId?: string, rememberToken?: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.authSession.updateMany({ where: { id: s.sessionId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'LOGOUT' } });
      if (rememberToken) await this.rememberDevices.revokeByToken(tx, rememberToken, s.actor.employeeId, 'LOGOUT', now);
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
// Lỗi STALE_TOKEN_VERSION do fn_auth_api_change_own_password ném (ERRCODE check_violation 23514, thông điệp bắt đầu bằng STALE_TOKEN_VERSION).
function isStaleTokenVersion(e: unknown): boolean {
  const text = e instanceof Error ? e.message : '';
  const meta = (e as { meta?: { message?: unknown; code?: unknown } })?.meta;
  return /STALE_TOKEN_VERSION/.test(text) || /STALE_TOKEN_VERSION/.test(String(meta?.message ?? ''));
}
const sessionCookieFor = (token: string): string => SESSION_COOKIE_NAME + '=' + token;
