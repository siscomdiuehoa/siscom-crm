import { LoginAbuseStore, LoginAbusePolicy, ThrottledPasswordLogin, UNCONFIGURED_LOGIN_ABUSE_POLICY } from './login-abuse.policy';
import { PasswordLoginService } from './password-login.service';
import { CredentialStore, PasswordHasher } from './password-login.types';

// Bộ điều hợp trong bộ nhớ CHỈ DÙNG CHO TEST (không đưa vào src chạy thật). Cửa sổ cố định; lùi đồng hồ thì mở cửa sổ mới.
class MemoryStore implements LoginAbuseStore {
  readonly buckets = new Map<string, { start: number; n: number }>();
  async hit(key: string, nowMs: number, windowMs: number): Promise<number> {
    let b = this.buckets.get(key);
    if (!b || nowMs - b.start >= windowMs || nowMs < b.start) { b = { start: nowMs, n: 0 }; this.buckets.set(key, b); }
    b.n += 1;
    return b.n;
  }
}

const TEST_CFG = { windowMs: 1000, maxPerSource: 5, maxPerSourceIdentifier: 2 }; // CHỈ cho test, không phải ngưỡng sản xuất
const fakeHash = (m: string) => `h(${m.length}:${[...m].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)})`;

const make = (over: Partial<ConstructorParameters<typeof LoginAbusePolicy>[0]> = {}) => {
  const clock = { t: 10_000 };
  const store = new MemoryStore();
  const logs: Array<{ e: string; f: unknown }> = [];
  const policy = new LoginAbusePolicy({
    config: TEST_CFG, store, keyHasher: fakeHash, now: () => clock.t,
    log: { warn: (e, f) => logs.push({ e, f }) }, ...over,
  });
  return { clock, store, logs, policy };
};

describe('LoginAbusePolicy — cấu hình bắt buộc', () => {
  it.each([
    [undefined], [{}], [{ windowMs: 0, maxPerSource: 1, maxPerSourceIdentifier: 1 }],
    [{ windowMs: 1, maxPerSource: -1, maxPerSourceIdentifier: 1 }], [{ windowMs: 1, maxPerSource: 1, maxPerSourceIdentifier: 1.5 }],
    [{ windowMs: '1000', maxPerSource: 1, maxPerSourceIdentifier: 1 }], [{ windowMs: 1, maxPerSource: NaN, maxPerSourceIdentifier: 1 }],
  ])('thiếu/không hợp lệ => ném lỗi, không có mặc định (%j)', (cfg) => {
    expect(() => new LoginAbusePolicy({ config: cfg as never, store: new MemoryStore(), keyHasher: fakeHash, now: () => 0 })).toThrow(/LOGIN_ABUSE_CONFIG_REQUIRED/);
  });
  it('thiếu store/keyHasher/now => ném lỗi', () => {
    expect(() => new LoginAbusePolicy({ config: TEST_CFG, store: undefined as never, keyHasher: fakeHash, now: () => 0 })).toThrow(/DEPS_REQUIRED/);
    expect(() => new LoginAbusePolicy({ config: TEST_CFG, store: new MemoryStore(), keyHasher: undefined as never, now: () => 0 })).toThrow(/DEPS_REQUIRED/);
  });
  it('bộ giữ chỗ chưa cấu hình luôn từ chối (không phải bypass)', async () => {
    await expect(UNCONFIGURED_LOGIN_ABUSE_POLICY.check({ source: 'a', identifier: 'NV-0001' })).resolves.toEqual({ allowed: false, reason: 'POLICY_UNAVAILABLE' });
  });
});

describe('LoginAbusePolicy — ngưỡng và biên đồng hồ', () => {
  it('cho phép đúng maxPerSourceIdentifier lần, lần kế tiếp bị RATE_LIMITED', async () => {
    const { policy } = make();
    const i = { source: '10.0.0.1', identifier: 'NV-0001' };
    expect((await policy.check(i)).allowed).toBe(true);
    expect((await policy.check(i)).allowed).toBe(true);
    expect(await policy.check(i)).toEqual({ allowed: false, reason: 'RATE_LIMITED' });
  });
  it('biên cửa sổ: t=start+windowMs-1 vẫn trong cửa sổ, t=start+windowMs mở cửa sổ mới', async () => {
    const { policy, clock } = make();
    const i = { source: 's', identifier: 'NV-0001' };
    await policy.check(i); await policy.check(i);
    clock.t += TEST_CFG.windowMs - 1;
    expect((await policy.check(i)).allowed).toBe(false);
    clock.t += 1;
    expect((await policy.check(i)).allowed).toBe(true);
  });
  it('đồng hồ lùi => mở cửa sổ mới (không kẹt vĩnh viễn)', async () => {
    const { policy, clock } = make();
    const i = { source: 's', identifier: 'NV-0001' };
    await policy.check(i); await policy.check(i);
    clock.t -= 500;
    expect((await policy.check(i)).allowed).toBe(true);
  });
  it('now không hữu hạn => từ chối POLICY_UNAVAILABLE', async () => {
    const { policy, clock } = make();
    clock.t = NaN;
    expect(await policy.check({ source: 's', identifier: 'NV-0001' })).toEqual({ allowed: false, reason: 'POLICY_UNAVAILABLE' });
  });
});

