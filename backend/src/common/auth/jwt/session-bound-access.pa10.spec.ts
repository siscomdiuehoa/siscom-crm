// PA10 — hồi quy có mục tiêu cho SessionBoundAccessService, chỉ bổ sung các ca CHƯA phủ bởi PA8. Khóa/đồng hồ/nguồn phiên đều giả. Không env, không DB.
import { randomBytes } from 'node:crypto';
import { AccessTokenService, AccessTokenVerifyResult } from './access-token.service';
import {
  SESSION_ACCESS_UNAUTHORIZED,
  SessionBoundAccessService,
  STRICT_REQUIRE_LIVE_ROW,
  TrustedSessionAccessRecord,
} from './session-bound-access.service';

const EMP = '11111111-1111-4111-8111-111111111111';
const OTHER_EMP = '44444444-4444-4444-8444-444444444444';
const SID = '22222222-2222-4222-8222-222222222222';
const NEXT_SID = '66666666-6666-4666-8666-666666666666';
const FAMILY = '55555555-5555-4555-8555-555555555555';
const SECRET = 'FAKE-TEST-KEY-A-0123456789abcdef0123456789';
const NOW_MS = 1_800_000_000_000;
const HEX = 'a'.repeat(64);
const DENY = { ok: false, code: SESSION_ACCESS_UNAUTHORIZED };

const at = (deltaMs: number) => new Date(NOW_MS + deltaMs);
const row = (over: Record<string, unknown> = {}) => ({
  id: SID, employeeId: EMP, familyId: FAMILY, refreshHash: HEX, csrfHash: HEX,
  issuedAt: at(-60_000), lastUsedAt: at(-30_000), idleExpiresAt: at(3_600_000), absExpiresAt: at(86_400_000),
  rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null, ...over,
});
const rec = (r: Record<string, unknown> = row(), over: Partial<TrustedSessionAccessRecord> = {}): TrustedSessionAccessRecord => ({
  session: r, employeeStatus: 'ACTIVE', credentialTokenVersion: 3, ...over,
});

// Một "kho" có thể đổi giữa hai request: khóa theo sid, đồng hồ dùng chung cho JWT và phiên, tv của PA7 đổi được.
function world() {
  const clock = { ms: NOW_MS };
  const store = new Map<string, unknown>([[SID, rec()]]);
  const calls: string[] = [];
  const jwtTv = { value: 3 };
  const tokens = new AccessTokenService({
    keys: { current: { kid: 'k2', secret: SECRET } },
    now: () => clock.ms,
    randomBytes: (n) => randomBytes(n),
    tokenVersions: { getTokenVersion: async () => jwtTv.value },
  });
  const build = (over: Record<string, unknown> = {}) =>
    new SessionBoundAccessService({
      accessTokens: tokens,
      sessions: { findBySessionId: async (s: string) => (calls.push(s), (store.get(s) ?? null) as TrustedSessionAccessRecord | null) },
      now: () => clock.ms,
      posture: STRICT_REQUIRE_LIVE_ROW,
      allowedEmployeeStatuses: ['ACTIVE'],
      ...over,
    });
  return { clock, store, calls, jwtTv, tokens, svc: build(), build, token: tokens.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 }) };
}

describe('PA10 SessionBoundAccessService — biên hết hạn của phiên (nửa mở) theo đồng hồ chạy', () => {
  it('abs: còn sống tại hạn-1 ms, bị từ chối đúng tại hạn (now >= absExpiresAt)', async () => {
    const w = world();
    w.store.set(SID, rec(row({ absExpiresAt: at(300_000), idleExpiresAt: at(300_000) })));
    w.clock.ms = NOW_MS + 299_999;
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.clock.ms = NOW_MS + 300_000;
    expect(await w.svc.validate(w.token)).toEqual(DENY);
  });
  it('idle: còn sống tại hạn-1 ms, bị từ chối đúng tại hạn; abs còn dài không cứu được', async () => {
    const w = world();
    w.store.set(SID, rec(row({ idleExpiresAt: at(120_000), absExpiresAt: at(86_400_000) })));
    w.clock.ms = NOW_MS + 119_999;
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.clock.ms = NOW_MS + 120_000;
    expect(await w.svc.validate(w.token)).toEqual(DENY);
  });
  it('phiên hết hạn trước JWT: JWT còn hạn (đến +605 s) nhưng phiên hết ở +300 s => từ chối; sau đó JWT hết hạn cũng từ chối', async () => {
    const w = world();
    w.store.set(SID, rec(row({ absExpiresAt: at(300_000), idleExpiresAt: at(300_000) })));
    w.clock.ms = NOW_MS + 400_000;
    expect(await w.svc.validate(w.token)).toEqual(DENY);
    w.clock.ms = NOW_MS + 700_000;
    expect(await w.svc.validate(w.token)).toEqual(DENY);
  });
  it('JWT hết hạn trước phiên: phiên sống đến hết ngày vẫn không cứu được JWT quá exp + 5 s', async () => {
    const w = world();
    w.clock.ms = NOW_MS + 605_000;
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.clock.ms = NOW_MS + 606_000;
    expect(await w.svc.validate(w.token)).toEqual(DENY);
  });
  it('hàng có phiên hết hạn ngay tại now (idle = abs = now) => từ chối', async () => {
    const w = world();
    w.store.set(SID, rec(row({ idleExpiresAt: at(0), absExpiresAt: at(0) })));
    expect(await w.svc.validate(w.token)).toEqual(DENY);
  });
});

