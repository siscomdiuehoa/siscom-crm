import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Liveness: khong cham database.
  @Get()
  liveness() {
    return this.health.liveness();
  }

  // Readiness: kiem tra ket noi database. Loi -> 503 voi thong bao chung, khong lo chi tiet.
  @Get('database')
  async database(@Res({ passthrough: true }) res: Response) {
    const r = await this.health.database();
    if (!r.ok) {
      res.status(503);
      return { status: 'error', database: 'down', message: 'Không kết nối được cơ sở dữ liệu.', time: new Date().toISOString() };
    }
    return { status: 'ok', database: 'up', latencyMs: r.latencyMs, schema: { migrated: r.migrated, baseline: r.baseline }, time: new Date().toISOString() };
  }
}
