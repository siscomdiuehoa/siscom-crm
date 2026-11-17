import type { Actor, Permission, Scope } from '../../common/auth/actor';
import { OPPORTUNITY_PERMISSIONS } from '../../common/auth/actor';
import { mergeScopes } from '../../common/auth/scope-merge';
import type { EmployeeAccess } from '../../common/auth/scope-merge';
import { DomainException } from '../../common/errors/domain.exception';
import { BIZ, ROLE_CODE } from '../auth/bootstrap';
import {
  accessPath, allowsCreate, allowsWrite, assertAssignee, assertMayLoadDeleted, assertRestorable, assertWrite, assigneeRefusal, deletedListWhere,
  fullReadWhere, hasAssignedReadCode, mayRestore, OppRef, OppWriteCode, ownerLostAccess, readsFull, restoreDecision, ScopeOf, seesOwnerLostFlag,
} from './opportunities.access';

// Sales S5 — ma trận vị từ §5.4 (docs/SALES_DESIGN.md), kiểm ở tầng hàm thuần. Quyền của từng vai trò lấy từ ĐÚNG ma trận BIZ thật
// (bootstrap.ts) qua mergeScopes — cùng hàm với SessionActorProvider — nên test không tự chép ma trận.
// Ca nghiệm thu qua API (TC 9, 9a, 9c, 12) thuộc các PR có endpoint (S6–S9); ở đây là hợp đồng mà các service đó phải gọi.
type RoleKey = 'admin' | 'sale' | 'technician' | 'accountant';
const grantsOf = (k: RoleKey) => ({
  role: {
    code: ROLE_CODE[k], isConfirmed: true,
    permissions: Object.entries(BIZ).filter(([, m]) => m[k]).map(([code, m]) => ({ scope: m[k] as Scope, permission: { code } })),
  },
});
const scopesOf = (...ks: RoleKey[]) => mergeScopes(ks.map(grantsOf)).scopes;
const of = (scopes: Partial<Record<Permission, Scope>>): ScopeOf => (p) => scopes[p] ?? null;
const NOBODY: ScopeOf = () => null;

const ME: Actor = { employeeId: 'me', departmentId: 'd1' };
const opp = (over: Partial<{ ownerId: string; deleted: boolean; custOwner: string | null; custDeleted: boolean }> = {}): OppRef => ({
  ownerId: over.ownerId ?? 'other',
  deletedAt: over.deleted ? new Date() : null,
  customer: { ownerId: over.custOwner === undefined ? 'other2' : over.custOwner, deletedAt: over.custDeleted ? new Date() : null },
});
const WRITE_CODES: OppWriteCode[] = ['opportunity.update', 'opportunity.move_stage', 'opportunity.close', 'opportunity.assign', 'opportunity.reopen', 'opportunity.delete'];
const OWNER_CODES: OppWriteCode[] = ['opportunity.update', 'opportunity.move_stage', 'opportunity.close', 'opportunity.assign'];
const code = (fn: () => void): string => {
  try { fn(); } catch (e) { if (e instanceof DomainException) return e.getStatus() + ' ' + e.code; throw e; }
  return 'OK';
};

