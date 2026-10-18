import { Prisma } from '../../generated/prisma/client';
import { buildOuterWhere, buildSearchCountQuery, buildSearchOrder, buildSearchPageQuery, buildSearchWhere, chooseSearchPath, escapeLike, phonePatterns, scopeSql, textBranches, type SearchWhereInput } from './customers.search';

const actor = { employeeId: '22222222-2222-4222-8222-222222222222', departmentId: '33333333-3333-4333-8333-333333333333' };
const base = { actor, folded: 'cong ty abc', raw: 'Công ty ABC', deletedOnly: false, readScope: 'ALL' as const, restoreScope: null, ids: {} };

describe('escapeLike', () => {
  it('thoát \\ % _ để chúng là ký tự thường', () => {
    expect(escapeLike('50%_x\\y')).toBe('50\\%\\_x\\\\y');
    expect(escapeLike('abc')).toBe('abc');
  });
});

describe('phonePatterns', () => {
  it('dưới 3 chữ số -> không tìm theo SĐT', () => {
    expect(phonePatterns('ab')).toBeNull();
    expect(phonePatterns('12')).toBeNull();
  });
  it('0xxx -> tiền tố +84; +/84/00 xử lý đúng', () => {
    expect(phonePatterns('0903 123')?.e164Prefix).toBe('+84903123%');
    expect(phonePatterns('+84 903 123')?.e164Prefix).toBe('+84903123%');
    expect(phonePatterns('84903123')?.e164Prefix).toBe('+84903123%');
    expect(phonePatterns('0082 2 123')?.e164Prefix).toBe('+822123%');
  });
  it('ILIKE thoát ký tự đặc biệt', () => expect(phonePatterns('09_3%')?.ilike).toBe('%09\\_3\\%%'));
});

describe('buildSearchWhere (toàn bộ giá trị là tham số)', () => {
  it('dùng đúng biểu thức có chỉ mục và chỉ khách chưa xoá mềm', () => {
    const w = buildSearchWhere(base);
    expect(w.text).toContain('c.deleted_at IS NULL');
    expect(w.text).toContain('public.f_vn_fold(c.name) LIKE $');
    expect(w.text).toContain('public.f_vn_fold(c.short_name) LIKE $');
    expect(w.text).toContain('lower(c.code) LIKE $');
    expect(w.text).toContain('c.tax_id LIKE $');
    expect(w.text).toContain('public.f_vn_fold(ct.full_name) LIKE $');
    expect(w.values).toContain('%cong ty abc%');
    expect(w.text).not.toContain('c.phone'); // không có ≥3 chữ số
  });
  it('chuỗi độc hại chỉ nằm trong tham số, không nằm trong SQL', () => {
    const evil = "'; DROP TABLE customer; --";
    const w = buildSearchWhere({ ...base, folded: evil, raw: evil });
    expect(w.text).not.toMatch(/drop table/i);
    expect(w.values).toContain('%' + escapeLike(evil) + '%');
  });
  it('có ≥3 chữ số: thêm điều kiện SĐT', () => {
    const w = buildSearchWhere({ ...base, folded: '0903123', raw: '0903 123' });
    expect(w.text).toContain('c.phone ILIKE $');
    expect(w.text).toContain('c.phone_e164 LIKE $');
    expect(w.values).toContain('+84903123%');
  });
  it('phạm vi: OWN dùng employeeId; DEPARTMENT dùng phòng ban; không quyền -> FALSE', () => {
    expect(buildSearchWhere({ ...base, readScope: 'OWN' }).values).toContain(actor.employeeId);
    const d = buildSearchWhere({ ...base, readScope: 'DEPARTMENT' });
    expect(d.text).toContain('e.department_id =');
    expect(d.values).toContain(actor.departmentId);
    expect(buildSearchWhere({ ...base, readScope: null }).text).toContain('FALSE');
    expect(scopeSql({ employeeId: 'x', departmentId: null }, 'DEPARTMENT').text).toContain('FALSE');
  });
  it('deleted=only: IS NOT NULL và áp thêm phạm vi restore', () => {
    const w = buildSearchWhere({ ...base, deletedOnly: true, readScope: 'ALL', restoreScope: 'OWN' });
    expect(w.text).toContain('c.deleted_at IS NOT NULL');
    expect(w.text).not.toContain('c.deleted_at IS NULL');
    expect(w.values).toContain(actor.employeeId);
  });
  it('bộ lọc danh mục và ownerId là tham số có ép kiểu uuid', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const w = buildSearchWhere({ ...base, ownerId: id, ids: { tier: id, status: id, industry: id, source: id, province: id } });
    for (const col of ['c.owner_id', 'c.tier_id', 'c.status_id', 'c.industry_id', 'c.source_id', 'c.province_id']) expect(w.text).toContain(col + ' = $');
    expect(w.text).toContain('::uuid');
  });
});

