// Sales S9a — giao diện Sales ↔ Activities (docs/SALES_DESIGN.md §5.5(a)(b)(c)) và ĐƯỜNG ĐỌC THEO VIỆC của Kỹ thuật (§5.5(d), §5.1 [C7], §5.4).
import type { INestApplication } from '@nestjs/common';
import type { Permission, Scope } from '../src/common/auth/actor';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ACCT, as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, makeEmployee, makeOpportunity, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const ACT = '/api/v1/activities';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who: string, app: INestApplication = t.app) => as(app, who);
type Ref = { id: string; code: string };
type Scopes = Partial<Record<Permission, Scope>>;
let cA: Ref; let cA2: Ref;
let techD = ''; let techX = ''; let acctE = ''; let goneF = ''; let sameDept = '';
const preset = (name: string, employeeId: string, departmentId: string, scopes: Scopes) => {
  const cur = t.actors!.presets[name];
  t.actors!.presets[name] = { actor: cur ? cur.actor : { employeeId, departmentId }, scopes: { ...scopes } };
};
const due = (days = 3): string => new Date(Date.now() + days * 86_400_000).toISOString();
const SECRET_AMOUNT = '987654321';

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  techD = (await makeEmployee({ fullName: 'S9 Kỹ thuật cùng phòng ' + uniq(), departmentId: fx.d1 })).id;
  techX = (await makeEmployee({ fullName: 'S9 Kỹ thuật khác phòng ' + uniq(), departmentId: fx.d2 })).id;
  acctE = (await makeEmployee({ fullName: 'S9 Kế toán ' + uniq(), departmentId: fx.d1 })).id;
  goneF = (await makeEmployee({ fullName: 'S9 Đã nghỉ ' + uniq(), departmentId: fx.d1, status: 'RESIGNED' })).id;
  sameDept = (await makeEmployee({ fullName: 'S9 Kinh doanh cùng phòng ' + uniq(), departmentId: fx.d1 })).id;
  t.access.scopes.set(sameDept, SALES);
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, SALES); t.access.scopes.set(fx.empC, SALES);
  t.access.scopes.set(techD, TECH); t.access.scopes.set(techX, TECH); t.access.scopes.set(acctE, ACCT); t.access.scopes.set(goneF, TECH);
  preset('techDp', techD, fx.d1, TECH);
  preset('techXp', techX, fx.d2, TECH);
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA });
  cA2 = await makeCustomer(prisma, fx, { ownerId: fx.empA });
});
afterEach(() => { preset('techXp', techX, fx.d2, TECH); t.access.scopes.set(techX, TECH); });
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

const opp = (ownerId: string, extra: object = {}, customerId = cA.id) => makeOpportunity(prisma, fx, { customerId, ownerId, title: 'S9 ' + uniq(), stage: 'PROSPECTING', ...extra });
// Tạo việc gắn cơ hội: người phụ trách cơ hội tạo qua đường Sales (b). Trả id + version.
async function task(who: string, oppId: string, performedById: string | undefined, external = false, extra: object = {}): Promise<{ id: string; version: number }> {
  const r = await a(who).post(O + '/' + oppId + '/activities', { type: 'TASK', content: 'Việc S9 ' + uniq(), dueAt: due(), ...(performedById ? { performedById } : {}), ...(external ? { external: true } : {}), ...extra });
  expect({ who, s: r.status, e: r.body.error }).toEqual({ who, s: 201, e: undefined });
  return { id: r.body.data.id, version: r.body.data.version };
}
const getOpp = (who: string, id: string) => a(who).get(O + '/' + id);
const listIds = async (who: string, qs: string) => { const r = await a(who).get(O + '?pageSize=100' + qs); expect(r.status).toBe(200); return (r.body.data.items as Array<{ id: string }>).map((x) => x.id); };
const actIds = async (who: string, oppId: string, qs = '') => {
  const r = await a(who).get(O + '/' + oppId + '/activities?pageSize=100' + qs);
  expect({ who, s: r.status }).toEqual({ who, s: 200 });
  return { ids: (r.body.data.items as Array<{ id: string }>).map((x) => x.id).sort(), total: r.body.data.total as number, access: r.body.data.access as string, items: r.body.data.items as Array<{ id: string; contact: unknown; opportunityId: string }> };
};
// Hợp đồng trả về của bản kỹ thuật (§5.4) — danh sách khoá ĐÓNG: thêm / bớt trường phải sửa ở đây (review R1 #245: không status, không owner).
const TECH_KEYS = ['access', 'code', 'createdAt', 'customer', 'expectedCloseDate', 'id', 'isProjectLinked', 'projectName', 'stage', 'title', 'type', 'updatedAt', 'version'];

