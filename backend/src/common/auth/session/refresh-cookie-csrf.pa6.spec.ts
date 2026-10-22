import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  RefreshCookiePolicyError,
  buildRefreshCookie,
  buildRefreshCookieClear,
} from './refresh-cookie.policy';
import { checkCsrfToken, checkOrigin, checkRefreshLogoutCsrf } from './csrf-origin.policy';

const tok = () => randomBytes(32).toString('base64url'); // 43 ký tự
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const ALLOWED = ['https://crm.example.test', 'http://localhost:5173'];

describe('PA6 refresh cookie', () => {
  it('đặt cookie: đúng tên, HttpOnly, Secure, SameSite=Strict, Path hẹp, không Domain', () => {
    const t = tok();
    const c = buildRefreshCookie(t);
    expect(c).toBe(`siscom_rt=${t}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict`);
    expect(REFRESH_COOKIE_NAME).toBe('siscom_rt');
    expect(c).not.toMatch(/Domain=/i);
    expect(c).not.toMatch(/Max-Age|Expires/i); // chưa chốt => bỏ
  });

  it('xóa cookie: Name + Path trùng cookie đặt, có Max-Age=0 và cờ bảo mật', () => {
    const set = buildRefreshCookie(tok());
    const clr = buildRefreshCookieClear();
    const path = (s: string) => /Path=([^;]+)/.exec(s)![1];
    expect(path(clr)).toBe(path(set));
    expect(path(clr)).toBe(REFRESH_COOKIE_PATH);
    expect(clr.startsWith('siscom_rt=;')).toBe(true);
    expect(clr).toMatch(/Max-Age=0/);
    expect(clr).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(clr).not.toMatch(/Domain=/i);
  });

  it.each([
    [{ domain: 'example.com' }],
    [{ path: '/' }],
    [{ secure: false }],
    [{ sameSite: 'Lax' }],
    [{ httpOnly: false }],
    [{ name: '__Host-rt' }],
    ['Domain=evil.test'],
    [null],
  ])('từ chối ghi đè %j', (ov) => {
    expect(() => buildRefreshCookie(tok(), ov)).toThrow(RefreshCookiePolicyError);
    expect(() => buildRefreshCookieClear(ov)).toThrow(RefreshCookiePolicyError);
  });

  it('chấp nhận overrides rỗng/không có', () => {
    expect(buildRefreshCookie(tok(), {})).toMatch(/^siscom_rt=/);
    expect(buildRefreshCookieClear(undefined)).toMatch(/^siscom_rt=;/);
  });

  it.each([
    [''],
    ['abc'],
    [tok() + 'A'],
    ['a;b' + 'x'.repeat(40)],
    ['x'.repeat(43) + '\r\nSet-Cookie: a=b'],
    [123],
    [undefined],
    [null],
  ])('từ chối refresh token sai định dạng %p (chống chèn header)', (v) => {
    expect(() => buildRefreshCookie(v)).toThrow(RefreshCookiePolicyError);
  });

  it('lỗi không chứa giá trị token', () => {
    const bad = 'secretvalue;' + 'x'.repeat(40);
    let caught: unknown;
    try {
      buildRefreshCookie(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RefreshCookiePolicyError);
    expect(String((caught as Error).message)).not.toContain('secretvalue');
    expect(JSON.stringify(caught)).not.toContain('secretvalue');
  });
});

describe('PA6 Origin', () => {
  it('khớp chính xác origin được cho phép', () => {
    expect(checkOrigin('https://crm.example.test', ALLOWED)).toEqual({ ok: true });
    expect(checkOrigin('http://localhost:5173', ALLOWED)).toEqual({ ok: true });
  });

  it.each([undefined, ''])('thiếu Origin (%p) => từ chối', (o) => {
    expect(checkOrigin(o, ALLOWED)).toMatchObject({ ok: false, reason: 'ORIGIN_MISSING' });
  });

  it.each([
    'https://evil.test',
    'http://crm.example.test', // khác scheme
    'https://crm.example.test:8443', // khác port
    'https://sub.crm.example.test',
    'https://crm.example.test.evil.test',
    'http://localhost:5174',
  ])('sai origin %s => ORIGIN_NOT_ALLOWED', (o) => {
    expect(checkOrigin(o, ALLOWED)).toMatchObject({ ok: false, reason: 'ORIGIN_NOT_ALLOWED' });
  });

  it.each([
    'null',
    'file:///x',
    'https://crm.example.test/',
    'https://crm.example.test/path',
    'https://user@crm.example.test',
    'HTTPS://CRM.EXAMPLE.TEST ',
    'not a url',
    ['https://crm.example.test', 'https://crm.example.test'],
    42,
  ])('Origin không hợp lệ %p => ORIGIN_INVALID', (o) => {
    expect(checkOrigin(o, ALLOWED)).toMatchObject({ ok: false, reason: 'ORIGIN_INVALID' });
  });

  it.each([
    undefined,
    null,
    [],
    'https://crm.example.test',
    [''],
    ['*'],
    ['null'],
    ['https://a.test/'],
    ['https://ok.test', 'bad'],
    [1],
  ])('allowlist thiếu/hỏng %p => fail-closed kể cả Origin đúng', (cfg) => {
    expect(checkOrigin('https://crm.example.test', cfg)).toMatchObject({ ok: false, reason: 'ORIGIN_CONFIG_INVALID' });
  });
});

describe('PA6 CSRF token', () => {
  it('khớp băm gắn phiên', () => {
    const t = tok();
    expect(checkCsrfToken(t, sha(t))).toEqual({ ok: true });
  });

  it('thiếu header', () => {
    expect(checkCsrfToken(undefined, sha(tok()))).toMatchObject({ ok: false, reason: 'CSRF_HEADER_MISSING' });
    expect(checkCsrfToken('', sha(tok()))).toMatchObject({ ok: false, reason: 'CSRF_HEADER_MISSING' });
  });

  it('không khớp', () => {
    expect(checkCsrfToken(tok(), sha(tok()))).toMatchObject({ ok: false, code: 'CSRF_FAILED', reason: 'CSRF_MISMATCH' });
  });

  it('token cũ sau rotate bị từ chối, token mới được chấp nhận', () => {
    const oldT = tok();
    const newT = tok();
    const storedAfterRotate = sha(newT);
    expect(checkCsrfToken(oldT, storedAfterRotate)).toMatchObject({ ok: false, reason: 'CSRF_MISMATCH' });
    expect(checkCsrfToken(newT, storedAfterRotate)).toEqual({ ok: true });
  });

  it.each([
    'short',
    'x'.repeat(42),
    'x'.repeat(44),
    'x'.repeat(42) + '=',
    'x'.repeat(42) + '+',
    'x'.repeat(42) + '/',
    'x'.repeat(42) + ' ',
    ['a'],
    7,
    null,
  ])('header sai độ dài/định dạng %p', (h) => {
    expect(checkCsrfToken(h, sha(tok()))).toMatchObject({ ok: false, reason: 'CSRF_HEADER_INVALID' });
  });

  it.each([undefined, null, '', 'abc', sha('x').toUpperCase(), sha('x') + '0', sha('x').slice(1), 5])(
    'băm lưu hỏng %p => fail-closed',
    (h) => {
      expect(checkCsrfToken(tok(), h)).toMatchObject({ ok: false, reason: 'CSRF_HASH_INVALID' });
    },
  );

  it('kết quả lỗi không chứa token/băm', () => {
    const t = tok();
    const h = sha(tok());
    const r = JSON.stringify(checkCsrfToken(t, h));
    expect(r).not.toContain(t);
    expect(r).not.toContain(h);
  });

  it('dùng timingSafeEqual trên hai digest 32 byte', () => {
    const src = readFileSync(join(__dirname, 'csrf-origin.policy.ts'), 'utf8');
    expect(src).toMatch(/timingSafeEqual\(got, want\)/);
    expect(src).toMatch(/got\.length === want\.length/);
  });
});

describe('PA6 checkRefreshLogoutCsrf', () => {
  const t = tok();
  const base = { originHeader: 'https://crm.example.test', csrfHeader: t, allowedOrigins: ALLOWED, storedCsrfHash: sha(t) };

  it.each(['refresh', 'logout'])('route %s hợp lệ', (route) => {
    expect(checkRefreshLogoutCsrf({ ...base, route })).toEqual({ ok: true });
  });

  it.each(['login', 'logout-all', 'change-password', '', 'REFRESH'])('route %p ngoài tài liệu => từ chối', (route) => {
    expect(checkRefreshLogoutCsrf({ ...base, route })).toMatchObject({ ok: false, reason: 'ROUTE_NOT_PROTECTED' });
  });

  it('Origin sai bị chặn dù token đúng', () => {
    expect(checkRefreshLogoutCsrf({ ...base, route: 'refresh', originHeader: 'https://evil.test' })).toMatchObject({
      ok: false,
      reason: 'ORIGIN_NOT_ALLOWED',
    });
  });

  it('thiếu Origin bị chặn dù token đúng', () => {
    expect(checkRefreshLogoutCsrf({ ...base, route: 'logout', originHeader: undefined })).toMatchObject({
      reason: 'ORIGIN_MISSING',
    });
  });

  it('thiếu cấu hình allowlist => từ chối', () => {
    expect(checkRefreshLogoutCsrf({ ...base, route: 'refresh', allowedOrigins: undefined })).toMatchObject({
      reason: 'ORIGIN_CONFIG_INVALID',
    });
  });

  it('Origin đúng nhưng token thiếu/sai bị chặn', () => {
    expect(checkRefreshLogoutCsrf({ ...base, route: 'refresh', csrfHeader: undefined })).toMatchObject({
      reason: 'CSRF_HEADER_MISSING',
    });
    expect(checkRefreshLogoutCsrf({ ...base, route: 'refresh', csrfHeader: tok() })).toMatchObject({
      reason: 'CSRF_MISMATCH',
    });
  });
});

describe('PA6 phạm vi mã nguồn', () => {
  it.each(['refresh-cookie.policy.ts', 'csrf-origin.policy.ts'])('%s: không env/log/DB/JWT/Nest', (f) => {
    const code = readFileSync(join(__dirname, f), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/process\.env|console\.|Logger|prisma|@nestjs|jsonwebtoken|\.sign\(|@Controller|@Module/i);
  });
});
