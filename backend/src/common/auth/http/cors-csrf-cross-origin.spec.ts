// Kiểm thử HỢP ĐỒNG CORS/CSRF/cookie giữa trình duyệt và backend cho các phương án triển khai (TEST-ONLY, offline).
// KHÔNG đổi cấu hình CORS thật: mọi cấu hình "ứng viên" (credentials:true, X-CSRF-Token) chỉ nằm trong file test này.
// Dùng: configureApp THẬT (app.setup.ts) + validateEnv THẬT + checkOrigin/buildRefreshCookie THẬT (PA6), qua supertest.
// Mô hình trình duyệt (browserFetch/cookieSent) là MÔ PHỎNG theo đặc tả Fetch/RFC 6265bis, đã rút gọn; KHÔNG thay Chrome/Edge thật.
// Tên miền dùng .example (giữ chỗ), không phải tên miền thật của SISCOM; quyết định thật thuộc chủ sở hữu.
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../../app.setup';
import { validateEnv } from '../../../config/env.validation';
import { checkOrigin, checkRefreshLogoutCsrf } from '../session/csrf-origin.policy';
import { REFRESH_COOKIE_PATH, buildRefreshCookie } from '../session/refresh-cookie.policy';

// ---------- Hạ tầng test ----------
const DB = { DATABASE_URL: 'postgresql://siscom_app:unit-test-only@127.0.0.1:5432/siscom_crm_test_unit?schema=public' };
const env = (o: Record<string, unknown> = {}) => validateEnv({ ...DB, LOG_LEVEL: 'error', ...o });
const errorOf = (o: Record<string, unknown>): string => {
  try { env(o); } catch (e) { return (e as Error).message; }
  throw new Error('expected validateEnv to throw');
};

@Controller()
class StubController {
  @Get('health') health() { return { status: 'ok' }; }
  @Post('auth/refresh') refresh() { return { ok: true }; } // chỉ để có route thật; KHÔNG phải AuthController
}

async function bootWith(setup: (app: INestApplication) => void): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ controllers: [StubController] }).compile();
  const app = mod.createNestApplication();
  setup(app);
  await app.init();
  return app;
}
// Cấu hình THẬT: validateEnv -> configureApp (đúng đường main.ts đi).
const bootLive = (envOverrides: Record<string, unknown>) =>
  bootWith((app) => configureApp(app, new ConfigService(env(envOverrides))));

type Credentials = 'omit' | 'same-origin' | 'include';
interface FetchInit { origin: string; path: string; method: string; headers?: Record<string, string>; credentials: Credentials }
type Verdict = { ok: true } | { ok: false; stage: 'preflight' | 'actual'; reason: string };

const SIMPLE_METHODS = ['GET', 'HEAD', 'POST'];
const SAFELISTED = ['accept', 'accept-language', 'content-language']; // content-type: chỉ an toàn với 3 kiểu form, JSON thì KHÔNG
const SIMPLE_CT = /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/i;

function nonSafelisted(headers: Record<string, string>): string[] {
  return Object.entries(headers)
    .filter(([k, v]) => !SAFELISTED.includes(k.toLowerCase()) && !(k.toLowerCase() === 'content-type' && SIMPLE_CT.test(v)))
    .map(([k]) => k.toLowerCase());
}
function acaoOk(h: Record<string, string>, origin: string, cred: Credentials): string | null {
  const acao = h['access-control-allow-origin'];
  if (acao === undefined) return 'THIẾU Access-Control-Allow-Origin';
  if (cred === 'include' && acao === '*') return 'ACAO="*" không được dùng với credentials:include';
  if (acao !== '*' && acao !== origin) return `ACAO không khớp origin (${acao})`;
  if (cred === 'include' && h['access-control-allow-credentials'] !== 'true') return 'THIẾU Access-Control-Allow-Credentials:true';
  return null;
}

