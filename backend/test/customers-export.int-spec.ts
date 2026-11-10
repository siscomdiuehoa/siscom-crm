// FV-4A \u2014 POST /customers/export trên PostgreSQL thử (dữ liệu giả). Đặc tả FV4A bản 5 + đính chính 5.1 + checklist B1/B2.
// Số đo thật in ra với tiền tố "SO_DO" (không mặc định PASS cho thời gian).
import type { Permission, Scope } from '../src/common/auth/actor';
import { csvSafeServer } from '../src/modules/customers/export/csv-safe';
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createAdminTestPrisma, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, makeEmployee, uniq } from './helpers/fixtures';

const URL = '/api/v1/customers/export';
let prisma: PrismaService; let admin: PrismaService; let fx: Fixtures; let t: TestApp;
type Scopes = Partial<Record<Permission, Scope>>;
const EXP_ALL: Scopes = { 'customer.read': 'ALL', 'customer.export': 'ALL', 'contact.read': 'ALL', 'lookup.read': 'ALL' };
const SALES_NOEXP: Scopes = { 'customer.read': 'OWN', 'contact.read': 'OWN', 'lookup.read': 'ALL' };
const ACCT_NOEXP: Scopes = { 'customer.read': 'ALL', 'contact.read': 'ALL', 'lookup.read': 'ALL' };

// Mỗi nhóm test dùng nhân viên RIÊNG (hạn mức đếm theo nhân viên).
async function newActor(app: TestApp, scopes: Scopes, dept?: string): Promise<{ key: string; id: string }> {
  const e = await makeEmployee({ fullName: 'FV4A ' + uniq(), departmentId: dept ?? fx.d1 });
  const key = 'fv4a-' + e.id;
  app.actors!.presets[key] = { actor: { employeeId: e.id, departmentId: dept ?? fx.d1 }, scopes: { ...scopes } };
  app.exportAccess.scopes.set(e.id, { ...scopes });
  return { key, id: e.id };
}
const post = (app: TestApp, who: string, body: object) => as(app.app, who).post(URL, body).buffer(true);
const csvLines = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l.length > 0);
const auditOf = (id: string) => prisma.auditLog.findMany({ where: { actorId: id, action: 'customer.export' }, orderBy: { id: 'asc' }, select: { changes: true, requestId: true } });
const results = async (id: string) => (await auditOf(id)).map((r) => (r.changes as { result: string }).result);
const ms = () => Number(process.hrtime.bigint() / 1_000_000n);

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  admin = createAdminTestPrisma().prisma;
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx, { realAudit: true });
}, 60000);
afterAll(async () => {
  await admin.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_fv4a_slow_audit ON audit_log').catch(() => undefined);
  await t.app.close(); await prisma.$disconnect(); await admin.$disconnect();
});

