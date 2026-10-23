import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Controller, Get, HttpCode, INestApplication, Post, Body, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../../filters/all-exceptions.filter';
import { AccessGuard } from '../access.guard';
import { ACTOR_PROVIDER, Actor } from '../actor';
import { DenyAllActorProvider } from '../deny-all-actor.provider';
import { Public, RequirePermissions } from '../permissions.decorator';
import { LoginAbusePolicy, ThrottledPasswordLogin } from '../login/login-abuse.policy';
import { LoginSessionService } from '../login/login-session.service';
import { parseLoginIdentifier } from '../login/login-identifier';
import { PasswordLoginService } from '../login/password-login.service';
import { CredentialStore, PasswordHasher, StoredCredential } from '../login/password-login.types';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { buildRefreshCookie, REFRESH_COOKIE_PATH } from '../session/refresh-cookie.policy';
import { checkCsrfToken, checkOrigin } from '../session/csrf-origin.policy';
import { SessionService, Sha256TokenHasher } from '../session/session.service';
import { AuthHttpHandler } from './auth-http.handler';

// Hợp đồng HTTP backend (A4, PR #31 + #36/#38/#39 + PA6) <-> kỳ vọng của frontend (authClient.js / loginSession.js / loginIdentifier.js,
// frontend PR #67/#73/#81, head 5cdeec4). CHỈ TEST + provider giả trong bộ nhớ: không DB, không Prisma, không AppModule,
// KHÔNG đăng ký AuthController thật. Controller bên dưới tồn tại duy nhất trong file test này.
//
// Quy ước tên:  "KHỚP" = hai bên đã đồng ý, test khóa lại.
//               "LỆCH-n" = khác biệt đã xác minh; test khóa HÀNH VI HIỆN TẠI của backend và nêu quyết định chủ sở hữu cần đưa ra
//                          (OWNER_DECISIONS cuối file). Khi chủ sở hữu quyết, đổi test tương ứng trong PR triển khai.

const E7 = '00000000-0000-4000-8000-000000000007';
const PW = 'Mat-khau-thu-nghiem-1';
const TTL = 60_000;
const NOW = Date.UTC(2026, 9, 23, 0, 0, 0);
const clock = { now: () => new Date(NOW) };
const hasher: PasswordHasher = { verify: async (h, p) => h !== null && h === 'H:' + p };
const cred = (employeeId: string): StoredCredential => ({ employeeId, hash: 'H:' + PW, algo: 'argon2id', active: true });
const knownCreds: CredentialStore = {
  async findByIdentifier(id) {
    if (id.kind === 'EMPLOYEE_CODE' && id.value === 'NV-0007') return cred(E7);
    if (id.kind === 'EMAIL' && id.value.toLowerCase() === 'nv7@siscom.vn') return cred(E7);
    return null;
  },
};

// ---- Dạng yêu cầu mà frontend authClient.js THỰC SỰ gửi (đọc từ mã nguồn frontend, không suy đoán) ----
// fetch(baseUrl + path, { method, credentials:'omit', headers:{ Accept, [Content-Type nếu có body], [Authorization nếu có token] }, body: JSON })
const FE_BASE = '/api/v1'; // frontend nối VITE_CRM_API_BASE + '/auth/...'; backend có tiền tố toàn cục api/v1 => base PHẢI kết thúc bằng /api/v1
const FE_PATHS = { login: '/auth/login', logout: '/auth/logout', me: '/auth/me' } as const;
const FE_HEADERS_ANON = { Accept: 'application/json', 'Content-Type': 'application/json' };
const feBearer = (t: string) => ({ Accept: 'application/json', Authorization: 'Bearer ' + t });
// Bảng phân loại lỗi của frontend (classifyAuthError): [status, code] -> lớp lỗi hiển thị. Mã khác 'LOGIN_INVALID' ở 401 => SESSION_EXPIRED.
const feClassify = (status: number, code: string, onLogin: boolean): string => {
  if ([404, 405, 501].includes(status)) return 'ENDPOINT_UNAVAILABLE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401) return code === 'LOGIN_INVALID' ? 'INVALID_CREDENTIALS' : onLogin ? 'SESSION_EXPIRED(login!)' : 'SESSION_EXPIRED';
  if (status === 400) return 'REQUEST_INVALID';
  if (status >= 500) return 'SERVICE_UNAVAILABLE';
  return 'UNKNOWN';
};
// Kết quả parseLoginIdentifier của frontend (loginIdentifier.js) — SINH BẰNG CÁCH CHẠY mã frontend thật tại head 5cdeec4 ngày 2026-10-23.
const FE_IDENTIFIER_KINDS: ReadonlyArray<readonly [string, string]> = [
  ['NV-0007', 'EMPLOYEE_CODE'], ['NV-007', 'INVALID'], ['nv-0007', 'INVALID'], [' NV-0007 ', 'EMPLOYEE_CODE'], ['NV-12345', 'EMPLOYEE_CODE'],
  ['a@b.vn', 'EMAIL'], ['A@B.VN', 'EMAIL'], ['@b.vn', 'INVALID'], ['a@', 'INVALID'], ['a@@b', 'INVALID'], ['a b@c.vn', 'INVALID'],
  ['a​@c.vn', 'INVALID'], ['＠x', 'INVALID'], ['x＠y.vn', 'INVALID'], ['a@b@c', 'INVALID'], ['', 'INVALID'], ['   ', 'INVALID'],
  ['NV-0007\n', 'EMPLOYEE_CODE'], ['é@c.vn', 'EMAIL'], ['é@c.vn', 'EMAIL'], ['NV-٠٠٠٠', 'INVALID'],
];

