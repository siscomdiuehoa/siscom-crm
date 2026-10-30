import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestContext } from './common/middleware/request-context.middleware';

// Gia tri TRUST_PROXY da duoc env.validation kiem tra: false | 'loopback' | 1..5 (khong bao gio la true).
export type TrustProxySetting = false | 'loopback' | number;

// B1.4 P1: ap dung 'trust proxy' cho Express de req.ip la dia chi khach that sau reverse proxy (nginx cung may => 'loopback').
// false => Express bo qua X-Forwarded-For hoan toan (mac dinh an toan khi khong co proxy). Dung chung cho main.ts va test.
export function applyTrustProxy(app: INestApplication, setting: TrustProxySetting): void {
  if (setting === false) return;
  (app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void }).set('trust proxy', setting);
}

// Dung chung cho main.ts va kiem thu e2e de hai noi cau hinh giong nhau.
export function configureApp(app: INestApplication, config: ConfigService): void {
  app.useLogger(config.getOrThrow<Array<'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal'>>('LOG_LEVELS'));
  app.setGlobalPrefix('api/v1');
  const trustProxy = config.getOrThrow<TrustProxySetting>('TRUST_PROXY');
  applyTrustProxy(app, trustProxy);
  app.use(helmet());
  app.use(requestContext);
  const origins = config.getOrThrow<string[]>('CORS_ORIGIN_LIST');
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  new Logger('Config').log('CORS cho phép: ' + origins.join(', '));
  new Logger('Config').log('TRUST_PROXY: ' + String(trustProxy));
}
