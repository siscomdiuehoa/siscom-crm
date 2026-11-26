// Báo giá Q5b — gửi, chấp nhận, từ chối, báo giá đang theo đuổi, đồng bộ giá trị cơ hội (docs/QUOTES_DESIGN.md mục 5.3, 5.4, 8 điểm 4, 6, 7, 8,
// mục 8.1; nghiệm thu C2 phần Q5b, C5, C6, nhóm D). Mọi thao tác đi qua API; tình huống đồng thời chạy thật song song trên các kết nối của pool.
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, makeOpportunity, uniq } from './helpers/fixtures';

const Q = '/api/v1/quotes';
const O = '/api/v1/opportunities';
const ROUNDS = Math.max(3, Math.min(50, Number(process.env.CONCURRENCY_ROUNDS ?? '10')));
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who?: string, app: INestApplication = t.app) => as(app, who);
const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
type Ref = { id: string; code: string };
type Detail = { id: string; code: string; version: number; isPrimary: boolean; versions: Array<Record<string, unknown> & { versionNo: number; status: string }> };
let cA: Ref; let tpl = '';
const TAG = 'Q5S' + uniq().replace(/[^a-z0-9]/gi, '');
const today = () => new Date().toISOString().slice(0, 10);
const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const ITEM = (quantity: string, unitPriceVnd: string) => ({ kind: 'ITEM', description: 'Hàng', unit: 'cái', quantity, unitPriceVnd });

const newOpp = () => makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, needSummary: 'Nhu cầu thử' });
// Báo giá có bản nháp v1 với một dòng 1 × price (VAT 10 %).
async function draft(opp: Ref, price: string, dates: { quoteDate: string; validUntil: string } = { quoteDate: today(), validUntil: shift(10) }): Promise<Detail> {
  const c = await a('salesA').post(O + '/' + opp.id + '/quotes', { templateId: tpl, itemName: 'Hạng mục ' + uniq() });
  expect(c.status).toBe(201);
  const s = await a('salesA').put(Q + '/' + c.body.data.id + '/versions/1', { version: 1, vatPercent: 10, ...dates, lines: [ITEM('1', price)] });
  expect(s.status).toBe(200);
  return s.body.data as Detail;
}
const send = (who: string, d: { id: string; version: number }, no: number, body: object = {}) => a(who).post(Q + '/' + d.id + '/versions/' + no + '/send', { version: d.version, ...body });
const accept = (who: string, d: { id: string; version: number }, no: number) => a(who).post(Q + '/' + d.id + '/versions/' + no + '/accept', { version: d.version });
const reject = (who: string, d: { id: string; version: number }, no: number, reason?: string) => a(who).post(Q + '/' + d.id + '/versions/' + no + '/reject', { version: d.version, ...(reason === undefined ? {} : { reason }) });
const primary = (who: string, d: { id: string; version: number }) => a(who).post(Q + '/' + d.id + '/primary', { version: d.version });
async function newVersion(d: Detail, price: string): Promise<Detail> {
  const r = await a('salesA').post(Q + '/' + d.id + '/versions', { version: d.version });
  expect(r.status).toBe(201);
  const nd = r.body.data as Detail; const no = nd.versions[nd.versions.length - 1]!.versionNo;
  const s = await a('salesA').put(Q + '/' + d.id + '/versions/' + no, { version: nd.version, vatPercent: 10, lines: [ITEM('1', price)] });
  expect(s.status).toBe(200);
  return s.body.data as Detail;
}
const oppRow = (id: string) => prisma.opportunity.findUniqueOrThrow({ where: { id }, select: { expectedAmountVnd: true, version: true } });
const amountHistory = (id: string) => prisma.opportunityChange.findMany({ where: { opportunityId: id, field: 'AMOUNT' }, orderBy: { changedAt: 'asc' }, select: { oldValue: true, newValue: true, reason: true, changedById: true } });

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA, name: 'Công ty Gửi Giá ' + TAG });
  tpl = (await prisma.quoteTemplate.create({ data: { code: 'zs-' + TAG.toLowerCase(), name: 'Loại gửi ' + TAG, title: 'BÁO GIÁ' }, select: { id: true } })).id;
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

