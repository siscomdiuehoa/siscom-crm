import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACTOR_PROVIDER, Actor, ActorProvider, Permission, Scope } from '../../common/auth/actor';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupsModule } from '../lookups/lookups.module';
import { CustomersModule } from './customers.module';

// OVN01 (M01 authz retry) — bổ sung so với #131/access-control.http.spec.ts: ma trận OWN/DEPARTMENT/ALL ở mức HTTP,
// phạm vi truy vấn danh sách, quyền ghi hỗn hợp, đổi chủ sở hữu giữa hai request, token hết hạn, lỗi cấp quyền giữa chừng.
// Chỉ provider/prisma giả; không database, không .env, không kích hoạt auth routes.
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
const ME: Actor = { employeeId: 'e-me', departmentId: 'd1' };
type Method = 'get' | 'post' | 'patch' | 'delete';

const lk = (code = 'POTENTIAL') => ({ code, labelVi: code, isActive: true });
const owner = (id: string | null, dept: string | null) => (id === null ? null : { id, code: 'NV-' + id, fullName: id, departmentId: dept });
const row = (ownerId: string | null, dept: string | null, o: Record<string, unknown> = {}) => ({
  id: ID, code: 'KH-00001', name: 'Công ty ABC', shortName: 'ABC', taxId: null, address: null, phone: '0903123456', phoneE164: '+84903123456',
  email: null, website: null, note: null, tags: [], revenueVnd: 0n, revenueBasis: 'ESTIMATED', version: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), deletedAt: null, restoredAt: null,
  ownerId, tier: lk(), status: lk(), industry: null, source: null, province: null, owner: owner(ownerId, dept), ...o,
});

function makePrisma() {
  const customer = { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn(), updateMany: jest.fn() };
  const lookupItem = { findMany: jest.fn().mockResolvedValue([]) };
  const contact = { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), create: jest.fn() };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([{ id: ID }]), customer, lookupItem, contact };
  return { customer, lookupItem, contact, tx, $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
}
type P = ReturnType<typeof makePrisma>;
const noWrite = (p: P) => {
  for (const fn of [p.customer.create, p.customer.updateMany, p.contact.create, p.contact.updateMany]) expect(fn).not.toHaveBeenCalled();
};
const noDbTouch = (p: P) => {
  expect(p.$transaction).not.toHaveBeenCalled();
  for (const fn of [p.customer.findFirst, p.customer.findMany, p.customer.count]) expect(fn).not.toHaveBeenCalled();
  noWrite(p);
};
async function makeApp(prisma: unknown, provider: ActorProvider): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [CustomersModule, LookupsModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(ACTOR_PROVIDER).useValue(provider).compile();
  const app = mod.createNestApplication();
  app.useLogger(false);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
const call = (app: INestApplication, method: Method, url: string, body?: object, headers: Record<string, string> = {}) => {
  let r = (request(app.getHttpServer()) as any)[method](url);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return body ? r.send(body) : r;
};
type Granted = Partial<Record<Permission, Scope>>;
const withScopes = (granted: Granted, actor: Actor | null = ME, resolve?: ActorProvider['resolve']): ActorProvider => ({ resolve: resolve ?? (async () => actor), scopeFor: (_a, p) => granted[p] ?? null });
const URL_ID = '/api/v1/customers/' + ID;

describe('Ma trận phạm vi đọc OWN/DEPARTMENT/ALL ở mức HTTP (GET /customers/:id)', () => {
  const rows = {
    own: row('e-me', 'd1'),
    sameDeptOther: row('e-o', 'd1'),
    otherDept: row('e-x', 'd9'),
    orphan: row(null, null),
    ownerNoDept: row('e-y', null),
  };
  const expected: Record<Scope, Record<keyof typeof rows, number>> = {
    OWN: { own: 200, sameDeptOther: 404, otherDept: 404, orphan: 404, ownerNoDept: 404 },
    DEPARTMENT: { own: 200, sameDeptOther: 200, otherDept: 404, orphan: 404, ownerNoDept: 404 },
    ALL: { own: 200, sameDeptOther: 200, otherDept: 200, orphan: 200, ownerNoDept: 200 },
  };
  for (const scope of ['OWN', 'DEPARTMENT', 'ALL'] as Scope[]) {
    for (const k of Object.keys(rows) as (keyof typeof rows)[]) {
      it(`customer.read=${scope}, khách "${k}" -> ${expected[scope][k]}`, async () => {
        const prisma = makePrisma();
        prisma.customer.findFirst.mockResolvedValue(rows[k]);
        const app = await makeApp(prisma, withScopes({ 'customer.read': scope }));
        try {
          const res = await call(app, 'get', URL_ID);
          expect(res.status).toBe(expected[scope][k]);
          if (res.status === 404) expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND'); // không lộ "tồn tại nhưng không được xem"
          noWrite(prisma);
        } finally { await app.close(); }
      });
    }
  }
  it('DEPARTMENT mà actor không có phòng ban: không khớp null===null, khách cùng "không phòng ban" vẫn 404', async () => {
    const prisma = makePrisma();
    prisma.customer.findFirst.mockResolvedValue(rows.ownerNoDept);
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'DEPARTMENT' }, { employeeId: 'e-me', departmentId: null }));
    try {
      expect((await call(app, 'get', URL_ID)).status).toBe(404);
      prisma.customer.findFirst.mockResolvedValue(rows.sameDeptOther);
      expect((await call(app, 'get', URL_ID)).status).toBe(404);
    } finally { await app.close(); }
  });
  it('cross-department (đại diện cho cross-tenant; mô hình hiện chưa có tenant): actor phòng d9 không đọc được khách phòng d1 dù cùng ID', async () => {
    const prisma = makePrisma();
    prisma.customer.findFirst.mockResolvedValue(rows.own);
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'DEPARTMENT' }, { employeeId: 'e-z', departmentId: 'd9' }));
    try { expect((await call(app, 'get', URL_ID)).status).toBe(404); } finally { await app.close(); }
  });
});

