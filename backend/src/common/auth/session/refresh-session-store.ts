// P-A Sprint PA3 — CỔNG (port) kho phiên refresh `auth_session`. Chỉ KIỂU + bộ kiểm đầu vào thuần + bản `Unwired` từ chối mặc định.
// KHÔNG SQL, KHÔNG DB, KHÔNG đăng ký DI/route, KHÔNG đọc cấu hình. Chưa có adapter thật (S8 chờ ủy quyền).
// Chỉ nhận BĂM (SHA-256 hex) — kiểu đầu vào không có chỗ cho token rõ; bộ kiểm từ chối khóa lạ (vd `refreshToken`).
// `employeeId` luôn do server cung cấp (từ phiên/đăng nhập đã xác thực), KHÔNG lấy từ nội dung request.
// Chính sách CHƯA được duyệt (`reuseGraceMs`, TTL idle/tuyệt đối, cookie, JWT) là tham số BẮT BUỘC, không có mặc định ở đây.
//
// HỢP ĐỒNG NGUYÊN TỬ của `atomicRotate` (adapter DB phải bảo đảm; mô hình nhiều lệnh gọi KHÔNG tương đương):
//  1. Một thao tác duy nhất của kho: đọc hàng theo băm + phân loại + ghi kết quả là KHÔNG thể xen kẽ với `atomicRotate` khác trên cùng băm
//     (adapter DB: một giao dịch, khóa hàng). Hai lệnh đồng thời cùng băm: tối đa MỘT trả ROTATED; bên còn lại nhận ROTATED_RECENT/ROTATED_REUSE.
//  2. ROTATED: hàng cũ có rotatedAt+replacedById, hàng mới được tạo CÙNG family, cả hai hoặc không gì cả.
//  3. ROTATED_REUSE: kho thu hồi CẢ family trong cùng thao tác (lý do REFRESH_REUSE) và báo `familyRevoked: true`.
//  4. Mọi trạng thái khác USABLE/ROTATED: KHÔNG ghi gì.
//  5. Lỗi hạ tầng => ném lỗi (người gọi coi là từ chối); không bao giờ trả ROTATED khi chưa ghi bền.
//
// LỘ TRÌNH THAY THẾ (chưa làm ở PA3): `SessionService`/`SessionRecord`/`InMemorySessionStore` (bearer `sid_`, A2) VẪN GIỮ vì test hiện có phụ thuộc.
// S4 (dịch vụ refresh) dùng cổng này; S8 thêm adapter DB thật (giao dịch + khóa hàng) sau khi được ủy quyền; sau đó mới gỡ dịch vụ `sid_`
// và chuyển `InMemorySessionStore` sang `test/` — mỗi bước một PR riêng.
import { isCanonicalUuid } from '../uuid';
import { RefreshRowStatus, RefreshSessionRow } from './refresh-session-row';

export interface NewRefreshSessionInput {
  readonly id: string; // UUID do server sinh
  readonly refreshHash: string; // SHA-256 hex của refresh token (token rõ không bao giờ vào kho)
  readonly csrfHash: string; // SHA-256 hex của CSRF token
  readonly idleExpiresAt: Date;
  readonly absExpiresAt: Date;
}

export interface CreateFamilyInput extends NewRefreshSessionInput {
  readonly employeeId: string; // từ phiên đã xác thực phía server
  readonly familyId: string; // UUID mới do server sinh
  readonly issuedAt: Date;
}
export type CreateFamilyResult = { readonly status: 'CREATED'; readonly row: RefreshSessionRow } | { readonly status: 'DUPLICATE' };

export interface FindActiveInput {
  readonly refreshHash: string;
  readonly expectedEmployeeId: string;
  readonly now: Date;
}
// "Active" = chưa thu hồi, chưa xoay, chưa quá hạn idle/tuyệt đối (nửa mở). Còn lại => NOT_FOUND (không phân biệt, tránh dò).
export type FindActiveResult = { readonly status: 'FOUND'; readonly row: RefreshSessionRow } | { readonly status: 'NOT_FOUND' };

export interface AtomicRotateInput {
  readonly presentedRefreshHash: string;
  readonly expectedEmployeeId: string;
  readonly now: Date;
  readonly reuseGraceMs: number; // BẮT BUỘC, số nguyên an toàn >= 0, chưa có mặc định được duyệt
  readonly next: NewRefreshSessionInput; // hàng kế tiếp (chỉ băm)
}
export type RotateDenyStatus = Exclude<RefreshRowStatus, 'USABLE'> | 'UNKNOWN_TOKEN';
export type AtomicRotateResult =
  | { readonly status: 'ROTATED'; readonly previousRowId: string; readonly row: RefreshSessionRow }
  | { readonly status: RotateDenyStatus; readonly familyRevoked: boolean };

export interface RevokeFamilyInput {
  readonly familyId: string;
  readonly reason: string; // HOA/_ (ck_sess_revoke), <= 40 ký tự
  readonly now: Date;
}
export interface RevokeAllForEmployeeInput {
  readonly employeeId: string;
  readonly reason: string;
  readonly now: Date;
}
export interface RevokeResult {
  readonly revokedCount: number;
}

export interface RefreshSessionStore {
  createFamily(input: CreateFamilyInput): Promise<CreateFamilyResult>;
  findActiveByRefreshHash(input: FindActiveInput): Promise<FindActiveResult>;
  atomicRotate(input: AtomicRotateInput): Promise<AtomicRotateResult>;
  revokeFamily(input: RevokeFamilyInput): Promise<RevokeResult>;
  revokeAllForEmployee(input: RevokeAllForEmployeeInput): Promise<RevokeResult>;
}

