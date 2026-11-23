// Sales S7 — API GHI cơ hội trên DB thử: tạo, sửa, đổi giai đoạn, lịch sử (docs/SALES_DESIGN.md §6.1–6.3, §4.1 R-S1..R-S3; TC 1, 1a, 1b, 2, 3, 4,
// 9a(iii), 12, 12e, 13). Ma trận vai trò như opportunities.int-spec.ts. DB thử dùng chung => mỗi ca tự tạo khách / cơ hội của mình.
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, leaks, makeApp, SALES, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who: string) => as(t.app, who);
type Ref = { id: string; code: string };
let cA: Ref; let cB: Ref; let cC: Ref; let cNoOwner: Ref; let cDel: Ref;
let SUPPLY = ''; let INSTALL = ''; let PROS = ''; let SURVEY = ''; let QUOTE = ''; let NEGO = '';

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, SALES); t.access.scopes.set(fx.empC, SALES);
  // Vai trò thử bổ sung: đọc được mọi khách nhưng chỉ tạo cơ hội cho khách mình; có update nhưng thiếu move_stage.
  t.actors!.presets['readAllCreateOwn'] = { actor: { employeeId: fx.empB, departmentId: fx.d1 }, scopes: { 'customer.read': 'ALL', 'opportunity.read': 'OWN', 'opportunity.create': 'OWN' } };
  t.actors!.presets['updateNoStage'] = { actor: { employeeId: fx.empA, departmentId: fx.d1 }, scopes: { 'customer.read': 'OWN', 'opportunity.read': 'OWN', 'opportunity.create': 'OWN', 'opportunity.update': 'OWN' } };
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA });
  cB = await makeCustomer(prisma, fx, { ownerId: fx.empB });
  cC = await makeCustomer(prisma, fx, { ownerId: fx.empC });
  cNoOwner = await makeCustomer(prisma, fx, { ownerId: null });
  cDel = await makeCustomer(prisma, fx, { ownerId: fx.empA, deleted: true });
  SUPPLY = fx.oppType['SUPPLY']; INSTALL = fx.oppType['INSTALLATION'];
  PROS = fx.oppStage['PROSPECTING']; SURVEY = fx.oppStage['SURVEY']; QUOTE = fx.oppStage['QUOTATION']; NEGO = fx.oppStage['NEGOTIATION'];
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

const create = (who: string, body: object) => a(who).post(O, body);
const fieldsOf = (r: { body: { error?: { details?: Array<{ field: string }> } } }) => (r.body.error?.details ?? []).map((d) => d.field).sort();
// Tạo nhanh một cơ hội hợp lệ của khách cA (Kinh doanh A phụ trách cả khách lẫn cơ hội).
async function fresh(body: object = {}) {
  const r = await create('salesA', { customerId: cA.id, title: 'S7 ' + uniq(), typeId: SUPPLY, ...body });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; code: string; version: number };
}
const changes = async (id: string, who = 'crmAdmin') => (await a(who).get(O + '/' + id + '/changes')).body.data.items as Array<{ field: string; oldValue: string | null; newValue: string | null; reason: string | null; changedBy: { id: string } }>;

