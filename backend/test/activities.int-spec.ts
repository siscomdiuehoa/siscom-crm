// B3 A5 — API Hoạt động trên DB thử: timeline theo khách, tạo hoạt động, ứng viên người phụ trách (docs/B3_ACTIVITIES_DESIGN.md §5, §6).
// Ma trận vai trò (preset giống BIZ thật): salesA (OWN), techB/techC (DEPARTMENT, chỉ create_tech), acctA (chỉ đọc ALL), all (crm_admin ALL),
// readonly (đọc khách nhưng KHÔNG có activity.*), không header (agent/chưa xác thực => 401 — placeholder cho AI Agent L3, §14).
import type { PrismaService } from '../src/prisma/prisma.service';
import { AUDIT_REDACTED_TEXT } from '../src/common/audit/db-audit.port';
import { DbEmployeeAccess } from '../src/modules/activities/activities.employee-access';
import { as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, makeEmployee, uniq } from './helpers/fixtures';

const C = '/api/v1/customers/';
const CAND = '/api/v1/activities/assignee-candidates?customerId=';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who = 'all') => as(t.app, who);
const anon = () => as(t.app);
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
let cA: { id: string; code: string }; let cB: { id: string; code: string }; let cC: { id: string; code: string };

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  // Phạm vi của người được giao (theo vai trò thật): empA = sales, empB = kỹ thuật phòng 1, empC = kỹ thuật phòng 2.
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, TECH); t.access.scopes.set(fx.empC, TECH);
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA }); // phòng 1, chủ = A
  cB = await makeCustomer(prisma, fx, { ownerId: fx.empB }); // phòng 1, chủ = B
  cC = await makeCustomer(prisma, fx, { ownerId: fx.empC }); // phòng 2, chủ = C
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

const post = (who: string, customerId: string, body: object) => a(who).post(C + customerId + '/activities', body);
const list = (who: string, customerId: string, qs = '') => a(who).get(C + customerId + '/activities' + qs);

