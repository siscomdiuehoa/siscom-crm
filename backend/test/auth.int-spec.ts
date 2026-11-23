import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { applyTrustProxy, TrustProxySetting } from '../src/app.setup';
import { AUTH_CONFIG, AuthConfig } from '../src/common/auth/auth.config';
import { ASSIGNEE_ELIGIBILITY, AssigneeEligibility, AuthPoolAssigneeEligibility } from '../src/common/auth/assignee-eligibility';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { requestContext } from '../src/common/middleware/request-context.middleware';
import { AccountsModule } from '../src/modules/accounts/accounts.module';
import { ACCOUNTS_WRITE_LIMITER } from '../src/modules/accounts/accounts.write.service';
import { LoginLimiter } from '../src/modules/auth/login-limiter';
import { inAcctTx } from '../src/modules/accounts/accounts.flow';
import { DomainException } from '../src/common/errors/domain.exception';
import { AcctPrismaService } from '../src/prisma/acct-prisma.service';
import { assessDbRole, fetchDbRoleFacts } from '../src/prisma/db-role-check';
import { AuthApiModule } from '../src/modules/auth/auth-api.module';
import { bootstrapAuth, BootstrapUser } from '../src/modules/auth/bootstrap';
import { AccountAdmin, markMustChange, parseArgs } from '../src/modules/auth/account-admin';
import { ActivitiesModule } from '../src/modules/activities/activities.module';
import { CustomersModule } from '../src/modules/customers/customers.module';
import { LookupsModule } from '../src/modules/lookups/lookups.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { leaks } from './helpers/test-app';
import { assertTestConnection, createAcctTestPrisma, createAdminTestPrisma, createAuthTestPrisma, createTestPrisma, setDatabaseDefaultTimeZone } from './helpers/test-db';
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
// P1: pool quản lý tài khoản (siscom_acct qua TEST_ACCT_DATABASE_URL); không có biến => available = false (API /accounts trả 503).
let acctPrisma: AcctPrismaService;
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
  const mod = await Test.createTestingModule({ imports: [AuthApiModule, CustomersModule, LookupsModule, ActivitiesModule, AccountsModule] })
    .overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthPrismaService).useValue((authPrisma = createAuthTestPrisma().prisma)).overrideProvider(AUTH_CONFIG).useValue(cfg).overrideProvider(AcctPrismaService).useValue((acctPrisma = createAcctTestPrisma()))
    // P1: bộ kiểm thử làm hàng chục thao tác ghi liên tiếp bằng một tài khoản => nới hạn mức (hạn mức thật 30/phút kiểm ở accounts.write.service.spec.ts).
    .overrideProvider(ACCOUNTS_WRITE_LIMITER).useValue(new LoginLimiter({ windowMs: 60_000, maxPerSource: 10_000, maxPerIdentifier: 10_000 })).compile();
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
  try { if (dbName) await setDatabaseDefaultTimeZone(dbName, null); } finally { await prisma?.$disconnect(); await adminPrisma?.$disconnect(); await authPrisma?.$disconnect(); await acctPrisma?.onModuleDestroy(); }
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
  // BUG-1 (B1.4): trình duyệt còn cookie siscom_sid của phiên đã chết (thu hồi / không tồn tại) => trước đây login 403 CSRF_FAILED.
  it('BUG-1: còn cookie phiên CHẾT (rác hoặc đã đăng xuất) => đăng nhập đúng 200 cấp phiên mới; sai mật khẩu 401 LOGIN_INVALID (không 403)', async () => {
    const u = USERS[1];
    const junk = 'siscom_sid=' + randomBytes(32).toString('base64url');
    const r1 = await login(u.email, u.password).set('Cookie', junk);
    expect(r1.status).toBe(200); expect(cookieOf(r1)).not.toBe(''); expect(cookieOf(r1)).not.toBe(junk);
    const r2 = await login(u.email, 'sai-mat-khau-bug1').set('Cookie', junk);
    expect(r2.status).toBe(401); expect(r2.body.error.code).toBe('LOGIN_INVALID');
    const s = await session('admin');
    expect((await srv().post('/api/v1/auth/logout').set('Cookie', s.cookie).set('Origin', ORIGIN).set('X-CSRF-Token', s.csrf)).status).toBeLessThan(300);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(401); // phiên đã thu hồi
    const r3 = await login(u.email, u.password).set('Cookie', s.cookie);
    expect(r3.status).toBe(200); expect(cookieOf(r3)).not.toBe(s.cookie);
  });
  it('BUG-1: phiên CÒN SỐNG giữ nguyên bảo vệ — đăng nhập kèm cookie phiên sống mà thiếu X-CSRF-Token => 403 CSRF_FAILED', async () => {
    const u = USERS[1]; const s = await session('admin');
    const r = await login(u.email, u.password).set('Cookie', s.cookie);
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('CSRF_FAILED');
    expect((await login(u.email, u.password).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf)).status).toBe(200);
  });
  // Owner duyệt 2026-11-01 (QA bảo mật PR #190 Minor 2): đăng nhập lại thành công trên trình duyệt đang có phiên sống => thu hồi phiên cũ (RELOGIN).
  it('RELOGIN: đăng nhập lại (cùng người) khi phiên cũ còn sống => phiên cũ 401, phiên mới 200, có nhật ký thu hồi', async () => {
    const u = USERS[1]; const s = await session('admin');
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(200);
    const W = { action: 'auth.session_revoked_relogin', actorId: s.me.employeeId as string, entityId: s.me.employeeId as string };
    const before = await adminPrisma.auditLog.count({ where: W });
    const r = await login(u.email, u.password).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    expect(r.status).toBe(200);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(401);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', cookieOf(r))).status).toBe(200);
    expect(await adminPrisma.auditLog.count({ where: W })).toBe(before + 1); // đúng MỘT dòng nhật ký cho lần này
  });
  it('RELOGIN: người KHÁC đăng nhập trên cùng trình duyệt (máy dùng chung) => phiên của người trước bị thu hồi; nhật ký: người thực hiện = người mới, đối tượng = người trước', async () => {
    const s = await session('sale');
    const a = USERS[1];
    const r = await login(a.email, a.password).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    expect(r.status).toBe(200);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(401);
    const last = await adminPrisma.auditLog.findFirst({ where: { action: 'auth.session_revoked_relogin', entityId: s.me.employeeId as string }, orderBy: { id: 'desc' } });
    expect(last?.actorId).toBe(r.body.data.me.employeeId);
  });
  it('RELOGIN: đăng nhập SAI mật khẩu khi có phiên sống => 401 và phiên cũ VẪN dùng được', async () => {
    const s = await session('admin');
    const r = await login(USERS[1].email, 'sai-mat-khau-relogin').set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    expect(r.status).toBe(401);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s.cookie)).status).toBe(200);
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
  it('R2-228: ĐANG khoá mà thử tiếp (sai quá ngưỡng + đúng mật khẩu) => vẫn 401, lock_level / locked_until / failed_count KHÔNG đổi, không khoá thêm; hết hạn => 200', async () => {
    const u = USERS[3];
    // Tài khoản dùng chung với các ca khác => LUÔN trả về trạng thái sạch, kể cả khi ca này thất bại (không gây lỗi dây chuyền).
    const resetCred = () => adminPrisma.employeeCredential.updateMany({ where: { employee: { email: u.email } }, data: { failedCount: 0, windowStartedAt: null, lockedUntil: null, lockLevel: 0 } });
    try {
      for (let i = 0; i < cfg.lockAfterFailures; i++) expect((await login(u.email, 'sai-r2-' + i)).status).toBe(401);
      const c0 = await adminPrisma.employeeCredential.findFirstOrThrow({ where: { employee: { email: u.email } } });
      expect(c0.lockedUntil).not.toBeNull(); expect(c0.lockLevel).toBe(1);
      const lockedBefore = await prisma.auditLog.count({ where: { action: 'auth.login_locked', entityId: c0.employeeId } });
      const failedBefore = await prisma.auditLog.count({ where: { action: 'auth.login_failed', entityId: c0.employeeId } });
      const tries = cfg.lockAfterFailures * 2 + 1; // quá ngưỡng hai lần
      for (let i = 0; i < tries; i++) {
        const r = await login(u.email, 'sai-khi-khoa-' + i);
        expect(r.status).toBe(401); expect(r.body.error.code).toBe('LOGIN_INVALID');
      }
      const ok = await login(u.email, u.password); // đúng mật khẩu khi đang khoá
      expect(ok.status).toBe(401); expect(ok.body.error.code).toBe('LOGIN_INVALID');
      const c1 = await adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: c0.employeeId } });
      expect(c1.lockLevel).toBe(1);
      expect(c1.lockedUntil!.getTime()).toBe(c0.lockedUntil!.getTime());
      expect(c1.failedCount).toBe(0); expect(c1.windowStartedAt).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: 'auth.login_locked', entityId: c0.employeeId } })).toBe(lockedBefore);
      expect(await prisma.auditLog.count({ where: { action: 'auth.login_failed', entityId: c0.employeeId } })).toBe(failedBefore + tries + 1); // vẫn còn dấu vết
      await adminPrisma.employeeCredential.update({ where: { employeeId: c0.employeeId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      expect((await login(u.email, u.password)).status).toBe(200);
    } finally {
      await resetCred();
    }
    const clean = await adminPrisma.employeeCredential.findFirstOrThrow({ where: { employee: { email: u.email } } });
    expect([clean.failedCount, clean.lockLevel, clean.lockedUntil, clean.windowStartedAt]).toEqual([0, 0, null, null]);
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

  it('QA lần 3 Important-1: kẻ trộm restore trước rồi tự thu hồi thiết bị (revoke-all) để né phát hiện => nạn nhân dùng lại token cũ sau 10 giây vẫn là REPLAY, phiên kẻ trộm bị thu hồi', async () => {
    const tok = rmbToken(await loginRemember('sale', true));
    const thief = await restore(tok); expect(thief.status).toBe(200);
    const thiefSid = cookieOf(thief); const thiefCsrf = thief.body.data.csrfToken as string;
    const ra = await srv().post('/api/v1/auth/remember/revoke-all').set('Origin', ORIGIN).set('Cookie', thiefSid).set('X-CSRF-Token', thiefCsrf);
    expect(ra.status).toBe(200);
    // Owner duyệt 2026-11-01 (câu 3): revoke-all nay thu hồi luôn phiên đã khôi phục — kể cả phiên của kẻ trộm đang gọi lệnh (trước đây vẫn 200).
    expect((await srv().get('/api/v1/auth/me').set('Cookie', thiefSid)).status).toBe(401);
    // Rà soát 2026-11-01 Minor 3: ghim đúng đường thu hồi (revoke-all, không phải REPLAY).
    expect((await adminPrisma.authSession.findFirstOrThrow({ where: { refreshHash: sha(thiefSid.split('=')[1]) } })).revokeReason).toBe('REMEMBER_DEVICE_REVOKED');
    const replaysBefore = await prisma.auditLog.count({ where: { action: 'auth.remember_replay' } });
    await sleep(10_500);
    const victim = await restore(tok);
    expect(victim.status).toBe(401); expect(victim.body.error.code).toBe('REMEMBER_INVALID');
    // Phiên kẻ trộm đã chết từ bước revoke-all ở trên; việc REPLAY tự thu hồi phiên được chứng minh ở test "QA I-2" (kẻ trộm không tự thu hồi).
    expect((await srv().get('/api/v1/auth/me').set('Cookie', thiefSid)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.remember_replay' } })).toBe(replaysBefore + 1);
    // QA lần 3b Important-A: nạn nhân đăng nhập lại; kẻ cầm token cũ gửi lại => KHÔNG đăng xuất được phiên mới.
    const again = await loginRemember('sale', false); expect(again.status).toBe(200);
    const victimSid = cookieOf(again);
    const replay2 = await restore(tok);
    expect(replay2.status).toBe(401);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', victimSid)).status).toBe(200);
    // QA lần 3c Minor-2: lần thử này VẪN có dấu vết audit (đánh dấu familyAlreadyRevoked, không thu hồi phiên nào).
    expect(await prisma.auditLog.count({ where: { action: 'auth.remember_replay' } })).toBe(replaysBefore + 2);
  }, 30_000);

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

  it('Rà soát 2026-11-01 Minor 1: kẻ trộm restore trước; nạn nhân đăng nhập KHÔNG tích trên thiết bị còn cookie => phiên kẻ trộm 401 (REMEMBER_DEVICE_REVOKED), phiên mới của nạn nhân 200', async () => {
    const tok = rmbToken(await loginRemember('sale', true));
    const thief = await restore(tok); expect(thief.status).toBe(200);
    const thiefSid = cookieOf(thief);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', thiefSid)).status).toBe(200);
    const again = await loginRemember('sale', false, 'siscom_rmb=' + tok);
    expect(again.status).toBe(200); expect(cleared(again)).toBe(true);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', thiefSid)).status).toBe(401);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', cookieOf(again))).status).toBe(200);
    const dead = await adminPrisma.authSession.findFirstOrThrow({ where: { refreshHash: sha(thiefSid.split('=')[1]) } });
    expect(dead.revokeReason).toBe('REMEMBER_DEVICE_REVOKED');
  });

  // Kịch bản GỘP #191 (RELOGIN) + #193 (câu 3), rà soát độc lập I-1: trình duyệt giữ phiên khôi phục S2 (từ family F) + cookie F (token con),
  // đăng nhập lại bằng mật khẩu không tích => S2 bị RELOGIN (và có audit), phiên khôi phục khác của F (S1) bị REMEMBER_DEVICE_REVOKED,
  // family F bị LOGIN_NO_REMEMBER, không lỗi trigger, phiên mới 200.
  it('GỘP RELOGIN + câu 3: đăng nhập lại trên trình duyệt có phiên khôi phục + cookie ghi nhớ => phiên đó RELOGIN, phiên khôi phục khác REMEMBER_DEVICE_REVOKED', async () => {
    const tok0 = rmbToken(await loginRemember('sale', true));
    const r1 = await restore(tok0); expect(r1.status).toBe(200); const s1 = cookieOf(r1); const tok1 = rmbToken(r1);
    const r2 = await restore(tok1); expect(r2.status).toBe(200); const s2 = cookieOf(r2); const tok2 = rmbToken(r2); const csrf2 = r2.body.data.csrfToken as string;
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s1)).status).toBe(200);
    const relBefore = await prisma.auditLog.count({ where: { action: 'auth.session_revoked_relogin' } });
    const u = USERS.find((x) => x.key === 'sale')!;
    const again = await srv().post('/api/v1/auth/login').set('Origin', ORIGIN).set('Cookie', s2 + '; siscom_rmb=' + tok2).set('X-CSRF-Token', csrf2)
      .send({ login: u.email, password: u.password, remember: false });
    expect(again.status).toBe(200); expect(cleared(again)).toBe(true);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', cookieOf(again))).status).toBe(200);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s2)).status).toBe(401);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', s1)).status).toBe(401);
    expect((await adminPrisma.authSession.findFirstOrThrow({ where: { refreshHash: sha(s2.split('=')[1]) } })).revokeReason).toBe('RELOGIN');
    expect((await adminPrisma.authSession.findFirstOrThrow({ where: { refreshHash: sha(s1.split('=')[1]) } })).revokeReason).toBe('REMEMBER_DEVICE_REVOKED');
    expect((await rowOf(tok2))!.revokeReason).toBe('LOGIN_NO_REMEMBER');
    expect(await prisma.auditLog.count({ where: { action: 'auth.session_revoked_relogin' } })).toBe(relBefore + 1);
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

