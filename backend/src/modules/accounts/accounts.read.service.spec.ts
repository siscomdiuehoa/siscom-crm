import type { ActorProvider, RequestCtx } from '../../common/auth/actor';
import type { AcctPrismaService } from '../../prisma/acct-prisma.service';
import { accountErrors } from './accounts.errors';
import { AccountsReadService } from './accounts.read.service';

// P1 Task 4: API đọc của trang Tài khoản. Chỉ người có access.approve (Quản trị CRM) được gọi; mọi truy vấn đi qua pool siscom_acct.
const ME = '11111111-1111-4111-8111-111111111111';
const ctx: RequestCtx = { actor: { employeeId: ME, departmentId: null } };
const provider = (allowed: boolean): ActorProvider => ({ resolve: async () => null, scopeFor: (_a, p) => (allowed && p === 'access.approve' ? 'ALL' : null) });

type Row = Record<string, unknown>;
const emp = (over: Row = {}): Row => ({
  id: '22222222-2222-4222-8222-222222222222', code: 'NV-0003', fullName: 'Nhân viên thử', email: 'thu@example.invalid', departmentId: 'd1', positionTitle: null,
  updatedAt: new Date('2026-11-23T01:02:03.456Z'), department: { name: 'Kinh doanh' }, roles: [{ role: { code: 'sales' } }], credential: { status: 'ACTIVE', mustChangePassword: false }, ...over,
});

