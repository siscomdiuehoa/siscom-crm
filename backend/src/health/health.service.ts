import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DatabaseHealth {
  ok: boolean;
  latencyMs?: number;
  migrated?: boolean;
  baseline?: string | null;
}

const DB_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
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
    try {
      const row = await this.withTimeout(this.prisma.appMeta.findUnique({ where: { key: 'schema_baseline' } }));
      return { ok: true, latencyMs, migrated: !!row, baseline: row ? row.value : null };
    } catch {
      // Ket noi duoc nhung chua chay migration (bang app_meta chua ton tai).
      return { ok: true, latencyMs, migrated: false, baseline: null };
    }
  }
}
