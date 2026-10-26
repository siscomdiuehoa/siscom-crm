import 'reflect-metadata';
import * as path from 'path';
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACTOR_PROVIDER, Actor, ActorProvider, Permission, Scope } from '../../common/auth/actor';
import { AuthModule } from '../../common/auth/auth.module';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupsModule } from '../lookups/lookups.module';
import { CustomersModule } from './customers.module';
import { CustomersService } from './customers.service';

// OVN04 — smoke FE<->BE OFFLINE: module FRONTEND thật (customerApiClient/repository/ui) -> fetch giả -> app Nest thật (ActorGuard, AccessGuard,
// ValidationPipe, AllExceptionsFilter) -> CustomersService GIẢ (repository giả). Không database, không mạng, không .env, không kích hoạt auth routes.
// KHÔNG phải E2E: không trình duyệt, không đăng nhập thật, không PostgreSQL. Xem backend/docs/OVN04_CUSTOMER_API_MOCK_SMOKE.md.
const nativeRequire = (process as unknown as { getBuiltinModule(n: string): typeof import('module') })
  .getBuiltinModule('module')
  .createRequire(__filename);
const FE = path.resolve(__dirname, '../../../../frontend/siscom-crm-web/src');
// require(esm) NATIVE của Node (jest không chuyển đổi được ESM); các module FE không có top-level await.
const fe = {
  client: nativeRequire(path.join(FE, 'data/api/customerApiClient.js')),
  ui: nativeRequire(path.join(FE, 'features/customers/customerApiUi.js')),
  repo: nativeRequire(path.join(FE, 'data/api/customerRepository.js')),
};

const BASE = 'http://crm.invalid/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ME: Actor = { employeeId: 'e-me', departmentId: 'd1' };
const NEW_ID = '33333333-3333-4333-8333-333333333333';
const detail = (name: string, phone: string) => ({ id: NEW_ID, code: 'KH-00001', name, phone, version: 1, owner: null, tags: [] });

