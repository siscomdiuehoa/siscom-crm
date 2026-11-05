import { Argon2PasswordHasher, ARGON2_ALGO, ARGON2_PARAMS } from '../../common/auth/login/argon2.hasher';
import type { PrismaService } from '../../prisma/prisma.service';

// Khởi tạo xác thực MVP (Issue #8, 28/10/2026, phương án M1 mục 3 đã duyệt): chạy MỘT LẦN trong CHẾ ĐỘ KHỞI TẠO của M1
// (chưa có app_meta.auth_bootstrap_done): seed catalog quyền + 5 vai trò theo ma trận RBAC V2, 4 người dùng thử + 1 tài khoản kỹ thuật
// sysadmin (vai trò `admin` của M1, chỉ quyền sys.*), credential argon2id, rồi fn_auth_bootstrap_close. Sau đó mọi thay đổi vai trò/quyền
// phải qua luồng hai người của M1 (MVP không có UI). Mật khẩu chỉ nhận qua tham số, không ghi log, không in.
//
// Ma trận V2 (comment 6465588065): SALE read/update OWN, create (ownerId = chính mình, do service); ADMIN(V2)=crm_admin ALL kể cả xoá mềm/khôi phục;
// TECHNICIAN read DEPARTMENT; ACCOUNTANT read ALL. lookup.read: tất cả. contact theo customer tương ứng.
export const BOOTSTRAP_MARKER = 'mvp-v2-20261028';
export type BootstrapRoleCode = 'sysadmin' | 'admin' | 'sale' | 'technician' | 'accountant';
export interface BootstrapUser { key: BootstrapRoleCode; email: string; fullName: string; password: string; departmentCode: string }
export interface BootstrapResult { closed: boolean; employees: Array<{ key: BootstrapRoleCode; code: string; email: string; role: string }> }

type Scope = 'ALL' | 'DEPARTMENT' | 'OWN';
export const BIZ: Record<string, Partial<Record<Exclude<BootstrapRoleCode, 'sysadmin'>, Scope>>> = {
  'customer.read':    { admin: 'ALL', sale: 'OWN', technician: 'DEPARTMENT', accountant: 'ALL' },
  'customer.create':  { admin: 'ALL', sale: 'OWN' },
  'customer.update':  { admin: 'ALL', sale: 'OWN' },
  'customer.delete':  { admin: 'ALL' },
  'customer.restore': { admin: 'ALL' },
  'contact.read':     { admin: 'ALL', sale: 'OWN', technician: 'DEPARTMENT', accountant: 'ALL' },
  'contact.create':   { admin: 'ALL', sale: 'OWN' },
  'lookup.read':      { admin: 'ALL', sale: 'ALL', technician: 'ALL', accountant: 'ALL' },
  // B3 A4 — ma trận §5 thiết kế B3 v5.3 (OWNER_DECISION 03-04/11/2026): 9 mã, 16 dòng (crm_admin 6, sales 5, technician 4, accountant 1).
  // DB đã bootstrap (demo/thật) KHÔNG lấy từ đây: cấp qua yêu cầu 2 người bằng docs/B3_ACTIVITY_PERMISSIONS.sql.txt (unit test giữ 2 nguồn khớp nhau).
  'activity.read':             { admin: 'ALL', sale: 'OWN', technician: 'DEPARTMENT', accountant: 'ALL' },
  'activity.create':           { admin: 'ALL', sale: 'OWN' },
  'activity.create_tech':      { technician: 'DEPARTMENT' },
  'activity.update':           { admin: 'ALL', sale: 'OWN' },
  'activity.update_own':       { technician: 'DEPARTMENT' },
  'activity.assign':           { admin: 'ALL', sale: 'OWN' },
  'activity.delete':           { admin: 'ALL' },
  'activity.assign_external':  { admin: 'ALL', sale: 'OWN' },
  'activity.transfer_request': { technician: 'DEPARTMENT' },
};
// Quyền hệ thống của M1: sysadmin (mã vai trò `admin`) = nhóm REQUEST; crm_admin = APPROVE (access.approve) + đọc.
const SYS_ADMIN = ['employee.read', 'employee.manage', 'role.read', 'role.manage', 'auth.credential.manage', 'auth.reset.request', 'access.request', 'audit.read'];
const SYS_CRM_ADMIN = ['employee.read', 'role.read', 'access.approve', 'audit.read'];
// Mã vai trò trong DB: `admin` là vai trò kỹ thuật của M1 (SoD: không được giữ quyền BIZ); ADMIN của ma trận V2 là `crm_admin`.
export const ROLE_CODE: Record<BootstrapRoleCode, string> = { sysadmin: 'admin', admin: 'crm_admin', sale: 'sales', technician: 'technician', accountant: 'accountant' };
const ROLE_NAME: Record<string, string> = { admin: 'Quản trị hệ thống (kỹ thuật)', crm_admin: 'Quản trị CRM', sales: 'Kinh doanh', technician: 'Kỹ thuật', accountant: 'Kế toán' };

export const MIN_BOOTSTRAP_PASSWORD = 12;

