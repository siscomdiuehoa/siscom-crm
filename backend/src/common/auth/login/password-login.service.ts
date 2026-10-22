import { DomainException } from '../../errors/domain.exception';
import { CredentialStore, PasswordHasher, VerifiedLogin } from './password-login.types';
import { isCanonicalUuid } from '../uuid';

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
    const normalized = login.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > MAX_LOGIN_LEN || password.length === 0 || password.length > MAX_PASSWORD_LEN) return fail();

    let cred: Awaited<ReturnType<CredentialStore['findByLogin']>>;
    try {
      cred = await this.store.findByLogin(normalized);
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
