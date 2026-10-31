import { Injectable, Logger } from '@nestjs/common';
import { assessDbRole, fetchDbRoleFacts } from '../prisma/db-role-check';
import { PrismaService } from '../prisma/prisma.service';

export interface DatabaseHealth {
  ok: boolean;
  latencyMs?: number;
  migrated?: boolean;
  baseline?: string | null;
  // B1.4 P3b (M-d): ứng dụng có đang chạy bằng role đặc quyền tối thiểu không; null = chưa đọc được. Không trả tên tài khoản.
  role?: { leastPrivilege: boolean | null };
}

const DB_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  // M-6: nhớ trạng thái role đã báo để không ghi cảnh báo lặp mỗi lần probe; chỉ ghi khi trạng thái đổi.
  private lastRoleWarning: string | null = null;
  constructor(private readonly prisma: PrismaService) {}

  liveness() {
    return {
      status: 'ok',
      service: 'siscom-crm-backend',
      version: process.env.npm_package_version || 'dev',
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
    });
  }

  async database(): Promise<DatabaseHealth> {
    const start = Date.now();
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`);
    } catch (err) {
      // Ghi chi tiet o may chu; khong tra ve client.
      this.logger.error('Kiểm tra database thất bại: ' + (err instanceof Error ? err.message : 'không rõ'));
      return { ok: false };
    }
    const latencyMs = Date.now() - start;
    const role = await this.role();
    try {
      const row = await this.withTimeout(this.prisma.appMeta.findUnique({ where: { key: 'schema_baseline' } }));
      return { ok: true, latencyMs, migrated: !!row, baseline: row ? row.value : null, role };
    } catch {
      // Ket noi duoc nhung chua chay migration (bang app_meta chua ton tai).
      return { ok: true, latencyMs, migrated: false, baseline: null, role };
    }
  }

  // Chỉ catalog; không ảnh hưởng ok/503. Chi tiết (tên tài khoản, lý do) ghi ở máy chủ, client chỉ thấy true/false/null.
  private async role(): Promise<{ leastPrivilege: boolean | null }> {
    try {
      const a = assessDbRole(await this.withTimeout(fetchDbRoleFacts(this.prisma)), process.env.NODE_ENV);
      this.warnOnChange(a.leastPrivilege ? null : 'Role database không phải đặc quyền tối thiểu: ' + a.problems.join('; '));
      return { leastPrivilege: a.leastPrivilege };
    } catch (err) {
      this.warnOnChange('Không đọc được thông tin role database: ' + (err instanceof Error ? err.message : 'không rõ'));
      return { leastPrivilege: null };
    }
  }

  private warnOnChange(msg: string | null): void {
    if (msg !== null && msg !== this.lastRoleWarning) this.logger.warn(msg);
    this.lastRoleWarning = msg;
  }
}
