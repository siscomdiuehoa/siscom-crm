import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { ActivitiesService } from './activities.service';
import { ActivityTasksService } from './activities.tasks.service';
import { ActivityTransfersService } from './activities.transfers.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { QueryAssigneeCandidatesDto, QueryTimelineDto } from './dto/query-activities.dto';
import {
  AssignActivityDto, CompleteActivityDto, CreateTransferRequestDto, DecideTransferDto, DeleteActivityDto, QueryTasksDto, QueryTransferBoxDto, RevokeAccessDto,
  UpdateActivityDto, VersionDto,
} from './dto/task-actions.dto';

// Timeline + tạo hoạt động theo khách (thiết kế §6). CSRF/Origin là guard toàn cục như các module khác.
@Controller('customers/:customerId/activities')
@UseGuards(ActorGuard)
export class CustomerActivitiesController {
  constructor(private readonly service: ActivitiesService) {}

  @Get()
  async timeline(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string, @Query() q: QueryTimelineDto) {
    return { data: await this.service.timeline(ctx, customerId, q) };
  }

  @Post()
  async create(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string, @Body() dto: CreateActivityDto) {
    return { data: await this.service.create(ctx, customerId, dto) };
  }
}

// /activities. THỨ TỰ: các đường tĩnh ('assignee-candidates', 'reminders/summary') khai báo TRƯỚC ':id' (static-guards.spec ghim thứ tự).
@Controller('activities')
@UseGuards(ActorGuard)
export class ActivitiesController {
  constructor(private readonly service: ActivitiesService, private readonly tasks: ActivityTasksService, private readonly transfers: ActivityTransfersService) {}

  @Get('assignee-candidates')
  async assigneeCandidates(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryAssigneeCandidatesDto) {
    return { data: await this.service.assigneeCandidates(ctx, q.customerId, q.external === 'true') };
  }

  @Get('reminders/summary')
  async summary(@CurrentCtx() ctx: RequestCtx) {
    this.tasks.assertCanReadList(ctx);
    return { data: await this.tasks.summary(ctx, await this.transfers.counts(ctx.actor)) };
  }

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryTasksDto) {
    return { data: await this.tasks.list(ctx, q) };
  }

  @Get(':id')
  async detail(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.tasks.detail(ctx, id) };
  }

  @Patch(':id')
  async update(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateActivityDto) {
    return { data: await this.tasks.update(ctx, id, dto) };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DeleteActivityDto) {
    return { data: await this.tasks.remove(ctx, id, dto) };
  }

  @Get(':id/history')
  async history(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.tasks.history(ctx, id) };
  }

  @Get(':id/work-card')
  async workCard(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.tasks.workCard(ctx, id) };
  }

  @Post(':id/assign')
  @HttpCode(200)
  async assign(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AssignActivityDto) {
    return { data: await this.tasks.assign(ctx, id, dto) };
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CompleteActivityDto) {
    return { data: await this.tasks.complete(ctx, id, dto) };
  }

  @Post(':id/reopen')
  @HttpCode(200)
  async reopen(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: VersionDto) {
    return { data: await this.tasks.reopen(ctx, id, dto) };
  }

  @Post(':id/access/revoke')
  @HttpCode(200)
  async revokeAccess(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RevokeAccessDto) {
    return { data: await this.tasks.revokeTaskAccess(ctx, id, dto) };
  }

  @Post(':id/transfer-requests')
  async requestTransfer(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateTransferRequestDto) {
    return { data: await this.transfers.create(ctx, id, dto) };
  }
}

// Đề xuất chuyển việc (§5.5): hộp đến/đi + duyệt/từ chối/rút.
@Controller('activity-transfer-requests')
@UseGuards(ActorGuard)
export class ActivityTransferRequestsController {
  constructor(private readonly transfers: ActivityTransfersService) {}

  @Get()
  async box(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryTransferBoxDto) {
    return { data: await this.transfers.box(ctx, q.box) };
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DecideTransferDto) {
    return { data: await this.transfers.approve(ctx, id, dto) };
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DecideTransferDto) {
    return { data: await this.transfers.reject(ctx, id, dto) };
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  async withdraw(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DecideTransferDto) {
    return { data: await this.transfers.withdraw(ctx, id, dto) };
  }
}