describe('Phạm vi trong truy vấn danh sách — không bao giờ mở rộng bởi tham số request', () => {
  const listWhere = async (granted: Granted, url: string, actor: Actor = ME) => {
    const prisma = makePrisma();
    prisma.customer.count.mockResolvedValue(1);
    const app = await makeApp(prisma, withScopes(granted, actor));
    try {
      const res = await call(app, 'get', url);
      expect(res.status).toBe(200);
      return prisma.customer.count.mock.calls[0][0].where;
    } finally { await app.close(); }
  };
  it('OWN -> AND[{ownerId: actor}]; DEPARTMENT -> theo phòng của actor; ALL -> AND[{}]', async () => {
    expect((await listWhere({ 'customer.read': 'OWN' }, '/api/v1/customers')).AND).toEqual([{ ownerId: 'e-me' }]);
    expect((await listWhere({ 'customer.read': 'DEPARTMENT' }, '/api/v1/customers')).AND).toEqual([{ owner: { is: { departmentId: 'd1' } } }]);
    expect((await listWhere({ 'customer.read': 'ALL' }, '/api/v1/customers')).AND).toEqual([{}]);
  });
  it('DEPARTMENT mà actor không có phòng ban -> điều kiện rỗng-mặc-định (không khớp dòng nào)', async () => {
    const w = await listWhere({ 'customer.read': 'DEPARTMENT' }, '/api/v1/customers', { employeeId: 'e-me', departmentId: null });
    expect(w.AND).toEqual([{ id: { in: [] } }]);
  });
  it('OWN + ?ownerId=<người khác>: bộ lọc chỉ THU HẸP; ràng buộc ownerId=actor vẫn còn trong AND (không đọc được khách người khác)', async () => {
    const w = await listWhere({ 'customer.read': 'OWN' }, '/api/v1/customers?ownerId=' + OTHER_UUID);
    expect(w.ownerId).toBe(OTHER_UUID);
    expect(w.AND).toEqual([{ ownerId: 'e-me' }]);
  });
  it('deleted=only với read=ALL + restore=OWN: cả hai phạm vi đều áp (không mở rộng nhờ read=ALL)', async () => {
    const w = await listWhere({ 'customer.read': 'ALL', 'customer.restore': 'OWN' }, '/api/v1/customers?deleted=only');
    expect(w.AND).toEqual([{}, { ownerId: 'e-me' }]);
    expect(w.deletedAt).toEqual({ not: null });
  });
  it('deleted=only thiếu quyền restore -> 403, không truy vấn', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'ALL' }));
    try {
      expect((await call(app, 'get', '/api/v1/customers?deleted=only')).status).toBe(403);
      noDbTouch(prisma);
    } finally { await app.close(); }
  });
});

