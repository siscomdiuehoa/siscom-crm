// P-A Sprint PA12 — ĐIỀU KIỆN TIÊN QUYẾT credential (token_version + trạng thái nhân viên) cho xoay refresh. CHỈ KIỂU + hàm thuần + bản `Unwired`.
// KHÔNG SQL, KHÔNG DB, KHÔNG DI/route, KHÔNG đọc cấu hình/env. Không sửa `RefreshSessionStore` (PA3) để không phá hợp đồng/ test đã chốt.
//
// VẤN ĐỀ (PA11): `RefreshSessionStore.atomicRotate` không kiểm credential. Sau đổi mật khẩu (token_version tăng) hoặc nhân viên bị khóa/nghỉ việc,
// nếu người gọi quên `revokeAllForEmployee` thì refresh vẫn sinh hàng mới. => `atomicRotate` TRẦN KHÔNG ĐƯỢC dùng cho dịch vụ refresh (S4);
// dịch vụ refresh phải dùng `atomicRotateGuarded` của cổng `CredentialGuardedRefreshSessionStore` dưới đây.
//
// HỢP ĐỒNG `atomicRotateGuarded` (bổ sung cho mục 1-6 của PA3; adapter PHẢI bảo đảm):
//  C1. TRONG CÙNG thao tác nguyên tử với đọc hàng/ghi xoay, adapter tự đọc trạng thái credential CÓ THẨM QUYỀN phía server (token_version hiện tại + trạng thái
//      nhân viên) — KHÔNG nhận giá trị trạng thái từ người gọi. `credential.expectedTokenVersion` chỉ là KỲ VỌNG, được so với trạng thái thật ở C1.
//      NGUỒN của kỳ vọng phải là phía server và GẮN VỚI PHIÊN lúc cấp (không phải body/header/JWT cũ, và KHÔNG phải "đọc token_version hiện tại rồi truyền lại":
//      làm vậy vô hiệu hóa kiểm tra). Hàng `auth_session` hiện KHÔNG có cột token_version => nguồn đó CHƯA TỒN TẠI; cần thay đổi schema (F09/migration, chưa làm).
//  C2. Thất bại => KHÔNG xoay, KHÔNG tạo hàng, KHÔNG thu hồi bất kỳ family nào (kể cả phát hiện tái dùng), KHÔNG phát token. Kiểm credential chạy TRƯỚC phân loại hàng.
//  C3. Fail-closed: không có nguồn credential / nguồn ném lỗi / hình dạng sai / chính sách trạng thái trống => CREDENTIAL_UNAVAILABLE. Không có mặc định cho phép.
//  C4. Mã TOKEN_VERSION_STALE / EMPLOYEE_NOT_ALLOWED / CREDENTIAL_UNAVAILABLE CHỈ DÙNG NỘI BỘ (log nội bộ/đo lường). Phía ngoài PHẢI trả lỗi xác thực đồng nhất
//      (xem `toUniformRefreshDenial`), không phân biệt nguyên nhân.
//  C5. Chính sách trạng thái nhân viên được phép (vd ON_LEAVE có được không) là tham số TƯỜNG MINH `allowedEmployeeStatuses`; mã này KHÔNG chọn thay chủ sở hữu.
//
// !!! CHƯA CHỨNG MINH: tính nguyên tử THẬT giữa "đổi mật khẩu/khóa nhân viên" và "xoay" cần một giao dịch DB (khóa dòng credential + dòng phiên, hoặc UPDATE có
// điều kiện) — chưa có adapter, chưa có cột; giữ trạng thái CHƯA CHỨNG MINH đến F09. Kho giả trong test KHÔNG chứng minh điều đó. !!!
import { isValidTokenVersion } from '../uuid';
import { AtomicRotateInput, AtomicRotateResult, assertValidAtomicRotate, RefreshStoreInputError, RefreshStoreUnwiredError, RefreshSessionStore } from './refresh-session-store';

export type CredentialDenyCode = 'TOKEN_VERSION_STALE' | 'EMPLOYEE_NOT_ALLOWED' | 'CREDENTIAL_UNAVAILABLE';

export interface CredentialPrecondition {
  /** Kỳ vọng phía server gắn với phiên (KHÔNG từ body/header/JWT). Adapter so với token_version thật trong cùng thao tác nguyên tử. */
  readonly expectedTokenVersion: number;
  /** Chính sách trạng thái nhân viên được phép, tiêm tường minh. Rỗng => từ chối. Không có mặc định. */
  readonly allowedEmployeeStatuses: readonly string[];
}
/** Trạng thái credential có thẩm quyền do ADAPTER đọc trong thao tác nguyên tử (coi là không tin cậy về hình dạng). */
export interface CredentialAuthoritativeState {
  readonly employeeStatus: unknown;
  readonly tokenVersion: unknown;
}

