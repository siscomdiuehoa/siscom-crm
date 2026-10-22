// P-A Sprint PA2 — HỢP ĐỒNG hành vi xoay refresh-token (CONTRACT TESTS trên MÔ HÌNH GIẢ LẬP trong bộ nhớ).
// !!! KHÔNG chứng minh tính nguyên tử của DB: chưa có mã xoay thật / giao dịch DB (SELECT ... FOR UPDATE) trong kho. !!!
// Mô hình `Sim*` bên dưới chỉ sống trong file test này (không nằm trong src sản xuất, không gắn DI/route, không SQL).
// Dùng `checkRefreshSessionRow` (PA1) làm nguồn phân loại hàng. Các tham số (grace, TTL) là giá trị thử, KHÔNG phải chính sách production.
// Chưa chốt và KHÔNG được các test này ngầm quyết: JWT vs opaque access token, cookie/CSRF policy cuối cùng, TTL, ngữ nghĩa đồng thời.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isCanonicalUuid } from '../uuid';
import { checkRefreshSessionRow, RefreshRowStatus, RefreshSessionRow } from './refresh-session-row';

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const GRACE = 10_000; // thử nghiệm
const IDLE = 1000;
const ABS = 5000;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

// ---- Mô hình giả lập (chỉ test) ----
interface SimStore {
  findByRefreshHash(h: string): RefreshSessionRow | null;
  all(): RefreshSessionRow[];
  put(r: RefreshSessionRow): void;
  employeeTokenVersion(employeeId: string): number | null;
}
const makeStore = (tv: Record<string, number> = { [EMP]: 1 }): SimStore & { rows: RefreshSessionRow[] } => {
  const rows: RefreshSessionRow[] = [];
  return {
    rows,
    findByRefreshHash: (h) => rows.find((r) => r.refreshHash === h) ?? null,
    all: () => rows,
    put: (r) => { const i = rows.findIndex((x) => x.id === r.id); if (i >= 0) rows[i] = r; else rows.push(r); },
    employeeTokenVersion: (e) => tv[e] ?? null,
  };
};

type Denial = 'NO_STORE' | 'STORE_ERROR' | 'BAD_INPUT' | 'UNKNOWN_TOKEN' | 'CSRF_MISMATCH' | 'TOKEN_VERSION' | RefreshRowStatus;
type SimResult = { ok: true; refreshToken: string; csrfToken: string; row: RefreshSessionRow } | { ok: false; reason: Denial };

interface Presented { refreshToken: string; csrfHeader: string; employeeId: string; tokenVersion: number }
const newToken = () => randomBytes(32).toString('base64url');
const eqHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function simRotate(store: SimStore | null | undefined, p: Presented, now: Date, idGen: () => string): SimResult {
  if (!store) return { ok: false, reason: 'NO_STORE' };
  try {
    if (!isCanonicalUuid(p.employeeId) || typeof p.refreshToken !== 'string' || p.refreshToken === '' || !Number.isSafeInteger(p.tokenVersion)) {
      return { ok: false, reason: 'BAD_INPUT' };
    }
    const row = store.findByRefreshHash(sha(p.refreshToken));
    if (!row) return { ok: false, reason: 'UNKNOWN_TOKEN' };
    const st = checkRefreshSessionRow({ row, expectedEmployeeId: p.employeeId, now, reuseGraceMs: GRACE });
    if (st === 'ROTATED_REUSE') {
      // hợp đồng: dùng lại ngoài cửa sổ => thu hồi CẢ family
      for (const r of store.all().filter((x) => x.familyId === row.familyId && x.revokedAt === null)) {
        store.put({ ...r, revokedAt: now, revokeReason: 'REFRESH_REUSE' });
      }
    }
    if (st !== 'USABLE') return { ok: false, reason: st };
    if (store.employeeTokenVersion(row.employeeId) !== p.tokenVersion) return { ok: false, reason: 'TOKEN_VERSION' };
    if (typeof p.csrfHeader !== 'string' || !eqHex(sha(p.csrfHeader), row.csrfHash)) return { ok: false, reason: 'CSRF_MISMATCH' };
    const refreshToken = newToken();
    const csrfToken = newToken();
    const child: RefreshSessionRow = {
      id: idGen(), employeeId: row.employeeId, familyId: row.familyId, refreshHash: sha(refreshToken), csrfHash: sha(csrfToken),
      issuedAt: now, lastUsedAt: now, idleExpiresAt: new Date(Math.min(now.getTime() + IDLE, row.absExpiresAt.getTime())),
      absExpiresAt: row.absExpiresAt, rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null,
    };
    store.put({ ...row, rotatedAt: now, replacedById: child.id, lastUsedAt: now });
    store.put(child);
    return { ok: true, refreshToken, csrfToken, row: child };
  } catch {
    return { ok: false, reason: 'STORE_ERROR' };
  }
}

