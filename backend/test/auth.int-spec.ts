import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AUTH_CONFIG, AuthConfig } from '../src/common/auth/auth.config';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { requestContext } from '../src/common/middleware/request-context.middleware';
import { AuthApiModule } from '../src/modules/auth/auth-api.module';
import { bootstrapAuth, BootstrapUser } from '../src/modules/auth/bootstrap';
import { CustomersModule } from '../src/modules/customers/customers.module';
import { LookupsModule } from '../src/modules/lookups/lookups.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { leaks } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer } from './helpers/fixtures';

// B1.3 MVP — ĐĂNG NHẬP THẬT trên DATABASE THỬ: bootstrap 4+1 tài khoản (chế độ khởi tạo M1, sau đó đóng vĩnh viễn trên DB thử này),
// phiên cookie server-side, RBAC V2 qua Customer API thật, CSRF/Origin, khoá sau nhiều lần sai, logout thu hồi.
// App "real": KHÔNG ghi đè ACTOR_PROVIDER (SessionActorProvider thật) và KHÔNG ghi đè AUDIT_PORT.
const ORIGIN = 'http://localhost:5173';
const cfg: AuthConfig = { cookieSecure: false, allowedOrigins: [ORIGIN], sessionIdleMinutes: 30, sessionAbsHours: 2, loginWindowMinutes: 15, loginMaxPerSource: 1000, loginMaxPerIdentifier: 1000, lockMinutes: 15, lockAfterFailures: 3 };
const pw = () => 'Pw-' + randomBytes(12).toString('base64url');
const DOMAIN = 'it-' + Date.now().toString(36) + '.siscom.local';
const USERS: BootstrapUser[] = [
  { key: 'sysadmin', email: 'sysadmin@' + DOMAIN, fullName: 'Sys Admin', password: pw(), departmentCode: 'IT' },
  { key: 'admin', email: 'admin@' + DOMAIN, fullName: 'CRM Admin', password: pw(), departmentCode: 'BGD' },
  { key: 'sale', email: 'sale@' + DOMAIN, fullName: 'Sale A', password: pw(), departmentCode: 'KD' },
  { key: 'technician', email: 'kythuat@' + DOMAIN, fullName: 'Ky Thuat', password: pw(), departmentCode: 'KT' },
  { key: 'accountant', email: 'ketoan@' + DOMAIN, fullName: 'Ke Toan', password: pw(), departmentCode: 'KETOAN' },
];
let prisma: PrismaService; let app: INestApplication; let codes: Record<string, string> = {}; let fx: Fixtures;
const srv = () => request(app.getHttpServer());
const cookieOf = (res: request.Response): string => { const sc = res.headers['set-cookie']; const first = Array.isArray(sc) ? sc[0] : String(sc ?? ''); return first.split(';')[0]; };
const login = (login: string, password: string) => srv().post('/api/v1/auth/login').set('Origin', ORIGIN).send({ login, password });
async function session(key: string): Promise<{ cookie: string; csrf: string; me: Record<string, unknown> }> {
  const u = USERS.find((x) => x.key === key)!;
  const res = await login(u.email, u.password);
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res), csrf: res.body.data.csrfToken, me: res.body.data.me };
}

beforeAll(async () => {
  const t = createTestPrisma(); prisma = t.prisma;
  await assertTestConnection(prisma, t.name);
  const open = await prisma.$queryRaw<{ open: boolean }[]>`SELECT public.fn_auth_bootstrap_open() AS open`;
  if (!open[0]?.open) throw new Error('DB thử đã đóng khởi tạo: cần DB thử MỚI cho auth.int-spec.');
  fx = await ensureFixtures(prisma);
  const r = await bootstrapAuth(prisma, USERS);
  expect(r.closed).toBe(true);
  codes = Object.fromEntries(r.employees.map((e) => [e.key, e.code]));
  const mod = await Test.createTestingModule({ imports: [AuthApiModule, CustomersModule, LookupsModule] })
    .overrideProvider(PrismaService).useValue(prisma).overrideProvider(AUTH_CONFIG).useValue(cfg).compile();
  app = mod.createNestApplication();
  app.useLogger(false); app.setGlobalPrefix('api/v1'); app.use(requestContext);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init(); await app.listen(0, '127.0.0.1');
}, 120000);
afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

describe('bootstrap (chế độ khởi tạo M1) và ràng buộc', () => {
  it('đã đóng khởi tạo; 5 tài khoản có mã NV-xxxx, không chạy lại được', async () => {
    const r = await prisma.$queryRaw<{ open: boolean }[]>`SELECT public.fn_auth_bootstrap_open() AS open`;
    expect(r[0].open).toBe(false);
    expect(Object.values(codes).every((c) => /^NV-[0-9]{4,}$/.test(c))).toBe(true);
    await expect(bootstrapAuth(prisma, USERS)).rejects.toThrow('BOOTSTRAP_CLOSED');
  });
  it('không có hash/mật khẩu trong audit_log; mật khẩu lưu argon2id', async () => {
    const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: 'auth.' } } });
    const text = JSON.stringify(rows);
    for (const u of USERS) expect(text).not.toContain(u.password);
    const cred = await prisma.employeeCredential.findMany({ select: { passwordAlgo: true, passwordHash: true } });
    expect(cred.every((c) => c.passwordAlgo === 'argon2id' && c.passwordHash.startsWith('$argon2id$'))).toBe(true);
  });
});