describe('Đọc — đường đầy đủ (opportunity.read)', () => {
  const sale = of(scopesOf('sale')); const admin = of(scopesOf('admin')); const acct = of(scopesOf('accountant')); const tech = of(scopesOf('technician'));
  it('Kinh doanh (OWN): thấy cơ hội mình phụ trách VÀ cơ hội của khách mình phụ trách [C4]; không thấy cơ hội khác', () => {
    expect(readsFull(ME, sale, opp({ ownerId: 'me' }))).toBe(true);
    expect(readsFull(ME, sale, opp({ custOwner: 'me' }))).toBe(true);
    expect(readsFull(ME, sale, opp())).toBe(false);
    expect(readsFull(ME, sale, opp({ custOwner: null }))).toBe(false);
  });
  it('Quản trị CRM và Kế toán (ALL): thấy mọi cơ hội; Kỹ thuật và người không có quyền: không có đường đầy đủ', () => {
    expect(readsFull(ME, admin, opp())).toBe(true);
    expect(readsFull(ME, acct, opp())).toBe(true);
    expect(readsFull(ME, tech, opp({ ownerId: 'me', custOwner: 'me' }))).toBe(false);
    expect(readsFull(ME, NOBODY, opp({ ownerId: 'me' }))).toBe(false);
  });
  it('cơ hội hoặc khách đã xoá mềm => không ai đọc qua đường thường, kể cả ALL', () => {
    for (const s of [sale, admin, acct]) {
      expect(readsFull(ME, s, opp({ ownerId: 'me', deleted: true }))).toBe(false);
      expect(readsFull(ME, s, opp({ ownerId: 'me', custDeleted: true }))).toBe(false);
    }
  });
  it('phạm vi DEPARTMENT (không cấp ở đợt này) => fail-closed ở cả hàm kiểm và điều kiện truy vấn', () => {
    const dept = of({ 'opportunity.read': 'DEPARTMENT' });
    expect(readsFull(ME, dept, opp({ ownerId: 'me', custOwner: 'me' }))).toBe(false);
    expect(fullReadWhere(ME, dept)).toEqual({ AND: [{ deletedAt: null, customer: { is: { deletedAt: null } } }, { id: { in: [] } }] });
  });
  it('fullReadWhere khớp readsFull: luôn lọc xoá mềm; OWN = phụ trách cơ hội HOẶC phụ trách khách; không quyền => rỗng', () => {
    const LIVE = { deletedAt: null, customer: { is: { deletedAt: null } } };
    expect(fullReadWhere(ME, admin)).toEqual({ AND: [LIVE, {}] });
    expect(fullReadWhere(ME, sale)).toEqual({ AND: [LIVE, { OR: [{ ownerId: 'me' }, { customer: { is: { ownerId: 'me' } } }] }] });
    expect(fullReadWhere(ME, tech)).toEqual({ AND: [LIVE, { id: { in: [] } }] });
    expect(fullReadWhere(ME, NOBODY)).toEqual({ AND: [LIVE, { id: { in: [] } }] });
  });
});

describe('Đường truy cập và nhiều vai trò (TC 9a(i))', () => {
  it('chỉ Kỹ thuật có mã read_assigned; Kinh doanh / Kế toán / Quản trị CRM không cần và không có', () => {
    expect(hasAssignedReadCode(of(scopesOf('technician')))).toBe(true);
    for (const k of ['sale', 'accountant', 'admin'] as RoleKey[]) expect(hasAssignedReadCode(of(scopesOf(k)))).toBe(false);
  });
  it('đạt cả hai đường => FULL; chỉ đường theo việc => TASK; không đường nào => null', () => {
    expect(accessPath(true, true)).toBe('FULL');
    expect(accessPath(true, false)).toBe('FULL');
    expect(accessPath(false, true)).toBe('TASK');
    expect(accessPath(false, false)).toBeNull();
  });
  it('người vừa Kinh doanh vừa Kỹ thuật: quyền hợp nhất theo từng mã — có read (OWN) VÀ read_assigned; cơ hội mình phụ trách => đầy đủ', () => {
    const both = of(scopesOf('sale', 'technician'));
    expect(both('opportunity.read')).toBe('OWN');
    expect(hasAssignedReadCode(both)).toBe(true);
    expect(readsFull(ME, both, opp({ ownerId: 'me' }))).toBe(true);
    expect(readsFull(ME, both, opp())).toBe(false); // cơ hội chỉ tới qua việc => đường TASK (S9), không phải FULL
  });
  it('vai trò chưa xác nhận không đóng góp quyền nào (TC 9a(ii))', () => {
    const g = grantsOf('sale'); g.role.isConfirmed = false;
    const s = of(mergeScopes([g]).scopes);
    expect(readsFull(ME, s, opp({ ownerId: 'me' }))).toBe(false);
    for (const c of WRITE_CODES) expect(allowsWrite(ME, s, c, opp({ ownerId: 'me' }))).toBe(false);
  });
});

