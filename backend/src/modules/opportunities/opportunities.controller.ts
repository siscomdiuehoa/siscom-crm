import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { QueryOpportunitiesDto } from './dto/query-opportunities.dto';
import { CreateOpportunityDto, MoveStageDto, UpdateOpportunityDto } from './dto/write-opportunity.dto';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityWritesService } from './opportunities.write.service';

// Sales S6 (đọc) + S7 (tạo, sửa, đổi giai đoạn, lịch sử) — docs/SALES_DESIGN.md §7. Tập route ghim trong opportunities.static-guards.spec.ts.
// Tạm hoãn / Thắng / Thua / chuyển người / mở lại / xoá mềm thuộc S8. CSRF/Origin là guard toàn cục như các module khác.
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
  constructor(private readonly service: OpportunitiesService, private readonly writes: OpportunityWritesService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryOpportunitiesDto) {
    return { data: await this.service.list(ctx, q) };
  }

  @Post()
  async create(@CurrentCtx() ctx: RequestCtx, @Body() dto: CreateOpportunityDto) {
    return { data: await this.writes.create(ctx, dto) };
  }

  @Get(':id')
  async detail(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.detail(ctx, id) };
  }

  @Patch(':id')
  async update(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateOpportunityDto) {
    return { data: await this.writes.update(ctx, id, dto) };
  }

  @Get(':id/changes')
  async changes(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.changes(ctx, id) };
  }

  @Post(':id/stage')
  async moveStage(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MoveStageDto) {
    return { data: await this.writes.moveStage(ctx, id, dto) };
  }
}
