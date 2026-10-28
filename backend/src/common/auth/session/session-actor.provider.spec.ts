import type { Request } from 'express';
import type { AuthConfig } from '../auth.config';
import { SessionActorProvider } from './session-actor.provider';
import { newOpaqueToken, SESSION_COOKIE_NAME, sha256Hex } from './session-token';

// Đơn vị, không DB: prisma giả. Kiểm fail-closed và hợp quyền theo vai trò.
const cfg: AuthConfig = { cookieSecure: true, allowedOrigins: ['http://localhost:5173'], sessionIdleMinutes: 60, sessionAbsHours: 12, loginWindowMinutes: 15, loginMaxPerSource: 30, loginMaxPerIdentifier: 5, lockMinutes: 15, lockAfterFailures: 5 };
const future = new Date(Date.now() + 3_600_000);
const past = new Date(Date.now() - 1000);
const perm = (code: string, scope: string) => ({ scope, permission: { code } });
const role = (code: string, perms: Array<{ scope: string; permission: { code: string } }>, isConfirmed = true) => ({ role: { code, isConfirmed, permissions: perms } });

function makePrisma(session: Record<string, unknown> | null) {
  return {
    authSession: { findUnique: jest.fn().mockResolvedValue(session), update: jest.fn().mockResolvedValue({}) },
  } as unknown as ConstructorParameters<typeof SessionActorProvider>[0];
}
const base = (token: string, over: Record<string, unknown> = {}) => ({
  id: 's1', employeeId: 'e1', csrfHash: 'c'.repeat(64), revokedAt: null, idleExpiresAt: future, absExpiresAt: future, lastUsedAt: new Date(),
  employee: { status: 'ACTIVE', deletedAt: null, departmentId: 'd1', credential: { status: 'ACTIVE' }, roles: [role('sales', [perm('customer.read', 'OWN'), perm('lookup.read', 'ALL')])] },
  ...over,
});
const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} } as unknown as Request);

describe('SessionActorProvider', () => {
  const token = newOpaqueToken();
  const cookie = `${SESSION_COOKIE_NAME}=${token}`;

  it('cookie hợp lệ + phiên sống => actor + quyền; tra DB theo băm, không theo token', async () => {
    const prisma = makePrisma(base(token));
    const p = new SessionActorProvider(prisma, cfg);
    const actor = await p.resolve(req(cookie));
    expect(actor).toEqual({ employeeId: 'e1', departmentId: 'd1' });
    const call = (prisma.authSession.findUnique as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ refreshHash: sha256Hex(token) });
    expect(JSON.stringify(call)).not.toContain(token);
    expect(p.scopeFor(actor!, 'customer.read')).toBe('OWN');
    expect(p.scopeFor(actor!, 'customer.update')).toBeNull();
    expect(p.scopeFor({ employeeId: 'e1', departmentId: 'd1' }, 'customer.read')).toBeNull(); // actor giả cùng id => không có quyền
  });
  it('không cookie / cookie sai định dạng / không có phiên => null, không tra DB khi không có cookie', async () => {
    const prisma = makePrisma(null);
    const p = new SessionActorProvider(prisma, cfg);
    expect(await p.resolve(req())).toBeNull();
    expect(await p.resolve(req(`${SESSION_COOKIE_NAME}=abc`))).toBeNull();
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
    expect(await p.resolve(req(cookie))).toBeNull();
  });
  it.each([
    ['thu hồi', { revokedAt: past }],
    ['hết hạn idle', { idleExpiresAt: past }],
    ['hết hạn tuyệt đối', { absExpiresAt: past }],
    ['nhân viên nghỉ', { employee: { ...base(token).employee, status: 'RESIGNED' } }],
    ['nhân viên xoá mềm', { employee: { ...base(token).employee, deletedAt: past } }],
    ['credential DISABLED', { employee: { ...base(token).employee, credential: { status: 'DISABLED' } } }],
    ['không credential', { employee: { ...base(token).employee, credential: null } }],
  ])('fail-closed: %s => null', async (_n, over) => {
    const p = new SessionActorProvider(makePrisma(base(token, over)), cfg);
    expect(await p.resolve(req(cookie))).toBeNull();
  });
  it('hợp quyền nhiều vai trò: phạm vi rộng nhất thắng; vai trò chưa xác nhận và quyền lạ bị bỏ qua', async () => {
    const roles = [role('sales', [perm('customer.read', 'OWN'), perm('customer.update', 'OWN')]), role('accountant', [perm('customer.read', 'ALL'), perm('weird.perm', 'ALL'), perm('customer.update', 'BOGUS')]), role('x', [perm('customer.delete', 'ALL')], false)];
    const p = new SessionActorProvider(makePrisma(base(token, { employee: { ...base(token).employee, roles } })), cfg);
    const a = (await p.resolve(req(cookie)))!;
    expect(p.scopeFor(a, 'customer.read')).toBe('ALL');
    expect(p.scopeFor(a, 'customer.update')).toBe('OWN');
    expect(p.scopeFor(a, 'customer.delete')).toBeNull();
  });
  it('gia hạn idle tối đa mỗi phút và không vượt hạn tuyệt đối; lỗi gia hạn không chặn request', async () => {
    const abs = new Date(Date.now() + 10 * 60_000);
    const prisma = makePrisma(base(token, { lastUsedAt: new Date(Date.now() - 120_000), absExpiresAt: abs }));
    (prisma.authSession.update as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const p = new SessionActorProvider(prisma, cfg);
    expect(await p.resolve(req(cookie))).not.toBeNull();
    const data = (prisma.authSession.update as jest.Mock).mock.calls[0][0].data;
    expect(data.idleExpiresAt.getTime()).toBeLessThanOrEqual(abs.getTime());
    const fresh = makePrisma(base(token, { lastUsedAt: new Date() }));
    await new SessionActorProvider(fresh, cfg).resolve(req(cookie));
    expect(fresh.authSession.update).not.toHaveBeenCalled();
  });
  it('cùng request chỉ tra DB một lần (kết quả gắn vào req)', async () => {
    const prisma = makePrisma(base(token));
    const p = new SessionActorProvider(prisma, cfg);
    const r = req(cookie);
    await p.resolve(r); await p.resolve(r);
    expect(prisma.authSession.findUnique).toHaveBeenCalledTimes(1);
  });
});
