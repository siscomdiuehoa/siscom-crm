// Báo giá Q6 — ghi loại báo giá (chỉ Quản trị CRM, QB19) và mặc định cá nhân (QB15) qua API (docs/QUOTES_DESIGN.md mục 4.1, 4.3, 5.1, 7.1,
// 8 điểm 10, 11, 12; nghiệm thu C12, B10 qua API, D6 của bảng 8.1).
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, makeOpportunity, uniq } from './helpers/fixtures';

const T = '/api/v1/quotes/templates';
const MY = '/api/v1/quotes/my-defaults';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
const a = (who?: string, app: INestApplication = t.app) => as(app, who);
const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
const code = () => 'zt-' + uniq().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
const COLS = [{ key: 'dk', label: 'Đường kính', unit: 'mm' }, { key: 'dai', label: 'Chiều dài', unit: 'm' }];
const body = (extra: object = {}) => ({ code: code(), name: 'Ống gió vải ' + uniq(), title: 'BẢNG BÁO GIÁ ỐNG GIÓ VẢI', intro: 'Kính gửi', defaultTerms: 'Thanh toán 50 %', defaultValidDays: 20, defaultVat: 8, vatMode: 'QUOTE', columns: COLS, ...extra });
const newOpp = async () => { const cu = await makeCustomer(prisma, fx, { ownerId: fx.empA }); return makeOpportunity(prisma, fx, { customerId: cu.id, ownerId: fx.empA }); };

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
});
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

describe('POST /quotes/templates — thêm loại báo giá [QB17, QB19]', () => {
  it('Quản trị CRM: 201, đủ trường, version 1; xuất hiện trong danh sách đang dùng; nhật ký có mã loại; no-store', async () => {
    t.audit.entries.length = 0;
    const b = body();
    const r = await a('crmAdmin').post(T, b);
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.data).toMatchObject({ code: b.code, name: b.name, title: b.title, intro: 'Kính gửi', defaultTerms: 'Thanh toán 50 %', defaultValidDays: 20, defaultVat: 8, vatMode: 'QUOTE', columns: COLS, isActive: true, version: 1 });
    expect(((await a('salesA').get(T)).body.data.items as Array<{ code: string }>).map((x) => x.code)).toContain(b.code);
    expect(t.audit.entries.map((e) => [e.action, e.entityCode])).toEqual([['quote.template.create', b.code]]);
  });
  it('quyền: Kinh doanh / Kế toán / Kỹ thuật / không quyền => 403 (C12)', async () => {
    for (const who of ['salesA', 'acctA', 'techB', 'none']) expect({ who, ...err(await a(who).post(T, body())) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
  });
  it('B10 qua API: cột sai hình dạng / mã sai mẫu / thiếu tên, tiêu đề / số ngày, VAT, cách tính sai => 400; thiếu đơn vị cột => ""', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ key: 'c' + i, label: 'Cột ' + i, unit: '' }));
    const bad: Array<[string, object]> = [
      ['11 cột', { columns: eleven }], ['key trùng', { columns: [COLS[0], COLS[0]] }], ['key sai mẫu', { columns: [{ key: '1ab', label: 'X', unit: '' }] }],
      ['key hoa', { columns: [{ key: 'Ab', label: 'X', unit: '' }] }], ['nhãn rỗng', { columns: [{ key: 'ab', label: '  ', unit: '' }] }],
      ['nhãn 41', { columns: [{ key: 'ab', label: 'x'.repeat(41), unit: '' }] }], ['đơn vị 21', { columns: [{ key: 'ab', label: 'X', unit: 'x'.repeat(21) }] }],
      ['thuộc tính lạ', { columns: [{ key: 'ab', label: 'X', unit: '', formula: '=1+1' }] }], ['mã có dấu cách', { code: 'ab cd' }], ['mã chữ hoa', { code: 'ABC' }],
      ['thiếu tên', { name: '  ' }], ['thiếu tiêu đề', { title: '' }], ['ngày 0', { defaultValidDays: 0 }], ['ngày 366', { defaultValidDays: 366 }], ['VAT 5', { defaultVat: 5 }],
      ['cách tính lạ', { vatMode: 'MIXED' }], ['gửi kèm version', { version: 3 }],
    ];
    for (const [why, extra] of bad) expect({ why, s: (await a('crmAdmin').post(T, body(extra))).status }).toEqual({ why, s: 400 });
    const r = await a('crmAdmin').post(T, body({ columns: [{ key: 'ab', label: 'X' }] }));
    expect(r.status).toBe(201);
    expect(r.body.data.columns).toEqual([{ key: 'ab', label: 'X', unit: '' }]);
  });
  it('mã trùng => 409 TEMPLATE_CODE_EXISTS', async () => {
    const b = body();
    expect((await a('crmAdmin').post(T, b)).status).toBe(201);
    expect(err(await a('crmAdmin').post(T, body({ code: b.code })))).toEqual({ s: 409, code: 'TEMPLATE_CODE_EXISTS' });
  });
});

