import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { REMEMBER_MAX_DEVICES, REMEMBER_RACE_GRACE_MS } from '../../common/auth/session/remember-token';
import type { ResolvedSession } from '../../common/auth/session/session-actor.provider';
import { newOpaqueToken, sha256Hex } from '../../common/auth/session/session-token';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

// Issue #177 — Remember Me 90 ngày. AuthService + RememberDevices với Prisma GIẢ có trạng thái (bảng remember_device trong bộ nhớ).
// Tính nguyên tử của compare-and-set/khoá dòng trên PostgreSQL thật được kiểm ở test/remember.int-spec.ts (cần DB thử cách ly).
// Mọi mật khẩu/token ở đây là giá trị TỔNG HỢP cho test.
const DAY = 86_400_000;
const T0 = new Date('2026-01-10T03:00:00.000Z');
const PW = 'Demo-Test#301085';

type Row = {
  id: string; employeeId: string; familyId: string; tokenHash: string; tokenVersion: number; passwordAuthAt: Date; absExpiresAt: Date; issuedAt: Date;
  lastUsedAt: Date; rotatedAt: Date | null; replacedById: string | null; revokedAt: Date | null; revokeReason: string | null; ipPrefix: string | null; uaShort: string | null;
};
type Where = Record<string, unknown>;
const match = (r: Row, w: Where): boolean => Object.entries(w).every(([k, v]) => {
  const x = (r as unknown as Record<string, unknown>)[k];
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { gt?: Date; in?: unknown[]; not?: unknown };
    if ('not' in o) return x !== o.not;
    if (o.gt !== undefined) return (x as Date).getTime() > o.gt.getTime();
    if (o.in !== undefined) return o.in.includes(x);
  }
  return x === v;
});

interface Emp { id: string; status: string; deletedAt: Date | null; credential: { status: string; mustChangePassword: boolean; tokenVersion: number } | null; roles: string[] }
function build(over: { emps?: Emp[] } = {}) {
  const rows: Row[] = [];
  const emps: Emp[] = over.emps ?? [{ id: 'e1', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['sale'] }];
  const audits: Array<{ action: string; actorId?: string; changes?: unknown }> = [];
  const sessions: Array<Record<string, unknown>> = [];
  const log: string[] = [];
  const rememberDevice = {
    create: jest.fn(async ({ data }: { data: Partial<Row> }) => { const r = { id: randomUUID(), lastUsedAt: new Date(), issuedAt: new Date(), rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null, ipPrefix: null, uaShort: null, ...data } as Row; rows.push(r); log.push('create'); return r; }),
    updateMany: jest.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => { const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); log.push('updateMany:' + JSON.stringify(data.revokeReason ?? (data.rotatedAt ? 'rotate' : 'x'))); return { count: hit.length }; }),
    update: jest.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => { const r = rows.find((x) => match(x, where)); if (!r) throw new Error('not found'); Object.assign(r, data); return r; }),
    findUnique: jest.fn(async ({ where }: { where: Where }) => rows.find((r) => match(r, where)) ?? null),
    findMany: jest.fn(async ({ where, orderBy }: { where: Where; orderBy?: { lastUsedAt: 'asc' | 'desc' } }) => {
      const out = rows.filter((r) => match(r, where));
      if (orderBy) out.sort((a, b) => (a.lastUsedAt.getTime() - b.lastUsedAt.getTime()) * (orderBy.lastUsedAt === 'asc' ? 1 : -1));
      return out;
    }),
  };
  const employee = { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => emps.find((e) => e.id === where.id) ?? null) };
  const sessionRevokes: Array<{ employeeId: unknown; reason: unknown; issuedBefore?: Date }> = [];
  const authSession = { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { sessions.push(data); return { id: 'sess-new' }; }),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { sessionRevokes.push({ employeeId: where.employeeId, reason: data.revokeReason, ...((where.issuedAt as { lte?: Date } | undefined)?.lte ? { issuedBefore: (where.issuedAt as { lte: Date }).lte } : {}) });
      const lte = (where.issuedAt as { lte?: Date } | undefined)?.lte;
      const hit = sessions.filter((x) => x.employeeId === where.employeeId && !x.revokedAt && (!lte || (x.issuedAt as Date).getTime() <= lte.getTime()));
      hit.forEach((x) => { x.revokedAt = data.revokedAt; });
      return { count: hit.length }; }) };
  const auditLog = { create: jest.fn(async ({ data }: { data: { action: string; actorId?: string; changes?: unknown } }) => { audits.push(data); return {}; }) };
  const employeeCredential = { update: jest.fn(async () => ({})) };
  const $executeRaw = jest.fn(async () => 0);
  const tx = { rememberDevice, employee, authSession, auditLog, employeeCredential, $executeRaw };
  const prisma = { ...tx, $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const cfg = { cookieSecure: false, allowedOrigins: [], sessionIdleMinutes: 480, sessionAbsHours: 12, loginWindowMinutes: 15, loginMaxPerSource: 1000, loginMaxPerIdentifier: 1000, lockMinutes: 15, lockAfterFailures: 5 };
  const roleOf = (id: string) => emps.find((e) => e.id === id)?.roles ?? [];
  const sessionProvider = { lookup: jest.fn(async (): Promise<ResolvedSession> => ({ sessionId: 'sess-new', csrfHash: 'h', actor: { employeeId: 'e1', departmentId: 'd1' }, roles: roleOf('e1'), scopes: {}, mustChangePassword: false })) };
  const svc = new AuthService(prisma as never, cfg as never, sessionProvider as never);
  return { svc, rows, emps, audits, sessions, sessionRevokes, log, prisma, rememberDevice, sessionProvider, cfg };
}
type Env = ReturnType<typeof build>;

