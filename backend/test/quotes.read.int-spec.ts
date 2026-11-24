// Báo giá Q4 — ĐỌC (docs/QUOTES_DESIGN.md mục 7, 9, 11: C1 phần đọc, C3, C12, C14 phần chi tiết, C15, A12): báo giá đi theo CƠ HỘI trên đường đầy đủ;
// giá vốn chỉ cho Quản trị CRM và người tạo phiên bản; mọi phản hồi có Cache-Control: no-store; tổng số chỉ đếm dòng được xem.
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ACCT, as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, makeEmployee, makeOpportunity, uniq } from './helpers/fixtures';

const Q = '/api/v1/quotes';
const O = '/api/v1/opportunities';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who?: string, app: INestApplication = t.app) => as(app, who);
type Ref = { id: string; code: string };
let cA: Ref; let cB: Ref; let o1: Ref; let o2: Ref; let o3: Ref; let oHold: Ref;
let tpl = ''; let tplOff = ''; let techX = '';
let q1 = ''; let q2 = ''; let q3 = ''; let q4 = '';
const TAG = 'Q4R' + uniq().replace(/[^a-z0-9]/gi, '');
const day = (offset: number): Date => new Date(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime() + offset * 86_400_000);
const COLS = [{ key: 'dk', label: 'Đường kính', unit: 'mm' }, { key: 'dai', label: 'Chiều dài', unit: 'm' }];

