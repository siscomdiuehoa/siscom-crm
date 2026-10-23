import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// OFFLINE: PrismaService giả, không database, không .env. Đây KHÔNG phải e2e thật (xem test/health.e2e-spec.ts, cần PostgreSQL).
async function makeApp(prisma: unknown): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ controllers: [HealthController], providers: [HealthService, { provide: PrismaService, useValue: prisma }] }).compile();
  const app = mod.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

describe('Health (offline, Prisma giả)', () => {
  it('GET /api/v1/health -> 200 và không chạm database', async () => {
    const prisma = { $queryRaw: jest.fn(), appMeta: { findUnique: jest.fn() } };
    const app = await makeApp(prisma);
    try {
      const r = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      expect(r.body.status).toBe('ok');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.appMeta.findUnique).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('GET /api/v1/health/database khi DB lỗi -> 503 thông báo chung, không lộ chi tiết kết nối', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED postgres://u:secret@db:5432/x')), appMeta: { findUnique: jest.fn() } };
    const app = await makeApp(prisma);
    try {
      const r = await request(app.getHttpServer()).get('/api/v1/health/database').expect(503);
      expect(r.body.database).toBe('down');
      expect(JSON.stringify(r.body)).not.toMatch(/postgres|secret|ECONNREFUSED/i);
    } finally { await app.close(); }
  });

  it('GET /api/v1/health/database khi DB ổn nhưng chưa migrate -> 200 migrated:false (không giả "đã migrate")', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]), appMeta: { findUnique: jest.fn().mockRejectedValue(new Error('no table')) } };
    const app = await makeApp(prisma);
    try {
      const r = await request(app.getHttpServer()).get('/api/v1/health/database').expect(200);
      expect(r.body.database).toBe('up');
      expect(r.body.schema.migrated).toBe(false);
    } finally { await app.close(); }
  });
});
