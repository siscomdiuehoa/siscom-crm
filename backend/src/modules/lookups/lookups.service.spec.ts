import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Actor, Permission, Scope } from '../../common/auth/actor';
import { DomainException } from '../../common/errors/domain.exception';
import { LookupsService } from './lookups.service';

const actor: Actor = { employeeId: 'e1', departmentId: null };
const ctx = { actor };
function build(scopes: Partial<Record<Permission, Scope>> = { 'lookup.read': 'ALL' }) {
  const lookupItem = { findMany: jest.fn().mockResolvedValue([]) };
  const svc = new LookupsService({ lookupItem } as never, { scopeFor: (_a: Actor, p: Permission) => scopes[p] ?? null } as never);
  return { svc, lookupItem };
}
async function err(p: Promise<unknown>): Promise<DomainException> {
  try { await p; } catch (e) { if (e instanceof DomainException) return e; throw e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}

describe('LookupsService', () => {
  it('thiếu quyền lookup.read -> 403 và không truy vấn', async () => {
    const e = build({});
    expect((await err(e.svc.list(ctx, { type: 'industry' }))).code).toBe('FORBIDDEN');
    expect(e.lookupItem.findMany).not.toHaveBeenCalled();
  });
  it('loại ngoài bảng trắng / quá nhiều -> 400', async () => {
    const e = build();
    expect((await err(e.svc.list(ctx, { type: 'employee' }))).code).toBe('VALIDATION_FAILED');
    expect((await err(e.svc.list(ctx, { type: 'industry,secret' }))).code).toBe('VALIDATION_FAILED');
    expect((await err(e.svc.list(ctx, { type: ',' }))).code).toBe('VALIDATION_FAILED');
    expect(e.lookupItem.findMany).not.toHaveBeenCalled();
  });
  it('chỉ mục đang hoạt động, thứ tự sortOrder rồi nhãn; gộp theo loại; loại rỗng vẫn có mảng rỗng; bỏ trùng', async () => {
    const e = build();
    e.lookupItem.findMany.mockResolvedValue([
      { type: 'customer_tier', code: 'VIP', labelVi: 'VIP', sortOrder: 10, isActive: true },
      { type: 'customer_tier', code: 'STD', labelVi: 'Thường', sortOrder: 20, isActive: true },
      { type: 'industry', code: 'IT', labelVi: 'CNTT', sortOrder: 1, isActive: true },
    ]);
    const r = await e.svc.list(ctx, { type: 'customer_tier,industry,source,industry' });
    const arg = e.lookupItem.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ type: { in: ['customer_tier', 'industry', 'source'] }, isActive: true });
    expect(arg.orderBy).toEqual([{ sortOrder: 'asc' }, { labelVi: 'asc' }]);
    expect(r.customer_tier.map((x) => x.code)).toEqual(['VIP', 'STD']);
    expect(r.industry).toHaveLength(1);
    expect(r.source).toEqual([]);
    expect(Object.keys(r).sort()).toEqual(['customer_tier', 'industry', 'source']);
  });
  it('không lộ id nội bộ / isSystem (select không chứa id, isSystem)', () => {
    const src = readFileSync(join(__dirname, 'lookups.service.ts'), 'utf8');
    const select = /select:\s*\{([^}]*)\}/.exec(src)?.[1] ?? '';
    expect(select).not.toMatch(/\bid\b|isSystem/);
    expect(select).toMatch(/type/);
  });
});
