// Sales S9b — tài liệu cơ hội (docs/SALES_DESIGN.md §6.14 [C10], §5.4): chỉ đường dẫn https + tên tệp; xem theo ĐƯỜNG TRUY CẬP; thêm / xoá mềm
// cần opportunity.update; tên tệp chứng từ Thắng (won_doc_file_name).
import type { INestApplication } from '@nestjs/common';
import { AUDIT_PORT, AuditEntry, AuditPort } from '../src/common/audit/audit.port';
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, leaks, makeApp, SALES, TECH, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, makeEmployee, makeOpportunity, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const ACT = '/api/v1/activities';
const GHOST = '00000000-0000-4000-8000-000000000001';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let real: TestApp;
const a = (who: string, app: INestApplication = t.app) => as(app, who);
type Ref = { id: string; code: string };
let cA: Ref; let techX = '';

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  real = await makeApp(prisma, fx, { realAudit: true });
  techX = (await makeEmployee({ fullName: 'S9b Kỹ thuật khác phòng ' + uniq(), departmentId: fx.d2 })).id;
  for (const x of [t, real]) {
    x.access.scopes.set(fx.empA, SALES); x.access.scopes.set(fx.empB, SALES); x.access.scopes.set(fx.empC, SALES); x.access.scopes.set(techX, TECH);
    x.actors!.presets['techXp'] = { actor: { employeeId: techX, departmentId: fx.d2 }, scopes: { ...TECH } };
  }
  cA = await makeCustomer(prisma, fx, { ownerId: fx.empA });
});
afterAll(async () => { await t.app.close(); await real.app.close(); await prisma.$disconnect(); });

const opp = (ownerId: string, extra: object = {}) => makeOpportunity(prisma, fx, { customerId: cA.id, ownerId, title: 'S9b ' + uniq(), stage: 'PROSPECTING', ...extra });
const docs = (id: string) => O + '/' + id + '/documents';
const add = (who: string, id: string, body: object, app: INestApplication = t.app) => a(who, app).post(docs(id), body);
const list = async (who: string, id: string) => { const r = await a(who).get(docs(id)); expect({ who, s: r.status }).toEqual({ who, s: 200 }); return r.body.data as { access: string; items: Array<{ id: string; kind: string; fileName: string; url: string }> }; };
const TECH_DOC = () => ({ kind: 'TECHNICAL', fileName: 'ban-ve-' + uniq() + '.pdf', url: 'https://drive.example.com/ky-thuat/' + uniq() });
const COMM_DOC = () => ({ kind: 'COMMERCIAL', fileName: 'bao-gia-' + uniq() + '.xlsx', url: 'https://drive.example.com/thuong-mai/' + uniq() });
const err = (r: { status: number; body: { error?: { code?: string } } }) => ({ s: r.status, code: r.body.error?.code });
const rows = (id: string) => prisma.opportunityDocument.findMany({ where: { opportunityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, kind: true, fileName: true, url: true, createdById: true, deletedAt: true, deletedById: true, deleteReason: true } });
const techTask = async (who: string, oppId: string) => {
  const r = await a(who).post(O + '/' + oppId + '/activities', { type: 'TASK', content: 'Việc kỹ thuật ' + uniq(), dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), performedById: techX, external: true });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; version: number };
};

