import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { QueryOpportunitiesDto } from './dto/query-opportunities.dto';
import { OpportunitiesService } from './opportunities.service';

// Sales S6 — CHỈ ĐỌC (docs/SALES_DESIGN.md §7). Tập route ghim trong opportunities.static-guards.spec.ts; route ghi thuộc S7/S8.
@Controller('customers/:customerId/opportunities')
@UseGuards(ActorGuard)
export class CustomerOpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string, @Query() q: QueryOpportunitiesDto) {
    return { data: await this.service.listByCustomer(ctx, customerId, q) };
  }
}

@Controller('opportunities')
@UseGuards(ActorGuard)
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryOpportunitiesDto) {
    return { data: await this.service.list(ctx, q) };
  }

  @Get(':id')
  async detail(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.detail(ctx, id) };
  }
}
