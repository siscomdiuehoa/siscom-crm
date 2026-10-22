import 'reflect-metadata';
import { DomainException } from '../../errors/domain.exception';
import { newSecret } from './grant-secret';
import { PasswordResetService, RESET_PASSWORD_SQL } from './password-reset.service';
import { DEFAULT_RESET_ABUSE, ResetAbusePolicy } from './reset-abuse.policy';

// F-04 — mock trong bộ nhớ, KHÔNG DB. Chỉ chứng minh logic Node (đầu ra chung, giới hạn tốc độ, định dạng mã). Hành vi hàm SQL: B1.3_P2_DB_TESTS (CHƯA CHẠY).
const SECRET = { hash: '$argon2id$v=19$moi', algo: 'argon2id', params: { m: 65536, t: 3, p: 1 } };
const describeErr = async (p: Promise<unknown>) =>
  p.then(() => null, (e: DomainException) => ({ status: e.getStatus(), body: e.getResponse() }));

function make(rows: unknown[] | Error, opt = DEFAULT_RESET_ABUSE, now: () => number = () => 0) {
  const run = jest.fn().mockImplementation(async () => { if (rows instanceof Error) throw rows; return rows; });
  const policy = new ResetAbusePolicy(opt, now);
  return { run, policy, svc: new PasswordResetService(run, policy) };
}

describe('PasswordResetService — đầu ra chung, không dò tài khoản/mã', () => {
  it('thành công: gọi đúng hàm *_v2 với tham số GẮN, trả { status: OK }', async () => {
    const { svc, run } = make([{ result: 'OK' }]);
    const token = newSecret();
    await expect(svc.reset({ token, newSecret: SECRET, sourceKey: 'ip:1' })).resolves.toEqual({ status: 'OK' });
    expect(run).toHaveBeenCalledWith(RESET_PASSWORD_SQL, [token, SECRET.hash, SECRET.algo, JSON.stringify(SECRET.params)]);
    expect(RESET_PASSWORD_SQL).toMatch(/fn_auth_api_reset_password_v2\(\$1::text, \$2::text, \$3::text, \$4::jsonb\)/);
    expect(RESET_PASSWORD_SQL).not.toContain(token);
  });
  it('MỌI thất bại cho ra CÙNG status/mã/thông điệp (INVALID, NO_TOKEN lạ, null, DB lỗi, định dạng sai)', async () => {
    const token = newSecret();
    const cases: Array<[string, ReturnType<typeof make>, unknown]> = [
      ['DB INVALID (mã sai/hết hạn/đã dùng/nhân viên khóa)', make([{ result: 'INVALID' }]), token],
      ['DB trả mã cũ NO_TOKEN', make([{ result: 'NO_TOKEN' }]), token],
      ['DB trả EXPIRED', make([{ result: 'EXPIRED' }]), token],
      ['DB trả rỗng', make([]), token],
      ['DB trả null', make([{ result: null }]), token],
      ['DB ném lỗi', make(new Error('boom: employee 123 not found')), token],
      ['mã quá ngắn', make([{ result: 'OK' }]), 'abc'],
      ['mã không phải chuỗi', make([{ result: 'OK' }]), { $ne: 1 }],
      ['mã có khoảng trắng', make([{ result: 'OK' }]), token.slice(0, 20) + ' ' + token.slice(21)],
    ];
    const results = [];
    for (const [, m, t] of cases) results.push(await describeErr(m.svc.reset({ token: t, newSecret: SECRET, sourceKey: 'ip:2' })));
    for (const r of results) expect(r).toEqual({ status: 400, body: { code: 'RESET_INVALID', message: 'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' } });
    expect(JSON.stringify(results)).not.toMatch(/boom|employee|NO_TOKEN|EXPIRED/);
  });
  it('mã sai định dạng KHÔNG chạm DB; mật khẩu mới thiếu trường => từ chối không chạm DB', async () => {
    const { svc, run } = make([{ result: 'OK' }]);
    await describeErr(svc.reset({ token: 'x', newSecret: SECRET, sourceKey: 's' }));
    await describeErr(svc.reset({ token: newSecret(), newSecret: { hash: 1 } as never, sourceKey: 's' }));
    await describeErr(svc.reset({ token: newSecret(), newSecret: null as never, sourceKey: 's' }));
    expect(run).not.toHaveBeenCalled();
  });
  it('không có tham số tài khoản nào trong hợp đồng (không thể dò tồn tại tài khoản)', () => {
    expect(RESET_PASSWORD_SQL).not.toMatch(/employee|email|account|p_actor/i);
  });
});

