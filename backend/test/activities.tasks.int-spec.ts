// B3 A6 — vòng đời công việc, quyền theo việc (§5.4), đề xuất chuyển (§5.5), chuông (§7) trên DB thử (docs/B3_ACTIVITIES_DESIGN.md §6, §9).
// Ma trận vai trò (preset giống BIZ thật): salesA (OWN, chủ cA), techB (kỹ thuật phòng 1), techC/techD (kỹ thuật phòng 2 — KHÔNG đọc được khách
// phòng 1), acctA (chỉ đọc ALL), all (crm_admin ALL), readonly (đọc khách nhưng không có activity.*), không header (agent => 401 placeholder §14).
import type { PrismaService } from '../src/prisma/prisma.service';
import { AUDIT_REDACTED_TEXT } from '../src/common/audit/db-audit.port';
import type { Permission, Scope } from '../src/common/auth/actor';
import { vnDayRange } from '../src/modules/activities/activities.time';
import { ACCT, as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, makeEmployee, uniq, withAdmin } from './helpers/fixtures';

const C = '/api/v1/customers/';
const A = '/api/v1/activities/';
const L = '/api/v1/activities';
const TR = '/api/v1/activity-transfer-requests';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who = 'all') => as(t.app, who);
const anon = () => as(t.app);
const HOUR = 3600000; const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
let cA: { id: string; code: string }; let cC: { id: string; code: string };
let empD: string; let empS: string;
const preset = (name: string, employeeId: string, departmentId: string, scopes: Partial<Record<Permission, Scope>>) => { t.actors!.presets[name] = { actor: { employeeId, departmentId }, scopes }; };
const noOwn = (): Partial<Record<Permission, Scope>> => { const s = { ...TECH }; delete s['activity.update_own']; return s; };

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx, { verifiedLinks: true }); // checker GIẢ chỉ để thử xoá mềm khách (thu hồi quyền theo việc)
  empD = (await makeEmployee({ fullName: 'KT phòng 2 thứ hai ' + uniq(), departmentId: fx.d2 })).id;
  empS = (await makeEmployee({ fullName: 'Sale chuông ' + uniq(), departmentId: fx.d1 })).id;
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, TECH); t.access.scopes.set(fx.empC, TECH); t.access.scopes.set(empD, TECH); t.access.scopes.set(empS, SALES);
  preset('techD', empD, fx.d2, { ...TECH });
  preset('salesS', empS, fx.d1, { ...SALES });
  preset('techCNoOwn', fx.empC, fx.d2, noOwn()); // cùng người C nhưng phiên đã mất activity.update_own
  const noExt = { ...SALES }; delete noExt['activity.assign_external'];
  preset('salesNoExt', fx.empA, fx.d1, noExt);   // sale có assign/update nhưng KHÔNG có assign_external
  const noContact = { ...SALES }; delete noContact['contact.read'];
  preset('salesNoContact', fx.empA, fx.d1, noContact); // chủ khách (SCOPE) nhưng KHÔNG có contact.read
  preset('techCContactAll', fx.empC, fx.d2, { ...TECH, 'contact.read': 'ALL' }); // vẫn chỉ có quyền theo việc (không đọc được khách) nhưng CÓ contact.read phạm vi khách
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA }); // phòng 1, chủ = A
  cC = await makeCustomer(prisma, fx, { ownerId: fx.empC }); // phòng 2, chủ = C
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

type Act = { id: string; code: string; version: number; status: string };
const mkTask = async (who: string, customerId: string, body: object = {}): Promise<Act> => {
  const r = await a(who).post(C + customerId + '/activities', { type: 'TASK', content: 'Việc ' + uniq(), dueAt: at(2 * DAY), ...body });
  if (r.status !== 201) throw new Error('mkTask ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body.data;
};
const ver = async (id: string) => (await prisma.activity.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;
const accessRows = (activityId: string) => prisma.activityAccess.findMany({ where: { activityId }, orderBy: { createdAt: 'asc' }, select: { employeeId: true, revokedAt: true, revokeReason: true, revokedById: true, createdAt: true, expiresAt: true, grantedById: true } });
const ids = (r: { body: { data: { items: { id: string }[] } } }) => r.body.data.items.map((i) => i.id);
// Giao TASK của khách cA cho kỹ thuật PHÒNG KHÁC (techC) bằng quyền theo việc.
const externalTask = async (to = fx.empC, body: object = {}) => mkTask('salesA', cA.id, { performedById: to, external: true, ...body });

describe('xác thực và quyền cơ bản', () => {
  it('không xác thực (agent chưa có provider) => 401 cho mọi route A6', async () => {
    const x = await mkTask('salesA', cA.id);
    for (const r of [await anon().get(L), await anon().get(A + 'reminders/summary'), await anon().get(A + x.id), await anon().get(A + x.id + '/work-card'), await anon().get(TR + '?box=inbox'),
      await anon().patch(A + x.id, { version: 1, title: 'x' }), await anon().post(A + x.id + '/complete', { version: 1 })]) expect(r.status).toBe(401);
  });
  it('không có activity.read => danh sách/chuông/lịch sử/hộp đề xuất 403; :id không hợp lệ => 400; không tồn tại => 404 ACTIVITY_NOT_FOUND', async () => {
    const x = await mkTask('salesA', cA.id);
    for (const u of [L, A + 'reminders/summary', A + x.id + '/history', TR + '?box=inbox']) expect((await a('readonly').get(u)).status).toBe(403);
    expect((await a('readonly').get(A + x.id)).status).toBe(403);
    expect((await a('none').post(A + x.id + '/complete', { version: 1 })).status).toBe(403); // rà soát A6 M-1
    expect((await a('all').get(A + 'abc')).status).toBe(400);
    const nf = await a('all').get(A + '00000000-0000-4000-8000-000000000000');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('ACTIVITY_NOT_FOUND');
  });
});

describe('GET /activities — phạm vi đọc theo khách + quyền theo việc', () => {
  it('kỹ thuật phòng 2 KHÔNG thấy việc trên khách phòng 1 kể cả lọc assignee=<uuid người khác> (vị từ phạm vi áp TRƯỚC bộ lọc)', async () => {
    const x = await mkTask('salesA', cA.id, { performedById: fx.empB });
    expect(ids(await a('techB').get(L + '?assignee=' + fx.empB + '&pageSize=100'))).toContain(x.id);
    const r = await a('techC').get(L + '?assignee=' + fx.empB + '&pageSize=100');
    expect(r.status).toBe(200);
    expect(ids(r)).not.toContain(x.id);
    expect(ids(await a('acctA').get(L + '?assignee=' + fx.empB + '&pageSize=100'))).toContain(x.id);
  });
  it('assignee=me, type, status; sai tham số => 400; mục có customer + access=SCOPE', async () => {
    const x = await mkTask('salesA', cA.id);
    const r = await a('salesA').get(L + '?assignee=me&type=TASK&status=OPEN&pageSize=100');
    expect(r.status).toBe(200);
    const it0 = r.body.data.items.find((i: { id: string }) => i.id === x.id);
    expect(it0).toMatchObject({ access: 'SCOPE', assigneeLostAccess: false, customer: { id: cA.id, code: cA.code } });
    for (const q of ['?assignee=abc', '?due=tomorrow', '?status=X', '?pageSize=101', '?sortBy=title']) expect((await a('salesA').get(L + q)).status).toBe(400);
  });
});

describe('chuông + bộ lọc hạn theo giờ VN (§7)', () => {
  let cS: { id: string };
  beforeAll(async () => {
    cS = await makeCustomer(prisma, fx, { ownerId: empS });
    const now = Date.now();
    const tomorrow = vnDayRange(new Date(now)).end.getTime();
    const todayDue = now + Math.min(HOUR, Math.floor((tomorrow - now) / 2));
    const base = { customerId: cS.id, type: 'TASK' as const, content: 'chuông', occurredAt: new Date(), performedById: empS, isDemo: true };
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(now - HOUR) } });            // quá hạn
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(now - 30 * DAY) } });        // quá hạn
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(todayDue) } });              // hôm nay (chưa quá hạn)
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(tomorrow + HOUR) } });       // 7 ngày tới
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(tomorrow + 7 * DAY - 1000) } }); // 7 ngày tới (sát biên)
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(tomorrow + 7 * DAY) } });    // ngoài 7 ngày (biên nửa mở)
    // KHÔNG đếm: TASK xong, MEETING có hạn, TASK đã xoá, TASK của người khác, TASK trên khách đã xoá.
    await prisma.activity.create({ data: { ...base, status: 'DONE', completedAt: new Date(), completedById: empS, dueAt: new Date(now - HOUR) } });
    await prisma.activity.create({ data: { ...base, type: 'MEETING', status: 'DONE', dueAt: new Date(todayDue) } });
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(now - HOUR), deletedAt: new Date(), deletedById: fx.empA } });
    await prisma.activity.create({ data: { ...base, status: 'OPEN', dueAt: new Date(now - HOUR), performedById: fx.empA } });
    const dc = await makeCustomer(prisma, fx, { ownerId: empS, deleted: true });
    await prisma.activity.create({ data: { ...base, customerId: dc.id, status: 'OPEN', dueAt: new Date(now - HOUR) } });
  });
  it('summary: overdue/today/upcoming7d chỉ TASK OPEN của tôi, không chồng nhau; đủ 5 trường', async () => {
    const r = await a('salesS').get(A + 'reminders/summary');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ overdue: 2, today: 1, upcoming7d: 2, pendingApprovals: 0, transferDecisions: 0 });
  });
  it('due=overdue|today|week trùng định nghĩa chuông (mặc định chỉ OPEN); due=all không lọc hạn', async () => {
    const n = async (q: string) => (await a('salesS').get(L + '?assignee=me&pageSize=100' + q)).body.data.total;
    expect(await n('&due=overdue')).toBe(2);
    expect(await n('&due=today')).toBe(1);
    expect(await n('&due=week')).toBe(2);
    expect(await n('&due=overdue&status=DONE')).toBe(1);
    expect(await n('&due=all')).toBe(8); // 6 OPEN + DONE + MEETING (không gồm đã xoá / khách đã xoá)
  });
  it('mất phạm vi đọc khách (đổi chủ khách) => việc không còn vào chuông của người phụ trách', async () => {
    const cx = await makeCustomer(prisma, fx, { ownerId: empS });
    await prisma.activity.create({ data: { customerId: cx.id, type: 'TASK', content: 'x', occurredAt: new Date(), performedById: empS, isDemo: true, status: 'OPEN', dueAt: new Date(Date.now() - HOUR) } });
    expect((await a('salesS').get(A + 'reminders/summary')).body.data.overdue).toBe(3);
    await prisma.customer.update({ where: { id: cx.id }, data: { ownerId: fx.empA } });
    expect((await a('salesS').get(A + 'reminders/summary')).body.data.overdue).toBe(2);
  });
});

