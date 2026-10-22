// P-A Sprint PA3 — test HỢP ĐỒNG cho cổng RefreshSessionStore. `FakeStore` chỉ sống trong test (không DB, không SQL).
// !!! KHÔNG chứng minh tính nguyên tử DB: FakeStore đồng bộ nên "nguyên tử" chỉ do JS đơn luồng; adapter DB thật (S8) phải có test riêng. !!!
// Tham số (grace/TTL) là giá trị thử, KHÔNG phải chính sách production.
import { createHash } from 'node:crypto';
import { checkRefreshSessionRow, parseRefreshSessionRow, RefreshSessionRow } from './refresh-session-row';
import {
  assertValidAtomicRotate,
  assertValidCreateFamily,
  assertValidFindActive,
  assertValidRevokeAllForEmployee,
  assertValidRevokeFamily,
  AtomicRotateInput,
  AtomicRotateResult,
  CreateFamilyInput,
  CreateFamilyResult,
  FindActiveInput,
  FindActiveResult,
  RefreshSessionStore,
  RefreshStoreInputError,
  RefreshStoreUnwiredError,
  RevokeAllForEmployeeInput,
  RevokeFamilyInput,
  RevokeResult,
  UnwiredRefreshSessionStore,
} from './refresh-session-store';

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FAM = '44444444-4444-4444-8444-444444444444';
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const GRACE = 10_000;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const uid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const sess = (n: number, tok: string) => ({ id: uid(n), refreshHash: sha(tok), csrfHash: sha(`csrf-${tok}`), idleExpiresAt: at(1000), absExpiresAt: at(5000) });

class FakeStore implements RefreshSessionStore {
  readonly rows: RefreshSessionRow[] = [];
  async createFamily(i: CreateFamilyInput): Promise<CreateFamilyResult> {
    assertValidCreateFamily(i);
    if (this.rows.some((r) => r.id === i.id || r.refreshHash === i.refreshHash)) return { status: 'DUPLICATE' };
    const row: RefreshSessionRow = { id: i.id, employeeId: i.employeeId, familyId: i.familyId, refreshHash: i.refreshHash, csrfHash: i.csrfHash, issuedAt: i.issuedAt, lastUsedAt: i.issuedAt, idleExpiresAt: i.idleExpiresAt, absExpiresAt: i.absExpiresAt, rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null };
    this.rows.push(row);
    return { status: 'CREATED', row };
  }
  async findActiveByRefreshHash(i: FindActiveInput): Promise<FindActiveResult> {
    assertValidFindActive(i);
    const row = this.rows.find((r) => r.refreshHash === i.refreshHash);
    if (!row) return { status: 'NOT_FOUND' };
    return checkRefreshSessionRow({ row, expectedEmployeeId: i.expectedEmployeeId, now: i.now, reuseGraceMs: 0 }) === 'USABLE' ? { status: 'FOUND', row } : { status: 'NOT_FOUND' };
  }
  async atomicRotate(i: AtomicRotateInput): Promise<AtomicRotateResult> {
    assertValidAtomicRotate(i);
    const idx = this.rows.findIndex((r) => r.refreshHash === i.presentedRefreshHash);
    if (idx < 0) return { status: 'UNKNOWN_TOKEN', familyRevoked: false };
    const row = this.rows[idx];
    const st = checkRefreshSessionRow({ row, expectedEmployeeId: i.expectedEmployeeId, now: i.now, reuseGraceMs: i.reuseGraceMs });
    if (st === 'ROTATED_REUSE') {
      this.rows.forEach((r, k) => { if (r.familyId === row.familyId && r.revokedAt === null) this.rows[k] = { ...r, revokedAt: i.now, revokeReason: 'REFRESH_REUSE' }; });
      return { status: st, familyRevoked: true };
    }
    if (st !== 'USABLE') return { status: st, familyRevoked: false };
    const next: RefreshSessionRow = { id: i.next.id, employeeId: row.employeeId, familyId: row.familyId, refreshHash: i.next.refreshHash, csrfHash: i.next.csrfHash, issuedAt: i.now, lastUsedAt: i.now, idleExpiresAt: i.next.idleExpiresAt, absExpiresAt: i.next.absExpiresAt, rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null };
    this.rows[idx] = { ...row, rotatedAt: i.now, replacedById: next.id };
    this.rows.push(next);
    return { status: 'ROTATED', previousRowId: row.id, row: next };
  }
  private revokeWhere(pred: (r: RefreshSessionRow) => boolean, reason: string, now: Date): RevokeResult {
    let n = 0;
    this.rows.forEach((r, k) => { if (pred(r) && r.revokedAt === null) { this.rows[k] = { ...r, revokedAt: now, revokeReason: reason }; n++; } });
    return { revokedCount: n };
  }
  async revokeFamily(i: RevokeFamilyInput): Promise<RevokeResult> {
    assertValidRevokeFamily(i);
    return this.revokeWhere((r) => r.familyId === i.familyId, i.reason, i.now);
  }
  async revokeAllForEmployee(i: RevokeAllForEmployeeInput): Promise<RevokeResult> {
    assertValidRevokeAllForEmployee(i);
    return this.revokeWhere((r) => r.employeeId === i.employeeId, i.reason, i.now);
  }
}

