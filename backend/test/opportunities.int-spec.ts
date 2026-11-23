// Sales S6 — API ĐỌC cơ hội trên DB thử (docs/SALES_DESIGN.md §5.1, §5.4, §7; tiêu chí nghiệm thu 7, 9, 9c(iii), 11, 12 phần đọc).
// Ma trận vai trò (preset giống BIZ thật): salesA/salesB/salesC (OWN), acctA (chỉ đọc ALL), crmAdmin (ALL), techB (chỉ read_assigned — đường
// theo việc thuộc S9), readonly/none (không có mã opportunity.*), không header => 401.
// DB thử dùng chung giữa các lần chạy => mọi danh sách đều lọc theo từ khoá RIÊNG của lần chạy (q=TOK) hoặc theo khách vừa tạo.
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, makeOpportunity, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const C = '/api/v1/customers/';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who = 'crmAdmin') => as(t.app, who);
const anon = () => as(t.app);
const TOK = 's6' + uniq().replace(/[^a-z0-9]/gi, '');
type Ref = { id: string; code: string };
let cA: Ref; let cB: Ref; let cC: Ref; let cDel: Ref;
let oA1: Ref; let oA2: Ref; let oB1: Ref; let oC1: Ref; let oC2: Ref; let oDel: Ref; let oOnDelCust: Ref;
let ctA: Ref;

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  // Quyền hiệu lực "trong DB" của người phụ trách (cho cờ ownerLostAccess): cả ba là Kinh doanh.
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, SALES); t.access.scopes.set(fx.empC, SALES);
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA }); // phòng 1, chủ = A
  cB = await makeCustomer(prisma, fx, { ownerId: fx.empB }); // phòng 1, chủ = B
  cC = await makeCustomer(prisma, fx, { ownerId: fx.empC }); // phòng 2, chủ = C
  cDel = await makeCustomer(prisma, fx, { ownerId: fx.empA, deleted: true });
  ctA = await makeContact(prisma, cA.id, 'Liên hệ S6 ' + TOK);
  const T = (s: string) => 'S6 ' + TOK + ' ' + s;
  oA1 = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: T('chiller'), stage: 'T_QUOTE', type: 'T_INSTALL', amount: 7_200_000_000n, probability: 45, closeDate: '2026-12-20', projectName: 'Tháp ' + TOK.toUpperCase(), contactId: ctA.id, needSummary: 'Nhu cầu thử' });
  oA2 = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empB, title: T('fcu') }); // B phụ trách CƠ HỘI, A phụ trách KHÁCH; giá trị chưa rõ
  oB1 = await makeOpportunity(prisma, fx, { customerId: cB.id, ownerId: fx.empB, title: T('tam hoan'), status: 'ON_HOLD', amount: 100_000_000n, closeDate: '2027-01-31' });
  oC1 = await makeOpportunity(prisma, fx, { customerId: cC.id, ownerId: fx.empC, title: T('thang'), status: 'WON', amount: 4_000_000_000n, probability: 70 });
  oC2 = await makeOpportunity(prisma, fx, { customerId: cC.id, ownerId: fx.empC, title: T('thua'), status: 'LOST', probability: 25 });
  oDel = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: T('da xoa'), deleted: true });
  oOnDelCust = await makeOpportunity(prisma, fx, { customerId: cDel.id, ownerId: fx.empA, title: T('khach da xoa') });
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

const list = (who: string, qs = '') => a(who).get(O + '?q=' + TOK + qs);
const ids = (res: { body: { data: { items: Array<{ id: string }> } } }) => res.body.data.items.map((x) => x.id).sort();
const sorted = (...r: Ref[]) => r.map((x) => x.id).sort();

describe('xác thực và quyền cơ bản', () => {
  it('không xác thực => 401 cho cả ba đường đọc', async () => {
    expect((await anon().get(O)).status).toBe(401);
    expect((await anon().get(O + '/' + oA1.id)).status).toBe(401);
    expect((await anon().get(C + cA.id + '/opportunities')).status).toBe(401);
  });
  it('không có mã opportunity.* nào (Quản trị hệ thống, vai trò chỉ đọc khách) => 403 cho cả ba đường, không lộ chi tiết', async () => {
    for (const who of ['none', 'readonly']) {
      for (const u of [O, O + '/' + oA1.id, C + cA.id + '/opportunities']) {
        const r = await a(who).get(u);
        expect({ who, u, s: r.status, code: r.body.error?.code }).toEqual({ who, u, s: 403, code: 'FORBIDDEN' });
        expect(leaks(r.body)).toBe(false);
      }
    }
  });
});

