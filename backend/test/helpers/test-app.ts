import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AUDIT_PORT, AuditEntry, AuditPort } from '../../src/common/audit/audit.port';
import { ACTOR_PROVIDER, Actor, ActorProvider, Permission, Scope } from '../../src/common/auth/actor';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import type { Prisma } from '../../src/generated/prisma/client';
import type { EmployeeAccess } from '../../src/common/auth/scope-merge';
import { DbEmployeeAccess, EMPLOYEE_ACCESS } from '../../src/modules/activities/activities.employee-access';
import { ActivitiesModule } from '../../src/modules/activities/activities.module';
import { ACTIVE_LINKS_CHECKER, ActiveLinksChecker } from '../../src/modules/customers/customers.deletion-guard';
import { CustomersModule } from '../../src/modules/customers/customers.module';
import { LookupsModule } from '../../src/modules/lookups/lookups.module';
import { DbAuditPort } from '../../src/common/audit/db-audit.port';
import { EXPORT_ACCESS, EXPORT_CONFIG, ExportAccessReader, ExportConfig, exportConfigFromEnv } from '../../src/modules/customers/export/customers-export.service';
import { AuthPrismaService } from '../../src/prisma/auth-prisma.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { Fixtures } from './fixtures';

// ───── CHỈ TỒN TẠI TRONG TEST (không bao giờ import từ src) ─────
export const ACTOR_HEADER = 'x-test-actor';
const ALL_PERMS: Permission[] = ['customer.read', 'customer.create', 'customer.update', 'customer.delete', 'customer.restore', 'contact.read', 'contact.create', 'lookup.read',
  // B3 A4
  'activity.read', 'activity.create', 'activity.create_tech', 'activity.update', 'activity.update_own', 'activity.assign', 'activity.delete', 'activity.assign_external', 'activity.transfer_request',
  // FV-4A
  'customer.export'];
const uniform = (s: Scope): Partial<Record<Permission, Scope>> => Object.fromEntries(ALL_PERMS.map((p) => [p, s]));
// B3 A5: phạm vi theo vai trò thật (bootstrap.ts BIZ) \u2014 dùng cho preset và cho người được giao việc (TestEmployeeAccess).
export const SALES: Partial<Record<Permission, Scope>> = { 'customer.read': 'OWN', 'customer.create': 'OWN', 'customer.update': 'OWN', 'contact.read': 'OWN', 'contact.create': 'OWN', 'lookup.read': 'ALL',
  'activity.read': 'OWN', 'activity.create': 'OWN', 'activity.update': 'OWN', 'activity.assign': 'OWN', 'activity.assign_external': 'OWN' };
export const TECH: Partial<Record<Permission, Scope>> = { 'customer.read': 'DEPARTMENT', 'contact.read': 'DEPARTMENT', 'lookup.read': 'ALL',
  'activity.read': 'DEPARTMENT', 'activity.create_tech': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT', 'activity.transfer_request': 'DEPARTMENT' };
export const ACCT: Partial<Record<Permission, Scope>> = { 'customer.read': 'ALL', 'contact.read': 'ALL', 'lookup.read': 'ALL', 'activity.read': 'ALL' };

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
      // B3 A5 \u2014 giống ma trận thật §5 (sales/technician/accountant), để kiểm hoạt động theo vai trò:
      salesA: { actor: { ...a }, scopes: { ...SALES } },
      techB: { actor: { employeeId: fx.empB, departmentId: fx.d1 }, scopes: { ...TECH } },
      techC: { actor: { employeeId: fx.empC, departmentId: fx.d2 }, scopes: { ...TECH } },
      acctA: { actor: { ...a }, scopes: { ...ACCT } },
      // Rà soát PR #209 M-8: người giao KHÔNG có phòng ban; một người NHIỀU vai trò (sales + kỹ thuật, phạm vi rộng nhất thắng).
      salesNoDept: { actor: { employeeId: fx.empA, departmentId: null }, scopes: { ...SALES } },
      salesTech: { actor: { ...a }, scopes: { ...SALES, 'customer.read': 'DEPARTMENT', 'contact.read': 'DEPARTMENT', 'activity.read': 'DEPARTMENT', 'activity.create_tech': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT' } },
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

// B3 A5 \u2014 CHỈ TRONG TEST: phạm vi của NGƯỜI ĐƯỢC GIAO lấy từ bảng do test đặt (DB thử có thể đã đóng bootstrap => không chèn vai trò thật).
// Trạng thái/phòng ban vẫn đọc từ DB thật (DbEmployeeAccess). Người không có trong bảng => phạm vi lấy từ vai trò thật trong DB (thường rỗng).
// Đường đọc vai trò THẬT được kiểm bằng phiên đăng nhập thật ở auth.int-spec (bootstrap cấp ma trận BIZ).
export class TestEmployeeAccess extends DbEmployeeAccess {
  readonly scopes = new Map<string, Partial<Record<Permission, Scope>>>();
  async load(db: Pick<Prisma.TransactionClient, 'employee'>, ids: readonly string[]): Promise<Map<string, EmployeeAccess>> {
    const m = await super.load(db, ids);
    for (const [id, v] of m) { const o = this.scopes.get(id); if (o) m.set(id, { ...v, scopes: Object.freeze({ ...o }) }); }
    return m;
  }
}

// FV-4A \u2014 CHỈ TRONG TEST: quyền "trong DB" của người xuất do test đặt (DB thử không có vai trò thật); trạng thái/phòng ban vẫn đọc DB thật.
// Test đổi map giữa chừng để mô phỏng thu hồi quyền sau khi phiên đã nạp quyền (I-19/I-20).
export class TestExportAccess implements ExportAccessReader {
  readonly scopes = new Map<string, Partial<Record<Permission, Scope>>>();
  async load(tx: Pick<Prisma.TransactionClient, 'employee'>, employeeId: string): Promise<EmployeeAccess | null> {
    const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, departmentId: true, status: true, deletedAt: true } });
    if (!e) return null;
    return { id: e.id, departmentId: e.departmentId, active: e.status === 'ACTIVE' && e.deletedAt === null, scopes: Object.freeze({ ...(this.scopes.get(employeeId) ?? {}) }) };
  }
}

