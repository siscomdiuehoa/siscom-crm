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
const cookieOf = (res: request.Response): string => { const sc = res.headers['set-cookie']; const list = Array.isArray(sc) ? sc : [String(sc ?? '')]; return list.find((c) => c.startsWith('siscom_sid='))!.split(';')[0]; };
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
    // Chỉ lấy cột chuỗi/JSON (cột id là BigInt, JSON.stringify không serialize được).
    const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: 'auth.' } }, select: { action: true, summary: true, changes: true, entityCode: true, actorRole: true } });
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
    const list = res.headers['set-cookie'] as unknown as string[];
    expect(list).toHaveLength(2);
    const sc = list.find((c) => c.startsWith('siscom_sid='))!;
    expect(sc).toMatch(/^siscom_sid=[A-Za-z0-9_-]{43}; Path=\/api\/v1; HttpOnly; SameSite=Lax; Max-Age=\d+/);
    const cc = list.find((c) => c.startsWith('siscom_csrf='))!;
    expect(cc).toMatch(/^siscom_csrf=[A-Za-z0-9_-]{43}; Path=\/; SameSite=Lax; Max-Age=\d+/);
    expect(cc).not.toMatch(/HttpOnly/);
    expect(cc.split(';')[0].split('=')[1]).toBe(res.body.data.csrfToken);
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
    expect(out.status).toBe(200); expect(String(out.headers['set-cookie'])).toMatch(/siscom_sid=; .*Max-Age=0/); expect(String(out.headers['set-cookie'])).toMatch(/siscom_csrf=; .*Max-Age=0/);
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
  it('SALE (B3): tạo khách với create=OWN => 201, chủ sở hữu = chính mình, có phân công OWNER, tự xem được; sửa khách của mình OK; sửa khách người khác 404; xoá/khôi phục 403', async () => {
    const mine = await makeCustomer(prisma, fx, { ownerId: saleId, phone: '0903123457', phoneE164: '+84903123457' });
    const upd = await srv().patch(C + '/' + mine.id).set(w(saleS)).send({ version: mine.version, note: 'ghi chu' });
    expect(upd.status).toBe(200);
    const made = await srv().post(C).set(w(saleS)).send({ name: 'KH sale tao', phone: '0903123458' });
    expect(made.status).toBe(201);
    expect(made.body.data.owner).toMatchObject({ id: saleId, code: codes.sale });
    expect(await prisma.customerAssignment.count({ where: { customerId: made.body.data.id, employeeId: saleId, role: 'OWNER', endedAt: null, assignedById: saleId } })).toBe(1);
    expect((await srv().get(C + '/' + made.body.data.id).set('Cookie', saleS.cookie)).status).toBe(200);
    expect((await srv().post(C).set(w(saleS)).send({ name: 'KH sale tao 2', phone: '0903123458', ownerId: fx.empB })).status).toBe(403); // OWN: không được đặt người khác
    expect((await srv().delete(C + '/' + mine.id).set(w(saleS))).status).toBe(403);
    expect((await srv().post(C + '/' + mine.id + '/restore').set(w(saleS))).status).toBe(403);
    const other = await makeCustomer(prisma, fx, { ownerId: fx.empB, phone: '0903123459', phoneE164: '+84903123459' }); // khách của nhân viên khác (cùng phòng thử)
    expect((await srv().patch(C + '/' + other.id).set(w(saleS)).send({ version: other.version, note: 'x' })).status).toBe(404);
    expect((await srv().patch(C + '/' + other.id).set(w(acctS)).send({ version: other.version, note: 'x' })).status).toBe(403);
  });
  it('audit: đăng nhập/đăng xuất được ghi với actor; không có mật khẩu/token trong nhật ký', async () => {
    const n = await prisma.auditLog.count({ where: { action: { in: ['auth.login_ok', 'auth.logout', 'auth.login_failed'] } } });
    expect(n).toBeGreaterThan(5);
    const text = JSON.stringify(await prisma.auditLog.findMany({ where: { action: { startsWith: 'auth.' } }, select: { action: true, summary: true, changes: true, entityCode: true, actorRole: true, requestId: true } }));
    expect(text).not.toMatch(/\$argon2|siscom_sid=|[A-Za-z0-9_-]{43}/);
  });
});