describe('ma trận đọc — danh sách và chi tiết dùng cùng một vị từ (TC 9)', () => {
  const live = () => [oA1, oA2, oB1, oC1, oC2];
  const expectSees = async (who: string, visible: Ref[]) => {
    const r = await list(who, '&pageSize=100');
    expect(r.status).toBe(200);
    expect({ who, ids: ids(r) }).toEqual({ who, ids: sorted(...visible) });
    expect(r.body.data.total).toBe(visible.length);
    for (const o of [...live(), oDel, oOnDelCust]) {
      const d = await a(who).get(O + '/' + o.id);
      const want = visible.some((v) => v.id === o.id) ? 200 : 404;
      expect({ who, code: o.code, s: d.status }).toEqual({ who, code: o.code, s: want });
      if (want === 404) { expect(d.body.error.code).toBe('OPPORTUNITY_NOT_FOUND'); expect(leaks(d.body)).toBe(false); }
    }
  };
  it('Kinh doanh A (phụ trách khách cA): thấy cơ hội mình phụ trách VÀ cơ hội của khách mình do người khác phụ trách [C4]', async () => {
    await expectSees('salesA', [oA1, oA2]);
  });
  it('Kinh doanh B: thấy cơ hội mình phụ trách ở khách của người khác (oA2) và ở khách mình (oB1); KHÔNG thấy cơ hội khác của khách cA', async () => {
    await expectSees('salesB', [oA2, oB1]);
  });
  it('Kinh doanh C (phòng khác): chỉ cơ hội của mình', async () => {
    await expectSees('salesC', [oC1, oC2]);
  });
  it('Kế toán (đọc ALL) và Quản trị CRM (ALL): mọi cơ hội đang hoạt động', async () => {
    await expectSees('acctA', live());
    await expectSees('crmAdmin', live());
  });
  it('cơ hội đã xoá mềm và cơ hội của khách đã xoá mềm: 404 với MỌI vai trò, không nằm trong danh sách thường (TC 9c(iii))', async () => {
    for (const who of ['crmAdmin', 'acctA', 'salesA', 'all']) {
      expect((await a(who).get(O + '/' + oDel.id)).status).toBe(404);
      expect((await a(who).get(O + '/' + oOnDelCust.id)).status).toBe(404);
      const r = await list(who, '&pageSize=100');
      expect(ids(r)).not.toContain(oDel.id);
      expect(ids(r)).not.toContain(oOnDelCust.id);
    }
  });
  it('Kỹ thuật (chỉ có read_assigned; đường theo việc thuộc S9): danh sách rỗng, chi tiết 404 — không 403, không lộ dữ liệu', async () => {
    const r = await list('techB', '&pageSize=100');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ items: [], total: 0 });
    for (const o of live()) expect((await a('techB').get(O + '/' + o.id)).status).toBe(404);
  });
  it('phạm vi DEPARTMENT cho opportunity.* (không cấp ở đợt này) => fail-closed: danh sách rỗng, chi tiết 404', async () => {
    const r = await list('deptA', '&pageSize=100');
    expect(r.body.data.total).toBe(0);
    expect((await a('deptA').get(O + '/' + oA1.id)).status).toBe(404);
  });
  it('id không tồn tại => 404; id không phải uuid => 400', async () => {
    expect((await a().get(O + '/' + GHOST)).status).toBe(404);
    expect((await a().get(O + '/khong-phai-uuid')).status).toBe(400);
  });
});

