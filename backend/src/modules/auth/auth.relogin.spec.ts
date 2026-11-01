import 'reflect-metadata';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthService } from './auth.service';

// Owner duyệt 2026-11-01 (QA bảo mật PR #190, Minor 2): đăng nhập THÀNH CÔNG trên trình duyệt đang có phiên CÒN SỐNG => thu hồi phiên cũ đó
// (cookie cũ bị ghi đè ở trình duyệt; nếu không thu hồi, token cũ — nếu đã bị lộ — vẫn dùng được tới 8–12 giờ). Lý do thu hồi: RELOGIN.
// Đăng nhập thất bại / không có phiên cũ => không thu hồi gì. Prisma GIẢ; mọi mật khẩu ở đây là giá trị tổng hợp cho test.
const PW = 'Demo-Test#301085';
function build(verifyOk = true) {
  const sessionUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const created: Array<Record<string, unknown>> = [];
  const authSession = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'sess-new' }; }),
    updateMany: jest.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { sessionUpdates.push(a); return { count: 1 }; }),
  };
  const auditLog = { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return {}; }) };
  const employeeCredential = { update: jest.fn(async () => ({})) };
  const emp = { id: 'e1', code: 'NV-0001', fullName: 'A', status: 'ACTIVE', departmentId: 'd1',
    credential: { passwordHash: '$argon2id$x', passwordAlgo: 'argon2id', status: 'ACTIVE', lockedUntil: null, failedCount: 0, windowStartedAt: null, lockLevel: 0, mustChangePassword: false, tokenVersion: 3 } };
  const employee = { findUnique: jest.fn(async () => emp) };
  const rememberDevice = { updateMany: jest.fn(async () => ({ count: 0 })), findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn() };
  const tx = { authSession, auditLog, employeeCredential, employee, rememberDevice, $executeRaw: jest.fn(async () => 0) };
  const prisma = { ...tx, $queryRaw: jest.fn(async () => [{ id: 'e1' }]), $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const cfg = { cookieSecure: false, allowedOrigins: [], sessionIdleMinutes: 480, sessionAbsHours: 12, loginWindowMinutes: 15, loginMaxPerSource: 1000, loginMaxPerIdentifier: 1000, lockMinutes: 15, lockAfterFailures: 5 };
  const sessionProvider = { lookup: jest.fn(async () => ({ sessionId: 'sess-new', csrfHash: 'h', actor: { employeeId: 'e1', departmentId: 'd1' }, roles: ['sale'], scopes: {}, mustChangePassword: false })) };
  const svc = new AuthService(prisma as never, cfg as never, sessionProvider as never);
  (svc as unknown as { hasher: unknown }).hasher = { verify: jest.fn().mockResolvedValue(verifyOk), hash: jest.fn() };
  return { svc, sessionUpdates, audits, created };
}
const base = { login: 'NV-0001', password: PW, source: '127.0.0.1', ip: '10.1.2.3', userAgent: 'ua', requestId: 'r1' };

describe('AuthService.login — thu hồi phiên cũ trên cùng trình duyệt khi đăng nhập lại (RELOGIN)', () => {
  it('có phiên cũ còn sống (của chính người này) => thu hồi đúng phiên đó bằng id, lý do RELOGIN, ghi nhật ký; vẫn cấp phiên mới', async () => {
    const e = build();
    const r = await e.svc.login({ ...base, previousSession: { sessionId: 'sess-old', employeeId: 'e1' } });
    expect(r.sessionToken).toBeTruthy();
    expect(e.created).toHaveLength(1);
    expect(e.sessionUpdates).toHaveLength(1);
    expect(e.sessionUpdates[0].where).toEqual({ id: 'sess-old', revokedAt: null });
    expect(e.sessionUpdates[0].data).toMatchObject({ revokeReason: 'RELOGIN' });
    expect(e.sessionUpdates[0].data.revokedAt).toBeInstanceOf(Date);
    const a = e.audits.find((x) => x.action === 'auth.session_revoked_relogin');
    expect(a).toMatchObject({ actorType: 'USER', actorId: 'e1', entityType: 'employee', entityId: 'e1' });
    expect(JSON.stringify(e.audits)).not.toContain('sess-old'); // nhật ký không chứa id phiên
  });
  it('phiên cũ của NGƯỜI KHÁC trên cùng trình duyệt (máy dùng chung) => cũng thu hồi; nhật ký ghi đối tượng là người có phiên cũ', async () => {
    const e = build();
    await e.svc.login({ ...base, previousSession: { sessionId: 'sess-other', employeeId: 'e9' } });
    expect(e.sessionUpdates[0].where).toEqual({ id: 'sess-other', revokedAt: null });
    expect(e.audits.find((x) => x.action === 'auth.session_revoked_relogin')).toMatchObject({ actorId: 'e1', entityId: 'e9' });
  });
  it('không có phiên cũ => không thu hồi gì', async () => {
    for (const prev of [undefined, null]) {
      const e = build();
      await e.svc.login({ ...base, previousSession: prev });
      expect(e.sessionUpdates).toHaveLength(0);
      expect(e.audits.some((x) => x.action === 'auth.session_revoked_relogin')).toBe(false);
    }
  });
  it('đăng nhập SAI mật khẩu => không thu hồi phiên cũ (không cho kẻ đoán mật khẩu đá người dùng ra)', async () => {
    const e = build(false);
    await expect(e.svc.login({ ...base, previousSession: { sessionId: 'sess-old', employeeId: 'e1' } })).rejects.toBeInstanceOf(DomainException);
    expect(e.sessionUpdates).toHaveLength(0);
  });
});