describe('R1 PR #211 — tối thiểu hoá người liên hệ (§5.4)', () => {
  const itemOf = (r: { body: { data: { items: { id: string; contact: unknown }[] } } }, id: string) => r.body.data.items.find((i) => i.id === id);
  it('chỉ có quyền theo việc (TASK): danh sách, chi tiết và phản hồi ghi KHÔNG có contact; work-card vẫn trả contact tối thiểu', async () => {
    const name = 'LH việc ngoài ' + uniq();
    const ct = await makeContact(prisma, cA.id, name);
    const x = await externalTask(fx.empC, { contactId: ct.id });
    const d = await a('techC').get(A + x.id);
    expect(d.status).toBe(200);
    expect(d.body.data.access).toBe('TASK');
    expect(d.body.data.contact).toBeNull();
    expect(d.body.data).not.toHaveProperty('contactId'); // Owner phương án 2: phản hồi không có khoá contactId; mã liên hệ chỉ nằm trong contact.id (đã ẩn)
    const l = await a('techC').get(L + '?assignee=me&due=all&pageSize=100');
    expect(itemOf(l, x.id)).toMatchObject({ access: 'TASK', contact: null });
    expect(itemOf(l, x.id)).not.toHaveProperty('contactId');
    const p = await a('techC').patch(A + x.id, { version: x.version, outcome: 'Đã khảo sát' });
    expect(p.status).toBe(200);
    expect(p.body.data.contact).toBeNull();
    expect(p.body.data).not.toHaveProperty('contactId');
    const w = await a('techC').get(A + x.id + '/work-card');
    expect(w.status).toBe(200);
    expect(Object.keys(w.body.data.contact).sort()).toEqual(['fullName', 'phone', 'title']);
    expect(w.body.data.contact.fullName).toBe(name);
    expect(JSON.stringify(d.body) + JSON.stringify(l.body) + JSON.stringify(p.body)).not.toContain(name);
    expect(JSON.stringify(d.body) + JSON.stringify(itemOf(l, x.id)) + JSON.stringify(p.body)).not.toContain(ct.id);
    // TASK nhưng CÓ contact.read phạm vi khách: vẫn chỉ có quyền theo việc => không nhận contact/mã liên hệ ở chi tiết, danh sách (R1: chỉ qua /work-card).
    const d2 = await a('techCContactAll').get(A + x.id);
    const l2 = itemOf(await a('techCContactAll').get(L + '?assignee=me&due=all&pageSize=100'), x.id);
    expect(d2.body.data).toMatchObject({ access: 'TASK', contact: null });
    expect(l2).toMatchObject({ access: 'TASK', contact: null });
    expect(JSON.stringify(d2.body) + JSON.stringify(l2)).not.toContain(ct.id);
    expect((await a('techCContactAll').get(A + x.id + '/work-card')).body.data.contact.fullName).toBe(name);
  });
  it('R2 PR #211: POST /activities/:id/complete bởi người chỉ có quyền theo việc => phản hồi không có contact; quyền theo việc bị thu hồi COMPLETED', async () => {
    const name = 'LH hoàn thành ' + uniq();
    const ct = await makeContact(prisma, cA.id, name);
    const x = await externalTask(fx.empC, { contactId: ct.id });
    const r = await a('techC').post(A + x.id + '/complete', { version: x.version, outcome: 'Xong' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: x.id, status: 'DONE', access: 'TASK', contact: null });
    expect(r.body.data).not.toHaveProperty('contactId');
    expect(JSON.stringify(r.body)).not.toContain(name);
    expect(JSON.stringify(r.body)).not.toContain(ct.id);
    // Quyền theo việc vẫn bị thu hồi ngay sau khi hoàn thành (cùng transaction).
    const rows = await accessRows(x.id);
    expect(rows.map((z) => [z.employeeId, z.revokeReason])).toEqual([[fx.empC, 'COMPLETED']]);
    for (const u of [A + x.id, A + x.id + '/work-card']) expect({ u, s: (await a('techC').get(u)).status }).toEqual({ u, s: 404 });
    expect(itemOf(await a('techC').get(L + '?assignee=me&due=all&status=DONE&pageSize=100'), x.id)).toBeUndefined();
    // Nhánh SCOPE không đổi: chủ khách có contact.read vẫn thấy người liên hệ của việc đã xong.
    expect((await a('salesA').get(A + x.id)).body.data.contact).toMatchObject({ id: ct.id, fullName: name });
  });
  it('theo phạm vi khách (SCOPE): có contact khi có contact.read; thiếu contact.read => contact null ở danh sách và chi tiết', async () => {
    const name = 'LH việc trong ' + uniq();
    const ct = await makeContact(prisma, cA.id, name);
    const x = await mkTask('salesA', cA.id, { contactId: ct.id });
    const q = L + '?assignee=me&due=all&pageSize=100';
    expect((await a('salesA').get(A + x.id)).body.data.contact).toMatchObject({ id: ct.id, fullName: name });
    expect(itemOf(await a('salesA').get(q), x.id)).toMatchObject({ access: 'SCOPE', contact: { id: ct.id, fullName: name } });
    const d = await a('salesNoContact').get(A + x.id);
    expect(d.status).toBe(200);
    expect(d.body.data).toMatchObject({ access: 'SCOPE', contact: null });
    expect(itemOf(await a('salesNoContact').get(q), x.id)).toMatchObject({ access: 'SCOPE', contact: null });
    expect(JSON.stringify(d.body)).not.toContain(ct.id); // thiếu contact.read: không lộ mã liên hệ
  });
});

