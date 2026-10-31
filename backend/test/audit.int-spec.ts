import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AUDIT_PORT, AuditEntry } from '../src/common/audit/audit.port';
import { DbAuditPort } from '../src/common/audit/db-audit.port';
import { ACTOR_PROVIDER } from '../src/common/auth/actor';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { requestContext } from '../src/common/middleware/request-context.middleware';
import { CustomersModule } from '../src/modules/customers/customers.module';
import { LookupsModule } from '../src/modules/lookups/lookups.module';
import { AuthPrismaService } from '../src/prisma/auth-prisma.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ACTOR_HEADER, leaks, TestActorProvider } from './helpers/test-app';
import { assertTestConnection, caught, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, uniq } from './helpers/fixtures';

// B1.3.2a — kiểm thử DbAuditPort trên DATABASE THỬ (CHỈ ghi vào DB thử; audit_log là bảng chỉ-thêm nên dòng thử không xoá được).
// App "real" KHÔNG ghi đè AUDIT_PORT => dùng DbAuditPort do AuditModule gắn (kiểm chứng cả việc đấu nối). Provider danh tính là provider GIẢ chỉ có trong test.
const C = '/api/v1/customers';
const NIL = '00000000-0000-0000-0000-000000000000';
const REDACTED = '(đã thay đổi)';
let prisma: PrismaService; let fx: Fixtures;
let real: INestApplication; let deny: INestApplication; let sab: INestApplication;
const port = new DbAuditPort();

// Phá hoại có chủ đích: đổi người thao tác thành uuid không tồn tại => INSERT audit_log vi phạm khoá ngoại SAU khi thao tác nghiệp vụ đã ghi.
class SabotagedAuditPort extends DbAuditPort {
  override async record(tx: unknown, e: AuditEntry): Promise<void> { return super.record(tx, { ...e, actorEmployeeId: randomUUID() }); }
}

async function build(opts: { actors: boolean; audit?: DbAuditPort }): Promise<INestApplication> {
  let b = Test.createTestingModule({ imports: [CustomersModule, LookupsModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthPrismaService).useValue(prisma); // B1.4 P3c: pool auth giả như pool app (test chỉ dùng TestActorProvider/DenyAll)
  if (opts.actors) b = b.overrideProvider(ACTOR_PROVIDER).useValue(new TestActorProvider(fx));
  if (opts.audit) b = b.overrideProvider(AUDIT_PORT).useValue(opts.audit);
  const app = (await b.compile()).createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.use(requestContext);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0, '127.0.0.1');
  return app;
}
function call(app: INestApplication, method: 'get' | 'post' | 'patch' | 'delete', url: string, o: { who?: string; rid?: string; body?: object } = {}): request.Test {
  let r: request.Test = request(app.getHttpServer())[method](url);
  if (o.who) r = r.set(ACTOR_HEADER, o.who);
  if (o.rid) r = r.set('X-Request-Id', o.rid);
  return o.body ? r.send(o.body) : r;
}
const rid = (tag: string): string => 'audit-' + tag + '-' + uniq();
const one = <T>(a: T[]): T => { if (a.length !== 1) throw new Error('mong đợi đúng 1 phần tử, có ' + a.length); return a[0] as T; };
const customerData = (name: string) => ({ name, phone: '0903123456', tierId: fx.tier.POTENTIAL as string, statusId: fx.status.POTENTIAL as string, isDemo: true, createdById: fx.empA, updatedById: fx.empA });
const entry = (code: string, requestId: string, actor: string = fx.empA): AuditEntry => ({ action: 'customer.create', entityType: 'customer', entityId: randomUUID(), entityCode: code, summary: 'Thử giao dịch ' + code, actorEmployeeId: actor, requestId });

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  real = await build({ actors: true });
  deny = await build({ actors: false });
  sab = await build({ actors: true, audit: new SabotagedAuditPort() });
});
afterAll(async () => {
  for (const a of [real, deny, sab]) if (a) await a.close();
  await prisma.$disconnect();
});

