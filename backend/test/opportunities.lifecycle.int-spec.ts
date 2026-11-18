// Sales S8b — vòng đời trạng thái của cơ hội và CÔNG VIỆC TỰ SINH (docs/SALES_DESIGN.md §5.5(e), §6.4–6.8, §6.13; TC 5, 6, 9b, 12a, 12b, 12d):
// Tạm hoãn / đổi hạn / Tiếp tục / Thắng / Thua / Mở lại; việc nhắc tạm hoãn và việc bàn giao; nhật ký THẬT (DbAuditPort) và rollback NGUYÊN TỬ.
import type { INestApplication } from '@nestjs/common';
import { AUDIT_PORT, AuditEntry, AuditPort } from '../src/common/audit/audit.port';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ACCT, as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, makeEmployee, makeOpportunity, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const ACT = '/api/v1/activities';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let real: TestApp;
const a = (who: string, app: INestApplication = t.app) => as(app, who);
type Ref = { id: string; code: string };
let cA: Ref;
let techD = ''; let techX = ''; let acctE = ''; let goneF = '';

// Ngày YYYY-MM-DD theo giờ Việt Nam, lệch n ngày so với hôm nay.
const day = (n: number): string => new Date(Date.now() + 7 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const nineAm = (d: string): string => d + 'T02:00:00.000Z';

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  real = await makeApp(prisma, fx, { realAudit: true });
  techD = (await makeEmployee({ fullName: 'S8b Kỹ thuật cùng phòng ' + uniq(), departmentId: fx.d1 })).id;
  techX = (await makeEmployee({ fullName: 'S8b Kỹ thuật khác phòng ' + uniq(), departmentId: fx.d2 })).id;
  acctE = (await makeEmployee({ fullName: 'S8b Kế toán ' + uniq(), departmentId: fx.d1 })).id;
  goneF = (await makeEmployee({ fullName: 'S8b Đã nghỉ ' + uniq(), departmentId: fx.d1, status: 'RESIGNED' })).id;
  for (const x of [t, real]) {
    x.access.scopes.set(fx.empA, SALES); x.access.scopes.set(fx.empB, SALES); x.access.scopes.set(fx.empC, SALES);
    x.access.scopes.set(techD, TECH); x.access.scopes.set(techX, TECH); x.access.scopes.set(acctE, ACCT); x.access.scopes.set(goneF, TECH);
  }
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA });
});
afterAll(async () => { await t.app.close(); await real.app.close(); await prisma.$disconnect(); });

const opp = (ownerId: string, extra: object = {}) => makeOpportunity(prisma, fx, { customerId: cA.id, ownerId, title: 'S8b ' + uniq(), stage: 'PROSPECTING', ...extra });
const post = (who: string, id: string, action: string, body: object, app: INestApplication = t.app) => a(who, app).post(O + '/' + id + '/' + action, body);
const row = (id: string) => prisma.opportunity.findUniqueOrThrow({ where: { id } });
const hist = (id: string, field: 'STATUS' | 'HOLD') => prisma.opportunityChange.findMany({ where: { opportunityId: id, field }, orderBy: [{ changedAt: 'asc' }, { id: 'asc' }], select: { oldValue: true, newValue: true, reason: true, changedById: true } });
const TASK_SEL = { id: true, code: true, status: true, version: true, dueAt: true, performedById: true, opportunityAutoKind: true, title: true, content: true, outcome: true, type: true, customerId: true } as const;
const tasks = (id: string, kind?: 'HOLD_REMINDER' | 'WIN_HANDOVER') => prisma.activity.findMany({ where: { opportunityId: id, ...(kind ? { opportunityAutoKind: kind } : {}) }, orderBy: [{ createdAt: 'asc' }, { code: 'asc' }], select: TASK_SEL });
const WIN = { wonAmountVnd: '1250000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-2026-118', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/hd-2026-118' };
const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });

