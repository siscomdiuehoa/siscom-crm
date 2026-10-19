import { validateEnv } from './env.validation';

// Giá trị giả, chỉ dùng cho test (không phải bí mật thật).
const BASE = { DATABASE_URL: 'postgresql://siscom_app:unit-test-only@127.0.0.1:5432/siscom_crm_test_unit?schema=public' };
const SECRET = 'unit-test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_PREV = 'unit-test-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const run = (o: Record<string, unknown> = {}) => validateEnv({ ...BASE, ...o });
const errorOf = (o: Record<string, unknown>): string => {
  try { run(o); } catch (e) { return (e as Error).message; }
  throw new Error('expected validateEnv to throw');
};

describe('validateEnv — biến xác thực (B1.3.2-A)', () => {
  it('không có biến auth: vẫn hợp lệ (JWT_ACCESS_SECRET chưa bắt buộc ở gói A), trả mặc định an toàn', () => {
    const env = run();
    expect(env.JWT_ACCESS_SECRET).toBeUndefined();
    expect(env.JWT_ACCESS_SECRET_PREV).toBeUndefined();
    expect(env.ACCESS_TTL_SECONDS).toBe(600);
    expect(env.REFRESH_IDLE_DAYS).toBe(7);
    expect(env.REFRESH_ABS_DAYS).toBe(30);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.AUTH_ALLOWED_ORIGIN_LIST).toEqual(env.CORS_ORIGIN_LIST);
  });

  it('không đổi kết quả các biến cũ', () => {
    const env = run({ PORT: '3001', LOG_LEVEL: 'warn' });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVELS).toEqual(['error', 'fatal', 'warn']);
  });

  it('nhận JWT_ACCESS_SECRET >= 32 byte và khóa cũ khác khóa hiện tại', () => {
    const env = run({ JWT_ACCESS_SECRET: SECRET, JWT_ACCESS_SECRET_PREV: SECRET_PREV });
    expect(env.JWT_ACCESS_SECRET).toBe(SECRET);
    expect(env.JWT_ACCESS_SECRET_PREV).toBe(SECRET_PREV);
  });

  it('từ chối khóa ngắn, chỉ nêu TÊN biến, không in giá trị', () => {
    const short = 'short-secret-value-123';
    const msg = errorOf({ JWT_ACCESS_SECRET: short });
    expect(msg).toContain('JWT_ACCESS_SECRET phải dài tối thiểu 32 byte');
    expect(msg).not.toContain(short);
  });

  it('từ chối khóa mẫu CHANGE_ME và không in giá trị', () => {
    const sample = 'CHANGE_ME_' + 'x'.repeat(40);
    const msg = errorOf({ JWT_ACCESS_SECRET: sample });
    expect(msg).toContain('JWT_ACCESS_SECRET vẫn là giá trị mẫu');
    expect(msg).not.toContain(sample);
  });

  it('từ chối JWT_ACCESS_SECRET_PREV khi thiếu khóa hiện tại hoặc trùng khóa hiện tại', () => {
    expect(errorOf({ JWT_ACCESS_SECRET_PREV: SECRET_PREV })).toContain('JWT_ACCESS_SECRET_PREV chỉ dùng khi đã có JWT_ACCESS_SECRET');
    const msg = errorOf({ JWT_ACCESS_SECRET: SECRET, JWT_ACCESS_SECRET_PREV: SECRET });
    expect(msg).toContain('JWT_ACCESS_SECRET_PREV phải khác JWT_ACCESS_SECRET');
    expect(msg).not.toContain(SECRET);
  });

  it('kiểm tra khoảng thời hạn token/phiên', () => {
    expect(run({ ACCESS_TTL_SECONDS: '900', REFRESH_IDLE_DAYS: '3', REFRESH_ABS_DAYS: '14' })).toMatchObject({ ACCESS_TTL_SECONDS: 900, REFRESH_IDLE_DAYS: 3, REFRESH_ABS_DAYS: 14 });
    expect(errorOf({ ACCESS_TTL_SECONDS: '59' })).toContain('ACCESS_TTL_SECONDS phải là số nguyên từ 60 đến 3600');
    expect(errorOf({ ACCESS_TTL_SECONDS: 'abc' })).toContain('ACCESS_TTL_SECONDS');
    expect(errorOf({ REFRESH_IDLE_DAYS: '0' })).toContain('REFRESH_IDLE_DAYS phải là số nguyên từ 1 đến 30');
    expect(errorOf({ REFRESH_ABS_DAYS: '91' })).toContain('REFRESH_ABS_DAYS phải là số nguyên từ 1 đến 90');
    expect(errorOf({ REFRESH_IDLE_DAYS: '10', REFRESH_ABS_DAYS: '5' })).toContain('REFRESH_IDLE_DAYS không được lớn hơn REFRESH_ABS_DAYS');
  });

  it('COOKIE_SECURE: chỉ true/false; production cấm false', () => {
    expect(run({ COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(errorOf({ COOKIE_SECURE: 'yes' })).toContain('COOKIE_SECURE phải là true hoặc false');
    expect(errorOf({ NODE_ENV: 'production', CORS_ORIGINS: 'https://crm.example.vn', COOKIE_SECURE: 'false' })).toContain('production không được đặt COOKIE_SECURE=false');
  });

  it('AUTH_ALLOWED_ORIGINS: danh sách riêng hợp lệ; cấm * và URL có đường dẫn', () => {
    expect(run({ AUTH_ALLOWED_ORIGINS: 'https://crm.example.vn, http://localhost:5173' }).AUTH_ALLOWED_ORIGIN_LIST).toEqual(['https://crm.example.vn', 'http://localhost:5173']);
    expect(errorOf({ AUTH_ALLOWED_ORIGINS: '*' })).toContain('AUTH_ALLOWED_ORIGINS không được dùng *');
    expect(errorOf({ AUTH_ALLOWED_ORIGINS: 'https://crm.example.vn/app' })).toContain('AUTH_ALLOWED_ORIGINS có giá trị sai định dạng');
    expect(errorOf({ AUTH_ALLOWED_ORIGINS: 'not a url' })).toContain('AUTH_ALLOWED_ORIGINS có giá trị không phải URL hợp lệ');
  });

  it('TRUST_PROXY: false/loopback/1..5; từ chối true', () => {
    expect(run({ TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
    expect(run({ TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(errorOf({ TRUST_PROXY: 'true' })).toContain('TRUST_PROXY phải là false, loopback hoặc số nguyên từ 1 đến 5');
    expect(errorOf({ TRUST_PROXY: '6' })).toContain('TRUST_PROXY');
  });
});
