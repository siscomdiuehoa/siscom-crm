import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sales S6 + S7: ghim tập route của module Cơ hội và các ràng buộc tĩnh của đường ĐỌC / GHI (docs/SALES_DESIGN.md §5.1 "không có đường đọc nào bỏ qua").
// PR241-R1-03: đây CHỈ là kiểm hồi quy HÌNH THỨC (bắt việc ai đó thêm truy vấn bỏ qua khuôn mẫu) — KHÔNG phải bằng chứng bảo mật độc lập.
// Bằng chứng hành vi: test/opportunities.int-spec.ts (ma trận quyền qua HTTP), test/opportunities.consistency.int-spec.ts (đọc nhất quán),
// test/opportunities.write.int-spec.ts (ghi: quyền, luật R-S, lịch sử, xung đột phiên bản).
const text = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const READ_FNS = ['async list(', 'async listByCustomer(', 'async detail(', 'async changes('];

describe('kiểm tra tĩnh module opportunities (S6 đọc + S7 ghi)', () => {
  const c = text('opportunities.controller.ts');
  const s = text('opportunities.service.ts');
  const w = text('opportunities.write.service.ts');
  const routes = (cls: string) => {
    const start = c.indexOf('export class ' + cls);
    const next = c.indexOf('export class', start + 1);
    const body = c.slice(start, next === -1 ? undefined : next);
    return [...body.matchAll(/@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/g)].map((m) => m[1] + '(' + m[2] + ')');
  };
  it('đúng tập route S6 + S7 + S8a; chưa có route của S8b (hold / win / lose / resume / reopen)', () => {
    expect(c).toMatch(/@Controller\('customers\/:customerId\/opportunities'\)/);
    expect(c).toMatch(/@Controller\('opportunities'\)/);
    expect(routes('CustomerOpportunitiesController')).toEqual(['Get()']);
    expect(routes('OpportunitiesController')).toEqual(['Get()', 'Post()', "Get(':id')", "Patch(':id')", "Get(':id/changes')", "Post(':id/stage')", "Post(':id/assign')", "Post(':id/restore')", "Delete(':id')"]);
    expect(c).not.toMatch(/@Put\(/);
    expect(c).not.toMatch(/':id\/(hold|win|lose|resume|reopen)'/);
  });
  it('mọi controller đều sau ActorGuard', () => {
    expect((c.match(/@Controller\(/g) ?? []).length).toBe(2);
    expect((c.match(/@UseGuards\(ActorGuard\)/g) ?? []).length).toBe(2);
  });
  it('service ĐỌC không ghi bảng nào và không dùng SQL thô (ghi nằm ở opportunities.write.service.ts)', () => {
    expect(s).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(s).not.toMatch(/\$queryRaw|\$executeRaw/);
  });
  it('mọi truy vấn opportunity trong service đọc đều đi qua vị từ phạm vi (fullReadWhere / deletedListWhere)', () => {
    // Mỗi lần gọi *.opportunity.* phải dùng `where` dựng từ vị từ của opportunities.access.
    const calls = [...s.matchAll(/\.opportunity\.(findFirst|findMany|count|findUnique|findUniqueOrThrow|findFirstOrThrow)\(([^;]*);/g)];
    expect(calls.length).toBe(5);
    for (const m of calls) expect(m[2]).toMatch(/fullReadWhere\(actor, scopeOf\)|\bwhere\b[,} ]/);
    expect(s).not.toMatch(/opportunity\.(findUnique|findUniqueOrThrow|findFirstOrThrow)\(/);
    // `where` của danh sách được dựng với vị từ phạm vi ở phần tử ĐẦU.
    expect(s).toMatch(/const where: Prisma\.OpportunityWhereInput = \{ AND: \[p\.deletedOnly \? deletedListWhere\(actor, scopeOf\) : fullReadWhere\(actor, scopeOf\), \.\.\.p\.filters\] \};/);
    // Lịch sử thay đổi chỉ đọc SAU khi cơ hội qua vị từ phạm vi, trong cùng snapshot.
    const ch = s.slice(s.indexOf('async changes('));
    expect(ch.indexOf('fullReadWhere(actor, scopeOf)')).toBeGreaterThan(-1);
    expect(ch.indexOf('fullReadWhere(actor, scopeOf)')).toBeLessThan(ch.indexOf('tx.opportunityChange.findMany('));
  });
  it('PR241-R1-01/02: mọi truy vấn nghiệp vụ của đường đọc chạy trên tx của MỘT transaction REPEATABLE READ; không truy vấn nào đi thẳng qua this.prisma', () => {
    expect(s).not.toMatch(/this\.prisma\.(opportunity|opportunityChange|customer|contact|employee|lookupItem)\b/);
    expect((s.match(/this\.prisma\./g) ?? []).length).toBe(1); // chỉ this.prisma.$transaction trong snapshot()
    expect(s).toMatch(/this\.prisma\.\$transaction\(fn, \{ isolationLevel: Prisma\.TransactionIsolationLevel\.RepeatableRead/);
    for (const fn of READ_FNS) {
      const i = s.indexOf(fn);
      expect(s.slice(i, s.indexOf('\n  }\n', i))).toMatch(/return this\.snapshot\(/);
    }
    // Thẻ khách, người liên hệ và quyền hiệu lực của người phụ trách đều đọc qua tx.
    expect(s).toMatch(/await tx\.customer\.findFirst\(/);
    expect(s).toMatch(/await tx\.contact\.findFirst\(/);
    expect(s).toMatch(/this\.access\.load\(tx, ids\)/);
  });
  it('mọi hàm đọc công khai đều kiểm mã đọc trước khi truy vấn', () => {
    for (const fn of READ_FNS) {
      const i = s.indexOf(fn);
      expect(i).toBeGreaterThan(-1);
      const body = s.slice(i, i + 400);
      expect(body.indexOf('this.needAnyRead(scopeOf)')).toBeGreaterThan(-1);
      const q = body.search(/this\.snapshot\(|this\.prisma\./);
      if (q !== -1) expect(body.indexOf('this.needAnyRead(scopeOf)')).toBeLessThan(q);
    }
  });
  it('S7 — service GHI: thao tác trên cơ hội có sẵn đi qua loadForWrite (khoá khách rồi cơ hội, kiểm đúng mã); ghi theo version; mỗi lần ghi có nhật ký', () => {
    expect(w).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe/);
    expect(w).toMatch(/FROM customer WHERE id = \$\{id\}::uuid FOR SHARE/);
    expect(w).toMatch(/FROM opportunity WHERE id = \$\{id\}::uuid FOR UPDATE/);
    expect(w.indexOf('FOR SHARE`')).toBeLessThan(w.indexOf('FOR UPDATE`')); // thứ tự khoá: khách trước, cơ hội sau
    expect(w).toMatch(/this\.loadForWrite\(tx, actor, scopeOf, id, 'opportunity\.update'\)/);
    expect(w).toMatch(/this\.loadForWrite\(tx, actor, scopeOf, id, 'opportunity\.move_stage'\)/);
    // Trong loadForWrite: khoá xong mới đọc lại dòng và kiểm quyền.
    const lf = w.slice(w.indexOf('private async loadForWrite('), w.indexOf('// ───── POST /opportunities ─────'));
    expect(lf.indexOf('FOR UPDATE`')).toBeLessThan(lf.indexOf('assertWrite('));
    expect(lf.indexOf('this.lockCustomer(')).toBeLessThan(lf.indexOf('FOR UPDATE`'));
    // Mọi lệnh cập nhật cơ hội đều kèm điều kiện version; không có update() không điều kiện.
    expect([...w.matchAll(/tx\.opportunity\.updateMany\(\{\s*where: \{ id, version: row\.version[ ,]/g)].length).toBe(5);
    expect(w).not.toMatch(/tx\.opportunity\.update\(/);
    expect((w.match(/tx\.opportunity\.updateMany\(/g) ?? []).length).toBe(5);
    // Sáu thao tác ghi công khai (tạo, sửa, đổi giai đoạn, chuyển người, xoá mềm, khôi phục): mỗi thao tác một lần ghi nhật ký; luật R-S ở ba thao tác đổi trường.
    expect((w.match(/await this\.audit\.record\(tx, \{/g) ?? []).length).toBe(6);
    expect(w).toMatch(/this\.loadForWrite\(tx, actor, scopeOf, id, 'opportunity\.assign'\)/);
    expect(w).toMatch(/this\.loadForWrite\(tx, actor, scopeOf, id, 'opportunity\.delete'\)/);
    // Khôi phục: kiểm restore ALL TRƯỚC khi mở transaction / truy vấn (đường nạp riêng, §5.4). Người nhận kiểm bằng assertAssignee trước khi ghi.
    const rs = w.slice(w.indexOf('async restore('));
    expect(rs.indexOf('assertMayLoadDeleted(scopeOf)')).toBeGreaterThan(-1);
    expect(rs.indexOf('assertMayLoadDeleted(scopeOf)')).toBeLessThan(rs.indexOf('this.inTx('));
    expect(rs.indexOf('assertRestorable(scopeOf, row)')).toBeLessThan(rs.indexOf('tx.opportunity.updateMany('));
    const asg = w.slice(w.indexOf('async assign('), w.indexOf('async remove('));
    expect(asg.indexOf('assertAssignee(')).toBeLessThan(asg.indexOf('tx.opportunity.updateMany('));
    expect(asg).toContain('this.eligibility.canSignIn([dto.ownerId])');
    expect((w.match(/ruleViolations\(/g) ?? []).length).toBe(3);
    // Nhật ký chung không mang số liệu nghiệp vụ.
    for (const k of ['title', 'needSummary', 'projectName', 'offerScope', 'expectedAmountVnd', 'expectedCloseDate', 'probability']) expect(w).toContain('changes.' + k + ' = AUDIT_REDACTED_TEXT');
  });
});