describe('Quyền ghi hỗn hợp: đọc được nhưng phạm vi ghi hẹp hơn -> 403 và không ghi', () => {
  const sameDeptOther = row('e-o', 'd1');
  const run = async (granted: Granted, method: Method, url: string, body?: object, found = sameDeptOther) => {
    const prisma = makePrisma();
    prisma.customer.findFirst.mockResolvedValue(found);
    const app = await makeApp(prisma, withScopes(granted));
    try {
      const res = await call(app, method, url, body);
      return { res, prisma };
    } finally { await app.close(); }
  };
  it('PATCH: read=ALL, update=OWN, khách người khác -> 403', async () => {
    const { res, prisma } = await run({ 'customer.read': 'ALL', 'customer.update': 'OWN' }, 'patch', URL_ID, { version: 1, note: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    noWrite(prisma);
  });
  it('PATCH: read=DEPARTMENT, update=OWN, khách cùng phòng khác chủ -> 403 (xem được ≠ sửa được)', async () => {
    const { res, prisma } = await run({ 'customer.read': 'DEPARTMENT', 'customer.update': 'OWN' }, 'patch', URL_ID, { version: 1, note: 'x' });
    expect(res.status).toBe(403);
    noWrite(prisma);
  });
  it('PATCH: read=ALL, update=ALL qua được phạm vi (tới kiểm tra version -> 409), vẫn không ghi khi version cũ', async () => {
    const { res, prisma } = await run({ 'customer.read': 'ALL', 'customer.update': 'ALL' }, 'patch', URL_ID, { version: 5, note: 'x' });
    expect(res.status).toBe(409);
    noWrite(prisma);
  });
  it('DELETE: read=ALL, delete=OWN, khách người khác -> 403 trước khi gọi kiểm tra liên kết/ghi', async () => {
    const { res, prisma } = await run({ 'customer.read': 'ALL', 'customer.delete': 'OWN' }, 'delete', URL_ID);
    expect(res.status).toBe(403);
    noWrite(prisma);
  });
  it('RESTORE: read=ALL, restore=OWN, khách đã xóa của người khác -> 403', async () => {
    const { res, prisma } = await run({ 'customer.read': 'ALL', 'customer.restore': 'OWN' }, 'post', URL_ID + '/restore', undefined, row('e-o', 'd1', { deletedAt: new Date() }));
    expect(res.status).toBe(403);
    noWrite(prisma);
  });
  it('CONTACT create: read=ALL, update=OWN, contact.create=ALL, khách người khác -> không tạo liên hệ', async () => {
    const { res, prisma } = await run({ 'customer.read': 'ALL', 'customer.update': 'OWN', 'contact.create': 'ALL' }, 'post', URL_ID + '/contacts', { fullName: 'A', phone: '0903123456' });
    // Hợp đồng: khách TRONG phạm vi đọc nhưng NGOÀI phạm vi ghi -> 403 FORBIDDEN (customers.contacts.service.ts: create(), nhánh forbidden;
    // customers.contacts.service.spec.ts:95). Khác 404 (chỉ dành cho khách ngoài phạm vi ĐỌC / không tồn tại).
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    noWrite(prisma);
  });
  it('CONTACT create: read=OWN, khách người khác (ngoài phạm vi đọc) -> 404 CUSTOMER_NOT_FOUND, không lộ khách, không ghi', async () => {
    const { res, prisma } = await run({ 'customer.read': 'OWN', 'customer.update': 'OWN', 'contact.create': 'ALL' }, 'post', URL_ID + '/contacts', { fullName: 'A', phone: '0903123456' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/KH-00001|Công ty ABC|e-o/);
    noWrite(prisma);
  });
});

describe('Đổi chủ sở hữu giữa hai request: quyền theo trạng thái HIỆN TẠI, không cache', () => {
  it('OWN: đang là chủ -> 200; sau khi chuyển cho người khác -> 404; chuyển lại -> 200', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'OWN' }));
    try {
      prisma.customer.findFirst.mockResolvedValue(row('e-me', 'd1'));
      expect((await call(app, 'get', URL_ID)).status).toBe(200);
      prisma.customer.findFirst.mockResolvedValue(row('e-o', 'd1'));
      expect((await call(app, 'get', URL_ID)).status).toBe(404);
      prisma.customer.findFirst.mockResolvedValue(row('e-me', 'd1'));
      expect((await call(app, 'get', URL_ID)).status).toBe(200);
    } finally { await app.close(); }
  });
  it('DEPARTMENT: chủ chuyển sang phòng khác hoặc bị gỡ chủ -> 404', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'DEPARTMENT' }));
    try {
      prisma.customer.findFirst.mockResolvedValue(row('e-o', 'd1'));
      expect((await call(app, 'get', URL_ID)).status).toBe(200);
      prisma.customer.findFirst.mockResolvedValue(row('e-o', 'd9'));
      expect((await call(app, 'get', URL_ID)).status).toBe(404);
      prisma.customer.findFirst.mockResolvedValue(row(null, null));
      expect((await call(app, 'get', URL_ID)).status).toBe(404);
    } finally { await app.close(); }
  });
  it('chủ cũ mất quyền ghi ngay: PATCH sau khi khách đổi chủ -> 404, không ghi', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'OWN', 'customer.update': 'OWN' }));
    try {
      prisma.customer.findFirst.mockResolvedValue(row('e-o', 'd1'));
      expect((await call(app, 'patch', URL_ID, { version: 1, note: 'x' })).status).toBe(404);
      noWrite(prisma);
    } finally { await app.close(); }
  });
  it('body PATCH cố đổi ownerId (tự gán/chiếm khách) -> 400, không chạm DB', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, withScopes({ 'customer.read': 'ALL', 'customer.update': 'ALL' }));
    try {
      expect((await call(app, 'patch', URL_ID, { version: 1, ownerId: 'e-me' })).status).toBe(400);
      noDbTouch(prisma);
    } finally { await app.close(); }
  });
});