async function mkQuote(opp: Ref, customerId: string, createdById: string, itemName: string): Promise<string> {
  return (await prisma.quote.create({ data: { opportunityId: opp.id, customerId, templateId: tpl, itemName, createdById }, select: { id: true } })).id;
}
// Một phiên bản NHÁP với các dòng [số lượng, đơn giá, giá vốn]; send => đặt tổng rồi chuyển SENT (trigger R-Q1 kiểm lại tổng).
async function mkVersion(quoteId: string, versionNo: number, createdById: string, lines: Array<[string, bigint, bigint | null]>, send?: { quoteDate: Date; validUntil: Date }) {
  const v = await prisma.quoteVersion.create({
    data: {
      quoteId, versionNo, codeSnapshot: 'BG-THU', itemName: 'Ống gió vải ' + TAG, printTemplate: 'siscom-v1', templateName: 'Ống gió', title: 'BẢNG BÁO GIÁ', columns: COLS, vatMode: 'QUOTE',
      clientName: 'Anh Thử', clientCompany: 'Công ty TNHH Điện lạnh Đông Á', quoterName: 'Người lập thử', note: 'ghi chú nội bộ', createdById,
    }, select: { id: true },
  });
  let base = 0n; let n = 0;
  for (const [qty, price, cost] of lines) {
    const [whole, frac = ''] = qty.split('.');
    const amount = (BigInt(whole + frac.padEnd(3, '0')) * price + 500n) / 1000n;   // số lượng tính theo phần nghìn, 0,5 làm tròn lên
    base += amount;
    await prisma.quoteLine.create({ data: { quoteVersionId: v.id, lineNo: ++n, description: 'Dòng thử ' + n, unit: 'm', extra: { dk: '400' }, quantity: qty, unitPriceVnd: price, vatPercent: 10, amountVnd: amount, costPriceVnd: cost } });
  }
  const vat = (base * 10n + 50n) / 100n;
  await prisma.quoteVersion.update({ where: { id: v.id }, data: { base10Vnd: base, subtotalVnd: base, vat10Vnd: vat, totalVnd: base + vat } });
  if (send) await prisma.quoteVersion.update({ where: { id: v.id }, data: { status: 'SENT', quoteDate: send.quoteDate, validUntil: send.validUntil, sentById: createdById, sentAt: new Date() } });
  return v.id;
}

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  // Kế toán là người KHÁC người tạo báo giá (preset acctA dùng chung nhân viên A với salesA).
  t.actors!.presets['acctC'] = { actor: { employeeId: fx.empC, departmentId: fx.d2 }, scopes: { ...ACCT } };
  // Kỹ thuật được giao việc trên cơ hội (đường theo việc): nhân viên riêng, quyền hiệu lực theo ma trận Kỹ thuật.
  techX = (await makeEmployee({ fullName: 'Q4 Kỹ thuật ' + uniq(), departmentId: fx.d2 })).id;
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, SALES); t.access.scopes.set(techX, TECH);
  t.actors!.presets['techXp'] = { actor: { employeeId: techX, departmentId: fx.d2 }, scopes: { ...TECH } };
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA, name: 'Khách Ánh Dương ' + TAG });
  cB = await makeCustomer(prisma, fx, { ownerId: fx.empB, name: 'Khách Bình Minh ' + TAG });
  await makeContact(prisma, cA.id, 'Chị Liên Hệ Chính', true);
  o1 = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, projectName: 'Toà nhà thử ' + TAG });   // A phụ trách cơ hội + khách
  o2 = await makeOpportunity(prisma, fx, { customerId: cB.id, ownerId: fx.empB });                                       // của B hoàn toàn
  o3 = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empB });                                       // B phụ trách cơ hội; A phụ trách KHÁCH => A chỉ xem
  oHold = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, status: 'ON_HOLD' });
  tpl = (await prisma.quoteTemplate.create({ data: { code: 'zz-' + TAG.toLowerCase(), name: 'Ống gió ' + TAG, title: 'BẢNG BÁO GIÁ ỐNG GIÓ', intro: 'Kính gửi', defaultTerms: 'Điều khoản thử', defaultValidDays: 20, defaultVat: 8, columns: COLS }, select: { id: true } })).id;
  tplOff = (await prisma.quoteTemplate.create({ data: { code: 'zz-off-' + TAG.toLowerCase(), name: 'Đã ngừng ' + TAG, title: 'X', isActive: false }, select: { id: true } })).id;
  q1 = await mkQuote(o1, cA.id, fx.empA, 'Ống gió vải ' + TAG);
  await mkVersion(q1, 1, fx.empA, [['2.5', 333333n, 250000n], ['8999', 999999999999n, null]], { quoteDate: day(-2), validUntil: day(5) });   // A tạo, đã gửi, còn 5 ngày
  await mkVersion(q1, 2, fx.empB, [['1', 125n, 77777n]]);                                                                                    // B tạo, nháp
  q2 = await mkQuote(o2, cB.id, fx.empB, 'Quạt hút ' + TAG);
  await mkVersion(q2, 1, fx.empB, [['3', 5n, 4n]], { quoteDate: day(-30), validUntil: day(-10) });                                           // đã gửi, HẾT hiệu lực
  q3 = await mkQuote(o3, cA.id, fx.empB, 'Gas lạnh ' + TAG);
  await mkVersion(q3, 1, fx.empB, [['1', 1000n, 900n]]);
  q4 = await mkQuote(o2, cB.id, fx.empB, 'Linh kiện ' + TAG);
  await mkVersion(q4, 1, fx.empA, [['1', 2000n, 1888n]]);   // A tạo phiên bản trên cơ hội mà A KHÔNG còn thấy (C14a)
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

const mine = (who: string, extra = '') => a(who).get(Q + '?templateId=' + tpl + '&pageSize=100' + extra);
const ids = (r: { body: { data: { items: Array<{ id: string }> } } }) => r.body.data.items.map((x) => x.id).sort();
const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
const sorted = (...x: string[]) => [...x].sort();

