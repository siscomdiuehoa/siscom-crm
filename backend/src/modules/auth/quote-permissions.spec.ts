// Báo giá Q3 — 9 mã quyền quote.* phải nhất quán ở Permission union / KNOWN / BIZ (DB mới) và trùng với script cấp quyền 2 người
// docs/QUOTES_Q3_PERMISSIONS.sql.txt (+ REMOVE) cho DB đã bootstrap. Ma trận: docs/QUOTES_DESIGN.md mục 7.1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUOTE_PERMISSIONS } from '../../common/auth/actor';
import { KNOWN } from '../../common/auth/scope-merge';
import { BIZ, ROLE_CODE } from './bootstrap';

const ADMIN_ALL = ['read', 'create', 'update', 'send', 'decide', 'delete', 'export', 'template', 'cost'];
const SALES_OWN = ['read', 'create', 'update', 'send', 'decide', 'delete', 'export'];
const MATRIX: Record<string, Record<string, string>> = {
  crm_admin: Object.fromEntries(ADMIN_ALL.map((c) => ['quote.' + c, 'ALL'])),
  sales: Object.fromEntries(SALES_OWN.map((c) => ['quote.' + c, 'OWN'])),
  accountant: { 'quote.read': 'ALL', 'quote.export': 'ALL' },
};

function bizRowsByDbRole(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [code, m] of Object.entries(BIZ)) {
    if (!code.startsWith('quote.')) continue;
    for (const [k, scope] of Object.entries(m)) { const db = ROLE_CODE[k as keyof typeof ROLE_CODE]; (out[db] ??= {})[code] = scope as string; }
  }
  return out;
}

const docFile = (name: string) => readFileSync(join(__dirname, '..', '..', '..', 'docs', name), 'utf8');
const migration = () => readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'migrations', '20261125000000_quotes', 'migration.sql'), 'utf8');

// Ma trận + số tuple thô (phát hiện tuple trùng — object key sẽ ghi đè nên đếm riêng).
function scriptRows(name: string): { rows: Record<string, Record<string, string>>; tuples: number } {
  const out: Record<string, Record<string, string>> = {};
  let tuples = 0;
  for (const m of docFile(name).matchAll(/\('(admin|crm_admin|sales|technician|accountant)',\s*'(quote\.[a-z_]+)',\s*'(ALL|DEPARTMENT|OWN)'\)/g)) { (out[m[1]] ??= {})[m[2]] = m[3]; tuples++; }
  return { rows: out, tuples };
}
const codesOf = (name: string): string[] => {
  const m = docFile(name).match(/set_config\('q3\.codes',\s*'([^']+)'/);
  expect(m).not.toBeNull();
  return m![1].split(',');
};