export async function bootstrapAuth(prisma: PrismaService, users: readonly BootstrapUser[], hasher: Argon2PasswordHasher = new Argon2PasswordHasher()): Promise<BootstrapResult> {
  const open = await prisma.$queryRaw<{ open: boolean }[]>`SELECT public.fn_auth_bootstrap_open() AS open`;
  if (!open[0]?.open) throw new Error('BOOTSTRAP_CLOSED: chế độ khởi tạo đã đóng; không khởi tạo lại.');
  const keys = new Set(users.map((u) => u.key));
  for (const k of ['sysadmin', 'admin'] as const) if (!keys.has(k)) throw new Error('BOOTSTRAP_INPUT: thiếu người dùng ' + k + ' (M1 cần >= 1 admin và >= 1 người duyệt).');
  if (keys.size !== users.length) throw new Error('BOOTSTRAP_INPUT: trùng key người dùng.');
  for (const u of users) {
    if (typeof u.password !== 'string' || u.password.length < MIN_BOOTSTRAP_PASSWORD) throw new Error('BOOTSTRAP_INPUT: mật khẩu ' + u.key + ' phải >= ' + MIN_BOOTSTRAP_PASSWORD + ' ký tự.');
    if (!/^[^@\s]+@[^@\s]+$/.test(u.email)) throw new Error('BOOTSTRAP_INPUT: email ' + u.key + ' không hợp lệ.');
  }
  // Băm trước (tốn CPU) ngoài transaction.
  const hashes = new Map<BootstrapRoleCode, string>();
  for (const u of users) hashes.set(u.key, await hasher.hash(u.password));

  const result: BootstrapResult = { closed: false, employees: [] };
  await prisma.$transaction(async (tx) => {
    // Catalog quyền
    const permCodes = [...Object.keys(BIZ), ...new Set([...SYS_ADMIN, ...SYS_CRM_ADMIN])];
    await tx.permission.createMany({ data: permCodes.map((code) => ({ code })), skipDuplicates: true });
    const perms = Object.fromEntries((await tx.permission.findMany({ where: { code: { in: permCodes } }, select: { id: true, code: true } })).map((p) => [p.code, p.id]));
    // Vai trò (is_confirmed = true: SessionActorProvider chỉ cấp quyền cho vai trò đã xác nhận)
    const roleIds: Record<string, string> = {};
    for (const code of Object.values(ROLE_CODE)) {
      const r = await tx.role.upsert({ where: { code }, create: { code, name: ROLE_NAME[code], isSystem: true, isConfirmed: true }, update: { isConfirmed: true }, select: { id: true } });
      roleIds[code] = r.id;
    }
    // Quyền theo vai trò
    const rp: Array<{ roleId: string; permissionId: string; scope: Scope }> = [];
    for (const [code, m] of Object.entries(BIZ)) for (const [k, scope] of Object.entries(m) as Array<[Exclude<BootstrapRoleCode, 'sysadmin'>, Scope]>) rp.push({ roleId: roleIds[ROLE_CODE[k]], permissionId: perms[code], scope });
    for (const code of SYS_ADMIN) rp.push({ roleId: roleIds['admin'], permissionId: perms[code], scope: 'ALL' });
    for (const code of SYS_CRM_ADMIN) rp.push({ roleId: roleIds['crm_admin'], permissionId: perms[code], scope: 'ALL' });
    await tx.rolePermission.createMany({ data: rp, skipDuplicates: true });
    // Phòng ban + nhân viên + credential + vai trò
    for (const u of users) {
      const dept = await tx.department.upsert({ where: { code: u.departmentCode }, create: { code: u.departmentCode, name: u.departmentCode }, update: {}, select: { id: true } });
      const existing = await tx.employee.findFirst({ where: { email: { equals: u.email, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
      if (existing) throw new Error('BOOTSTRAP_INPUT: email đã tồn tại cho ' + u.key + '.');
      const e = await tx.employee.create({ data: { fullName: u.fullName, email: u.email, departmentId: dept.id, status: 'ACTIVE', isDemo: true }, select: { id: true, code: true } });
      await tx.employeeCredential.create({ data: { employeeId: e.id, passwordHash: hashes.get(u.key)!, passwordAlgo: ARGON2_ALGO, passwordParams: { ...ARGON2_PARAMS }, mustChangePassword: false, status: 'ACTIVE' } });
      await tx.employeeRole.create({ data: { employeeId: e.id, roleId: roleIds[ROLE_CODE[u.key]] } });
      await tx.auditLog.create({ data: { actorType: 'SYSTEM', action: 'auth.bootstrap_user', entityType: 'employee', entityId: e.id, entityCode: e.code, summary: 'Khởi tạo tài khoản ' + ROLE_CODE[u.key] } });
      result.employees.push({ key: u.key, code: e.code, email: u.email, role: ROLE_CODE[u.key] });
    }
    // Đóng khởi tạo vĩnh viễn (M1.2 kiểm: >= 1 admin và >= 1 người duyệt có credential ACTIVE)
    await tx.$executeRaw`SELECT public.fn_auth_bootstrap_close(${BOOTSTRAP_MARKER})`;
    result.closed = true;
  });
  return result;
}

// Đọc mật khẩu từ biến môi trường BOOTSTRAP_PASSWORD_<KEY> (không in ra). Email/họ tên mặc định cho 4+1 tài khoản thử.
export function bootstrapUsersFromEnv(env: NodeJS.ProcessEnv, domain = env.BOOTSTRAP_EMAIL_DOMAIN || 'siscom.local'): BootstrapUser[] {
  const def: Array<[BootstrapRoleCode, string, string, string]> = [
    ['sysadmin', 'sysadmin', 'Quản trị hệ thống', 'IT'],
    ['admin', 'admin', 'Quản trị CRM', 'BGD'],
    ['sale', 'sale', 'Nhân viên kinh doanh', 'KD'],
    ['technician', 'kythuat', 'Nhân viên kỹ thuật', 'KT'],
    ['accountant', 'ketoan', 'Nhân viên kế toán', 'KETOAN'],
  ];
  return def.map(([key, local, fullName, departmentCode]) => {
    const pw = env['BOOTSTRAP_PASSWORD_' + key.toUpperCase()];
    if (!pw) throw new Error('Thiếu biến môi trường BOOTSTRAP_PASSWORD_' + key.toUpperCase());
    return { key, email: local + '@' + domain, fullName, password: pw, departmentCode };
  });
}
