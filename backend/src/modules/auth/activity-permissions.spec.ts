// B3 A4 — 9 mã quyền hoạt động phải nhất quán ở 4 nơi mã (Permission union, KNOWN, ALL_PERMS, BIZ) và trùng với script cấp quyền 2 người
// docs/B3_ACTIVITY_PERMISSIONS.sql.txt (DB đã bootstrap). Ma trận: docs/B3_ACTIVITIES_DESIGN.md §5 (OWNER_DECISION 03–04/11/2026).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITY_PERMISSIONS } from '../../common/auth/actor';
import { KNOWN } from '../../common/auth/session/session-actor.provider';
import { BIZ, ROLE_CODE } from './bootstrap';

const MATRIX: Record<string, Record<string, string>> = {
  crm_admin:  { 'activity.read': 'ALL', 'activity.create': 'ALL', 'activity.update': 'ALL', 'activity.assign': 'ALL', 'activity.delete': 'ALL', 'activity.assign_external': 'ALL' },
  sales:      { 'activity.read': 'OWN', 'activity.create': 'OWN', 'activity.update': 'OWN', 'activity.assign': 'OWN', 'activity.assign_external': 'OWN' },
  technician: { 'activity.read': 'DEPARTMENT', 'activity.create_tech': 'DEPARTMENT', 'activity.update_own': 'DEPARTMENT', 'activity.transfer_request': 'DEPARTMENT' },
  accountant: { 'activity.read': 'ALL' },
};

function bizRowsByDbRole(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [code, m] of Object.entries(BIZ)) {
    if (!code.startsWith('activity.')) continue;
    for (const [k, scope] of Object.entries(m)) { const db = ROLE_CODE[k as keyof typeof ROLE_CODE]; (out[db] ??= {})[code] = scope as string; }
  }
  return out;
}

const docFile = (name: string) => readFileSync(join(__dirname, '..', '..', '..', 'docs', name), 'utf8');

// Trả về ma trận + số tuple thô (phát hiện tuple trùng — object key sẽ ghi đè nên đếm riêng).
function scriptRows(name = 'B3_ACTIVITY_PERMISSIONS.sql.txt'): { rows: Record<string, Record<string, string>>; tuples: number } {
  const sql = docFile(name);
  const out: Record<string, Record<string, string>> = {};
  let tuples = 0;
  for (const m of sql.matchAll(/\('(crm_admin|sales|technician|accountant)',\s*'(activity\.[a-z_]+)',\s*'(ALL|DEPARTMENT|OWN)'\)/g)) { (out[m[1]] ??= {})[m[2]] = m[3]; tuples++; }
  return { rows: out, tuples };
}

describe('B3 A4 — mã quyền activity.* nhất quán', () => {
  it('đúng 9 mã, tất cả thuộc nhóm BIZ theo regex của fn_auth_perm_class (^activity\\.)', () => {
    expect(ACTIVITY_PERMISSIONS).toHaveLength(9);
    expect(new Set(ACTIVITY_PERMISSIONS).size).toBe(9);
    for (const p of ACTIVITY_PERMISSIONS) expect(p).toMatch(/^activity\.[a-z_]+$/);
  });
  it('KNOWN của SessionActorProvider chứa đủ 9 mã (quyền lạ bị bỏ qua => fail-closed nếu thiếu)', () => {
    for (const p of ACTIVITY_PERMISSIONS) expect(KNOWN.has(p)).toBe(true);
  });
  it('BIZ (bootstrap DB mới) = ma trận §5: 16 dòng, crm_admin 6 / sales 5 / technician 4 / accountant 1, admin (sysadmin) 0', () => {
    const rows = bizRowsByDbRole();
    expect(rows).toEqual(MATRIX);
    expect(Object.values(rows).reduce((n, m) => n + Object.keys(m).length, 0)).toBe(16);
    expect(rows['admin']).toBeUndefined();
    for (const p of ACTIVITY_PERMISSIONS) expect(Object.keys(BIZ)).toContain(p);
  });
  it('script 2 người cho DB đã bootstrap (docs/B3_ACTIVITY_PERMISSIONS.sql.txt) có đúng 16 dòng trùng BIZ, không tuple trùng', () => {
    const { rows, tuples } = scriptRows();
    expect(rows).toEqual(bizRowsByDbRole());
    expect(tuples).toBe(16);
  });
  it('rollback (B3_ACTIVITY_PERMISSIONS_REMOVE.sql.txt) chỉ nhắm ĐÚNG 9 mã A4 (danh sách tường minh, không LIKE) và ma trận "ngoài dự kiến" trùng BIZ', () => {
    const sql = docFile('B3_ACTIVITY_PERMISSIONS_REMOVE.sql.txt');
    const m = sql.match(/set_config\('b3\.codes',\s*'([^']+)'/);
    expect(m).not.toBeNull();
    expect(new Set(m![1].split(','))).toEqual(new Set(ACTIVITY_PERMISSIONS));
    // Mọi câu lệnh chọn/xoá phải theo danh sách b3.codes; LIKE 'activity.%' chỉ được dùng ở câu THÔNG BÁO mã giữ nguyên (code <> ALL(...)).
    const likeLines = sql.split(/\r?\n/).filter((l) => /LIKE 'activity\.%'/.test(l) && !l.trimStart().startsWith('--'));
    expect(likeLines).toHaveLength(1);
    expect(likeLines[0]).toMatch(/<> ALL \(string_to_array\(current_setting\('b3\.codes'\)/);
    const { rows, tuples } = scriptRows('B3_ACTIVITY_PERMISSIONS_REMOVE.sql.txt');
    expect(rows).toEqual(bizRowsByDbRole());
    expect(tuples).toBe(16);
  });
});
