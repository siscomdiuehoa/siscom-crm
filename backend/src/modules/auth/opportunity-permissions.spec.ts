// Sales S5 — 10 mã quyền opportunity.* phải nhất quán ở Permission union / KNOWN / BIZ (DB mới) và trùng với script cấp quyền 2 người
// docs/SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt (+ REMOVE) cho DB đã bootstrap. Ma trận: docs/SALES_DESIGN.md §5.2.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPPORTUNITY_PERMISSIONS } from '../../common/auth/actor';
import { KNOWN } from '../../common/auth/scope-merge';
import { BIZ, ROLE_CODE } from './bootstrap';

const ADMIN_ALL = ['read', 'create', 'update', 'move_stage', 'close', 'assign', 'reopen', 'delete', 'restore'];
const SALES_OWN = ['read', 'create', 'update', 'move_stage', 'close', 'assign'];
const MATRIX: Record<string, Record<string, string>> = {
  crm_admin: Object.fromEntries(ADMIN_ALL.map((c) => ['opportunity.' + c, 'ALL'])),
  sales: Object.fromEntries(SALES_OWN.map((c) => ['opportunity.' + c, 'OWN'])),
  technician: { 'opportunity.read_assigned': 'OWN' },
  accountant: { 'opportunity.read': 'ALL' },
};

function bizRowsByDbRole(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [code, m] of Object.entries(BIZ)) {
    if (!code.startsWith('opportunity.')) continue;
    for (const [k, scope] of Object.entries(m)) { const db = ROLE_CODE[k as keyof typeof ROLE_CODE]; (out[db] ??= {})[code] = scope as string; }
  }
  return out;
}

const docFile = (name: string) => readFileSync(join(__dirname, '..', '..', '..', 'docs', name), 'utf8');
const migration = () => readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'migrations', '20261118000000_sales_perm_class', 'migration.sql'), 'utf8');

// Ma trận + số tuple thô (phát hiện tuple trùng — object key sẽ ghi đè nên đếm riêng).
function scriptRows(name: string): { rows: Record<string, Record<string, string>>; tuples: number } {
  const out: Record<string, Record<string, string>> = {};
  let tuples = 0;
  for (const m of docFile(name).matchAll(/\('(admin|crm_admin|sales|technician|accountant)',\s*'(opportunity\.[a-z_]+)',\s*'(ALL|DEPARTMENT|OWN)'\)/g)) { (out[m[1]] ??= {})[m[2]] = m[3]; tuples++; }
  return { rows: out, tuples };
}
const codesOf = (name: string): string[] => {
  const m = docFile(name).match(/set_config\('s5\.codes',\s*'([^']+)'/);
  expect(m).not.toBeNull();
  return m![1].split(',');
};