describe('FV-4A quyền và phạm vi', () => {
  it('I-01/I-12: sale (customer.read OWN, không có customer.export) => 403; có nhật ký DENIED_PERMISSION', async () => {
    const s = await newActor(t, SALES_NOEXP);
    const r = await post(t, s.key, { mode: 'filtered' });
    expect(r.status).toBe(403);
    expect(r.body.error?.code ?? r.body.code).toBe('FORBIDDEN');
    expect(await results(s.id)).toEqual(['DENIED_PERMISSION']);
  });
  it('I-02: kế toán (customer.read ALL, không có export) => 403', async () => {
    const a = await newActor(t, ACCT_NOEXP);
    expect((await post(t, a.key, { mode: 'filtered' })).status).toBe(403);
  });
  it('I-03: ALL + lọc ownerId: số dòng = máy chủ; đúng MỘT dòng SUCCESS, rowCount khớp; nhật ký không chứa chuỗi tìm kiếm', async () => {
    const a = await newActor(t, EXP_ALL); const owner = await makeEmployee({ fullName: 'FV4A chu ' + uniq(), departmentId: fx.d2 });
    for (let i = 0; i < 3; i++) await makeCustomer(prisma, fx, { ownerId: owner.id, name: 'Khach BIMATTIM ' + uniq() });
    await makeCustomer(prisma, fx, { ownerId: owner.id, deleted: true });
    const r = await post(t, a.key, { mode: 'filtered', ownerId: owner.id, search: 'BIMATTIM' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(csvLines(r.text)).toHaveLength(1 + 3);
    expect(r.headers['x-export-rows']).toBe('3');
    const rows = await auditOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toMatchObject({ result: 'SUCCESS', rowCount: 3, scope: 'ALL', hasSearch: true, filters: { ownerId: true } });
    expect(rows[0]!.requestId).toBe(r.headers['x-export-id']);
    expect(JSON.stringify(rows[0]!.changes)).not.toMatch(/BIMATTIM|Khach/);
  });
  it('I-04: phạm vi HẸP hơn thắng (read ALL + export OWN; read OWN + export ALL)', async () => {
    const a = await newActor(t, { 'customer.read': 'ALL', 'customer.export': 'OWN', 'lookup.read': 'ALL' });
    const b = await newActor(t, { 'customer.read': 'OWN', 'customer.export': 'ALL', 'lookup.read': 'ALL' });
    for (const x of [a, b]) for (let i = 0; i < 2; i++) await makeCustomer(prisma, fx, { ownerId: x.id });
    for (const x of [a, b]) {
      const r = await post(t, x.key, { mode: 'filtered' });
      expect(r.status).toBe(200);
      expect(r.headers['x-export-rows']).toBe('2');
    }
  });
  it('I-05/I-06: selected bỏ qua id ngoài phạm vi / đã xoá / không tồn tại (không phân biệt); ownerId người khác khi OWN => 0', async () => {
    const a = await newActor(t, { 'customer.read': 'OWN', 'customer.export': 'OWN', 'lookup.read': 'ALL' });
    const mine = await makeCustomer(prisma, fx, { ownerId: a.id });
    const other = await makeCustomer(prisma, fx, { ownerId: fx.empC });
    const del = await makeCustomer(prisma, fx, { ownerId: a.id, deleted: true });
    const r = await post(t, a.key, { mode: 'selected', ids: [mine.id, other.id, del.id, '00000000-0000-4000-8000-000000000000'] });
    expect(r.status).toBe(200);
    expect([r.headers['x-export-rows'], r.headers['x-export-skipped']]).toEqual(['1', '3']);
    const r2 = await post(t, a.key, { mode: 'filtered', ownerId: fx.empC });
    expect(r2.headers['x-export-rows']).toBe('0');
  });
  it('U-05 (qua HTTP): trường lạ / ids sai => 400', async () => {
    const a = await newActor(t, EXP_ALL);
    for (const body of [{ mode: 'filtered', scope: 'ALL' }, { mode: 'filtered', pageSize: 100 }, { mode: 'filtered', ids: [fx.empA] }, { mode: 'selected' }, { mode: 'x' }, { mode: 'filtered', tier: 'KHONG_CO' }]) {
      expect({ body, status: (await post(t, a.key, body)).status }).toEqual({ body, status: 400 });
    }
  });
  it('I-19/I-20: phiên đã nạp quyền nhưng DB đã thu hồi / NV bị khoá => 403, không SUCCESS', async () => {
    const a = await newActor(t, EXP_ALL); await makeCustomer(prisma, fx, { ownerId: a.id });
    t.exportAccess.scopes.set(a.id, { 'customer.read': 'ALL' }); // gỡ export trong "DB"
    expect((await post(t, a.key, { mode: 'filtered', ownerId: a.id })).status).toBe(403);
    t.exportAccess.scopes.set(a.id, { ...EXP_ALL });
    await admin.employee.update({ where: { id: a.id }, data: { status: 'RESIGNED' } });
    expect((await post(t, a.key, { mode: 'filtered', ownerId: a.id })).status).toBe(403);
    expect(await results(a.id)).not.toContain('SUCCESS');
  });
});

describe('FV-4A giới hạn 5.000 dòng (D-E4: từ chối)', () => {
  it('I-07: 5.001 khách => 422, không CSV, nhật ký TOO_LARGE; 5.000 => 200 đủ 5.000 dòng', async () => {
    const a = await newActor(t, { 'customer.read': 'OWN', 'customer.export': 'OWN', 'lookup.read': 'ALL' });
    const base = { tierId: fx.tier.POTENTIAL as string, statusId: fx.status.POTENTIAL as string, ownerId: a.id, isDemo: true, createdById: fx.empA, updatedById: fx.empA };
    await prisma.customer.createMany({ data: Array.from({ length: 5001 }, (_, i) => ({ ...base, name: 'FV4A loat ' + i + ' ' + uniq() })) });
    const t0 = ms(); const r = await post(t, a.key, { mode: 'filtered' }); const dt = ms() - t0;
    console.log('SO_DO I-07 thoi_gian_5001_ms=' + dt);
    expect(r.status).toBe(422);
    expect(r.body.error?.code ?? r.body.code).toBe('EXPORT_TOO_LARGE');
    expect(r.headers['content-type']).not.toMatch(/csv/);
    expect(await results(a.id)).toEqual(['TOO_LARGE']);
    const one = await prisma.customer.findFirst({ where: { ownerId: a.id }, select: { id: true } });
    await prisma.customer.update({ where: { id: one!.id }, data: { deletedAt: new Date(), deletedById: fx.empA } });
    const t1 = ms(); const r2 = await post(t, a.key, { mode: 'filtered' }); console.log('SO_DO I-07 thoi_gian_5000_ms=' + (ms() - t1) + ' bytes=' + r2.text.length);
    expect(r2.status).toBe(200);
    expect(csvLines(r2.text)).toHaveLength(5001);
  }, 120000);
});

describe('FV-4A hạn mức và đồng thời', () => {
  it('I-27: 11 lượt tuần tự => 10 thành công, lượt 11 = 429 EXPORT_RATE_LIMITED + Retry-After', async () => {
    const a = await newActor(t, EXP_ALL);
    const st: number[] = [];
    for (let i = 0; i < 11; i++) st.push((await post(t, a.key, { mode: 'filtered', ownerId: a.id })).status);
    expect(st.slice(0, 10)).toEqual(Array(10).fill(200));
    const last = await post(t, a.key, { mode: 'filtered', ownerId: a.id });
    expect(st[10]).toBe(429);
    expect(last.body.error?.code ?? last.body.code).toBe('EXPORT_RATE_LIMITED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    expect((await results(a.id)).filter((x) => x === 'SUCCESS')).toHaveLength(10);
  }, 60000);
  it('I-15: 30 request đồng thời của một người => SUCCESS ≤ 10 và ≥ 1; số 200 = số SUCCESS; còn lại 429/503', async () => {
    const a = await newActor(t, EXP_ALL);
    const rs = await Promise.all(Array.from({ length: 30 }, () => post(t, a.key, { mode: 'filtered', ownerId: a.id })));
    const ok = rs.filter((r) => r.status === 200).length;
    const succ = (await results(a.id)).filter((x) => x === 'SUCCESS').length;
    console.log('SO_DO I-15 status=' + JSON.stringify(rs.map((r) => r.status).reduce<Record<number, number>>((m, s) => { m[s] = (m[s] ?? 0) + 1; return m; }, {})) + ' success=' + succ);
    expect(succ).toBeLessThanOrEqual(10); expect(succ).toBeGreaterThanOrEqual(1); expect(ok).toBe(succ);
    expect(rs.every((r) => [200, 429, 503].includes(r.status))).toBe(true);
  }, 60000);
  it('I-18: khoá theo người đang bị giữ => 429 EXPORT_IN_PROGRESS ngay (không chờ)', async () => {
    const a = await newActor(t, EXP_ALL);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${0x46563441}::int, hashtext(${a.id}::text))`;
      const t0 = ms(); const r = await post(t, a.key, { mode: 'filtered', ownerId: a.id }); const dt = ms() - t0;
      console.log('SO_DO I-18 phan_hoi_ms=' + dt);
      expect(r.status).toBe(429); expect(r.body.error?.code ?? r.body.code).toBe('EXPORT_IN_PROGRESS');
    }, { timeout: 20000 });
  }, 30000);
  it('I-28: đang có thay đổi RBAC (khoá độc quyền siscom.rbac) => 429 EXPORT_RBAC_BUSY ngay', async () => {
    const a = await newActor(t, EXP_ALL);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('siscom.rbac'))`;
      const t0 = ms(); const r = await post(t, a.key, { mode: 'filtered', ownerId: a.id }); const dt = ms() - t0;
      console.log('SO_DO I-28 phan_hoi_ms=' + dt);
      expect(r.status).toBe(429); expect(r.body.error?.code ?? r.body.code).toBe('EXPORT_RBAC_BUSY');
    }, { timeout: 20000 });
    expect(await results(a.id)).not.toContain('SUCCESS');
  }, 30000);
});