describe('Tạm hoãn / đổi hạn / Tiếp tục (§6.4, TC 5, 12a)', () => {
  it('OPEN → ON_HOLD: bắt buộc ngày + lý do; ghi lịch sử STATUS và HOLD; tạo ĐÚNG MỘT việc nhắc cho người phụ trách, hạn 09:00 giờ VN, tiêu đề không chứa giá trị', async () => {
    const o = await opp(fx.empA, { amount: 987654321n });
    const until = day(10);
    const r = await post('salesA', o.id, 'hold', { version: 1, holdUntil: until, holdReason: '  Khách chờ duyệt ngân sách  ' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: o.id, version: 2, status: 'ON_HOLD', holdUntil: until, holdReason: 'Khách chờ duyệt ngân sách' });
    expect(await hist(o.id, 'STATUS')).toEqual([{ oldValue: 'OPEN', newValue: 'ON_HOLD', reason: 'Khách chờ duyệt ngân sách', changedById: fx.empA }]);
    expect(await hist(o.id, 'HOLD')).toEqual([{ oldValue: null, newValue: until, reason: 'Khách chờ duyệt ngân sách', changedById: fx.empA }]);
    const ts = await tasks(o.id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ opportunityAutoKind: 'HOLD_REMINDER', type: 'TASK', status: 'OPEN', performedById: fx.empA, customerId: cA.id });
    expect(ts[0].dueAt?.toISOString()).toBe(nineAm(until));
    expect(ts[0].title + ' ' + ts[0].content).toContain(o.code);
    expect(ts[0].title + ' ' + ts[0].content).not.toContain('987654321');
  });
  it('đổi hạn khi đang tạm hoãn: cập nhật hạn của CHÍNH việc nhắc đó (không tạo việc thứ hai); gửi lại y hệt => không ghi gì, không tăng version', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Lý do 1' })).status).toBe(200);
    const first = (await tasks(o.id))[0];
    const r = await post('salesA', o.id, 'hold', { version: 2, holdUntil: day(20), holdReason: 'Lý do 2' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ version: 3, status: 'ON_HOLD', holdUntil: day(20), holdReason: 'Lý do 2' });
    const ts = await tasks(o.id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ id: first.id, status: 'OPEN', version: first.version + 1 });
    expect(ts[0].dueAt?.toISOString()).toBe(nineAm(day(20)));
    expect(await hist(o.id, 'STATUS')).toHaveLength(1); // không ghi STATUS lần hai
    expect(await hist(o.id, 'HOLD')).toMatchObject([{ oldValue: null, newValue: day(5) }, { oldValue: day(5), newValue: day(20), reason: 'Lý do 2' }]);
    const same = await post('salesA', o.id, 'hold', { version: 3, holdUntil: day(20), holdReason: 'Lý do 2' });
    expect(same.status).toBe(200);
    expect(same.body.data.version).toBe(3);
    expect(await hist(o.id, 'HOLD')).toHaveLength(2);
    expect((await tasks(o.id))[0].version).toBe(first.version + 1);
  });
  it('dữ liệu sai => 400; version cũ => 409; cơ hội đã đóng => 409 OPPORTUNITY_STATE; không tạo việc, không đổi cơ hội', async () => {
    const o = await opp(fx.empA);
    for (const body of [
      { version: 1, holdUntil: day(-1), holdReason: 'quá khứ' }, { version: 1, holdUntil: '2027-02-30', holdReason: 'ngày không có thật' }, { version: 1, holdUntil: day(3) },
      { version: 1, holdUntil: day(3), holdReason: '   ' }, { version: 1, holdReason: 'thiếu ngày' }, { holdUntil: day(3), holdReason: 'thiếu version' },
    ]) expect({ body, s: (await post('salesA', o.id, 'hold', body)).status }).toEqual({ body, s: 400 });
    expect(err(await post('salesA', o.id, 'hold', { version: 7, holdUntil: day(3), holdReason: 'x' }))).toEqual({ s: 409, code: 'OPPORTUNITY_VERSION_CONFLICT' });
    expect(await row(o.id)).toMatchObject({ status: 'OPEN', version: 1, holdUntil: null });
    expect(await tasks(o.id)).toEqual([]);
    for (const status of ['WON', 'LOST'] as const) {
      const closed = await opp(fx.empA, { status });
      expect(err(await post('salesA', closed.id, 'hold', { version: 1, holdUntil: day(3), holdReason: 'x' }))).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
      expect(await tasks(closed.id)).toEqual([]);
    }
  });
  it('hôm nay (giờ VN) là ngày hợp lệ', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(0), holdReason: 'Gọi lại trong ngày' })).status).toBe(200);
  });
  it('Tiếp tục: ON_HOLD → OPEN, giữ giai đoạn; việc nhắc còn mở => CANCELLED; tạm hoãn lại => việc nhắc MỚI (việc cũ không bị mở lại)', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ khách' })).status).toBe(200);
    const stageBefore = (await row(o.id)).stageId;
    const r = await post('salesA', o.id, 'resume', { version: 2, reason: 'Khách liên hệ lại' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ version: 3, status: 'OPEN', holdUntil: null, holdReason: null });
    expect(await row(o.id)).toMatchObject({ status: 'OPEN', stageId: stageBefore, holdReason: 'Chờ khách' }); // hold_* giữ làm dấu vết
    expect(await hist(o.id, 'STATUS')).toMatchObject([{ oldValue: 'OPEN', newValue: 'ON_HOLD' }, { oldValue: 'ON_HOLD', newValue: 'OPEN', reason: 'Khách liên hệ lại', changedById: fx.empA }]);
    expect(await tasks(o.id)).toMatchObject([{ status: 'CANCELLED', outcome: 'Cơ hội đã tiếp tục' }]);
    expect(err(await post('salesA', o.id, 'resume', { version: 3 }))).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' }); // đang mở thì không "tiếp tục" được
    expect((await post('salesA', o.id, 'hold', { version: 3, holdUntil: day(9), holdReason: 'Hoãn lần hai' })).status).toBe(200);
    const ts = await tasks(o.id);
    expect(ts.map((x) => x.status)).toEqual(['CANCELLED', 'OPEN']);
    expect(ts[1].id).not.toBe(ts[0].id);
  });
  it('việc nhắc đã được hoàn thành (DONE) rồi mới đổi hạn => tạo việc nhắc mới; việc đã DONE không bị đụng', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' })).status).toBe(200);
    const first = (await tasks(o.id))[0];
    expect((await a('salesA').post(ACT + '/' + first.id + '/complete', { version: first.version, outcome: 'Đã gọi, khách hẹn thêm' })).status).toBeLessThan(300);
    expect((await post('salesA', o.id, 'hold', { version: 2, holdUntil: day(15), holdReason: 'Khách hẹn thêm' })).status).toBe(200);
    const ts = await tasks(o.id);
    expect(ts.map((x) => x.status)).toEqual(['DONE', 'OPEN']);
    expect(ts[0]).toMatchObject({ id: first.id, outcome: 'Đã gọi, khách hẹn thêm' });
    expect(ts[1].dueAt?.toISOString()).toBe(nineAm(day(15)));
  });
  it('Tiếp tục áp lại luật R-S trên trạng thái Đang mở: cơ hội ở giai đoạn Báo giá chưa có giá trị dự kiến => 400, vẫn tạm hoãn, việc nhắc còn nguyên', async () => {
    const o = await opp(fx.empA, { stage: 'QUOTATION', needSummary: 'Cần 3 máy', status: 'ON_HOLD' });
    const r = await post('salesA', o.id, 'resume', { version: 1 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.error.details)).toContain('expectedAmountVnd');
    expect(await row(o.id)).toMatchObject({ status: 'ON_HOLD', version: 1 });
  });
  it('hai yêu cầu tạm hoãn đồng thời cùng version: một thành công, một 409; chỉ MỘT việc nhắc đang mở', async () => {
    const o = await opp(fx.empA);
    const rs = await Promise.all([
      post('salesA', o.id, 'hold', { version: 1, holdUntil: day(4), holdReason: 'Song song 1' }),
      post('salesA', o.id, 'hold', { version: 1, holdUntil: day(6), holdReason: 'Song song 2' }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await row(o.id)).toMatchObject({ status: 'ON_HOLD', version: 2 });
    expect(await tasks(o.id, 'HOLD_REMINDER')).toHaveLength(1);
    expect(await hist(o.id, 'STATUS')).toHaveLength(1);
  });
});

