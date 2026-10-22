// PA8 — kiểm thử đơn vị SessionBoundAccessService. Khóa GIẢ, nguồn phiên GIẢ, đồng hồ giả. Không env, không DB.
import { randomBytes } from 'node:crypto';
import { AccessTokenService } from './access-token.service';
import {
  SESSION_ACCESS_UNAUTHORIZED,
  SessionAccessStatusSource,
  SessionBoundAccessService,
  STRICT_REQUIRE_LIVE_ROW,
  TrustedSessionAccessRecord,
} from './session-bound-access.service';

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER_EMP = '44444444-4444-4444-8444-444444444444';
const SID = '22222222-2222-4222-8222-222222222222';
const FAMILY = '55555555-5555-4555-8555-555555555555';
const NEXT_SID = '66666666-6666-4666-8666-666666666666';
const SECRET = 'FAKE-TEST-KEY-A-0123456789abcdef0123456789';
const NOW_MS = 1_800_000_000_000;
const HEX = 'a'.repeat(64);
const DENY = { ok: false, code: SESSION_ACCESS_UNAUTHORIZED };

const at = (deltaMs: number) => new Date(NOW_MS + deltaMs);
const liveRow = (over: Record<string, unknown> = {}) => ({
  id: SID,
  employeeId: EMP,
  familyId: FAMILY,
  refreshHash: HEX,
  csrfHash: HEX,
  issuedAt: at(-60_000),
  lastUsedAt: at(-30_000),
  idleExpiresAt: at(3_600_000),
  absExpiresAt: at(86_400_000),
  rotatedAt: null,
  replacedById: null,
  revokedAt: null,
  revokeReason: null,
  ...over,
});
const record = (over: Partial<Record<keyof TrustedSessionAccessRecord, unknown>> & { row?: Record<string, unknown> } = {}): TrustedSessionAccessRecord => ({
  session: 'session' in over ? over.session : liveRow(over.row),
  employeeStatus: 'employeeStatus' in over ? over.employeeStatus : 'ACTIVE',
  credentialTokenVersion: 'credentialTokenVersion' in over ? over.credentialTokenVersion : 3,
});

function setup(rec: TrustedSessionAccessRecord | null | (() => never) | 'reject' = record(), over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const source: SessionAccessStatusSource = {
    findBySessionId: async (sid: string) => {
      calls.push(sid);
      if (rec === 'reject') throw new Error('db down');
      if (typeof rec === 'function') return rec();
      return rec;
    },
  };
  const tokens = new AccessTokenService({
    keys: { current: { kid: 'k2', secret: SECRET } },
    now: () => NOW_MS,
    randomBytes: (n) => randomBytes(n),
    tokenVersions: { getTokenVersion: async () => 3 },
  });
  const svc = new SessionBoundAccessService({
    accessTokens: tokens,
    sessions: source,
    now: () => NOW_MS,
    posture: STRICT_REQUIRE_LIVE_ROW,
    allowedEmployeeStatuses: ['ACTIVE'],
    ...over,
  });
  const token = tokens.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
  return { svc, tokens, token, calls };
}

describe('SessionBoundAccessService (PA8) — mặc định từ chối', () => {
  it('đối chứng dương: JWT hợp lệ + hàng phiên sống + nhân viên ACTIVE + tv khớp => ok, danh tính từ hàng tin cậy', async () => {
    const { svc, token, calls } = setup();
    const r = await svc.validate(token);
    expect(r).toEqual({ ok: true, access: { employeeId: EMP, sessionId: SID, tokenVersion: 3 } });
    expect(calls).toEqual([SID]);
  });

  it.each([
    ['phiên không tồn tại (null)', () => null],
    ['phiên đã thu hồi', () => record({ row: { revokedAt: at(-1000), revokeReason: 'LOGOUT' } })],
    ['phiên đã xoay (rotated) — JWT của phiên đã xoay vô hiệu', () => record({ row: { rotatedAt: at(-1000), replacedById: NEXT_SID } })],
    ['phiên đã xoay vừa xong (trong cửa sổ phát lại) vẫn bị từ chối', () => record({ row: { rotatedAt: at(-1), replacedById: NEXT_SID } })],
    ['hết hạn tuyệt đối (đúng ranh giới, nửa mở)', () => record({ row: { absExpiresAt: at(0) } })],
    ['hết hạn rảnh', () => record({ row: { idleExpiresAt: at(-1) } })],
    ['hàng thuộc nhân viên khác (sub != employee_id tin cậy)', () => record({ row: { employeeId: OTHER_EMP } })],
    ['hàng có id khác sid được hỏi (nguồn trả nhầm phiên)', () => record({ row: { id: NEXT_SID } })],
    ['hàng sai hình dạng', () => record({ session: { id: SID } })],
    ['hàng không phải object', () => record({ session: 'x' })],
    ['token_version của credential đã đổi', () => record({ credentialTokenVersion: 4 })],
    ['token_version credential sai kiểu', () => record({ credentialTokenVersion: '3' })],
    ['nhân viên RESIGNED (bị vô hiệu)', () => record({ employeeStatus: 'RESIGNED' })],
    ['nhân viên ON_LEAVE (không nằm trong chính sách cho phép)', () => record({ employeeStatus: 'ON_LEAVE' })],
    ['trạng thái nhân viên thiếu', () => record({ employeeStatus: undefined })],
    ['trạng thái nhân viên chữ thường', () => record({ employeeStatus: 'active' })],
    ['nguồn trả về không phải object', () => 42 as unknown as null],
  ])('%s => UNAUTHORIZED đồng nhất', async (_n, make) => {
    const { svc, token } = setup(make as () => never);
    expect(await svc.validate(token)).toEqual(DENY);
  });

  it('ngoại lệ tra cứu (reject) => UNAUTHORIZED, không lộ lỗi', async () => {
    const { svc, token } = setup('reject');
    expect(await svc.validate(token)).toEqual(DENY);
  });

  it('ngoại lệ tra cứu (ném đồng bộ) => UNAUTHORIZED', async () => {
    const { svc, token } = setup(() => {
      throw new Error('sync boom');
    });
    expect(await svc.validate(token)).toEqual(DENY);
  });

  it('mọi lý do từ chối cho ra đúng cùng một đối tượng (không phân biệt nguyên nhân)', async () => {
    const a = await setup(null).svc.validate(setup().token);
    const b = await setup(record({ employeeStatus: 'RESIGNED' })).svc.validate(setup().token);
    const c = await setup().svc.validate('rubbish');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(Object.keys(a)).toEqual(['ok', 'code']);
  });
});

