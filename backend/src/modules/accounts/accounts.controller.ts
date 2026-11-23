import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { AccountsReadService } from './accounts.read.service';
import { AccountsWriteService } from './accounts.write.service';
import { QueryAccountsDto } from './dto/query-accounts.dto';
import { ChangeRoleDto, CreateAccountDto, DisableAccountDto, TempPasswordDto, UpdateAccountDto } from './dto/write-account.dto';

// P1 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.5) — quản lý tài khoản cho Quản trị CRM. Mọi route cần đăng nhập (ActorGuard) + access.approve
// (kiểm trong service). CSRF/Origin là guard toàn cục như các module khác.
// Route TĨNH (roles, departments) PHẢI khai báo trước mọi route `:id` — ghim trong accounts.static-guards.spec.ts.
// Mọi thao tác ghi trả về dòng tài khoản SAU thao tác (không bao giờ kèm mật khẩu).
@Controller('accounts')
@UseGuards(ActorGuard)
export class AccountsController {
  constructor(private readonly reads: AccountsReadService, private readonly writes: AccountsWriteService) {}

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

  @Post()
  async create(@CurrentCtx() ctx: RequestCtx, @Body() dto: CreateAccountDto) {
    return { data: await this.writes.create(ctx, dto) };
  }

  @Patch(':id')
  async update(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateAccountDto) {
    return { data: await this.writes.update(ctx, id, dto) };
  }

  @Post(':id/role')
  @HttpCode(200)
  async changeRole(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ChangeRoleDto) {
    return { data: await this.writes.changeRole(ctx, id, dto) };
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: TempPasswordDto) {
    return { data: await this.writes.resetPassword(ctx, id, dto) };
  }

  @Post(':id/disable')
  @HttpCode(200)
  async disable(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DisableAccountDto) {
    return { data: await this.writes.disable(ctx, id, dto) };
  }

  @Post(':id/enable')
  @HttpCode(200)
  async enable(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: TempPasswordDto) {
    return { data: await this.writes.enable(ctx, id, dto) };
  }
}