// Owner duyệt 2026-11-01 (Remember Me câu 3): thu hồi thiết bị => thu hồi luôn phiên thường đang mở đã KHÔI PHỤC từ thiết bị đó.
describe('B1.4 câu 3 — thu hồi thiết bị kéo theo phiên đã khôi phục', () => {
  const all = (res: request.Response): string[] => { const sc = res.headers['set-cookie']; return Array.isArray(sc) ? sc : sc ? [String(sc)] : []; };
  const rmbToken = (res: request.Response): string => all(res).find((c) => c.startsWith('siscom_rmb=') && !c.startsWith('siscom_rmb=;'))!.split(';')[0].split('=')[1];
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');
  const restore = (token: string) => srv().post('/api/v1/auth/remember/restore').set('Origin', ORIGIN).set('X-Remember-Restore', '1').set('Cookie', 'siscom_rmb=' + token);
  const loginRmb = () => { const u = USERS.find((x) => x.key === 'technician')!; return srv().post('/api/v1/auth/login').set('Origin', ORIGIN).send({ login: u.email, password: u.password, remember: true }); };
  const me = (cookie: string) => srv().get('/api/v1/auth/me').set('Cookie', cookie);
  const familyOf = async (tok: string) => (await adminPrisma.rememberDevice.findUniqueOrThrow({ where: { tokenHash: sha(tok) }, select: { familyId: true } })).familyId;

  it('phiên khôi phục ghi remember_family_id; phiên đăng nhập mật khẩu để NULL', async () => {
    const a = await loginRmb(); expect(a.status).toBe(200);
    const tok = rmbToken(a); const fam = await familyOf(tok);
    const r = await restore(tok); expect(r.status).toBe(200);
    const sid = cookieOf(r).split('=')[1];
    const row = await adminPrisma.authSession.findUniqueOrThrow({ where: { refreshHash: sha(sid) }, select: { rememberFamilyId: true } });
    expect(row.rememberFamilyId).toBe(fam);
    const pw = await adminPrisma.authSession.findUniqueOrThrow({ where: { refreshHash: sha(cookieOf(a).split('=')[1]) }, select: { rememberFamilyId: true } });
    expect(pw.rememberFamilyId).toBeNull();
  });
  it('DELETE một thiết bị => phiên khôi phục từ thiết bị đó 401; phiên từ thiết bị khác và phiên mật khẩu vẫn 200', async () => {
    const a = await loginRmb(); const tokA = rmbToken(a); const famA = await familyOf(tokA);
    const sidA = cookieOf(await restore(tokA));
    const b = await loginRmb(); const tokB = rmbToken(b);
    const sidB = cookieOf(await restore(tokB));
    for (const c of [sidA, sidB, cookieOf(b)]) expect((await me(c)).status).toBe(200);
    const del = await srv().delete('/api/v1/auth/remember/devices/' + famA).set('Cookie', cookieOf(b)).set('Origin', ORIGIN).set('X-CSRF-Token', b.body.data.csrfToken);
    expect(del.status).toBeLessThan(300);
    expect((await me(sidA)).status).toBe(401);
    expect((await me(sidB)).status).toBe(200);
    expect((await me(cookieOf(b))).status).toBe(200);
  });
  it('revoke-all => mọi phiên khôi phục 401; phiên đăng nhập bằng mật khẩu vẫn 200', async () => {
    const a = await loginRmb(); const sidA = cookieOf(await restore(rmbToken(a)));
    const b = await loginRmb(); const sidB = cookieOf(await restore(rmbToken(b)));
    const pw = await loginRmb();
    const r = await srv().post('/api/v1/auth/remember/revoke-all').set('Cookie', cookieOf(pw)).set('Origin', ORIGIN).set('X-CSRF-Token', pw.body.data.csrfToken);
    expect(r.status).toBeLessThan(300);
    expect((await me(sidA)).status).toBe(401);
    expect((await me(sidB)).status).toBe(401);
    expect((await me(cookieOf(pw))).status).toBe(200);
  });
  it('QA #193: nạn nhân ĐĂNG XUẤT (kèm cookie ghi nhớ) => phiên kẻ trộm đã khôi phục từ thiết bị đó cũng 401', async () => {
    const victim = await loginRmb(); const tok = rmbToken(victim);
    const thiefSid = cookieOf(await restore(tok));
    expect((await me(thiefSid)).status).toBe(200);
    const lo = await srv().post('/api/v1/auth/logout').set('Origin', ORIGIN).set('Cookie', cookieOf(victim) + '; siscom_rmb=' + tok).set('X-CSRF-Token', victim.body.data.csrfToken);
    expect(lo.status).toBeLessThan(300);
    expect((await me(thiefSid)).status).toBe(401);
  });
  it('DELETE thiết bị của NGƯỜI KHÁC => 404 và phiên khôi phục của người đó vẫn 200', async () => {
    const a = await loginRmb(); const tokA = rmbToken(a); const famA = await familyOf(tokA);
    const sidA = cookieOf(await restore(tokA));
    const other = await session('accountant');
    const del = await srv().delete('/api/v1/auth/remember/devices/' + famA).set('Cookie', other.cookie).set('Origin', ORIGIN).set('X-CSRF-Token', other.csrf);
    expect(del.status).toBe(404);
    expect((await me(sidA)).status).toBe(200);
  });
});

