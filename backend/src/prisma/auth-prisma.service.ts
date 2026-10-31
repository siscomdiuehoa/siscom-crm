import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { pickAuthDbUrl } from '../config/auth-db-url';
import { PrismaClient } from '../generated/prisma/client';
import { DEFAULT_RETRY, enforceDbRoleAtStartup, fetchDbRoleFacts } from './db-role-check';
import { pgPoolConfig } from './pg-config';

// B1.4 P3c: POOL XAC THUC rieng (role siscom_auth, AUTH_DATABASE_URL) cho dang nhap / phien / doi mat khau / me. Pool nghiep vu
// (PrismaService, siscom_app) sau APP_GRANTS_V3 khong con doc hash, tao phien hay goi ham doi mat khau => dong S3.
// Khong co AUTH_DATABASE_URL (development/test, may Windows chua tach): dung lai DATABASE_URL (separate=false) - production thi tu choi.
// Khong goi $connect() luc khoi dong (nhu PrismaService); moi phien TimeZone=UTC (D.0).
@Injectable()
export class AuthPrismaService extends PrismaClient implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(AuthPrismaService.name);
  private stopped = false;
  readonly separate: boolean;

  // Constructor chi dung get('DATABASE_URL'/'AUTH_DATABASE_URL'/'NODE_ENV') qua getOrThrow/get: test truyen doi tuong toi gian.
  constructor(config: ConfigService) {
    const env = { DATABASE_URL: config.getOrThrow<string>('DATABASE_URL'), AUTH_DATABASE_URL: config.get<string>('AUTH_DATABASE_URL') };
    const picked = pickAuthDbUrl(env, config.get<string>('NODE_ENV') ?? process.env.NODE_ENV);
    super({ adapter: new PrismaPg(pgPoolConfig(picked.url)) });
    this.separate = picked.separate;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.separate) {
      this.log.warn('Khong co AUTH_DATABASE_URL: pool xac thuc dung chung DATABASE_URL (chua dong S3). Chi chap nhan ngoai production.');
      return; // pool app da tu kiem role (PrismaService)
    }
    await enforceDbRoleAtStartup(() => fetchDbRoleFacts(this), process.env.NODE_ENV, { warn: (m) => this.log.warn(m), error: (m) => this.log.error(m) },
      { ...DEFAULT_RETRY, isStopped: () => this.stopped }, { pool: 'auth', authSeparate: true });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.$disconnect();
  }
}
