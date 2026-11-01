import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ActorGuard } from '../../common/auth/actor.guard';
import { AUTH_CONFIG, AuthConfig } from '../../common/auth/auth.config';
import { LoginEndpoint, OriginOnly } from '../../common/auth/csrf-origin.guard';
import { AllowPasswordChangeRequired } from '../../common/auth/password-change-required.guard';
import { buildRememberCookie, buildRememberCookieClear, readRememberCookie } from '../../common/auth/session/remember-token';
import type { SessionRequest } from '../../common/auth/session/session-actor.provider';
import { buildCsrfCookie, buildCsrfCookieClear, buildSessionCookie, buildSessionCookieClear } from '../../common/auth/session/session-token';
import { DomainException } from '../../common/errors/domain.exception';
import { clientAddress } from '../../common/middleware/client-address';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

// Hợp đồng HTTP (B1.3 MVP, session cookie):
//   POST /auth/login  {login,password} -> 200 {data:{me, csrfToken}} + Set-Cookie siscom_sid (HttpOnly; SameSite=Lax; Path=/api/v1)
//                                         | 400 VALIDATION_FAILED | 401 LOGIN_INVALID | 429 LOGIN_THROTTLED
//   GET  /auth/me     (cookie)         -> 200 {data:{me, csrfToken: null}} | 401 UNAUTHENTICATED
//   POST /auth/logout (cookie + Origin + X-CSRF-Token) -> 200 {data:{ok:true}} + cookie xoá | 401 | 403 CSRF_FAILED
//   POST /auth/change-password (cookie + Origin + X-CSRF-Token) {currentPassword,newPassword,confirmPassword}
//        -> 200 {data:{me, csrfToken}} + Set-Cookie PHIÊN MỚI (mọi phiên cũ bị thu hồi) | 400 VALIDATION_FAILED | 400 PASSWORD_CURRENT_INVALID
//        | 401 | 403 CSRF_FAILED | 429 PASSWORD_CHANGE_THROTTLED (B1.3.3 PR 8, D16)
// B1.4 Remember Me 90 ngày (Issue #177, docs/B1.4_REMEMBER_ME_90D_DESIGN.md) - cộng thêm, hợp đồng cũ không đổi:
//   POST /auth/login {login,password,remember?} : remember=true => thêm Set-Cookie siscom_rmb (HttpOnly; SameSite=Lax; Path=/api/v1/auth; Secure theo
//        COOKIE_SECURE; Max-Age <= 90 ngày từ lần nhập mật khẩu). Không tích + thiết bị còn cookie cũ => thu hồi chuỗi cũ, xoá cookie.
//   POST /auth/remember/restore (cookie siscom_rmb + Origin allowlist BẮT BUỘC + X-Remember-Restore: 1) -> 200 {data:{me, csrfToken}} + phiên THƯỜNG
//        mới + siscom_rmb đã xoay vòng | 401 REMEMBER_INVALID (+xoá cookie) | 401 REMEMBER_RACE (giữ cookie) | 403 CSRF_FAILED | 429 REMEMBER_THROTTLED
//   GET /auth/remember/devices (phiên) | DELETE /auth/remember/devices/:id (phiên + CSRF; 404 nếu không phải của mình)
//   POST /auth/remember/revoke-all (phiên + CSRF). logout / change-password: thu hồi (logout: thiết bị này; đổi mật khẩu: mọi thiết bị do trigger
//   token_version ở DB) và xoá cookie siscom_rmb.
// Không nhận token qua query/header; danh tính chỉ từ cookie phiên (SessionActorProvider) hoặc cookie ghi nhớ ở route restore.
// Nguồn hạn mức / IP phiên: clientAddress(req) = req.ip theo TRUST_PROXY (B1.4 P1), không lấy thẳng địa chỉ socket.
// B1.4 P2: phiên có must_change_password = true chỉ được gọi me, logout, change-password (@AllowPasswordChangeRequired);
//   mọi route khác của hệ thống => 403 PASSWORD_CHANGE_REQUIRED (PasswordChangeRequiredGuard toàn cục). login KHÔNG được miễn: login bình
//   thường không mang cookie phiên nên guard cho qua; còn mang cookie của phiên phải đổi mật khẩu (kèm đúng CSRF) thì cũng bị 403.
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {}

  @Post('login')
  @HttpCode(200)
  @LoginEndpoint() // BUG-1: cookie phiên đã chết không chặn đăng nhập lại (phiên còn sống vẫn cần X-CSRF-Token)
  async login(@Body() dto: LoginDto, @Req() req: Request & { requestId?: string }, @Res({ passthrough: true }) res: Response) {
    const addr = clientAddress(req);
    const previous = readRememberCookie(req.headers.cookie);
    const r = await this.auth.login({
      login: dto.login, password: dto.password,
      source: addr.source, ip: addr.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null, requestId: req.requestId,
      remember: dto.remember === true, previousRememberToken: previous,
    });
    const co = { secure: this.cfg.cookieSecure, maxAgeSeconds: r.maxAgeSeconds };
    const cookies = [buildSessionCookie(r.sessionToken, co), buildCsrfCookie(r.csrfToken, co)];
    if (r.remember) cookies.push(buildRememberCookie(r.remember.token, { secure: this.cfg.cookieSecure, maxAgeSeconds: r.remember.maxAgeSeconds }));
    else if (previous !== null || hasRememberCookieName(req.headers.cookie)) cookies.push(buildRememberCookieClear({ secure: this.cfg.cookieSecure }));
    res.setHeader('Set-Cookie', cookies);
    res.setHeader('Cache-Control', 'no-store');
    return { data: { me: r.me, csrfToken: r.csrfToken } };
  }

  @Get('me')
  @AllowPasswordChangeRequired()
  @UseGuards(ActorGuard)
  async me(@Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { data: { me: await this.auth.me(req.authSession ?? null), csrfToken: null } };
  }

  @Post('logout')
  @HttpCode(200)
  @AllowPasswordChangeRequired()
  @UseGuards(ActorGuard)
  async logout(@Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.authSession;
    if (!s) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    await this.auth.logout(s, req.requestId, readRememberCookie(req.headers.cookie));
    res.setHeader('Set-Cookie', [buildSessionCookieClear({ secure: this.cfg.cookieSecure }), buildCsrfCookieClear({ secure: this.cfg.cookieSecure }),
      buildRememberCookieClear({ secure: this.cfg.cookieSecure })]);
    res.setHeader('Cache-Control', 'no-store');
    return { data: { ok: true } };
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowPasswordChangeRequired()
  @UseGuards(ActorGuard)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.authSession;
    if (!s) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    const addr = clientAddress(req);
    const r = await this.auth.changePassword(s, {
      currentPassword: dto.currentPassword, newPassword: dto.newPassword, confirmPassword: dto.confirmPassword,
      source: addr.source, ip: addr.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null, requestId: req.requestId,
    });
    const co = { secure: this.cfg.cookieSecure, maxAgeSeconds: r.maxAgeSeconds };
    // Đổi mật khẩu tăng token_version => trigger DB thu hồi MỌI thiết bị ghi nhớ; xoá cookie ở thiết bị này (không tự cấp lại).
    res.setHeader('Set-Cookie', [buildSessionCookie(r.sessionToken, co), buildCsrfCookie(r.csrfToken, co), buildRememberCookieClear({ secure: this.cfg.cookieSecure })]);
    res.setHeader('Cache-Control', 'no-store');
    return { data: { me: r.me, csrfToken: r.csrfToken } };
  }

  // Tái lập phiên THƯỜNG từ cookie ghi nhớ. Chưa có phiên => không có CSRF-token phiên: @OriginOnly (Origin allowlist bắt buộc + X-Remember-Restore: 1).
  // KHÔNG miễn PASSWORD_CHANGE_REQUIRED (danh sách miễn trừ P2 giữ nguyên): phiên còn hiệu lực mà bị buộc đổi mật khẩu => 403 như route khác;
  // cookie phiên hết hạn/thu hồi không chặn. Restore tự từ chối tài khoản bị buộc đổi mật khẩu (login không cấp token khi must_change_password).
  @Post('remember/restore')
  @HttpCode(200)
  @OriginOnly()
  async restore(@Req() req: Request & { requestId?: string }, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const addr = clientAddress(req);
    const out = await this.auth.restoreRemembered({
      token: readRememberCookie(req.headers.cookie), source: addr.source, ip: addr.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null, requestId: req.requestId,
    });
    if (out.kind === 'RACE') throw new DomainException(401, 'REMEMBER_RACE', 'Phiên đang được khôi phục ở yêu cầu khác.');
    if (out.kind !== 'OK') {
      if (out.kind === 'INVALID' || hasRememberCookieName(req.headers.cookie)) res.setHeader('Set-Cookie', [buildRememberCookieClear({ secure: this.cfg.cookieSecure })]);
      throw new DomainException(401, 'REMEMBER_INVALID', 'Cần đăng nhập lại.');
    }
    const co = { secure: this.cfg.cookieSecure, maxAgeSeconds: out.maxAgeSeconds };
    res.setHeader('Set-Cookie', [buildSessionCookie(out.sessionToken, co), buildCsrfCookie(out.csrfToken, co),
      buildRememberCookie(out.remember.token, { secure: this.cfg.cookieSecure, maxAgeSeconds: out.remember.maxAgeSeconds })]);
    return { data: { me: out.me, csrfToken: out.csrfToken } };
  }

  @Get('remember/devices')
  @UseGuards(ActorGuard)
  async devices(@Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.authSession;
    if (!s) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    res.setHeader('Cache-Control', 'no-store');
    return { data: await this.auth.listRememberDevices(s, readRememberCookie(req.headers.cookie)) };
  }

  @Delete('remember/devices/:id')
  @HttpCode(200)
  @UseGuards(ActorGuard)
  async revokeDevice(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.authSession;
    if (!s) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    res.setHeader('Cache-Control', 'no-store');
    if (!(await this.auth.revokeRememberDevice(s, id, req.requestId))) throw new DomainException(404, 'NOT_FOUND', 'Không tìm thấy thiết bị.');
    return { data: { ok: true } };
  }

  @Post('remember/revoke-all')
  @HttpCode(200)
  @UseGuards(ActorGuard)
  async revokeAll(@Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.authSession;
    if (!s) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    const n = await this.auth.revokeAllRememberDevices(s, req.requestId);
    res.setHeader('Set-Cookie', [buildRememberCookieClear({ secure: this.cfg.cookieSecure })]);
    res.setHeader('Cache-Control', 'no-store');
    return { data: { revoked: n } };
  }
}

// Có cookie tên siscom_rmb (kể cả sai định dạng/trùng) => nên xoá ở trình duyệt.
function hasRememberCookieName(cookieHeader: unknown): boolean {
  return typeof cookieHeader === 'string' && cookieHeader.split(';').some((p) => p.split('=')[0]?.trim() === 'siscom_rmb');
}
