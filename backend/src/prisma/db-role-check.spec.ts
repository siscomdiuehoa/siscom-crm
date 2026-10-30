import { assessDbRole, DbRoleFacts, enforceDbRoleAtStartup } from './db-role-check';

// B1.4 P3b (M-d): backend KHÔNG được chạy bằng role chủ sở hữu DB / superuser / role có CREATE trên schema public (mất tác dụng tách role S1).
// NODE_ENV=production: từ chối khởi động khi có bằng chứng sai cấu hình; môi trường khác (Windows chưa tách role): chỉ cảnh báo.
const ok: DbRoleFacts = { user: 'siscom_app', isSuperuser: false, isDbOwner: false, canCreateInPublic: false, isMigratorMember: false };

describe('assessDbRole', () => {
  it('siscom_app không superuser, không chủ sở hữu, không CREATE public, không thành viên migrator => đặc quyền tối thiểu, không vấn đề', () => {
    expect(assessDbRole(ok, 'production')).toEqual({ leastPrivilege: true, problems: [], enforce: true });
    expect(assessDbRole(ok, 'development')).toEqual({ leastPrivilege: true, problems: [], enforce: false });
  });
  it('liệt kê đủ từng vấn đề: chủ sở hữu DB, superuser, CREATE trên public, thành viên siscom_migrator, tên tài khoản là migrator/postgres', () => {
    const r = assessDbRole({ user: 'siscom_migrator', isSuperuser: true, isDbOwner: true, canCreateInPublic: true, isMigratorMember: true }, 'production');
    expect(r.leastPrivilege).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([
      expect.stringContaining('chủ sở hữu'), expect.stringContaining('superuser'), expect.stringContaining('CREATE'),
      expect.stringContaining('siscom_migrator'),
    ]));
    expect(r.problems.length).toBeGreaterThanOrEqual(4);
    expect(assessDbRole({ ...ok, user: 'postgres' }, 'production').problems.join(' ')).toContain('postgres');
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
    await expect(enforceDbRoleAtStartup(async () => { throw new Error('ECONNREFUSED postgresql://x:secret@h/db'); }, 'production', l))
      .resolves.toEqual({ checked: false, leastPrivilege: null });
    expect(l.w).toHaveLength(1); expect(l.w[0]).not.toContain('secret');
  });
  it('development + chủ sở hữu (Windows chưa tách role) => chỉ cảnh báo một lần, không ném', async () => {
    const l = log();
    await expect(enforceDbRoleAtStartup(async () => ({ ...ok, isDbOwner: true }), 'development', l)).resolves.toEqual({ checked: true, leastPrivilege: false });
    expect(l.e).toEqual([]); expect(l.w).toHaveLength(1); expect(l.w[0]).toContain('chủ sở hữu');
  });
});