function makePrisma() { return { $transaction: jest.fn(), customer: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() }, lookupItem: { findMany: jest.fn() }, contact: { findMany: jest.fn() } }; }
function makeService() {
  return {
    create: jest.fn(async (_c: unknown, dto: { name: string; phone: string }) => detail(dto.name, dto.phone)),
    list: jest.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })),
    get: jest.fn(),
  };
}
// Nhà cung cấp actor giả: bearer "Bearer tok-<employeeId>" -> actor; token khác -> null (401).
function bearerProvider(granted: Partial<Record<Permission, Scope>>, seen: string[] = []): ActorProvider {
  return {
    resolve: async (req) => {
      const h = req.headers.authorization ?? '';
      seen.push(h);
      const m = /^Bearer tok-([a-z-]+)$/.exec(h);
      return m ? { employeeId: m[1], departmentId: 'd1' } : null;
    },
    scopeFor: (_a, p) => granted[p] ?? null,
  };
}
async function makeApp(service: unknown, provider?: ActorProvider, prisma: unknown = makePrisma()): Promise<INestApplication> {
  let b = Test.createTestingModule({ imports: [CustomersModule, LookupsModule, AuthModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(CustomersService).useValue(service);
  if (provider) b = b.overrideProvider(ACTOR_PROVIDER).useValue(provider);
  const app = (await b.compile()).createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
// fetch giả: chuyển yêu cầu của FE vào app Nest trong tiến trình (supertest). Ghi lại mọi cuộc gọi.
function bridge(app: INestApplication, hook?: (url: string, init: any) => Promise<any> | any) {
  const calls: { url: string; init: any }[] = [];
  const f: any = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const hooked = hook ? await hook(url, init) : undefined;
    if (hooked) return hooked;
    const method = (init.method || 'GET').toLowerCase();
    let r = (request(app.getHttpServer()) as any)[method](url.replace('http://crm.invalid', ''));
    for (const [k, v] of Object.entries(init.headers || {})) r = r.set(k, v as string);
    const res = await (init.body ? r.send(JSON.parse(init.body)) : r);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body };
  };
  f.calls = calls;
  return f;
}
const synthetic = (status: number, code: string) => ({ ok: false, status, json: async () => ({ error: { code, message: 'giả lập ' + status } }) });
// Phiên giả đúng hợp đồng customerApiClient: { getState, getAuthHeader, handleUnauthorized(headerĐãDùng) } — chỉ hủy khi header khớp phiên hiện tại.
function fakeSession(initial: string | null) {
  let token = initial; const revoked: (string | null)[] = [];
  return {
    getState: () => ({ status: token ? 'AUTHENTICATED' : 'IDLE' }),
    getAuthHeader: () => (token ? 'Bearer ' + token : null),
    handleUnauthorized: (used: string | null) => { revoked.push(used); if (used === (token ? 'Bearer ' + token : null)) token = null; },
    switchTo: (t: string | null) => { token = t; },
    revoked,
  };
}
const GOOD = { name: 'Công ty ABC', phone: '0903123456' };

describe('A. API BẬT + cấu hình MẶC ĐỊNH của backend (DenyAll thật): fail-closed, không fallback demo', () => {
  let app: INestApplication; let service: ReturnType<typeof makeService>; let prisma: ReturnType<typeof makePrisma>;
  beforeEach(async () => { service = makeService(); prisma = makePrisma(); app = await makeApp(service, undefined, prisma); });
  afterEach(async () => { await app.close(); });

  it('UI/repository FE (không phiên) -> mọi thao tác 401 unauthenticated; local KHÔNG được gọi; backend không chạm service/DB', async () => {
    const f = bridge(app);
    const local = { list: jest.fn(), create: jest.fn(), get: jest.fn(), update: jest.fn() };
    const repo = fe.repo.createCustomerRepository({ env: ON, fetchImpl: f, local });
    expect(repo.mode).toBe('api');
    for (const op of [() => repo.list({ page: 1 }), () => repo.create(GOOD), () => repo.get(NEW_ID), () => repo.update(NEW_ID, GOOD, 1)]) {
      await expect(op()).rejects.toMatchObject({ kind: 'unauthenticated', status: 401, code: 'UNAUTHENTICATED' });
    }
    for (const fn of Object.values(local)) expect(fn).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled(); expect(service.list).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(4); // đúng 4 yêu cầu, không thử lại tự động
    for (const c of f.calls) { expect(c.init.credentials).toBe('omit'); expect(Object.keys(c.init.headers).map((h) => h.toLowerCase())).not.toContain('authorization'); }
  });
  it('controller UI: submit khi 401 -> ok:false, denied:true, không thành công giả, danh sách rỗng', async () => {
    const c = fe.ui.createCustomerApiUi({ env: ON, fetchImpl: bridge(app) });
    const r = await c.submit(GOOD);
    expect(r.ok).toBe(false); expect(r.error).toMatchObject({ kind: 'unauthenticated', denied: true, retryable: false });
    await c.load({ page: 1 });
    expect(c.getState().list.status).toBe('error'); expect(c.getState().list.items).toEqual([]);
  });
  it('cờ TẮT / thiếu BASE: FE không gửi yêu cầu nào tới backend', async () => {
    const f = bridge(app);
    expect(fe.ui.createCustomerApiUi({ env: { VITE_CRM_API_BASE: BASE }, fetchImpl: f })).toBeNull();
    const repo = fe.repo.createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true' }, fetchImpl: f, local: {} });
    await expect(repo.list()).rejects.toMatchObject({ kind: 'config' });
    expect(f.calls).toHaveLength(0);
  });
  it('FE gửi Authorization giả khi KHÔNG có provider thật -> backend vẫn 401 (danh tính không lấy từ header)', async () => {
    const session = fakeSession('forged');
    const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), bridge(app), { auth: session });
    await expect(api.list({})).rejects.toMatchObject({ status: 401 });
    expect(session.revoked).toEqual(['Bearer forged']); // 401 hủy đúng phiên đã dùng token đó
    expect(service.list).not.toHaveBeenCalled();
  });
});

