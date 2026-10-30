import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ResolvedSession } from '../../common/auth/session/session-actor.provider';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';

// B1.3.3 PR 8 — AuthService.changePassword (D16, D18 A, D19) với prisma/hasher giả (Argon2 thật quá chậm cho unit).
// Mật khẩu trong file này là giá trị TỔNG HỢP cho test, không phải mật khẩu demo/thật.
const S: ResolvedSession = { sessionId: 'sess1', csrfHash: 'h', actor: { employeeId: 'e1', departmentId: 'd1' }, roles: ['sales'], scopes: { 'customer.read': 'OWN' }, mustChangePassword: false };
const CUR = 'Demo-Cu#301085'; const NEW = 'Demo-Moi#301085';
const row = () => ({ id: 'e1', code: 'NV-0003', fullName: 'Sale A', email: 'sale@siscom.local', departmentId: 'd1', status: 'ACTIVE',
  credential: { passwordHash: '$argon2id$old', passwordAlgo: 'argon2id', status: 'ACTIVE', mustChangePassword: true, tokenVersion: 3 } });
function build(cfgOver: Record<string, unknown> = {}) {
  const employee = { findUnique: jest.fn().mockResolvedValue(row()), findUniqueOrThrow: jest.fn().mockResolvedValue(row()) };
  const employeeCredential = { update: jest.fn().mockResolvedValue({}) };
  const authSession = { create: jest.fn().mockResolvedValue({ id: 'sess2' }), count: jest.fn().mockResolvedValue(2) };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const $queryRaw = jest.fn().mockResolvedValue([{ tv: 4 }]);
  const tx = { employeeCredential, authSession, auditLog, $queryRaw };
  const prisma = { employee, employeeCredential, authSession, auditLog, $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const cfg = { cookieSecure: false, allowedOrigins: [], sessionIdleMinutes: 30, sessionAbsHours: 2, loginWindowMinutes: 15, loginMaxPerSource: 1000, loginMaxPerIdentifier: 5, lockMinutes: 15, lockAfterFailures: 5, ...cfgOver };
  const sessions = { lookup: jest.fn().mockResolvedValue({ ...S, sessionId: 'sess2' }) };
  const svc = new AuthService(prisma as never, cfg as never, sessions as never);
  const hasher = { verify: jest.fn(async (_h: string | null, pw: string) => pw === CUR), hash: jest.fn().mockResolvedValue('$argon2id$new') };
  (svc as unknown as { hasher: unknown }).hasher = hasher;
  return { svc, prisma, employee, employeeCredential, authSession, auditLog, hasher, sessions, $queryRaw };
}
const input = (o: Record<string, unknown> = {}) => ({ currentPassword: CUR, newPassword: NEW, confirmPassword: NEW, source: '127.0.0.1', ip: '127.0.0.1', userAgent: 'jest', requestId: 'r1', ...o });
async function err(p: Promise<unknown>): Promise<DomainException> {
  try { await p; } catch (e) { if (e instanceof DomainException) return e; throw e; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
}
const sqlOf = (call: unknown[]): string => (Array.isArray(call[0]) ? (call[0] as string[]).join('?') : String(call[0]));
const allCalls = (e: ReturnType<typeof build>) => JSON.stringify([e.employeeCredential.update.mock.calls, e.authSession.create.mock.calls, e.auditLog.create.mock.calls, e.$queryRaw.mock.calls]);

describe('ChangePasswordDto', () => {
  const check = async (plain: object) => (await validate(plainToInstance(ChangePasswordDto, plain), { whitelist: true, forbidNonWhitelisted: true })).length;
  it('đúng 3 trường chuỗi 1..1024; thiếu/rỗng/trường lạ => lỗi', async () => {
    expect(await check({ currentPassword: 'a', newPassword: 'b', confirmPassword: 'b' })).toBe(0);
    expect(await check({ currentPassword: 'a', newPassword: 'b' })).toBeGreaterThan(0);
    expect(await check({ currentPassword: '', newPassword: 'b', confirmPassword: 'b' })).toBeGreaterThan(0);
    expect(await check({ currentPassword: 'a', newPassword: 'b', confirmPassword: 'b', login: 'x' })).toBeGreaterThan(0);
    expect(await check({ currentPassword: 'a', newPassword: 'x'.repeat(1025), confirmPassword: 'b' })).toBeGreaterThan(0);
  });
});

describe('AuthService.changePassword', () => {
  it('thành công (F1): cột bí mật + token_version qua fn_auth_api_change_own_password (khoá lạc quan token_version), Prisma chỉ cập nhật cột không bí mật, phiên mới, nhật ký; không ghi mật khẩu', async () => {
    const e = build();
    const r = await e.svc.changePassword(S, input());
    expect(e.hasher.hash).toHaveBeenCalledWith(NEW);
    const fn = e.$queryRaw.mock.calls.find((c) => sqlOf(c).includes('fn_auth_api_change_own_password'));
    expect(fn).toBeDefined();
    const params = (fn as unknown[]).slice(1);
    expect(params).toEqual(expect.arrayContaining(['e1', 3, '$argon2id$new', 'argon2id']));
    expect(params.some((p) => typeof p === 'string' && p.includes('"m":'))).toBe(true); // password_params JSON
    const upd = e.employeeCredential.update.mock.calls[0][0];
    expect(upd.where).toEqual({ employeeId: 'e1' });
    expect(upd.data).toEqual({ failedCount: 0, windowStartedAt: null, lockedUntil: null, lockLevel: 0, passwordChangedAt: expect.any(Date) });
    expect(JSON.stringify(upd.data)).not.toMatch(/passwordHash|tokenVersion|mustChangePassword/);
    expect(e.authSession.count.mock.calls[0][0].where).toEqual({ employeeId: 'e1', revokedAt: null });
    expect(e.authSession.create).toHaveBeenCalledTimes(1);
    expect(e.authSession.create.mock.calls[0][0].data).toMatchObject({ employeeId: 'e1', uaShort: 'jest' });
    expect(e.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorType: 'USER', actorId: 'e1', action: 'auth.password_changed', entityType: 'employee', entityId: 'e1', changes: { sessionsRevoked: 2, tokenVersion: 4 }, requestId: 'r1' });
    expect(e.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(r.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(r.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.me.employeeId).toBe('e1'); expect(r.me.mustChangePassword).toBe(false);
    expect(allCalls(e)).not.toMatch(/Demo-Cu|Demo-Moi/);
  });
  it('token_version đã đổi giữa chừng (STALE_TOKEN_VERSION từ DB) => 409 PASSWORD_CHANGE_CONFLICT, không tạo phiên mới', async () => {
    const e = build();
    const dbErr = Object.assign(new Error('STALE_TOKEN_VERSION: token_version cua nhan vien e1 da doi; dang nhap lai.'), { code: 'P2010', meta: { code: '23514', message: 'STALE_TOKEN_VERSION: ...' } });
    e.$queryRaw.mockRejectedValue(dbErr);
    const x = await err(e.svc.changePassword(S, input()));
    expect(x.code).toBe('PASSWORD_CHANGE_CONFLICT'); expect(x.getStatus()).toBe(409);
    expect(e.authSession.create).not.toHaveBeenCalled();
  });
  it('xác nhận lệch => 400 VALIDATION_FAILED, không so mật khẩu, không ghi', async () => {
    const e = build();
    const x = await err(e.svc.changePassword(S, input({ confirmPassword: NEW + '!' })));
    expect(x.code).toBe('VALIDATION_FAILED'); expect(x.details).toEqual(['Mật khẩu xác nhận không khớp']);
    expect(e.hasher.verify).not.toHaveBeenCalled(); expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('mật khẩu mới vi phạm chính sách => 400 có details; không so mật khẩu', async () => {
    const e = build();
    const x = await err(e.svc.changePassword(S, input({ newPassword: 'sale-weak', confirmPassword: 'sale-weak' })));
    expect(x.code).toBe('VALIDATION_FAILED'); expect((x.details as string[]).length).toBeGreaterThan(0);
    expect(e.hasher.verify).not.toHaveBeenCalled(); expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('mật khẩu hiện tại sai => 400 PASSWORD_CURRENT_INVALID + nhật ký auth.password_change_failed; không đổi credential', async () => {
    const e = build();
    const x = await err(e.svc.changePassword(S, input({ currentPassword: 'sai-mat-khau-1!' })));
    expect(x.code).toBe('PASSWORD_CURRENT_INVALID'); expect(x.getStatus()).toBe(400);
    expect(e.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorType: 'USER', actorId: 'e1', action: 'auth.password_change_failed' });
    expect(e.employeeCredential.update).not.toHaveBeenCalled(); expect(e.authSession.create).not.toHaveBeenCalled(); expect(e.$queryRaw).not.toHaveBeenCalled();
    expect(allCalls(e)).not.toMatch(/sai-mat-khau/);
  });
  it('mật khẩu mới trùng mật khẩu hiện tại => 400 VALIDATION_FAILED "khác mật khẩu hiện tại"; không ghi', async () => {
    const e = build();
    const x = await err(e.svc.changePassword(S, input({ newPassword: CUR, confirmPassword: CUR })));
    expect(x.code).toBe('VALIDATION_FAILED'); expect(x.details).toEqual(['Mật khẩu mới phải khác mật khẩu hiện tại']);
    expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('D18 A: quá hạn mức (nguồn + nhân viên) => 429 PASSWORD_CHANGE_THROTTLED trước khi chạm DB', async () => {
    const e = build({ loginMaxPerIdentifier: 2 });
    await err(e.svc.changePassword(S, input({ currentPassword: 'x' })));
    await err(e.svc.changePassword(S, input({ currentPassword: 'x' })));
    const n = e.employee.findUnique.mock.calls.length;
    const x = await err(e.svc.changePassword(S, input()));
    expect(x.code).toBe('PASSWORD_CHANGE_THROTTLED'); expect(x.getStatus()).toBe(429);
    expect(e.employee.findUnique.mock.calls.length).toBe(n);
  });
  it('D18 A (F4): bucket THEO NHÂN VIÊN bất kể nguồn = 4 x loginMaxPerIdentifier — xoay IP không dò được vô hạn; nguồn khác vẫn không bị lây khi dưới trần', async () => {
    const e = build({ loginMaxPerIdentifier: 2 }); // trần theo nhân viên = 8
    for (let i = 0; i < 8; i++) await err(e.svc.changePassword(S, input({ currentPassword: 'x', source: '10.0.0.' + i })));
    const n = e.employee.findUnique.mock.calls.length;
    expect(n).toBe(8); // 8 nguồn khác nhau, mỗi nguồn 1 lần => chưa bị chặn theo cặp nguồn+nhân viên
    const x = await err(e.svc.changePassword(S, input({ source: '10.0.0.99' })));
    expect(x.code).toBe('PASSWORD_CHANGE_THROTTLED');
    expect(e.employee.findUnique.mock.calls.length).toBe(n);
    const other: ResolvedSession = { ...S, actor: { employeeId: 'e2', departmentId: 'd1' } };
    e.employee.findUnique.mockResolvedValue({ ...row(), id: 'e2' });
    expect((await err(e.svc.changePassword(other, input({ currentPassword: 'x', source: '10.0.0.99' })))).code).toBe('PASSWORD_CURRENT_INVALID'); // nhân viên khác không bị lây
  });
  it('credential không ACTIVE / nhân viên không ACTIVE => 400 PASSWORD_CURRENT_INVALID (không lộ lý do), không ghi', async () => {
    const e = build();
    e.employee.findUnique.mockResolvedValue({ ...row(), credential: { ...row().credential, status: 'DISABLED' } });
    expect((await err(e.svc.changePassword(S, input()))).code).toBe('PASSWORD_CURRENT_INVALID');
    expect(e.$queryRaw).not.toHaveBeenCalled();
  });
  it('F8: tra cứu phiên mới sau commit thất bại => vẫn trả 200 với me từ phiên cũ (vai trò không đổi), không 500', async () => {
    const e = build();
    e.sessions.lookup.mockRejectedValue(new Error('DB tạm thời lỗi'));
    const r = await e.svc.changePassword(S, input());
    expect(r.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.me).toMatchObject({ employeeId: 'e1', code: 'NV-0003', roles: ['sales'], mustChangePassword: false });
  });
});