describe('PA10 SessionBoundAccessService — đồng hồ của cổng phiên lỗi', () => {
  it.each([
    ['NaN', () => NaN],
    ['Infinity', () => Infinity],
    ['undefined', () => undefined],
    ['chuỗi số', () => String(NOW_MS)],
  ])('now() của cổng trả %s => từ chối và KHÔNG tra cứu nguồn phiên', async (_n, now) => {
    const w = world();
    const svc = w.build({ now });
    expect(await svc.validate(w.token)).toEqual(DENY);
    expect(w.calls).toEqual([]);
  });
  it('now() hữu hạn nhưng vượt miền Date (> 8.64e15) => từ chối (Date không hợp lệ bị bắt ở bước kiểm hàng; có thể đã tra cứu)', async () => {
    const w = world();
    expect(await w.build({ now: () => 9e15 }).validate(w.token)).toEqual(DENY);
  });
  it('now() của cổng ném => từ chối, không tra cứu', async () => {
    const w = world();
    const svc = w.build({ now: () => { throw new Error('clock'); } });
    expect(await svc.validate(w.token)).toEqual(DENY);
    expect(w.calls).toEqual([]);
  });
});

describe('PA10 SessionBoundAccessService — trạng thái đổi GIỮA hai request (không cache dương)', () => {
  it('token_version của JWT-nguồn đổi sau lần validate thành công => lần sau bị từ chối; mỗi lần validate đều tra cứu phiên lại hoặc chặn ở JWT', async () => {
    const w = world();
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.jwtTv.value = 4; // đổi mật khẩu / thu hồi toàn bộ
    expect(await w.svc.validate(w.token)).toEqual(DENY);
    expect(w.calls).toEqual([SID]); // lần 2 bị chặn ngay ở tầng JWT, chưa cần hỏi phiên
  });
  it('credentialTokenVersion trong kho phiên đổi sau lần thành công (JWT-nguồn chưa đổi) => từ chối', async () => {
    const w = world();
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.store.set(SID, rec(row(), { credentialTokenVersion: 4 }));
    expect(await w.svc.validate(w.token)).toEqual(DENY);
    expect(w.calls).toEqual([SID, SID]); // không dùng kết quả cũ
  });
  it('credentialTokenVersion thấp hơn claim (lùi version) cũng bị từ chối, không chỉ cao hơn', async () => {
    const w = world();
    w.store.set(SID, rec(row(), { credentialTokenVersion: 2 }));
    expect(await w.svc.validate(w.token)).toEqual(DENY);
  });
  it('thu hồi giữa hai request: OK -> DENY; hàng quay lại sống (kho là nguồn sự thật) -> OK, không có trạng thái âm bị nhớ', async () => {
    const w = world();
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.store.set(SID, rec(row({ revokedAt: at(-1), revokeReason: 'LOGOUT' })));
    expect(await w.svc.validate(w.token)).toEqual(DENY);
    w.store.set(SID, rec());
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    expect(w.calls).toEqual([SID, SID, SID]);
  });
  it('rotation giữa hai request: token của sid cũ bị từ chối NGAY; token của sid mới (hàng mới) được chấp nhận; nguồn nhận đúng sid từng token', async () => {
    const w = world();
    const newToken = w.tokens.sign({ employeeId: EMP, sessionId: NEXT_SID, tokenVersion: 3 });
    w.store.set(NEXT_SID, rec(row({ id: NEXT_SID })));
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.store.set(SID, rec(row({ rotatedAt: at(-1), replacedById: NEXT_SID })));
    expect(await w.svc.validate(w.token)).toEqual(DENY);
    expect(await w.svc.validate(newToken)).toEqual({ ok: true, access: { employeeId: EMP, sessionId: NEXT_SID, tokenVersion: 3 } });
    expect(w.calls).toEqual([SID, SID, NEXT_SID]);
  });
  it('rotation: hàng cũ đã xoay nhưng hàng kế nhiệm bị thu hồi => cả hai token đều bị từ chối', async () => {
    const w = world();
    const newToken = w.tokens.sign({ employeeId: EMP, sessionId: NEXT_SID, tokenVersion: 3 });
    w.store.set(SID, rec(row({ rotatedAt: at(-10), replacedById: NEXT_SID })));
    w.store.set(NEXT_SID, rec(row({ id: NEXT_SID, revokedAt: at(-1), revokeReason: 'REUSE_DETECTED' })));
    expect(await w.svc.validate(w.token)).toEqual(DENY);
    expect(await w.svc.validate(newToken)).toEqual(DENY);
  });
  it('trạng thái nhân viên đổi ACTIVE -> RESIGNED giữa hai request => từ chối ngay', async () => {
    const w = world();
    expect((await w.svc.validate(w.token)).ok).toBe(true);
    w.store.set(SID, rec(row(), { employeeStatus: 'RESIGNED' }));
    expect(await w.svc.validate(w.token)).toEqual(DENY);
  });
  it('lookup lỗi giữa hai request: OK -> DENY (lỗi) -> OK (hồi phục); lỗi không để lại trạng thái', async () => {
    const w = world();
    let fail = false;
    const svc = w.build({
      sessions: { findBySessionId: async (s: string) => { if (fail) throw new Error('db down'); return w.store.get(s) as TrustedSessionAccessRecord; } },
    });
    expect((await svc.validate(w.token)).ok).toBe(true);
    fail = true;
    expect(await svc.validate(w.token)).toEqual(DENY);
    fail = false;
    expect((await svc.validate(w.token)).ok).toBe(true);
  });
});