describe('SessionBoundAccessService (PA8) — thiếu cấu hình/adapter => từ chối, không đường lùi', () => {
  it('thiếu adapter nguồn phiên: JWT hoàn toàn hợp lệ vẫn bị từ chối', async () => {
    const { svc, token } = setup(record(), { sessions: undefined });
    expect(await svc.validate(token)).toEqual(DENY);
  });
  it('adapter sai hình dạng (không có findBySessionId) => từ chối', async () => {
    const { svc, token } = setup(record(), { sessions: {} });
    expect(await svc.validate(token)).toEqual(DENY);
  });
  it('thiếu bộ kiểm JWT => từ chối', async () => {
    const { svc, token } = setup(record(), { accessTokens: undefined });
    expect(await svc.validate(token)).toEqual(DENY);
  });
  it('thiếu đồng hồ => từ chối', async () => {
    const { svc, token } = setup(record(), { now: undefined });
    expect(await svc.validate(token)).toEqual(DENY);
  });
  it('tư thế strict không được opt-in tường minh (thiếu/sai tên) => từ chối', async () => {
    for (const posture of [undefined, '', 'strict_require_live_row', 'LENIENT', 'true'] as const) {
      const { svc, token } = setup(record(), { posture });
      expect(await svc.validate(token)).toEqual(DENY);
    }
  });
  it('chưa cấu hình chính sách trạng thái nhân viên (thiếu/rỗng/không hợp lệ) => từ chối (fail-closed)', async () => {
    for (const allowedEmployeeStatuses of [undefined, [], [''], ['active'], [1 as unknown as string]]) {
      const { svc, token } = setup(record(), { allowedEmployeeStatuses });
      expect(await svc.validate(token)).toEqual(DENY);
    }
  });
  it('khởi tạo với deps rỗng/null không ném và luôn từ chối', async () => {
    const { token } = setup();
    expect(await new SessionBoundAccessService({}).validate(token)).toEqual(DENY);
    expect(await new SessionBoundAccessService(undefined as never).validate(token)).toEqual(DENY);
  });
  it('chính sách có ON_LEAVE được cấu hình tường minh thì ON_LEAVE mới qua (chính sách là của người gọi, không có mặc định)', async () => {
    const { svc, token } = setup(record({ employeeStatus: 'ON_LEAVE' }), { allowedEmployeeStatuses: ['ACTIVE', 'ON_LEAVE'] });
    expect((await svc.validate(token)).ok).toBe(true);
  });
});

