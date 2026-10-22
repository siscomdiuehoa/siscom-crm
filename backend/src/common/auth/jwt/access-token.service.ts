// Dịch vụ ký/kiểm JWT access token (P-A, Sprint PA7). CHỈ MÃ NGUỒN, offline: KHÔNG đăng ký vào AuthModule, KHÔNG guard/route,
// KHÔNG đọc env/bí mật, KHÔNG DB, KHÔNG log. Khóa, đồng hồ, bộ sinh ngẫu nhiên và nguồn token_version đều do NGƯỜI GỌI tiêm vào.
// Nguồn: B1.3.1_DETAILED_DESIGN mục 6.2: HS256 ghim; iss="siscom-crm"; aud="siscom-crm-api"; sub/sid/tv/iat/exp/jti; exp=+600 s;
// lệch đồng hồ <= 5 s; khóa hiện tại + khóa cũ (kid) để quay vòng. Độ dài khóa theo B1.3.2-A (>= 32 byte, không CHANGE_ME, PREV khác hiện tại).
// KẾT QUẢ `ok:true` CHỈ có nghĩa: chữ ký + hình dạng claim + hạn + token_version khớp. KHÔNG phải quyền: claim không bao giờ là thẩm quyền đặc quyền;
// lớp gọi vẫn phải kiểm phiên chưa thu hồi/quá hạn tuyệt đối, nhân viên ACTIVE, credential ACTIVE (mục 6.2) từ DB.
// CHƯA CHỐT (chọn tối thiểu, cần chủ sở hữu xác nhận): (a) cách mã hóa kid — ở đây kid là header JWT, giá trị do người gọi cấu hình, bắt buộc có;
// (b) KHÔNG có danh sách chặn jti (tài liệu không nêu): token vẫn dùng lại được đến khi hết hạn; jti chỉ là nonce duy nhất;
// (c) không có claim `amr` (B1.3.0 nêu, B1.3.1 DETAILED bỏ); (d) thu hồi phiên/đổi tv ở lớp khác, không làm ở đây.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isCanonicalUuid, isValidTokenVersion } from '../uuid';

export const ACCESS_TOKEN_ALG = 'HS256';
export const ACCESS_TOKEN_ISSUER = 'siscom-crm';
export const ACCESS_TOKEN_AUDIENCE = 'siscom-crm-api';
export const ACCESS_TOKEN_TTL_SECONDS = 600;
export const ACCESS_TOKEN_SKEW_SECONDS = 5;
export const ACCESS_TOKEN_INVALID = 'ACCESS_TOKEN_INVALID';

export type AccessTokenFailReason =
  | 'MALFORMED'
  | 'HEADER_INVALID'
  | 'ALG_NOT_ALLOWED'
  | 'KID_UNKNOWN'
  | 'SIGNATURE_INVALID'
  | 'CLAIMS_INVALID'
  | 'ISSUER_INVALID'
  | 'AUDIENCE_INVALID'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'ACTOR_UNKNOWN'
  | 'TOKEN_VERSION_STALE'
  | 'TOKEN_VERSION_SOURCE_ERROR';

export interface AccessClaims {
  iss: string;
  aud: string;
  sub: string; // employeeId
  sid: string; // sessionId
  tv: number; // token_version
  iat: number;
  exp: number;
  jti: string;
}

// Kết quả lỗi chỉ chứa mã cố định; không phản chiếu token/chữ ký/khóa.
export type AccessTokenVerifyResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; code: typeof ACCESS_TOKEN_INVALID; reason: AccessTokenFailReason };

export interface AccessKey {
  kid: string;
  secret: string | Buffer;
}
export interface AccessTokenKeys {
  current: AccessKey;
  previous?: AccessKey; // chỉ khi đang quay vòng tường minh; chỉ để KIỂM, không bao giờ để ký
}
export interface TokenVersionSource {
  /** token_version hiện tại của nhân viên; null nếu không có nhân viên. */
  getTokenVersion(employeeId: string): Promise<number | null>;
}
export interface AccessTokenDeps {
  keys: AccessTokenKeys;
  now: () => number; // epoch ms
  randomBytes: (size: number) => Buffer;
  tokenVersions: TokenVersionSource;
}
export interface SignInput {
  employeeId: string;
  sessionId: string;
  tokenVersion: number;
}