describe('POST /quotes/:id/versions/:no/send — đánh dấu đã gửi [QB1]', () => {
  it('gửi bản nháp: SENT, người gửi = người bấm; báo giá gửi đầu tiên của cơ hội tự thành "đang theo đuổi"; giá trị cơ hội = tổng trước VAT; lịch sử AMOUNT có mã, không có số tiền trong lý do', async () => {
    const o = await newOpp();
    const d = await draft(o, '1000');
    const before = await oppRow(o.id);
    t.audit.entries.length = 0;
    const r = await send('salesA', d, 1);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const nd = r.body.data as Detail;
    expect(nd.isPrimary).toBe(true);
    expect(nd.versions[0]).toMatchObject({ status: 'SENT', sentBy: { id: fx.empA } });
    const after = await oppRow(o.id);
    expect({ amount: after.expectedAmountVnd?.toString(), ver: after.version }).toEqual({ amount: '1000', ver: before.version + 1 });
    expect(await amountHistory(o.id)).toEqual([{ oldValue: null, newValue: '1000', reason: 'Theo báo giá ' + d.code + ' v1', changedById: fx.empA }]);
    expect(t.audit.entries.map((e) => e.action)).toEqual(['quote.version.send']);
    expect(JSON.stringify(t.audit.entries)).not.toMatch(/"1000"|Vnd|amount/i);
  });
  it('D8: gửi v1 (100) rồi v2 (150) => giá trị cơ hội 150, KHÔNG phải 250; gửi bản có cùng giá trị => không thêm lịch sử, không tăng version cơ hội', async () => {
    const o = await newOpp();
    let d = await draft(o, '100');
    d = (await send('salesA', d, 1)).body.data;
    d = await newVersion(d, '150');
    d = (await send('salesA', d, 2)).body.data;
    expect((await oppRow(o.id)).expectedAmountVnd?.toString()).toBe('150');
    d = await newVersion(d, '150');
    const v = (await oppRow(o.id)).version;
    expect((await send('salesA', d, 3)).status).toBe(200);
    expect((await oppRow(o.id)).version).toBe(v);
    expect((await amountHistory(o.id)).map((h) => [h.oldValue, h.newValue, h.reason])).toEqual([[null, '100', 'Theo báo giá ' + d.code + ' v1'], ['100', '150', 'Theo báo giá ' + d.code + ' v2']]);
  });
  it('báo giá thứ hai được gửi KHÔNG tự thành đang theo đuổi và không đổi giá trị cơ hội', async () => {
    const o = await newOpp();
    const d1 = await draft(o, '100'); await send('salesA', d1, 1);
    const d2 = await draft(o, '999');
    const r = await send('salesA', d2, 1);
    expect((r.body.data as Detail).isPrimary).toBe(false);
    expect((await oppRow(o.id)).expectedAmountVnd?.toString()).toBe('100');
  });
  it('điều kiện gửi: chỉ dòng nhóm => 422 QUOTE_EMPTY; ngày ở tương lai / hạn trước ngày / thiếu ngày => 400; version cũ => 409; đã gửi => 409', async () => {
    const o = await newOpp();
    const c = (await a('salesA').post(O + '/' + o.id + '/quotes', { templateId: tpl, itemName: 'Rỗng' })).body.data as Detail;
    const s = (await a('salesA').put(Q + '/' + c.id + '/versions/1', { version: 1, vatPercent: 10, lines: [{ kind: 'SECTION', description: 'NHÓM' }] })).body.data as Detail;
    expect(err(await send('salesA', s, 1))).toEqual({ s: 422, code: 'QUOTE_EMPTY' });
    const d = await draft(o, '100');
    expect((await send('salesA', d, 1, { quoteDate: shift(2), validUntil: shift(5) })).status).toBe(400);
    expect((await send('salesA', d, 1, { quoteDate: today(), validUntil: shift(-1) })).status).toBe(400);
    const noDate = (await a('salesA').put(Q + '/' + d.id + '/versions/1', { version: d.version, vatPercent: 10, quoteDate: null, validUntil: null, lines: [ITEM('1', '100')] })).body.data as Detail;
    expect((await send('salesA', noDate, 1)).status).toBe(400);
    expect(err(await send('salesA', { id: d.id, version: 1 }, 1, { quoteDate: today(), validUntil: today() }))).toEqual({ s: 409, code: 'VERSION_CONFLICT' });
    const ok = await send('salesA', noDate, 1, { quoteDate: today(), validUntil: today() });
    expect(ok.status).toBe(200);
    expect((ok.body.data as Detail).versions[0]).toMatchObject({ quoteDate: today(), validUntil: today() });
    expect(err(await send('salesA', ok.body.data, 1))).toEqual({ s: 409, code: 'QUOTE_VERSION_LOCKED' });
  });
  it('quyền: Kế toán / Kỹ thuật => 403; ngoài phạm vi => 404', async () => {
    const o = await newOpp();
    const d = await draft(o, '100');
    for (const who of ['acctA', 'techB']) expect({ who, ...err(await send(who, d, 1)) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
    expect(err(await send('salesC', d, 1))).toEqual({ s: 404, code: 'QUOTE_NOT_FOUND' });
  });
  it('cơ hội Tạm hoãn: gửi được, nhưng KHÔNG đồng bộ giá trị cơ hội (mục 8 điểm 8)', async () => {
    const o = await newOpp();
    const d = await draft(o, '777');
    await prisma.opportunity.update({ where: { id: o.id }, data: { status: 'ON_HOLD', holdReason: 'thử', holdUntil: new Date(shift(30) + 'T00:00:00.000Z') } });
    expect((await send('salesA', d, 1)).status).toBe(200);
    expect((await oppRow(o.id)).expectedAmountVnd).toBeNull();
    expect(await amountHistory(o.id)).toEqual([]);
  });
});

describe('POST /quotes/:id/primary — đổi báo giá đang theo đuổi; nhãn giá trị (QB5, D9)', () => {
  it('đổi sang báo giá khác đã gửi => giá trị cơ hội theo phiên bản gửi mới nhất của nó; báo giá chưa gửi => 422; đã là đang theo đuổi => không đổi gì; Kế toán => 403', async () => {
    const o = await newOpp();
    let d1 = await draft(o, '100'); d1 = (await send('salesA', d1, 1)).body.data;
    let d2 = await draft(o, '250'); d2 = (await send('salesA', d2, 1)).body.data;
    const d3 = await draft(o, '5');
    expect(err(await primary('salesA', d3))).toEqual({ s: 422, code: 'QUOTE_PRIMARY_NEEDS_SENT' });
    const r = await primary('salesA', d2);
    expect(r.status).toBe(200);
    expect((r.body.data as Detail).isPrimary).toBe(true);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: d1.id }, select: { isPrimary: true } })).isPrimary).toBe(false);
    expect((await oppRow(o.id)).expectedAmountVnd?.toString()).toBe('250');
    expect((await amountHistory(o.id)).map((h) => h.reason)).toEqual(['Theo báo giá ' + d1.code + ' v1', 'Theo báo giá ' + d2.code + ' v1']);
    expect((await primary('salesA', r.body.data)).status).toBe(200);
    expect((await amountHistory(o.id)).length).toBe(2);
    expect(err(await primary('acctA', r.body.data))).toEqual({ s: 403, code: 'FORBIDDEN' });
  });
  it('D9 + nhãn: sửa tay giá trị cơ hội => nhãn "đã sửa tay"; gửi bản kế tiếp => ghi đè, có lịch sử, nhãn "theo báo giá"', async () => {
    const o = await newOpp();
    let d = await draft(o, '100'); d = (await send('salesA', d, 1)).body.data;
    expect((await a('salesA').get(O + '/' + o.id + '/quotes')).body.data.amountSource).toEqual({ quoteId: d.id, code: d.code, versionNo: 1, subtotalVnd: '100', matchesOpportunity: true });
    const ov = (await oppRow(o.id)).version;
    expect((await a('salesA').patch(O + '/' + o.id, { version: ov, expectedAmountVnd: '120' })).status).toBe(200);
    expect((await a('salesA').get(O + '/' + o.id + '/quotes')).body.data.amountSource).toMatchObject({ subtotalVnd: '100', matchesOpportunity: false });
    d = await newVersion(d, '180');
    expect((await send('salesA', d, 2)).status).toBe(200);
    expect((await oppRow(o.id)).expectedAmountVnd?.toString()).toBe('180');
    expect((await amountHistory(o.id)).map((h) => [h.oldValue, h.newValue])).toEqual([[null, '100'], ['100', '120'], ['120', '180']]);
    expect((await a('salesA').get(O + '/' + o.id + '/quotes')).body.data.amountSource).toMatchObject({ versionNo: 2, subtotalVnd: '180', matchesOpportunity: true });
  });
  it('cơ hội chưa có báo giá đang theo đuổi => amountSource null', async () => {
    const o = await newOpp();
    await draft(o, '1');
    expect((await a('salesA').get(O + '/' + o.id + '/quotes')).body.data.amountSource).toBeNull();
  });
});

