import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AllowPasswordChangeRequired } from '../common/auth/password-change-required.guard';
import { HealthService } from './health.service';

// Health khong can phien; B1.4 P2: khong bi chan khi trinh duyet tinh co gui cookie cua phien phai doi mat khau.
@AllowPasswordChangeRequired()
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
    return { status: 'ok', database: 'up', latencyMs: r.latencyMs, schema: { migrated: r.migrated, baseline: r.baseline }, role: r.role, time: new Date().toISOString() };
  }
}