describe('Thắng / Thua (§6.5, §6.6, TC 6, 12b)', () => {
  it('Thắng từ Đang mở: lưu giá trị chốt + chứng từ, closed_at, lịch sử; tạo MỘT việc bàn giao cho người nhận đọc được khách (giao nội bộ, không cấp quyền theo việc); hạn mặc định 7 ngày', async () => {
    const o = await opp(fx.empA);
    const r = await post('salesA', o.id, 'win', { version: 1, ...WIN, wonDocNo: '  HD-2026-118  ', handoverToId: techD });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ version: 2, status: 'WON', probability: 100, wonAmountVnd: '1250000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-2026-118', wonDocDate: '2026-11-10', wonDocUrl: WIN.wonDocUrl });
    expect(r.body.data.closedAt).not.toBeNull();
    expect(await hist(o.id, 'STATUS')).toEqual([{ oldValue: 'OPEN', newValue: 'WON', reason: null, changedById: fx.empA }]);
    const ts = await tasks(o.id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ opportunityAutoKind: 'WIN_HANDOVER', type: 'TASK', status: 'OPEN', performedById: techD });
    expect(ts[0].dueAt?.toISOString()).toBe(nineAm(day(7)));
    expect(ts[0].title + ' ' + ts[0].content).not.toContain('1250000000');
    expect(await prisma.activityAccess.count({ where: { activityId: ts[0].id } })).toBe(0);
    // Đã đóng: không thắng / thua / tạm hoãn / tiếp tục lần nữa.
    expect(err(await post('salesA', o.id, 'win', { version: 2, ...WIN, handoverToId: techD }))).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
    expect(err(await post('salesA', o.id, 'lose', { version: 2, lostReasonId: fx.oppLostReason['PRICE_HIGHER'] }))).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
    expect(err(await post('salesA', o.id, 'resume', { version: 2 }))).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
    expect(await tasks(o.id)).toHaveLength(1);
  });
  it('Thắng từ Tạm hoãn: việc nhắc còn mở => CANCELLED; người nhận KHÔNG đọc được khách nhưng có thẩm quyền kỹ thuật => giao ngoài phạm vi, được cấp quyền theo việc; hạn bàn giao do người chốt chọn', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ ký' })).status).toBe(200);
    const r = await post('salesA', o.id, 'win', { version: 2, ...WIN, wonDocType: 'DON_DAT_HANG', handoverToId: techX, handoverDueDate: day(3) });
    expect(r.status).toBe(200);
    expect(await hist(o.id, 'STATUS')).toMatchObject([{ oldValue: 'OPEN', newValue: 'ON_HOLD' }, { oldValue: 'ON_HOLD', newValue: 'WON' }]);
    expect(await tasks(o.id, 'HOLD_REMINDER')).toMatchObject([{ status: 'CANCELLED', outcome: 'Cơ hội đã chốt' }]);
    const hand = await tasks(o.id, 'WIN_HANDOVER');
    expect(hand).toMatchObject([{ status: 'OPEN', performedById: techX }]);
    expect(hand[0].dueAt?.toISOString()).toBe(nineAm(day(3)));
    expect(await prisma.activityAccess.findMany({ where: { activityId: hand[0].id }, select: { employeeId: true } })).toEqual([{ employeeId: techX }]);
  });
  it('người nhận bàn giao không hợp lệ (đã nghỉ, không tồn tại, không đọc được khách và không có thẩm quyền kỹ thuật) => 400 theo trường handoverToId; TOÀN BỘ thao tác Thắng bị huỷ', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ ký' })).status).toBe(200);
    for (const [name, to] of [['đã nghỉ', goneF], ['không tồn tại', GHOST], ['Kinh doanh khác phòng', fx.empC]] as const) {
      const r = await post('salesA', o.id, 'win', { version: 2, ...WIN, handoverToId: to });
      expect({ name, s: r.status }).toEqual({ name, s: 400 });
      expect(JSON.stringify(r.body.error.details)).toContain('handoverToId');
      expect(leaks(r.body)).toBe(false);
    }
    expect(await row(o.id)).toMatchObject({ status: 'ON_HOLD', version: 2, wonAmountVnd: null, closedAt: null });
    expect(await hist(o.id, 'STATUS')).toHaveLength(1);
    expect(await tasks(o.id)).toMatchObject([{ opportunityAutoKind: 'HOLD_REMINDER', status: 'OPEN' }]); // việc nhắc KHÔNG bị đóng
  });
  it('Thắng thiếu / sai chứng từ => 400; không đủ quyền => 403 / 404; cơ hội không đổi', async () => {
    const o = await opp(fx.empA);
    const ok = { version: 1, ...WIN, handoverToId: techD };
    const bad: object[] = [
      { ...ok, wonAmountVnd: undefined }, { ...ok, wonAmountVnd: '-5' }, { ...ok, wonAmountVnd: '1.5' }, { ...ok, wonDocType: 'HOA_DON' }, { ...ok, wonDocNo: '   ' },
      { ...ok, wonDocDate: '2026-13-01' }, { ...ok, wonDocUrl: 'http://drive.example.com/x' }, { ...ok, wonDocUrl: 'khong-phai-url' }, { ...ok, wonDocUrl: undefined },
      { ...ok, handoverToId: undefined }, { ...ok, handoverDueDate: day(-2) },
    ];
    for (const body of bad) expect({ body, s: (await post('salesA', o.id, 'win', body)).status }).toEqual({ body, s: 400 });
    expect((await post('salesB', o.id, 'win', ok)).status).toBe(404); // Kinh doanh khác: không thấy cơ hội
    expect((await post('acctA', o.id, 'win', ok)).status).toBe(403); // Kế toán: đọc được, không có opportunity.close
    const ofB = await opp(fx.empB); // cơ hội của B ở khách của A: A đọc được (phụ trách khách) nhưng không phụ trách cơ hội
    expect((await post('salesA', ofB.id, 'win', ok)).status).toBe(403);
    expect((await post('salesA', ofB.id, 'hold', { version: 1, holdUntil: day(2), holdReason: 'x' })).status).toBe(403);
    expect(await row(o.id)).toMatchObject({ status: 'OPEN', version: 1 });
    expect(await tasks(o.id)).toEqual([]);
  });
  it('Thua: bắt buộc lý do theo danh mục; lý do "Khác" phải kèm ghi chú; từ Tạm hoãn thì việc nhắc bị đóng; không tạo việc bàn giao', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' })).status).toBe(200);
    expect((await post('salesA', o.id, 'lose', { version: 2 })).status).toBe(400);
    expect((await post('salesA', o.id, 'lose', { version: 2, lostReasonId: GHOST })).status).toBe(400);
    expect((await post('salesA', o.id, 'lose', { version: 2, lostReasonId: fx.oppStage['SURVEY'] })).status).toBe(400); // id của danh mục khác
    const other = await post('salesA', o.id, 'lose', { version: 2, lostReasonId: fx.oppLostReason['OTHER'], lostNote: '  ' });
    expect(other.status).toBe(400);
    expect(JSON.stringify(other.body.error.details)).toContain('lostNote');
    expect(await row(o.id)).toMatchObject({ status: 'ON_HOLD', version: 2 });
    const r = await post('salesA', o.id, 'lose', { version: 2, lostReasonId: fx.oppLostReason['OTHER'], lostNote: 'Khách đổi chủ đầu tư' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ version: 3, status: 'LOST', probability: 0, lostReason: { code: 'OTHER' }, lostNote: 'Khách đổi chủ đầu tư' });
    expect(r.body.data.closedAt).not.toBeNull();
    expect(await tasks(o.id)).toMatchObject([{ opportunityAutoKind: 'HOLD_REMINDER', status: 'CANCELLED', outcome: 'Cơ hội đã chốt' }]);
    const o2 = await opp(fx.empA);
    expect((await post('salesA', o2.id, 'lose', { version: 1, lostReasonId: fx.oppLostReason['PRICE_HIGHER'] })).status).toBe(200); // lý do thường: ghi chú tuỳ chọn
    expect(await tasks(o2.id)).toEqual([]);
  });
});

