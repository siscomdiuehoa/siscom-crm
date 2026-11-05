import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { AuthPrismaService } from '../../../prisma/auth-prisma.service';
import { AUTH_CONFIG, AuthConfig } from '../auth.config';
import type { Actor, ActorProvider, Permission, Scope } from '../actor';
import { readSessionCookie, sha256Hex } from './session-token';
import { mergeScopes, ROLE_GRANTS_SELECT } from '../scope-merge';
// B3 A5: KNOWN/RANK chuyển sang scope-merge.ts (hàm thuần dùng chung với effectiveAccessOf). Giữ re-export để mã/test cũ không đổi import.
export { KNOWN } from '../scope-merge';

// Danh tính từ PHIÊN SERVER-SIDE (cookie siscom_sid -> auth_session). Nguồn duy nhất của actor; không đọc bất kỳ header danh tính nào.
// Fail-closed: thiếu/sai cookie, phiên thu hồi/hết hạn, nhân viên không ACTIVE/đã xoá mềm, credential không ACTIVE => null (401).
// Quyền: hợp của mọi vai trò (phạm vi rộng nhất thắng: ALL > DEPARTMENT > OWN); vai trò chưa is_confirmed không cấp quyền.
export interface ResolvedSession {
  readonly sessionId: string;
  readonly csrfHash: string;
  readonly actor: Actor;
  readonly roles: readonly string[];
  readonly scopes: Readonly<Partial<Record<Permission, Scope>>>;
  // B1.4 P2: credential.must_change_password tại thời điểm tra phiên (đọc DB mỗi request) — PasswordChangeRequiredGuard chặn API khác.
  readonly mustChangePassword: boolean;
}
export type SessionRequest = Request & { authSession?: ResolvedSession | null; requestId?: string };

const TOUCH_EVERY_MS = 60_000;

@Injectable()
export class SessionActorProvider implements ActorProvider {
  private readonly log = new Logger('Session');
  // Quyền gắn với đúng object Actor đã cấp (WeakMap: không rò rỉ, không tra cứu theo id => không thể giả Actor).
  private readonly perms = new WeakMap<Actor, Readonly<Partial<Record<Permission, Scope>>>>();

  // B1.4 P3c: tra phien bang POOL AUTH (siscom_auth) - pool nghiep vu khong doc duoc auth_session.
  constructor(private readonly prisma: AuthPrismaService, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {}

  async resolve(req: Request): Promise<Actor | null> {
    const r = req as SessionRequest;
    if (r.authSession !== undefined) return r.authSession?.actor ?? null; // đã tra trong cùng request (CsrfOriginGuard)
    const s = await this.lookup(req.headers.cookie);
    r.authSession = s;
    return s?.actor ?? null;
  }

  scopeFor(actor: Actor, permission: Permission): Scope | null {
    return this.perms.get(actor)?.[permission] ?? null;
  }

  // Tra phiên theo băm cookie; gia hạn idle (trượt) tối đa mỗi phút; không bao giờ trả về token/băm.
  async lookup(cookieHeader: unknown): Promise<ResolvedSession | null> {
    const token = readSessionCookie(cookieHeader);
    if (token === null) return null;
    const hash = sha256Hex(token);
    const now = new Date();
    const s = await this.prisma.authSession.findUnique({
      where: { refreshHash: hash },
      select: {
        id: true, employeeId: true, csrfHash: true, revokedAt: true, idleExpiresAt: true, absExpiresAt: true, lastUsedAt: true,
        employee: { select: { status: true, deletedAt: true, departmentId: true, credential: { select: { status: true, mustChangePassword: true } },
          roles: { select: ROLE_GRANTS_SELECT } } },
      },
    });
    if (!s || s.revokedAt !== null || s.idleExpiresAt <= now || s.absExpiresAt <= now) return null;
    const e = s.employee;
    if (e.status !== 'ACTIVE' || e.deletedAt !== null || e.credential?.status !== 'ACTIVE') return null;

    // B3 A5: cùng một hàm thuần với effectiveAccessOf (người khác) — hai nơi không thể lệch nhau.
    const { roles, scopes } = mergeScopes(e.roles);
    const actor: Actor = { employeeId: s.employeeId, departmentId: e.departmentId };
    this.perms.set(actor, scopes);

    if (now.getTime() - s.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
      const idle = new Date(now.getTime() + this.cfg.sessionIdleMinutes * 60_000);
      try {
        await this.prisma.authSession.update({ where: { id: s.id }, data: { lastUsedAt: now, idleExpiresAt: idle < s.absExpiresAt ? idle : s.absExpiresAt } });
      } catch (err) {
        // Không chặn request vì gia hạn thất bại (phiên vẫn hợp lệ tới idleExpiresAt cũ); chỉ ghi nhận.
        this.log.warn('Không gia hạn được phiên: ' + (err instanceof Error ? err.message : 'lỗi'));
      }
    }
    return { sessionId: s.id, csrfHash: s.csrfHash, actor, roles: Object.freeze([...roles]), scopes: this.perms.get(actor)!, mustChangePassword: e.credential.mustChangePassword === true };
  }
}
