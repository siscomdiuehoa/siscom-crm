// P-A Sprint PA11 — bộ kiểm HỢP ĐỒNG cho cổng RefreshSessionStore.atomicRotate, ghép với SessionBoundAccessService (strict) trên CÙNG một kho giả.
// !!! KHÔNG chứng minh khóa/giao dịch PostgreSQL: kho giả chạy trong một tiến trình JS; "đồng thời" = các Promise đan xen ở điểm await. !!!
// Giá trị: (1) các hàm `contract*` là bộ kiểm TÁI DÙNG cho adapter S8 sau này (chạy với `make` trả adapter thật trên DB thử); (2) hai kho "đối chứng âm"
// (không khóa / không hoàn tác) PHẢI làm bộ kiểm thất bại — chứng tỏ bộ kiểm phát hiện được vi phạm, không chỉ mô phỏng lại kho đúng; (3) phần ghép dùng
// MÃ PRODUCTION thật: assertValid*, checkRefreshSessionRow, deriveRotatedChildRow, AccessTokenService, SessionBoundAccessService.
// Không lặp PA2/PA3/PA5 (luồng đơn, biên thời gian, thừa kế abs) và PA8/PA10 (hàng dựng tay). Tham số grace/TTL là giá trị thử, KHÔNG phải chính sách production.
import { createHash, randomBytes } from 'node:crypto';
import { AccessTokenService } from '../jwt/access-token.service';
import { SessionBoundAccessService, SessionAccessStatusSource, STRICT_REQUIRE_LIVE_ROW, TrustedSessionAccessRecord } from '../jwt/session-bound-access.service';
import { checkRefreshSessionRow, RefreshSessionRow } from './refresh-session-row';
import {
  assertValidAtomicRotate,
  assertValidCreateFamily,
  assertValidRevokeAllForEmployee,
  assertValidRevokeFamily,
  AtomicRotateInput,
  AtomicRotateResult,
  CreateFamilyInput,
  CreateFamilyResult,
  deriveRotatedChildRow,
  FindActiveInput,
  FindActiveResult,
  RefreshSessionStore,
  RevokeAllForEmployeeInput,
  RevokeFamilyInput,
  RevokeResult,
} from './refresh-session-store';

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FAM = '44444444-4444-4444-8444-444444444444';
const FAM2 = '55555555-5555-4555-8555-555555555555';
const SECRET = 'FAKE-TEST-KEY-A-0123456789abcdef0123456789';
const T0_MS = 1_800_000_000_000;
const T0 = new Date(T0_MS);
const at = (ms: number) => new Date(T0_MS + ms);
const GRACE = 10_000;
const IDLE_TTL = 3_600_000;
const IDLE = 3_600_000;
const ABS = 86_400_000;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const uid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const nxt = (n: number, tok: string) => ({ id: uid(n), refreshHash: sha(tok), csrfHash: sha(`csrf-${tok}`), idleTtlMs: IDLE_TTL });
const first = (n: number, tok: string, over: Partial<CreateFamilyInput> = {}): CreateFamilyInput => ({
  id: uid(n), refreshHash: sha(tok), csrfHash: sha(`csrf-${tok}`), idleExpiresAt: at(IDLE), absExpiresAt: at(ABS), employeeId: EMP, familyId: FAM, issuedAt: T0, ...over,
});

