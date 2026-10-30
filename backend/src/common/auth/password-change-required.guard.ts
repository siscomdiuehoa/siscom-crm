import { CanActivate, CustomDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException } from '../errors/domain.exception';
import { ACTOR_PROVIDER, ActorProvider } from './actor';
import { SessionActorProvider, SessionRequest } from './session/session-actor.provider';

// B1.4 P2 (biên bản MVP Minor 6; thiết kế B1.3.1 §6, B1.3.3 §7): khi credential có must_change_password = true, phiên chỉ được
// gọi các route được đánh dấu @AllowPasswordChangeRequired() (/auth/me, /auth/change-password, /auth/logout, health); mọi route
// khác => 403 PASSWORD_CHANGE_REQUIRED. Guard toàn cục (APP_GUARD) chạy SAU CsrfOriginGuard và dùng lại phiên đã tra trong cùng
// request (req.authSession) => không thêm truy vấn. Không có cookie/phiên => cho qua (ActorGuard vẫn trả 401 ở route cần xác thực;
// route công khai như /health không đổi). Cờ đọc từ DB mỗi request (không cache ngoài request) => đổi mật khẩu xong là hết chặn.
export const ALLOW_PASSWORD_CHANGE_REQUIRED = 'auth:allowPasswordChangeRequired';
export const AllowPasswordChangeRequired = (): CustomDecorator<string> => SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED, true);
export const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED';

@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(ACTOR_PROVIDER) private readonly provider: ActorProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_PASSWORD_CHANGE_REQUIRED, [context.getHandler(), context.getClass()]);
    if (allowed === true) return true;
    const provider = this.provider;
    // Chỉ provider phiên thật mới có cờ credential; provider khác (chỉ trong test) không có khái niệm này.
    if (!(provider instanceof SessionActorProvider)) return true;
    const req = context.switchToHttp().getRequest<SessionRequest>();
    if (req.authSession === undefined) req.authSession = await provider.lookup(req.headers.cookie);
    const s = req.authSession;
    if (!s) return true;
    if (s.mustChangePassword) throw new DomainException(403, PASSWORD_CHANGE_REQUIRED_CODE, 'Bạn phải đổi mật khẩu trước khi tiếp tục.');
    return true;
  }
}
