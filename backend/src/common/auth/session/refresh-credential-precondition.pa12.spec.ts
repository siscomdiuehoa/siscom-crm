// P-A Sprint PA12 — test HỢP ĐỒNG cho điều kiện tiên quyết credential của `atomicRotateGuarded`. Kho giả chỉ sống trong test (không DB/SQL/env).
// !!! KHÔNG chứng minh tính nguyên tử DB: kho giả đồng bộ trong một tiến trình JS; "đồng thời" chỉ mô phỏng thứ tự đan xen. Nguyên tử thật giữa đổi mật khẩu và xoay
// còn CHƯA CHỨNG MINH đến F09 (cần cột token_version gắn phiên + giao dịch DB). Chính sách trạng thái trong test là giá trị thử, KHÔNG phải chính sách production. !!!
import { createHash } from 'node:crypto';
import { checkRefreshSessionRow, RefreshSessionRow } from './refresh-session-row';
import { assertValidCreateFamily, AtomicRotateInput, CreateFamilyInput, deriveRotatedChildRow, RefreshStoreInputError, RefreshStoreUnwiredError } from './refresh-session-store';
import {
  assertValidGuardedRotate,
  CredentialAuthoritativeState,
  evaluateCredentialPrecondition,
  GuardedAtomicRotateInput,
  GuardedAtomicRotateResult,
  REFRESH_DENIED,
  toUniformRefreshDenial,
  UnwiredCredentialGuardedRefreshSessionStore,
} from './refresh-credential-precondition';

const EMP = '11111111-1111-4111-8111-111111111111';
const FAM = '44444444-4444-4444-8444-444444444444';
const FAM2 = '55555555-5555-4555-8555-555555555555';
const OTHER = '22222222-2222-4222-8222-222222222222';
const T0 = new Date(1_800_000_000_000);
const at = (ms: number) => new Date(T0.getTime() + ms);
const GRACE = 10_000;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const uid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const POLICY = ['ACTIVE']; // giá trị thử; KHÔNG quyết định ON_LEAVE
const nxt = (n: number, tok: string) => ({ id: uid(n), refreshHash: sha(tok), csrfHash: sha(`csrf-${tok}`), idleTtlMs: 1000 });
const sess = (n: number, tok: string): Omit<CreateFamilyInput, 'employeeId' | 'familyId' | 'issuedAt'> => ({ id: uid(n), refreshHash: sha(tok), csrfHash: sha(`csrf-${tok}`), idleExpiresAt: at(1000), absExpiresAt: at(50_000) });

/** Nguồn credential giả: trong adapter thật việc đọc này nằm TRONG giao dịch. `undefined` = không có nguồn. */
type Cred = { read(employeeId: string): unknown };
class CredFake implements Cred {
  readonly state = new Map<string, CredentialAuthoritativeState>();
  throwOnRead = false;
  reads = 0;
  read(id: string): unknown {
    this.reads++;
    if (this.throwOnRead) throw new Error('boom');
    return this.state.get(id);
  }
}

