// Báo giá Q5a — GHI qua API (docs/QUOTES_DESIGN.md mục 6, 7, 8, 9; nghiệm thu A1–A14 qua API, C2 phần ghi Q5a, C14 phần ghi, C15):
// tạo báo giá, đổi hạng mục, lưu nháp (máy chủ tự tính mọi tổng bằng BigInt), tạo bản mới (quy tắc chép giá vốn), xoá nháp, xoá báo giá.
// Gửi / chấp nhận / từ chối / đang theo đuổi / đồng bộ giá trị cơ hội thuộc Q5b — ở đây phiên bản "đã gửi" được dựng thẳng bằng SQL.
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, leaks, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, makeOpportunity, uniq } from './helpers/fixtures';

const Q = '/api/v1/quotes';
const O = '/api/v1/opportunities';
const GHOST = '00000000-0000-4000-8000-000000000001';
const hasValue = (body: unknown, ...vals: string[]): boolean => new RegExp('(?<![0-9a-fA-F.-])(' + vals.join('|') + ')(?![0-9a-fA-F-])').test(JSON.stringify(body));
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who?: string, app: INestApplication = t.app) => as(app, who);
const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
type Ref = { id: string; code: string };
let cA: Ref; let cB: Ref; let o1: Ref; let o2: Ref; let o3: Ref; let oHold: Ref;
let tpl = ''; let tplLine = ''; let tplOff = '';
const TAG = 'Q5W' + uniq().replace(/[^a-z0-9]/gi, '');
const COLS = [{ key: 'dk', label: 'Đường kính', unit: 'mm' }];
const create = (who: string, oppId: string, body: object) => a(who).post(O + '/' + oppId + '/quotes', body);
const save = (who: string, id: string, no: number, body: object) => a(who).put(Q + '/' + id + '/versions/' + no, body);
const ITEM = (quantity: string, unitPriceVnd: string, extra: Record<string, unknown> = {}) => ({ kind: 'ITEM', description: 'Hàng ' + quantity + '×' + unitPriceVnd, unit: 'cái', quantity, unitPriceVnd, ...extra });
type Detail = { id: string; code: string; version: number; itemName: string; versions: Array<Record<string, unknown> & { versionNo: number; status: string; lines: Array<Record<string, unknown>> }> };
const latest = (d: Detail) => d.versions[d.versions.length - 1]!;
async function freshQuote(who = 'salesA', opp: Ref = o1, templateId = tpl): Promise<Detail> {
  const r = await create(who, opp.id, { templateId, itemName: 'Ống gió ' + uniq() });
  expect(r.status).toBe(201);
  return r.body.data as Detail;
}
// Dựng thẳng bằng SQL một phiên bản ĐÃ GỬI (thay cho API gửi của Q5b): trigger R-Q1 của DB kiểm lại tổng.
async function markSent(quoteId: string, versionNo: number) {
  const v = await prisma.quoteVersion.findFirstOrThrow({ where: { quoteId, versionNo }, select: { id: true, createdById: true } });
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  await prisma.quoteVersion.update({ where: { id: v.id }, data: { status: 'SENT', quoteDate: today, validUntil: today, sentById: v.createdById, sentAt: new Date() } });
}
// Thay phiên bản 1 (nháp, rỗng) của một báo giá bằng phiên bản 1 do NGƯỜI KHÁC tạo, có một dòng mang giá vốn (dựng bằng SQL).
async function replaceV1ByOther(d: Detail, createdById: string, cost: bigint): Promise<string> {
  await prisma.quoteVersion.deleteMany({ where: { quoteId: d.id } });
  const v1 = (await prisma.quoteVersion.create({
    data: { quoteId: d.id, versionNo: 1, codeSnapshot: d.code, itemName: d.itemName, printTemplate: 'siscom-v1', templateName: 'T', title: 'T', columns: [], vatMode: 'QUOTE', quoterName: 'Người khác', createdById, base10Vnd: 1000n, subtotalVnd: 1000n, vat10Vnd: 100n, totalVnd: 1100n },
    select: { id: true },
  })).id;
  await prisma.quoteLine.create({ data: { quoteVersionId: v1, lineNo: 1, description: 'Có giá vốn', quantity: '1', unitPriceVnd: 1000n, vatPercent: 10, amountVnd: 1000n, costPriceVnd: cost } });
  return v1;
}

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA, name: 'Công ty Ánh Dương ' + TAG });
  cB = await makeCustomer(prisma, fx, { ownerId: fx.empB, name: 'Công ty Bình Minh ' + TAG });
  await makeContact(prisma, cA.id, 'Chị Liên Hệ', true);
  o1 = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, projectName: 'Toà nhà ' + TAG }); // A phụ trách
  o2 = await makeOpportunity(prisma, fx, { customerId: cB.id, ownerId: fx.empB });                                 // của B
  o3 = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empB });                                 // B phụ trách; A chỉ xem (phụ trách khách)
  oHold = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, status: 'ON_HOLD' });
  tpl = (await prisma.quoteTemplate.create({ data: { code: 'zw-' + TAG.toLowerCase(), name: 'Ống gió ' + TAG, title: 'BẢNG BÁO GIÁ ỐNG GIÓ', intro: 'Kính gửi Quý khách', defaultTerms: 'Điều khoản thử', defaultValidDays: 20, defaultVat: 10, columns: COLS }, select: { id: true } })).id;
  tplLine = (await prisma.quoteTemplate.create({ data: { code: 'zw-line-' + TAG.toLowerCase(), name: 'VAT theo dòng ' + TAG, title: 'BÁO GIÁ', vatMode: 'LINE', defaultVat: 8 }, select: { id: true } })).id;
  tplOff = (await prisma.quoteTemplate.create({ data: { code: 'zw-off-' + TAG.toLowerCase(), name: 'Đã ngừng ' + TAG, title: 'X', isActive: false }, select: { id: true } })).id;
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

