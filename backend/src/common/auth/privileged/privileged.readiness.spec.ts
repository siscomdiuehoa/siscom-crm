import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../../filters/all-exceptions.filter';
import { validateEnv } from '../../../config/env.validation';
import { AuthModule } from '../auth.module';
import { ACTOR_PROVIDER, Actor, ActorProvider } from '../actor';
import { DenyAllActorProvider } from '../deny-all-actor.provider';
import { EVIDENCE_SQL, evaluateEvidence, evaluatePoolSeparation } from './readiness.evidence';
import { PrivilegedReadinessService } from './privileged-readiness.service';
import { PrivilegedReadyGuard } from './privileged-ready.guard';
import { PrivilegedModule } from './privileged.module';
import { ACTOR_BINDING_VERIFIER, ActorBindingVerifier, AUTH_DB_PROBE, GENERAL_DB_PROBE, PgCatalogProbe } from './privileged.types';

// F-01/F-02 — TOÀN BỘ test ở đây dùng mock/giả trong bộ nhớ: KHÔNG kết nối PostgreSQL, không .env.
// Kết quả "đạt" ở đây chỉ chứng minh LOGIC từ chối; KHÔNG chứng minh trạng thái quyền thật của PostgreSQL (UNVERIFIED).

const goodGeneral = () => ({
  evidence_version: 1, db_user: 'siscom_app', session_is_current: true, role_unprivileged: true, is_migrator_member: false, is_database_owner: false,
  owned_public_relations: 0, can_write_rbac: false, can_touch_reset_tokens: false, can_read_password_hash: false, can_write_credential_secret: false,
  can_tamper_audit: false, api_function_count: 11, api_exec_count: 0, internal_function_count: 4, internal_exec_count: 0, bootstrap_closed: true,
});
const goodAuth = () => ({ ...goodGeneral(), db_user: 'siscom_auth', api_exec_count: 11, can_read_password_hash: true });

