// Sales S8a — chuyển người phụ trách, xoá mềm, khôi phục (docs/SALES_DESIGN.md §5.4, §6.8, §6.9; TC 8, 9a(iv)–(vii), 9c) và
// MINOR-01 của review PR #242: nhật ký THẬT (DbAuditPort) cho mọi đường ghi + rollback NGUYÊN TỬ khi ghi nhật ký thất bại.
import type { INestApplication } from '@nestjs/common';
import { AUDIT_PORT, AuditEntry, AuditPort } from '../src/common/audit/audit.port';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ACCT, as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, makeEmployee, makeOpportunity, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let real: TestApp;
const a = (who: string, app: INestApplication = t.app) => as(app, who);
type Ref = { id: string; code: string };
let cA: Ref; let cB: Ref;
let techD = ''; let acctE = ''; let goneF = ''; let deptG = '';

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  real = await makeApp(prisma, fx, { realAudit: true });
  techD = (await makeEmployee({ fullName: 'S8 Kỹ thuật ' + uniq(), departmentId: fx.d1 })).id;
  acctE = (await makeEmployee({ fullName: 'S8 Kế toán ' + uniq(), departmentId: fx.d1 })).id;
  goneF = (await makeEmployee({ fullName: 'S8 Đã nghỉ ' + uniq(), departmentId: fx.d1, status: 'RESIGNED' })).id;
  deptG = (await makeEmployee({ fullName: 'S8 Phạm vi phòng ' + uniq(), departmentId: fx.d1 })).id;
  for (const x of [t, real]) {
    x.access.scopes.set(fx.empA, SALES); x.access.scopes.set(fx.empB, SALES); x.access.scopes.set(fx.empC, SALES);
    x.access.scopes.set(techD, TECH); x.access.scopes.set(acctE, ACCT); x.access.scopes.set(goneF, SALES);
    x.access.scopes.set(deptG, { 'opportunity.read': 'DEPARTMENT', 'opportunity.update': 'DEPARTMENT' });
  }
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA });
  cB = await makeCustomer(prisma, fx, { ownerId: fx.empB });
});
afterEach(() => { t.eligibility.blocked.clear(); });
afterAll(async () => { await t.app.close(); await real.app.close(); await prisma.$disconnect(); });

// Dùng giai đoạn THẬT "Tiếp cận" (mã PROSPECTING) để các lần sửa sau đó không vướng luật R-S2 của giai đoạn thử.
const opp = (ownerId: string, customerId = cA.id, extra: object = {}) => makeOpportunity(prisma, fx, { customerId, ownerId, title: 'S8 ' + uniq(), stage: 'PROSPECTING', ...extra });
const assign = (who: string, id: string, body: object, app: INestApplication = t.app) => a(who, app).post(O + '/' + id + '/assign', body);
const row = (id: string) => prisma.opportunity.findUniqueOrThrow({ where: { id } });
const ownerRows = (id: string) => prisma.opportunityChange.findMany({ where: { opportunityId: id, field: 'OWNER' }, orderBy: { changedAt: 'asc' } });

