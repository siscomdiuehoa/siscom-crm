import { DEFAULT_STATUS_CODE, DEFAULT_TIER_CODE } from '../customers/customers.defaults';
import { catalogProblems, LOOKUP_CATALOG, NEVER_SEED_DBS, SEED_ALLOW_ENV, seedLookupCatalog, seedTargetRefusal, type LookupSeedItem, type SeedDb } from './lookups.catalog';

describe('lookups.catalog — danh mục chuẩn D3', () => {
  it('catalog hợp lệ: type trong bảng trắng, code UPPER_SNAKE, (type, code) duy nhất, có loại bắt buộc và mặc định', () => {
    expect(catalogProblems()).toEqual([]);
    expect(LOOKUP_CATALOG.length).toBeGreaterThanOrEqual(13);
  });
  it('tier/status mặc định của customers.defaults.ts có trong catalog và là is_system', () => {
    const t = LOOKUP_CATALOG.find((x) => x.type === 'customer_tier' && x.code === DEFAULT_TIER_CODE);
    const s = LOOKUP_CATALOG.find((x) => x.type === 'customer_status' && x.code === DEFAULT_STATUS_CODE);
    expect(t?.isSystem).toBe(true); expect(s?.isSystem).toBe(true);
    expect(LOOKUP_CATALOG.filter((x) => x.isSystem)).toHaveLength(2);
  });
  it('catalogProblems bắt lỗi: code thường, trùng, type lạ, thiếu mặc định', () => {
    const bad: LookupSeedItem[] = [
      { type: 'customer_tier', code: 'vip', labelVi: 'x', sortOrder: 1, isSystem: false },
      { type: 'customer_tier', code: 'VIP', labelVi: 'x', sortOrder: 1, isSystem: false },
      { type: 'customer_tier', code: 'VIP', labelVi: ' ', sortOrder: 1.5, isSystem: false },
      { type: 'employee', code: 'A', labelVi: 'x', sortOrder: 1, isSystem: false },
    ];
    const p = catalogProblems(bad);
    expect(p.some((m) => m.includes('code sai dinh dang'))).toBe(true);
    expect(p.some((m) => m.includes('trung (type, code)'))).toBe(true);
    expect(p.some((m) => m.includes('type ngoai bang trang'))).toBe(true);
    expect(p.some((m) => m.includes('thieu tier mac dinh'))).toBe(true);
    expect(p.some((m) => m.includes('thieu loai bat buoc: source'))).toBe(true);
  });
});

describe('seedTargetRefusal — chỉ DB thử', () => {
  it('cho phép tên DB thử đúng regex; từ chối tên khác', () => {
    expect(seedTargetRefusal('siscom_crm_test_20261029_062004', {})).toBeNull();
    expect(seedTargetRefusal('siscom_crm_restore_20261101_010203', {})).toBeNull();
    expect(seedTargetRefusal('siscom_crm_demo', {})).toMatch(/khong phai database thu/);
    expect(seedTargetRefusal('siscom_crm_test_2026', {})).toMatch(/khong phai database thu/);
  });
  it('biến phê duyệt đúng tên mở cho DB ngoài regex, nhưng KHÔNG BAO GIỜ cho siscom_crm_dev / baseline đã khoá', () => {
    expect(seedTargetRefusal('siscom_crm_demo', { [SEED_ALLOW_ENV]: 'siscom_crm_demo' })).toBeNull();
    expect(seedTargetRefusal('siscom_crm_demo', { [SEED_ALLOW_ENV]: 'khac' })).toMatch(/TU CHOI/);
    for (const d of NEVER_SEED_DBS) expect(seedTargetRefusal(d, { [SEED_ALLOW_ENV]: d })).toMatch(/database chinh \/ baseline da khoa/);
  });
});

describe('seedLookupCatalog — idempotent (ON CONFLICT DO NOTHING)', () => {
  function fakeDb(existing: { type: string; code: string; isActive: boolean }[] = []) {
    const store = new Map(existing.map((x) => [x.type + '/' + x.code, x]));
    const createMany = jest.fn(async (a: { data: LookupSeedItem[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const d of a.data) { const k = d.type + '/' + d.code; if (!store.has(k)) { store.set(k, { type: d.type, code: d.code, isActive: true }); count++; } }
      return { count };
    });
    const findMany = jest.fn(async (a: { where: { OR: { type: string; code: string }[] } }) => a.where.OR.map((w) => store.get(w.type + '/' + w.code)).filter((x): x is { type: string; code: string; isActive: boolean } => !!x));
    return { db: { lookupItem: { createMany, findMany } } as SeedDb, createMany, store };
  }
  it('lần 1 chèn toàn bộ, lần 2 chèn 0 và không tạo trùng; luôn skipDuplicates', async () => {
    const f = fakeDb();
    const r1 = await seedLookupCatalog(f.db);
    expect(r1).toMatchObject({ total: LOOKUP_CATALOG.length, inserted: LOOKUP_CATALOG.length, existing: 0, missing: [], inactive: [], defaultsOk: true });
    const r2 = await seedLookupCatalog(f.db);
    expect(r2).toMatchObject({ inserted: 0, existing: LOOKUP_CATALOG.length, missing: [], defaultsOk: true });
    expect(f.store.size).toBe(LOOKUP_CATALOG.length);
    for (const c of f.createMany.mock.calls) expect(c[0].skipDuplicates).toBe(true);
    expect(r1.byType.customer_tier).toEqual({ total: 4, present: 4 });
    expect(r1.byType.source.total).toBe(5);
  });
  it('không sửa dòng có sẵn: mục đã is_active=false được giữ nguyên và báo inactive; mặc định inactive => defaultsOk=false', async () => {
    const f = fakeDb([{ type: 'customer_status', code: DEFAULT_STATUS_CODE, isActive: false }, { type: 'source', code: 'OTHER', isActive: false }]);
    const r = await seedLookupCatalog(f.db);
    expect(r.inserted).toBe(LOOKUP_CATALOG.length - 2);
    expect(r.inactive.sort()).toEqual(['customer_status/' + DEFAULT_STATUS_CODE, 'source/OTHER']);
    expect(r.defaultsOk).toBe(false);
    expect(f.store.get('source/OTHER')?.isActive).toBe(false);
  });
});