const S1: ResolvedSession = { sessionId: 'sess1', csrfHash: 'h', actor: { employeeId: 'e1', departmentId: 'd1' }, roles: ['sale'], scopes: {}, mustChangePassword: false };
const ctx = { source: '127.0.0.1', ip: '10.1.2.3', userAgent: 'jest-agent', requestId: 'r1' };
// Phát hành trực tiếp một thiết bị nhớ (đi qua đúng đường mã `issue` của login) rồi trả token plaintext.
async function seedDevice(e: Env, over: { employeeId?: string; passwordAuthAt?: Date } = {}): Promise<string> {
  const tok = newOpaqueToken();
  await e.svc.rememberDevices.issue(e.prisma as never, { employeeId: over.employeeId ?? "e1", tokenVersion: 3, passwordAuthAt: over.passwordAuthAt ?? new Date(), now: new Date(), ip: ctx.ip, userAgent: ctx.userAgent }, tok);
  return tok;
}
async function err(p: Promise<unknown>): Promise<DomainException> {
  try { await p; } catch (x) { if (x instanceof DomainException) return x; throw x; }
  throw new Error('Mong đợi lỗi');
}

beforeEach(() => { jest.useFakeTimers({ now: T0 }); });
afterEach(() => { jest.useRealTimers(); });

describe('LoginDto.remember', () => {
  const check = async (plain: object) => (await validate(plainToInstance(LoginDto, plain), { whitelist: true, forbidNonWhitelisted: true })).length;
  it('tuỳ chọn, chỉ boolean; thiếu vẫn hợp lệ (client cũ); chuỗi/số bị từ chối', async () => {
    expect(await check({ login: 'a@b.c', password: 'x' })).toBe(0);
    expect(await check({ login: 'a@b.c', password: 'x', remember: true })).toBe(0);
    expect(await check({ login: 'a@b.c', password: 'x', remember: false })).toBe(0);
    expect(await check({ login: 'a@b.c', password: 'x', remember: 'true' })).toBeGreaterThan(0);
    expect(await check({ login: 'a@b.c', password: 'x', remember: 1 })).toBeGreaterThan(0);
  });
});

describe('phát hành (issue) — token riêng, chỉ lưu băm, mốc 90 ngày từ lần nhập mật khẩu', () => {
  it('lưu SHA-256, không lưu plaintext; abs = passwordAuthAt + 90 ngày; kế thừa token_version; ghi ip_prefix/ua', async () => {
    const e = build();
    const tok = await seedDevice(e);
    expect(e.rows).toHaveLength(1);
    const r = e.rows[0];
    expect(r.tokenHash).toBe(sha256Hex(tok));
    expect(JSON.stringify(e.rows)).not.toContain(tok);
    expect(r.absExpiresAt.getTime()).toBe(T0.getTime() + 90 * DAY);
    expect(r.passwordAuthAt.getTime()).toBe(T0.getTime());
    expect(r.tokenVersion).toBe(3);
    expect(r.ipPrefix).toBe('10.1.2.0/24');
    expect(r.uaShort).toBe('jest-agent');
  });
  it('thiết bị thứ 6 => thu hồi thiết bị ít dùng gần nhất (DEVICE_LIMIT), còn đúng 5 đang hoạt động', async () => {
    const e = build();
    const toks: string[] = [];
    for (let i = 0; i < REMEMBER_MAX_DEVICES; i += 1) { jest.setSystemTime(new Date(T0.getTime() + i * 1000)); toks.push(await seedDevice(e)); }
    jest.setSystemTime(new Date(T0.getTime() + 10_000));
    const sixth = await seedDevice(e);
    const active = e.rows.filter((r) => r.revokedAt === null && r.rotatedAt === null);
    expect(active).toHaveLength(REMEMBER_MAX_DEVICES);
    const oldest = e.rows.find((r) => r.tokenHash === sha256Hex(toks[0]))!;
    expect(oldest.revokeReason).toBe('DEVICE_LIMIT');
    expect(active.some((r) => r.tokenHash === sha256Hex(sixth))).toBe(true);
    // Cả 4 thiết bị còn lại vẫn dùng được
    expect(e.rows.filter((r) => toks.slice(1).some((t) => sha256Hex(t) === r.tokenHash)).every((r) => r.revokedAt === null)).toBe(true);
  });
  it('giới hạn tính riêng từng nhân viên', async () => {
    const e = build({ emps: [
      { id: 'e1', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['sale'] },
      { id: 'e2', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['admin'] }] });
    for (let i = 0; i < REMEMBER_MAX_DEVICES; i += 1) await seedDevice(e, { employeeId: 'e1' });
    await seedDevice(e, { employeeId: 'e2' });
    expect(e.rows.filter((r) => r.employeeId === 'e1' && r.revokedAt === null)).toHaveLength(REMEMBER_MAX_DEVICES);
  });
});