const seed = async (s = new FakeStore(), tok = 'tok-1') => {
  await s.createFamily({ ...sess(1, tok), employeeId: EMP, familyId: FAM, issuedAt: T0 });
  return s;
};
const rot = (s: RefreshSessionStore, from: string, to: string, n: number, now: Date, emp = EMP, grace = GRACE) =>
  s.atomicRotate({ presentedRefreshHash: sha(from), expectedEmployeeId: emp, now, reuseGraceMs: grace, next: { ...sess(n, to), idleExpiresAt: at(now.getTime() - T0.getTime() + 1000), absExpiresAt: at(now.getTime() - T0.getTime() + 5000) } });

describe('PA3 — UnwiredRefreshSessionStore (từ chối mặc định)', () => {
  const u = new UnwiredRefreshSessionStore();
  it.each([
    ['createFamily', () => u.createFamily({ ...sess(1, 'a'), employeeId: EMP, familyId: FAM, issuedAt: T0 })],
    ['findActiveByRefreshHash', () => u.findActiveByRefreshHash({ refreshHash: sha('a'), expectedEmployeeId: EMP, now: T0 })],
    ['atomicRotate', () => u.atomicRotate({ presentedRefreshHash: sha('a'), expectedEmployeeId: EMP, now: T0, reuseGraceMs: GRACE, next: sess(2, 'b') })],
    ['revokeFamily', () => u.revokeFamily({ familyId: FAM, reason: 'LOGOUT', now: T0 })],
    ['revokeAllForEmployee', () => u.revokeAllForEmployee({ employeeId: EMP, reason: 'LOGOUT_ALL', now: T0 })],
  ])('%s ném RefreshStoreUnwiredError, không trả kết quả', async (_n, call) => {
    await expect(call()).rejects.toBeInstanceOf(RefreshStoreUnwiredError);
  });
});

