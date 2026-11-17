import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sales S6: ghim tập route của module Cơ hội và các ràng buộc tĩnh của đường ĐỌC (docs/SALES_DESIGN.md §5.1 "không có đường đọc nào bỏ qua").
const text = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('kiểm tra tĩnh module opportunities (S6 — chỉ đọc)', () => {
  const c = text('opportunities.controller.ts');
  const s = text('opportunities.service.ts');
  const routes = (cls: string) => {
    const start = c.indexOf('export class ' + cls);
    const next = c.indexOf('export class', start + 1);
    const body = c.slice(start, next === -1 ? undefined : next);
    return [...body.matchAll(/@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/g)].map((m) => m[1] + '(' + m[2] + ')');
  };
  it('đúng 3 route GET; chưa có route ghi nào (S7/S8)', () => {
    expect(c).toMatch(/@Controller\('customers\/:customerId\/opportunities'\)/);
    expect(c).toMatch(/@Controller\('opportunities'\)/);
    expect(routes('CustomerOpportunitiesController')).toEqual(['Get()']);
    expect(routes('OpportunitiesController')).toEqual(['Get()', "Get(':id')"]);
    expect(c).not.toMatch(/@(Post|Patch|Put|Delete)\(/);
  });
  it('mọi controller đều sau ActorGuard', () => {
    expect((c.match(/@Controller\(/g) ?? []).length).toBe(2);
    expect((c.match(/@UseGuards\(ActorGuard\)/g) ?? []).length).toBe(2);
  });
  it('service không ghi bảng nào và không dùng SQL thô', () => {
    expect(s).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(s).not.toMatch(/\$queryRaw|\$executeRaw/);
  });
  it('mọi truy vấn opportunity trong service đều đi qua vị từ phạm vi (fullReadWhere / deletedListWhere)', () => {
    // Mỗi lần gọi *.opportunity.* phải dùng `where` dựng từ vị từ của opportunities.access.
    const calls = [...s.matchAll(/\.opportunity\.(findFirst|findMany|count|findUnique|findUniqueOrThrow|findFirstOrThrow)\(([^;]*);/g)];
    expect(calls.length).toBe(4);
    for (const m of calls) expect(m[2]).toMatch(/fullReadWhere\(actor, scopeOf\)|\bwhere\b[,} ]/);
    expect(s).not.toMatch(/opportunity\.(findUnique|findUniqueOrThrow|findFirstOrThrow)\(/);
    // `where` của danh sách được dựng với vị từ phạm vi ở phần tử ĐẦU.
    expect(s).toMatch(/const and: Prisma\.OpportunityWhereInput\[\] = \[deletedOnly \? deletedListWhere\(actor, scopeOf\) : fullReadWhere\(actor, scopeOf\)\];/);
  });
  it('mọi hàm công khai đều kiểm mã đọc trước khi truy vấn', () => {
    for (const fn of ['async list(', 'async listByCustomer(', 'async detail(']) {
      const i = s.indexOf(fn);
      expect(i).toBeGreaterThan(-1);
      const body = s.slice(i, i + 400);
      expect(body.indexOf('this.needAnyRead(scopeOf)')).toBeGreaterThan(-1);
      const q = body.search(/this\.prisma\./);
      if (q !== -1) expect(body.indexOf('this.needAnyRead(scopeOf)')).toBeLessThan(q);
    }
  });
});
