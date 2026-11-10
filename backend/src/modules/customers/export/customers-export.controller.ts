import { Body, Controller, HttpCode, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { RequestCtx } from '../../../common/auth/actor';
import { CurrentCtx } from '../../../common/auth/actor.decorator';
import { ActorGuard } from '../../../common/auth/actor.guard';
import { CustomersExportService } from './customers-export.service';
import { ExportCustomersDto } from './export.dto';
import { ExportException } from './export.errors';

// FV-4A: POST /api/v1/customers/export. Controller riêng để không đổi bộ route đã chốt của CustomersController.
// CSRF/Origin và must_change_password: guard toàn cục (APP_GUARD) áp cho POST này.
@Controller('customers/export')
@UseGuards(ActorGuard)
export class CustomersExportController {
  constructor(private readonly exporter: CustomersExportService) {}

  @Post()
  @HttpCode(200)
  async export(@CurrentCtx() ctx: RequestCtx, @Body() dto: ExportCustomersDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    try {
      const r = await this.exporter.export(ctx, dto);
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + r.filename + '"',
        'Cache-Control': 'no-store',
        'X-Export-Id': r.exportId,
        'X-Export-Rows': String(r.rows),
        'X-Export-Skipped': String(r.skipped),
      });
      return new StreamableFile(r.buffer);
    } catch (e) {
      if (e instanceof ExportException && e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
      throw e;
    }
  }
}
