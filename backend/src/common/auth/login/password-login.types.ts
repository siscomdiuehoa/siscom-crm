// Cổng (port) cho xác minh đăng nhập bằng mật khẩu (Sprint A1, chỉ mã nguồn, offline). CHƯA có triển khai DB và CHƯA gắn vào route/DI:
// lược đồ hiện tại chưa có hàm đọc thông tin xác thực cho role siscom_auth được duyệt, nên bộ lưu trữ là giao diện do PR sau cung cấp.

import { ParsedLoginIdentifier } from './login-identifier';

export interface StoredCredential {
  // Danh tính do DB trả về — nguồn DUY NHẤT của employeeId; không bao giờ lấy từ nội dung request.
  readonly employeeId: string;
  readonly hash: string;
  readonly algo: string;
  readonly active: boolean;
}

// Danh tính tra cứu đã qua parseLoginIdentifier (đã loại INVALID). EMAIL => DB so khớp lower(email)=lower($1), giá trị giữ nguyên hoa/thường; EMPLOYEE_CODE => so khớp chính xác NV-#### (chữ hoa).
export type LoginLookupIdentifier = Exclude<ParsedLoginIdentifier, { readonly kind: 'INVALID' }>;

export interface CredentialStore {
  // Không tìm thấy => null. Không được log giá trị tham số. Chưa có triển khai DB.
  findByIdentifier(identifier: LoginLookupIdentifier): Promise<StoredCredential | null>;
}
export const CREDENTIAL_STORE = Symbol('CREDENTIAL_STORE');

export interface PasswordHasher {
  // Luôn tốn thời gian xác minh ngay cả khi `hash` là null (băm giả) để không lộ tài khoản có tồn tại hay không. Không ném lỗi ra ngoài: lỗi => false.
  verify(hash: string | null, password: string): Promise<boolean>;
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface VerifiedLogin { readonly employeeId: string }