describe('§5.5(d) — đường đọc theo việc của Kỹ thuật: bản kỹ thuật, không giá trị, không quyền ghi', () => {
  it('Kỹ thuật ngoài phạm vi khách: chỉ thấy cơ hội khi có việc OPEN được giao cho mình và đang đọc được việc đó; nhận ĐÚNG bộ trường kỹ thuật', async () => {
    const o = await opp(fx.empA, { amount: BigInt(SECRET_AMOUNT), probability: 37, needSummary: 'Cần 3 chiller 500RT', projectName: 'Nhà máy S9 ' + uniq(), closeDate: '2027-03-31' });
    const other = await opp(fx.empA, { amount: 5n });
    expect((await getOpp('techXp', o.id)).status).toBe(404);
    expect(await listIds('techXp', '&customerId=' + cA.id)).toEqual([]);
    const tk = await task('salesA', o.id, techX, true);
    expect(await prisma.activityAccess.count({ where: { activityId: tk.id, employeeId: techX, revokedAt: null } })).toBe(1);

    const d = await getOpp('techXp', o.id);
    expect(d.status).toBe(200);
    expect(Object.keys(d.body.data).sort()).toEqual([...TECH_KEYS, 'needSummary', 'offerScope'].sort());
    expect(d.body.data).toMatchObject({ id: o.id, access: 'TASK', needSummary: 'Cần 3 chiller 500RT', offerScope: 'Phạm vi chào thử', expectedCloseDate: '2027-03-31', customer: { id: cA.id, code: cA.code }, type: { code: 'T_SUPPLY' }, stage: { code: 'PROSPECTING' } });
    expect(Object.keys(d.body.data.customer).sort()).toEqual(['code', 'id', 'name']); // không địa chỉ / điện thoại: thẻ khách lấy qua work-card của B3
    expect(JSON.stringify(d.body)).not.toContain(SECRET_AMOUNT);

    const l = await a('techXp').get(O + '?pageSize=100&customerId=' + cA.id);
    expect(l.body.data.items.map((x: { id: string }) => x.id)).toEqual([o.id]); // cơ hội khác của cùng khách không lọt
    expect(l.body.data.total).toBe(1);
    expect(Object.keys(l.body.data.items[0]).sort()).toEqual(TECH_KEYS);
    expect(JSON.stringify(l.body)).not.toContain(SECRET_AMOUNT);
    const byCust = await a('techXp').get('/api/v1/customers/' + cA.id + '/opportunities?pageSize=100');
    expect(byCust.status).toBe(200);
    expect(byCust.body.data.items.map((x: { id: string; access: string }) => [x.id, x.access])).toEqual([[o.id, 'TASK']]);
    expect((await getOpp('techXp', other.id)).status).toBe(404);

    // Thấy được nhưng không có mã ghi => 403 ở mọi đường ghi và lịch sử; cơ hội không đổi.
    expect((await a('techXp').get(O + '/' + o.id + '/changes')).status).toBe(403);
    expect((await a('techXp').patch(O + '/' + o.id, { version: 1, title: 'Kỹ thuật tự sửa' })).status).toBe(403);
    for (const [action, body] of [
      ['stage', { version: 1, stageId: fx.oppStage['SURVEY'] }], ['hold', { version: 1, holdUntil: '2099-01-01', holdReason: 'x' }], ['resume', { version: 1 }],
      ['win', { version: 1, wonAmountVnd: '1', wonDocType: 'HOP_DONG', wonDocNo: 'x', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/x', handoverToId: techX }],
      ['lose', { version: 1, lostReasonId: fx.oppLostReason['PRICE_HIGHER'] }], ['assign', { version: 1, ownerId: fx.empB, reason: 'x' }], ['reopen', { version: 1, reason: 'x' }],
      ['activities', { type: 'NOTE', content: 'Kỹ thuật ghi chú qua đường Sales' }],
    ] as const) expect({ action, s: (await a('techXp').post(O + '/' + o.id + '/' + action, body)).status }).toEqual({ action, s: 403 });
    expect((await a('techXp').delete(O + '/' + o.id, { version: 1, reason: 'x' })).status).toBe(403);
    expect(await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id }, select: { version: true, status: true, title: true } })).toMatchObject({ version: 1, status: 'OPEN', title: o.title });
    // Người xem đầy đủ vẫn nhận bản đầy đủ của cùng cơ hội.
    expect((await getOpp('salesA', o.id)).body.data).toMatchObject({ access: 'FULL', expectedAmountVnd: SECRET_AMOUNT, probability: 37 });
  });

  // L-01 (rà soát S8–S11): bản kỹ thuật không có trạng thái / người phụ trách (review R1 #245) => bộ lọc theo hai trường đó không được trở thành
  // "máy dò": dòng chỉ đạt đường theo việc KHÔNG được có / không tuỳ theo giá trị lọc.
  it('L-01: bộ lọc status / ownerId không cho người CHỈ đạt đường theo việc dò ra trạng thái và người phụ trách; bộ lọc trên trường được thấy vẫn dùng được', async () => {
    const o = await opp(fx.empA, { amount: BigInt(SECRET_AMOUNT), projectName: 'Dò L01 ' + uniq(), closeDate: '2027-04-30' });
    await task('salesA', o.id, techX, true);
    const mine = '&customerId=' + cA.id;
    expect(await listIds('techXp', mine)).toContain(o.id); // không lọc: vẫn thấy qua việc được giao
    for (const s of ['OPEN', 'ON_HOLD', 'WON', 'LOST']) {
      const r = await a('techXp').get(O + '?pageSize=100' + mine + '&status=' + s);
      expect({ s, status: r.status, ids: r.body.data.items.map((x: { id: string }) => x.id), total: r.body.data.total }).toEqual({ s, status: 200, ids: [], total: 0 });
    }
    for (const owner of [fx.empA, fx.empB, techX]) {
      const r = await a('techXp').get(O + '?pageSize=100' + mine + '&ownerId=' + owner);
      expect({ owner, status: r.status, ids: r.body.data.items.map((x: { id: string }) => x.id), total: r.body.data.total }).toEqual({ owner, status: 200, ids: [], total: 0 });
    }
    // Đường theo khách: cùng quy tắc (dòng theo việc không trả lời câu hỏi về trạng thái / người phụ trách).
    const byCust = await a('techXp').get('/api/v1/customers/' + cA.id + '/opportunities?pageSize=100&status=OPEN');
    expect({ s: byCust.status, n: byCust.body.data?.items.length }).toEqual({ s: 200, n: 0 });
    expect((await a('techXp').get('/api/v1/customers/' + cA.id + '/opportunities?pageSize=100&ownerId=' + fx.empA)).body.data.items).toEqual([]);
    // Bộ lọc trên trường mà bản kỹ thuật ĐƯỢC thấy vẫn hoạt động.
    expect(await listIds('techXp', mine + '&stageId=' + fx.oppStage['PROSPECTING'])).toContain(o.id);
    expect(await listIds('techXp', mine + '&closeFrom=2027-04-01&closeTo=2027-04-30')).toEqual([o.id]);
    expect(await listIds('techXp', mine + '&q=' + encodeURIComponent('Dò L01'))).toEqual([o.id]);
    // Đối chứng: người xem đầy đủ lọc như cũ.
    expect(await listIds('salesA', mine + '&status=OPEN&ownerId=' + fx.empA)).toContain(o.id);
    expect(await listIds('salesA', mine + '&status=WON')).not.toContain(o.id);
    // Người đạt CẢ HAI loại đường (đầy đủ với cơ hội mình phụ trách, theo việc với cơ hội khác): lọc status / ownerId chỉ trả dòng đầy đủ.
    const own = await opp(techX, {}, cA2.id);
    preset('techXp', techX, fx.d2, { ...TECH, 'opportunity.read': 'OWN' });
    expect((await listIds('techXp', '')).sort()).toEqual(expect.arrayContaining([o.id, own.id]));
    const both = await a('techXp').get(O + '?pageSize=100&status=OPEN');
    const mineOnly = (rows: Array<{ id: string; access: string }>) => rows.filter((x) => x.id === o.id || x.id === own.id).map((x) => [x.id, x.access]);
    expect(mineOnly(both.body.data.items)).toEqual([[own.id, 'FULL']]);
    expect(both.body.data.items.every((x: { access: string }) => x.access === 'FULL')).toBe(true); // không dòng theo việc nào lọt khi lọc trạng thái
    expect(await listIds('techXp', '&ownerId=' + fx.empA)).toEqual([]);
    const byMe = await listIds('techXp', '&ownerId=' + techX);
    expect(byMe).toContain(own.id); expect(byMe).not.toContain(o.id);
  });

  it('quyền TỰ HẾT ngay khi một điều kiện không còn: việc xong / huỷ / đổi người làm / thu hồi quyền theo việc / bỏ gắn cơ hội / xoá mềm việc / xoá mềm cơ hội / mất mã', async () => {
    const cases: Array<[string, (o: Ref, tk: { id: string; version: number }) => Promise<{ status: number }>, number]> = [
      ['việc hoàn thành', (_o, tk) => a('techXp').post(ACT + '/' + tk.id + '/complete', { version: tk.version }), 404],
      ['việc bị huỷ', (_o, tk) => a('salesA').patch(ACT + '/' + tk.id, { version: tk.version, status: 'CANCELLED' }), 404],
      ['đổi người làm', (_o, tk) => a('salesA').post(ACT + '/' + tk.id + '/assign', { version: tk.version, performedById: techD }), 404],
      ['thu hồi quyền theo việc', (_o, tk) => a('salesA').post(ACT + '/' + tk.id + '/access/revoke', { employeeId: techX }), 404],
      ['bỏ gắn cơ hội khỏi việc', (_o, tk) => a('salesA').patch(ACT + '/' + tk.id, { version: tk.version, opportunityId: null }), 404],
      ['xoá mềm việc', (_o, tk) => a('crmAdmin').delete(ACT + '/' + tk.id, { reason: 'thử' }), 404],
      ['xoá mềm cơ hội', (o) => a('crmAdmin').delete(O + '/' + o.id, { version: 1, reason: 'thử' }), 404],
      ['mất activity.update_own (quyền theo việc vô hiệu)', async () => { const s: Scopes = { ...TECH }; delete s['activity.update_own']; preset('techXp', techX, fx.d2, s); return { status: 200 }; }, 404],
      ['mất opportunity.read_assigned (không còn mã đọc cơ hội nào)', async () => { const s: Scopes = { ...TECH }; delete s['opportunity.read_assigned']; preset('techXp', techX, fx.d2, s); return { status: 200 }; }, 403],
    ];
    for (const [name, act, expected] of cases) {
      const o = await opp(fx.empA);
      const tk = await task('salesA', o.id, techX, true);
      expect({ name, before: (await getOpp('techXp', o.id)).status }).toEqual({ name, before: 200 });
      expect({ name, s: (await act(o, tk)).status }).toEqual({ name, s: 200 });
      expect({ name, after: (await getOpp('techXp', o.id)).status }).toEqual({ name, after: expected });
      const l = await a('techXp').get(O + '?pageSize=100&customerId=' + cA.id);
      if (expected === 403) expect(l.status).toBe(403); else expect(l.body.data.items.map((x: { id: string }) => x.id)).not.toContain(o.id);
      preset('techXp', techX, fx.d2, TECH);
    }
  });

  it('Kỹ thuật TRONG phạm vi khách: việc OPEN được giao là đủ (không cần activity_access); hoạt động không phải TASK hoặc việc của người khác không mở đường', async () => {
    const o = await opp(fx.empA, { amount: BigInt(SECRET_AMOUNT) });
    const o2 = await opp(fx.empA);
    const o3 = await opp(fx.empA);
    const tk = await task('salesA', o.id, techD); // nội bộ: techD đọc được khách theo phòng
    expect(await prisma.activityAccess.count({ where: { activityId: tk.id } })).toBe(0);
    const note = await a('salesA').post(O + '/' + o2.id + '/activities', { type: 'NOTE', content: 'Ghi chú giao cho kỹ thuật', performedById: techD });
    expect(note.status).toBe(201);
    await task('salesA', o3.id, undefined); // việc của chính A
    expect((await getOpp('techDp', o.id)).body.data).toMatchObject({ access: 'TASK' });
    expect(JSON.stringify((await getOpp('techDp', o.id)).body)).not.toContain(SECRET_AMOUNT);
    expect((await getOpp('techDp', o2.id)).status).toBe(404);
    expect((await getOpp('techDp', o3.id)).status).toBe(404);
    const seen = await listIds('techDp', '&customerId=' + cA.id);
    expect(seen).toContain(o.id);
    expect(seen).not.toContain(o2.id);
    expect(seen).not.toContain(o3.id);
  });

  it('người đạt CẢ HAI đường với cùng một cơ hội => đầy đủ; chỉ đạt đường theo việc => bản kỹ thuật', async () => {
    preset('bothB', fx.empB, fx.d1, { ...SALES, 'opportunity.read_assigned': 'OWN', 'activity.update_own': 'DEPARTMENT' });
    t.access.scopes.set(fx.empB, { ...SALES, 'activity.update_own': 'DEPARTMENT' });
    try {
      const mine = await opp(fx.empB, { amount: BigInt(SECRET_AMOUNT) }); // B phụ trách cơ hội
      await task('bothB', mine.id, undefined, true); // B không đọc được khách => tự nhận phải qua nhánh giao ngoài phạm vi (PR245-R1-01)
      const theirs = await opp(fx.empA, { amount: BigInt(SECRET_AMOUNT) }); // cơ hội của A, B chỉ có việc được giao (ngoài phạm vi khách)
      await task('salesA', theirs.id, fx.empB, true);
      expect((await getOpp('bothB', mine.id)).body.data).toMatchObject({ access: 'FULL', expectedAmountVnd: SECRET_AMOUNT });
      const tech = await getOpp('bothB', theirs.id);
      expect(tech.body.data.access).toBe('TASK');
      expect(JSON.stringify(tech.body)).not.toContain(SECRET_AMOUNT);
      const l = await a('bothB').get(O + '?pageSize=100&customerId=' + cA.id);
      const byId = new Map((l.body.data.items as Array<{ id: string; access: string; expectedAmountVnd?: string }>).map((x) => [x.id, x]));
      expect(byId.get(mine.id)).toMatchObject({ access: 'FULL', expectedAmountVnd: SECRET_AMOUNT });
      expect(byId.get(theirs.id)).toMatchObject({ access: 'TASK' });
      expect(byId.get(theirs.id)).not.toHaveProperty('expectedAmountVnd');
    } finally { t.access.scopes.set(fx.empB, SALES); }
  });
});

