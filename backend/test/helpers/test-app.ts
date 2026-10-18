import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AUDIT_PORT, AuditEntry, AuditPort } from '../../src/common/audit/audit.port';
import { ACTOR_PROVIDER, Actor, ActorProvider, Permission, Scope } from '../../src/common/auth/actor';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ACTIVE_LINKS_CHECKER, ActiveLinksChecker } from '../../src/modules/customers/customers.deletion-guard';
import { CustomersModule } from '../../src/modules/customers/customers.module';
import { LookupsModule } from '../../src/modules/lookups/lookups.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { Fixtures } from './fixtures';

// ───── CHỈ TỒN TẠI TRONG TEST (không bao giờ import từ src) ─────
export const ACTOR_HEADER = 'x-test-actor';
const ALL_PERMS: Permission[] = ['customer.read', 'customer.create', 'customer.update', 'customer.delete', 'customer.restore', 'contact.read', 'contact.create', 'lookup.read'];
const uniform = (s: Scope): Partial<Record<Permission, Scope>> => Object.fromEntries(ALL_PERMS.map((p) => [p, s]));

export class TestActorProvider implements ActorProvider {
  readonly presets: Record<string, { actor: Actor; scopes: Partial<Record<Permission, Scope>> }>;
  constructor(fx: Fixtures) {
    const a: Actor = { employeeId: fx.empA, departmentId: fx.d1 };
    this.presets = {
      all: { actor: { ...a }, scopes: uniform('ALL') },
      deptA: { actor: { ...a }, scopes: { ...uniform('DEPARTMENT'), 'lookup.read': 'ALL' } },
      ownA: { actor: { ...a }, scopes: { ...uniform('OWN'), 'lookup.read': 'ALL' } },
      ownB: { actor: { employeeId: fx.empB, departmentId: fx.d1 }, scopes: { ...uniform('OWN'), 'lookup.read': 'ALL' } },
      deptC: { actor: { employeeId: fx.empC, departmentId: fx.d2 }, scopes: { ...uniform('DEPARTMENT'), 'lookup.read': 'ALL' } },
      createReadOwn: { actor: { ...a }, scopes: { 'customer.create': 'ALL', 'customer.read': 'OWN', 'customer.update': 'ALL', 'lookup.read': 'ALL' } },
      readonly: { actor: { ...a }, scopes: { 'customer.read': 'ALL', 'contact.read': 'ALL', 'lookup.read': 'ALL' } },
      none: { actor: { ...a }, scopes: {} },
    };
  }
  async resolve(req: Request): Promise<Actor | null> {
    const k = req.header(ACTOR_HEADER);
    const p = k ? this.presets[k] : undefined;
    return p ? p.actor : null;
  }
  scopeFor(actor: Actor, permission: Permission): Scope | null {
    const p = Object.values(this.presets).find((x) => x.actor === actor);
    return p?.scopes[permission] ?? null;
  }
}

export class RecordingAuditPort implements AuditPort {
  entries: AuditEntry[] = [];
  async record(_tx: unknown, entry: AuditEntry): Promise<void> { this.entries.push(entry); }
}

// Checker GIẢ (N7): chỉ để kiểm chứng logic xoá mềm/khôi phục trên DB thử; route DELETE thật vẫn khoá.
export class TestLinksChecker implements ActiveLinksChecker {
  async check(): Promise<{ verified: boolean; unchecked: string[] }> { return { verified: true, unchecked: [] }; }
}

export interface TestApp { app: INestApplication; audit: RecordingAuditPort }
export async function makeApp(prisma: PrismaService, fx: Fixtures, opts: { verifiedLinks?: boolean; denyAll?: boolean } = {}): Promise<TestApp> {
  const audit = new RecordingAuditPort();
  let b = Test.createTestingModule({ imports: [CustomersModule, LookupsModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AUDIT_PORT).useValue(audit);
  if (!opts.denyAll) b = b.overrideProvider(ACTOR_PROVIDER).useValue(new TestActorProvider(fx));
  if (opts.verifiedLinks) b = b.overrideProvider(ACTIVE_LINKS_CHECKER).useValue(new TestLinksChecker());
  const mod = await b.compile();
  const app = mod.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  // Lắng nghe sẵn cổng tạm 127.0.0.1: nếu không, supertest gọi server.listen(0) cho MỖI yêu cầu trên cùng http.Server chưa lắng nghe;
  // nhiều yêu cầu song song cộng dồn listener 'listening'/'close' -> MaxListenersExceededWarning. app.close() đóng server này.
  await app.listen(0, '127.0.0.1');
  return { app, audit };
}

export function as(app: INestApplication, who?: string) {
  const h = (r: request.Test): request.Test => (who ? r.set(ACTOR_HEADER, who) : r);
  const srv = () => request(app.getHttpServer());
  return {
    get: (u: string) => h(srv().get(u)),
    post: (u: string, body: object = {}) => h(srv().post(u)).send(body),
    patch: (u: string, body: object = {}) => h(srv().patch(u)).send(body),
    delete: (u: string) => h(srv().delete(u)),
  };
}

// Phản hồi lỗi không được lộ chi tiết nội bộ (kiểm tra thông điệp + details, không kiểm mã lỗi như CONSTRAINT_CONFLICT).
const LEAK_RE = /postgres|password|stack|prisma|constraint|uq_|ck_|trg_|fn_|public\.|select |insert |update /i;
export const leaks = (body: { message?: string; error?: { details?: unknown } }): boolean => LEAK_RE.test(String(body.message ?? '') + JSON.stringify(body.error?.details ?? ''));