describe('PA10 SessionBoundAccessService — lookup lỗi dị dạng', () => {
  it.each([
    ['reject undefined', () => Promise.reject(undefined)],
    ['reject chuỗi', () => Promise.reject('db down')],
    ['resolve undefined', () => Promise.resolve(undefined)],
    ['resolve mảng', () => Promise.resolve([])],
    ['resolve hàm', () => Promise.resolve(() => rec())],
  ])('nguồn %s => UNAUTHORIZED', async (_n, impl) => {
    const w = world();
    const svc = w.build({ sessions: { findBySessionId: impl as never } });
    expect(await svc.validate(w.token)).toEqual(DENY);
  });
  it('bản ghi có getter ném khi đọc session/employeeStatus/credentialTokenVersion => UNAUTHORIZED', async () => {
    const w = world();
    for (const key of ['session', 'employeeStatus', 'credentialTokenVersion']) {
      const hostile = { ...rec() } as Record<string, unknown>;
      Object.defineProperty(hostile, key, { get() { throw new Error('getter'); }, enumerable: true });
      const svc = w.build({ sessions: { findBySessionId: async () => hostile as never } });
      expect(await svc.validate(w.token)).toEqual(DENY);
    }
  });
  it('hàng phiên có Date không hợp lệ / sai kiểu (chuỗi ISO, số epoch) => từ chối, không so sánh ngầm', async () => {
    const w = world();
    for (const bad of [
      { absExpiresAt: new Date(NaN) },
      { absExpiresAt: new Date(NOW_MS + 86_400_000).toISOString() },
      { idleExpiresAt: NOW_MS + 3_600_000 },
    ]) {
      w.store.set(SID, rec(row(bad)));
      expect(await w.svc.validate(w.token)).toEqual(DENY);
    }
  });
});

