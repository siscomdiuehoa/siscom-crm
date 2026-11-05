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

function scriptRows(): Record<string, Record<string, string>> {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'B3_ACTIVITY_PERMISSIONS.sql.txt'), 'utf8');
  const out: Record<string, Record<string, string>> = {};
  for (const m of sql.matchAll(/\('(crm_admin|sales|technician|accountant)',\s*'(activity\.[a-z_]+)',\s*'(ALL|DEPARTMENT|OWN)'\)/g)) (out[m[1]] ??= {})[m[2]] = m[3];
  return out;
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
  it('script 2 người cho DB đã bootstrap (docs/B3_ACTIVITY_PERMISSIONS.sql.txt) có đúng 16 dòng trùng BIZ', () => {
    const rows = scriptRows();
    expect(rows).toEqual(bizRowsByDbRole());
  });
});