function fakeAcct(rows: Row[] = [], total = rows.length, extra: { roles?: Row[]; departments?: Row[] } = {}) {
  const calls: { op: string; args: any }[] = [];
  const db: any = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    employee: {
      count: async (args: unknown) => { calls.push({ op: 'count', args }); return total; },
      findMany: async (args: unknown) => { calls.push({ op: 'findMany', args }); return rows; },
      findFirst: async (args: unknown) => { calls.push({ op: 'findFirst', args }); return rows[0] ?? null; },
    },
    role: { findMany: async (args: unknown) => { calls.push({ op: 'role.findMany', args }); return extra.roles ?? []; } },
    department: { findMany: async (args: unknown) => { calls.push({ op: 'department.findMany', args }); return extra.departments ?? []; } },
  };
  let clientCalls = 0;
  const acct = { available: true, client: () => { clientCalls += 1; return db; } } as unknown as AcctPrismaService;
  return { acct, calls, db, clientCalls: () => clientCalls };
}
const codeOf = async (p: Promise<unknown>): Promise<{ status: number; code: string }> => {
  try { await p; } catch (e) { const d = e as { getStatus(): number; code: string }; return { status: d.getStatus(), code: d.code }; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
};

describe('AccountsReadService — quyền và trạng thái bật', () => {
  it('không có access.approve => 403 FORBIDDEN và KHÔNG chạm database (cả 3 API đọc)', async () => {
    const f = fakeAcct([emp()]);
    const s = new AccountsReadService(f.acct, provider(false));
    expect(await codeOf(s.list(ctx, {}))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(await codeOf(s.roles(ctx))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(await codeOf(s.departments(ctx))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(f.clientCalls()).toBe(0);
    expect(f.calls).toEqual([]);
  });
  it('requireManager ném 403 khi thiếu quyền, im lặng khi có', () => {
    expect(() => new AccountsReadService(fakeAcct().acct, provider(false)).requireManager(ctx)).toThrow();
    expect(() => new AccountsReadService(fakeAcct().acct, provider(true)).requireManager(ctx)).not.toThrow();
  });
  it('pool quản lý tài khoản chưa bật => 503 ACCOUNT_ADMIN_UNAVAILABLE (người có quyền)', async () => {
    const acct = { available: false, client: () => { throw accountErrors.unavailable(); } } as unknown as AcctPrismaService;
    const s = new AccountsReadService(acct, provider(true));
    expect(await codeOf(s.list(ctx, {}))).toEqual({ status: 503, code: 'ACCOUNT_ADMIN_UNAVAILABLE' });
    expect(await codeOf(s.roles(ctx))).toEqual({ status: 503, code: 'ACCOUNT_ADMIN_UNAVAILABLE' });
  });
  it('thiếu quyền VÀ chưa bật => vẫn 403 (không lộ trạng thái máy chủ cho người không có quyền)', async () => {
    const acct = { available: false, client: () => { throw accountErrors.unavailable(); } } as unknown as AcctPrismaService;
    expect(await codeOf(new AccountsReadService(acct, provider(false)).list(ctx, {}))).toEqual({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('AccountsReadService.list — ánh xạ dòng', () => {
  const list = async (rows: Row[]) => (await new AccountsReadService(fakeAcct(rows).acct, provider(true)).list(ctx, {})).items;
  it('trả đúng hình AccountRow', async () => {
    expect((await list([emp()]))[0]).toEqual({
      id: '22222222-2222-4222-8222-222222222222', code: 'NV-0003', fullName: 'Nhân viên thử', email: 'thu@example.invalid', departmentId: 'd1', departmentName: 'Kinh doanh',
      positionTitle: null, roles: ['sales'], login: 'ACTIVE', isSystem: false, isSelf: false, updatedAt: '2026-11-23T01:02:03.456Z',
    });
  });
  it('4 trạng thái đăng nhập: ACTIVE / MUST_CHANGE / DISABLED / NONE', async () => {
    const got = await list([
      emp({ credential: { status: 'ACTIVE', mustChangePassword: false } }), emp({ credential: { status: 'ACTIVE', mustChangePassword: true } }),
      emp({ credential: { status: 'DISABLED', mustChangePassword: true } }), emp({ credential: null }),
    ]);
    expect(got.map((r) => r.login)).toEqual(['ACTIVE', 'MUST_CHANGE', 'DISABLED', 'NONE']);
  });
  it('isSystem = có vai trò admin; isSelf = chính người gọi; roles sắp xếp; không phòng ban => departmentName null', async () => {
    const got = await list([
      emp({ roles: [{ role: { code: 'admin' } }] }), emp({ id: ME }), emp({ roles: [{ role: { code: 'sales' } }, { role: { code: 'accountant' } }] }), emp({ departmentId: null, department: null, roles: [] }),
    ]);
    expect(got.map((r) => r.isSystem)).toEqual([true, false, false, false]);
    expect(got.map((r) => r.isSelf)).toEqual([false, true, false, false]);
    expect(got[2].roles).toEqual(['accountant', 'sales']);
    expect(got[3]).toMatchObject({ departmentId: null, departmentName: null, roles: [] });
  });
  it('KHÔNG bao giờ chọn cột bí mật của credential (chỉ status + mustChangePassword)', async () => {
    const f = fakeAcct([emp()]);
    await new AccountsReadService(f.acct, provider(true)).list(ctx, {});
    const sel = f.calls.find((c) => c.op === 'findMany')!.args.select;
    expect(sel.credential).toEqual({ select: { status: true, mustChangePassword: true } });
    expect(JSON.stringify(sel)).not.toMatch(/passwordHash|passwordParams|passwordAlgo|tokenVersion/);
  });
});

describe('AccountsReadService.list — bộ lọc và phân trang', () => {
  const run = async (q: Record<string, unknown>, total = 0) => {
    const f = fakeAcct([], total);
    const out = await new AccountsReadService(f.acct, provider(true)).list(ctx, q as never);
    return { out, where: f.calls.find((c) => c.op === 'count')!.args.where, find: f.calls.find((c) => c.op === 'findMany')?.args };
  };
  it('mặc định: chỉ nhân viên chưa xoá, trang 1, 50 dòng, sắp theo mã; count và rows dùng CÙNG where', async () => {
    const f = fakeAcct([emp()], 1);
    const out = await new AccountsReadService(f.acct, provider(true)).list(ctx, {});
    const count = f.calls.find((c) => c.op === 'count')!.args; const find = f.calls.find((c) => c.op === 'findMany')!.args;
    expect(count.where).toEqual({ AND: [{ deletedAt: null }] });
    expect(find.where).toEqual(count.where);
    expect({ skip: find.skip, take: find.take, orderBy: find.orderBy }).toEqual({ skip: 0, take: 50, orderBy: [{ code: 'asc' }] });
    expect({ page: out.page, pageSize: out.pageSize, total: out.total, totalPages: out.totalPages }).toEqual({ page: 1, pageSize: 50, total: 1, totalPages: 1 });
  });
  it('q: cắt khoảng trắng, tìm CHỨA không phân biệt hoa thường trên họ tên / email / mã', async () => {
    const { where } = await run({ q: '  thu  ' });
    expect(where.AND[1]).toEqual({ OR: [
      { fullName: { contains: 'thu', mode: 'insensitive' } }, { email: { contains: 'thu', mode: 'insensitive' } }, { code: { contains: 'thu', mode: 'insensitive' } },
    ] });
  });
  it('q sau khi cắt còn dưới 2 ký tự => 400 VALIDATION_FAILED, không truy vấn', async () => {
    const f = fakeAcct([emp()]);
    expect(await codeOf(new AccountsReadService(f.acct, provider(true)).list(ctx, { q: ' a ' }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(f.calls).toEqual([]);
  });
  it('role: lọc theo mã vai trò; mã ngoài 5 vai trò => 400', async () => {
    expect((await run({ role: 'sales' })).where.AND[1]).toEqual({ roles: { some: { role: { code: 'sales' } } } });
    expect(await codeOf(new AccountsReadService(fakeAcct().acct, provider(true)).list(ctx, { role: 'director' } as never))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });
  it('status: ACTIVE => credential đang dùng; DISABLED => credential đã khoá; giá trị khác => 400', async () => {
    expect((await run({ status: 'ACTIVE' })).where.AND[1]).toEqual({ credential: { is: { status: 'ACTIVE' } } });
    expect((await run({ status: 'DISABLED' })).where.AND[1]).toEqual({ credential: { is: { status: 'DISABLED' } } });
    expect(await codeOf(new AccountsReadService(fakeAcct().acct, provider(true)).list(ctx, { status: 'X' } as never))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });
  it('phân trang: page 3, pageSize 20 => skip 40; totalPages làm tròn lên; total 0 => không đọc rows', async () => {
    const a = await run({ page: 3, pageSize: 20 }, 41);
    expect({ skip: a.find.skip, take: a.find.take, totalPages: a.out.totalPages }).toEqual({ skip: 40, take: 20, totalPages: 3 });
    const b = await run({}, 0);
    expect(b.find).toBeUndefined();
    expect(b.out).toEqual({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 });
  });
  it('pageSize vượt 100 hoặc page < 1 => 400', async () => {
    const s = new AccountsReadService(fakeAcct().acct, provider(true));
    expect(await codeOf(s.list(ctx, { pageSize: 101 }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(await codeOf(s.list(ctx, { page: 0 }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });
});

describe('AccountsReadService — vai trò, phòng ban, rowById', () => {
  it('roles: 5 vai trò, grantable = 4 vai trò cấp được (không admin)', async () => {
    const f = fakeAcct([], 0, { roles: [
      { code: 'admin', name: 'Quản trị hệ thống (kỹ thuật)' }, { code: 'crm_admin', name: 'Quản trị CRM' }, { code: 'sales', name: 'Kinh doanh' },
      { code: 'technician', name: 'Kỹ thuật' }, { code: 'accountant', name: 'Kế toán' }, { code: 'director', name: 'Vai trò lạ' },
    ] });
    const got = await new AccountsReadService(f.acct, provider(true)).roles(ctx);
    expect(got.map((r) => r.code + ':' + r.grantable)).toEqual(['admin:false', 'crm_admin:true', 'sales:true', 'technician:true', 'accountant:true']);
  });
  it('departments: chỉ phòng đang hoạt động, sắp theo tên', async () => {
    const f = fakeAcct([], 0, { departments: [{ id: 'd1', name: 'Kinh doanh' }] });
    expect(await new AccountsReadService(f.acct, provider(true)).departments(ctx)).toEqual([{ id: 'd1', name: 'Kinh doanh' }]);
    expect(f.calls.find((c) => c.op === 'department.findMany')!.args).toMatchObject({ where: { isActive: true }, orderBy: [{ name: 'asc' }] });
  });
  it('rowById: thấy => AccountRow (isSelf theo selfId); không thấy / đã xoá => 404 ACCOUNT_NOT_FOUND', async () => {
    const f = fakeAcct([emp({ id: ME })]);
    const s = new AccountsReadService(f.acct, provider(true));
    expect((await s.rowById(f.db, ME, ME)).isSelf).toBe(true);
    expect(f.calls.find((c) => c.op === 'findFirst')!.args.where).toEqual({ id: ME, deletedAt: null });
    const none = fakeAcct([]);
    expect(await codeOf(new AccountsReadService(none.acct, provider(true)).rowById(none.db, ME, ME))).toEqual({ status: 404, code: 'ACCOUNT_NOT_FOUND' });
  });
});
