import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AcctPrismaService } from '../../prisma/acct-prisma.service';
import { AccountsController } from './accounts.controller';
import { AccountsReadService } from './accounts.read.service';
import { ACCOUNTS_WRITE_LIMITER, AccountsWriteService, createAccountsWriteLimiter } from './accounts.write.service';

// P1: quản lý tài khoản (docs/P1_ACCOUNT_ADMIN_DESIGN.md). AuthModule cấp ACTOR_PROVIDER + ActorGuard.
// AcctPrismaService (pool siscom_acct, tuỳ chọn) là provider của RIÊNG module này — không nằm trong PrismaModule toàn cục: chỉ module accounts
// được dùng pool có quyền gọi hàm đặc quyền, và các module / bộ test khác không phải biết tới nó.
@Module({
  imports: [AuthModule],
  controllers: [AccountsController],
  providers: [AcctPrismaService, AccountsReadService, AccountsWriteService, { provide: ACCOUNTS_WRITE_LIMITER, useFactory: createAccountsWriteLimiter }],
})
export class AccountsModule {}
