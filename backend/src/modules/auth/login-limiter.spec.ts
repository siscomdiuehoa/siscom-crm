import { LoginLimiter } from './login-limiter';

describe('LoginLimiter (cửa sổ cố định, trong bộ nhớ)', () => {
  const mk = (now: { t: number }, o = { windowMs: 1000, maxPerSource: 5, maxPerIdentifier: 2 }) => new LoginLimiter(o, () => now.t);

  it('cấu hình phải là số nguyên dương', () => {
    expect(() => new LoginLimiter({ windowMs: 0, maxPerSource: 1, maxPerIdentifier: 1 })).toThrow('LOGIN_LIMITER_CONFIG_INVALID');
    expect(() => new LoginLimiter({ windowMs: 1000, maxPerSource: 1.5, maxPerIdentifier: 1 })).toThrow('LOGIN_LIMITER_CONFIG_INVALID');
  });
  it('theo nguồn: lần thứ maxPerSource+1 trong cửa sổ bị từ chối; hết cửa sổ thì mở lại', () => {
    const now = { t: 1_000_000 }; const l = mk(now);
    for (let i = 0; i < 5; i++) expect(l.allow('10.0.0.1', null)).toBe(true);
    expect(l.allow('10.0.0.1', null)).toBe(false);
    expect(l.allow('10.0.0.2', null)).toBe(true); // nguồn khác không ảnh hưởng
    now.t += 1000;
    expect(l.allow('10.0.0.1', null)).toBe(true);
  });
  it('theo nguồn+danh tính: chặt hơn, nhưng KHÔNG khoá danh tính đó từ nguồn khác (chống DoS tài khoản)', () => {
    const now = { t: 5 }; const l = mk(now);
    expect(l.allow('A', 'e:u@x')).toBe(true);
    expect(l.allow('A', 'e:u@x')).toBe(true);
    expect(l.allow('A', 'e:u@x')).toBe(false);
    expect(l.allow('B', 'e:u@x')).toBe(true);
  });
  it('nguồn rỗng/không hợp lệ => từ chối; bộ nhớ có giới hạn', () => {
    const now = { t: 1 }; const l = new LoginLimiter({ windowMs: 1000, maxPerSource: 5, maxPerIdentifier: 2, maxKeys: 3 }, () => now.t);
    expect(l.allow('', null)).toBe(false);
    for (let i = 0; i < 10; i++) l.allow('src' + i, null);
    expect(l.size()).toBeLessThanOrEqual(3);
  });
});