describe('PA3 — bộ kiểm đầu vào (định dạng, không token rõ)', () => {
  const base = { ...sess(1, 'a'), employeeId: EMP, familyId: FAM, issuedAt: T0 };
  it('chấp nhận đầu vào hợp lệ', () => expect(() => assertValidCreateFamily(base)).not.toThrow());
  it('từ chối khóa lạ như refreshToken/csrfToken (không có đường lưu token rõ)', () => {
    expect(() => assertValidCreateFamily({ ...base, refreshToken: 'plain' })).toThrow(/unexpected:refreshToken/);
    expect(() => assertValidCreateFamily({ ...base, csrfToken: 'plain' })).toThrow(/unexpected:csrfToken/);
  });
  it('từ chối băm không phải 64 hex thường (token rõ bị nhét vào trường băm)', () => {
    expect(() => assertValidCreateFamily({ ...base, refreshHash: 'plain-token' })).toThrow(RefreshStoreInputError);
    expect(() => assertValidCreateFamily({ ...base, csrfHash: sha('x').toUpperCase() })).toThrow(RefreshStoreInputError);
  });
  it('từ chối UUID hỏng và family/employee sai định dạng', () => {
    expect(() => assertValidCreateFamily({ ...base, familyId: 'fam-1' })).toThrow(/familyId/);
    expect(() => assertValidCreateFamily({ ...base, employeeId: 'x' })).toThrow(/employeeId/);
  });
  it('từ chối vi phạm ck_sess_idle / ck_sess_abs', () => {
    expect(() => assertValidCreateFamily({ ...base, idleExpiresAt: at(9000) })).toThrow(/ck_sess_idle/);
    expect(() => assertValidCreateFamily({ ...base, absExpiresAt: at(-1) , idleExpiresAt: at(-2) })).toThrow(/ck_sess_abs/);
  });
  it('atomicRotate: reuseGraceMs BẮT BUỘC, không mặc định', () => {
    const ok = { presentedRefreshHash: sha('a'), expectedEmployeeId: EMP, now: T0, reuseGraceMs: GRACE, next: sess(2, 'b') };
    expect(() => assertValidAtomicRotate(ok)).not.toThrow();
    const { reuseGraceMs: _g, ...noGrace } = ok;
    expect(() => assertValidAtomicRotate(noGrace)).toThrow(/reuseGraceMs/);
    for (const bad of [-1, 1.5, NaN, Infinity, '10']) expect(() => assertValidAtomicRotate({ ...ok, reuseGraceMs: bad })).toThrow(/reuseGraceMs/);
  });
  it('atomicRotate: next không được trùng băm đang trình bày; next bị kiểm như hàng mới', () => {
    const ok = { presentedRefreshHash: sha('a'), expectedEmployeeId: EMP, now: T0, reuseGraceMs: GRACE, next: sess(2, 'a') };
    expect(() => assertValidAtomicRotate(ok)).toThrow(/next.refreshHash_reuses_presented/);
    expect(() => assertValidAtomicRotate({ ...ok, next: { ...sess(2, 'b'), refreshToken: 'plain' } })).toThrow(/next.unexpected:refreshToken/);
  });
  it('actor không lấy từ request: khóa employeeId lạ/giả mạo trong rotate bị từ chối', () => {
    const ok = { presentedRefreshHash: sha('a'), expectedEmployeeId: EMP, now: T0, reuseGraceMs: GRACE, next: sess(2, 'b') };
    expect(() => assertValidAtomicRotate({ ...ok, employeeId: OTHER })).toThrow(/unexpected:employeeId/);
    expect(() => assertValidAtomicRotate({ ...ok, expectedEmployeeId: '../admin' })).toThrow(/expectedEmployeeId/);
  });
  it('revoke: lý do phải HOA/_ và <= 40 ký tự', () => {
    for (const reason of ['logout', '', 'A'.repeat(41), 'X Y', null]) expect(() => assertValidRevokeFamily({ familyId: FAM, reason, now: T0 })).toThrow(/reason/);
    expect(() => assertValidRevokeAllForEmployee({ employeeId: EMP, reason: 'PASSWORD_CHANGED', now: T0 })).not.toThrow();
  });
  it('lỗi chỉ chứa tên trường, không rò giá trị băm', () => {
    try { assertValidCreateFamily({ ...base, refreshHash: 'SECRET-PLAINTEXT' }); fail('phải ném'); } catch (e) { expect((e as Error).message).not.toContain('SECRET-PLAINTEXT'); }
  });
});