describe('Token hết hạn/không hợp lệ: provider trả null theo từng request, không rò trạng thái giữa request', () => {
  const tokenProvider = (): ActorProvider => ({
    resolve: async (req) => {
      const h = String(req.headers.authorization ?? '');
      if (h === 'Bearer valid') return ME;
      if (h === 'Bearer boom') throw new Error('jwt secret=hunter2 lookup failed');
      return null; // hết hạn / rác / thiếu
    },
    scopeFor: () => 'ALL',
  });
  it('valid -> 200; expired -> 401; valid lại -> 200; header giả actor kèm token hết hạn vẫn 401; DB chỉ bị chạm bởi request hợp lệ', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, tokenProvider());
    try {
      expect((await call(app, 'get', '/api/v1/customers', undefined, { Authorization: 'Bearer valid' })).status).toBe(200);
      const expired = await call(app, 'get', '/api/v1/customers', undefined, { Authorization: 'Bearer expired', 'x-actor-id': 'e-me', 'x-employee-id': 'e-me' });
      expect(expired.status).toBe(401);
      expect(expired.body.error.code).toBe('UNAUTHENTICATED');
      expect((await call(app, 'get', '/api/v1/customers', undefined, { Authorization: 'Bearer valid' })).status).toBe(200);
      expect(prisma.customer.count).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });
  it('token hết hạn trên mọi route ghi -> 401, không mở transaction, không ghi', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, tokenProvider());
    const h = { Authorization: 'Bearer expired' };
    try {
      expect((await call(app, 'post', '/api/v1/customers', { name: 'Công ty A', phone: '0903123456' }, h)).status).toBe(401);
      expect((await call(app, 'patch', URL_ID, { version: 1, note: 'x' }, h)).status).toBe(401);
      expect((await call(app, 'delete', URL_ID, undefined, h)).status).toBe(401);
      expect((await call(app, 'post', URL_ID + '/restore', undefined, h)).status).toBe(401);
      expect((await call(app, 'post', URL_ID + '/contacts', { fullName: 'A', phone: '0903123456' }, h)).status).toBe(401);
      noDbTouch(prisma);
    } finally { await app.close(); }
  });
  it('lỗi hạ tầng khi xác minh token -> 500 chung, không lộ nội dung lỗi/secret, không bị hiểu thành 401 hay cho qua', async () => {
    const prisma = makePrisma();
    const app = await makeApp(prisma, tokenProvider());
    try {
      const res = await call(app, 'get', '/api/v1/customers', undefined, { Authorization: 'Bearer boom' });
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|secret|lookup failed/);
      noDbTouch(prisma);
    } finally { await app.close(); }
  });
});

