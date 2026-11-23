import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { pickAcctDbUrl } from '../config/acct-db-url';
import { PrismaClient } from '../generated/prisma/client';
import { accountErrors } from '../modules/accounts/accounts.errors';
import { DEFAULT_RETRY, enforceDbRoleAtStartup, fetchDbRoleFacts } from './db-role-check';
import { pgPoolConfig } from './pg-config';

// P1: POOL QUAN LY TAI KHOAN rieng (role siscom_acct, ACCT_DATABASE_URL) - CHI module accounts dung. Pool nghiep vu (siscom_app) va pool xac thuc
// (siscom_auth) van khong goi duoc ham dac quyen nao; role nay chi doc 4 bang + 5 cot trang thai credential va goi dung 12 ham (B1.5_ACCT_GRANTS).
// KHAC hai pool kia: TUY CHON. Thieu ACCT_DATABASE_URL => available = false, client() nem 503 ACCOUNT_ADMIN_UNAVAILABLE, phan con lai cua ung
// dung chay binh thuong (chua bat P1 tren may chu). URL dat sai => constructor nem loi (tu choi khoi dong, fail-closed).
// Kiem dac quyen luc khoi dong KHONG DAT (role chua duoc cap quyen vi bat do dang, thua quyen, khong noi duoc) => KHONG lam ca ung dung tu choi
// khoi dong: tat RIENG pool nay (available = false, 503) + ghi dong LOI. Khong dung pool = khong co rui ro tu quyen thua cua no.
// Khong goi $connect() luc khoi dong; moi phien TimeZone=UTC (pgPoolConfig).
@Injectable()
export class AcctPrismaService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(AcctPrismaService.name);
  private readonly db: PrismaClient | null;
  private stopped = false;
  private usable: boolean;
  // true = pool da cau hinh VA (sau khi khoi dong) da qua kiem dac quyen.
  get available(): boolean { return this.usable; }

  constructor(config: ConfigService) {
    const url = pickAcctDbUrl({
      DATABASE_URL: config.getOrThrow<string>('DATABASE_URL'),
      AUTH_DATABASE_URL: config.get<string>('AUTH_DATABASE_URL'),
      ACCT_DATABASE_URL: config.get<string>('ACCT_DATABASE_URL'),
    });
    this.db = url === null ? null : new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(url, 'ACCT_DATABASE_URL')) });
    this.usable = this.db !== null;
  }

  // Ket noi cua pool quan ly tai khoan. Chua bat => 503 (khong phai 500): giao dien hien "chuc nang chua duoc bat".
  client(): PrismaClient {
    if (this.db === null || !this.usable) throw accountErrors.unavailable();
    return this.db;
  }

  async onApplicationBootstrap(): Promise<void> {
    const db = this.db;
    if (db === null) {
      this.log.warn('Khong co ACCT_DATABASE_URL: chuc nang quan ly tai khoan (P1) chua bat; API /accounts tra 503.');
      return;
    }
    try {
      await enforceDbRoleAtStartup(() => fetchDbRoleFacts(db), process.env.NODE_ENV, { warn: (m) => this.log.warn(m), error: (m) => this.log.error(m) },
        { ...DEFAULT_RETRY, isStopped: () => this.stopped }, { pool: 'acct', authSeparate: true });
    } catch (e) {
      this.usable = false;
      this.log.error('Pool quan ly tai khoan (ACCT_DATABASE_URL) KHONG qua kiem dac quyen: TAT chuc nang quan ly tai khoan, API /accounts tra 503. '
        + 'Phan con lai cua ung dung van chay. Chay create-db.sh <db> grants roi khoi dong lai. Ly do: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.db !== null) await this.db.$disconnect();
  }
}
