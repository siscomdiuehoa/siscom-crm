import {
  REMEMBER_COOKIE_NAME, REMEMBER_COOKIE_PATH, REMEMBER_MAX_DAYS, REMEMBER_MAX_DEVICES, REMEMBER_RACE_GRACE_MS,
  buildRememberCookie, buildRememberCookieClear, classifyRememberFailure, readRememberCookie, rememberAbsExpiry,
} from './remember-token';
import { newOpaqueToken } from './session-token';

const DAY = 86_400_000;
const T0 = new Date('2026-01-10T00:00:00.000Z');

describe('hằng số chính sách Remember Me (Issue #177)', () => {
  it('tối đa 90 ngày và 5 thiết bị; cookie riêng, Path hẹp', () => {
    expect(REMEMBER_MAX_DAYS).toBe(90);
    expect(REMEMBER_MAX_DEVICES).toBe(5);
    expect(REMEMBER_COOKIE_NAME).toBe('siscom_rmb');
    expect(REMEMBER_COOKIE_PATH).toBe('/api/v1/auth');
    expect(REMEMBER_RACE_GRACE_MS).toBeGreaterThan(0);
    expect(REMEMBER_RACE_GRACE_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('rememberAbsExpiry — mốc 90 ngày tuyệt đối từ lần nhập mật khẩu', () => {
  it('đúng 90 × 24h theo UTC, không phụ thuộc múi giờ', () => {
    expect(rememberAbsExpiry(T0).getTime()).toBe(T0.getTime() + 90 * DAY);
    expect(rememberAbsExpiry(T0).toISOString()).toBe('2026-04-10T00:00:00.000Z');
  });
  it('không đổi khi đồng hồ tiến trình ở Asia/Ho_Chi_Minh hay UTC (chỉ dùng mili-giây)', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Ho_Chi_Minh';
      const a = rememberAbsExpiry(T0).getTime();
      process.env.TZ = 'UTC';
      expect(rememberAbsExpiry(T0).getTime()).toBe(a);
    } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  });
  it('từ chối Date không hợp lệ', () => {
    expect(() => rememberAbsExpiry(new Date('x'))).toThrow();
  });
});

describe('cookie siscom_rmb', () => {
  const token = newOpaqueToken();
  it('HttpOnly; SameSite=Lax; Path hẹp; Max-Age làm tròn xuống; Secure theo cấu hình', () => {
    const c = buildRememberCookie(token, { secure: true, maxAgeSeconds: 7_776_000.9 });
    expect(c).toBe(`siscom_rmb=${token}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=7776000; Secure`);
    expect(buildRememberCookie(token, { secure: false, maxAgeSeconds: 10 })).not.toContain('Secure');
  });
  it('không bao giờ đặt Max-Age vượt 90 ngày', () => {
    const c = buildRememberCookie(token, { secure: true, maxAgeSeconds: 200 * 86_400 });
    expect(c).toContain('Max-Age=7776000;');
  });
  it('từ chối token sai định dạng (không ghi cookie rác)', () => {
    expect(() => buildRememberCookie('abc', { secure: true, maxAgeSeconds: 10 })).toThrow('REMEMBER_TOKEN_FORMAT_INVALID');
  });
  it('xoá cookie: Max-Age=0, cùng Path/thuộc tính', () => {
    const c = buildRememberCookieClear({ secure: true });
    expect(c).toMatch(/^siscom_rmb=; Path=\/api\/v1\/auth; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure$/);
  });
  it('readRememberCookie: chỉ nhận đúng một cookie đúng định dạng; trùng/sai/thiếu => null', () => {
    expect(readRememberCookie(`a=1; siscom_rmb=${token}; b=2`)).toBe(token);
    expect(readRememberCookie(`siscom_rmb=${token}; siscom_rmb=${token}`)).toBeNull();
    expect(readRememberCookie('siscom_rmb=short')).toBeNull();
    expect(readRememberCookie(`siscom_sid=${token}`)).toBeNull();
    expect(readRememberCookie(undefined)).toBeNull();
    expect(readRememberCookie('x'.repeat(9000))).toBeNull();
  });
});

describe('classifyRememberFailure — phân loại khi compare-and-set thua', () => {
  const now = new Date('2026-02-01T12:00:00.000Z');
  const base = { revokedAt: null, rotatedAt: null, absExpiresAt: new Date(now.getTime() + DAY) };
  it('không có hàng => INVALID', () => expect(classifyRememberFailure(null, now)).toBe('INVALID'));
  it('đã thu hồi => INVALID', () => expect(classifyRememberFailure({ ...base, revokedAt: new Date(now.getTime() - 1) }, now)).toBe('INVALID'));
  it('hết hạn tuyệt đối (ngay mốc) => INVALID', () => {
    expect(classifyRememberFailure({ ...base, absExpiresAt: now }, now)).toBe('INVALID');
    expect(classifyRememberFailure({ ...base, absExpiresAt: new Date(now.getTime() - 1) }, now)).toBe('INVALID');
  });
  it('mới rotate trong cửa sổ cho phép => RACE (không báo replay)', () => {
    expect(classifyRememberFailure({ ...base, rotatedAt: new Date(now.getTime() - 1) }, now)).toBe('RACE');
    expect(classifyRememberFailure({ ...base, rotatedAt: new Date(now.getTime() - REMEMBER_RACE_GRACE_MS) }, now)).toBe('RACE');
  });
  it('rotate cũ hơn cửa sổ => REPLAY', () => {
    expect(classifyRememberFailure({ ...base, rotatedAt: new Date(now.getTime() - REMEMBER_RACE_GRACE_MS - 1) }, now)).toBe('REPLAY');
  });
  it('hàng chưa rotate, chưa thu hồi, chưa hết hạn mà CAS vẫn thua (không xảy ra) => INVALID fail-closed', () => {
    expect(classifyRememberFailure(base, now)).toBe('INVALID');
  });
  it('lệch đồng hồ giữa tiến trình: |tuổi| trong cửa sổ => RACE; lệch xa hơn cửa sổ => REPLAY (fail-closed)', () => {
    expect(classifyRememberFailure({ ...base, rotatedAt: new Date(now.getTime() + 5_000) }, now)).toBe('RACE');
    expect(classifyRememberFailure({ ...base, rotatedAt: new Date(now.getTime() + REMEMBER_RACE_GRACE_MS + 1) }, now)).toBe('REPLAY');
  });
});
