import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException } from '../errors/domain.exception';
import { Actor, ActorProvider, Permission, Scope } from './actor';
import { AccessGuard } from './access.guard';
import { Public, RequirePermissions } from './permissions.decorator';

const actor: Actor = { employeeId: 'e1', departmentId: 'd1' };

// Mỗi lớp/handler giả mang đúng metadata mà decorator thật đặt ra.
function target(decorate: (h: () => void) => void, decorateClass?: (c: new () => unknown) => void) {
  class C { h() { return undefined; } }
  decorate(C.prototype.h);
  if (decorateClass) decorateClass(C);
  return C;
}
function ctxOf(C: new () => { h: () => void }, req: Record<string, unknown>): ExecutionContext {
  return { getHandler: () => C.prototype.h, getClass: () => C, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}
function makeGuard(provider: Partial<ActorProvider>) {
  const resolve = jest.fn(provider.resolve ?? (async () => actor));
  const scopeFor = jest.fn(provider.scopeFor ?? (() => 'ALL' as Scope));
  return { guard: new AccessGuard(new Reflector(), { resolve, scopeFor } as ActorProvider), resolve, scopeFor };
}
const expectDomain = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(DomainException);
  expect((e as DomainException).getStatus()).toBe(status);
  expect(JSON.stringify((e as DomainException).getResponse())).toContain(code);
};

describe('AccessGuard — fail-closed theo từng endpoint', () => {
  it('route KHÔNG khai báo gì => 403 và không gọi provider (không chạm danh tính)', async () => {
    const C = target(() => undefined);
    const { guard, resolve } = makeGuard({});
    await expectDomain(guard.canActivate(ctxOf(C, {})), 403, 'FORBIDDEN');
    expect(resolve).not.toHaveBeenCalled();
  });
  it('@Public() => cho qua, không gọi provider', async () => {
    const C = target((h) => Public()(h as never, 'h', { value: h } as never));
    const { guard, resolve } = makeGuard({});
    await expect(guard.canActivate(ctxOf(C, {}))).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('@Public() kèm @RequirePermissions() => 403 (mơ hồ bị từ chối)', async () => {
    const C = target((h) => { Public()(h as never, 'h', { value: h } as never); RequirePermissions('customer.read')(h as never, 'h', { value: h } as never); });
    await expectDomain(makeGuard({}).guard.canActivate(ctxOf(C, {})), 403, 'FORBIDDEN');
  });
  it('danh sách quyền rỗng (ép kiểu) => coi như chưa khai báo => 403', async () => {
    const C = target((h) => (RequirePermissions as unknown as (...p: string[]) => MethodDecorator)()(h as never, 'h', { value: h } as never));
    await expectDomain(makeGuard({}).guard.canActivate(ctxOf(C, {})), 403, 'FORBIDDEN');
  });
  it('chưa xác thực (provider trả null) => 401, không hỏi phạm vi', async () => {
    const C = target((h) => RequirePermissions('customer.read')(h as never, 'h', { value: h } as never));
    const { guard, scopeFor } = makeGuard({ resolve: async () => null });
    await expectDomain(guard.canActivate(ctxOf(C, {})), 401, 'UNAUTHENTICATED');
    expect(scopeFor).not.toHaveBeenCalled();
  });
  it('thiếu BẤT KỲ quyền nào trong danh sách (AND) => 403', async () => {
    const C = target((h) => RequirePermissions('customer.update', 'customer.read')(h as never, 'h', { value: h } as never));
    const granted = new Set<Permission>(['customer.read']);
    const { guard } = makeGuard({ scopeFor: (_a, p) => (granted.has(p) ? 'OWN' : null) });
    await expectDomain(guard.canActivate(ctxOf(C, {})), 403, 'FORBIDDEN');
  });
  it('đủ quyền => true và gắn actor lấy từ provider vào request', async () => {
    const C = target((h) => RequirePermissions('customer.read')(h as never, 'h', { value: h } as never));
    const req: Record<string, unknown> = {};
    await expect(makeGuard({ scopeFor: () => 'OWN' }).guard.canActivate(ctxOf(C, req))).resolves.toBe(true);
    expect(req.actor).toEqual(actor);
  });
  it('danh tính CHỈ từ provider: header/body/query giả mạo bị bỏ qua (guard không đọc chúng)', async () => {
    const C = target((h) => RequirePermissions('customer.read')(h as never, 'h', { value: h } as never));
    const req: Record<string, unknown> = {
      headers: { 'x-actor-id': 'admin', 'x-employee-id': 'admin' }, body: { actor: { employeeId: 'admin' }, employeeId: 'admin' }, query: { actorId: 'admin' }, actor: { employeeId: 'admin', departmentId: null },
    };
    await makeGuard({}).guard.canActivate(ctxOf(C, req));
    expect(req.actor).toEqual(actor); // actor có sẵn trong request cũng bị ghi đè bằng kết quả provider
  });
  it('provider ném lỗi => guard ném lỗi (không mặc định cho qua)', async () => {
    const C = target((h) => RequirePermissions('customer.read')(h as never, 'h', { value: h } as never));
    const { guard } = makeGuard({ resolve: async () => { throw new Error('boom'); } });
    await expect(guard.canActivate(ctxOf(C, {}))).rejects.toThrow('boom');
  });
  it('quyền khai báo ở cấp class có hiệu lực khi handler không khai báo', async () => {
    const C = target(() => undefined, (c) => RequirePermissions('lookup.read')(c));
    const { guard, scopeFor } = makeGuard({});
    await expect(guard.canActivate(ctxOf(C, {}))).resolves.toBe(true);
    expect(scopeFor).toHaveBeenCalledWith(actor, 'lookup.read');
  });
  it('scope ngoài ALL/DEPARTMENT/OWN (giá trị lạ) => 403, không gắn actor', async () => {
    const C = target((h) => RequirePermissions('customer.read')(h as never, 'h', { value: h } as never));
    for (const bad of ['ADMIN', '', true, 1]) {
      const req: Record<string, unknown> = {};
      await expectDomain(makeGuard({ scopeFor: () => bad as unknown as Scope }).guard.canActivate(ctxOf(C, req)), 403, 'FORBIDDEN');
      expect(req.actor).toBeUndefined();
    }
  });
  it('actor sai hình dạng (employeeId rỗng/thiếu/không phải chuỗi) => 401, không hỏi phạm vi', async () => {
    const C = target((h) => RequirePermissions('customer.read')(h as never, 'h', { value: h } as never));
    for (const bad of [{ employeeId: '', departmentId: null }, { departmentId: 'd1' }, { employeeId: 7 }]) {
      const { guard, scopeFor } = makeGuard({ resolve: async () => bad as unknown as Actor });
      await expectDomain(guard.canActivate(ctxOf(C, {})), 401, 'UNAUTHENTICATED');
      expect(scopeFor).not.toHaveBeenCalled();
    }
  });
  it('scopeFor ném lỗi => guard ném lỗi (không mặc định cho qua)', async () => {
    const C = target((h) => RequirePermissions('customer.read')(h as never, 'h', { value: h } as never));
    const { guard } = makeGuard({ scopeFor: () => { throw new Error('boom'); } });
    await expect(guard.canActivate(ctxOf(C, {}))).rejects.toThrow('boom');
  });
});
