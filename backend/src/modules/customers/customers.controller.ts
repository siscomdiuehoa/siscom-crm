import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Mọi route cần danh tính (ActorGuard). Cấu hình thật = DenyAll => 401 cho tới khi có đăng nhập (B1.3).
// B1.3 M1.3: mỗi route khai báo quyền cổng vào (AccessGuard, trước khi chạm DB) = đúng các quyền service bắt buộc; phạm vi bản ghi do service kiểm.
@Controller('customers')
@UseGuards(ActorGuard)
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @RequirePermissions('customer.read')
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryCustomersDto) {
    return { data: await this.service.list(ctx, q) };
  }

  @Get(':id')
  @RequirePermissions('customer.read')
  async get(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.get(ctx, id) };
  }

  @Post()
  @RequirePermissions('customer.create')
  async create(@CurrentCtx() ctx: RequestCtx, @Body() dto: CreateCustomerDto) {
    return { data: await this.service.create(ctx, dto) };
  }

  @Patch(':id')
  @RequirePermissions('customer.update', 'customer.read')
  async update(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateCustomerDto) {
    return { data: await this.service.update(ctx, id, dto) };
  }

  // KHOÁ (N2 = Y): sau xác thực/quyền/phạm vi luôn trả 409 DELETE_LINKS_UNVERIFIED. Không body, không tham số bỏ qua.
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('customer.delete', 'customer.read')
  async remove(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.remove(ctx, id) };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('customer.restore', 'customer.read')
  async restore(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.restore(ctx, id) };
  }
}