describe('POST /opportunities/:id/assign — chuyển người phụ trách (§6.8, TC 8)', () => {
  it('người phụ trách cơ hội chuyển cho người ACTIVE cùng phòng, đủ quyền: có lịch sử (người chuyển, cũ, mới, lý do); người phụ trách KHÁCH không đổi; người cũ hết quyền sửa, người mới sửa được', async () => {
    const o = await opp(fx.empA);
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: cA.id }, select: { ownerId: true, version: true } });
    const r = await assign('salesA', o.id, { version: 1, ownerId: fx.empB, reason: '  Bàn giao địa bàn  ' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ id: o.id, version: 2, owner: { id: fx.empB } }); // A vẫn đọc được vì phụ trách khách
    expect(await ownerRows(o.id)).toMatchObject([{ oldValue: fx.empA, newValue: fx.empB, reason: 'Bàn giao địa bàn', changedById: fx.empA }]);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: cA.id }, select: { ownerId: true, version: true } })).toEqual(before);
    expect((await a('salesA').patch(O + '/' + o.id, { version: 2, expectedAmountVnd: '1' })).status).toBe(403);
    expect((await a('salesB').patch(O + '/' + o.id, { version: 2, expectedAmountVnd: '1' })).status).toBe(200);
  });
  it('người chuyển không còn thấy cơ hội sau khi chuyển (không phụ trách khách) => phản hồi tối thiểu, không lộ chi tiết; sau đó 404', async () => {
    const o = await opp(fx.empB); // B phụ trách cơ hội ở khách của A
    const r = await assign('salesB', o.id, { version: 1, ownerId: fx.empA, reason: 'Trả lại người phụ trách khách' });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ id: o.id, code: o.code, version: 2, transferred: true });
    expect((await a('salesB').get(O + '/' + o.id)).status).toBe(404);
    expect((await a('salesA').get(O + '/' + o.id)).body.data.owner.id).toBe(fx.empA);
  });
  it('thiếu lý do / lý do trắng / người nhận chính là người đang phụ trách => 400; version cũ => 409; không ghi gì', async () => {
    const o = await opp(fx.empA);
    expect((await assign('salesA', o.id, { version: 1, ownerId: fx.empB })).status).toBe(400);
    expect((await assign('salesA', o.id, { version: 1, ownerId: fx.empB, reason: '   ' })).status).toBe(400);
    expect((await assign('salesA', o.id, { version: 1, ownerId: fx.empA, reason: 'x' })).status).toBe(400);
    const stale = await assign('salesA', o.id, { version: 9, ownerId: fx.empB, reason: 'x' });
    expect({ s: stale.status, code: stale.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_VERSION_CONFLICT' });
    expect(await row(o.id)).toMatchObject({ ownerId: fx.empA, version: 1 });
    expect(await ownerRows(o.id)).toEqual([]);
  });
  it('người nhận không đủ điều kiện => luôn 400 OPPORTUNITY_ASSIGNEE_INELIGIBLE (một mã cho mọi nguyên nhân), dữ liệu không đổi', async () => {
    const o = await opp(fx.empA);
    const cases: Array<[string, string, string]> = [
      ['khác phòng (Kinh doanh chuyển)', 'salesA', fx.empC], ['đã nghỉ việc', 'salesA', goneF], ['Kỹ thuật', 'salesA', techD], ['Kế toán (chỉ đọc)', 'salesA', acctE],
      ['không tồn tại', 'salesA', GHOST], ['read/update phạm vi DEPARTMENT', 'salesA', deptG],
      ['Kỹ thuật — Quản trị CRM chuyển', 'crmAdmin', techD], ['đã nghỉ — Quản trị CRM chuyển', 'crmAdmin', goneF], ['DEPARTMENT — Quản trị CRM chuyển', 'crmAdmin', deptG],
    ];
    for (const [name, who, to] of cases) {
      const r = await assign(who, o.id, { version: 1, ownerId: to, reason: 'thử' });
      expect({ name, s: r.status, code: r.body.error?.code }).toEqual({ name, s: 400, code: 'OPPORTUNITY_ASSIGNEE_INELIGIBLE' });
      expect(leaks(r.body)).toBe(false);
    }
    expect(await row(o.id)).toMatchObject({ ownerId: fx.empA, version: 1 });
  });
  it('TC 9a(vii): nhân viên ACTIVE, đủ vai trò nhưng tài khoản không dùng được (cổng auth trả false) => cùng mã lỗi; mở lại thì chuyển được', async () => {
    const o = await opp(fx.empA);
    t.eligibility.blocked.add(fx.empB);
    const r = await assign('salesA', o.id, { version: 1, ownerId: fx.empB, reason: 'thử' });
    expect({ s: r.status, code: r.body.error.code }).toEqual({ s: 400, code: 'OPPORTUNITY_ASSIGNEE_INELIGIBLE' });
    expect(JSON.stringify(r.body)).not.toMatch(/tài khoản|credential|khoá/i);
    t.eligibility.blocked.clear();
    expect((await assign('salesA', o.id, { version: 1, ownerId: fx.empB, reason: 'thử' })).status).toBe(201);
  });
  it('Quản trị CRM chuyển khác phòng được; chuyển cả cơ hội đã đóng (người phụ trách nghỉ việc)', async () => {
    const o = await opp(fx.empA);
    expect((await assign('crmAdmin', o.id, { version: 1, ownerId: fx.empC, reason: 'Điều chuyển' })).body.data.owner.id).toBe(fx.empC);
    const won = await opp(fx.empA, cA.id, { status: 'WON' });
    expect((await assign('crmAdmin', won.id, { version: 1, ownerId: fx.empB, reason: 'Người cũ nghỉ' })).status).toBe(201);
  });
  it('phân quyền người chuyển: người phụ trách khách không phụ trách cơ hội => 403; ngoài phạm vi => 404; Kế toán => 403; Kỹ thuật => 404; không có mã => 403', async () => {
    const o = await opp(fx.empB);
    const body = { version: 1, ownerId: fx.empA, reason: 'thử' };
    expect((await assign('salesA', o.id, body)).status).toBe(403);
    expect((await assign('salesC', o.id, body)).status).toBe(404);
    expect((await assign('acctA', o.id, body)).status).toBe(403);
    expect((await assign('techB', o.id, body)).status).toBe(404);
    expect((await assign('none', o.id, body)).status).toBe(403);
    expect((await as(t.app).post(O + '/' + o.id + '/assign', body)).status).toBe(401);
    expect(await row(o.id)).toMatchObject({ ownerId: fx.empB, version: 1 });
  });
});

