import { Client } from 'pg';
import { seedLookupCatalog, type SeedDb } from '../src/modules/lookups/lookups.catalog';
import { OPPORTUNITY_STAGE, OPPORTUNITY_TYPE, SALES_LOOKUP_CATALOG, SALES_LOOKUP_TYPES } from '../src/modules/lookups/sales.catalog';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ensureFixtures, makeCustomer, withAdmin, type Fixtures } from './helpers/fixtures';
import { assertTestConnection, createTestPrisma, testDatabase } from './helpers/test-db';

// Sales S4 — seed danh mục cơ hội trên PostgreSQL THẬT (DB thử của job). Seed bằng kết nối CHỦ SỞ HỮU (siscom_migrator khi đã tách role —
// lookup_item là dữ liệu nền, siscom_app chỉ SELECT) qua đúng hàm seedLookupCatalog mà CLI seed-lookups dùng.
// Phần "tuỳ chỉnh / ẩn rồi chạy lại" và chèn cơ hội nằm trong transaction và ROLLBACK (không để lại dấu); chỉ phần seed lần 1/2 là ghi thật
// (đúng việc CLI làm). Yêu cầu Owner: chạy lại không tạo trùng, không ghi đè nhãn/thứ tự đã tuỳ chỉnh, không bật lại mục đã ẩn.
class Rollback extends Error { constructor(readonly result: unknown) { super('rollback'); } }
type Row = { type: string; code: string; label_vi: string; sort_order: number; is_active: boolean; id: string };
type Raw = { $queryRawUnsafe: PrismaService['$queryRawUnsafe'] };

