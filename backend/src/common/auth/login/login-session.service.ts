import { DomainException } from '../../errors/domain.exception';
import { SessionService } from '../session/session.service';
import { IssuedSession } from '../session/session.types';
import { PasswordLoginService } from './password-login.service';

// Điều phối đăng nhập -> phiên (Sprint A3, chỉ mã nguồn, offline). CHƯA gắn controller/route/DI/DB.
// Hợp đồng: chỉ đọc `login` và `password` từ đầu vào (mọi trường khác, kể cả employeeId, bị bỏ qua). employeeId chỉ đến từ
// PasswordLoginService (bộ lưu trữ xác thực). Phiên chỉ được cấp SAU khi xác minh mật khẩu thành công. MỌI thất bại (xác minh, bộ lưu trữ
// phiên chưa nối/lỗi ghi) => cùng DomainException(401, LOGIN_INVALID), cùng thông điệp; không log, không lộ nguyên nhân. Fail-closed.
export class LoginSessionService {
  constructor(private readonly logins: PasswordLoginService, private readonly sessions: SessionService) {}

  async login(input: { login: unknown; password: unknown }): Promise<IssuedSession> {
    const { employeeId } = await this.logins.verify({ login: input?.login, password: input?.password });
    try {
      return await this.sessions.issue(employeeId);
    } catch {
      throw new DomainException(401, 'LOGIN_INVALID', 'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
  }
}