type Mode = 'ATOMIC' | 'NO_LOCK' | 'NO_ROLLBACK';
/** Kho giả: vừa là RefreshSessionStore vừa là nguồn trạng thái phiên (cùng một mảng hàng => hai cổng nhìn thấy cùng sự thật). */
class RefStore implements RefreshSessionStore, SessionAccessStatusSource {
  rows: RefreshSessionRow[] = [];
  credentialTv = 3;
  employeeStatus = 'ACTIVE';
  faultAfterParentWrite = false; // ném SAU khi đã ghi hàng cũ, TRƯỚC khi ghi hàng mới
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly mode: Mode = 'ATOMIC') {}

  async createFamily(i: CreateFamilyInput): Promise<CreateFamilyResult> {
    assertValidCreateFamily(i);
    if (this.rows.some((r) => r.id === i.id || r.refreshHash === i.refreshHash)) return { status: 'DUPLICATE' };
    const row: RefreshSessionRow = { id: i.id, employeeId: i.employeeId, familyId: i.familyId, refreshHash: i.refreshHash, csrfHash: i.csrfHash, issuedAt: i.issuedAt, lastUsedAt: i.issuedAt, idleExpiresAt: i.idleExpiresAt, absExpiresAt: i.absExpiresAt, rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null };
    this.rows = [...this.rows, row];
    return { status: 'CREATED', row };
  }
  async findActiveByRefreshHash(i: FindActiveInput): Promise<FindActiveResult> {
    const row = this.rows.find((r) => r.refreshHash === i.refreshHash);
    return row && checkRefreshSessionRow({ row, expectedEmployeeId: i.expectedEmployeeId, now: i.now, reuseGraceMs: 0 }) === 'USABLE' ? { status: 'FOUND', row } : { status: 'NOT_FOUND' };
  }
  atomicRotate(i: AtomicRotateInput): Promise<AtomicRotateResult> {
    assertValidAtomicRotate(i);
    if (this.mode !== 'NO_LOCK') {
      const run = this.tail.then(() => this.rotateOnce(i)); // khóa tuần tự: mô hình "một giao dịch + khóa hàng" ở mức ứng dụng
      this.tail = run.catch(() => undefined);
      return run;
    }
    return this.rotateOnce(i);
  }
  private async rotateOnce(i: AtomicRotateInput): Promise<AtomicRotateResult> {
    const snapshot = this.rows;
    try {
      const idx = this.rows.findIndex((r) => r.refreshHash === i.presentedRefreshHash);
      if (idx < 0) return { status: 'UNKNOWN_TOKEN', familyRevoked: false };
      const row = this.rows[idx];
      const st = checkRefreshSessionRow({ row, expectedEmployeeId: i.expectedEmployeeId, now: i.now, reuseGraceMs: i.reuseGraceMs });
      await Promise.resolve(); // điểm đan xen: kho không khóa sẽ để lệnh thứ hai đọc trạng thái cũ ở đây
      if (st === 'ROTATED_REUSE') {
        this.rows = this.rows.map((r) => (r.familyId === row.familyId && r.revokedAt === null ? { ...r, revokedAt: i.now, revokeReason: 'REFRESH_REUSE' } : r));
        return { status: st, familyRevoked: true };
      }
      if (st !== 'USABLE') return { status: st, familyRevoked: false };
      const child = deriveRotatedChildRow(row, i);
      this.rows = this.rows.map((r) => (r.id === row.id ? { ...r, rotatedAt: i.now, replacedById: child.id } : r));
      if (this.faultAfterParentWrite) throw new Error('INFRA_FAULT');
      this.rows = [...this.rows, child];
      return { status: 'ROTATED', previousRowId: row.id, row: child };
    } catch (e) {
      if (this.mode !== 'NO_ROLLBACK') this.rows = snapshot; // hoàn tác: "cả hai hoặc không gì cả"
      throw e;
    }
  }
  private revokeWhere(pred: (r: RefreshSessionRow) => boolean, reason: string, now: Date): RevokeResult {
    let n = 0;
    this.rows = this.rows.map((r) => (pred(r) && r.revokedAt === null ? (n++, { ...r, revokedAt: now, revokeReason: reason }) : r));
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
  async findBySessionId(sid: string): Promise<TrustedSessionAccessRecord | null> {
    const row = this.rows.find((r) => r.id === sid);
    return row ? { session: row, employeeStatus: this.employeeStatus, credentialTokenVersion: this.credentialTv } : null;
  }
}

const rot = (s: RefreshSessionStore, from: string, to: string, n: number, now: Date, emp = EMP) =>
  s.atomicRotate({ presentedRefreshHash: sha(from), expectedEmployeeId: emp, now, reuseGraceMs: GRACE, next: nxt(n, to) });
const seeded = async (mode: Mode = 'ATOMIC') => {
  const s = new RefStore(mode);
  await s.createFamily(first(1, 'tok-1'));
  return s;
};
const snap = (s: RefStore) => JSON.stringify(s.rows);

// ---- Bộ kiểm hợp đồng TÁI DÙNG (adapter thật chạy lại bằng `make` của nó; ở đây `make` trả kho giả) ----
type Make = () => Promise<RefStore>;