describe('B1.3.2a DbAuditPort', () => {
  it('tạo khách: đúng một dòng nhật ký USER, cùng giao dịch; trường nhạy cảm được che', async () => {
    const id = rid('create');
    const name = 'Audit tạo ' + uniq();
    const r = await call(real, 'post', C, { who: 'all', rid: id, body: { name, phone: '0903123456', note: 'ghi chú bí mật 777' } });
    expect(r.status).toBe(201);
    const row = one(await prisma.auditLog.findMany({ where: { requestId: id } }));
    expect(row).toMatchObject({ actorType: 'USER', actorId: fx.empA, actorRole: null, action: 'customer.create', entityType: 'customer', entityId: r.body.data.id, entityCode: r.body.data.code });
    const ch = row.changes as Record<string, unknown>;
    expect(ch.name).toEqual([null, name]);
    expect(ch.phone).toBe(REDACTED);
    expect(ch.note).toBe(REDACTED);
    expect(JSON.stringify(row.changes) + row.summary).not.toMatch(/0903123456|ghi chú bí mật|\+84903123456/);
  });

  it('sửa khách: nhật ký ghi tên cũ/mới, che ghi chú', async () => {
    const c = await makeCustomer(prisma, fx);
    const id = rid('update');
    const newName = 'Audit sửa ' + uniq();
    const r = await call(real, 'patch', C + '/' + c.id, { who: 'all', rid: id, body: { version: 1, name: newName, note: 'ghi chú nhạy cảm XYZ' } });
    expect(r.status).toBe(200);
    const row = one(await prisma.auditLog.findMany({ where: { requestId: id } }));
    expect(row).toMatchObject({ action: 'customer.update', entityId: c.id, entityCode: c.code, actorId: fx.empA });
    const ch = row.changes as Record<string, unknown>;
    expect(ch.name).toEqual([c.name, newName]);
    expect(ch.note).toBe(REDACTED);
    expect(JSON.stringify(row.changes)).not.toMatch(/nhạy cảm XYZ/);
  });

  it('khôi phục khách: có dòng nhật ký customer.restore', async () => {
    const c = await makeCustomer(prisma, fx, { deleted: true });
    const id = rid('restore');
    const r = await call(real, 'post', C + '/' + c.id + '/restore', { who: 'all', rid: id });
    expect(r.status).toBe(200);
    const row = one(await prisma.auditLog.findMany({ where: { requestId: id } }));
    expect(row).toMatchObject({ action: 'customer.restore', entityType: 'customer', entityId: c.id, entityCode: c.code, actorId: fx.empA });
  });

  it('thêm liên hệ: nhật ký không chứa thông tin cá nhân của người liên hệ', async () => {
    const c = await makeCustomer(prisma, fx);
    const id = rid('contact');
    const r = await call(real, 'post', C + '/' + c.id + '/contacts', { who: 'all', rid: id, body: { fullName: 'Trần Thị Bí Mật', phone: '0987654321', email: 'bi.mat@x.vn' } });
    expect(r.status).toBe(201);
    const row = one(await prisma.auditLog.findMany({ where: { requestId: id } }));
    expect(row).toMatchObject({ action: 'contact.create', entityType: 'contact', entityCode: r.body.data.code, actorId: fx.empA });
    expect(JSON.stringify(row.changes) + row.summary).not.toMatch(/Bí Mật|0987654321|bi\.mat/);
  });

  it('DELETE vẫn khoá (409) và không ghi nhật ký', async () => {
    const c = await makeCustomer(prisma, fx);
    const r = await call(real, 'delete', C + '/' + c.id, { who: 'all', rid: rid('delete') });
    expect(r.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { entityId: c.id } })).toBe(0);
  });

  it('thao tác bị từ chối (400/403/404/409) không tạo dòng nhật ký', async () => {
    const c = await makeCustomer(prisma, fx);
    const before = await prisma.auditLog.count();
    expect((await call(real, 'post', C, { who: 'all', body: {} })).status).toBe(400);
    expect((await call(real, 'patch', C + '/' + NIL, { who: 'all', body: { version: 1, note: 'x' } })).status).toBe(404);
    expect((await call(real, 'post', C, { who: 'none', body: { name: 'Trái phép ' + uniq(), phone: '0903123456' } })).status).toBe(403);
    expect((await call(real, 'patch', C + '/' + c.id, { who: 'all', body: { version: 99, name: 'Sai phiên bản ' + uniq() } })).status).toBe(409);
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('lỗi ghi nhật ký => rollback thao tác nghiệp vụ (tạo, sửa, thêm liên hệ), phản hồi 500 chung', async () => {
    const name = 'Audit phá hoại ' + uniq();
    const id1 = rid('sabc');
    const r1 = await call(sab, 'post', C, { who: 'all', rid: id1, body: { name, phone: '0903123456' } });
    expect(r1.status).toBe(500);
    expect(leaks(r1.body)).toBe(false);
    expect(await prisma.customer.count({ where: { name } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: id1 } })).toBe(0);

    const c = await makeCustomer(prisma, fx);
    const id2 = rid('sabu');
    const r2 = await call(sab, 'patch', C + '/' + c.id, { who: 'all', rid: id2, body: { version: 1, note: 'không được lưu' } });
    expect(r2.status).toBe(500);
    expect(await prisma.customer.findUnique({ where: { id: c.id }, select: { version: true, note: true } })).toEqual({ version: 1, note: null });
    expect(await prisma.auditLog.count({ where: { requestId: id2 } })).toBe(0);

    const r3 = await call(sab, 'post', C + '/' + c.id + '/contacts', { who: 'all', rid: rid('sabk'), body: { fullName: 'Không được lưu', phone: '0903123456' } });
    expect(r3.status).toBe(500);
    expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(0);

    expect((await call(real, 'post', C, { who: 'all', body: { name: 'Sau lỗi ' + uniq(), phone: '0903123456' } })).status).toBe(201); // kết nối/pool không bị hỏng
  });

  it('cấu hình thật (DenyAll): mọi thao tác ghi trả 401, không khách mới, không dòng nhật ký', async () => {
    const name = 'Audit từ chối ' + uniq();
    const c = await makeCustomer(prisma, fx);
    const before = await prisma.auditLog.count();
    const rs = [
      await call(deny, 'post', C, { body: { name, phone: '0903123456' } }),
      await call(deny, 'patch', C + '/' + c.id, { body: { version: 1, note: 'x' } }),
      await call(deny, 'delete', C + '/' + c.id),
      await call(deny, 'post', C + '/' + c.id + '/restore'),
      await call(deny, 'post', C + '/' + c.id + '/contacts', { body: { fullName: 'A', phone: '0903123456' } }),
      await call(deny, 'post', C, { who: 'all', body: { name, phone: '0903123456' } }), // header giả không có tác dụng
    ];
    expect(rs.map((x) => x.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(await prisma.customer.count({ where: { name } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('audit_log chỉ thêm: UPDATE/DELETE bị trigger chặn', async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
    await caught(prisma.auditLog.update({ where: { id: row.id }, data: { summary: 'bị sửa' } }));
    await caught(prisma.auditLog.delete({ where: { id: row.id } }));
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).summary).toBe(row.summary);
  });

  it('trực tiếp: record cùng giao dịch — commit giữ cả hai, lỗi sau đó rollback cả hai', async () => {
    const okName = 'Audit tx ok ' + uniq();
    const okId = rid('txok');
    await prisma.$transaction(async (tx) => {
      await tx.customer.create({ data: customerData(okName) });
      await port.record(tx, entry('KH-TX-OK', okId));
    });
    expect(await prisma.customer.count({ where: { name: okName } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { requestId: okId } })).toBe(1);

    const rbName = 'Audit tx rollback ' + uniq();
    const rbId = rid('txrb');
    await caught(prisma.$transaction(async (tx) => {
      await tx.customer.create({ data: customerData(rbName) });
      await port.record(tx, entry('KH-TX-RB', rbId));
      throw new Error('ROLLBACK_THU');
    }));
    expect(await prisma.customer.count({ where: { name: rbName } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: rbId } })).toBe(0);

    const feName = 'Audit tx audit-loi ' + uniq();
    const err = await caught(prisma.$transaction(async (tx) => {
      await tx.customer.create({ data: customerData(feName) });
      await port.record(tx, entry('KH-TX-FE', rid('txfe'), randomUUID()));
    }));
    expect(err).toMatchObject({ name: 'AuditWriteError', reason: 'WRITE_FAILED' });
    expect(await prisma.customer.count({ where: { name: feName } })).toBe(0);
  });
});