describe('§5.5(a) — GET /opportunities/:id/activities: chỉ hoạt động của đúng cơ hội, lọc theo đường truy cập TRƯỚC khi đếm', () => {
  let o: Ref; let n1 = ''; let t1 = ''; let t2 = ''; let t3 = ''; let unrelated = ''; let ofOther = ''; let contactName = '';
  beforeAll(async () => {
    o = await opp(fx.empB); // B phụ trách cơ hội ở khách của A
    contactName = 'S9 liên hệ ' + uniq();
    const ct = await makeContact(prisma, cA.id, contactName);
    // Liên hệ này KHÔNG phải liên hệ của cơ hội => chỉ người có contact.read trong phạm vi mới gắn được (PR245-R1-02).
    const note = await a('crmAdmin').post(O + '/' + o.id + '/activities', { type: 'NOTE', content: 'Ghi chú của cơ hội', contactId: ct.id });
    expect(note.status).toBe(201);
    n1 = note.body.data.id;
    t1 = (await task('salesB', o.id, techX, true)).id;
    t2 = (await task('salesB', o.id, techX, true)).id;
    expect((await a('salesA').post(ACT + '/' + t2 + '/access/revoke', { employeeId: techX })).status).toBe(200); // B3 đã từ chối techX với việc này
    t3 = (await task('salesB', o.id, techD)).id;
    const u = await a('salesA').post('/api/v1/customers/' + cA.id + '/activities', { type: 'NOTE', content: 'Hoạt động không gắn cơ hội' });
    expect(u.status).toBe(201);
    unrelated = u.body.data.id;
    const oo = await opp(fx.empA);
    ofOther = (await task('salesA', oo.id, undefined)).id;
  });
  it('đường đầy đủ: người phụ trách cơ hội (không đọc khách) thấy MỌI hoạt động của cơ hội, không thấy hoạt động khác của khách; không nhận người liên hệ', async () => {
    const r = await actIds('salesB', o.id);
    expect(r).toMatchObject({ ids: [n1, t1, t2, t3].sort(), total: 4, access: 'FULL' });
    expect(r.ids).not.toContain(unrelated);
    expect(r.ids).not.toContain(ofOther);
    expect(r.items.every((x) => x.contact === null && x.opportunityId === o.id)).toBe(true);
    expect(JSON.stringify(r.items)).not.toContain(contactName);
    // API Hoạt động chung KHÔNG đổi: B không mở được timeline khách, chi tiết hoạt động, hay tạo hoạt động theo khách.
    expect((await a('salesB').get('/api/v1/customers/' + cA.id + '/activities')).status).toBe(404);
    expect((await a('salesB').get(ACT + '/' + n1)).status).toBe(404);
    expect((await a('salesB').post('/api/v1/customers/' + cA.id + '/activities', { type: 'NOTE', content: 'x' })).status).toBe(404);
  });
  it('người phụ trách khách và Kế toán (đường đầy đủ + contact.read trong phạm vi) thấy cả người liên hệ; bộ lọc type / status áp sau', async () => {
    for (const who of ['salesA', 'acctA', 'crmAdmin']) {
      const r = await actIds(who, o.id);
      expect({ who, ids: r.ids, total: r.total, access: r.access }).toEqual({ who, ids: [n1, t1, t2, t3].sort(), total: 4, access: 'FULL' });
      expect(r.items.find((x) => x.id === n1)?.contact).toMatchObject({ fullName: contactName });
    }
    expect(await actIds('salesA', o.id, '&type=NOTE')).toMatchObject({ ids: [n1], total: 1 });
    expect(await actIds('salesA', o.id, '&status=OPEN')).toMatchObject({ ids: [t1, t2, t3].sort(), total: 3 });
    expect((await a('salesA').get(O + '/' + o.id + '/activities?pageSize=2&page=2')).body.data).toMatchObject({ total: 4, totalPages: 2, page: 2 });
  });
  it('CHỈ đường theo việc: mỗi dòng phải là việc của chính mình VÀ B3 còn cho đọc — việc A còn hiệu lực không mở việc B đã bị thu hồi; tổng số tính sau lọc', async () => {
    expect(await actIds('techXp', o.id)).toMatchObject({ ids: [t1], total: 1, access: 'TASK' }); // t2: quyền đã thu hồi; t3: của người khác; n1: không phải của mình
    expect(await actIds('techXp', o.id, '&status=DONE')).toMatchObject({ ids: [], total: 0 });
    expect(await actIds('techDp', o.id)).toMatchObject({ ids: [t3], total: 1, access: 'TASK' });
    expect((await actIds('techXp', o.id)).items[0].contact).toBeNull();
    // Chi tiết từng việc vẫn do B3 quyết định.
    expect((await a('techXp').get(ACT + '/' + t1)).status).toBe(200);
    expect((await a('techXp').get(ACT + '/' + t2)).status).toBe(404);
    expect((await a('techXp').get(ACT + '/' + t3)).status).toBe(404);
  });
  it('không thấy cơ hội => 404; không có mã đọc cơ hội nào => 403; tham số sai => 400', async () => {
    expect((await a('salesC').get(O + '/' + o.id + '/activities')).status).toBe(404);
    expect((await a('salesA').get(O + '/' + GHOST + '/activities')).status).toBe(404);
    expect((await a('none').get(O + '/' + o.id + '/activities')).status).toBe(403);
    expect((await a('salesA').get(O + '/' + o.id + '/activities?pageSize=1000')).status).toBe(400);
    expect((await a('salesA').get(O + '/' + o.id + '/activities?type=KHAC')).status).toBe(400);
  });
});

