import { catalogProblems, LOOKUP_CATALOG, LOOKUP_CODE_RE, SEED_ALLOWED_TYPES, seedLookupCatalog, type LookupSeedItem, type SeedDb } from './lookups.catalog';
import { LOOKUP_ALLOWED_TYPES } from './lookups.service';
import { OPPORTUNITY_STAGE, OPPORTUNITY_STAGE_DEFAULT_PROBABILITY, OPPORTUNITY_TYPE, SALES_LOOKUP_CATALOG, SALES_LOOKUP_TYPES, salesCatalogProblems } from './sales.catalog';

// Sales S4 — danh mục cơ hội (docs/SALES_DESIGN.md §4.2, §4.3). Tên type phải khớp trigger fn_opportunity_lookups (migration S2).
const of = (t: string) => SALES_LOOKUP_CATALOG.filter((x) => x.type === t).sort((a, b) => a.sortOrder - b.sortOrder);

describe('sales.catalog — nội dung theo đặc tả', () => {
  it('đúng 3 type Sales, đúng tên trigger S2 dùng; nằm trong LOOKUP_CATALOG (cùng lệnh seed)', () => {
    expect([...SALES_LOOKUP_TYPES].sort()).toEqual(['opportunity_lost_reason', 'opportunity_stage', 'opportunity_type']);
    for (const x of SALES_LOOKUP_CATALOG) expect(LOOKUP_CATALOG).toContainEqual(x);
    expect(SALES_LOOKUP_CATALOG).toHaveLength(4 + 3 + 9);
    expect(catalogProblems()).toEqual([]);
  });
  it('giai đoạn: Tiếp cận 10, Khảo sát 25, Báo giá 45, Đàm phán 70 (thứ tự hiển thị đúng; không có Thắng/Thua)', () => {
    expect(of('opportunity_stage').map((x) => [x.labelVi, OPPORTUNITY_STAGE_DEFAULT_PROBABILITY[x.code]])).toEqual([
      ['Tiếp cận', 10], ['Khảo sát', 25], ['Báo giá', 45], ['Đàm phán', 70],
    ]);
    expect(of('opportunity_stage').every((x) => x.isSystem)).toBe(true);
    expect(Object.isFrozen(OPPORTUNITY_STAGE_DEFAULT_PROBABILITY)).toBe(true);
    expect(OPPORTUNITY_STAGE_DEFAULT_PROBABILITY[OPPORTUNITY_STAGE.QUOTATION]).toBe(45);
  });
  it('loại: đúng 3 loại [C1], không thêm loại; 2 loại có thi công là is_system (R-S3 ở S7)', () => {
    expect(of('opportunity_type').map((x) => x.labelVi)).toEqual(['Cung cấp thiết bị, vật tư', 'Thi công', 'Cung cấp và thi công']);
    expect(of('opportunity_type').filter((x) => x.isSystem).map((x) => x.code).sort()).toEqual([OPPORTUNITY_TYPE.INSTALLATION, OPPORTUNITY_TYPE.SUPPLY_INSTALLATION].sort());
  });
  it('lý do thua: đúng 9 lý do §4.3 theo thứ tự, "Khác (kèm ghi chú)" ở cuối', () => {
    expect(of('opportunity_lost_reason').map((x) => x.labelVi)).toEqual([
      'Giá cao hơn đối thủ', 'Khách chọn đối thủ khác', 'Khách không phản hồi', 'Khách hủy dự án/nhu cầu', 'Khách không đủ ngân sách',
      'Không đáp ứng tiến độ giao hàng/thi công', 'Không thống nhất điều kiện thanh toán/hợp đồng', 'SISCOM chủ động không tiếp tục theo đuổi', 'Khác (kèm ghi chú)',
    ]);
    expect(of('opportunity_lost_reason').every((x) => !x.isSystem)).toBe(true);
  });
  it('mã UPPER_SNAKE (ck_lookup_code_fmt), ≤60, duy nhất theo type; nhãn ≤200; sortOrder không trùng trong type', () => {
    for (const t of SALES_LOOKUP_TYPES) {
      const xs = of(t);
      for (const x of xs) { expect(x.code).toMatch(LOOKUP_CODE_RE); expect(x.code.length).toBeLessThanOrEqual(60); expect(x.labelVi.length).toBeLessThanOrEqual(200); }
      expect(new Set(xs.map((x) => x.code)).size).toBe(xs.length);
      expect(new Set(xs.map((x) => x.sortOrder)).size).toBe(xs.length);
    }
  });
  it('S4 KHÔNG mở type Sales qua GET /lookups (API đọc thuộc S6/S10); chỉ được phép seed', () => {
    for (const t of SALES_LOOKUP_TYPES) { expect(LOOKUP_ALLOWED_TYPES).not.toContain(t); expect(SEED_ALLOWED_TYPES).toContain(t); }
  });
  it('salesCatalogProblems bắt: thiếu type, giai đoạn không có xác suất, xác suất thừa, thiếu mã loại', () => {
    const noSurvey = SALES_LOOKUP_CATALOG.filter((x) => !(x.type === 'opportunity_stage' && x.code === OPPORTUNITY_STAGE.SURVEY));
    const extra: LookupSeedItem = { type: 'opportunity_stage', code: 'DESIGN', labelVi: 'Thiết kế', sortOrder: 15, isSystem: false };
    const noType = SALES_LOOKUP_CATALOG.filter((x) => x.type !== 'opportunity_lost_reason' && x.code !== OPPORTUNITY_TYPE.INSTALLATION);
    expect(salesCatalogProblems(noSurvey)).toContain('xac suat cho giai doan khong co trong catalog: SURVEY');
    expect(salesCatalogProblems([...SALES_LOOKUP_CATALOG, extra])).toContain('giai doan khong co xac suat mac dinh: DESIGN');
    expect(salesCatalogProblems(noType)).toEqual(expect.arrayContaining(['thieu loai Sales: opportunity_lost_reason', 'thieu loai co hoi: INSTALLATION']));
    expect(salesCatalogProblems(SALES_LOOKUP_CATALOG)).toEqual([]);
  });
});

