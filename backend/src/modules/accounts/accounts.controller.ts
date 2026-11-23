import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { AccountsReadService } from './accounts.read.service';
import { QueryAccountsDto } from './dto/query-accounts.dto';

// P1 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.5) — quản lý tài khoản cho Quản trị CRM. Mọi route cần đăng nhập (ActorGuard) + access.approve
// (kiểm trong service). CSRF/Origin là guard toàn cục như các module khác.
// Route TĨNH (roles, departments) PHẢI khai báo trước mọi route `:id` — ghim trong accounts.static-guards.spec.ts.
@Controller('accounts')
@UseGuards(ActorGuard)
export class AccountsController {
  constructor(private readonly reads: AccountsReadService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryAccountsDto) {
    return { data: await this.reads.list(ctx, q) };
  }

  @Get('roles')
  async roles(@CurrentCtx() ctx: RequestCtx) {
    return { data: await this.reads.roles(ctx) };
  }

  @Get('departments')
  async departments(@CurrentCtx() ctx: RequestCtx) {
    return { data: await this.reads.departments(ctx) };
  }
}
