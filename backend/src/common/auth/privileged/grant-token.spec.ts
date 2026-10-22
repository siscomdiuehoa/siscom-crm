import { newSecret, sha256Hex, SECRET_RE, UUID_RE } from './grant-token';

// Chỉ test thuần Node: không DB, không .env.
describe('grant-token', () => {
  it('newSecret: 43 ký tự base64url, 1000 giá trị không trùng, dùng CSPRNG (không Math.random)', () => {
    const spy = jest.spyOn(Math, 'random');
    const all = Array.from({ length: 1000 }, () => newSecret());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(new Set(all).size).toBe(1000);
    for (const s of all) expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('sha256Hex: hex thường 64 ký tự, xác định, vector rỗng; từ chối kiểu không phải chuỗi', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('x')).toBe(sha256Hex('x'));
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
    for (const v of [undefined, null, 1, {}, Buffer.from('a')]) expect(() => sha256Hex(v as never)).toThrow(TypeError);
  });
  it('SECRET_RE: nhận 43..128, từ chối ngắn/dài/ký tự lạ/xuống dòng cuối/không phải chuỗi', () => {
    expect(SECRET_RE.test('a'.repeat(43))).toBe(true);
    expect(SECRET_RE.test('A-_'.repeat(42) + 'a')).toBe(true); // 127
    expect(SECRET_RE.test('a'.repeat(128))).toBe(true);
    for (const v of ['a'.repeat(42), 'a'.repeat(129), 'a'.repeat(42) + '+', 'a'.repeat(42) + '=', 'a'.repeat(43) + '\n', ' ' + 'a'.repeat(43), '']) {
      expect(SECRET_RE.test(v)).toBe(false);
    }
  });
  it('UUID_RE: nhận 8-4-4-4-12 hex (hoa/thường), từ chối sai dạng và xuống dòng cuối', () => {
    const u = 'f1397400-0000-4000-8000-000000000001';
    expect(UUID_RE.test(u)).toBe(true);
    expect(UUID_RE.test(u.toUpperCase())).toBe(true);
    for (const v of [u + '\n', u.slice(1), u.replace(/-/g, ''), 'g' + u.slice(1), '']) expect(UUID_RE.test(v)).toBe(false);
  });
});