describe('PA10 SessionBoundAccessService — danh tính từ nguồn không tin cậy (bộ kiểm JWT bị tiêm giả)', () => {
  const okResult = (claims: unknown) => ({ ok: true, claims }) as unknown as AccessTokenVerifyResult;
  const withVerifier = (w: ReturnType<typeof world>, result: unknown) =>
    w.build({ accessTokens: { verify: async () => result as AccessTokenVerifyResult } });

  it.each([
    ['claims thiếu', { ok: true }],
    ['claims null', { ok: true, claims: null }],
    ['ok là chuỗi "true"', { ok: 'true', claims: { sub: EMP, sid: SID, tv: 3 } }],
    ['ok là 1', { ok: 1, claims: { sub: EMP, sid: SID, tv: 3 } }],
    ['kết quả null', null],
    ['kết quả undefined', undefined],
    ['sub không phải UUID chuẩn', { ok: true, claims: { sub: 'admin', sid: SID, tv: 3 } }],
    ['sid chữ hoa', { ok: true, claims: { sub: EMP, sid: SID.replace(/2/g, 'A').toUpperCase(), tv: 3 } }],
    ['tv chuỗi', { ok: true, claims: { sub: EMP, sid: SID, tv: '3' } }],
    ['tv âm', { ok: true, claims: { sub: EMP, sid: SID, tv: -1 } }],
  ])('verifier trả %s => UNAUTHORIZED và nguồn phiên không bị gọi', async (_n, result) => {
    const w = world();
    expect(await withVerifier(w, result).validate(w.token)).toEqual(DENY);
    expect(w.calls).toEqual([]);
  });
  it('verifier (giả) trả sub KHÁC chủ hàng phiên => từ chối; danh tính không lấy từ hàng khi lệch sub', async () => {
    const w = world();
    const svc = withVerifier(w, okResult({ sub: OTHER_EMP, sid: SID, tv: 3 }));
    expect(await svc.validate(w.token)).toEqual(DENY);
    expect(w.calls).toEqual([SID]);
  });
  it('verifier trả sid khác với sid trong token: nguồn chỉ được hỏi bằng sid của verifier, hàng sai id bị loại', async () => {
    const w = world();
    w.store.set(NEXT_SID, rec(row())); // hàng mang id=SID nhưng được trả cho NEXT_SID
    const svc = withVerifier(w, okResult({ sub: EMP, sid: NEXT_SID, tv: 3 }));
    expect(await svc.validate(w.token)).toEqual(DENY);
    expect(w.calls).toEqual([NEXT_SID]);
  });
  it('claims chứa trường đặc quyền thừa (role/employeeId/isAdmin): kết quả chỉ có đúng 3 trường từ sub/sid/tv', async () => {
    const w = world();
    const svc = withVerifier(w, okResult({ sub: EMP, sid: SID, tv: 3, role: 'ADMIN', isAdmin: true, employeeId: OTHER_EMP }));
    const r = await svc.validate(w.token);
    expect(r).toEqual({ ok: true, access: { employeeId: EMP, sessionId: SID, tokenVersion: 3 } });
    expect(Object.keys(r.ok ? r.access : {}).sort()).toEqual(['employeeId', 'sessionId', 'tokenVersion']);
  });
  it('hàng tin cậy mang trường thừa (role) không rò vào danh tính cấp ra', async () => {
    const w = world();
    w.store.set(SID, rec(row({ role: 'ADMIN', isAdmin: true })));
    const r = await w.svc.validate(w.token);
    expect(r).toEqual({ ok: true, access: { employeeId: EMP, sessionId: SID, tokenVersion: 3 } });
  });
});

describe('PA10 SessionBoundAccessService — bất biến kết quả và cấu hình sau khi tạo', () => {
  it('DENY là đối tượng đóng băng: không ai sửa được kết quả từ chối dùng chung', async () => {
    const w = world();
    const d = await w.svc.validate('rubbish');
    expect(Object.isFrozen(d)).toBe(true);
    try { (d as { ok: boolean }).ok = true; } catch { /* strict mode ném TypeError: chấp nhận */ }
    expect(await w.svc.validate('rubbish')).toEqual(DENY);
    expect((await world().svc.validate('x')).ok).toBe(false);
  });
  it('danh sách trạng thái được sao chép lúc tạo: người gọi thêm/bớt phần tử mảng sau đó không đổi chính sách', async () => {
    const w = world();
    const list = ['ACTIVE'];
    const svc = w.build({ allowedEmployeeStatuses: list });
    list.push('RESIGNED');
    w.store.set(SID, rec(row(), { employeeStatus: 'RESIGNED' }));
    expect(await svc.validate(w.token)).toEqual(DENY);
    list.length = 0;
    w.store.set(SID, rec());
    expect((await svc.validate(w.token)).ok).toBe(true);
  });
  it('allowedEmployeeStatuses là chuỗi (không phải mảng) hoặc chứa trạng thái có khoảng trắng => từ chối', async () => {
    const w = world();
    for (const allowedEmployeeStatuses of ['ACTIVE', ['ACTIVE '], [' ACTIVE'], new Set(['ACTIVE'])]) {
      expect(await w.build({ allowedEmployeeStatuses }).validate(w.token)).toEqual(DENY);
    }
  });
  it('trạng thái nhân viên có khoảng trắng/ký tự điều khiển ("ACTIVE ", "ACTIVE\\n") không khớp chính sách ACTIVE', async () => {
    const w = world();
    for (const employeeStatus of ['ACTIVE ', 'ACTIVE\n', 'ACTIVE\u0000']) {
      w.store.set(SID, rec(row(), { employeeStatus }));
      expect(await w.svc.validate(w.token)).toEqual(DENY);
    }
  });
});
