import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { ACTOR_PROVIDER } from './actor';
import { ActorGuard } from './actor.guard';
import { AUTH_CONFIG, AuthConfig, authConfigFrom } from './auth.config';
import { CsrfOriginGuard } from './csrf-origin.guard';
import { SessionActorProvider } from './session/session-actor.provider';

// B1.3 MVP (Issue #8, 28/10/2026): danh tính lấy từ PHIÊN SERVER-SIDE (cookie HttpOnly -> auth_session) thay cho DenyAll.
// Không có cookie/phiên hợp lệ => ActorGuard trả 401 như trước (fail-closed). Chỉ test mới thay provider (overrideProvider).
// CsrfOriginGuard là guard toàn cục: mọi request ghi mang cookie phiên phải có Origin hợp lệ + X-CSRF-Token khớp phiên.
// AUTH_CONFIG: từ ConfigService (AppModule có ConfigModule toàn cục). Khi module được dựng KHÔNG có ConfigModule (bộ test dựng
// CustomersModule trực tiếp) thì dùng cấu hình an toàn mặc định: cookie Secure, allowlist Origin RỖNG (mọi Origin bị từ chối).
const SAFE_DEFAULT: AuthConfig = Object.freeze({
  cookieSecure: true, allowedOrigins: [], sessionIdleMinutes: 480, sessionAbsHours: 12,
  loginWindowMinutes: 15, loginMaxPerSource: 30, loginMaxPerIdentifier: 5, lockMinutes: 15, lockAfterFailures: 5,
});

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: AUTH_CONFIG,
      inject: [{ token: ConfigService, optional: true }],
      useFactory: (config?: ConfigService): AuthConfig => {
        if (config) return authConfigFrom(config);
        new Logger('Auth').warn('Không có ConfigService: dùng cấu hình xác thực mặc định an toàn (chỉ xảy ra trong kiểm thử).');
        return SAFE_DEFAULT;
      },
    },
    { provide: ACTOR_PROVIDER, useClass: SessionActorProvider },
    { provide: APP_GUARD, useClass: CsrfOriginGuard },
    ActorGuard,
  ],
  exports: [ACTOR_PROVIDER, AUTH_CONFIG, ActorGuard],
})
export class AuthModule {}
