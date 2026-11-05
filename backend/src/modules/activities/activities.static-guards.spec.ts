import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B3 A5: ghim tập route của module Hoạt động (thiết kế §6 "tập route của controller mới ghim trong static-guards").
const dir = __dirname;
const text = (f: string) => readFileSync(join(dir, f), 'utf8');

describe('kiểm tra tĩnh module activities (A5)', () => {
  const c = text('activities.controller.ts');
  const routes = (cls: string) => {
    const start = c.indexOf('export class ' + cls);
    const next = c.indexOf('export class', start + 1);
    const body = c.slice(start, next === -1 ? undefined : next);
    return [...body.matchAll(/@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/g)].map((m) => m[1] + '(' + m[2] + ')');
  };
  it('timeline + tạo: đúng GET và POST trên customers/:customerId/activities', () => {
    expect(c).toMatch(/@Controller\('customers\/:customerId\/activities'\)/);
    expect(routes('CustomerActivitiesController')).toEqual(['Get()', 'Post()']);
  });
  it("activities: A5 chỉ có GET 'assignee-candidates' (route ':id' thuộc A6, phải khai báo sau)", () => {
    expect(c).toMatch(/@Controller\('activities'\)/);
    expect(routes('ActivitiesController')).toEqual(["Get('assignee-candidates')"]);
  });
  it('mọi controller đều có @UseGuards(ActorGuard)', () => {
    expect((c.match(/@UseGuards\(ActorGuard\)/g) ?? []).length).toBe((c.match(/@Controller\(/g) ?? []).length);
  });
  it('module nối DbEmployeeAccess (nguồn quyền THẬT từ DB); không có nguồn giả trong src', () => {
    const m = text('activities.module.ts');
    expect(m).toMatch(/provide: EMPLOYEE_ACCESS, useClass: DbEmployeeAccess/);
    expect(m).toMatch(/imports: \[[^\]]*AuditModule/);
    expect(m).not.toMatch(/Test|Fake|Mock/);
  });
  it('service không dùng SQL thô không tham số hoá và không gán quyền người khác vào actor', () => {
    const s = text('activities.service.ts');
    expect(s).not.toMatch(/\$(query|execute)RawUnsafe/);
    expect(s).not.toMatch(/ctx\.actor\s*=|actor\s*=\s*\{[^}]*scopes/);
  });
});
