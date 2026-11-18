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
  const l = text('opportunities.lifecycle.service.ts');
  const routes = (cls: string) => {
    const start = c.indexOf('export class ' + cls);
    const next = c.indexOf('export class', start + 1);
    const body = c.slice(start, next === -1 ? undefined : next);
    return [...body.matchAll(/@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/g)].map((m) => m[1] + '(' + m[2] + ')');
  };
  it('đúng tập route S6 + S7 + S8a + S8b + S9a + S9b', () => {
    expect(c).toMatch(/@Controller\('customers\/:customerId\/opportunities'\)/);
    expect(c).toMatch(/@Controller\('opportunities'\)/);
    expect(routes('CustomerOpportunitiesController')).toEqual(['Get()']);
    expect(routes('OpportunitiesController')).toEqual(['Get()', 'Post()', "Get(':id')", "Patch(':id')", "Get(':id/changes')", "Post(':id/stage')", "Post(':id/assign')", "Post(':id/restore')", "Post(':id/hold')", "Post(':id/resume')", "Post(':id/win')", "Post(':id/lose')", "Post(':id/reopen')", "Get(':id/activities')", "Post(':id/activities')", "Get(':id/documents')", "Post(':id/documents')", "Delete(':id/documents/:docId')", "Delete(':id')"]);
    expect(c).not.toMatch(/@Put\(/);
  });
  it('mọi controller đều sau ActorGuard', () => {
    expect((c.match(/@Controller\(/g) ?? []).length).toBe(2);
    expect((c.match(/@UseGuards\(ActorGuard\)/g) ?? []).length).toBe(2);
  });
  it('service ĐỌC không ghi bảng nào và không dùng SQL thô (ghi nằm ở opportunities.write.service.ts)', () => {
    expect(s).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(s).not.toMatch(/\$queryRaw|\$executeRaw/);
  });
  it('mọi truy vấn opportunity trong service đọc đều đi qua vị từ phạm vi (anyReadWhere = đầy đủ HOẶC theo việc / deletedListWhere)', () => {
    // Mỗi lần gọi *.opportunity.* phải dùng `where` dựng từ vị từ của opportunities.access.
    const calls = [...s.matchAll(/\.opportunity\.(findFirst|findMany|count|findUnique|findUniqueOrThrow|findFirstOrThrow)\(([^;]*);/g)];
    expect(calls.length).toBe(5);
    for (const m of calls) expect(m[2]).toMatch(/anyReadWhere\(actor, scopeOf, |\bwhere\b[,} ]/);
    // S9a: service đọc KHÔNG gọi thẳng fullReadWhere / taskPathWhere — chỉ qua anyReadWhere (một vị từ cho mọi đường đọc).
    expect(s).not.toMatch(/fullReadWhere\(|taskPathWhere\(/);
    expect(s).not.toMatch(/opportunity\.(findUnique|findUniqueOrThrow|findFirstOrThrow)\(/);
    // `where` của danh sách được dựng với vị từ phạm vi ở phần tử ĐẦU.
    expect(s).toMatch(/const where: Prisma\.OpportunityWhereInput = \{ AND: \[p\.deletedOnly \? deletedListWhere\(actor, scopeOf\) : anyReadWhere\(actor, scopeOf, now\), \.\.\.p\.filters\] \};/);
    // Lịch sử thay đổi chỉ đọc SAU khi cơ hội qua vị từ phạm vi, trong cùng snapshot.
    const ch = s.slice(s.indexOf('async changes('));
    expect(ch.indexOf('anyReadWhere(actor, scopeOf, ')).toBeGreaterThan(-1);
    expect(ch.indexOf('anyReadWhere(actor, scopeOf, ')).toBeLessThan(ch.indexOf('tx.opportunityChange.findMany('));
    // S9a: lịch sử CHỈ cho đường đầy đủ — kiểm readsFull TRƯỚC khi đọc opportunity_change.
    expect(ch.indexOf('if (!readsFull(actor, scopeOf, row)) throw opportunityErrors.forbidden(')).toBeGreaterThan(-1);
    expect(ch.indexOf('if (!readsFull(actor, scopeOf, row)) throw opportunityErrors.forbidden(')).toBeLessThan(ch.indexOf('tx.opportunityChange.findMany('));
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
    const lf = w.slice(w.indexOf('async loadForWrite('), w.indexOf('// ───── POST /opportunities ─────'));
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
  it('S9a — bản kỹ thuật (đường theo việc) không bao giờ mang giá trị / xác suất / hold / won / lost; đường theo việc không cho quyền ghi', () => {
    const m = text('opportunities.mapper.ts');
    const tech = m.slice(m.indexOf('export function toOpportunityTechListItem('));
    expect(tech.length).toBeGreaterThan(100);
    expect(tech).not.toMatch(/[aA]mount|[pP]robability|[hH]old|[wW]on|[lL]ost|closedAt|ownerLostAccess|[cC]ontact|[pP]hone|[aA]ddress|\.\.\.r\b/);
    expect(tech).toContain("access: 'TASK' as const");
    expect(tech).not.toMatch(/\bstatus\b|\bowner\b|emp\(/); // review R1 #245: bám danh sách trường §5.4 — không trạng thái, không người phụ trách
    // Chi tiết: chỉ đạt đường theo việc => trả bản kỹ thuật TRƯỚC khi đọc thẻ khách / liên hệ.
    const d = s.slice(s.indexOf('async detailIn('), s.indexOf('async changes('));
    expect(d.indexOf("if (path === 'TASK') return toOpportunityTechDetail(row);")).toBeGreaterThan(-1);
    expect(d.indexOf("if (path === 'TASK') return toOpportunityTechDetail(row);")).toBeLessThan(d.indexOf('tx.customer.findFirst('));
    // Vị từ đường theo việc: đủ mọi điều kiện của §5.5(d) và dùng ĐÚNG vị từ đọc của B3.
    const tp = text('opportunities.task-path.ts');
    expect(tp).toContain("activities: { some: { type: 'TASK', status: 'OPEN', deletedAt: null, performedById: actor.employeeId, OR: readable } }");
    expect(tp).toContain('scopeReadWhere(actor, scopeOf)');
    expect(tp).toContain('taskAccessWhere(actor, scopeOf, now)');
    expect(tp).toMatch(/if \(!hasAssignedReadCode\(scopeOf\)\) return NONE;/);
    // Đường ghi: đường theo việc chỉ đổi 404 thành 403 — quyền ghi vẫn do allowsWrite quyết định (opportunities.access).
    expect(w).toContain('assertWrite(actor, scopeOf, code, ref, await resolvePath(tx, actor, scopeOf, id, ref));');
    // Hoạt động theo cơ hội: lọc theo đường truy cập nằm TRONG where, trước count; tạo phải qua loadForWrite với đúng mã opportunity.update.
    const oa = text('opportunities.activities.service.ts');
    expect(oa.indexOf('and.push({ performedById: actor.employeeId, OR: readable });')).toBeGreaterThan(-1);
    expect(oa.indexOf('and.push({ performedById: actor.employeeId, OR: readable });')).toBeLessThan(oa.indexOf('tx.activity.count({ where })'));
    expect(oa).toContain("this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.update')");
    expect(oa.indexOf("this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.update')")).toBeLessThan(oa.indexOf('this.gate.createForOpportunity('));
    expect(oa).not.toMatch(/\$queryRaw|\$executeRaw|\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(\{/);
  });
  it('S9b — tài liệu cơ hội: xem theo đường truy cập (kind lọc TRONG where); thêm / xoá qua loadForWrite đúng mã; nhật ký không mang tên tệp / đường dẫn / lý do', () => {
    const d = text('opportunities.documents.service.ts');
    expect(d).toContain("const where: Prisma.OpportunityDocumentWhereInput = { opportunityId: id, deletedAt: null, ...(full ? {} : { kind: 'TECHNICAL' }) };");
    const ls = d.slice(d.indexOf('async list('), d.indexOf('async add('));
    expect(ls.indexOf('anyReadWhere(actor, scopeOf, ')).toBeGreaterThan(-1);
    expect(ls.indexOf('anyReadWhere(actor, scopeOf, ')).toBeLessThan(ls.indexOf('tx.opportunityDocument.findMany('));
    expect(ls.indexOf('const full = readsFull(actor, scopeOf, opp);')).toBeLessThan(ls.indexOf('tx.opportunityDocument.findMany('));
    for (const fn of ['async add(', 'async remove(']) {
      const body = d.slice(d.indexOf(fn));
      const load = body.indexOf("this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.update')");
      expect(load).toBeGreaterThan(-1);
      expect(load).toBeLessThan(body.search(/tx\.opportunityDocument\.(create|updateMany|count|findFirst)\(/));
    }
    expect(d).not.toMatch(/\$queryRaw|\$executeRaw|opportunityDocument\.(update|delete|deleteMany)\(/); // không sửa, không xoá cứng
    expect(d).toMatch(/where: \{ id: docId, opportunityId: id, deletedAt: null \}/); // tài liệu phải thuộc đúng cơ hội trên đường dẫn
    expect((d.match(/await this\.audit\.record\(tx, \{/g) ?? []).length).toBe(2);
    const changes = [...d.matchAll(/changes: (\{[^}]*\})/g)].map((m) => m[1]);
    expect(changes.length).toBe(2);
    for (const ch of changes) expect(ch).not.toMatch(/dto\.fileName|dto\.url|dto\.reason|: reason\b/);
  });
  it('S8b — service VÒNG ĐỜI: năm thao tác đều qua inTx + loadForWrite của đường ghi, kiểm đúng mã, ghi theo version, có nhật ký và không mang số liệu', () => {
    expect(l).not.toMatch(/\$queryRaw|\$executeRaw|this\.prisma\b|\$transaction/); // không tự mở transaction, không SQL thô
    expect(l).not.toMatch(/tx\.opportunity\.update\(/);
    expect((l.match(/tx\.opportunity\.updateMany\(/g) ?? []).length).toBe(1); // một chỗ ghi duy nhất (apply), kèm điều kiện version
    expect(l).toMatch(/tx\.opportunity\.updateMany\(\{ where: \{ id: row\.id, version: row\.version \}/);
    expect((l.match(/await this\.audit\.record\(tx, \{/g) ?? []).length).toBe(1);
    const fns: Array<[string, string]> = [['hold', 'opportunity.close'], ['resume', 'opportunity.close'], ['win', 'opportunity.close'], ['lose', 'opportunity.close'], ['reopen', 'opportunity.reopen']];
    fns.forEach(([fn, code], i) => {
      const start = l.indexOf('  async ' + fn + '(');
      expect(start).toBeGreaterThan(-1);
      const end = i + 1 < fns.length ? l.indexOf('  async ' + fns[i + 1][0] + '(') : l.length;
      const body = l.slice(start, end);
      const load = body.indexOf("this.writes.loadForWrite(tx, actor, scopeOf, id, '" + code + "')");
      expect(body.indexOf('this.writes.inTx(')).toBeGreaterThan(-1);
      expect(load).toBeGreaterThan(body.indexOf('this.writes.inTx('));
      // Thứ tự: nạp + kiểm mã -> kiểm trạng thái nguồn -> kiểm version -> ghi (apply) -> việc tự sinh.
      expect(body.indexOf('opportunityErrors.state(')).toBeGreaterThan(load);
      expect(body.indexOf('row.version !== dto.version')).toBeGreaterThan(body.indexOf('opportunityErrors.state('));
      expect(body.indexOf('await this.apply(tx, ctx, row,')).toBeGreaterThan(body.indexOf('row.version !== dto.version'));
      expect(body.indexOf('await this.tasks.')).toBeGreaterThan(body.indexOf('await this.apply(tx, ctx, row,'));
      expect(body).toContain("'opportunity." + fn + "'"); // hành động nhật ký riêng của thao tác
    });
    // Trở về Đang mở (tiếp tục, mở lại) phải áp lại luật R-S.
    expect((l.match(/ruleViolations\(asOpen\(row\)\)/g) ?? []).length).toBe(2);
    // Nhật ký chung: không có giá trị chốt, số / ngày / đường dẫn chứng từ, ghi chú thua; lý do luôn được che.
    const changes = [...l.matchAll(/'opportunity\.(hold|resume|win|lose|reopen)',([^;]*)\);/g)].map((m) => m[2]);
    expect(changes.length).toBe(5);
    for (const ch of changes) {
      expect(ch).not.toMatch(/wonAmount|wonDoc|lostNote|holdReason|\bnote\b/);
      expect(ch).not.toMatch(/reason: (?!AUDIT_REDACTED_TEXT)/);
    }
    // Chuyển người phụ trách (S8a) kéo theo việc nhắc tạm hoãn trong cùng transaction.
    const asg = w.slice(w.indexOf('async assign('), w.indexOf('async remove('));
    expect(asg.indexOf('this.tasks.reassignReminder(')).toBeGreaterThan(asg.indexOf('tx.opportunity.updateMany('));
  });
});