describe('POST /opportunities — tạo (§6.1)', () => {
  it('Kinh doanh tạo cho khách mình: Đang mở, Tiếp cận, xác suất 10, người phụ trách = người phụ trách khách; có nhật ký không chứa tiêu đề/giá trị (TC 1)', async () => {
    const title = 'S7 tạo ' + uniq(); const n = t.audit.entries.length;
    const r = await create('salesA', { customerId: cA.id, title: '  ' + title + '  ', typeId: SUPPLY, expectedAmountVnd: '123456789', expectedCloseDate: '2026-12-31' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ title, status: 'OPEN', stage: { code: 'PROSPECTING' }, type: { code: 'SUPPLY' }, probability: 10, probabilityOverridden: false,
      owner: { id: fx.empA }, customer: { id: cA.id }, expectedAmountVnd: '123456789', expectedCloseDate: '2026-12-31', isProjectLinked: false, version: 1, access: 'FULL' });
    expect(r.body.data.code).toMatch(/^CH-\d{4,}$/);
    const e = t.audit.entries.slice(n);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ action: 'opportunity.create', entityType: 'opportunity', entityId: r.body.data.id, actorEmployeeId: fx.empA });
    expect(JSON.stringify(e[0])).not.toContain(title);
    expect(JSON.stringify(e[0])).not.toContain('123456789');
    expect(await changes(r.body.data.id)).toEqual([]);
  });
  it('Quản trị CRM tạo cho khách của người khác: người phụ trách cơ hội là người phụ trách KHÁCH, không phải người tạo', async () => {
    const r = await create('crmAdmin', { customerId: cB.id, title: 'S7 ' + uniq(), typeId: SUPPLY });
    expect(r.status).toBe(201);
    expect(r.body.data.owner.id).toBe(fx.empB);
  });
  it('một khách có nhiều cơ hội cùng mở; dữ liệu khách không đổi', async () => {
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: cA.id }, select: { version: true, ownerId: true, updatedAt: true } });
    await fresh(); await fresh();
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: cA.id }, select: { version: true, ownerId: true, updatedAt: true } })).toEqual(before);
    expect((await a('salesA').get('/api/v1/customers/' + cA.id + '/opportunities?status=OPEN&pageSize=1')).body.data.total).toBeGreaterThanOrEqual(2);
  });
  it('phân quyền tạo theo KHÁCH: khách không đọc được => 404; đọc được nhưng không phụ trách => 403; không có mã tạo => 403 (TC 12)', async () => {
    const body = { title: 'S7 ' + uniq(), typeId: SUPPLY };
    const notMine = await create('salesA', { ...body, customerId: cB.id });
    expect({ s: notMine.status, code: notMine.body.error.code }).toEqual({ s: 404, code: 'CUSTOMER_NOT_FOUND' });
    const readable = await create('readAllCreateOwn', { ...body, customerId: cA.id });
    expect({ s: readable.status, code: readable.body.error.code }).toEqual({ s: 403, code: 'FORBIDDEN' });
    for (const who of ['acctA', 'techB', 'none', 'readonly']) expect({ who, s: (await create(who, { ...body, customerId: cA.id })).status }).toEqual({ who, s: 403 });
    expect((await as(t.app).post(O, { ...body, customerId: cA.id })).status).toBe(401);
  });
  it('khách không tồn tại / đã xoá mềm => 404; khách chưa có người phụ trách => 409 OPPORTUNITY_CUSTOMER_NO_OWNER; không tạo dòng nào', async () => {
    const body = { title: 'S7 ' + uniq(), typeId: SUPPLY };
    expect((await create('crmAdmin', { ...body, customerId: GHOST })).status).toBe(404);
    expect((await create('crmAdmin', { ...body, customerId: cDel.id })).status).toBe(404);
    const r = await create('crmAdmin', { ...body, customerId: cNoOwner.id });
    expect({ s: r.status, code: r.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_CUSTOMER_NO_OWNER' });
    expect(await prisma.opportunity.count({ where: { customerId: { in: [cDel.id, cNoOwner.id] } } })).toBe(0);
  });
  it('R-S3 (TC 1a): loại Thi công tự gắn dự án; thiếu tên dự án / phạm vi chào => 400 theo trường; cố tắt gắn dự án => 400', async () => {
    const base = { customerId: cA.id, title: 'S7 ' + uniq(), typeId: INSTALL };
    const missing = await create('salesA', base);
    expect(missing.status).toBe(400);
    expect(fieldsOf(missing)).toEqual(['offerScope', 'projectName']);
    expect(fieldsOf(await create('salesA', { ...base, projectName: '   ', offerScope: 'Lắp đặt' }))).toEqual(['projectName']);
    expect(fieldsOf(await create('salesA', { ...base, isProjectLinked: false }))).toEqual(['isProjectLinked']);
    const ok = await create('salesA', { ...base, projectName: 'Tháp A', offerScope: 'Lắp đặt hệ thống HVAC' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ isProjectLinked: true, projectName: 'Tháp A', offerScope: 'Lắp đặt hệ thống HVAC', type: { code: 'INSTALLATION' } });
  });
  it('TC 1a/1b: dự án chỉ cung cấp hàng tạo được với loại Cung cấp; bán hàng không gắn dự án tạo được; không gắn mà gửi tên dự án => 400', async () => {
    const base = { customerId: cA.id, title: 'S7 ' + uniq(), typeId: SUPPLY };
    const linked = await create('salesA', { ...base, isProjectLinked: true, projectName: 'Khách sạn B', offerScope: 'Cung cấp 120 FCU' });
    expect(linked.status).toBe(201);
    expect(linked.body.data).toMatchObject({ type: { code: 'SUPPLY' }, isProjectLinked: true });
    expect(fieldsOf(await create('salesA', { ...base, isProjectLinked: true }))).toEqual(['offerScope', 'projectName']);
    expect((await create('salesA', base)).body.data).toMatchObject({ isProjectLinked: false, projectName: null, offerScope: null });
    expect(fieldsOf(await create('salesA', { ...base, projectName: 'Khách sạn B' }))).toEqual(['projectName']);
  });
  it('dữ liệu sai => 400, không lộ chi tiết nội bộ: tiêu đề trống, giá trị âm / thập phân / quá dài, ngày sai, loại sai nhóm, liên hệ khác khách, trường lạ', async () => {
    const base = { customerId: cA.id, title: 'S7 ' + uniq(), typeId: SUPPLY };
    const other = await makeContact(prisma, cB.id, 'Liên hệ khác khách ' + uniq());
    for (const [name, body] of [
      ['tiêu đề trống', { ...base, title: '   ' }], ['giá trị âm', { ...base, expectedAmountVnd: '-1' }], ['giá trị thập phân', { ...base, expectedAmountVnd: '1.5' }],
      ['giá trị là số', { ...base, expectedAmountVnd: 1000 }], ['giá trị 16 chữ số', { ...base, expectedAmountVnd: '1234567890123456' }],
      ['ngày không có thật', { ...base, expectedCloseDate: '2026-02-30' }], ['ngày sai dạng', { ...base, expectedCloseDate: '31/12/2026' }],
      ['loại là id của giai đoạn', { ...base, typeId: PROS }], ['loại không tồn tại', { ...base, typeId: GHOST }], ['liên hệ khác khách', { ...base, contactId: other.id }],
      ['gửi ownerId', { ...base, ownerId: fx.empB }], ['gửi stageId', { ...base, stageId: QUOTE }], ['gửi probability', { ...base, probability: 90 }], ['thiếu typeId', { customerId: cA.id, title: 'x' }],
    ] as Array<[string, object]>) {
      const r = await create('salesA', body);
      expect({ name, s: r.status }).toEqual({ name, s: 400 });
      expect(leaks(r.body)).toBe(false);
    }
  });
  it('gắn người liên hệ của chính khách đó => được', async () => {
    const ct = await makeContact(prisma, cA.id, 'Liên hệ S7 ' + uniq());
    expect((await create('salesA', { customerId: cA.id, title: 'S7 ' + uniq(), typeId: SUPPLY, contactId: ct.id })).body.data.contact).toMatchObject({ id: ct.id });
  });
});

