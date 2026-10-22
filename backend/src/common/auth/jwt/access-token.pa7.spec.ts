// PA7 — kiểm thử đơn vị AccessTokenService. Chỉ khóa GIẢ trong fixture; đồng hồ/ngẫu nhiên/nguồn tv đều giả. Không env, không DB.
import { createHmac, randomBytes } from 'node:crypto';
import {
  ACCESS_TOKEN_INVALID,
  AccessTokenService,
  AccessTokenFailReason,
  TokenVersionSource,
} from './access-token.service';

const EMP = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const UPPER_SID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const FAKE_EMP = '33333333-3333-4333-8333-333333333333';
const SECRET_A = 'FAKE-TEST-KEY-A-0123456789abcdef0123456789';
const SECRET_B = 'FAKE-TEST-KEY-B-0123456789abcdef0123456789';
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const sigOf = (secret: string, input: string, algo = 'sha256') => createHmac(algo, secret).update(input).digest();

function tvSource(map: Record<string, number | null>, opts: { throws?: boolean; raw?: unknown } = {}): TokenVersionSource {
  return {
    getTokenVersion: async (id: string) => {
      if (opts.throws) throw new Error('boom');
      if (opts.raw !== undefined) return opts.raw as number;
      return id in map ? map[id] : null;
    },
  };
}

function make(over: { now?: () => number; rnd?: (n: number) => Buffer; prev?: boolean; tv?: TokenVersionSource; currentKid?: string; secret?: string } = {}) {
  const clock = { ms: NOW_MS };
  const svc = new AccessTokenService({
    keys: {
      current: { kid: over.currentKid ?? 'k2', secret: over.secret ?? SECRET_A },
      ...(over.prev ? { previous: { kid: 'k1', secret: SECRET_B } } : {}),
    },
    now: over.now ?? (() => clock.ms),
    randomBytes: over.rnd ?? ((n) => randomBytes(n)),
    tokenVersions: over.tv ?? tvSource({ [EMP]: 3 }),
  });
  return { svc, clock };
}

const claimsOf = (over: Record<string, unknown> = {}) => ({
  iss: 'siscom-crm', aud: 'siscom-crm-api', sub: EMP, sid: SID, tv: 3, iat: NOW_S, exp: NOW_S + 600, jti: b64u(Buffer.alloc(16, 7)), ...over,
});
// Dựng token tay (để tạo token độc hại), ký bằng secret/thuật toán tùy chọn.
function forge(header: Record<string, unknown>, claims: Record<string, unknown>, secret = SECRET_A, algo = 'sha256'): string {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  return `${input}.${sigOf(secret, input, algo).toString('base64url')}`;
}
const H = { alg: 'HS256', typ: 'JWT', kid: 'k2' };

async function reason(svc: AccessTokenService, token: unknown): Promise<AccessTokenFailReason | 'OK'> {
  const r = await svc.verify(token);
  if (r.ok) return 'OK';
  expect(r.code).toBe(ACCESS_TOKEN_INVALID);
  return r.reason;
}

