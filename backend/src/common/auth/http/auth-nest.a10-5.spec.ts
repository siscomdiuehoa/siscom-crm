import 'reflect-metadata';
import { AsyncLocalStorage } from 'async_hooks';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, HttpException, INestApplication, Post, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessGuard } from '../access.guard';
import { ACTOR_PROVIDER, Actor, ActorProvider } from '../actor';
import { DenyAllActorProvider } from '../deny-all-actor.provider';
import { Public, RequirePermissions } from '../permissions.decorator';
import { APP_GUARD } from '@nestjs/core';
import { LoginAbusePolicy, ThrottledPasswordLogin } from '../login/login-abuse.policy';
import { LoginSessionService } from '../login/login-session.service';
import { PasswordLoginService } from '../login/password-login.service';
import { CredentialStore, LoginLookupIdentifier, PasswordHasher, StoredCredential } from '../login/password-login.types';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { SessionService, Sha256TokenHasher } from '../session/session.service';
import { AuthHttpHandler } from './auth-http.handler';

// A10-5 — kiểm thử Nest TestingModule cho chuỗi A1→A4 + bộ phân tích định danh + limiter, CHỈ với provider GIẢ trong bộ nhớ.
// KHÔNG import AppModule/AuthModule/PrivilegedModule, KHÔNG PrismaService, KHÔNG dùng bộ lọc lỗi production (nó kéo Prisma Client).
// Nếu bất kỳ đường import nào chạm '@prisma/client' thì mock dưới đây ném lỗi => suite đỏ (bằng chứng không có Postgres).
jest.mock('@prisma/client', () => { throw new Error('PRISMA_FORBIDDEN_IN_A10_5_TESTS'); });

const E7 = '00000000-0000-4000-8000-000000000007';
const E8 = '00000000-0000-4000-8000-000000000008';
const PW = 'Mat-khau-thu-nghiem-1';
const TTL = 60_000;
const START = Date.UTC(2026, 9, 22, 0, 0, 0);
let nowMs = START;
const clock = { now: () => new Date(nowMs) };

const hasher: PasswordHasher = { verify: async (h, p) => h !== null && h === 'H:' + p };
const cred = (employeeId: string): StoredCredential => ({ employeeId, hash: 'H:' + PW, algo: 'argon2id', active: true });
// Kho credential giả: ghi lại mọi lần tra cứu (để kiểm "từ chối trước khi tra credential") và chỉ biết 2 tài khoản.
function makeCreds() {
  const lookups: LoginLookupIdentifier[] = [];
  const store: CredentialStore = {
    async findByIdentifier(id) {
      lookups.push(id);
      if (id.kind === 'EMPLOYEE_CODE' && id.value === 'NV-0007') return cred(E7);
      if (id.kind === 'EMAIL' && id.value.toLowerCase() === 'nv8@siscom.vn') return cred(E8);
      return null;
    },
  };
  return { store, lookups };
}

// Nguồn (source) của lần thử do controller test cấp qua AsyncLocalStorage để limiter nằm TRONG chuỗi A1→A3 thật.
const sourceCtx = new AsyncLocalStorage<string>();
class LimitedPasswordLogin extends PasswordLoginService {
  constructor(creds: CredentialStore, private readonly throttled: ThrottledPasswordLogin) { super(creds, hasher); }
  override verify(input: { login: unknown; password: unknown }) {
    return this.throttled.verify({ source: sourceCtx.getStore(), login: input.login, password: input.password });
  }
}

// Provider danh tính CHỈ có trong test: lấy danh tính từ phiên phía server (Bearer), không bao giờ từ header/body.
class SessionActorProvider implements ActorProvider {
  constructor(private readonly sessions: SessionService) {}
  async resolve(req: { headers: Record<string, unknown> }): Promise<Actor | null> {
    const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''));
    if (!m) return null;
    try { return { employeeId: (await this.sessions.validate(m[1])).employeeId, departmentId: null }; } catch { return null; }
  }
  scopeFor() { return 'OWN' as const; }
}

