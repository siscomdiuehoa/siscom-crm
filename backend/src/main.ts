import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  configureApp(app, config);
  const host = config.getOrThrow<string>('HOST');
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, host);
  new Logger('Bootstrap').log('SISCOM CRM backend đang chạy tại http://' + host + ':' + port + '/api/v1 (môi trường: ' + config.get<string>('NODE_ENV') + ')');
}

bootstrap().catch((err: unknown) => {
  // Chỉ in thông điệp cấu hình/khởi động, không in biến môi trường.
  const msg = err instanceof Error ? err.message : 'Lỗi khởi động không xác định';
  new Logger('Bootstrap').error('Không khởi động được backend: ' + msg);
  process.exit(1);
});