describe('thêm và xem tài liệu — đường đầy đủ', () => {
  it('người phụ trách cơ hội thêm tài liệu kỹ thuật + thương mại; trả đúng trường; người xem đầy đủ thấy cả hai; cơ hội không tăng version', async () => {
    const o = await opp(fx.empA);
    const td = TECH_DOC(); const cd = COMM_DOC();
    const r1 = await add('salesA', o.id, { ...td, fileName: '  ' + td.fileName + '  ' });
    expect(r1.status).toBe(201);
    expect(r1.body.data).toMatchObject({ kind: 'TECHNICAL', fileName: td.fileName, url: td.url, createdBy: { id: fx.empA } });
    expect(Object.keys(r1.body.data).sort()).toEqual(['createdAt', 'createdBy', 'fileName', 'id', 'kind', 'url']);
    expect((await add('salesA', o.id, cd)).status).toBe(201);
    for (const who of ['salesA', 'acctA', 'crmAdmin']) {
      const l = await list(who, o.id);
      expect({ who, access: l.access, items: l.items.map((x) => [x.kind, x.fileName, x.url]) }).toEqual({ who, access: 'FULL', items: [['TECHNICAL', td.fileName, td.url], ['COMMERCIAL', cd.fileName, cd.url]] });
    }
    expect(await rows(o.id)).toMatchObject([{ createdById: fx.empA, deletedAt: null }, { createdById: fx.empA, deletedAt: null }]);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id }, select: { version: true } })).version).toBe(1);
  });
  it('dữ liệu sai => 400, không ghi gì: http, có khoảng trắng, không phải URL, thiếu / trắng tên tệp, tên quá dài, kind lạ, trường thừa', async () => {
    const o = await opp(fx.empA);
    const ok = TECH_DOC();
    for (const body of [
      { ...ok, url: 'http://drive.example.com/x' }, { ...ok, url: 'https://drive.example.com/a b' }, { ...ok, url: 'khong-phai-url' }, { ...ok, url: undefined },
      { ...ok, fileName: '   ' }, { ...ok, fileName: undefined }, { ...ok, fileName: 'x'.repeat(256) }, { ...ok, kind: 'KHAC' }, { ...ok, kind: undefined }, { ...ok, opportunityId: GHOST },
    ]) {
      const r = await add('salesA', o.id, body);
      expect({ body, s: r.status }).toEqual({ body, s: 400 });
      expect(leaks(r.body)).toBe(false);
    }
    expect(await rows(o.id)).toEqual([]);
  });
});