// Mô phỏng fetch cross-origin của trình trình duyệt: preflight (nếu cần) rồi yêu cầu thật, đọc được phản hồi hay không.
async function browserFetch(app: INestApplication, f: FetchInit): Promise<Verdict> {
  const server = app.getHttpServer();
  const headers = f.headers ?? {};
  const custom = nonSafelisted(headers);
  if (!SIMPLE_METHODS.includes(f.method) || custom.length > 0) {
    let pf = request(server).options(f.path).set('Origin', f.origin).set('Access-Control-Request-Method', f.method);
    if (custom.length) pf = pf.set('Access-Control-Request-Headers', custom.join(','));
    const r = await pf;
    if (r.status < 200 || r.status > 299) return { ok: false, stage: 'preflight', reason: `status ${r.status}` };
    const bad = acaoOk(r.headers, f.origin, f.credentials);
    if (bad) return { ok: false, stage: 'preflight', reason: bad };
    const methods = String(r.headers['access-control-allow-methods'] ?? '').toUpperCase().split(',').map((s) => s.trim());
    if (!SIMPLE_METHODS.includes(f.method) && !methods.includes(f.method)) return { ok: false, stage: 'preflight', reason: `method ${f.method} không được phép` };
    const allowedH = String(r.headers['access-control-allow-headers'] ?? '').toLowerCase().split(',').map((s) => s.trim());
    for (const h of custom) {
      const wildcardOk = allowedH.includes('*') && f.credentials !== 'include' && h !== 'authorization';
      if (!allowedH.includes(h) && !wildcardOk) return { ok: false, stage: 'preflight', reason: `header ${h} không được phép` };
    }
  }
  const req = (request(server) as unknown as Record<string, (p: string) => request.Test>)[f.method.toLowerCase()](f.path).set('Origin', f.origin);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  const res = await req;
  const bad = acaoOk(res.headers, f.origin, f.credentials);
  return bad ? { ok: false, stage: 'actual', reason: bad } : { ok: true };
}

// Cookie có được gắn vào request không (rút gọn): credentials, cùng-origin/cùng-site, SameSite=Strict, Secure, Path.
function siteOf(u: URL): string {
  const host = u.hostname;
  const labels = host.split('.');
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost';
  return `${u.protocol}//${ip ? host : labels.slice(-2).join('.')}`; // rút gọn: eTLD+1 = 2 nhãn cuối (đủ cho .example/.vn; KHÔNG đúng cho com.vn)
}
function cookieSent(page: string, apiUrl: string, credentials: Credentials, cookie = buildRefreshCookie('A'.repeat(43))): { sent: boolean; why: string } {
  const p = new URL(page);
  const a = new URL(apiUrl);
  if (/;\s*Secure/i.test(cookie) && a.protocol !== 'https:' && a.hostname !== 'localhost') return { sent: false, why: 'Secure + API không phải HTTPS (không phải localhost)' };
  if (!a.pathname.startsWith(REFRESH_COOKIE_PATH)) return { sent: false, why: 'Path cookie không khớp' };
  const sameOrigin = p.origin === a.origin;
  if (credentials === 'omit') return { sent: false, why: 'credentials:omit' };
  if (credentials === 'same-origin' && !sameOrigin) return { sent: false, why: 'same-origin credentials nhưng request khác origin' };
  if (/SameSite=Strict/i.test(cookie) && siteOf(p) !== siteOf(a)) return { sent: false, why: 'SameSite=Strict + khác site' };
  return { sent: true, why: 'ok' };
}