describe('PATCH /quotes/templates/:id — sửa / ngừng dùng loại báo giá', () => {
  it('sửa tiêu đề, cột, cách tính VAT: version tăng; mã không đổi được (400); version cũ => 409; không tồn tại => 404; Kinh doanh => 403', async () => {
    const c = (await a('crmAdmin').post(T, body())).body.data;
    const r = await a('crmAdmin').patch(T + '/' + c.id, { version: 1, title: 'TIÊU ĐỀ MỚI', vatMode: 'LINE', columns: [{ key: 'model', label: 'Model', unit: '' }] });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ title: 'TIÊU ĐỀ MỚI', vatMode: 'LINE', columns: [{ key: 'model', label: 'Model', unit: '' }], version: 2, code: c.code });
    expect((await a('crmAdmin').patch(T + '/' + c.id, { version: 2, code: 'khac' })).status).toBe(400);
    expect(err(await a('crmAdmin').patch(T + '/' + c.id, { version: 1, name: 'X' }))).toEqual({ s: 409, code: 'VERSION_CONFLICT' });
    expect(err(await a('crmAdmin').patch(T + '/' + GHOST, { version: 1, name: 'X' }))).toEqual({ s: 404, code: 'QUOTE_TEMPLATE_NOT_FOUND' });
    expect(err(await a('salesA').patch(T + '/' + c.id, { version: 2, name: 'X' }))).toEqual({ s: 403, code: 'FORBIDDEN' });
  });
  it('gửi lại đúng giá trị cũ => không tăng version, không ghi nhật ký', async () => {
    const c = (await a('crmAdmin').post(T, body())).body.data;
    t.audit.entries.length = 0;
    const r = await a('crmAdmin').patch(T + '/' + c.id, { version: 1, name: c.name, columns: c.columns });
    expect(r.status).toBe(200);
    expect(r.body.data.version).toBe(1);
    expect(t.audit.entries).toEqual([]);
  });
  it('ngừng dùng: biến mất khỏi danh sách đang dùng, không lập báo giá mới được (422); bật lại được', async () => {
    const c = (await a('crmAdmin').post(T, body())).body.data;
    expect((await a('crmAdmin').patch(T + '/' + c.id, { version: 1, isActive: false })).status).toBe(200);
    expect(((await a('salesA').get(T)).body.data.items as Array<{ id: string }>).map((x) => x.id)).not.toContain(c.id);
    const o = await newOpp();
    expect(err(await a('salesA').post('/api/v1/opportunities/' + o.id + '/quotes', { templateId: c.id, itemName: 'X' }))).toEqual({ s: 422, code: 'TEMPLATE_INACTIVE' });
    expect((await a('crmAdmin').patch(T + '/' + c.id, { version: 2, isActive: true })).body.data).toMatchObject({ isActive: true, version: 3 });
  });
  it('sửa loại báo giá KHÔNG đổi báo giá đã lập (mục 4.3): bản nháp giữ tiêu đề và cột lúc tạo', async () => {
    const c = (await a('crmAdmin').post(T, body())).body.data;
    const o = await newOpp();
    const q = (await a('salesA').post('/api/v1/opportunities/' + o.id + '/quotes', { templateId: c.id, itemName: 'Giữ bản chép' })).body.data;
    expect((await a('crmAdmin').patch(T + '/' + c.id, { version: 1, title: 'ĐÃ ĐỔI', columns: [] })).status).toBe(200);
    const v = (await a('salesA').get('/api/v1/quotes/' + q.id)).body.data.versions[0];
    expect({ title: v.title, columns: v.columns }).toEqual({ title: 'BẢNG BÁO GIÁ ỐNG GIÓ VẢI', columns: COLS });
  });
  it('D6: Quản trị sửa loại báo giá đúng lúc Kinh doanh lập báo giá từ loại đó => bản chép là trọn bản cũ HOẶC trọn bản mới, không lai', async () => {
    for (let i = 0; i < 8; i++) {
      const c = (await a('crmAdmin').post(T, body())).body.data;
      const o = await newOpp();
      const newCols = [{ key: 'moi', label: 'Cột mới', unit: '' }];
      const [rq, rt] = await Promise.all([
        a('salesA').post('/api/v1/opportunities/' + o.id + '/quotes', { templateId: c.id, itemName: 'Đua ' + i }),
        a('crmAdmin').patch(T + '/' + c.id, { version: 1, title: 'TIÊU ĐỀ MỚI ' + i, columns: newCols }),
      ]);
      expect([rq.status, rt.status]).toEqual([201, 200]);
      const v = rq.body.data.versions[0];
      const norm = (title: string, cols: Array<{ key: string; label: string; unit: string }>) => JSON.stringify([title, cols.map((c) => [c.key, c.label, c.unit])]);
      expect([norm('BẢNG BÁO GIÁ ỐNG GIÓ VẢI', COLS), norm('TIÊU ĐỀ MỚI ' + i, newCols)]).toContain(norm(v.title, v.columns));
    }
  });
  it('không cho ngừng dùng loại báo giá CUỐI CÙNG đang dùng => 422 TEMPLATE_LAST_ACTIVE', async () => {
    const keep = (await a('crmAdmin').post(T, body())).body.data;
    const others = await prisma.quoteTemplate.findMany({ where: { isActive: true, id: { not: keep.id } }, select: { id: true } });
    // Tắt tạm mọi loại khác bằng SQL (dữ liệu thử), chỉ còn `keep`. Quy tắc này là toàn cục nên ca kiểm dựa vào việc bộ tích hợp chạy TUẦN TỰ
    // (npm run test:e2e:customers = jest --runInBand, như CI); chạy song song nhiều file cùng lúc có thể làm bài đọc loại báo giá thấy danh sách tạm rỗng.
    await prisma.quoteTemplate.updateMany({ where: { id: { in: others.map((x) => x.id) } }, data: { isActive: false } });
    try {
      expect(err(await a('crmAdmin').patch(T + '/' + keep.id, { version: 1, isActive: false }))).toEqual({ s: 422, code: 'TEMPLATE_LAST_ACTIVE' });
    } finally {
      await prisma.quoteTemplate.updateMany({ where: { id: { in: others.map((x) => x.id) } }, data: { isActive: true } });
    }
  });
});