describe('POST /opportunities/:id/quotes — tạo báo giá', () => {
  it('Kinh doanh phụ trách cơ hội: 201, sinh mã BG-…, phiên bản 1 nháp, ô đầu trang điền sẵn và chép từ loại báo giá; no-store; nhật ký không có tiền', async () => {
    t.audit.entries.length = 0;
    const r = await create('salesA', o1.id, { templateId: tpl, itemName: '  Ống gió vải tầng 3  ' });
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    const d = r.body.data as Detail;
    expect(d.code).toMatch(/^BG-\d{4,}$/);
    expect(d.itemName).toBe('Ống gió vải tầng 3');
    expect(d.version).toBe(1);
    expect(d.versions).toHaveLength(1);
    expect(latest(d)).toMatchObject({
      versionNo: 1, status: 'DRAFT', codeSnapshot: d.code, itemName: 'Ống gió vải tầng 3', printTemplate: 'siscom-v1', templateName: 'Ống gió ' + TAG, title: 'BẢNG BÁO GIÁ ỐNG GIÓ',
      columns: COLS, vatMode: 'QUOTE', intro: 'Kính gửi Quý khách', terms: 'Điều khoản thử', projectName: 'Toà nhà ' + TAG,
      client: { company: 'Công ty Ánh Dương ' + TAG, name: 'Chị Liên Hệ' }, subtotalVnd: '0', totalVnd: '0', lines: [], costVisible: true,
    });
    expect(t.audit.entries.map((e) => e.action)).toEqual(['quote.create']);
    expect(JSON.stringify(t.audit.entries)).not.toMatch(/Vnd|price|amount/i);
  });
  it('quyền: không có mã quote.create => 403; chỉ xem cơ hội => 403; không thấy cơ hội => 404; cơ hội không tồn tại => 404', async () => {
    for (const who of ['acctA', 'techB', 'none']) expect({ who, ...err(await create(who, o1.id, { templateId: tpl, itemName: 'X' })) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
    expect(err(await create('salesA', o3.id, { templateId: tpl, itemName: 'X' }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(err(await create('salesA', o2.id, { templateId: tpl, itemName: 'X' }))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await create('salesA', GHOST, { templateId: tpl, itemName: 'X' }))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
  });
  it('cơ hội không mở => 422; loại đã ngừng => 422; loại không tồn tại => 404; thiếu hạng mục / gửi kèm createdBy => 400', async () => {
    expect(err(await create('salesA', oHold.id, { templateId: tpl, itemName: 'X' }))).toEqual({ s: 422, code: 'OPPORTUNITY_NOT_OPEN' });
    expect(err(await create('salesA', o1.id, { templateId: tplOff, itemName: 'X' }))).toEqual({ s: 422, code: 'TEMPLATE_INACTIVE' });
    expect(err(await create('salesA', o1.id, { templateId: GHOST, itemName: 'X' }))).toEqual({ s: 404, code: 'QUOTE_TEMPLATE_NOT_FOUND' });
    expect((await create('salesA', o1.id, { templateId: tpl, itemName: '   ' })).status).toBe(400);
    expect((await create('salesA', o1.id, { templateId: tpl, itemName: 'X', createdBy: fx.empB })).status).toBe(400);
    expect((await create('salesA', o1.id, { templateId: tpl, itemName: 'X', createdById: fx.empB })).status).toBe(400);
  });
});

describe('PUT /quotes/:id/versions/:no — lưu nháp; máy chủ tự tính mọi tổng (A1–A14 qua API)', () => {
  it('A1 qua API: tổng đúng từng đồng, tiền là chuỗi; quote.version tăng; dòng có giá trị cột riêng', async () => {
    const d = await freshQuote();
    const r = await save('salesA', d.id, 1, {
      version: d.version, vatPercent: 10,
      lines: [{ kind: 'SECTION', description: 'THIẾT BỊ' }, ITEM('5', '1636000', { extra: { dk: '400' } }), ITEM('5', '1722000'), ITEM('1', '636364'), ITEM('1', '1500000')],
    });
    expect(r.status).toBe(200);
    const v = latest(r.body.data as Detail);
    expect(v).toMatchObject({ base8Vnd: '0', base10Vnd: '18926364', vat8Vnd: '0', vat10Vnd: '1892636', subtotalVnd: '18926364', totalVnd: '20819000' });
    expect(v.lines.map((l) => l.amountVnd)).toEqual([null, '8180000', '8610000', '636364', '1500000']);
    expect(v.lines.map((l) => l.vatPercent)).toEqual([null, 10, 10, 10, 10]);
    expect(v.lines[1]).toMatchObject({ lineNo: 2, kind: 'ITEM', quantity: '5', unitPriceVnd: '1636000', extra: { dk: '400' } });
    expect((r.body.data as Detail).version).toBe(2);
  });
  it('A2 qua API với loại VAT theo dòng: hai mức thuế; sai cách nhập VAT theo loại => 400', async () => {
    const d = await freshQuote('salesA', o1, tplLine);
    const r = await save('salesA', d.id, 1, { version: d.version, lines: [ITEM('2.5', '333333', { vatPercent: 8 }), ITEM('1.005', '999', { vatPercent: 10 }), ITEM('237', '17000', { vatPercent: 10 })] });
    expect(r.status).toBe(200);
    expect(latest(r.body.data as Detail)).toMatchObject({ base8Vnd: '833333', base10Vnd: '4030004', vat8Vnd: '66667', vat10Vnd: '403000', subtotalVnd: '4863337', totalVnd: '5333004' });
    // loại theo dòng: thiếu VAT ở dòng hàng, hoặc gửi VAT chung => 400
    expect((await save('salesA', d.id, 1, { version: 2, lines: [ITEM('1', '1')] })).status).toBe(400);
    expect((await save('salesA', d.id, 1, { version: 2, vatPercent: 10, lines: [ITEM('1', '1', { vatPercent: 10 })] })).status).toBe(400);
    // loại một mức: gửi VAT ở dòng, hoặc thiếu VAT chung khi có dòng hàng => 400
    const q = await freshQuote();
    expect((await save('salesA', q.id, 1, { version: q.version, vatPercent: 10, lines: [ITEM('1', '1', { vatPercent: 8 })] })).status).toBe(400);
    expect((await save('salesA', q.id, 1, { version: q.version, lines: [ITEM('1', '1')] })).status).toBe(400);
  });
  it('A14: đơn giá 999999999999, số lượng 999999.999 và tổng sau VAT vượt 2^53 đi trọn vòng yêu cầu → DB → phản hồi đúng từng chữ số', async () => {
    const d = await freshQuote();
    const r = await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: [ITEM('8000', '999999999999'), ITEM('1', '999999999999'), ITEM('999999.999', '1')] });
    expect(r.status).toBe(200);
    const v = latest(r.body.data as Detail);
    expect(v.lines.map((l) => [l.quantity, l.unitPriceVnd, l.amountVnd])).toEqual([['8000', '999999999999', '7999999999992000'], ['1', '999999999999', '999999999999'], ['999999.999', '1', '1000000']]);
    expect(v).toMatchObject({ subtotalVnd: '8001000000991999', vat10Vnd: '800100000099200', totalVnd: '8801100001091199' });
    const db = await prisma.quoteVersion.findFirstOrThrow({ where: { quoteId: d.id, versionNo: 1 }, select: { totalVnd: true } });
    expect(db.totalVnd.toString()).toBe('8801100001091199');
  });
  it('A7 / A11 / A14: vượt giới hạn tổng; SL 4 chữ số thập phân; âm; số JSON; 1e3; 1,000; +5; khoảng trắng; giá lẻ; chữ => 400, KHÔNG lưu gì', async () => {
    const d = await freshQuote();
    const bad: Array<[string, object]> = [
      ['vượt giới hạn', ITEM('999999.999', '999999999999')], ['4 chữ số thập phân', ITEM('1.0005', '1')], ['âm', ITEM('-1', '1')], ['số JSON (SL)', { ...ITEM('1', '1'), quantity: 5 }],
      ['số JSON (giá)', { ...ITEM('1', '1'), unitPriceVnd: 1000 }], ['1e3', ITEM('1', '1e3')], ['1,000', ITEM('1', '1,000')], ['+5', ITEM('+5', '1')], [' 5', ITEM(' 5', '1')],
      ['giá lẻ', ITEM('1', '1.5')], ['chữ', ITEM('mười', '1')], ['giá vốn số JSON', { ...ITEM('1', '1'), costPriceVnd: 5 }], ['giá vốn âm', { ...ITEM('1', '1'), costPriceVnd: '-1' }],
    ];
    for (const [why, line] of bad) {
      const r = await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: [line] });
      expect({ why, s: r.status }).toEqual({ why, s: 400 });
      expect(leaks(r.body)).toBe(false);
    }
    expect(err(await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: [ITEM('999999.999', '999999999999')] }))).toEqual({ s: 400, code: 'AMOUNT_OUT_OF_RANGE' });
    expect((await save('salesA', d.id, 1, { version: d.version, vatPercent: 5, lines: [ITEM('1', '1')] })).status).toBe(400);
    const v = await prisma.quoteVersion.findFirstOrThrow({ where: { quoteId: d.id, versionNo: 1 }, select: { subtotalVnd: true, _count: { select: { lines: true } } } });
    expect({ sub: v.subtotalVnd.toString(), n: v._count.lines }).toEqual({ sub: '0', n: 0 });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: d.id }, select: { version: true } })).version).toBe(1);
  });
  it('A10: tổng do trình duyệt gửi lên không được nhận (thuộc tính lạ => 400); dòng nhóm có số tiền / cột riêng lạ / quá 300 dòng => 400', async () => {
    const d = await freshQuote();
    expect((await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, subtotalVnd: '1', lines: [ITEM('1', '100')] })).status).toBe(400);
    expect((await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: [{ ...ITEM('1', '100'), amountVnd: '999' }] })).status).toBe(400);
    expect((await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: [{ kind: 'SECTION', description: 'NHÓM', quantity: '1' }] })).status).toBe(400);
    expect(err(await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: [ITEM('1', '1', { extra: { la: 'x' } })] }))).toEqual({ s: 400, code: 'VALIDATION_FAILED' });
    expect((await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: [ITEM('1', '1', { extra: { dk: 5 } })] })).status).toBe(400);
    expect((await save('salesA', d.id, 1, { version: d.version, vatPercent: 10, lines: Array.from({ length: 301 }, () => ITEM('1', '1')) })).status).toBe(400);
  });
  it('khoá lạc quan: version cũ => 409 VERSION_CONFLICT; phiên bản không tồn tại => 404; lưu các ô đầu trang; hạn trước ngày báo giá => 400', async () => {
    const d = await freshQuote();
    expect((await save('salesA', d.id, 1, { version: 1, vatPercent: 10, lines: [], clientCompany: 'Công ty đổi tên', quoteDate: '2026-11-20', validUntil: '2026-12-05', note: 'nội bộ' })).status).toBe(200);
    expect(err(await save('salesA', d.id, 1, { version: 1, vatPercent: 10, lines: [] }))).toEqual({ s: 409, code: 'VERSION_CONFLICT' });
    expect(err(await save('salesA', d.id, 9, { version: 2, vatPercent: 10, lines: [] }))).toEqual({ s: 404, code: 'QUOTE_VERSION_NOT_FOUND' });
    const v = (await a('salesA').get(Q + '/' + d.id)).body.data.versions[0];
    expect(v).toMatchObject({ client: { company: 'Công ty đổi tên' }, quoteDate: '2026-11-20', validUntil: '2026-12-05', note: 'nội bộ' });
    expect((await save('salesA', d.id, 1, { version: 2, vatPercent: 10, lines: [], quoteDate: '2026-12-10', validUntil: '2026-12-05' })).status).toBe(400);
  });
  it('quyền: Kế toán / Kỹ thuật => 403; chỉ xem => 403; ngoài phạm vi / không tồn tại => 404; phiên bản đã gửi => 409 QUOTE_VERSION_LOCKED', async () => {
    const d = await freshQuote();
    for (const who of ['acctA', 'techB']) expect({ who, ...err(await save(who, d.id, 1, { version: 1, vatPercent: 10, lines: [] })) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
    expect(err(await save('salesC', d.id, 1, { version: 1, vatPercent: 10, lines: [] }))).toEqual({ s: 404, code: 'QUOTE_NOT_FOUND' });
    expect(err(await save('salesA', GHOST, 1, { version: 1, vatPercent: 10, lines: [] }))).toEqual({ s: 404, code: 'QUOTE_NOT_FOUND' });
    const onB = await freshQuote('salesB', o3);   // cơ hội của B, A phụ trách KHÁCH => A chỉ xem
    expect(err(await save('salesA', onB.id, 1, { version: 1, vatPercent: 10, lines: [] }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await save('salesA', d.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('1', '100')] })).status).toBe(200);
    await markSent(d.id, 1);
    expect(err(await save('salesA', d.id, 1, { version: 2, vatPercent: 10, lines: [ITEM('1', '200')] }))).toEqual({ s: 409, code: 'QUOTE_VERSION_LOCKED' });
  });
});

