import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { AUTH_CONFIG, AuthConfig } from '../auth.config';
import type { Actor, ActorProvider, Permission, Scope } from '../actor';
import { readSessionCookie, sha256Hex } from './session-token';

// Danh tính từ PHIÊN SERVER-SIDE (cookie siscom_sid -> auth_session). Nguồn duy nhất của actor; không đọc bất kỳ header danh tính nào.
// Fail-closed: thiếu/sai cookie, phiên thu hồi/hết hạn, nhân viên không ACTIVE/đã xoá mềm, credential không ACTIVE => null (401).
// Quyền: hợp của mọi vai trò (phạm vi rộng nhất thắng: ALL > DEPARTMENT > OWN); vai trò chưa is_confirmed không cấp quyền.
export interface ResolvedSession {
  readonly sessionId: string;
  readonly csrfHash: string;
  readonly actor: Actor;
  readonly roles: readonly string[];
  readonly scopes: Readonly<Partial<Record<Permission, Scope>>>;
}
export type SessionRequest = Request & { authSession?: ResolvedSession | null; requestId?: string };

const RANK: Record<Scope, number> = { OWN: 1, DEPARTMENT: 2, ALL: 3 };
const SCOPES = new Set<string>(['ALL', 'DEPARTMENT', 'OWN']);
const KNOWN: ReadonlySet<string> = new Set<Permission>(['customer.read', 'customer.create', 'customer.update', 'customer.delete', 'customer.restore', 'contact.read', 'contact.create', 'lookup.read']);
const TOUCH_EVERY_MS = 60_000;

@Injectable()
export class SessionActorProvider implements ActorProvider {
  private readonly log = new Logger('Session');
  // Quyền gắn với đúng object Actor đã cấp (WeakMap: không rò rỉ, không tra cứu theo id => không thể giả Actor).
  private readonly perms = new WeakMap<Actor, Readonly<Partial<Record<Permission, Scope>>>>();

  constructor(private readonly prisma: PrismaService, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {}

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
        employee: { select: { status: true, deletedAt: true, departmentId: true, credential: { select: { status: true } },
          roles: { select: { role: { select: { code: true, isConfirmed: true, permissions: { select: { scope: true, permission: { select: { code: true } } } } } } } } } },
      },
    });
    if (!s || s.revokedAt !== null || s.idleExpiresAt <= now || s.absExpiresAt <= now) return null;
    const e = s.employee;
    if (e.status !== 'ACTIVE' || e.deletedAt !== null || e.credential?.status !== 'ACTIVE') return null;

    const scopes: Partial<Record<Permission, Scope>> = {};
    const roles: string[] = [];
    for (const er of e.roles) {
      if (!er.role.isConfirmed) continue;
      roles.push(er.role.code);
      for (const rp of er.role.permissions) {
        const code = rp.permission.code;
        const sc = String(rp.scope);
        if (!KNOWN.has(code) || !SCOPES.has(sc)) continue;
        const p = code as Permission; const next = sc as Scope; const cur = scopes[p];
        if (cur === undefined || RANK[next] > RANK[cur]) scopes[p] = next;
      }
    }
    const actor: Actor = { employeeId: s.employeeId, departmentId: e.departmentId };
    this.perms.set(actor, Object.freeze({ ...scopes }));

    if (now.getTime() - s.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
      const idle = new Date(now.getTime() + this.cfg.sessionIdleMinutes * 60_000);
      try {
        await this.prisma.authSession.update({ where: { id: s.id }, data: { lastUsedAt: now, idleExpiresAt: idle < s.absExpiresAt ? idle : s.absExpiresAt } });
      } catch (err) {
        // Không chặn request vì gia hạn thất bại (phiên vẫn hợp lệ tới idleExpiresAt cũ); chỉ ghi nhận.
        this.log.warn('Không gia hạn được phiên: ' + (err instanceof Error ? err.message : 'lỗi'));
      }
    }
    return { sessionId: s.id, csrfHash: s.csrfHash, actor, roles: Object.freeze(roles.sort()), scopes: this.perms.get(actor)! };
  }
}
