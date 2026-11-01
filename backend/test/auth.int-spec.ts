import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { applyTrustProxy, TrustProxySetting } from '../src/app.setup';
import { AUTH_CONFIG, AuthConfig } from '../src/common/auth/auth.config';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { requestContext } from '../src/common/middleware/request-context.middleware';
import { AuthApiModule } from '../src/modules/auth/auth-api.module';
import { bootstrapAuth, BootstrapUser } from '../src/modules/auth/bootstrap';
import { CustomersModule } from '../src/modules/customers/customers.module';
import { LookupsModule } from '../src/modules/lookups/lookups.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { leaks } from './helpers/test-app';
import { assertTestConnection, createAdminTestPrisma, createAuthTestPrisma, createTestPrisma, setDatabaseDefaultTimeZone } from './helpers/test-db';
import { AuthPrismaService } from '../src/prisma/auth-prisma.service';
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
let prisma: PrismaService; let app: INestApplication; let codes: Record<string, string> = {}; let fx: Fixtures; let dbName = '';
// B1.4 P3b: test dựng trạng thái "bí mật/quyền" (token_version, must_change_password) phải dùng kết nối CHỦ SỞ HỮU — siscom_app không còn
// quyền ghi các cột này (S3). Khi chưa tách role (Windows), createAdminTestPrisma rơi về chính app.
let adminPrisma: PrismaService;
// B1.4 P3c: pool xác thực (siscom_auth qua TEST_AUTH_DATABASE_URL; rơi về app khi chưa tách) — AuthService/SessionActorProvider dùng pool này.
let authPrisma: AuthPrismaService;
// P3c: các truy vấn KIỂM CHỨNG trên auth_session / employee_credential dùng adminPrisma (chủ sở hữu) — pool app (prisma) không còn quyền đọc.
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
  // D.0: chạy toàn bộ bộ test xác thực như máy chủ tại VN (DB mặc định +07); kết nối của ứng dụng phải tự chạy UTC.
  const setup = createTestPrisma(); dbName = setup.name;
  await assertTestConnection(setup.prisma, dbName);
  await setup.prisma.$disconnect();
  await setDatabaseDefaultTimeZone(dbName, 'Asia/Ho_Chi_Minh');
  const t = createTestPrisma(); prisma = t.prisma;
  await assertTestConnection(prisma, t.name);
  const open = await prisma.$queryRaw<{ open: boolean }[]>`SELECT public.fn_auth_bootstrap_open() AS open`;
  if (!open[0]?.open) throw new Error('DB thử đã đóng khởi tạo: cần DB thử MỚI cho auth.int-spec.');
  fx = await ensureFixtures(prisma);
  // B1.4 P3 (S1): bootstrap gọi fn_auth_bootstrap_close (chỉ chủ sở hữu) => chạy bằng kết nối chủ sở hữu (siscom_migrator sau khi tách role;
  // siscom_app khi chưa tách). Ứng dụng (prisma) KHÔNG có quyền này — kiểm ở test "BOOTSTRAP_CLOSED" bên dưới và db-roles.int-spec.
  const admin = createAdminTestPrisma();
  let r: Awaited<ReturnType<typeof bootstrapAuth>>;
  try { await assertTestConnection(admin.prisma, dbName); r = await bootstrapAuth(admin.prisma, USERS); } finally { await admin.prisma.$disconnect(); }
  expect(r.closed).toBe(true);
  codes = Object.fromEntries(r.employees.map((e) => [e.key, e.code]));
  const mod = await Test.createTestingModule({ imports: [AuthApiModule, CustomersModule, LookupsModule] })
    .overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthPrismaService).useValue((authPrisma = createAuthTestPrisma().prisma)).overrideProvider(AUTH_CONFIG).useValue(cfg).compile();
  app = mod.createNestApplication();
  app.useLogger(false); app.setGlobalPrefix('api/v1'); app.use(requestContext);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  applyTrustProxy(app, 'loopback'); // B1.4 P1: như sau nginx cùng máy; test không gửi X-Forwarded-For thì hành vi không đổi
  await app.init(); await app.listen(0, '127.0.0.1');
  adminPrisma = createAdminTestPrisma().prisma;
}, 120000);
afterAll(async () => {
  await app?.close();
  // Trả múi giờ mặc định của DB thử về như cũ kể cả khi beforeAll lỗi giữa chừng; luôn đóng kết nối.
  try { if (dbName) await setDatabaseDefaultTimeZone(dbName, null); } finally { await prisma?.$disconnect(); await adminPrisma?.$disconnect(); await authPrisma?.$disconnect(); }
});

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
    const cred = await adminPrisma.employeeCredential.findMany({ select: { passwordAlgo: true, passwordHash: true } });
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
    const cred = await adminPrisma.employeeCredential.findFirstOrThrow({ where: { employee: { email: u.email } } });
    expect(cred.lockedUntil).not.toBeNull(); expect(cred.lockLevel).toBe(1);
    const locked = await prisma.auditLog.count({ where: { action: 'auth.login_locked', entityId: cred.employeeId } });
    expect(locked).toBe(1);
    await adminPrisma.employeeCredential.update({ where: { employeeId: cred.employeeId }, data: { lockedUntil: new Date(Date.now() - 1000) } }); // hết hạn khoá
    expect((await login(u.email, u.password)).status).toBe(200);
    const after = await adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: cred.employeeId } });
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
    const row = await adminPrisma.authSession.findFirst({ where: { employeeId: (await prisma.employee.findFirstOrThrow({ where: { email: USERS[2].email } })).id, revokeReason: 'LOGOUT' } });
    expect(row).not.toBeNull();
  });
  it('phiên hết hạn (idle) => 401; thu hồi toàn bộ phiên khi token_version tăng (đổi mật khẩu/khoá) — trigger M1.2', async () => {
    const s = await session('technician');
    const emp = await prisma.employee.findFirstOrThrow({ where: { email: USERS[3].email } });
    await adminPrisma.authSession.updateMany({ where: { employeeId: emp.id, revokedAt: null }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(401);
    const s2 = await session('technician');
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s2.cookie)).status).toBe(200);
    await adminPrisma.employeeCredential.update({ where: { employeeId: emp.id }, data: { tokenVersion: { increment: 1 } } }); // P3b: app không ghi token_version
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s2.cookie)).status).toBe(401);
    expect(await adminPrisma.authSession.count({ where: { employeeId: emp.id, revokeReason: 'TOKEN_VERSION' } })).toBeGreaterThanOrEqual(1);
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
  const acct = USERS[4]; // accountant: các describe sau (RBAC, Bước 3, D.0) đăng nhập qua session() nên đọc USERS[4].password đã cập nhật; afterAll đổi lại mật khẩu gốc
  const ORIG = acct.password;
  const NEW = 'Taichinh-Moi#2026-ok';
  const body = (currentPassword: string, newPassword = NEW, confirmPassword = newPassword) => ({ currentPassword, newPassword, confirmPassword });
  let empId = '';
  const cred = () => adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: empId } });
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
    expect(await adminPrisma.authSession.count({ where: { employeeId: empId, revokeReason: 'TOKEN_VERSION' } })).toBeGreaterThanOrEqual(2);
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
    const mismatch = await srv().post(U).set(w(s)).send(body(acct.password, 'Taichinh-Khac#2026-ok', 'Taichinh-Khac#2026-xx'));
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
    const modT = await Test.createTestingModule({ imports: [AuthApiModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthPrismaService).useValue(authPrisma).overrideProvider(AUTH_CONFIG).useValue(cfgT).compile();
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

// Regression nghiệm thu MVP Bước 3 (2026-10-29): công cụ PowerShell báo FAIL 3 mục trên tài khoản admin. Mô phỏng ĐÚNG chuỗi
// gọi của công cụ qua phiên cookie thật + guard CSRF toàn cục + Customer API thật, và kiểm cả MÃ LỖI trong body (hợp đồng API §3.4):
//   DELETE (cookie + Origin + X-CSRF-Token) => 409 DELETE_LINKS_UNVERIFIED (N2: khoá, không xoá gì)
//   POST restore khách đang hoạt động       => 409 CUSTOMER_NOT_DELETED
//   DELETE thiếu X-CSRF-Token                => 403 CSRF_FAILED trước khi chạm nghiệp vụ
describe('Nghiệm thu Bước 3 — xoá mềm/khôi phục qua phiên thật (regression công cụ KIEM-TRA-XOA-MEM)', () => {
  const C = '/api/v1/customers';
  const w = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  const errBody = (r: request.Response) => r.body as { error?: { code?: string; details?: unknown } };
  let target = { id: '', code: '' };
  beforeAll(async () => {
    const adm = await session('admin');
    const made = await srv().post(C).set(w(adm)).send({ name: 'KH buoc 3 ' + Date.now(), phone: '0903123459' });
    expect(made.status).toBe(201);
    target = { id: made.body.data.id, code: made.body.data.code };
  });

  it('admin: DELETE => HTTP 409 và body error.code = DELETE_LINKS_UNVERIFIED; khách vẫn còn (deletedAt null)', async () => {
    const adm = await session('admin');
    const d = await srv().delete(C + '/' + target.id).set(w(adm));
    expect(d.status).toBe(409);
    expect(errBody(d).error?.code).toBe('DELETE_LINKS_UNVERIFIED');
    expect(errBody(d).error?.details).toEqual({ unchecked: ['contract', 'quote', 'project', 'opportunity'] });
    const g = await srv().get(C + '/' + target.id).set('Cookie', adm.cookie);
    expect(g.status).toBe(200); expect(g.body.data.deletedAt).toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).toBeNull();
  });

  it('admin: restore khách đang hoạt động => HTTP 409 và body error.code = CUSTOMER_NOT_DELETED', async () => {
    const adm = await session('admin');
    const r = await srv().post(C + '/' + target.id + '/restore').set(w(adm));
    expect(r.status).toBe(409);
    expect(errBody(r).error?.code).toBe('CUSTOMER_NOT_DELETED');
  });

  it('admin: DELETE có cookie + Origin nhưng THIẾU X-CSRF-Token => 403 CSRF_FAILED (không phải 409); token của phiên khác cũng 403', async () => {
    const adm = await session('admin'); const other = await session('admin');
    const noCsrf = await srv().delete(C + '/' + target.id).set({ Cookie: adm.cookie, Origin: ORIGIN });
    expect(noCsrf.status).toBe(403); expect(errBody(noCsrf).error?.code).toBe('CSRF_FAILED');
    const wrongCsrf = await srv().delete(C + '/' + target.id).set({ Cookie: adm.cookie, Origin: ORIGIN, 'X-CSRF-Token': other.csrf });
    expect(wrongCsrf.status).toBe(403); expect(errBody(wrongCsrf).error?.code).toBe('CSRF_FAILED');
    const noOrigin = await srv().delete(C + '/' + target.id).set({ Cookie: adm.cookie, 'X-CSRF-Token': adm.csrf });
    expect(noOrigin.status).toBe(403); expect(errBody(noOrigin).error?.code).toBe('CSRF_FAILED');
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).toBeNull();
  });

  it('kế toán / kỹ thuật / kinh doanh: DELETE và restore => 403 FORBIDDEN (kiểm quyền trước phạm vi, không lộ 404), không đổi dữ liệu', async () => {
    for (const key of ['accountant', 'technician', 'sale']) {
      const s = await session(key);
      const d = await srv().delete(C + '/' + target.id).set(w(s));
      expect(d.status).toBe(403); expect(errBody(d).error?.code).toBe('FORBIDDEN');
      const r = await srv().post(C + '/' + target.id + '/restore').set(w(s));
      expect(r.status).toBe(403); expect(errBody(r).error?.code).toBe('FORBIDDEN');
      const noCsrf = await srv().delete(C + '/' + target.id).set({ Cookie: s.cookie, Origin: ORIGIN });
      expect(noCsrf.status).toBe(403); expect(errBody(noCsrf).error?.code).toBe('CSRF_FAILED');
    }
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).toBeNull();
  });
});