describe('Báo giá Q3 — mã quyền quote.* nhất quán', () => {
  it('đúng 9 mã, không trùng, không có mã duyệt (QB1: Kinh doanh tự gửi, không có bước duyệt)', () => {
    expect(QUOTE_PERMISSIONS).toHaveLength(9);
    expect(new Set(QUOTE_PERMISSIONS).size).toBe(9);
    for (const p of QUOTE_PERMISSIONS) expect(p).toMatch(/^quote\.[a-z_]+$/);
    expect(QUOTE_PERMISSIONS as readonly string[]).not.toContain('quote.approve');
    expect(Object.keys(BIZ)).not.toContain('quote.approve');
  });
  it('KNOWN chứa đủ 9 mã (mã lạ bị bỏ qua => fail-closed nếu thiếu)', () => {
    for (const p of QUOTE_PERMISSIONS) expect(KNOWN.has(p)).toBe(true);
  });
  it('BIZ (bootstrap DB mới) = ma trận 7.1: 18 dòng, crm_admin 9 / sales 7 / accountant 2; technician và admin (sysadmin) 0', () => {
    const rows = bizRowsByDbRole();
    expect(rows).toEqual(MATRIX);
    expect(Object.values(rows).reduce((n, m) => n + Object.keys(m).length, 0)).toBe(18);
    expect(rows['admin']).toBeUndefined();
    expect(rows['technician']).toBeUndefined();
    expect(new Set(Object.keys(BIZ).filter((c) => c.startsWith('quote.')))).toEqual(new Set(QUOTE_PERMISSIONS));
  });
  it('không vai trò nào nhận phạm vi DEPARTMENT cho quote.*', () => {
    for (const m of Object.values(bizRowsByDbRole())) for (const s of Object.values(m)) expect(s).not.toBe('DEPARTMENT');
  });
  it('mỗi mã cấp riêng: chỉ Quản trị CRM có template (QB19) và cost (QB23); Kế toán chỉ có read + export (QB21)', () => {
    const rows = bizRowsByDbRole();
    for (const c of ['template', 'cost']) { expect(rows['sales']['quote.' + c]).toBeUndefined(); expect(rows['accountant']['quote.' + c]).toBeUndefined(); expect(rows['crm_admin']['quote.' + c]).toBe('ALL'); }
    expect(Object.keys(rows['accountant']).sort()).toEqual(['quote.export', 'quote.read']);
  });
  it('script 2 người (QUOTES_Q3_PERMISSIONS.sql.txt) có đúng 18 dòng trùng BIZ, không tuple trùng, danh sách mã = 9 mã', () => {
    const { rows, tuples } = scriptRows('QUOTES_Q3_PERMISSIONS.sql.txt');
    expect(rows).toEqual(bizRowsByDbRole());
    expect(tuples).toBe(18);
    expect(new Set(codesOf('QUOTES_Q3_PERMISSIONS.sql.txt'))).toEqual(new Set(QUOTE_PERMISSIONS));
    expect(codesOf('QUOTES_Q3_PERMISSIONS.sql.txt')).toHaveLength(9);
  });
  it('script gỡ (…_REMOVE.sql.txt) chỉ nhắm ĐÚNG 9 mã (danh sách tường minh, không LIKE) và ma trận "ngoài dự kiến" trùng BIZ', () => {
    const name = 'QUOTES_Q3_PERMISSIONS_REMOVE.sql.txt';
    expect(new Set(codesOf(name))).toEqual(new Set(QUOTE_PERMISSIONS));
    // LIKE 'quote.%' chỉ được dùng ở câu THÔNG BÁO mã giữ nguyên (code <> ALL(...)), không dùng để chọn/xoá.
    const likeLines = docFile(name).split(/\r?\n/).filter((l) => /LIKE 'quote\.%'/.test(l) && !l.trimStart().startsWith('--'));
    expect(likeLines).toHaveLength(1);
    expect(likeLines[0]).toMatch(/<> ALL \(string_to_array\(current_setting\('q3\.codes'\)/);
    const { rows, tuples } = scriptRows(name);
    expect(rows).toEqual(bizRowsByDbRole());
    expect(tuples).toBe(18);
  });
  it('migration 20261125000000_quotes xếp quote.* vào nhóm BIZ (SoD: admin kỹ thuật không giữ được) và giữ nguyên các nhóm cũ', () => {
    const sql = migration();
    const re = sql.match(/WHEN p_code ~ '\^\(([a-z|]+)\)\\\.' THEN 'BIZ'/);
    expect(re).not.toBeNull();
    expect(re![1].split('|')).toEqual(['customer', 'contact', 'activity', 'interaction', 'approval', 'opportunity', 'quote']);
    const biz = new RegExp('^(' + re![1] + ')\\.');
    for (const p of QUOTE_PERMISSIONS) expect(biz.test(p)).toBe(true);
    expect(biz.test('quotex.read')).toBe(false);
    // Script cấp quyền từ chối khi migration chưa áp.
    expect(docFile('QUOTES_Q3_PERMISSIONS.sql.txt')).toMatch(/fn_auth_perm_class\('quote\.read'\) <> 'BIZ'/);
    // Rollback trả đúng regex của Sales S5 và từ chối khi còn mã quote.*.
    const rb = docFile('QUOTES_Q2_ROLLBACK.sql.txt');
    expect(rb).toMatch(/WHEN p_code ~ '\^\(customer\|contact\|activity\|interaction\|approval\|opportunity\)\\\.' THEN 'BIZ'/);
    expect(rb).toMatch(/TU CHOI: con % ma quote\.\*/);
  });
});