describe('accept / reject — kết quả [QB6, QB7, QB10]', () => {
  it('chấp nhận phiên bản gửi mới nhất của báo giá đang theo đuổi; sau đó không đổi được đang theo đuổi, không chấp nhận thêm, không tạo bản mới', async () => {
    const o = await newOpp();
    let d1 = await draft(o, '100'); d1 = (await send('salesA', d1, 1)).body.data;
    d1 = await newVersion(d1, '90'); d1 = (await send('salesA', d1, 2)).body.data;
    let d2 = await draft(o, '300'); d2 = (await send('salesA', d2, 1)).body.data;
    expect(err(await accept('salesA', d1, 1))).toEqual({ s: 422, code: 'QUOTE_NOT_LATEST' });
    expect(err(await accept('salesA', d2, 1))).toEqual({ s: 409, code: 'QUOTE_NOT_PRIMARY' });
    const r = await accept('salesA', d1, 2);
    expect(r.status).toBe(200);
    expect(r.body.data.versions[1]).toMatchObject({ status: 'ACCEPTED', decidedBy: { id: fx.empA } });
    expect(r.body.data.warnings).toEqual([]);
    expect((await oppRow(o.id)).expectedAmountVnd?.toString()).toBe('90');
    d2 = (await a('salesA').get(Q + '/' + d2.id)).body.data;
    expect(err(await primary('salesA', d2))).toEqual({ s: 409, code: 'QUOTE_PRIMARY_FIXED' });
    expect(err(await a('salesA').post(Q + '/' + d1.id + '/versions', { version: r.body.data.version }))).toEqual({ s: 409, code: 'QUOTE_ALREADY_ACCEPTED' });
    expect(err(await accept('salesA', r.body.data, 2))).toEqual({ s: 409, code: 'QUOTE_VERSION_LOCKED' });
  });
  it('quá hạn hiệu lực vẫn chấp nhận được, kèm cảnh báo EXPIRED [QB10]', async () => {
    const o = await newOpp();
    let d = await draft(o, '100', { quoteDate: shift(-20), validUntil: shift(-5) });
    d = (await send('salesA', d, 1)).body.data;
    const r = await accept('salesA', d, 1);
    expect(r.status).toBe(200);
    expect(r.body.data.warnings).toEqual(['EXPIRED']);
  });
  it('từ chối: bắt buộc lý do; REJECTED kèm lý do; không đổi giá trị cơ hội; bản nháp => 422 QUOTE_NOT_SENT; Kế toán => 403', async () => {
    const o = await newOpp();
    let d = await draft(o, '100');
    expect(err(await reject('salesA', d, 1, 'X'))).toEqual({ s: 422, code: 'QUOTE_NOT_SENT' });
    d = (await send('salesA', d, 1)).body.data;
    expect((await reject('salesA', d, 1)).status).toBe(400);
    expect(err(await reject('acctA', d, 1, 'Giá cao'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    const v = (await oppRow(o.id)).version;
    const r = await reject('salesA', d, 1, 'Giá cao');
    expect(r.status).toBe(200);
    expect(r.body.data.versions[0]).toMatchObject({ status: 'REJECTED', rejectReason: 'Giá cao' });
    expect((await oppRow(o.id)).version).toBe(v);
  });
});

describe('Nhóm D — đồng thời qua API (mục 8.1)', () => {
  const invariant = async (oppId: string) => {
    const qs = await prisma.quote.findMany({ where: { opportunityId: oppId, deletedAt: null }, select: { id: true, isPrimary: true, versions: { select: { versionNo: true, status: true, subtotalVnd: true }, orderBy: { versionNo: 'asc' } } } });
    const prim = qs.filter((q) => q.isPrimary);
    const accepted = qs.flatMap((q) => q.versions.filter((v) => v.status === 'ACCEPTED').map(() => q.id));
    expect(prim.length).toBeLessThanOrEqual(1);
    expect(accepted.length).toBeLessThanOrEqual(1);
    if (accepted.length) expect(prim.map((q) => q.id)).toEqual(accepted);   // không bao giờ "đã chấp nhận X nhưng đang theo đuổi Y"
    const o = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppId }, select: { expectedAmountVnd: true, status: true } });
    const sent = prim[0]?.versions.filter((v) => v.status !== 'DRAFT') ?? [];
    return { o, last: sent.length ? sent[sent.length - 1]!.subtotalVnd.toString() : null };
  };
  it('D1: hai người cùng gửi một phiên bản => đúng một thành công, người kia 409', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const o = await newOpp();
      const d = await draft(o, String(100 + i));
      const rs = await Promise.all([send('salesA', d, 1), send('crmAdmin', d, 1)]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      const inv = await invariant(o.id);
      expect(inv.o.expectedAmountVnd?.toString()).toBe(inv.last);   // D11
    }
  });
  it('D5 / D7: chấp nhận X đua với đổi đang theo đuổi sang Y => chỉ một trong các kết cục hợp lệ; không bao giờ "đã chấp nhận X nhưng theo đuổi Y"', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const o = await newOpp();
      let x = await draft(o, '100'); x = (await send('salesA', x, 1)).body.data;
      let y = await draft(o, '200'); y = (await send('salesA', y, 1)).body.data;
      const [ra, rp] = await Promise.all([accept('salesA', x, 1), primary('crmAdmin', y)]);
      const out = [ra.status, err(ra).code ?? '-', rp.status, err(rp).code ?? '-'].join(' ');
      expect(['200 - 409 QUOTE_PRIMARY_FIXED', '409 QUOTE_NOT_PRIMARY 200 -', '409 VERSION_CONFLICT 200 -']).toContain(out);
      const inv = await invariant(o.id);
      expect(inv.o.expectedAmountVnd?.toString()).toBe(inv.last);   // D11
    }
  });
  it('D6: gửi báo giá đang theo đuổi đua với sửa tay giá trị cơ hội => chạy lần lượt; lịch sử AMOUNT chỉ ghi khi giá trị thực sự đổi', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const o = await newOpp();
      let d = await draft(o, '100'); d = (await send('salesA', d, 1)).body.data;
      d = await newVersion(d, String(300 + i));
      const ov = (await oppRow(o.id)).version;
      const [rs, rm] = await Promise.all([send('salesA', d, 2), a('crmAdmin').patch(O + '/' + o.id, { version: ov, expectedAmountVnd: '555' })]);
      expect(rs.status).toBe(200);
      expect([200, 409]).toContain(rm.status);
      // Hai yêu cầu cùng giữ khoá dòng cơ hội nên chạy lần lượt:
      //  - gửi trước => version cơ hội đã tăng (100 -> 300+i) => sửa tay mang version cũ nhận 409;
      //  - sửa tay trước (200, 555) => gửi chạy sau và ghi đè bằng tạm tính báo giá (sự kiện gửi kế tiếp thắng sửa tay).
      // Cả hai thứ tự đều kết thúc ở giá trị của bản vừa gửi.
      const amount = (await oppRow(o.id)).expectedAmountVnd?.toString();
      expect(amount).toBe(String(300 + i));
      const hist = await amountHistory(o.id);
      // (không dựa vào thứ tự changedAt: now() là giờ bắt đầu transaction, có thể lệch thứ tự lấy khoá)
      const ch = hist.map((h) => [h.oldValue, h.newValue]);
      if (rm.status === 200) expect(ch).toEqual(expect.arrayContaining([['100', '555'], ['555', String(300 + i)]]));   // sửa tay trước, gửi ghi đè sau
      else expect(ch).toEqual(expect.arrayContaining([['100', String(300 + i)]]));
      expect(ch.some(([, n]) => n === '555')).toBe(rm.status === 200);
      expect(hist.every((h) => h.oldValue !== h.newValue)).toBe(true);   // D11: mỗi dòng AMOUNT là một lần giá trị thực sự đổi
    }
  });
  it('D10: ghi xen kẽ báo giá và cơ hội trên cùng một cơ hội (40 lượt) => không có 500, không có khoá chéo', async () => {
    const o = await newOpp();
    let d = await draft(o, '100'); d = (await send('salesA', d, 1)).body.data;
    const statuses: number[] = []; const codes: string[] = [];
    for (let i = 0; i < 40; i++) {
      const cur = (await a('salesA').get(Q + '/' + d.id)).body.data as Detail;
      const ov = (await oppRow(o.id)).version;
      const rs = await Promise.all([
        a('salesA').post(Q + '/' + d.id + '/versions', { version: cur.version })
          .then((r) => (r.status === 201 ? a('salesA').delete(Q + '/' + d.id + '/versions/' + (cur.versions.length + 1), { version: r.body.data.version }) : r)),
        a('crmAdmin').patch(O + '/' + o.id, { version: ov, title: 'Cơ hội xen kẽ ' + i }),
      ]);
      for (const r of rs) { statuses.push(r.status); if (r.body?.error?.code) codes.push(r.body.error.code); }
    }
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(codes.filter((c) => /BUSY|DEADLOCK/.test(c))).toEqual([]);
    expect(statuses.filter((s) => s >= 400)).toEqual([]);
    await invariant(o.id);
  });
});