async function contractConcurrentRotateSingleWinner(make: Make): Promise<void> {
  const s = await make();
  const results = await Promise.all([2, 3, 4, 5, 6].map((n) => rot(s, 'tok-1', `tok-${n}`, n, at(100))));
  const statuses = results.map((r) => r.status).sort();
  expect(statuses.filter((x) => x === 'ROTATED')).toHaveLength(1); // tối đa MỘT thắng
  expect(statuses.filter((x) => x === 'ROTATED_RECENT')).toHaveLength(4); // còn lại: trong cửa sổ, không thu hồi
  expect(results.every((r) => r.status === 'ROTATED' || r.familyRevoked === false)).toBe(true);
  expect(s.rows).toHaveLength(2); // đúng một hàng con
  expect(s.rows.filter((r) => r.rotatedAt === null && r.revokedAt === null)).toHaveLength(1); // đúng một hàng sống
}
async function contractRotateAllOrNothingOnFault(make: Make): Promise<void> {
  const s = await make();
  const before = snap(s);
  s.faultAfterParentWrite = true;
  await expect(rot(s, 'tok-1', 'tok-2', 2, at(100))).rejects.toThrow('INFRA_FAULT'); // lỗi hạ tầng => ném, KHÔNG bao giờ trả ROTATED
  expect(snap(s)).toBe(before); // không có hàng cũ "đã xoay" mà thiếu hàng con
  s.faultAfterParentWrite = false;
  expect((await rot(s, 'tok-1', 'tok-2', 2, at(200))).status).toBe('ROTATED'); // token chưa bị đốt: thử lại được; kho không kẹt sau lỗi
}

