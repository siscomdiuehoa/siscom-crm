import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B3 A5/A6: ghim tập route của module Hoạt động (thiết kế §6 "tập route của controller mới ghim trong static-guards").
const dir = __dirname;
const text = (f: string) => readFileSync(join(dir, f), 'utf8');

describe('kiểm tra tĩnh module activities (A5 + A6)', () => {
  const c = text('activities.controller.ts');
  const routes = (cls: string) => {
    const start = c.indexOf('export class ' + cls);
    const next = c.indexOf('export class', start + 1);
    const body = c.slice(start, next === -1 ? undefined : next);
    return [...body.matchAll(/@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/g)].map((m) => m[1] + '(' + m[2] + ')');
  };
  it('timeline + tạo: đúng GET và POST trên customers/:customerId/activities (hợp đồng A5 không đổi)', () => {
    expect(c).toMatch(/@Controller\('customers\/:customerId\/activities'\)/);
    expect(routes('CustomerActivitiesController')).toEqual(['Get()', 'Post()']);
  });
  it("activities: đúng tập route A6; 'assignee-candidates' và 'reminders/summary' khai báo TRƯỚC mọi route ':id'", () => {
    expect(c).toMatch(/@Controller\('activities'\)/);
    const r = routes('ActivitiesController');
    expect(r).toEqual([
      "Get('assignee-candidates')", "Get('reminders/summary')", 'Get()',
      "Get(':id')", "Patch(':id')", "Delete(':id')", "Get(':id/history')", "Get(':id/work-card')",
      "Post(':id/assign')", "Post(':id/complete')", "Post(':id/reopen')", "Post(':id/access/revoke')", "Post(':id/transfer-requests')",
    ]);
    const firstParam = r.findIndex((x) => x.includes(':id'));
    expect(r.indexOf("Get('assignee-candidates')")).toBeLessThan(firstParam);
    expect(r.indexOf("Get('reminders/summary')")).toBeLessThan(firstParam);
  });
  it('activity-transfer-requests: hộp đến/đi + duyệt/từ chối/rút', () => {
    expect(c).toMatch(/@Controller\('activity-transfer-requests'\)/);
    expect(routes('ActivityTransferRequestsController')).toEqual(['Get()', "Post(':id/approve')", "Post(':id/reject')", "Post(':id/withdraw')"]);
  });
  it('mọi controller đều có @UseGuards(ActorGuard); mọi :id đều qua ParseUUIDPipe', () => {
    expect((c.match(/@UseGuards\(ActorGuard\)/g) ?? []).length).toBe((c.match(/@Controller\(/g) ?? []).length);
    expect((c.match(/@Param\('id'\)/g) ?? []).length).toBe(0);
  });
  it('module nối DbEmployeeAccess (nguồn quyền THẬT từ DB); không có nguồn giả trong src; chỉ export ACTIVITY_CUSTOMER_HOOKS', () => {
    const m = text('activities.module.ts');
    expect(m).toMatch(/provide: EMPLOYEE_ACCESS, useClass: DbEmployeeAccess/);
    expect(m).toMatch(/imports: \[[^\]]*AuditModule/);
    expect(m).toMatch(/exports: \[ACTIVITY_CUSTOMER_HOOKS\]/);
    expect(m).not.toMatch(/Test|Fake|Mock/);
  });
  it('service không dùng SQL thô không tham số hoá và không gán quyền người khác vào actor', () => {
    for (const f of ['activities.service.ts', 'activities.tasks.service.ts', 'activities.transfers.service.ts', 'activities.access.ts', 'activities.customer-hooks.ts']) {
      const s = text(f);
      expect(s).not.toMatch(/\$(query|execute)RawUnsafe/);
      expect(s).not.toMatch(/ctx\.actor\s*=|actor\s*=\s*\{[^}]*scopes/);
    }
  });
  it('§5.4: expires_at tính bằng SQL trong câu INSERT (không giờ Node); quyền theo việc không xuất hiện trong timeline', () => {
    const a = text('activities.access.ts');
    expect(a).toMatch(/least\(greatest\(a\.due_at, now\(\)\) \+ interval '168 hours', now\(\) \+ interval '720 hours'\)/);
    expect(a).toMatch(/rows\.length !== 1/);
    const svc = text('activities.service.ts');
    const timeline = svc.slice(svc.indexOf('async timeline('), svc.indexOf('async create('));
    expect(timeline.length).toBeGreaterThan(100);
    expect(timeline).not.toMatch(/activity_access|accesses|taskAccess|activityAccess/);
  });
  it('quyết định Owner #4: so thời hạn quyền theo việc bằng đồng hồ PostgreSQL (dbNow), không bằng giờ Node', () => {
    const a = text('activities.access.ts');
    expect(a).toMatch(/export async function dbNow\(/);
    const sweep = a.slice(a.indexOf('export async function sweepStaleAccess('));
    expect(sweep).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    for (const f of ['activities.service.ts', 'activities.tasks.service.ts', 'activities.transfers.service.ts']) {
      const s = text(f);
      expect(s).not.toMatch(/activeAccessRows\([^;]*new Date\(/);
      expect(s).not.toMatch(/taskAccessWhere\([^;]*new Date\(/);
      // Biến now truyền vào vị từ quyền phải lấy từ dbNow().
      for (const m of s.matchAll(/taskAccessWhere\(actor, s, (\w+)\)/g)) expect(s).toMatch(new RegExp('const ' + m[1] + ' = await dbNow\\('));
    }
  });
  it('khoá nhạy cảm của nhật ký: lý do thu hồi dùng revokeReason (không dùng khoá reason trần)', () => {
    for (const f of ['activities.access.ts', 'activities.customer-hooks.ts']) expect(text(f)).not.toMatch(/changes: \{[^}]*\breason: r\./);
  });
});