// ---- Bộ kiểm đầu vào thuần (adapter nào cũng phải gọi trước khi chạm lưu trữ) ----
const HEX64 = /^[0-9a-f]{64}$/;
const REASON = /^[A-Z][A-Z0-9_]*$/;
const isDate = (v: unknown): v is Date => v instanceof Date && Number.isFinite(v.getTime());
const isHex64 = (v: unknown): boolean => typeof v === 'string' && HEX64.test(v);
const isReason = (v: unknown): boolean => typeof v === 'string' && v.length <= 40 && REASON.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class RefreshStoreInputError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`REFRESH_STORE_BAD_INPUT: ${problems.join(',')}`); // chỉ tên trường, không giá trị
    this.name = 'RefreshStoreInputError';
  }
}

function check(raw: unknown, allowed: readonly string[], rules: Record<string, (v: unknown) => boolean>, extra?: (r: Record<string, unknown>) => string[]): void {
  if (!isObj(raw)) throw new RefreshStoreInputError(['input']);
  const p: string[] = [];
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) p.push(`unexpected:${k}`); // chặn token rõ / trường lạ
  for (const k of allowed) if (!rules[k](raw[k])) p.push(k);
  if (!p.length && extra) p.push(...extra(raw));
  if (p.length) throw new RefreshStoreInputError(p);
}
const uuid = (v: unknown) => isCanonicalUuid(v);
const nextRules = { id: uuid, refreshHash: isHex64, csrfHash: isHex64, idleExpiresAt: isDate, absExpiresAt: isDate };
const nextKeys = ['id', 'refreshHash', 'csrfHash', 'idleExpiresAt', 'absExpiresAt'] as const;
const expiryOrder = (r: Record<string, unknown>, base?: Date): string[] => {
  const idle = r.idleExpiresAt as Date;
  const abs = r.absExpiresAt as Date;
  const p: string[] = [];
  if (idle > abs) p.push('ck_sess_idle');
  if (base && abs < base) p.push('ck_sess_abs');
  return p;
};

export function assertValidCreateFamily(raw: unknown): asserts raw is CreateFamilyInput {
  check(raw, [...nextKeys, 'employeeId', 'familyId', 'issuedAt'], { ...nextRules, employeeId: uuid, familyId: uuid, issuedAt: isDate }, (r) => expiryOrder(r, r.issuedAt as Date));
}
export function assertValidFindActive(raw: unknown): asserts raw is FindActiveInput {
  check(raw, ['refreshHash', 'expectedEmployeeId', 'now'], { refreshHash: isHex64, expectedEmployeeId: uuid, now: isDate });
}
export function assertValidAtomicRotate(raw: unknown): asserts raw is AtomicRotateInput {
  check(
    raw,
    ['presentedRefreshHash', 'expectedEmployeeId', 'now', 'reuseGraceMs', 'next'],
    {
      presentedRefreshHash: isHex64,
      expectedEmployeeId: uuid,
      now: isDate,
      reuseGraceMs: (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
      next: (v) => isObj(v),
    },
    (r) => {
      const next = r.next as Record<string, unknown>;
      try {
        check(next, nextKeys, nextRules, (n) => expiryOrder(n, r.now as Date));
      } catch (e) {
        return (e as RefreshStoreInputError).problems.map((x) => `next.${x}`);
      }
      return next.refreshHash === r.presentedRefreshHash ? ['next.refreshHash_reuses_presented'] : [];
    },
  );
}
export function assertValidRevokeFamily(raw: unknown): asserts raw is RevokeFamilyInput {
  check(raw, ['familyId', 'reason', 'now'], { familyId: uuid, reason: isReason, now: isDate });
}
export function assertValidRevokeAllForEmployee(raw: unknown): asserts raw is RevokeAllForEmployeeInput {
  check(raw, ['employeeId', 'reason', 'now'], { employeeId: uuid, reason: isReason, now: isDate });
}

// ---- Bản chưa nối: từ chối mặc định, không bao giờ phát/ghi phiên ----
export class RefreshStoreUnwiredError extends Error {
  constructor(op: string) {
    super(`REFRESH_SESSION_STORE_UNWIRED: ${op}`);
    this.name = 'RefreshStoreUnwiredError';
  }
}
export class UnwiredRefreshSessionStore implements RefreshSessionStore {
  createFamily(_input: CreateFamilyInput): Promise<CreateFamilyResult> {
    return Promise.reject(new RefreshStoreUnwiredError('createFamily'));
  }
  findActiveByRefreshHash(_input: FindActiveInput): Promise<FindActiveResult> {
    return Promise.reject(new RefreshStoreUnwiredError('findActiveByRefreshHash'));
  }
  atomicRotate(_input: AtomicRotateInput): Promise<AtomicRotateResult> {
    return Promise.reject(new RefreshStoreUnwiredError('atomicRotate'));
  }
  revokeFamily(_input: RevokeFamilyInput): Promise<RevokeResult> {
    return Promise.reject(new RefreshStoreUnwiredError('revokeFamily'));
  }
  revokeAllForEmployee(_input: RevokeAllForEmployeeInput): Promise<RevokeResult> {
    return Promise.reject(new RefreshStoreUnwiredError('revokeAllForEmployee'));
  }
}