export interface GuardedAtomicRotateInput extends AtomicRotateInput {
  readonly credential: CredentialPrecondition;
}
export type GuardedAtomicRotateResult = AtomicRotateResult | { readonly status: CredentialDenyCode; readonly familyRevoked: false };

export interface CredentialGuardedRefreshSessionStore extends RefreshSessionStore {
  atomicRotateGuarded(input: GuardedAtomicRotateInput): Promise<GuardedAtomicRotateResult>;
}

const STATUS_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Kiểm đầu vào thuần: `credential` BẮT BUỘC, đúng hình dạng; phần còn lại kiểm bằng `assertValidAtomicRotate`. Ném `RefreshStoreInputError` (chỉ tên trường). */
export function assertValidGuardedRotate(raw: unknown): asserts raw is GuardedAtomicRotateInput {
  if (!isObj(raw)) throw new RefreshStoreInputError(['input']);
  const { credential, ...rest } = raw;
  assertValidAtomicRotate(rest);
  const p: string[] = [];
  if (!isObj(credential)) p.push('credential');
  else {
    for (const k of Object.keys(credential)) if (k !== 'expectedTokenVersion' && k !== 'allowedEmployeeStatuses') p.push(`credential.unexpected:${k}`);
    if (!isValidTokenVersion(credential.expectedTokenVersion)) p.push('credential.expectedTokenVersion');
    const s = credential.allowedEmployeeStatuses;
    if (!Array.isArray(s) || s.length === 0 || !s.every((x) => typeof x === 'string' && STATUS_RE.test(x))) p.push('credential.allowedEmployeeStatuses');
  }
  if (p.length) throw new RefreshStoreInputError(p);
}

/**
 * Hàm thuần dùng chung cho mọi adapter: so trạng thái có thẩm quyền (đọc trong thao tác nguyên tử) với điều kiện. `null` = được phép.
 * Fail-closed: thiếu/sai hình dạng => CREDENTIAL_UNAVAILABLE; trạng thái ngoài chính sách => EMPLOYEE_NOT_ALLOWED; token_version khác => TOKEN_VERSION_STALE.
 * Trạng thái được kiểm TRƯỚC token_version (nhân viên bị khóa thì không cần lộ thêm thông tin).
 */
export function evaluateCredentialPrecondition(state: unknown, pre: CredentialPrecondition): CredentialDenyCode | null {
  if (!isObj(state)) return 'CREDENTIAL_UNAVAILABLE';
  const { employeeStatus, tokenVersion } = state;
  if (typeof employeeStatus !== 'string' || !STATUS_RE.test(employeeStatus) || !isValidTokenVersion(tokenVersion)) return 'CREDENTIAL_UNAVAILABLE';
  if (!isValidTokenVersion(pre.expectedTokenVersion) || !Array.isArray(pre.allowedEmployeeStatuses) || pre.allowedEmployeeStatuses.length === 0) return 'CREDENTIAL_UNAVAILABLE';
  if (!pre.allowedEmployeeStatuses.includes(employeeStatus)) return 'EMPLOYEE_NOT_ALLOWED';
  if (tokenVersion !== pre.expectedTokenVersion) return 'TOKEN_VERSION_STALE';
  return null;
}

/** C4: mọi mã từ chối credential (và mọi từ chối xoay khác) ra ngoài là MỘT kết quả đồng nhất, không phản chiếu nguyên nhân. */
export const REFRESH_DENIED = 'UNAUTHORIZED';
export function toUniformRefreshDenial(result: GuardedAtomicRotateResult): { readonly ok: true } | { readonly ok: false; readonly code: typeof REFRESH_DENIED } {
  return result.status === 'ROTATED' ? { ok: true } : { ok: false, code: REFRESH_DENIED };
}

export class UnwiredCredentialGuardedRefreshSessionStore {
  atomicRotateGuarded(_input: GuardedAtomicRotateInput): Promise<GuardedAtomicRotateResult> {
    // Từ chối mặc định: chưa có adapter/nguồn credential có thẩm quyền.
    return Promise.reject(new RefreshStoreUnwiredError('atomicRotateGuarded'));
  }
}