describe('B. POST /customers: tên + điện thoại bắt buộc ở CẢ HAI lớp', () => {
  let app: INestApplication; let service: ReturnType<typeof makeService>;
  beforeEach(async () => { service = makeService(); app = await makeApp(service, bearerProvider({ 'customer.create': 'ALL' })); });
  afterEach(async () => { await app.close(); });

  it('FE chặn trước khi gửi: thiếu/rỗng/chỉ khoảng trắng/ký tự vô hình -> 0 yêu cầu', async () => {
    const f = bridge(app); const repo = fe.repo.createCustomerRepository({ env: ON, fetchImpl: f, local: {} });
    for (const bad of [{ phone: '0903123456' }, { name: 'ABC' }, { name: '   ', phone: '0903123456' }, { name: 'ABC', phone: ' ' }, { name: '​‍', phone: '0903123456' }, null]) {
      await expect(repo.create(bad as never)).rejects.toMatchObject({ kind: 'validation' });
    }
    expect(f.calls).toHaveLength(0);
  });
  it('BE độc lập từ chối khi bỏ qua FE: thiếu name / thiếu phone / rỗng -> 400, service.create không chạy', async () => {
    const hdr = { Authorization: 'Bearer tok-e-me' };
    for (const body of [{ phone: '0903123456' }, { name: 'Công ty ABC' }, { name: '', phone: '' }, { name: 'A', phone: '0903123456' }, {}]) {
      const res = await request(app.getHttpServer()).post('/api/v1/customers').set(hdr).send(body);
      expect(res.status).toBe(400); expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(service.create).not.toHaveBeenCalled();
  });
  it('tên + điện thoại hợp lệ: 201, FE ánh xạ về mô hình UI; body KHÔNG chứa owner/id/code; actor lấy từ token', async () => {
    const session = fakeSession('tok-e-me');
    const f = bridge(app);
    const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), f, { auth: session });
    const created = await api.create({ ...GOOD, owner: 'Hacker', ownerId: 'e-admin', id: 'x', code: 'KH-9' }, {});
    expect(created).toMatchObject({ id: NEW_ID, name: GOOD.name, phone: GOOD.phone });
    expect(Object.keys(JSON.parse(f.calls[0].init.body)).sort()).toEqual(['name', 'phone']);
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create.mock.calls[0][0]).toMatchObject({ actor: { employeeId: 'e-me' } });
    expect(session.revoked).toEqual([]);
  });
  it('FE cố gửi thêm owner qua gọi trực tiếp (bỏ qua adapter) -> BE 400 (forbidNonWhitelisted), không tạo', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/customers').set({ Authorization: 'Bearer tok-e-me' }).send({ ...GOOD, ownerId: 'e-admin' });
    expect(res.status).toBe(400); expect(service.create).not.toHaveBeenCalled();
  });
  it('400 thật từ BE (điện thoại sai định dạng) -> FE nhận ApiError 400 VALIDATION_FAILED, service.create không chạy', async () => {
    const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), bridge(app), { auth: fakeSession('tok-e-me') });
    await expect(api.create({ name: 'Công ty ABC', phone: 'abc' }, {})).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('C. 403 / 429 / 500 qua FE', () => {
  it('403 thật từ BE (token hợp lệ nhưng thiếu quyền customer.create): FE báo forbidden, KHÔNG hủy phiên, không ghi', async () => {
    const service = makeService(); const app = await makeApp(service, bearerProvider({ 'customer.read': 'ALL' }));
    try {
      const session = fakeSession('tok-e-me');
      const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), bridge(app), { auth: session });
      await expect(api.create(GOOD, {})).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(session.getState().status).toBe('AUTHENTICATED'); expect(session.revoked).toEqual([]);
      expect(service.create).not.toHaveBeenCalled();
      const repo = fe.repo.createCustomerRepository({ env: ON, fetchImpl: bridge(app, () => synthetic(403, 'FORBIDDEN')), local: {} });
      await expect(repo.create(GOOD)).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
    } finally { await app.close(); }
  });
  it('500 thật từ BE (service ném lỗi nội bộ): thông điệp chung, không lộ chi tiết; FE kind server + retryable, không tự thử lại', async () => {
    const service = makeService(); service.create.mockRejectedValue(new Error('secret-internal-detail'));
    const app = await makeApp(service, bearerProvider({ 'customer.create': 'ALL' }));
    try {
      const session = fakeSession('tok-e-me'); const f = bridge(app);
      const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), f, { auth: session });
      const err: any = await api.create(GOOD, {}).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
      expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain('secret-internal-detail');
      expect(f.calls).toHaveLength(1); expect(session.revoked).toEqual([]);
    } finally { await app.close(); }
  });
  it('429: backend KHÔNG có bộ giới hạn tốc độ cho /customers (design gap) — mã 429 chỉ mô phỏng ở tầng fetch; FE xử lý fail-closed, không thử lại tự động', async () => {
    const service = makeService(); const app = await makeApp(service, bearerProvider({ 'customer.create': 'ALL' }));
    try {
      const f = bridge(app, () => synthetic(429, 'TOO_MANY_REQUESTS'));
      const c = fe.ui.createCustomerApiUi({ env: ON, fetchImpl: f });
      const r = await c.submit(GOOD);
      expect(r.ok).toBe(false); expect(r.error).toMatchObject({ status: 429, retryable: true, denied: false }); // retryable = người dùng bấm thử lại thủ công; FE không tự thử lại
      expect(f.calls).toHaveLength(1); expect(service.create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

describe('D. Phiên cũ A -> phiên mới B (stale session) qua FE thật + BE thật', () => {
  it('phản hồi 200 muộn của A sau khi chuyển sang B: FE bỏ kết quả (StaleSessionError), không cập nhật dữ liệu; phiên B còn nguyên', async () => {
    const service = makeService(); const seen: string[] = []; const uniq = () => [...new Set(seen)];
    const app = await makeApp(service, bearerProvider({ 'customer.read': 'ALL' }, seen));
    try {
      const session = fakeSession('tok-a');
      let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
      const f = bridge(app, async () => { await gate; return undefined; });
      const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), f, { auth: session });
      const pending = api.list({}).catch((e: unknown) => e);
      await new Promise((r) => setImmediate(r));
      session.switchTo('tok-b'); release();
      const err: any = await pending;
      expect(err).toBeInstanceOf(fe.client.StaleSessionError);
      expect(uniq()).toEqual(['Bearer tok-a']); // BE chỉ thấy token A (đã gửi trước khi đổi)
      expect(session.getState().status).toBe('AUTHENTICATED'); expect(session.getAuthHeader()).toBe('Bearer tok-b');
      await expect(api.list({})).resolves.toMatchObject({ page: 1 });
      expect(uniq()).toEqual(['Bearer tok-a', 'Bearer tok-b']);
    } finally { await app.close(); }
  });
  it('401 muộn của A (token A đã bị BE coi hết hạn) sau khi chuyển sang B: KHÔNG hủy phiên B', async () => {
    const service = makeService();
    const app = await makeApp(service, bearerProvider({ 'customer.read': 'ALL' })); // chỉ chấp nhận tok-[a-z-]+, "tok-a1" (chữ số) => 401
    try {
      const session = fakeSession('tok-a1'); // BE: không khớp mẫu => 401
      let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
      const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), bridge(app, async () => { await gate; return undefined; }), { auth: session });
      const pending = api.list({}).catch((e: unknown) => e);
      await new Promise((r) => setImmediate(r));
      session.switchTo('tok-b'); release();
      expect(await pending).toMatchObject({ status: 401 });
      expect(session.revoked).toEqual(['Bearer tok-a1']);
      expect(session.getState().status).toBe('AUTHENTICATED'); expect(session.getAuthHeader()).toBe('Bearer tok-b');
    } finally { await app.close(); }
  });
  it('không có phiên xác thực (IDLE/token hỏng) với auth opt-in: AuthRequiredError TRƯỚC khi gọi mạng — backend không nhận gì', async () => {
    const service = makeService(); const app = await makeApp(service, bearerProvider({ 'customer.read': 'ALL' }));
    try {
      for (const t of [null]) {
        const f = bridge(app);
        const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), f, { auth: fakeSession(t) });
        await expect(api.list({})).rejects.toBeInstanceOf(fe.client.AuthRequiredError);
        expect(f.calls).toHaveLength(0);
      }
      expect(service.list).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

describe('E. Cầu nối auth UI->repo->client: kiểm HÀNH VI trên đúng nền (không đọc mã nguồn bằng toString)', () => {
  // KỲ VỌNG LEGACY CỦA NỀN NÀY (#142, cd31e82, CHƯA có #149): createCustomerRepository / createCustomerApiUi KHÔNG nhận/truyền `auth`.
  // => khi truyền phiên hợp lệ, các lớp trên client vẫn gọi mạng KHÔNG có Authorization; backend trả 401; repository trả CustomerRepoError
  //    unauthenticated/401/UNAUTHENTICATED; UI list.status='error' (denied, không data/fallback); không ghi local; phiên không bị hủy.
  // Kỳ vọng được khẳng định CỨNG, không chấp nhận "có hoặc không auth". Khi nền có #149 (38001cd), THAY kỳ vọng ở MỘT thay đổi riêng
  // (phải 200 + đúng Bearer của phiên); không được nới thành chấp nhận cả hai.
  const provider = (seen: string[]) => bearerProvider({ 'customer.read': 'ALL' } as Partial<Record<Permission, Scope>>, seen);
  const headerNames = (init: any) => Object.keys(init.headers || {}).map((h) => h.toLowerCase());

  it('đối chứng: client có phiên hợp lệ => 200 payload đúng + Bearer đúng phiên; không phiên => 401 và không Authorization', async () => {
    const service = makeService(); const seen: string[] = []; const app = await makeApp(service, provider(seen));
    try {
      const session = fakeSession('tok-e-me'); const f = bridge(app);
      const api = fe.client.createCustomerApi(fe.client.readApiConfig(ON), f, { auth: session });
      await expect(api.list({})).resolves.toMatchObject({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].init.headers.Authorization).toBe('Bearer tok-e-me');
      expect([...new Set(seen)]).toEqual(['Bearer tok-e-me']); // backend (2 guard đọc header) chỉ thấy đúng header của phiên
      expect(service.list).toHaveBeenCalledTimes(1);
      expect(session.revoked).toEqual([]);
      const none = bridge(app);
      await expect(fe.client.createCustomerApi(fe.client.readApiConfig(ON), none).list({})).rejects.toMatchObject({ status: 401 });
      expect(headerNames(none.calls[0].init)).not.toContain('authorization');
      expect(service.list).toHaveBeenCalledTimes(1); // ca không phiên không tới service
    } finally { await app.close(); }
  });

  it('LEGACY createCustomerRepository({ auth }) trên nền chưa có #149: 401 unauthenticated, không Authorization, không fallback local, phiên không bị hủy', async () => {
    const service = makeService(); const seen: string[] = []; const app = await makeApp(service, provider(seen));
    try {
      const session = fakeSession('tok-e-me'); const f = bridge(app);
      const local = { list: jest.fn(), create: jest.fn(), get: jest.fn(), update: jest.fn() };
      const repo = fe.repo.createCustomerRepository({ env: ON, fetchImpl: f, local, auth: session });
      expect(repo.mode).toBe('api');
      await expect(repo.list({ page: 1 })).rejects.toMatchObject({ name: 'CustomerRepoError', kind: 'unauthenticated', status: 401, code: 'UNAUTHENTICATED' });
      expect(f.calls).toHaveLength(1);
      expect(headerNames(f.calls[0].init)).not.toContain('authorization');
      expect([...new Set(seen)]).toEqual(['']); // backend không nhận Authorization nào
      expect(service.list).not.toHaveBeenCalled();
      for (const fn of Object.values(local)) expect(fn).not.toHaveBeenCalled();
      expect(session.revoked).toEqual([]); expect(session.getAuthHeader()).toBe('Bearer tok-e-me');
    } finally { await app.close(); }
  });

  it('LEGACY createCustomerApiUi({ auth }) trên nền chưa có #149: list.status=error đúng kind/status, không data, không Authorization, phiên không bị hủy', async () => {
    const service = makeService(); const seen: string[] = []; const app = await makeApp(service, provider(seen));
    try {
      const session = fakeSession('tok-e-me'); const f = bridge(app);
      const ui = fe.ui.createCustomerApiUi({ env: ON, fetchImpl: f, auth: session });
      await ui.load({ page: 1 });
      const list = ui.getState().list;
      expect(list.status).toBe('error');
      expect(list.items).toEqual([]); expect(list.paging).toBeNull();
      expect(list.error).toMatchObject({ kind: 'unauthenticated', status: 401, code: 'UNAUTHENTICATED', denied: true, retryable: false });
      expect(f.calls).toHaveLength(1);
      expect(headerNames(f.calls[0].init)).not.toContain('authorization');
      expect([...new Set(seen)]).toEqual(['']);
      expect(service.list).not.toHaveBeenCalled();
      expect(session.revoked).toEqual([]); expect(session.getAuthHeader()).toBe('Bearer tok-e-me');
    } finally { await app.close(); }
  });
});