// B3 A5 — Hoạt động với PHIÊN THẬT 4 vai trò: quyền activity.* lấy từ vai trò bootstrap (ma trận BIZ của A4), người được giao đọc vai trò THẬT
// trong DB (DbEmployeeAccess, không giả), nhật ký ghi THẬT vào audit_log (DbAuditPort + SENSITIVE_KEYS), ghi bằng siscom_app nhờ APP_GRANTS_V4.
describe('B3 A5 — Hoạt động qua API thật (phiên + vai trò + audit thật)', () => {
  const C = '/api/v1/customers/';
  const w = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  let adminS: { cookie: string; csrf: string }; let saleS: { cookie: string; csrf: string }; let techS: { cookie: string; csrf: string }; let acctS: { cookie: string; csrf: string };
  const id: Record<string, string> = {};
  let cust: { id: string; code: string };
  beforeAll(async () => {
    adminS = await session('admin'); saleS = await session('sale'); techS = await session('technician'); acctS = await session('accountant');
    for (const k of ['admin', 'sale', 'technician', 'accountant', 'sysadmin']) id[k] = (await prisma.employee.findFirstOrThrow({ where: { code: codes[k] }, select: { id: true } })).id;
    cust = await makeCustomer(prisma, fx, { ownerId: id.sale, phone: '0903123470', phoneE164: '+84903123470' }); // khách của SALE (phòng KD)
  });
  const due = () => new Date(Date.now() + 2 * 86400000).toISOString();

  it('đăng nhập: vai trò bootstrap mang đúng quyền activity.* của ma trận §5', async () => {
    const m = (await session('sale')).me as { permissions: Record<string, string> };
    expect(m.permissions).toMatchObject({ 'activity.read': 'OWN', 'activity.create': 'OWN', 'activity.assign': 'OWN' });
    expect(m.permissions['activity.delete']).toBeUndefined();
    const t = (await session('technician')).me as { permissions: Record<string, string> };
    expect(t.permissions).toMatchObject({ 'activity.read': 'DEPARTMENT', 'activity.create_tech': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT' });
    expect(t.permissions['activity.create']).toBeUndefined();
  });
  it('SALE tạo CALL trên khách của mình => 201; audit_log THẬT có activity.create, nội dung bị che; ghi không CSRF => 403', async () => {
    const secret = 'Nội dung chăm sóc riêng ' + Date.now();
    expect((await srv().post(C + cust.id + '/activities').set('Cookie', saleS.cookie).send({ type: 'CALL', content: secret })).status).toBe(403);
    const r = await srv().post(C + cust.id + '/activities').set(w(saleS)).send({ type: 'CALL', content: secret, outcome: 'Đồng ý báo giá' });
    expect(r.status).toBe(201);
    const log = await prisma.auditLog.findFirst({ where: { action: 'activity.create', entityId: r.body.data.id }, select: { actorId: true, entityCode: true, summary: true, changes: true } });
    expect(log).toMatchObject({ actorId: id.sale, entityCode: r.body.data.code });
    expect(log!.changes).toMatchObject({ content: '(đã thay đổi)', outcome: '(đã thay đổi)', type: [null, 'CALL'] });
    expect(JSON.stringify(log)).not.toContain(secret);
  });
  it('TECHNICIAN (phòng KT) với khách phòng KD => 404 cả đọc lẫn ghi; ACCOUNTANT đọc 200 nhưng tạo 403', async () => {
    expect((await srv().get(C + cust.id + '/activities').set('Cookie', techS.cookie)).status).toBe(404);
    expect((await srv().post(C + cust.id + '/activities').set(w(techS)).send({ type: 'NOTE', content: 'x' })).status).toBe(404);
    const g = await srv().get(C + cust.id + '/activities').set('Cookie', acctS.cookie);
    expect(g.status).toBe(200);
    expect(g.body.data.total).toBeGreaterThanOrEqual(1);
    expect((await srv().post(C + cust.id + '/activities').set(w(acctS)).send({ type: 'NOTE', content: 'x' })).status).toBe(403);
  });
  it('giao việc đọc VAI TRÒ THẬT của người nhận: crm_admin giao cho kỹ thuật (không đọc được khách KD) => 400 NO_ACCESS; giao cho sale (chủ khách) => 201 + audit activity.assign', async () => {
    const no = await srv().post(C + cust.id + '/activities').set(w(adminS)).send({ type: 'TASK', content: 'Khảo sát', dueAt: due(), performedById: id.technician });
    expect(no.status).toBe(400);
    expect(no.body.error.code).toBe('ACTIVITY_ASSIGNEE_NO_ACCESS');
    const ok = await srv().post(C + cust.id + '/activities').set(w(adminS)).send({ type: 'TASK', content: 'Gọi lại khách', dueAt: due(), performedById: id.sale });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ status: 'OPEN', performedBy: { id: id.sale } });
    const logs = await prisma.auditLog.findMany({ where: { entityId: ok.body.data.id }, select: { action: true, changes: true }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['activity.create', 'activity.assign']);
    expect(logs[1].changes).toEqual({ performedById: [id.admin, id.sale] });
  });
  it('SALE giao cho người khác phòng => 400 ACTIVITY_ASSIGNEE_INVALID (phạm vi giao OWN)', async () => {
    const r = await srv().post(C + cust.id + '/activities').set(w(saleS)).send({ type: 'TASK', content: 'x', dueAt: due(), performedById: id.technician });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('ACTIVITY_ASSIGNEE_INVALID');
  });
  it('ứng viên phụ trách (crm_admin): chỉ người đọc được khách — có sale, crm_admin, kế toán; KHÔNG có kỹ thuật (phòng khác) và sysadmin (không quyền BIZ)', async () => {
    const r = await srv().get('/api/v1/activities/assignee-candidates?customerId=' + cust.id).set('Cookie', adminS.cookie);
    expect(r.status).toBe(200);
    const ids = r.body.data.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([id.sale, id.admin, id.accountant]));
    expect(ids).not.toContain(id.technician);
    expect(ids).not.toContain(id.sysadmin);
    expect((await srv().get('/api/v1/activities/assignee-candidates?customerId=' + cust.id).set('Cookie', techS.cookie)).status).toBe(403);
  });
});