describe('PA11 hợp đồng atomicRotate — bộ kiểm tái dùng (kho giả; KHÔNG phải bằng chứng khóa/giao dịch PostgreSQL)', () => {
  it('hai refresh cạnh tranh cùng băm: đúng một ROTATED, các bên còn lại ROTATED_RECENT (không thu hồi)', async () => {
    await contractConcurrentRotateSingleWinner(() => seeded('ATOMIC'));
  });
  it('ĐỐI CHỨNG ÂM: kho không khóa (đọc-rồi-ghi có await xen giữa) làm bộ kiểm thất bại — bộ kiểm có khả năng phát hiện', async () => {
    await expect(contractConcurrentRotateSingleWinner(() => seeded('NO_LOCK'))).rejects.toThrow(/expect\(/);
  });
  it('lỗi hạ tầng giữa chừng: hoàn tác hết, token chưa bị đốt, thử lại thành công', async () => {
    await contractRotateAllOrNothingOnFault(() => seeded('ATOMIC'));
  });
  it('ĐỐI CHỨNG ÂM: kho không hoàn tác để lại hàng cũ đã xoay mà không có hàng con — bộ kiểm phát hiện', async () => {
    await expect(contractRotateAllOrNothingOnFault(() => seeded('NO_ROLLBACK'))).rejects.toThrow(/expect\(/);
  });
});

describe('PA11 hợp đồng refresh — phát lại, thu hồi family, ràng buộc nhân viên (mã production thật + kho giả)', () => {
  it('đua sau khi đã xoay: kẻ phát lại ngoài cửa sổ thu hồi CẢ family; hàng con và token con hết dùng được; family khác của cùng nhân viên không bị đụng', async () => {
    const s = await seeded();
    await s.createFamily(first(9, 'other-fam', { familyId: FAM2 }));
    expect((await rot(s, 'tok-1', 'tok-2', 2, at(100))).status).toBe('ROTATED');
    const [a, b] = await Promise.all([rot(s, 'tok-1', 'tok-3', 3, at(100 + GRACE)), rot(s, 'tok-2', 'tok-4', 4, at(100 + GRACE))]);
    expect(a).toEqual({ status: 'ROTATED_REUSE', familyRevoked: true });
    expect(b.status).toBe('REVOKED'); // hàng con bị thu hồi bởi lệnh xếp trước; nếu đổi thứ tự khóa kết quả này cũng không thể là ROTATED
    expect(s.rows.filter((r) => r.familyId === FAM).every((r) => r.revokeReason === 'REFRESH_REUSE')).toBe(true);
    expect(s.rows.find((r) => r.familyId === FAM2)?.revokedAt).toBeNull();
    expect(s.rows).toHaveLength(3); // không có hàng mới nào được phát
  });
  it('sai nhân viên KHÔNG kích hoạt thu hồi family kể cả khi băm đã xoay ngoài cửa sổ (WRONG_EMPLOYEE ưu tiên hơn ROTATED_REUSE), không ghi gì', async () => {
    const s = await seeded();
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    const before = snap(s);
    expect(await rot(s, 'tok-1', 'tok-3', 3, at(100 + GRACE * 5), OTHER)).toEqual({ status: 'WRONG_EMPLOYEE', familyRevoked: false });
    expect(await rot(s, 'tok-2', 'tok-3', 3, at(200), OTHER)).toEqual({ status: 'WRONG_EMPLOYEE', familyRevoked: false });
    expect(snap(s)).toBe(before);
  });
  it('hàng con luôn thuộc đúng nhân viên/family của cha, kể cả khi hai nhân viên xoay xen kẽ đồng thời', async () => {
    const s = await seeded();
    await s.createFamily(first(7, 'o-1', { employeeId: OTHER, familyId: FAM2 }));
    const [r1, r2] = await Promise.all([rot(s, 'tok-1', 'tok-2', 2, at(100)), rot(s, 'o-1', 'o-2', 8, at(100), OTHER)]);
    expect([r1.status, r2.status]).toEqual(['ROTATED', 'ROTATED']);
    expect(s.rows.find((r) => r.id === uid(2))).toMatchObject({ employeeId: EMP, familyId: FAM });
    expect(s.rows.find((r) => r.id === uid(8))).toMatchObject({ employeeId: OTHER, familyId: FAM2 });
  });
  it('lệnh thu hồi chen vào giữa: xoay sau thu hồi => REVOKED, không phát hàng con; thu hồi sau xoay => hàng con cũng bị thu hồi', async () => {
    const s = await seeded();
    await s.revokeFamily({ familyId: FAM, reason: 'LOGOUT', now: at(50) });
    expect((await rot(s, 'tok-1', 'tok-2', 2, at(100))).status).toBe('REVOKED');
    expect(s.rows).toHaveLength(1);
    const t = await seeded();
    await rot(t, 'tok-1', 'tok-2', 2, at(100));
    expect(await t.revokeFamily({ familyId: FAM, reason: 'LOGOUT', now: at(150) })).toEqual({ revokedCount: 2 }); // cả cha (đã xoay, chưa thu hồi) lẫn con
  });
  it('port KHÔNG có chỗ cho tokenVersion / trạng thái nhân viên (khoảng trống hợp đồng — xem báo cáo PA11): trường đó bị từ chối như trường lạ', () => {
    const ok = { presentedRefreshHash: sha('a'), expectedEmployeeId: EMP, now: T0, reuseGraceMs: GRACE, next: nxt(2, 'b') };
    expect(() => assertValidAtomicRotate(ok)).not.toThrow();
    for (const k of ['tokenVersion', 'expectedTokenVersion', 'employeeStatus']) {
      expect(() => assertValidAtomicRotate({ ...ok, [k]: 3 })).toThrow(new RegExp(`unexpected:${k}`));
    }
  });
});

// ---- Ghép với SessionBoundAccessService (strict) trên cùng kho ----
function world(store: RefStore) {
  const clock = { ms: T0_MS };
  const tokens = new AccessTokenService({ keys: { current: { kid: 'k2', secret: SECRET } }, now: () => clock.ms, randomBytes: (n) => randomBytes(n), tokenVersions: { getTokenVersion: async () => store.credentialTv } });
  const svc = new SessionBoundAccessService({ accessTokens: tokens, sessions: store, now: () => clock.ms, posture: STRICT_REQUIRE_LIVE_ROW, allowedEmployeeStatuses: ['ACTIVE'] });
  const tok = (sessionId: string, emp = EMP, tv = store.credentialTv) => tokens.sign({ employeeId: emp, sessionId, tokenVersion: tv });
  return { clock, svc, tok };
}
const OK = (sid: string, emp = EMP, tv = 3) => ({ ok: true, access: { employeeId: emp, sessionId: sid, tokenVersion: tv } });
const DENY = { ok: false, code: 'UNAUTHORIZED' };

describe('PA11 ghép kho refresh + SessionBoundAccessService (strict): phiên con được chấp nhận, phiên cũ bị từ chối', () => {
  it('xoay thật qua atomicRotate: token của phiên cha bị từ chối NGAY, token của phiên con (hàng do deriveRotatedChildRow sinh) được chấp nhận', async () => {
    const s = await seeded();
    const w = world(s);
    const parent = w.tok(uid(1));
    expect(await w.svc.validate(parent)).toEqual(OK(uid(1)));
    expect((await rot(s, 'tok-1', 'tok-2', 2, at(100))).status).toBe('ROTATED');
    expect(await w.svc.validate(parent)).toEqual(DENY);
    expect(await w.svc.validate(w.tok(uid(2)))).toEqual(OK(uid(2)));
  });
  it('trong cửa sổ phát lại (ROTATED_RECENT) cửa sổ chỉ áp cho refresh: access token của phiên cha VẪN bị từ chối (strict) — quyết định chính sách #1 của chủ sở hữu còn mở', async () => {
    const s = await seeded();
    const w = world(s);
    const parent = w.tok(uid(1));
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    w.clock.ms = T0_MS + 100 + GRACE - 1;
    expect((await rot(s, 'tok-1', 'tok-3', 3, at(100 + GRACE - 1))).status).toBe('ROTATED_RECENT');
    expect(await w.svc.validate(parent)).toEqual(DENY);
  });
  it('phát lại ngoài cửa sổ: thu hồi family => token cha VÀ token con đều bị từ chối ngay, kể cả token con đang còn hạn JWT', async () => {
    const s = await seeded();
    const w = world(s);
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    const child = w.tok(uid(2));
    expect(await w.svc.validate(child)).toEqual(OK(uid(2)));
    expect(await rot(s, 'tok-1', 'tok-9', 9, at(100 + GRACE))).toEqual({ status: 'ROTATED_REUSE', familyRevoked: true });
    w.clock.ms = T0_MS + 100 + GRACE;
    expect(await w.svc.validate(child)).toEqual(DENY);
    expect(await w.svc.validate(w.tok(uid(1)))).toEqual(DENY);
  });
  it('xoay nhiều thế hệ: chỉ hàng ngọn được chấp nhận; abs thừa kế chặn phiên con đúng tại hạn tuyệt đối dù idle trượt còn dài', async () => {
    const s = await seeded();
    const w = world(s);
    for (let k = 1; k <= 3; k++) await rot(s, `tok-${k}`, `tok-${k + 1}`, k + 1, at(k * 1000));
    for (const sid of [uid(1), uid(2), uid(3)]) expect(await w.svc.validate(w.tok(sid))).toEqual(DENY);
    const tip = w.tok(uid(4));
    expect(await w.svc.validate(tip)).toEqual(OK(uid(4)));
    const big = { ...nxt(5, 'tok-5'), idleTtlMs: Number.MAX_SAFE_INTEGER }; // idle mới = min(now+ttl, abs) = abs
    expect((await s.atomicRotate({ presentedRefreshHash: sha('tok-4'), expectedEmployeeId: EMP, now: at(4000), reuseGraceMs: GRACE, next: big })).status).toBe('ROTATED');
    w.clock.ms = T0_MS + ABS - 1;
    expect(await w.svc.validate(w.tok(uid(5)))).toEqual(OK(uid(5)));
    w.clock.ms = T0_MS + ABS;
    expect(await w.svc.validate(w.tok(uid(5)))).toEqual(DENY);
  });
  it('revokeAllForEmployee: mọi phiên của nhân viên đó bị từ chối, nhân viên khác không bị ảnh hưởng', async () => {
    const s = await seeded();
    await s.createFamily(first(7, 'o-1', { employeeId: OTHER, familyId: FAM2 }));
    const w = world(s);
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    await s.revokeAllForEmployee({ employeeId: EMP, reason: 'PASSWORD_CHANGED', now: at(200) });
    expect(await w.svc.validate(w.tok(uid(2)))).toEqual(DENY);
    expect(await w.svc.validate(w.tok(uid(7), OTHER))).toEqual(OK(uid(7), OTHER));
  });
  it('ràng buộc employee/session: token ký cho sub khác chủ hàng con, hoặc sid không tồn tại => từ chối', async () => {
    const s = await seeded();
    const w = world(s);
    await rot(s, 'tok-1', 'tok-2', 2, at(100));
    expect(await w.svc.validate(w.tok(uid(2), OTHER))).toEqual(DENY); // sub != employeeId của hàng
    expect(await w.svc.validate(w.tok(uid(77)))).toEqual(DENY);
  });
  it('GAP (hành vi hiện tại, KHÔNG phải chính sách đã chốt): đổi mật khẩu tăng tokenVersion mà không revokeAll => refresh cũ VẪN xoay được và phiên con dùng được với token mang tv mới', async () => {
    const s = await seeded();
    const w = world(s);
    s.credentialTv = 4; // đổi mật khẩu
    expect(await w.svc.validate(w.tok(uid(1), EMP, 3))).toEqual(DENY); // access cũ: chặn bởi tv
    expect((await rot(s, 'tok-1', 'tok-2', 2, at(100))).status).toBe('ROTATED'); // refresh KHÔNG kiểm tv/trạng thái nhân viên — cổng không có chỗ cho chúng
    expect(await w.svc.validate(w.tok(uid(2)))).toEqual(OK(uid(2), EMP, 4)); // phiên trước đổi mật khẩu "sống lại" ở tv mới
    // Biện pháp duy nhất hiện có là người gọi PHẢI revokeAllForEmployee cùng lúc đổi mật khẩu:
    await s.revokeAllForEmployee({ employeeId: EMP, reason: 'PASSWORD_CHANGED', now: at(300) });
    expect(await w.svc.validate(w.tok(uid(2)))).toEqual(DENY);
  });
});