describe('Tạo (opportunity.create) — tính theo KHÁCH', () => {
  it('Kinh doanh: chỉ khách mình phụ trách; Quản trị CRM: mọi khách; Kế toán / Kỹ thuật: không', () => {
    const sale = of(scopesOf('sale'));
    expect(allowsCreate(ME, sale, { ownerId: 'me', deletedAt: null })).toBe(true);
    expect(allowsCreate(ME, sale, { ownerId: 'other', deletedAt: null })).toBe(false);
    expect(allowsCreate(ME, sale, { ownerId: null, deletedAt: null })).toBe(false);
    expect(allowsCreate(ME, of(scopesOf('admin')), { ownerId: 'other', deletedAt: null })).toBe(true);
    expect(allowsCreate(ME, of(scopesOf('accountant')), { ownerId: 'me', deletedAt: null })).toBe(false);
    expect(allowsCreate(ME, of(scopesOf('technician')), { ownerId: 'me', deletedAt: null })).toBe(false);
  });
  it('khách đã xoá mềm => không tạo được, kể cả ALL', () => {
    expect(allowsCreate(ME, of(scopesOf('admin')), { ownerId: 'me', deletedAt: new Date() })).toBe(false);
  });
  it('quyền tạo không suy từ quyền ghi cơ hội: có update ALL mà không có create => không tạo được', () => {
    expect(allowsCreate(ME, of({ 'opportunity.update': 'ALL', 'opportunity.read': 'ALL' }), { ownerId: 'me', deletedAt: null })).toBe(false);
  });
});

describe('Ghi trên cơ hội có sẵn — mỗi thao tác kiểm đúng mã của nó', () => {
  const sale = of(scopesOf('sale')); const admin = of(scopesOf('admin'));
  it('Kinh doanh phụ trách CƠ HỘI: update / move_stage / close / assign được; reopen / delete không (chỉ ALL)', () => {
    const mine = opp({ ownerId: 'me' });
    for (const c of OWNER_CODES) expect(allowsWrite(ME, sale, c, mine)).toBe(true);
    expect(allowsWrite(ME, sale, 'opportunity.reopen', mine)).toBe(false);
    expect(allowsWrite(ME, sale, 'opportunity.delete', mine)).toBe(false);
  });
  it('người phụ trách KHÁCH mà không phụ trách CƠ HỘI: đọc được nhưng KHÔNG có quyền ghi nào => 403 (TC 12)', () => {
    const o = opp({ custOwner: 'me' });
    expect(readsFull(ME, sale, o)).toBe(true);
    for (const c of WRITE_CODES) {
      expect(allowsWrite(ME, sale, c, o)).toBe(false);
      expect(code(() => assertWrite(ME, sale, c, o, accessPath(readsFull(ME, sale, o), false)))).toBe('403 FORBIDDEN');
    }
  });
  it('cơ hội ngoài phạm vi xem => 404 cho mọi mã ghi (không lộ tồn tại)', () => {
    const o = opp();
    for (const c of WRITE_CODES) expect(code(() => assertWrite(ME, sale, c, o, accessPath(readsFull(ME, sale, o), false)))).toBe('404 OPPORTUNITY_NOT_FOUND');
  });
  it('Quản trị CRM (ALL): mọi mã ghi trên mọi cơ hội', () => {
    for (const c of WRITE_CODES) expect(code(() => assertWrite(ME, admin, c, opp(), 'FULL'))).toBe('OK');
  });
  it('Kế toán (chỉ đọc ALL): thấy được nhưng mọi mã ghi => 403; Kỹ thuật qua đường theo việc: mọi mã ghi => 403', () => {
    const acct = of(scopesOf('accountant')); const tech = of(scopesOf('technician'));
    for (const c of WRITE_CODES) {
      expect(code(() => assertWrite(ME, acct, c, opp({ ownerId: 'me' }), 'FULL'))).toBe('403 FORBIDDEN');
      expect(code(() => assertWrite(ME, tech, c, opp({ ownerId: 'me' }), 'TASK'))).toBe('403 FORBIDDEN');
    }
  });
  it.each([
    ['opportunity.close', 'Tạm hoãn / Thắng / Thua'], ['opportunity.assign', 'chuyển người phụ trách'], ['opportunity.move_stage', 'đổi giai đoạn'],
  ] as Array<[OppWriteCode, string]>)('có update nhưng KHÔNG có %s => %s bị 403, sửa trường vẫn được (TC 9a(iii))', (missing) => {
    const all: Partial<Record<Permission, Scope>> = { 'opportunity.read': 'OWN', 'opportunity.update': 'OWN', 'opportunity.move_stage': 'OWN', 'opportunity.close': 'OWN', 'opportunity.assign': 'OWN' };
    delete all[missing];
    const s = of(all); const mine = opp({ ownerId: 'me' });
    expect(code(() => assertWrite(ME, s, 'opportunity.update', mine, 'FULL'))).toBe('OK');
    expect(code(() => assertWrite(ME, s, missing, mine, 'FULL'))).toBe('403 FORBIDDEN');
  });
  it('reopen / delete phạm vi OWN (nếu ai đó cấp nhầm) vẫn bị từ chối: hai mã này chỉ nhận ALL', () => {
    const s = of({ 'opportunity.read': 'OWN', 'opportunity.reopen': 'OWN', 'opportunity.delete': 'OWN' });
    expect(allowsWrite(ME, s, 'opportunity.reopen', opp({ ownerId: 'me' }))).toBe(false);
    expect(allowsWrite(ME, s, 'opportunity.delete', opp({ ownerId: 'me' }))).toBe(false);
  });
  it('phạm vi DEPARTMENT cho mã ghi => fail-closed', () => {
    const s = of({ 'opportunity.update': 'DEPARTMENT' });
    expect(allowsWrite(ME, s, 'opportunity.update', opp({ ownerId: 'me' }))).toBe(false);
  });
  it('cơ hội hoặc khách đã xoá mềm => không mã ghi nào chạy, kể cả ALL', () => {
    for (const c of WRITE_CODES) {
      expect(allowsWrite(ME, admin, c, opp({ deleted: true }))).toBe(false);
      expect(allowsWrite(ME, admin, c, opp({ custDeleted: true }))).toBe(false);
    }
  });
});

