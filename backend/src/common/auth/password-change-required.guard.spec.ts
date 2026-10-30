import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainException } from '../errors/domain.exception';
import type { ActorProvider } from './actor';
import { ALLOW_PASSWORD_CHANGE_REQUIRED, AllowPasswordChangeRequired, PasswordChangeRequiredGuard } from './password-change-required.guard';
import { SessionActorProvider, type ResolvedSession, type SessionRequest } from './session/session-actor.provider';

// B1.4 P2: guard chặn mọi route khi must_change_password = true, trừ route được đánh dấu. Kiểm tra cả "không thể vượt qua":
// không có cách nào ngoài decorator để được miễn; cache phiên trong request được dùng lại (không tra DB lần hai).
const session = (mustChangePassword: boolean): ResolvedSession =>
  ({ sessionId: 's', csrfHash: 'h', actor: { employeeId: 'e', departmentId: null }, roles: [], scopes: {}, mustChangePassword }) as ResolvedSession;

function ctxOf(req: Partial<SessionRequest>, handlerMeta?: boolean, classMeta?: boolean): ExecutionContext {
  const handler = () => undefined; const cls = class {};
  if (handlerMeta !== undefined) Reflect.defineMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED, handlerMeta, handler);
  if (classMeta !== undefined) Reflect.defineMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED, classMeta, cls);
  return { getHandler: () => handler, getClass: () => cls, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}
// Provider phiên thật (instanceof) với lookup giả — không cần Prisma. Như provider thật: không có cookie => null (không tra DB).
function sessionProvider(result: ResolvedSession | null): { provider: SessionActorProvider; lookup: jest.Mock } {
  const provider = Object.create(SessionActorProvider.prototype) as SessionActorProvider;
  const lookup = jest.fn(async (cookie: unknown) => (typeof cookie === 'string' && cookie.length > 0 ? result : null));
  (provider as unknown as { lookup: jest.Mock }).lookup = lookup;
  return { provider, lookup };
}
const guard = (provider: ActorProvider) => new PasswordChangeRequiredGuard(new Reflector(), provider);
const req = (over: Partial<SessionRequest> = {}): Partial<SessionRequest> => ({ headers: { cookie: 'siscom_sid=x' }, ...over });

describe('PasswordChangeRequiredGuard (B1.4 P2)', () => {
  it('phiên có must_change_password = true => 403 PASSWORD_CHANGE_REQUIRED ở route không được miễn', async () => {
    const { provider } = sessionProvider(session(true));
    await expect(guard(provider).canActivate(ctxOf(req()))).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' } as Partial<DomainException>);
    const err = await guard(provider).canActivate(ctxOf(req())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException); expect((err as DomainException).getStatus()).toBe(403);
  });
  it('phiên có cờ nhưng handler hoặc class được @AllowPasswordChangeRequired => cho qua, không tra phiên', async () => {
    const { provider, lookup } = sessionProvider(session(true));
    await expect(guard(provider).canActivate(ctxOf(req(), true))).resolves.toBe(true);
    await expect(guard(provider).canActivate(ctxOf(req(), undefined, true))).resolves.toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('metadata false / giá trị khác true KHÔNG miễn (chỉ đúng decorator mới miễn)', async () => {
    const { provider } = sessionProvider(session(true));
    await expect(guard(provider).canActivate(ctxOf(req(), false))).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    await expect(guard(provider).canActivate(ctxOf(req(), 'yes' as unknown as boolean))).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });
  it('phiên không có cờ => cho qua; không có phiên (cookie sai/thiếu) => cho qua (ActorGuard quyết định 401)', async () => {
    await expect(guard(sessionProvider(session(false)).provider).canActivate(ctxOf(req()))).resolves.toBe(true);
    await expect(guard(sessionProvider(null).provider).canActivate(ctxOf(req()))).resolves.toBe(true);
    await expect(guard(sessionProvider(session(true)).provider).canActivate(ctxOf(req({ headers: {} })))).resolves.toBe(true);
  });
  it('dùng lại req.authSession đã tra bởi guard trước (CsrfOriginGuard): không gọi lookup; vẫn chặn nếu cờ bật', async () => {
    const { provider, lookup } = sessionProvider(session(false));
    await expect(guard(provider).canActivate(ctxOf(req({ authSession: session(true) })))).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    await expect(guard(provider).canActivate(ctxOf(req({ authSession: null })))).resolves.toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('provider không phải SessionActorProvider (chỉ trong test) => không có cờ credential => cho qua', async () => {
    const other: ActorProvider = { resolve: async () => null, scopeFor: () => null };
    await expect(guard(other).canActivate(ctxOf(req()))).resolves.toBe(true);
  });
  it('decorator đặt đúng khoá metadata', () => {
    const h = () => undefined; AllowPasswordChangeRequired()(h);
    expect(Reflect.getMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED, h)).toBe(true);
  });
});

// Kiểm tra tĩnh "không thể vượt qua": chỉ đúng 3 handler của AuthController (me, logout, change-password) và HealthController được
// miễn; login KHÔNG được miễn (không có phiên nên không cần); guard được gắn toàn cục trong AuthModule, sau CsrfOriginGuard.
describe('tĩnh: phạm vi miễn trừ PASSWORD_CHANGE_REQUIRED', () => {
  const SRC = join(__dirname, '..', '..');
  const text = (p: string) => readFileSync(join(SRC, p), 'utf8');
  it('AuthController: đúng 3 route được miễn (me, logout, change-password), login không', () => {
    const c = text('modules/auth/auth.controller.ts');
    const blocks = c.split(/\n(?=\s*@(?:Get|Post)\()/).slice(1);
    const allowed = blocks.filter((b) => /@AllowPasswordChangeRequired\(\)/.test(b)).map((b) => /@(?:Get|Post)\('([^']*)'\)/.exec(b)![1]).sort();
    expect(allowed).toEqual(['change-password', 'logout', 'me']);
    expect(blocks.find((b) => /@Post\('login'\)/.test(b))).not.toMatch(/AllowPasswordChangeRequired/);
    expect(c).not.toMatch(/@AllowPasswordChangeRequired\(\)\s*\n\s*@Controller/);
  });
  it('ngoài AuthController chỉ HealthController được miễn; AuthModule gắn guard toàn cục sau CsrfOriginGuard', () => {
    const files = ['modules/customers/customers.controller.ts', 'modules/customers/contacts.controller.ts', 'modules/lookups/lookups.controller.ts'];
    for (const f of files) expect(text(f)).not.toMatch(/AllowPasswordChangeRequired/);
    expect(text('health/health.controller.ts')).toMatch(/@AllowPasswordChangeRequired\(\)\s*\n@Controller\('health'\)/);
    const m = text('common/auth/auth.module.ts');
    expect(m.indexOf('useClass: CsrfOriginGuard')).toBeGreaterThan(-1);
    expect(m.indexOf('useClass: PasswordChangeRequiredGuard')).toBeGreaterThan(m.indexOf('useClass: CsrfOriginGuard'));
  });
});
