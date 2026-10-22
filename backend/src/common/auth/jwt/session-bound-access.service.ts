// Cổng + dịch vụ xác thực access token GẮN PHIÊN (P-A, Sprint PA8). CHỈ MÃ NGUỒN, offline: KHÔNG đăng ký AuthModule, KHÔNG guard/route,
// KHÔNG đọc env/bí mật, KHÔNG DB, KHÔNG log. Bọc AccessTokenService.verify (PA7) rồi BẮT BUỘC đối chiếu nguồn trạng thái phiên phía server.
// Chữ ký/iss/aud/exp/token_version của JWT một mình KHÔNG BAO GIỜ tạo ra danh tính đã xác thực. Mặc định từ chối: mọi lỗi, thiếu phụ thuộc,
// thiếu chính sách, ngoại lệ tra cứu, hàng sai hình dạng ⇒ cùng một kết quả UNAUTHORIZED (không phân biệt nguyên nhân ra ngoài).
// Không có đường lùi về claim/body/header/bộ nhớ: danh tính chỉ lấy từ `sub` đã được ký VÀ được hàng phiên tin cậy xác nhận trùng.
//
// TƯ THẾ "STRICT_REQUIRE_LIVE_ROW" (chỉ opt-in tường minh, chỉ dùng cho kiểm thử offline; KHÔNG nối vào AuthModule/route):
//   hàng auth_session ứng với `sid` phải CÒN SỐNG: chưa thu hồi, CHƯA XOAY (rotatedAt = null), chưa quá hạn tuyệt đối và chưa quá hạn rảnh.
//   TÁC ĐỘNG: access token (TTL 600 s) cấp từ phiên đã bị xoay refresh trở nên VÔ HIỆU NGAY, dù chữ ký/hạn còn đúng; thu hồi có hiệu lực tức thì.
//   Hệ quả sản phẩm: client phải dùng access token mới ngay sau mỗi lần refresh; request đang bay với token cũ sẽ bị 401.
//   QUYẾT ĐỊNH CHÍNH SÁCH CẦN CHỦ SỞ HỮU: (1) hàng đã xoay có còn hợp lệ cho access token cũ trong thời gian ngắn không; (2) TTL access;
//   (3) thu hồi tức thì hay chấp nhận cửa sổ ≤ TTL; (4) trạng thái nhân viên nào được phép (ON_LEAVE?).
// KHÔNG có denylist jti (không bịa): jti chỉ là nonce; token bị đánh cắp dùng lại được đến khi hết hạn (TTL 600 s + skew 5 s) nếu hàng phiên còn sống.
//   Biện pháp giảm nhẹ duy nhất ở đây là kiểm phiên phía server (thu hồi/xoay/hết hạn ⇒ từ chối ngay) + TTL ngắn.
import { isCanonicalUuid, isValidTokenVersion } from '../uuid';
import { checkRefreshSessionRow } from '../session/refresh-session-row';
import type { AccessTokenVerifyResult } from './access-token.service';

export const SESSION_ACCESS_UNAUTHORIZED = 'UNAUTHORIZED';
export const STRICT_REQUIRE_LIVE_ROW = 'STRICT_REQUIRE_LIVE_ROW';

/** Kết quả từ chối đồng nhất: không có lý do, không phản chiếu token/ID. */
export type SessionBoundAccessResult =
  | { ok: true; access: ValidatedSessionAccess }
  | { ok: false; code: typeof SESSION_ACCESS_UNAUTHORIZED };

/** Danh tính chỉ sinh ra khi đã qua đủ kiểm tra; employeeId lấy từ hàng phiên tin cậy (đã xác nhận trùng `sub`). */
export interface ValidatedSessionAccess {
  readonly employeeId: string;
  readonly sessionId: string;
  readonly tokenVersion: number;
}