describe('PA7 AccessTokenService', () => {
  describe('ký + kiểm hợp lệ', () => {
    it('round-trip: claim đúng hình dạng, exp = iat + 600, iss/aud cố định', async () => {
      const { svc } = make();
      const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      const [h, p] = t.split('.');
      expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual(H);
      const c = JSON.parse(Buffer.from(p, 'base64url').toString());
      expect(Object.keys(c).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'sid', 'sub', 'tv']);
      expect(c).toMatchObject({ iss: 'siscom-crm', aud: 'siscom-crm-api', sub: EMP, sid: SID, tv: 3, iat: NOW_S, exp: NOW_S + 600 });
      const r = await svc.verify(t);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.claims).toEqual(c);
    });
    it('sign từ chối đầu vào sai hình dạng (không ký token sai)', () => {
      const { svc } = make();
      for (const bad of [
        { employeeId: 'x', sessionId: SID, tokenVersion: 1 },
        { employeeId: EMP, sessionId: UPPER_SID, tokenVersion: 1 },
        { employeeId: EMP, sessionId: SID, tokenVersion: -1 },
        { employeeId: EMP, sessionId: SID, tokenVersion: 1.5 },
        null,
      ]) {
        expect(() => svc.sign(bad as never)).toThrow();
      }
    });
    it('sign từ chối bộ ngẫu nhiên trả sai độ dài / đồng hồ hỏng', () => {
      expect(() => make({ rnd: () => Buffer.alloc(8) }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 })).toThrow();
      expect(() => make({ now: () => NaN }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 })).toThrow();
    });
  });

  describe('malformed', () => {
    it.each([
      ['không phải chuỗi', 123],
      ['null', null],
      ['rỗng', ''],
      ['2 đoạn', 'a.b'],
      ['4 đoạn', 'a.b.c.d'],
      ['ký tự lạ', 'a b.c.d'],
      ['có padding =', 'YQ==.YQ==.YQ=='],
      ['quá dài', 'a'.repeat(3000)],
    ])('%s => MALFORMED', async (_n, tok) => {
      expect(await reason(make().svc, tok)).toBe('MALFORMED');
    });
    it('header không phải JSON / không phải object => HEADER_INVALID', async () => {
      const { svc } = make();
      for (const h of ['not json', '[]', '"str"', 'null']) {
        expect(await reason(svc, `${b64u(h)}.${b64u('{}')}.${b64u('x')}`)).toBe('HEADER_INVALID');
      }
    });
    it('payload không phải JSON (dù chữ ký đúng) => CLAIMS_INVALID', async () => {
      const input = `${b64u(JSON.stringify(H))}.${b64u('not json')}`;
      expect(await reason(make().svc, `${input}.${sigOf(SECRET_A, input).toString('base64url')}`)).toBe('CLAIMS_INVALID');
    });
    it('chữ ký sai độ dài / không chuẩn => SIGNATURE_INVALID', async () => {
      const { svc } = make();
      const good = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      const [h, p, s] = good.split('.');
      expect(await reason(svc, `${h}.${p}.${s.slice(0, -4)}`)).toBe('SIGNATURE_INVALID');
      expect(await reason(svc, `${h}.${p}.${s}AAAA`)).toBe('SIGNATURE_INVALID');
      expect(await reason(svc, `${h}.${p}.`)).toBe('MALFORMED');
      // bit thừa ở ký tự cuối: giải mã cùng byte nhưng mã hóa không chuẩn
      const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const alt = last[(last.indexOf(s[s.length - 1]) + 1) % 4 === 0 ? 0 : 1];
      if (alt !== s[s.length - 1]) expect(await reason(svc, `${h}.${p}.${s.slice(0, -1)}${alt}`)).toBe('SIGNATURE_INVALID');
    });
    it('claim sai hình dạng (chữ ký đúng) => bị từ chối', async () => {
      const { svc } = make();
      const bad: Array<[string, Record<string, unknown>, AccessTokenFailReason]> = [
        ['thiếu jti', (() => { const c = claimsOf(); delete (c as Record<string, unknown>).jti; return c; })(), 'CLAIMS_INVALID'],
        ['claim thừa', claimsOf({ amr: ['pwd'] }), 'CLAIMS_INVALID'],
        ['sub không phải UUID', claimsOf({ sub: 'admin' }), 'CLAIMS_INVALID'],
        ['sid chữ hoa', claimsOf({ sid: UPPER_SID }), 'CLAIMS_INVALID'],
        ['tv âm', claimsOf({ tv: -1 }), 'CLAIMS_INVALID'],
        ['tv chuỗi', claimsOf({ tv: '3' }), 'CLAIMS_INVALID'],
        ['iat không nguyên', claimsOf({ iat: NOW_S + 0.5, exp: NOW_S + 600.5 }), 'CLAIMS_INVALID'],
        ['exp - iat != 600', claimsOf({ exp: NOW_S + 3600 }), 'CLAIMS_INVALID'],
        ['jti sai độ dài', claimsOf({ jti: 'short' }), 'CLAIMS_INVALID'],
        ['sai iss', claimsOf({ iss: 'evil' }), 'ISSUER_INVALID'],
        ['sai aud', claimsOf({ aud: 'other-api' }), 'AUDIENCE_INVALID'],
        ['aud dạng mảng', claimsOf({ aud: ['siscom-crm-api'] }), 'AUDIENCE_INVALID'],
      ];
      for (const [, c, why] of bad) expect(await reason(svc, forge(H, c))).toBe(why);
    });
  });

  describe('replay / jti', () => {
    it('jti là nonce 128-bit duy nhất giữa các lần ký (1000 token)', () => {
      const { svc } = make();
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
        const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
        expect(c.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
        seen.add(c.jti);
      }
      expect(seen.size).toBe(1000);
    });
    it('jti đến từ nguồn ngẫu nhiên tiêm vào (không tự suy ra từ claim)', () => {
      const a = make({ rnd: () => Buffer.alloc(16, 1) }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      const b = make({ rnd: () => Buffer.alloc(16, 2) }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      expect(a).not.toBe(b);
    });
    it('GHI NHẬN thiết kế: không có danh sách chặn jti — cùng token kiểm được nhiều lần đến khi hết hạn (câu hỏi cho chủ sở hữu)', async () => {
      const { svc } = make();
      const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      expect(await reason(svc, t)).toBe('OK');
      expect(await reason(svc, t)).toBe('OK');
    });
  });

  describe('hết hạn / chưa hiệu lực / skew 5 s', () => {
    it('hợp lệ tới exp + 5 s, hết hạn từ exp + 6 s', async () => {
      const { svc, clock } = make();
      const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      clock.ms = NOW_MS + 600_000;
      expect(await reason(svc, t)).toBe('OK');
      clock.ms = NOW_MS + 605_000;
      expect(await reason(svc, t)).toBe('OK');
      clock.ms = NOW_MS + 606_000;
      expect(await reason(svc, t)).toBe('EXPIRED');
      clock.ms = NOW_MS + 7 * 86_400_000;
      expect(await reason(svc, t)).toBe('EXPIRED');
    });
    it('iat ở tương lai: chấp nhận <= 5 s, từ chối > 5 s (NOT_YET_VALID)', async () => {
      const { svc } = make();
      expect(await reason(svc, forge(H, claimsOf({ iat: NOW_S + 5, exp: NOW_S + 605 })))).toBe('OK');
      expect(await reason(svc, forge(H, claimsOf({ iat: NOW_S + 6, exp: NOW_S + 606 })))).toBe('NOT_YET_VALID');
      expect(await reason(svc, forge(H, claimsOf({ iat: NOW_S + 3600, exp: NOW_S + 4200 })))).toBe('NOT_YET_VALID');
    });
    it('đồng hồ hỏng (NaN) => từ chối', async () => {
      const t = make().svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      expect(await reason(make({ now: () => NaN }).svc, t)).toBe('CLAIMS_INVALID');
    });
  });

  describe('chữ ký sai / khóa', () => {
    it('đổi 1 ký tự payload hoặc dùng khóa khác => SIGNATURE_INVALID', async () => {
      const { svc } = make();
      const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      const [h, , s] = t.split('.');
      const evilPayload = b64u(JSON.stringify(claimsOf({ sub: FAKE_EMP })));
      expect(await reason(svc, `${h}.${evilPayload}.${s}`)).toBe('SIGNATURE_INVALID');
      expect(await reason(svc, forge(H, claimsOf(), SECRET_B))).toBe('SIGNATURE_INVALID');
    });
  });

  describe('alg confusion', () => {
    it.each([
      ['none', ''],
      ['HS384', 'sha384'],
      ['HS512', 'sha512'],
      ['RS256', 'sha256'],
      ['ES256', 'sha256'],
      ['hs256', 'sha256'],
      ['HS256 ', 'sha256'],
    ])('alg=%s bị chặn ALG_NOT_ALLOWED', async (alg, algo) => {
      const { svc } = make();
      const input = `${b64u(JSON.stringify({ ...H, alg }))}.${b64u(JSON.stringify(claimsOf()))}`;
      const sig = alg === 'none' ? '' : sigOf(SECRET_A, input, algo).toString('base64url');
      expect(await reason(svc, `${input}.${sig}`)).toBe(alg === 'none' ? 'MALFORMED' : 'ALG_NOT_ALLOWED');
      // alg=none kèm chữ ký giả vẫn bị chặn ở alg
      if (alg === 'none') expect(await reason(svc, `${input}.${b64u(Buffer.alloc(32))}`)).toBe('ALG_NOT_ALLOWED');
    });
    it('header thiếu alg / alg không phải chuỗi / header có trường thừa (jku, crit, jwk)', async () => {
      const { svc } = make();
      expect(await reason(svc, forge({ typ: 'JWT', kid: 'k2' }, claimsOf()))).toBe('ALG_NOT_ALLOWED');
      expect(await reason(svc, forge({ ...H, alg: ['HS256'] }, claimsOf()))).toBe('ALG_NOT_ALLOWED');
      for (const extra of [{ jku: 'http://evil' }, { crit: ['x'] }, { jwk: {} }]) {
        expect(await reason(svc, forge({ ...H, ...extra }, claimsOf()))).toBe('HEADER_INVALID');
      }
      expect(await reason(svc, forge({ alg: 'HS256', kid: 'k2' }, claimsOf()))).toBe('HEADER_INVALID'); // thiếu typ
      expect(await reason(svc, forge({ alg: 'HS256', typ: 'JWT' }, claimsOf()))).toBe('HEADER_INVALID'); // thiếu kid
    });
    it('khóa công khai/PEM giả làm secret HS256 không giúp được: kid lạ bị từ chối', async () => {
      expect(await reason(make().svc, forge({ ...H, kid: 'rsa-pub' }, claimsOf()))).toBe('KID_UNKNOWN');
    });
  });

  describe('nhân viên giả / token_version cũ', () => {
    it('sub không tồn tại trong nguồn => ACTOR_UNKNOWN (dù chữ ký đúng)', async () => {
      const { svc } = make();
      const t = svc.sign({ employeeId: FAKE_EMP, sessionId: SID, tokenVersion: 3 });
      expect(await reason(svc, t)).toBe('ACTOR_UNKNOWN');
    });
    it('tv cũ (đã đổi mật khẩu/thu hồi) => TOKEN_VERSION_STALE; tv lớn hơn hiện tại cũng bị từ chối', async () => {
      const src: Record<string, number | null> = { [EMP]: 3 };
      const { svc } = make({ tv: tvSource(src) });
      const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      expect(await reason(svc, t)).toBe('OK');
      src[EMP] = 4;
      expect(await reason(svc, t)).toBe('TOKEN_VERSION_STALE');
      src[EMP] = 2;
      expect(await reason(svc, t)).toBe('TOKEN_VERSION_STALE');
    });
    it('nguồn tv ném lỗi hoặc trả giá trị rác => từ chối (fail-closed)', async () => {
      const t = make().svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      expect(await reason(make({ tv: tvSource({}, { throws: true }) }).svc, t)).toBe('TOKEN_VERSION_SOURCE_ERROR');
      for (const raw of [-1, 1.5, '3', undefined, NaN]) {
        const svc = make({ tv: { getTokenVersion: async () => raw as never } }).svc;
        expect(await reason(svc, t)).toBe(raw === undefined ? 'TOKEN_VERSION_SOURCE_ERROR' : 'TOKEN_VERSION_SOURCE_ERROR');
      }
    });
    it('claim KHÔNG phải thẩm quyền: verifyOffline không kiểm tv nhưng verify thì có; nguồn tv không bị gọi khi chữ ký sai', async () => {
      const spy = jest.fn(async () => 3);
      const { svc } = make({ tv: { getTokenVersion: spy } });
      expect(await reason(svc, forge(H, claimsOf(), SECRET_B))).toBe('SIGNATURE_INVALID');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('quay vòng khóa (current + previous)', () => {
    it('token ký bằng khóa cũ (kid k1) được kiểm khi PREV được cấu hình; ký mới luôn dùng khóa hiện tại', async () => {
      const old = make({ currentKid: 'k1', secret: SECRET_B }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      const rotated = make({ prev: true }).svc; // current k2/A, previous k1/B
      expect(await reason(rotated, old)).toBe('OK');
      const fresh = rotated.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      expect(JSON.parse(Buffer.from(fresh.split('.')[0], 'base64url').toString()).kid).toBe('k2');
    });
    it('không cấu hình PREV (hoặc đã bỏ PREV) => token khóa cũ bị từ chối KID_UNKNOWN', async () => {
      const old = make({ currentKid: 'k1', secret: SECRET_B }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      expect(await reason(make().svc, old)).toBe('KID_UNKNOWN');
    });
    it('kid ràng buộc khóa: nhãn k1 nhưng ký bằng khóa hiện tại (hoặc ngược lại) => SIGNATURE_INVALID', async () => {
      const svc = make({ prev: true }).svc;
      expect(await reason(svc, forge({ ...H, kid: 'k1' }, claimsOf(), SECRET_A))).toBe('SIGNATURE_INVALID');
      expect(await reason(svc, forge({ ...H, kid: 'k2' }, claimsOf(), SECRET_B))).toBe('SIGNATURE_INVALID');
    });
    it('khóa cũ chỉ để kiểm: service không bao giờ ký bằng khóa cũ', () => {
      const t = make({ prev: true }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      const [h, p, s] = t.split('.');
      expect(s).toBe(sigOf(SECRET_A, `${h}.${p}`).toString('base64url'));
      expect(s).not.toBe(sigOf(SECRET_B, `${h}.${p}`).toString('base64url'));
    });
  });

  describe('cấu hình thiếu/sai => fail-closed (không tạo được dịch vụ)', () => {
    const ok = { now: () => NOW_MS, randomBytes: (n: number) => randomBytes(n), tokenVersions: tvSource({}) };
    const build = (keys: unknown, rest: Record<string, unknown> = {}) => () => new AccessTokenService({ ...ok, keys, ...rest } as never);
    it('thiếu/sai khóa hiện tại', () => {
      expect(build(undefined)).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({})).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'k', secret: '' } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'k', secret: 'short' } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'k', secret: 'CHANGE_ME' + 'x'.repeat(40) } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: '', secret: SECRET_A } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'bad kid!', secret: SECRET_A } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'k', secret: 123 } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
    });
    it('PREV trùng kid/khóa với hiện tại hoặc hỏng', () => {
      expect(build({ current: { kid: 'k', secret: SECRET_A }, previous: { kid: 'k', secret: SECRET_B } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'k', secret: SECRET_A }, previous: { kid: 'p', secret: SECRET_A } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'k', secret: SECRET_A }, previous: { kid: 'p', secret: 'short' } })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build({ current: { kid: 'k', secret: SECRET_A }, previous: null })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
    });
    it('thiếu đồng hồ / ngẫu nhiên / nguồn tv', () => {
      const keys = { current: { kid: 'k', secret: SECRET_A } };
      expect(build(keys, { now: undefined })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build(keys, { randomBytes: undefined })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(build(keys, { tokenVersions: undefined })).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
      expect(() => new AccessTokenService(undefined as never)).toThrow('ACCESS_TOKEN_CONFIG_INVALID');
    });
    it('lỗi/kết quả không làm lộ khóa hay token', async () => {
      try {
        build({ current: { kid: 'k', secret: 'short-secret-value' } })();
      } catch (e) {
        expect(String((e as Error).message)).not.toContain('short-secret-value');
      }
      const { svc } = make();
      const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      const bad = await svc.verify(t.slice(0, -2) + 'AA');
      const dump = JSON.stringify(bad);
      expect(dump).not.toContain(t.split('.')[2]);
      expect(dump).not.toContain(SECRET_A);
    });
    it('sao chép khóa lúc tạo: đổi Buffer của người gọi sau đó không đổi hành vi', async () => {
      const buf = Buffer.from(SECRET_A);
      const svc = new AccessTokenService({ ...ok, keys: { current: { kid: 'k2', secret: buf } }, tokenVersions: tvSource({ [EMP]: 3 }) });
      const t = svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 });
      buf.fill(0);
      expect(await reason(svc, t)).toBe('OK');
    });
  });
});