describe('nội dung trả về — đường đầy đủ', () => {
  it('chi tiết OPEN: đủ trường; giá trị là CHUỖI; thẻ khách tối thiểu; người liên hệ của cơ hội', async () => {
    const r = await a('salesA').get(O + '/' + oA1.id);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({
      id: oA1.id, code: oA1.code, status: 'OPEN', access: 'FULL', expectedAmountVnd: '7200000000', probability: 45, probabilityOverridden: false,
      expectedCloseDate: '2026-12-20', isProjectLinked: true, projectName: 'Tháp ' + TOK.toUpperCase(), offerScope: 'Phạm vi chào thử', needSummary: 'Nhu cầu thử',
      type: { code: 'T_INSTALL', label: 'Thi công (thử)' }, stage: { code: 'T_QUOTE', label: 'Báo giá (thử)' },
      owner: { id: fx.empA }, customerReadable: true,
      holdUntil: null, holdReason: null, wonAmountVnd: null, wonDocType: null, wonDocNo: null, wonDocDate: null, wonDocUrl: null, lostReason: null, lostNote: null, closedAt: null,
    });
    expect(d.code).toMatch(/^CH-\d{4,}$/);
    expect(Object.keys(d.customer).sort()).toEqual(['address', 'code', 'id', 'name', 'phone', 'provinceName', 'shortName']);
    expect(d.customer).toMatchObject({ id: cA.id, code: cA.code });
    expect(d.contact).toMatchObject({ id: ctA.id, fullName: 'Liên hệ S6 ' + TOK });
    expect(Object.keys(d.contact).sort()).toEqual(['code', 'fullName', 'id', 'phone', 'title']);
    // Không lộ trường của hồ sơ khách ngoài thẻ tối thiểu.
    expect(JSON.stringify(d)).not.toMatch(/taxId|email|revenue|note"/);
  });
  it('giá trị trống trả null ("Chưa rõ"), không bao giờ là 0 hay "0" (TC 7) — ở cả chi tiết lẫn danh sách', async () => {
    const d = (await a('salesB').get(O + '/' + oA2.id)).body.data;
    expect(d.expectedAmountVnd).toBeNull();
    const item = (await list('salesB', '&pageSize=100')).body.data.items.find((x: { id: string }) => x.id === oA2.id);
    expect(item.expectedAmountVnd).toBeNull();
  });
  it('người phụ trách cơ hội KHÔNG phụ trách khách: vẫn nhận thẻ khách tối thiểu, customerReadable = false; hồ sơ khách qua API Khách hàng => 404 (TC 11)', async () => {
    const d = (await a('salesB').get(O + '/' + oA2.id)).body.data;
    expect(d.customerReadable).toBe(false);
    expect(d.customer).toMatchObject({ id: cA.id, code: cA.code });
    expect((await a('salesB').get(C + cA.id)).status).toBe(404);
  });
  it('Tạm hoãn: có hạn + lý do; Thắng: xác suất hiển thị 100 + chứng từ; Thua: xác suất hiển thị 0 + lý do — trạng thái khác thì các trường đó là null', async () => {
    const hold = (await a().get(O + '/' + oB1.id)).body.data;
    expect(hold).toMatchObject({ status: 'ON_HOLD', holdUntil: '2027-01-15', holdReason: 'Khách hoãn (thử)', wonAmountVnd: null, lostReason: null, closedAt: null });
    const won = (await a().get(O + '/' + oC1.id)).body.data;
    expect(won).toMatchObject({ status: 'WON', probability: 100, wonAmountVnd: '5000000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-THU-01', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.google.com/thu', holdUntil: null, lostReason: null });
    expect(typeof won.closedAt).toBe('string');
    const lost = (await a().get(O + '/' + oC2.id)).body.data;
    expect(lost).toMatchObject({ status: 'LOST', probability: 0, lostReason: { code: 'T_PRICE' }, lostNote: 'Ghi chú thua (thử)', wonAmountVnd: null, wonDocNo: null });
  });
  it('dòng danh sách: đủ trường tóm tắt, không có trường chi tiết (nhu cầu, lý do, chứng từ)', async () => {
    const item = (await list('crmAdmin', '&pageSize=100')).body.data.items.find((x: { id: string }) => x.id === oC1.id);
    expect(item).toMatchObject({ code: oC1.code, status: 'WON', probability: 100, wonAmountVnd: '5000000000', customer: { id: cC.id, code: cC.code }, owner: { id: fx.empC }, deletedAt: null });
    for (const k of ['needSummary', 'offerScope', 'holdReason', 'wonDocNo', 'wonDocUrl', 'lostNote', 'lostReason', 'contact']) expect(item).not.toHaveProperty(k);
  });
});

describe('bộ lọc, tìm kiếm, phân trang — luôn áp SAU vị từ phạm vi', () => {
  it('lọc theo người phụ trách không mở được cơ hội ngoài phạm vi: Kinh doanh C lọc ownerId = A => rỗng', async () => {
    const r = await list('salesC', '&ownerId=' + fx.empA);
    expect(r.body.data).toMatchObject({ items: [], total: 0 });
    expect(ids(await list('crmAdmin', '&ownerId=' + fx.empA))).toEqual(sorted(oA1));
  });
  it('lọc theo trạng thái, giai đoạn, loại, khách', async () => {
    expect(ids(await list('crmAdmin', '&status=ON_HOLD'))).toEqual(sorted(oB1));
    expect(ids(await list('crmAdmin', '&status=WON'))).toEqual(sorted(oC1));
    expect(ids(await list('crmAdmin', '&stageId=' + fx.oppStage['T_QUOTE']))).toEqual(sorted(oA1));
    expect(ids(await list('crmAdmin', '&typeId=' + fx.oppType['T_INSTALL']))).toEqual(sorted(oA1));
    expect(ids(await list('crmAdmin', '&customerId=' + cC.id))).toEqual(sorted(oC1, oC2));
    expect(ids(await list('salesB', '&customerId=' + cA.id))).toEqual(sorted(oA2));
  });
  it('lọc theo ngày dự kiến chốt (khoảng đóng hai đầu); cơ hội chưa có ngày không khớp', async () => {
    expect(ids(await list('crmAdmin', '&closeFrom=2026-12-20&closeTo=2026-12-20'))).toEqual(sorted(oA1));
    expect(ids(await list('crmAdmin', '&closeFrom=2026-12-21'))).toEqual(sorted(oB1));
    expect(ids(await list('crmAdmin', '&closeTo=2026-12-19'))).toEqual([]);
  });
  // T-07: tìm không phân biệt dấu tiếng Việt và hoa/thường (cột gập dấu f_vn_fold) — các ca chi tiết ở describe "tìm không dấu (T-07)" bên dưới.
  it('tìm theo tiêu đề hoặc tên dự án (chứa); không phân biệt hoa thường; kết quả vẫn trong phạm vi', async () => {
    expect(ids(await a('crmAdmin').get(O + '?q=' + encodeURIComponent('Tháp ' + TOK.toUpperCase())))).toEqual(sorted(oA1));
    expect(ids(await a('crmAdmin').get(O + '?q=' + encodeURIComponent('Tháp ' + TOK)))).toEqual(sorted(oA1));
    expect(ids(await a('crmAdmin').get(O + '?q=' + encodeURIComponent('thap ' + TOK)))).toEqual(sorted(oA1));
    expect(ids(await a('crmAdmin').get(O + '?q=' + encodeURIComponent(TOK.toUpperCase() + ' FCU')))).toEqual(sorted(oA2));
    expect(ids(await a('salesC').get(O + '?q=' + encodeURIComponent('Tháp ' + TOK)))).toEqual([]);
  });
  it('phân trang: tổng số và số trang tính trên tập ĐÃ lọc phạm vi; các trang không trùng, không sót', async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const r = await list('crmAdmin', '&pageSize=2&sortBy=code&sortOrder=asc&page=' + page);
      expect(r.body.data).toMatchObject({ page, pageSize: 2, total: 5, totalPages: 3 });
      seen.push(...r.body.data.items.map((x: { id: string }) => x.id));
    }
    expect(seen.sort()).toEqual(sorted(oA1, oA2, oB1, oC1, oC2));
    expect((await list('salesB', '&pageSize=1')).body.data).toMatchObject({ total: 2, totalPages: 2 });
  });
  it('sắp xếp theo mã tăng/giảm và theo ngày dự kiến chốt (chưa có ngày xếp cuối)', async () => {
    const asc = (await list('crmAdmin', '&sortBy=code&sortOrder=asc')).body.data.items.map((x: { code: string }) => x.code);
    expect(asc).toEqual([...asc].sort());
    const byClose = (await list('crmAdmin', '&sortBy=expectedCloseDate&sortOrder=asc')).body.data.items.map((x: { expectedCloseDate: string | null }) => x.expectedCloseDate);
    expect(byClose.slice(0, 2)).toEqual(['2026-12-20', '2027-01-31']);
    expect(byClose.slice(2)).toEqual([null, null, null]);
  });
  it('tham số sai => 400 VALIDATION_FAILED, không lộ chi tiết nội bộ', async () => {
    for (const qs of ['?q=a', '?closeFrom=2026-02-30', '?closeFrom=20261220', '?closeFrom=2026-12-21&closeTo=2026-12-20', '?closeTo=1999-01-01', '?page=1001&pageSize=100',
      '?page=0', '?pageSize=101', '?status=CLOSED', '?stageId=x', '?ownerId=x', '?sortBy=amount', '?deleted=all', '?khongco=1']) {
      const r = await a().get(O + qs);
      expect({ qs, s: r.status }).toEqual({ qs, s: 400 });
      expect(leaks(r.body)).toBe(false);
    }
  });
});

describe('GET /customers/:id/opportunities — tab Cơ hội của khách', () => {
  const byCust = (who: string, id: string, qs = '') => a(who).get(C + id + '/opportunities' + qs);
  it('người phụ trách khách thấy mọi cơ hội của khách; Kế toán / Quản trị CRM cũng vậy', async () => {
    for (const who of ['salesA', 'acctA', 'crmAdmin']) expect({ who, ids: ids(await byCust(who, cA.id)) }).toEqual({ who, ids: sorted(oA1, oA2) });
  });
  it('người phụ trách cơ hội không phụ trách khách: chỉ thấy cơ hội của mình ở khách đó, không thấy cơ hội khác của khách [C5]', async () => {
    const r = await byCust('salesB', cA.id);
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(sorted(oA2));
    // Bộ lọc làm kết quả rỗng nhưng vẫn có cơ hội nhìn thấy được ở khách này => 200 rỗng, không phải 404.
    const none = await byCust('salesB', cA.id, '?status=WON');
    expect(none.status).toBe(200);
    expect(none.body.data.total).toBe(0);
  });
  it('không đọc được khách và không có cơ hội nào ở khách đó => 404 CUSTOMER_NOT_FOUND (giống hệt khách không tồn tại)', async () => {
    const r = await byCust('salesC', cA.id);
    const ghost = await byCust('salesC', GHOST);
    expect({ s: r.status, code: r.body.error.code }).toEqual({ s: 404, code: 'CUSTOMER_NOT_FOUND' });
    expect({ s: ghost.status, code: ghost.body.error.code }).toEqual({ s: 404, code: 'CUSTOMER_NOT_FOUND' });
    expect(r.body.error.message).toBe(ghost.body.error.message);
  });
  it('khách đã xoá mềm => 404 kể cả Quản trị CRM; cơ hội của khách đó không lộ', async () => {
    expect((await byCust('crmAdmin', cDel.id)).status).toBe(404);
    expect((await byCust('salesA', cDel.id)).status).toBe(404);
  });
  it('Kỹ thuật đọc được khách (cùng phòng) nhưng chưa có đường theo việc => 200 rỗng', async () => {
    const r = await byCust('techB', cA.id);
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(0);
  });
  it('deleted / customerId trong truy vấn => 400', async () => {
    expect((await byCust('crmAdmin', cA.id, '?deleted=only')).status).toBe(400);
    expect((await byCust('crmAdmin', cA.id, '?customerId=' + cB.id)).status).toBe(400);
  });
});

describe('deleted=only — danh sách cơ hội đã xoá mềm (§5.4, TC 9c(iii))', () => {
  it('Quản trị CRM (restore ALL + read ALL): thấy cơ hội đã xoá, kèm deletedAt và version; không trộn cơ hội đang hoạt động', async () => {
    const r = await a('crmAdmin').get(O + '?deleted=only&pageSize=100&q=' + TOK);
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(sorted(oDel));
    expect(typeof r.body.data.items[0].deletedAt).toBe('string');
    expect(r.body.data.items[0].version).toBe(1);
    expect(r.body.data.items[0]).not.toHaveProperty('ownerLostAccess');
  });
  it('Kinh doanh (kể cả người phụ trách cũ / người phụ trách khách), Kế toán, Kỹ thuật: không trả dòng nào', async () => {
    for (const who of ['salesA', 'salesB', 'acctA', 'techB']) {
      const r = await a(who).get(O + '?deleted=only&q=' + TOK);
      expect({ who, s: r.status, total: r.body.data.total }).toEqual({ who, s: 200, total: 0 });
    }
  });
  it('có restore OWN (cấp nhầm) hoặc restore ALL mà đọc OWN: không mở rộng quyền xem — ownA (mọi mã OWN) không thấy gì', async () => {
    const r = await a('ownA').get(O + '?deleted=only&q=' + TOK);
    expect(r.body.data.total).toBe(0);
  });
});

describe('GET /opportunities/board-summary — tổng theo cột kanban (T-04)', () => {
  type Col = { stageId: string; count: number; knownAmountCount: number; unknownAmountCount: number; sumExpectedAmountVnd: string | null };
  const summary = (who: string, qs = '') => a(who).get(O + '/board-summary?q=' + TOK + qs);
  const col = (r: { body: { data: { stages: Col[] } } }, stage: string) => r.body.data.stages.find((x) => x.stageId === fx.oppStage[stage]);
  it('Quản trị CRM / Kế toán: mỗi giai đoạn có số cơ hội ĐANG MỞ, tổng giá trị (chuỗi) và số chưa rõ giá trị (không cộng như 0); số Tạm hoãn; không tính cơ hội đã xoá / của khách đã xoá / đã đóng', async () => {
    for (const who of ['crmAdmin', 'acctA']) {
      const r = await summary(who);
      expect({ who, s: r.status }).toEqual({ who, s: 200 });
      expect(Object.keys(r.body.data).sort()).toEqual(['onHoldCount', 'stages']);
      expect(r.body.data.stages.length).toBe(2);
      expect(col(r, 'T_QUOTE')).toEqual({ stageId: fx.oppStage.T_QUOTE, count: 1, knownAmountCount: 1, unknownAmountCount: 0, sumExpectedAmountVnd: '7200000000' });
      expect(col(r, 'T_APPROACH')).toEqual({ stageId: fx.oppStage.T_APPROACH, count: 1, knownAmountCount: 0, unknownAmountCount: 1, sumExpectedAmountVnd: null });
      expect(r.body.data.onHoldCount).toBe(1); // oB1
    }
  });
  it('khớp ĐÚNG số thẻ của cột kanban (GET /opportunities?status=OPEN&stageId=…) cho từng vai trò; cộng nhiều thẻ bằng số nguyên lớn, không làm tròn', async () => {
    const extra = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'S6 ' + TOK + ' them', stage: 'T_QUOTE', amount: 999_999_999_999_999n });
    try {
      for (const who of ['crmAdmin', 'salesA', 'salesB', 'salesC']) {
        const r = await summary(who);
        for (const stage of ['T_QUOTE', 'T_APPROACH']) {
          const listed = await list(who, '&status=OPEN&stageId=' + fx.oppStage[stage]);
          expect({ who, stage, n: col(r, stage)?.count ?? 0 }).toEqual({ who, stage, n: listed.body.data.total });
        }
        const held = await list(who, '&status=ON_HOLD');
        expect({ who, held: r.body.data.onHoldCount }).toEqual({ who, held: held.body.data.total });
      }
      expect(col(await summary('crmAdmin'), 'T_QUOTE')).toMatchObject({ count: 2, knownAmountCount: 2, sumExpectedAmountVnd: '1000007199999999' });
    } finally {
      await prisma.opportunity.update({ where: { id: extra.id }, data: { deletedAt: new Date(), deletedById: fx.empA, deleteReason: 'dọn test T-04' } });
    }
  });
  it('phạm vi: Kinh doanh A thấy oA1 + oA2 (khách mình), không Tạm hoãn của B; Kinh doanh B chỉ oA2 + Tạm hoãn oB1; Kinh doanh C (phòng khác) rỗng; DEPARTMENT => rỗng', async () => {
    const sa = await summary('salesA');
    expect([col(sa, 'T_QUOTE')?.sumExpectedAmountVnd, col(sa, 'T_APPROACH')?.count, sa.body.data.onHoldCount]).toEqual(['7200000000', 1, 0]);
    const sb = await summary('salesB');
    expect(sb.body.data).toEqual({ stages: [{ stageId: fx.oppStage.T_APPROACH, count: 1, knownAmountCount: 0, unknownAmountCount: 1, sumExpectedAmountVnd: null }], onHoldCount: 1 });
    expect((await summary('salesC')).body.data).toEqual({ stages: [], onHoldCount: 0 });
    expect((await summary('deptA')).body.data).toEqual({ stages: [], onHoldCount: 0 });
  });
  it('bộ lọc loại và từ khoá như danh sách: typeId => chỉ loại đó; từ khoá không khớp => rỗng', async () => {
    const r = await summary('crmAdmin', '&typeId=' + fx.oppType.T_INSTALL);
    expect(r.body.data).toEqual({ stages: [{ stageId: fx.oppStage.T_QUOTE, count: 1, knownAmountCount: 1, unknownAmountCount: 0, sumExpectedAmountVnd: '7200000000' }], onHoldCount: 0 });
    expect((await a('crmAdmin').get(O + '/board-summary?q=' + TOK + 'khongkhop')).body.data).toEqual({ stages: [], onHoldCount: 0 });
  });
  it('BẢO MẬT: Kỹ thuật (chỉ read_assigned) => 403, không có số tiền; không mã => 403; chưa đăng nhập => 401; tham số sai / thừa => 400', async () => {
    const tech = await summary('techB');
    expect({ s: tech.status, code: tech.body.error?.code }).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(JSON.stringify(tech.body)).not.toMatch(/7200000000|sumExpectedAmountVnd|stages/);
    for (const who of ['none', 'readonly']) expect({ who, s: (await summary(who)).status }).toEqual({ who, s: 403 });
    expect((await anon().get(O + '/board-summary')).status).toBe(401);
    for (const bad of ['?q=a', '?typeId=abc', '?status=OPEN', '?stageId=' + fx.oppStage.T_QUOTE, '?page=1']) {
      const r = await a('crmAdmin').get(O + '/board-summary' + bad);
      expect({ bad, s: r.status }).toEqual({ bad, s: 400 });
      expect(leaks(r.body)).toBe(false);
    }
  });
});

