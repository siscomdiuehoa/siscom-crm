import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { QueryQuoteDefaultsDto, QueryQuotesDto, QueryTemplatesDto } from './dto/query-quotes.dto';
import { CreateQuoteDto, DeleteQuoteDto, QuoteVersionRefDto, SaveQuoteDraftDto, UpdateQuoteDto } from './dto/write-quotes.dto';
import { QuotesService } from './quotes.service';
import { QuotesWriteService } from './quotes.write.service';

// Báo giá Q4 (đọc) + Q5a (ghi) — docs/QUOTES_DESIGN.md mục 9. Tập route ghim trong quotes.read.spec.ts.
// MỌI phản hồi (kể cả lỗi) của các đường dưới đây mang Cache-Control: no-store — đặt bằng middleware ở QuotesModule (mục 7.2, ca C15).
// CSRF / Origin là guard toàn cục như các module khác.
@Controller('opportunities/:opportunityId/quotes')
@UseGuards(ActorGuard)
export class OpportunityQuotesController {
  constructor(private readonly service: QuotesService, private readonly writes: QuotesWriteService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Param('opportunityId', new ParseUUIDPipe()) opportunityId: string) {
    return { data: await this.service.listByOpportunity(ctx, opportunityId) };
  }

  // Giá trị điền sẵn khi lập báo giá mới.
  @Get('defaults')
  async defaults(@CurrentCtx() ctx: RequestCtx, @Param('opportunityId', new ParseUUIDPipe()) opportunityId: string, @Query() q: QueryQuoteDefaultsDto) {
    return { data: await this.service.defaults(ctx, opportunityId, q.templateId) };
  }

  // Q5a: lập báo giá mới (phiên bản 1, nháp).
  @Post()
  async create(@CurrentCtx() ctx: RequestCtx, @Param('opportunityId', new ParseUUIDPipe()) opportunityId: string, @Body() dto: CreateQuoteDto) {
    return { data: await this.writes.create(ctx, opportunityId, dto) };
  }
}

@Controller('quotes')
@UseGuards(ActorGuard)
export class QuotesController {
  constructor(private readonly service: QuotesService, private readonly writes: QuotesWriteService) {}

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

  // ───── Q5a: ghi ─────
  @Patch(':id')
  async updateItem(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateQuoteDto) {
    return { data: await this.writes.updateItem(ctx, id, dto) };
  }

  @Delete(':id')
  async remove(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DeleteQuoteDto) {
    return { data: await this.writes.deleteQuote(ctx, id, dto) };
  }

  // Tạo bản mới từ phiên bản mới nhất.
  @Post(':id/versions')
  async newVersion(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: QuoteVersionRefDto) {
    return { data: await this.writes.newVersion(ctx, id, dto) };
  }

  // Lưu cả bản nháp.
  @Put(':id/versions/:no')
  async saveDraft(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Param('no', new ParseIntPipe()) no: number, @Body() dto: SaveQuoteDraftDto) {
    return { data: await this.writes.saveDraft(ctx, id, no, dto) };
  }

  // Xoá bản nháp.
  @Delete(':id/versions/:no')
  async deleteVersion(@CurrentCtx() ctx: RequestCtx, @Param('id', new ParseUUIDPipe()) id: string, @Param('no', new ParseIntPipe()) no: number, @Body() dto: QuoteVersionRefDto) {
    return { data: await this.writes.deleteVersion(ctx, id, no, dto) };
  }
}
