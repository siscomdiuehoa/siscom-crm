import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ActorGuard } from '../../common/auth/actor.guard';
import { AUTH_CONFIG, AuthConfig } from '../../common/auth/auth.config';
import type { SessionRequest } from '../../common/auth/session/session-actor.provider';
import { buildCsrfCookie, buildCsrfCookieClear, buildSessionCookie, buildSessionCookieClear } from '../../common/auth/session/session-token';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

// Hợp đồng HTTP (B1.3 MVP, session cookie):
//   POST /auth/login  {login,password} -> 200 {data:{me, csrfToken}} + Set-Cookie siscom_sid (HttpOnly; SameSite=Lax; Path=/api/v1)
//                                         | 400 VALIDATION_FAILED | 401 LOGIN_INVALID | 429 LOGIN_THROTTLED
//   GET  /auth/me     (cookie)         -> 200 {data:{me, csrfToken: null}} | 401 UNAUTHENTICATED
//   POST /auth/logout (cookie + Origin + X-CSRF-Token) -> 200 {data:{ok:true}} + cookie xoá | 401 | 403 CSRF_FAILED
// Không nhận token qua query/header; danh tính chỉ từ cookie phiên (SessionActorProvider).
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request & { requestId?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login({
      login: dto.login, password: dto.password,
      source: req.socket?.remoteAddress ?? 'unknown', ip: req.socket?.remoteAddress ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null, requestId: req.requestId,
    });
    const co = { secure: this.cfg.cookieSecure, maxAgeSeconds: r.maxAgeSeconds };
    res.setHeader('Set-Cookie', [buildSessionCookie(r.sessionToken, co), buildCsrfCookie(r.csrfToken, co)]);
    res.setHeader('Cache-Control', 'no-store');
    return { data: { me: r.me, csrfToken: r.csrfToken } };
  }

  @Get('me')
  @UseGuards(ActorGuard)
  async me(@Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { data: { me: await this.auth.me(req.authSession ?? null), csrfToken: null } };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(ActorGuard)
  async logout(@Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.authSession;
    if (!s) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    await this.auth.logout(s, req.requestId);
    res.setHeader('Set-Cookie', [buildSessionCookieClear({ secure: this.cfg.cookieSecure }), buildCsrfCookieClear({ secure: this.cfg.cookieSecure })]);
    res.setHeader('Cache-Control', 'no-store');
    return { data: { ok: true } };
  }
}