/** Bản ghi từ kho tin cậy phía server; coi là KHÔNG tin cậy về hình dạng (kiểm lại, fail-closed). */
export interface TrustedSessionAccessRecord {
  readonly session: unknown; // hàng auth_session (RefreshSessionRow)
  readonly employeeStatus: unknown; // trạng thái nhân viên HIỆN TẠI
  readonly credentialTokenVersion: unknown; // token_version hiện tại của credential
}
/** Cổng nguồn trạng thái phiên (adapter DB do lớp sau cấp). Chỉ nhận `sid` đã qua kiểm JWT; null = không có phiên. */
export interface SessionAccessStatusSource {
  findBySessionId(sessionId: string): Promise<TrustedSessionAccessRecord | null>;
}
/** Phần AccessTokenService mà dịch vụ này cần (cho phép tiêm giả trong test). */
export interface AccessTokenVerifier {
  verify(token: unknown): Promise<AccessTokenVerifyResult>;
}
export interface SessionBoundAccessDeps {
  accessTokens?: AccessTokenVerifier;
  sessions?: SessionAccessStatusSource; // thiếu = từ chối mọi yêu cầu (không có đường lùi)
  now?: () => number; // epoch ms
  /** Phải đặt tường minh đúng STRICT_REQUIRE_LIVE_ROW; thiếu/khác = từ chối mọi yêu cầu. */
  posture?: string;
  /** Chính sách trạng thái nhân viên được phép (vd ['ACTIVE']); chưa cấu hình/rỗng = từ chối (chưa có chính sách đã chốt trong mã). */
  allowedEmployeeStatuses?: readonly string[];
}

const DENY: SessionBoundAccessResult = Object.freeze({ ok: false, code: SESSION_ACCESS_UNAUTHORIZED });
const STATUS_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

export class SessionBoundAccessService {
  private readonly accessTokens: AccessTokenVerifier | null;
  private readonly sessions: SessionAccessStatusSource | null;
  private readonly now: (() => number) | null;
  private readonly strict: boolean;
  private readonly allowed: ReadonlySet<string>;

  /** Không ném: cấu hình thiếu/sai chỉ làm validate() luôn từ chối (mặc định từ chối). */
  constructor(deps: SessionBoundAccessDeps) {
    const d = deps ?? {};
    this.accessTokens = d.accessTokens && typeof d.accessTokens.verify === 'function' ? d.accessTokens : null;
    this.sessions = d.sessions && typeof d.sessions.findBySessionId === 'function' ? d.sessions : null;
    this.now = typeof d.now === 'function' ? d.now : null;
    this.strict = d.posture === STRICT_REQUIRE_LIVE_ROW;
    const list = Array.isArray(d.allowedEmployeeStatuses) ? d.allowedEmployeeStatuses : [];
    this.allowed = new Set(list.filter((s): s is string => typeof s === 'string' && STATUS_RE.test(s)));
  }

  /** Chỉ nhận token thô. Không nhận claim/header/body từ client. Mọi nhánh lỗi => cùng một kết quả UNAUTHORIZED. */
  async validate(token: unknown): Promise<SessionBoundAccessResult> {
    try {
      if (!this.accessTokens || !this.sessions || !this.now || !this.strict || this.allowed.size === 0) return DENY;

      const verified = await this.accessTokens.verify(token);
      if (!verified || verified.ok !== true) return DENY; // JWT sai => KHÔNG gọi nguồn phiên
      const { sub, sid, tv } = verified.claims;
      if (!isCanonicalUuid(sub) || !isCanonicalUuid(sid) || !isValidTokenVersion(tv)) return DENY;

      const nowMs = this.now();
      if (!Number.isFinite(nowMs)) return DENY;

      const rec = await this.sessions.findBySessionId(sid);
      if (typeof rec !== 'object' || rec === null) return DENY;

      const row = rec.session as { id?: unknown } | null;
      if (typeof row !== 'object' || row === null || row.id !== sid) return DENY; // hàng phải đúng phiên được hỏi
      // reuseGraceMs=0: mọi hàng đã xoay là ROTATED_REUSE => không USABLE. checkRefreshSessionRow cũng kiểm hình dạng, employee == sub,
      // thu hồi, hết hạn tuyệt đối/rảnh (nửa mở).
      if (checkRefreshSessionRow({ row, expectedEmployeeId: sub, now: new Date(nowMs), reuseGraceMs: 0 }) !== 'USABLE') return DENY;

      if (typeof rec.employeeStatus !== 'string' || !this.allowed.has(rec.employeeStatus)) return DENY;
      if (!isValidTokenVersion(rec.credentialTokenVersion) || rec.credentialTokenVersion !== tv) return DENY;

      return { ok: true, access: Object.freeze({ employeeId: sub, sessionId: sid, tokenVersion: tv }) };
    } catch {
      return DENY; // ngoại lệ (kể cả nguồn phiên ném) => từ chối, không lộ nguyên nhân
    }
  }
}