describe('§5.5(b) — POST /opportunities/:id/activities: ba kiểm độc lập (cơ hội, mã hoạt động, người nhận)', () => {
  let o: Ref;
  beforeAll(async () => { o = await opp(fx.empB); });
  const create = (who: string, body: object, id = o.id) => a(who).post(O + '/' + id + '/activities', body);
  const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
  it('người phụ trách cơ hội (không phụ trách khách) tạo được hoạt động; luôn gắn đúng cơ hội và khách của cơ hội; có nhật ký', async () => {
    t.audit.entries.length = 0;
    const r = await create('salesB', { type: 'CALL', content: 'Gọi khách xác nhận nhu cầu', outcome: 'Hẹn khảo sát' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ opportunityId: o.id, customerId: cA.id, type: 'CALL', status: 'DONE', performedBy: { id: fx.empB } });
    expect(await prisma.activity.findUniqueOrThrow({ where: { id: r.body.data.id }, select: { opportunityId: true, customerId: true, createdById: true, opportunityAutoKind: true } }))
      .toEqual({ opportunityId: o.id, customerId: cA.id, createdById: fx.empB, opportunityAutoKind: null });
    const log = t.audit.entries.find((e) => e.action === 'activity.create' && e.entityId === r.body.data.id);
    expect(log?.changes).toMatchObject({ opportunityId: [null, o.id], customerId: [null, cA.id] });
    expect(JSON.stringify(log)).not.toContain('Gọi khách xác nhận nhu cầu');
    expect((await create('crmAdmin', { type: 'NOTE', content: 'Quản trị ghi chú' })).status).toBe(201);
  });
  it('kiểm 1 — cơ hội: không thấy => 404; thấy nhưng không đạt opportunity.update => 403 (người phụ trách khách chỉ-đọc, Kế toán, Kỹ thuật theo việc)', async () => {
    await task('salesB', o.id, techD);
    const before = await prisma.activity.count({ where: { opportunityId: o.id } });
    expect(err(await create('salesC', { type: 'NOTE', content: 'x' }))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await create('salesA', { type: 'NOTE', content: 'x' }, GHOST))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    for (const who of ['salesA', 'acctA', 'techDp']) expect({ who, ...err(await create(who, { type: 'NOTE', content: 'x' })) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
    expect((await create('none', { type: 'NOTE', content: 'x' })).status).toBe(403);
    expect(await prisma.activity.count({ where: { opportunityId: o.id } })).toBe(before);
  });
  it('kiểm 2 — mã hoạt động: không có activity.create / create_tech => 403; chỉ create_tech => chỉ 3 loại kỹ thuật; opportunityId khác trong nội dung => 400', async () => {
    const noAct: Scopes = { ...SALES }; delete noAct['activity.create'];
    preset('oppB', fx.empB, fx.d1, noAct);
    expect(err(await create('oppB', { type: 'NOTE', content: 'x' }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    preset('oppB', fx.empB, fx.d1, { ...noAct, 'activity.create_tech': 'DEPARTMENT' });
    expect(err(await create('oppB', { type: 'CALL', content: 'x' }))).toEqual({ s: 403, code: 'ACTIVITY_TYPE_NOT_ALLOWED' });
    expect((await create('oppB', { type: 'SITE_SURVEY', content: 'Khảo sát hiện trường' })).status).toBe(201);
    expect((await create('salesB', { type: 'NOTE', content: 'x', opportunityId: GHOST })).status).toBe(400);
    expect((await create('salesB', { type: 'TASK', content: 'thiếu hạn' })).status).toBe(400);
  });
  it('kiểm 3 — người nhận theo đúng quy tắc B3: nội bộ / ngoài phạm vi (cấp activity_access cùng transaction) / từ chối', async () => {
    const mk = (performedById: string, extra: object = {}, who = 'salesB') => create(who, { type: 'TASK', content: 'Việc giao ' + uniq(), dueAt: due(), performedById, ...extra });
    const internal = await mk(acctE); // Kế toán đọc được khách, cùng phòng với B
    expect(internal.status).toBe(201);
    expect(await prisma.activityAccess.count({ where: { activityId: internal.body.data.id } })).toBe(0);
    const ext = await mk(techX, { external: true });
    expect(ext.status).toBe(201);
    expect(await prisma.activityAccess.findMany({ where: { activityId: ext.body.data.id, revokedAt: null }, select: { employeeId: true, grantedById: true } })).toEqual([{ employeeId: techX, grantedById: fx.empB }]);
    expect((await a('techXp').get(ACT + '/' + ext.body.data.id + '/work-card')).status).toBe(200); // quyền theo việc của B3 hoạt động như thường

    expect(err(await mk(techX))).toEqual({ s: 400, code: 'ACTIVITY_ASSIGNEE_INVALID' }); // không xin external: giao nội bộ phải cùng phòng (B3)
    expect(err(await mk(sameDept))).toEqual({ s: 400, code: 'ACTIVITY_ASSIGNEE_NO_ACCESS' }); // cùng phòng nhưng không đọc được khách, không xin external
    expect(err(await mk(goneF, { external: true }))).toEqual({ s: 400, code: 'ACTIVITY_ASSIGNEE_INVALID' });
    expect(err(await mk(GHOST, { external: true }))).toEqual({ s: 400, code: 'ACTIVITY_ASSIGNEE_INVALID' });
    expect(err(await mk(fx.empC, { external: true }))).toEqual({ s: 403, code: 'ACTIVITY_EXTERNAL_NOT_ALLOWED' }); // người nhận không có thẩm quyền kỹ thuật
    expect(err(await create('salesB', { type: 'NOTE', content: 'x', performedById: techX, external: true }))).toEqual({ s: 400, code: 'ACTIVITY_EXTERNAL_NOT_ALLOWED' }); // không phải TASK
    const noAssign: Scopes = { ...SALES }; delete noAssign['activity.assign'];
    preset('oppB', fx.empB, fx.d1, noAssign);
    expect(err(await mk(acctE, {}, 'oppB'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    const noExt: Scopes = { ...SALES }; delete noExt['activity.assign_external'];
    preset('oppB', fx.empB, fx.d1, noExt);
    expect(err(await mk(techX, { external: true }, 'oppB'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await mk(acctE, {}, 'oppB')).status).toBe(201); // giao nội bộ không cần assign_external
    for (const r of [await mk(techX), await mk(fx.empC, { external: true })]) expect(leaks(r.body)).toBe(false);
  });
  it('khách của cơ hội đã bị xoá mềm => cơ hội ẩn theo => 404, không tạo gì', async () => {
    const cDel = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    const od = await opp(fx.empA, {}, cDel.id);
    await prisma.customer.update({ where: { id: cDel.id }, data: { deletedAt: new Date(), deletedById: fx.empA } });
    expect((await create('salesA', { type: 'NOTE', content: 'x' }, od.id)).status).toBe(404);
    expect(await prisma.activity.count({ where: { opportunityId: od.id } })).toBe(0);
  });
});

describe('§5.5(c) — opportunityId qua API Hoạt động chung: cùng khách là CHƯA đủ', () => {
  let mine: Ref; let mine2: Ref; let ofB: Ref; let otherCust: Ref; let deleted: Ref;
  const C = () => '/api/v1/customers/' + cA.id + '/activities';
  const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
  const linkOf = async (id: string) => (await prisma.activity.findUniqueOrThrow({ where: { id }, select: { opportunityId: true, version: true } }));
  beforeAll(async () => {
    mine = await opp(fx.empA); mine2 = await opp(fx.empA); ofB = await opp(fx.empB);
    otherCust = await opp(fx.empA, {}, cA2.id);
    deleted = await opp(fx.empA, { deleted: true });
  });
  it('TẠO: cơ hội mình sửa được => gắn được; không thấy => 404; thấy nhưng chỉ-đọc => 403; khác khách => 400; không gửi => như cũ', async () => {
    const before = await prisma.activity.count({ where: { customerId: cA.id } });
    const ok = await a('salesA').post(C(), { type: 'NOTE', content: 'Gắn cơ hội của mình', opportunityId: mine.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.opportunityId).toBe(mine.id);
    const plain = await a('salesA').post(C(), { type: 'NOTE', content: 'Không gắn' });
    expect(plain.body.data.opportunityId).toBeNull();
    expect(err(await a('salesA').post(C(), { type: 'NOTE', content: 'x', opportunityId: ofB.id }))).toEqual({ s: 403, code: 'FORBIDDEN' }); // A phụ trách khách, chỉ đọc cơ hội của B
    expect(err(await a('salesA').post(C(), { type: 'NOTE', content: 'x', opportunityId: GHOST }))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await a('salesA').post(C(), { type: 'NOTE', content: 'x', opportunityId: deleted.id }))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await a('salesA').post(C(), { type: 'NOTE', content: 'x', opportunityId: otherCust.id }))).toEqual({ s: 400, code: 'ACTIVITY_OPPORTUNITY_MISMATCH' });
    // Kỹ thuật đọc được khách nhưng không thấy cơ hội => 404; thấy qua việc nhưng không có opportunity.update => 403.
    expect(err(await a('techDp').post(C(), { type: 'NOTE', content: 'x', opportunityId: mine2.id }))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    await task('salesA', mine2.id, techD);
    expect(err(await a('techDp').post(C(), { type: 'NOTE', content: 'x', opportunityId: mine2.id }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await a('techDp').post(C(), { type: 'NOTE', content: 'Kỹ thuật ghi chú theo khách' })).status).toBe(201); // quyền B3 của Kỹ thuật giữ nguyên
    expect((await a('crmAdmin').post(C(), { type: 'NOTE', content: 'Quản trị gắn cơ hội của B', opportunityId: ofB.id })).status).toBe(201);
    expect(await prisma.activity.count({ where: { customerId: cA.id } })).toBe(before + 5); // ok + plain + việc của techD + ghi chú techD + quản trị
  });
  it('SỬA: gắn / đổi / bỏ phải đạt opportunity.update với TỪNG cơ hội liên quan (cũ và mới); sửa trường khác không bị ảnh hưởng', async () => {
    const x = (await a('salesA').post(C(), { type: 'NOTE', content: 'Hoạt động X' })).body.data as { id: string; version: number };
    const set = (who: string, id: string, version: number, opportunityId: string | null) => a(who).patch(ACT + '/' + id, { version, opportunityId });
    expect((await set('salesA', x.id, 1, mine.id)).body.data).toMatchObject({ opportunityId: mine.id, version: 2 });
    expect((await set('salesA', x.id, 2, mine.id)).body.data.version).toBe(2); // không đổi => không ghi
    expect(err(await set('salesA', x.id, 2, ofB.id))).toEqual({ s: 403, code: 'FORBIDDEN' }); // mới: chỉ đọc
    expect(err(await set('salesA', x.id, 2, GHOST))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await set('salesA', x.id, 2, otherCust.id))).toEqual({ s: 400, code: 'ACTIVITY_OPPORTUNITY_MISMATCH' });
    expect(await linkOf(x.id)).toEqual({ opportunityId: mine.id, version: 2 });
    expect((await set('salesA', x.id, 2, mine2.id)).body.data).toMatchObject({ opportunityId: mine2.id, version: 3 });
    expect((await set('salesA', x.id, 3, null)).body.data).toMatchObject({ opportunityId: null, version: 4 });

    // Hoạt động đang gắn cơ hội của B (B tạo qua đường Sales): A phụ trách khách, sửa được nội dung theo B3 nhưng KHÔNG bỏ / đổi được liên kết.
    const y = (await a('salesB').post(O + '/' + ofB.id + '/activities', { type: 'NOTE', content: 'Hoạt động Y của cơ hội B' })).body.data as { id: string; version: number };
    expect(err(await set('salesA', y.id, 1, null))).toEqual({ s: 403, code: 'FORBIDDEN' }); // cũ: chỉ đọc
    expect(err(await set('salesA', y.id, 1, mine.id))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(await linkOf(y.id)).toEqual({ opportunityId: ofB.id, version: 1 });
    expect((await a('salesA').patch(ACT + '/' + y.id, { version: 1, content: 'A sửa nội dung theo quyền B3' })).status).toBe(200);
    expect((await set('crmAdmin', y.id, 2, mine.id)).body.data).toMatchObject({ opportunityId: mine.id }); // Quản trị CRM đạt update với cả hai
    expect(t.audit.entries.some((e) => e.action === 'activity.update' && e.entityId === y.id && JSON.stringify(e.changes).includes(ofB.id))).toBe(true);
  });
  it('việc TỰ SINH của cơ hội không đổi / bỏ được cơ hội gắn kèm => 409, dòng không đổi', async () => {
    const h = await opp(fx.empA);
    expect((await a('salesA').post(O + '/' + h.id + '/hold', { version: 1, holdUntil: '2099-01-01', holdReason: 'Chờ' })).status).toBe(200);
    const r = await prisma.activity.findFirstOrThrow({ where: { opportunityId: h.id, opportunityAutoKind: 'HOLD_REMINDER' }, select: { id: true, version: true } });
    expect(err(await a('salesA').patch(ACT + '/' + r.id, { version: r.version, opportunityId: null }))).toEqual({ s: 409, code: 'ACTIVITY_AUTO_TASK' });
    expect(err(await a('salesA').patch(ACT + '/' + r.id, { version: r.version, opportunityId: mine.id }))).toEqual({ s: 409, code: 'ACTIVITY_AUTO_TASK' });
    expect(await linkOf(r.id)).toEqual({ opportunityId: h.id, version: r.version });
  });
});

// ───── Review R1 của PR #245 ─────
describe('PR245-R1-01 — TASK ở đường Sales luôn qua kiểm NGƯỜI NHẬN, kể cả khi để mặc định hoặc tự chọn chính mình', () => {
  const create = (who: string, id: string, body: object) => a(who).post(O + '/' + id + '/activities', body);
  const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
  const TASK = () => ({ type: 'TASK', content: 'Việc tự nhận ' + uniq(), dueAt: due() });
  const count = (oppId: string) => prisma.activity.count({ where: { opportunityId: oppId } });
  afterEach(() => { t.access.scopes.set(fx.empB, SALES); });

  it('người phụ trách cơ hội NGOÀI phạm vi khách, không có thẩm quyền kỹ thuật: tự nhận TASK (mặc định hoặc gửi UUID của mình) bị từ chối, không ghi gì; hoạt động không phải TASK vẫn tạo được', async () => {
    const o = await opp(fx.empB); // B phụ trách cơ hội ở khách của A; B không đọc được khách
    for (const body of [TASK(), { ...TASK(), performedById: fx.empB }, { ...TASK(), performedById: fx.empB.toUpperCase() }]) {
      expect({ body, ...err(await create('salesB', o.id, body)) }).toEqual({ body, s: 400, code: 'ACTIVITY_ASSIGNEE_NO_ACCESS' });
      // Xin giao ngoài phạm vi cho chính mình: B không có activity.update_own => không thể được cấp quyền theo việc => từ chối.
      expect({ body, ...err(await create('salesB', o.id, { ...body, external: true })) }).toEqual({ body, s: 403, code: 'ACTIVITY_EXTERNAL_NOT_ALLOWED' });
    }
    expect(await count(o.id)).toBe(0);
    expect(await prisma.activityAccess.count({ where: { employeeId: fx.empB, activity: { opportunityId: o.id } } })).toBe(0);
    expect((await create('salesB', o.id, { type: 'NOTE', content: 'Ghi chú của người phụ trách cơ hội' })).status).toBe(201);
  });

  it('người phụ trách cơ hội ngoài phạm vi khách CÓ thẩm quyền kỹ thuật: tự nhận với external=true => được cấp activity_access cùng transaction, đọc và hoàn thành được qua API Công việc; thiếu external / thiếu quyền giao => từ chối, không ghi dở', async () => {
    const withTech = { ...SALES, 'activity.update_own': 'DEPARTMENT' } as Scopes;
    t.access.scopes.set(fx.empB, withTech);
    preset('extB', fx.empB, fx.d1, withTech);
    const o = await opp(fx.empB);
    expect(err(await create('extB', o.id, TASK()))).toEqual({ s: 400, code: 'ACTIVITY_ASSIGNEE_NO_ACCESS' }); // không xin external
    const noExt: Scopes = { ...withTech }; delete noExt['activity.assign_external'];
    preset('extB', fx.empB, fx.d1, noExt);
    expect(err(await create('extB', o.id, { ...TASK(), external: true }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    const noAssign: Scopes = { ...withTech }; delete noAssign['activity.assign'];
    preset('extB', fx.empB, fx.d1, noAssign);
    expect(err(await create('extB', o.id, { ...TASK(), external: true }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(await count(o.id)).toBe(0);
    expect(await prisma.activityAccess.count({ where: { employeeId: fx.empB, activity: { opportunityId: o.id } } })).toBe(0);

    preset('extB', fx.empB, fx.d1, withTech);
    for (const extra of [{}, { performedById: fx.empB }]) {
      const r = await create('extB', o.id, { ...TASK(), external: true, ...extra });
      expect(r.status).toBe(201);
      expect(r.body.data.performedBy.id).toBe(fx.empB);
      expect(await prisma.activityAccess.findMany({ where: { activityId: r.body.data.id, revokedAt: null }, select: { employeeId: true, grantedById: true } })).toEqual([{ employeeId: fx.empB, grantedById: fx.empB }]);
      // Việc không còn "mồ côi": chính người được giao đọc và hoàn thành được qua API Công việc của B3.
      expect((await a('extB').get(ACT + '/' + r.body.data.id)).body.data).toMatchObject({ id: r.body.data.id, access: 'TASK' });
      expect((await a('extB').post(ACT + '/' + r.body.data.id + '/complete', { version: r.body.data.version })).status).toBe(200);
    }
  });

  it('đối chứng: người phụ trách cơ hội ĐỌC ĐƯỢC khách tự nhận TASK như cũ (không cần activity.assign, không cấp activity_access); đường theo khách của B3 không đổi', async () => {
    const o = await opp(fx.empA);
    const noAssign: Scopes = { ...SALES }; delete noAssign['activity.assign']; delete noAssign['activity.assign_external'];
    preset('ownA', fx.empA, fx.d1, noAssign);
    for (const body of [TASK(), { ...TASK(), performedById: fx.empA }]) {
      const r = await create('ownA', o.id, body);
      expect(r.status).toBe(201);
      expect(await prisma.activityAccess.count({ where: { activityId: r.body.data.id } })).toBe(0);
      expect((await a('ownA').post(ACT + '/' + r.body.data.id + '/complete', { version: r.body.data.version })).status).toBe(200);
    }
    const viaCustomer = await a('ownA').post('/api/v1/customers/' + cA.id + '/activities', TASK());
    expect(viaCustomer.status).toBe(201);
    expect((await a('salesB').post('/api/v1/customers/' + cA.id + '/activities', TASK())).status).toBe(404); // B vẫn không tạo được theo khách
  });
});

describe('PR245-R1-02 — người liên hệ ở đường Sales: cùng một chính sách cho phản hồi POST và danh sách; không gắn được liên hệ ngoài phạm vi', () => {
  const create = (who: string, id: string, body: object) => a(who).post(O + '/' + id + '/activities', body);
  it('người phụ trách cơ hội ngoài phạm vi contact.read: chỉ gắn được liên hệ CỦA CHÍNH CƠ HỘI; phản hồi POST và danh sách đều che liên hệ; liên hệ khác của khách => 400, không ghi', async () => {
    const oppContactName = 'S9 liên hệ của cơ hội ' + uniq(); const otherName = 'S9 liên hệ khác ' + uniq();
    const oppContact = await makeContact(prisma, cA.id, oppContactName);
    const other = await makeContact(prisma, cA.id, otherName);
    const o = await opp(fx.empB, { contactId: oppContact.id });

    const bad = await create('salesB', o.id, { type: 'NOTE', content: 'Gắn liên hệ khác của khách', contactId: other.id });
    expect({ s: bad.status, code: bad.body.error?.code }).toEqual({ s: 400, code: 'ACTIVITY_CONTACT_MISMATCH' });
    expect(JSON.stringify(bad.body)).not.toContain(otherName);
    expect(await prisma.activity.count({ where: { opportunityId: o.id } })).toBe(0);

    const ok = await create('salesB', o.id, { type: 'NOTE', content: 'Gắn liên hệ của cơ hội', contactId: oppContact.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.contact).toBeNull(); // cùng chính sách với danh sách: không có contact.read trong phạm vi => che
    expect(JSON.stringify(ok.body)).not.toContain(oppContactName);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: ok.body.data.id }, select: { contactId: true } })).contactId).toBe(oppContact.id); // vẫn lưu đúng
    expect((await actIds('salesB', o.id)).items.find((x) => x.id === ok.body.data.id)?.contact).toBeNull();
    // Đối chứng: người có contact.read trong phạm vi chủ khách thấy liên hệ ở cả danh sách lẫn phản hồi POST, và gắn được liên hệ bất kỳ của khách.
    expect((await actIds('salesA', o.id)).items.find((x) => x.id === ok.body.data.id)?.contact).toMatchObject({ fullName: oppContactName });
    const admin = await create('crmAdmin', o.id, { type: 'NOTE', content: 'Quản trị gắn liên hệ khác', contactId: other.id });
    expect(admin.status).toBe(201);
    expect(admin.body.data.contact).toMatchObject({ id: other.id, fullName: otherName });
    const mine = await opp(fx.empA);
    const own = await create('salesA', mine.id, { type: 'NOTE', content: 'A gắn liên hệ của khách mình phụ trách', contactId: other.id });
    expect(own.status).toBe(201);
    expect(own.body.data.contact).toMatchObject({ id: other.id, fullName: otherName });
  });
});

describe('T-04 — GET /opportunities/board-summary với đường theo việc: không bao giờ nhận số tiền của cơ hội chỉ thấy qua việc', () => {
  it('Kỹ thuật chỉ có read_assigned => 403; người đạt CẢ HAI đường: cơ hội chỉ thấy qua việc bị loại khỏi CẢ số đếm LẪN tổng tiền, cơ hội đầy đủ của chính mình vẫn được tính', async () => {
    const tok = 't04' + uniq().replace(/[^a-z0-9]/gi, '');
    const viaTask = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'S9 ' + tok + ' qua viec', stage: 'PROSPECTING', amount: BigInt(SECRET_AMOUNT) });
    await task('salesA', viaTask.id, techX, true);
    const tech = await a('techXp').get(O + '/board-summary?q=' + tok);
    expect({ s: tech.status, code: tech.body.error?.code }).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(JSON.stringify(tech.body)).not.toContain(SECRET_AMOUNT);
    expect(await listIds('techXp', '&q=' + tok)).toEqual([viaTask.id]); // đối chứng: vẫn thấy bản kỹ thuật trong danh sách
    // Đạt cả hai đường: đầy đủ với cơ hội mình phụ trách (own), theo việc với viaTask.
    const own = await makeOpportunity(prisma, fx, { customerId: cA2.id, ownerId: techX, title: 'S9 ' + tok + ' cua minh', stage: 'PROSPECTING', amount: 5_000n });
    preset('techXp', techX, fx.d2, { ...TECH, 'opportunity.read': 'OWN' });
    const listed = (await a('techXp').get(O + '?pageSize=100&q=' + tok)).body.data.items as Array<{ id: string; access: string }>;
    expect(listed.map((x) => [x.id, x.access]).sort()).toEqual([[own.id, 'FULL'], [viaTask.id, 'TASK']].sort());
    const both = await a('techXp').get(O + '/board-summary?q=' + tok);
    expect(both.status).toBe(200);
    expect(both.body.data).toEqual({ stages: [{ stageId: fx.oppStage.PROSPECTING, count: 1, knownAmountCount: 1, unknownAmountCount: 0, sumExpectedAmountVnd: '5000' }], onHoldCount: 0 });
    expect(JSON.stringify(both.body)).not.toContain(SECRET_AMOUNT);
    // Người xem đầy đủ (Quản trị CRM) thấy cả hai.
    const admin = await a('crmAdmin').get(O + '/board-summary?q=' + tok);
    expect(admin.body.data.stages).toEqual([{ stageId: fx.oppStage.PROSPECTING, count: 2, knownAmountCount: 2, unknownAmountCount: 0, sumExpectedAmountVnd: String(BigInt(SECRET_AMOUNT) + 5_000n) }]);
  });
});