describe('SessionBoundAccessService (PA8) — JWT sai thì nguồn phiên không bao giờ bị gọi', () => {
  it('token rác / sai kiểu / rỗng / null', async () => {
    const { svc, calls } = setup();
    for (const t of ['', 'a.b.c', 'rubbish', null, undefined, 123, {}, [], { sub: EMP, sid: SID, tv: 3 }]) {
      expect(await svc.validate(t)).toEqual(DENY);
    }
    expect(calls).toEqual([]);
  });
  it('chữ ký sai (đổi 1 ký tự) / khóa khác => không gọi nguồn', async () => {
    const { svc, token, calls } = setup();
    const bad = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(await svc.validate(bad)).toEqual(DENY);
    const other = new AccessTokenService({
      keys: { current: { kid: 'k2', secret: 'FAKE-TEST-KEY-Z-0123456789abcdef0123456789' } },
      now: () => NOW_MS,
      randomBytes: (n) => randomBytes(n),
      tokenVersions: { getTokenVersion: async () => 3 },
    });
    expect(await svc.validate(other.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 }))).toEqual(DENY);
    expect(calls).toEqual([]);
  });
  it('token hết hạn / tv cũ theo nguồn tv của PA7 => không gọi nguồn phiên', async () => {
    const { svc, token, calls } = setup(record(), {});
    let later = NOW_MS + 700_000;
    const expiredSvc = new SessionBoundAccessService({
      accessTokens: new AccessTokenService({
        keys: { current: { kid: 'k2', secret: SECRET } },
        now: () => later,
        randomBytes: (n) => randomBytes(n),
        tokenVersions: { getTokenVersion: async () => 3 },
      }),
      sessions: { findBySessionId: async (s) => (calls.push(s), record()) },
      now: () => later,
      posture: STRICT_REQUIRE_LIVE_ROW,
      allowedEmployeeStatuses: ['ACTIVE'],
    });
    expect(await expiredSvc.validate(token)).toEqual(DENY);
    later = NOW_MS;
    const staleSvc = new SessionBoundAccessService({
      accessTokens: new AccessTokenService({
        keys: { current: { kid: 'k2', secret: SECRET } },
        now: () => NOW_MS,
        randomBytes: (n) => randomBytes(n),
        tokenVersions: { getTokenVersion: async () => 9 },
      }),
      sessions: { findBySessionId: async (s) => (calls.push(s), record()) },
      now: () => NOW_MS,
      posture: STRICT_REQUIRE_LIVE_ROW,
      allowedEmployeeStatuses: ['ACTIVE'],
    });
    expect(await staleSvc.validate(token)).toEqual(DENY);
    expect(svc).toBeDefined();
    expect(calls).toEqual([]);
  });
  it('bộ kiểm JWT ném ngoại lệ => từ chối, không gọi nguồn', async () => {
    const calls: string[] = [];
    const svc = new SessionBoundAccessService({
      accessTokens: { verify: async () => { throw new Error('x'); } },
      sessions: { findBySessionId: async (s) => (calls.push(s), record()) },
      now: () => NOW_MS,
      posture: STRICT_REQUIRE_LIVE_ROW,
      allowedEmployeeStatuses: ['ACTIVE'],
    });
    expect(await svc.validate('x')).toEqual(DENY);
    expect(calls).toEqual([]);
  });
});

describe('SessionBoundAccessService (PA8) — giả mạo từ client & token hợp lệ nhưng không được tin cậy', () => {
  it('JWT ký đúng nhưng nguồn tin cậy không biết phiên => UNAUTHORIZED (chữ ký một mình không đủ)', async () => {
    const { svc, token, calls } = setup(null);
    expect((await svc.validate(token))).toEqual(DENY);
    expect(calls).toEqual([SID]);
  });
  it('client giả sub/sid trong payload không có chữ ký => từ chối, nguồn không bị gọi', async () => {
    const { svc, calls } = setup();
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b({ alg: 'HS256', typ: 'JWT', kid: 'k2' })}.${b({ sub: OTHER_EMP, sid: SID, tv: 3 })}.${'A'.repeat(43)}`;
    expect(await svc.validate(forged)).toEqual(DENY);
    expect(calls).toEqual([]);
  });
  it('tham số thừa (header/body/claims của client) bị bỏ qua; danh tính không đổi theo chúng', async () => {
    const { svc, token } = setup();
    const r = await (svc.validate as (...a: unknown[]) => Promise<unknown>)(token, { employeeId: OTHER_EMP, role: 'admin' }, { 'x-employee-id': OTHER_EMP });
    expect(r).toEqual({ ok: true, access: { employeeId: EMP, sessionId: SID, tokenVersion: 3 } });
  });
  it('nguồn chỉ nhận sid (không nhận sub/claim) và chỉ được gọi đúng một lần', async () => {
    const { svc, token, calls } = setup();
    await svc.validate(token);
    expect(calls).toEqual([SID]);
  });
  it('đối tượng ValidatedSessionAccess bị đóng băng (không sửa được sau khi cấp)', async () => {
    const { svc, token } = setup();
    const r = await svc.validate(token);
    expect(r.ok && Object.isFrozen(r.access)).toBe(true);
  });
  it('jti không có denylist: cùng một token dùng lại thành công khi phiên còn sống, bị từ chối ngay khi phiên bị thu hồi', async () => {
    let rec = record();
    const { svc, token } = setup((() => rec) as never);
    expect((await svc.validate(token)).ok).toBe(true);
    expect((await svc.validate(token)).ok).toBe(true); // replay trong TTL: chưa có denylist (câu hỏi chính sách)
    rec = record({ row: { revokedAt: at(-1), revokeReason: 'LOGOUT' } });
    expect(await svc.validate(token)).toEqual(DENY); // kiểm phiên phía server chặn ngay
  });
});