describe('Giá vốn khi ghi (C14 phần ghi, mục 7.3)', () => {
  it('người tạo nhập giá vốn: chi tiết có giá vốn + lãi gộp tạm tính (A11, A13); danh sách / theo cơ hội / nhật ký không có', async () => {
    t.audit.entries.length = 0;
    const d = await freshQuote();
    const r = await save('salesA', d.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('2.5', '333333', { costPriceVnd: '300000' }), ITEM('1', '100')] });
    expect(r.status).toBe(200);
    const v = latest(r.body.data as Detail);
    expect(v.lines.map((l) => l.costPriceVnd)).toEqual(['300000', null]);
    expect(v.margin).toEqual({ itemLines: 2, costedLines: 1, costedAmountVnd: '833333', costVnd: '750000', grossProfitVnd: '83333' });
    expect(v.subtotalVnd).toBe('833433');
    expect(hasValue((await a('salesA').get(Q + '?pageSize=100')).body, '300000', '750000', '83333')).toBe(false);
    expect(hasValue((await a('salesA').get(O + '/' + o1.id + '/quotes')).body, '300000', '750000', '83333')).toBe(false);
    expect(hasValue(t.audit.entries, '300000', '750000', '83333')).toBe(false);
  });
  it('người không được xem giá vốn (không phải người tạo, không có quote.cost) không sửa được bản nháp: 403, giá vốn không bị xoá, không lộ', async () => {
    // Bản nháp do A tạo trên cơ hội nay do B phụ trách (như sau khi chuyển người phụ trách): B có quote.update nhưng không thấy giá vốn của A.
    const d = await freshQuote('salesB', o2);
    const v1 = await replaceV1ByOther(d, fx.empA, 654321n);
    const r = await save('salesB', d.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('1', '2000')] });
    expect(err(r)).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(hasValue(r.body, '654321')).toBe(false);
    expect((await prisma.quoteLine.findFirstOrThrow({ where: { quoteVersionId: v1 }, select: { costPriceVnd: true } })).costPriceVnd).toBe(654321n);
    // Quản trị CRM (có quote.cost) sửa được và thấy giá vốn.
    const adm = await save('crmAdmin', d.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('1', '2000', { costPriceVnd: '1500' })] });
    expect(adm.status).toBe(200);
    expect(latest(adm.body.data as Detail).lines[0]!.costPriceVnd).toBe('1500');
  });
  it('lỗi kiểm dữ liệu của giá vốn chỉ nêu tên trường và số dòng, không lặp lại giá trị', async () => {
    const d = await freshQuote();
    const r = await save('salesA', d.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('1', '1'), { ...ITEM('1', '1'), costPriceVnd: '7777777777777' }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/lines\[1\]\.costPriceVnd/);
    expect(hasValue(r.body, '7777777777777')).toBe(false);
  });
});