describe('Sales S4 — seed danh mục cơ hội trên PostgreSQL', () => {
  let prisma: PrismaService; let fx: Fixtures; let customerId = '';
  beforeAll(async () => {
    const t = createTestPrisma(); prisma = t.prisma; await assertTestConnection(prisma, t.name);
    fx = await ensureFixtures(prisma);
    customerId = (await makeCustomer(prisma, fx)).id;
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  const salesRows = (db: Raw) =>
    db.$queryRawUnsafe<Row[]>('SELECT id::text AS id, type, code, label_vi, sort_order, is_active FROM lookup_item WHERE type = ANY($1::text[]) ORDER BY type, sort_order', [...SALES_LOOKUP_TYPES]);
  const idOf = (rows: Row[], type: string, code: string) => (rows.find((r) => r.type === type && r.code === code) as Row).id;

  it('chạy 2 lần: đủ 4 giai đoạn / 3 loại / 9 lý do thua, lần 2 chèn 0, không trùng; nhãn và thứ tự đúng catalog', async () => {
    const r1 = await withAdmin((a) => seedLookupCatalog(a as unknown as SeedDb, SALES_LOOKUP_CATALOG));
    expect(r1.missing).toEqual([]); expect(r1.inserted + r1.existing).toBe(16);
    const r2 = await withAdmin((a) => seedLookupCatalog(a as unknown as SeedDb, SALES_LOOKUP_CATALOG));
    expect(r2).toMatchObject({ inserted: 0, existing: 16, missing: [], inactive: [] });
    const rows = await salesRows(prisma);
    // DB thử dùng chung: bộ test khác (Sales S6/S7) có thể đã thêm mục danh mục RIÊNG của test (mã T_*) vào cùng type => chỉ đếm mục THUỘC catalog.
    // "Không trùng" vẫn được kiểm bằng truy vấn GROUP BY (type, code) ở cuối ca này.
    const inCatalog = (r: Row) => SALES_LOOKUP_CATALOG.some((x) => x.type === r.type && x.code === r.code);
    const count = (t: string) => rows.filter((r) => r.type === t && inCatalog(r)).length;
    expect([count('opportunity_stage'), count('opportunity_type'), count('opportunity_lost_reason')]).toEqual([4, 3, 9]);
    for (const x of SALES_LOOKUP_CATALOG) expect(rows).toContainEqual(expect.objectContaining({ type: x.type, code: x.code, label_vi: x.labelVi, sort_order: x.sortOrder, is_active: true }));
    expect(await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM (SELECT type, code FROM lookup_item GROUP BY type, code HAVING count(*) > 1) d')).toEqual([{ n: 0 }]);
  });

  it('sửa nhãn/thứ tự + ẩn mục rồi chạy lại => giữ tuỳ chỉnh, vẫn ẩn; cơ hội gán mục vừa seed chạy được, gán MỚI mục đã ẩn bị trigger chặn (ROLLBACK)', async () => {
    const outcome = await withAdmin(async (a) => {
      try {
        await a.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("UPDATE lookup_item SET label_vi = 'Chào giá (đã sửa)', sort_order = 35 WHERE type = 'opportunity_stage' AND code = $1", OPPORTUNITY_STAGE.QUOTATION);
          await tx.$executeRawUnsafe("UPDATE lookup_item SET is_active = false WHERE (type = 'opportunity_stage' AND code = $1) OR (type = 'opportunity_lost_reason' AND code = 'NO_BUDGET')", OPPORTUNITY_STAGE.SURVEY);
          const r = await seedLookupCatalog(tx as unknown as SeedDb, SALES_LOOKUP_CATALOG);
          const rows = await salesRows(tx);
          const q = rows.find((x) => x.type === 'opportunity_stage' && x.code === OPPORTUNITY_STAGE.QUOTATION);
          const hidden = rows.filter((x) => !x.is_active).map((x) => x.type + '/' + x.code).sort();
          // Cơ hội với loại/giai đoạn vừa seed (đang hoạt động) => trigger fn_opportunity_lookups cho qua.
          const ins = (stage: string) => tx.$queryRawUnsafe<{ id: string; code: string }[]>(
            'INSERT INTO opportunity (customer_id, title, type_id, stage_id, owner_id, is_demo) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, true) RETURNING id::text AS id, code',
            customerId, 'S4 seed thử', idOf(rows, 'opportunity_type', OPPORTUNITY_TYPE.SUPPLY), stage, fx.empA);
          const ok = await ins(idOf(rows, 'opportunity_stage', OPPORTUNITY_STAGE.PROSPECTING));
          // Gán MỚI mục đã ẩn (INSERT, UPDATE đổi giai đoạn, UPDATE lý do thua) => bị chặn; SAVEPOINT để transaction còn dùng tiếp.
          const tryErr = async (fn: () => Promise<unknown>): Promise<string> => {
            await tx.$executeRawUnsafe('SAVEPOINT s4');
            try { await fn(); await tx.$executeRawUnsafe('RELEASE SAVEPOINT s4'); return 'OK'; } catch (e) { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT s4'); return String((e as Error).message); }
          };
          const surveyId = idOf(rows, 'opportunity_stage', OPPORTUNITY_STAGE.SURVEY);
          const lost = (code: string) => () => tx.$executeRawUnsafe("UPDATE opportunity SET status = 'LOST', closed_at = now(), lost_reason_id = $1::uuid WHERE id = $2::uuid", idOf(rows, 'opportunity_lost_reason', code), ok[0].id);
          const insHidden = await tryErr(() => ins(surveyId));
          const updHidden = await tryErr(() => tx.$executeRawUnsafe('UPDATE opportunity SET stage_id = $1::uuid WHERE id = $2::uuid', surveyId, ok[0].id));
          const lostHidden = await tryErr(lost('NO_BUDGET'));
          const lostOk = await tryErr(lost('OTHER'));
          throw new Rollback({ r, q, hidden, ok, insHidden, updHidden, lostHidden, lostOk });
        });
        throw new Error('transaction khong rollback');
      } catch (e) { if (e instanceof Rollback) return e.result; throw e; }
    });
    const o = outcome as { r: { inserted: number; inactive: string[] }; q: Row; hidden: string[]; ok: { code: string }[]; insHidden: string; updHidden: string; lostHidden: string; lostOk: string };
    expect(o.r.inserted).toBe(0);
    expect([...o.r.inactive].sort()).toEqual(['opportunity_lost_reason/NO_BUDGET', 'opportunity_stage/SURVEY']);
    expect(o.q).toMatchObject({ label_vi: 'Chào giá (đã sửa)', sort_order: 35, is_active: true });
    expect(o.hidden).toEqual(['opportunity_lost_reason/NO_BUDGET', 'opportunity_stage/SURVEY']);
    expect(o.ok[0].code).toMatch(/^CH-\d{4,}$/);
    for (const m of [o.insHidden, o.updHidden, o.lostHidden]) expect(m).toMatch(/khong hop le hoac da ngung su dung/);
    expect(o.lostOk).toBe('OK');
    // Sau ROLLBACK: tuỳ chỉnh không còn, mục không bị ẩn, không còn cơ hội thử.
    const after = await salesRows(prisma);
    expect(after.every((x) => x.is_active)).toBe(true);
    expect(after.find((x) => x.code === OPPORTUNITY_STAGE.QUOTATION)?.label_vi).toBe('Báo giá');
    expect(await prisma.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM opportunity WHERE title = 'S4 seed thử'")).toEqual([{ n: 0 }]);
  });

  it('siscom_app tạo được cơ hội với loại/giai đoạn đã seed (RETURNING); stage trỏ mục sai loại danh mục bị chặn (BEGIN … ROLLBACK)', async () => {
    const rows = await salesRows(prisma);
    const c = new Client({ connectionString: testDatabase().url }); await c.connect();
    try {
      await c.query('BEGIN');
      const sql = 'INSERT INTO opportunity (customer_id, title, type_id, stage_id, owner_id, is_project_linked, project_name, offer_scope, is_demo) VALUES ($1, $2, $3, $4, $5, true, $6, $7, true) RETURNING code';
      const r = await c.query(sql, [customerId, 'S4 app thử', idOf(rows, 'opportunity_type', OPPORTUNITY_TYPE.SUPPLY_INSTALLATION), idOf(rows, 'opportunity_stage', OPPORTUNITY_STAGE.NEGOTIATION), fx.empA, 'Nhà máy thử', 'Cung cấp + lắp đặt chiller']);
      expect(r.rows[0].code).toMatch(/^CH-\d{4,}$/);
      await c.query('SAVEPOINT s');
      const bad = await c.query(sql, [customerId, 'S4 app sai', idOf(rows, 'opportunity_type', OPPORTUNITY_TYPE.SUPPLY), idOf(rows, 'opportunity_type', OPPORTUNITY_TYPE.INSTALLATION), fx.empA, 'x', 'y'])
        .then(() => 'OK', (e: { code?: string; message: string }) => String(e.code) + ' ' + e.message);
      expect(bad).toMatch(/^23503 .*opportunity_stage khong hop le/);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.end(); }
  });
});
