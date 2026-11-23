import type { Actor, Permission, Scope } from '../../common/auth/actor';
import type { EmployeeAccess } from '../../common/auth/scope-merge';
import { HANDOVER_CANDIDATES_MAX, OpportunityAutoTasks } from '../activities/activities.opportunity-tasks';
import { ActivitiesService } from '../activities/activities.service';
import { OpportunityChoicesService, OWNER_CANDIDATES_MAX } from './opportunities.choices.service';

// T-09: danh sách ứng viên bị cắt ở 500 người KHÔNG còn cắt âm thầm — phản hồi luôn có truncated (true khi còn người đủ điều kiện bị bỏ ra ngoài).
// Kiểm bằng mock (dựng > 500 nhân viên trên DB thử chung sẽ làm lệch các bộ test khác); hành vi HTTP với danh sách nhỏ (truncated = false) ở int-spec.
const CAP = 500;
const actor: Actor = { employeeId: 'me', departmentId: 'd1' };
const ctx = { actor, requestId: 'r1' };
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'e' + String(i).padStart(4, '0'), code: 'NV-' + i, fullName: 'NV ' + String(i).padStart(4, '0'), department: { code: 'KD' } }));
const accessOf = (scopes: Partial<Record<Permission, Scope>>) => ({
  load: jest.fn(async (_db: unknown, ids: readonly string[]) => new Map<string, EmployeeAccess>(ids.map((id) => [id, { id, departmentId: 'd1', active: true, scopes }]))),
});

describe('T-09 — truncated trên các danh sách ứng viên', () => {
  it('hằng số giới hạn vẫn là 500', () => {
    expect([HANDOVER_CANDIDATES_MAX, OWNER_CANDIDATES_MAX]).toEqual([CAP, CAP]);
  });

  it('handover-candidates (OpportunityAutoTasks.handoverCandidates): > 500 người đủ điều kiện => 500 người đầu + truncated; ≤ 500 => truncated = false', async () => {
    const tasks = new OpportunityAutoTasks({ record: jest.fn() } as never, accessOf({ 'customer.read': 'ALL', 'activity.read': 'ALL' }) as never);
    const owner = { ownerId: 'x', ownerDepartmentId: 'd1' };
    const over = await tasks.handoverCandidates({ employee: { findMany: jest.fn().mockResolvedValue(people(CAP + 3)) } } as never, owner);
    expect([over.items.length, over.truncated]).toEqual([CAP, true]);
    expect(over.items[0]).toEqual({ id: 'e0000', code: 'NV-0', fullName: 'NV 0000', departmentCode: 'KD' });
    const fit = await tasks.handoverCandidates({ employee: { findMany: jest.fn().mockResolvedValue(people(CAP)) } } as never, owner);
    expect([fit.items.length, fit.truncated]).toEqual([CAP, false]);
  });

  it('handover-candidates: người KHÔNG đủ điều kiện không làm bật truncated (lọc trước rồi mới cắt)', async () => {
    const acc = { load: jest.fn(async (_db: unknown, ids: readonly string[]) => new Map<string, EmployeeAccess>(ids.map((id, i) => [id, { id, departmentId: 'd1', active: i < 10, scopes: { 'customer.read': 'ALL', 'activity.read': 'ALL' } }]))) };
    const tasks = new OpportunityAutoTasks({ record: jest.fn() } as never, acc as never);
    const r = await tasks.handoverCandidates({ employee: { findMany: jest.fn().mockResolvedValue(people(CAP + 50)) } } as never, { ownerId: 'x', ownerDepartmentId: 'd1' });
    expect([r.items.length, r.truncated]).toEqual([10, false]);
  });

  it('owner-candidates (OpportunityChoicesService.ownerCandidates): > 500 người nhận hợp lệ => 500 + truncated; danh sách nhỏ => truncated = false', async () => {
    const make = (n: number) => {
      const tx = { employee: { findMany: jest.fn().mockResolvedValue(people(n)) } };
      const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
      const scopes: Partial<Record<Permission, Scope>> = { 'opportunity.assign': 'ALL' };
      const actors = { scopeFor: (_a: Actor, p: Permission) => scopes[p] ?? null };
      const eligibility = { canSignIn: jest.fn(async (ids: readonly string[]) => new Map(ids.map((id) => [id, true]))) };
      const writes = { peekForWrite: jest.fn().mockResolvedValue({ ownerId: 'owner', customer: { ownerId: null, owner: null } }) };
      return new OpportunityChoicesService(prisma as never, actors as never, accessOf({ 'opportunity.read': 'OWN', 'opportunity.update': 'OWN' }) as never, eligibility as never, writes as never, {} as never);
    };
    const over = await make(CAP + 1).ownerCandidates(ctx, 'o1');
    expect([over.items.length, over.truncated]).toEqual([CAP, true]);
    const small = await make(3).ownerCandidates(ctx, 'o1');
    expect(small).toEqual({ items: people(3).map((p) => ({ id: p.id, code: p.code, fullName: p.fullName, departmentCode: 'KD' })), truncated: false });
  });

  it('assignee-candidates (ActivitiesService, nội bộ và external=true): > 500 => 500 + truncated; ≤ 500 => truncated = false', async () => {
    const make = (n: number, acc: ReturnType<typeof accessOf>) => {
      const customer = { findFirst: jest.fn().mockResolvedValue({ id: 'c1', code: 'KH-1', deletedAt: null, ownerId: 'me', owner: { departmentId: 'd1' } }) };
      const prisma = { customer, employee: { findMany: jest.fn().mockResolvedValue(people(n)) } };
      const scopes: Partial<Record<Permission, Scope>> = { 'activity.assign': 'ALL', 'activity.assign_external': 'ALL', 'customer.read': 'ALL' };
      const actors = { scopeFor: (_a: Actor, p: Permission) => scopes[p] ?? null };
      return new ActivitiesService(prisma as never, actors as never, { record: jest.fn() } as never, acc as never);
    };
    const readers = accessOf({ 'customer.read': 'ALL', 'activity.read': 'ALL' });
    const over = await make(CAP + 1, readers).assigneeCandidates(ctx, 'c1');
    expect([over.items.length, over.truncated]).toEqual([CAP, true]);
    expect((await make(2, readers).assigneeCandidates(ctx, 'c1')).truncated).toBe(false);
    const techs = accessOf({ 'activity.update_own': 'DEPARTMENT' }); // có thẩm quyền kỹ thuật, KHÔNG đọc được khách => ứng viên ngoài phạm vi
    const ext = await make(CAP + 1, techs).assigneeCandidates(ctx, 'c1', true);
    expect([ext.items.length, ext.truncated]).toEqual([CAP, true]);
    expect((await make(CAP, techs).assigneeCandidates(ctx, 'c1', true)).truncated).toBe(false);
  });
});