const HANDLER = Symbol('HANDLER');
// Controller test-only: bọc AuthHttpHandler. Header/body được chuyển nguyên vẹn để kiểm tra từ chối giả mạo.
@Controller('t-auth')
class TestAuthController {
  constructor(private readonly h: AuthHttpHandler) {}
  @Public() @HttpCode(200) @Post('login') login(@Req() req: { headers: Record<string, string>; ip: string }, @Body() body: unknown) {
    return sourceCtx.run(req.ip, () => this.h.login({ body, headers: req.headers }));
  }
  @Public() @HttpCode(200) @Post('logout') logout(@Req() req: { headers: Record<string, string> }) { return this.h.logout({ headers: req.headers }); }
  @Public() @Get('me') me(@Req() req: { headers: Record<string, string> }) { return this.h.me({ headers: req.headers }); }
}
@Controller('t-guarded')
class GuardedController {
  @RequirePermissions('customer.read') @Get('ok') ok(@Req() req: { actor?: Actor }) { return { actor: req.actor }; }
  @Get('undeclared') undeclared() { return { leaked: true }; }
}

@Catch()
class TestFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) {
      const b = e.getResponse() as { code?: string; message?: string };
      res.status(e.getStatus()).json({ error: { code: b.code ?? 'REQUEST_FAILED', message: b.message ?? '' } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống.' } });
    }
  }
}

