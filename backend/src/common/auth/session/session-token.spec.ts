import { buildSessionCookie, buildSessionCookieClear, isOpaqueToken, newOpaqueToken, readSessionCookie, SESSION_COOKIE_NAME, sha256Hex } from './session-token';

describe('session-token (thuần)', () => {
  it('token đục 43 ký tự base64url, mỗi lần khác nhau; băm SHA-256 hex 64', () => {
    const a = newOpaqueToken(), b = newOpaqueToken();
    expect(isOpaqueToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(isOpaqueToken('x'.repeat(42))).toBe(false);
    expect(isOpaqueToken('x'.repeat(43) + '=')).toBe(false);
  });
  it('cookie: HttpOnly, SameSite=Lax, Path=/api/v1, Max-Age; Secure theo cấu hình; không Domain', () => {
    const t = newOpaqueToken();
    const c = buildSessionCookie(t, { secure: true, maxAgeSeconds: 600.7 });
    expect(c).toBe(`${SESSION_COOKIE_NAME}=${t}; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=600; Secure`);
    expect(buildSessionCookie(t, { secure: false, maxAgeSeconds: 1 })).not.toMatch(/Secure/);
    expect(buildSessionCookie(t, { secure: false, maxAgeSeconds: 0 })).toMatch(/Max-Age=1/);
    expect(() => buildSessionCookie('bad', { secure: true, maxAgeSeconds: 1 })).toThrow('SESSION_TOKEN_FORMAT_INVALID');
    expect(buildSessionCookieClear({ secure: true })).toMatch(/^siscom_sid=; Path=\/api\/v1; HttpOnly; SameSite=Lax; Max-Age=0; Expires=.*; Secure$/);
  });
  it('đọc cookie: chỉ nhận đúng tên + đúng định dạng; trùng tên, sai định dạng, thiếu, quá dài => null', () => {
    const t = newOpaqueToken();
    expect(readSessionCookie(`a=1; ${SESSION_COOKIE_NAME}=${t}; b=2`)).toBe(t);
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}= ${t} `)).toBe(t);
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=${t}; ${SESSION_COOKIE_NAME}=${t}`)).toBeNull();
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=abc`)).toBeNull();
    expect(readSessionCookie(`other=${t}`)).toBeNull();
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie(['a'])).toBeNull();
    expect(readSessionCookie('x'.repeat(9000))).toBeNull();
  });
});
