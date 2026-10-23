import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Body, Controller, HttpCode, INestApplication, Post, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainException } from '../../errors/domain.exception';
import { AllExceptionsFilter } from '../../filters/all-exceptions.filter';
import { AccessGuard } from '../access.guard';
import { ACTOR_PROVIDER } from '../actor';
import { DenyAllActorProvider } from '../deny-all-actor.provider';
import { LoginSessionService } from '../login/login-session.service';
import { PasswordLoginService } from '../login/password-login.service';
import { CredentialStore, PasswordHasher, StoredCredential } from '../login/password-login.types';
import { Public } from '../permissions.decorator';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { SessionService, Sha256TokenHasher } from '../session/session.service';
import { authUnavailable } from './auth-http.contract';
import { AuthHttpHandler } from './auth-http.handler';

// B-08 (SISCOM-FOLLOWUP-B-08-LOGIN-ERROR-CONTRACT): lệch lỗi hạ tầng khi đăng nhập giữa backend và frontend. CHỈ TEST + provider giả trong bộ nhớ:
// không DB, không Prisma, không AppModule, KHÔNG đăng ký AuthController thật, KHÔNG sửa handler/service auth, không đổi DenyAll/CSRF/CORS/guard.
//
//   A. HIỆN TRẠNG (khóa hành vi hiện tại, phải GREEN trên mã nguồn hiện có):
//      A1 kho credential lỗi -> 401 LOGIN_INVALID, thân giống hệt "sai mật khẩu" (frontend hiện "sai thông tin" dù là sự cố hạ tầng).
//      A2 bộ lọc lỗi production đổi MỌI mã 5xx thành INTERNAL_ERROR => AUTH_UNAVAILABLE của handler (logout) không bao giờ tới client qua HTTP.
//      A3 không gian mã 401: LOGIN_INVALID / AUTH_REQUIRED / UNAUTHENTICATED; frontend chỉ đọc đúng (401, LOGIN_INVALID) là "sai thông tin".
//   B. ĐỀ XUẤT (chưa là chính sách; chỉ chứng minh khả thi bằng lớp bọc NẰM TRONG FILE TEST): lỗi kho credential -> 503, thân chung, không lộ
//      nguyên nhân; các thất bại xác thực khác giữ nguyên 401 LOGIN_INVALID (chống dò tài khoản). Chủ sở hữu quyết (PR #84 OWNER_DECISIONS LỆCH-4/5).
//
// Ranh giới đề xuất: lỗi kho là thuộc tính của hạ tầng, KHÔNG phụ thuộc định danh/mật khẩu người gọi => 503 không tạo kênh dò tài khoản mới.
// Giới hạn đã biết: phân biệt 503 vẫn cho kẻ tấn công biết "kho đang lỗi" (thông tin về hạ tầng, không về tài khoản); đây là đánh đổi cần chủ sở hữu duyệt.

const E7 = '00000000-0000-4000-8000-000000000007';
const PW = 'Mat-khau-thu-nghiem-1';
const SECRET_CAUSE = 'ECONNREFUSED 10.0.0.5:5432 password authentication failed for user "crm_app"';
const clock = { now: () => new Date(Date.UTC(2026, 9, 24)) };
const hasher: PasswordHasher = { verify: async (h, p) => h !== null && h === 'H:' + p };
const cred = (over: Partial<StoredCredential> = {}): StoredCredential => ({ employeeId: E7, hash: 'H:' + PW, algo: 'argon2id', active: true, ...over });
const okStore = (c: StoredCredential | null): CredentialStore => ({ async findByIdentifier() { return c; } });
const downStore: CredentialStore = { async findByIdentifier() { throw new Error(SECRET_CAUSE); } };

// ---- Đề xuất B (chỉ trong test): dò lỗi hạ tầng của kho mà không đổi PasswordLoginService ----
class InfraProbe {
  failed = false;
  wrap(inner: CredentialStore): CredentialStore {
    return { findByIdentifier: async (i) => { try { return await inner.findByIdentifier(i); } catch (e) { this.failed = true; throw e; } } };
  }
}
class ProposedPasswordLogin extends PasswordLoginService {
  constructor(private readonly inner: CredentialStore) { super(inner, hasher); }
  override async verify(input: { login: unknown; password: unknown }) {
    const probe = new InfraProbe(); // mỗi lần gọi một probe: không dùng chung trạng thái giữa các request
    const svc = new PasswordLoginService(probe.wrap(this.inner), hasher);
    try {
      return await svc.verify(input);
    } catch (e) {
      if (probe.failed) throw authUnavailable(); // 503 AUTH_UNAVAILABLE chung, không mang nguyên nhân
      throw e; // mọi thất bại xác thực khác: nguyên 401 LOGIN_INVALID
    }
  }
}