describe('FV-4A đường không thành công (trần 20) và lỗi ghi nhật ký', () => {
  it('I-23/I-13/I-25: 100 lần từ chối đồng thời rồi 30 lần tuần tự => mọi lần 403; dòng nhật ký ≤ 20', async () => {
    const s = await newActor(t, SALES_NOEXP);
    const rs = await Promise.all(Array.from({ length: 100 }, () => post(t, s.key, { mode: 'filtered' })));
    expect(rs.every((r) => r.status === 403)).toBe(true);
    for (let i = 0; i < 30; i++) expect((await post(t, s.key, { mode: 'filtered' })).status).toBe(403);
    const n = (await results(s.id)).length;
    console.log('SO_DO I-23 dong_nhat_ky_tu_choi=' + n);
    expect(n).toBeLessThanOrEqual(20); expect(n).toBeGreaterThanOrEqual(1);
  }, 60000);
  it('I-09/I-26: app mất quyền INSERT audit_log => xuất 500 không SUCCESS; từ chối vẫn 403', async () => {
    const a = await newActor(t, EXP_ALL); const s = await newActor(t, SALES_NOEXP);
    await makeCustomer(prisma, fx, { ownerId: a.id });
    await admin.$executeRawUnsafe('REVOKE INSERT ON audit_log FROM siscom_app');
    try {
      const r = await post(t, a.key, { mode: 'filtered', ownerId: a.id });
      expect(r.status).toBe(500); expect(r.headers['content-type']).not.toMatch(/csv/);
      expect((await post(t, s.key, { mode: 'filtered' })).status).toBe(403);
    } finally { await admin.$executeRawUnsafe('GRANT INSERT ON audit_log TO siscom_app'); }
    expect(await results(a.id)).not.toContain('SUCCESS');
  }, 30000);
});

