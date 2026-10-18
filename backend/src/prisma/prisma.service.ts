import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Prisma 7 bat buoc dung driver adapter. Khong goi $connect() luc khoi dong: backend van chay khi DB tam thoi tat,
// ket noi duoc tao khi co truy van dau tien.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: 10,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30000,
    });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.log.log('Đã đóng kết nối cơ sở dữ liệu');
  }
}
