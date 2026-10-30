import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ActorGuard } from '../../common/auth/actor.guard';
import { AUTH_CONFIG, AuthConfig } from '../../common/auth/auth.config';
import { AllowPasswordChangeRequired } from '../../common/auth/password-change-required.guard';
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
// Không nhận token qua query/header; danh tính chỉ từ cookie phiên (SessionActorProvider).
// Nguồn hạn mức / IP phiên: clientAddress(req) = req.ip theo TRUST_PROXY (B1.4 P1), không lấy thẳng địa chỉ socket.
// B1.4 P2: phiên có must_change_password = true chỉ được gọi me, logout, change-password (@AllowPasswordChangeRequired);
//   mọi route khác của hệ thống => 403 PASSWORD_CHANGE_REQUIRED (PasswordChangeRequiredGuard toàn cục). login KHÔNG được miễn: login bình
//   thường không mang cookie phiên nên guard cho qua; còn mang cookie của phiên phải đổi mật khẩu (kèm đúng CSRF) thì cũng bị 403.
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request & { requestId?: string }, @Res({ passthrough: true }) res: Response) {
    const addr = clientAddress(req);
    const r = await this.auth.login({
      login: dto.login, password: dto.password,
      source: addr.source, ip: addr.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null, requestId: req.requestId,
    });
    const co = { secure: this.cfg.cookieSecure, maxAgeSeconds: r.maxAgeSeconds };
    res.setHeader('Set-Cookie', [buildSessionCookie(r.sessionToken, co), buildCsrfCookie(r.csrfToken, co)]);
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
    await this.auth.logout(s, req.requestId);
    res.setHeader('Set-Cookie', [buildSessionCookieClear({ secure: this.cfg.cookieSecure }), buildCsrfCookieClear({ secure: this.cfg.cookieSecure })]);
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
    res.setHeader('Set-Cookie', [buildSessionCookie(r.sessionToken, co), buildCsrfCookie(r.csrfToken, co)]);
    res.setHeader('Cache-Control', 'no-store');
    return { data: { me: r.me, csrfToken: r.csrfToken } };
  }
}
