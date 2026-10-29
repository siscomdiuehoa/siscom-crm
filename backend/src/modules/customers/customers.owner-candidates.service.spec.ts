import { Actor, Permission, Scope } from '../../common/auth/actor';
import { DomainException } from '../../common/errors/domain.exception';
import { UnverifiedLinksChecker } from './customers.deletion-guard';
import { CustomersService } from './customers.service';

// PR 7 (D15): CustomersService.ownerCandidates — phạm vi rộng nhất của create/update; không quyền => 403, không chạm DB.
const actor: Actor = { employeeId: 'e1', departmentId: 'd1' };
const ctx = { actor, requestId: 'r1' };
type Scopes = Partial<Record<Permission, Scope>>;
function build(scopes: Scopes) {
  const employee = { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'e1', code: 'NV-0001', fullName: 'A', department: { code: 'KD' } }]) };
  const prisma = { employee, customer: {}, lookupItem: {}, $transaction: jest.fn() };
  const actors = { resolve: jest.fn(), scopeFor: jest.fn((_a: Actor, p: Permission) => scopes[p] ?? null) };
  const svc = new CustomersService(prisma as never, actors as never, { record: jest.fn() } as never, new UnverifiedLinksChecker() as never);
  return { svc, employee, prisma };
}
async function err(p: Promise<unknown>): Promise<DomainException> {
  try { await p; } catch (e) { if (e instanceof DomainException) return e; throw e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}

describe('CustomersService.ownerCandidates', () => {
  it('không có customer.create lẫn customer.update -> 403, không truy vấn', async () => {
    const e = build({ 'customer.read': 'ALL', 'lookup.read': 'ALL' });
    expect((await err(e.svc.ownerCandidates(ctx))).code).toBe('FORBIDDEN');
    expect(e.employee.findMany).not.toHaveBeenCalled();
    expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('phạm vi rộng nhất: create=OWN + update=ALL -> ALL (mọi nhân viên ACTIVE); chỉ update=DEPARTMENT -> cùng phòng; chỉ create=OWN -> chính mình', async () => {
    const all = build({ 'customer.create': 'OWN', 'customer.update': 'ALL' });
    const r = await all.svc.ownerCandidates(ctx);
    expect(r).toEqual({ scope: 'ALL', items: [{ id: 'e1', code: 'NV-0001', fullName: 'A', departmentCode: 'KD' }] });
    expect(all.employee.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', deletedAt: null });
    const dept = build({ 'customer.update': 'DEPARTMENT' });
    expect((await dept.svc.ownerCandidates(ctx)).scope).toBe('DEPARTMENT');
    expect(dept.employee.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', deletedAt: null, departmentId: 'd1' });
    const own = build({ 'customer.create': 'OWN' });
    expect((await own.svc.ownerCandidates(ctx)).scope).toBe('OWN');
    expect(own.employee.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', deletedAt: null, id: 'e1' });
  });
});