describe('ownerLostAccess — chỉ trả cho người có opportunity.assign (TC 9a(v), 9a(vii))', () => {
  const flagOf = async (who: string, o: Ref) => (await a(who).get(O + '/' + o.id)).body.data;
  afterEach(() => { t.access.scopes.set(fx.empA, SALES); t.eligibility.blocked.clear(); });
  it('người phụ trách còn đủ quyền => false (chi tiết và danh sách)', async () => {
    expect((await flagOf('crmAdmin', oA1)).ownerLostAccess).toBe(false);
    const item = (await list('crmAdmin', '&pageSize=100')).body.data.items.find((x: { id: string }) => x.id === oA1.id);
    expect(item.ownerLostAccess).toBe(false);
  });
  it('người phụ trách bị gỡ vai trò (không còn đường đầy đủ) => true với Quản trị CRM', async () => {
    t.access.scopes.set(fx.empA, TECH);
    expect((await flagOf('crmAdmin', oA1)).ownerLostAccess).toBe(true);
    const item = (await list('crmAdmin', '&pageSize=100')).body.data.items.find((x: { id: string }) => x.id === oA1.id);
    expect(item.ownerLostAccess).toBe(true);
    expect((await flagOf('crmAdmin', oB1)).ownerLostAccess).toBe(false); // người phụ trách khác không bị ảnh hưởng
  });
  it('tài khoản người phụ trách không dùng được (cổng auth trả false) => true', async () => {
    t.eligibility.blocked.add(fx.empA);
    expect((await flagOf('crmAdmin', oA1)).ownerLostAccess).toBe(true);
  });
  it('Kế toán (không có opportunity.assign): phản hồi KHÔNG có khoá ownerLostAccess, kể cả khi người phụ trách đã mất quyền', async () => {
    t.access.scopes.set(fx.empA, TECH);
    expect(await flagOf('acctA', oA1)).not.toHaveProperty('ownerLostAccess');
    const item = (await list('acctA', '&pageSize=100')).body.data.items.find((x: { id: string }) => x.id === oA1.id);
    expect(item).not.toHaveProperty('ownerLostAccess');
  });
  it('Kinh doanh (có assign) thấy cờ trên cơ hội mình nhìn được', async () => {
    expect((await flagOf('salesA', oA2)).ownerLostAccess).toBe(false);
  });
});