describe('evaluateEvidence (thuần, không DB)', () => {
  it('hàng đạt chuẩn của hai profile => sẵn sàng', () => {
    expect(evaluateEvidence('GENERAL', goodGeneral())).toEqual({ ready: true, reasons: [] });
    expect(evaluateEvidence('AUTH', goodAuth())).toEqual({ ready: true, reasons: [] });
    expect(evaluatePoolSeparation(goodGeneral(), goodAuth()).ready).toBe(true);
  });

  const unsafeGeneral: Array<[string, Record<string, unknown>, string]> = [
    ['role là superuser/createrole/bypassrls', { role_unprivileged: false }, 'G_ROLE_PRIVILEGED'],
    ['kết nối bằng postgres', { db_user: 'postgres' }, 'G_DB_USER'],
    ['kết nối bằng POSTGRES (khác hoa/thường)', { db_user: 'POSTGRES' }, 'G_DB_USER'],
    ['là thành viên siscom_migrator', { is_migrator_member: true }, 'G_IS_MIGRATOR_MEMBER'],
    ['vai trò siscom_migrator không tồn tại (NULL)', { is_migrator_member: null }, 'G_IS_MIGRATOR_MEMBER'],
    ['là chủ database', { is_database_owner: true }, 'G_IS_DATABASE_OWNER'],
    ['sở hữu bảng trong public (S1 chưa chạy)', { owned_public_relations: 12 }, 'G_OWNS_PUBLIC_OBJECTS'],
    ['ghi được employee_role/role_permission... (F-02)', { can_write_rbac: true }, 'G_CAN_WRITE_RBAC'],
    ['bảng RBAC không tồn tại (NULL)', { can_write_rbac: null }, 'G_CAN_WRITE_RBAC'],
    ['đọc/ghi được password_reset_token', { can_touch_reset_tokens: true }, 'G_CAN_TOUCH_RESET_TOKENS'],
    ['đọc được password_hash (F-03)', { can_read_password_hash: true }, 'G_CAN_READ_PASSWORD_HASH'],
    ['ghi được bí mật credential', { can_write_credential_secret: true }, 'G_CAN_WRITE_CREDENTIAL_SECRET'],
    ['sửa/xóa được audit_log', { can_tamper_audit: true }, 'G_CAN_TAMPER_AUDIT'],
    ['pool chung gọi được hàm API đặc quyền (F-01, giai đoạn 1)', { api_exec_count: 11 }, 'G_CAN_EXEC_PRIVILEGED_API'],
    ['pool chung gọi được 1 hàm API', { api_exec_count: 1 }, 'G_CAN_EXEC_PRIVILEGED_API'],
    ['thiếu hàm API (chưa áp M1.2)', { api_function_count: null }, 'G_API_FUNCTIONS_MISSING'],
    ['gọi được hàm nội bộ/đóng khởi tạo', { internal_exec_count: 1 }, 'G_INTERNAL_EXEC'],
    ['bootstrap còn mở', { bootstrap_closed: false }, 'G_BOOTSTRAP_OPEN'],
    ['SET ROLE/session khác current_user', { session_is_current: false }, 'G_SESSION_SWITCHED'],
    ['phiên bản bằng chứng lạ', { evidence_version: 2 }, 'G_EVIDENCE_VERSION'],
  ];
  it.each(unsafeGeneral)('GENERAL từ chối: %s', (_n, patch, code) => {
    const r = evaluateEvidence('GENERAL', { ...goodGeneral(), ...patch });
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain(code);
  });

  it('giá trị "chuỗi"/bigint/1/undefined không được coi là đúng kiểu (không ép kiểu)', () => {
    for (const bad of ['false', 'f', 0, undefined, null, 1n]) {
      expect(evaluateEvidence('GENERAL', { ...goodGeneral(), can_write_rbac: bad }).ready).toBe(false);
    }
    for (const bad of ['0', 0n, 0.5, NaN, null, undefined]) {
      expect(evaluateEvidence('GENERAL', { ...goodGeneral(), owned_public_relations: bad }).ready).toBe(false);
    }
  });
  it('thiếu cột => từ chối; không phải đối tượng => từ chối', () => {
    const g: Record<string, unknown> = goodGeneral();
    delete g.bootstrap_closed;
    expect(evaluateEvidence('GENERAL', g).ready).toBe(false);
    for (const bad of [null, undefined, 'ok', 42, [], [goodGeneral()]]) expect(evaluateEvidence('GENERAL', bad)).toEqual({ ready: false, reasons: ['G_EVIDENCE_MISSING'] });
  });
  it('AUTH: không gọi được đủ 11 hàm => từ chối (cấu hình sai không phải "an toàn")', () => {
    expect(evaluateEvidence('AUTH', { ...goodAuth(), api_exec_count: 10 }).reasons).toContain('A_API_EXEC_INCOMPLETE');
    expect(evaluateEvidence('AUTH', { ...goodAuth(), can_write_rbac: true }).ready).toBe(false);
    expect(evaluateEvidence('AUTH', { ...goodAuth(), bootstrap_closed: false }).ready).toBe(false);
  });
  it('hai pool phải là hai danh tính DB khác nhau (kể cả khác hoa/thường)', () => {
    expect(evaluatePoolSeparation(goodGeneral(), { ...goodAuth(), db_user: 'SISCOM_APP' }).ready).toBe(false);
    expect(evaluatePoolSeparation(goodGeneral(), null).ready).toBe(false);
    expect(evaluatePoolSeparation(undefined, goodAuth()).ready).toBe(false);
  });
});

describe('EVIDENCE_SQL (kiểm tĩnh: chỉ đọc, không tham số)', () => {
  it('là đúng một câu SELECT, không từ khóa ghi/DDL, không đổi quyền/vai trò/phiên', () => {
    const sql = EVIDENCE_SQL;
    expect(sql.trim()).toMatch(/^SELECT\b/);
    expect(sql).not.toMatch(/;/);
    expect(sql).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE|DROP|ALTER|CREATE|GRANT|REVOKE|SET\s+ROLE|SET\s+SESSION|set_config|COPY|EXECUTE\s+FUNCTION|nextval|pg_terminate|dblink)\b/i);
    expect(sql).not.toMatch(/\$\d/);
  });
  it('mọi tham chiếu catalog dùng tiền tố pg_catalog.; chỉ một bảng nghiệp vụ được đọc (app_meta) ', () => {
    expect(EVIDENCE_SQL.match(/FROM\s+public\.\w+/g)).toEqual(['FROM public.app_meta']);
    expect(EVIDENCE_SQL).toContain("key = 'auth_bootstrap_done'");
  });
  it('không đọc cột bí mật (chỉ hỏi QUYỀN trên password_hash, không SELECT nó)', () => {
    expect(EVIDENCE_SQL).not.toMatch(/SELECT[^)]*password_hash/i);
    expect(EVIDENCE_SQL).not.toMatch(/token_hash|refresh_hash/i);
  });
});

