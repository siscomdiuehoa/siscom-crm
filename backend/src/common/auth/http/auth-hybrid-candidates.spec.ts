import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AuthHttpHandler } from './auth-http.handler';
import { checkRefreshLogoutCsrf } from '../session/csrf-origin.policy';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, buildRefreshCookie, buildRefreshCookieClear } from '../session/refresh-cookie.policy';

// ĐÁNH GIÁ 3 thiết kế ứng viên (KHÔNG chọn, KHÔNG bật): (A) Bearer-only (access trong bộ nhớ, không refresh);
// (B) phiên cookie + CSRF; (C) access Bearer trong bộ nhớ + refresh cookie HttpOnly, CSRF trên refresh/logout.
// Chỉ TEST: mô hình tham chiếu ứng viên C bên dưới sống trong file này, ghép các hàm chính sách PA6 THẬT; không controller, không DI,
// không route, không DB, không bí mật. Điều gì cần route chưa tồn tại => khẳng định NOT_ACTIVE (không giả PASS).
// Nền sự thật đã đọc từ mã: backend head PR #84 (14dff07, PA6 policy + A4 handler); frontend PR #83 (head 95a9dbb):
// authClient.js và customerApiClient.js đều dùng credentials:'omit', chỉ gắn Authorization.
// GIỚI HẠN: frontend không nằm trong nhánh này nên KHÔNG có test đọc mã frontend (tránh giả PASS); sự thật frontend ở trên đọc thủ công từ git.

const SRC = join(__dirname, '..', '..', '..'); // backend/src
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
};
const prodFiles = () => walk(SRC).filter((f) => !/\.(spec|test)\.ts$/.test(f));

// ===================== Mô hình tham chiếu ứng viên C (CHỈ TEST) =====================
const tok = () => randomBytes(32).toString('base64url'); // 43 ký tự
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const ALLOWED = ['https://crm.example.test'];
const API = '/api/v1';
const NOW = Date.UTC(2026, 9, 23);

interface Req { path: string; headers?: Record<string, string>; cookies?: Record<string, string> }
interface Res { status: number; body: Record<string, unknown>; setCookie: string[] }
interface Row { csrfHash: string; active: boolean }

class CandidateCModel {
  readonly rows = new Map<string, Row>(); // key = sha256(refresh token)
  private issue(): { refresh: string; csrf: string; res: Res } {
    const refresh = tok(), csrf = tok();
    this.rows.set(sha(refresh), { csrfHash: sha(csrf), active: true });
    // GIẢ ĐỊNH D7 (chưa chốt): CSRF token trả trong thân JSON; access token là chuỗi giả, KHÔNG phải JWT thật.
    return { refresh, csrf, res: { status: 200, body: { token: 'access-stub', expiresAt: new Date(NOW + 60_000).toISOString(), csrfToken: csrf }, setCookie: [buildRefreshCookie(refresh)] } };
  }
  login(): { refresh: string; csrf: string; res: Res } { return this.issue(); }

  private lookup(r: Req): { key: string; row: Row } | null {
    const t = r.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof t !== 'string') return null;
    const key = sha(t), row = this.rows.get(key);
    return row && row.active ? { key, row } : null;
  }
  private csrf(route: 'refresh' | 'logout', r: Req, row: Row | undefined): Res | null {
    const c = checkRefreshLogoutCsrf({ route, originHeader: r.headers?.origin, csrfHeader: r.headers?.['x-csrf-token'], allowedOrigins: ALLOWED, storedCsrfHash: row?.csrfHash });
    return c.ok ? null : { status: 403, body: { error: { code: c.code } }, setCookie: [] }; // thân chỉ mã cố định, không phản chiếu đầu vào
  }
  // Thứ tự bất biến: tra phiên theo cookie -> (không có) 401; kiểm CSRF -> 403 không đổi trạng thái; xoay refresh.
  refresh(r: Req): Res {
    const hit = this.lookup(r);
    if (!hit) return { status: 401, body: { error: { code: 'AUTH_REQUIRED' } }, setCookie: [] };
    const denied = this.csrf('refresh', r, hit.row);
    if (denied) return denied;
    hit.row.active = false; // xoay: cookie cũ chết ngay
    return this.issue().res;
  }
  // QUYẾT ĐỊNH D1 CHƯA CHỐT: mô hình chọn fail-closed (không cookie => không có băm CSRF => 403), KHÁC logout idempotent 200 của handler A4.
  logout(r: Req): Res {
    const hit = this.lookup(r);
    const denied = this.csrf('logout', r, hit?.row);
    if (denied) return denied;
    hit!.row.active = false;
    return { status: 200, body: { ok: true }, setCookie: [buildRefreshCookieClear()] };
  }
}