// Sales T-07: tìm KHÔNG PHÂN BIỆT DẤU tiếng Việt và hoa/thường trên tiêu đề / tên dự án (cột sinh tự động title_fold / project_name_fold =
// public.f_vn_fold(...), từ khoá gập bằng cùng hàm). Bộ dữ liệu riêng với từ khoá T7 để không đổi tập kết quả q=TOK của các ca S6 ở trên.
describe('tìm không dấu (T-07)', () => {
  const T7 = 't7' + uniq().replace(/[^a-z0-9]/gi, '');
  let hp: Ref; let hpOut: Ref; let dd: Ref; let prj: Ref; let pct: Ref; let del7: Ref; let held: Ref;
  const find = (who: string, q: string, qs = '') => a(who).get(O + '?pageSize=100&q=' + encodeURIComponent(q) + qs);
  beforeAll(async () => {
    hp = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'Chiller Hòa Phát ' + T7 });
    hpOut = await makeOpportunity(prisma, fx, { customerId: cC.id, ownerId: fx.empC, title: 'Chiller Hòa Phát ' + T7 + ' phòng khác' });
    dd = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'Điều hoà ' + T7 + ' Đông Đô' });
    prj = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'Cơ hội dự án ' + T7, projectName: 'Tòa nhà Đức Giang ' + T7 });
    pct = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'Giảm 50% ' + T7 + ' mã x_y c:\\d ' + T7 });
    del7 = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'Bảo trì Hòa Phát ' + T7 + ' đã xoá', deleted: true });
    held = await makeOpportunity(prisma, fx, { customerId: cA.id, ownerId: fx.empA, title: 'Tạm hoãn Hòa Phát ' + T7, status: 'ON_HOLD' });
  });

  it('từ khoá KHÔNG dấu khớp tiêu đề CÓ dấu ("hoa phat" => "Hòa Phát"); không phân biệt hoa/thường', async () => {
    expect(ids(await find('crmAdmin', 'hoa phat ' + T7))).toEqual(sorted(hp, hpOut, held));
    expect(ids(await find('crmAdmin', 'HOA PHAT ' + T7.toUpperCase()))).toEqual(sorted(hp, hpOut, held));
    expect((await find('crmAdmin', 'hoa phat ' + T7)).body.data.total).toBe(3);
    expect(ids(await find('crmAdmin', 'chiller hoa phat ' + T7))).toEqual(sorted(hp, hpOut));
  });
  it('"d" khớp "đ" / "Đ" và ngược lại', async () => {
    expect(ids(await find('crmAdmin', 'dieu hoa ' + T7))).toEqual(sorted(dd));
    expect(ids(await find('crmAdmin', T7 + ' dong do'))).toEqual(sorted(dd));
    expect(ids(await find('crmAdmin', T7 + ' Đông Đô'))).toEqual(sorted(dd));
    expect(ids(await find('crmAdmin', 'đieu hoa ' + T7))).toEqual(sorted(dd));
  });
  it('từ khoá CÓ dấu vẫn khớp, kể cả dấu đặt khác chỗ / dạng tổ hợp (NFD) và có dấu trên dòng không dấu', async () => {
    expect(ids(await find('crmAdmin', 'Hòa Phát ' + T7))).toEqual(sorted(hp, hpOut, held));
    expect(ids(await find('crmAdmin', 'Hoà Phát ' + T7))).toEqual(sorted(hp, hpOut, held)); // "oà" thay cho "òa"
    expect(ids(await find('crmAdmin', ('Hòa Phát ' + T7).normalize('NFD')))).toEqual(sorted(hp, hpOut, held));
    expect(ids(await find('crmAdmin', 'CHILLER HÒA PHÁT ' + T7.toUpperCase()))).toEqual(sorted(hp, hpOut));
    expect(ids(await find('crmAdmin', 'Điều Hòa ' + T7))).toEqual(sorted(dd)); // tiêu đề viết "hoà"
  });
  it('tên dự án / công trình: khớp không dấu; tiêu đề và tên dự án là HAI trường riêng (không khớp vắt qua ranh giới)', async () => {
    expect(ids(await find('crmAdmin', 'toa nha duc giang ' + T7))).toEqual(sorted(prj));
    expect(ids(await find('crmAdmin', 'TÒA NHÀ ĐỨC GIANG ' + T7.toUpperCase()))).toEqual(sorted(prj));
    expect(ids(await find('crmAdmin', 'co hoi du an ' + T7))).toEqual(sorted(prj));
    expect(ids(await find('crmAdmin', T7 + ' toa nha'))).toEqual([]); // cuối tiêu đề + đầu tên dự án: không phải một chuỗi
  });
  it('% _ \\ là ký tự thường, không phải ký tự đại diện của LIKE', async () => {
    expect(ids(await find('crmAdmin', '50% ' + T7))).toEqual(sorted(pct));
    expect(ids(await find('crmAdmin', '5_% ' + T7))).toEqual([]); // nếu _ / % là đại diện thì "50% t7.." sẽ khớp
    expect(ids(await find('crmAdmin', 'giam 5%'))).toEqual([]); // "% " đại diện sẽ khớp "giảm 50% "
    expect(ids(await find('crmAdmin', T7 + ' ma x_y'))).toEqual(sorted(pct));
    expect(ids(await find('crmAdmin', T7 + ' ma x%y'))).toEqual([]);
    expect(ids(await find('crmAdmin', T7 + ' ma x_'))).toEqual(sorted(pct));
    expect(ids(await find('crmAdmin', 'x_y c:\\d ' + T7))).toEqual(sorted(pct));
    expect(ids(await find('crmAdmin', 'x_y c:d ' + T7))).toEqual([]); // \ là ký tự thường, không bị nuốt
    expect(ids(await find('crmAdmin', T7 + '%'))).toEqual([]);
    expect(ids(await find('crmAdmin', '%%'))).toEqual([]);
    expect(ids(await find('crmAdmin', '__'))).toEqual([]);
  });
  it('phạm vi vẫn áp: từ khoá không dấu KHÔNG mở rộng tập được xem (Kinh doanh A không thấy cơ hội phòng khác; C chỉ thấy của mình)', async () => {
    expect(ids(await find('salesA', 'hoa phat ' + T7))).toEqual(sorted(hp, held));
    expect((await find('salesA', 'hoa phat ' + T7)).body.data.total).toBe(2);
    expect(ids(await find('salesC', 'hoa phat ' + T7))).toEqual(sorted(hpOut));
    expect(ids(await find('salesB', 'hoa phat ' + T7))).toEqual([]);
    expect(ids(await find('techB', 'hoa phat ' + T7))).toEqual([]);
    expect(ids(await find('deptA', 'hoa phat ' + T7))).toEqual([]);
    for (const who of ['none', 'readonly']) expect((await find(who, 'hoa phat ' + T7)).status).toBe(403);
  });
  it('bảng kanban (status=OPEN + giai đoạn), tab cơ hội của khách và danh sách đã xoá dùng cùng điều kiện tìm', async () => {
    expect(ids(await find('crmAdmin', 'hoa phat ' + T7, '&status=OPEN&stageId=' + fx.oppStage['T_APPROACH']))).toEqual(sorted(hp, hpOut));
    expect(ids(await find('crmAdmin', 'hoa phat ' + T7, '&status=ON_HOLD'))).toEqual(sorted(held));
    const bc = await a('salesA').get(C + cA.id + '/opportunities?pageSize=100&q=' + encodeURIComponent('hoa phat ' + T7));
    expect(bc.status).toBe(200);
    expect(ids(bc)).toEqual(sorted(hp, held));
    const dl = await a('crmAdmin').get(O + '?deleted=only&pageSize=100&q=' + encodeURIComponent('bao tri hoa phat ' + T7));
    expect(ids(dl)).toEqual(sorted(del7));
    expect(ids(await find('salesA', 'bao tri hoa phat ' + T7, '&deleted=only'))).toEqual([]);
  });
  it('từ khoá < 2 ký tự sau trim => 400; từ khoá dài 100 ký tự vẫn chạy', async () => {
    for (const q of [' đ ', 'a', '  ']) expect((await a().get(O + '?q=' + encodeURIComponent(q))).status).toBe(400);
    expect((await find('crmAdmin', 'đ'.repeat(100))).status).toBe(200);
  });
  it('cột gập dấu do PostgreSQL tự tính khi đổi tiêu đề; ứng dụng (siscom_app) KHÔNG ghi trực tiếp được', async () => {
    await prisma.opportunity.update({ where: { id: dd.id }, data: { title: 'Điều hoà ' + T7 + ' Đông Đô (sửa) Nguyễn Trãi' }, select: { id: true } });
    expect(ids(await find('crmAdmin', T7 + ' dong do (sua) nguyen trai'))).toEqual(sorted(dd));
    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: dd.id }, select: { titleFold: true, projectNameFold: true } });
    expect(row).toEqual({ titleFold: 'dieu hoa ' + T7.toLowerCase() + ' dong do (sua) nguyen trai', projectNameFold: null });
    await expect(prisma.opportunity.update({ where: { id: dd.id }, data: { titleFold: 'gia' }, select: { id: true } })).rejects.toThrow();
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: dd.id }, select: { titleFold: true } })).titleFold).toContain('nguyen trai');
  });
});

describe('không thay đổi dữ liệu', () => {
  it('các lần đọc không ghi gì: version và updatedAt của cơ hội không đổi; không ghi audit', async () => {
    const before = await prisma.opportunity.findUniqueOrThrow({ where: { id: oA1.id }, select: { version: true, updatedAt: true } });
    const n = t.audit.entries.length;
    await a('salesA').get(O + '/' + oA1.id); await list('salesA'); await a('salesA').get(C + cA.id + '/opportunities');
    const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: oA1.id }, select: { version: true, updatedAt: true } });
    expect(after).toEqual(before);
    expect(t.audit.entries.length).toBe(n);
  });
});