interface Fixture { app: INestApplication; store: InMemorySessionStore; lookups: LoginLookupIdentifier[]; limiterHits: string[]; logs: string[] }
async function boot(opts: { maxPerSource?: number; denyAll?: boolean; limiterDown?: boolean } = {}): Promise<Fixture> {
  nowMs = START;
  const store = new InMemorySessionStore();
  store.setTokenVersion(E7, 1);
  store.setTokenVersion(E8, 1);
  const { store: creds, lookups } = makeCreds();
  const limiterHits: string[] = [];
  const logs: string[] = [];
  const counts = new Map<string, number>();
  const policy = new LoginAbusePolicy({
    config: { windowMs: 10_000, maxPerSource: opts.maxPerSource ?? 1000, maxPerSourceIdentifier: opts.maxPerSource ?? 1000 }, // số giả CHỈ cho test
    store: {
      async hit(key) {
        if (opts.limiterDown) throw new Error('store down');
        limiterHits.push(key);
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return n;
      },
    },
    keyHasher: (m) => 'h:' + Buffer.from(m).toString('hex'),
    now: () => nowMs,
    log: { warn: (e, f) => logs.push(e + JSON.stringify(f)) },
  });
  const sessions = new SessionService(store, store, new Sha256TokenHasher(), clock, TTL);
  const login = new LoginSessionService(new LimitedPasswordLogin(creds, new ThrottledPasswordLogin(policy, new PasswordLoginService(creds, hasher))), sessions);
  const moduleRef = await Test.createTestingModule({
    controllers: [TestAuthController, GuardedController],
    providers: [
      { provide: AuthHttpHandler, useValue: new AuthHttpHandler(login, sessions) },
      { provide: ACTOR_PROVIDER, useValue: opts.denyAll ? new DenyAllActorProvider() : new SessionActorProvider(sessions) },
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  app.useGlobalFilters(new TestFilter());
  await app.init();
  return { app, store, lookups, limiterHits, logs };
}
const http = (app: INestApplication) => request(app.getHttpServer());
const loginReq = (app: INestApplication, login: string, password = PW) => http(app).post('/t-auth/login').send({ login, password });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('A10-5 — Nest TestingModule với provider giả (không DB)', () => {
  let f: Fixture;
  afterEach(async () => { await f.app.close(); });

  describe('đăng nhập thành công (mô phỏng)', () => {
    beforeEach(async () => { f = await boot(); });

    it('mã nhân viên NV-0007 -> 200 token; me trả employeeId từ kho (không từ request); limiter được gọi', async () => {
      const r = await loginReq(f.app, 'NV-0007');
      expect(r.status).toBe(200);
      expect(r.body.token).toMatch(/^sid_[A-Za-z0-9_-]{43}$/);
      expect(r.body.expiresAt).toBe(new Date(START + TTL).toISOString());
      const me = await http(f.app).get('/t-auth/me').set(bearer(r.body.token));
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ employeeId: E7 });
      expect(f.lookups).toEqual([{ kind: 'EMPLOYEE_CODE', value: 'NV-0007' }]);
      expect(f.limiterHits.length).toBeGreaterThan(0);
    });

    it('email khác hoa/thường -> 200 và ra đúng employeeId của email đó', async () => {
      const r = await loginReq(f.app, 'NV8@Siscom.VN');
      expect(r.status).toBe(200);
      const me = await http(f.app).get('/t-auth/me').set(bearer(r.body.token));
      expect(me.body).toEqual({ employeeId: E8 });
      expect(f.lookups[0].kind).toBe('EMAIL');
    });

    it('định danh sai định dạng (không phải NV-#### hay email) -> 401 chung, không tra credential', async () => {
      const r = await loginReq(f.app, 'not an id');
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('LOGIN_INVALID');
      expect(f.lookups).toHaveLength(0);
    });
  });

  describe('thất bại đăng nhập', () => {
    beforeEach(async () => { f = await boot(); });

    it('sai mật khẩu và tài khoản không tồn tại -> cùng 401 LOGIN_INVALID, cùng thông điệp, không có phiên', async () => {
      const wrong = await loginReq(f.app, 'NV-0007', 'sai-mat-khau');
      const ghost = await loginReq(f.app, 'NV-0099');
      expect(wrong.status).toBe(401);
      expect(ghost.status).toBe(401);
      expect(wrong.body).toEqual(ghost.body);
      expect(wrong.body.error.code).toBe('LOGIN_INVALID');
      expect(JSON.stringify(wrong.body)).not.toContain('token');
      expect(f.store.dumpKeys().length).toBe(0);
    });

    it('header giả danh tính trên login/logout/me -> 400 REQUEST_INVALID, không tra credential', async () => {
      for (const h of ['x-actor-id', 'x-employee-id', 'x-user-id', 'x-impersonate']) {
        const r = await http(f.app).post('/t-auth/login').set(h, E8).send({ login: 'NV-0007', password: PW });
        expect(r.status).toBe(400);
        expect(r.body.error.code).toBe('REQUEST_INVALID');
      }
      const ok = await loginReq(f.app, 'NV-0007');
      const lo = await http(f.app).post('/t-auth/logout').set(bearer(ok.body.token)).set('x-actor-id', E8);
      const me = await http(f.app).get('/t-auth/me').set(bearer(ok.body.token)).set('x-employee-id', E8);
      expect(lo.status).toBe(400);
      expect(me.status).toBe(400);
      expect(f.lookups).toHaveLength(1); // chỉ lần đăng nhập hợp lệ ở trên
    });

    it('body giả danh tính (employeeId/actor thừa) hoặc sai hình dạng -> 400, không tra credential', async () => {
      const bodies: unknown[] = [
        { login: 'NV-0007', password: PW, employeeId: E8 },
        { login: 'NV-0007', password: PW, actor: { employeeId: E8 } },
        { login: 'NV-0007' },
        { login: 1, password: PW },
        [],
      ];
      for (const b of bodies) {
        const r = await http(f.app).post('/t-auth/login').send(b as object);
        expect(r.status).toBe(400);
        expect(r.body.error.code).toBe('REQUEST_INVALID');
      }
      expect(f.lookups).toHaveLength(0);
    });
  });

  describe('vòng đời phiên', () => {
    beforeEach(async () => { f = await boot(); });
    const token = async () => (await loginReq(f.app, 'NV-0007')).body.token as string;

    it('hết hạn: hợp lệ tại hạn-1ms, 401 AUTH_REQUIRED tại hạn', async () => {
      const t = await token();
      nowMs = START + TTL - 1;
      expect((await http(f.app).get('/t-auth/me').set(bearer(t))).status).toBe(200);
      nowMs = START + TTL;
      const r = await http(f.app).get('/t-auth/me').set(bearer(t));
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('thu hồi: sau logout -> me 401; logout lần hai vẫn 200 và không lỗi', async () => {
      const t = await token();
      const first = await http(f.app).post('/t-auth/logout').set(bearer(t));
      const second = await http(f.app).post('/t-auth/logout').set(bearer(t));
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ ok: true });
      expect(second.status).toBe(200);
      expect((await http(f.app).get('/t-auth/me').set(bearer(t))).status).toBe(401);
    });

    it('tokenVersion đổi (hoặc tài khoản bị khóa) -> 401 AUTH_REQUIRED, cùng thông điệp với hết hạn', async () => {
      const t = await token();
      f.store.setTokenVersion(E7, 2);
      const bumped = await http(f.app).get('/t-auth/me').set(bearer(t));
      expect(bumped.status).toBe(401);
      expect(bumped.body.error.code).toBe('AUTH_REQUIRED');
      const t2 = await loginReq(f.app, 'NV-0007'); // phiên mới ở phiên bản mới thì hợp lệ
      expect((await http(f.app).get('/t-auth/me').set(bearer(t2.body.token))).status).toBe(200);
      f.store.setTokenVersion(E8, 1);
      const t3 = (await loginReq(f.app, 'nv8@siscom.vn')).body.token as string;
      f.store.setTokenVersion(E8, null);
      expect((await http(f.app).get('/t-auth/me').set(bearer(t3))).status).toBe(401);
    });

    it('Authorization sai định dạng -> 401 AUTH_REQUIRED chung (thiếu, sai scheme, token lạ, thừa khoảng trắng, quá dài, query token)', async () => {
      const t = await token();
      const headers: Array<string | undefined> = [undefined, '', 'Basic abc', 'Bearer', 'Bearer ' + t + ' x', 'Bearer  ' + t, t, 'Bearer sid_short', 'Bearer ' + 'a'.repeat(200)];
      for (const h of headers) {
        const rq = http(f.app).get('/t-auth/me');
        const r = h === undefined ? await rq : await rq.set('Authorization', h);
        expect(r.status).toBe(401);
        expect(r.body.error.code).toBe('AUTH_REQUIRED');
      }
      expect((await http(f.app).get('/t-auth/me?token=' + t)).status).toBe(401);
      expect((await http(f.app).post('/t-auth/logout')).status).toBe(401);
    });
  });

  describe('AccessGuard mặc định từ chối', () => {
    it('route không khai báo quyền -> 403 dù có phiên hợp lệ', async () => {
      f = await boot();
      const t = (await loginReq(f.app, 'NV-0007')).body.token as string;
      const r = await http(f.app).get('/t-guarded/undeclared').set(bearer(t));
      expect(r.status).toBe(403);
      expect(r.body).not.toHaveProperty('leaked');
    });

    it('route có quyền: không phiên -> 401; header giả không đủ; phiên hợp lệ -> actor đến từ phiên', async () => {
      f = await boot();
      const anon = await http(f.app).get('/t-guarded/ok').set({ 'x-actor-id': E8 });
      expect(anon.status).toBe(401);
      expect(anon.body.error.code).toBe('UNAUTHENTICATED');
      const t = (await loginReq(f.app, 'NV-0007')).body.token as string;
      const r = await http(f.app).get('/t-guarded/ok').set(bearer(t)).set('x-actor-id', E8);
      expect(r.status).toBe(200);
      expect(r.body.actor.employeeId).toBe(E7); // không phải E8
    });

    it('cấu hình production (DenyAllActorProvider) -> 401 ngay cả với phiên hợp lệ', async () => {
      f = await boot({ denyAll: true });
      const t = (await loginReq(f.app, 'NV-0007')).body.token as string;
      const r = await http(f.app).get('/t-guarded/ok').set(bearer(t));
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('limiter cấu hình (giả)', () => {
    it('vượt ngưỡng -> 429 LOGIN_THROTTLED và kho credential không bị gọi thêm', async () => {
      f = await boot({ maxPerSource: 2 });
      expect((await loginReq(f.app, 'NV-0007')).status).toBe(200);
      expect((await loginReq(f.app, 'NV-0007')).status).toBe(200);
      const lookupsBefore = f.lookups.length;
      const r = await loginReq(f.app, 'NV-0007');
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe('LOGIN_THROTTLED');
      expect(f.lookups).toHaveLength(lookupsBefore);
      expect(JSON.stringify(f.limiterHits) + f.logs.join('')).not.toMatch(/NV-0007|127\.0\.0\.1|::1/); // khóa/log là băm, không có PII thô
    });

    it('kho limiter lỗi -> từ chối (fail-closed), không cấp phiên', async () => {
      f = await boot({ limiterDown: true });
      const r = await loginReq(f.app, 'NV-0007');
      expect(r.status).toBe(429);
      expect(f.lookups).toHaveLength(0);
    });
  });
});

describe('A10-5 — không gắn vào production; không Postgres', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
  it('AppModule/AuthModule/PrivilegedModule không tham chiếu handler, login, limiter hay controller test', () => {
    const banned = /AuthHttpHandler|LoginSessionService|PasswordLoginService|ThrottledPasswordLogin|LoginAbusePolicy|InMemorySessionStore|auth-http|login-abuse/;
    for (const p of ['app.module.ts', 'common/auth/auth.module.ts', 'common/auth/privileged/privileged.module.ts']) expect(src(p)).not.toMatch(banned);
  });
  it('AuthModule vẫn dùng DenyAllActorProvider', () => {
    expect(src('common/auth/auth.module.ts')).toMatch(/useClass: DenyAllActorProvider/);
  });
  it('suite này không import Prisma/pg và không đọc .env (mock @prisma/client ném lỗi vẫn xanh)', () => {
    const self = readFileSync(__filename, 'utf8').split('\n').filter((l) => /^import /.test(l)).join('\n');
    expect(self).not.toMatch(/prisma|'pg'|dotenv|@nestjs\/config/i);
  });
});
