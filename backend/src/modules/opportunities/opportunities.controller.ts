import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { QueryOpportunitiesDto } from './dto/query-opportunities.dto';
import {
  AssignOpportunityDto, CreateOpportunityDto, DeleteOpportunityDto, HoldOpportunityDto, LoseOpportunityDto, MoveStageDto, ReopenOpportunityDto, RestoreOpportunityDto,
  ResumeOpportunityDto, UpdateOpportunityDto, WinOpportunityDto,
} from './dto/write-opportunity.dto';
import { OpportunityLifecycleService } from './opportunities.lifecycle.service';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityWritesService } from './opportunities.write.service';

// Sales S6 (đọc) + S7 (tạo, sửa, đổi giai đoạn, lịch sử) — docs/SALES_DESIGN.md §7. Tập route ghim trong opportunities.static-guards.spec.ts.
// S8a: chuyển người phụ trách, xoá mềm, khôi phục. Tạm hoãn / Tiếp tục / Thắng / Thua / mở lại + việc tự tạo thuộc S8b. CSRF/Origin là guard toàn cục như các module khác.
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
  constructor(private readonly service: OpportunitiesService, private readonly writes: OpportunityWritesService, private readonly lifecycle: OpportunityLifecycleService) {}

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

  @Post(':id/assign')
  async assign(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AssignOpportunityDto) {
    return { data: await this.writes.assign(ctx, id, dto) };
  }

  @Post(':id/restore')
  async restore(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RestoreOpportunityDto) {
    return { data: await this.writes.restore(ctx, id, dto) };
  }

  // S8b — vòng đời trạng thái (§6.4–6.7). Trả 200 kèm chi tiết cơ hội sau thao tác.
  @Post(':id/hold')
  @HttpCode(200)
  async hold(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: HoldOpportunityDto) {
    return { data: await this.lifecycle.hold(ctx, id, dto) };
  }

  @Post(':id/resume')
  @HttpCode(200)
  async resume(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ResumeOpportunityDto) {
    return { data: await this.lifecycle.resume(ctx, id, dto) };
  }

  @Post(':id/win')
  @HttpCode(200)
  async win(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: WinOpportunityDto) {
    return { data: await this.lifecycle.win(ctx, id, dto) };
  }

  @Post(':id/lose')
  @HttpCode(200)
  async lose(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: LoseOpportunityDto) {
    return { data: await this.lifecycle.lose(ctx, id, dto) };
  }

  @Post(':id/reopen')
  @HttpCode(200)
  async reopen(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReopenOpportunityDto) {
    return { data: await this.lifecycle.reopen(ctx, id, dto) };
  }

  // Xoá mềm: lý do + version ở body (như DELETE /activities/:id).
  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DeleteOpportunityDto) {
    return { data: await this.writes.remove(ctx, id, dto) };
  }
}
