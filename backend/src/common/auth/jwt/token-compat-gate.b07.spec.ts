// B07 — cổng tương thích token (CHỈ TEST, offline): chứng minh chênh lệch giữa parseBearer/SessionService (sid_ + 43) và JWT HS256 (PA7/PA8).
// KHÔNG đổi parser, KHÔNG bật AuthController, KHÔNG nối AuthModule/guard/CSRF/CORS. Khóa/đồng hồ/kho đều GIẢ. Không env, không DB.
// Các ca này GHI NHẬN hành vi hiện tại; khi chủ sở hữu chọn mô hình token (xem BLOCKED_BY_DESIGN trong báo cáo), test phải được sửa có chủ đích.
import { randomBytes } from 'node:crypto';
import { DomainException } from '../../errors/domain.exception';
import { AuthHttpHandler } from '../http/auth-http.handler';
import { MAX_AUTH_HEADER_LEN, parseBearer } from '../http/auth-http.contract';
import { LoginSessionService } from '../login/login-session.service';
import { PasswordLoginService } from '../login/password-login.service';
import { CredentialStore, PasswordHasher } from '../login/password-login.types';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { SessionService, Sha256TokenHasher, TOKEN_PREFIX } from '../session/session.service';
import { AccessTokenService } from './access-token.service';
import { SESSION_ACCESS_UNAUTHORIZED, SessionBoundAccessService, STRICT_REQUIRE_LIVE_ROW } from './session-bound-access.service';

const EMP = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const FAMILY = '55555555-5555-4555-8555-555555555555';
const SECRET = 'FAKE-TEST-KEY-A-0123456789abcdef0123456789';
const NOW_MS = 1_800_000_000_000;
const HEX = 'a'.repeat(64);
const at = (d: number) => new Date(NOW_MS + d);

const tokens = new AccessTokenService({
  keys: { current: { kid: 'k2', secret: SECRET } },
  now: () => NOW_MS,
  randomBytes: (n) => randomBytes(n),
  tokenVersions: { getTokenVersion: async () => 3 },
});
const jwt = () => tokens.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });

function build() {
  const store = new InMemorySessionStore();
  store.setTokenVersion(EMP, 1);
  const clock = { now: () => new Date(NOW_MS) };
  const sessions = new SessionService(store, store, new Sha256TokenHasher(), clock, 60_000);
  const hasher: PasswordHasher = { verify: async () => true };
  const creds: CredentialStore = { findByIdentifier: async () => ({ employeeId: EMP, hash: 'H', algo: 'argon2id', active: true }) };
  const handler = new AuthHttpHandler(new LoginSessionService(new PasswordLoginService(creds, hasher), sessions), sessions);
  return { store, sessions, handler };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const errOf = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as DomainException; }
  throw new Error('không ném lỗi');
};
const expect401 = (e: DomainException) => { expect(e.getStatus()).toBe(401); expect(e.code).toBe('AUTH_REQUIRED'); };

describe('B07 — parseBearer chỉ nhận sid_+43; JWT HS256 (PA7) bị loại trước khi chạm kho', () => {
  it('đối chứng dương: Bearer sid_ + 43 ký tự base64url => trả nguyên token', () => {
    const t = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    expect(t).toHaveLength(47);
    expect(parseBearer(`Bearer ${t}`)).toBe(t);
  });

  it('JWT do AccessTokenService (PA7) ký: có dạng a.b.c và dài hơn giới hạn header => parseBearer ném 401 AUTH_REQUIRED', () => {
    const t = jwt();
    expect(t.split('.')).toHaveLength(3);
    expect(t.startsWith(TOKEN_PREFIX)).toBe(false);
    expect(`Bearer ${t}`.length).toBeGreaterThan(MAX_AUTH_HEADER_LEN); // bị chặn ngay ở giới hạn độ dài, trước cả regex
    expect(() => parseBearer(`Bearer ${t}`)).toThrow(DomainException);
    try { parseBearer(`Bearer ${t}`); } catch (e) { expect401(e as DomainException); }
  });

  it('nới độ dài cũng không cứu được: regex sid_[A-Za-z0-9_-]{43} loại JWT vì có dấu "." và tiền tố eyJ', () => {
    // Thay một JWT bằng chuỗi ngắn giả (≤128) vẫn có dấu "." => vẫn bị loại, chứng minh nguyên nhân thứ hai độc lập với độ dài.
    expect(() => parseBearer('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.AAAA')).toThrow(DomainException);
    expect(() => parseBearer('Bearer sid_' + 'A'.repeat(42) + '.')).toThrow(DomainException);
  });
});