// Yêu cầu Owner: chạy lại không tạo trùng, không ghi đè nhãn/thứ tự đã tuỳ chỉnh, không bật lại mục đã ẩn. Giả lập ON CONFLICT DO NOTHING
// (kho lưu cả nhãn/thứ tự/is_active). Kiểm thật trên PostgreSQL: test/sales-lookups.int-spec.ts.
describe('seedLookupCatalog — danh mục Sales: chạy lại an toàn', () => {
  type Row = { type: string; code: string; labelVi: string; sortOrder: number; isActive: boolean };
  function fakeDb() {
    const store = new Map<string, Row>();
    const db: SeedDb = { lookupItem: {
      createMany: async (a) => { let count = 0; for (const d of a.data) { const k = d.type + '/' + d.code; if (!store.has(k)) { store.set(k, { type: d.type, code: d.code, labelVi: d.labelVi, sortOrder: d.sortOrder, isActive: true }); count++; } } return { count }; },
      findMany: async (a) => a.where.OR.map((w) => store.get(w.type + '/' + w.code)).filter((x): x is Row => !!x).map(({ type, code, isActive }) => ({ type, code, isActive })),
    } };
    return { db, store };
  }
  it('chạy 2 lần: lần 2 chèn 0, không trùng; sửa nhãn/thứ tự + ẩn mục rồi chạy lại => giữ nguyên, báo inactive', async () => {
    const f = fakeDb();
    const r1 = await seedLookupCatalog(f.db, SALES_LOOKUP_CATALOG);
    expect(r1).toMatchObject({ inserted: 16, existing: 0, missing: [], inactive: [] });
    expect(r1.byType).toEqual({ opportunity_stage: { total: 4, present: 4 }, opportunity_type: { total: 3, present: 3 }, opportunity_lost_reason: { total: 9, present: 9 } });
    expect((await seedLookupCatalog(f.db, SALES_LOOKUP_CATALOG)).inserted).toBe(0);
    expect(f.store.size).toBe(16);
    const q = f.store.get('opportunity_stage/QUOTATION') as Row; q.labelVi = 'Chào giá'; q.sortOrder = 35;
    (f.store.get('opportunity_lost_reason/NO_BUDGET') as Row).isActive = false;
    const r3 = await seedLookupCatalog(f.db, SALES_LOOKUP_CATALOG);
    expect(r3).toMatchObject({ inserted: 0, existing: 16, missing: [], inactive: ['opportunity_lost_reason/NO_BUDGET'] });
    expect(f.store.get('opportunity_stage/QUOTATION')).toMatchObject({ labelVi: 'Chào giá', sortOrder: 35, isActive: true });
    expect(f.store.get('opportunity_lost_reason/NO_BUDGET')?.isActive).toBe(false);
  });
});
