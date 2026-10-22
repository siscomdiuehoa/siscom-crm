import { LoginSessionService } from '../login/login-session.service';
import { SessionService } from '../session/session.service';
import {
  authRequired, authUnavailable, HeaderBag, parseBearer, parseLoginBody, rejectSpoofHeaders,
} from './auth-http.contract';

// Bộ xử lý HTTP xác thực thuần (không decorator Nest => KHÔNG thể thành route nếu chưa có PR gắn module được duyệt).
// Phụ thuộc được tiêm qua constructor; không import vào module/AppModule nào. Không đọc query/cookie; không log.
// Mặc định từ chối: dùng với bộ lưu trữ chưa nối (UnwiredSessionStore) thì mọi thao tác ra lỗi chung.
export class AuthHttpHandler {
  constructor(private readonly logins: LoginSessionService, private readonly sessions: SessionService) {}

  async login(req: { body: unknown; headers?: HeaderBag }): Promise<{ token: string; expiresAt: string }> {
    rejectSpoofHeaders(req?.headers);
    const { login, password } = parseLoginBody(req?.body);
    const issued = await this.logins.login({ login, password }); // lỗi luôn là 401 LOGIN_INVALID chung
    return { token: issued.token, expiresAt: issued.expiresAt.toISOString() };
  }

  async logout(req: { headers?: HeaderBag }): Promise<{ ok: true }> {
    rejectSpoofHeaders(req?.headers);
    const token = parseBearer(req?.headers?.authorization);
    try {
      await this.sessions.revoke(token);
    } catch {
      throw authUnavailable(); // không báo thành công giả, không lộ nguyên nhân
    }
    return { ok: true };
  }

  async me(req: { headers?: HeaderBag }): Promise<{ employeeId: string }> {
    rejectSpoofHeaders(req?.headers);
    const token = parseBearer(req?.headers?.authorization);
    try {
      const { employeeId } = await this.sessions.validate(token);
      return { employeeId };
    } catch {
      throw authRequired(); // mọi lý do (hết hạn/thu hồi/lệch phiên bản/lỗi kho) cùng một 401, không lộ nguyên nhân
    }
  }
}
