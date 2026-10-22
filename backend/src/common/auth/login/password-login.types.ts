// Cổng (port) cho xác minh đăng nhập bằng mật khẩu (Sprint A1, chỉ mã nguồn, offline). CHƯA có triển khai DB và CHƯA gắn vào route/DI:
// lược đồ hiện tại chưa có hàm đọc thông tin xác thực cho role siscom_auth được duyệt, nên bộ lưu trữ là giao diện do PR sau cung cấp.

export interface StoredCredential {
  // Danh tính do DB trả về — nguồn DUY NHẤT của employeeId; không bao giờ lấy từ nội dung request.
  readonly employeeId: string;
  readonly hash: string;
  readonly algo: string;
  readonly active: boolean;
}

export interface CredentialStore {
  // Tra theo tên đăng nhập (đã chuẩn hóa). Không tìm thấy => null. Không được log giá trị tham số.
  findByLogin(login: string): Promise<StoredCredential | null>;
}
export const CREDENTIAL_STORE = Symbol('CREDENTIAL_STORE');

export interface PasswordHasher {
  // Luôn tốn thời gian xác minh ngay cả khi `hash` là null (băm giả) để không lộ tài khoản có tồn tại hay không. Không ném lỗi ra ngoài: lỗi => false.
  verify(hash: string | null, password: string): Promise<boolean>;
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface VerifiedLogin { readonly employeeId: string }