describe('FV-4A nội dung CSV từ API thật', () => {
  it('I-11/I-40: giá trị V-CSV lưu trong DB => ô CSV = csvSafeServer(giá trị); prefixedCells trong nhật ký đúng', async () => {
    const a = await newActor(t, { 'customer.read': 'OWN', 'customer.export': 'OWN', 'lookup.read': 'ALL' });
    const BS = String.fromCharCode(92);
    const vals = ['=1+1', '-1-1', '+84 909 123 456', '0903123456', '0101234567', '1/2', 'KH-00012', '@SUM(A1)', 'Cong ty "ABC"', String.fromCharCode(0xA0) + '=1', String.fromCharCode(0xFF1D) + '1', 'a' + BS + 'b'];
    for (const v of vals) await prisma.customer.create({ data: { name: 'FV4A ' + uniq(), address: v, phone: null, tierId: fx.tier.POTENTIAL as string, statusId: fx.status.POTENTIAL as string, ownerId: a.id, isDemo: true, createdById: fx.empA, updatedById: fx.empA } });
    const r = await post(t, a.key, { mode: 'filtered' });
    expect(r.status).toBe(200);
    const body = csvLines(r.text).slice(1);
    const addrCol = 7; // Địa chỉ
    const got = body.map((l) => (l.match(/("(?:[^"]|"")*")/g) ?? [])[addrCol]!.slice(1, -1).replace(/""/g, '"')).sort();
    expect(got).toEqual(vals.map((v) => csvSafeServer(v)).sort());
    const pc = ((await auditOf(a.id))[0]!.changes as { prefixedCells: number }).prefixedCells;
    expect(pc).toBeGreaterThanOrEqual(vals.filter((v) => csvSafeServer(v) !== v).length);
  }, 30000);
});

describe('FV-4A thời hạn transaction và khoá RBAC (số đo thật)', () => {
  const slow = async (sec: number) => {
    await admin.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fv4a_slow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'customer.export' AND NEW.changes->>'result' = 'SUCCESS' THEN PERFORM pg_sleep(${sec}); END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_fv4a_slow_audit ON audit_log');
    await admin.$executeRawUnsafe('CREATE TRIGGER trg_fv4a_slow_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fv4a_slow_audit()');
  };
  const unslow = () => admin.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_fv4a_slow_audit ON audit_log');

  it('I-36: transaction_timeout (cấu hình thử 2 s) huỷ transaction xuất đang chạy; không SUCCESS; khoá được nhả', async () => {
    const t2 = await makeApp(prisma, fx, { realAudit: true, exportConfig: { transactionTimeoutMs: 2000, statementTimeoutMs: 15000 } });
    try {
      const a = await newActor(t2, EXP_ALL); await makeCustomer(prisma, fx, { ownerId: a.id });
      await slow(6);
      const t0 = ms(); const r = await post(t2, a.key, { mode: 'filtered', ownerId: a.id }); const dt = ms() - t0;
      console.log('SO_DO I-36 bi_huy_sau_ms=' + dt + ' status=' + r.status);
      expect(r.status).toBe(500);
      expect(dt).toBeLessThan(6000);
      const held = await admin.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = hashtext(${a.id}::text)::oid`;
      expect(held[0]!.n).toBe(0);
      expect(await results(a.id)).not.toContain('SUCCESS');
    } finally { await unslow(); await t2.app.close(); }
  }, 60000);

  it('I-39/I-29: lệnh đổi RBAC (khoá độc quyền siscom.rbac) CHỜ tới khi lượt xuất commit; đo thời gian chờ', async () => {
    const a = await newActor(t, EXP_ALL); await makeCustomer(prisma, fx, { ownerId: a.id });
    await slow(3);
    try {
      const pExport = post(t, a.key, { mode: 'filtered', ownerId: a.id }).then((r) => ({ r, end: ms() }));
      await new Promise((res) => setTimeout(res, 700));
      const t0 = ms();
      await admin.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('siscom.rbac'))`; }, { timeout: 30000, maxWait: 30000 });
      const waited = ms() - t0; const gotLockAt = ms();
      const { r, end } = await pExport;
      console.log('SO_DO I-39 cho_khoa_rbac_ms=' + waited + ' xuat_status=' + r.status + ' xuat_xong_truoc_khi_lay_khoa_ms=' + (gotLockAt - end));
      expect(r.status).toBe(200);
      expect(waited).toBeGreaterThan(1000); // phải CHỜ
      expect(end).toBeLessThanOrEqual(gotLockAt + 50); // xuất xong trước khi lệnh RBAC lấy được khoá
    } finally { await unslow(); }
  }, 60000);

  it('I-17: nhiều người cùng xuất (chậm 1 s) => có 503 EXPORT_BUSY; GET /customers của người khác vẫn < 1 s', async () => {
    const actors = await Promise.all(Array.from({ length: 6 }, () => newActor(t, EXP_ALL)));
    const reader = await newActor(t, EXP_ALL);
    await slow(1);
    try {
      const pAll = Promise.all(actors.flatMap((x) => [0, 1, 2].map(() => post(t, x.key, { mode: 'filtered', ownerId: x.id }))));
      await new Promise((res) => setTimeout(res, 300));
      const t0 = ms(); const g = await as(t.app, reader.key).get('/api/v1/customers?pageSize=5'); const dt = ms() - t0;
      const rs = await pAll;
      const by = rs.reduce<Record<number, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {});
      console.log('SO_DO I-17 status=' + JSON.stringify(by) + ' get_customers_ms=' + dt);
      expect(g.status).toBe(200); expect(dt).toBeLessThan(1000);
      expect(by[503] ?? 0).toBeGreaterThan(0);
      expect(by[200] ?? 0).toBeGreaterThan(0);
    } finally { await unslow(); }
  }, 60000);
});