describe('restoreRemembered — tái lập phiên thường từ token ghi nhớ', () => {
  it('không có cookie => ABSENT, không chạm DB, không tính hạn mức', async () => {
    const e = build();
    const r = await e.svc.restoreRemembered({ ...ctx, token: null });
    expect(r.kind).toBe('ABSENT');
    expect(e.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('thành công: phiên MỚI (8h idle/12h abs), CSRF mới, token rotate (cùng family, CÙNG mốc tuyệt đối, không gia hạn), audit', async () => {
    const e = build();
    const tok = await seedDevice(e);
    jest.setSystemTime(new Date(T0.getTime() + 30 * DAY));
    const r = await e.svc.restoreRemembered({ ...ctx, token: tok });
    if (r.kind !== 'OK') throw new Error('mong đợi OK, nhận ' + r.kind);
    expect(r.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.remember.token).not.toBe(tok);
    const [oldRow, newRow] = e.rows;
    expect(oldRow.rotatedAt).not.toBeNull();
    expect(oldRow.replacedById).toBe(newRow.id);
    expect(newRow.familyId).toBe(oldRow.familyId);
    expect(newRow.absExpiresAt.getTime()).toBe(oldRow.absExpiresAt.getTime()); // không gia hạn
    expect(newRow.passwordAuthAt.getTime()).toBe(T0.getTime());
    expect(newRow.tokenHash).toBe(sha256Hex(r.remember.token));
    expect(r.remember.maxAgeSeconds).toBe(60 * 86_400); // còn đúng 60 ngày tới mốc 90
    const s = e.sessions[0] as { idleExpiresAt: Date; absExpiresAt: Date; issuedAt: Date; refreshHash: string };
    expect(s.absExpiresAt.getTime() - s.issuedAt.getTime()).toBe(12 * 3_600_000);
    expect(s.idleExpiresAt.getTime() - s.issuedAt.getTime()).toBe(480 * 60_000);
    expect(s.refreshHash).toBe(sha256Hex(r.sessionToken));
    expect(e.audits.map((a) => a.action)).toContain('auth.remember_restored');
    expect(JSON.stringify(e.audits)).not.toContain(tok);
    expect(JSON.stringify(e.audits)).not.toContain(r.sessionToken);
  });
  it('token đã dùng một lần: dùng lại SAU cửa sổ race = REPLAY thật => thu hồi cả family (kể cả token con), audit, INVALID', async () => {
    const e = build();
    const tok = await seedDevice(e);
    const first = await e.svc.restoreRemembered({ ...ctx, token: tok });
    if (first.kind !== 'OK') throw new Error('first');
    jest.setSystemTime(new Date(T0.getTime() + REMEMBER_RACE_GRACE_MS + 1000));
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(e.rows.some((r) => r.revokeReason === 'REPLAY')).toBe(true);
    expect(e.audits.map((a) => a.action)).toContain('auth.remember_replay');
    // token con (kẻ hợp pháp) cũng bị vô hiệu: buộc nhập lại mật khẩu
    expect((await e.svc.restoreRemembered({ ...ctx, token: first.remember.token })).kind).toBe('INVALID');
  });
  it('hai request song song cùng token: đúng MỘT thắng, request còn lại RACE — không thu hồi, không báo replay, không tạo thêm session', async () => {
    const e = build();
    const tok = await seedDevice(e);
    const [a, b] = await Promise.all([e.svc.restoreRemembered({ ...ctx, token: tok }), e.svc.restoreRemembered({ ...ctx, token: tok })]);
    expect([a.kind, b.kind].sort()).toEqual(['OK', 'RACE']);
    expect(e.sessions).toHaveLength(1);
    expect(e.rows.filter((r) => r.revokedAt !== null)).toHaveLength(0);
    expect(e.audits.map((x) => x.action)).not.toContain('auth.remember_replay');
    expect(e.rows.filter((r) => r.rotatedAt === null)).toHaveLength(1); // đúng một token hiện hành
  });
  it('mười request song song: đúng một thắng', async () => {
    const e = build();
    const tok = await seedDevice(e);
    const rs = await Promise.all(Array.from({ length: 10 }, () => e.svc.restoreRemembered({ ...ctx, token: tok })));
    expect(rs.filter((r) => r.kind === 'OK')).toHaveLength(1);
    expect(rs.filter((r) => r.kind === 'RACE')).toHaveLength(9);
    expect(e.sessions).toHaveLength(1);
  });
  it('token giả/không có trong DB => INVALID, không lộ gì, không ghi', async () => {
    const e = build();
    const r = await e.svc.restoreRemembered({ ...ctx, token: newOpaqueToken() });
    expect(r.kind).toBe('INVALID');
    expect(e.sessions).toHaveLength(0);
    expect(e.rows).toHaveLength(0);
  });
  it('mốc 90 ngày: 89 ngày 23:59 còn dùng được; đúng 90 ngày thì INVALID; không có gia hạn âm thầm', async () => {
    const e = build();
    const tok = await seedDevice(e);
    jest.setSystemTime(new Date(T0.getTime() + 90 * DAY - 60_000));
    const ok = await e.svc.restoreRemembered({ ...ctx, token: tok });
    if (ok.kind !== 'OK') throw new Error('89d23h59m phải OK, nhận ' + ok.kind);
    expect(ok.remember.maxAgeSeconds).toBe(60); // chỉ còn 1 phút tới mốc cứng
    jest.setSystemTime(new Date(T0.getTime() + 90 * DAY));
    expect((await e.svc.restoreRemembered({ ...ctx, token: ok.remember.token })).kind).toBe('INVALID');
    jest.setSystemTime(new Date(T0.getTime() + 91 * DAY));
    expect((await e.svc.restoreRemembered({ ...ctx, token: ok.remember.token })).kind).toBe('INVALID');
  });
  it('mốc 90 ngày không đổi theo múi giờ tiến trình (UTC vs Asia/Ho_Chi_Minh)', async () => {
    const before = process.env.TZ;
    try {
      const abs: number[] = [];
      for (const tz of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        const e = build(); await seedDevice(e); abs.push(e.rows[0].absExpiresAt.getTime());
      }
      expect(new Set(abs).size).toBe(1);
    } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  });
  it.each([
    ['nhân viên không ACTIVE', (x: Emp) => { x.status = 'INACTIVE'; }],
    ['nhân viên đã xoá mềm', (x: Emp) => { x.deletedAt = new Date(); }],
    ['credential bị khoá (DISABLED)', (x: Emp) => { x.credential!.status = 'DISABLED'; }],
    ['không có credential', (x: Emp) => { x.credential = null; }],
    ['must_change_password = true (không được bỏ qua)', (x: Emp) => { x.credential!.mustChangePassword = true; }],
    ['token_version đã đổi (đổi mật khẩu ở nơi khác)', (x: Emp) => { x.credential!.tokenVersion = 4; }],
  ])('%s => INVALID, thu hồi chuỗi, không tạo phiên', async (_n, mutate) => {
    const e = build();
    const tok = await seedDevice(e);
    mutate(e.emps[0]);
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.sessions).toHaveLength(0);
    expect(e.rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(e.rows.filter((r) => r.rotatedAt === null || r.revokedAt !== null)).toHaveLength(e.rows.length);
  });
  it('token đã bị thu hồi (logout/đổi mật khẩu/thu hồi tất cả) => INVALID', async () => {
    const e = build();
    const tok = await seedDevice(e);
    e.rows[0].revokedAt = new Date(); e.rows[0].revokeReason = 'LOGOUT';
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.sessions).toHaveLength(0);
  });
  it('hạn mức theo nguồn: vượt ngưỡng => 429 REMEMBER_THROTTLED trước khi chạm DB', async () => {
    const e = build();
    e.cfg.loginMaxPerSource = 3;
    const svc = new AuthService(e.prisma as never, e.cfg as never, e.sessionProvider as never);
    for (let i = 0; i < 3; i += 1) await svc.restoreRemembered({ ...ctx, token: newOpaqueToken() });
    const calls = (e.prisma.$transaction as jest.Mock).mock.calls.length;
    const x = await err(svc.restoreRemembered({ ...ctx, token: newOpaqueToken() }));
    expect([x.getStatus(), x.code]).toEqual([429, 'REMEMBER_THROTTLED']);
    expect((e.prisma.$transaction as jest.Mock).mock.calls.length).toBe(calls);
  });
  it.each(['sale', 'admin', 'technician', 'accountant'])('vai trò %s: me/quyền của phiên khôi phục đúng như SessionActorProvider cấp, không thêm quyền', async (role) => {
    const e = build({ emps: [{ id: 'e1', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: [role] }] });
    const tok = await seedDevice(e);
    const r = await e.svc.restoreRemembered({ ...ctx, token: tok });
    if (r.kind !== 'OK') throw new Error('OK');
    expect(r.me.roles).toEqual([role]);
    expect(r.me.mustChangePassword).toBe(false);
    expect(Object.keys(r.me.permissions)).toHaveLength(0);
  });
});

describe('login(remember) — checkbox mặc định KHÔNG tích', () => {
  async function loginWith(over: Record<string, unknown>) {
    const e = build();
    const emp = { id: 'e1', code: 'NV-0001', fullName: 'A', status: 'ACTIVE', departmentId: 'd1',
      credential: { passwordHash: '$argon2id$x', passwordAlgo: 'argon2id', status: 'ACTIVE', lockedUntil: null, failedCount: 0, windowStartedAt: null, lockLevel: 0, mustChangePassword: false, tokenVersion: 3 } };
    (e.prisma as unknown as Record<string, unknown>).$queryRaw = jest.fn().mockResolvedValue([{ id: 'e1' }]);
    (e.prisma.employee as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(emp);
    (e.svc as unknown as { hasher: unknown }).hasher = { verify: jest.fn().mockResolvedValue(true), hash: jest.fn() };
    const r = await e.svc.login({ login: 'NV-0001', password: PW, source: '127.0.0.1', ip: '10.1.2.3', userAgent: 'ua', requestId: 'r', ...over });
    return { e, r };
  }
  it('không gửi remember / remember=false: không tạo hàng remember_device, kết quả không có remember', async () => {
    for (const over of [{}, { remember: false }]) {
      const { e, r } = await loginWith(over);
      expect(e.rows).toHaveLength(0);
      expect(r.remember).toBeUndefined();
      expect(r.maxAgeSeconds).toBe(480 * 60); // phiên thường 8h idle
    }
  });
  it('remember=true: cấp token ghi nhớ 90 ngày, mốc = thời điểm nhập mật khẩu; phiên thường vẫn 8h/12h', async () => {
    const { e, r } = await loginWith({ remember: true });
    expect(e.rows).toHaveLength(1);
    expect(r.remember!.maxAgeSeconds).toBe(90 * 86_400);
    expect(e.rows[0].passwordAuthAt.getTime()).toBe(T0.getTime());
    expect(e.rows[0].tokenHash).toBe(sha256Hex(r.remember!.token));
    expect(r.maxAgeSeconds).toBe(480 * 60);
    const s = e.sessions[0] as { absExpiresAt: Date; issuedAt: Date };
    expect(s.absExpiresAt.getTime() - s.issuedAt.getTime()).toBe(12 * 3_600_000);
  });
  it('đăng nhập KHÔNG tích nhớ trên thiết bị còn cookie cũ: thu hồi chuỗi cũ (LOGIN_NO_REMEMBER), không cấp mới', async () => {
    const e0 = build();
    const old = await seedDevice(e0);
    const emp = { id: 'e1', code: 'NV-0001', fullName: 'A', status: 'ACTIVE', departmentId: 'd1',
      credential: { passwordHash: '$argon2id$x', passwordAlgo: 'argon2id', status: 'ACTIVE', lockedUntil: null, failedCount: 0, windowStartedAt: null, lockLevel: 0, mustChangePassword: false, tokenVersion: 3 } };
    (e0.prisma as unknown as Record<string, unknown>).$queryRaw = jest.fn().mockResolvedValue([{ id: 'e1' }]);
    (e0.prisma.employee as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue(emp);
    (e0.svc as unknown as { hasher: unknown }).hasher = { verify: jest.fn().mockResolvedValue(true), hash: jest.fn() };
    const r = await e0.svc.login({ login: 'NV-0001', password: PW, source: 's', ip: null, userAgent: null, previousRememberToken: old });
    expect(r.remember).toBeUndefined();
    expect(e0.rows).toHaveLength(1);
    expect(e0.rows[0].revokeReason).toBe('LOGIN_NO_REMEMBER');
  });
  it('mật khẩu sai: không cấp, không thu hồi gì', async () => {
    const e = build();
    const old = await seedDevice(e);
    (e.prisma as unknown as Record<string, unknown>).$queryRaw = jest.fn().mockResolvedValue([{ id: 'e1' }]);
    (e.prisma.employee as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue({ id: 'e1', code: 'c', fullName: 'x', status: 'ACTIVE', departmentId: null,
      credential: { passwordHash: '$argon2id$x', passwordAlgo: 'argon2id', status: 'ACTIVE', lockedUntil: null, failedCount: 0, windowStartedAt: null, lockLevel: 0, mustChangePassword: false, tokenVersion: 3 } });
    (e.svc as unknown as { hasher: unknown }).hasher = { verify: jest.fn().mockResolvedValue(false), hash: jest.fn() };
    const x = await err(e.svc.login({ login: 'NV-0001', password: PW, source: 's', ip: null, userAgent: null, remember: true, previousRememberToken: old }));
    expect(x.code).toBe('LOGIN_INVALID');
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0].revokedAt).toBeNull();
  });
});

describe('thu hồi', () => {
  it('logout: thu hồi chuỗi của thiết bị này (LOGOUT); token của NGƯỜI KHÁC không bị đụng', async () => {
    const e = build({ emps: [
      { id: 'e1', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['sale'] },
      { id: 'e2', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['admin'] }] });
    const mine = await seedDevice(e, { employeeId: 'e1' });
    const other = await seedDevice(e, { employeeId: 'e2' });
    const auth = (e.prisma as unknown as { authSession: { updateMany?: jest.Mock } }).authSession;
    auth.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await e.svc.logout(S1, 'r1', other); // cookie của e2 gửi kèm phiên e1 => bỏ qua
    expect(e.rows.every((r) => r.revokedAt === null)).toBe(true);
    await e.svc.logout(S1, 'r1', mine);
    expect(e.rows.find((r) => r.tokenHash === sha256Hex(mine))!.revokeReason).toBe('LOGOUT');
    expect(e.rows.find((r) => r.tokenHash === sha256Hex(other))!.revokedAt).toBeNull();
    // sau logout token cũ không tái lập được phiên
    expect((await e.svc.restoreRemembered({ ...ctx, token: mine })).kind).toBe('INVALID');
  });
  it('logout không có cookie nhớ vẫn chạy như cũ', async () => {
    const e = build();
    (e.prisma as unknown as { authSession: { updateMany?: jest.Mock } }).authSession.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await expect(e.svc.logout(S1, 'r1')).resolves.toBeUndefined();
  });
  it('revoke-all: thu hồi mọi thiết bị của CHÍNH MÌNH (REVOKE_ALL), không đụng người khác', async () => {
    const e = build({ emps: [
      { id: 'e1', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['sale'] },
      { id: 'e2', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['admin'] }] });
    await seedDevice(e, { employeeId: 'e1' }); await seedDevice(e, { employeeId: 'e1' }); const o = await seedDevice(e, { employeeId: 'e2' });
    expect(await e.svc.revokeAllRememberDevices(S1, 'r1')).toBe(2);
    expect(e.rows.filter((r) => r.employeeId === 'e1').every((r) => r.revokeReason === 'REVOKE_ALL')).toBe(true);
    expect(e.rows.find((r) => r.tokenHash === sha256Hex(o))!.revokedAt).toBeNull();
  });
  it('thu hồi MỘT thiết bị: chỉ của chính mình; id của người khác/không tồn tại => false (404 như nhau)', async () => {
    const e = build({ emps: [
      { id: 'e1', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['sale'] },
      { id: 'e2', status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE', mustChangePassword: false, tokenVersion: 3 }, roles: ['admin'] }] });
    await seedDevice(e, { employeeId: 'e1' }); await seedDevice(e, { employeeId: 'e2' });
    const mineFam = e.rows[0].familyId; const otherFam = e.rows[1].familyId;
    expect(await e.svc.revokeRememberDevice(S1, otherFam, 'r1')).toBe(false);
    expect(await e.svc.revokeRememberDevice(S1, randomUUID(), 'r1')).toBe(false);
    expect(e.rows.every((r) => r.revokedAt === null)).toBe(true);
    expect(await e.svc.revokeRememberDevice(S1, mineFam, 'r1')).toBe(true);
    expect(e.rows[0].revokeReason).toBe('REVOKED_BY_USER');
    expect(e.rows[1].revokedAt).toBeNull();
  });
  it('liệt kê: chỉ thiết bị hiện hành của mình, đánh dấu current; KHÔNG trả token/băm', async () => {
    const e = build();
    const a = await seedDevice(e); await seedDevice(e);
    e.rows[1].revokedAt = new Date(); e.rows[1].revokeReason = 'LOGOUT';
    const list = await e.svc.listRememberDevices(S1, a);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ id: e.rows[0].familyId, uaShort: 'jest-agent', ipPrefix: '10.1.2.0/24', issuedAt: e.rows[0].issuedAt, lastUsedAt: e.rows[0].lastUsedAt, expiresAt: e.rows[0].absExpiresAt, current: true });
    expect(JSON.stringify(list)).not.toContain(a);
    expect(JSON.stringify(list)).not.toContain(sha256Hex(a));
  });
  it('đổi mật khẩu / khoá tài khoản (token_version tăng => trigger DB thu hồi): mô phỏng cơ chế DB rồi restore bị từ chối', async () => {
    const e = build();
    const tok = await seedDevice(e);
    e.rows.forEach((r) => { r.revokedAt = new Date(); r.revokeReason = 'TOKEN_VERSION'; });
    e.emps[0].credential!.tokenVersion = 4;
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.sessions).toHaveLength(0);
  });
});

// QA bảo mật lần 1 (PR #184): I-1 phiên tái lập KHÔNG được sống quá mốc 90 ngày; I-2 phát hiện replay phải thu hồi cả phiên đang mở.
describe('QA bảo mật I-1/I-2', () => {
  it('I-1: restore sát mốc 90 ngày => phiên mới hết hạn tuyệt đối ĐÚNG mốc 90 ngày (không +12h), idle <= abs, cookie phiên <= thời gian còn lại', async () => {
    const e = build();
    const tok = await seedDevice(e, { passwordAuthAt: T0 });
    jest.setSystemTime(new Date(T0.getTime() + 90 * DAY - 2 * 3_600_000)); // còn 2 giờ tới mốc
    const r = await e.svc.restoreRemembered({ ...ctx, token: tok });
    if (r.kind !== 'OK') throw new Error('mong đợi OK, nhận ' + r.kind);
    const s = e.sessions[0] as { idleExpiresAt: Date; absExpiresAt: Date };
    expect(s.absExpiresAt.getTime()).toBe(T0.getTime() + 90 * DAY);
    expect(s.idleExpiresAt.getTime()).toBeLessThanOrEqual(s.absExpiresAt.getTime());
    expect(r.maxAgeSeconds).toBeLessThanOrEqual(2 * 3600);
    expect(r.remember.maxAgeSeconds).toBeLessThanOrEqual(2 * 3600);
  });
  it('I-1: còn xa mốc => giữ chính sách phiên thường (12h abs)', async () => {
    const e = build();
    const tok = await seedDevice(e, { passwordAuthAt: T0 });
    jest.setSystemTime(new Date(T0.getTime() + 10 * DAY));
    const r = await e.svc.restoreRemembered({ ...ctx, token: tok });
    if (r.kind !== 'OK') throw new Error('mong đợi OK');
    const s = e.sessions[0] as { absExpiresAt: Date; issuedAt: Date };
    expect(s.absExpiresAt.getTime() - s.issuedAt.getTime()).toBe(12 * 3_600_000);
  });
  it('I-2: replay thật => thu hồi family VÀ mọi auth_session đang mở của nhân viên (kẻ đã restore trước bị đá ra)', async () => {
    const e = build();
    const tok = await seedDevice(e);
    const ok = await e.svc.restoreRemembered({ ...ctx, token: tok });
    expect(ok.kind).toBe('OK');
    jest.setSystemTime(new Date(Date.now() + 11_000));
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.sessionRevokes).toEqual([expect.objectContaining({ employeeId: 'e1', reason: 'REMEMBER_REPLAY' })]);
  });
});

// QA lần 2 Minor-2: thu hồi family chạy song song với rotate => trigger DB từ chối INSERT token con (REMEMBER_FAMILY_REVOKED)
// => restore trả INVALID (401 + xoá cookie) thay vì lỗi 500 lặp lại ở mỗi lần tải trang.
describe('QA lần 2 Minor-2', () => {
  it('rotate bị trigger REMEMBER_FAMILY_REVOKED từ chối => INVALID, không cấp phiên', async () => {
    const e = build();
    const tok = await seedDevice(e);
    e.rememberDevice.create.mockImplementationOnce(async () => { throw new Error('Raw query failed. Code: `23514`. Message: `REMEMBER_FAMILY_REVOKED: family x da bi thu hoi.`'); });
    const r = await e.svc.restoreRemembered({ ...ctx, token: tok });
    expect(r.kind).toBe('INVALID');
    expect(e.sessions).toHaveLength(0);
  });
  it('lỗi DB khác vẫn ném ra (không nuốt lỗi)', async () => {
    const e = build();
    const tok = await seedDevice(e);
    e.rememberDevice.create.mockImplementationOnce(async () => { throw new Error('connection reset'); });
    await expect(e.svc.restoreRemembered({ ...ctx, token: tok })).rejects.toThrow('connection reset');
  });
});

// QA lần 3 Minor-4: hàng "ma" — token con chèn đồng thời với lệnh thu hồi family (snapshot cũ) còn revoked_at IS NULL.
// Bảo mật vẫn giữ (trigger chặn xoay vòng tiếp), nhưng không được hiện là thiết bị đang hoạt động, không được tính vào giới hạn 5 thiết bị.
describe('QA lần 3 Minor-4 — family có hàng đã thu hồi', () => {
  function ghost(e: Env) {
    const fam = randomUUID(); const t = new Date();
    const mk = (over: Partial<Row>): Row => ({ id: randomUUID(), employeeId: 'e1', familyId: fam, tokenHash: sha256Hex(newOpaqueToken()), tokenVersion: 3, passwordAuthAt: t, absExpiresAt: new Date(t.getTime() + 90 * DAY), issuedAt: t, lastUsedAt: new Date(t.getTime() - 5 * DAY), rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null, ipPrefix: null, uaShort: null, ...over });
    e.rows.push(mk({ rotatedAt: t, revokedAt: t, revokeReason: 'LOGOUT' }), mk({}));
    return fam;
  }
  it('liệt kê: KHÔNG hiện family đã có hàng bị thu hồi', async () => {
    const e = build();
    const fam = ghost(e);
    await seedDevice(e);
    const list = await e.svc.listRememberDevices(S1, null);
    expect(list.map((d) => d.id)).not.toContain(fam);
    expect(list).toHaveLength(1);
  });
  it('cấp thiết bị: hàng ma không tính vào giới hạn 5 (không đẩy thiết bị thật ra) và bị thu hồi luôn', async () => {
    const e = build();
    const fam = ghost(e);
    for (let i = 0; i < REMEMBER_MAX_DEVICES; i++) await seedDevice(e);
    const active = e.rows.filter((r) => r.revokedAt === null && r.rotatedAt === null);
    expect(active).toHaveLength(REMEMBER_MAX_DEVICES);
    expect(active.some((r) => r.familyId === fam)).toBe(false);
    expect(e.rows.filter((r) => r.revokeReason === 'DEVICE_LIMIT')).toHaveLength(0);
  });
});

// QA lần 3b Important-A: token cũ đã xoay vòng + family ĐÃ thu hồi => REPLAY (giữ sửa Important-1) nhưng CHỈ thu hồi phiên tạo TRƯỚC thời điểm
// family bị thu hồi. Nạn nhân đăng nhập lại sau đó không bị kẻ cầm token cũ đăng xuất lặp lại; không ghi audit lặp khi không thu hồi gì mới.
describe('QA lần 3b Important-A', () => {
  it('family chưa thu hồi => thu hồi phiên tạo tới THỜI ĐIỂM HIỆN TẠI', async () => {
    const e = build();
    const tok = await seedDevice(e);
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    jest.setSystemTime(new Date(Date.now() + 11_000));
    const at = new Date();
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.sessionRevokes).toEqual([{ employeeId: 'e1', reason: 'REMEMBER_REPLAY', issuedBefore: at }]);
  });
  it('family ĐÃ thu hồi (vd kẻ trộm revoke-all) => chỉ thu hồi phiên tạo trước mốc thu hồi family', async () => {
    const e = build();
    const tok = await seedDevice(e);
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    jest.setSystemTime(new Date(Date.now() + 2_000));
    const revokedAt = new Date();
    await e.svc.revokeAllRememberDevices(S1);
    jest.setSystemTime(new Date(Date.now() + 60_000));
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.sessionRevokes).toEqual([{ employeeId: 'e1', reason: 'REMEMBER_REPLAY', issuedBefore: revokedAt }]);
  });
  it('gửi lại token cũ lần nữa => mốc vẫn là thời điểm family bị thu hồi (phiên đăng nhập lại sau đó an toàn); không audit lặp', async () => {
    const e = build();
    const tok = await seedDevice(e);
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    jest.setSystemTime(new Date(Date.now() + 11_000));
    const firstAt = new Date();
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    const audits1 = e.audits.filter((a) => a.action === 'auth.remember_replay').length;
    jest.setSystemTime(new Date(Date.now() + 3_600_000));
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    expect(e.sessionRevokes[1]).toEqual({ employeeId: 'e1', reason: 'REMEMBER_REPLAY', issuedBefore: firstAt });
    expect(e.audits.filter((a) => a.action === 'auth.remember_replay').length).toBe(audits1 + 1); // QA lần 3c Minor-2: vẫn ghi (đánh dấu)
  });
});

// QA lần 3c Minor-1: đua thu hồi ↔ xoay vòng — kẻ trộm xoay vòng (rotated_at) SAU mốc revoked_at sớm nhất (lệnh thu hồi chốt `now` trước).
// Mốc = max(MIN(revoked_at), MAX(rotated_at)) của family => phiên sinh từ lần xoay vòng đó vẫn bị thu hồi.
describe('QA lần 3c Minor-1', () => {
  it('family có hàng xoay vòng sau mốc thu hồi sớm nhất => mốc = rotated_at muộn nhất', async () => {
    const e = build();
    const tok = await seedDevice(e);
    await e.svc.restoreRemembered({ ...ctx, token: tok }); // hàng 0 xoay vòng, hàng 1 là token con
    const t = Date.now();
    const [first, child] = e.rows;
    first.revokedAt = new Date(t - 5); first.revokeReason = 'REVOKED_BY_USER'; // lệnh thu hồi chốt now_v sớm hơn...
    child.rotatedAt = new Date(t);                                              // ...kẻ trộm xoay vòng con ở now_r > now_v (hàng ma)
    jest.setSystemTime(new Date(t + 11_000));
    expect((await e.svc.restoreRemembered({ ...ctx, token: tok })).kind).toBe('INVALID');
    expect(e.sessionRevokes[0]).toEqual({ employeeId: 'e1', reason: 'REMEMBER_REPLAY', issuedBefore: new Date(t) });
  });
  it('Minor-2: gửi lại token cũ của family đã thu hồi, không còn phiên để thu hồi => VẪN ghi audit (đánh dấu familyAlreadyRevoked)', async () => {
    const e = build();
    const tok = await seedDevice(e);
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    jest.setSystemTime(new Date(Date.now() + 11_000));
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    jest.setSystemTime(new Date(Date.now() + 3_600_000));
    await e.svc.restoreRemembered({ ...ctx, token: tok });
    const rep = e.audits.filter((a) => a.action === 'auth.remember_replay');
    expect(rep).toHaveLength(2);
    expect(rep[1].changes).toEqual({ sessions: 0, familyAlreadyRevoked: true });
  });
});