describe('Mở lại (§6.7, TC 12d)', () => {
  it('chỉ Quản trị CRM (opportunity.reopen phạm vi ALL), bắt buộc lý do; WON → OPEN: closed_at về NULL, won_* giữ làm dấu vết, việc bàn giao còn mở => CANCELLED; Thắng lại => việc bàn giao MỚI', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'win', { version: 1, ...WIN, handoverToId: techD })).status).toBe(200);
    expect((await post('salesA', o.id, 'reopen', { version: 2, reason: 'Kinh doanh tự mở' })).status).toBe(403);
    expect((await post('crmAdmin', o.id, 'reopen', { version: 2 })).status).toBe(400);
    expect((await post('crmAdmin', o.id, 'reopen', { version: 2, reason: '   ' })).status).toBe(400);
    expect(err(await post('crmAdmin', o.id, 'reopen', { version: 1, reason: 'x' }))).toEqual({ s: 409, code: 'OPPORTUNITY_VERSION_CONFLICT' });
    expect(await row(o.id)).toMatchObject({ status: 'WON', version: 2 });
    const r = await post('crmAdmin', o.id, 'reopen', { version: 2, reason: 'Khách huỷ hợp đồng, đàm phán lại' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ version: 3, status: 'OPEN', closedAt: null, wonAmountVnd: null, wonDocNo: null }); // không hiển thị khi đang mở
    expect(await row(o.id)).toMatchObject({ status: 'OPEN', closedAt: null, wonAmountVnd: 1250000000n, wonDocNo: 'HD-2026-118' }); // dấu vết còn ở DB
    expect(await hist(o.id, 'STATUS')).toMatchObject([{ oldValue: 'OPEN', newValue: 'WON' }, { oldValue: 'WON', newValue: 'OPEN', reason: 'Khách huỷ hợp đồng, đàm phán lại', changedById: fx.empC }]);
    expect(await tasks(o.id)).toMatchObject([{ opportunityAutoKind: 'WIN_HANDOVER', status: 'CANCELLED', outcome: 'Cơ hội đã mở lại' }]);
    expect(err(await post('crmAdmin', o.id, 'reopen', { version: 3, reason: 'x' }))).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
    expect((await post('salesA', o.id, 'win', { version: 3, ...WIN, wonAmountVnd: '900000000', handoverToId: techD })).status).toBe(200);
    expect((await tasks(o.id)).map((x) => x.status)).toEqual(['CANCELLED', 'OPEN']);
    expect((await row(o.id)).wonAmountVnd).toBe(900000000n); // lần đóng sau ghi đè
  });
  it('LOST → OPEN; việc bàn giao đã hoàn thành trước khi mở lại không bị đụng; mở lại áp luật R-S (Báo giá thiếu giá trị => 400)', async () => {
    const lost = await opp(fx.empA, { status: 'LOST' });
    expect((await post('crmAdmin', lost.id, 'reopen', { version: 1, reason: 'Khách quay lại' })).status).toBe(200);
    expect(await row(lost.id)).toMatchObject({ status: 'OPEN', closedAt: null, version: 2 });
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'win', { version: 1, ...WIN, handoverToId: fx.empA })).status).toBe(200);
    const hand = (await tasks(o.id))[0];
    expect((await a('salesA').post(ACT + '/' + hand.id + '/complete', { version: hand.version })).status).toBeLessThan(300);
    expect((await post('crmAdmin', o.id, 'reopen', { version: 2, reason: 'Sửa chứng từ' })).status).toBe(200);
    expect(await tasks(o.id)).toMatchObject([{ id: hand.id, status: 'DONE' }]);
    const bad = await opp(fx.empA, { status: 'LOST', stage: 'QUOTATION', needSummary: 'Cần 3 máy' });
    expect((await post('crmAdmin', bad.id, 'reopen', { version: 1, reason: 'Thử' })).status).toBe(400);
    expect(await row(bad.id)).toMatchObject({ status: 'LOST', version: 1 });
  });
});