describe('Người nhận khi chuyển người phụ trách [O3] (TC 8, 9a(iv), 9a(vi), 9a(vii))', () => {
  const emp = (id: string, dept: string | null, ks: RoleKey[], active = true): EmployeeAccess => ({ id, departmentId: dept, active, scopes: scopesOf(...ks) });
  const sale = of(scopesOf('sale')); const admin = of(scopesOf('admin'));
  const owner = { departmentId: 'd1' };
  it('Kinh doanh chuyển cho người ACTIVE, tài khoản dùng được, cùng phòng, có read + update => được', () => {
    expect(assigneeRefusal(sale, owner, emp('r', 'd1', ['sale']), true)).toBeNull();
    expect(assigneeRefusal(sale, owner, emp('r', 'd1', ['admin']), true)).toBeNull();
  });
  it('người nhận không tồn tại / không ACTIVE => từ chối', () => {
    expect(assigneeRefusal(sale, owner, undefined, true)).toBe('INACTIVE');
    expect(assigneeRefusal(sale, owner, emp('r', 'd1', ['sale'], false), true)).toBe('INACTIVE');
  });
  it('nhân viên ACTIVE, đủ vai trò nhưng tài khoản không dùng được (bị khoá / chưa có credential / cổng auth lỗi) => từ chối', () => {
    expect(assigneeRefusal(sale, owner, emp('r', 'd1', ['sale']), false)).toBe('CANNOT_SIGN_IN');
    expect(assigneeRefusal(admin, owner, emp('r', 'd1', ['sale']), false)).toBe('CANNOT_SIGN_IN');
    expect(assigneeRefusal(sale, owner, emp('r', 'd1', ['sale']), undefined as unknown as boolean)).toBe('CANNOT_SIGN_IN');
  });
  it('người nhận thiếu quyền: Kỹ thuật, Kế toán (chỉ read), Quản trị hệ thống (không có gì) => từ chối', () => {
    expect(assigneeRefusal(sale, owner, emp('r', 'd1', ['technician']), true)).toBe('LACKS_PERMISSION');
    expect(assigneeRefusal(sale, owner, emp('r', 'd1', ['accountant']), true)).toBe('LACKS_PERMISSION');
    expect(assigneeRefusal(admin, owner, { id: 'r', departmentId: 'd1', active: true, scopes: {} }, true)).toBe('LACKS_PERMISSION');
  });
  it('người nhận chỉ có update mà thiếu read => từ chối (tránh người phụ trách không đọc được cơ hội của mình)', () => {
    expect(assigneeRefusal(admin, owner, { id: 'r', departmentId: 'd1', active: true, scopes: { 'opportunity.update': 'OWN' } }, true)).toBe('LACKS_PERMISSION');
  });
  it('khác phòng: Kinh doanh bị từ chối; Quản trị CRM (assign ALL) được', () => {
    expect(assigneeRefusal(sale, owner, emp('r', 'd2', ['sale']), true)).toBe('OTHER_DEPARTMENT');
    expect(assigneeRefusal(admin, owner, emp('r', 'd2', ['sale']), true)).toBeNull();
  });
  it('phòng của người phụ trách hiện tại hoặc của người nhận chưa xác định => chỉ phạm vi ALL chuyển được', () => {
    expect(assigneeRefusal(sale, { departmentId: null }, emp('r', 'd1', ['sale']), true)).toBe('OTHER_DEPARTMENT');
    expect(assigneeRefusal(sale, undefined, emp('r', 'd1', ['sale']), true)).toBe('OTHER_DEPARTMENT');
    expect(assigneeRefusal(sale, owner, emp('r', null, ['sale']), true)).toBe('OTHER_DEPARTMENT');
    expect(assigneeRefusal(admin, { departmentId: null }, emp('r', null, ['sale']), true)).toBeNull();
  });
  it('Quản trị CRM chuyển khác phòng cho người không đủ quyền => vẫn từ chối', () => {
    expect(assigneeRefusal(admin, owner, emp('r', 'd2', ['technician']), true)).toBe('LACKS_PERMISSION');
  });
  it('client luôn nhận MỘT mã 400 OPPORTUNITY_ASSIGNEE_INELIGIBLE cho mọi nguyên nhân (không lộ trạng thái tài khoản)', () => {
    const cases: Array<[EmployeeAccess | undefined, boolean]> = [[undefined, true], [emp('r', 'd1', ['sale']), false], [emp('r', 'd1', ['technician']), true], [emp('r', 'd2', ['sale']), true]];
    for (const [r, can] of cases) expect(code(() => assertAssignee(sale, owner, r, can))).toBe('400 OPPORTUNITY_ASSIGNEE_INELIGIBLE');
    expect(code(() => assertAssignee(sale, owner, emp('r', 'd1', ['sale']), true))).toBe('OK');
  });
  it('sau khi nhận: người nhận sửa được nhờ vị từ OWN; chốt / chuyển tiếp tuỳ mã close / assign của CHÍNH họ; người cũ mất quyền ghi ngay', () => {
    const after = opp({ ownerId: 'r' });
    const r: Actor = { employeeId: 'r', departmentId: 'd1' };
    const onlyUpdate = of({ 'opportunity.read': 'OWN', 'opportunity.update': 'OWN' });
    expect(allowsWrite(r, onlyUpdate, 'opportunity.update', after)).toBe(true);
    expect(allowsWrite(r, onlyUpdate, 'opportunity.close', after)).toBe(false);
    expect(allowsWrite(r, onlyUpdate, 'opportunity.assign', after)).toBe(false);
    for (const c of OWNER_CODES) expect(allowsWrite(ME, sale, c, after)).toBe(false);
  });
});