// ---------- Fixture phương án triển khai (giữ chỗ, chủ sở hữu quyết định) ----------
const BEARER = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer test-token' }; // đúng hình dạng authClient.js
const COOKIE_FLOW = { ...BEARER, 'X-CSRF-Token': 'B'.repeat(43) }; // hình dạng yêu cầu refresh nếu chọn Bearer+HttpOnly refresh+CSRF
const SCENARIOS = {
  // D1: Windows dev/LAN, web 5173 + API 3000 trên cùng máy
  winDevLocalhost: { page: 'http://localhost:5173', api: 'http://localhost:3000/api/v1/auth/refresh', cors: 'http://localhost:5173' },
  // D2: web mở bằng localhost nhưng API gọi bằng 127.0.0.1 (HOST mặc định backend) -> khác SITE
  winDevMixedHost: { page: 'http://localhost:5173', api: 'http://127.0.0.1:3000/api/v1/auth/refresh', cors: 'http://localhost:5173' },
  // D3: VPS, cùng origin qua reverse proxy (/api/v1 cùng host)
  vpsSameOrigin: { page: 'https://crm.siscom.example', api: 'https://crm.siscom.example/api/v1/auth/refresh', cors: 'https://crm.siscom.example' },
  // D4: VPS, API ở subdomain riêng (cùng site, khác origin)
  vpsApiSubdomain: { page: 'https://app.siscom.example', api: 'https://api.siscom.example/api/v1/auth/refresh', cors: 'https://app.siscom.example' },
  // D5: API ở site khác hẳn
  vpsCrossSite: { page: 'https://crm.siscom.example', api: 'https://api.other-vendor.example/api/v1/auth/refresh', cors: 'https://crm.siscom.example' },
} as const;

