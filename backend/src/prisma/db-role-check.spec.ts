import { assessDbRole, DbRoleFacts, dbRoleFactsFromRow, enforceDbRoleAtStartup } from './db-role-check';

// B1.4 P3b (M-d): backend KHÔNG được chạy bằng role chủ sở hữu DB / superuser / role có CREATE trên schema public (mất tác dụng tách role S1).
// NODE_ENV=production: từ chối khởi động khi có bằng chứng sai cấu hình; môi trường khác (Windows chưa tách role): chỉ cảnh báo.
const ok: DbRoleFacts = { user: 'siscom_app', isSuperuser: false, isDbOwner: false, canCreateInPublic: false, isMigratorMember: false,
  ownsObjectsInPublic: false, hasAdminAttributes: false, hasBroadGrants: false, isMemberOfOtherRoles: false, hasAuthGrants: false, canWriteBusiness: true };

describe('assessDbRole', () => {
  it('siscom_app không superuser, không chủ sở hữu, không CREATE public, không thành viên migrator => đặc quyền tối thiểu, không vấn đề', () => {
    expect(assessDbRole(ok, 'production')).toEqual({ leastPrivilege: true, problems: [], enforce: true });
    expect(assessDbRole(ok, 'development')).toEqual({ leastPrivilege: true, problems: [], enforce: false });
  });
  it('liệt kê đủ từng vấn đề: chủ sở hữu DB, superuser, CREATE trên public, thành viên siscom_migrator, tên tài khoản là migrator/postgres', () => {
    const r = assessDbRole({ user: 'siscom_migrator', isSuperuser: true, isDbOwner: true, canCreateInPublic: true, isMigratorMember: true,
      ownsObjectsInPublic: true, hasAdminAttributes: true, hasBroadGrants: true, isMemberOfOtherRoles: true, hasAuthGrants: true, canWriteBusiness: true }, 'production');
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([
      expect.stringContaining('chủ sở hữu'), expect.stringContaining('superuser'), expect.stringContaining('CREATE'),
      expect.stringContaining('siscom_migrator'),
    ]));
    expect(r.problems.length).toBeGreaterThanOrEqual(4);
    expect(assessDbRole({ ...ok, user: 'postgres' }, 'production').problems.join(' ')).toContain('postgres');
  });
  // M-4 (rà soát P3b): điều kiện thật để tắt trigger là SỞ HỮU BẢNG/HÀM (không chỉ sở hữu DB); CREATEROLE/CREATEDB/BYPASSRLS cũng không
  // được có ở role ứng dụng.
  it('sở hữu bảng/sequence/hàm trong public (kể cả qua thành viên nhóm) => không tối thiểu', () => {
    const r = assessDbRole({ ...ok, ownsObjectsInPublic: true }, 'production');
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems.join(' ')).toContain('sở hữu bảng');
  });
  it('CREATEROLE / CREATEDB / BYPASSRLS => không tối thiểu', () => {
    const r = assessDbRole({ ...ok, hasAdminAttributes: true }, 'production');
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems.join(' ')).toContain('CREATEROLE');
  });
  // QA bằng AI I-2: chạy nhầm APP_GRANTS V1 (DML mọi bảng + EXECUTE mọi fn_auth_api_*) => S2/S3 mở lại mà role vẫn "không sở hữu gì".
  // Phải nhận ra: quyền ghi bảng RBAC / UPDATE password_hash / EXECUTE > 1 hàm SECURITY DEFINER.
  it('quyền rộng kiểu APP_GRANTS V1 => không tối thiểu (production từ chối)', () => {
    const r = assessDbRole({ ...ok, hasBroadGrants: true }, 'production');
    expect(r).toMatchObject({ leastPrivilege: false, enforce: true });
    expect(r.problems.join(' ')).toContain('APP_GRANTS_V2');
  });
  it('siscom_app là thành viên role khác (vd. nhóm cũ siscom_auth_rt) => không tối thiểu', () => {
    const r = assessDbRole({ ...ok, isMemberOfOtherRoles: true }, 'production');
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems.join(' ')).toContain('thành viên');
  });
  it('dbRoleFactsFromRow đọc đủ cột mới; thiếu cột => false (không làm hỏng khởi động)', () => {
    expect(dbRoleFactsFromRow({ user: 'x', has_broad_grants: true, is_member_of_other_roles: true })).toMatchObject({ hasBroadGrants: true, isMemberOfOtherRoles: true });
    expect(dbRoleFactsFromRow({ user: 'x' })).toMatchObject({ hasBroadGrants: false, isMemberOfOtherRoles: false });
    expect(dbRoleFactsFromRow({ user: 'x', owns_objects_in_public: true, has_admin_attributes: true })).toMatchObject({ ownsObjectsInPublic: true, hasAdminAttributes: true });
    expect(dbRoleFactsFromRow({ user: 'x' })).toMatchObject({ ownsObjectsInPublic: false, hasAdminAttributes: false });
  });
  it('chỉ một dấu hiệu (chủ sở hữu DB — mô hình cũ B1.1 trên Windows) cũng là không tối thiểu; enforce chỉ khi production', () => {
    const dev = assessDbRole({ ...ok, isDbOwner: true }, 'development');
    expect(dev).toMatchObject({ leastPrivilege: false, enforce: false });
    expect(dev.problems).toHaveLength(1);
    expect(assessDbRole({ ...ok, isDbOwner: true }, 'test').enforce).toBe(false);
    expect(assessDbRole({ ...ok, isDbOwner: true }, 'production').enforce).toBe(true);
  });
});

