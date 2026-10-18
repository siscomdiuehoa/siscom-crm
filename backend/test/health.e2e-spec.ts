// Can DB that + file .env. Chay: npm run test:e2e
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, app.get(ConfigService));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('GET /api/v1/health -> 200 ok', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(r.body.status).toBe('ok');
    expect(r.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/v1/health/database -> 200 up (can DB dang chay + da migrate)', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/health/database').expect(200);
    expect(r.body.database).toBe('up');
    expect(r.body.schema.migrated).toBe(true);
  });

  it('duong dan khong ton tai -> 404 thong bao tieng Viet, khong lo chi tiet', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/khong-ton-tai').expect(404);
    expect(r.body.message).toBeDefined();
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|password|stack/i);
  });

  it('CORS: chi cho phep origin trong danh sach', async () => {
    const ok = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