describe('ownerLostAccess (TC 9a(v), 9a(vii))', () => {
  const owner = (ks: RoleKey[], active = true): EmployeeAccess => ({ id: 'o', departmentId: 'd1', active, scopes: scopesOf(...ks) });
  const o = opp({ ownerId: 'o' });
  it('người phụ trách còn đủ quyền và tài khoản dùng được => false', () => {
    expect(ownerLostAccess(o, owner(['sale']), true)).toBe(false);
  });
  it('bị gỡ vai trò (không còn opportunity.read) / đổi sang vai trò không có đường đầy đủ => true', () => {
    expect(ownerLostAccess(o, { id: 'o', departmentId: 'd1', active: true, scopes: {} }, true)).toBe(true);
    expect(ownerLostAccess(o, owner(['technician']), true)).toBe(true);
  });
  it('nghỉ việc / không tìm thấy / tài khoản không dùng được / cổng auth lỗi => true', () => {
    expect(ownerLostAccess(o, owner(['sale'], false), true)).toBe(true);
    expect(ownerLostAccess(o, undefined, true)).toBe(true);
    expect(ownerLostAccess(o, owner(['sale']), false)).toBe(true);
  });
  it('cờ chỉ trả cho người có opportunity.assign đang hiệu lực', () => {
    expect(seesOwnerLostFlag(of(scopesOf('admin')))).toBe(true);
    expect(seesOwnerLostFlag(of(scopesOf('sale')))).toBe(true);
    expect(seesOwnerLostFlag(of(scopesOf('accountant')))).toBe(false);
    expect(seesOwnerLostFlag(of(scopesOf('technician')))).toBe(false);
  });
});