describe('POST /quotes/:id/versions — tạo bản mới; DELETE nháp; DELETE báo giá; PATCH hạng mục', () => {
  it('tạo bản mới từ phiên bản đã gửi: chép dòng, ô đầu trang, cột; số phiên bản kế tiếp; nháp; người tạo = người đang đăng nhập; đã có nháp => 409', async () => {
    const d = await freshQuote();
    await save('salesA', d.id, 1, { version: 1, vatPercent: 10, clientCompany: 'Khách v1', lines: [{ kind: 'SECTION', description: 'NHÓM' }, ITEM('2', '500', { costPriceVnd: '400', extra: { dk: '300' } })] });
    await markSent(d.id, 1);
    const r = await a('salesA').post(Q + '/' + d.id + '/versions', { version: 2 });
    expect(r.status).toBe(201);
    const nd = r.body.data as Detail;
    expect(nd.versions.map((v) => [v.versionNo, v.status])).toEqual([[1, 'SENT'], [2, 'DRAFT']]);
    const v2 = latest(nd);
    expect(v2).toMatchObject({ client: { company: 'Khách v1' }, columns: COLS, subtotalVnd: '1000', createdBy: { id: fx.empA }, sentAt: null });
    expect(v2.lines.map((l) => [l.kind, l.amountVnd, l.costPriceVnd, l.extra])).toEqual([['SECTION', null, null, {}], ['ITEM', '1000', '400', { dk: '300' }]]);
    expect(err(await a('salesA').post(Q + '/' + d.id + '/versions', { version: nd.version }))).toEqual({ s: 409, code: 'QUOTE_DRAFT_EXISTS' });
  });
  it('người không được xem giá vốn của bản nguồn tạo bản mới => giá vốn KHÔNG được chép sang', async () => {
    const d = await freshQuote('salesB', o2);
    await replaceV1ByOther(d, fx.empA, 654321n);
    await markSent(d.id, 1);
    const r = await a('salesB').post(Q + '/' + d.id + '/versions', { version: 1 });
    expect(r.status).toBe(201);
    expect(hasValue(r.body, '654321')).toBe(false);
    expect(latest(r.body.data as Detail).lines.map((l) => l.costPriceVnd)).toEqual([null]);
    expect((await prisma.quoteLine.findFirstOrThrow({ where: { version: { quoteId: d.id, versionNo: 2 } }, select: { costPriceVnd: true } })).costPriceVnd).toBeNull();
  });
  it('xoá nháp: được khi còn phiên bản khác; xoá phiên bản duy nhất => 422; xoá phiên bản đã gửi => 409; Kế toán => 403', async () => {
    const d = await freshQuote();
    expect(err(await a('salesA').delete(Q + '/' + d.id + '/versions/1', { version: 1 }))).toEqual({ s: 422, code: 'QUOTE_LAST_VERSION' });
    await save('salesA', d.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('1', '100')] });
    await markSent(d.id, 1);
    await a('salesA').post(Q + '/' + d.id + '/versions', { version: 2 });
    expect(err(await a('acctA').delete(Q + '/' + d.id + '/versions/2', { version: 3 }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(err(await a('salesA').delete(Q + '/' + d.id + '/versions/1', { version: 3 }))).toEqual({ s: 409, code: 'QUOTE_VERSION_LOCKED' });
    const r = await a('salesA').delete(Q + '/' + d.id + '/versions/2', { version: 3 });
    expect(r.status).toBe(200);
    expect((r.body.data as Detail).versions.map((v) => v.versionNo)).toEqual([1]);
    expect(await prisma.quoteVersion.count({ where: { quoteId: d.id } })).toBe(1);
  });
  it('xoá báo giá: chưa gửi => xoá mềm (sau đó 404); đã có phiên bản gửi => 409; thiếu lý do => 400', async () => {
    const d = await freshQuote();
    expect((await a('salesA').delete(Q + '/' + d.id, { version: 1 })).status).toBe(400);
    expect((await a('salesA').delete(Q + '/' + d.id, { version: 1, reason: 'Lập nhầm' })).status).toBe(200);
    expect(err(await a('salesA').get(Q + '/' + d.id))).toEqual({ s: 404, code: 'QUOTE_NOT_FOUND' });
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: d.id }, select: { deletedAt: true, deletedById: true, deleteReason: true } });
    expect({ del: row.deletedAt !== null, by: row.deletedById, reason: row.deleteReason }).toEqual({ del: true, by: fx.empA, reason: 'Lập nhầm' });
    const s = await freshQuote();
    await save('salesA', s.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('1', '100')] });
    await markSent(s.id, 1);
    expect(err(await a('salesA').delete(Q + '/' + s.id, { version: 2, reason: 'X' }))).toEqual({ s: 409, code: 'QUOTE_DELETE_FORBIDDEN' });
  });
  it('đổi hạng mục: đổi cả hạng mục của bản nháp; phiên bản đã gửi giữ nguyên (mục 4.3); version cũ => 409', async () => {
    const d = await freshQuote();
    await save('salesA', d.id, 1, { version: 1, vatPercent: 10, lines: [ITEM('1', '100')] });
    await markSent(d.id, 1);
    await a('salesA').post(Q + '/' + d.id + '/versions', { version: 2 });
    const r = await a('salesA').patch(Q + '/' + d.id, { version: 3, itemName: 'Hạng mục mới' });
    expect(r.status).toBe(200);
    const nd = r.body.data as Detail;
    expect({ item: nd.itemName, v1: nd.versions[0]!.itemName, v2: nd.versions[1]!.itemName, ver: nd.version }).toEqual({ item: 'Hạng mục mới', v1: d.itemName, v2: 'Hạng mục mới', ver: 4 });
    expect(err(await a('salesA').patch(Q + '/' + d.id, { version: 3, itemName: 'Khác' }))).toEqual({ s: 409, code: 'VERSION_CONFLICT' });
  });
});
