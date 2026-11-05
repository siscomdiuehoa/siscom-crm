import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { QueryAssigneeCandidatesDto, QueryTimelineDto } from './dto/query-activities.dto';

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

// /activities: A5 chỉ có assignee-candidates. Các route ':id' (A6) phải khai báo SAU 'assignee-candidates' (static-guards.spec ghim thứ tự).
@Controller('activities')
@UseGuards(ActorGuard)
export class ActivitiesController {
  constructor(private readonly service: ActivitiesService) {}

  @Get('assignee-candidates')
  async assigneeCandidates(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryAssigneeCandidatesDto) {
    return { data: await this.service.assigneeCandidates(ctx, q.customerId) };
  }
}