describe('DELETE /opportunities/:id và POST /opportunities/:id/restore (§5.4, §6.9, TC 9c)', () => {
  const del = (who: string, id: string, body: object) => a(who).delete(O + '/' + id, body);
  const restore = (who: string, id: string, body: object) => a(who).post(O + '/' + id + '/restore', body);
  it('xoá mềm: chỉ Quản trị CRM, bắt buộc lý do; sau đó mọi đường thường trả 404 với MỌI vai trò, chỉ danh sách deleted=only của Quản trị CRM thấy', async () => {
    const o = await opp(fx.empA, cA.id, { status: 'ON_HOLD' });
    for (const who of ['salesA', 'acctA']) expect({ who, s: (await del(who, o.id, { version: 1, reason: 'x' })).status }).toEqual({ who, s: 403 });
    expect((await del('salesC', o.id, { version: 1, reason: 'x' })).status).toBe(404);
    expect((await del('crmAdmin', o.id, { version: 1 })).status).toBe(400);
    expect((await del('crmAdmin', o.id, { version: 1, reason: '  ' })).status).toBe(400);
    expect((await del('crmAdmin', o.id, { version: 5, reason: 'x' })).status).toBe(409);
    const n = t.audit.entries.length;
    const r = await del('crmAdmin', o.id, { version: 1, reason: 'Nhập trùng' });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: o.id, code: o.code, version: 2, deleted: true });
    expect(await row(o.id)).toMatchObject({ deleteReason: 'Nhập trùng', deletedById: fx.empC, status: 'ON_HOLD', version: 2 });
    expect(t.audit.entries.slice(n)).toMatchObject([{ action: 'opportunity.delete', entityId: o.id }]);
    expect(JSON.stringify(t.audit.entries.slice(n))).not.toContain('Nhập trùng');
    for (const who of ['crmAdmin', 'salesA', 'acctA']) {
      expect((await a(who).get(O + '/' + o.id)).status).toBe(404);
      expect((await a(who).get(O + '/' + o.id + '/changes')).status).toBe(404);
      expect((await a(who).patch(O + '/' + o.id, { version: 2, expectedAmountVnd: '1' })).status).toBe(404);
    }
    expect((await a('crmAdmin').post(O + '/' + o.id + '/assign', { version: 2, ownerId: fx.empB, reason: 'x' })).status).toBe(404);
    expect((await del('crmAdmin', o.id, { version: 2, reason: 'xoá lần hai' })).status).toBe(404);
    const listed = await a('crmAdmin').get(O + '?deleted=only&pageSize=100&customerId=' + cA.id);
    expect(listed.body.data.items.map((x: { id: string }) => x.id)).toContain(o.id);
  });
  it('khôi phục: người thiếu restore ALL nhận 404 giống hệt id không tồn tại; Quản trị CRM khôi phục => trạng thái như lúc xoá, version + 1, hiện lại ở mọi đường đọc', async () => {
    const o = await opp(fx.empA, cA.id, { status: 'ON_HOLD', amount: 5_000_000n });
    await del('crmAdmin', o.id, { version: 1, reason: 'Xoá để thử khôi phục' });
    for (const who of ['salesA', 'salesB', 'acctA', 'techB', 'none']) {
      const x = await restore(who, o.id, { version: 2 }); const g = await restore(who, GHOST, { version: 1 });
      expect({ who, s: x.status, code: x.body.error.code, same: x.body.error.message === g.body.error.message, gs: g.status }).toEqual({ who, s: 404, code: 'OPPORTUNITY_NOT_FOUND', same: true, gs: 404 });
    }
    expect((await restore('crmAdmin', o.id, { version: 1 })).status).toBe(409); // version cũ
    expect((await restore('crmAdmin', GHOST, { version: 1 })).status).toBe(404);
    const n = t.audit.entries.length;
    const r = await restore('crmAdmin', o.id, { version: 2 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ id: o.id, status: 'ON_HOLD', holdUntil: '2027-01-15', owner: { id: fx.empA }, expectedAmountVnd: '5000000', version: 3 });
    expect(await row(o.id)).toMatchObject({ deletedAt: null, deletedById: null, deleteReason: null });
    expect(t.audit.entries.slice(n)).toMatchObject([{ action: 'opportunity.restore', entityId: o.id, actorEmployeeId: fx.empC }]);
    expect((await a('salesA').get(O + '/' + o.id)).status).toBe(200);
    const again = await restore('crmAdmin', o.id, { version: 3 });
    expect({ s: again.status, code: again.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
    expect(await prisma.opportunityChange.count({ where: { opportunityId: o.id } })).toBe(0); // xoá/khôi phục ghi ở nhật ký, không ở lịch sử cơ hội
  });
  it('T-01: có opportunity.restore ALL nhưng KHÔNG đọc được cơ hội (không có opportunity.read, hoặc read OWN ngoài phạm vi) => 201, cơ hội THẬT SỰ được khôi phục (không rollback), phản hồi tối thiểu không có giá trị / xác suất', async () => {
    t.actors!.presets.oppRestoreOnly = { actor: { employeeId: fx.empB, departmentId: fx.d1 }, scopes: { 'opportunity.restore': 'ALL' } };
    t.actors!.presets.oppRestoreOwnRead = { actor: { employeeId: fx.empB, departmentId: fx.d1 }, scopes: { 'opportunity.restore': 'ALL', 'opportunity.read': 'OWN' } };
    for (const who of ['oppRestoreOnly', 'oppRestoreOwnRead']) {
      const o = await opp(fx.empA, cA.id, { amount: 7_000_000n, probability: 45 });
      await del('crmAdmin', o.id, { version: 1, reason: 'Xoá để thử khôi phục không có quyền đọc' });
      const n = t.audit.entries.length;
      const r = await restore(who, o.id, { version: 2 });
      expect({ who, s: r.status }).toEqual({ who, s: 201 });
      expect(r.body.data).toEqual({ id: o.id, code: o.code, version: 3, restored: true });
      expect(JSON.stringify(r.body)).not.toMatch(/7000000|probability|expectedAmount|owner/);
      expect(await row(o.id)).toMatchObject({ deletedAt: null, deletedById: null, deleteReason: null, version: 3 });
      expect(t.audit.entries.slice(n)).toMatchObject([{ action: 'opportunity.restore', entityId: o.id, actorEmployeeId: fx.empB }]);
      expect((await a(who).get(O + '/' + o.id)).status).not.toBe(200); // quyền khôi phục không mở quyền xem
      expect((await a('salesA').get(O + '/' + o.id)).status).toBe(200);
    }
  });
  it('khách còn bị xoá mềm => 409 OPPORTUNITY_CUSTOMER_DELETED, không ghi; khôi phục khách xong thì khôi phục cơ hội được; không tự khôi phục khách', async () => {
    const cust = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    const o = await opp(fx.empA, cust.id);
    await del('crmAdmin', o.id, { version: 1, reason: 'x' });
    await prisma.customer.update({ where: { id: cust.id }, data: { deletedAt: new Date(), deletedById: fx.empA } });
    const r = await restore('crmAdmin', o.id, { version: 2 });
    expect({ s: r.status, code: r.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_CUSTOMER_DELETED' });
    expect((await row(o.id)).deletedAt).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).deletedAt).not.toBeNull();
    await prisma.customer.update({ where: { id: cust.id }, data: { deletedAt: null, deletedById: null } });
    expect((await restore('crmAdmin', o.id, { version: 2 })).status).toBe(201);
  });
});