// D.0 — Toàn bộ file chạy với DB mặc định Asia/Ho_Chi_Minh (+07). Mốc thời gian phải là thời điểm thật (UTC) trong DB:
// so với now() của DB (cùng đồng hồ) bằng epoch, và các quyết định hết hạn phải đúng theo now() của DB.
describe('D.0 — mốc thời gian xác thực lưu theo UTC (DB mặc định +07)', () => {
  const TOL = 60_000;
  const MIN = 60_000;
  const hashOf = (cookie: string): string => createHash('sha256').update(cookie.split('=')[1], 'utf8').digest('hex');
  const ME = '/api/v1/auth/me';
  const CP = '/api/v1/auth/change-password';

  it('đăng nhập: issued_at, last_login_at ≈ now() của DB; hạn idle 30 phút và hạn tuyệt đối 2 giờ tính từ now() của DB', async () => {
    const s = await session('admin');
    const r = await adminPrisma.$queryRaw<{ issued: number; idle: number; abs: number; lastLogin: number }[]>`
      SELECT extract(epoch FROM s.issued_at - now())::float8 * 1000 AS issued,
             extract(epoch FROM s.idle_expires_at - now())::float8 * 1000 AS idle,
             extract(epoch FROM s.abs_expires_at - now())::float8 * 1000 AS abs,
             extract(epoch FROM c.last_login_at - now())::float8 * 1000 AS "lastLogin"
      FROM auth_session s JOIN employee_credential c ON c.employee_id = s.employee_id WHERE s.refresh_hash = ${hashOf(s.cookie)}`;
    expect(r).toHaveLength(1);
    expect(Math.abs(r[0].issued)).toBeLessThan(TOL);
    expect(Math.abs(r[0].lastLogin)).toBeLessThan(TOL);
    expect(Math.abs(r[0].idle - cfg.sessionIdleMinutes * MIN)).toBeLessThan(TOL);
    expect(Math.abs(r[0].abs - cfg.sessionAbsHours * 60 * MIN)).toBeLessThan(TOL);
  });

  it('hết hạn phiên theo thời điểm thật: idle_expires_at = now() + 5 phút => 200; = now() - 1 phút => 401', async () => {
    const s = await session('admin'); const h = hashOf(s.cookie);
    await adminPrisma.$executeRaw`UPDATE auth_session SET idle_expires_at = now() + interval '5 minutes' WHERE refresh_hash = ${h}`;
    expect((await srv().get(ME).set('Cookie', s.cookie)).status).toBe(200);
    await adminPrisma.$executeRaw`UPDATE auth_session SET idle_expires_at = now() - interval '1 minute' WHERE refresh_hash = ${h}`;
    expect((await srv().get(ME).set('Cookie', s.cookie)).status).toBe(401);
  });

  it('khoá đăng nhập: locked_until = now() của DB + 15 phút; còn hạn => 401 kể cả đúng mật khẩu; quá hạn theo now() của DB => 200', async () => {
    const u = USERS[3];
    for (let i = 0; i < cfg.lockAfterFailures; i++) expect((await login(u.email, 'sai-utc-' + i)).status).toBe(401);
    const r = await adminPrisma.$queryRaw<{ left: number }[]>`
      SELECT extract(epoch FROM c.locked_until - now())::float8 * 1000 AS "left"
      FROM employee_credential c JOIN employee e ON e.id = c.employee_id WHERE e.email = ${u.email}`;
    expect(Math.abs(r[0].left - cfg.lockMinutes * MIN)).toBeLessThan(TOL);
    await adminPrisma.$executeRaw`UPDATE employee_credential c SET locked_until = now() + interval '2 minutes' FROM employee e WHERE e.id = c.employee_id AND e.email = ${u.email}`;
    expect((await login(u.email, u.password)).status).toBe(401);
    await adminPrisma.$executeRaw`UPDATE employee_credential c SET locked_until = now() - interval '1 minute' FROM employee e WHERE e.id = c.employee_id AND e.email = ${u.email}`;
    expect((await login(u.email, u.password)).status).toBe(200);
  });

  it('đổi mật khẩu: password_changed_at ≈ now() của DB; revoked_at do trigger M1.2 ghi bằng now() của DB đọc qua Prisma ≈ đồng hồ ứng dụng', async () => {
    const acct = USERS[4]; const orig = acct.password; const TMP = 'Thoi-gian-UTC#2026-ok';
    const s = await session('accountant'); const other = await session('accountant');
    const t = Date.now();
    const res = await srv().post(CP).set({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf }).send({ currentPassword: orig, newPassword: TMP, confirmPassword: TMP });
    expect(res.status).toBe(200);
    acct.password = TMP;
    try {
      const r = await adminPrisma.$queryRaw<{ changed: number }[]>`
        SELECT extract(epoch FROM c.password_changed_at - now())::float8 * 1000 AS changed
        FROM employee_credential c JOIN employee e ON e.id = c.employee_id WHERE e.email = ${acct.email}`;
      expect(Math.abs(r[0].changed)).toBeLessThan(TOL);
      const old = await adminPrisma.authSession.findUniqueOrThrow({ where: { refreshHash: hashOf(other.cookie) }, select: { revokedAt: true, revokeReason: true } });
      expect(old.revokeReason).toBe('TOKEN_VERSION');
      expect(Math.abs(old.revokedAt!.getTime() - t)).toBeLessThan(TOL);
    } finally {
      const s2 = await session('accountant');
      const back = await srv().post(CP).set({ Cookie: s2.cookie, Origin: ORIGIN, 'X-CSRF-Token': s2.csrf }).send({ currentPassword: TMP, newPassword: orig, confirmPassword: orig });
      expect(back.status).toBe(200);
      acct.password = orig;
    }
  });

  it('nhật ký: occurred_at của auth.login_ok mới nhất ≈ now() của DB', async () => {
    await session('admin');
    const r = await prisma.$queryRaw<{ d: number }[]>`
      SELECT extract(epoch FROM occurred_at - now())::float8 * 1000 AS d FROM audit_log WHERE action = 'auth.login_ok' ORDER BY id DESC LIMIT 1`;
    expect(Math.abs(r[0].d)).toBeLessThan(TOL);
  });
});

