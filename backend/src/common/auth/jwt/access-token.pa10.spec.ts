// PA10 — hồi quy có mục tiêu cho AccessTokenService, chỉ bổ sung các ca CHƯA phủ bởi PA7. Khóa/đồng hồ/nguồn tv đều giả. Không env, không DB.
import { createHmac, randomBytes } from 'node:crypto';
import { AccessTokenFailReason, AccessTokenService, TokenVersionSource } from './access-token.service';

const EMP = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const SECRET_A = 'FAKE-TEST-KEY-A-0123456789abcdef0123456789';
const SECRET_B = 'FAKE-TEST-KEY-B-0123456789abcdef0123456789';
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const H = { alg: 'HS256', typ: 'JWT', kid: 'k2' };
const claimsOf = (over: Record<string, unknown> = {}) => ({
  iss: 'siscom-crm', aud: 'siscom-crm-api', sub: EMP, sid: SID, tv: 3, iat: NOW_S, exp: NOW_S + 600, jti: b64u(Buffer.alloc(16, 7)), ...over,
});
function forge(header: Record<string, unknown>, claims: unknown, secret = SECRET_A): string {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest().toString('base64url')}`;
}

function make(over: { now?: () => unknown; tv?: TokenVersionSource; prev?: boolean } = {}) {
  const clock = { ms: NOW_MS };
  const tvCalls: string[] = [];
  const svc = new AccessTokenService({
    keys: { current: { kid: 'k2', secret: SECRET_A }, ...(over.prev ? { previous: { kid: 'k1', secret: SECRET_B } } : {}) },
    now: (over.now ?? (() => clock.ms)) as () => number,
    randomBytes: (n) => randomBytes(n),
    tokenVersions: over.tv ?? { getTokenVersion: async (id: string) => (tvCalls.push(id), 3) },
  });
  return { svc, clock, tvCalls };
}
async function reason(svc: AccessTokenService, token: unknown): Promise<AccessTokenFailReason | 'OK'> {
  const r = await svc.verify(token);
  return r.ok ? 'OK' : r.reason;
}

describe('PA10 AccessTokenService — biên thời gian theo giây nguyên (sàn của ms)', () => {
  it('exp+5 s còn hợp lệ đến hết mili-giây thứ 605_999; sang 606_000 mới EXPIRED', async () => {
    const { svc, clock } = make();
    const t = forge(H, claimsOf());
    clock.ms = NOW_MS + 605_999;
    expect(await reason(svc, t)).toBe('OK');
    clock.ms = NOW_MS + 606_000;
    expect(await reason(svc, t)).toBe('EXPIRED');
  });
  it('iat tương lai: now có phần lẻ ms vẫn dùng sàn — iat = now+5 s OK, iat = now+6 s bị từ chối dù now = ..999 ms', async () => {
    const { svc, clock } = make();
    clock.ms = NOW_MS + 999;
    expect(await reason(svc, forge(H, claimsOf({ iat: NOW_S + 5, exp: NOW_S + 605 })))).toBe('OK');
    expect(await reason(svc, forge(H, claimsOf({ iat: NOW_S + 6, exp: NOW_S + 606 })))).toBe('NOT_YET_VALID');
  });
  it('token iat nằm trong tương lai gần rồi đồng hồ chạy tới: NOT_YET_VALID chuyển thành OK đúng tại biên', async () => {
    const { svc, clock } = make();
    const t = forge(H, claimsOf({ iat: NOW_S + 6, exp: NOW_S + 606 }));
    expect(await reason(svc, t)).toBe('NOT_YET_VALID');
    clock.ms = NOW_MS + 1_000;
    expect(await reason(svc, t)).toBe('OK');
  });
  it('now âm hoặc rất lớn không làm thủng kiểm tra hạn (token cũ vẫn EXPIRED, token tương lai vẫn NOT_YET_VALID)', async () => {
    const { svc, clock } = make();
    clock.ms = Number.MAX_SAFE_INTEGER;
    expect(await reason(svc, forge(H, claimsOf()))).toBe('EXPIRED');
    clock.ms = -NOW_MS;
    expect(await reason(svc, forge(H, claimsOf()))).toBe('NOT_YET_VALID');
  });
});

describe('PA10 AccessTokenService — đồng hồ lỗi => từ chối, không chạm nguồn tv', () => {
  it.each([
    ['NaN', () => NaN],
    ['Infinity', () => Infinity],
    ['undefined', () => undefined],
    ['null', () => null],
    ['chuỗi số (không ép kiểu ngầm)', () => String(NOW_MS)],
  ])('now() trả %s => verify từ chối và nguồn tv không bị gọi', async (_n, now) => {
    const tvCalls: string[] = [];
    const { svc } = make({ now, tv: { getTokenVersion: async (id) => (tvCalls.push(id), 3) } });
    expect(await reason(svc, forge(H, claimsOf()))).toBe('CLAIMS_INVALID');
    expect(tvCalls).toEqual([]);
  });
  it('now() ném ngoại lệ: verify() từ chối (không ném ra ngoài), nguồn tv không bị gọi', async () => {
    const tvCalls: string[] = [];
    const { svc } = make({
      now: () => { throw new Error('clock down'); },
      tv: { getTokenVersion: async (id) => (tvCalls.push(id), 3) },
    });
    expect(await reason(svc, forge(H, claimsOf()))).toBe('MALFORMED');
    expect(tvCalls).toEqual([]);
  });
  it('sign với đồng hồ trả chuỗi/Infinity bị từ chối (không ký iat vô nghĩa)', () => {
    for (const bad of [String(NOW_MS), Infinity, undefined]) {
      expect(() => make({ now: () => bad }).svc.sign({ employeeId: EMP, sessionId: SID, tokenVersion: 3 })).toThrow('ACCESS_TOKEN_CLOCK_INVALID');
    }
  });
});

describe('PA10 AccessTokenService — kid lạ và khóa cũ khi ngừng chấp nhận', () => {
  it.each([
    ['kid chưa từng cấu hình dù ký bằng khóa hiện tại', 'k9'],
    ['kid sai hoa/thường', 'K2'],
    ['kid chuỗi rỗng', ''],
    ['kid chứa ký tự ngoài bảng chữ cái cấu hình', 'k2/../k1'],
    ['kid quá dài', 'k'.repeat(64)],
    ['kid "__proto__"', '__proto__'],
  ])('%s => KID_UNKNOWN và nguồn tv không bị gọi', async (_n, kid) => {
    const { svc, tvCalls } = make({ prev: true });
    expect(await reason(svc, forge({ ...H, kid }, claimsOf()))).toBe('KID_UNKNOWN');
    expect(tvCalls).toEqual([]);
  });
  it('kid không phải chuỗi (số/null/mảng/object) => HEADER_INVALID', async () => {
    const { svc } = make({ prev: true });
    for (const kid of [2, null, ['k2'], { k: 'k2' }, true]) {
      expect(await reason(svc, forge({ ...H, kid }, claimsOf()))).toBe('HEADER_INVALID');
    }
  });
  it('typ sai hoa/thường hoặc sai loại => HEADER_INVALID', async () => {
    const { svc } = make();
    for (const typ of ['jwt', 'JWS', '', null, 1]) expect(await reason(svc, forge({ ...H, typ }, claimsOf()))).toBe('HEADER_INVALID');
  });
  it('rotation hai bước: cùng một token khóa cũ — OK khi PREV còn, KID_UNKNOWN ngay khi dịch vụ mới không cấu hình PREV; khóa mới vẫn OK', async () => {
    const oldToken = forge({ ...H, kid: 'k1' }, claimsOf(), SECRET_B);
    const during = make({ prev: true }).svc;
    expect(await reason(during, oldToken)).toBe('OK');
    const after = make().svc; // PREV đã bị bỏ
    expect(await reason(after, oldToken)).toBe('KID_UNKNOWN');
    expect(await reason(after, forge(H, claimsOf()))).toBe('OK');
  });
  it('token khóa cũ vẫn chịu mọi kiểm tra khác: hết hạn / tv cũ / tv lệch đều bị từ chối', async () => {
    const { svc, clock } = make({ prev: true });
    const old = forge({ ...H, kid: 'k1' }, claimsOf({ tv: 2 }), SECRET_B);
    expect(await reason(svc, old)).toBe('TOKEN_VERSION_STALE'); // nguồn tv = 3
    const ok = forge({ ...H, kid: 'k1' }, claimsOf(), SECRET_B);
    expect(await reason(svc, ok)).toBe('OK');
    clock.ms = NOW_MS + 606_000;
    expect(await reason(svc, ok)).toBe('EXPIRED');
  });
});

describe('PA10 AccessTokenService — claim thiếu từng trường / sai kiểu (chữ ký đúng)', () => {
  it.each(['iss', 'aud', 'sub', 'sid', 'tv', 'iat', 'exp', 'jti'])('thiếu %s => từ chối, nguồn tv không bị gọi', async (key) => {
    const { svc, tvCalls } = make();
    const c = claimsOf() as Record<string, unknown>;
    delete c[key];
    expect(await reason(svc, forge(H, c))).toBe('CLAIMS_INVALID');
    expect(tvCalls).toEqual([]);
  });
  it.each([
    ['sub là số', { sub: 1 }],
    ['sub null', { sub: null }],
    ['sid mảng', { sid: [SID] }],
    ['sid UUID có dấu ngoặc', { sid: `{${SID}}` }],
    ['sub có khoảng trắng thừa', { sub: `${EMP} ` }],
    ['tv boolean', { tv: true }],
    ['tv null', { tv: null }],
    ['tv vượt số nguyên an toàn', { tv: 2 ** 53 }],
    ['iat chuỗi số', { iat: String(NOW_S), exp: NOW_S + 600 }],
    ['exp chuỗi số', { exp: String(NOW_S + 600) }],
    ['iat null', { iat: null }],
    ['exp null', { exp: null }],
    ['iat vượt số nguyên an toàn (exp-iat vẫn 600)', { iat: 1e300, exp: 1e300 + 600 }],
    ['jti số', { jti: 12345 }],
    ['jti đủ 22 ký tự nhưng có ký tự ngoài base64url', { jti: 'A'.repeat(21) + '+' }],
    ['iss số', { iss: 1 }],
  ])('%s => CLAIMS_INVALID (hoặc iss sai)', async (_n, over) => {
    const r = await reason(make().svc, forge(H, claimsOf(over)));
    expect(r === 'CLAIMS_INVALID' || r === 'ISSUER_INVALID').toBe(true);
  });
  it('payload là mảng / null / chuỗi / số (dù ký đúng) => CLAIMS_INVALID', async () => {
    const { svc } = make();
    for (const payload of [[], null, 'x', 7, [claimsOf()]]) expect(await reason(svc, forge(H, payload))).toBe('CLAIMS_INVALID');
  });
  it('claim __proto__ / constructor chèn thêm bị từ chối bởi tập khóa cố định', async () => {
    const { svc } = make();
    const base = JSON.stringify(claimsOf());
    for (const extra of ['"__proto__":{"sub":"x"}', '"constructor":1']) {
      const input = `${b64u(JSON.stringify(H))}.${b64u(base.slice(0, -1) + ',' + extra + '}')}`;
      const sig = createHmac('sha256', SECRET_A).update(input).digest().toString('base64url');
      expect(await reason(svc, `${input}.${sig}`)).toBe('CLAIMS_INVALID');
    }
  });
  it('tv = 0 là hợp lệ về hình dạng và phải khớp nguồn đúng 0 (không bị coi là falsy)', async () => {
    const zero = make({ tv: { getTokenVersion: async () => 0 } }).svc;
    expect(await reason(zero, forge(H, claimsOf({ tv: 0 })))).toBe('OK');
    const nonZero = make({ tv: { getTokenVersion: async () => 1 } }).svc;
    expect(await reason(nonZero, forge(H, claimsOf({ tv: 0 })))).toBe('TOKEN_VERSION_STALE');
  });
});

describe('PA10 AccessTokenService — nguồn tv: danh tính từ nguồn không tin cậy', () => {
  it('nguồn tv chỉ được hỏi bằng sub đã ký (đúng một lần, đúng một đối số)', async () => {
    const seen: unknown[][] = [];
    const { svc } = make({ tv: { getTokenVersion: async (...a: unknown[]) => (seen.push(a), 3) } as TokenVersionSource });
    expect(await reason(svc, forge(H, claimsOf()))).toBe('OK');
    expect(seen).toEqual([[EMP]]);
  });
  it('nguồn tv ném ĐỒNG BỘ (không phải reject) => TOKEN_VERSION_SOURCE_ERROR, không ném ra ngoài', async () => {
    const { svc } = make({ tv: { getTokenVersion: (() => { throw new Error('sync'); }) as never } });
    expect(await reason(svc, forge(H, claimsOf()))).toBe('TOKEN_VERSION_SOURCE_ERROR');
  });
  it('nguồn tv trả đối tượng/mảng/boolean/Infinity/số quá lớn => từ chối (không khớp ngầm bằng ép kiểu)', async () => {
    for (const raw of [{ tv: 3 }, [3], true, Infinity, 2 ** 53, '3', 3.0000001]) {
      const svc = make({ tv: { getTokenVersion: async () => raw as never } }).svc;
      expect(await reason(svc, forge(H, claimsOf()))).toBe('TOKEN_VERSION_SOURCE_ERROR');
    }
  });
  it('tv đổi giữa hai lần verify của CÙNG token: lần 1 OK, lần 2 STALE, rồi trả về giá trị cũ thì OK lại (không có cache âm/dương)', async () => {
    let current = 3;
    const { svc } = make({ tv: { getTokenVersion: async () => current } });
    const t = forge(H, claimsOf());
    expect(await reason(svc, t)).toBe('OK');
    current = 4;
    expect(await reason(svc, t)).toBe('TOKEN_VERSION_STALE');
    current = 3;
    expect(await reason(svc, t)).toBe('OK');
  });
  it('verifyOffline không có tác dụng phụ lên nguồn tv và không ném với token rác', () => {
    const { svc, tvCalls } = make();
    for (const t of [undefined, null, 5, {}, 'a.b', forge(H, claimsOf())]) expect(() => svc.verifyOffline(t)).not.toThrow();
    expect(tvCalls).toEqual([]);
  });
});