describe('buildSearchOrder (bảng trắng)', () => {
  it('mỗi khoá sắp xếp ánh xạ đúng và luôn phụ theo code giảm dần (trừ code)', () => {
    expect(buildSearchOrder('code', 'asc', 'x').text).toBe('c.code ASC');
    expect(buildSearchOrder('name', 'desc', 'x').text).toBe('c.name DESC, c.code DESC');
    expect(buildSearchOrder('updatedAt', 'asc', 'x').text).toBe('c.updated_at ASC, c.code DESC');
    expect(buildSearchOrder('tier', 'asc', 'x').text).toContain('l.id = c.tier_id');
    expect(buildSearchOrder('status', 'asc', 'x').text).toContain('l.id = c.status_id');
    expect(buildSearchOrder('relevance', 'desc', 'x').text).toContain('public.similarity');
  });
  it('khoá lạ/độc hại rơi về created_at, không đi vào SQL', () => {
    const o = buildSearchOrder('name; DROP TABLE customer', 'asc', 'x');
    expect(o.text).toBe('c.created_at ASC, c.code DESC');
    expect(buildSearchOrder('createdAt', 'desc', 'x').text).toBe('c.created_at DESC, c.code DESC');
  });
  it('từ khoá chỉ là tham số trong relevance', () => {
    const o = buildSearchOrder('relevance', 'desc', "x'; drop table customer; --");
    expect(o.text).not.toMatch(/drop table/i);
    expect(o.values).toContain("x'; drop table customer; --");
  });
});

// ───── P2-1 ─────
const norm = (x: string): string => x.replace(/\$\d+/g, '$');
// Bản sao NGUYÊN VĂN của buildSearchWhere trước P2-1 (tham chiếu để chứng minh refactor không đổi SQL/tham số).
function legacyBuildSearchWhere(p: SearchWhereInput): Prisma.Sql {
  const pat = '%' + escapeLike(p.folded) + '%';
  const ph = phonePatterns(p.raw);
  const text: Prisma.Sql[] = [
    Prisma.sql`public.f_vn_fold(c.name) LIKE ${pat}`,
    Prisma.sql`public.f_vn_fold(c.short_name) LIKE ${pat}`,
    Prisma.sql`lower(c.code) LIKE ${pat}`,
    Prisma.sql`c.tax_id LIKE ${pat}`,
    Prisma.sql`EXISTS (SELECT 1 FROM contact ct WHERE ct.customer_id = c.id AND ct.deleted_at IS NULL AND public.f_vn_fold(ct.full_name) LIKE ${pat})`,
  ];
  if (ph) text.push(Prisma.sql`c.phone ILIKE ${ph.ilike}`, Prisma.sql`c.phone_e164 LIKE ${ph.e164Prefix}`);
  const parts: Prisma.Sql[] = [
    p.deletedOnly ? Prisma.sql`c.deleted_at IS NOT NULL` : Prisma.sql`c.deleted_at IS NULL`,
    scopeSql(p.actor, p.readScope),
  ];
  if (p.deletedOnly) parts.push(scopeSql(p.actor, p.restoreScope));
  parts.push(Prisma.sql`(${Prisma.join(text, ' OR ')})`);
  if (p.ownerId) parts.push(Prisma.sql`c.owner_id = ${p.ownerId}::uuid`);
  if (p.ids.tier) parts.push(Prisma.sql`c.tier_id = ${p.ids.tier}::uuid`);
  if (p.ids.status) parts.push(Prisma.sql`c.status_id = ${p.ids.status}::uuid`);
  if (p.ids.industry) parts.push(Prisma.sql`c.industry_id = ${p.ids.industry}::uuid`);
  if (p.ids.source) parts.push(Prisma.sql`c.source_id = ${p.ids.source}::uuid`);
  if (p.ids.province) parts.push(Prisma.sql`c.province_id = ${p.ids.province}::uuid`);
  return Prisma.join(parts, ' AND ');
}
const uid = '44444444-4444-4444-8444-444444444444';
const sortRel = { sortBy: 'relevance', order: 'desc' as const };