// B1.4 P1 — TRUST_PROXY áp dụng thật. App dùng chung đã đặt 'loopback' (beforeAll); supertest nối qua 127.0.0.1 nên
// X-Forwarded-For được tin đúng một hop: địa chỉ CUỐI header là khách thật (nginx nối thêm), phần khách tự khai bị bỏ.
describe('B1.4 P1 — TRUST_PROXY: hạn mức theo nguồn và tiền tố IP phiên theo X-Forwarded-For', () => {
  const XFF = 'X-Forwarded-For';
  const tech = () => USERS.find((x) => x.key === 'technician')!;
  // Tiền tố IP của ĐÚNG phiên vừa cấp (tra theo băm cookie), không dựa vào thứ tự issued_at (hai login có thể trùng mili-giây).
  const prefixOf = async (res: request.Response): Promise<string | null> => {
    const h = createHash('sha256').update(cookieOf(res).split('=')[1], 'utf8').digest('hex');
    return (await adminPrisma.authSession.findUniqueOrThrow({ where: { refreshHash: h }, select: { ipPrefix: true } })).ipPrefix;
  };
  const loginXff = (xff?: string) => { const r = login(tech().email, tech().password); return xff === undefined ? r : r.set(XFF, xff); };
  it('đăng nhập có X-Forwarded-For => tiền tố IP phiên là của khách thật (hop gần proxy nhất), phần tự khai bị bỏ', async () => {
    const r1 = await loginXff('203.0.113.7');
    expect(r1.status).toBe(200); expect(await prefixOf(r1)).toBe('203.0.113.0/24');
    const r2 = await loginXff('203.0.113.7, 198.51.100.4');
    expect(r2.status).toBe(200); expect(await prefixOf(r2)).toBe('198.51.100.0/24');
    const r3 = await loginXff('::ffff:198.51.100.4'); // IPv4-mapped => tiền tố IPv4
    expect(r3.status).toBe(200); expect(await prefixOf(r3)).toBe('198.51.100.0/24');
  });
  it('header không phải IP / IPv6 có zone id dài => vẫn đăng nhập được (không 500); tiền tố IP hợp lệ, ≤ 64 ký tự', async () => {
    const base = await loginXff(); expect(base.status).toBe(200);
    const r1 = await loginXff('khong-phai-ip');
    expect(r1.status).toBe(200); expect(await prefixOf(r1)).toBe(await prefixOf(base));
    const r2 = await loginXff('fe80::1%' + 'x'.repeat(100));
    expect(r2.status).toBe(200); const p = await prefixOf(r2); expect(p).toBe('fe80::1::/48'); expect(p!.length).toBeLessThanOrEqual(64);
  });
  it('hạn mức theo nguồn: loopback => hai khách sau cùng proxy KHÔNG chặn nhau; false => header bị bỏ, chung một bucket', async () => {
    const mkApp = async (trust: TrustProxySetting): Promise<INestApplication> => {
      const cfgT: AuthConfig = { ...cfg, loginMaxPerSource: 3 };
      const modT = await Test.createTestingModule({ imports: [AuthApiModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthPrismaService).useValue(authPrisma).overrideProvider(AUTH_CONFIG).useValue(cfgT).compile();
      const appT = modT.createNestApplication();
      appT.useLogger(false); appT.setGlobalPrefix('api/v1'); appT.use(requestContext);
      appT.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      appT.useGlobalFilters(new AllExceptionsFilter());
      applyTrustProxy(appT, trust);
      await appT.init();
      return appT;
    };
    // Tài khoản không tồn tại => 401 LOGIN_INVALID, không khoá tài khoản nào; chỉ bộ đếm theo nguồn tăng.
    const nobody = 'nobody@' + DOMAIN;
    const tryLogin = (a: INestApplication, ip: string) => request(a.getHttpServer()).post('/api/v1/auth/login').set('Origin', ORIGIN).set(XFF, ip).send({ login: nobody, password: 'Sai-mat-khau#2026' });
    const appOn = await mkApp('loopback');
    try {
      for (let i = 0; i < 3; i++) expect((await tryLogin(appOn, '203.0.113.10')).status).toBe(401);
      const fourth = await tryLogin(appOn, '203.0.113.10');
      expect(fourth.status).toBe(429); expect(fourth.body.error.code).toBe('LOGIN_THROTTLED');
      expect((await tryLogin(appOn, '203.0.113.11')).status).toBe(401); // khách khác => bucket khác, không bị chặn oan
    } finally { await appOn.close(); }
    const appOff = await mkApp(false);
    try {
      for (let i = 0; i < 3; i++) expect((await tryLogin(appOff, '203.0.113.' + (20 + i))).status).toBe(401);
      const fourth = await tryLogin(appOff, '203.0.113.99');
      expect(fourth.status).toBe(429); // TRUST_PROXY=false: header bị bỏ qua, mọi yêu cầu cùng socket => cùng một bucket
    } finally { await appOff.close(); }
  });
});

// B1.4 P2 — chặn API khi must_change_password = true: 403 PASSWORD_CHANGE_REQUIRED cho mọi route trừ /auth/me, /auth/change-password,
// /auth/logout, /health. Kiểm cả "không thể vượt qua": chặn trước quyền (kể cả route người này vốn được phép), trước validation,
// mọi phương thức; cookie cũ sau khi đổi mật khẩu bị thu hồi; cờ tắt => hành vi như trước.
describe('B1.4 P2 — PASSWORD_CHANGE_REQUIRED', () => {
  const tech = USERS[3]; // technician: có customer.read (DEPARTMENT) => GET /customers vốn 200
  const ORIG_T = tech.password; const TMP_T = 'C0ngTrinh#P2-2026-ok'; // Không chứa định danh email 'kythuat' theo chính sách D17
  const ME2 = '/api/v1/auth/me'; const CP2 = '/api/v1/auth/change-password'; const C2 = '/api/v1/customers';
  const hdr = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  let empId = '';
  const setFlag = (v: boolean) => adminPrisma.employeeCredential.update({ where: { employeeId: empId }, data: { mustChangePassword: v } }); // P3b: app không ghi cờ này
  const expectBlocked = (r: request.Response) => { expect(r.status).toBe(403); expect(r.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED'); };
  beforeAll(async () => { empId = (await prisma.employee.findFirstOrThrow({ where: { email: tech.email } })).id; });
  afterAll(async () => {
    // Trả về trạng thái ban đầu để các bộ test khác không phụ thuộc thứ tự: cờ tắt, mật khẩu gốc.
    await setFlag(false);
    if (tech.password !== ORIG_T) {
      const s = await session('technician');
      expect((await srv().post(CP2).set(hdr(s)).send({ currentPassword: tech.password, newPassword: ORIG_T, confirmPassword: ORIG_T })).status).toBe(200);
      tech.password = ORIG_T;
    }
  });

  it('cờ tắt (mặc định bootstrap): GET /customers 200 — hành vi đã nghiệm thu không đổi', async () => {
    const s = await session('technician');
    expect((await srv().get(C2).set('Cookie', s.cookie)).status).toBe(200);
    expect((await srv().get(ME2).set('Cookie', s.cookie)).body.data.me.mustChangePassword).toBe(false);
  });
  it('cờ bật: đăng nhập vẫn 200 (me.mustChangePassword=true); GET/POST/PATCH/DELETE/HEAD route khác => 403 PASSWORD_CHANGE_REQUIRED, không ghi gì', async () => {
    await setFlag(true);
    const res = await login(tech.email, tech.password);
    expect(res.status).toBe(200); expect(res.body.data.me.mustChangePassword).toBe(true);
    const s = { cookie: cookieOf(res), csrf: res.body.data.csrfToken };
    const before = await prisma.customer.count();
    expectBlocked(await srv().get(C2).set('Cookie', s.cookie));
    expectBlocked(await srv().get(C2 + '?deleted=only').set('Cookie', s.cookie));
    expectBlocked(await srv().get(C2 + '/owner-candidates').set('Cookie', s.cookie)); // route vốn 403 FORBIDDEN với technician => vẫn là PASSWORD_CHANGE_REQUIRED (chặn trước quyền)
    expectBlocked(await srv().get('/api/v1/lookups').set('Cookie', s.cookie));
    expectBlocked(await srv().post(C2).set(hdr(s)).send({})); // trước validation (không 400)
    expectBlocked(await srv().post(C2).set(hdr(s)).send({ name: 'KH P2 khong duoc tao', phone: '0900000000' }));
    expectBlocked(await srv().patch(C2 + '/00000000-0000-0000-0000-000000000000').set(hdr(s)).send({ version: 1 }));
    expectBlocked(await srv().delete(C2 + '/00000000-0000-0000-0000-000000000000').set(hdr(s)));
    expect((await srv().head(C2).set('Cookie', s.cookie)).status).toBe(403);
    expect(await prisma.customer.count()).toBe(before);
    // Thiếu CSRF với cờ bật: CsrfOriginGuard chạy trước => vẫn 403 CSRF_FAILED (không nới lỏng CSRF).
    const noCsrf = await srv().post(C2).set('Cookie', s.cookie).set('Origin', ORIGIN).send({});
    expect(noCsrf.status).toBe(403); expect(noCsrf.body.error.code).toBe('CSRF_FAILED');
  });
  it('cờ bật: /auth/me 200, /auth/logout 200; không cookie => 401 như cũ', async () => {
    const s = await session('technician');
    expect((await srv().get(ME2).set('Cookie', s.cookie)).status).toBe(200);
    expect((await srv().get(C2)).status).toBe(401);
    const out = await srv().post('/api/v1/auth/logout').set(hdr(s));
    expect(out.status).toBe(200);
    expect((await srv().get(ME2).set('Cookie', s.cookie)).status).toBe(401);
  });
  it('cờ bật: đổi mật khẩu 200 => cờ tắt (DB), phiên mới gọi được API, cookie cũ 401; sai mật khẩu hiện tại vẫn 400 (không vượt qua)', async () => {
    const s = await session('technician');
    const bad = await srv().post(CP2).set(hdr(s)).send({ currentPassword: 'Sai-mat-khau#2026', newPassword: TMP_T, confirmPassword: TMP_T });
    expect(bad.status).toBe(400); expect(bad.body.error.code).toBe('PASSWORD_CURRENT_INVALID');
    expectBlocked(await srv().get(C2).set('Cookie', s.cookie)); // vẫn bị chặn
    const ok = await srv().post(CP2).set(hdr(s)).send({ currentPassword: tech.password, newPassword: TMP_T, confirmPassword: TMP_T });
    expect(ok.status).toBe(200); expect(ok.body.data.me.mustChangePassword).toBe(false);
    tech.password = TMP_T;
    expect((await adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: empId } })).mustChangePassword).toBe(false);
    const fresh = { cookie: cookieOf(ok), csrf: ok.body.data.csrfToken };
    expect((await srv().get(C2).set('Cookie', fresh.cookie)).status).toBe(200);
    expect((await srv().get(C2).set('Cookie', s.cookie)).status).toBe(401); // phiên cũ đã bị thu hồi
  });
  it('cờ bật lại giữa chừng (admin đặt lại): phiên đang dùng bị chặn ngay ở request kế tiếp (không cache ngoài request)', async () => {
    // Test độc lập: bài trước thất bại cũng không để cờ must_change_password ảnh hưởng kết quả.
    await setFlag(false);
    const s = await session('technician');
    expect((await srv().get(C2).set('Cookie', s.cookie)).status).toBe(200);
    await setFlag(true);
    expectBlocked(await srv().get(C2).set('Cookie', s.cookie));
    await setFlag(false);
    expect((await srv().get(C2).set('Cookie', s.cookie)).status).toBe(200);
  });
});

// B1.4 Remember Me 90 ngày (Issue #177) trên DB thử THẬT, qua pool auth (siscom_auth khi đã tách). Token/mật khẩu là giá trị tổng hợp.
// Phủ: không tích => không đổi chính sách phiên; tích => cookie riêng HttpOnly/SameSite/Path hẹp, DB chỉ lưu SHA-256, mốc 90 ngày từ lần nhập
// mật khẩu; restore hợp lệ (xoay vòng, cùng mốc); Origin/header bắt buộc; token giả / hết hạn / thu hồi; replay (cả family bị thu hồi);
// race trong 10 giây; truy cập đồng thời (đúng MỘT thắng); logout, đổi mật khẩu (trigger token_version), nhân viên nghỉ việc; tối đa 5 thiết bị.
describe('B1.4 Remember Me 90 ngày (Issue #177)', () => {
  const RESTORE = '/api/v1/auth/remember/restore';
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');
  const all = (res: request.Response): string[] => { const sc = res.headers['set-cookie']; return Array.isArray(sc) ? sc : sc ? [String(sc)] : []; };
  const rmbOf = (res: request.Response): string | null => all(res).find((c) => c.startsWith('siscom_rmb=') && !c.startsWith('siscom_rmb=;')) ?? null;
  const rmbToken = (res: request.Response): string => rmbOf(res)!.split(';')[0].split('=')[1];
  const cleared = (res: request.Response): boolean => all(res).some((c) => /^siscom_rmb=; Path=\/api\/v1\/auth; HttpOnly; SameSite=Lax; Max-Age=0/.test(c));
  const restore = (token: string | null, h: Record<string, string> = {}) => {
    const r = srv().post(RESTORE).set('Origin', ORIGIN).set('X-Remember-Restore', '1');
    if (token !== null) r.set('Cookie', 'siscom_rmb=' + token);
    for (const [k, v] of Object.entries(h)) r.set(k, v);
    return r;
  };
  const loginRemember = (key: string, remember: boolean | undefined, extraCookie?: string) => {
    const u = USERS.find((x) => x.key === key)!;
    const r = srv().post('/api/v1/auth/login').set('Origin', ORIGIN);
    if (extraCookie) r.set('Cookie', extraCookie);
    return r.send(remember === undefined ? { login: u.email, password: u.password } : { login: u.email, password: u.password, remember });
  };
  const empId = async (key: string) => (await prisma.employee.findFirstOrThrow({ where: { email: USERS.find((x) => x.key === key)!.email }, select: { id: true } })).id;
  const rowOf = (token: string) => adminPrisma.rememberDevice.findUnique({ where: { tokenHash: sha(token) } });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('không tích (thiếu remember / remember=false): KHÔNG có cookie siscom_rmb, KHÔNG thêm hàng; phiên thường như cũ', async () => {
    const id = await empId('sale');
    const before = await adminPrisma.rememberDevice.count({ where: { employeeId: id } });
    for (const v of [undefined, false]) {
      const res = await loginRemember('sale', v);
      expect(res.status).toBe(200);
      expect(rmbOf(res)).toBeNull();
      expect(all(res)).toHaveLength(2);
      expect(all(res).find((c) => c.startsWith('siscom_sid='))).toMatch(/Max-Age=1800(;|$)/); // cfg.sessionIdleMinutes=30: chính sách phiên không đổi
    }
    expect(await adminPrisma.rememberDevice.count({ where: { employeeId: id } })).toBe(before);
    expect((await srv().post('/api/v1/auth/login').set('Origin', ORIGIN).send({ login: USERS[2].email, password: USERS[2].password, remember: 'true' })).status).toBe(400);
  });

  it('tích: cookie siscom_rmb HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age = 90 ngày; DB chỉ lưu SHA-256; mốc = lần nhập mật khẩu + 90 ngày', async () => {
    const t0 = Date.now();
    const res = await loginRemember('sale', true);
    expect(res.status).toBe(200);
    const c = rmbOf(res)!;
    expect(c).toMatch(/^siscom_rmb=[A-Za-z0-9_-]{43}; Path=\/api\/v1\/auth; HttpOnly; SameSite=Lax; Max-Age=(77759\d\d|7776000)$/);
    const tok = rmbToken(res);
    expect(JSON.stringify(res.body)).not.toContain(tok);
    const row = (await rowOf(tok))!;
    expect(row).not.toBeNull();
    expect(row.tokenHash).toBe(sha(tok));
    expect(row.absExpiresAt.getTime() - row.passwordAuthAt.getTime()).toBe(90 * 86_400_000);
    expect(Math.abs(row.passwordAuthAt.getTime() - t0)).toBeLessThan(60_000);
    expect(row.employeeId).toBe(await empId('sale'));
    const raw = await adminPrisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM public.remember_device WHERE token_hash = ${tok} OR ua_short = ${tok} OR ip_prefix = ${tok}`;
    expect(Number(raw[0].n)).toBe(0);
  });

  it('restore hợp lệ: phiên THƯỜNG mới + CSRF mới + token xoay vòng (cùng family, CÙNG mốc tuyệt đối); /auth/me chạy bằng phiên mới', async () => {
    const tok = rmbToken(await loginRemember('sale', true));
    const old = (await rowOf(tok))!;
    const res = await restore(tok);
    expect(res.status).toBe(200);
    expect(res.body.data.me).toMatchObject({ code: codes.sale, roles: ['sales'] });
    expect(res.body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sid = cookieOf(res);
    expect(all(res).find((c) => c.startsWith('siscom_sid='))).toMatch(/Max-Age=1800(;|$)/);
    const next = rmbToken(res);
    expect(next).not.toBe(tok);
    const oldAfter = (await rowOf(tok))!; const child = (await rowOf(next))!;
    expect(oldAfter.rotatedAt).not.toBeNull();
    expect(oldAfter.replacedById).toBe(child.id);
    expect(child.familyId).toBe(old.familyId);
    expect(child.absExpiresAt.getTime()).toBe(old.absExpiresAt.getTime());
    expect(child.passwordAuthAt.getTime()).toBe(old.passwordAuthAt.getTime());
    const me = await srv().get('/api/v1/auth/me').set('Cookie', sid);
    expect(me.status).toBe(200);
    expect(me.body.data.me.code).toBe(codes.sale);
    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: 'auth.remember' } }, select: { action: true, summary: true, changes: true } });
    expect(audit.some((a) => a.action === 'auth.remember_restored')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(tok);
    expect(JSON.stringify(audit)).not.toContain(next);
  });

  it('restore bắt buộc Origin allowlist + X-Remember-Restore: 1 (403 CSRF_FAILED), token KHÔNG bị tiêu', async () => {
    const tok = rmbToken(await loginRemember('sale', true));
    const bare = (o: (r: request.Test) => request.Test) => o(srv().post(RESTORE).set('Cookie', 'siscom_rmb=' + tok));
    for (const r of [
      bare((x) => x.set('X-Remember-Restore', '1')),
      bare((x) => x.set('Origin', 'http://evil.example').set('X-Remember-Restore', '1')),
      bare((x) => x.set('Origin', ORIGIN)),
      bare((x) => x.set('Origin', ORIGIN).set('X-Remember-Restore', '0')),
    ]) { const res = await r; expect(res.status).toBe(403); expect(res.body.error.code).toBe('CSRF_FAILED'); }
    expect((await rowOf(tok))!.rotatedAt).toBeNull();
    expect((await restore(tok)).status).toBe(200);
  });

  it('không cookie / token giả đúng định dạng / sai định dạng => 401 REMEMBER_INVALID (không lộ chi tiết); token giả => xoá cookie', async () => {
    const none = await restore(null);
    expect(none.status).toBe(401); expect(none.body.error.code).toBe('REMEMBER_INVALID');
    const forged = await restore(randomBytes(32).toString('base64url'));
    expect(forged.status).toBe(401); expect(forged.body.error.code).toBe('REMEMBER_INVALID'); expect(cleared(forged)).toBe(true);
    const bad = await restore('khong-dung-dinh-dang');
    expect(bad.status).toBe(401); expect(bad.body.error.code).toBe('REMEMBER_INVALID'); expect(cleared(bad)).toBe(true);
    expect(forged.body.error.message).toBe(bad.body.error.message);
  });

  it('token hết hạn (quá mốc 90 ngày) => 401 REMEMBER_INVALID + xoá cookie, không tạo phiên', async () => {
    const id = await empId('sale');
    const cred = await adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: id }, select: { tokenVersion: true } });
    const tok = randomBytes(32).toString('base64url'); const day = 86_400_000; const now = Date.now();
    await adminPrisma.rememberDevice.create({ data: { employeeId: id, familyId: randomUUID(), tokenHash: sha(tok), tokenVersion: cred.tokenVersion,
      passwordAuthAt: new Date(now - 91 * day), issuedAt: new Date(now - 91 * day), lastUsedAt: new Date(now - 2 * day), absExpiresAt: new Date(now - day) } });
    const sessionsBefore = await adminPrisma.authSession.count({ where: { employeeId: id } });
    const res = await restore(tok);
    expect(res.status).toBe(401); expect(res.body.error.code).toBe('REMEMBER_INVALID'); expect(cleared(res)).toBe(true);
    expect(await adminPrisma.authSession.count({ where: { employeeId: id } })).toBe(sessionsBefore);
  });

  it('dùng lại token cũ TRONG 10 giây => 401 REMEMBER_RACE (giữ cookie, không thu hồi); SAU 10 giây => replay: thu hồi CẢ family (kể cả token con), audit', async () => {
    const tok = rmbToken(await loginRemember('sale', true));
    const first = await restore(tok); const child = rmbToken(first); const thiefSid = cookieOf(first);
    const race = await restore(tok);
    expect(race.status).toBe(401); expect(race.body.error.code).toBe('REMEMBER_RACE'); expect(all(race)).toHaveLength(0);
    expect((await rowOf(child))!.revokedAt).toBeNull();
    await sleep(10_500);
    const replay = await restore(tok);
    expect(replay.status).toBe(401); expect(replay.body.error.code).toBe('REMEMBER_INVALID'); expect(cleared(replay)).toBe(true);
    const fam = await adminPrisma.rememberDevice.findMany({ where: { familyId: (await rowOf(tok))!.familyId } });
    expect(fam.length).toBe(2);
    expect(fam.find((r) => r.tokenHash === sha(child))!.revokeReason).toBe('REPLAY');
    expect((await restore(child)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.remember_replay' } })).toBeGreaterThan(0);
    // QA I-2: phiên thường đã tái lập từ family bị lộ cũng bị thu hồi (kẻ restore trước bị đá ra).
    expect((await srv().get('/api/v1/auth/me').set('Cookie', thiefSid)).status).toBe(401);
  }, 30_000);

  it('QA I-1: restore khi còn 1 giờ tới mốc 90 ngày => phiên thường mới hết hạn đúng mốc (cookie phiên Max-Age <= 3600), không +12h', async () => {
    const id = await empId('sale');
    const cred = await adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: id }, select: { tokenVersion: true } });
    const tok = randomBytes(32).toString('base64url'); const day = 86_400_000; const pa = new Date(Date.now() - 90 * day + 3_600_000);
    await adminPrisma.rememberDevice.create({ data: { employeeId: id, familyId: randomUUID(), tokenHash: sha(tok), tokenVersion: cred.tokenVersion,
      passwordAuthAt: pa, issuedAt: pa, lastUsedAt: pa, absExpiresAt: new Date(pa.getTime() + 90 * day) } });
    const res = await restore(tok);
    expect(res.status).toBe(200);
    const maxAge = Number(/Max-Age=([0-9]+)/.exec(all(res).find((x) => x.startsWith('siscom_sid='))!)![1]);
    expect(maxAge).toBeLessThanOrEqual(3600);
    const row = await adminPrisma.authSession.findFirstOrThrow({ where: { refreshHash: sha(cookieOf(res).split('=')[1]) } });
    expect(row.absExpiresAt.getTime()).toBe(pa.getTime() + 90 * day);
  });

  it('QA lần 2 Minor-2: family vừa bị thu hồi song song (còn token chưa xoay) => trigger DB chặn token con, restore 401 + xoá cookie (không 500, không phiên)', async () => {
    const id = await empId('sale');
    const cred = await adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: id }, select: { tokenVersion: true } });
    const tok = randomBytes(32).toString('base64url'); const fam = randomUUID(); const pa = new Date(Date.now() - 86_400_000); const abs = new Date(pa.getTime() + 90 * 86_400_000);
    const base = { employeeId: id, familyId: fam, tokenVersion: cred.tokenVersion, passwordAuthAt: pa, issuedAt: pa, lastUsedAt: pa, absExpiresAt: abs };
    await adminPrisma.rememberDevice.create({ data: { ...base, tokenHash: sha(tok) } });
    // mô phỏng kết quả của một lần thu hồi chạy song song: một hàng khác cùng family đã bị thu hồi
    await adminPrisma.rememberDevice.create({ data: { ...base, tokenHash: sha(randomBytes(32).toString('base64url')), revokedAt: new Date(), revokeReason: 'LOGOUT' } });
    const before = await adminPrisma.authSession.count({ where: { employeeId: id } });
    const res = await restore(tok);
    expect(res.status).toBe(401); expect(res.body.error.code).toBe('REMEMBER_INVALID'); expect(cleared(res)).toBe(true);
    expect(await adminPrisma.authSession.count({ where: { employeeId: id } })).toBe(before);
    expect(await adminPrisma.rememberDevice.count({ where: { familyId: fam } })).toBe(2);
  });

  it('truy cập đồng thời: 6 restore song song cùng token => đúng MỘT 200, còn lại 401 REMEMBER_RACE; đúng một token con, không thu hồi family', async () => {
    const tok = rmbToken(await loginRemember('sale', true));
    const fam = (await rowOf(tok))!.familyId;
    const rs = await Promise.all(Array.from({ length: 6 }, () => restore(tok)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 401 && r.body.error.code === 'REMEMBER_RACE')).toHaveLength(5);
    const rows = await adminPrisma.rememberDevice.findMany({ where: { familyId: fam } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt === null)).toBe(true);
  });

  it('logout thu hồi chuỗi ghi nhớ của thiết bị này (LOGOUT) và xoá cookie; restore sau đó 401', async () => {
    const res = await loginRemember('sale', true); const tok = rmbToken(res); const sid = cookieOf(res);
    const out = await srv().post('/api/v1/auth/logout').set('Origin', ORIGIN).set('Cookie', sid + '; siscom_rmb=' + tok).set('X-CSRF-Token', res.body.data.csrfToken);
    expect(out.status).toBe(200); expect(cleared(out)).toBe(true);
    expect((await rowOf(tok))!.revokeReason).toBe('LOGOUT');
    expect((await restore(tok)).status).toBe(401);
  });

  it('đăng nhập lại KHÔNG tích trên thiết bị còn cookie cũ => thu hồi chuỗi cũ (LOGIN_NO_REMEMBER) + xoá cookie', async () => {
    const tok = rmbToken(await loginRemember('sale', true));
    const res = await loginRemember('sale', false, 'siscom_rmb=' + tok);
    expect(res.status).toBe(200); expect(rmbOf(res)).toBeNull(); expect(cleared(res)).toBe(true);
    expect((await rowOf(tok))!.revokeReason).toBe('LOGIN_NO_REMEMBER');
  });

  it('nhân viên không còn ACTIVE (khoá/nghỉ việc) => restore 401, thu hồi family (INVALID_STATE), không cấp phiên', async () => {
    // kỹ thuật viên: không giữ vai trò quan trọng (admin cuối cùng bị trigger M1.1 LAST_ADMIN chặn đổi trạng thái — đúng thiết kế).
    const tok = rmbToken(await loginRemember('technician', true));
    const id = await empId('technician');
    await adminPrisma.employee.update({ where: { id }, data: { status: 'RESIGNED' } });
    try {
      const res = await restore(tok);
      expect(res.status).toBe(401); expect(res.body.error.code).toBe('REMEMBER_INVALID');
      expect((await rowOf(tok))!.revokeReason).toBe('INVALID_STATE');
    } finally { await adminPrisma.employee.update({ where: { id }, data: { status: 'ACTIVE' } }); }
    expect((await restore(tok)).status).toBe(401);
  });

  it('tối đa 5 thiết bị: thiết bị thứ 6 thay thiết bị ít dùng gần nhất (DEVICE_LIMIT)', async () => {
    const id = await empId('admin');
    const toks: string[] = [];
    for (let i = 0; i < 6; i++) toks.push(rmbToken(await loginRemember('admin', true)));
    const active = await adminPrisma.rememberDevice.count({ where: { employeeId: id, revokedAt: null, rotatedAt: null, absExpiresAt: { gt: new Date() } } });
    expect(active).toBe(5);
    expect((await rowOf(toks[0]))!.revokeReason).toBe('DEVICE_LIMIT');
  });

  it('đổi mật khẩu => trigger DB (token_version) thu hồi MỌI thiết bị (TOKEN_VERSION), response xoá cookie; token cũ restore 401', async () => {
    const u = USERS.find((x) => x.key === 'sale')!;
    const a = rmbToken(await loginRemember('sale', true));
    const s = await loginRemember('sale', true); const b = rmbToken(s);
    const NEW = 'Ghi-nho-90-ngay#doi-mk';
    const res = await srv().post('/api/v1/auth/change-password').set('Origin', ORIGIN).set('Cookie', cookieOf(s) + '; siscom_rmb=' + b)
      .set('X-CSRF-Token', s.body.data.csrfToken).send({ currentPassword: u.password, newPassword: NEW, confirmPassword: NEW });
    expect(res.status).toBe(200);
    u.password = NEW;
    expect(cleared(res)).toBe(true);
    for (const t of [a, b]) {
      expect((await rowOf(t))!.revokeReason).toBe('TOKEN_VERSION');
      expect((await restore(t)).status).toBe(401);
    }
    const left = await adminPrisma.rememberDevice.count({ where: { employeeId: await empId('sale'), revokedAt: null } });
    expect(left).toBe(0);
  });

  it('pool nghiệp vụ (prisma = siscom_app) không đọc được remember_device khi đã tách pool auth', async () => {
    if (!process.env.TEST_AUTH_DATABASE_URL) return; // chưa tách (Windows dev): bỏ qua, kiểm ở db-roles.int-spec / CI
    await expect(prisma.rememberDevice.count()).rejects.toThrow();
  });
});