describe('GET /activities/:id, work-card, history', () => {
  it('chủ khách: SCOPE + taskAccesses; kỹ thuật phòng khác: 404; kế toán: 200 (chỉ đọc)', async () => {
    const x = await mkTask('salesA', cA.id);
    const r = await a('salesA').get(A + x.id);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: x.id, access: 'SCOPE', assigneeLostAccess: false, taskAccesses: [], customer: { id: cA.id } });
    expect((await a('techC').get(A + x.id)).status).toBe(404);
    expect((await a('acctA').get(A + x.id)).status).toBe(200);
  });
  it('work-card: đúng các trường tối thiểu (không email/taxId/chủ khách/ghi chú)', async () => {
    const ct = await makeContact(prisma, cA.id, 'LH việc ' + uniq());
    const x = await mkTask('salesA', cA.id, { contactId: ct.id });
    const r = await a('salesA').get(A + x.id + '/work-card');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(['activity', 'contact', 'customer']);
    expect(Object.keys(r.body.data.customer).sort()).toEqual(['address', 'code', 'name', 'phone', 'provinceName', 'shortName']);
    expect(Object.keys(r.body.data.contact).sort()).toEqual(['fullName', 'phone', 'title']);
  });
  it('history: các dòng audit_log THẬT không lộ nội dung; chỉ người đọc theo khách', async () => {
    // RecordingAuditPort không ghi DB => kiểm định dạng đường đọc bằng dòng audit_log giả lập đã che.
    const x = await mkTask('salesA', cA.id);
    await prisma.auditLog.create({ data: { actorId: fx.empA, action: 'activity.update', entityType: 'activity', entityId: x.id, entityCode: x.code, summary: 'Cập nhật hoạt động ' + x.code, changes: { content: AUDIT_REDACTED_TEXT } } });
    const r = await a('salesA').get(A + x.id + '/history');
    expect(r.status).toBe(200);
    expect(r.body.data.items[0]).toMatchObject({ action: 'activity.update', changes: { content: AUDIT_REDACTED_TEXT }, actor: { fullName: 'TEST NV A' } });
    expect(Object.keys(r.body.data.items[0]).sort()).toEqual(['action', 'actor', 'changes', 'occurredAt']);
    expect((await a('techC').get(A + x.id + '/history')).status).toBe(404);
  });
});

describe('PATCH /activities/:id', () => {
  it('version cũ => 409 ACTIVITY_VERSION_CONFLICT {currentVersion}; đúng version => 200, version+1; nhật ký che nội dung + diff hạn', async () => {
    const x = await mkTask('salesA', cA.id);
    const bad = await a('salesA').patch(A + x.id, { version: x.version + 5, title: 'Mới' });
    expect(bad.status).toBe(409);
    expect(bad.body.error).toMatchObject({ code: 'ACTIVITY_VERSION_CONFLICT', details: { currentVersion: x.version } });
    t.audit.entries = [];
    const due = at(5 * DAY);
    const ok = await a('salesA').patch(A + x.id, { version: x.version, title: 'Tiêu đề bí mật', content: 'Nội dung bí mật', dueAt: due });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ version: x.version + 1, title: 'Tiêu đề bí mật', dueAt: new Date(due).toISOString() });
    const e = t.audit.entries.find((z) => z.action === 'activity.update')!;
    expect(e.changes).toMatchObject({ title: AUDIT_REDACTED_TEXT, content: AUDIT_REDACTED_TEXT, dueAt: [expect.any(String), new Date(due).toISOString()] });
    expect(JSON.stringify(t.audit.entries)).not.toContain('bí mật');
  });
  it('kỹ thuật (update_own): sửa việc MÌNH được giao => 200; việc người khác => 403; kế toán => 403; không có trường nào => 400', async () => {
    const mine = await mkTask('salesA', cA.id, { performedById: fx.empB });
    expect((await a('techB').patch(A + mine.id, { version: mine.version, outcome: 'Đã khảo sát' })).status).toBe(200);
    const other = await mkTask('salesA', cA.id);
    expect((await a('techB').patch(A + other.id, { version: other.version, outcome: 'x' })).status).toBe(403);
    expect((await a('acctA').patch(A + other.id, { version: other.version, outcome: 'x' })).status).toBe(403);
    expect((await a('salesA').patch(A + other.id, { version: other.version })).status).toBe(400);
  });
  it('F-217-01: kỹ thuật (update_own) sửa việc DO MÌNH TẠO (đã giao người khác) trên khách phòng mình => 200, version +1, DB + audit; việc người khác tạo, không phụ trách => 403, DB/audit không đổi', async () => {
    // cA: chủ = empA (phòng d1) => techB (empB, phòng d1, TECH: customer.read/activity.update_own DEPARTMENT) đọc được khách.
    const c = await a('techB').post(C + cA.id + '/activities', { type: 'TASK', title: 'KT tự tạo', content: 'Việc do kỹ thuật tạo', dueAt: at(2 * DAY) });
    expect(c.status).toBe(201);
    const own = c.body.data;
    // Giao cho người khác để chỉ còn nhánh "người tạo" (createdById), không còn nhánh "người phụ trách".
    const g = await a('salesA').post(A + own.id + '/assign', { performedById: fx.empA, version: own.version });
    expect(g.status).toBe(200);
    const before = await prisma.activity.findUniqueOrThrow({ where: { id: own.id } });
    expect([before.createdById, before.performedById]).toEqual([fx.empB, fx.empA]);
    t.audit.entries = [];
    const ok = await a('techB').patch(A + own.id, { version: before.version, title: 'KT sửa việc mình tạo' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(before.version + 1);
    const after = await prisma.activity.findUniqueOrThrow({ where: { id: own.id } });
    expect({ title: after.title, version: after.version, updatedById: after.updatedById, performedById: after.performedById }).toEqual({ title: 'KT sửa việc mình tạo', version: before.version + 1, updatedById: fx.empB, performedById: fx.empA });
    const e = t.audit.entries.filter((z) => z.action === 'activity.update');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ entityType: 'activity', entityId: own.id, actorEmployeeId: fx.empB, changes: { title: AUDIT_REDACTED_TEXT } });
    // Việc salesA tạo, empA phụ trách: techB không tạo, không phụ trách => 403, không ghi DB, không audit.
    const other = await mkTask('salesA', cA.id, { performedById: fx.empA });
    t.audit.entries = [];
    const no = await a('techB').patch(A + other.id, { version: other.version, title: 'KT cố sửa việc người khác' });
    expect(no.status).toBe(403);
    expect(no.body.error.code).toBe('FORBIDDEN');
    const o2 = await prisma.activity.findUniqueOrThrow({ where: { id: other.id } });
    expect({ title: o2.title, version: o2.version }).toEqual({ title: null, version: other.version });
    expect(t.audit.entries).toEqual([]);
  });
  it('TASK: không sửa occurredAt, không bỏ hạn, remindAt > dueAt => 400; trường lạ / status khác CANCELLED => 400', async () => {
    const x = await mkTask('salesA', cA.id);
    for (const b of [{ occurredAt: at(-DAY) }, { dueAt: null }, { remindAt: at(10 * DAY) }, { status: 'DONE' }, { customerId: cC.id }, { type: 'CALL' }]) {
      expect((await a('salesA').patch(A + x.id, { version: x.version, ...b })).status).toBe(400);
    }
  });
  it('liên hệ của khách khác => 400 ACTIVITY_CONTACT_MISMATCH; xoá liên hệ (null) => 200', async () => {
    const x = await mkTask('salesA', cA.id);
    const other = await makeContact(prisma, cC.id, 'LH khác ' + uniq());
    const r = await a('salesA').patch(A + x.id, { version: x.version, contactId: other.id });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('ACTIVITY_CONTACT_MISMATCH');
    expect((await a('salesA').patch(A + x.id, { version: x.version, contactId: null })).status).toBe(200);
  });
  it('huỷ: chỉ TASK (CALL => 409 ACTIVITY_NOT_TASK); TASK OPEN => CANCELLED + activity.cancel; huỷ lại => 409 ACTIVITY_NOT_OPEN; mở lại => OPEN', async () => {
    const call = await a('salesA').post(C + cA.id + '/activities', { type: 'CALL', content: 'gọi' });
    const nc = await a('salesA').patch(A + call.body.data.id, { version: 1, status: 'CANCELLED' });
    expect(nc.status).toBe(409);
    expect(nc.body.error.code).toBe('ACTIVITY_NOT_TASK');
    const x = await mkTask('salesA', cA.id);
    t.audit.entries = [];
    const r = await a('salesA').patch(A + x.id, { version: x.version, status: 'CANCELLED' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'CANCELLED', completedAt: null });
    expect(t.audit.entries.map((e) => e.action)).toEqual(['activity.cancel']);
    expect((await a('salesA').patch(A + x.id, { version: x.version + 1, status: 'CANCELLED' })).body.error.code).toBe('ACTIVITY_NOT_OPEN');
    const ro = await a('salesA').post(A + x.id + '/reopen', { version: x.version + 1 });
    expect(ro.status).toBe(200);
    expect(ro.body.data.status).toBe('OPEN');
    expect((await a('salesA').post(A + x.id + '/reopen', { version: x.version + 2 })).body.error.code).toBe('ACTIVITY_ALREADY_OPEN');
  });
  it('đổi người phụ trách qua PATCH => cần activity.assign; ghi 2 dòng update + assign', async () => {
    const x = await mkTask('salesA', cA.id);
    t.audit.entries = [];
    const r = await a('salesA').patch(A + x.id, { version: x.version, title: 'Giao lại', performedById: fx.empB });
    expect(r.status).toBe(200);
    expect(t.audit.entries.map((e) => e.action)).toEqual(['activity.update', 'activity.assign']);
    expect((await a('techB').patch(A + x.id, { version: x.version + 1, performedById: fx.empA })).status).toBe(403);
  });
});