// ---- Controller CHỈ trong test (đường dẫn như frontend giả định) ----
// source cho limiter: backend handler KHÔNG nhận nguồn (xem LỆCH-3) nên controller test phải tự cấp qua trường cục bộ.
let throttleSource: string | undefined;
class SourcedLogin extends PasswordLoginService {
  constructor(creds: CredentialStore, private readonly t: ThrottledPasswordLogin) { super(creds, hasher); }
  override verify(input: { login: unknown; password: unknown }) { return this.t.verify({ source: throttleSource, ...input }); }
}
const HANDLER = 'AUTH_HANDLER';
@Controller('auth')
class TestAuthController {
  constructor(private readonly h: AuthHttpHandler) {}
  @Public() @HttpCode(200) @Post('login') login(@Req() req: { headers: Record<string, string> }, @Body() body: unknown) { return this.h.login({ body, headers: req.headers }); }
  @Public() @HttpCode(200) @Post('logout') logout(@Req() req: { headers: Record<string, string> }) { return this.h.logout({ headers: req.headers }); }
  @Public() @Get('me') me(@Req() req: { headers: Record<string, string> }) { return this.h.me({ headers: req.headers }); }
}
// Giả lập Customers API: có khai báo quyền như controller thật, KHÔNG @Public. Đếm số lần handler chạy để chứng minh bị chặn trước handler.
let customersHandlerRuns = 0;
@Controller('customers')
class CustomersStandIn {
  @RequirePermissions('customer.read') @Get() list(@Req() req: { actor?: Actor }) { customersHandlerRuns++; return { actor: req.actor }; }
}