describe('PUT /quotes/my-defaults — mặc định cá nhân [QB15] (C12)', () => {
  it('lưu của CHÍNH MÌNH (không có tham số nhân viên); đọc lại đúng; người khác không thấy; lưu lại thay toàn bộ', async () => {
    const r = await a('salesA').put(MY, { quoterTitle: 'Trưởng nhóm', quoterPhone: '0903000111', quoterEmail: 'a@vidu.vn', paymentInfo: 'TK 0001 - Ngân hàng thử' });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.data).toMatchObject({ saved: true, quoterTitle: 'Trưởng nhóm', quoterPhone: '0903000111', quoterEmail: 'a@vidu.vn', paymentInfo: 'TK 0001 - Ngân hàng thử' });
    expect((await a('salesA').get(MY)).body.data).toMatchObject({ saved: true, quoterTitle: 'Trưởng nhóm' });
    expect(JSON.stringify((await a('salesB').get(MY)).body.data)).not.toMatch(/Ngân hàng thử|Trưởng nhóm/);
    const again = await a('salesA').put(MY, { paymentInfo: 'TK mới' });
    expect(again.body.data).toMatchObject({ quoterTitle: null, quoterPhone: null, quoterEmail: null, paymentInfo: 'TK mới' });
  });
  it('gửi kèm employeeId => 400; email sai => 400; quá dài => 400; Kế toán / Kỹ thuật => 403', async () => {
    expect((await a('salesA').put(MY, { employeeId: fx.empB, paymentInfo: 'x' })).status).toBe(400);
    expect((await a('salesA').put(MY, { quoterEmail: 'khong-phai-email' })).status).toBe(400);
    expect((await a('salesA').put(MY, { paymentInfo: 'x'.repeat(2001) })).status).toBe(400);
    for (const who of ['acctA', 'techB']) expect({ who, ...err(await a(who).put(MY, { paymentInfo: 'x' })) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
  });
  it('mặc định mới được dùng để điền sẵn báo giá mới; báo giá đã lập không đổi', async () => {
    await a('salesA').put(MY, { quoterTitle: 'Chức vụ điền sẵn', paymentInfo: 'TK điền sẵn' });
    const tp = (await a('crmAdmin').post(T, body())).body.data;
    const o = await newOpp();
    const q = (await a('salesA').post('/api/v1/opportunities/' + o.id + '/quotes', { templateId: tp.id, itemName: 'Điền sẵn' })).body.data;
    expect(q.versions[0]).toMatchObject({ quoter: { title: 'Chức vụ điền sẵn' }, paymentInfo: 'TK điền sẵn' });
    await a('salesA').put(MY, { quoterTitle: 'Đổi sau', paymentInfo: 'TK sau' });
    expect((await a('salesA').get('/api/v1/quotes/' + q.id)).body.data.versions[0]).toMatchObject({ quoter: { title: 'Chức vụ điền sẵn' }, paymentInfo: 'TK điền sẵn' });
  });
});