describe('POST assign / complete / reopen', () => {
  it('assign nội bộ => audit activity.assign; người phòng khác không external => 400 INVALID; version cũ => 409', async () => {
    const x = await mkTask('salesA', cA.id);
    t.audit.entries = [];
    const r = await a('salesA').post(A + x.id + '/assign', { performedById: fx.empB, version: x.version });
    expect(r.status).toBe(200);
    expect(r.body.data.performedBy.id).toBe(fx.empB);
    expect(t.audit.entries.find((e) => e.action === 'activity.assign')!.changes).toEqual({ performedById: [fx.empA, fx.empB] });
    expect((await a('salesA').post(A + x.id + '/assign', { performedById: fx.empC, version: x.version + 1 })).body.error.code).toBe('ACTIVITY_ASSIGNEE_INVALID');
    expect((await a('salesA').post(A + x.id + '/assign', { performedById: fx.empA, version: x.version })).status).toBe(409);
    expect((await a('techB').post(A + x.id + '/assign', { performedById: fx.empB, version: x.version + 1 })).status).toBe(403);
  });
  it('complete: người được giao (kể cả kế toán chỉ có activity.read) đánh dấu xong; không phải TASK OPEN => 409; người khác không quyền => 403', async () => {
    const x = await mkTask('all', cA.id, { performedById: fx.empA });
    // acctA là người A với quyền kế toán (chỉ activity.read) — là người phụ trách => được hoàn thành (§5 đường performed_by = tôi).
    const r = await a('acctA').post(A + x.id + '/complete', { version: x.version, outcome: 'Xong' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'DONE', completedById: fx.empA, outcome: 'Xong' });
    expect((await a('acctA').post(A + x.id + '/complete', { version: x.version + 1 })).body.error.code).toBe('ACTIVITY_NOT_OPEN');
    const y = await mkTask('salesA', cA.id);
    expect((await a('techB').post(A + y.id + '/complete', { version: y.version })).status).toBe(403);
    const note = await a('salesA').post(C + cA.id + '/activities', { type: 'NOTE', content: 'n' });
    expect((await a('salesA').post(A + note.body.data.id + '/complete', { version: 1 })).body.error.code).toBe('ACTIVITY_NOT_TASK');
  });
  it('reopen: kế toán (không update) => 403; xoá completed_at/by', async () => {
    const x = await mkTask('salesA', cA.id);
    await a('salesA').post(A + x.id + '/complete', { version: x.version });
    expect((await a('acctA').post(A + x.id + '/reopen', { version: x.version + 1 })).status).toBe(403);
    const r = await a('salesA').post(A + x.id + '/reopen', { version: x.version + 1 });
    expect(r.body.data).toMatchObject({ status: 'OPEN', completedAt: null, completedById: null });
  });
});