describe('đăng nhập', () => {
  it('email đúng => 200 + cookie HttpOnly SameSite=Lax + csrfToken + me (vai trò, quyền); body không chứa token phiên', async () => {
    const u = USERS[2]; const res = await login(u.email, u.password);
    expect(res.status).toBe(200);
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(/^siscom_sid=[A-Za-z0-9_-]{43}; Path=\/api\/v1; HttpOnly; SameSite=Lax; Max-Age=\d+/);
    expect(res.body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.data.me).toMatchObject({ code: codes.sale, roles: ['sales'], permissions: { 'customer.read': 'OWN', 'customer.update': 'OWN', 'lookup.read': 'ALL' } });
    expect(res.body.data.me.permissions['customer.delete']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(sc.split(';')[0].split('=')[1]);
  });
  it('mã nhân viên NV-xxxx đúng => 200; email khác hoa/thường vẫn đúng', async () => {
    const u = USERS[1];
    expect((await login(codes.admin, u.password)).status).toBe(200);
    expect((await login(u.email.toUpperCase(), u.password)).status).toBe(200);
  });
  it('sai mật khẩu / không tồn tại / sai định dạng / thiếu trường => cùng 401 LOGIN_INVALID (400 cho body sai) không lộ chi tiết', async () => {
    const u = USERS[2];
    for (const [l, p] of [[u.email, 'sai-mat-khau-123'], ['khong-ton-tai@' + DOMAIN, u.password], ['NV-0000', u.password], ['not an email', u.password]]) {
      const res = await login(l, p);
      expect(res.status).toBe(401); expect(res.body.error.code).toBe('LOGIN_INVALID'); expect(leaks(res.body)).toBe(false);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect((await srv().post('/api/v1/auth/login').send({ login: u.email })).status).toBe(400);
    expect((await srv().post('/api/v1/auth/login').send({ login: u.email, password: u.password, employeeId: 'x' })).status).toBe(400);
  });
  it('khoá sau N lần sai: mật khẩu đúng cũng 401 cho tới hết hạn khoá; đăng nhập đúng reset bộ đếm', async () => {
    const u = USERS[3];
    for (let i = 0; i < cfg.lockAfterFailures; i++) expect((await login(u.email, 'sai-' + i)).status).toBe(401);
    expect((await login(u.email, u.password)).status).toBe(401);
    const cred = await prisma.employeeCredential.findFirstOrThrow({ where: { employee: { email: u.email } } });
    expect(cred.lockedUntil).not.toBeNull(); expect(cred.lockLevel).toBe(1);
    const locked = await prisma.auditLog.count({ where: { action: 'auth.login_locked', entityId: cred.employeeId } });
    expect(locked).toBe(1);
    await prisma.employeeCredential.update({ where: { employeeId: cred.employeeId }, data: { lockedUntil: new Date(Date.now() - 1000) } }); // hết hạn khoá
    expect((await login(u.email, u.password)).status).toBe(200);
    const after = await prisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: cred.employeeId } });
    expect(after.failedCount).toBe(0); expect(after.lockedUntil).toBeNull(); expect(after.lastLoginAt).not.toBeNull();
  });
});

describe('phiên, /auth/me, logout', () => {
  it('me: cookie hợp lệ => 200; không cookie / cookie rác => 401; header giả danh không có tác dụng', async () => {
    const s = await session('accountant');
    const me = await srv().get('/api/v1/auth/me').set('Cookie', s.cookie);
    expect(me.status).toBe(200); expect(me.body.data.me.roles).toEqual(['accountant']);
    expect((await srv().get('/api/v1/auth/me')).status).toBe(401);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', 'siscom_sid=abc')).status).toBe(401);
    expect((await srv().get('/api/v1/auth/me').set('x-test-actor', 'all').set('x-actor-id', codes.admin)).status).toBe(401);
  });
  it('logout: cần Origin + X-CSRF-Token; thành công => cookie xoá, phiên thu hồi, me sau đó 401; token cũ không dùng lại được', async () => {
    const s = await session('sale');
    expect((await srv().post('/api/v1/auth/logout').set('Cookie', s.cookie)).status).toBe(403);
    expect((await srv().post('/api/v1/auth/logout').set('Cookie', s.cookie).set('Origin', ORIGIN)).status).toBe(403);
    expect((await srv().post('/api/v1/auth/logout').set('Cookie', s.cookie).set('Origin', 'http://evil.example').set('X-CSRF-Token', s.csrf)).status).toBe(403);
    const out = await srv().post('/api/v1/auth/logout').set('Cookie', s.cookie).set('Origin', ORIGIN).set('X-CSRF-Token', s.csrf);
    expect(out.status).toBe(200); expect(String(out.headers['set-cookie'])).toMatch(/siscom_sid=; .*Max-Age=0/);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(401);
    const row = await prisma.authSession.findFirst({ where: { employeeId: (await prisma.employee.findFirstOrThrow({ where: { email: USERS[2].email } })).id, revokeReason: 'LOGOUT' } });
    expect(row).not.toBeNull();
  });
  it('phiên hết hạn (idle) => 401; thu hồi toàn bộ phiên khi token_version tăng (đổi mật khẩu/khoá) — trigger M1.2', async () => {
    const s = await session('technician');
    const emp = await prisma.employee.findFirstOrThrow({ where: { email: USERS[3].email } });
    await prisma.authSession.updateMany({ where: { employeeId: emp.id, revokedAt: null }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(401);
    const s2 = await session('technician');
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s2.cookie)).status).toBe(200);
    await prisma.employeeCredential.update({ where: { employeeId: emp.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s2.cookie)).status).toBe(401);
    expect(await prisma.authSession.count({ where: { employeeId: emp.id, revokeReason: 'TOKEN_VERSION' } })).toBeGreaterThanOrEqual(1);
  });
});