describe('PgCatalogProbe', () => {
  it('chỉ chạy đúng EVIDENCE_SQL; yêu cầu đúng 1 hàng', async () => {
    const run = jest.fn().mockResolvedValue([goodGeneral()]);
    expect(await new PgCatalogProbe(run).fetchEvidence()).toEqual(goodGeneral());
    expect(run).toHaveBeenCalledWith(EVIDENCE_SQL);
    await expect(new PgCatalogProbe(jest.fn().mockResolvedValue([])).fetchEvidence()).rejects.toThrow();
    await expect(new PgCatalogProbe(jest.fn().mockResolvedValue([{}, {}])).fetchEvidence()).rejects.toThrow();
  });
});

// ---------- service + guard với DI thật của Nest, mọi phụ thuộc là giả ----------
const REAL_PROVIDER: ActorProvider = { resolve: async () => ({ employeeId: 'e1', departmentId: null }), scopeFor: () => 'ALL' };
const probe = (row: unknown) => ({ fetchEvidence: jest.fn().mockResolvedValue(row) });
const verifier = (over: Partial<ActorBindingVerifier> = {}): ActorBindingVerifier => ({ dbVerifiable: true, verify: async () => ({ employeeId: 'e1', departmentId: null, proof: 'p' }), ...over });

interface Opts { enabled?: boolean | string; provider?: ActorProvider | 'deny'; verifier?: ActorBindingVerifier | null; general?: unknown; auth?: unknown }
async function makeService(o: Opts = {}) {
  const providers: unknown[] = [
    PrivilegedReadinessService, PrivilegedReadyGuard,
    { provide: ConfigService, useValue: { get: (k: string) => (k === 'PRIVILEGED_AUTH_ENABLED' ? o.enabled : undefined) } },
    { provide: ACTOR_PROVIDER, useValue: o.provider === 'deny' || o.provider === undefined ? new DenyAllActorProvider() : o.provider },
  ];
  if (o.verifier) providers.push({ provide: ACTOR_BINDING_VERIFIER, useValue: o.verifier });
  if (o.general !== undefined) providers.push({ provide: GENERAL_DB_PROBE, useValue: o.general });
  if (o.auth !== undefined) providers.push({ provide: AUTH_DB_PROBE, useValue: o.auth });
  const mod = await Test.createTestingModule({ providers: providers as never[] }).compile();
  return { svc: mod.get(PrivilegedReadinessService), guard: mod.get(PrivilegedReadyGuard) };
}
const fullOk = (): Opts => ({ enabled: true, provider: REAL_PROVIDER, verifier: verifier(), general: probe(goodGeneral()), auth: probe(goodAuth()) });

