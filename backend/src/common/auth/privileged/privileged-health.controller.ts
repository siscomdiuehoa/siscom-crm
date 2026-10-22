import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../permissions.decorator';
import { PrivilegedReadinessService } from './privileged-readiness.service';

// Chỉ báo trạng thái; KHÔNG lộ lý do chi tiết (lý do ghi log máy chủ). Không thuộc hợp đồng API khách hàng.
@Controller('health')
@Public()
export class PrivilegedHealthController {
  constructor(private readonly readiness: PrivilegedReadinessService) {}

  @Get('privileged')
  async privileged(@Res({ passthrough: true }) res: Response) {
    if (!this.readiness.enabled()) return { status: 'disabled', privileged: false, time: new Date().toISOString() };
    const r = await this.readiness.evaluate();
    if (!r.ready) {
      res.status(503);
      return { status: 'error', privileged: false, message: 'Chức năng đặc quyền chưa sẵn sàng.', time: new Date().toISOString() };
    }
    return { status: 'ok', privileged: true, time: new Date().toISOString() };
  }
}