describe('RBAC V2 qua Customer API thật (SessionActorProvider)', () => {
  const C = '/api/v1/customers';
  const w = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  let adminS: { cookie: string; csrf: string }; let saleS: { cookie: string; csrf: string }; let techS: { cookie: string; csrf: string }; let acctS: { cookie: string; csrf: string };
  let saleId = '';
  beforeAll(async () => { adminS = await session('admin'); saleS = await session('sale'); techS = await session('technician'); acctS = await session('accountant'); saleId = (await prisma.employee.findFirstOrThrow({ where: { email: USERS[2].email } })).id; });

  it('không cookie => 401 mọi route; ghi không có CSRF => 403 trước khi chạm nghiệp vụ', async () => {
    expect((await srv().get(C)).status).toBe(401);
    expect((await srv().post(C).set('Cookie', saleS.cookie).send({ name: 'X' })).status).toBe(403);
    expect((await srv().post(C).set('Cookie', saleS.cookie).set('Origin', ORIGIN).send({ name: 'X' })).status).toBe(403);
  });
  it('ADMIN (crm_admin): tạo được khách, đọc ALL; TECHNICIAN/ACCOUNTANT: 403 khi tạo; ACCOUNTANT đọc ALL; TECHNICIAN chỉ phòng mình', async () => {
    const body = { name: 'KH admin ' + Date.now(), phone: '0903123456' };
    const created = await srv().post(C).set(w(adminS)).send(body);
    expect(created.status).toBe(201); const id = created.body.data.id;
    expect((await srv().post(C).set(w(techS)).send(body)).status).toBe(403);
    expect((await srv().post(C).set(w(acctS)).send(body)).status).toBe(403);
    expect((await srv().get(C + '/' + id).set('Cookie', acctS.cookie)).status).toBe(200);
    expect((await srv().get(C + '/' + id).set('Cookie', techS.cookie)).status).toBe(404); // khác phòng => không thấy (không lộ tồn tại)
    expect((await srv().get(C + '/' + id).set('Cookie', saleS.cookie)).status).toBe(404); // không phải chủ sở hữu
  });
  it('SALE: tạo khách bị từ chối vì chỉ có create=OWN (service hiện yêu cầu ALL để tạo — ghi nhận, B3 mở OWN); sửa khách của mình OK; sửa khách người khác 404; xoá/khôi phục 403', async () => {
    const mine = await makeCustomer(prisma, fx, { ownerId: saleId, phone: '0903123457', phoneE164: '+84903123457' });
    const upd = await srv().patch(C + '/' + mine.id).set(w(saleS)).send({ version: mine.version, note: 'ghi chu' });
    expect(upd.status).toBe(200);
    expect((await srv().post(C).set(w(saleS)).send({ name: 'KH sale tao', phone: '0903123458' })).status).toBe(403);
    expect((await srv().delete(C + '/' + mine.id).set(w(saleS))).status).toBe(403);
    expect((await srv().post(C + '/' + mine.id + '/restore').set(w(saleS))).status).toBe(403);
    const other = await prisma.customer.findFirstOrThrow({ where: { ownerId: { not: saleId }, deletedAt: null }, select: { id: true, version: true } });
    expect((await srv().patch(C + '/' + other.id).set(w(saleS)).send({ version: other.version, note: 'x' })).status).toBe(404);
    expect((await srv().patch(C + '/' + other.id).set(w(acctS)).send({ version: other.version, note: 'x' })).status).toBe(403);
  });
  it('audit: đăng nhập/đăng xuất được ghi với actor; không có mật khẩu/token trong nhật ký', async () => {
    const n = await prisma.auditLog.count({ where: { action: { in: ['auth.login_ok', 'auth.logout', 'auth.login_failed'] } } });
    expect(n).toBeGreaterThan(5);
    const text = JSON.stringify(await prisma.auditLog.findMany({ where: { action: { startsWith: 'auth.' } } }));
    expect(text).not.toMatch(/\$argon2|siscom_sid=/);
  });
});