describe('quyền: xem theo đường truy cập; thêm / xoá cần opportunity.update trên cơ hội', () => {
  it('người phụ trách khách chỉ-đọc và Kế toán: xem được cả hai loại nhưng không thêm / xoá (403); người không thấy cơ hội: 404; không có mã: 403', async () => {
    const o = await opp(fx.empB); // B phụ trách cơ hội ở khách của A
    const d = (await add('salesB', o.id, COMM_DOC())).body.data as { id: string };
    await add('salesB', o.id, TECH_DOC());
    for (const who of ['salesA', 'acctA']) {
      expect((await list(who, o.id)).items).toHaveLength(2);
      expect({ who, ...err(await add(who, o.id, TECH_DOC())) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
      expect({ who, ...err(await a(who).delete(docs(o.id) + '/' + d.id, { reason: 'x' })) }).toEqual({ who, s: 403, code: 'FORBIDDEN' });
    }
    expect(err(await a('salesC').get(docs(o.id)))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await add('salesC', o.id, TECH_DOC()))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect(err(await a('salesC').delete(docs(o.id) + '/' + d.id, { reason: 'x' }))).toEqual({ s: 404, code: 'OPPORTUNITY_NOT_FOUND' });
    expect((await a('none').get(docs(o.id))).status).toBe(403);
    expect((await add('none', o.id, TECH_DOC())).status).toBe(403);
    expect((await a('salesA').get(docs(GHOST))).status).toBe(404);
    expect((await rows(o.id)).filter((x) => x.deletedAt === null)).toHaveLength(2);
  });
  it('Kỹ thuật theo việc: CHỈ nhận tài liệu TECHNICAL; không bao giờ nhận COMMERCIAL; không thêm / xoá được; việc xong là mất', async () => {
    const o = await opp(fx.empA);
    const td = TECH_DOC(); const cd = COMM_DOC();
    const tech = (await add('salesA', o.id, td)).body.data as { id: string };
    const comm = (await add('salesA', o.id, cd)).body.data as { id: string };
    expect((await a('techXp').get(docs(o.id))).status).toBe(404); // chưa có việc => không thấy cơ hội
    const tk = await techTask('salesA', o.id);
    const r = await a('techXp').get(docs(o.id));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ access: 'TASK', items: [{ id: tech.id, kind: 'TECHNICAL', fileName: td.fileName, url: td.url }] });
    expect(r.body.data.items).toHaveLength(1);
    const dump = JSON.stringify(r.body);
    for (const secret of [comm.id, cd.fileName, cd.url, 'COMMERCIAL']) expect(dump).not.toContain(secret);
    expect(err(await add('techXp', o.id, TECH_DOC()))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(err(await a('techXp').delete(docs(o.id) + '/' + tech.id, { reason: 'x' }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect(err(await a('techXp').delete(docs(o.id) + '/' + comm.id, { reason: 'x' }))).toEqual({ s: 403, code: 'FORBIDDEN' });
    expect((await a('techXp').post(ACT + '/' + tk.id + '/complete', { version: tk.version })).status).toBe(200);
    expect((await a('techXp').get(docs(o.id))).status).toBe(404);
  });
  it('cơ hội bị xoá mềm => tài liệu ẩn theo (404) với mọi người', async () => {
    const o = await opp(fx.empA);
    await add('salesA', o.id, TECH_DOC());
    expect((await a('crmAdmin').delete(O + '/' + o.id, { version: 1, reason: 'thử' })).status).toBe(200);
    for (const who of ['salesA', 'crmAdmin', 'acctA']) expect({ who, s: (await a(who).get(docs(o.id))).status }).toEqual({ who, s: 404 });
    expect((await add('crmAdmin', o.id, TECH_DOC())).status).toBe(404);
  });
});

describe('xoá mềm tài liệu', () => {
  it('bắt buộc lý do; tài liệu phải thuộc đúng cơ hội trên đường dẫn; xoá mềm giữ dòng (người xoá, lý do); xoá lần hai => 404', async () => {
    const o = await opp(fx.empA); const other = await opp(fx.empA);
    const d = (await add('salesA', o.id, COMM_DOC())).body.data as { id: string };
    const keep = (await add('salesA', o.id, TECH_DOC())).body.data as { id: string };
    const del = (id: string, docId: string, body: object | undefined) => a('salesA').delete(docs(id) + '/' + docId, body);
    expect((await del(o.id, d.id, undefined)).status).toBe(400);
    expect((await del(o.id, d.id, { reason: '   ' })).status).toBe(400);
    expect(err(await del(other.id, d.id, { reason: 'x' }))).toEqual({ s: 404, code: 'OPPORTUNITY_DOCUMENT_NOT_FOUND' }); // sai cơ hội
    expect(err(await del(o.id, GHOST, { reason: 'x' }))).toEqual({ s: 404, code: 'OPPORTUNITY_DOCUMENT_NOT_FOUND' });
    expect((await rows(o.id)).every((x) => x.deletedAt === null)).toBe(true);
    const r = await del(o.id, d.id, { reason: '  Tải nhầm tệp  ' });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: d.id, deleted: true });
    const after = await rows(o.id);
    expect(after).toHaveLength(2); // không xoá cứng
    expect(after.find((x) => x.id === d.id)).toMatchObject({ deletedById: fx.empA, deleteReason: 'Tải nhầm tệp' });
    expect(after.find((x) => x.id === d.id)?.deletedAt).not.toBeNull();
    expect((await list('salesA', o.id)).items.map((x) => x.id)).toEqual([keep.id]);
    expect(err(await del(o.id, d.id, { reason: 'x' }))).toEqual({ s: 404, code: 'OPPORTUNITY_DOCUMENT_NOT_FOUND' });
  });
});

describe('nhật ký và tính nguyên tử', () => {
  it('nhật ký THẬT: có bản ghi thêm / xoá, không chứa tên tệp, đường dẫn, lý do', async () => {
    const o = await opp(fx.empA);
    const cd = { kind: 'COMMERCIAL', fileName: 'bao-gia-5-ty-kin-' + uniq() + '.xlsx', url: 'https://drive.example.com/kin/' + uniq() };
    const d = (await add('salesA', o.id, cd, real.app)).body.data as { id: string };
    expect((await a('salesA', real.app).delete(docs(o.id) + '/' + d.id, { reason: 'Lý do xoá tài liệu kín' })).status).toBe(200);
    const logs = await prisma.auditLog.findMany({ where: { entityType: 'opportunity', entityId: o.id }, orderBy: { id: 'asc' }, select: { action: true, actorId: true, entityCode: true, summary: true, changes: true } });
    expect(logs.map((x) => x.action)).toEqual(['opportunity.document_add', 'opportunity.document_delete']);
    expect(logs.every((x) => x.actorId === fx.empA && x.entityCode === o.code)).toBe(true);
    expect(logs[0].changes).toMatchObject({ documentId: [null, d.id], kind: [null, 'COMMERCIAL'] });
    const dump = JSON.stringify(logs);
    for (const secret of [cd.fileName, cd.url, 'Lý do xoá tài liệu kín']) expect(dump).not.toContain(secret);
  });
  it('ghi nhật ký thất bại => thêm không tạo dòng nào; xoá mềm không đổi dòng', async () => {
    const port = real.app.get<AuditPort>(AUDIT_PORT);
    const orig = port.record.bind(port);
    const sabotaged = async <T>(fn: () => Promise<T>): Promise<T> => {
      port.record = async (tx: unknown, e: AuditEntry) => { await orig(tx, e); throw new Error('nhật ký hỏng sau khi ghi (thử)'); };
      try { return await fn(); } finally { port.record = orig; }
    };
    const o = await opp(fx.empA);
    expect((await sabotaged(() => add('salesA', o.id, TECH_DOC(), real.app))).status).toBe(500);
    expect(await rows(o.id)).toEqual([]);
    const d = (await add('salesA', o.id, TECH_DOC(), real.app)).body.data as { id: string };
    const audits = await prisma.auditLog.count({ where: { entityType: 'opportunity', entityId: o.id } });
    expect((await sabotaged(() => a('salesA', real.app).delete(docs(o.id) + '/' + d.id, { reason: 'thử' }))).status).toBe(500);
    expect(await rows(o.id)).toMatchObject([{ id: d.id, deletedAt: null, deletedById: null, deleteReason: null }]);
    expect(await prisma.auditLog.count({ where: { entityType: 'opportunity', entityId: o.id } })).toBe(audits);
  });
});

describe('tên tệp chứng từ Thắng (won_doc_file_name, C10)', () => {
  const WIN = { wonAmountVnd: '1250000000', wonDocType: 'HOP_DONG', wonDocNo: 'HD-2026-200', wonDocDate: '2026-11-10', wonDocUrl: 'https://drive.example.com/hd-2026-200' };
  it('gửi kèm khi Thắng => lưu và trả ở chi tiết đường đầy đủ; không gửi => null; mở lại => không hiển thị; Kỹ thuật theo việc không bao giờ nhận', async () => {
    const o = await opp(fx.empA);
    const tk = await techTask('salesA', o.id);
    const r = await a('salesA').post(O + '/' + o.id + '/win', { version: 1, ...WIN, wonDocFileName: '  HD-2026-200-da-ky.pdf  ', handoverToId: fx.empA });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'WON', wonDocFileName: 'HD-2026-200-da-ky.pdf', wonDocUrl: WIN.wonDocUrl });
    const tech = await a('techXp').get(O + '/' + o.id);
    expect(tech.status).toBe(200); // việc của Kỹ thuật vẫn mở => vẫn thấy bản kỹ thuật
    expect(tech.body.data.access).toBe('TASK');
    for (const secret of ['HD-2026-200-da-ky.pdf', WIN.wonDocUrl, WIN.wonDocNo, WIN.wonAmountVnd]) expect(JSON.stringify(tech.body)).not.toContain(secret);
    expect(tk.id).toBeTruthy();
    expect((await a('crmAdmin').post(O + '/' + o.id + '/reopen', { version: 2, reason: 'Sửa chứng từ' })).body.data).toMatchObject({ status: 'OPEN', wonDocFileName: null });
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id }, select: { wonDocFileName: true } })).wonDocFileName).toBe('HD-2026-200-da-ky.pdf'); // dấu vết còn ở DB

    const o2 = await opp(fx.empA);
    expect((await a('salesA').post(O + '/' + o2.id + '/win', { version: 1, ...WIN, handoverToId: fx.empA })).body.data).toMatchObject({ status: 'WON', wonDocFileName: null });
    expect((await a('salesA').post(O + '/' + (await opp(fx.empA)).id + '/win', { version: 1, ...WIN, wonDocFileName: 'x'.repeat(256), handoverToId: fx.empA })).status).toBe(400);
  });
});