// Kho giả ĐÚNG hợp đồng C1-C3: đọc credential + phân loại + ghi trong MỘT hàm đồng bộ (không await xen giữa).
class GuardedFake {
  readonly rows: RefreshSessionRow[] = [];
  constructor(readonly cred: Cred | undefined, private readonly checkCredential = true) {}
  async createFamily(i: CreateFamilyInput) {
    assertValidCreateFamily(i);
    this.rows.push({ id: i.id, employeeId: i.employeeId, familyId: i.familyId, refreshHash: i.refreshHash, csrfHash: i.csrfHash, issuedAt: i.issuedAt, lastUsedAt: i.issuedAt, idleExpiresAt: i.idleExpiresAt, absExpiresAt: i.absExpiresAt, rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null });
  }
  async atomicRotateGuarded(i: GuardedAtomicRotateInput): Promise<GuardedAtomicRotateResult> {
    assertValidGuardedRotate(i);
    if (this.checkCredential) {
      let state: unknown;
      try {
        state = this.cred ? this.cred.read(i.expectedEmployeeId) : undefined;
      } catch {
        state = undefined;
      }
      const deny = evaluateCredentialPrecondition(state, i.credential);
      if (deny) return { status: deny, familyRevoked: false }; // C2: không ghi gì, không thu hồi
    }
    const idx = this.rows.findIndex((r) => r.refreshHash === i.presentedRefreshHash);
    if (idx < 0) return { status: 'UNKNOWN_TOKEN', familyRevoked: false };
    const row = this.rows[idx];
    const st = checkRefreshSessionRow({ row, expectedEmployeeId: i.expectedEmployeeId, now: i.now, reuseGraceMs: i.reuseGraceMs });
    if (st === 'ROTATED_REUSE') {
      this.rows.forEach((r, k) => { if (r.familyId === row.familyId && r.revokedAt === null) this.rows[k] = { ...r, revokedAt: i.now, revokeReason: 'REFRESH_REUSE' }; });
      return { status: st, familyRevoked: true };
    }
    if (st !== 'USABLE') return { status: st, familyRevoked: false };
    const { credential: _c, ...base } = i;
    const next = deriveRotatedChildRow(row, base as AtomicRotateInput);
    this.rows[idx] = { ...row, rotatedAt: i.now, replacedById: next.id };
    this.rows.push(next);
    return { status: 'ROTATED', previousRowId: row.id, row: next };
  }
}

const snapshot = (s: GuardedFake) => JSON.stringify(s.rows);
const input = (from: string, to: string, n: number, now: Date, tv = 1, policy: readonly string[] = POLICY, emp = EMP): GuardedAtomicRotateInput => ({
  presentedRefreshHash: sha(from), expectedEmployeeId: emp, now, reuseGraceMs: GRACE, next: nxt(n, to), credential: { expectedTokenVersion: tv, allowedEmployeeStatuses: policy },
});
const setup = async (cred: CredFake | undefined, status = 'ACTIVE', tv = 1, check = true) => {
  cred?.state.set(EMP, { employeeStatus: status, tokenVersion: tv });
  const s = new GuardedFake(cred, check);
  await s.createFamily({ ...sess(1, 'tok-1'), employeeId: EMP, familyId: FAM, issuedAt: T0 });
  // Hàng của gia đình KHÁC (cùng nhân viên khác thiết bị + nhân viên khác) để chứng minh không bị thu hồi lan.
  await s.createFamily({ ...sess(2, 'other-fam'), employeeId: EMP, familyId: FAM2, issuedAt: T0 });
  await s.createFamily({ ...sess(3, 'other-emp'), employeeId: OTHER, familyId: uid(9), issuedAt: T0 });
  return s;
};