describe('PATCH /opportunities/:id — sửa (§6.3)', () => {
  const patch = (who: string, id: string, body: object) => a(who).patch(O + '/' + id, body);
  it('sửa giá trị, ngày dự kiến chốt: tăng version, có lịch sử cũ → mới đúng người; nhật ký không chứa số liệu (TC 4, 12)', async () => {
    const o = await fresh(); const n = t.audit.entries.length;
    const r = await patch('salesA', o.id, { version: 1, expectedAmountVnd: '7200000000', expectedCloseDate: '2026-12-20', title: 'Tiêu đề mới ' + o.code });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ version: 2, expectedAmountVnd: '7200000000', expectedCloseDate: '2026-12-20', title: 'Tiêu đề mới ' + o.code });
    const h = await changes(o.id);
    expect(h.map((x) => [x.field, x.oldValue, x.newValue]).sort()).toEqual([['AMOUNT', null, '7200000000'], ['CLOSE_DATE', null, '2026-12-20']]);
    expect(h.every((x) => x.changedBy.id === fx.empA)).toBe(true);
    const e = t.audit.entries.slice(n);
    expect(e).toHaveLength(1);
    expect(e[0].action).toBe('opportunity.update');
    expect(JSON.stringify(e[0])).not.toMatch(/7200000000|2026-12-20|Tiêu đề mới/);
    // Xoá giá trị về "chưa rõ": lịch sử ghi mới = null.
    const back = await patch('salesA', o.id, { version: 2, expectedAmountVnd: null });
    expect(back.body.data).toMatchObject({ version: 3, expectedAmountVnd: null });
    expect((await changes(o.id))[0]).toMatchObject({ field: 'AMOUNT', oldValue: '7200000000', newValue: null });
  });
  it('sửa xác suất: không lý do => 400; có lý do => lưu lịch sử kèm lý do, đánh dấu đã sửa tay (TC 4)', async () => {
    const o = await fresh();
    const no = await patch('salesA', o.id, { version: 1, probability: 60 });
    expect(no.status).toBe(400);
    expect(fieldsOf(no)).toEqual(['probabilityReason']);
    expect(fieldsOf(await patch('salesA', o.id, { version: 1, probabilityReason: 'thừa lý do' }))).toEqual(['probabilityReason']);
    const ok = await patch('salesA', o.id, { version: 1, probability: 60, probabilityReason: 'Khách đã duyệt ngân sách' });
    expect(ok.body.data).toMatchObject({ probability: 60, probabilityOverridden: true, version: 2 });
    expect(await changes(o.id)).toMatchObject([{ field: 'PROBABILITY', oldValue: '10', newValue: '60', reason: 'Khách đã duyệt ngân sách' }]);
    for (const p of [-1, 101, 1.5, '50']) expect((await patch('salesA', o.id, { version: 2, probability: p, probabilityReason: 'x' })).status).toBe(400);
  });
  it('version cũ => 409 kèm currentVersion, không ghi gì; PATCH không đổi gì => 200, không tăng version, không lịch sử (TC 13)', async () => {
    const o = await fresh({ expectedAmountVnd: '100' });
    await patch('salesA', o.id, { version: 1, expectedAmountVnd: '200' });
    const stale = await patch('salesA', o.id, { version: 1, expectedAmountVnd: '300' });
    expect({ s: stale.status, code: stale.body.error.code, cur: stale.body.error.details }).toEqual({ s: 409, code: 'OPPORTUNITY_VERSION_CONFLICT', cur: { currentVersion: 2 } });
    const n = t.audit.entries.length;
    const noop = await patch('salesA', o.id, { version: 2, expectedAmountVnd: '200' });
    expect(noop.body.data).toMatchObject({ version: 2, expectedAmountVnd: '200' });
    expect(t.audit.entries.length).toBe(n);
    expect(await changes(o.id)).toHaveLength(1);
  });
  it('hai yêu cầu sửa cùng version gửi đồng thời => đúng một thành công, một 409; một dòng lịch sử', async () => {
    const o = await fresh();
    const [x, y] = await Promise.all([patch('salesA', o.id, { version: 1, expectedAmountVnd: '111' }), patch('salesA', o.id, { version: 1, expectedAmountVnd: '222' })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id }, select: { version: true } })).version).toBe(2);
    expect(await changes(o.id)).toHaveLength(1);
  });
  it('phân quyền sửa theo người phụ trách CƠ HỘI: người phụ trách khách không phụ trách cơ hội => 403; ngoài phạm vi => 404; Kế toán => 403; dữ liệu không đổi (TC 12)', async () => {
    const r = await create('crmAdmin', { customerId: cA.id, title: 'S7 ' + uniq(), typeId: SUPPLY });
    const id = r.body.data.id as string;
    await prisma.opportunity.update({ where: { id }, data: { ownerId: fx.empB } }); // B phụ trách cơ hội, A phụ trách khách
    const before = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    const body = { version: 1, expectedAmountVnd: '999' };
    expect({ s: (await patch('salesA', id, body)).status }).toEqual({ s: 403 });
    expect({ s: (await patch('salesC', id, body)).status }).toEqual({ s: 404 });
    expect({ s: (await patch('acctA', id, body)).status }).toEqual({ s: 403 });
    expect({ s: (await patch('techB', id, body)).status }).toEqual({ s: 404 });
    expect({ s: (await patch('none', id, body)).status }).toEqual({ s: 403 });
    expect((await patch('crmAdmin', GHOST, body)).status).toBe(404);
    expect(await prisma.opportunity.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect((await patch('salesB', id, body)).status).toBe(200); // người phụ trách cơ hội sửa được dù không phụ trách khách
  });
  it('R-S3 khi sửa: đổi sang loại Thi công mà chưa gắn dự án => 400; tắt gắn dự án khi loại là Thi công => 400; tắt ở loại Cung cấp thì xoá tên dự án + phạm vi', async () => {
    const o = await fresh();
    expect(fieldsOf(await patch('salesA', o.id, { version: 1, typeId: INSTALL }))).toEqual(['isProjectLinked']);
    const ok = await patch('salesA', o.id, { version: 1, typeId: INSTALL, isProjectLinked: true, projectName: 'Tháp C', offerScope: 'Thi công' });
    expect(ok.body.data).toMatchObject({ type: { code: 'INSTALLATION' }, isProjectLinked: true, version: 2 });
    expect(fieldsOf(await patch('salesA', o.id, { version: 2, isProjectLinked: false }))).toEqual(['isProjectLinked']);
    expect(fieldsOf(await patch('salesA', o.id, { version: 2, projectName: null }))).toEqual(['projectName']);
    const back = await patch('salesA', o.id, { version: 2, typeId: SUPPLY, isProjectLinked: false });
    expect(back.body.data).toMatchObject({ type: { code: 'SUPPLY' }, isProjectLinked: false, projectName: null, offerScope: null, version: 3 });
  });
  it('R-S1 / R-S2 khi sửa (TC 12e): đã ở Báo giá thì không xoá được giá trị và nhu cầu', async () => {
    const o = await fresh({ needSummary: 'Cần 2 chiller', expectedAmountVnd: '5000000000' });
    const moved = await a('salesA').post(O + '/' + o.id + '/stage', { version: 1, stageId: QUOTE });
    expect(moved.status).toBe(201);
    expect(fieldsOf(await patch('salesA', o.id, { version: 2, expectedAmountVnd: null }))).toEqual(['expectedAmountVnd']);
    expect(fieldsOf(await patch('salesA', o.id, { version: 2, needSummary: '   ' }))).toEqual(['needSummary']);
    expect((await patch('salesA', o.id, { version: 2, expectedAmountVnd: '0' })).status).toBe(200);
  });
  it('cơ hội đã Thắng / Thua khoá sửa => 409 OPPORTUNITY_STATE; Tạm hoãn vẫn sửa được', async () => {
    const o = await fresh();
    await prisma.opportunity.update({ where: { id: o.id }, data: { status: 'LOST', lostReasonId: fx.oppLostReason['T_PRICE'], closedAt: new Date() } });
    const r = await patch('salesA', o.id, { version: 1, expectedAmountVnd: '1' });
    expect({ s: r.status, code: r.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
    const h = await fresh();
    await prisma.opportunity.update({ where: { id: h.id }, data: { status: 'ON_HOLD', holdUntil: new Date('2027-01-15T00:00:00.000Z'), holdReason: 'thử' } });
    expect((await patch('salesA', h.id, { version: 1, expectedAmountVnd: '1' })).status).toBe(200);
  });
  it('null trên trường không được xoá (title, typeId, version) và trường lạ (status, stageId, ownerId) => 400', async () => {
    const o = await fresh();
    for (const body of [{ version: 1, title: null }, { version: 1, typeId: null }, { title: 'x' }, { version: 1, status: 'WON' }, { version: 1, stageId: QUOTE }, { version: 1, ownerId: fx.empB }]) {
      expect({ body, s: (await patch('salesA', o.id, body)).status }).toEqual({ body, s: 400 });
    }
  });
});

describe('POST /opportunities/:id/stage — đổi giai đoạn (§6.2)', () => {
  const stage = (who: string, id: string, body: object) => a(who).post(O + '/' + id + '/stage', body);
  it('rời Tiếp cận khi thiếu nhu cầu => 400 (needSummary); sang Báo giá khi chưa có giá trị => 400 (expectedAmountVnd), báo rõ; không ghi gì (TC 3)', async () => {
    const o = await fresh();
    const r1 = await stage('salesA', o.id, { version: 1, stageId: SURVEY });
    expect(r1.status).toBe(400);
    expect(fieldsOf(r1)).toEqual(['needSummary']);
    const r2 = await stage('salesA', o.id, { version: 1, stageId: QUOTE });
    expect(fieldsOf(r2)).toEqual(['expectedAmountVnd', 'needSummary']);
    expect(r2.body.error.details.find((d: { field: string }) => d.field === 'expectedAmountVnd').message).toContain('giá trị');
    expect(await changes(o.id)).toEqual([]);
    expect((await a('salesA').get(O + '/' + o.id)).body.data).toMatchObject({ version: 1, stage: { code: 'PROSPECTING' } });
  });
  it('đi đủ Tiếp cận → Khảo sát → Báo giá → Đàm phán, có bỏ qua và có lùi; mỗi bước một dòng lịch sử đúng người; xác suất theo giai đoạn (TC 2)', async () => {
    const o = await fresh({ needSummary: 'Cần hệ VRV', expectedAmountVnd: '900000000' });
    const steps: Array<[string, string, number]> = [[SURVEY, 'SURVEY', 25], [QUOTE, 'QUOTATION', 45], [NEGO, 'NEGOTIATION', 70], [SURVEY, 'SURVEY', 25], [NEGO, 'NEGOTIATION', 70], [PROS, 'PROSPECTING', 10]];
    let v = 1;
    for (const [id, codeOf, prob] of steps) {
      const r = await stage('salesA', o.id, { version: v, stageId: id });
      expect({ codeOf, s: r.status }).toEqual({ codeOf, s: 201 });
      expect(r.body.data).toMatchObject({ stage: { code: codeOf }, probability: prob, probabilityOverridden: false, version: v + 1 });
      v++;
    }
    const h = (await changes(o.id)).filter((x) => x.field === 'STAGE').reverse();
    expect(h.map((x) => [x.oldValue, x.newValue])).toEqual([['PROSPECTING', 'SURVEY'], ['SURVEY', 'QUOTATION'], ['QUOTATION', 'NEGOTIATION'], ['NEGOTIATION', 'SURVEY'], ['SURVEY', 'NEGOTIATION'], ['NEGOTIATION', 'PROSPECTING']]);
    expect(h.every((x) => x.changedBy.id === fx.empA)).toBe(true);
    expect((await changes(o.id)).filter((x) => x.field === 'PROBABILITY')).toHaveLength(6);
  });
  it('xác suất đã sửa tay: không chọn KEEP/RESET => 400; KEEP giữ nguyên; RESET về mặc định và bỏ đánh dấu sửa tay', async () => {
    const o = await fresh({ needSummary: 'x', expectedAmountVnd: '1' });
    await a('salesA').patch(O + '/' + o.id, { version: 1, probability: 55, probabilityReason: 'lý do' });
    expect(fieldsOf(await stage('salesA', o.id, { version: 2, stageId: SURVEY }))).toEqual(['probability']);
    const keep = await stage('salesA', o.id, { version: 2, stageId: SURVEY, probability: 'KEEP' });
    expect(keep.body.data).toMatchObject({ probability: 55, probabilityOverridden: true, stage: { code: 'SURVEY' }, version: 3 });
    const reset = await stage('salesA', o.id, { version: 3, stageId: QUOTE, probability: 'RESET' });
    expect(reset.body.data).toMatchObject({ probability: 45, probabilityOverridden: false, version: 4 });
    expect((await stage('salesA', o.id, { version: 4, stageId: NEGO, probability: 'KHAC' })).status).toBe(400);
  });
  it('cùng giai đoạn => 400; version cũ => 409; giai đoạn sai nhóm => 400; giai đoạn không có xác suất mặc định trong mã => 409 OPPORTUNITY_CATALOG_MISSING', async () => {
    const o = await fresh({ needSummary: 'x', expectedAmountVnd: '1' });
    expect(fieldsOf(await stage('salesA', o.id, { version: 1, stageId: PROS }))).toEqual(['stageId']);
    expect(fieldsOf(await stage('salesA', o.id, { version: 1, stageId: SUPPLY }))).toEqual(['stageId']);
    const unknown = await stage('salesA', o.id, { version: 1, stageId: fx.oppStage['T_QUOTE'] });
    expect({ s: unknown.status, code: unknown.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_CATALOG_MISSING' });
    await stage('salesA', o.id, { version: 1, stageId: SURVEY });
    const stale = await stage('salesA', o.id, { version: 1, stageId: QUOTE });
    expect({ s: stale.status, code: stale.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_VERSION_CONFLICT' });
  });
  it('chỉ đổi giai đoạn khi Đang mở: Tạm hoãn / Thắng / Thua => 409 OPPORTUNITY_STATE', async () => {
    const o = await fresh({ needSummary: 'x', expectedAmountVnd: '1' });
    await prisma.opportunity.update({ where: { id: o.id }, data: { status: 'ON_HOLD', holdUntil: new Date('2027-01-15T00:00:00.000Z'), holdReason: 'thử' } });
    const r = await stage('salesA', o.id, { version: 1, stageId: SURVEY });
    expect({ s: r.status, code: r.body.error.code }).toEqual({ s: 409, code: 'OPPORTUNITY_STATE' });
  });
  it('mã move_stage cấp riêng: có update nhưng không có move_stage => sửa được, đổi giai đoạn 403 (TC 9a(iii)); người phụ trách khách không phụ trách cơ hội => 403; ngoài phạm vi => 404', async () => {
    const o = await fresh({ needSummary: 'x', expectedAmountVnd: '1' });
    expect((await a('updateNoStage').patch(O + '/' + o.id, { version: 1, expectedAmountVnd: '2' })).status).toBe(200);
    expect((await stage('updateNoStage', o.id, { version: 2, stageId: SURVEY })).status).toBe(403);
    expect((await stage('salesC', o.id, { version: 2, stageId: SURVEY })).status).toBe(404);
    expect((await stage('acctA', o.id, { version: 2, stageId: SURVEY })).status).toBe(403);
    await prisma.opportunity.update({ where: { id: o.id }, data: { ownerId: fx.empB } });
    expect((await stage('salesA', o.id, { version: 2, stageId: SURVEY })).status).toBe(403);
    expect((await stage('salesB', o.id, { version: 2, stageId: SURVEY })).status).toBe(201);
  });
  it('TC 12e: đổi TÊN và THỨ TỰ giai đoạn Báo giá không đổi luật (luật theo mã)', async () => {
    const { withAdmin } = await import('./helpers/fixtures');
    const orig = await prisma.lookupItem.findUniqueOrThrow({ where: { id: QUOTE }, select: { labelVi: true, sortOrder: true } });
    await withAdmin((ad) => ad.lookupItem.update({ where: { id: QUOTE }, data: { labelVi: 'Chào giá (đổi tên thử)', sortOrder: 5 } }));
    try {
      const o = await fresh({ needSummary: 'x' });
      expect(fieldsOf(await stage('salesA', o.id, { version: 1, stageId: QUOTE }))).toEqual(['expectedAmountVnd']);
      await a('salesA').patch(O + '/' + o.id, { version: 1, expectedAmountVnd: '10' });
      const ok = await stage('salesA', o.id, { version: 2, stageId: QUOTE });
      expect(ok.body.data).toMatchObject({ stage: { code: 'QUOTATION', label: 'Chào giá (đổi tên thử)' }, probability: 45 });
    } finally {
      await withAdmin((ad) => ad.lookupItem.update({ where: { id: QUOTE }, data: orig }));
    }
  });
});

describe('GET /opportunities/:id/changes — lịch sử', () => {
  it('mới nhất trước, có người đổi; chỉ đường đọc đầy đủ: Kế toán / Quản trị CRM xem được, ngoài phạm vi và Kỹ thuật => 404, không có mã => 403', async () => {
    const o = await fresh({ needSummary: 'x', expectedAmountVnd: '1' });
    await a('salesA').patch(O + '/' + o.id, { version: 1, expectedAmountVnd: '2' });
    await a('salesA').post(O + '/' + o.id + '/stage', { version: 2, stageId: SURVEY });
    const r = await a('acctA').get(O + '/' + o.id + '/changes');
    expect(r.status).toBe(200);
    expect(r.body.data.items.map((x: { field: string }) => x.field).sort()).toEqual(['AMOUNT', 'PROBABILITY', 'STAGE']);
    expect(r.body.data.items[r.body.data.items.length - 1]).toMatchObject({ field: 'AMOUNT', oldValue: '1', newValue: '2', changedBy: { id: fx.empA } });
    expect(typeof r.body.data.items[0].changedAt).toBe('string');
    expect((await a('crmAdmin').get(O + '/' + o.id + '/changes')).status).toBe(200);
    for (const who of ['salesC', 'techB']) expect({ who, s: (await a(who).get(O + '/' + o.id + '/changes')).status }).toEqual({ who, s: 404 });
    expect((await a('none').get(O + '/' + o.id + '/changes')).status).toBe(403);
    expect((await as(t.app).get(O + '/' + o.id + '/changes')).status).toBe(401);
    expect((await a('crmAdmin').get(O + '/' + GHOST + '/changes')).status).toBe(404);
  });

  it('T-02: phân trang — mặc định 50 dòng, có total / totalPages; trang 2 nối tiếp không trùng, không sót; pageSize > 100, page 0, cửa sổ offset quá lớn => 400', async () => {
    const o = await fresh();
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    await prisma.opportunityChange.createMany({ data: Array.from({ length: 57 }, (_, i) => ({ opportunityId: o.id, field: 'PROBABILITY' as const, oldValue: String(i), newValue: String(i + 1), changedById: fx.empA, changedAt: new Date(base + i * 60000) })) });
    const p1 = await a('crmAdmin').get(O + '/' + o.id + '/changes');
    expect(p1.status).toBe(200);
    expect(p1.body.data).toMatchObject({ page: 1, pageSize: 50, total: 57, totalPages: 2 });
    expect(p1.body.data.items.length).toBe(50);
    expect(p1.body.data.items[0].newValue).toBe('57'); // mới nhất trước
    const p2 = await a('crmAdmin').get(O + '/' + o.id + '/changes?page=2');
    expect(p2.body.data).toMatchObject({ page: 2, pageSize: 50, total: 57, totalPages: 2 });
    const all = [...p1.body.data.items, ...p2.body.data.items].map((x: { id: string }) => x.id);
    expect(all.length).toBe(57); expect(new Set(all).size).toBe(57);
    expect(p2.body.data.items[p2.body.data.items.length - 1].newValue).toBe('1');
    const small = await a('crmAdmin').get(O + '/' + o.id + '/changes?page=3&pageSize=20');
    expect(small.body.data).toMatchObject({ page: 3, pageSize: 20, total: 57, totalPages: 3 });
    expect(small.body.data.items.length).toBe(17);
    expect((await a('crmAdmin').get(O + '/' + o.id + '/changes?page=9')).body.data).toMatchObject({ items: [], total: 57 });
    for (const bad of ['pageSize=101', 'pageSize=0', 'page=0', 'page=abc', 'page=1001&pageSize=100']) expect({ bad, s: (await a('crmAdmin').get(O + '/' + o.id + '/changes?' + bad)).status }).toEqual({ bad, s: 400 });
    // Ngoài phạm vi / Kỹ thuật vẫn không nhận gì dù có tham số trang.
    for (const who of ['salesC', 'techB']) expect({ who, s: (await a(who).get(O + '/' + o.id + '/changes?page=1&pageSize=5')).status }).toEqual({ who, s: 404 });
  });

  it('T-03: dòng OWNER kèm tên người phụ trách cũ / mới (oldOwner, newOwner); id không tìm thấy => null; dòng khác không có hai khoá này', async () => {
    const o = await fresh();
    expect((await a('salesA').post(O + '/' + o.id + '/assign', { version: 1, ownerId: fx.empB, reason: 'Bàn giao' })).status).toBe(201);
    await prisma.opportunityChange.create({ data: { opportunityId: o.id, field: 'OWNER', oldValue: GHOST, newValue: fx.empB, reason: 'dòng cũ', changedById: fx.empC, changedAt: new Date('2025-01-01T00:00:00.000Z') } });
    const items = (await a('crmAdmin').get(O + '/' + o.id + '/changes')).body.data.items as Array<Record<string, unknown>>;
    const owners = items.filter((x) => x.field === 'OWNER');
    expect(owners.length).toBe(2);
    expect(owners[0]).toMatchObject({ oldValue: fx.empA, newValue: fx.empB, oldOwner: { id: fx.empA, fullName: 'TEST NV A' }, newOwner: { id: fx.empB, fullName: 'TEST NV B' } });
    expect(Object.keys(owners[0].oldOwner as object).sort()).toEqual(['code', 'fullName', 'id']);
    expect(owners[1]).toMatchObject({ oldValue: GHOST, oldOwner: null, newOwner: { id: fx.empB } });
    expect((await a('salesB').patch(O + '/' + o.id, { version: 2, expectedAmountVnd: '5' })).status).toBe(200);
    const amount = ((await a('crmAdmin').get(O + '/' + o.id + '/changes')).body.data.items as Array<Record<string, unknown>>).find((x) => x.field === 'AMOUNT');
    expect(amount).toBeDefined();
    expect(['oldOwner' in (amount as object), 'newOwner' in (amount as object)]).toEqual([false, false]);
  });
});