describe('Đổi mật khẩu của chính mình (B1.3.3, PR 8 — D16/D17/D18 A/D19)', () => {
  const U = '/api/v1/auth/change-password';
  const ME = '/api/v1/auth/me';
  const w = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  const acct = USERS[4]; // accountant: không dùng ở các describe khác
  const ORIG = acct.password;
  const NEW = 'Ketoan-Moi#2026-ok';
  const body = (currentPassword: string, newPassword = NEW, confirmPassword = newPassword) => ({ currentPassword, newPassword, confirmPassword });
  let empId = '';
  const cred = () => prisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: empId } });
  const failedLogs = () => prisma.auditLog.count({ where: { action: 'auth.password_change_failed', entityId: empId } });
  beforeAll(async () => { empId = (await prisma.employee.findFirstOrThrow({ where: { email: acct.email } })).id; });
  afterAll(async () => {
    // Đổi lại mật khẩu gốc để các bộ test khác không phụ thuộc thứ tự (dùng phiên mới sau khi đổi).
    if (acct.password === ORIG) return;
    const s = await session('accountant');
    const r = await srv().post(U).set(w(s)).send(body(acct.password, ORIG));
    expect(r.status).toBe(200);
    acct.password = ORIG;
  });

  it('thành công: hash Argon2id mới, token_version+1, mọi phiên cũ 401 (cả thiết bị khác), phiên mới dùng được, nhật ký; mật khẩu cũ không đăng nhập được', async () => {
    const s1 = await session('accountant'); const s2 = await session('accountant');
    const before = await cred();
    const res = await srv().post(U).set(w(s1)).send(body(ORIG));
    expect(res.status).toBe(200);
    expect(res.body.data.me).toMatchObject({ code: codes.accountant, roles: ['accountant'], mustChangePassword: false });
    expect(res.body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(res.body.data.csrfToken).not.toBe(s1.csrf);
    expect(res.headers['cache-control']).toBe('no-store');
    const fresh = cookieOf(res); expect(fresh).not.toBe(s1.cookie);
    expect((await srv().get(ME).set('Cookie', s1.cookie)).status).toBe(401);
    expect((await srv().get(ME).set('Cookie', s2.cookie)).status).toBe(401);
    expect((await srv().get(ME).set('Cookie', fresh)).status).toBe(200);
    const after = await cred();
    expect(after.passwordHash).toMatch(/^\$argon2id\$/); expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordAlgo).toBe('argon2id'); expect(after.tokenVersion).toBe(before.tokenVersion + 1); expect(after.mustChangePassword).toBe(false);
    expect(after.passwordChangedAt.getTime()).toBeGreaterThan(before.passwordChangedAt.getTime());
    expect(await prisma.authSession.count({ where: { employeeId: empId, revokeReason: 'TOKEN_VERSION' } })).toBeGreaterThanOrEqual(2);
    const log = await prisma.auditLog.findFirst({ where: { action: 'auth.password_changed', entityId: empId }, orderBy: { id: 'desc' } });
    expect(log).toMatchObject({ actorType: 'USER', actorId: empId, entityType: 'employee' });
    expect((log!.changes as { sessionsRevoked: number; tokenVersion: number }).sessionsRevoked).toBeGreaterThanOrEqual(2);
    expect((log!.changes as { tokenVersion: number }).tokenVersion).toBe(after.tokenVersion);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_CHANGE', entityId: empId } })).toBeGreaterThanOrEqual(1); // audit của hàm M1.2
    expect((await login(acct.email, ORIG)).status).toBe(401);
    expect((await login(acct.email, NEW)).status).toBe(200);
    acct.password = NEW;
  });
  it('mật khẩu hiện tại sai => 400 PASSWORD_CURRENT_INVALID; hash/token_version không đổi; nhật ký auth.password_change_failed; phiên vẫn dùng được (không khoá)', async () => {
    const s = await session('accountant');
    const before = await cred(); const n = await failedLogs();
    const r = await srv().post(U).set(w(s)).send(body('Sai-mat-khau#2026'));
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('PASSWORD_CURRENT_INVALID');
    const after = await cred();
    expect(after.passwordHash).toBe(before.passwordHash); expect(after.tokenVersion).toBe(before.tokenVersion); expect(after.lockedUntil).toBeNull();
    expect(await failedLogs()).toBe(n + 1);
    expect((await srv().get(ME).set('Cookie', s.cookie)).status).toBe(200);
  });
  it('chính sách yếu / xác nhận lệch / trùng mật khẩu hiện tại / trường lạ => 400, không đổi hash, không so mật khẩu (không nhật ký thất bại)', async () => {
    const s = await session('accountant');
    const before = await cred(); const n = await failedLogs();
    const weak = await srv().post(U).set(w(s)).send(body(acct.password, 'ketoan-yeu'));
    expect(weak.status).toBe(400); expect(weak.body.error.code).toBe('VALIDATION_FAILED'); expect(weak.body.details.length).toBeGreaterThan(0);
    const mismatch = await srv().post(U).set(w(s)).send(body(acct.password, 'Ketoan-Khac#2026-ok', 'Ketoan-Khac#2026-xx'));
    expect(mismatch.status).toBe(400); expect(mismatch.body.details).toEqual(['Mật khẩu xác nhận không khớp']);
    const same = await srv().post(U).set(w(s)).send(body(acct.password, acct.password));
    expect(same.status).toBe(400); expect(same.body.details).toEqual(['Mật khẩu mới phải khác mật khẩu hiện tại']);
    expect((await srv().post(U).set(w(s)).send({ ...body(acct.password), login: 'x' })).status).toBe(400);
    expect((await cred()).passwordHash).toBe(before.passwordHash);
    expect(await failedLogs()).toBe(n);
    expect(JSON.stringify([weak.body, mismatch.body, same.body])).not.toMatch(/ketoan-yeu|Ketoan-Khac|Ketoan-Moi/);
  });
  it('không cookie => 401; cookie nhưng thiếu X-CSRF-Token / thiếu Origin => 403 CSRF_FAILED trước khi so mật khẩu (không nhật ký, không đổi)', async () => {
    const s = await session('accountant');
    const before = await cred(); const n = await failedLogs();
    expect((await srv().post(U).set('Origin', ORIGIN).send(body(acct.password))).status).toBe(401);
    const noCsrf = await srv().post(U).set('Cookie', s.cookie).set('Origin', ORIGIN).send(body('Sai-mat-khau#2026'));
    expect(noCsrf.status).toBe(403); expect(noCsrf.body.error.code).toBe('CSRF_FAILED');
    expect((await srv().post(U).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body(acct.password))).status).toBe(403);
    expect(await failedLogs()).toBe(n);
    expect((await cred()).passwordHash).toBe(before.passwordHash);
  });
  it('D18 A: 6 lần sai liên tiếp (hạn mức 5/15 phút theo cặp nguồn + nhân viên) => lần thứ 6 là 429 PASSWORD_CHANGE_THROTTLED; tài khoản KHÔNG bị khoá đăng nhập', async () => {
    const cfgT: AuthConfig = { ...cfg, loginMaxPerIdentifier: 5 };
    const modT = await Test.createTestingModule({ imports: [AuthApiModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AUTH_CONFIG).useValue(cfgT).compile();
    const appT = modT.createNestApplication();
    appT.useLogger(false); appT.setGlobalPrefix('api/v1'); appT.use(requestContext);
    appT.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    appT.useGlobalFilters(new AllExceptionsFilter());
    await appT.init();
    try {
      const s = await session('accountant');
      for (let i = 0; i < 5; i++) expect((await request(appT.getHttpServer()).post(U).set(w(s)).send(body('Sai-mat-khau#2026'))).status).toBe(400);
      const sixth = await request(appT.getHttpServer()).post(U).set(w(s)).send(body(acct.password));
      expect(sixth.status).toBe(429); expect(sixth.body.error.code).toBe('PASSWORD_CHANGE_THROTTLED');
      expect((await cred()).lockedUntil).toBeNull();
      expect((await login(acct.email, acct.password)).status).toBe(200);
    } finally { await appT.close(); }
  });
  it('nhật ký auth.* của nhân viên không chứa mật khẩu nào (gốc, mới, sai)', async () => {
    const text = JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: empId, action: { startsWith: 'auth.' } }, select: { action: true, summary: true, changes: true } }));
    expect(text).not.toMatch(new RegExp([ORIG, NEW, 'Sai-mat-khau', 'ketoan-yeu'].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')));
  });
});
