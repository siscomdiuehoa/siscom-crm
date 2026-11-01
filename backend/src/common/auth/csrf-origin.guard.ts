import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DomainException } from '../errors/domain.exception';
import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { ACTOR_PROVIDER, ActorProvider } from './actor';
import { checkCsrfToken, checkOrigin } from './session/csrf-origin.policy';
import { SessionActorProvider, SessionRequest } from './session/session-actor.provider';
import { REMEMBER_RESTORE_HEADER } from './session/remember-token';
import { CSRF_HEADER, readSessionCookie } from './session/session-token';

// Guard toàn cục (APP_GUARD) chống CSRF cho xác thực bằng cookie. Với MỌI phương thức ghi (POST/PUT/PATCH/DELETE):
//   - có cookie phiên => bắt buộc Origin thuộc AUTH_ALLOWED_ORIGINS VÀ X-CSRF-Token khớp csrf_hash của phiên (so sánh hằng thời gian);
//   - không có cookie (vd. đăng nhập) => chỉ kiểm Origin NẾU trình duyệt gửi (bỏ qua khi thiếu: công cụ CLI/kiểm thử);
//   - route @LoginEndpoint có cookie nhưng phiên đã chết => như không có cookie (BUG-1).
// GET/HEAD/OPTIONS không bị kiểm (không đổi trạng thái). Sai => 403 CSRF_FAILED, không lộ lý do, không đổi phiên.
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Issue #177: route tái lập phiên từ token ghi nhớ. Chưa có phiên => không có CSRF-token phiên; thay bằng Origin BẮT BUỘC thuộc allowlist + header tuỳ biến
// X-Remember-Restore: 1 (trình duyệt buộc preflight CORS cho header này). Cookie phiên cũ/hết hạn còn sót không được chặn restore.
const ORIGIN_ONLY = 'siscom:origin-only';
export const OriginOnly = (): MethodDecorator => (_t, _k, d) => { Reflect.defineMetadata(ORIGIN_ONLY, true, d.value as object); };
// BUG-1 (B1.4): route đăng nhập bằng mật khẩu. Đăng nhập không dựa vào phiên cũ; cookie siscom_sid của phiên ĐÃ CHẾT (thu hồi, hết hạn phía
// server, DB khác) được coi như không có cookie (Origin kiểm nếu trình duyệt gửi) — trước đây trả 403 và người dùng kẹt tới khi cookie hết hạn.
// Phiên CÒN SỐNG giữ nguyên kiểm Origin + X-CSRF-Token như mọi request ghi có cookie.
const LOGIN_ENDPOINT = 'siscom:login-endpoint';
export const LoginEndpoint = (): MethodDecorator => (_t, _k, d) => { Reflect.defineMetadata(LOGIN_ENDPOINT, true, d.value as object); };
const csrfFailed = (): DomainException => new DomainException(403, 'CSRF_FAILED', 'Yêu cầu bị từ chối (kiểm tra nguồn gốc).');

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(@Inject(ACTOR_PROVIDER) private readonly provider: ActorProvider, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    if (!UNSAFE.has(req.method.toUpperCase())) return true;
    if (typeof context.getHandler === 'function' && Reflect.getMetadata(ORIGIN_ONLY, context.getHandler()) === true) {
      if (!checkOrigin(header(req, 'origin'), this.cfg.allowedOrigins).ok || header(req, REMEMBER_RESTORE_HEADER) !== '1') throw csrfFailed();
      return true;
    }
    const hasCookie = readSessionCookie(req.headers.cookie) !== null;
    const origin = header(req, 'origin');
    const noCookiePath = (): boolean => {
      if (origin !== undefined && !checkOrigin(origin, this.cfg.allowedOrigins).ok) throw csrfFailed();
      return true;
    };
    if (!hasCookie) return noCookiePath();
    // Chỉ provider phiên thật mới có csrf_hash; provider khác (test giả) => không có phiên cookie thật để bảo vệ => từ chối (fail-closed).
    const provider = this.provider;
    if (!(provider instanceof SessionActorProvider)) throw csrfFailed();
    if (typeof context.getHandler === 'function' && Reflect.getMetadata(LOGIN_ENDPOINT, context.getHandler()) === true) {
      if (req.authSession === undefined) req.authSession = await provider.lookup(req.headers.cookie);
      if (!req.authSession) return noCookiePath(); // BUG-1: phiên chết => như chưa có cookie
    }
    if (!checkOrigin(origin, this.cfg.allowedOrigins).ok) throw csrfFailed();
    if (req.authSession === undefined) req.authSession = await provider.lookup(req.headers.cookie);
    const s = req.authSession;
    if (!s) throw csrfFailed();
    if (!checkCsrfToken(header(req, CSRF_HEADER), s.csrfHash).ok) throw csrfFailed();
    return true;
  }
}

function header(req: Request, name: string): unknown {
  return req.headers[name];
}