describe('quyền theo việc §5.4 — giao ra ngoài phạm vi', () => {
  it('không external => quy tắc A5 (phòng khác => 400 INVALID); external nhưng thiếu assign_external => 403; người nhận không có update_own => 403 EXTERNAL_NOT_ALLOWED (quyết định Owner #2); việc không phải TASK => 400', async () => {
    const x = await mkTask('salesA', cA.id);
    expect((await a('salesA').post(A + x.id + '/assign', { performedById: fx.empC, version: x.version })).body.error.code).toBe('ACTIVITY_ASSIGNEE_INVALID');
    expect((await a('salesNoExt').post(A + x.id + '/assign', { performedById: fx.empC, version: x.version, external: true })).status).toBe(403);
    const k = await makeEmployee({ fullName: 'KT không update_own ' + uniq(), departmentId: fx.d2 });
    t.access.scopes.set(k.id, { 'lookup.read': 'ALL' }); // không đọc được khách, không update_own
    const r = await a('salesA').post(A + x.id + '/assign', { performedById: k.id, version: x.version, external: true });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ACTIVITY_EXTERNAL_NOT_ALLOWED');
    const note = await a('salesA').post(C + cA.id + '/activities', { type: 'NOTE', content: 'n' });
    const rn = await a('salesA').post(A + note.body.data.id + '/assign', { performedById: fx.empC, version: 1, external: true });
    expect(rn.status).toBe(400);
    expect(rn.body.error.code).toBe('ACTIVITY_EXTERNAL_NOT_ALLOWED');
    expect(await prisma.activityAccess.count({ where: { activityId: x.id } })).toBe(0);
  });
  it('tạo TASK giao ngoài phạm vi (external=true) => 201 + 1 dòng activity_access + audit create/assign/access_grant', async () => {
    t.audit.entries = [];
    const x = await externalTask();
    expect(t.audit.entries.map((e) => e.action)).toEqual(['activity.create', 'activity.assign', 'activity.access_grant']);
    const rows = await accessRows(x.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employeeId: fx.empC, grantedById: fx.empA, revokedAt: null });
  });
  it('người được cấp: chi tiết 200 (access=TASK), work-card 200, danh sách + chuông có việc; timeline/khách/liên hệ/lịch sử/việc khác 404', async () => {
    const x = await externalTask();
    const other = await mkTask('salesA', cA.id);
    const d = await a('techC').get(A + x.id);
    expect(d.status).toBe(200);
    expect(d.body.data).toMatchObject({ access: 'TASK', id: x.id });
    expect(d.body.data.accessExpiresAt).toEqual(expect.any(String));
    expect(d.body.data.taskAccesses).toBeUndefined();
    expect((await a('techC').get(A + x.id + '/work-card')).status).toBe(200);
    const l = await a('techC').get(L + '?assignee=me&pageSize=100');
    expect(l.body.data.items.find((i: { id: string }) => i.id === x.id)).toMatchObject({ access: 'TASK' });
    expect(ids(l)).not.toContain(other.id);
    expect((await a('techC').get(A + 'reminders/summary')).body.data.today + (await a('techC').get(A + 'reminders/summary')).body.data.upcoming7d).toBeGreaterThanOrEqual(1);
    for (const u of [C + cA.id + '/activities', C + cA.id, C + cA.id + '/contacts', A + x.id + '/history', A + other.id, A + other.id + '/work-card']) {
      expect({ u, s: (await a('techC').get(u)).status }).toEqual({ u, s: 404 });
    }
    expect((await a('techC').post(C + cA.id + '/activities', { type: 'NOTE', content: 'x' })).status).toBe(404);
  });
  it('người được cấp: PATCH chỉ outcome (trường khác 403); không giao lại; hoàn thành => quyền thu hồi COMPLETED, sau đó 404', async () => {
    const x = await externalTask();
    expect((await a('techC').patch(A + x.id, { version: x.version, content: 'sửa' })).status).toBe(403);
    expect((await a('techC').patch(A + x.id, { version: x.version, dueAt: at(9 * DAY) })).status).toBe(403);
    const o = await a('techC').patch(A + x.id, { version: x.version, outcome: 'Đã đo đạc' });
    expect(o.status).toBe(200);
    expect(o.body.data.access).toBe('TASK');
    expect((await a('techC').post(A + x.id + '/assign', { performedById: empD, version: x.version + 1 })).status).toBe(403);
    expect((await a('techC').post(A + x.id + '/reopen', { version: x.version + 1 })).status).toBe(403);
    const c = await a('techC').post(A + x.id + '/complete', { version: x.version + 1 });
    expect(c.status).toBe(200);
    expect(c.body.data.status).toBe('DONE');
    expect((await accessRows(x.id))[0]).toMatchObject({ revokeReason: 'COMPLETED', revokedById: fx.empC });
    expect((await a('techC').get(A + x.id)).status).toBe(404);
  });
  it('mất activity.update_own trong phiên => mất quyền theo việc NGAY (404), không chờ hết hạn', async () => {
    const x = await externalTask();
    expect((await a('techC').get(A + x.id)).status).toBe(200);
    expect((await a('techCNoOwn').get(A + x.id)).status).toBe(404);
  });
  it('ROLE_LOST: lần ghi kế tiếp do người khác đánh dấu dòng của người đã mất update_own; chủ khách thấy cờ assigneeLostAccess', async () => {
    const x = await externalTask();
    t.access.scopes.set(fx.empC, noOwn());
    try {
      expect((await a('salesA').get(A + x.id)).body.data.assigneeLostAccess).toBe(true);
      const r = await a('salesA').patch(A + x.id, { version: x.version, title: 'Ghi kế tiếp' });
      expect(r.status).toBe(200);
      expect((await accessRows(x.id))[0]).toMatchObject({ revokeReason: 'ROLE_LOST', revokedById: fx.empA });
    } finally { t.access.scopes.set(fx.empC, TECH); }
  });
  it('hết hạn: vị từ kiểm expires_at > now() (không cần job); chủ khách thấy cờ; cấp lại cùng người => dòng cũ EXPIRED, không 23505', async () => {
    const x = await externalTask();
    // Giả lập hết hạn bằng dòng mới hạn rất ngắn (không sửa được dòng cũ — append-only): thu hồi dòng cũ rồi chèn dòng 1 giây.
    await prisma.$executeRaw`UPDATE activity_access SET revoked_at = now(), revoked_by = ${fx.empA}::uuid, revoke_reason = 'MANUAL' WHERE activity_id = ${x.id}::uuid AND revoked_at IS NULL`;
    await prisma.$executeRaw`INSERT INTO activity_access (activity_id, employee_id, granted_by, expires_at) VALUES (${x.id}::uuid, ${fx.empC}::uuid, ${fx.empA}::uuid, now() + interval '1 second')`;
    await new Promise((r) => setTimeout(r, 1300));
    expect((await a('techC').get(A + x.id)).status).toBe(404);
    expect((await a('salesA').get(A + x.id)).body.data.assigneeLostAccess).toBe(true);
    // I-1: cấp lại thẳng cho CHÍNH người phụ trách (không giao vòng qua người thứ ba).
    const again = await a('salesA').post(A + x.id + '/assign', { performedById: fx.empC, version: x.version, external: true });
    expect(again.status).toBe(200);
    const rows = await accessRows(x.id);
    expect(rows.map((z) => [z.employeeId, z.revokeReason])).toEqual([[fx.empC, 'MANUAL'], [fx.empC, 'EXPIRED'], [fx.empC, null]]);
    expect((await a('techC').get(A + x.id)).status).toBe(200);
  });
  it('quyết định Owner #4: thời hạn quyền theo việc theo đồng hồ PostgreSQL — giờ Node lùi 2 giờ vẫn KHÔNG coi quyền đã hết hạn là còn hiệu lực', async () => {
    const x = await externalTask();
    await prisma.$executeRaw`UPDATE activity_access SET revoked_at = now(), revoked_by = ${fx.empA}::uuid, revoke_reason = 'MANUAL' WHERE activity_id = ${x.id}::uuid AND revoked_at IS NULL`;
    await prisma.$executeRaw`INSERT INTO activity_access (activity_id, employee_id, granted_by, expires_at) VALUES (${x.id}::uuid, ${fx.empC}::uuid, ${fx.empA}::uuid, now() + interval '1 second')`;
    await new Promise((r) => setTimeout(r, 1300)); // hết hạn theo giờ DB
    // Chỉ giả Date của Node (lùi 2 giờ): theo giờ Node dòng quyền vẫn "còn hạn". Hẹn giờ/IO giữ thật để HTTP và pg chạy bình thường.
    jest.useFakeTimers({ now: Date.now() - 2 * HOUR, doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const list = await a('techC').get(L + '?assignee=me&due=all&pageSize=100');
      expect(list.status).toBe(200);
      expect(list.body.data.items.map((i: { id: string }) => i.id)).not.toContain(x.id);
      expect((await a('techC').get(A + x.id)).status).toBe(404);
      expect((await a('salesA').get(A + x.id)).body.data.assigneeLostAccess).toBe(true);
      expect((await a('salesA').get(A + x.id)).body.data.taskAccesses).toEqual([]);
    } finally { jest.useRealTimers(); }
  });
  it('expires_at tính bằng SQL: hạn quá khứ => +168h; hạn +23 ngày => trần 720h; hạn +60 ngày => trần 720h', async () => {
    const hours = async (dueMs: number) => {
      const x = await mkTask('salesA', cA.id);
      if (dueMs < 0) await prisma.$executeRaw`UPDATE activity SET due_at = now() - interval '2 days' WHERE id = ${x.id}::uuid`;
      else await prisma.$executeRaw`UPDATE activity SET due_at = now() + (${dueMs / HOUR}::int * interval '1 hour') WHERE id = ${x.id}::uuid`;
      await a('salesA').post(A + x.id + '/assign', { performedById: fx.empC, version: await ver(x.id), external: true });
      const r = (await accessRows(x.id))[0];
      return Math.round((r.expiresAt.getTime() - r.createdAt.getTime()) / HOUR);
    };
    expect(await hours(-1)).toBe(168);
    expect(await hours(23 * 24 * HOUR)).toBe(720);
    expect(await hours(60 * 24 * HOUR)).toBe(720);
    expect(await hours(2 * 24 * HOUR)).toBe(48 + 168);
  });
  it('đổi hạn (PATCH dueAt): người có assign_external => DUE_CHANGED + cấp lại theo hạn mới; không có => giữ quyền cũ + trả accessExpiresAt', async () => {
    const x = await externalTask();
    const r = await a('salesA').patch(A + x.id, { version: x.version, dueAt: at(10 * DAY) });
    expect(r.status).toBe(200);
    let rows = await accessRows(x.id);
    expect(rows.map((z) => z.revokeReason)).toEqual(['DUE_CHANGED', null]);
    expect(Math.round((rows[1].expiresAt.getTime() - Date.now()) / DAY)).toBe(17);
    expect(r.body.data.accessExpiresAt).toBe(rows[1].expiresAt.toISOString());
    const k = await a('salesNoExt').patch(A + x.id, { version: x.version + 1, dueAt: at(3 * DAY) });
    expect(k.status).toBe(200);
    rows = await accessRows(x.id);
    expect(rows).toHaveLength(2);
    expect(k.body.data.accessExpiresAt).toBe(rows[1].expiresAt.toISOString());
  });
  it('thu hồi tự động: đổi người (REASSIGNED), huỷ (CANCELLED), xoá mềm (DELETED); thu hồi thủ công (MANUAL)', async () => {
    const x1 = await externalTask();
    await a('salesA').post(A + x1.id + '/assign', { performedById: fx.empB, version: x1.version });
    expect((await accessRows(x1.id))[0].revokeReason).toBe('REASSIGNED');
    const x2 = await externalTask();
    await a('salesA').patch(A + x2.id, { version: x2.version, status: 'CANCELLED' });
    expect((await accessRows(x2.id))[0].revokeReason).toBe('CANCELLED');
    const x3 = await externalTask();
    expect((await a('all').delete(A + x3.id, { reason: 'Trùng' })).status).toBe(200);
    expect((await accessRows(x3.id))[0].revokeReason).toBe('DELETED');
    const x4 = await externalTask();
    expect((await a('techB').post(A + x4.id + '/access/revoke', { employeeId: fx.empC })).status).toBe(403);
    const m = await a('salesA').post(A + x4.id + '/access/revoke', { employeeId: fx.empC });
    expect(m.status).toBe(200);
    expect(m.body.data).toMatchObject({ assigneeLostAccess: true, taskAccesses: [] });
    expect((await accessRows(x4.id))[0].revokeReason).toBe('MANUAL');
    expect((await a('salesA').post(A + x4.id + '/access/revoke', { employeeId: fx.empC })).status).toBe(404);
  });
  // Rà soát độc lập A6 I-1: cấp lại quyền theo việc cho CHÍNH người đang phụ trách (sau thu hồi thủ công / mở lại / hết hạn) — không phải giao vòng qua người thứ ba.
  it('I-1: giao lại CÙNG người (external=true) sau thu hồi / mở lại => cấp lại quyền (version+1, audit access_grant, không audit assign); còn quyền => không đổi gì', async () => {
    const x = await externalTask();
    const same = await a('salesA').post(A + x.id + '/assign', { performedById: fx.empC, version: x.version, external: true });
    expect(same.status).toBe(200);
    expect(same.body.data.version).toBe(x.version); // còn quyền hiệu lực => không làm gì
    await a('salesA').post(A + x.id + '/access/revoke', { employeeId: fx.empC });
    expect((await a('techC').get(A + x.id)).status).toBe(404);
    t.audit.entries = [];
    const r = await a('salesA').post(A + x.id + '/assign', { performedById: fx.empC, version: await ver(x.id), external: true });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ assigneeLostAccess: false, version: x.version + 1 });
    expect(t.audit.entries.map((e) => e.action)).toEqual(['activity.access_grant']);
    expect((await a('techC').get(A + x.id)).status).toBe(200);
    // Hoàn thành rồi mở lại: quyền đã thu hồi COMPLETED; PATCH performedById = chính người đó + external => cấp lại.
    await a('techC').post(A + x.id + '/complete', { version: await ver(x.id) });
    const ro = await a('salesA').post(A + x.id + '/reopen', { version: await ver(x.id) });
    expect(ro.body.data.assigneeLostAccess).toBe(true);
    const p = await a('salesA').patch(A + x.id, { version: await ver(x.id), performedById: fx.empC, external: true });
    expect(p.status).toBe(200);
    expect(p.body.data.assigneeLostAccess).toBe(false);
    expect((await a('techC').get(A + x.id)).body.data.access).toBe('TASK');
    // Không gửi external => không cấp (giữ hành vi tường minh).
    await a('salesA').post(A + x.id + '/access/revoke', { employeeId: fx.empC });
    const n = await a('salesA').post(A + x.id + '/assign', { performedById: fx.empC, version: await ver(x.id) });
    expect(n.status).toBe(200);
    expect((await a('techC').get(A + x.id)).status).toBe(404);
  });
  it('đổi chủ khách: quyền theo việc giữ nguyên; chủ mới thấy việc + người được cấp', async () => {
    const cx = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    const x = await mkTask('salesA', cx.id, { performedById: fx.empC, external: true });
    await prisma.customer.update({ where: { id: cx.id }, data: { ownerId: empS } });
    expect((await a('techC').get(A + x.id)).status).toBe(200);
    const s = await a('salesS').get(A + x.id);
    expect(s.status).toBe(200);
    expect(s.body.data.taskAccesses.map((z: { employee: { id: string } }) => z.employee.id)).toEqual([fx.empC]);
  });
});