// Phát hành hàng gốc: chỉ lưu BĂM.
function seed(store: SimStore, over: Partial<RefreshSessionRow> = {}) {
  const refreshToken = newToken();
  const csrfToken = newToken();
  const row: RefreshSessionRow = {
    id: uuid(1), employeeId: EMP, familyId: FAMILY, refreshHash: sha(refreshToken), csrfHash: sha(csrfToken),
    issuedAt: T0, lastUsedAt: T0, idleExpiresAt: at(IDLE), absExpiresAt: at(ABS),
    rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null, ...over,
  };
  store.put(row);
  return { row, refreshToken, csrfToken };
}
const ids = () => { let n = 100; return () => uuid(++n); };
const present = (s: { refreshToken: string; csrfToken: string }, o: Partial<Presented> = {}): Presented =>
  ({ refreshToken: s.refreshToken, csrfHeader: s.csrfToken, employeeId: EMP, tokenVersion: 1, ...o });

describe('PA2 CONTRACT (mô hình giả lập — KHÔNG chứng minh nguyên tử DB)', () => {
  describe('xoay dùng một lần', () => {
    it('xoay thành công: hàng cũ đánh dấu rotated/replaced, hàng mới USABLE, token đổi', () => {
      const st = makeStore(); const s = seed(st); const gen = ids();
      const r = simRotate(st, present(s), at(100), gen);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.refreshToken).not.toBe(s.refreshToken);
      expect(r.csrfToken).not.toBe(s.csrfToken);
      const old = st.rows.find((x) => x.id === s.row.id)!;
      expect(old.rotatedAt).toEqual(at(100));
      expect(old.replacedById).toBe(r.row.id);
      expect(r.row.familyId).toBe(s.row.familyId);
      expect(checkRefreshSessionRow({ row: r.row, expectedEmployeeId: EMP, now: at(100), reuseGraceMs: GRACE })).toBe('USABLE');
    });
    it('hàng mới không kéo dài quá hạn tuyệt đối của family', () => {
      const st = makeStore(); const s = seed(st, { idleExpiresAt: at(ABS) });
      const r = simRotate(st, present(s), at(ABS - 10), ids());
      expect(r.ok && r.row.idleExpiresAt.getTime() <= r.row.absExpiresAt.getTime()).toBe(true);
      expect(r.ok && r.row.absExpiresAt).toEqual(at(ABS));
    });
  });

  describe('từ chối phát lại sau khi xoay', () => {
    it('dùng lại token cũ ngay trong cửa sổ → ROTATED_RECENT, không sinh hàng mới, không thu hồi', () => {
      const st = makeStore(); const s = seed(st); const gen = ids();
      expect(simRotate(st, present(s), at(100), gen).ok).toBe(true);
      const n = st.rows.length;
      expect(simRotate(st, present(s), at(100 + GRACE - 1), gen)).toEqual({ ok: false, reason: 'ROTATED_RECENT' });
      expect(st.rows).toHaveLength(n);
      expect(st.rows.every((x) => x.revokedAt === null)).toBe(true);
    });
    it('dùng lại ngoài cửa sổ → ROTATED_REUSE và THU HỒI cả family; token mới cũng bị từ chối', () => {
      const st = makeStore(); const s = seed(st); const gen = ids();
      const r = simRotate(st, present(s), at(100), gen);
      expect(simRotate(st, present(s), at(100 + GRACE), gen)).toEqual({ ok: false, reason: 'ROTATED_REUSE' });
      expect(st.rows.every((x) => x.revokedAt !== null && x.revokeReason === 'REFRESH_REUSE')).toBe(true);
      if (!r.ok) throw new Error('setup');
      expect(simRotate(st, present({ refreshToken: r.refreshToken, csrfToken: r.csrfToken }), at(100 + GRACE + 1), gen))
        .toEqual({ ok: false, reason: 'REVOKED' });
    });
  });

  describe('family bị thu hồi', () => {
    it('hàng revoked → REVOKED, không xoay', () => {
      const st = makeStore(); const s = seed(st, { revokedAt: at(50), revokeReason: 'LOGOUT' });
      expect(simRotate(st, present(s), at(100), ids())).toEqual({ ok: false, reason: 'REVOKED' });
      expect(st.rows).toHaveLength(1);
    });
  });

  describe('biên hết hạn (nửa mở: now >= hạn ⇒ hết hạn)', () => {
    it('idle: now = idle-1ms được; now = idle bị IDLE_EXPIRED', () => {
      const a = makeStore(); const sa = seed(a);
      expect(simRotate(a, present(sa), at(IDLE - 1), ids()).ok).toBe(true);
      const b = makeStore(); const sb = seed(b);
      expect(simRotate(b, present(sb), at(IDLE), ids())).toEqual({ ok: false, reason: 'IDLE_EXPIRED' });
      expect(b.rows).toHaveLength(1);
    });
    it('tuyệt đối: now = abs-1ms được; now = abs bị ABS_EXPIRED (ưu tiên hơn idle)', () => {
      const a = makeStore(); const sa = seed(a, { idleExpiresAt: at(ABS) });
      expect(simRotate(a, present(sa), at(ABS - 1), ids()).ok).toBe(true);
      const b = makeStore(); const sb = seed(b, { idleExpiresAt: at(ABS) });
      expect(simRotate(b, present(sb), at(ABS), ids())).toEqual({ ok: false, reason: 'ABS_EXPIRED' });
    });
  });

  describe('sai nhân viên / UUID hỏng', () => {
    it('employeeId khác chủ hàng → WRONG_EMPLOYEE, không đổi trạng thái', () => {
      const st = makeStore({ [EMP]: 1, [OTHER]: 1 }); const s = seed(st);
      expect(simRotate(st, present(s, { employeeId: OTHER }), at(100), ids())).toEqual({ ok: false, reason: 'WRONG_EMPLOYEE' });
      expect(st.rows).toHaveLength(1);
      expect(st.rows[0].rotatedAt).toBeNull();
    });
    it.each(['', 'not-a-uuid', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', `${EMP} `, 42 as unknown as string, null as unknown as string])(
      'employeeId %p → BAD_INPUT', (e) => {
        const st = makeStore(); const s = seed(st);
        expect(simRotate(st, present(s, { employeeId: e }), at(100), ids())).toEqual({ ok: false, reason: 'BAD_INPUT' });
        expect(st.rows).toHaveLength(1);
      });
    it('token lạ / rỗng → từ chối', () => {
      const st = makeStore(); seed(st);
      expect(simRotate(st, { refreshToken: 'unknown', csrfHeader: 'x', employeeId: EMP, tokenVersion: 1 }, at(1), ids()).ok).toBe(false);
      expect(simRotate(st, { refreshToken: '', csrfHeader: 'x', employeeId: EMP, tokenVersion: 1 }, at(1), ids())).toEqual({ ok: false, reason: 'BAD_INPUT' });
    });
  });

  describe('CSRF', () => {
    it.each(['', 'wrong', 'x'.repeat(200)])('header CSRF %p không khớp băm → CSRF_MISMATCH, không xoay', (h) => {
      const st = makeStore(); const s = seed(st);
      expect(simRotate(st, present(s, { csrfHeader: h }), at(100), ids())).toEqual({ ok: false, reason: 'CSRF_MISMATCH' });
      expect(st.rows).toHaveLength(1);
      expect(st.rows[0].rotatedAt).toBeNull();
    });
    it('CSRF của hàng cũ không dùng được cho hàng mới sau xoay (đã thay mới)', () => {
      const st = makeStore(); const s = seed(st); const gen = ids();
      const r = simRotate(st, present(s), at(100), gen);
      if (!r.ok) throw new Error('setup');
      expect(simRotate(st, { refreshToken: r.refreshToken, csrfHeader: s.csrfToken, employeeId: EMP, tokenVersion: 1 }, at(200), gen))
        .toEqual({ ok: false, reason: 'CSRF_MISMATCH' });
    });
  });

  describe('chỉ lưu băm, không lưu bản rõ', () => {
    it('mọi hàng chỉ chứa SHA-256 hex; chuỗi tuần tự hóa không chứa token rõ (cũ lẫn mới)', () => {
      const st = makeStore(); const s = seed(st);
      const r = simRotate(st, present(s), at(100), ids());
      if (!r.ok) throw new Error('setup');
      const dump = JSON.stringify(st.rows);
      for (const secret of [s.refreshToken, s.csrfToken, r.refreshToken, r.csrfToken]) expect(dump).not.toContain(secret);
      for (const row of st.rows) {
        expect(row.refreshHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.csrfHash).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(r.row.refreshHash).toBe(sha(r.refreshToken));
    });
    it('hàng không có trường token rõ', () => {
      const st = makeStore(); const s = seed(st);
      expect(Object.keys(s.row).filter((k) => /token/i.test(k) && !/hash/i.test(k))).toEqual([]);
    });
  });

  describe('tokenVersion', () => {
    it('tokenVersion thay đổi so với nhân viên hiện tại → TOKEN_VERSION, không xoay', () => {
      const st = makeStore({ [EMP]: 2 }); const s = seed(st);
      expect(simRotate(st, present(s, { tokenVersion: 1 }), at(100), ids())).toEqual({ ok: false, reason: 'TOKEN_VERSION' });
      expect(st.rows).toHaveLength(1);
      expect(simRotate(st, present(s, { tokenVersion: 2 }), at(100), ids()).ok).toBe(true);
    });
    it('nhân viên không còn tồn tại (tokenVersion null) → từ chối', () => {
      const st = makeStore({}); const s = seed(st);
      expect(simRotate(st, present(s), at(100), ids())).toEqual({ ok: false, reason: 'TOKEN_VERSION' });
    });
    it.each([1.5, NaN, Infinity, '1' as unknown as number])('tokenVersion %p không phải số nguyên an toàn → BAD_INPUT', (v) => {
      const st = makeStore(); const s = seed(st);
      expect(simRotate(st, present(s, { tokenVersion: v }), at(100), ids())).toEqual({ ok: false, reason: 'BAD_INPUT' });
    });
  });

  describe('fail-closed khi thiếu / lỗi adapter DB', () => {
    it.each([null, undefined])('adapter %p → NO_STORE', (a) => {
      expect(simRotate(a, { refreshToken: 'x', csrfHeader: 'y', employeeId: EMP, tokenVersion: 1 }, at(1), ids())).toEqual({ ok: false, reason: 'NO_STORE' });
    });
    it('adapter ném lỗi → STORE_ERROR (từ chối, không ném ra ngoài, không cấp token)', () => {
      const broken: SimStore = {
        findByRefreshHash: () => { throw new Error('db down'); }, all: () => [], put: () => undefined, employeeTokenVersion: () => 1,
      };
      expect(simRotate(broken, { refreshToken: 'x', csrfHeader: 'y', employeeId: EMP, tokenVersion: 1 }, at(1), ids())).toEqual({ ok: false, reason: 'STORE_ERROR' });
    });
  });

  // KHOẢNG TRỐNG đã biết (không giả vờ phủ): hai yêu cầu đồng thời cùng token, khóa hàng FOR UPDATE, rollback giao dịch, trigger DB
  // fn_sess_before_update, và hành vi PostgreSQL thật — cần test tích hợp trên bản sao siscom_crm_test_* (chưa chạy).
  it.todo('INTEGRATION (DB thật, chưa chạy): hai yêu cầu xoay đồng thời cùng refresh token — đúng một bên thắng');
  it.todo('INTEGRATION (DB thật, chưa chạy): giao dịch xoay rollback nguyên vẹn khi lỗi giữa chừng');
});
