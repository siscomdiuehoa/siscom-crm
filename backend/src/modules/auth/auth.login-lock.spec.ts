import 'reflect-metadata';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthService } from './auth.service';

// Rà soát 10/11/2026 (A3): khi tài khoản ĐANG bị khoá tạm, mỗi lần thử (kể cả đúng mật khẩu) trước đây vẫn bị đếm là sai
// => đủ ngưỡng lại khoá tiếp với lock_level cao hơn, thời gian nhân đôi: một nguồn có thể giữ khoá vô thời hạn và kéo dài dần.
// Yêu cầu: trong lúc đang khoá, lần thử bị từ chối nhưng KHÔNG đổi bộ đếm, lock_level hay locked_until.
// Prisma GIẢ; mọi mật khẩu ở đây là giá trị tổng hợp cho test.
const PW = 'Demo-Test#301085';
const MIN = 60_000;
function build(cred: { lockedUntil: Date | null; lockLevel: number; failedCount: number; windowStartedAt: Date | null }, verifyOk: boolean) {
  const credUpdates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const authSession = { create: jest.fn(async () => ({ id: 'sess-new' })), updateMany: jest.fn(async () => ({ count: 0 })) };
  const auditLog = { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return {}; }) };
  const employeeCredential = { update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { credUpdates.push(data); return {}; }) };
  const emp = { id: 'e1', code: 'NV-0001', fullName: 'A', status: 'ACTIVE', departmentId: 'd1',
    credential: { passwordHash: '$argon2id$x', passwordAlgo: 'argon2id', status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3, ...cred } };
  const employee = { findUnique: jest.fn(async () => emp) };
  const rememberDevice = { updateMany: jest.fn(async () => ({ count: 0 })), findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn() };
  const tx = { authSession, auditLog, employeeCredential, employee, rememberDevice, $executeRaw: jest.fn(async () => 0) };
  const prisma = { ...tx, $queryRaw: jest.fn(async () => [{ id: 'e1' }]), $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const cfg = { cookieSecure: false, allowedOrigins: [], sessionIdleMinutes: 480, sessionAbsHours: 12, loginWindowMinutes: 15, loginMaxPerSource: 1000, loginMaxPerIdentifier: 1000, lockMinutes: 15, lockAfterFailures: 5 };
  const sessionProvider = { lookup: jest.fn(async () => ({ sessionId: 'sess-new', csrfHash: 'h', actor: { employeeId: 'e1', departmentId: 'd1' }, roles: ['sale'], scopes: {}, mustChangePassword: false })) };
  const svc = new AuthService(prisma as never, cfg as never, sessionProvider as never);
  (svc as unknown as { hasher: unknown }).hasher = { verify: jest.fn().mockResolvedValue(verifyOk), hash: jest.fn() };
  return { svc, credUpdates, audits, authSession };
}
const base = { login: 'NV-0001', password: PW, source: '127.0.0.1', ip: '10.1.2.3', userAgent: 'ua', requestId: 'r1' };

describe('AuthService.login — đang bị khoá tạm thì lần thử không làm khoá leo thang', () => {
  it('đang khoá + sai mật khẩu nhiều lần (quá ngưỡng) => vẫn từ chối, KHÔNG ghi bộ đếm / lock_level / locked_until', async () => {
    const e = build({ lockedUntil: new Date(Date.now() + 10 * MIN), lockLevel: 1, failedCount: 0, windowStartedAt: null }, false);
    for (let i = 0; i < 6; i++) await expect(e.svc.login(base)).rejects.toBeInstanceOf(DomainException);
    expect(e.credUpdates).toHaveLength(0);
    expect(e.audits.some((a) => a.action === 'auth.login_locked')).toBe(false);
    expect(e.authSession.create).not.toHaveBeenCalled();
  });
  it('đang khoá + ĐÚNG mật khẩu => vẫn từ chối (khoá còn hạn) và không bị tính là một lần sai', async () => {
    const e = build({ lockedUntil: new Date(Date.now() + 10 * MIN), lockLevel: 2, failedCount: 0, windowStartedAt: null }, true);
    await expect(e.svc.login(base)).rejects.toBeInstanceOf(DomainException);
    expect(e.credUpdates).toHaveLength(0);
    expect(e.authSession.create).not.toHaveBeenCalled();
  });
  it('khoá ĐÃ HẾT HẠN + sai mật khẩu => đếm lại bình thường (không nới chính sách khoá)', async () => {
    const e = build({ lockedUntil: new Date(Date.now() - MIN), lockLevel: 1, failedCount: 0, windowStartedAt: null }, false);
    await expect(e.svc.login(base)).rejects.toBeInstanceOf(DomainException);
    expect(e.credUpdates).toHaveLength(1);
    expect(e.credUpdates[0]).toMatchObject({ failedCount: 1 });
    expect(e.audits.some((a) => a.action === 'auth.login_failed')).toBe(true);
  });
  it('không khoá + sai tới ngưỡng => khoá và tăng lock_level như cũ', async () => {
    const e = build({ lockedUntil: null, lockLevel: 0, failedCount: 4, windowStartedAt: new Date(Date.now() - MIN) }, false);
    await expect(e.svc.login(base)).rejects.toBeInstanceOf(DomainException);
    expect(e.credUpdates[0]).toMatchObject({ failedCount: 0, lockLevel: 1 });
    expect(e.credUpdates[0].lockedUntil).toBeInstanceOf(Date);
    expect(e.audits.some((a) => a.action === 'auth.login_locked')).toBe(true);
  });
});