describe('TOCTOU đổi chủ khách (§5)', () => {
  it('assignee cũ (đọc theo phòng) không còn thấy việc / không hoàn thành được; chủ mới thấy + cờ assigneeLostAccess', async () => {
    const cx = await makeCustomer(prisma, fx, { ownerId: fx.empB }); // phòng 1
    const x = await mkTask('techB', cx.id); // kỹ thuật B tự tạo, tự phụ trách
    expect((await a('techB').get(A + x.id)).status).toBe(200);
    await prisma.customer.update({ where: { id: cx.id }, data: { ownerId: fx.empC } }); // sang phòng 2
    expect((await a('techB').get(A + x.id)).status).toBe(404);
    expect(ids(await a('techB').get(L + '?assignee=me&pageSize=100'))).not.toContain(x.id);
    expect((await a('techB').post(A + x.id + '/complete', { version: x.version })).status).toBe(404);
    const c = await a('techC').get(A + x.id);
    expect(c.status).toBe(200);
    expect(c.body.data.assigneeLostAccess).toBe(true);
    const l = await a('techC').get(L + '?assignee=' + fx.empB + '&pageSize=100');
    expect(l.body.data.items.find((i: { id: string }) => i.id === x.id)).toMatchObject({ assigneeLostAccess: true });
  });
});

