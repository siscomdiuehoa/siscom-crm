// Báo giá Q4 — kiểm thuần: chính sách truy cập (mục 7.1, 7.3), danh sách khoá của hai dạng phản hồi có / không có giá vốn (mục 7.3),
// trạng thái "hết hiệu lực", tập route + thứ tự + không có đường ghi ở Q4, không dùng số thực trên trường tiền.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Actor, Permission, Scope } from '../../common/auth/actor';
import type { OppRef } from '../opportunities/opportunities.access';
import { allowsQuoteWrite, mayHaveDefaults, mayManageTemplates, mayUseTemplates, quoteReadWhere, readsQuotesOf, seesCost } from './quotes.access';
import { LineRow, toLine, toLineWithCost, toQuoteListItem, toVersionDetail, VersionDetailRow, versionState } from './quotes.mapper';

const A: Actor = { employeeId: 'emp-a', departmentId: 'd1' };
const scopes = (m: Partial<Record<Permission, Scope>>) => (p: Permission): Scope | null => m[p] ?? null;
const opp = (ownerId: string, customerOwner: string | null = null, deleted = false): OppRef => ({ ownerId, deletedAt: deleted ? new Date() : null, customer: { ownerId: customerOwner, deletedAt: null } });
const SALES = scopes({ 'opportunity.read': 'OWN', 'quote.read': 'OWN', 'quote.create': 'OWN', 'quote.update': 'OWN', 'quote.send': 'OWN', 'quote.decide': 'OWN', 'quote.delete': 'OWN', 'quote.export': 'OWN' });
const ACCT = scopes({ 'opportunity.read': 'ALL', 'quote.read': 'ALL', 'quote.export': 'ALL' });
const ADMIN = scopes({ 'opportunity.read': 'ALL', 'quote.read': 'ALL', 'quote.create': 'ALL', 'quote.update': 'ALL', 'quote.send': 'ALL', 'quote.decide': 'ALL', 'quote.delete': 'ALL', 'quote.export': 'ALL', 'quote.template': 'ALL', 'quote.cost': 'ALL' });
const TECH = scopes({ 'opportunity.read_assigned': 'OWN' });

describe('Báo giá — chính sách đọc (đi theo cơ hội, chỉ đường đầy đủ)', () => {
  it('Kinh doanh: đọc báo giá của cơ hội mình phụ trách hoặc của khách mình phụ trách; không đọc cơ hội của người khác', () => {
    expect(readsQuotesOf(A, SALES, opp('emp-a'))).toBe(true);
    expect(readsQuotesOf(A, SALES, opp('emp-b', 'emp-a'))).toBe(true);
    expect(readsQuotesOf(A, SALES, opp('emp-b', 'emp-c'))).toBe(false);
  });
  it('Kế toán / Quản trị CRM: đọc mọi báo giá; cơ hội đã xoá => không', () => {
    expect(readsQuotesOf(A, ACCT, opp('emp-b'))).toBe(true);
    expect(readsQuotesOf(A, ADMIN, opp('emp-b'))).toBe(true);
    expect(readsQuotesOf(A, ADMIN, opp('emp-b', null, true))).toBe(false);
  });
  it('Kỹ thuật (chỉ có đường theo việc) và người không có quote.read: không bao giờ đọc được', () => {
    expect(readsQuotesOf(A, TECH, opp('emp-a'))).toBe(false);
    expect(readsQuotesOf(A, scopes({ 'opportunity.read': 'ALL' }), opp('emp-a'))).toBe(false);
  });
  it('có quote.read nhưng không có opportunity.read => không đọc được (fail-closed, mã báo giá không tự mở cơ hội)', () => {
    expect(readsQuotesOf(A, scopes({ 'quote.read': 'ALL' }), opp('emp-a'))).toBe(false);
    expect(quoteReadWhere(A, scopes({ 'quote.read': 'ALL' }))).toEqual({ AND: [{ deletedAt: null }, { opportunity: { is: { AND: [{ deletedAt: null, customer: { is: { deletedAt: null } } }, { id: { in: [] } }] } } }] });
  });
  it('phạm vi DEPARTMENT của quote.read không được hỗ trợ => không trả dòng nào', () => {
    expect(quoteReadWhere(A, scopes({ 'quote.read': 'DEPARTMENT', 'opportunity.read': 'ALL' }))).toEqual({ id: { in: [] } });
    expect(readsQuotesOf(A, scopes({ 'quote.read': 'DEPARTMENT', 'opportunity.read': 'ALL' }), opp('emp-a'))).toBe(false);
  });
  it('vị từ danh sách: báo giá chưa xoá + cơ hội theo đúng fullReadWhere (OWN = phụ trách cơ hội HOẶC phụ trách khách)', () => {
    expect(quoteReadWhere(A, SALES)).toEqual({ AND: [{ deletedAt: null }, { opportunity: { is: { AND: [{ deletedAt: null, customer: { is: { deletedAt: null } } }, { OR: [{ ownerId: 'emp-a' }, { customer: { is: { ownerId: 'emp-a' } } }] }] } } }] });
    expect(quoteReadWhere(A, TECH)).toEqual({ id: { in: [] } });
  });
});

