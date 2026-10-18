import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestContext } from './common/middleware/request-context.middleware';

// Dung chung cho main.ts va kiem thu e2e de hai noi cau hinh giong nhau.
export function configureApp(app: INestApplication, config: ConfigService): void {
  app.useLogger(config.getOrThrow<Array<'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal'>>('LOG_LEVELS'));
  app.setGlobalPrefix('api/v1');
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
}