describe('Sales S5 — mã quyền opportunity.* nhất quán', () => {
  it('đúng 10 mã, không trùng, không có opportunity.export (§5.2: không cấp cho ai ở đợt này)', () => {
    expect(OPPORTUNITY_PERMISSIONS).toHaveLength(10);
    expect(new Set(OPPORTUNITY_PERMISSIONS).size).toBe(10);
    for (const p of OPPORTUNITY_PERMISSIONS) expect(p).toMatch(/^opportunity\.[a-z_]+$/);
    expect(OPPORTUNITY_PERMISSIONS as readonly string[]).not.toContain('opportunity.export');
    expect(Object.keys(BIZ)).not.toContain('opportunity.export');
  });
  it('KNOWN chứa đủ 10 mã (mã lạ bị bỏ qua => fail-closed nếu thiếu)', () => {
    for (const p of OPPORTUNITY_PERMISSIONS) expect(KNOWN.has(p)).toBe(true);
  });
  it('BIZ (bootstrap DB mới) = ma trận §5.2: 17 dòng, crm_admin 9 / sales 6 / technician 1 / accountant 1, admin (sysadmin) 0', () => {
    const rows = bizRowsByDbRole();
    expect(rows).toEqual(MATRIX);
    expect(Object.values(rows).reduce((n, m) => n + Object.keys(m).length, 0)).toBe(17);
    expect(rows['admin']).toBeUndefined();
    expect(new Set(Object.keys(BIZ).filter((c) => c.startsWith('opportunity.')))).toEqual(new Set(OPPORTUNITY_PERMISSIONS));
  });
  it('không vai trò nào nhận phạm vi DEPARTMENT cho opportunity.* (§5.4: không cấp ở đợt này)', () => {
    for (const m of Object.values(bizRowsByDbRole())) for (const s of Object.values(m)) expect(s).not.toBe('DEPARTMENT');
  });
  it('mỗi mã cấp riêng: Kinh doanh không có reopen/delete/restore; Kỹ thuật chỉ có read_assigned; Kế toán chỉ có read', () => {
    const rows = bizRowsByDbRole();
    for (const c of ['reopen', 'delete', 'restore', 'read_assigned']) expect(rows['sales']['opportunity.' + c]).toBeUndefined();
    expect(Object.keys(rows['technician'])).toEqual(['opportunity.read_assigned']);
    expect(Object.keys(rows['accountant'])).toEqual(['opportunity.read']);
  });
  it('script 2 người (SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt) có đúng 17 dòng trùng BIZ, không tuple trùng, danh sách mã = 10 mã', () => {
    const { rows, tuples } = scriptRows('SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt');
    expect(rows).toEqual(bizRowsByDbRole());
    expect(tuples).toBe(17);
    expect(new Set(codesOf('SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt'))).toEqual(new Set(OPPORTUNITY_PERMISSIONS));
    expect(codesOf('SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt')).toHaveLength(10);
  });
  it('script gỡ (…_REMOVE.sql.txt) chỉ nhắm ĐÚNG 10 mã (danh sách tường minh, không LIKE) và ma trận "ngoài dự kiến" trùng BIZ', () => {
    const name = 'SALES_S5_OPPORTUNITY_PERMISSIONS_REMOVE.sql.txt';
    expect(new Set(codesOf(name))).toEqual(new Set(OPPORTUNITY_PERMISSIONS));
    // LIKE 'opportunity.%' chỉ được dùng ở câu THÔNG BÁO mã giữ nguyên (code <> ALL(...)), không dùng để chọn/xoá.
    const likeLines = docFile(name).split(/\r?\n/).filter((l) => /LIKE 'opportunity\.%'/.test(l) && !l.trimStart().startsWith('--'));
    expect(likeLines).toHaveLength(1);
    expect(likeLines[0]).toMatch(/<> ALL \(string_to_array\(current_setting\('s5\.codes'\)/);
    const { rows, tuples } = scriptRows(name);
    expect(rows).toEqual(bizRowsByDbRole());
    expect(tuples).toBe(17);
  });
  it('migration 20261118000000_sales_perm_class xếp opportunity.* vào nhóm BIZ (SoD: admin kỹ thuật không giữ được) và giữ nguyên các nhóm cũ', () => {
    const sql = migration();
    const re = sql.match(/WHEN p_code ~ '\^\(([a-z|]+)\)\\\.' THEN 'BIZ'/);
    expect(re).not.toBeNull();
    expect(re![1].split('|')).toEqual(['customer', 'contact', 'activity', 'interaction', 'approval', 'opportunity']);
    const biz = new RegExp('^(' + re![1] + ')\\.');
    for (const p of OPPORTUNITY_PERMISSIONS) expect(biz.test(p)).toBe(true);
    expect(biz.test('opportunityx.read')).toBe(false);
    // Script cấp quyền từ chối khi migration chưa áp.
    expect(docFile('SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt')).toMatch(/fn_auth_perm_class\('opportunity\.read'\) <> 'BIZ'/);
    // Rollback trả đúng regex cũ và từ chối khi còn mã opportunity.*.
    const rb = docFile('SALES_S5_PERM_CLASS_ROLLBACK.sql.txt');
    expect(rb).toMatch(/WHEN p_code ~ '\^\(customer\|contact\|activity\|interaction\|approval\)\\\.' THEN 'BIZ'/);
    expect(rb).toMatch(/TU CHOI: con % ma opportunity\.\*/);
  });
});