describe('Báo giá — quyền ghi / tải (dùng cho cờ can.* và giá trị điền sẵn)', () => {
  it('Kinh doanh: chỉ trên cơ hội mình PHỤ TRÁCH; phụ trách khách mà không phụ trách cơ hội => chỉ xem', () => {
    for (const c of ['quote.create', 'quote.update', 'quote.send', 'quote.decide', 'quote.delete', 'quote.export'] as const) {
      expect(allowsQuoteWrite(A, SALES, c, opp('emp-a'))).toBe(true);
      expect(allowsQuoteWrite(A, SALES, c, opp('emp-b', 'emp-a'))).toBe(false);
    }
  });
  it('Kế toán: tải được mọi báo giá [QB21], không ghi được', () => {
    expect(allowsQuoteWrite(A, ACCT, 'quote.export', opp('emp-b'))).toBe(true);
    for (const c of ['quote.create', 'quote.update', 'quote.send', 'quote.decide', 'quote.delete'] as const) expect(allowsQuoteWrite(A, ACCT, c, opp('emp-b'))).toBe(false);
  });
  it('không thấy được cơ hội thì không có quyền ghi nào, dù có mã phạm vi ALL', () => {
    expect(allowsQuoteWrite(A, scopes({ 'quote.update': 'ALL' }), 'quote.update', opp('emp-a'))).toBe(false);
  });
  it('loại báo giá: xem = quote.create hoặc quote.template; quản lý = quote.template [QB19]; mặc định cá nhân = quote.create', () => {
    expect([mayUseTemplates(SALES), mayManageTemplates(SALES), mayHaveDefaults(SALES)]).toEqual([true, false, true]);
    expect([mayUseTemplates(ADMIN), mayManageTemplates(ADMIN), mayHaveDefaults(ADMIN)]).toEqual([true, true, true]);
    expect([mayUseTemplates(ACCT), mayManageTemplates(ACCT), mayHaveDefaults(ACCT)]).toEqual([false, false, false]);
    expect([mayUseTemplates(TECH), mayManageTemplates(TECH), mayHaveDefaults(TECH)]).toEqual([false, false, false]);
  });
});

