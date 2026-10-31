import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { pickAuthDbUrl } from '../config/auth-db-url';
import { PrismaClient } from '../generated/prisma/client';
import { DEFAULT_RETRY, enforceDbRoleAtStartup, fetchDbRoleFacts } from './db-role-check';
import { pgPoolConfig } from './pg-config';

// Prisma 7 bat buoc dung driver adapter. Khong goi $connect() luc khoi dong: backend van chay khi DB tam thoi tat,
// ket noi duoc tao khi co truy van dau tien. Moi phien chay TimeZone=UTC (D.0, xem pg-config.ts).
// B1.4 P3b (M-d): sau khi module khoi tao, kiem role dang dung; production + chay bang chu so huu/migrator/superuser => tu choi khoi dong.
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);
  private stopped = false; // dang tat => bo lan kiem role da hen (khong mo lai pool)
  // B1.4 P3c: da tach pool auth (AUTH_DATABASE_URL) => pool nay KHONG duoc con quyen xac thuc (APP_GRANTS_V3).
  private readonly dbUrl: string;

  // Constructor chi dung getOrThrow('DATABASE_URL'): test helper va CLI (seed-lookups, bootstrap-auth) truyen doi tuong toi gian.
  constructor(config: ConfigService) {
    const adapter = new PrismaPg(pgPoolConfig(config.getOrThrow<string>('DATABASE_URL')));
    super({ adapter });
    this.dbUrl = config.getOrThrow<string>('DATABASE_URL');
  }

  // NODE_ENV doc tu process.env (nhu health.service.ts); env.validation chi chap nhan development | production | test.
  async onApplicationBootstrap(): Promise<void> {
    // P3c: AUTH_DATABASE_URL doc tu process.env (constructor chi dung getOrThrow - test helper/CLI); production thieu => pickAuthDbUrl nem => tu choi khoi dong.
    const authSeparate = pickAuthDbUrl({ DATABASE_URL: this.dbUrl, AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL }, process.env.NODE_ENV).separate;
    await enforceDbRoleAtStartup(() => fetchDbRoleFacts(this), process.env.NODE_ENV, { warn: (m) => this.log.warn(m), error: (m) => this.log.error(m) },
      { ...DEFAULT_RETRY, isStopped: () => this.stopped }, { pool: 'app', authSeparate });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.$disconnect();
    this.log.log('Đã đóng kết nối cơ sở dữ liệu');
  }
}
