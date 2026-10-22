import { DomainException } from '../../errors/domain.exception';
import { CredentialStore, PasswordHasher, VerifiedLogin } from './password-login.types';
import { isCanonicalUuid } from '../uuid';
import { parseLoginIdentifier } from './login-identifier';

export const MAX_LOGIN_LEN = 254;
export const MAX_PASSWORD_LEN = 1024;

// Hợp đồng: thành công => { employeeId } (lấy từ bộ lưu trữ, không từ request). MỌI thất bại (sai định dạng, không có tài khoản, sai mật khẩu,
// tài khoản khóa, thuật toán không hỗ trợ, lỗi bộ lưu trữ) => cùng một DomainException(401, LOGIN_INVALID) với cùng thông điệp.
// Service CHƯA gắn vào controller/route nào; không tạo phiên, không giới hạn tốc độ (việc của PR sau, được duyệt).
export class PasswordLoginService {
  constructor(private readonly store: CredentialStore, private readonly hasher: PasswordHasher) {}

  async verify(input: { login: unknown; password: unknown }): Promise<VerifiedLogin> {
    const fail = (): never => {
      throw new DomainException(401, 'LOGIN_INVALID', 'Tên đăng nhập hoặc mật khẩu không đúng.');
    };
    const { login, password } = input;
    if (typeof login !== 'string' || typeof password !== 'string') return fail();
    // Không hạ chữ thường: email giữ nguyên (DB so khớp lower(email)); mã nhân viên phải đúng NV-#### chữ hoa; sai định dạng => 401 chung.
    const identifier = parseLoginIdentifier(login);
    if (identifier.kind === 'INVALID' || password.length === 0 || password.length > MAX_PASSWORD_LEN) return fail();

    let cred: Awaited<ReturnType<CredentialStore['findByIdentifier']>>;
    try {
      cred = await this.store.findByIdentifier(identifier);
    } catch {
      return fail();
    }
    const usable = cred !== null && cred.active && cred.algo === 'argon2id' && isCanonicalUuid(cred.employeeId);
    // Luôn chạy xác minh (băm giả khi không dùng được) rồi mới quyết định, để các nhánh thất bại cùng chi phí.
    const ok = await this.hasher.verify(usable ? cred!.hash : null, password);
    if (!usable || !ok) return fail();
    return { employeeId: cred!.employeeId };
  }
}