describe('MINOR-01 (review PR #242) — nhật ký THẬT và rollback nguyên tử', () => {
  const logs = (entityId: string) => prisma.auditLog.findMany({ where: { entityType: 'opportunity', entityId }, orderBy: { id: 'asc' }, select: { action: true, actorId: true, entityCode: true, summary: true, changes: true } });
  it('DbAuditPort thật nhận mọi bản ghi của 6 đường ghi (tạo, sửa, đổi giai đoạn, chuyển người, xoá, khôi phục); không chứa số liệu, tiêu đề, lý do', async () => {
    const title = 'S8 nhật ký thật ' + uniq();
    const created = await a('salesA', real.app).post(O, { customerId: cA.id, title, typeId: fx.oppType['SUPPLY'], needSummary: 'Nhu cầu bí mật ' + title });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await a('salesA', real.app).patch(O + '/' + id, { version: 1, expectedAmountVnd: '987654321', probability: 33, probabilityReason: 'Lý do riêng tư' })).status).toBe(200);
    expect((await a('salesA', real.app).post(O + '/' + id + '/stage', { version: 2, stageId: fx.oppStage['SURVEY'], probability: 'RESET' })).status).toBe(201);
    expect((await assign('salesA', id, { version: 3, ownerId: fx.empB, reason: 'Lý do chuyển kín' }, real.app)).status).toBe(201);
    expect((await a('crmAdmin', real.app).delete(O + '/' + id, { version: 4, reason: 'Lý do xoá kín' })).status).toBe(200);
    expect((await a('crmAdmin', real.app).post(O + '/' + id + '/restore', { version: 5 })).status).toBe(201);
    const rows = await logs(id);
    expect(rows.map((r) => r.action)).toEqual(['opportunity.create', 'opportunity.update', 'opportunity.move_stage', 'opportunity.assign', 'opportunity.delete', 'opportunity.restore']);
    expect(rows.map((r) => r.actorId)).toEqual([fx.empA, fx.empA, fx.empA, fx.empA, fx.empC, fx.empC]);
    expect(rows.every((r) => r.entityCode === created.body.data.code)).toBe(true);
    const dump = JSON.stringify(rows);
    for (const secret of [title, '987654321', 'Lý do riêng tư', 'Lý do chuyển kín', 'Lý do xoá kín', 'Nhu cầu bí mật']) expect(dump).not.toContain(secret);
    expect(rows[3].changes).toMatchObject({ ownerId: [fx.empA, fx.empB] });
    expect(rows[2].changes).toMatchObject({ stageCode: ['PROSPECTING', 'SURVEY'] });
  });

  // Phá hoại có chủ đích: cổng nhật ký THẬT ghi xong dòng audit rồi ném lỗi => toàn bộ transaction nghiệp vụ phải rollback.
  async function sabotaged<T>(fn: () => Promise<T>): Promise<T> {
    const port = real.app.get<AuditPort>(AUDIT_PORT);
    const orig = port.record.bind(port);
    port.record = async (tx: unknown, e: AuditEntry) => { await orig(tx, e); throw new Error('nhật ký hỏng sau khi ghi (thử)'); };
    try { return await fn(); } finally { port.record = orig; }
  }
  const snapshot = async (id: string) => ({ row: await row(id), changes: await prisma.opportunityChange.count({ where: { opportunityId: id } }), audit: await prisma.auditLog.count({ where: { entityType: 'opportunity', entityId: id } }) });

  it('ghi nhật ký thất bại SAU khi đã cập nhật cơ hội và ghi lịch sử => sửa / đổi giai đoạn / chuyển người / xoá mềm đều rollback hết: cơ hội, lịch sử, nhật ký không đổi', async () => {
    const o = await opp(fx.empA, cA.id, { needSummary: 'x', amount: 10n });
    const before = await snapshot(o.id);
    const calls: Array<[string, () => Promise<{ status: number; body: { message?: string; error?: { details?: unknown } } }>]> = [
      ['sửa', () => a('salesA', real.app).patch(O + '/' + o.id, { version: 1, expectedAmountVnd: '999', probability: 77, probabilityReason: 'thử' })],
      ['đổi giai đoạn', () => a('salesA', real.app).post(O + '/' + o.id + '/stage', { version: 1, stageId: fx.oppStage['QUOTATION'] })],
      ['chuyển người', () => assign('salesA', o.id, { version: 1, ownerId: fx.empB, reason: 'thử' }, real.app)],
      ['xoá mềm', () => a('crmAdmin', real.app).delete(O + '/' + o.id, { version: 1, reason: 'thử' })],
    ];
    for (const [name, call] of calls) {
      const r = await sabotaged(call);
      expect({ name, s: r.status }).toEqual({ name, s: 500 });
      expect(leaks(r.body)).toBe(false);
      expect({ name, after: await snapshot(o.id) }).toEqual({ name, after: before });
    }
    // Cổng nhật ký trở lại bình thường => cùng yêu cầu chạy được, đúng một bộ thay đổi.
    expect((await a('salesA', real.app).patch(O + '/' + o.id, { version: 1, expectedAmountVnd: '999' })).status).toBe(200);
    expect(await snapshot(o.id)).toMatchObject({ changes: 1, audit: 1, row: { version: 2 } });
  });
  it('ghi nhật ký thất bại khi TẠO => không có cơ hội nào được tạo; khi KHÔI PHỤC => cơ hội vẫn ở trạng thái đã xoá', async () => {
    const cust = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    const r = await sabotaged(() => a('salesA', real.app).post(O, { customerId: cust.id, title: 'S8 không được tạo ' + uniq(), typeId: fx.oppType['SUPPLY'] }));
    expect(r.status).toBe(500);
    expect(await prisma.opportunity.count({ where: { customerId: cust.id } })).toBe(0);
    const o = await opp(fx.empA, cust.id);
    expect((await a('crmAdmin', real.app).delete(O + '/' + o.id, { version: 1, reason: 'thử' })).status).toBe(200);
    const before = await snapshot(o.id);
    expect((await sabotaged(() => a('crmAdmin', real.app).post(O + '/' + o.id + '/restore', { version: 2 }))).status).toBe(500);
    expect(await snapshot(o.id)).toEqual(before);
    expect(before.row.deletedAt).not.toBeNull();
  });
});