describe('Khôi phục cơ hội đã xoá mềm (PR234-R3-SEC-02, TC 9c)', () => {
  const admin = of(scopesOf('admin')); const sale = of(scopesOf('sale')); const acct = of(scopesOf('accountant')); const tech = of(scopesOf('technician'));
  const row = (deleted: boolean, custDeleted = false) => ({ deletedAt: deleted ? new Date() : null, customer: { deletedAt: custDeleted ? new Date() : null } });
  it('chỉ opportunity.restore phạm vi ALL được dùng đường nạp riêng; mọi người khác nhận 404 TRƯỚC khi truy vấn', () => {
    expect(mayRestore(admin)).toBe(true);
    for (const s of [sale, acct, tech, NOBODY, of({ 'opportunity.restore': 'OWN' }), of({ 'opportunity.restore': 'DEPARTMENT' })]) {
      expect(mayRestore(s)).toBe(false);
      expect(code(() => assertMayLoadDeleted(s))).toBe('404 OPPORTUNITY_NOT_FOUND');
    }
    expect(code(() => assertMayLoadDeleted(admin))).toBe('OK');
  });
  it('người thiếu quyền không phân biệt được "không tồn tại" / "chưa xoá" / "đã xoá": luôn NOT_FOUND', () => {
    for (const r of [null, row(false), row(true), row(true, true)]) {
      expect(restoreDecision(sale, r)).toBe('NOT_FOUND');
      expect(code(() => assertRestorable(sale, r))).toBe('404 OPPORTUNITY_NOT_FOUND');
    }
  });
  it('Quản trị CRM: id không tồn tại => 404; chưa xoá => 409 OPPORTUNITY_STATE; khách còn bị xoá => 409 OPPORTUNITY_CUSTOMER_DELETED; đã xoá + khách còn hoạt động => OK', () => {
    expect(code(() => assertRestorable(admin, null))).toBe('404 OPPORTUNITY_NOT_FOUND');
    expect(code(() => assertRestorable(admin, row(false)))).toBe('409 OPPORTUNITY_STATE');
    expect(code(() => assertRestorable(admin, row(true, true)))).toBe('409 OPPORTUNITY_CUSTOMER_DELETED');
    expect(code(() => assertRestorable(admin, row(true)))).toBe('OK');
  });
  it('đường thường không bao giờ thấy cơ hội đã xoá, kể cả với người có quyền khôi phục', () => {
    expect(readsFull(ME, admin, opp({ deleted: true }))).toBe(false);
    for (const c of WRITE_CODES) expect(allowsWrite(ME, admin, c, opp({ deleted: true }))).toBe(false);
  });
  it('danh sách đã xoá: cần CẢ restore ALL và opportunity.read, và vẫn bị giới hạn bởi PHẠM VI đọc', () => {
    expect(deletedListWhere(ME, admin)).toEqual({ AND: [{ deletedAt: { not: null } }, {}] });
    for (const s of [sale, acct, tech, NOBODY]) expect(deletedListWhere(ME, s)).toEqual({ id: { in: [] } });
    // restore ALL nhưng không có read => không trả dòng nào; read OWN => chỉ trong phạm vi OWN (quyền khôi phục không mở rộng quyền xem).
    expect(deletedListWhere(ME, of({ 'opportunity.restore': 'ALL' }))).toEqual({ AND: [{ deletedAt: { not: null } }, { id: { in: [] } }] });
    expect(deletedListWhere(ME, of({ 'opportunity.restore': 'ALL', 'opportunity.read': 'OWN' })))
      .toEqual({ AND: [{ deletedAt: { not: null } }, { OR: [{ ownerId: 'me' }, { customer: { is: { ownerId: 'me' } } }] }] });
  });
});

describe('Ma trận 4 vai trò × 10 mã (TC 9) — lấy từ BIZ thật', () => {
  it('mỗi vai trò có đúng tập mã theo §5.2; Quản trị hệ thống không có mã nào', () => {
    const has = (k: RoleKey) => OPPORTUNITY_PERMISSIONS.filter((p) => scopesOf(k)[p]).map((p) => p.replace('opportunity.', '')).sort();
    expect(has('admin')).toEqual(['assign', 'close', 'create', 'delete', 'move_stage', 'read', 'reopen', 'restore', 'update']);
    expect(has('sale')).toEqual(['assign', 'close', 'create', 'move_stage', 'read', 'update']);
    expect(has('technician')).toEqual(['read_assigned']);
    expect(has('accountant')).toEqual(['read']);
    expect(Object.entries(BIZ).filter(([c, m]) => c.startsWith('opportunity.') && 'sysadmin' in m)).toEqual([]);
  });
});
