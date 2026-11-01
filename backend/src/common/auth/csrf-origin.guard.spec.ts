import type { ExecutionContext } from '@nestjs/common';
import type { AuthConfig } from './auth.config';
import { CsrfOriginGuard, OriginOnly } from './csrf-origin.guard';
import { DenyAllActorProvider } from './deny-all-actor.provider';
import { SessionActorProvider, SessionRequest } from './session/session-actor.provider';
import { newOpaqueToken, SESSION_COOKIE_NAME, sha256Hex } from './session/session-token';

const cfg: AuthConfig = { cookieSecure: true, allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'], sessionIdleMinutes: 60, sessionAbsHours: 12, loginWindowMinutes: 15, loginMaxPerSource: 30, loginMaxPerIdentifier: 5, lockMinutes: 15, lockAfterFailures: 5 };
const csrf = newOpaqueToken();
const token = newOpaqueToken();
const session = { sessionId: 's', csrfHash: sha256Hex(csrf), actor: { employeeId: 'e', departmentId: null }, roles: [], scopes: {} };

function ctx(method: string, headers: Record<string, unknown>): { ec: ExecutionContext; req: SessionRequest } {
  const req = { method, headers } as unknown as SessionRequest;
  return { ec: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext, req };
}
function provider(found: boolean): SessionActorProvider {
  const p = Object.create(SessionActorProvider.prototype) as SessionActorProvider;
  (p as unknown as { lookup: () => Promise<unknown> }).lookup = jest.fn().mockResolvedValue(found ? session : null);
  return p;
}
const cookie = `${SESSION_COOKIE_NAME}=${token}`;
const expect403 = async (g: CsrfOriginGuard, c: ExecutionContext) => { await expect(g.canActivate(c)).rejects.toMatchObject({ code: 'CSRF_FAILED' }); };

describe('CsrfOriginGuard', () => {
  it('GET/HEAD/OPTIONS không bị kiểm, kể cả có cookie và không Origin', async () => {
    const g = new CsrfOriginGuard(provider(true), cfg);
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(await g.canActivate(ctx(m, { cookie }).ec)).toBe(true);
  });
  it('POST không cookie: cho qua nếu không có Origin (CLI); Origin có nhưng lạ => 403', async () => {
    const g = new CsrfOriginGuard(provider(false), cfg);
    expect(await g.canActivate(ctx('POST', {}).ec)).toBe(true);
    expect(await g.canActivate(ctx('POST', { origin: 'http://localhost:5173' }).ec)).toBe(true);
    await expect403(g, ctx('POST', { origin: 'http://evil.example' }).ec);
    await expect403(g, ctx('POST', { origin: 'null' }).ec);
  });
  it('POST có cookie: thiếu Origin / Origin lạ / thiếu CSRF / CSRF sai => 403; đủ và đúng => qua, phiên gắn vào req', async () => {
    const g = new CsrfOriginGuard(provider(true), cfg);
    await expect403(g, ctx('PATCH', { cookie }).ec);
    await expect403(g, ctx('DELETE', { cookie, origin: 'http://evil.example' }).ec);
    await expect403(g, ctx('POST', { cookie, origin: 'http://localhost:5173' }).ec);
    await expect403(g, ctx('POST', { cookie, origin: 'http://localhost:5173', 'x-csrf-token': newOpaqueToken() }).ec);
    const ok = ctx('POST', { cookie, origin: 'http://localhost:5173', 'x-csrf-token': csrf });
    expect(await g.canActivate(ok.ec)).toBe(true);
    expect(ok.req.authSession).toBe(session);
  });
  it('cookie có nhưng phiên không tồn tại => 403 (không để request ghi đi tiếp rồi 401 sau)', async () => {
    const g = new CsrfOriginGuard(provider(false), cfg);
    await expect403(g, ctx('POST', { cookie, origin: 'http://localhost:5173', 'x-csrf-token': csrf }).ec);
  });
  it('provider không phải SessionActorProvider (vd. giả trong test) mà có cookie phiên => 403 (fail-closed)', async () => {
    const g = new CsrfOriginGuard(new DenyAllActorProvider(), cfg);
    await expect403(g, ctx('POST', { cookie, origin: 'http://localhost:5173', 'x-csrf-token': csrf }).ec);
  });
});

// Issue #177 — route tái lập phiên từ token ghi nhớ (@OriginOnly): chưa có phiên nên không có CSRF-token phiên; thay bằng Origin BẮT BUỘC + header tuỳ biến.
describe('CsrfOriginGuard — @OriginOnly (restore Remember Me)', () => {
  class Ctl { @OriginOnly() restore(): void { /* marker */ } other(): void { /* marker */ } }
  const ctlCtx = (handler: 'restore' | 'other', method: string, headers: Record<string, unknown>) => {
    const req = { method, headers } as unknown as SessionRequest;
    return { ec: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => Ctl.prototype[handler] } as unknown as ExecutionContext, req };
  };
  const ok = { origin: 'http://localhost:5173', 'x-remember-restore': '1' };
  it('Origin hợp lệ + header đúng => qua, KHÔNG tra phiên', async () => {
    const p = provider(true);
    const g = new CsrfOriginGuard(p, cfg);
    expect(await g.canActivate(ctlCtx('restore', 'POST', ok).ec)).toBe(true);
    expect((p as unknown as { lookup: jest.Mock }).lookup).not.toHaveBeenCalled();
  });
  it('cookie phiên cũ/hết hạn còn sót KHÔNG chặn restore (khác nhánh thường cần X-CSRF-Token)', async () => {
    const g = new CsrfOriginGuard(provider(false), cfg);
    expect(await g.canActivate(ctlCtx('restore', 'POST', { ...ok, cookie }).ec)).toBe(true);
  });
  it('thiếu Origin / Origin lạ / "null" / thiếu header / header sai => 403 CSRF_FAILED', async () => {
    const g = new CsrfOriginGuard(provider(false), cfg);
    await expect403(g, ctlCtx('restore', 'POST', { 'x-remember-restore': '1' }).ec);
    await expect403(g, ctlCtx('restore', 'POST', { ...ok, origin: 'http://evil.example' }).ec);
    await expect403(g, ctlCtx('restore', 'POST', { ...ok, origin: 'null' }).ec);
    await expect403(g, ctlCtx('restore', 'POST', { origin: 'http://localhost:5173' }).ec);
    await expect403(g, ctlCtx('restore', 'POST', { ...ok, 'x-remember-restore': '0' }).ec);
  });
  it('route KHÔNG gắn @OriginOnly giữ nguyên hành vi cũ (có cookie phiên hỏng => 403)', async () => {
    const g = new CsrfOriginGuard(provider(false), cfg);
    await expect403(g, ctlCtx('other', 'POST', { ...ok, cookie }).ec);
  });
});