describe('GET /quotes — phạm vi theo cơ hội (C1, C15)', () => {
  it('Kinh doanh thấy báo giá của cơ hội mình phụ trách và của khách mình phụ trách; Quản trị CRM / Kế toán thấy tất cả; total chỉ đếm dòng được xem', async () => {
    const want: Record<string, string[]> = { salesA: sorted(q1, q3), salesB: sorted(q2, q3, q4), salesC: [], crmAdmin: sorted(q1, q2, q3, q4), acctC: sorted(q1, q2, q3, q4) };
    for (const [who, list] of Object.entries(want)) {
      const r = await mine(who);
      expect({ who, s: r.status, ids: ids(r), total: r.body.data.total, pages: r.body.data.totalPages }).toEqual({ who, s: 200, ids: list, total: list.length, pages: list.length === 0 ? 0 : 1 });
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });
  it('không có mã quote.read (Kỹ thuật, không quyền) => 403; chưa xác thực => 401; cả hai vẫn có no-store', async () => {
    for (const who of ['techB', 'none', 'readonly']) { const r = await mine(who); expect({ who, ...err(r) }).toEqual({ who, s: 403, code: 'FORBIDDEN' }); expect(r.headers['cache-control']).toBe('no-store'); }
    const r = await a().get(Q);
    expect(r.status).toBe(401);
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('dòng danh sách: đúng tập khoá, không có giá vốn / dòng hàng; tiền là chuỗi; có nhãn trạng thái của phiên bản mới nhất', async () => {
    const r = await mine('crmAdmin');
    type Item = { id: string; latest: { versionNo: number; state: string; daysLeft: number | null; subtotalVnd: string; totalVnd: string } };
    const by = Object.fromEntries((r.body.data.items as Item[]).map((x) => [x.id, x])) as Record<string, { latest: { versionNo: number; state: string; daysLeft: number | null; subtotalVnd: string; totalVnd: string } }>;
    expect(Object.keys(by[q1]!).sort()).toEqual(['code', 'createdAt', 'createdBy', 'customer', 'id', 'isPrimary', 'itemName', 'latest', 'opportunity', 'template', 'updatedAt', 'version']);
    expect(by[q1]!.latest).toMatchObject({ versionNo: 2, state: 'DRAFT', daysLeft: null, subtotalVnd: '125', totalVnd: '138' });
    expect(by[q2]!.latest).toMatchObject({ versionNo: 1, state: 'EXPIRED', daysLeft: -10, subtotalVnd: '15', totalVnd: '17' });
    expect(JSON.stringify(r.body)).not.toMatch(/costPrice|250000|77777|1888|"lines"/);
  });
  it('lọc trạng thái theo phiên bản MỚI NHẤT; "hết hiệu lực" dùng cùng mốc ngày với nhãn', async () => {
    const want: Record<string, string[]> = { DRAFT: sorted(q1, q3, q4), EXPIRED: [q2], SENT: [], EXPIRING: [], ACCEPTED: [], REJECTED: [] };
    for (const [state, list] of Object.entries(want)) { const r = await mine('crmAdmin', '&state=' + state); expect({ state, ids: ids(r), total: r.body.data.total }).toEqual({ state, ids: list, total: list.length }); }
    // Kinh doanh A lọc EXPIRED: báo giá hết hiệu lực q2 nằm ngoài phạm vi => 0 dòng, total 0 (bộ lọc không làm lộ sự tồn tại)
    expect((await mine('salesA', '&state=EXPIRED')).body.data).toMatchObject({ items: [], total: 0 });
  });
  it('tìm theo hạng mục / tên khách không phân biệt dấu và hoa thường; theo mã; từ khoá có % và _ không thành ký tự đại diện', async () => {
    expect(ids(await mine('crmAdmin', '&q=' + encodeURIComponent('ong gio vai')))).toEqual([q1]);
    expect(ids(await mine('crmAdmin', '&q=' + encodeURIComponent('BÌNH MINH')))).toEqual(sorted(q2, q4));
    const code = (await prisma.quote.findUniqueOrThrow({ where: { id: q3 }, select: { code: true } })).code;
    expect(ids(await mine('crmAdmin', '&q=' + encodeURIComponent(code.toLowerCase())))).toEqual([q3]);
    expect(ids(await mine('crmAdmin', '&q=' + encodeURIComponent('%_')))).toEqual([]);
    expect(ids(await mine('salesA', '&q=' + encodeURIComponent('binh minh')))).toEqual([]);
  });
  it('lọc theo người phụ trách cơ hội, khách, cơ hội; sắp xếp theo mã', async () => {
    expect(ids(await mine('crmAdmin', '&ownerId=' + fx.empA))).toEqual([q1]);
    expect(ids(await mine('crmAdmin', '&customerId=' + cB.id))).toEqual(sorted(q2, q4));
    expect(ids(await mine('crmAdmin', '&opportunityId=' + o3.id))).toEqual([q3]);
    const r = await mine('crmAdmin', '&sortBy=code&sortOrder=asc');
    const codes = (r.body.data.items as Array<{ code: string }>).map((x) => x.code);
    expect(codes).toEqual([...codes].sort());
  });
  it('tham số lạ / lọc hay sắp xếp theo giá vốn => 400, không lộ chi tiết nội bộ', async () => {
    for (const p of ['&sortBy=costPriceVnd', '&costMin=1', '&state=KHAC', '&q=a', '&pageSize=101', '&templateId=abc', '&margin=desc']) {
      const r = await mine('crmAdmin', p);
      expect({ p, s: r.status }).toEqual({ p, s: 400 });
      expect(leaks(r.body)).toBe(false);
    }
  });
});

describe('GET /quotes/:id — chi tiết và giá vốn theo TỪNG phiên bản (C14)', () => {
  type V = { versionNo: number; costVisible: boolean; lines: Array<Record<string, unknown>>; subtotalVnd: string; totalVnd: string; suggestedFileName: string; state: string; daysLeft: number | null };
  const get = async (who: string, id: string) => { const r = await a(who).get(Q + '/' + id); expect({ who, s: r.status }).toEqual({ who, s: 200 }); expect(r.headers['cache-control']).toBe('no-store'); return r.body.data as { versions: V[]; can: Record<string, boolean> }; };
  it('Quản trị CRM: mọi phiên bản đều có giá vốn', async () => {
    const d = await get('crmAdmin', q1);
    expect(d.versions.map((v) => [v.versionNo, v.costVisible, v.lines.map((l) => l['costPriceVnd'])])).toEqual([[1, true, ['250000', null]], [2, true, ['77777']]]);
  });
  it('người tạo: CHỈ phiên bản mình tạo có giá vốn; phiên bản người khác tạo KHÔNG có khoá giá vốn', async () => {
    const d = await get('salesA', q1);
    expect(d.versions.map((v) => [v.versionNo, v.costVisible])).toEqual([[1, true], [2, false]]);
    expect(d.versions[0]!.lines[0]).toHaveProperty('costPriceVnd', '250000');
    expect(Object.keys(d.versions[1]!.lines[0]!)).not.toContain('costPriceVnd');
    expect(JSON.stringify(d.versions[1])).not.toMatch(/77777/);
  });
  it('Kế toán (xem được báo giá) và Kinh doanh chỉ-xem: không có khoá giá vốn ở phiên bản nào', async () => {
    for (const [who, id] of [['acctC', q1], ['salesA', q3]] as const) {
      const d = await get(who, id);
      for (const v of d.versions) { expect({ who, v: v.versionNo, cost: v.costVisible }).toEqual({ who, v: v.versionNo, cost: false }); for (const l of v.lines) expect(Object.keys(l)).not.toContain('costPriceVnd'); }
      expect(JSON.stringify(d)).not.toMatch(/costPrice|250000|77777|"900"/);
    }
  });
  it('người tạo cũ không còn thấy cơ hội => 404, không thấy cả báo giá lẫn giá vốn (created_by không mở rộng phạm vi)', async () => {
    const r = await a('salesA').get(Q + '/' + q4);
    expect(err(r)).toEqual({ s: 404, code: 'QUOTE_NOT_FOUND' });
    expect(JSON.stringify(r.body)).not.toMatch(/1888|2000/);
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('ngoài phạm vi / không tồn tại / đã xoá mềm => cùng một 404; không có mã đọc => 403; id sai dạng => 400', async () => {
    const gone = await mkQuote(o1, cA.id, fx.empA, 'Đã xoá ' + TAG);
    await prisma.quote.update({ where: { id: gone }, data: { deletedAt: new Date(), deletedById: fx.empA, deleteReason: 'thử' } });
    for (const [who, id] of [['salesB', q1], ['salesC', q2], ['crmAdmin', GHOST], ['crmAdmin', gone], ['salesA', gone]] as const) expect({ who, ...err(await a(who).get(Q + '/' + id)) }).toEqual({ who, s: 404, code: 'QUOTE_NOT_FOUND' });
    // Thiếu mã đọc => 403 quyết định TRƯỚC khi tra bản ghi: id có thật, không tồn tại, đã xoá mềm cho CÙNG một phản hồi (review R1-02 — không lộ sự tồn tại).
    for (const who of ['techB', 'none']) {
      const seen = new Set<string>();
      for (const id of [q1, GHOST, gone]) { const r = await a(who).get(Q + '/' + id); expect({ who, id, ...err(r) }).toEqual({ who, id, s: 403, code: 'FORBIDDEN' }); seen.add(JSON.stringify({ ...r.body, timestamp: undefined }).split(id).join('<id>')); }
      expect([...seen]).toHaveLength(1);
      expect({ who, ...err(await a(who).get(O + '/' + GHOST + '/quotes')) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
    }
    expect((await a('crmAdmin').get(Q + '/khong-phai-uuid')).status).toBe(400);
  });
  it('tiền là chuỗi, đúng từng chữ số khi vượt 2^53 (A12); tên tệp gợi ý; nhãn còn hạn', async () => {
    const d = await get('crmAdmin', q1);
    const v1 = d.versions[0]!;
    // 2,5 × 333 333 = 833 333 (làm tròn lên) + 8 999 × 999 999 999 999; tổng sau VAT vượt 2^53 (9 007 199 254 740 991)
    expect([v1.subtotalVnd, v1.totalVnd]).toEqual(['8999000000824334', '9898900000906767']);
    expect(v1.lines.map((l) => [l['quantity'], l['unitPriceVnd'], l['amountVnd']])).toEqual([['2.5', '333333', '833333'], ['8999', '999999999999', '8998999999991001']]);
    expect(v1.suggestedFileName).toMatch(/^\d{8}_BG-THU_CongTyTNHHDienLanhDongA_OngGioVaiQ4R[A-Za-z0-9]+$/);
    expect(d.versions[1]!.suggestedFileName).toMatch(/_v2_.*_NHAP$/);
    expect([v1.state, v1.daysLeft]).toEqual(['SENT', 5]);
  });
  it('cờ can.*: người phụ trách cơ hội ghi được; người chỉ xem / Kế toán không; Kế toán tải được', async () => {
    expect((await get('salesA', q1)).can).toEqual({ update: true, send: true, decide: true, delete: true, export: true });
    expect((await get('salesA', q3)).can).toEqual({ update: false, send: false, decide: false, delete: false, export: false });
    expect((await get('acctC', q1)).can).toEqual({ update: false, send: false, decide: false, delete: false, export: true });
  });
});

describe('GET /opportunities/:id/quotes — tab Báo giá của cơ hội', () => {
  const list = (who: string, id: string) => a(who).get(O + '/' + id + '/quotes');
  it('trả mọi báo giá của cơ hội kèm bảng phiên bản; không có giá vốn; can.create theo người phụ trách', async () => {
    const r = await list('salesA', o1.id);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const d = r.body.data as { items: Array<{ id: string; versions: Array<{ versionNo: number; state: string; subtotalVnd: string }> }>; can: Record<string, boolean> };
    expect(d.items.filter((x) => x.id === q1).map((x) => x.versions.map((v) => [v.versionNo, v.state, v.subtotalVnd]))).toEqual([[[1, 'SENT', '8999000000824334'], [2, 'DRAFT', '125']]]);
    expect(d.can).toEqual({ create: true, export: true });
    expect(JSON.stringify(r.body)).not.toMatch(/costPrice|250000|77777/);
    expect((await list('salesA', o3.id)).body.data.can).toEqual({ create: false, export: false });
    expect((await list('acctC', o2.id)).body.data.can).toEqual({ create: false, export: true });
  });
  it('cơ hội ngoài phạm vi / không tồn tại => 404; Kỹ thuật có VIỆC trên cơ hội vẫn không vào được báo giá (C3)', async () => {
    for (const [who, id] of [['salesA', o2.id], ['salesC', o1.id], ['crmAdmin', GHOST]] as const) expect({ who, ...err(await list(who, id)) }).toEqual({ who, s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    // Giao việc kỹ thuật trên o1 cho nhân viên kỹ thuật X => người đó thấy cơ hội theo đường theo việc
    const task = await a('salesA').post(O + '/' + o1.id + '/activities', { type: 'TASK', content: 'Việc kỹ thuật ' + uniq(), dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), performedById: techX, external: true });
    expect(task.status).toBe(201);
    const opp = await a('techXp').get(O + '/' + o1.id);
    expect(opp.status).toBe(200);
    expect(JSON.stringify(opp.body)).not.toMatch(/quote|BG-/i);
    for (const u of [O + '/' + o1.id + '/quotes', O + '/' + o1.id + '/quotes/defaults?templateId=' + tpl, Q, Q + '/' + q1, Q + '/templates', Q + '/my-defaults']) {
      const r = await a('techXp').get(u);
      expect({ u, s: r.status }).toEqual({ u, s: 403 });
      expect(JSON.stringify(r.body)).not.toMatch(/BG-|833333|Ống gió/);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('loại báo giá và mặc định cá nhân (C12)', () => {
  it('GET /quotes/templates: người lập báo giá chỉ thấy loại đang dùng; all=1 chỉ cho người quản lý loại; Kế toán / Kỹ thuật => 403', async () => {
    const r = await a('salesA').get(Q + '/templates');
    expect(r.status).toBe(200);
    const items = r.body.data.items as Array<{ id: string; isActive: boolean }>;
    expect(items.some((x) => x.id === tpl)).toBe(true);
    expect(items.some((x) => x.id === tplOff)).toBe(false);
    expect(items.every((x) => x.isActive)).toBe(true);
    expect(r.body.data.canManage).toBe(false);
    expect(Object.keys(items.find((x) => x.id === tpl)!).sort()).toEqual(['code', 'columns', 'defaultTerms', 'defaultValidDays', 'defaultVat', 'id', 'intro', 'isActive', 'name', 'sortOrder', 'title', 'vatMode', 'version']);
    expect(err(await a('salesA').get(Q + '/templates?all=1'))).toEqual({ s: 403, code: 'FORBIDDEN' });
    const all = await a('crmAdmin').get(Q + '/templates?all=1');
    expect((all.body.data.items as Array<{ id: string }>).some((x) => x.id === tplOff)).toBe(true);
    expect(all.body.data.canManage).toBe(true);
    for (const who of ['acctC', 'techB', 'none']) expect({ who, ...err(await a(who).get(Q + '/templates')) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
    expect((await a('crmAdmin').get(Q + '/templates?all=yes')).status).toBe(400);
  });
  it('GET /quotes/my-defaults: luôn là của chính mình; chưa lưu => saved false; không có đường đọc mặc định của người khác', async () => {
    await prisma.quoteUserDefault.deleteMany({ where: { employeeId: { in: [fx.empA, fx.empB] } } }).catch(() => undefined);
    expect((await a('salesB').get(Q + '/my-defaults')).body.data).toEqual({ saved: false, quoterTitle: null, quoterPhone: null, quoterEmail: null, paymentInfo: '', updatedAt: null });
    await prisma.quoteUserDefault.upsert({ where: { employeeId: fx.empA }, create: { employeeId: fx.empA, quoterTitle: 'Kinh doanh dự án', paymentInfo: 'TK thử của A ' + TAG }, update: { quoterTitle: 'Kinh doanh dự án', paymentInfo: 'TK thử của A ' + TAG } });
    expect((await a('salesA').get(Q + '/my-defaults')).body.data).toMatchObject({ saved: true, quoterTitle: 'Kinh doanh dự án', paymentInfo: 'TK thử của A ' + TAG });
    const b = await a('salesB').get(Q + '/my-defaults');
    expect(JSON.stringify(b.body)).not.toMatch(/TK thử của A/);
    // Không có tham số chọn nhân viên: gửi kèm employeeId cũng chỉ nhận mặc định của CHÍNH MÌNH
    const forced = await a('salesB').get(Q + '/my-defaults?employeeId=' + fx.empA);
    expect(forced.body.data).toMatchObject({ saved: false, paymentInfo: '' });
    expect(JSON.stringify(forced.body)).not.toMatch(/TK thử của A/);
    for (const who of ['acctC', 'techB', 'none']) expect({ who, ...err(await a(who).get(Q + '/my-defaults')) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
  });
});

describe('GET /opportunities/:id/quotes/defaults — giá trị điền sẵn', () => {
  const get = (who: string, oppId: string, templateId = tpl) => a(who).get(O + '/' + oppId + '/quotes/defaults?templateId=' + templateId);
  it('người phụ trách: khối khách lấy từ khách + người liên hệ chính, khối người báo giá từ nhân viên + mặc định cá nhân, điều khoản và cột từ loại báo giá', async () => {
    const r = await get('salesA', o1.id);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const d = r.body.data as Record<string, unknown> & { client: Record<string, unknown>; quoter: Record<string, unknown>; template: { id: string; columns: unknown }; quoteDate: string; validUntil: string };
    expect(d.client).toMatchObject({ name: 'Chị Liên Hệ Chính', company: 'Khách Ánh Dương ' + TAG, contact: null });
    expect(d.projectName).toBe('Toà nhà thử ' + TAG);
    expect(d.quoter).toMatchObject({ title: 'Kinh doanh dự án' });
    expect(typeof d.quoter['name']).toBe('string');
    expect(d).toMatchObject({ intro: 'Kính gửi', terms: 'Điều khoản thử', vatPercent: 8, printTemplate: 'siscom-v1', paymentInfo: 'TK thử của A ' + TAG });
    expect(d.template).toMatchObject({ id: tpl, columns: COLS });
    expect((new Date(d.validUntil).getTime() - new Date(d.quoteDate).getTime()) / 86_400_000).toBe(20);
    expect(Object.keys(d).sort()).toEqual(['client', 'intro', 'paymentInfo', 'printTemplate', 'projectName', 'quoteDate', 'quoter', 'template', 'terms', 'validUntil', 'vatPercent']);
  });
  it('chỉ xem (không phụ trách cơ hội) / Kế toán => 403; ngoài phạm vi => 404; cơ hội không mở => 422; loại đã ngừng => 422; loại không tồn tại => 404; thiếu templateId => 400', async () => {
    expect(err(await get('salesA', o3.id))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(err(await get('acctC', o1.id))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(err(await get('salesA', o2.id))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await get('salesA', oHold.id))).toEqual({ s: 422, code: 'OPPORTUNITY_NOT_OPEN' });
    expect(err(await get('salesA', o1.id, tplOff))).toEqual({ s: 422, code: 'TEMPLATE_INACTIVE' });
    expect(err(await get('salesA', o1.id, GHOST))).toEqual({ s: 404, code: 'QUOTE_TEMPLATE_NOT_FOUND' });
    expect((await a('salesA').get(O + '/' + o1.id + '/quotes/defaults')).status).toBe(400);
    expect((await get('crmAdmin', o2.id)).status).toBe(200);
  });
});