// B3 A6 — vòng đời việc + quyền theo việc (§5.4) bằng PHIÊN THẬT: quyền activity.* từ vai trò bootstrap, thẩm quyền kỹ thuật của người nhận đọc
// vai trò THẬT (DbEmployeeAccess), ghi activity/activity_access bằng siscom_app (APP_GRANTS_V4), nhật ký THẬT vào audit_log (SENSITIVE_KEYS).
describe('B3 A6 — Công việc + quyền theo việc qua API thật', () => {
  const C = '/api/v1/customers/';
  const A = '/api/v1/activities/';
  const w = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  let adminS: { cookie: string; csrf: string }; let saleS: { cookie: string; csrf: string }; let techS: { cookie: string; csrf: string }; let acctS: { cookie: string; csrf: string };
  const id: Record<string, string> = {};
  let cust: { id: string; code: string };
  let task: { id: string; code: string; version: number };
  const secret = 'Nội dung khảo sát riêng ' + Date.now();
  beforeAll(async () => {
    adminS = await session('admin'); saleS = await session('sale'); techS = await session('technician'); acctS = await session('accountant');
    for (const k of ['admin', 'sale', 'technician', 'accountant']) id[k] = (await prisma.employee.findFirstOrThrow({ where: { code: codes[k] }, select: { id: true } })).id;
    cust = await makeCustomer(prisma, fx, { ownerId: id.sale, phone: '0903123471', phoneE164: '+84903123471' }); // khách của SALE (phòng KD)
  });
  const due = () => new Date(Date.now() + 3 * 86400000).toISOString();

  it('SALE giao TASK cho KỸ THUẬT phòng khác: không external => 400; external=true => 201 + activity_access THẬT + audit access_grant', async () => {
    const no = await srv().post(C + cust.id + '/activities').set(w(saleS)).send({ type: 'TASK', content: secret, dueAt: due(), performedById: id.technician });
    expect(no.status).toBe(400);
    const r = await srv().post(C + cust.id + '/activities').set(w(saleS)).send({ type: 'TASK', content: secret, dueAt: due(), performedById: id.technician, external: true });
    expect(r.status).toBe(201);
    task = r.body.data;
    const acc = await prisma.activityAccess.findMany({ where: { activityId: task.id }, select: { employeeId: true, grantedById: true, revokedAt: true, createdAt: true, expiresAt: true } });
    expect(acc).toHaveLength(1);
    expect(acc[0]).toMatchObject({ employeeId: id.technician, grantedById: id.sale, revokedAt: null });
    expect(Math.round((acc[0].expiresAt.getTime() - acc[0].createdAt.getTime()) / 3600000)).toBe(72 + 168);
    const logs = await prisma.auditLog.findMany({ where: { entityId: task.id }, select: { action: true }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['activity.create', 'activity.assign', 'activity.access_grant']);
  });
  it('KỸ THUẬT (chỉ quyền theo việc): danh sách/chi tiết/thẻ khách 200; timeline/lịch sử 404; sửa nội dung 403; không CSRF 403', async () => {
    const l = await srv().get('/api/v1/activities?assignee=me&pageSize=100').set('Cookie', techS.cookie);
    expect(l.status).toBe(200);
    expect(l.body.data.items.find((i: { id: string }) => i.id === task.id)).toMatchObject({ access: 'TASK' });
    const d = await srv().get(A + task.id).set('Cookie', techS.cookie);
    expect(d.status).toBe(200);
    expect(d.body.data.access).toBe('TASK');
    const wc = await srv().get(A + task.id + '/work-card').set('Cookie', techS.cookie);
    expect(wc.status).toBe(200);
    expect(wc.body.data.customer).toMatchObject({ code: cust.code });
    expect((await srv().get(C + cust.id + '/activities').set('Cookie', techS.cookie)).status).toBe(404);
    expect((await srv().get(A + task.id + '/history').set('Cookie', techS.cookie)).status).toBe(404);
    expect((await srv().patch(A + task.id).set(w(techS)).send({ version: task.version, content: 'sửa' })).status).toBe(403);
    expect((await srv().patch(A + task.id).set('Cookie', techS.cookie).send({ version: task.version, outcome: 'x' })).status).toBe(403);
    const s = await srv().get(A + 'reminders/summary').set('Cookie', techS.cookie);
    expect(s.status).toBe(200);
    expect(Object.keys(s.body.data).sort()).toEqual(['overdue', 'pendingApprovals', 'today', 'transferDecisions', 'upcoming7d']);
    expect(s.body.data.upcoming7d).toBeGreaterThanOrEqual(1);
  });
  it('KỸ THUẬT hoàn thành (kèm kết quả) => DONE; quyền theo việc thu hồi COMPLETED trong audit_log THẬT (che kết quả); sau đó 404', async () => {
    const r = await srv().post(A + task.id + '/complete').set(w(techS)).send({ version: task.version, outcome: 'Kết quả đo riêng' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'DONE', completedById: id.technician });
    const rev = await prisma.auditLog.findFirst({ where: { entityId: task.id, action: 'activity.access_revoke' }, select: { changes: true, actorId: true } });
    expect(rev).toMatchObject({ actorId: id.technician, changes: { employeeId: id.technician, revokeReason: 'COMPLETED' } });
    const done = await prisma.auditLog.findFirst({ where: { entityId: task.id, action: 'activity.complete' }, select: { changes: true } });
    expect(done!.changes).toMatchObject({ outcome: '(đã thay đổi)', status: ['OPEN', 'DONE'] });
    expect((await srv().get(A + task.id).set('Cookie', techS.cookie)).status).toBe(404);
  });
  it('SALE xem lịch sử THẬT (không lộ nội dung); KẾ TOÁN đọc chi tiết 200 nhưng không mở lại; SALE mở lại => cờ assigneeLostAccess', async () => {
    const h = await srv().get(A + task.id + '/history').set('Cookie', saleS.cookie);
    expect(h.status).toBe(200);
    expect(h.body.data.items.map((i: { action: string }) => i.action)).toEqual(['activity.create', 'activity.assign', 'activity.access_grant', 'activity.complete', 'activity.access_revoke']);
    expect(JSON.stringify(h.body)).not.toContain(secret);
    expect(JSON.stringify(h.body)).not.toContain('Kết quả đo riêng');
    expect((await srv().get(A + task.id).set('Cookie', acctS.cookie)).status).toBe(200);
    expect((await srv().post(A + task.id + '/reopen').set(w(acctS)).send({ version: task.version + 1 })).status).toBe(403);
    const ro = await srv().post(A + task.id + '/reopen').set(w(saleS)).send({ version: task.version + 1 });
    expect(ro.status).toBe(200);
    expect(ro.body.data).toMatchObject({ status: 'OPEN', completedAt: null, assigneeLostAccess: true });
  });
  it('xoá mềm: SALE 403; CRM_ADMIN 200, lý do che trong audit_log THẬT', async () => {
    expect((await srv().delete(A + task.id).set(w(saleS)).send({ reason: 'x' })).status).toBe(403);
    const r = await srv().delete(A + task.id).set(w(adminS)).send({ reason: 'Lý do xoá riêng' });
    expect(r.status).toBe(200);
    const log = await prisma.auditLog.findFirst({ where: { entityId: task.id, action: 'activity.delete' }, select: { changes: true, summary: true, actorId: true } });
    expect(log).toMatchObject({ actorId: id.admin, changes: { reason: '(đã thay đổi)' }, summary: 'Xoá mềm hoạt động ' + task.code + ' (TASK)' });
    expect((await srv().get(A + task.id).set('Cookie', saleS.cookie)).status).toBe(404);
  });
});

// FV-5 (CT-FV5-1): công cụ quản lý tài khoản nhân viên SAU bootstrap, chạy bằng kết nối CHỦ SỞ HỮU (adminPrisma = siscom_migrator khi đã tách role)
// trên DB thử này, qua ĐÚNG các hàm đặc quyền M1.2 (2 người). Kiểm bằng đăng nhập THẬT: mật khẩu tạm dùng được, bị buộc đổi, reset/khoá có hiệu lực.
describe('FV-5 — account-admin (thêm / đặt lại mật khẩu / khoá) qua hàm đặc quyền thật', () => {
  const ME5 = '/api/v1/auth/me'; const CP5 = '/api/v1/auth/change-password'; const C5 = '/api/v1/customers';
  const hdr = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  const email = 'fv5-' + Date.now().toString(36) + '@' + DOMAIN;
  const base = () => ['--requester', codes.sysadmin, '--approver', codes.admin];
  let tool: AccountAdmin; let first = ''; let empCode = '';

  beforeAll(() => { tool = new AccountAdmin(adminPrisma); });

  it('FV5-1. preflight: đúng DB thử, chủ sở hữu, bootstrap đã đóng', async () => {
    await expect(tool.preflight()).resolves.toBe(dbName);
  });
  it('FV5-2. add: tạo nhân viên + vai trò sales; đăng nhập bằng mật khẩu tạm => mustChangePassword, API bị chặn; đổi mật khẩu => dùng được', async () => {
    const r = await tool.add(parseArgs(['add', ...base(), '--email', email, '--full-name', 'Nhân viên FV5', '--department', 'KD', '--role', 'sales', '--out', 'khong-dung']));
    expect(r.code).toMatch(/^NV-[0-9]{4,}$/); empCode = r.code; first = r.password;
    const res = await login(email, r.password);
    expect(res.status).toBe(200);
    expect(res.body.data.me).toMatchObject({ code: r.code, roles: ['sales'], mustChangePassword: true });
    const s = { cookie: cookieOf(res), csrf: res.body.data.csrfToken };
    const blocked = await srv().get(C5).set('Cookie', s.cookie);
    expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const NEW = 'Fv5#Doi-MatKhau-2026';
    const ok = await srv().post(CP5).set(hdr(s)).send({ currentPassword: r.password, newPassword: NEW, confirmPassword: NEW });
    expect(ok.status).toBe(200); expect(ok.body.data.me.mustChangePassword).toBe(false);
    expect((await srv().get(C5).set('Cookie', cookieOf(ok))).status).toBe(200);
    const emp = await adminPrisma.employee.findFirstOrThrow({ where: { email }, select: { isDemo: true, status: true, department: { select: { code: true } } } });
    expect(emp).toMatchObject({ isDemo: false, status: 'ACTIVE', department: { code: 'KD' } });
  });
  it('FV5-3. audit đủ bước (2 yêu cầu, 2 lần duyệt, thi hành) và KHÔNG chứa mật khẩu', async () => {
    const e = await adminPrisma.employee.findFirstOrThrow({ where: { email }, select: { id: true } });
    const reqs = await adminPrisma.privilegedChangeRequest.findMany({ where: { subjectEmployeeId: e.id }, select: { id: true, type: true, status: true, requestedById: true, approvedById: true } });
    expect(reqs.map((q) => q.type).sort()).toEqual(['PASSWORD_RESET', 'ROLE_GRANT']);
    expect(reqs.every((q) => q.status === 'EXECUTED' && !!q.approvedById && q.requestedById !== q.approvedById)).toBe(true);
    const ids = [e.id, ...reqs.map((q) => q.id)];
    const logs = await adminPrisma.auditLog.findMany({ where: { entityId: { in: ids } }, select: { action: true, summary: true, changes: true } });
    const acts = logs.map((l) => l.action);
    for (const a of ['EMPLOYEE_CREATE', 'CREDENTIAL_CREATE', 'ROLE_GRANT', 'PASSWORD_RESET_ISSUE', 'PASSWORD_RESET_DONE', 'PASSWORD_MUST_CHANGE_SET']) expect(acts).toContain(a);
    expect(acts.filter((a) => a === 'PRIV_REQUEST_CREATE')).toHaveLength(2);
    expect(acts.filter((a) => a === 'PRIV_REQUEST_APPROVE')).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toContain(first);
  });
  it('FV5-4. reset-password: mật khẩu cũ hết hiệu lực, mật khẩu mới đăng nhập được và lại bị buộc đổi', async () => {
    const r = await tool.resetPassword(parseArgs(['reset-password', ...base(), '--employee', empCode, '--out', 'khong-dung']));
    expect((await login(email, 'Fv5#Doi-MatKhau-2026')).status).toBe(401);
    const res = await login(empCode, r.password);
    expect(res.status).toBe(200); expect(res.body.data.me.mustChangePassword).toBe(true);
  });
  it('FV5-5 (F225-C). disable: phiên bị thu hồi; reset-password KHÔNG mở khoá (ACCOUNT_DISABLED, không đổi gì); chỉ unlock có xác nhận mới mở', async () => {
    const r0 = await tool.resetPassword(parseArgs(['reset-password', ...base(), '--employee', empCode, '--out', 'khong-dung']));
    const live = await login(email, r0.password); expect(live.status).toBe(200);
    await tool.disable(parseArgs(['disable', '--requester', codes.sysadmin, '--employee', empCode, '--reason', 'FV5 thử khoá']));
    expect((await srv().get(ME5).set('Cookie', cookieOf(live))).status).toBe(401);
    expect((await login(email, r0.password)).status).toBe(401);
    const e = await adminPrisma.employee.findFirstOrThrow({ where: { email }, select: { id: true } });
    const snap = async () => (await adminPrisma.$queryRaw<{ status: string; token_version: number; password_hash: string }[]>`SELECT status::text AS status, token_version, password_hash FROM public.employee_credential WHERE employee_id = ${e.id}::uuid`)[0];
    const before = await snap(); expect(before.status).toBe('DISABLED');
    const nReq = await adminPrisma.privilegedChangeRequest.count({ where: { subjectEmployeeId: e.id } });
    await expect(tool.resetPassword(parseArgs(['reset-password', ...base(), '--employee', empCode, '--out', 'khong-dung']))).rejects.toThrow(/ACCOUNT_DISABLED/);
    expect(await snap()).toEqual(before); // vẫn khoá, mật khẩu & token_version không đổi
    expect(await adminPrisma.privilegedChangeRequest.count({ where: { subjectEmployeeId: e.id } })).toBe(nReq); // không để lại yêu cầu dở dang
    expect((await login(email, r0.password)).status).toBe(401);
    const un = ['unlock', ...base(), '--employee', empCode, '--reason', 'FV5 thử mở khoá', '--out', 'khong-dung'];
    await expect(tool.unlock(parseArgs([...un, '--confirm-unlock', email]))).rejects.toThrow(/CONFIRM_UNLOCK/); // phải gõ đúng MÃ nhân viên
    expect(await snap()).toEqual(before);
    const r1 = await tool.unlock(parseArgs([...un, '--confirm-unlock', empCode]));
    const back = await login(email, r1.password);
    expect(back.status).toBe(200); expect(back.body.data.me.mustChangePassword).toBe(true);
    expect((await login(email, r0.password)).status).toBe(401);
    const logs = await adminPrisma.auditLog.findMany({ where: { entityId: e.id, action: 'ACCOUNT_UNLOCK' }, select: { summary: true } });
    expect(logs).toHaveLength(1); expect(logs[0].summary).toContain('FV5 thử mở khoá'); expect(JSON.stringify(logs)).not.toContain(r1.password);
    await expect(tool.unlock(parseArgs([...un, '--confirm-unlock', empCode]))).rejects.toThrow(/NOT_DISABLED/); // đang hoạt động: không có gì để mở
  });
  it('FV5-6. người duyệt KHÔNG có quyền duyệt (sale) => DB từ chối, KHÔNG tạo nhân viên dở dang (một transaction)', async () => {
    const e2 = 'fv5-x-' + Date.now().toString(36) + '@' + DOMAIN;
    await expect(tool.add(parseArgs(['add', '--requester', codes.sysadmin, '--approver', codes.sale, '--email', e2, '--full-name', 'Không được tạo', '--department', 'KD', '--role', 'sales', '--out', 'x'])))
      .rejects.toThrow(/APPROVAL_REQUIRED/);
    expect(await adminPrisma.employee.count({ where: { email: e2 } })).toBe(0);
    // requester không thuộc nhóm REQUEST (crm_admin) => DB từ chối
    await expect(tool.disable(parseArgs(['disable', '--requester', codes.admin, '--employee', empCode, '--reason', 'x']))).rejects.toThrow(/APPROVAL_REQUIRED/);
  });
  it('FV5-7 (M1). cờ buộc đổi mật khẩu chỉ bật đúng tài khoản + đúng lần reset: sai nhân viên / token_version cũ / hash khác => 0 dòng, lỗi, không đổi gì', async () => {
    const r = await tool.resetPassword(parseArgs(['reset-password', ...base(), '--employee', empCode, '--out', 'khong-dung']));
    const emp = await adminPrisma.employee.findFirstOrThrow({ where: { code: empCode }, select: { id: true } });
    const other = await adminPrisma.employee.findFirstOrThrow({ where: { email: USERS[2].email }, select: { id: true } }); // sale (không bị đụng)
    const snap = async (id: string) => adminPrisma.employeeCredential.findUniqueOrThrow({ where: { employeeId: id }, select: { mustChangePassword: true, tokenVersion: true, passwordHash: true } });
    const me = await snap(emp.id); const them = await snap(other.id);
    expect(me.mustChangePassword).toBe(true);
    const run = (id: string, tv: number, hash: string) => adminPrisma.$transaction((tx) => markMustChange(tx, id, { tokenVersion: tv, passwordHash: hash }));
    // Tắt cờ của chính tài khoản để chứng minh các điều kiện sai KHÔNG bật lại được (không đổi token_version/hash).
    await adminPrisma.employeeCredential.update({ where: { employeeId: emp.id }, data: { mustChangePassword: false } });
    await expect(run(other.id, me.tokenVersion, me.passwordHash)).rejects.toThrow('MUST_CHANGE_FAILED'); // sai tài khoản
    await expect(run(emp.id, me.tokenVersion - 1, me.passwordHash)).rejects.toThrow('MUST_CHANGE_FAILED'); // lần reset cũ
    await expect(run(emp.id, me.tokenVersion, them.passwordHash)).rejects.toThrow('MUST_CHANGE_FAILED'); // hash không phải lần reset này
    expect((await snap(emp.id)).mustChangePassword).toBe(false);
    expect(await snap(other.id)).toEqual(them);
    await run(emp.id, me.tokenVersion, me.passwordHash); // đúng => bật
    expect((await snap(emp.id)).mustChangePassword).toBe(true);
    await expect(run(emp.id, me.tokenVersion, me.passwordHash)).rejects.toThrow('MUST_CHANGE_FAILED'); // đã bật => không chạy lại
    expect((await login(email, r.password)).body.data.me.mustChangePassword).toBe(true);
  });
  it('FV5-8. CLI không cấp crm_admin (tạm cấm, Owner 08/11/2026)', () => {
    expect(() => parseArgs(['add', ...base(), '--email', 'x@' + DOMAIN, '--full-name', 'X', '--department', 'KD', '--role', 'crm_admin', '--out', 'x'])).toThrow('INPUT');
  });
});

// Sales S5 (docs/SALES_DESIGN.md §5.2, §5.4; TC 9a(vii)) — trên DB thử thật đã bootstrap bằng ma trận BIZ mới:
//  (1) 10 mã opportunity.* / 17 dòng đúng vai trò, thuộc nhóm BIZ ở DB (SoD: vai trò admin kỹ thuật không giữ mã nào);
//  (2) cổng AssigneeEligibility chạy trên POOL AUTH thật: tài khoản dùng được => true, bị khoá => false, mở khoá => true lại, id lạ => false;
//  (3) cùng cổng đó dựng trên pool NGHIỆP VỤ (đã tách role) => truy vấn bị DB từ chối => fail-closed (false) — app không đọc được credential.
describe('Sales S5 — mã quyền opportunity.* và cổng AssigneeEligibility trên DB thật', () => {
  const email = 's5-' + Date.now().toString(36) + '@' + DOMAIN;
  const base = () => ['--requester', codes.sysadmin, '--approver', codes.admin];
  let tool: AccountAdmin; let port: AssigneeEligibility; let empId = ''; let empCode = '';

  beforeAll(async () => {
    tool = new AccountAdmin(adminPrisma);
    port = app.get<AssigneeEligibility>(ASSIGNEE_ELIGIBILITY, { strict: false }); // đúng provider của AuthModule (pool auth đã ghi đè bằng authPrisma)
    const r = await tool.add(parseArgs(['add', ...base(), '--email', email, '--full-name', 'Nhân viên S5', '--department', 'KD', '--role', 'sales', '--out', 'khong-dung']));
    empCode = r.code;
    empId = (await adminPrisma.employee.findFirstOrThrow({ where: { email }, select: { id: true } })).id;
  });

  it('S5-1. bootstrap cấp đúng 17 dòng của 10 mã: crm_admin 9, sales 6, technician 1, accountant 1; admin (quản trị hệ thống) 0; không có opportunity.export', async () => {
    const rows = await adminPrisma.$queryRaw<{ role: string; n: bigint }[]>`
      SELECT r.code AS role, count(p.id) AS n FROM public.role r
      LEFT JOIN public.role_permission rp ON rp.role_id = r.id
      LEFT JOIN public.permission p ON p.id = rp.permission_id AND p.code LIKE 'opportunity.%'
      WHERE r.code IN ('admin', 'crm_admin', 'sales', 'technician', 'accountant') GROUP BY r.code`;
    expect(Object.fromEntries(rows.map((x) => [x.role, Number(x.n)]))).toEqual({ admin: 0, crm_admin: 9, sales: 6, technician: 1, accountant: 1 });
    const codesInDb = await adminPrisma.permission.findMany({ where: { code: { startsWith: 'opportunity.' } }, select: { code: true } });
    expect(codesInDb).toHaveLength(10);
    expect(codesInDb.map((c) => c.code)).not.toContain('opportunity.export');
  });
  it('S5-2. DB xếp opportunity.* vào nhóm BIZ (migration 20261118000000) => SoD áp cho vai trò admin; các nhóm cũ không đổi', async () => {
    const r = await adminPrisma.$queryRaw<{ a: string; b: string; c: string; d: string; e: string }[]>`
      SELECT public.fn_auth_perm_class('opportunity.read') AS a, public.fn_auth_perm_class('opportunity.read_assigned') AS b,
             public.fn_auth_perm_class('customer.read') AS c, public.fn_auth_perm_class('access.approve') AS d, public.fn_auth_perm_class('lookup.read') AS e`;
    expect(r[0]).toEqual({ a: 'BIZ', b: 'BIZ', c: 'BIZ', d: 'APPROVE', e: 'OTHER' });
  });
  it('S5-3. vai trò thật của 5 tài khoản bootstrap: đúng tập mã opportunity.* theo §5.2; Quản trị hệ thống không có mã nào', async () => {
    const perms = async (key: string) => {
      const u = USERS.find((x) => x.key === key)!;
      const rows = await adminPrisma.$queryRaw<{ code: string }[]>`
        SELECT DISTINCT p.code::text AS code FROM public.employee e JOIN public.employee_role er ON er.employee_id = e.id
        JOIN public.role_permission rp ON rp.role_id = er.role_id JOIN public.permission p ON p.id = rp.permission_id
        WHERE lower(e.email) = lower(${u.email}) AND p.code LIKE 'opportunity.%'`;
      return rows.map((x) => x.code.replace('opportunity.', '')).sort();
    };
    expect(await perms('sysadmin')).toEqual([]);
    expect(await perms('sale')).toEqual(['assign', 'close', 'create', 'move_stage', 'read', 'update']);
    expect(await perms('technician')).toEqual(['read_assigned']);
    expect(await perms('accountant')).toEqual(['read']);
    expect(await perms('admin')).toEqual(['assign', 'close', 'create', 'delete', 'move_stage', 'read', 'reopen', 'restore', 'update']);
  });
  it('S5-4. cổng trên pool auth thật: tài khoản dùng được => true; id không tồn tại => false; id không phải uuid => false cho cả lô (fail-closed)', async () => {
    const ghost = randomUUID();
    const r = await port.canSignIn([empId, ghost]);
    expect([...r.entries()]).toEqual([[empId, true], [ghost, false]]);
    const bad = await port.canSignIn([empId, 'khong-phai-uuid']);
    expect([...bad.entries()]).toEqual([[empId, false], ['khong-phai-uuid', false]]);
  });
  it('S5-5. nhân viên ACTIVE nhưng tài khoản bị khoá => false; mở khoá => true lại; employee.status không đổi (TC 9a(vii))', async () => {
    await tool.disable(parseArgs(['disable', '--requester', codes.sysadmin, '--employee', empCode, '--reason', 'S5 thử khoá']));
    const emp = await adminPrisma.employee.findUniqueOrThrow({ where: { id: empId }, select: { status: true, deletedAt: true } });
    expect(emp).toEqual({ status: 'ACTIVE', deletedAt: null }); // pool nghiệp vụ (helper B3) vẫn thấy "active" — vì vậy mới cần cổng auth
    expect((await port.canSignIn([empId])).get(empId)).toBe(false);
    await tool.unlock(parseArgs(['unlock', ...base(), '--employee', empCode, '--reason', 'S5 thử mở khoá', '--out', 'khong-dung', '--confirm-unlock', empCode]));
    expect((await port.canSignIn([empId])).get(empId)).toBe(true);
  });
  it('S5-6. cổng dựng trên pool NGHIỆP VỤ (siscom_app, đã tách role) không đọc được credential => fail-closed false; chưa tách role thì bỏ qua có lý do', async () => {
    if (!authPrisma.separate) { console.warn('S5-6 bỏ qua: DB thử chưa tách pool auth (không có TEST_AUTH_DATABASE_URL).'); return; }
    const viaApp = new AuthPoolAssigneeEligibility(prisma as unknown as AuthPrismaService);
    expect((await viaApp.canSignIn([empId])).get(empId)).toBe(false);
    expect((await port.canSignIn([empId])).get(empId)).toBe(true); // cùng thời điểm, pool auth vẫn trả true
  });
});

// P1 (docs/P1_ACCOUNT_ADMIN_DESIGN.md) — quản lý tài khoản qua API thật: phiên thật của Quản trị CRM, pool siscom_acct thật (TEST_ACCT_DATABASE_URL),
// hàm đặc quyền thật. Mỗi thao tác là MỘT lần bấm: máy chủ tạo yêu cầu dưới tên tài khoản hệ thống, người bấm duyệt, thực thi, ghi nhật ký người bấm.
// Không có TEST_ACCT_DATABASE_URL (máy chưa tách role): chỉ kiểm nhánh "chưa bật" (503), các ca còn lại bỏ qua.
describe('P1 — quản lý tài khoản (/accounts, pool siscom_acct)', () => {
  const A = '/api/v1/accounts';
  const hdr = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, Origin: ORIGIN, 'X-CSRF-Token': s.csrf });
  const TEMP = 'Tam#MatKhau-2026x';
  const TEMP2 = 'Tam#MatKhau-2026y';
  const mail = (k: string) => 'p1.' + k + '@' + DOMAIN;
  type S = { cookie: string; csrf: string };
  let admin: S; let adminId = ''; let sysId = '';
  const on = () => acctPrisma.available;
  const post = (path: string, body: object, s: S = admin) => srv().post(A + path).set(hdr(s)).send(body);
  const patch = (path: string, body: object, s: S = admin) => srv().patch(A + path).set(hdr(s)).send(body);
  const get = (path: string, s: S = admin) => srv().get(A + path).set('Cookie', s.cookie);
  const counts = async () => ({
    employee: await adminPrisma.employee.count(), credential: await adminPrisma.employeeCredential.count(), role: await adminPrisma.employeeRole.count(),
    pcr: await adminPrisma.privilegedChangeRequest.count(), openPcr: await adminPrisma.privilegedChangeRequest.count({ where: { status: { in: ['PENDING', 'APPROVED'] } } }),
  });
  const create = async (k: string, role = 'sales', extra: object = {}) => {
    const res = await post('', { fullName: 'P1 ' + k, email: mail(k), role, tempPassword: TEMP, ...extra });
    expect({ k, s: res.status, c: res.body?.error?.code }).toEqual({ k, s: 201, c: undefined });
    return res.body.data as { id: string; code: string; updatedAt: string; roles: string[]; login: string };
  };
  const signIn = async (email: string, password: string): Promise<S & { me: Record<string, unknown>; status: number }> => {
    const res = await login(email, password);
    return res.status === 200 ? { cookie: cookieOf(res), csrf: res.body.data.csrfToken, me: res.body.data.me, status: 200 } : { cookie: '', csrf: '', me: {}, status: res.status };
  };

  beforeAll(async () => {
    const a = await session('admin'); admin = a; adminId = String(a.me.employeeId);
    sysId = (await adminPrisma.employee.findFirstOrThrow({ where: { code: codes.sysadmin }, select: { id: true } })).id;
  });

  it('P1-0. /auth/me trả access.approve cho Quản trị CRM; vai trò khác không có', async () => {
    expect(((await session('admin')).me.permissions as Record<string, string>)['access.approve']).toBe('ALL');
    for (const k of ['sale', 'technician', 'accountant', 'sysadmin']) expect(((await session(k)).me.permissions as Record<string, string>)['access.approve']).toBeUndefined();
  });

  it('P1-1. quyền: 4 vai trò còn lại nhận 403 ở mọi API; chưa đăng nhập 401', async () => {
    for (const k of ['sale', 'technician', 'accountant', 'sysadmin']) {
      const s = await session(k);
      expect({ k, s: (await get('', s)).status }).toEqual({ k, s: 403 });
      expect({ k, s: (await get('/roles', s)).status }).toEqual({ k, s: 403 });
      expect({ k, s: (await post('', { fullName: 'X', email: mail('x-' + k), role: 'sales', tempPassword: TEMP }, s)).status }).toEqual({ k, s: 403 });
      expect({ k, s: (await post('/' + adminId + '/disable', { reason: 'thu' }, s)).status }).toEqual({ k, s: 403 });
    }
    expect((await srv().get(A)).status).toBe(401);
  });

  it('P1-2. chưa bật (không có ACCT_DATABASE_URL): API tài khoản 503 ACCOUNT_ADMIN_UNAVAILABLE với mã + câu riêng', async () => {
    if (on()) return; // CI có pool acct: nhánh này kiểm ở unit (accounts.read.service.spec) + bộ lọc lỗi
    const res = await get('');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ACCOUNT_ADMIN_UNAVAILABLE');
  });

  it('P1-3. pool siscom_acct đạt kiểm role lúc khởi động (đúng 12 hàm, không ghi bảng); pool app không đổi kết quả', async () => {
    if (!on()) return;
    const f = await fetchDbRoleFacts(acctPrisma.client());
    expect(f).toMatchObject({ user: 'siscom_acct', acctHasCore: true, acctSecdefExtra: false, canWriteAnyTable: false, hasAuthGrants: false });
    expect(assessDbRole(f, 'production', { pool: 'acct', authSeparate: true })).toEqual({ leastPrivilege: true, problems: [], enforce: true });
    const app2 = await fetchDbRoleFacts(prisma);
    expect(app2).toMatchObject({ acctHasCore: false, canWriteAnyTable: true });
    expect(assessDbRole(app2, 'production', { pool: 'app', authSeparate: true }).leastPrivilege).toBe(true);
  });

  it('P1-4. danh sách: 5 tài khoản khởi tạo, tài khoản hệ thống được đánh dấu, chính mình được đánh dấu; vai trò + phòng ban cho ô chọn', async () => {
    if (!on()) return;
    const res = await get('?pageSize=100');
    expect(res.status).toBe(200);
    const items = res.body.data.items as { code: string; isSystem: boolean; isSelf: boolean; roles: string[]; login: string }[];
    expect(items.find((x) => x.code === codes.sysadmin)).toMatchObject({ isSystem: true, isSelf: false, roles: ['admin'] });
    expect(items.find((x) => x.code === codes.admin)).toMatchObject({ isSystem: false, isSelf: true, roles: ['crm_admin'], login: 'ACTIVE' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|\$argon2/);
    const roles = (await get('/roles')).body.data as { code: string; grantable: boolean }[];
    expect(roles.map((r) => r.code + ':' + r.grantable)).toEqual(['admin:false', 'crm_admin:true', 'sales:true', 'technician:true', 'accountant:true']);
    expect(((await get('/departments')).body.data as unknown[]).length).toBeGreaterThan(0);
    expect((await get('?q=a')).status).toBe(400);
    expect((await get('?role=director')).status).toBe(400);
  });

  let emp: { id: string; code: string; updatedAt: string };
  it('P1-5. thêm nhân viên (sales): 201, chờ đổi mật khẩu; đăng nhập bằng mật khẩu tạm => buộc đổi; nhật ký mang tên người bấm; không còn yêu cầu treo', async () => {
    if (!on()) return;
    const before = await counts();
    emp = await create('moi');
    expect(emp).toMatchObject({ roles: ['sales'], login: 'MUST_CHANGE' });
    expect(emp.code).toMatch(/^NV-[0-9]{4,}$/);
    const after = await counts();
    expect({ employee: after.employee - before.employee, credential: after.credential - before.credential, role: after.role - before.role, openPcr: after.openPcr })
      .toEqual({ employee: 1, credential: 1, role: 1, openPcr: before.openPcr });
    const u = await signIn(mail('moi'), TEMP);
    expect(u.status).toBe(200);
    expect(u.me).toMatchObject({ code: emp.code, roles: ['sales'], mustChangePassword: true });
    const audit = await adminPrisma.auditLog.findMany({ where: { entityId: emp.id }, select: { action: true, actorId: true, summary: true, changes: true } });
    expect(audit.find((x) => x.action === 'ACCOUNT_CREATE')).toMatchObject({ actorId: adminId });
    expect(audit.find((x) => x.action === 'EMPLOYEE_CREATE')).toMatchObject({ actorId: adminId });
    expect(audit.find((x) => x.action === 'ROLE_GRANT')).toMatchObject({ actorId: sysId });
    expect(JSON.stringify(audit)).not.toContain(TEMP);
    const pcr = await adminPrisma.privilegedChangeRequest.findMany({ where: { subjectEmployeeId: emp.id }, select: { type: true, status: true, requestedById: true, approvedById: true } });
    expect(pcr.map((x) => x.type + ':' + x.status).sort()).toEqual(['PASSWORD_RESET:EXECUTED', 'ROLE_GRANT:EXECUTED']);
    expect(pcr.every((x) => x.requestedById === sysId && x.approvedById === adminId)).toBe(true);
  });

  it('P1-6. thêm lỗi KHÔNG để lại gì: email trùng (khác hoa thường + khoảng trắng) 409; mật khẩu tạm yếu / trùng email / toàn khoảng trắng 400; vai trò admin 400', async () => {
    if (!on()) return;
    const before = await counts();
    const bad: [object, number, string][] = [
      [{ fullName: 'P1 trùng', email: '  ' + mail('moi').toUpperCase() + ' ', role: 'sales', tempPassword: TEMP }, 409, 'EMAIL_TAKEN'],
      [{ fullName: 'P1 y', email: mail('y1'), role: 'sales', tempPassword: 'Ngan#12345a' }, 400, 'VALIDATION_FAILED'],
      [{ fullName: 'P1 y', email: 'matkhauchuaemail@' + DOMAIN, role: 'sales', tempPassword: 'Matkhauchuaemail#1' }, 400, 'VALIDATION_FAILED'],
      [{ fullName: 'P1 y', email: mail('y3'), role: 'sales', tempPassword: '               ' }, 400, 'VALIDATION_FAILED'],
      [{ fullName: 'P1 y', email: mail('y4'), role: 'admin', tempPassword: TEMP }, 400, 'VALIDATION_FAILED'],
      [{ fullName: '   ', email: mail('y5'), role: 'sales', tempPassword: TEMP }, 400, 'VALIDATION_FAILED'],
      [{ fullName: 'P1 y', email: 'khong-phai-email', role: 'sales', tempPassword: TEMP }, 400, 'VALIDATION_FAILED'],
      [{ fullName: 'P1 y', email: mail('y7'), role: 'sales', tempPassword: TEMP, departmentId: randomUUID() }, 400, 'VALIDATION_FAILED'],
      [{ fullName: 'P1 y', email: mail('y8'), role: 'sales', tempPassword: TEMP, isDemo: true }, 400, 'VALIDATION_FAILED'],
    ];
    for (const [body, status, code] of bad) {
      const res = await post('', body);
      expect({ body: JSON.stringify(body).slice(0, 60), s: res.status, c: res.body?.error?.code }).toEqual({ body: JSON.stringify(body).slice(0, 60), s: status, c: code });
      expect(JSON.stringify(res.body)).not.toMatch(/Tam#MatKhau|Matkhauchuaemail#1|Ngan#12345a/);
    }
    expect(await counts()).toEqual(before);
  });

  it('P1-7. sửa thông tin: đúng updatedAt => lưu, mã giữ nguyên; updatedAt cũ => 409 VERSION_CONFLICT, không ghi đè; tự sửa mình được; tài khoản hệ thống 403', async () => {
    if (!on()) return;
    const ok = await patch('/' + emp.id, { updatedAt: emp.updatedAt, fullName: '  P1 Tên mới ', email: mail('moi2'), positionTitle: 'Nhân viên kinh doanh' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ id: emp.id, code: emp.code, fullName: 'P1 Tên mới', email: mail('moi2'), positionTitle: 'Nhân viên kinh doanh' });
    expect(new Date(ok.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(emp.updatedAt).getTime());
    const stale = await patch('/' + emp.id, { updatedAt: emp.updatedAt, fullName: 'P1 Ghi đè', email: mail('moi2') });
    expect({ s: stale.status, c: stale.body.error.code }).toEqual({ s: 409, c: 'VERSION_CONFLICT' });
    expect((await adminPrisma.employee.findUniqueOrThrow({ where: { id: emp.id }, select: { fullName: true } })).fullName).toBe('P1 Tên mới');
    emp.updatedAt = ok.body.data.updatedAt;
    expect((await signIn(mail('moi2'), TEMP)).status).toBe(200); // đổi email => đăng nhập bằng email mới
    const dup = await patch('/' + emp.id, { updatedAt: emp.updatedAt, fullName: 'P1 Tên mới', email: USERS[2].email.toUpperCase() });
    expect({ s: dup.status, c: dup.body.error.code }).toEqual({ s: 409, c: 'EMAIL_TAKEN' });
    // Tự sửa họ tên của chính mình rồi trả lại như cũ (các bộ test khác dùng tài khoản này).
    const me0 = await adminPrisma.employee.findUniqueOrThrow({ where: { id: adminId }, select: { fullName: true, email: true, updatedAt: true, departmentId: true, positionTitle: true } });
    const self = await patch('/' + adminId, { updatedAt: me0.updatedAt.toISOString(), fullName: 'CRM Admin P1', email: me0.email, departmentId: me0.departmentId });
    expect(self.status).toBe(200);
    const back = await patch('/' + adminId, { updatedAt: self.body.data.updatedAt, fullName: me0.fullName, email: me0.email, departmentId: me0.departmentId });
    expect(back.status).toBe(200);
    const sys0 = await adminPrisma.employee.findUniqueOrThrow({ where: { id: sysId }, select: { fullName: true, email: true, updatedAt: true } });
    const sys = await patch('/' + sysId, { updatedAt: sys0.updatedAt.toISOString(), fullName: 'Đổi tên hệ thống', email: sys0.email });
    expect({ s: sys.status, c: sys.body.error.code }).toEqual({ s: 403, c: 'SYSTEM_ACCOUNT' });
    expect((await patch('/' + randomUUID(), { updatedAt: new Date().toISOString(), fullName: 'X', email: mail('x404') })).status).toBe(404);
  });

  it('P1-8. đổi vai trò: sales -> accountant; -> crm_admin; crm_admin -> sales (gỡ vai trò trọng yếu qua yêu cầu riêng); tự đổi mình / tài khoản hệ thống / nhiều vai trò bị chặn', async () => {
    if (!on()) return;
    const r1 = await post('/' + emp.id + '/role', { role: 'accountant' });
    expect(r1.status).toBe(200); expect(r1.body.data.roles).toEqual(['accountant']);
    const same = await post('/' + emp.id + '/role', { role: 'accountant' });
    expect(same.status).toBe(400);
    const r2 = await post('/' + emp.id + '/role', { role: 'crm_admin' });
    expect(r2.status).toBe(200); expect(r2.body.data.roles).toEqual(['crm_admin']);
    const r3 = await post('/' + emp.id + '/role', { role: 'sales' });
    expect({ s: r3.status, c: r3.body?.error?.code }).toEqual({ s: 200, c: undefined });
    expect(r3.body.data.roles).toEqual(['sales']);
    const pcr = await adminPrisma.privilegedChangeRequest.findMany({ where: { subjectEmployeeId: emp.id, type: 'ROLE_REVOKE_CRITICAL' }, select: { status: true, requestedById: true, approvedById: true } });
    expect(pcr).toEqual([{ status: 'EXECUTED', requestedById: sysId, approvedById: adminId }]);
    expect((await counts()).openPcr).toBe(0);
    const self = await post('/' + adminId + '/role', { role: 'sales' });
    expect({ s: self.status, c: self.body.error.code }).toEqual({ s: 403, c: 'SELF_MODIFICATION' });
    const sys = await post('/' + sysId + '/role', { role: 'sales' });
    expect({ s: sys.status, c: sys.body.error.code }).toEqual({ s: 403, c: 'SYSTEM_ACCOUNT' });
    expect((await post('/' + emp.id + '/role', { role: 'admin' })).status).toBe(400);
    // Nhân viên có 2 vai trò (gán bằng chủ sở hữu qua đúng luồng hai người) => giao diện không đổi được, báo rõ.
    const multi = await create('haivaitro', 'sales');
    const tool = new AccountAdmin(adminPrisma);
    const roleId = (await adminPrisma.role.findFirstOrThrow({ where: { code: 'accountant' }, select: { id: true } })).id;
    await adminPrisma.$transaction(async (tx) => {
      const q = await tx.$queryRaw<{ id: string }[]>`SELECT public.fn_auth_api_request_create(${sysId}::uuid, 'ROLE_GRANT'::public.privileged_change_type, ${multi.id}::uuid, ${roleId}::uuid, '{"t":"p1-multi"}'::jsonb, 5) AS id`;
      await tx.$queryRaw`SELECT public.fn_auth_api_request_decide(${adminId}::uuid, ${q[0].id}::uuid, true)::text`;
      await tx.$executeRaw`SELECT public.fn_auth_api_role_grant(${sysId}::uuid, ${q[0].id}::uuid)`;
    });
    expect(tool).toBeDefined();
    const m = await post('/' + multi.id + '/role', { role: 'technician' });
    expect({ s: m.status, c: m.body.error.code }).toEqual({ s: 409, c: 'MULTI_ROLE_UNSUPPORTED' });
    expect((await counts()).openPcr).toBe(0);
  });

  it('P1-9. cấp lại mật khẩu: phiên cũ chết, mật khẩu cũ không dùng được, mật khẩu tạm mới buộc đổi; tự cấp cho mình / tài khoản hệ thống bị chặn', async () => {
    if (!on()) return;
    const old = await signIn(mail('moi2'), TEMP);
    expect(old.status).toBe(200);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', old.cookie)).status).toBe(200);
    const res = await post('/' + emp.id + '/reset-password', { tempPassword: TEMP2 });
    expect({ s: res.status, c: res.body?.error?.code }).toEqual({ s: 200, c: undefined });
    expect(res.body.data.login).toBe('MUST_CHANGE');
    expect(JSON.stringify(res.body)).not.toContain(TEMP2);
    expect((await srv().get('/api/v1/auth/me').set('Cookie', old.cookie)).status).toBe(401);
    expect((await signIn(mail('moi2'), TEMP)).status).toBe(401);
    const neu = await signIn(mail('moi2'), TEMP2);
    expect(neu.status).toBe(200); expect(neu.me).toMatchObject({ mustChangePassword: true });
    const weak = await post('/' + emp.id + '/reset-password', { tempPassword: 'P1-Moi2-' + emp.code + '-x' });
    expect(weak.status).toBe(400); // chứa mã nhân viên
    const self = await post('/' + adminId + '/reset-password', { tempPassword: TEMP2 });
    expect({ s: self.status, c: self.body.error.code }).toEqual({ s: 403, c: 'SELF_MODIFICATION' });
    const sys = await post('/' + sysId + '/reset-password', { tempPassword: TEMP2 });
    expect({ s: sys.status, c: sys.body.error.code }).toEqual({ s: 403, c: 'SYSTEM_ACCOUNT' });
    const audit = await adminPrisma.auditLog.findMany({ where: { entityId: emp.id }, select: { action: true, actorId: true, summary: true, changes: true } });
    expect(audit.find((x) => x.action === 'ACCOUNT_PASSWORD_RESET')).toMatchObject({ actorId: adminId });
    expect(JSON.stringify(audit)).not.toMatch(/Tam#MatKhau/);
    expect((await counts()).openPcr).toBe(0);
  });

  it('P1-10. khoá: bị đăng xuất ngay, không đăng nhập được, bản ghi nhân viên giữ nguyên; mở lại: mật khẩu tạm mới, buộc đổi; sai trạng thái 409; tự khoá / tài khoản hệ thống bị chặn', async () => {
    if (!on()) return;
    const live = await signIn(mail('moi2'), TEMP2);
    expect(live.status).toBe(200);
    const off = await post('/' + emp.id + '/disable', { reason: 'Nghỉ việc (thử P1)' });
    expect({ s: off.status, c: off.body?.error?.code }).toEqual({ s: 200, c: undefined });
    expect(off.body.data.login).toBe('DISABLED');
    expect((await srv().get('/api/v1/auth/me').set('Cookie', live.cookie)).status).toBe(401);
    expect((await signIn(mail('moi2'), TEMP2)).status).toBe(401);
    expect(await adminPrisma.employee.findUniqueOrThrow({ where: { id: emp.id }, select: { status: true, deletedAt: true } })).toEqual({ status: 'ACTIVE', deletedAt: null });
    expect((await post('/' + emp.id + '/disable', { reason: 'lần hai' })).status).toBe(409);
    expect((await post('/' + emp.id + '/reset-password', { tempPassword: TEMP })).status).toBe(409);
    expect((await post('/' + emp.id + '/disable', { reason: '' })).status).toBe(400);
    const onAgain = await post('/' + emp.id + '/enable', { tempPassword: TEMP });
    expect({ s: onAgain.status, c: onAgain.body?.error?.code }).toEqual({ s: 200, c: undefined });
    expect(onAgain.body.data.login).toBe('MUST_CHANGE');
    const back = await signIn(mail('moi2'), TEMP);
    expect(back.status).toBe(200); expect(back.me).toMatchObject({ mustChangePassword: true });
    expect((await post('/' + emp.id + '/enable', { tempPassword: TEMP2 })).status).toBe(409);
    const self = await post('/' + adminId + '/disable', { reason: 'tự khoá' });
    expect({ s: self.status, c: self.body.error.code }).toEqual({ s: 403, c: 'SELF_MODIFICATION' });
    const sys = await post('/' + sysId + '/disable', { reason: 'khoá hệ thống' });
    expect({ s: sys.status, c: sys.body.error.code }).toEqual({ s: 403, c: 'SYSTEM_ACCOUNT' });
    expect((await session('admin')).me).toMatchObject({ code: codes.admin }); // người bấm và tài khoản hệ thống vẫn nguyên
    expect((await session('sysadmin')).me).toMatchObject({ code: codes.sysadmin });
    const audit = await adminPrisma.auditLog.findMany({ where: { entityId: emp.id, action: { in: ['ACCOUNT_DISABLE', 'ACCOUNT_ENABLE'] } }, select: { action: true, actorId: true } });
    expect(audit.map((x) => x.action + ':' + (x.actorId === adminId)).sort()).toEqual(['ACCOUNT_DISABLE:true', 'ACCOUNT_ENABLE:true']);
    expect((await counts()).openPcr).toBe(0);
  });

  it('P1-11. người duyệt cuối cùng: lỗi LAST_APPROVER của database ra đúng 409 LAST_APPROVER (không phải 409 chung)', async () => {
    if (!on()) return;
    // Đường này không tới được qua HTTP (tự khoá bị chặn trước); gọi thẳng hàm bằng pool acct để ghim phần ánh xạ lỗi.
    const approvers = await adminPrisma.employeeRole.count({ where: { role: { code: 'crm_admin' }, employee: { status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE' } } } });
    expect(approvers).toBe(1);
    let err: unknown;
    try { await inAcctTx(acctPrisma, async (tx) => { await tx.$queryRaw`SELECT public.fn_auth_api_credential_disable(${sysId}::uuid, ${adminId}::uuid, 'thu P1')`; }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DomainException);
    expect({ s: (err as DomainException).getStatus(), c: (err as DomainException).code }).toEqual({ s: 409, c: 'LAST_APPROVER' });
    expect((await session('admin')).me).toMatchObject({ code: codes.admin });
  });
});