// ---------- 1. Cấu hình THẬT hiện hành (credentials:false, Bearer) ----------
describe('CORS thật (app.setup.ts) — Bearer qua preflight, không cookie', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await bootLive({ CORS_ORIGINS: 'http://localhost:5173,https://app.siscom.example' }); });
  afterAll(async () => { await app.close(); });

  it('origin được liệt kê + hình dạng authClient (omit, Authorization, JSON): preflight và yêu cầu thật đều qua', async () => {
    const v = await browserFetch(app, { origin: 'http://localhost:5173', path: '/api/v1/health', method: 'GET', headers: BEARER, credentials: 'omit' });
    expect(v).toEqual({ ok: true });
    const r = await request(app.getHttpServer()).options('/api/v1/auth/refresh')
      .set('Origin', 'https://app.siscom.example').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(r.headers['access-control-allow-origin']).toBe('https://app.siscom.example'); // phản chiếu đúng một origin, không "*"
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    expect(String(r.headers.vary)).toMatch(/Origin/i); // cache proxy không trộn phản hồi giữa các origin
    expect(r.headers['access-control-max-age']).toBe('600');
  });

  it.each([
    ['origin lạ', 'http://evil.example'],
    ['cùng host khác cổng', 'http://localhost:3000'],
    ['cùng host khác scheme', 'https://localhost:5173'],
    ['hậu tố giả mạo', 'http://localhost:5173.evil.example'],
    ['subdomain chưa liệt kê', 'https://evil.siscom.example'],
    ['origin "null" (file:/sandbox)', 'null'],
    ['có dấu / cuối', 'http://localhost:5173/'],
  ])('origin không nằm trong danh sách bị trình duyệt chặn ở preflight: %s', async (_n, origin) => {
    const v = await browserFetch(app, { origin, path: '/api/v1/auth/refresh', method: 'POST', headers: BEARER, credentials: 'omit' });
    expect(v).toMatchObject({ ok: false, stage: 'preflight' });
    const r = await request(app.getHttpServer()).options('/api/v1/health').set('Origin', origin).set('Access-Control-Request-Method', 'GET');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('thiếu Origin (curl/server-to-server): không có header CORS nhưng vẫn phục vụ — CORS không phải xác thực', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('LỆCH đã biết: luồng cookie (credentials:include + X-CSRF-Token) KHÔNG chạy qua CORS hiện hành', async () => {
    const withCsrf = await browserFetch(app, { origin: 'http://localhost:5173', path: '/api/v1/auth/refresh', method: 'POST', headers: COOKIE_FLOW, credentials: 'omit' });
    expect(withCsrf).toEqual({ ok: false, stage: 'preflight', reason: 'header x-csrf-token không được phép' });
    const withCred = await browserFetch(app, { origin: 'http://localhost:5173', path: '/api/v1/auth/refresh', method: 'POST', headers: BEARER, credentials: 'include' });
    expect(withCred).toEqual({ ok: false, stage: 'preflight', reason: 'THIẾU Access-Control-Allow-Credentials:true' });
  });

  it('phương thức ngoài danh sách bị từ chối ở preflight', async () => {
    const v = await browserFetch(app, { origin: 'http://localhost:5173', path: '/api/v1/health', method: 'TRACE', headers: {}, credentials: 'omit' });
    expect(v).toMatchObject({ ok: false, stage: 'preflight' });
  });
});

// ---------- 2. Ứng viên credentials+CSRF (CHỈ trong test, chưa được chủ sở hữu duyệt) ----------
describe('ỨNG VIÊN (test-local, KHÔNG phải cấu hình thật): credentials:true + X-CSRF-Token + allowlist', () => {
  const candidate = (origins: string[] | string, credentials = true) => (app: INestApplication) => {
    app.setGlobalPrefix('api/v1');
    app.enableCors({ origin: origins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token'], credentials, maxAge: 600 });
  };

  it('origin được liệt kê: luồng cookie đi hết (preflight + thật), ACAO là origin cụ thể + ACAC:true', async () => {
    const app = await bootWith(candidate(['https://app.siscom.example']));
    try {
      expect(await browserFetch(app, { origin: 'https://app.siscom.example', path: '/api/v1/auth/refresh', method: 'POST', headers: COOKIE_FLOW, credentials: 'include' })).toEqual({ ok: true });
      const r = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://app.siscom.example');
      expect(r.headers['access-control-allow-origin']).toBe('https://app.siscom.example');
      expect(r.headers['access-control-allow-credentials']).toBe('true');
    } finally { await app.close(); }
  });

  it('origin lạ vẫn bị chặn dù credentials:true (không phản chiếu origin tùy ý)', async () => {
    const app = await bootWith(candidate(['https://app.siscom.example']));
    try {
      const v = await browserFetch(app, { origin: 'https://evil.example', path: '/api/v1/auth/refresh', method: 'POST', headers: COOKIE_FLOW, credentials: 'include' });
      expect(v).toMatchObject({ ok: false, stage: 'preflight' });
      const r = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://evil.example');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
      // Quan sát thật: thư viện cors vẫn phát ACAC:true cho origin lạ; vô hại vì thiếu ACAO => trình duyệt chặn (verdict ở trên). Không được dựa vào ACAC để kết luận.
    } finally { await app.close(); }
  });

  it('NGUY HIỂM (mô hình chặn): wildcard + credentials bị trình duyệt từ chối', async () => {
    const app = await bootWith(candidate('*'));
    try {
      const v = await browserFetch(app, { origin: 'https://app.siscom.example', path: '/api/v1/auth/refresh', method: 'POST', headers: COOKIE_FLOW, credentials: 'include' });
      expect(v).toMatchObject({ ok: false, stage: 'preflight' });
    } finally { await app.close(); }
  });

  it('NGUY HIỂM: allowlist là hàm/regex "phản chiếu mọi origin" + credentials sẽ qua trình duyệt => cấu hình đó phải bị cấm bằng review (test chứng minh vì sao)', async () => {
    const app = await bootWith((a) => {
      a.setGlobalPrefix('api/v1');
      a.enableCors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'] }); // origin:true = phản chiếu mọi origin
    });
    try {
      const v = await browserFetch(app, { origin: 'https://evil.example', path: '/api/v1/auth/refresh', method: 'POST', headers: COOKIE_FLOW, credentials: 'include' });
      expect(v).toEqual({ ok: true }); // trình duyệt SẼ cho trang evil đọc phản hồi có cookie => đây là cấu hình không được phép
    } finally { await app.close(); }
  });
});

// ---------- 3. Fixture/cấu hình triển khai: validateEnv + chính sách Origin PA6 ----------
describe('Kiểm tra cấu hình CORS_ORIGINS / AUTH_ALLOWED_ORIGINS (validateEnv thật)', () => {
  it('cấm "*" ở cả CORS_ORIGINS và AUTH_ALLOWED_ORIGINS', () => {
    expect(errorOf({ CORS_ORIGINS: '*' })).toMatch(/CORS_ORIGINS không được dùng \*/);
    expect(errorOf({ CORS_ORIGINS: 'https://app.siscom.example', AUTH_ALLOWED_ORIGINS: '*' })).toMatch(/AUTH_ALLOWED_ORIGINS không được dùng \*/);
  });
  it.each(['https://app.siscom.example/path', 'ftp://x.example', 'app.siscom.example', 'null'])('từ chối origin sai định dạng: %s', (o) => {
    expect(errorOf({ CORS_ORIGINS: o })).toMatch(/CORS_ORIGINS/);
  });
  it('production bắt buộc khai báo CORS_ORIGINS và COOKIE_SECURE không được false', () => {
    expect(errorOf({ NODE_ENV: 'production' })).toMatch(/bắt buộc khai báo CORS_ORIGINS/);
    expect(errorOf({ NODE_ENV: 'production', CORS_ORIGINS: 'https://crm.siscom.example', COOKIE_SECURE: 'false' })).toMatch(/COOKIE_SECURE=false/);
  });
  it('AUTH_ALLOWED_ORIGINS mặc định = CORS_ORIGINS; khai riêng thì tách biệt (PA6 chặt hơn CORS được)', () => {
    const e = env({ CORS_ORIGINS: 'https://app.siscom.example,https://admin.siscom.example', AUTH_ALLOWED_ORIGINS: 'https://app.siscom.example' });
    expect(e.AUTH_ALLOWED_ORIGIN_LIST).toEqual(['https://app.siscom.example']);
    const list = e.AUTH_ALLOWED_ORIGIN_LIST;
    expect(checkOrigin('https://app.siscom.example', list)).toEqual({ ok: true });
    expect(checkOrigin('https://admin.siscom.example', list)).toMatchObject({ ok: false, reason: 'ORIGIN_NOT_ALLOWED' }); // CORS cho qua nhưng PA6 từ chối
  });
  it('PA6: thiếu Origin / "null" / trùng header bị từ chối trên refresh & logout; route khác không thuộc chính sách', () => {
    const list = ['https://app.siscom.example'];
    const base = { csrfHeader: 'C'.repeat(43), allowedOrigins: list, storedCsrfHash: 'a'.repeat(64) };
    expect(checkRefreshLogoutCsrf({ ...base, route: 'refresh', originHeader: undefined })).toMatchObject({ reason: 'ORIGIN_MISSING' });
    expect(checkRefreshLogoutCsrf({ ...base, route: 'refresh', originHeader: 'null' })).toMatchObject({ reason: 'ORIGIN_INVALID' });
    expect(checkRefreshLogoutCsrf({ ...base, route: 'logout', originHeader: ['https://app.siscom.example', 'https://app.siscom.example'] })).toMatchObject({ reason: 'ORIGIN_INVALID' });
    expect(checkRefreshLogoutCsrf({ ...base, route: 'login', originHeader: 'https://app.siscom.example' })).toMatchObject({ reason: 'ROUTE_NOT_PROTECTED' });
  });

  // GAP: ghi nhận hành vi hiện tại, KHÔNG sửa production (phải được chủ sở hữu quyết định).
  it('GAP-1 (đặc trưng hiện tại): production vẫn chấp nhận origin http:// và localhost — validateEnv không ép HTTPS', () => {
    expect(() => env({ NODE_ENV: 'production', CORS_ORIGINS: 'http://crm.siscom.example,http://localhost:5173' })).not.toThrow();
  });
  it('GAP-2 (đặc trưng hiện tại): AUTH_ALLOWED_ORIGINS không bắt buộc là tập con của CORS_ORIGINS', () => {
    const e = env({ CORS_ORIGINS: 'https://app.siscom.example', AUTH_ALLOWED_ORIGINS: 'https://other.siscom.example' });
    expect(e.AUTH_ALLOWED_ORIGIN_LIST).toEqual(['https://other.siscom.example']); // PA6 cho phép origin mà CORS chặn => luồng cookie không bao giờ chạy
  });
});

// ---------- 4. Cookie PA6 × phương án triển khai ----------
describe('Cookie refresh PA6 (HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; không Domain) × phương án', () => {
  it('thuộc tính cố định, không Domain, không ghi đè', () => {
    const c = buildRefreshCookie('A'.repeat(43));
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/; Secure/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(new RegExp(`Path=${REFRESH_COOKIE_PATH}`));
    expect(c).not.toMatch(/Domain=/i);
    expect(() => buildRefreshCookie('A'.repeat(43), { sameSite: 'None' })).toThrow(); // không thể hạ xuống SameSite=None để "chữa" cross-site
  });

  // credentials mà frontend cần để cookie đi: authClient hiện dùng 'omit' => cookie KHÔNG BAO GIỜ được gửi, kể cả cùng origin.
  it('authClient hiện tại (credentials:omit) không gửi cookie ở bất kỳ phương án nào', () => {
    for (const s of Object.values(SCENARIOS)) expect(cookieSent(s.page, s.api, 'omit').sent).toBe(false);
  });

  it.each([
    ['winDevLocalhost', 'include', true],
    ['winDevMixedHost', 'include', false], // localhost vs 127.0.0.1 là KHÁC site => Strict chặn
    ['vpsSameOrigin', 'same-origin', true], // cùng origin: same-origin đủ, không cần CORS
    ['vpsSameOrigin', 'include', true],
    ['vpsApiSubdomain', 'same-origin', false], // khác origin => bắt buộc include
    ['vpsApiSubdomain', 'include', true], // cùng site => Strict vẫn gửi; cần CORS credentials:true
    ['vpsCrossSite', 'include', false], // khác site: Strict chặn, và SameSite=None bị chính sách cấm
  ] as const)('%s + credentials:%s => cookie gửi=%s', (name, cred, expected) => {
    const s = SCENARIOS[name];
    expect(cookieSent(s.page, s.api, cred).sent).toBe(expected);
  });

  it('cookie Secure + HTTP không-localhost (vd. LAN http://crm-server:8080 hoặc VPS chưa có TLS) không bao giờ được gửi', () => {
    const r = cookieSent('http://crm-server:8080', 'http://crm-server:8080/api/v1/auth/refresh', 'same-origin');
    expect(r).toEqual({ sent: false, why: 'Secure + API không phải HTTPS (không phải localhost)' });
  });

  it('cookie không gửi tới route ngoài Path /api/v1/auth', () => {
    expect(cookieSent('https://crm.siscom.example', 'https://crm.siscom.example/api/v1/customers', 'include').sent).toBe(false);
  });
});

// ---------- 5. Ma trận quyết định: phương án nào chạy được với CORS THẬT hiện hành ----------
describe('Ma trận phương án × cấu hình CORS thật (Bearer-only vs Bearer+cookie+CSRF)', () => {
  it.each(Object.entries(SCENARIOS))('%s: Bearer-only chạy; luồng cookie chỉ chạy nếu cùng origin', async (_name, s) => {
    const app = await bootLive({ CORS_ORIGINS: s.cors });
    try {
      const path = new URL(s.api).pathname;
      const sameOrigin = new URL(s.page).origin === new URL(s.api).origin;
      const bearer = await browserFetch(app, { origin: new URL(s.page).origin, path, method: 'POST', headers: BEARER, credentials: 'omit' });
      expect(bearer).toEqual({ ok: true }); // Bearer-only luôn qua CORS hiện hành khi origin được liệt kê
      if (sameOrigin) {
        // cùng origin: trình duyệt không áp CORS; luồng cookie dùng same-origin credentials, không cần ACAC
        expect(cookieSent(s.page, s.api, 'same-origin').sent).toBe(true);
      } else {
        const cookieFlow = await browserFetch(app, { origin: new URL(s.page).origin, path, method: 'POST', headers: COOKIE_FLOW, credentials: 'include' });
        expect(cookieFlow.ok).toBe(false); // cần đổi CORS (credentials:true + X-CSRF-Token) => thay đổi cấu hình triển khai, phải duyệt
      }
    } finally { await app.close(); }
  });
});
