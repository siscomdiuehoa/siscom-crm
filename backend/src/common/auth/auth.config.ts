import { ConfigService } from '@nestjs/config';

// Cấu hình xác thực đã được env.validation kiểm tra. Gom vào một token DI để test tích hợp thay bằng giá trị cố định (không cần ConfigModule).
export interface AuthConfig {
  readonly cookieSecure: boolean;
  readonly allowedOrigins: readonly string[];
  readonly sessionIdleMinutes: number;
  readonly sessionAbsHours: number;
  readonly loginWindowMinutes: number;
  readonly loginMaxPerSource: number;
  readonly loginMaxPerIdentifier: number;
  readonly lockMinutes: number;
  readonly lockAfterFailures: number;
}
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export function authConfigFrom(config: ConfigService): AuthConfig {
  return {
    cookieSecure: config.getOrThrow<boolean>('COOKIE_SECURE'),
    allowedOrigins: config.getOrThrow<string[]>('AUTH_ALLOWED_ORIGIN_LIST'),
    sessionIdleMinutes: config.getOrThrow<number>('SESSION_IDLE_MINUTES'),
    sessionAbsHours: config.getOrThrow<number>('SESSION_ABS_HOURS'),
    loginWindowMinutes: config.getOrThrow<number>('LOGIN_WINDOW_MINUTES'),
    loginMaxPerSource: config.getOrThrow<number>('LOGIN_MAX_PER_SOURCE'),
    loginMaxPerIdentifier: config.getOrThrow<number>('LOGIN_MAX_PER_IDENTIFIER'),
    lockMinutes: config.getOrThrow<number>('LOGIN_LOCK_MINUTES'),
    lockAfterFailures: config.getOrThrow<number>('LOGIN_LOCK_AFTER_FAILURES'),
  };
}