describe('B07 — route hiện có (AuthHttpHandler) dùng SessionService sid_: JWT bị 401, kho phiên không được chạm', () => {
  it('me: Bearer JWT => 401 AUTH_REQUIRED; Bearer sid_ do login cấp => 200 (đối chứng dương)', async () => {
    const { handler, store } = build();
    const findSpy = jest.spyOn(store, 'findByHash');
    expect401(await errOf(handler.me({ headers: bearer(jwt()) })));
    expect(findSpy).not.toHaveBeenCalled();
    const { token } = await handler.login({ body: { login: 'nv@siscom.vn', password: 'y' }, headers: {} });
    expect(await handler.me({ headers: bearer(token) })).toEqual({ employeeId: EMP });
  });

  it('logout: Bearer JWT => 401 AUTH_REQUIRED, không gọi revoke (JWT không thể đăng xuất qua route hiện tại)', async () => {
    const { handler, store } = build();
    const revokeSpy = jest.spyOn(store, 'revokeByHash');
    expect401(await errOf(handler.logout({ headers: bearer(jwt()) })));
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('login hiện trả token KHÔNG phải JWT: dạng sid_+43, không có dấu ".", và AccessTokenService.verify từ chối (MALFORMED)', async () => {
    const { handler } = build();
    const { token } = await handler.login({ body: { login: 'nv@siscom.vn', password: 'y' }, headers: {} });
    expect(token).toMatch(/^sid_[A-Za-z0-9_-]{43}$/);
    expect(token.includes('.')).toBe(false);
    const r = await tokens.verify(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MALFORMED');
  });

  it('SessionService.validate(JWT) và revoke(JWT): validate => 401; revoke im lặng không làm gì (không báo phiên có tồn tại)', async () => {
    const { sessions, store } = build();
    const revokeSpy = jest.spyOn(store, 'revokeByHash');
    const e = await errOf(sessions.validate(jwt())); expect(e.getStatus()).toBe(401); expect(e.code).toBe('SESSION_INVALID');
    await expect(sessions.revoke(jwt())).resolves.toBeUndefined();
    expect(revokeSpy).not.toHaveBeenCalled();
  });
});

describe('B07 — chiều ngược: SessionBoundAccessService (PA8) chỉ nhận JWT; token sid_ bị từ chối, nguồn phiên không được chạm', () => {
  const row = {
    id: SID, employeeId: EMP, familyId: FAMILY, refreshHash: HEX, csrfHash: HEX,
    issuedAt: at(-60_000), lastUsedAt: at(-30_000), idleExpiresAt: at(3_600_000), absExpiresAt: at(86_400_000),
    rotatedAt: null, replacedById: null, revokedAt: null, revokeReason: null,
  };
  const make = () => {
    const calls: string[] = [];
    const svc = new SessionBoundAccessService({
      accessTokens: tokens,
      sessions: { findBySessionId: async (sid) => (calls.push(sid), { session: row, employeeStatus: 'ACTIVE', credentialTokenVersion: 3 }) },
      now: () => NOW_MS,
      posture: STRICT_REQUIRE_LIVE_ROW,
      allowedEmployeeStatuses: ['ACTIVE'],
    });
    return { svc, calls };
  };

  it('đối chứng dương: JWT hợp lệ => ok; token sid_ do SessionService cấp => UNAUTHORIZED và nguồn phiên không bị gọi', async () => {
    const { svc, calls } = make();
    expect((await svc.validate(jwt())).ok).toBe(true);
    expect(calls).toEqual([SID]);
    calls.length = 0;
    const sidToken = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    expect(await svc.validate(sidToken)).toEqual({ ok: false, code: SESSION_ACCESS_UNAUTHORIZED });
    expect(calls).toEqual([]);
  });

  it('hai cổng loại trừ nhau: cùng một chuỗi không bao giờ được cả parseBearer và PA8 chấp nhận', async () => {
    const { svc } = make();
    const sidToken = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    for (const t of [jwt(), sidToken]) {
      let accepted = 0;
      try { parseBearer(`Bearer ${t}`); accepted++; } catch { /* từ chối */ }
      if ((await svc.validate(t)).ok) accepted++;
      expect(accepted).toBe(1);
    }
  });
});