describe('P2-1: buildSearchWhere sau refactor giữ NGUYÊN SQL và tham số', () => {
  const inputs: SearchWhereInput[] = [];
  for (const [folded, raw] of [['cong ty abc', 'Công ty ABC'], ['0903123', '0903 123'], ['50%_x', '50%_x'], ['ab', 'ab']] as const)
    for (const readScope of ['ALL', 'OWN', 'DEPARTMENT', null] as const)
      for (const deletedOnly of [false, true]) inputs.push({ ...base, folded, raw, readScope, deletedOnly, restoreScope: deletedOnly ? 'OWN' : null });
  inputs.push({ ...base, ownerId: uid, ids: { tier: uid, status: uid, industry: uid, source: uid, province: uid } });
  it('text và values giống hệt bản cũ ở mọi tổ hợp (từ khóa × phạm vi × xóa mềm × bộ lọc)', () => {
    for (const p of inputs) {
      const a = buildSearchWhere(p); const b = legacyBuildSearchWhere(p);
      expect(a.text).toBe(b.text);
      expect(a.values).toEqual(b.values);
    }
  });
  it('buildOuterWhere không có điều kiện văn bản, vẫn có xóa mềm/phạm vi/bộ lọc', () => {
    const w = buildOuterWhere({ ...base, readScope: 'OWN', ownerId: uid, ids: { tier: uid } });
    expect(w.text).not.toContain('f_vn_fold');
    expect(w.text).toContain('c.deleted_at IS NULL');
    expect(w.text).toContain('c.owner_id = $');
    expect(w.text).toContain('c.tier_id = $');
    expect(w.values).toContain(actor.employeeId);
  });
});

describe('P2-1: chooseSearchPath', () => {
  it('UNION khi ≥ 3 ký tự và không deleted=only; còn lại OR', () => {
    expect(chooseSearchPath('abc', false)).toBe('union');
    expect(chooseSearchPath('cong ty abc', false)).toBe('union');
    expect(chooseSearchPath('ab', false)).toBe('or');
    expect(chooseSearchPath('', false)).toBe('or');
    expect(chooseSearchPath('abc', true)).toBe('or');
    expect(chooseSearchPath('cong ty abc', true)).toBe('or');
  });
});

describe('P2-1: textBranches (nguồn duy nhất cho OR và UNION)', () => {
  it('không có ≥3 chữ số: 4 nhóm (tên, tên viết tắt, mã+MST, liên hệ), không có SĐT', () => {
    expect(textBranches(base).map((b) => b.kind)).toEqual(['name', 'shortName', 'codeTax', 'contact']);
  });
  it('có ≥3 chữ số: thêm nhóm SĐT với 2 nhánh union riêng (ILIKE và e164)', () => {
    const b = textBranches({ folded: '0903123', raw: '0903 123' });
    expect(b.map((x) => x.kind)).toEqual(['name', 'shortName', 'codeTax', 'contact', 'phone']);
    expect(b[4]?.union).toHaveLength(2);
    expect(b[4]?.or).toHaveLength(2);
  });
  it('mỗi nhánh union của khách chỉ lấy khách chưa xóa mềm; nhánh liên hệ chỉ lấy liên hệ chưa xóa', () => {
    for (const b of textBranches({ folded: '0903123', raw: '0903 123' })) for (const u of b.union) {
      if (b.kind === 'contact') { expect(u.text).toContain('SELECT ct.customer_id AS id FROM contact ct WHERE ct.deleted_at IS NULL'); expect(u.text).toContain('public.f_vn_fold(ct.full_name) LIKE $'); }
      else expect(u.text).toContain('FROM customer c WHERE c.deleted_at IS NULL AND');
    }
  });
  it('vị từ OR và nhánh UNION dùng CÙNG biểu thức (chỉ khác phần bao ngoài)', () => {
    const b = textBranches({ folded: '0903123', raw: '0903 123' });
    const orText = norm(b.flatMap((x) => x.or).map((x) => x.text).join(' | '));
    const unText = norm(b.flatMap((x) => x.union).map((x) => x.text).join(' | '));
    for (const e of ['public.f_vn_fold(c.name) LIKE $', 'public.f_vn_fold(c.short_name) LIKE $', 'lower(c.code) LIKE $', 'c.tax_id LIKE $', 'public.f_vn_fold(ct.full_name) LIKE $', 'c.phone ILIKE $', 'c.phone_e164 LIKE $']) {
      expect(orText).toContain(e); expect(unText).toContain(e);
    }
  });
});

