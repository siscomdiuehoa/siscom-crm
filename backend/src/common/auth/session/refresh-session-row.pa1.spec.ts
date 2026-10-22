import { checkRefreshSessionRow, parseRefreshSessionRow, RefreshRowStatus } from './refresh-session-row';

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CHILD = '55555555-5555-4555-8555-555555555555';
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const GRACE = 10_000; // giá trị thử nghiệm, KHÔNG phải chính sách production
const H1 = 'a'.repeat(64); // băm giả
const H2 = 'b'.repeat(64);

const base = () => ({
  id: '33333333-3333-4333-8333-333333333333', employeeId: EMP, familyId: '44444444-4444-4444-8444-444444444444',
  refreshHash: H1, csrfHash: H2, issuedAt: T0, lastUsedAt: T0, idleExpiresAt: at(1000), absExpiresAt: at(5000),
  rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null,
});
const status = (row: unknown, now: Date = at(500), emp: string = EMP, grace: number = GRACE): RefreshRowStatus =>
  checkRefreshSessionRow({ row, expectedEmployeeId: emp, now, reuseGraceMs: grace });
const bad = (patch: Record<string, unknown>) => ({ ...base(), ...patch });

describe('PA1 refresh-session-row', () => {
  it('hàng hợp lệ → USABLE', () => expect(status(base())).toBe('USABLE'));

  describe('parse: hình dạng', () => {
    it.each([null, undefined, 'x', 1, [], {}])('đầu vào %p → từ chối', (v) => {
      expect(parseRefreshSessionRow(v).ok).toBe(false);
    });
    it.each([
      ['id', 'nope'], ['employeeId', '11111111-1111-4111-8111-11111111111G'], ['employeeId', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'], ['familyId', 42],
      ['refreshHash', 'A'.repeat(64)], ['refreshHash', 'a'.repeat(63)], ['csrfHash', 'z'.repeat(64)], ['csrfHash', null],
      ['issuedAt', '2026-01-01'], ['idleExpiresAt', new Date('x')], ['absExpiresAt', null], ['lastUsedAt', 0],
      ['rotatedAt', 'x'], ['replacedById', 'x'], ['revokedAt', 5], ['revokeReason', 'lower'], ['revokeReason', 'A'.repeat(41)],
    ])('trường %s sai kiểu/định dạng (%p) → MALFORMED', (k, v) => {
      expect(parseRefreshSessionRow(bad({ [k]: v })).ok).toBe(false);
      expect(status(bad({ [k]: v }))).toBe('MALFORMED');
    });
    it('thiếu trường → MALFORMED', () => {
      const { csrfHash: _omit, ...rest } = base();
      expect(status(rest)).toBe('MALFORMED');
    });
    it('báo tên trường lỗi, không chứa giá trị (không rò băm)', () => {
      expect(parseRefreshSessionRow(bad({ refreshHash: 'SECRET-LIKE' }))).toEqual({ ok: false, problems: ['refreshHash'] });
    });
  });

  describe('parse: bất biến CHECK của DB', () => {
    it.each([
      ['ck_sess_abs', { absExpiresAt: at(-1), idleExpiresAt: at(-1) }],
      ['ck_sess_idle', { idleExpiresAt: at(6000) }],
      ['ck_sess_rotation', { replacedById: CHILD }],
      ['ck_sess_not_self', { rotatedAt: at(100), replacedById: base().id }],
      ['ck_sess_revoke', { revokedAt: at(100) }],
      ['ck_sess_revoke', { revokeReason: 'LOGOUT' }],
    ])('%s bị vi phạm → MALFORMED', (name, patch) => {
      const res = parseRefreshSessionRow(bad(patch));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.problems).toContain(name);
      expect(status(bad(patch))).toBe('MALFORMED');
    });
    it('idle == abs được phép (CHECK là <=)', () => expect(status(bad({ idleExpiresAt: at(5000) }))).toBe('USABLE'));
  });

  describe('trạng thái', () => {
    it('nhân viên khác → WRONG_EMPLOYEE, kể cả khi hàng đã thu hồi/hết hạn', () => {
      expect(status(base(), at(500), OTHER)).toBe('WRONG_EMPLOYEE');
      expect(status(bad({ revokedAt: at(1), revokeReason: 'LOGOUT' }), at(500), OTHER)).toBe('WRONG_EMPLOYEE');
      expect(status(base(), at(9000), OTHER)).toBe('WRONG_EMPLOYEE');
    });
    it('expectedEmployeeId sai định dạng → MALFORMED (không coi là khớp)', () => {
      expect(status(base(), at(500), 'x')).toBe('MALFORMED');
      expect(status(base(), at(500), '')).toBe('MALFORMED');
    });
    it('thu hồi → REVOKED (ưu tiên hơn xoay/hết hạn)', () => {
      expect(status(bad({ revokedAt: at(1), revokeReason: 'LOGOUT' }))).toBe('REVOKED');
      expect(status(bad({ revokedAt: at(1), revokeReason: 'REUSE_DETECTED', rotatedAt: at(2) }), at(9000))).toBe('REVOKED');
    });
    it('xoay: biên cửa sổ phát lại (grace do người gọi truyền)', () => {
      const rotated = bad({ rotatedAt: at(100), replacedById: CHILD });
      expect(status(rotated, at(100 + GRACE - 1))).toBe('ROTATED_RECENT');
      expect(status(rotated, at(100 + GRACE))).toBe('ROTATED_REUSE');
      expect(status(rotated, at(100 + GRACE + 1))).toBe('ROTATED_REUSE');
    });
    it('grace=0 → phát lại sau xoay luôn là ROTATED_REUSE', () => {
      expect(status(bad({ rotatedAt: at(100) }), at(100), EMP, 0)).toBe('ROTATED_REUSE');
    });
    it('hàng đã xoay không bao giờ USABLE, kể cả còn hạn', () => {
      expect(status(bad({ rotatedAt: at(100) }), at(200))).not.toBe('USABLE');
    });
    it('hết hạn tuyệt đối: nửa mở tại biên', () => {
      const row = bad({ idleExpiresAt: at(5000) });
      expect(status(row, at(4999))).toBe('USABLE');
      expect(status(row, at(5000))).toBe('ABS_EXPIRED');
      expect(status(row, at(5001))).toBe('ABS_EXPIRED');
    });
    it('hết hạn idle: nửa mở tại biên', () => {
      expect(status(base(), at(999))).toBe('USABLE');
      expect(status(base(), at(1000))).toBe('IDLE_EXPIRED');
      expect(status(base(), at(4999))).toBe('IDLE_EXPIRED');
    });
    it('cả idle và abs hết hạn → ABS_EXPIRED', () => expect(status(base(), at(9000))).toBe('ABS_EXPIRED'));
  });

  describe('tham số người gọi (fail-closed, không mặc định)', () => {
    it.each([-1, 1.5, NaN, Infinity, '10' as unknown as number])('reuseGraceMs=%p → MALFORMED', (g) => {
      expect(status(base(), at(500), EMP, g)).toBe('MALFORMED');
    });
    it('now không hợp lệ → MALFORMED', () => {
      expect(status(base(), new Date('x'))).toBe('MALFORMED');
      expect(status(base(), '2026' as unknown as Date)).toBe('MALFORMED');
    });
  });

  it('không ném lỗi với hàng đóng băng', () => {
    expect(() => status(Object.freeze(base()))).not.toThrow();
  });
});

describe('PA1 reuseGraceMs thiếu', () => {
  it('không truyền reuseGraceMs → MALFORMED (không có mặc định)', () => {
    const input = { row: base(), expectedEmployeeId: EMP, now: at(500) } as unknown as Parameters<typeof checkRefreshSessionRow>[0];
    expect(checkRefreshSessionRow(input)).toBe('MALFORMED');
  });
});
