import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { QueryLookupsDto } from './dto/query-lookups.dto';
import { LookupsService } from './lookups.service';

@Controller('lookups')
@UseGuards(ActorGuard)
export class LookupsController {
  constructor(private readonly service: LookupsService) {}

  @Get()
  @RequirePermissions('lookup.read')
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryLookupsDto) {
    return { data: await this.service.list(ctx, q) };
  }
}