const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const B64URL_SEG = /^[A-Za-z0-9_-]+$/;
const JTI_RE = /^[A-Za-z0-9_-]{22}$/; // 128-bit base64url
const MIN_SECRET_BYTES = 32;
const MAX_TOKEN_LENGTH = 2048;
const HEADER_KEYS = ['alg', 'kid', 'typ'];
const CLAIM_KEYS = ['aud', 'exp', 'iat', 'iss', 'jti', 'sid', 'sub', 'tv'];

const b64u = (b: Buffer): string => b.toString('base64url');
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const sameKeys = (o: Record<string, unknown>, expected: string[]): boolean => {
  const k = Object.keys(o).sort();
  return k.length === expected.length && k.every((x, i) => x === expected[i]);
};
const secretBytes = (s: unknown): Buffer | null => {
  if (typeof s === 'string') return Buffer.from(s, 'utf8');
  return Buffer.isBuffer(s) ? s : null;
};
const fail = (reason: AccessTokenFailReason): AccessTokenVerifyResult => ({ ok: false, code: ACCESS_TOKEN_INVALID, reason });

interface ResolvedKey {
  kid: string;
  secret: Buffer;
}
function resolveKey(k: unknown): ResolvedKey {
  const o = k as Partial<AccessKey> | undefined;
  const secret = secretBytes(o?.secret);
  if (!o || typeof o.kid !== 'string' || !KID_RE.test(o.kid) || secret === null) throw new Error('ACCESS_TOKEN_CONFIG_INVALID');
  if (secret.length < MIN_SECRET_BYTES || secret.toString('utf8').includes('CHANGE_ME')) throw new Error('ACCESS_TOKEN_CONFIG_INVALID');
  return { kid: o.kid, secret: Buffer.from(secret) }; // sao chép: người gọi đổi buffer sau đó không ảnh hưởng
}

export class AccessTokenService {
  private readonly current: ResolvedKey;
  private readonly previous: ResolvedKey | null;
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly tokenVersions: TokenVersionSource;

  /** Cấu hình thiếu/sai => ném lỗi cố định (fail-closed: không có dịch vụ nào được tạo). Lỗi không chứa giá trị khóa. */
  constructor(deps: AccessTokenDeps) {
    if (
      !deps ||
      typeof deps.now !== 'function' ||
      typeof deps.randomBytes !== 'function' ||
      !deps.tokenVersions ||
      typeof deps.tokenVersions.getTokenVersion !== 'function' ||
      !deps.keys
    ) {
      throw new Error('ACCESS_TOKEN_CONFIG_INVALID');
    }
    this.current = resolveKey(deps.keys.current);
    this.previous = deps.keys.previous === undefined ? null : resolveKey(deps.keys.previous);
    if (this.previous && (this.previous.kid === this.current.kid || this.previous.secret.equals(this.current.secret))) {
      throw new Error('ACCESS_TOKEN_CONFIG_INVALID'); // PREV phải khác hiện tại (kid và khóa)
    }
    this.now = deps.now;
    this.randomBytes = deps.randomBytes;
    this.tokenVersions = deps.tokenVersions;
  }

  /** Ký bằng khóa HIỆN TẠI (kid hiện tại). Đầu vào sai => ném lỗi cố định (không ký token sai hình dạng). */
  sign(input: SignInput): string {
    if (!input || !isCanonicalUuid(input.employeeId) || !isCanonicalUuid(input.sessionId) || !isValidTokenVersion(input.tokenVersion)) {
      throw new Error('ACCESS_TOKEN_SIGN_INPUT_INVALID');
    }
    const nowMs = this.now();
    if (!Number.isFinite(nowMs)) throw new Error('ACCESS_TOKEN_CLOCK_INVALID');
    const rnd = this.randomBytes(16);
    if (!Buffer.isBuffer(rnd) || rnd.length !== 16) throw new Error('ACCESS_TOKEN_RANDOM_INVALID');
    const iat = Math.floor(nowMs / 1000);
    const claims: AccessClaims = {
      iss: ACCESS_TOKEN_ISSUER,
      aud: ACCESS_TOKEN_AUDIENCE,
      sub: input.employeeId,
      sid: input.sessionId,
      tv: input.tokenVersion,
      iat,
      exp: iat + ACCESS_TOKEN_TTL_SECONDS,
      jti: b64u(rnd),
    };
    const header = { alg: ACCESS_TOKEN_ALG, typ: 'JWT', kid: this.current.kid };
    const signingInput = `${b64u(Buffer.from(JSON.stringify(header)))}.${b64u(Buffer.from(JSON.stringify(claims)))}`;
    return `${signingInput}.${b64u(createHmac('sha256', this.current.secret).update(signingInput).digest())}`;
  }