describe('DELETE /activities/:id (xoá mềm, chỉ crm_admin)', () => {
  it('sale 403; admin 200 + nhật ký chỉ mã/loại, lý do che; sau đó 404 và không trong danh sách/timeline; lý do > 200 => 400', async () => {
    const x = await mkTask('salesA', cA.id);
    expect((await a('salesA').delete(A + x.id)).status).toBe(403);
    expect((await a('all').delete(A + x.id, { reason: 'x'.repeat(201) })).status).toBe(400);
    t.audit.entries = [];
    const r = await a('all').delete(A + x.id, { reason: 'Lý do riêng tư' });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: x.id, code: x.code, deleted: true });
    const e = t.audit.entries.find((z) => z.action === 'activity.delete')!;
    expect(e.summary).toBe('Xoá mềm hoạt động ' + x.code + ' (TASK)');
    expect(e.changes).toEqual({ reason: AUDIT_REDACTED_TEXT });
    expect((await a('all').get(A + x.id)).status).toBe(404);
    expect(ids(await a('all').get(C + cA.id + '/activities?pageSize=100'))).not.toContain(x.id);
    expect((await a('all').delete(A + x.id)).status).toBe(404);
  });
});

describe('ứng viên ngoài phạm vi (assignee-candidates?external=true)', () => {
  it('sale: kỹ thuật phòng khác có update_own; KHÔNG có người đọc được khách, không có chính mình; kỹ thuật/kế toán 403', async () => {
    const r = await a('salesA').get(A + 'assignee-candidates?customerId=' + cA.id + '&external=true');
    expect(r.status).toBe(200);
    const list = r.body.data.items.map((i: { id: string }) => i.id);
    expect(list).toEqual(expect.arrayContaining([fx.empC, empD]));
    expect(list).not.toContain(fx.empB);
    expect(list).not.toContain(fx.empA);
    expect(Object.keys(r.body.data.items[0]).sort()).toEqual(['code', 'departmentCode', 'fullName', 'id']);
    expect((await a('techB').get(A + 'assignee-candidates?customerId=' + cA.id + '&external=true')).status).toBe(403);
    expect((await a('salesNoExt').get(A + 'assignee-candidates?customerId=' + cA.id + '&external=true')).status).toBe(403);
    expect((await a('salesA').get(A + 'assignee-candidates?customerId=' + cC.id + '&external=true')).status).toBe(404);
  });
});