describe('LoginAbusePolicy — khóa theo nguồn và danh tính chuẩn hóa', () => {
  it('nguồn khác không bị ảnh hưởng (không khóa nạn nhân từ nguồn khác)', async () => {
    const { policy } = make();
    for (let k = 0; k < 4; k++) await policy.check({ source: 'attacker', identifier: 'NV-0001' });
    expect((await policy.check({ source: 'victim', identifier: 'NV-0001' })).allowed).toBe(true);
  });
  it('hạn mức theo nguồn áp dụng cho nhiều danh tính khác nhau', async () => {
    const { policy } = make();
    const res: boolean[] = [];
    for (let k = 1; k <= 6; k++) res.push((await policy.check({ source: 's', identifier: `NV-000${k}` })).allowed);
    expect(res).toEqual([true, true, true, true, true, false]);
  });
  it('email khác hoa/thường và khoảng trắng hai đầu dùng chung một khóa', async () => {
    const { policy } = make();
    await policy.check({ source: 's', identifier: 'A@Corp.vn' });
    await policy.check({ source: 's', identifier: ' a@corp.VN ' });
    expect((await policy.check({ source: 's', identifier: 'a@corp.vn' })).allowed).toBe(false);
  });
  it('danh tính sai định dạng chỉ tính theo nguồn, không tạo khóa danh tính', async () => {
    const { policy, store } = make();
    await policy.check({ source: 's', identifier: 'rac thai\u0000' });
    await policy.check({ source: 's', identifier: 12345 });
    expect([...store.buckets.keys()].every((k) => k.startsWith('login:s:'))).toBe(true);
  });
  it('nguồn rỗng/không phải chuỗi => từ chối, không chạm kho', async () => {
    const { policy, store } = make();
    expect((await policy.check({ source: '', identifier: 'NV-0001' })).allowed).toBe(false);
    expect((await policy.check({ source: undefined, identifier: 'NV-0001' })).allowed).toBe(false);
    expect(store.buckets.size).toBe(0);
  });
});

describe('LoginAbusePolicy — không lộ PII thô', () => {
  it('khóa kho và log không chứa IP/email/mã NV thô', async () => {
    const { policy, store, logs } = make();
    const i = { source: '203.0.113.9', identifier: 'nguyen.van.a@corp.vn' };
    for (let k = 0; k < 4; k++) await policy.check(i);
    await policy.check({ source: '203.0.113.9', identifier: 'NV-0042' });
    const dump = JSON.stringify([...store.buckets.keys()]) + JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const raw of ['203.0.113.9', 'nguyen.van.a', 'corp.vn', 'NV-0042']) expect(dump).not.toContain(raw);
  });
});

describe('LoginAbusePolicy — fail-closed khi kho chính sách lỗi', () => {
  it.each([
    ['ném lỗi', async () => { throw new Error('conn refused 10.1.1.1 secret'); }],
    ['trả NaN', async () => NaN],
    ['trả 0', async () => 0],
    ['trả undefined', async () => undefined as never],
  ])('kho %s => POLICY_UNAVAILABLE, không ném, không lộ lỗi gốc', async (_n, hit) => {
    const { policy, logs } = make({ store: { hit } });
    const d = await policy.check({ source: 's', identifier: 'NV-0001' });
    expect(d).toEqual({ allowed: false, reason: 'POLICY_UNAVAILABLE' });
    expect(JSON.stringify(logs)).not.toContain('secret');
  });
  it('keyHasher ném lỗi => từ chối', async () => {
    const { policy } = make({ keyHasher: () => { throw new Error('x'); } });
    expect((await policy.check({ source: 's', identifier: 'NV-0001' })).allowed).toBe(false);
  });
});

describe('ThrottledPasswordLogin — từ chối TRƯỚC khi tra credential', () => {
  const build = (policy: Pick<LoginAbusePolicy, 'check'>) => {
    const store: CredentialStore & { calls: number } = {
      calls: 0,
      async findByIdentifier() {
        this.calls += 1;
        return { employeeId: '11111111-1111-4111-8111-111111111111', hash: 'h', algo: 'argon2id', active: true };
      },
    };
    const hasher: PasswordHasher = { verify: async () => true };
    return { store, svc: new ThrottledPasswordLogin(policy, new PasswordLoginService(store, hasher)) };
  };
  it('bị giới hạn => 429 LOGIN_THROTTLED, kho credential không bị gọi thêm', async () => {
    const { policy } = make();
    const { store, svc } = build(policy);
    const input = { source: 's', login: 'NV-0001', password: 'x' };
    await svc.verify(input); await svc.verify(input);
    await expect(svc.verify(input)).rejects.toMatchObject({ status: 429, code: 'LOGIN_THROTTLED' });
    expect(store.calls).toBe(2);
  });
  it('kho chính sách lỗi => từ chối, không tra credential', async () => {
    const { policy } = make({ store: { hit: async () => { throw new Error('down'); } } });
    const { store, svc } = build(policy);
    await expect(svc.verify({ source: 's', login: 'NV-0001', password: 'x' })).rejects.toMatchObject({ status: 429 });
    expect(store.calls).toBe(0);
  });
  it('bộ giữ chỗ chưa cấu hình => luôn từ chối, không tra credential', async () => {
    const { store, svc } = build(UNCONFIGURED_LOGIN_ABUSE_POLICY);
    await expect(svc.verify({ source: 's', login: 'NV-0001', password: 'x' })).rejects.toMatchObject({ code: 'LOGIN_THROTTLED' });
    expect(store.calls).toBe(0);
  });
  it('được phép => chuyển tiếp, employeeId lấy từ kho', async () => {
    const { policy } = make();
    const { svc } = build(policy);
    await expect(svc.verify({ source: 's', login: 'NV-0001', password: 'x' })).resolves.toEqual({ employeeId: '11111111-1111-4111-8111-111111111111' });
  });
});