@Controller('auth')
class LoginOnlyController {
  constructor(private readonly h: AuthHttpHandler) {}
  @Public() @HttpCode(200) @Post('login') login(@Req() req: { headers: Record<string, string> }, @Body() body: unknown) { return this.h.login({ body, headers: req.headers }); }
}

async function boot(creds: CredentialStore, proposed: boolean): Promise<INestApplication> {
  const store = new InMemorySessionStore();
  store.setTokenVersion(E7, 1);
  const sessions = new SessionService(store, store, new Sha256TokenHasher(), clock, 60_000);
  const verifier = proposed ? new ProposedPasswordLogin(creds) : new PasswordLoginService(creds, hasher);
  const mod = await Test.createTestingModule({
    controllers: [LoginOnlyController],
    providers: [
      { provide: AuthHttpHandler, useValue: new AuthHttpHandler(new LoginSessionService(verifier, sessions), sessions) },
      { provide: ACTOR_PROVIDER, useValue: new DenyAllActorProvider() },
      { provide: APP_GUARD, useClass: AccessGuard },
    ],
  }).compile();
  const app = mod.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter()); // bộ lọc lỗi production THẬT
  await app.init();
  return app;
}
const loginAs = (a: INestApplication, login: string, password = PW) =>
  request(a.getHttpServer()).post('/api/v1/auth/login').set('Accept', 'application/json').send({ login, password });
const shape = (r: { status: number; body: { error: { code: string; message: string } } }) => [r.status, r.body.error.code, r.body.error.message];

// Bản sao bảng phân loại của frontend authClient.js (đã khóa ở backend PR #84 / frontend PR #92): chỉ (401, LOGIN_INVALID) là "sai thông tin".
const feClass = (status: number, code: string): string =>
  [404, 405, 501].includes(status) ? 'ENDPOINT_UNAVAILABLE' : status === 429 ? 'RATE_LIMITED'
    : status === 401 ? (code === 'LOGIN_INVALID' ? 'INVALID_CREDENTIALS' : 'SESSION_EXPIRED') : status === 400 ? 'REQUEST_INVALID' : status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN';

describe('B-08 A — HIỆN TRẠNG (khóa hành vi hiện tại)', () => {
  it('A1: kho credential lỗi -> 401 LOGIN_INVALID, thân GIỐNG HỆT sai mật khẩu; frontend hiện "sai thông tin"; không lộ nguyên nhân', async () => {
    const down = await boot(downStore, false);
    const wrong = await boot(okStore(cred()), false);
    const rDown = await loginAs(down, 'NV-0007');
    const rWrong = await loginAs(wrong, 'NV-0007', 'sai-mat-khau');
    expect(shape(rDown)).toEqual([401, 'LOGIN_INVALID', 'Tên đăng nhập hoặc mật khẩu không đúng.']);
    expect(shape(rDown)).toEqual(shape(rWrong));
    expect(feClass(rDown.status, rDown.body.error.code)).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(rDown.body)).not.toContain('ECONNREFUSED');
    await down.close(); await wrong.close();
  });

  it('A2: AllExceptionsFilter đổi mọi 5xx thành INTERNAL_ERROR — DomainException(503, AUTH_UNAVAILABLE) của handler KHÔNG tới client qua HTTP (khác ghi chú hợp đồng "503 AUTH_UNAVAILABLE")', async () => {
    expect(authUnavailable().getStatus()).toBe(503);
    expect(authUnavailable().code).toBe('AUTH_UNAVAILABLE'); // mức handler
    const app = await boot(downStore, true); // đề xuất B ném authUnavailable() ra qua bộ lọc thật
    const r = await loginAs(app, 'NV-0007');
    expect([r.status, r.body.error.code]).toEqual([503, 'INTERNAL_ERROR']); // mức HTTP: mã bị ghi đè, status 503 còn nguyên
    expect(feClass(r.status, r.body.error.code)).toBe('SERVICE_UNAVAILABLE'); // frontend phân loại theo STATUS nên vẫn đúng
    await app.close();
  });

  it('A3: không gian mã 401 — frontend chỉ coi đúng (401, LOGIN_INVALID) là sai thông tin; AUTH_REQUIRED/UNAUTHENTICATED ở màn đăng nhập thành SESSION_EXPIRED', () => {
    expect(feClass(401, 'LOGIN_INVALID')).toBe('INVALID_CREDENTIALS');
    for (const c of ['AUTH_REQUIRED', 'UNAUTHENTICATED']) expect(feClass(401, c)).toBe('SESSION_EXPIRED');
  });
});