// ───── Bổ sung 10/11/2026 (hoàn thiện bằng chứng): hai "tiến trình", ghi đồng thời quanh ngưỡng, khoá nhân viên qua trigger thật ─────
describe('FV-4A hai tiến trình (hai ứng dụng Nest, chung DB): chỉ khoá tư vấn của DB phân xử', () => {
  let t2: TestApp;
  beforeAll(async () => { t2 = await makeApp(prisma, fx, { realAudit: true }); }, 60000);
  afterAll(async () => { await t2.app.close(); });
  const share = (a: { key: string; id: string }, scopes: Scopes) => {
    t2.actors!.presets[a.key] = { actor: { employeeId: a.id, departmentId: fx.d1 }, scopes: { ...scopes } };
    t2.exportAccess.scopes.set(a.id, { ...scopes });
  };

  it('I-16: 8 lượt tuần tự rồi 2 × 15 request đồng thời qua HAI ứng dụng => tổng SUCCESS ≤ 10; số 200 = số SUCCESS', async () => {
    const a = await newActor(t, EXP_ALL); share(a, EXP_ALL);
    for (let i = 0; i < 8; i++) expect((await post(i % 2 ? t2 : t, a.key, { mode: 'filtered', ownerId: a.id })).status).toBe(200);
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => post(i % 2 ? t2 : t, a.key, { mode: 'filtered', ownerId: a.id })));
    const ok = 8 + rs.filter((r) => r.status === 200).length;
    const succ = (await results(a.id)).filter((x) => x === 'SUCCESS').length;
    const by = rs.reduce<Record<number, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {});
    console.log('SO_DO I-16 dong_thoi=' + JSON.stringify(by) + ' tong_success=' + succ);
    expect(succ).toBeLessThanOrEqual(10); expect(succ).toBeGreaterThanOrEqual(8); expect(ok).toBe(succ);
    expect(rs.every((r) => [200, 429, 503].includes(r.status))).toBe(true);
    // Đã đủ 10 thì lượt kế tiếp bị chặn hạn mức, kể cả qua ứng dụng thứ hai.
    if (succ === 10) expect((await post(t2, a.key, { mode: 'filtered', ownerId: a.id })).status).toBe(429);
  }, 90000);

  it('I-24: 2 × 50 lần từ chối đồng thời qua HAI ứng dụng => mọi lần 403; tổng dòng nhật ký không thành công ≤ 20', async () => {
    const s = await newActor(t, SALES_NOEXP); share(s, SALES_NOEXP);
    const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => post(i % 2 ? t2 : t, s.key, { mode: 'filtered' })));
    expect(rs.every((r) => r.status === 403)).toBe(true);
    for (let i = 0; i < 20; i++) expect((await post(i % 2 ? t2 : t, s.key, { mode: 'filtered' })).status).toBe(403);
    const n = (await results(s.id)).length;
    console.log('SO_DO I-24 dong_nhat_ky_tu_choi=' + n);
    expect(n).toBeLessThanOrEqual(20); expect(n).toBeGreaterThanOrEqual(1);
  }, 90000);
});