describe('ResetAbusePolicy — chống lạm dụng theo NGUỒN', () => {
  const opt = { windowMs: 1000, maxAttempts: 5, maxFailures: 3, maxKeys: 3 };

  it('sau maxFailures thất bại từ một nguồn => 429 và KHÔNG chạm DB; nguồn khác không bị ảnh hưởng', async () => {
    const { svc, run } = make([{ result: 'INVALID' }], opt);
    for (let i = 0; i < 3; i++) await describeErr(svc.reset({ token: newSecret(), newSecret: SECRET, sourceKey: 'a' }));
    expect(run).toHaveBeenCalledTimes(3);
    const blocked = await describeErr(svc.reset({ token: newSecret(), newSecret: SECRET, sourceKey: 'a' }));
    expect(blocked).toMatchObject({ status: 429, body: { code: 'RESET_RATE_LIMITED' } });
    expect(run).toHaveBeenCalledTimes(3);
    const other = await describeErr(svc.reset({ token: newSecret(), newSecret: SECRET, sourceKey: 'b' }));
    expect(other).toMatchObject({ status: 400, body: { code: 'RESET_INVALID' } });
  });
  it('429 giống nhau dù mã đúng hay sai (không dùng làm oracle)', async () => {
    const { svc } = make([{ result: 'OK' }], opt);
    for (let i = 0; i < 3; i++) await describeErr(svc.reset({ token: 'ngan', newSecret: SECRET, sourceKey: 'z' }));
    const a = await describeErr(svc.reset({ token: newSecret(), newSecret: SECRET, sourceKey: 'z' }));
    const b = await describeErr(svc.reset({ token: 'ngan', newSecret: SECRET, sourceKey: 'z' }));
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: 429 });
  });
  it('giới hạn tổng số lần thử kể cả thành công; hết cửa sổ thì được thử lại', async () => {
    let t = 0;
    const { svc } = make([{ result: 'OK' }], opt, () => t);
    for (let i = 0; i < 5; i++) await expect(svc.reset({ token: newSecret(), newSecret: SECRET, sourceKey: 'a' })).resolves.toEqual({ status: 'OK' });
    expect(await describeErr(svc.reset({ token: newSecret(), newSecret: SECRET, sourceKey: 'a' }))).toMatchObject({ status: 429 });
    t = 1000;
    await expect(svc.reset({ token: newSecret(), newSecret: SECRET, sourceKey: 'a' })).resolves.toEqual({ status: 'OK' });
  });
  it('bộ nhớ có giới hạn: không vượt maxKeys dù nhiều nguồn', () => {
    const p = new ResetAbusePolicy(opt, () => 0);
    for (let i = 0; i < 100; i++) p.tryAcquire('ip:' + i);
    expect(p.size()).toBeLessThanOrEqual(opt.maxKeys);
  });
  it('KHÔNG có hạn mức toàn cục: nhiều nguồn khác nhau không chặn lẫn nhau (tránh DoS đặt lại mật khẩu)', () => {
    const p = new ResetAbusePolicy({ windowMs: 1000, maxAttempts: 2, maxFailures: 1, maxKeys: 1000 }, () => 0);
    for (let i = 0; i < 500; i++) { expect(p.tryAcquire('ip:' + i)).toBe(true); p.recordFailure('ip:' + i); }
    expect(p.tryAcquire('ip:nguoi-dung-hop-le')).toBe(true);
  });
  it('đồng hồ lùi (t < start) không làm hỏng bộ đếm', () => {
    let t = 5000;
    const p = new ResetAbusePolicy(opt, () => t);
    p.tryAcquire('a');
    t = 1;
    expect(p.tryAcquire('a')).toBe(true);
  });
});