  /** Kiểm chữ ký + claim + hạn + token_version. Mọi lỗi/ngoại lệ => từ chối. Xem ghi chú đầu tệp: ok KHÔNG phải quyền. */
  async verify(token: unknown): Promise<AccessTokenVerifyResult> {
    try {
      const r = this.verifyOffline(token);
      if (!r.ok) return r;
      let current: number | null;
      try {
        current = await this.tokenVersions.getTokenVersion(r.claims.sub);
      } catch {
        return fail('TOKEN_VERSION_SOURCE_ERROR');
      }
      if (current === null) return fail('ACTOR_UNKNOWN');
      if (!isValidTokenVersion(current)) return fail('TOKEN_VERSION_SOURCE_ERROR');
      if (current !== r.claims.tv) return fail('TOKEN_VERSION_STALE');
      return r;
    } catch {
      return fail('MALFORMED');
    }
  }

  /** Phần đồng bộ: chưa kiểm token_version. Không dùng riêng để cấp quyền. */
  verifyOffline(token: unknown): AccessTokenVerifyResult {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return fail('MALFORMED');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => B64URL_SEG.test(p))) return fail('MALFORMED');
    const [h, p, s] = parts;

    const header = this.parseJson(h);
    if (!isPlainObject(header)) return fail('HEADER_INVALID');
    if (header.alg !== ACCESS_TOKEN_ALG) return fail('ALG_NOT_ALLOWED'); // none/HS384/RS*/chữ thường... bị chặn trước khi chọn khóa
    if (!sameKeys(header, HEADER_KEYS) || header.typ !== 'JWT' || typeof header.kid !== 'string') return fail('HEADER_INVALID');
    const key = header.kid === this.current.kid ? this.current : this.previous && header.kid === this.previous.kid ? this.previous : null;
    if (key === null) return fail('KID_UNKNOWN');

    const sig = Buffer.from(s, 'base64url');
    if (sig.length !== 32 || b64u(sig) !== s) return fail('SIGNATURE_INVALID'); // đúng 32 byte, mã hóa chuẩn (không bit thừa)
    const expected = createHmac('sha256', key.secret).update(`${h}.${p}`).digest();
    if (!timingSafeEqual(sig, expected)) return fail('SIGNATURE_INVALID');

    const c = this.parseJson(p);
    if (!isPlainObject(c) || !sameKeys(c, CLAIM_KEYS)) return fail('CLAIMS_INVALID');
    if (c.iss !== ACCESS_TOKEN_ISSUER) return fail('ISSUER_INVALID');
    if (c.aud !== ACCESS_TOKEN_AUDIENCE) return fail('AUDIENCE_INVALID');
    if (
      !isCanonicalUuid(c.sub) ||
      !isCanonicalUuid(c.sid) ||
      !isValidTokenVersion(c.tv) ||
      !Number.isSafeInteger(c.iat) ||
      !Number.isSafeInteger(c.exp) ||
      typeof c.jti !== 'string' ||
      !JTI_RE.test(c.jti)
    ) {
      return fail('CLAIMS_INVALID');
    }
    const iat = c.iat as number;
    const exp = c.exp as number;
    if (exp - iat !== ACCESS_TOKEN_TTL_SECONDS) return fail('CLAIMS_INVALID'); // vòng đời cố định 600 s

    const nowMs = this.now();
    if (!Number.isFinite(nowMs)) return fail('CLAIMS_INVALID');
    const nowSec = Math.floor(nowMs / 1000);
    if (iat > nowSec + ACCESS_TOKEN_SKEW_SECONDS) return fail('NOT_YET_VALID');
    if (nowSec > exp + ACCESS_TOKEN_SKEW_SECONDS) return fail('EXPIRED');

    return { ok: true, claims: { iss: c.iss, aud: c.aud, sub: c.sub, sid: c.sid, tv: c.tv, iat, exp, jti: c.jti } };
  }

  private parseJson(seg: string): unknown {
    try {
      return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
    } catch {
      return undefined;
    }
  }
}