describe('Lỗi cấp quyền GIỮA CHỪNG (guard qua, service hỏi lại) -> fail-closed, không ghi', () => {
  // scopeFor trả ALL ở lần hỏi đầu (guard) rồi đổi hành vi ở các lần sau (service) — mô phỏng thu hồi/lỗi tra cứu giữa request.
  const flaky = (after: 'throw' | 'null' | 'bogus', onlyPerm?: Permission): ActorProvider => {
    const calls = new Map<Permission, number>();
    return {
      resolve: async () => ME,
      scopeFor: (_a, p) => {
        const n = (calls.get(p) ?? 0) + 1;
        calls.set(p, n);
        if (n === 1 || (onlyPerm && p !== onlyPerm)) return 'ALL';
        if (after === 'throw') throw new Error('perm store down password=hunter2');
        if (after === 'null') return null;
        return 'ADMIN' as unknown as Scope;
      },
    };
  };
  const cases: { name: string; method: Method; url: string; body?: object; found?: ReturnType<typeof row> }[] = [
    { name: 'GET :id', method: 'get', url: URL_ID },
    { name: 'GET list', method: 'get', url: '/api/v1/customers' },
    { name: 'PATCH', method: 'patch', url: URL_ID, body: { version: 1, note: 'x' } },
    { name: 'DELETE', method: 'delete', url: URL_ID },
    { name: 'RESTORE', method: 'post', url: URL_ID + '/restore', found: row('e-me', 'd1', { deletedAt: new Date() }) },
    { name: 'POST', method: 'post', url: '/api/v1/customers', body: { name: 'Công ty A', phone: '0903123456' } },
    { name: 'CONTACT create', method: 'post', url: URL_ID + '/contacts', body: { fullName: 'A', phone: '0903123456' } },
    { name: 'CONTACT list', method: 'get', url: URL_ID + '/contacts' },
  ];
  // Scope lạ (ngoài ALL/DEPARTMENT/OWN) => inScope() = false (scope.ts, fail-closed): route theo :id che sự tồn tại bằng 404 CUSTOMER_NOT_FOUND;
  // POST /customers (scope !== 'ALL') từ chối 403 FORBIDDEN; GET list trả tập rỗng 200. Không bao giờ 500, không ghi.
  const invalidScope = (name: string): { status: number; code?: string } =>
    name === 'GET list' ? { status: 200 } : name === 'POST' ? { status: 403, code: 'FORBIDDEN' } : { status: 404, code: 'CUSTOMER_NOT_FOUND' };
  for (const c of cases) {
    it(`${c.name}: scopeFor ném lỗi ở lần hỏi lại -> 500 chung, không lộ nội dung, không ghi`, async () => {
      const prisma = makePrisma();
      prisma.customer.findFirst.mockResolvedValue(c.found ?? row('e-me', 'd1'));
      const app = await makeApp(prisma, flaky('throw'));
      try {
        const res = await call(app, c.method, c.url, c.body);
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/hunter2|perm store/);
        noWrite(prisma);
      } finally { await app.close(); }
    });
    it(`${c.name}: scopeFor trả null (thu hồi) ở lần hỏi lại -> 403, không ghi`, async () => {
      const prisma = makePrisma();
      prisma.customer.findFirst.mockResolvedValue(c.found ?? row('e-me', 'd1'));
      const app = await makeApp(prisma, flaky('null'));
      try {
        const res = await call(app, c.method, c.url, c.body);
        expect(res.status).toBe(403);
        noWrite(prisma);
      } finally { await app.close(); }
    });
    it(`${c.name}: scopeFor trả giá trị lạ ở lần hỏi lại -> không bao giờ 2xx, không ghi`, async () => {
      const prisma = makePrisma();
      prisma.customer.findFirst.mockResolvedValue(c.found ?? row('e-me', 'd1'));
      const app = await makeApp(prisma, flaky('bogus'));
      try {
        const res = await call(app, c.method, c.url, c.body);
        if (c.name === 'GET list') { // danh sách: scope lạ => điều kiện "không khớp dòng nào" (fail-closed bằng tập rỗng, không lộ dữ liệu)
          expect(res.status).toBe(200);
          expect(prisma.customer.count.mock.calls[0][0].where.AND).toEqual([{ id: { in: [] } }]);
        } else {
          const want = invalidScope(c.name);
          expect(res.status).not.toBe(500);
          expect(res.status).toBe(want.status);
          expect(res.body.error.code).toBe(want.code);
          expect(JSON.stringify(res.body)).not.toMatch(/KH-00001|Công ty ABC/);
        }
        noWrite(prisma);
      } finally { await app.close(); }
    });
  }
});