// RFC 6265 path-match: trình duyệt chỉ gửi cookie khi path khớp.
const cookieSentTo = (cookiePath: string, requestPath: string) =>
  requestPath === cookiePath || (requestPath.startsWith(cookiePath) && (cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'));

const goodReq = (refresh: string, csrf: string, path: string): Req =>
  ({ path, headers: { origin: ALLOWED[0], 'x-csrf-token': csrf }, cookies: { [REFRESH_COOKIE_NAME]: refresh } });

describe('Ứng viên C — bất biến hợp đồng (mô hình test-only trên chính sách PA6 thật)', () => {
  it('login: 200, thân đúng 3 khóa, refresh token CHỈ ở Set-Cookie HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth, không Domain/Max-Age', () => {
    const { refresh, res } = new CandidateCModel().login();
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['csrfToken', 'expiresAt', 'token']);
    expect(JSON.stringify(res.body)).not.toContain(refresh);
    expect(res.setCookie).toEqual([`siscom_rt=${refresh}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict`]);
    expect(res.setCookie.join(';')).not.toMatch(/Domain=|Max-Age|Expires/i);
    expect(res.setCookie.join(';')).not.toContain('access-stub'); // access token không bao giờ vào cookie
  });

  it('phạm vi cookie: gửi tới /api/v1/auth và /api/v1/auth/refresh; KHÔNG gửi tới /api/v1/customers, /api/v1/authx, /', () => {
    expect(REFRESH_COOKIE_PATH).toBe(`${API}/auth`);
    for (const p of [`${API}/auth`, `${API}/auth/refresh`, `${API}/auth/logout`]) expect(cookieSentTo(REFRESH_COOKIE_PATH, p)).toBe(true);
    for (const p of [`${API}/customers`, `${API}/authx`, `${API}/auth-admin/x`, '/', '/api/v1']) expect(cookieSentTo(REFRESH_COOKIE_PATH, p)).toBe(false);
  });

  it('refresh hợp lệ: 200, xoay cookie (giá trị mới, CSRF mới), cookie cũ chết; phát lại cookie cũ -> 401 không Set-Cookie', () => {
    const m = new CandidateCModel();
    const a = m.login();
    const r1 = m.refresh(goodReq(a.refresh, a.csrf, `${API}/auth/refresh`));
    expect(r1.status).toBe(200);
    expect(r1.setCookie).toHaveLength(1);
    expect(r1.setCookie[0]).not.toContain(a.refresh);
    expect(r1.body.csrfToken).not.toBe(a.csrf);
    const replay = m.refresh(goodReq(a.refresh, a.csrf, `${API}/auth/refresh`));
    expect([replay.status, replay.setCookie]).toEqual([401, []]);
  });

  const csrfFailures: ReadonlyArray<readonly [string, (a: { refresh: string; csrf: string }) => Req]> = [
    ['thiếu Origin', (a) => ({ path: 'x', headers: { 'x-csrf-token': a.csrf }, cookies: { siscom_rt: a.refresh } })],
    ['Origin "null"', (a) => ({ path: 'x', headers: { origin: 'null', 'x-csrf-token': a.csrf }, cookies: { siscom_rt: a.refresh } })],
    ['Origin ngoài allowlist', (a) => ({ path: 'x', headers: { origin: 'https://evil.test', 'x-csrf-token': a.csrf }, cookies: { siscom_rt: a.refresh } })],
    ['Origin có path', (a) => ({ path: 'x', headers: { origin: ALLOWED[0] + '/x', 'x-csrf-token': a.csrf }, cookies: { siscom_rt: a.refresh } })],
    ['thiếu X-CSRF-Token', (a) => ({ path: 'x', headers: { origin: ALLOWED[0] }, cookies: { siscom_rt: a.refresh } })],
    ['X-CSRF-Token sai hình dạng', (a) => ({ path: 'x', headers: { origin: ALLOWED[0], 'x-csrf-token': 'short' }, cookies: { siscom_rt: a.refresh } })],
    ['X-CSRF-Token đúng hình dạng nhưng của phiên khác', (a) => ({ path: 'x', headers: { origin: ALLOWED[0], 'x-csrf-token': tok() }, cookies: { siscom_rt: a.refresh } })],
  ];
  it.each(csrfFailures)('refresh và logout, %s: 403 CSRF_FAILED, không Set-Cookie, không đổi trạng thái phiên, thân không phản chiếu đầu vào', (_n, mk) => {
    for (const op of ['refresh', 'logout'] as const) {
      const m = new CandidateCModel();
      const a = m.login();
      const req = mk(a);
      const r = m[op](req);
      expect([r.status, r.setCookie]).toEqual([403, []]);
      expect(r.body).toEqual({ error: { code: 'CSRF_FAILED' } });
      expect(JSON.stringify(r.body)).not.toContain(req.headers?.origin ?? '\u0000');
      expect([...m.rows.values()].every((x) => x.active)).toBe(true);
      expect(m.refresh(goodReq(a.refresh, a.csrf, 'x')).status).toBe(200); // phiên vẫn dùng được
    }
  });

  it('refresh không cookie / cookie lạ -> 401, không Set-Cookie, không kiểm CSRF để lộ tồn tại phiên', () => {
    const m = new CandidateCModel();
    for (const cookies of [undefined, {}, { siscom_rt: tok() }] as Array<Record<string, string> | undefined>) {
      const r = m.refresh({ path: 'x', headers: { origin: ALLOWED[0], 'x-csrf-token': tok() }, cookies });
      expect([r.status, r.setCookie, r.body]).toEqual([401, [], { error: { code: 'AUTH_REQUIRED' } }]);
    }
  });

  it('logout hợp lệ: 200 {ok:true}, Set-Cookie xóa đúng Name+Path (Max-Age=0), phiên bị thu hồi, refresh sau đó -> 401', () => {
    const m = new CandidateCModel();
    const a = m.login();
    const r = m.logout(goodReq(a.refresh, a.csrf, `${API}/auth/logout`));
    expect([r.status, r.body]).toEqual([200, { ok: true }]);
    expect(r.setCookie).toEqual([buildRefreshCookieClear()]);
    expect(r.setCookie[0]).toMatch(/^siscom_rt=; Path=\/api\/v1\/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=0/);
    expect(m.refresh(goodReq(a.refresh, a.csrf, 'x')).status).toBe(401);
  });

  it('D1 (chưa chốt) logout không cookie: mô hình C fail-closed 403 — KHÁC handler A4 idempotent 200; khóa sự khác biệt này để chủ sở hữu quyết', () => {
    const r = new CandidateCModel().logout({ path: 'x', headers: { origin: ALLOWED[0], 'x-csrf-token': tok() } });
    expect([r.status, r.body]).toEqual([403, { error: { code: 'CSRF_FAILED' } }]);
  });

  it('chính sách PA6 chỉ áp refresh/logout: route khác (kể cả ứng viên B cần bảo vệ mọi route ghi) -> ROUTE_NOT_PROTECTED', () => {
    for (const route of ['customers.create', 'customers.update', 'login', '']) {
      expect(checkRefreshLogoutCsrf({ route, originHeader: ALLOWED[0], csrfHeader: tok(), allowedOrigins: ALLOWED, storedCsrfHash: sha(tok()) }))
        .toEqual({ ok: false, code: 'CSRF_FAILED', reason: 'ROUTE_NOT_PROTECTED' });
    }
  });
});

// ===================== NOT_ACTIVE: những gì C cần mà kho CHƯA có (không giả PASS) =====================
describe('NOT_ACTIVE — ứng viên C chưa được kích hoạt ở mã production (các test này là chốt chặn; đổi chúng chỉ trong PR triển khai được duyệt)', () => {
  const setup = read('app.setup.ts');

  it('NOT_ACTIVE route: không @Controller("auth"), không route refresh, handler A4 không có refresh()', () => {
    expect(prodFiles().filter((f) => /@Controller\(\s*['"`]auth/.test(readFileSync(f, 'utf8')))).toEqual([]);
    expect(prodFiles().filter((f) => /@(Post|Get)\(\s*['"`]refresh['"`]/.test(readFileSync(f, 'utf8')))).toEqual([]);
    expect(Object.getOwnPropertyNames(AuthHttpHandler.prototype).sort()).toEqual(['constructor', 'login', 'logout', 'me']);
  });

  it('NOT_ACTIVE CORS: credentials:false và allowedHeaders không có X-CSRF-Token => trình duyệt không thể gọi refresh/logout bằng cookie', () => {
    expect(setup).toMatch(/credentials:\s*false/);
    expect(setup).not.toMatch(/X-CSRF-Token/i);
    expect(setup).toMatch(/allowedHeaders:\s*\[[^\]]*'Authorization'/);
  });

  it('NOT_ACTIVE ghi cookie: không mã production nào ngoài chính sách PA6 gọi buildRefreshCookie* hoặc set header Set-Cookie', () => {
    const users = prodFiles().filter((f) => !f.includes(join('auth', 'session', 'refresh-cookie.policy.ts')) && /buildRefreshCookie|[Ss]et-Cookie|res\.cookie\(/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual([]);
  });

  it('CHÍNH SÁCH ĐÃ CÓ (chỉ hàm thuần): PA6 cookie + CSRF có mặt và không đổi hằng số hợp đồng', () => {
    expect([REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH]).toEqual(['siscom_rt', '/api/v1/auth']);
  });
});

// ===================== Ma trận so sánh A/B/C, tính từ sự thật của kho =====================
const facts = {
  handlerHasLoginLogoutMe: ['login', 'logout', 'me'].every((m) => typeof (AuthHttpHandler.prototype as unknown as Record<string, unknown>)[m] === 'function'),
  corsBearerReady: /credentials:\s*false/.test(read('app.setup.ts')) && /allowedHeaders:\s*\[[^\]]*'Authorization'/.test(read('app.setup.ts')),
  corsCookieCsrfReady: /credentials:\s*true/.test(read('app.setup.ts')) && /X-CSRF-Token/i.test(read('app.setup.ts')),
  csrfPolicyCoversAllUnsafeRoutes: (() => {
    const r = checkRefreshLogoutCsrf({ route: 'customers.create', originHeader: ALLOWED[0], csrfHeader: tok(), allowedOrigins: ALLOWED, storedCsrfHash: sha(tok()) });
    return r.ok || r.reason !== 'ROUTE_NOT_PROTECTED';
  })(),
  refreshPolicyPresent: typeof buildRefreshCookie === 'function' && typeof checkRefreshLogoutCsrf === 'function',
  refreshRouteActive: prodFiles().some((f) => /@Post\(\s*['"`]refresh['"`]/.test(readFileSync(f, 'utf8'))),
};

type Cell = 'READY_OFFLINE' | 'POLICY_ONLY' | 'MISSING';
const readiness = (): Record<'A' | 'B' | 'C', Record<'server' | 'cors' | 'csrf' | 'refreshAfterReload', Cell>> => ({
  A: { server: facts.handlerHasLoginLogoutMe ? 'READY_OFFLINE' : 'MISSING', cors: facts.corsBearerReady ? 'READY_OFFLINE' : 'MISSING', csrf: 'READY_OFFLINE' /* không cookie => không CSRF */, refreshAfterReload: 'MISSING' /* thiết kế: đăng nhập lại */ },
  B: { server: 'MISSING', cors: facts.corsCookieCsrfReady ? 'READY_OFFLINE' : 'MISSING', csrf: facts.csrfPolicyCoversAllUnsafeRoutes ? 'READY_OFFLINE' : 'MISSING', refreshAfterReload: 'MISSING' },
  C: { server: facts.refreshPolicyPresent && !facts.refreshRouteActive ? 'POLICY_ONLY' : 'MISSING', cors: facts.corsCookieCsrfReady ? 'READY_OFFLINE' : 'MISSING', csrf: facts.refreshPolicyPresent ? 'POLICY_ONLY' : 'MISSING', refreshAfterReload: 'POLICY_ONLY' },
});

describe('Ma trận A/B/C — kỳ vọng bất biến theo trạng thái kho hiện tại (đổi khi PR triển khai đổi sự thật; KHÔNG phải lựa chọn)', () => {
  it('trạng thái sẵn sàng đúng bảng (nếu test này đỏ, ai đó đã đổi sự thật: cập nhật bảng quyết định + PR riêng)', () => {
    expect(readiness()).toEqual({
      A: { server: 'READY_OFFLINE', cors: 'READY_OFFLINE', csrf: 'READY_OFFLINE', refreshAfterReload: 'MISSING' },
      B: { server: 'MISSING', cors: 'MISSING', csrf: 'MISSING', refreshAfterReload: 'MISSING' },
      C: { server: 'POLICY_ONLY', cors: 'MISSING', csrf: 'POLICY_ONLY', refreshAfterReload: 'POLICY_ONLY' },
    });
  });

  it('KHÔNG ứng viên nào được chọn hay bật: route refresh không hoạt động, CORS vẫn Bearer-only', () => {
    expect(facts.refreshRouteActive).toBe(false);
    expect(facts.corsBearerReady).toBe(true);
    expect(facts.corsCookieCsrfReady).toBe(false);
  });
});

// Bảng quyết định chủ sở hữu (6 mục CHƯA CHỐT, khớp OWNER_DECISIONS LỆCH-1..6 của #84) — mỗi dòng nêu ảnh hưởng lên A / B / C.
export const OWNER_DECISION_TABLE = Object.freeze({
  D1_logout: { question: 'Logout: Bearer idempotent 200 (A4) hay cookie+CSRF (PA6)?', A: 'Bearer, idempotent', B: 'cookie+CSRF mọi route', C: 'cookie+CSRF; mô hình fail-closed 403 khi thiếu cookie' },
  D2_cors: { question: 'CORS credentials/X-CSRF-Token/SameSite=Strict (cần cùng site)?', A: 'giữ credentials:false', B: 'credentials:true + CSRF header', C: 'credentials:true chỉ cho /auth/*, thêm X-CSRF-Token' },
  D3_limiter: { question: 'Nguồn limiter đáng tin (socket/trust proxy)?', A: 'cần', B: 'cần', C: 'cần (login và refresh)' },
  D4_infra: { question: 'Lỗi hạ tầng khi đăng nhập: 401 (hiện tại) hay 503?', A: 'cần chốt', B: 'cần chốt', C: 'cần chốt (refresh lỗi kho: 401 hay 503?)' },
  D5_401: { question: 'Thống nhất mã 401 (LOGIN_INVALID/AUTH_REQUIRED/UNAUTHENTICATED)?', A: 'cần chốt', B: 'cần chốt', C: 'mô hình dùng AUTH_REQUIRED cho refresh — chưa chốt' },
  D6_route: { question: 'VITE_CRM_API_BASE gồm /api/v1; đường dẫn /auth/*?', A: 'cần', B: 'cần', C: 'cần; cookie Path=/api/v1/auth ràng buộc tiền tố' },
});

describe('Bảng quyết định chủ sở hữu', () => {
  it('đủ 6 quyết định chưa chốt, mỗi quyết định có ảnh hưởng cho cả A, B, C', () => {
    expect(Object.keys(OWNER_DECISION_TABLE)).toEqual(['D1_logout', 'D2_cors', 'D3_limiter', 'D4_infra', 'D5_401', 'D6_route']);
    for (const d of Object.values(OWNER_DECISION_TABLE)) expect([d.question, d.A, d.B, d.C].every((s) => s.length > 0)).toBe(true);
  });
});