describe('PA12 điều kiện credential cho atomicRotateGuarded (kho giả; KHÔNG phải bằng chứng giao dịch DB)', () => {
  it('luồng hợp lệ không đổi: token_version khớp + trạng thái được phép => ROTATED, hàng mới cùng family', async () => {
    const s = await setup(new CredFake());
    const r = await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100)));
    expect(r.status).toBe('ROTATED');
    expect(s.rows).toHaveLength(4);
    expect(s.rows.find((x) => x.id === uid(10))?.familyId).toBe(FAM);
    expect(toUniformRefreshDenial(r)).toEqual({ ok: true });
  });

  it('đổi mật khẩu (token_version tăng) mà KHÔNG gọi revokeAllForEmployee => TOKEN_VERSION_STALE, không xoay/tạo hàng/thu hồi', async () => {
    const cred = new CredFake();
    const s = await setup(cred);
    cred.state.set(EMP, { employeeStatus: 'ACTIVE', tokenVersion: 2 }); // đổi mật khẩu; không revokeAll
    const before = snapshot(s);
    const r = await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100), 1));
    expect(r).toEqual({ status: 'TOKEN_VERSION_STALE', familyRevoked: false });
    expect(snapshot(s)).toBe(before);
    expect(toUniformRefreshDenial(r)).toEqual({ ok: false, code: REFRESH_DENIED });
  });

  it.each(['DISABLED', 'RESIGNED', 'ON_LEAVE'])('trạng thái %s ngoài chính sách tiêm vào => EMPLOYEE_NOT_ALLOWED, không ghi gì', async (status) => {
    const s = await setup(new CredFake(), status);
    const before = snapshot(s);
    expect((await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100)))).status).toBe('EMPLOYEE_NOT_ALLOWED');
    expect(snapshot(s)).toBe(before);
  });

  it('ON_LEAVE chỉ được phép khi chính sách TƯỜNG MINH liệt kê (mã không tự chọn)', async () => {
    const s = await setup(new CredFake(), 'ON_LEAVE');
    expect((await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100), 1, ['ACTIVE', 'ON_LEAVE']))).status).toBe('ROTATED');
  });

  it('thiếu nguồn credential / nguồn ném / không có bản ghi / hình dạng sai => CREDENTIAL_UNAVAILABLE, không ghi gì', async () => {
    const throwing = new CredFake();
    const missing = new CredFake();
    const weird = new CredFake();
    const cases: Array<[string, GuardedFake]> = [
      ['không nguồn', await setup(undefined)],
      ['nguồn ném', await setup(throwing)],
      ['không bản ghi', await setup(missing)],
      ['sai hình dạng', await setup(weird)],
    ];
    throwing.throwOnRead = true;
    missing.state.clear();
    weird.state.set(EMP, { employeeStatus: 'ACTIVE', tokenVersion: '1' as unknown as number });
    for (const [name, s] of cases) {
      const before = snapshot(s);
      const r = await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100)));
      expect({ name, status: r.status }).toEqual({ name, status: 'CREDENTIAL_UNAVAILABLE' });
      expect(snapshot(s)).toBe(before);
    }
  });

  it('mô phỏng thứ tự đổi mật khẩu vs xoay (KHÔNG chứng minh đồng thời DB): đổi trước ranh giới nguyên tử => bị từ chối; xoay trước rồi đổi + revokeAll => token con bị từ chối', async () => {
    const cred = new CredFake();
    const s = await setup(cred);
    const expectedAtIssue = 1; // kỳ vọng gắn với phiên lúc cấp, giữ nguyên dù đã đổi mật khẩu
    cred.state.set(EMP, { employeeStatus: 'ACTIVE', tokenVersion: 2 }); // đổi mật khẩu xảy ra TRƯỚC khi thao tác nguyên tử chạy
    expect((await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100), expectedAtIssue))).status).toBe('TOKEN_VERSION_STALE');
    expect(s.rows.some((r) => r.rotatedAt !== null || r.id === uid(10))).toBe(false);
    // Thứ tự ngược: xoay xong trước (credential chưa đổi), rồi đổi mật khẩu — lần xoay kế tiếp bằng token con bị từ chối dù KHÔNG gọi revokeAll.
    cred.state.set(EMP, { employeeStatus: 'ACTIVE', tokenVersion: 1 });
    expect((await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100), 1))).status).toBe('ROTATED');
    cred.state.set(EMP, { employeeStatus: 'ACTIVE', tokenVersion: 2 });
    const before = snapshot(s);
    expect((await s.atomicRotateGuarded(input('tok-2', 'tok-3', 11, at(200), 1))).status).toBe('TOKEN_VERSION_STALE');
    expect(snapshot(s)).toBe(before);
  });

  it('kiểm credential chạy TRƯỚC phân loại: token tái dùng + credential hỏng => không thu hồi family (C2)', async () => {
    const cred = new CredFake();
    const s = await setup(cred);
    expect((await s.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100)))).status).toBe('ROTATED');
    cred.state.set(EMP, { employeeStatus: 'DISABLED', tokenVersion: 1 });
    const before = snapshot(s);
    const r = await s.atomicRotateGuarded(input('tok-1', 'tok-3', 11, at(60_000))); // ngoài grace: bình thường sẽ là ROTATED_REUSE + thu hồi
    expect(r).toEqual({ status: 'EMPLOYEE_NOT_ALLOWED', familyRevoked: false });
    expect(snapshot(s)).toBe(before);
    expect(s.rows.filter((x) => x.revokedAt !== null)).toHaveLength(0);
  });

  it('đối chứng âm: kho BỎ QUA kiểm credential làm bộ kiểm thất bại (bộ kiểm phát hiện được vi phạm)', async () => {
    const cred = new CredFake();
    const bad = await setup(cred, 'ACTIVE', 1, false);
    cred.state.set(EMP, { employeeStatus: 'DISABLED', tokenVersion: 9 });
    const r = await bad.atomicRotateGuarded(input('tok-1', 'tok-2', 10, at(100), 1));
    expect(r.status).toBe('ROTATED'); // kho sai cấp hàng mới dù credential đã đổi => mọi hợp đồng ở trên sẽ bắt được
  });

  it('kỳ vọng không được từ chối tin: credential BẮT BUỘC, đúng hình dạng, không trường lạ, chính sách không rỗng', () => {
    const ok = input('a', 'b', 2, T0);
    expect(() => assertValidGuardedRotate(ok)).not.toThrow();
    const { credential: _c, ...noCred } = ok;
    expect(() => assertValidGuardedRotate(noCred)).toThrow(/credential/);
    for (const bad of [
      { expectedTokenVersion: -1, allowedEmployeeStatuses: POLICY },
      { expectedTokenVersion: 1.5, allowedEmployeeStatuses: POLICY },
      { expectedTokenVersion: 1, allowedEmployeeStatuses: [] },
      { expectedTokenVersion: 1, allowedEmployeeStatuses: ['active'] },
      { expectedTokenVersion: 1, allowedEmployeeStatuses: POLICY, employeeStatus: 'ACTIVE' }, // trạng thái do người gọi cung cấp bị bác
      { expectedTokenVersion: 1 },
    ]) expect(() => assertValidGuardedRotate({ ...ok, credential: bad })).toThrow(RefreshStoreInputError);
    expect(() => assertValidGuardedRotate({ ...ok, refreshToken: 'x' })).toThrow(/unexpected:refreshToken/);
  });

  it('evaluateCredentialPrecondition: fail-closed với mọi hình dạng sai; thứ tự trạng thái trước token_version', () => {
    const pre = { expectedTokenVersion: 3, allowedEmployeeStatuses: POLICY };
    for (const st of [null, undefined, 'x', [], {}, { employeeStatus: 'ACTIVE' }, { tokenVersion: 3 }, { employeeStatus: 'ACTIVE', tokenVersion: NaN }, { employeeStatus: 1, tokenVersion: 3 }])
      expect(evaluateCredentialPrecondition(st, pre)).toBe('CREDENTIAL_UNAVAILABLE');
    expect(evaluateCredentialPrecondition({ employeeStatus: 'ACTIVE', tokenVersion: 3 }, { ...pre, allowedEmployeeStatuses: [] })).toBe('CREDENTIAL_UNAVAILABLE');
    expect(evaluateCredentialPrecondition({ employeeStatus: 'DISABLED', tokenVersion: 4 }, pre)).toBe('EMPLOYEE_NOT_ALLOWED');
    expect(evaluateCredentialPrecondition({ employeeStatus: 'ACTIVE', tokenVersion: 4 }, pre)).toBe('TOKEN_VERSION_STALE');
    expect(evaluateCredentialPrecondition({ employeeStatus: 'ACTIVE', tokenVersion: 3 }, pre)).toBeNull();
  });

  it('lỗi ra ngoài đồng nhất: mọi mã từ chối (credential hoặc hàng) => cùng một kết quả', () => {
    const codes: GuardedAtomicRotateResult[] = [
      { status: 'TOKEN_VERSION_STALE', familyRevoked: false },
      { status: 'EMPLOYEE_NOT_ALLOWED', familyRevoked: false },
      { status: 'CREDENTIAL_UNAVAILABLE', familyRevoked: false },
      { status: 'UNKNOWN_TOKEN', familyRevoked: false },
      { status: 'ROTATED_REUSE', familyRevoked: true },
    ];
    expect(new Set(codes.map((c) => JSON.stringify(toUniformRefreshDenial(c)))).size).toBe(1);
  });

  it('bản Unwired từ chối mặc định', async () => {
    await expect(new UnwiredCredentialGuardedRefreshSessionStore().atomicRotateGuarded(input('a', 'b', 2, T0))).rejects.toThrow(RefreshStoreUnwiredError);
  });
});