describe('P2-1: buildSearchPageQuery / buildSearchCountQuery', () => {
  const ph = { ...base, folded: '0903123', raw: '0903 123' };
  it('đường UNION: UNION các nhánh, JOIN cand, count(*) OVER (), ORDER BY nguyên buildSearchOrder, LIMIT/OFFSET là tham số', () => {
    const q = buildSearchPageQuery(ph, 'union', { sortBy: 'name', order: 'desc' }, 20, 40);
    const t = norm(q.text);
    expect(t).toContain('SELECT c.id, count(*) OVER ()::int AS total FROM customer c JOIN (');
    expect(t).toContain(' UNION ');
    expect(t).not.toContain('UNION ALL');
    expect(t).toContain(') cand ON cand.id = c.id WHERE c.deleted_at IS NULL');
    expect(t).toContain('ORDER BY c.name DESC, c.code DESC LIMIT $::int OFFSET $::int');
    expect(q.values).toContain(20); expect(q.values).toContain(40);
    expect(q.values).toContain('+84903123%');
  });
  it('đường UNION: relevance dùng đúng công thức của buildSearchOrder (không đổi định nghĩa)', () => {
    const q = buildSearchPageQuery(base, 'union', sortRel, 20, 0);
    expect(norm(q.text)).toContain('ORDER BY ' + norm(buildSearchOrder('relevance', 'desc', base.folded).text));
  });
  it('đường UNION: phạm vi/ownerId/bộ lọc nằm ở truy vấn ngoài; không quyền -> FALSE', () => {
    const own = buildSearchPageQuery({ ...base, readScope: 'OWN', ownerId: uid, ids: { tier: uid } }, 'union', sortRel, 20, 0);
    expect(own.values).toContain(actor.employeeId);
    expect(own.text).toContain('c.owner_id = $');
    expect(own.text).toContain('c.tier_id = $');
    const dep = buildSearchPageQuery({ ...base, readScope: 'DEPARTMENT' }, 'union', sortRel, 20, 0);
    expect(dep.text).toContain('e.department_id =');
    expect(buildSearchPageQuery({ ...base, readScope: null }, 'union', sortRel, 20, 0).text).toContain('FALSE');
  });
  it('đường UNION không dùng cho deleted=only (lỗi lập trình)', () => {
    expect(() => buildSearchPageQuery({ ...base, deletedOnly: true, restoreScope: 'ALL' }, 'union', sortRel, 20, 0)).toThrow();
    expect(() => buildSearchCountQuery({ ...base, deletedOnly: true, restoreScope: 'ALL' }, 'union')).toThrow();
  });
  it('đường OR: giữ điều kiện cũ, có count(*) OVER (), không UNION; deleted=only dùng IS NOT NULL + restore', () => {
    const q = buildSearchPageQuery({ ...base, deletedOnly: true, readScope: 'ALL', restoreScope: 'OWN' }, 'or', { sortBy: 'createdAt', order: 'desc' }, 20, 0);
    const t = norm(q.text);
    expect(t).toContain('SELECT c.id, count(*) OVER ()::int AS total FROM customer c WHERE ');
    expect(t).not.toContain('UNION');
    expect(t).toContain('c.deleted_at IS NOT NULL');
    expect(t).toContain('ORDER BY c.created_at DESC, c.code DESC');
    expect(q.values).toContain(actor.employeeId);
  });
  it('đường OR: WHERE đúng bằng buildSearchWhere (bản cũ)', () => {
    const p = { ...base, folded: 'mi', raw: 'mi' };
    const q = buildSearchPageQuery(p, 'or', { sortBy: 'createdAt', order: 'desc' }, 20, 0);
    expect(norm(q.text)).toContain('FROM customer c WHERE ' + norm(legacyBuildSearchWhere(p).text) + ' ORDER BY');
  });
  it('truy vấn đếm: count(*)::int AS n, cùng điều kiện cho cả hai đường', () => {
    expect(norm(buildSearchCountQuery(base, 'union').text)).toMatch(/^SELECT count\(\*\)::int AS n FROM customer c JOIN \(/);
    expect(norm(buildSearchCountQuery({ ...base, folded: 'ab', raw: 'ab' }, 'or').text)).toBe('SELECT count(*)::int AS n FROM customer c WHERE ' + norm(legacyBuildSearchWhere({ ...base, folded: 'ab', raw: 'ab' }).text));
  });
  it('chuỗi độc hại chỉ nằm trong tham số ở mọi truy vấn, mọi khóa sắp xếp', () => {
    const evil = "'; DROP TABLE customer; --";
    for (const path of ['union', 'or'] as const) for (const sortBy of ['relevance', 'name', 'createdAt', 'code', 'updatedAt', 'tier', 'status']) {
      const pg = buildSearchPageQuery({ ...base, folded: evil, raw: evil }, path, { sortBy, order: 'asc' }, 20, 0);
      expect(pg.text).not.toMatch(/drop table/i);
      expect(pg.values).toContain('%' + escapeLike(evil) + '%');
    }
    expect(buildSearchCountQuery({ ...base, folded: evil, raw: evil }, 'union').text).not.toMatch(/drop table/i);
  });
  it('khóa sắp xếp ngoài bảng trắng rơi về created_at, không vào SQL', () => {
    const q = buildSearchPageQuery(base, 'union', { sortBy: 'name; DROP TABLE customer', order: 'asc' }, 20, 0);
    expect(norm(q.text)).toContain('ORDER BY c.created_at ASC, c.code DESC');
    expect(q.text).not.toMatch(/drop table/i);
  });
});