describe('đề xuất chuyển việc §5.5', () => {
  it('người phụ trách (chỉ có quyền theo việc) đề xuất cho người CÙNG PHÒNG => 201; 1 PENDING/việc; sai người nhận => 400; không phụ trách => 403', async () => {
    const x = await externalTask();
    expect((await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: fx.empB, reason: 'khác phòng' })).body.error.code).toBe('ACTIVITY_ASSIGNEE_INVALID');
    expect((await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: fx.empC, reason: 'chính mình' })).status).toBe(400);
    expect((await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: '  ' })).status).toBe(400);
    t.audit.entries = [];
    const r = await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'Bận lịch riêng' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'PENDING', from: { id: fx.empC }, to: { id: empD }, activity: { id: x.id } });
    expect(t.audit.entries[t.audit.entries.length - 1]).toMatchObject({ action: 'activity.transfer_request', changes: { reason: AUDIT_REDACTED_TEXT, toEmployeeId: empD } });
    expect((await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'lần 2' })).body.error.code).toBe('ACTIVITY_TRANSFER_PENDING');
    expect((await a('salesA').post(A + x.id + '/transfer-requests', { toEmployeeId: fx.empB, reason: 'x' })).status).toBe(403); // sale không có transfer_request
    expect((await a('techD').post(A + x.id + '/transfer-requests', { toEmployeeId: fx.empC, reason: 'x' })).status).toBe(404); // techD chưa thấy việc
    // Người đề xuất KHÔNG tự mở quyền: người nhận vẫn chưa thấy việc.
    expect((await a('techD').get(A + x.id)).status).toBe(404);
  });
  it('F-A8-01: việc đổi sau khi tải hộp đến => duyệt bằng version cũ 409 {currentVersion}; tải lại hộp đến có version mới => duyệt được', async () => {
    const x = await externalTask();
    const req = (await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'Đổi lịch' })).body.data;
    const v1 = (await a('salesA').get(TR + '?box=inbox')).body.data.items.find((i: { id: string }) => i.id === req.id).activity.version;
    expect(v1).toBe(x.version);
    const p = await a('salesA').patch(A + x.id, { version: v1, title: 'Đổi tiêu đề sau khi tải hộp đến' });
    expect(p.status).toBe(200);
    const stale = await a('salesA').post(TR + '/' + req.id + '/approve', { version: v1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'ACTIVITY_VERSION_CONFLICT', details: { currentVersion: v1 + 1 } });
    expect((await prisma.activityTransferRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
    const v2 = (await a('salesA').get(TR + '?box=inbox')).body.data.items.find((i: { id: string }) => i.id === req.id).activity.version;
    expect(v2).toBe(v1 + 1);
    const ok = await a('salesA').post(TR + '/' + req.id + '/approve', { version: v2 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
  });
  it('hộp đến (chủ khách) + chuông pendingApprovals; duyệt thiếu assign_external => 403; duyệt => đổi người, thu hồi cũ, cấp mới, APPROVED; outbox + transferDecisions', async () => {
    const x = await externalTask();
    const req = (await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'Nhờ chuyển' })).body.data;
    const inbox = await a('salesA').get(TR + '?box=inbox');
    expect(inbox.status).toBe(200);
    const item = inbox.body.data.items.find((i: { id: string }) => i.id === req.id);
    expect(item).toMatchObject({ reason: 'Nhờ chuyển', customer: { id: cA.id } });
    expect(item.activity.version).toBe(x.version); // F-A8-01: inbox trả phiên bản việc để giao diện gửi khi duyệt
    expect((await a('salesA').get(A + 'reminders/summary')).body.data.pendingApprovals).toBeGreaterThanOrEqual(1);
    expect((await a('techB').get(TR + '?box=inbox')).body.data.items).toEqual([]);
    expect((await a('salesNoExt').get(TR + '?box=inbox')).body.data.items.map((i: { id: string }) => i.id)).not.toContain(req.id);
    expect((await a('salesNoExt').post(TR + '/' + req.id + '/approve', { version: x.version })).body.error.code).toBe('ACTIVITY_TRANSFER_NOT_ALLOWED');
    expect((await a('salesA').post(TR + '/' + req.id + '/approve', {})).status).toBe(400);
    expect((await a('salesA').post(TR + '/' + req.id + '/approve', { version: x.version + 9 })).status).toBe(409);
    t.audit.entries = [];
    const ok = await a('salesA').post(TR + '/' + req.id + '/approve', { version: item.activity.version, decisionNote: 'Đồng ý' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'APPROVED', decisionNote: 'Đồng ý' });
    expect(t.audit.entries.map((e) => e.action)).toEqual(['activity.access_revoke', 'activity.assign', 'activity.transfer_approve', 'activity.access_grant']);
    expect(t.audit.entries[1].changes).toEqual({ performedById: [fx.empC, empD], transferRequestId: req.id });
    expect(t.audit.entries[2].changes).toMatchObject({ decisionNote: AUDIT_REDACTED_TEXT });
    const rows = await accessRows(x.id);
    expect(rows.map((z) => [z.employeeId, z.revokeReason])).toEqual([[fx.empC, 'REASSIGNED'], [empD, null]]);
    expect((await a('techC').get(A + x.id)).status).toBe(404);
    expect((await a('techD').get(A + x.id)).body.data).toMatchObject({ access: 'TASK', performedBy: { id: empD } });
    const out = await a('techC').get(TR + '?box=outbox');
    expect(out.body.data.items.find((i: { id: string }) => i.id === req.id)).toMatchObject({ status: 'APPROVED' });
    expect((await a('techC').get(A + 'reminders/summary')).body.data.transferDecisions).toBeGreaterThanOrEqual(1);
    expect((await a('salesA').post(TR + '/' + req.id + '/approve', { version: x.version + 1 })).body.error.code).toBe('ACTIVITY_TRANSFER_NOT_PENDING');
  });
  it('từ chối (REJECTED, ghi chú che) và rút (chỉ người đề xuất); người không đọc được khách => 404', async () => {
    const x = await externalTask();
    const r1 = (await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'a' })).body.data;
    expect((await a('techD').post(TR + '/' + r1.id + '/reject', {})).status).toBe(403); // không có activity.assign
    expect((await a('ownB').post(TR + '/' + r1.id + '/reject', {})).status).toBe(404);  // có assign nhưng không đọc được khách
    const rj = await a('salesA').post(TR + '/' + r1.id + '/reject', { decisionNote: 'Không' });
    expect(rj.body.data).toMatchObject({ status: 'REJECTED' });
    const r2 = (await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'b' })).body.data;
    expect((await a('techD').post(TR + '/' + r2.id + '/withdraw', {})).body.error.code).toBe('ACTIVITY_TRANSFER_NOT_ALLOWED');
    const wd = await a('techC').post(TR + '/' + r2.id + '/withdraw', {});
    expect(wd.body.data.status).toBe('WITHDRAWN');
    expect((await a('techC').post(TR + '/' + r2.id + '/withdraw', {})).body.error.code).toBe('ACTIVITY_TRANSFER_NOT_PENDING');
    expect((await a('salesA').post(TR + '/00000000-0000-4000-8000-000000000000/approve', { version: 1 })).status).toBe(404);
  });
  it('rà soát A6 M-4/M-8: người nhận đổi phòng khi chờ duyệt => duyệt 400 ASSIGNEE_INVALID; rút không nhận decisionNote (400)', async () => {
    const x = await externalTask();
    const r = (await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'a' })).body.data;
    expect((await a('techC').post(TR + '/' + r.id + '/withdraw', { decisionNote: 'x' })).status).toBe(400);
    await withAdmin((ad) => ad.employee.update({ where: { id: empD }, data: { departmentId: fx.d1 } }));
    try {
      const ap = await a('salesA').post(TR + '/' + r.id + '/approve', { version: x.version });
      expect(ap.status).toBe(400);
      expect(ap.body.error.code).toBe('ACTIVITY_ASSIGNEE_INVALID');
    } finally { await withAdmin((ad) => ad.employee.update({ where: { id: empD }, data: { departmentId: fx.d2 } })); }
    expect((await a('techC').post(TR + '/' + r.id + '/withdraw', {})).body.data.status).toBe('WITHDRAWN');
  });
  it('tự WITHDRAWN khi việc hoàn thành / đổi người', async () => {
    const x = await externalTask();
    const r1 = (await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'a' })).body.data;
    await a('techC').post(A + x.id + '/complete', { version: x.version });
    expect((await prisma.activityTransferRequest.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe('WITHDRAWN');
    const y = await externalTask();
    const r2 = (await a('techC').post(A + y.id + '/transfer-requests', { toEmployeeId: empD, reason: 'b' })).body.data;
    await a('salesA').post(A + y.id + '/assign', { performedById: fx.empB, version: y.version });
    expect((await prisma.activityTransferRequest.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe('WITHDRAWN');
  });
});

describe('xoá mềm khách hàng (CustomersService.softDelete) — thu hồi quyền theo việc + rút đề xuất CÙNG transaction', () => {
  it('DELETE /customers/:id => activity_access CUSTOMER_DELETED, đề xuất chờ WITHDRAWN; người được cấp 404; ghi việc => 409 CUSTOMER_DELETED', async () => {
    const cx = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    const x = await mkTask('salesA', cx.id, { performedById: fx.empC, external: true });
    const req = (await a('techC').post(A + x.id + '/transfer-requests', { toEmployeeId: empD, reason: 'a' })).body.data;
    t.audit.entries = [];
    const del = await a('all').delete(C + cx.id);
    expect(del.status).toBe(200);
    expect((await accessRows(x.id))[0]).toMatchObject({ revokeReason: 'CUSTOMER_DELETED', revokedById: fx.empA });
    expect((await prisma.activityTransferRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('WITHDRAWN');
    expect(t.audit.entries.map((e) => e.action)).toEqual(['customer.delete', 'activity.access_revoke', 'activity.transfer_withdraw']);
    expect((await a('techC').get(A + x.id)).status).toBe(404);
    const w = await a('all').patch(A + x.id, { version: await ver(x.id), title: 'x' });
    expect(w.status).toBe(409);
    expect(w.body.error.code).toBe('CUSTOMER_DELETED');
    // Quyết định Owner #5: MỌI thao tác ghi trên việc của khách đã xoá đều bị từ chối (kể cả người có customer.restore).
    const v = await ver(x.id);
    for (const [path, body, method] of [
      ['/complete', { version: v }, 'post'], ['/reopen', { version: v }, 'post'], ['/assign', { performedById: fx.empA, version: v }, 'post'],
      ['/access/revoke', { employeeId: fx.empC }, 'post'], ['', { reason: 'x' }, 'delete'],
    ] as const) {
      const r = method === 'post' ? await a('all').post(A + x.id + path, body) : await a('all').delete(A + x.id, body);
      expect([path, r.status, r.body.error?.code]).toEqual([path, 409, 'CUSTOMER_DELETED']);
    }
    expect(await ver(x.id)).toBe(v);
    expect((await a('acctA').get(A + x.id)).status).toBe(404);  // không có customer.restore
    expect((await a('all').get(A + x.id)).status).toBe(200);    // có customer.restore (như timeline includeDeleted)
  });
});

describe('an toàn', () => {
  it('phản hồi lỗi không lộ chi tiết nội bộ', async () => {
    const x = await externalTask();
    for (const r of [await a('techC').patch(A + x.id, { version: x.version, content: 'x' }), await a('salesA').patch(A + x.id, { version: 99, title: 'x' }), await a('techB').get(A + x.id),
      await a('salesA').post(A + x.id + '/assign', { performedById: '00000000-0000-4000-8000-000000000000', version: x.version })]) expect(leaks(r.body)).toBe(false);
  });
});