describe('Báo giá — giá vốn [QB23]', () => {
  it('thấy: người có quote.cost, hoặc người tạo ra chính phiên bản đó; người khác (kể cả Kế toán, Kinh doanh khác) không', () => {
    expect(seesCost(A, ADMIN, 'emp-x')).toBe(true);
    expect(seesCost(A, SALES, 'emp-a')).toBe(true);
    expect(seesCost(A, SALES, 'emp-b')).toBe(false);
    expect(seesCost(A, ACCT, 'emp-b')).toBe(false);
  });
  const line: LineRow = { lineNo: 1, kind: 'ITEM', description: 'Ống gió', unit: 'm', note: null, extra: { dk: '400' }, quantity: { toString: () => '2.5' }, unitPriceVnd: 333333n, vatPercent: 10, amountVnd: 833333n, costPriceVnd: 250000n };
  it('dạng KHÔNG có giá vốn: không có khoá costPriceVnd (không phải null); tiền và số lượng là chuỗi', () => {
    const o = toLine(line);
    expect(Object.keys(o).sort()).toEqual(['amountVnd', 'description', 'extra', 'kind', 'lineNo', 'note', 'quantity', 'unit', 'unitPriceVnd', 'vatPercent']);
    expect(JSON.stringify(o)).not.toMatch(/cost|250000/i);
    expect([o.quantity, o.unitPriceVnd, o.amountVnd]).toEqual(['2.5', '333333', '833333']);
  });
  it('dạng CÓ giá vốn: đúng thêm MỘT khoá costPriceVnd; chưa nhập => null', () => {
    expect(Object.keys(toLineWithCost(line)).sort()).toEqual(['amountVnd', 'costPriceVnd', 'description', 'extra', 'kind', 'lineNo', 'note', 'quantity', 'unit', 'unitPriceVnd', 'vatPercent']);
    expect(toLineWithCost(line).costPriceVnd).toBe('250000');
    expect(toLineWithCost({ ...line, costPriceVnd: null }).costPriceVnd).toBeNull();
  });
  const emp = { id: 'e', code: 'NV-0001', fullName: 'Người lập' };
  const version: VersionDetailRow = {
    id: 'v', versionNo: 2, status: 'SENT', codeSnapshot: 'BG-0012', itemName: 'Ống gió vải', printTemplate: 'siscom-v1', templateName: 'Ống gió', title: 'BẢNG BÁO GIÁ', columns: [], vatMode: 'QUOTE',
    quoteDate: new Date('2026-11-20T00:00:00.000Z'), validUntil: new Date('2026-12-05T00:00:00.000Z'), clientName: 'Anh Thử', clientContact: null, clientCompany: 'Công ty Thử', clientPhone: null, clientEmail: null,
    clientAddress: null, projectName: null, quoterName: 'Người lập', quoterTitle: null, quoterPhone: null, quoterEmail: null, intro: '', terms: '', paymentInfo: '',
    subtotalVnd: 9000000000000000n, base8Vnd: 0n, base10Vnd: 9000000000000000n, vat8Vnd: 0n, vat10Vnd: 900000000000000n, totalVnd: 9900000000000000n, note: null, rejectReason: null,
    createdById: 'e', createdAt: new Date(), updatedAt: new Date(), sentAt: new Date(), decidedAt: null, createdBy: emp, sentBy: emp, decidedBy: null, lines: [line],
  };
  const VERSION_KEYS = ['client', 'codeSnapshot', 'columns', 'costVisible', 'createdAt', 'createdBy', 'daysLeft', 'decidedAt', 'decidedBy', 'intro', 'itemName', 'lines', 'note', 'paymentInfo', 'printTemplate', 'projectName',
    'quoteDate', 'quoter', 'rejectReason', 'sentAt', 'sentBy', 'state', 'status', 'subtotalVnd', 'base8Vnd', 'base10Vnd', 'vat8Vnd', 'vat10Vnd', 'totalVnd', 'suggestedFileName', 'templateName', 'terms', 'title', 'updatedAt',
    'validUntil', 'vatMode', 'versionNo'].sort();
  it('chi tiết phiên bản: danh sách khoá cố định ở cả hai dạng; chỉ khác ở dòng hàng; không lộ id nội bộ / createdById', () => {
    const without = toVersionDetail(version, 'BG-0012', '2026-11-24', false);
    const withCost = toVersionDetail(version, 'BG-0012', '2026-11-24', true);
    expect(Object.keys(without).sort()).toEqual(VERSION_KEYS);
    expect(Object.keys(withCost).sort()).toEqual(VERSION_KEYS);
    expect(JSON.stringify(without)).not.toMatch(/costPrice|250000/);
    expect(without.costVisible).toBe(false);
    expect(withCost.lines[0]).toHaveProperty('costPriceVnd', '250000');
  });
  it('tiền vượt 2^53 vẫn đúng từng chữ số (chuỗi, không qua Number)', () => {
    const d = toVersionDetail(version, 'BG-0012', '2026-11-24', false);
    expect([d.subtotalVnd, d.vat10Vnd, d.totalVnd]).toEqual(['9000000000000000', '900000000000000', '9900000000000000']);
  });
  it('tên tệp gợi ý lấy từ chính phiên bản: mã, số phiên bản, công ty khách, hạng mục', () => {
    expect(toVersionDetail(version, 'BG-0012', '2026-11-24', false).suggestedFileName).toBe('20261120_BG-0012_v2_CongTyThu_OngGioVai');
    expect(toVersionDetail({ ...version, status: 'DRAFT', quoteDate: null, versionNo: 1 }, 'BG-0012', '2026-11-24', false).suggestedFileName).toBe('20261124_BG-0012_CongTyThu_OngGioVai_NHAP');
  });
  it('danh sách: không có khoá giá vốn, không có dòng hàng', () => {
    const row = { id: 'q', code: 'BG-0012', itemName: 'x', isPrimary: true, version: 3, createdAt: new Date(), updatedAt: new Date(), template: { id: 't', code: 'chung', name: 'Chung' },
      opportunity: { id: 'o', code: 'CH-0001', title: 'CH', status: 'OPEN', ownerId: 'e', deletedAt: null, customer: { id: 'c', code: 'KH-0001', name: 'Khách', ownerId: 'e', deletedAt: null } }, createdBy: emp };
    const it0 = toQuoteListItem(row, { id: 'v', quoteId: 'q', versionNo: 2, status: 'SENT', quoteDate: version.quoteDate, validUntil: version.validUntil, subtotalVnd: 100n, totalVnd: 110n, sentAt: null, decidedAt: null }, '2026-11-24');
    expect(Object.keys(it0).sort()).toEqual(['code', 'createdAt', 'createdBy', 'customer', 'id', 'isPrimary', 'itemName', 'latest', 'opportunity', 'template', 'updatedAt', 'version']);
    expect(JSON.stringify(it0)).not.toMatch(/cost|lines/i);
    expect(toQuoteListItem(row, undefined, '2026-11-24').latest).toBeNull();
  });
});