interface Boot { app: INestApplication; store: InMemorySessionStore; sessions: SessionService }
async function boot(opts: { creds?: CredentialStore; policy?: 'none' | 'tight' | 'broken-store' } = {}): Promise<Boot> {
  const store = new InMemorySessionStore();
  store.setTokenVersion(E7, 1);
  const sessions = new SessionService(store, store, new Sha256TokenHasher(), clock, TTL);
  const creds = opts.creds ?? knownCreds;
  const plain = new PasswordLoginService(creds, hasher);
  let verifier: { verify(i: { login: unknown; password: unknown }): Promise<unknown> } = plain;
  if (opts.policy && opts.policy !== 'none') {
    const counts = new Map<string, number>();
    const policy = new LoginAbusePolicy({
      config: { windowMs: 10_000, maxPerSource: 2, maxPerSourceIdentifier: 2 }, // số giả CHỈ cho test
      store: { async hit(k) { if (opts.policy === 'broken-store') throw new Error('down'); counts.set(k, (counts.get(k) ?? 0) + 1); return counts.get(k)!; } },
      keyHasher: (m) => 'h:' + Buffer.from(m).toString('hex'),
      now: () => NOW,
    });
    verifier = new SourcedLogin(creds, new ThrottledPasswordLogin(policy, plain));
  }
  const login = new LoginSessionService(verifier as PasswordLoginService, sessions);
  const mod = await Test.createTestingModule({
    controllers: [TestAuthController, CustomersStandIn],
    providers: [
      { provide: AuthHttpHandler, useValue: new AuthHttpHandler(login, sessions) },
      { provide: ACTOR_PROVIDER, useValue: new DenyAllActorProvider() }, // mặc định production: KHÔNG có ActorProvider thật
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  }).compile();
  void HANDLER;
  const app = mod.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1'); // như app.setup.ts
  app.useGlobalFilters(new AllExceptionsFilter()); // bộ lọc lỗi production THẬT: thân lỗi frontend đọc là error.code
  await app.init();
  return { app, store, sessions };
}
const http = (a: INestApplication) => request(a.getHttpServer());
const loginAs = (a: INestApplication, login: string, password = PW) => http(a).post(FE_BASE + FE_PATHS.login).set(FE_HEADERS_ANON).send({ login, password });

const SRC = join(__dirname, '..', '..', '..'); // backend/src
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('KHỚP — luồng frontend login → me → logout trên handler backend (provider giả)', () => {
  let b: Boot;
  beforeEach(async () => { b = await boot(); });
  afterEach(async () => { await b.app.close(); });

  it('đăng nhập bằng mã NV và bằng email (khác hoa/thường): 200 { token, expiresAt ISO } — đúng hai trường frontend đòi', async () => {
    for (const id of ['NV-0007', 'NV7@Siscom.VN']) {
      const r = await loginAs(b.app, id);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(['expiresAt', 'token']);
      expect(typeof r.body.token).toBe('string');
      expect(new Date(r.body.expiresAt).toISOString()).toBe(r.body.expiresAt); // frontend lưu chuỗi; ISO round-trip
    }
  });

  it('me với token vừa cấp: 200 { employeeId } (frontend gọi me ngay sau login để lấy danh tính do server xác nhận)', async () => {
    const t = (await loginAs(b.app, 'NV-0007')).body.token;
    const me = await http(b.app).get(FE_BASE + FE_PATHS.me).set(feBearer(t));
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ employeeId: E7 });
  });

  it('logout: 200 { ok:true }; sau đó me với token cũ -> 401 AUTH_REQUIRED; logout lần hai vẫn 200 (idempotent)', async () => {
    const t = (await loginAs(b.app, 'NV-0007')).body.token;
    const out = await http(b.app).post(FE_BASE + FE_PATHS.logout).set(feBearer(t));
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    const me = await http(b.app).get(FE_BASE + FE_PATHS.me).set(feBearer(t));
    expect([me.status, me.body.error.code]).toEqual([401, 'AUTH_REQUIRED']);
    expect((await http(b.app).post(FE_BASE + FE_PATHS.logout).set(feBearer(t))).status).toBe(200);
  });

  it('bộ header frontend gửi (Accept, Content-Type, Authorization) không chạm bộ chặn header giả danh tính', async () => {
    const r = await loginAs(b.app, 'NV-0007');
    expect(r.status).toBe(200);
  });

  it('thân lỗi production có error.code đúng chỗ frontend đọc (json.error.code): sai mật khẩu và tài khoản lạ cùng 401 LOGIN_INVALID', async () => {
    const wrong = await loginAs(b.app, 'NV-0007', 'sai');
    const ghost = await loginAs(b.app, 'NV-0099');
    for (const r of [wrong, ghost]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('LOGIN_INVALID');
      expect(feClassify(r.status, r.body.error.code, true)).toBe('INVALID_CREDENTIALS');
    }
    expect(wrong.body.error.message).toBe(ghost.body.error.message);
  });

  it('thân đăng nhập sai hình dạng -> 400 REQUEST_INVALID (frontend: REQUEST_INVALID); trường thừa bị từ chối', async () => {
    for (const body of [{}, { login: 'NV-0007' }, { login: 'NV-0007', password: PW, role: 'ADMIN' }, { login: 7, password: PW }, '[]']) {
      const r = await http(b.app).post(FE_BASE + FE_PATHS.login).set(FE_HEADERS_ANON).send(body as never);
      expect([r.status, r.body.error?.code]).toEqual([400, 'REQUEST_INVALID']);
    }
  });

  it('me/logout thiếu hoặc sai ĐỊNH DẠNG Authorization -> 401 AUTH_REQUIRED, cùng thân; token đúng định dạng nhưng không tồn tại: me 401, logout 200 (idempotent, không lộ phiên có tồn tại)', async () => {
    const malformed = [{}, { Authorization: 'Bearer' }, { Authorization: 'Basic abc' }, { Authorization: 'Bearer sid_' + 'x'.repeat(42) }];
    const unknown = { Authorization: 'Bearer sid_' + 'A'.repeat(43) };
    const messages = new Set<string>();
    for (const h of malformed) {
      for (const r of [await http(b.app).get(FE_BASE + FE_PATHS.me).set(h), await http(b.app).post(FE_BASE + FE_PATHS.logout).set(h)]) {
        expect([r.status, r.body.error.code]).toEqual([401, 'AUTH_REQUIRED']);
        messages.add(r.body.error.message);
      }
    }
    const meUnknown = await http(b.app).get(FE_BASE + FE_PATHS.me).set(unknown);
    expect([meUnknown.status, meUnknown.body.error.code]).toEqual([401, 'AUTH_REQUIRED']);
    messages.add(meUnknown.body.error.message);
    expect(messages.size).toBe(1);
    expect((await http(b.app).post(FE_BASE + FE_PATHS.logout).set(unknown)).body).toEqual({ ok: true });
  });

  it('token không được nhận qua query/cookie/body (frontend chỉ dùng header Bearer)', async () => {
    const t = (await loginAs(b.app, 'NV-0007')).body.token;
    expect((await http(b.app).get(FE_BASE + FE_PATHS.me + '?token=' + t)).status).toBe(401);
    expect((await http(b.app).get(FE_BASE + FE_PATHS.me).set('Cookie', 'siscom_rt=' + t + '; token=' + t)).status).toBe(401);
  });

  it('bảng định danh: backend parseLoginIdentifier cho CÙNG kết quả với frontend loginIdentifier.js trên mọi mẫu', () => {
    const diffs = FE_IDENTIFIER_KINDS.filter(([input, kind]) => parseLoginIdentifier(input).kind !== kind).map(([i]) => JSON.stringify(i));
    expect(diffs).toEqual([]);
  });
});