describe('PA3 — hợp đồng hành vi qua FakeStore (KHÔNG chứng minh nguyên tử DB)', () => {
  it('createFamily: hàng chỉ có băm, family/băm đúng định dạng, parse PA1 hợp lệ', async () => {
    const s = await seed();
    const row = s.rows[0];
    expect(parseRefreshSessionRow(row).ok).toBe(true);
    expect(row.familyId).toBe(FAM);
    expect(row.refreshHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(s.rows)).not.toContain('tok-1');
    expect((await s.createFamily({ ...sess(1, 'tok-1'), employeeId: EMP, familyId: FAM, issuedAt: T0 })).status).toBe('DUPLICATE');
  });
  it('findActive: tìm được hàng active; sai nhân viên / hết hạn idle / hết hạn tuyệt đối => NOT_FOUND', async () => {
    const s = await seed();
    const q = (now: Date, emp = EMP) => s.findActiveByRefreshHash({ refreshHash: sha('tok-1'), expectedEmployeeId: emp, now });
    expect((await q(at(999))).status).toBe('FOUND');
    expect((await q(at(1000))).status).toBe('NOT_FOUND'); // biên idle nửa mở
    expect((await q(at(5000))).status).toBe('NOT_FOUND'); // biên tuyệt đối
    expect((await q(at(10), OTHER)).status).toBe('NOT_FOUND');
    expect((await s.findActiveByRefreshHash({ refreshHash: sha('unknown'), expectedEmployeeId: EMP, now: at(1) })).status).toBe('NOT_FOUND');
  });
  it('atomicRotate: ROTATED một lần, cùng family, hàng cũ trỏ replacedById, chỉ băm trong kho', async () => {
    const s = await seed();
    const r = await rot(s, 'tok-1', 'tok-2', 2, at(100));
    expect(r.status).toBe('ROTATED');
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ rotatedAt: at(100), replacedById: uid(2) });
    expect(s.rows[1].familyId).toBe(FAM);
    expect(s.rows.every((x) => parseRefreshSessionRow(x).ok)).toBe(true);
    expect(JSON.stringify(s.rows)).not.toMatch(/tok-1|tok-2/);
  });
  it('atomicRotate: phát lại trong cửa sổ => ROTATED_RECENT, không ghi, không thu hồi', async () => {
    const s = await seed();
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    const before = JSON.stringify(s.rows);
    expect(await rot(s, 'tok-1', 'tok-3', 3, at(100 + GRACE - 1))).toEqual({ status: 'ROTATED_RECENT', familyRevoked: false });
    expect(JSON.stringify(s.rows)).toBe(before);
  });
  it('atomicRotate: phát lại ngoài cửa sổ => ROTATED_REUSE, thu hồi cả family, không phát token mới', async () => {
    const s = await seed();
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    expect(await rot(s, 'tok-1', 'tok-3', 3, at(100 + GRACE))).toEqual({ status: 'ROTATED_REUSE', familyRevoked: true });
    expect(s.rows).toHaveLength(2);
    expect(s.rows.every((x) => x.revokedAt !== null && x.revokeReason === 'REFRESH_REUSE')).toBe(true);
    expect((await rot(s, 'tok-2', 'tok-4', 4, at(100 + GRACE + 1))).status).toBe('REVOKED');
  });
  it('atomicRotate: REVOKED / ABS_EXPIRED / IDLE_EXPIRED / WRONG_EMPLOYEE / UNKNOWN_TOKEN => từ chối, không ghi', async () => {
    const s = await seed();
    const snap = () => JSON.stringify(s.rows);
    const before = snap();
    expect(await rot(s, 'tok-1', 'x', 9, at(1000))).toEqual({ status: 'IDLE_EXPIRED', familyRevoked: false });
    expect(await rot(s, 'tok-1', 'x', 9, at(5000))).toEqual({ status: 'ABS_EXPIRED', familyRevoked: false }); // ABS ưu tiên hơn IDLE
    expect(await rot(s, 'tok-1', 'x', 9, at(10), OTHER)).toEqual({ status: 'WRONG_EMPLOYEE', familyRevoked: false });
    expect(await rot(s, 'nope', 'x', 9, at(10))).toEqual({ status: 'UNKNOWN_TOKEN', familyRevoked: false });
    expect(snap()).toBe(before);
    await s.revokeFamily({ familyId: FAM, reason: 'LOGOUT', now: at(20) });
    expect((await rot(s, 'tok-1', 'x', 9, at(30))).status).toBe('REVOKED');
  });
  it('atomicRotate: ABS_EXPIRED khi idle == abs và now >= abs (ưu tiên ABS)', async () => {
    const s = new FakeStore();
    await s.createFamily({ ...sess(1, 'tok-1'), idleExpiresAt: at(5000), employeeId: EMP, familyId: FAM, issuedAt: T0 });
    expect((await rot(s, 'tok-1', 'x', 9, at(5000))).status).toBe('ABS_EXPIRED');
  });
  it('revokeFamily / revokeAllForEmployee: có lý do, đếm số hàng, idempotent, không đụng nhân viên khác', async () => {
    const s = await seed();
    await s.createFamily({ ...sess(7, 'o-1'), employeeId: OTHER, familyId: '55555555-5555-4555-8555-555555555555', issuedAt: T0 });
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    expect(await s.revokeFamily({ familyId: FAM, reason: 'LOGOUT', now: at(200) })).toEqual({ revokedCount: 2 });
    expect(await s.revokeFamily({ familyId: FAM, reason: 'LOGOUT', now: at(300) })).toEqual({ revokedCount: 0 });
    expect(s.rows.filter((x) => x.employeeId === EMP).every((x) => x.revokeReason === 'LOGOUT')).toBe(true);
    expect(s.rows.find((x) => x.employeeId === OTHER)?.revokedAt).toBeNull();
    expect(await s.revokeAllForEmployee({ employeeId: OTHER, reason: 'PASSWORD_CHANGED', now: at(400) })).toEqual({ revokedCount: 1 });
    expect(s.rows.every((x) => parseRefreshSessionRow(x).ok)).toBe(true);
  });
});