describe('enforceDbRoleAtStartup', () => {
  const log = () => { const w: string[] = []; const e: string[] = []; return { warn: (m: string) => w.push(m), error: (m: string) => e.push(m), w, e }; };
  it('production + role tối thiểu => trả về facts, không log lỗi', async () => {
    const l = log();
    await expect(enforceDbRoleAtStartup(async () => ok, 'production', l)).resolves.toEqual({ checked: true, leastPrivilege: true });
    expect(l.e).toEqual([]); expect(l.w).toEqual([]);
  });
  it('production + chạy bằng chủ sở hữu/migrator => NÉM lỗi (main.ts thoát 1), thông điệp nêu vấn đề nhưng không nêu URL', async () => {
    const l = log();
    await expect(enforceDbRoleAtStartup(async () => ({ ...ok, user: 'siscom_migrator', isDbOwner: true }), 'production', l))
      .rejects.toThrow(/chủ sở hữu/);
    expect(l.e.join(' ')).toContain('siscom_migrator');
  });
  it('production + DB chưa kết nối được lúc khởi động => KHÔNG chặn (giữ hành vi backend vẫn chạy khi DB tạm tắt), chỉ cảnh báo; không in chi tiết lỗi driver ra ngoài', async () => {
    const l = log();
    await expect(enforceDbRoleAtStartup(async () => { throw new Error('ECONNREFUSED postgresql://x:secret@h/db'); }, 'production', l,
      { retryMs: 15000, schedule: () => undefined, exit: () => undefined }))
      .resolves.toEqual({ checked: false, leastPrivilege: null });
    expect(l.w).toHaveLength(1); expect(l.w[0]).not.toContain('secret');
  });
  // I-2 (rà soát độc lập P3b): VPS khởi động lại, backend lên TRƯỚC PostgreSQL => lần kiểm đầu lỗi kết nối. Production KHÔNG được bỏ qua
  // vĩnh viễn: kiểm lại theo chu kỳ; khi kiểm được mà vi phạm => thoát tiến trình (exit 1); khi đạt => dừng kiểm lại.
  it('production + lần đầu không kết nối được => lên lịch kiểm lại; lần sau đọc được và VI PHẠM => exit(1)', async () => {
    const l = log(); const timers: Array<() => void> = []; const exits: number[] = [];
    let n = 0;
    const query = async () => { n++; if (n === 1) throw new Error('ECONNREFUSED'); return { ...ok, user: 'siscom_migrator', isDbOwner: true }; };
    const r = await enforceDbRoleAtStartup(query, 'production', l, { retryMs: 15000, schedule: (fn) => { timers.push(fn); }, exit: (c) => { exits.push(c); } });
    expect(r).toEqual({ checked: false, leastPrivilege: null });
    expect(timers).toHaveLength(1);
    await (timers.shift() as () => Promise<void>)();
    expect(exits).toEqual([1]);
    expect(l.e.join(' ')).toContain('chủ sở hữu');
  });
  it('production + kiểm lại: còn lỗi thì tiếp tục lên lịch (không bỏ cuộc); đạt thì dừng, không exit', async () => {
    const l = log(); const timers: Array<() => void> = []; const exits: number[] = [];
    let n = 0;
    const query = async () => { n++; if (n <= 2) throw new Error('x'); return ok; };
    await enforceDbRoleAtStartup(query, 'production', l, { retryMs: 15000, schedule: (fn) => { timers.push(fn); }, exit: (c) => { exits.push(c); } });
    await (timers.shift() as () => Promise<void>)(); // lần 2: vẫn lỗi => lên lịch tiếp
    expect(timers).toHaveLength(1);
    await (timers.shift() as () => Promise<void>)(); // lần 3: đạt
    expect(timers).toHaveLength(0); expect(exits).toEqual([]);
  });
  // QA Minor 7: đang tắt máy (onModuleDestroy) thì lần kiểm lại đã hẹn KHÔNG được chạy truy vấn (mở lại pool, giữ tiến trình sống).
  it('production: sau khi dừng (isStopped=true), lần kiểm lại đã hẹn không truy vấn, không lên lịch tiếp', async () => {
    const timers: Array<() => Promise<void>> = []; let stopped = false; let n = 0;
    const query = async () => { n++; throw new Error('x'); };
    await enforceDbRoleAtStartup(query, 'production', log(), { retryMs: 15000, schedule: (fn) => { timers.push(fn); }, exit: () => undefined, isStopped: () => stopped });
    stopped = true;
    await (timers.shift() as () => Promise<void>)();
    expect(n).toBe(1); expect(timers).toHaveLength(0);
  });
  it('ngoài production: không lên lịch kiểm lại khi DB chưa kết nối được', async () => {
    const timers: Array<() => void> = [];
    await enforceDbRoleAtStartup(async () => { throw new Error('x'); }, 'development', log(), { retryMs: 15000, schedule: (fn) => { timers.push(fn); }, exit: () => undefined });
    expect(timers).toHaveLength(0);
  });
  it('development + chủ sở hữu (Windows chưa tách role) => chỉ cảnh báo một lần, không ném', async () => {
    const l = log();
    await expect(enforceDbRoleAtStartup(async () => ({ ...ok, isDbOwner: true }), 'development', l)).resolves.toEqual({ checked: true, leastPrivilege: false });
    expect(l.e).toEqual([]); expect(l.w).toHaveLength(1); expect(l.w[0]).toContain('chủ sở hữu');
  });
});