// B3 A6: actors (null khi denyAll) để test thêm preset cho nhân viên tạo trong beforeAll.
export interface TestApp { app: INestApplication; audit: RecordingAuditPort; access: TestEmployeeAccess; actors: TestActorProvider | null; exportAccess: TestExportAccess }
export async function makeApp(prisma: PrismaService, fx: Fixtures, opts: { verifiedLinks?: boolean; denyAll?: boolean; realAudit?: boolean; exportConfig?: Partial<ExportConfig> } = {}): Promise<TestApp> {
  const audit = new RecordingAuditPort();
  const access = new TestEmployeeAccess();
  let b = Test.createTestingModule({ imports: [CustomersModule, LookupsModule, ActivitiesModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(AuthPrismaService).useValue(prisma).overrideProvider(EMPLOYEE_ACCESS).useValue(access);
  // FV-4A: realAudit => DbAuditPort thật (hạn mức xuất đếm từ audit_log trong DB).
  b = opts.realAudit ? b.overrideProvider(AUDIT_PORT).useValue(new DbAuditPort()) : b.overrideProvider(AUDIT_PORT).useValue(audit);
  const exportAccess = new TestExportAccess();
  b = b.overrideProvider(EXPORT_ACCESS).useValue(exportAccess).overrideProvider(EXPORT_CONFIG).useValue({ ...exportConfigFromEnv(), ...(opts.exportConfig ?? {}) });
  const actors = opts.denyAll ? null : new TestActorProvider(fx);
  if (actors) b = b.overrideProvider(ACTOR_PROVIDER).useValue(actors);
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
  return { app, audit, access, actors, exportAccess };
}

export function as(app: INestApplication, who?: string) {
  const h = (r: request.Test): request.Test => (who ? r.set(ACTOR_HEADER, who) : r);
  const srv = () => request(app.getHttpServer());
  return {
    get: (u: string) => h(srv().get(u)),
    post: (u: string, body: object = {}) => h(srv().post(u)).send(body),
    patch: (u: string, body: object = {}) => h(srv().patch(u)).send(body),
    // B3 A6: DELETE /activities/:id nhận lý do ở body.
    delete: (u: string, body?: object) => (body ? h(srv().delete(u)).send(body) : h(srv().delete(u))),
  };
}

// Phản hồi lỗi không được lộ chi tiết nội bộ (kiểm tra thông điệp + details, không kiểm mã lỗi như CONSTRAINT_CONFLICT).
const LEAK_RE = /postgres|password|stack|prisma|constraint|uq_|ck_|trg_|fn_|public\.|select |insert |update /i;
export const leaks = (body: { message?: string; error?: { details?: unknown } }): boolean => LEAK_RE.test(String(body.message ?? '') + JSON.stringify(body.error?.details ?? ''));