describe('KHỚP — chống lạm dụng 429 (khi nguồn được cấp) và fail-closed', () => {
  afterEach(() => { throttleSource = undefined; });

  it('vượt hạn mức -> 429 LOGIN_THROTTLED qua bộ lọc production; frontend phân loại RATE_LIMITED; không tra credential của lần bị chặn', async () => {
    const b = await boot({ policy: 'tight' });
    throttleSource = '203.0.113.9';
    const codes: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 4; i++) { last = await loginAs(b.app, 'NV-0007', 'sai'); codes.push(last.status); }
    expect(codes).toEqual([401, 401, 429, 429]);
    expect(last!.body.error.code).toBe('LOGIN_THROTTLED');
    expect(feClassify(last!.status, last!.body.error.code, true)).toBe('RATE_LIMITED');
    await b.app.close();
  });

  it('kho giới hạn tốc độ hỏng -> từ chối (429), không bao giờ cho đăng nhập qua', async () => {
    const b = await boot({ policy: 'broken-store' });
    throttleSource = '203.0.113.9';
    const r = await loginAs(b.app, 'NV-0007');
    expect([r.status, r.body.error.code]).toEqual([429, 'LOGIN_THROTTLED']);
    expect(r.body.token).toBeUndefined();
    await b.app.close();
  });

  it('thiếu credential (không có Authorization) và thiếu actor: Customers API vẫn 401 UNAUTHENTICATED, handler không chạy', async () => {
    const b = await boot();
    customersHandlerRuns = 0;
    const r = await http(b.app).get(FE_BASE + '/customers').set({ Accept: 'application/json' });
    expect([r.status, r.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);
    expect(customersHandlerRuns).toBe(0);
    await b.app.close();
  });

  it('bảo vệ default-deny Customers: token phiên HỢP LỆ cũng KHÔNG mở được Customers khi chưa nối ActorProvider thật (frontend #83 gắn Authorization)', async () => {
    const b = await boot();
    customersHandlerRuns = 0;
    const t = (await loginAs(b.app, 'NV-0007')).body.token;
    expect((await http(b.app).get(FE_BASE + FE_PATHS.me).set(feBearer(t))).status).toBe(200); // phiên có thật
    const forged = { ...feBearer(t), 'x-actor-id': E7, 'x-employee-id': E7 };
    for (const h of [feBearer(t), forged]) {
      const r = await http(b.app).get(FE_BASE + '/customers').set(h);
      expect([r.status, r.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);
    }
    expect(customersHandlerRuns).toBe(0);
    await b.app.close();
  });

  it('tĩnh: controller Customers/Contacts/Lookups thật không có @Public; không có @Controller("auth") nào trong mã production; AuthHttpHandler không được module nào đăng ký', () => {
    for (const f of ['modules/customers/customers.controller.ts', 'modules/customers/contacts.controller.ts', 'modules/lookups/lookups.controller.ts']) {
      expect(read(...f.split('/'))).not.toMatch(/@Public\s*\(/);
    }
    const prod = walk(SRC).filter((f) => !/\.(spec|test)\.ts$/.test(f));
    const offenders = prod.filter((f) => /@Controller\(\s*['"`]auth/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    const registers = prod.filter((f) => !f.includes(join('auth', 'http')) && /\bAuthHttpHandler\b/.test(readFileSync(f, 'utf8')));
    expect(registers).toEqual([]);
  });
});

describe('LỆCH — khác biệt đã xác minh giữa backend hiện tại và frontend (khóa hành vi hiện tại; cần quyết định chủ sở hữu)', () => {
  it('LỆCH-1 (CSRF/logout): thiết kế PA6 bắt /auth/logout phải có Origin hợp lệ + X-CSRF-Token; handler A4 + frontend chỉ dùng Bearer, không CSRF -> handler cho qua', async () => {
    const b = await boot();
    const t = (await loginAs(b.app, 'NV-0007')).body.token;
    // Chính sách PA6 sẽ từ chối đúng yêu cầu frontend gửi (không có X-CSRF-Token):
    expect(checkCsrfToken(undefined, 'a'.repeat(64))).toEqual({ ok: false, code: 'CSRF_FAILED', reason: 'CSRF_HEADER_MISSING' });
    expect(checkOrigin(undefined, ['http://localhost:5173'])).toEqual({ ok: false, code: 'CSRF_FAILED', reason: 'ORIGIN_MISSING' });
    // ...nhưng handler A4 chấp nhận logout chỉ với Bearer:
    expect((await http(b.app).post(FE_BASE + FE_PATHS.logout).set(feBearer(t))).status).toBe(200);
    await b.app.close();
  });

  it('LỆCH-2 (cookie/CORS): frontend credentials:"omit", CORS credentials:false, allowedHeaders không có X-CSRF-Token, login không phát Set-Cookie -> frontend không thể dùng refresh cookie PA6', async () => {
    const b = await boot();
    const r = await loginAs(b.app, 'NV-0007');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(r.body)).not.toContain('refreshToken');
    await b.app.close();
    const setup = read('app.setup.ts');
    expect(setup).toMatch(/credentials:\s*false/);
    expect(setup).toMatch(/allowedHeaders:\s*\[[^\]]*'Authorization'[^\]]*\]/); // Authorization đã được phép => frontend Bearer chạy được qua CORS
    expect(setup).not.toMatch(/X-CSRF-Token/i); // preflight sẽ chặn header CSRF
    expect(buildRefreshCookie('A'.repeat(43))).toBe(`siscom_rt=${'A'.repeat(43)}; Path=${REFRESH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict`);
    expect(REFRESH_COOKIE_PATH).toBe(FE_BASE + '/auth'); // cookie chỉ gửi tới /api/v1/auth/* => frontend phải đặt base có /api/v1
  });

  it('LỆCH-3 (nguồn limiter): AuthHttpHandler.login chỉ nhận { body, headers } — không có nguồn đáng tin; ThrottledPasswordLogin thiếu nguồn từ chối MỌI người, kể cả mật khẩu đúng', async () => {
    expect(AuthHttpHandler.prototype.login.length).toBe(1);
    const b = await boot({ policy: 'tight' });
    throttleSource = undefined; // controller thật chưa có chỗ lấy IP socket đáng tin
    const r = await loginAs(b.app, 'NV-0007'); // mật khẩu ĐÚNG
    expect([r.status, r.body.error.code]).toEqual([429, 'LOGIN_THROTTLED']);
    expect(feClassify(r.status, r.body.error.code, true)).toBe('RATE_LIMITED'); // người dùng thấy "thử lại sau" vĩnh viễn
    await b.app.close();
  });

  it('LỆCH-4 (sự cố vs sai mật khẩu): kho credential lỗi khi đăng nhập -> 401 LOGIN_INVALID (frontend hiện "sai thông tin"), không phải 503 SERVICE_UNAVAILABLE', async () => {
    const down: CredentialStore = { async findByIdentifier() { throw new Error('db down'); } };
    const b = await boot({ creds: down });
    const r = await loginAs(b.app, 'NV-0007');
    expect([r.status, r.body.error.code]).toEqual([401, 'LOGIN_INVALID']);
    expect(feClassify(r.status, r.body.error.code, true)).toBe('INVALID_CREDENTIALS');
    await b.app.close();
  });

  it('LỆCH-5 (không gian mã 401): login=LOGIN_INVALID, me/logout=AUTH_REQUIRED, guard=UNAUTHENTICATED; frontend coi mọi 401 khác LOGIN_INVALID là SESSION_EXPIRED, kể cả ở login', async () => {
    const b = await boot();
    const me = await http(b.app).get(FE_BASE + FE_PATHS.me);
    const guard = await http(b.app).get(FE_BASE + '/customers');
    expect([me.body.error.code, guard.body.error.code]).toEqual(['AUTH_REQUIRED', 'UNAUTHENTICATED']);
    expect(feClassify(me.status, me.body.error.code, false)).toBe('SESSION_EXPIRED');
    expect(feClassify(guard.status, guard.body.error.code, false)).toBe('SESSION_EXPIRED');
    expect(feClassify(guard.status, guard.body.error.code, true)).toBe('SESSION_EXPIRED(login!)'); // nếu guard từng chặn login nhầm
    await b.app.close();
  });

  it('LỆCH-6 (đường dẫn): backend CHƯA có route /auth/*; frontend coi 404/405/501 là ENDPOINT_UNAVAILABLE (đúng). Tiền tố api/v1 là bắt buộc trong base URL', async () => {
    const b = await boot();
    const wrongBase = await http(b.app).post('/auth/login').set(FE_HEADERS_ANON).send({ login: 'NV-0007', password: PW }); // thiếu /api/v1
    expect(wrongBase.status).toBe(404);
    expect(feClassify(wrongBase.status, wrongBase.body.error.code, true)).toBe('ENDPOINT_UNAVAILABLE');
    await b.app.close();
  });
});

// Quyết định chủ sở hữu cần đưa ra (không tự chọn trong PR này):
export const OWNER_DECISIONS = {
  'LỆCH-1': 'Logout dùng Bearer thuần (A4/frontend) hay cookie+CSRF (thiết kế PA6)? Hai đường không thể cùng là nguồn sự thật.',
  'LỆCH-2': 'Có dùng refresh cookie HttpOnly không? Nếu có: frontend credentials:"include", CORS credentials:true + X-CSRF-Token, SameSite=Strict yêu cầu cùng site. Nếu không: bỏ PA6 khỏi lộ trình web.',
  'LỆCH-3': 'Nguồn limiter lấy từ đâu (socket/trust proxy)? Cần tham số nguồn trong handler hoặc interceptor; hiện thiếu nguồn = từ chối tất cả.',
  'LỆCH-4': 'Lỗi hạ tầng khi đăng nhập trả 401 (chống dò tài khoản, hiện tại) hay 503 (frontend phân biệt được)?',
  'LỆCH-5': 'Thống nhất mã 401: frontend nên coi AUTH_REQUIRED/UNAUTHENTICATED ở login là lỗi hệ thống, hay backend thống nhất mã.',
  'LỆCH-6': 'Chốt VITE_CRM_API_BASE gồm /api/v1 và đường dẫn /auth/login|logout|me khi AuthController được duyệt.',
} as const;
