import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { QueryQuoteDefaultsDto, QueryQuotesDto, QueryTemplatesDto } from './dto/query-quotes.dto';
import { QuotesService } from './quotes.service';

// Báo giá Q4 (đọc) — docs/QUOTES_DESIGN.md mục 9. Tập route ghim trong quotes.static-guards.spec.ts.
// MỌI phản hồi (kể cả lỗi) của các đường dưới đây mang Cache-Control: no-store — đặt bằng middleware ở QuotesModule (mục 7.2, ca C15).
// CSRF / Origin là guard toàn cục như các module khác.
@Controller('opportunities/:opportunityId/quotes')
@UseGuards(ActorGuard)
export class OpportunityQuotesController {
  constructor(private readonly service: QuotesService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Param('opportunityId', new ParseUUIDPipe()) opportunityId: string) {
    return { data: await this.service.listByOpportunity(ctx, opportunityId) };
  }

  // Giá trị điền sẵn khi lập báo giá mới.
  @Get('defaults')
  async defaults(@CurrentCtx() ctx: RequestCtx, @Param('opportunityId', new ParseUUIDPipe()) opportunityId: string, @Query() q: QueryQuoteDefaultsDto) {
    return { data: await this.service.defaults(ctx, opportunityId, q.templateId) };
  }
}

@Controller('quotes')
@UseGuards(ActorGuard)
export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryQuotesDto) {
    return { data: await this.service.list(ctx, q) };
  }

  // ĐƯỜNG TĨNH: phải khai báo TRƯỚC ':id' (static-guards.spec ghim thứ tự).
  @Get('templates')
  async templates(@CurrentCtx() ctx: RequestCtx, @Query() q: QueryTemplatesDto) {
    return { data: await this.service.templates(ctx, q.all === '1') };
  }

  @Get('my-defaults')
  async myDefaults(@CurrentCtx() ctx: RequestCtx) {
    return { data: await this.service.myDefaults(ctx) };
  }

  @Get(':id')
  async detail(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.service.detail(ctx, id) };
  }
}