describe('FV-4A nhất quán khi dữ liệu / trạng thái đổi đồng thời', () => {
  it('I-21: ghi liên tục quanh ngưỡng 5.000 trong lúc xuất => mỗi phản hồi tự nhất quán (200: dòng CSV = X-Export-Rows = rowCount ≤ 5.000; 422: không có CSV)', async () => {
    const a = await newActor(t, { 'customer.read': 'OWN', 'customer.export': 'OWN', 'lookup.read': 'ALL' });
    const base = { tierId: fx.tier.POTENTIAL as string, statusId: fx.status.POTENTIAL as string, ownerId: a.id, isDemo: true, createdById: fx.empA, updatedById: fx.empA };
    await prisma.customer.createMany({ data: Array.from({ length: 4998 }, (_, i) => ({ ...base, name: 'FV4A nguong ' + i + ' ' + uniq() })) });
    let stop = false; let writes = 0;
    const writer = (async () => {
      while (!stop) {
        const tag = 'FV4A dao dong ' + uniq();
        await prisma.customer.createMany({ data: Array.from({ length: 4 }, (_, i) => ({ ...base, name: tag + ' ' + i })) }); // 5.002
        await new Promise((r) => setTimeout(r, 15));
        await prisma.customer.updateMany({ where: { ownerId: a.id, name: { startsWith: tag } }, data: { deletedAt: new Date(), deletedById: fx.empA } }); // 4.998
        await new Promise((r) => setTimeout(r, 15));
        writes++;
      }
    })();
    const seen: Record<number, number> = {}; let success = 0;
    try {
      for (let i = 0; i < 16 && success < 8; i++) {
        const r = await post(t, a.key, { mode: 'filtered' });
        seen[r.status] = (seen[r.status] ?? 0) + 1;
        if (r.status === 200) {
          success++;
          const n = csvLines(r.text).length - 1;
          expect(n).toBeLessThanOrEqual(5000);
          expect(String(n)).toBe(r.headers['x-export-rows']);
          const row = await prisma.auditLog.findFirst({ where: { requestId: r.headers['x-export-id'], action: 'customer.export' }, select: { changes: true } });
          expect((row!.changes as { rowCount: number; result: string })).toMatchObject({ rowCount: n, result: 'SUCCESS' });
        } else {
          expect(r.status).toBe(422);
          expect(r.headers['content-type']).not.toMatch(/csv/);
        }
      }
    } finally { stop = true; await writer; }
    console.log('SO_DO I-21 phan_hoi=' + JSON.stringify(seen) + ' vong_ghi=' + writes);
    expect(writes).toBeGreaterThan(3);
    expect((await results(a.id)).filter((x) => x === 'SUCCESS')).toHaveLength(success);
  }, 180000);

  it('I-31: khoá nhân viên (UPDATE employee.status, trigger thật lấy khoá siscom.rbac) trong lúc xuất => lệnh khoá CHỜ lượt xuất commit; lượt sau 403', async () => {
    const a = await newActor(t, EXP_ALL); await makeCustomer(prisma, fx, { ownerId: a.id });
    await admin.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fv4a_slow_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'customer.export' AND NEW.changes->>'result' = 'SUCCESS' THEN PERFORM pg_sleep(3); END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_fv4a_slow_audit ON audit_log');
    await admin.$executeRawUnsafe('CREATE TRIGGER trg_fv4a_slow_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fv4a_slow_audit()');
    try {
      const pExport = post(t, a.key, { mode: 'filtered', ownerId: a.id }).then((r) => ({ r, end: ms() }));
      await new Promise((res) => setTimeout(res, 700));
      const t0 = ms();
      await admin.employee.update({ where: { id: a.id }, data: { status: 'RESIGNED' } });
      const waited = ms() - t0; const lockedAt = ms();
      const { r, end } = await pExport;
      console.log('SO_DO I-31 lenh_khoa_NV_cho_ms=' + waited + ' xuat_status=' + r.status);
      expect(r.status).toBe(200);
      expect(waited).toBeGreaterThan(1000);
      expect(end).toBeLessThanOrEqual(lockedAt + 50);
    } finally { await admin.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_fv4a_slow_audit ON audit_log'); }
    expect((await post(t, a.key, { mode: 'filtered', ownerId: a.id })).status).toBe(403);
  }, 60000);
});