// B1.4 P3c: hai pool. Pool nghiệp vụ (siscom_app) KHÔNG được còn quyền xác thực khi đã tách pool auth; pool auth (siscom_auth) PHẢI có
// quyền xác thực và KHÔNG được ghi bảng nghiệp vụ. Khi chưa tách (authSeparate=false, máy dev) thì pool app vẫn được giữ quyền xác thực.
describe('assessDbRole — hai pool (P3c)', () => {
  const base: DbRoleFacts = { user: 'siscom_app', isSuperuser: false, isDbOwner: false, canCreateInPublic: false, isMigratorMember: false,
    ownsObjectsInPublic: false, hasAdminAttributes: false, hasBroadGrants: false, isMemberOfOtherRoles: false, hasAuthGrants: false, canWriteBusiness: true };
  it('pool app, đã tách pool auth: còn quyền xác thực (auth_session / password_hash / chpw) => vi phạm (V3 chưa áp)', () => {
    const r = assessDbRole({ ...base, hasAuthGrants: true }, 'production', { pool: 'app', authSeparate: true });
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems.join(' ')).toContain('APP_GRANTS_V3');
  });
  it('pool app, CHƯA tách pool auth (dev): quyền xác thực là bình thường, không vi phạm', () => {
    expect(assessDbRole({ ...base, hasAuthGrants: true }, 'development', { pool: 'app', authSeparate: false }).leastPrivilege).toBe(true);
  });
  it('pool app sau V3: không quyền xác thực, có ghi nghiệp vụ => tối thiểu', () => {
    expect(assessDbRole(base, 'production', { pool: 'app', authSeparate: true }).leastPrivilege).toBe(true);
  });
  it('pool auth: thiếu quyền xác thực => vi phạm (AUTH_DATABASE_URL trỏ nhầm tài khoản hoặc V3 chưa áp)', () => {
    const r = assessDbRole({ ...base, user: 'siscom_auth', hasAuthGrants: false, canWriteBusiness: false }, 'production', { pool: 'auth', authSeparate: true });
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems.join(' ')).toContain('xác thực');
  });
  it('pool auth: ghi được bảng nghiệp vụ (customer) => vi phạm (đổi chỗ hai URL)', () => {
    const r = assessDbRole({ ...base, user: 'siscom_auth', hasAuthGrants: true, canWriteBusiness: true }, 'production', { pool: 'auth', authSeparate: true });
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems.join(' ')).toContain('nghiệp vụ');
  });
  it('pool auth đúng: có quyền xác thực, không ghi nghiệp vụ => tối thiểu', () => {
    expect(assessDbRole({ ...base, user: 'siscom_auth', hasAuthGrants: true, canWriteBusiness: false }, 'production', { pool: 'auth', authSeparate: true }).leastPrivilege).toBe(true);
  });
  it('dbRoleFactsFromRow đọc has_auth_grants / can_write_business; thiếu => false', () => {
    expect(dbRoleFactsFromRow({ user: 'x', has_auth_grants: true, can_write_business: true })).toMatchObject({ hasAuthGrants: true, canWriteBusiness: true });
    expect(dbRoleFactsFromRow({ user: 'x' })).toMatchObject({ hasAuthGrants: false, canWriteBusiness: false });
  });
});