describe('B-08 B — ĐỀ XUẤT 503 không lộ thông tin (lớp bọc chỉ trong test; backend KHÔNG đổi)', () => {
  it('B1: kho lỗi -> 503, thân chung (không tên máy/cổng/người dùng DB/stack), frontend phân loại SERVICE_UNAVAILABLE', async () => {
    const app = await boot(downStore, true);
    const r = await loginAs(app, 'NV-0007');
    expect(r.status).toBe(503);
    expect(r.body.error.message).toBe('Lỗi hệ thống. Vui lòng thử lại sau.');
    const raw = JSON.stringify(r.body);
    for (const leak of ['ECONNREFUSED', '10.0.0.5', '5432', 'crm_app', 'Error:', 'at ']) expect(raw).not.toContain(leak);
    expect(feClass(r.status, r.body.error.code)).toBe('SERVICE_UNAVAILABLE');
    await app.close();
  });

  it('B2: 503 không phụ thuộc định danh/mật khẩu (mã NV, email, định danh sai định dạng) -> không tạo kênh dò tài khoản mới', async () => {
    const app = await boot(downStore, true);
    const shapes = new Set<string>();
    for (const [id, pw] of [['NV-0007', PW], ['NV-9999', PW], ['nv7@siscom.vn', 'x'], ['NV-0007', 'sai']] as const) {
      const r = await loginAs(app, id, pw);
      shapes.add(JSON.stringify([r.status, r.body.error.code, r.body.error.message]));
    }
    expect(shapes.size).toBe(1);
    await app.close();
  });

  it('B3: thất bại xác thực thật (không có TK / sai mật khẩu / khóa / thuật toán lạ) vẫn là CÙNG 401 LOGIN_INVALID khi kho khỏe — chống dò tài khoản giữ nguyên', async () => {
    const cases: Array<[string, StoredCredential | null, string]> = [
      ['không có TK', null, PW], ['sai mật khẩu', cred(), 'sai'], ['tài khoản khóa', cred({ active: false }), PW], ['thuật toán lạ', cred({ algo: 'md5' as never }), PW],
    ];
    const shapes = new Set<string>();
    for (const [, c, pw] of cases) {
      const app = await boot(okStore(c), true);
      shapes.add(JSON.stringify(shape(await loginAs(app, 'NV-0007', pw))));
      await app.close();
    }
    expect([...shapes]).toEqual([JSON.stringify([401, 'LOGIN_INVALID', 'Tên đăng nhập hoặc mật khẩu không đúng.'])]);
  });

  it('B4: kho khỏe + đúng mật khẩu vẫn 200 { token, expiresAt } dưới lớp bọc đề xuất', async () => {
    const app = await boot(okStore(cred()), true);
    const r = await loginAs(app, 'NV-0007');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['expiresAt', 'token']);
    await app.close();
  });

  it('B5: lớp bọc dùng probe riêng mỗi lần gọi — một lần kho lỗi không làm lần sau (kho khỏe, sai mật khẩu) thành 503', async () => {
    let healthy = false;
    const flaky: CredentialStore = { async findByIdentifier() { if (!healthy) throw new Error(SECRET_CAUSE); return cred(); } };
    const app = await boot(flaky, true);
    expect((await loginAs(app, 'NV-0007')).status).toBe(503);
    healthy = true;
    expect(shape(await loginAs(app, 'NV-0007', 'sai'))).toEqual([401, 'LOGIN_INVALID', 'Tên đăng nhập hoặc mật khẩu không đúng.']);
    await app.close();
  });
});

describe('B-08 — ranh giới phạm vi (không đổi chính sách)', () => {
  it('mã nguồn auth hiện tại KHÔNG chứa đề xuất: login-session/password-login vẫn chỉ phát 401 LOGIN_INVALID, không có AUTH_UNAVAILABLE', () => {
    const src = join(__dirname, '..', 'login');
    for (const f of ['password-login.service.ts', 'login-session.service.ts']) {
      const t = readFileSync(join(src, f), 'utf8');
      expect(t).toContain("'LOGIN_INVALID'");
      expect(t).not.toContain('AUTH_UNAVAILABLE');
      expect(t).not.toContain('503');
    }
  });

  it('DomainException vẫn là kiểu lỗi duy nhất đề xuất dùng (không thêm kiểu lỗi mới vào src)', () => {
    expect(authUnavailable()).toBeInstanceOf(DomainException);
  });
});