describe('PrivilegedReadinessService (fail-closed)', () => {
  it('mặc định (không cờ, DenyAll, không probe) => đóng; onModuleInit không ném và không gọi probe', async () => {
    const g = probe(goodGeneral());
    const { svc } = await makeService({ general: g });
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect(await svc.isReady()).toBe(false);
    expect(g.fetchEvidence).not.toHaveBeenCalled();
  });
  it('CỜ BẬT NHƯNG KHÔNG CÓ bằng chứng/provider thật => đóng và TỪ CHỐI KHỞI ĐỘNG', async () => {
    const { svc } = await makeService({ enabled: true });
    await expect(svc.onModuleInit()).rejects.toThrow(/PRIVILEGED_AUTH_ENABLED/);
    const r = await svc.evaluate();
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining(['ACTOR_PROVIDER_DENY_ALL', 'NO_ACTOR_BINDING_VERIFIER', 'NO_GENERAL_PROBE', 'NO_AUTH_PROBE']));
  });
  it('chỉ boolean true thật mới là "bật" (chuỗi "true", 1 không đủ)', async () => {
    for (const v of ['true', 1, 'yes', undefined, null]) {
      const { svc } = await makeService({ ...fullOk(), enabled: v as never });
      expect(await svc.isReady()).toBe(false);
    }
  });
  it('mọi điều kiện đạt (toàn mock) => sẵn sàng — CHỈ chứng minh logic, KHÔNG phải trạng thái DB thật', async () => {
    const { svc } = await makeService(fullOk());
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect(await svc.isReady()).toBe(true);
  });
  it('verifier không khai dbVerifiable (xác minh ở Node rồi gửi p_actor trần = F-01) => đóng', async () => {
    const { svc } = await makeService({ ...fullOk(), verifier: verifier({ dbVerifiable: false }) });
    expect((await svc.evaluate()).reasons).toContain('ACTOR_BINDING_NOT_DB_VERIFIABLE');
  });
  it('mỗi cấu hình DB không an toàn => đóng (pool chung còn quyền gọi API, bootstrap mở, ghi được RBAC, 1 pool dùng chung)', async () => {
    const cases: Array<[string, Opts]> = [
      ['pool chung gọi được API (giai đoạn 1)', { ...fullOk(), general: probe({ ...goodGeneral(), api_exec_count: 11 }) }],
      ['bootstrap mở', { ...fullOk(), auth: probe({ ...goodAuth(), bootstrap_closed: false }) }],
      ['ghi được employee_role', { ...fullOk(), general: probe({ ...goodGeneral(), can_write_rbac: true }) }],
      ['đọc được password_hash ở pool chung', { ...fullOk(), general: probe({ ...goodGeneral(), can_read_password_hash: true }) }],
      ['hai pool cùng một role DB', { ...fullOk(), auth: probe({ ...goodAuth(), db_user: 'siscom_app' }) }],
    ];
    for (const [name, o] of cases) {
      const { svc } = await makeService(o);
      expect({ name, ready: await svc.isReady() }).toEqual({ name, ready: false });
    }
  });
  it('probe ném lỗi / trả rác / treo => đóng, không ném ra ngoài evaluate()', async () => {
    jest.useFakeTimers();
    try {
      const boom = { fetchEvidence: jest.fn().mockRejectedValue(new Error('connection refused')) };
      expect((await (await makeService({ ...fullOk(), general: boom })).svc.evaluate()).reasons).toEqual(['CHECK_ERROR']);
      expect((await (await makeService({ ...fullOk(), auth: probe('rác') })).svc.evaluate()).ready).toBe(false);
      const hang = { fetchEvidence: jest.fn().mockReturnValue(new Promise(() => undefined)) };
      const p = (await makeService({ ...fullOk(), auth: hang })).svc.evaluate();
      await jest.advanceTimersByTimeAsync(2500);
      expect((await p).ready).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  it('kết quả được cache ngắn hạn để health không dồn tải lên DB', async () => {
    const g = probe(goodGeneral());
    const { svc } = await makeService({ ...fullOk(), general: g });
    await svc.isReady(); await svc.isReady();
    expect(g.fetchEvidence).toHaveBeenCalledTimes(1);
  });
});

describe('PrivilegedReadyGuard — actor giả mạo/thiếu (negative)', () => {
  const ctx = (req: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;
  const status = async (p: Promise<boolean>) => { try { await p; return 'allowed'; } catch (e) { return (e as { getStatus(): number }).getStatus(); } };

  it('cổng đóng (mặc định) => 503 dù request mang header/body danh tính giả', async () => {
    const { guard } = await makeService({});
    const req = { headers: { 'x-actor-id': 'admin' }, body: { p_actor: 'admin', actorId: 'admin' }, actor: { employeeId: 'admin', departmentId: null } };
    expect(await status(guard.canActivate(ctx(req)))).toBe(503);
    expect((req as Record<string, unknown>).privilegedActor).toBeUndefined();
  });
  it('cổng mở nhưng verifier trả null (thiếu/giả chứng cứ) => 401', async () => {
    const { guard } = await makeService({ ...fullOk(), verifier: verifier({ verify: async () => null }) });
    expect(await status(guard.canActivate(ctx({ headers: { authorization: 'Bearer forged' }, body: { p_actor: 'admin' }, actor: { employeeId: 'admin', departmentId: null } })))).toBe(401);
  });
  it('verifier ném lỗi => 401 (không rò, không cho qua)', async () => {
    const { guard } = await makeService({ ...fullOk(), verifier: verifier({ verify: async () => { throw new Error('x'); } }) });
    expect(await status(guard.canActivate(ctx({ headers: {}, actor: { employeeId: 'e1', departmentId: null } })))).toBe(401);
  });
  it('verifier trả danh tính thiếu proof / employeeId rỗng => 401', async () => {
    for (const bad of [{ employeeId: 'e1', departmentId: null, proof: '' }, { employeeId: '', departmentId: null, proof: 'p' }, { employeeId: 'e1', departmentId: null }]) {
      const { guard } = await makeService({ ...fullOk(), verifier: verifier({ verify: async () => bad as never }) });
      expect(await status(guard.canActivate(ctx({ headers: {}, actor: { employeeId: 'e1', departmentId: null } })))).toBe(401);
    }
  });
  it('không có req.actor (ActorGuard chưa chạy) hoặc lệch với danh tính ràng buộc => 403', async () => {
    const { guard } = await makeService(fullOk());
    expect(await status(guard.canActivate(ctx({ headers: {} })))).toBe(403);
    expect(await status(guard.canActivate(ctx({ headers: {}, actor: { employeeId: 'someone-else', departmentId: null } })))).toBe(403);
  });
  it('hợp lệ: danh tính lấy từ verifier, KHÔNG từ body/header', async () => {
    const { guard } = await makeService(fullOk());
    const req: Record<string, unknown> = { headers: { 'x-actor-id': 'evil' }, body: { p_actor: 'evil' }, actor: { employeeId: 'e1', departmentId: null } };
    expect(await guard.canActivate(ctx(req))).toBe(true);
    expect((req.privilegedActor as Actor).employeeId).toBe('e1');
  });
});

describe('cấu hình thật của ứng dụng: PrivilegedModule + AuthModule mặc định', () => {
  let app: INestApplication;
  afterEach(async () => { await app?.close().catch(() => undefined); });
  async function boot(enabled: boolean) {
    const mod = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ PRIVILEGED_AUTH_ENABLED: enabled })] }), AuthModule, PrivilegedModule] }).compile();
    app = mod.createNestApplication();
    app.useLogger(false);
    app.useGlobalFilters(new AllExceptionsFilter());
    return app;
  }
  it('cờ tắt: khởi động bình thường, /health/privileged => 200 disabled; DenyAllActorProvider vẫn là mặc định', async () => {
    const a = await boot(false);
    await a.init();
    expect(a.get(ACTOR_PROVIDER)).toBeInstanceOf(DenyAllActorProvider);
    const r = await request(a.getHttpServer()).get('/health/privileged');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'disabled', privileged: false });
  });
  it('cờ bật nhưng thiếu giai đoạn 2: ứng dụng TỪ CHỐI KHỞI ĐỘNG', async () => {
    const a = await boot(true);
    await expect(a.init()).rejects.toThrow(/PRIVILEGED_AUTH_ENABLED/);
  });
});

describe('env: PRIVILEGED_AUTH_ENABLED', () => {
  const base = { DATABASE_URL: 'postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_test_20260101_000000' };
  it('mặc định false; chỉ true/false hợp lệ; giá trị lạ bị từ chối', () => {
    expect(validateEnv({ ...base }).PRIVILEGED_AUTH_ENABLED).toBe(false);
    expect(validateEnv({ ...base, PRIVILEGED_AUTH_ENABLED: 'true' }).PRIVILEGED_AUTH_ENABLED).toBe(true);
    expect(validateEnv({ ...base, PRIVILEGED_AUTH_ENABLED: 'FALSE' }).PRIVILEGED_AUTH_ENABLED).toBe(false);
    for (const bad of ['1', 'yes', 'on', 'enabled']) expect(() => validateEnv({ ...base, PRIVILEGED_AUTH_ENABLED: bad })).toThrow(/PRIVILEGED_AUTH_ENABLED/);
  });
});