describe('Việc nhắc tạm hoãn đi theo người phụ trách cơ hội (§5.5(e), §6.8, TC 9b)', () => {
  it('chuyển người phụ trách cơ hội => việc nhắc còn mở đổi người làm sang người mới (cùng việc, không tạo thêm)', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' })).status).toBe(200);
    const before = (await tasks(o.id))[0];
    expect((await post('salesA', o.id, 'assign', { version: 2, ownerId: fx.empB, reason: 'Bàn giao' })).status).toBe(201);
    const ts = await tasks(o.id);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ id: before.id, status: 'OPEN', performedById: fx.empB });
    expect(ts[0].dueAt?.toISOString()).toBe(before.dueAt?.toISOString());
  });
  it('người phụ trách cơ hội KHÔNG phụ trách khách: thấy và hoàn thành được việc nhắc của mình qua API Hoạt động; không sửa nội dung, không giao lại, không mở được khách; người khác không thấy', async () => {
    const o = await opp(fx.empB); // B phụ trách cơ hội ở khách của A
    expect((await post('salesB', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' })).status).toBe(200);
    const task = (await tasks(o.id))[0];
    expect(task.performedById).toBe(fx.empB);
    const got = await a('salesB').get(ACT + '/' + task.id);
    expect(got.status).toBe(200);
    expect(got.body.data).toMatchObject({ id: task.id, contact: null });
    expect(JSON.stringify((await a('salesB').get(ACT + '?assignee=me')).body)).toContain(task.id);
    expect((await a('salesB').get('/api/v1/customers/' + cA.id)).status).toBe(404);
    expect((await a('salesC').get(ACT + '/' + task.id)).status).toBe(404);
    expect((await a('salesB').patch(ACT + '/' + task.id, { version: task.version, content: 'B tự sửa nội dung' })).status).toBe(403);
    expect((await a('salesB').post(ACT + '/' + task.id + '/assign', { version: task.version, performedById: fx.empA })).status).toBe(403);
    expect((await a('salesB').post(ACT + '/' + task.id + '/complete', { version: task.version, outcome: 'Đã gọi lại' })).status).toBeLessThan(300);
    expect(await tasks(o.id)).toMatchObject([{ id: task.id, status: 'DONE', content: task.content }]);
  });
  it('mất vai trò phụ trách cơ hội => mất ngay quyền đọc việc nhắc cũ của mình', async () => {
    const o = await opp(fx.empB);
    expect((await post('salesB', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' })).status).toBe(200);
    const task = (await tasks(o.id))[0];
    expect((await a('salesB').get(ACT + '/' + task.id)).status).toBe(200);
    expect((await post('salesB', o.id, 'assign', { version: 2, ownerId: fx.empA, reason: 'Trả lại' })).status).toBe(201);
    expect((await tasks(o.id))[0].performedById).toBe(fx.empA);
    expect((await a('salesB').get(ACT + '/' + task.id)).status).toBe(404);
    expect((await a('salesA').get(ACT + '/' + task.id)).status).toBe(200);
  });
});

describe('Nhật ký THẬT và rollback nguyên tử cho năm thao tác vòng đời (ghi chú review PR #242)', () => {
  const taskIds = async (id: string) => (await tasks(id)).map((x) => x.id);
  it('DbAuditPort thật nhận đủ bản ghi của cơ hội và của việc tự sinh; không chứa giá trị chốt, số / đường dẫn chứng từ, lý do, ghi chú', async () => {
    const o = await opp(fx.empA);
    const A = (action: string, body: object, who = 'salesA') => post(who, o.id, action, body, real.app);
    expect((await A('hold', { version: 1, holdUntil: day(5), holdReason: 'Lý do hoãn kín' })).status).toBe(200);
    expect((await A('hold', { version: 2, holdUntil: day(8), holdReason: 'Lý do hoãn kín 2' })).status).toBe(200);
    expect((await A('resume', { version: 3, reason: 'Lý do tiếp tục kín' })).status).toBe(200);
    expect((await A('hold', { version: 4, holdUntil: day(9), holdReason: 'Lý do hoãn kín 3' })).status).toBe(200);
    expect((await A('lose', { version: 5, lostReasonId: fx.oppLostReason['OTHER'], lostNote: 'Ghi chú thua kín' })).status).toBe(200);
    expect((await A('reopen', { version: 6, reason: 'Lý do mở lại kín' }, 'crmAdmin')).status).toBe(200);
    expect((await A('win', { version: 7, wonAmountVnd: '123456789', wonDocType: 'HOP_DONG', wonDocNo: 'HD-KIN-77', wonDocDate: '2026-11-12', wonDocUrl: 'https://drive.example.com/kin-77', handoverToId: techX })).status).toBe(200);
    const sel = { action: true, actorId: true, entityCode: true, summary: true, changes: true } as const;
    const oppLogs = await prisma.auditLog.findMany({ where: { entityType: 'opportunity', entityId: o.id }, orderBy: { id: 'asc' }, select: sel });
    expect(oppLogs.map((r) => r.action)).toEqual(['opportunity.hold', 'opportunity.hold', 'opportunity.resume', 'opportunity.hold', 'opportunity.lose', 'opportunity.reopen', 'opportunity.win']);
    expect(oppLogs.map((r) => r.actorId)).toEqual([fx.empA, fx.empA, fx.empA, fx.empA, fx.empA, fx.empC, fx.empA]);
    expect(oppLogs.every((r) => r.entityCode === o.code)).toBe(true);
    expect(oppLogs[0].changes).toMatchObject({ status: ['OPEN', 'ON_HOLD'] });
    expect(oppLogs[6].changes).toMatchObject({ status: ['OPEN', 'WON'], handoverToId: [null, techX] });
    const actLogs = await prisma.auditLog.findMany({ where: { entityType: 'activity', entityId: { in: await taskIds(o.id) } }, orderBy: { id: 'asc' }, select: sel });
    const count = (action: string) => actLogs.filter((r) => r.action === action).length;
    // 2 việc nhắc + 1 việc bàn giao được tạo; 1 lần đổi hạn; 2 lần đóng việc nhắc (tiếp tục, thua).
    expect({ create: count('activity.create'), update: count('activity.update'), cancel: count('activity.cancel') }).toEqual({ create: 3, update: 1, cancel: 2 });
    const dump = JSON.stringify([oppLogs, actLogs]);
    for (const secret of ['Lý do hoãn kín', 'Lý do tiếp tục kín', 'Ghi chú thua kín', 'Lý do mở lại kín', '123456789', 'HD-KIN-77', 'kin-77']) expect(dump).not.toContain(secret);
  });

  // Phá hoại có chủ đích: cổng nhật ký THẬT ghi xong dòng audit rồi ném lỗi. onlyActivity = chỉ hỏng ở bản ghi của VIỆC TỰ SINH, tức là SAU khi cơ hội
  // đã được cập nhật, lịch sử và nhật ký của cơ hội đã ghi, dòng việc đã tạo / đã đóng => chứng minh tất cả cùng rollback.
  async function sabotaged<T>(onlyActivity: boolean, fn: () => Promise<T>): Promise<T> {
    const port = real.app.get<AuditPort>(AUDIT_PORT);
    const orig = port.record.bind(port);
    port.record = async (tx: unknown, e: AuditEntry) => { await orig(tx, e); if (!onlyActivity || e.entityType === 'activity') throw new Error('nhật ký hỏng sau khi ghi (thử)'); };
    try { return await fn(); } finally { port.record = orig; }
  }
  const snapshot = async (id: string) => {
    const ts = await tasks(id);
    const ids = ts.map((x) => x.id);
    return {
      row: await row(id), tasks: ts, changes: await prisma.opportunityChange.count({ where: { opportunityId: id } }),
      audit: await prisma.auditLog.count({ where: { OR: [{ entityType: 'opportunity', entityId: id }, { entityType: 'activity', entityId: { in: ids } }] } }),
      access: await prisma.activityAccess.count({ where: { activityId: { in: ids } } }),
      allTasksOfCustomer: await prisma.activity.count({ where: { opportunityId: id } }),
    };
  };
  it('nhật ký hỏng ở bất kỳ bước nào => Tạm hoãn / Tiếp tục / Thắng / Thua / Mở lại rollback HẾT: cơ hội, lịch sử, việc tự sinh, quyền theo việc, nhật ký không đổi', async () => {
    const open = await opp(fx.empA);
    const held = await opp(fx.empA);
    expect((await post('salesA', held.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' }, real.app)).status).toBe(200);
    const won = await opp(fx.empA);
    expect((await post('salesA', won.id, 'win', { version: 1, ...WIN, handoverToId: techX }, real.app)).status).toBe(200);
    type Res = { status: number; body: { message?: string; error?: { details?: unknown } } };
    const cases: Array<[string, string, () => Promise<Res>]> = [
      ['tạm hoãn (tạo việc nhắc)', open.id, () => post('salesA', open.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'thử' }, real.app)],
      ['đổi hạn tạm hoãn (cập nhật việc nhắc)', held.id, () => post('salesA', held.id, 'hold', { version: 2, holdUntil: day(12), holdReason: 'thử' }, real.app)],
      ['tiếp tục (đóng việc nhắc)', held.id, () => post('salesA', held.id, 'resume', { version: 2 }, real.app)],
      ['thắng (đóng việc nhắc + tạo việc bàn giao + cấp quyền theo việc)', held.id, () => post('salesA', held.id, 'win', { version: 2, ...WIN, handoverToId: techX }, real.app)],
      ['thua (đóng việc nhắc)', held.id, () => post('salesA', held.id, 'lose', { version: 2, lostReasonId: fx.oppLostReason['PRICE_HIGHER'] }, real.app)],
      ['mở lại (đóng việc bàn giao + thu hồi quyền theo việc)', won.id, () => post('crmAdmin', won.id, 'reopen', { version: 2, reason: 'thử' }, real.app)],
    ];
    for (const onlyActivity of [false, true]) {
      for (const [name, id, call] of cases) {
        const before = await snapshot(id);
        const r = await sabotaged(onlyActivity, call);
        expect({ name, onlyActivity, s: r.status }).toEqual({ name, onlyActivity, s: 500 });
        expect(leaks(r.body)).toBe(false);
        expect({ name, onlyActivity, after: await snapshot(id) }).toEqual({ name, onlyActivity, after: before });
      }
    }
    // Cổng nhật ký trở lại bình thường => cùng yêu cầu chạy được đúng một lần.
    expect((await post('salesA', held.id, 'resume', { version: 2 }, real.app)).status).toBe(200);
    expect(await snapshot(held.id)).toMatchObject({ row: { status: 'OPEN', version: 3 }, tasks: [{ status: 'CANCELLED' }] });
    expect((await post('crmAdmin', won.id, 'reopen', { version: 2, reason: 'thật' }, real.app)).status).toBe(200);
    expect(await snapshot(won.id)).toMatchObject({ row: { status: 'OPEN', version: 3 }, tasks: [{ opportunityAutoKind: 'WIN_HANDOVER', status: 'CANCELLED' }] });
  });
});

// ───── Review R1 của PR #244 ─────
// Việc TASK dựng thẳng bằng Prisma (không qua API) để có việc "không phải việc nhắc" gắn cùng cơ hội.
const rawTask = (opportunityId: string, performedById: string, kind: 'WIN_HANDOVER' | null) => prisma.activity.create({
  data: { customerId: cA.id, type: 'TASK', title: 'S8b việc thử ' + uniq(), content: 'Nội dung việc thử', occurredAt: new Date(), dueAt: new Date(nineAm(day(3))), status: 'OPEN', performedById, opportunityId, opportunityAutoKind: kind, isDemo: true, createdById: fx.empA, updatedById: fx.empA },
  select: { id: true, version: true },
});

describe('PR244-R1-01 — ngoại lệ việc nhắc chỉ cho ĐỌC + HOÀN THÀNH đúng việc; không mở work-card, không thành quyền cập nhật B3', () => {
  beforeAll(() => { t.actors!.presets['techXp'] = { actor: { employeeId: techX, departmentId: fx.d2 }, scopes: { ...TECH } }; });
  it('B (phụ trách cơ hội, không đọc khách, không có activity_access): chi tiết / danh sách / hoàn thành được; work-card, lịch sử, PATCH (kể cả outcome), giao lại, mở lại, đề xuất chuyển đều bị từ chối; không lọt thẻ khách hay liên hệ', async () => {
    const o = await opp(fx.empB);
    expect((await post('salesB', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' })).status).toBe(200);
    let task = (await tasks(o.id))[0];
    expect(await prisma.activityAccess.count({ where: { activityId: task.id } })).toBe(0);
    // Người phụ trách KHÁCH (quyền B3 theo phạm vi) gắn một liên hệ của khách vào việc nhắc.
    const contactName = 'Liên hệ kín ' + uniq();
    const ct = await prisma.contact.create({ data: { customerId: cA.id, fullName: contactName, phone: '0987000111', isDemo: true }, select: { id: true } });
    expect((await a('salesA').patch(ACT + '/' + task.id, { version: task.version, contactId: ct.id })).status).toBe(200);
    task = (await tasks(o.id))[0];
    const cust = await prisma.customer.findUniqueOrThrow({ where: { id: cA.id }, select: { phone: true, address: true } });

    const detail = await a('salesB').get(ACT + '/' + task.id);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id: task.id, contact: null, access: 'REMINDER' });
    expect(JSON.stringify(detail.body)).not.toContain(contactName);
    const list = await a('salesB').get(ACT + '?assignee=me&pageSize=100');
    expect(list.body.data.items.find((x: { id: string }) => x.id === task.id)).toMatchObject({ contact: null, access: 'REMINDER' });

    const card = await a('salesB').get(ACT + '/' + task.id + '/work-card');
    expect(card.status).toBe(404);
    const dump = JSON.stringify(card.body);
    for (const secret of [contactName, '0987000111', cust.phone]) expect(dump).not.toContain(secret);
    expect((await a('salesB').get(ACT + '/' + task.id + '/history')).status).toBe(404);
    expect((await a('salesB').patch(ACT + '/' + task.id, { version: task.version, outcome: 'B ghi kết quả qua PATCH' })).status).toBe(403);
    expect((await a('salesB').patch(ACT + '/' + task.id, { version: task.version, status: 'CANCELLED' })).status).toBe(403);
    expect((await a('salesB').post(ACT + '/' + task.id + '/assign', { version: task.version, performedById: fx.empA })).status).toBe(403);
    expect([403, 404]).toContain((await a('salesB').post(ACT + '/' + task.id + '/transfer-requests', { toEmployeeId: fx.empA, reason: 'thử' })).status);
    expect((await tasks(o.id))[0]).toMatchObject({ version: task.version, status: 'OPEN', outcome: null, performedById: fx.empB });

    expect((await a('salesB').post(ACT + '/' + task.id + '/complete', { version: task.version, outcome: 'Đã gọi lại' })).status).toBe(200);
    expect((await tasks(o.id))[0]).toMatchObject({ status: 'DONE', outcome: 'Đã gọi lại' });
    expect((await a('salesB').post(ACT + '/' + task.id + '/reopen', { version: task.version + 1 })).status).toBe(403);
  });
  it('đối chứng: quyền B3 độc lập vẫn nguyên — người đọc theo khách và người có activity_access mở được work-card, người có quyền theo việc vẫn PATCH được outcome', async () => {
    const o = await opp(fx.empA);
    expect((await post('salesA', o.id, 'hold', { version: 1, holdUntil: day(5), holdReason: 'Chờ' })).status).toBe(200);
    const reminder = (await tasks(o.id, 'HOLD_REMINDER'))[0];
    const scoped = await a('salesA').get(ACT + '/' + reminder.id + '/work-card'); // A phụ trách khách: đường theo phạm vi
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.customer.code).toBe(cA.code);
    expect((await a('salesA').get(ACT + '/' + reminder.id)).body.data.access).toBe('SCOPE');
    expect((await post('salesA', o.id, 'win', { version: 2, ...WIN, handoverToId: techX })).status).toBe(200);
    const hand = (await tasks(o.id, 'WIN_HANDOVER'))[0];
    expect((await a('techXp').get(ACT + '/' + hand.id)).body.data).toMatchObject({ access: 'TASK', contact: null });
    const card = await a('techXp').get(ACT + '/' + hand.id + '/work-card'); // techX: quyền theo việc (activity_access) của B3
    expect(card.status).toBe(200);
    expect(card.body.data.customer.code).toBe(cA.code);
    expect((await a('techXp').patch(ACT + '/' + hand.id, { version: hand.version, outcome: 'Đã khảo sát' })).status).toBe(200);
    expect((await a('techXp').patch(ACT + '/' + hand.id, { version: hand.version + 1, content: 'sửa nội dung' })).status).toBe(403);
  });
});

describe('PR244-R1-02 — người chỉ có mã opportunity.* (không có activity.*) vẫn dùng được đúng nhánh việc nhắc, và chỉ nhánh đó', () => {
  const OPP_ONLY = { 'opportunity.read': 'OWN', 'opportunity.close': 'OWN', 'opportunity.assign': 'OWN', 'lookup.read': 'ALL' } as const;
  const setScopes = (scopes: object) => { t.actors!.presets['oppOnlyB'] = { actor: t.actors!.presets['oppOnlyB']?.actor ?? { employeeId: fx.empB, departmentId: fx.d1 }, scopes: { ...scopes } }; };
  beforeAll(() => setScopes(OPP_ONLY));
  afterEach(() => setScopes(OPP_ONLY));
  const bell = async () => { const r = await a('oppOnlyB').get(ACT + '/reminders/summary'); expect(r.status).toBe(200); return r.body.data as { overdue: number; today: number; upcoming7d: number }; };
  const myList = async () => { const r = await a('oppOnlyB').get(ACT + '?assignee=me&pageSize=100'); expect(r.status).toBe(200); return r.body.data as { total: number; items: Array<{ id: string; access: string; contact: unknown }> }; };

  it('danh sách / chi tiết / chuông / hoàn thành đúng việc nhắc của mình; việc người dùng tạo và việc bàn giao KHÔNG mở nhờ ngoại lệ; work-card và PATCH bị từ chối', async () => {
    const before = await bell();
    const o = await opp(fx.empB);
    expect((await post('oppOnlyB', o.id, 'hold', { version: 1, holdUntil: day(4), holdReason: 'Chờ' })).status).toBe(200);
    const task = (await tasks(o.id, 'HOLD_REMINDER'))[0];
    const manual = await rawTask(o.id, fx.empB, null); // việc người dùng tạo, cùng cơ hội, cùng người làm
    const handover = await rawTask(o.id, fx.empB, 'WIN_HANDOVER'); // việc bàn giao: chỉ theo activity_access của B3
    expect(await bell()).toEqual({ ...before, upcoming7d: before.upcoming7d + 1 }); // chỉ việc nhắc được đếm

    const list = await myList();
    const ids = list.items.map((x) => x.id);
    expect(ids).toContain(task.id);
    expect(ids).not.toContain(manual.id);
    expect(ids).not.toContain(handover.id);
    // Mọi dòng trả về đều là việc nhắc tạm hoãn của chính B; tổng số khớp số dòng (lọc trước khi đếm / phân trang).
    const kinds = await prisma.activity.findMany({ where: { id: { in: ids } }, select: { opportunityAutoKind: true, performedById: true } });
    expect(kinds.every((k) => k.opportunityAutoKind === 'HOLD_REMINDER' && k.performedById === fx.empB)).toBe(true);
    expect(list.total).toBe(list.items.length);
    expect(list.items.every((x) => x.access === 'REMINDER' && x.contact === null)).toBe(true);

    expect((await a('oppOnlyB').get(ACT + '/' + task.id)).body.data).toMatchObject({ id: task.id, access: 'REMINDER', contact: null });
    expect((await a('oppOnlyB').get(ACT + '/' + manual.id)).status).toBe(404);
    expect((await a('oppOnlyB').get(ACT + '/' + handover.id)).status).toBe(404);
    expect((await a('oppOnlyB').post(ACT + '/' + manual.id + '/complete', { version: manual.version })).status).toBe(404);
    expect((await a('oppOnlyB').post(ACT + '/' + handover.id + '/complete', { version: handover.version })).status).toBe(404);
    expect([403, 404]).toContain((await a('oppOnlyB').get(ACT + '/' + task.id + '/work-card')).status);
    expect([403, 404]).toContain((await a('oppOnlyB').get(ACT + '/' + task.id + '/history')).status);
    expect((await a('oppOnlyB').patch(ACT + '/' + task.id, { version: task.version, outcome: 'x' })).status).toBe(403);
    expect((await a('oppOnlyB').get('/api/v1/customers/' + cA.id + '/activities')).status).toBeGreaterThanOrEqual(403); // timeline khách không mở

    const done = await a('oppOnlyB').post(ACT + '/' + task.id + '/complete', { version: task.version, outcome: 'Đã gọi' });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'DONE', contact: null });
    expect(await bell()).toEqual(before);
    expect(await prisma.activity.findUniqueOrThrow({ where: { id: manual.id }, select: { status: true, version: true } })).toEqual({ status: 'OPEN', version: manual.version });
  });
  it('mất opportunity.read => 403 ở request kế tiếp; chuyển người làm hoặc xoá mềm cơ hội => 404 và biến khỏi danh sách / chuông', async () => {
    const o1 = await opp(fx.empB); const o2 = await opp(fx.empB);
    for (const o of [o1, o2]) expect((await post('oppOnlyB', o.id, 'hold', { version: 1, holdUntil: day(4), holdReason: 'Chờ' })).status).toBe(200);
    const t1 = (await tasks(o1.id))[0]; const t2 = (await tasks(o2.id))[0];
    const withBoth = await bell();
    expect((await a('oppOnlyB').get(ACT + '/' + t1.id)).status).toBe(200);

    setScopes({ 'opportunity.close': 'OWN', 'lookup.read': 'ALL' }); // gỡ opportunity.read
    expect((await a('oppOnlyB').get(ACT + '/' + t1.id)).status).toBe(403);
    expect((await a('oppOnlyB').get(ACT + '?assignee=me')).status).toBe(403);
    expect((await a('oppOnlyB').get(ACT + '/reminders/summary')).status).toBe(403);
    expect((await a('oppOnlyB').post(ACT + '/' + t1.id + '/complete', { version: t1.version })).status).toBe(403);
    setScopes(OPP_ONLY);

    // Người phụ trách khách giao việc nhắc của cơ hội 1 cho người khác.
    expect((await a('salesA').post(ACT + '/' + t1.id + '/assign', { version: t1.version, performedById: fx.empA })).status).toBe(200);
    expect((await a('oppOnlyB').get(ACT + '/' + t1.id)).status).toBe(404);
    expect((await a('oppOnlyB').post(ACT + '/' + t1.id + '/complete', { version: t1.version + 1 })).status).toBe(404);
    // Quản trị CRM xoá mềm cơ hội 2.
    expect((await a('crmAdmin').delete(O + '/' + o2.id, { version: 2, reason: 'thử' })).status).toBe(200);
    expect((await a('oppOnlyB').get(ACT + '/' + t2.id)).status).toBe(404);
    expect((await a('oppOnlyB').post(ACT + '/' + t2.id + '/complete', { version: t2.version })).status).toBe(404);
    const ids = (await myList()).items.map((x) => x.id);
    expect(ids).not.toContain(t1.id);
    expect(ids).not.toContain(t2.id);
    expect(await bell()).toEqual({ ...withBoth, upcoming7d: withBoth.upcoming7d - 2 });
  });
  it('người không có mã nào liên quan (không activity.*, không opportunity.read) vẫn 403 ở mọi đường của Hoạt động', async () => {
    setScopes({ 'lookup.read': 'ALL' });
    for (const u of [ACT, ACT + '/reminders/summary', ACT + '/' + GHOST, ACT + '/' + GHOST + '/work-card']) expect({ u, s: (await a('oppOnlyB').get(u)).status }).toEqual({ u, s: 403 });
    expect((await a('oppOnlyB').post(ACT + '/' + GHOST + '/complete', { version: 1 })).status).toBe(403);
  });
});
