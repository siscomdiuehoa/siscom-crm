import { assessDbRole, DbRoleFacts, dbRoleFactsFromRow, enforceDbRoleAtStartup } from './db-role-check';

// B1.4 P3b (M-d): backend KHÔNG được chạy bằng role chủ sở hữu DB / superuser / role có CREATE trên schema public (mất tác dụng tách role S1).
// NODE_ENV=production: từ chối khởi động khi có bằng chứng sai cấu hình; môi trường khác (Windows chưa tách role): chỉ cảnh báo.
const ok: DbRoleFacts = { user: 'siscom_app', isSuperuser: false, isDbOwner: false, canCreateInPublic: false, isMigratorMember: false,
  ownsObjectsInPublic: false, hasAdminAttributes: false };

describe('assessDbRole', () => {
  it('siscom_app không superuser, không chủ sở hữu, không CREATE public, không thành viên migrator => đặc quyền tối thiểu, không vấn đề', () => {
    expect(assessDbRole(ok, 'production')).toEqual({ leastPrivilege: true, problems: [], enforce: true });
    expect(assessDbRole(ok, 'development')).toEqual({ leastPrivilege: true, problems: [], enforce: false });
  });
  it('liệt kê đủ từng vấn đề: chủ sở hữu DB, superuser, CREATE trên public, thành viên siscom_migrator, tên tài khoản là migrator/postgres', () => {
    const r = assessDbRole({ user: 'siscom_migrator', isSuperuser: true, isDbOwner: true, canCreateInPublic: true, isMigratorMember: true,
      ownsObjectsInPublic: true, hasAdminAttributes: true }, 'production');
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
  it('dbRoleFactsFromRow đọc đủ cột mới; thiếu cột => false (không làm hỏng khởi động)', () => {
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