describe('Báo giá — "hết hiệu lực" tính lúc đọc', () => {
  const d = (s: string) => new Date(s + 'T00:00:00.000Z');
  it('SENT còn hạn: SENT + số ngày còn lại; đúng ngày hết hạn vẫn còn hiệu lực (0 ngày)', () => {
    expect(versionState('SENT', d('2026-12-01'), '2026-11-24')).toEqual({ state: 'SENT', daysLeft: 7 });
    expect(versionState('SENT', d('2026-11-24'), '2026-11-24')).toEqual({ state: 'SENT', daysLeft: 0 });
  });
  it('SENT quá hạn: EXPIRED', () => {
    expect(versionState('SENT', d('2026-11-23'), '2026-11-24')).toEqual({ state: 'EXPIRED', daysLeft: -1 });
  });
  it('nháp / được chấp nhận / bị từ chối: không đổi theo ngày [QB10]', () => {
    for (const s of ['DRAFT', 'ACCEPTED', 'REJECTED']) expect(versionState(s, d('2020-01-01'), '2026-11-24')).toEqual({ state: s, daysLeft: null });
  });
});

describe('Báo giá Q4 — route và ràng buộc tĩnh', () => {
  const dir = __dirname;
  const src = readFileSync(join(dir, 'quotes.controller.ts'), 'utf8');
  it('Q4 chỉ có đường ĐỌC: 6 route GET, không có Post / Put / Patch / Delete', () => {
    expect([...src.matchAll(/@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/g)].map((m) => m[1] + ' ' + m[2])).toEqual(['Get ', "Get 'defaults'", 'Get ', "Get 'templates'", "Get 'my-defaults'", "Get ':id'"]);
  });
  it("đường tĩnh 'templates' và 'my-defaults' khai báo TRƯỚC ':id'", () => {
    expect(src.indexOf("@Get('templates')")).toBeLessThan(src.indexOf("@Get(':id')"));
    expect(src.indexOf("@Get('my-defaults')")).toBeLessThan(src.indexOf("@Get(':id')"));
  });
  it('mọi controller dùng ActorGuard; module gắn middleware no-store cho CẢ HAI controller', () => {
    expect([...src.matchAll(/@UseGuards\(ActorGuard\)\s+export class (\w+)/g)].map((m) => m[1])).toEqual(['OpportunityQuotesController', 'QuotesController']);
    expect(readFileSync(join(dir, 'quotes.module.ts'), 'utf8')).toMatch(/consumer\.apply\(quoteNoStore\)\.forRoutes\(OpportunityQuotesController, QuotesController\)/);
  });
  it('mã module báo giá không dùng số thực trên tiền / số lượng: không Number( / parseFloat( / parseInt( (A14)', () => {
    const files = [...readdirSync(dir), ...readdirSync(join(dir, 'dto')).map((f) => join('dto', f))].filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) expect({ f, hit: /\b(Number|parseFloat|parseInt)\(/.test(readFileSync(join(dir, f), 'utf8').replace(/\/\/[^\n]*/g, '')) }).toEqual({ f, hit: false });
  });
  it('module báo giá chỉ dùng module cơ hội qua opportunities.access (không import service / mapper nội bộ)', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.spec.ts'))) {
      const imports = [...readFileSync(join(dir, f), 'utf8').matchAll(/from '\.\.\/opportunities\/([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) expect({ f, i }).toEqual({ f, i: 'opportunities.access' });
    }
  });
  it('service đọc trong snapshot REPEATABLE READ, không truy vấn nghiệp vụ ngoài transaction', () => {
    const svc = readFileSync(join(dir, 'quotes.service.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
    expect(svc.match(/this\.prisma\./g)).toEqual(['this.prisma.']);
    expect(svc).toMatch(/this\.prisma\.\$transaction\(fn, \{ isolationLevel: Prisma\.TransactionIsolationLevel\.RepeatableRead/);
  });
});