describe('xác thực và quyền cơ bản', () => {
  it('không xác thực (agent chưa có provider) => 401 cho GET/POST/ứng viên', async () => {
    expect((await anon().get(C + cA.id + '/activities')).status).toBe(401);
    expect((await anon().post(C + cA.id + '/activities', { type: 'NOTE', content: 'x' })).status).toBe(401);
    expect((await anon().get(CAND + cA.id)).status).toBe(401);
  });
  it('đọc được khách nhưng KHÔNG có activity.* => 403 (không lộ dữ liệu)', async () => {
    const g = await list('readonly', cA.id);
    expect(g.status).toBe(403);
    expect(g.body.error.code).toBe('FORBIDDEN');
    expect((await post('readonly', cA.id, { type: 'NOTE', content: 'x' })).status).toBe(403);
  });
  it('customerId không phải uuid => 400; khách không tồn tại => 404', async () => {
    expect((await list('all', 'abc')).status).toBe(400);
    expect((await list('all', '00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('POST tạo hoạt động', () => {
  it('sales tạo CALL trên khách CỦA MÌNH => 201 DONE, mã TT-, người phụ trách = mình; nhật ký che nội dung', async () => {
    t.audit.entries = [];
    const r = await post('salesA', cA.id, { type: 'CALL', content: 'Gọi tư vấn bí mật ' + uniq(), outcome: 'Hẹn gặp', title: 'Tư vấn' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ type: 'CALL', status: 'DONE', customerId: cA.id, performedBy: { id: fx.empA }, version: 1, dueAt: null, completedAt: null });
    expect(r.body.data.code).toMatch(/^TT-\d{6,}$/);
    const e = t.audit.entries.find((x) => x.action === 'activity.create')!;
    expect(e).toMatchObject({ entityType: 'activity', entityCode: r.body.data.code, actorEmployeeId: fx.empA });
    expect(e.changes).toMatchObject({ content: AUDIT_REDACTED_TEXT, outcome: AUDIT_REDACTED_TEXT, title: AUDIT_REDACTED_TEXT, type: [null, 'CALL'] });
    expect(JSON.stringify(e)).not.toContain('bí mật');
    expect(e.summary).not.toContain('Tư vấn');
    expect(t.audit.entries.filter((x) => x.action === 'activity.assign')).toEqual([]);
  });
  it('sales trên khách NGƯỜI KHÁC (ngoài OWN) => 404, không tạo gì', async () => {
    const before = await prisma.activity.count({ where: { customerId: cB.id } });
    expect((await post('salesA', cB.id, { type: 'CALL', content: 'x' })).status).toBe(404);
    expect(await prisma.activity.count({ where: { customerId: cB.id } })).toBe(before);
  });
  it('TASK: bắt buộc dueAt; không nhận occurredAt; remindAt > dueAt bị từ chối; hợp lệ => OPEN, occurredAt do máy chủ đặt', async () => {
    expect((await post('salesA', cA.id, { type: 'TASK', content: 'Việc' })).status).toBe(400);
    expect((await post('salesA', cA.id, { type: 'TASK', content: 'Việc', dueAt: inDays(2), occurredAt: inDays(-10) })).status).toBe(400);
    expect((await post('salesA', cA.id, { type: 'TASK', content: 'Việc', dueAt: inDays(2), remindAt: inDays(3) })).status).toBe(400);
    const before = Date.now();
    const r = await post('salesA', cA.id, { type: 'TASK', content: 'Khảo sát tuần sau', dueAt: inDays(2), remindAt: inDays(1) });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('OPEN');
    expect(new Date(r.body.data.occurredAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
  it('mốc thời gian phải có múi giờ; quá 1 ngày tương lai bị từ chối trừ MEETING', async () => {
    expect((await post('salesA', cA.id, { type: 'CALL', content: 'x', occurredAt: '2026-11-05T09:00:00' })).status).toBe(400);
    expect((await post('salesA', cA.id, { type: 'CALL', content: 'x', occurredAt: inDays(2) })).status).toBe(400);
    expect((await post('salesA', cA.id, { type: 'MEETING', content: 'Hẹn', occurredAt: inDays(5), dueAt: inDays(5) })).status).toBe(201);
  });
  it('DTO: loại lạ, nội dung rỗng, trường lạ (status, customerId) => 400', async () => {
    for (const b of [{ type: 'SMS', content: 'x' }, { type: 'NOTE', content: '   ' }, { type: 'NOTE', content: 'x', status: 'OPEN' }, { type: 'NOTE', content: 'x', customerId: cB.id }]) {
      expect((await post('all', cA.id, b)).status).toBe(400);
    }
  });
  it('kỹ thuật (create_tech DEPARTMENT): khảo sát/ghi chú/công việc trên khách CÙNG PHÒNG => 201; CALL => 403 ACTIVITY_TYPE_NOT_ALLOWED; khách phòng khác => 404', async () => {
    expect((await post('techB', cA.id, { type: 'SITE_SURVEY', content: 'Khảo sát mái' })).status).toBe(201);
    expect((await post('techB', cA.id, { type: 'NOTE', content: 'Ghi chú kỹ thuật' })).status).toBe(201);
    expect((await post('techB', cA.id, { type: 'TASK', content: 'Lắp đặt', dueAt: inDays(3) })).status).toBe(201);
    const r = await post('techB', cA.id, { type: 'CALL', content: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ACTIVITY_TYPE_NOT_ALLOWED');
    expect((await post('techB', cC.id, { type: 'NOTE', content: 'x' })).status).toBe(404);
  });
  it('kế toán (chỉ activity.read) => POST 403 FORBIDDEN', async () => {
    const r = await post('acctA', cA.id, { type: 'NOTE', content: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });
  it('khách đã xoá mềm => 409 CUSTOMER_DELETED', async () => {
    const d = await makeCustomer(prisma, fx, { ownerId: fx.empA, deleted: true });
    const r = await post('all', d.id, { type: 'NOTE', content: 'x' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CUSTOMER_DELETED');
  });
  it('người liên hệ phải thuộc ĐÚNG khách (kiểm ở service trước trigger DB) => 400 ACTIVITY_CONTACT_MISMATCH; đúng khách => trả contact', async () => {
    const other = await makeContact(prisma, cB.id, 'LH khách B ' + uniq());
    const mine = await makeContact(prisma, cA.id, 'LH khách A ' + uniq());
    const bad = await post('all', cA.id, { type: 'CALL', content: 'x', contactId: other.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('ACTIVITY_CONTACT_MISMATCH');
    const ok = await post('all', cA.id, { type: 'CALL', content: 'x', contactId: mine.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.contact).toMatchObject({ id: mine.id, code: mine.code });
  });
});

describe('giao việc ngay khi tạo (performedById ≠ người tạo)', () => {
  it('sales giao cho kỹ thuật CÙNG PHÒNG (đọc được khách) => 201 + thêm 1 dòng nhật ký activity.assign', async () => {
    t.audit.entries = [];
    const r = await post('salesA', cA.id, { type: 'TASK', content: 'Khảo sát', dueAt: inDays(2), performedById: fx.empB });
    expect(r.status).toBe(201);
    expect(r.body.data.performedBy.id).toBe(fx.empB);
    expect(t.audit.entries.map((x) => x.action)).toEqual(['activity.create', 'activity.assign']);
    expect(t.audit.entries[1].changes).toEqual({ performedById: [fx.empA, fx.empB] });
  });
  it('sales giao cho người PHÒNG KHÁC => 400 ACTIVITY_ASSIGNEE_INVALID (phạm vi giao OWN, không phải ALL)', async () => {
    const r = await post('salesA', cA.id, { type: 'TASK', content: 'x', dueAt: inDays(2), performedById: fx.empC });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('ACTIVITY_ASSIGNEE_INVALID');
  });
  it('crm_admin (giao ALL) giao cho kỹ thuật phòng khác KHÔNG đọc được khách => 400 ACTIVITY_ASSIGNEE_NO_ACCESS (không nới phạm vi)', async () => {
    const r = await post('all', cA.id, { type: 'TASK', content: 'x', dueAt: inDays(2), performedById: fx.empC });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('ACTIVITY_ASSIGNEE_NO_ACCESS');
    expect((await post('all', cC.id, { type: 'TASK', content: 'x', dueAt: inDays(2), performedById: fx.empC })).status).toBe(201);
  });
  it('kỹ thuật không có activity.assign => 403 khi giao cho người khác', async () => {
    expect((await post('techB', cA.id, { type: 'TASK', content: 'x', dueAt: inDays(2), performedById: fx.empA })).status).toBe(403);
  });
  it('người nhận không tồn tại / đã nghỉ việc => 400 ACTIVITY_ASSIGNEE_INVALID', async () => {
    const gone = await makeEmployee({ fullName: 'NV nghỉ ' + uniq(), departmentId: fx.d1, status: 'RESIGNED' });
    t.access.scopes.set(gone.id, TECH);
    for (const id of ['00000000-0000-4000-8000-000000000000', gone.id]) {
      const r = await post('all', cA.id, { type: 'TASK', content: 'x', dueAt: inDays(2), performedById: id });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('ACTIVITY_ASSIGNEE_INVALID');
    }
  });
});

describe('GET timeline', () => {
  let cT: { id: string };
  beforeAll(async () => {
    cT = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    const mk = (type: 'CALL' | 'NOTE' | 'TASK', occurredAt: string, extra: object = {}) => prisma.activity.create({ data: { customerId: cT.id, type, content: 'tl ' + type, occurredAt: new Date(occurredAt), isDemo: true, ...extra } });
    await mk('CALL', '2026-10-31T16:59:00Z');                 // 23:59 VN 31/10
    await mk('NOTE', '2026-10-31T17:00:00Z');                 // 00:00 VN 01/11
    await mk('TASK', '2026-11-02T03:00:00Z', { status: 'OPEN', dueAt: new Date('2026-11-20T03:00:00Z') });
    const del = await mk('CALL', '2026-11-03T03:00:00Z');
    await prisma.activity.update({ where: { id: del.id }, data: { deletedAt: new Date(), deletedById: fx.empA } });
  });
  it('chỉ hoạt động CHƯA xoá của đúng khách; mới nhất trước; phân trang', async () => {
    const r = await list('all', cT.id);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    expect(r.body.data.items.map((i: { type: string }) => i.type)).toEqual(['TASK', 'NOTE', 'CALL']);
    const p = await list('all', cT.id, '?pageSize=2&page=2');
    expect(p.body.data.items).toHaveLength(1);
  });
  it('lọc type/status; from/to theo NGÀY VN (biên 23:59 / 00:00)', async () => {
    expect((await list('all', cT.id, '?type=TASK')).body.data.total).toBe(1);
    expect((await list('all', cT.id, '?status=DONE')).body.data.total).toBe(2);
    const nov1 = await list('all', cT.id, '?from=2026-11-01&to=2026-11-01');
    expect(nov1.body.data.items.map((i: { type: string }) => i.type)).toEqual(['NOTE']);
    const oct31 = await list('all', cT.id, '?to=2026-10-31');
    expect(oct31.body.data.items.map((i: { type: string }) => i.type)).toEqual(['CALL']);
    expect((await list('all', cT.id, '?from=2026-11-05&to=2026-11-01')).status).toBe(400);
    expect((await list('all', cT.id, '?from=2026-02-30')).status).toBe(400);
  });
  it('sortBy=dueAt: có hạn trước, không hạn sau', async () => {
    const r = await list('all', cT.id, '?sortBy=dueAt&sortOrder=asc');
    expect(r.body.data.items[0].type).toBe('TASK');
  });
  it('phạm vi: sales chủ khách 200; kỹ thuật cùng phòng 200; kỹ thuật phòng khác 404; kế toán 200; pageSize > 100 => 400', async () => {
    expect((await list('salesA', cT.id)).status).toBe(200);
    expect((await list('techB', cT.id)).status).toBe(200);
    expect((await list('techC', cT.id)).status).toBe(404);
    expect((await list('acctA', cT.id)).status).toBe(200);
    expect((await list('all', cT.id, '?pageSize=101')).status).toBe(400);
  });
  it('khách đã xoá mềm: mặc định 404; includeDeleted=true cần customer.restore (crm_admin 200, kế toán 404)', async () => {
    const d = await makeCustomer(prisma, fx, { ownerId: fx.empA, deleted: true });
    await prisma.activity.create({ data: { customerId: d.id, type: 'NOTE', content: 'trước khi xoá', occurredAt: new Date(), isDemo: true } });
    expect((await list('all', d.id)).status).toBe(404);
    const ok = await list('all', d.id, '?includeDeleted=true');
    expect(ok.status).toBe(200);
    expect(ok.body.data.total).toBe(1);
    expect((await list('acctA', d.id, '?includeDeleted=true')).status).toBe(404);
  });
  it('người chỉ có quyền theo việc (activity_access §5.4) KHÔNG xem được timeline của khách => 404', async () => {
    const act = await prisma.activity.create({ data: { customerId: cA.id, type: 'TASK', content: 'việc ngoài', status: 'OPEN', dueAt: new Date(Date.now() + 86400000), occurredAt: new Date(), isDemo: true } });
    await prisma.$executeRaw`INSERT INTO activity_access (activity_id, employee_id, granted_by, expires_at) VALUES (${act.id}::uuid, ${fx.empC}::uuid, ${fx.empA}::uuid, now() + interval '1 day')`;
    expect((await list('techC', cA.id)).status).toBe(404);
  });
});

describe('GET assignee-candidates (nội bộ)', () => {
  it('sales: ứng viên cùng phòng VÀ đọc được khách (mình + kỹ thuật cùng phòng), không có người phòng khác', async () => {
    const r = await a('salesA').get(CAND + cA.id);
    expect(r.status).toBe(200);
    const ids = r.body.data.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([fx.empA, fx.empB]));
    expect(ids).not.toContain(fx.empC);
    expect(Object.keys(r.body.data.items[0]).sort()).toEqual(['code', 'departmentCode', 'fullName', 'id']);
  });
  it('crm_admin (ALL): mọi phòng nhưng vẫn chỉ người đọc được khách (kỹ thuật phòng 2 không đọc được khách phòng 1)', async () => {
    const ids = (await a('all').get(CAND + cA.id)).body.data.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(fx.empC);
    expect((await a('all').get(CAND + cC.id)).body.data.items.map((i: { id: string }) => i.id)).toContain(fx.empC);
  });
  it('không có activity.assign => 403; khách ngoài phạm vi đọc => 404; thiếu/sai customerId => 400; external=true (A6) => 400', async () => {
    expect((await a('techB').get(CAND + cA.id)).status).toBe(403);
    expect((await a('salesA').get(CAND + cB.id)).status).toBe(404);
    expect((await a('all').get('/api/v1/activities/assignee-candidates')).status).toBe(400);
    expect((await a('all').get(CAND + 'abc')).status).toBe(400);
    expect((await a('all').get(CAND + cA.id + '&external=true')).status).toBe(400);
  });
});

describe('an toàn', () => {
  it('phản hồi lỗi không lộ chi tiết nội bộ (tên ràng buộc, SQL)', async () => {
    const other = await makeContact(prisma, cB.id, 'LH ' + uniq());
    for (const r of [await post('all', cA.id, { type: 'CALL', content: 'x', contactId: other.id }), await post('techB', cA.id, { type: 'CALL', content: 'x' }), await list('techC', cA.id)]) {
      expect(leaks(r.body)).toBe(false);
    }
  });
  it('nguồn quyền THẬT (DbEmployeeAccess) chạy được bằng pool nghiệp vụ: nhân viên mới không vai trò => active, không quyền nào', async () => {
    const e = await makeEmployee({ fullName: 'NV mới ' + uniq(), departmentId: fx.d1 });
    const m = await new DbEmployeeAccess().load(prisma, [e.id]);
    expect(m.get(e.id)).toEqual({ id: e.id, departmentId: fx.d1, active: true, scopes: {} });
  });
});
