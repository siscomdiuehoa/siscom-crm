// Sales S10a — các lựa chọn cho giao diện (docs/SALES_DESIGN.md §5.4, §6.5, §7, §8.3): GET /opportunities/meta,
// GET /opportunities/:id/owner-candidates, GET /opportunities/:id/handover-candidates. Chỉ đọc; danh sách ứng viên phải KHỚP với đúng điều kiện
// mà POST /assign và POST /win áp dụng (người có trong danh sách thì thao tác được; người không có thì bị từ chối).
import type { PrismaService } from '../src/prisma/prisma.service';
import { ACCT, as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, makeEmployee, makeOpportunity, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const GHOST = '00000000-0000-4000-8000-000000000001';
const WIN = { wonAmountVnd: '1250000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-2026-S10', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/hd-2026-s10' };
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who?: string) => as(t.app, who);
type Ref = { id: string; code: string };
type Item = { id: string; code: string; fullName: string; departmentCode: string | null };
let cA: Ref;
let techD = ''; let acctE = ''; let goneF = ''; let deptG = '';

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  techD = (await makeEmployee({ fullName: 'S10 Kỹ thuật ' + uniq(), departmentId: fx.d2 })).id;
  acctE = (await makeEmployee({ fullName: 'S10 Kế toán ' + uniq(), departmentId: fx.d1 })).id;
  goneF = (await makeEmployee({ fullName: 'S10 Đã nghỉ ' + uniq(), departmentId: fx.d1, status: 'RESIGNED' })).id;
  deptG = (await makeEmployee({ fullName: 'S10 Phạm vi phòng ' + uniq(), departmentId: fx.d1 })).id;
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, SALES); t.access.scopes.set(fx.empC, SALES);
  t.access.scopes.set(techD, TECH); t.access.scopes.set(acctE, ACCT); t.access.scopes.set(goneF, SALES);
  t.access.scopes.set(deptG, { 'opportunity.read': 'DEPARTMENT', 'opportunity.update': 'DEPARTMENT' });
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA });
});
afterEach(() => { t.eligibility.blocked.clear(); });
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

const opp = (ownerId: string, extra: object = {}) => makeOpportunity(prisma, fx, { customerId: cA.id, ownerId, title: 'S10 ' + uniq(), stage: 'PROSPECTING', ...extra });
const ids = (r: { body: { data: { items: Item[] } } }) => r.body.data.items.map((x) => x.id);
const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });

describe('GET /opportunities/meta — danh mục kèm ID cho biểu mẫu', () => {
  it('trả giai đoạn (đúng thứ tự, kèm xác suất mặc định), loại (kèm cờ bắt buộc gắn dự án), lý do thua (kèm cờ bắt buộc ghi chú); chỉ các khoá đã nêu', async () => {
    const r = await a('salesA').get(O + '/meta');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(Object.keys(d).sort()).toEqual(['lostReasons', 'stages', 'types']);
    // Giai đoạn thử (T_APPROACH, T_QUOTE) không có xác suất mặc định trong mã nguồn => đường ghi từ chối => không đưa ra làm lựa chọn.
    expect(d.stages.map((x: { code: string; defaultProbability: number }) => [x.code, x.defaultProbability])).toEqual([['PROSPECTING', 10], ['SURVEY', 25], ['QUOTATION', 45], ['NEGOTIATION', 70]]);
    for (const s of d.stages) { expect(Object.keys(s).sort()).toEqual(['code', 'defaultProbability', 'id', 'label']); expect(s.id).toBe(fx.oppStage[s.code]); }
    const type = (code: string) => d.types.find((x: { code: string }) => x.code === code);
    expect(type('SUPPLY')).toEqual({ id: fx.oppType.SUPPLY, code: 'SUPPLY', label: 'Cung cấp thiết bị, vật tư', requiresProject: false });
    expect(type('INSTALLATION')).toMatchObject({ id: fx.oppType.INSTALLATION, requiresProject: true });
    expect(type('SUPPLY_INSTALLATION')).toMatchObject({ id: fx.oppType.SUPPLY_INSTALLATION, requiresProject: true });
    const reason = (code: string) => d.lostReasons.find((x: { code: string }) => x.code === code);
    expect(reason('OTHER')).toEqual({ id: fx.oppLostReason.OTHER, code: 'OTHER', label: 'Khác (kèm ghi chú)', requiresNote: true });
    expect(reason('PRICE_HIGHER')).toMatchObject({ id: fx.oppLostReason.PRICE_HIGHER, requiresNote: false });
    expect(d.lostReasons.filter((x: { requiresNote: boolean }) => x.requiresNote).map((x: { code: string }) => x.code)).toEqual(['OTHER']);
  });

  it('ID lấy từ meta dùng được ngay cho API ghi: tạo cơ hội bằng typeId, đổi giai đoạn bằng stageId, chốt Thua bằng lostReasonId', async () => {
    const d = (await a('salesA').get(O + '/meta')).body.data;
    const pick = (list: Array<{ code: string; id: string }>, code: string) => (list.find((x) => x.code === code) as { id: string }).id;
    const made = await a('salesA').post(O, { customerId: cA.id, title: 'S10 từ meta ' + uniq(), typeId: pick(d.types, 'SUPPLY'), needSummary: 'Cần 20 FCU' });
    expect(made.status).toBe(201);
    const moved = await a('salesA').post(O + '/' + made.body.data.id + '/stage', { version: made.body.data.version, stageId: pick(d.stages, 'SURVEY') });
    expect(moved.status).toBe(201);
    expect(moved.body.data).toMatchObject({ stage: { code: 'SURVEY' }, probability: 25 });
    const lost = await a('salesA').post(O + '/' + made.body.data.id + '/lose', { version: moved.body.data.version, lostReasonId: pick(d.lostReasons, 'PRICE_HIGHER') });
    expect(lost.status).toBe(200);
    expect(lost.body.data).toMatchObject({ status: 'LOST', lostReason: { code: 'PRICE_HIGHER' } });
  });

  it('quyền: cần opportunity.read — Kế toán (chỉ đọc) xem được; Kỹ thuật (chỉ read_assigned), người không có mã => 403; chưa đăng nhập => 401; "meta" không bị coi là id', async () => {
    expect((await a('acctA').get(O + '/meta')).status).toBe(200);
    expect((await a('crmAdmin').get(O + '/meta')).status).toBe(200);
    expect(err(await a('techB').get(O + '/meta'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(err(await a('none').get(O + '/meta'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await a().get(O + '/meta')).status).toBe(401);
  });
});

describe('GET /opportunities/:id/owner-candidates — người có thể nhận khi chuyển người phụ trách (cùng điều kiện với /assign)', () => {
  it('Kinh doanh phụ trách cơ hội: chỉ thấy người ACTIVE cùng phòng, đủ quyền đảm nhận; không có người đang phụ trách, khác phòng, đã nghỉ, Kỹ thuật, Kế toán, phạm vi DEPARTMENT', async () => {
    const o = await opp(fx.empA);
    const r = await a('salesA').get(O + '/' + o.id + '/owner-candidates');
    expect(r.status).toBe(200);
    expect(ids(r)).toContain(fx.empB);
    for (const out of [fx.empA, fx.empC, techD, acctE, goneF, deptG]) expect(ids(r)).not.toContain(out);
    for (const x of r.body.data.items) expect(Object.keys(x).sort()).toEqual(['code', 'departmentCode', 'fullName', 'id']);
    expect(Object.keys(r.body.data)).toEqual(['items']);
  });

  it('khớp với /assign: MỌI người trong danh sách đều chuyển được; người ngoài danh sách bị từ chối (một mã chung)', async () => {
    const o = await opp(fx.empA);
    const list = ids(await a('salesA').get(O + '/' + o.id + '/owner-candidates'));
    expect(list.length).toBeGreaterThan(0);
    for (const out of [fx.empC, techD, acctE, goneF, deptG]) {
      expect(err(await a('salesA').post(O + '/' + o.id + '/assign', { version: 1, ownerId: out, reason: 'thử' }))).toEqual({ s: 400, code: 'OPPORTUNITY_ASSIGNEE_INELIGIBLE' });
    }
    for (const to of list) {
      const fresh = await opp(fx.empA);
      expect({ to, s: (await a('salesA').post(O + '/' + fresh.id + '/assign', { version: 1, ownerId: to, reason: 'Bàn giao' })).status }).toEqual({ to, s: 201 });
    }
  });

  it('Quản trị CRM (assign phạm vi ALL): thấy cả người khác phòng đủ quyền; vẫn không có người đã nghỉ / Kỹ thuật / Kế toán / DEPARTMENT', async () => {
    const o = await opp(fx.empA);
    const r = await a('crmAdmin').get(O + '/' + o.id + '/owner-candidates');
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(expect.arrayContaining([fx.empB, fx.empC]));
    for (const out of [fx.empA, techD, acctE, goneF, deptG]) expect(ids(r)).not.toContain(out);
  });

  it('TC 9a(vii): người có tài khoản không dùng được (cổng auth) không nằm trong danh sách; phản hồi không nói vì sao', async () => {
    const o = await opp(fx.empA);
    t.eligibility.blocked.add(fx.empB);
    const r = await a('salesA').get(O + '/' + o.id + '/owner-candidates');
    expect(r.status).toBe(200);
    expect(ids(r)).not.toContain(fx.empB);
    expect(JSON.stringify(r.body)).not.toMatch(/tài khoản|credential|khoá|blocked|reason/i);
    t.eligibility.blocked.clear();
    expect(ids(await a('salesA').get(O + '/' + o.id + '/owner-candidates'))).toContain(fx.empB);
  });

  it('quyền như /assign: phụ trách khách nhưng không phụ trách cơ hội => 403; ngoài phạm vi => 404; Kế toán => 403; Kỹ thuật => 404; không mã => 403; không tồn tại / đã xoá => 404; id sai dạng => 400', async () => {
    const o = await opp(fx.empB); // B phụ trách cơ hội ở khách của A
    const get = (who: string, id = o.id) => a(who).get(O + '/' + id + '/owner-candidates');
    expect((await get('salesB')).status).toBe(200);
    expect(err(await get('salesA'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await get('salesC')).status).toBe(404);
    expect(err(await get('acctA'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await get('techB')).status).toBe(404);
    expect((await get('none')).status).toBe(403);
    expect((await get('crmAdmin', GHOST)).status).toBe(404);
    expect((await get('crmAdmin', 'khong-phai-uuid')).status).toBe(400);
    expect((await a().get(O + '/' + o.id + '/owner-candidates')).status).toBe(401);
    const gone = await opp(fx.empA);
    expect((await a('crmAdmin').delete(O + '/' + gone.id, { version: 1, reason: 'Nhập nhầm' })).status).toBe(200);
    expect((await get('crmAdmin', gone.id)).status).toBe(404);
    for (const who of ['salesA', 'salesC', 'acctA', 'techB', 'none']) expect(leaks((await get(who)).body)).toBe(false);
  });

  it('chỉ đọc: gọi danh sách không đổi cơ hội (version, người phụ trách), không ghi lịch sử, không ghi nhật ký', async () => {
    const o = await opp(fx.empA);
    const before = t.audit.entries.length;
    await a('salesA').get(O + '/' + o.id + '/owner-candidates');
    await a('salesA').get(O + '/' + o.id + '/handover-candidates');
    await a('salesA').get(O + '/meta');
    expect(await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id }, select: { version: true, ownerId: true } })).toEqual({ version: 1, ownerId: fx.empA });
    expect(await prisma.opportunityChange.count({ where: { opportunityId: o.id } })).toBe(0);
    expect(t.audit.entries.length).toBe(before);
  });
});

describe('GET /opportunities/:id/handover-candidates — người có thể nhận việc "Bàn giao thực hiện" (cùng điều kiện với /win)', () => {
  it('gồm người ACTIVE đọc được khách (kể cả chính người chốt) và người có thẩm quyền kỹ thuật ở mọi phòng; không có người đã nghỉ, người không đọc được khách và không có thẩm quyền kỹ thuật', async () => {
    const o = await opp(fx.empA);
    const r = await a('salesA').get(O + '/' + o.id + '/handover-candidates');
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(expect.arrayContaining([fx.empA, techD, acctE])); // A phụ trách khách; D kỹ thuật phòng khác; E đọc mọi khách
    for (const out of [fx.empB, fx.empC, goneF, deptG]) expect(ids(r)).not.toContain(out);
    for (const x of r.body.data.items) expect(Object.keys(x).sort()).toEqual(['code', 'departmentCode', 'fullName', 'id']);
  });

  it('khớp với /win: người trong danh sách nhận bàn giao được (nội bộ lẫn kỹ thuật ngoài phạm vi); người ngoài danh sách => 400 theo trường handoverToId, không ghi gì', async () => {
    const list = ids(await a('salesA').get(O + '/' + (await opp(fx.empA)).id + '/handover-candidates'));
    for (const out of [fx.empB, goneF, deptG]) {
      const o = await opp(fx.empA);
      const r = await a('salesA').post(O + '/' + o.id + '/win', { version: 1, ...WIN, handoverToId: out });
      expect({ out, s: r.status }).toEqual({ out, s: 400 });
      expect(JSON.stringify(r.body.error.details)).toContain('handoverToId');
      expect(await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id }, select: { status: true, version: true } })).toEqual({ status: 'OPEN', version: 1 });
    }
    for (const to of [fx.empA, techD, acctE]) {
      expect(list).toContain(to);
      const o = await opp(fx.empA);
      const r = await a('salesA').post(O + '/' + o.id + '/win', { version: 1, ...WIN, handoverToId: to });
      expect({ to, s: r.status }).toEqual({ to, s: 200 });
      expect(await prisma.activity.count({ where: { opportunityId: o.id, opportunityAutoKind: 'WIN_HANDOVER', performedById: to, status: 'OPEN' } })).toBe(1);
    }
  });

  it('người phụ trách cơ hội KHÔNG đọc được khách vẫn lấy được danh sách (API ứng viên của Hoạt động tính theo khách nên từ chối họ); bản thân họ không nằm trong danh sách', async () => {
    const o = await opp(fx.empB);
    const r = await a('salesB').get(O + '/' + o.id + '/handover-candidates');
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(expect.arrayContaining([fx.empA, techD]));
    expect(ids(r)).not.toContain(fx.empB);
    expect((await a('salesB').get('/api/v1/activities/assignee-candidates?customerId=' + cA.id)).status).not.toBe(200);
  });

  it('quyền như /win (opportunity.close): phụ trách khách không phụ trách cơ hội => 403; ngoài phạm vi => 404; Kế toán => 403; Kỹ thuật => 404; không mã => 403; không tồn tại => 404', async () => {
    const o = await opp(fx.empB);
    const get = (who: string, id = o.id) => a(who).get(O + '/' + id + '/handover-candidates');
    expect(err(await get('salesA'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await get('salesC')).status).toBe(404);
    expect(err(await get('acctA'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await get('techB')).status).toBe(404);
    expect((await get('none')).status).toBe(403);
    expect((await get('crmAdmin', GHOST)).status).toBe(404);
    expect((await get('crmAdmin')).status).toBe(200);
    expect((await a().get(O + '/' + o.id + '/handover-candidates')).status).toBe(401);
  });
});
