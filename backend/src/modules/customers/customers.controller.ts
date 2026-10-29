import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Mọi route cần danh tính (ActorGuard). Cấu hình thật = DenyAll => 401 cho tới khi có đăng nhập (B1.3).
@Controller('customers')
@UseGuards(ActorGuard)
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryCustomersDto) {
    return { data: await this.service.list(ctx, q) };
  }

  // PR 7 (D15): ứng viên chủ sở hữu cho ô "Nhân viên phụ trách" — theo phạm vi customer.create/update, KHÔNG cần employee.read.
  // Khai báo TRƯỚC ':id' để không bị ParseUUIDPipe của route ':id' bắt.
  @Get('owner-candidates')
  async ownerCandidates(@CurrentCtx() ctx: RequestCtx) {
    return { data: await this.service.ownerCandidates(ctx) };
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.get(ctx, id) };
  }

  @Post()
  async create(@CurrentCtx() ctx: RequestCtx, @Body() dto: CreateCustomerDto) {
    return { data: await this.service.create(ctx, dto) };
  }

  @Patch(':id')
  async update(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateCustomerDto) {
    return { data: await this.service.update(ctx, id, dto) };
  }

  // KHOÁ (N2 = Y): sau xác thực/quyền/phạm vi luôn trả 409 DELETE_LINKS_UNVERIFIED. Không body, không tham số bỏ qua.
  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.remove(ctx, id) };
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.restore(ctx, id) };
  }
}
