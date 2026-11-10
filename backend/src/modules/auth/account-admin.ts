import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Argon2PasswordHasher, ARGON2_ALGO, ARGON2_PARAMS } from '../../common/auth/login/argon2.hasher';
import { checkPasswordPolicy } from '../../common/auth/login/password-policy';
import type { PrismaService } from '../../prisma/prisma.service';

// FV-5 (CT-FV5-1, Owner 08/11/2026): quản lý tài khoản nhân viên SAU khi bootstrap đã đóng — dùng ĐÚNG các hàm đặc quyền M1.2 (luồng 2 người)
// thay vì ghi thẳng bảng xác thực. Chạy bằng CHỦ SỞ HỮU DB (siscom_migrator sau tách role): siscom_app không INSERT được employee và
// các hàm fn_auth_api_* đã REVOKE FROM PUBLIC. Mỗi thao tác = MỘT transaction (lỗi giữa chừng => không còn gì dở dang).
//   add            : employee (owner INSERT) -> fn_auth_api_credential_create (placeholder DISABLED/none)
//                    -> ROLE_GRANT [request_create(requester) -> request_decide(approver) -> role_grant(requester)]
//                    -> PASSWORD_RESET [request_create -> request_decide -> reset_token_issue -> reset_password] -> bật must_change_password.
//   reset-password : PASSWORD_RESET như trên -> bật must_change_password. CHỈ cho tài khoản đang ACTIVE: tài khoản đang khoá => ACCOUNT_DISABLED (F225-C).
//   unlock         : thao tác RIÊNG để mở khoá (F225-C, Owner 10/11/2026): chỉ tài khoản đang DISABLED, bắt buộc lý do + gõ lại đúng MÃ nhân viên
//                    (--confirm-unlock). M1.2 chỉ cho mở lại kèm mật khẩu mới => cấp mật khẩu tạm mới + must_change_password + audit ACCOUNT_UNLOCK.
//   disable        : fn_auth_api_credential_disable (tăng token_version => thu hồi mọi phiên; DB chặn khoá admin/người duyệt cuối cùng).
//   list           : chỉ đọc; không trả hash.
// GIỚI HẠN (như B3_ACTIVITY_PERMISSIONS.sql.txt): requester/approver do NGƯỜI VẬN HÀNH khai báo; DB kiểm 2 người KHÁC nhau, đúng nhóm quyền,
// đang ACTIVE — không xác thực được người thật. Mật khẩu sinh ngẫu nhiên, không in, không ghi log; chỉ trả về cho CLI ghi file riêng.

export const TEST_DB_RE = /^siscom_crm_(test|restore)_\d{8}_\d{6}$/;
export const LOCKED_DBS: readonly string[] = ['siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948'];
// Vai trò cấp được qua CLI. `admin` (vai trò KỸ THUẬT, nhóm REQUEST) cố ý KHÔNG có: cấp riêng khi Owner duyệt.
// Owner 08/11/2026: tạm CẤM `crm_admin` (xem toàn bộ khách + là người duyệt) cho tới khi có phê duyệt hai người thật (thiết kế A1+A3).
export const GRANTABLE_ROLES: readonly string[] = ['sales', 'technician', 'accountant'];
const REQUEST_TTL_MIN = 15;
const RESET_TOKEN_TTL_MIN = 10;

export class AccountAdminError extends Error {
  constructor(readonly code: string, message: string) { super(code + ': ' + message); }
}

// FV5-DB-GUARD (Owner 10/11/2026): ALLOWLIST cứng trong mã — công cụ CHỈ chạy trên PostgreSQL thử cách ly: host 127.0.0.1/localhost, cổng 55470,
// tên DB siscom_crm_(test|restore)_<stamp>. KHÔNG có cờ/biến nào nới giới hạn này (đã bỏ --allow-db): F225-A (hai người chỉ là khai báo) và
// F225-B (bật must_change_password bằng UPDATE trực tiếp) chưa được duyệt cho vận hành thực tế. Baseline đã khoá: luôn từ chối.
export const TEST_PG_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];
export const TEST_PG_PORT = 55470;
export function assertTargetDb(name: string): void {
  if (!name) throw new AccountAdminError('DB_REFUSED', 'không xác định được tên database.');
  if (LOCKED_DBS.includes(name)) throw new AccountAdminError('DB_REFUSED', name + ' là baseline đã khoá.');
  if (!TEST_DB_RE.test(name)) throw new AccountAdminError('DB_REFUSED', '"' + name + '" không phải database thử (siscom_crm_test_*/siscom_crm_restore_*). Công cụ chỉ chạy trên PostgreSQL thử.');
}

// Kiểm URL TRƯỚC khi mở kết nối: đúng giao thức, host cục bộ, cổng ghi rõ = 55470, tên DB thử. Tham số truy vấn host/hostaddr/port/service
// (libpq cho phép đổi đích kết nối) bị từ chối. Thông điệp lỗi không bao giờ chứa URL/mật khẩu.
export function assertTargetUrl(url: string): { dbName: string; port: string; user: string } {
  let u: URL;
  try { u = new URL(url); } catch { throw new AccountAdminError('DB_REFUSED', 'MIGRATE_DATABASE_URL không hợp lệ.'); }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new AccountAdminError('DB_REFUSED', 'MIGRATE_DATABASE_URL phải là postgresql://.');
  if (!TEST_PG_HOSTS.includes(u.hostname)) throw new AccountAdminError('DB_REFUSED', 'chỉ kết nối PostgreSQL thử trên máy cục bộ (127.0.0.1 / localhost).');
  if (u.port !== String(TEST_PG_PORT)) throw new AccountAdminError('DB_REFUSED', 'chỉ kết nối PostgreSQL thử ở cổng ' + TEST_PG_PORT + ' (cổng khác, kể cả 5432 và cụm demo, bị từ chối).');
  for (const k of u.searchParams.keys()) {
    if (['host', 'hostaddr', 'port', 'service', 'dbname'].includes(k.toLowerCase())) throw new AccountAdminError('DB_REFUSED', 'MIGRATE_DATABASE_URL không được chứa tham số "' + k + '".');
  }
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  assertTargetDb(dbName);
  return { dbName, port: u.port, user: decodeURIComponent(u.username) };
}

// Mật khẩu ngẫu nhiên (CSPRNG) đạt chính sách D17; bảng chữ bỏ ký tự dễ nhầm (0/O, 1/l/I) và ký tự gây rắc rối khi gõ/CSV/shell.
const LOWER = 'abcdefghijkmnopqrstuvwxyz'; const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; const DIGIT = '23456789'; const SYMBOL = '-_.~+=';
export function generatePassword(ctx: { email?: string | null; code?: string | null } = {}, length = 20): string {
  if (length < 16) throw new AccountAdminError('INPUT', 'độ dài mật khẩu tối thiểu 16.');
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  for (let attempt = 0; attempt < 100; attempt++) {
    const chars = [LOWER, UPPER, DIGIT, SYMBOL].map((set) => set[randomInt(set.length)]);
    while (chars.length < length) chars.push(all[randomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    const pw = chars.join('');
    if (checkPasswordPolicy(pw, ctx).length === 0) return pw;
  }
  throw new AccountAdminError('INTERNAL', 'không sinh được mật khẩu đạt chính sách.');
}

export type Command = 'add' | 'reset-password' | 'disable' | 'unlock' | 'list';
export interface ParsedArgs {
  command: Command; requester?: string; approver?: string; employee?: string; email?: string; fullName?: string; department?: string;
  role?: string; phone?: string; title?: string; reason?: string; out?: string; confirmUnlock?: string; demo: boolean; yes: boolean;
}
const FLAGS: Record<string, keyof ParsedArgs> = {
  '--requester': 'requester', '--approver': 'approver', '--employee': 'employee', '--email': 'email', '--full-name': 'fullName', '--department': 'department',
  '--role': 'role', '--phone': 'phone', '--title': 'title', '--reason': 'reason', '--out': 'out', '--confirm-unlock': 'confirmUnlock',
};
const NEEDS: Record<Command, Array<keyof ParsedArgs>> = {
  add: ['requester', 'approver', 'email', 'fullName', 'department', 'role', 'out'],
  'reset-password': ['requester', 'approver', 'employee', 'out'],
  disable: ['requester', 'employee', 'reason'],
  unlock: ['requester', 'approver', 'employee', 'reason', 'confirmUnlock', 'out'],
  list: [],
};
// Không nhận mật khẩu qua tham số (mật khẩu chỉ do CLI sinh). Cờ lạ => từ chối (tránh gõ nhầm làm đổi ý nghĩa).
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (!cmd || !(cmd in NEEDS)) throw new AccountAdminError('INPUT', 'lệnh phải là add | reset-password | disable | unlock | list.');
  const out: ParsedArgs = { command: cmd as Command, demo: false, yes: false };
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i];
    if (f === '--demo') { out.demo = true; continue; }
    if (f === '--yes') { out.yes = true; continue; }
    const key = FLAGS[f];
    if (!key) throw new AccountAdminError('INPUT', 'tham số không hỗ trợ: ' + f);
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new AccountAdminError('INPUT', 'thiếu giá trị cho ' + f);
    (out as unknown as Record<string, unknown>)[key] = v.trim();
    i++;
  }
  const missing = NEEDS[out.command].filter((k) => !out[k]);
  if (missing.length) throw new AccountAdminError('INPUT', 'thiếu tham số: ' + missing.map((k) => '--' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())).join(', '));
  if (out.confirmUnlock && out.command !== 'unlock') throw new AccountAdminError('INPUT', '--confirm-unlock chỉ dùng cho lệnh unlock.');
  if (out.requester && out.approver && out.requester.toLowerCase() === out.approver.toLowerCase()) throw new AccountAdminError('TWO_PERSON', 'người yêu cầu và người duyệt phải KHÁC nhau.');
  if (out.role && !GRANTABLE_ROLES.includes(out.role)) throw new AccountAdminError('INPUT', 'vai trò phải là một trong: ' + GRANTABLE_ROLES.join(', ') + '.');
  if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw new AccountAdminError('INPUT', 'email không hợp lệ.');
  return out;
}

type Db = Pick<PrismaService, '$transaction' | '$queryRaw' | '$executeRaw'>;
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
export interface Hasher { hash(pw: string): Promise<string> }
export interface IssuedAccount { code: string; email: string; fullName: string; role?: string; password: string }
interface EmpRow { id: string; code: string; email: string | null; full_name: string; status: string; cred_status: string | null }

export class AccountAdmin {
  constructor(private readonly db: Db, private readonly hasher: Hasher = new Argon2PasswordHasher()) {}

  // Kiểm môi trường TRƯỚC mọi ghi: đúng DB thử, có quyền EXECUTE hàm đặc quyền (chủ sở hữu), bootstrap đã đóng.
  // serverPort (CLI luôn truyền TEST_PG_PORT — FV5-DB-GUARD): cổng THẬT của máy chủ theo inet_server_port() phải khớp; khác hoặc không xác minh
  // được (NULL, vd kết nối socket/qua trung gian) => từ chối. Không truyền (test tích hợp gọi thẳng lớp này trên PostgreSQL của CI) => không kiểm cổng.
  async preflight(opts: { serverPort?: number } = {}): Promise<string> {
    const r = await this.db.$queryRaw<{ db: string; can: boolean; open: boolean; port: number | null }[]>`
      SELECT current_database() AS db,
             has_function_privilege(current_user, 'public.fn_auth_api_credential_create(uuid, uuid)', 'EXECUTE') AS can,
             public.fn_auth_bootstrap_open() AS open,
             inet_server_port() AS port`;
    const row = r[0];
    assertTargetDb(row?.db ?? '');
    if (opts.serverPort !== undefined && Number(row.port) !== opts.serverPort) {
      throw new AccountAdminError('DB_REFUSED', 'máy chủ PostgreSQL không ở cổng thử ' + opts.serverPort + ' (hoặc không xác minh được cổng); huỷ trước khi ghi.');
    }
    if (!row.can) throw new AccountAdminError('NOT_OWNER', 'phải chạy bằng chủ sở hữu DB (siscom_migrator): không EXECUTE được hàm đặc quyền.');
    if (row.open) throw new AccountAdminError('BOOTSTRAP_OPEN', 'khởi tạo chưa đóng — DB mới dùng auth:bootstrap, không dùng công cụ này.');
    return row.db;
  }

  async add(a: ParsedArgs): Promise<IssuedAccount> {
    const email = a.email!.toLowerCase();
    const password = generatePassword({ email });
    const hash = await this.hasher.hash(password); // băm (tốn CPU) ngoài transaction
    return this.tx(async (tx) => {
      const req = await this.actor(tx, a.requester!); const appr = await this.actor(tx, a.approver!);
      if (req === appr) throw new AccountAdminError('TWO_PERSON', 'người yêu cầu và người duyệt phải KHÁC nhau.');
      const dup = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM public.employee WHERE lower(email) = ${email} AND deleted_at IS NULL`;
      if (dup[0].n > 0) throw new AccountAdminError('DUPLICATE', 'email đã có nhân viên.');
      const dept = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.department WHERE code = ${a.department} AND is_active`;
      if (!dept.length) throw new AccountAdminError('INPUT', 'phòng ban "' + a.department + '" không tồn tại hoặc đã ngừng.');
      const role = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.role WHERE code = ${a.role} AND is_confirmed`;
      if (!role.length) throw new AccountAdminError('INPUT', 'vai trò "' + a.role + '" chưa có trong DB.');
      const emp = await tx.$queryRaw<{ id: string; code: string }[]>`
        INSERT INTO public.employee (full_name, email, phone, department_id, position_title, status, is_demo)
        VALUES (${a.fullName}, ${email}, ${a.phone ?? null}, ${dept[0].id}::uuid, ${a.title ?? null}, 'ACTIVE', ${a.demo})
        RETURNING id, code`;
      const e = emp[0];
      await tx.$executeRaw`SELECT public.fn_auth_api_audit('USER', ${req}::uuid, 'EMPLOYEE_CREATE', 'employee', ${e.id}::uuid, 'FV-5 account-admin', NULL)`;
      await tx.$executeRaw`SELECT public.fn_auth_api_credential_create(${req}::uuid, ${e.id}::uuid)`;
      const g = await this.approved(tx, req, appr, 'ROLE_GRANT', e.id, role[0].id);
      await tx.$executeRaw`SELECT public.fn_auth_api_role_grant(${req}::uuid, ${g}::uuid)`;
      await this.setPassword(tx, req, appr, e.id, hash, null); // placeholder vừa tạo trong CHÍNH transaction này (DISABLED/none)
      return { code: e.code, email, fullName: a.fullName!, role: a.role, password };
    });
  }

  async resetPassword(a: ParsedArgs): Promise<IssuedAccount> {
    return this.tx(async (tx) => {
      const req = await this.actor(tx, a.requester!); const appr = await this.actor(tx, a.approver!);
      if (req === appr) throw new AccountAdminError('TWO_PERSON', 'người yêu cầu và người duyệt phải KHÁC nhau.');
      const e = await this.employee(tx, a.employee!);
      if (!e.cred_status) throw new AccountAdminError('INPUT', 'nhân viên ' + e.code + ' chưa có thông tin đăng nhập (dùng lệnh add).');
      const password = generatePassword({ email: e.email, code: e.code });
      const hash = await this.hasher.hash(password);
      await this.setPassword(tx, req, appr, e.id, hash, 'ACTIVE'); // F225-C: không bao giờ mở khoá
      return { code: e.code, email: e.email ?? '', fullName: e.full_name, password };
    });
  }

  // F225-C: mở khoá là thao tác RIÊNG, hai người, có lý do, và người vận hành phải gõ lại ĐÚNG mã nhân viên (không nhận email/viết khác).
  async unlock(a: ParsedArgs): Promise<IssuedAccount> {
    return this.tx(async (tx) => {
      const req = await this.actor(tx, a.requester!); const appr = await this.actor(tx, a.approver!);
      if (req === appr) throw new AccountAdminError('TWO_PERSON', 'người yêu cầu và người duyệt phải KHÁC nhau.');
      const e = await this.employee(tx, a.employee!);
      if (a.confirmUnlock !== e.code) throw new AccountAdminError('CONFIRM_UNLOCK', '--confirm-unlock phải đúng mã nhân viên ' + e.code + '; huỷ, không ghi gì.');
      if (!e.cred_status) throw new AccountAdminError('INPUT', 'nhân viên ' + e.code + ' chưa có thông tin đăng nhập (dùng lệnh add).');
      const password = generatePassword({ email: e.email, code: e.code });
      const hash = await this.hasher.hash(password);
      await this.setPassword(tx, req, appr, e.id, hash, 'DISABLED');
      await tx.$executeRaw`SELECT public.fn_auth_api_audit('USER', ${req}::uuid, 'ACCOUNT_UNLOCK', 'employee', ${e.id}::uuid, ${'FV-5 account-admin unlock: ' + (a.reason ?? '')}, NULL)`;
      return { code: e.code, email: e.email ?? '', fullName: e.full_name, password };
    });
  }

  async disable(a: ParsedArgs): Promise<{ code: string }> {
    return this.tx(async (tx) => {
      const req = await this.actor(tx, a.requester!);
      const e = await this.employee(tx, a.employee!);
      await tx.$queryRaw`SELECT public.fn_auth_api_credential_disable(${req}::uuid, ${e.id}::uuid, ${a.reason ?? ''})`;
      return { code: e.code };
    });
  }

  async list(): Promise<Array<{ code: string; fullName: string; email: string | null; department: string | null; roles: string; status: string; login: string | null; mustChange: boolean | null }>> {
    const rows = await this.db.$queryRaw<Array<{ code: string; full_name: string; email: string | null; dept: string | null; roles: string | null; status: string; cred: string | null; must: boolean | null }>>`
      SELECT e.code, e.full_name, e.email, d.code AS dept, string_agg(r.code, ',' ORDER BY r.code) AS roles, e.status::text AS status,
             c.status::text AS cred, c.must_change_password AS must
        FROM public.employee e
        LEFT JOIN public.department d ON d.id = e.department_id
        LEFT JOIN public.employee_role er ON er.employee_id = e.id
        LEFT JOIN public.role r ON r.id = er.role_id
        LEFT JOIN public.employee_credential c ON c.employee_id = e.id
       WHERE e.deleted_at IS NULL
       GROUP BY e.code, e.full_name, e.email, d.code, e.status, c.status, c.must_change_password
       ORDER BY e.code`;
    return rows.map((r) => ({ code: r.code, fullName: r.full_name, email: r.email, department: r.dept, roles: r.roles ?? '', status: r.status, login: r.cred, mustChange: r.must }));
  }

  // PASSWORD_RESET hai người: request -> duyệt -> phát hành mã reset (chỉ gửi SHA-256) -> đặt mật khẩu bằng mã gốc (DB tự băm & so).
  // fn_auth_api_reset_password đặt must_change_password = false => bật lại (chủ sở hữu; cột không thuộc nhóm bí mật) + ghi nhật ký.
  // expect (F225-C): trạng thái credential BẮT BUỘC trước khi đặt mật khẩu — 'ACTIVE' (reset-password), 'DISABLED' (unlock), null (add: placeholder mới).
  private async setPassword(tx: Tx, req: string, appr: string, employeeId: string, hash: string, expect: 'ACTIVE' | 'DISABLED' | null): Promise<void> {
    // M1 (Owner 08/11/2026): khoá dòng credential và ghi nhớ token_version TRƯỚC khi đặt mật khẩu; sau reset, cờ chỉ được bật khi
    // token_version = cũ + 1 VÀ password_hash = đúng hash vừa đặt (đúng tài khoản, đúng lần reset này, không bị đổi chen giữa).
    const cur = await tx.$queryRaw<{ token_version: number }[]>`SELECT token_version FROM public.employee_credential WHERE employee_id = ${employeeId}::uuid FOR UPDATE`;
    if (cur.length !== 1) throw new AccountAdminError('INTERNAL', 'nhân viên chưa có thông tin đăng nhập.');
    if (expect) {
      // Đọc SAU khi đã khoá dòng (FOR UPDATE ở trên) => không ai đổi trạng thái chen giữa; fn_auth_api_reset_password luôn đặt status = ACTIVE.
      const st = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM public.employee_credential WHERE employee_id = ${employeeId}::uuid`;
      const status = st[0]?.status;
      if (expect === 'ACTIVE' && status !== 'ACTIVE') throw new AccountAdminError('ACCOUNT_DISABLED', 'tài khoản đang bị khoá; reset-password KHÔNG mở khoá. Mở khoá là thao tác riêng: lệnh unlock.');
      if (expect === 'DISABLED' && status !== 'DISABLED') throw new AccountAdminError('NOT_DISABLED', 'tài khoản không ở trạng thái khoá; không có gì để mở (đặt lại mật khẩu: reset-password).');
    }
    const r = await this.approved(tx, req, appr, 'PASSWORD_RESET', employeeId, null);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    await tx.$queryRaw`SELECT public.fn_auth_api_reset_token_issue(${req}::uuid, ${r}::uuid, ${tokenHash}, ${RESET_TOKEN_TTL_MIN}::int)`;
    const res = await tx.$queryRaw<{ r: string }[]>`
      SELECT public.fn_auth_api_reset_password(${employeeId}::uuid, ${token}, ${hash}, ${ARGON2_ALGO}, ${JSON.stringify(ARGON2_PARAMS)}::jsonb) AS r`;
    if (res[0]?.r !== 'OK') throw new AccountAdminError('RESET_FAILED', 'đặt mật khẩu không thành công (' + String(res[0]?.r) + ').');
    await markMustChange(tx, employeeId, { tokenVersion: Number(cur[0].token_version) + 1, passwordHash: hash });
    await tx.$executeRaw`SELECT public.fn_auth_api_audit('USER', ${req}::uuid, 'PASSWORD_MUST_CHANGE_SET', 'employee', ${employeeId}::uuid, 'FV-5 account-admin', NULL)`;
  }

  private async approved(tx: Tx, req: string, appr: string, type: 'ROLE_GRANT' | 'PASSWORD_RESET', employeeId: string, roleId: string | null): Promise<string> {
    const payload = JSON.stringify({ source: 'fv5-account-admin', type });
    const c = await tx.$queryRaw<{ id: string }[]>`
      SELECT public.fn_auth_api_request_create(${req}::uuid, ${type}::public.privileged_change_type, ${employeeId}::uuid, ${roleId}::uuid, ${payload}::jsonb, ${REQUEST_TTL_MIN}::int) AS id`;
    const id = c[0].id;
    const d = await tx.$queryRaw<{ s: string }[]>`SELECT public.fn_auth_api_request_decide(${appr}::uuid, ${id}::uuid, true)::text AS s`;
    if (d[0]?.s !== 'APPROVED') throw new AccountAdminError('APPROVAL', 'yêu cầu không được duyệt.');
    return id;
  }

  // Nhận mã NV (NV-xxxx) hoặc email; chỉ nhân viên chưa xoá mềm.
  private async employee(tx: Tx, ref: string): Promise<EmpRow> {
    const k = ref.trim();
    const rows = await tx.$queryRaw<EmpRow[]>`
      SELECT e.id, e.code, e.email, e.full_name, e.status::text AS status, c.status::text AS cred_status
        FROM public.employee e LEFT JOIN public.employee_credential c ON c.employee_id = e.id
       WHERE e.deleted_at IS NULL AND (e.code = ${k} OR lower(e.email) = lower(${k}))`;
    if (rows.length !== 1) throw new AccountAdminError('NOT_FOUND', 'không tìm thấy đúng một nhân viên "' + k + '".');
    return rows[0];
  }

  private async actor(tx: Tx, ref: string): Promise<string> {
    return (await this.employee(tx, ref)).id; // fn_auth_api_actor trong DB kiểm ACTIVE + credential ACTIVE + nhóm quyền
  }

  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
      return fn(tx);
    }, { maxWait: 5000, timeout: 60000 }) as Promise<T>;
  }
}

// M1: bật must_change_password (fn_auth_api_reset_password luôn đặt false; chưa có hàm DB để bật). Ghi trực tiếp bằng CHỦ SỞ HỮU nhưng điều
// kiện khớp CHÍNH XÁC lần reset vừa xong: đúng nhân viên, ACTIVE, token_version mong đợi, đúng hash vừa đặt, cờ đang tắt. Khác đúng 1 dòng
// => lỗi => cả transaction (kể cả mật khẩu mới) bị huỷ. Chỉ thêm hạn chế (fail-safe), không đụng hash/token_version.
export async function markMustChange(tx: Pick<Tx, '$executeRaw'>, employeeId: string, expected: { tokenVersion: number; passwordHash: string }): Promise<void> {
  const n = await tx.$executeRaw`UPDATE public.employee_credential SET must_change_password = true, updated_at = now() WHERE employee_id = ${employeeId}::uuid AND status = 'ACTIVE' AND token_version = ${expected.tokenVersion} AND password_hash = ${expected.passwordHash} AND must_change_password = false`;
  if (n !== 1) throw new AccountAdminError('MUST_CHANGE_FAILED', 'không bật được yêu cầu đổi mật khẩu lần đầu (không khớp đúng lần đặt lại mật khẩu); đã huỷ toàn bộ thao tác.');
}

// Nội dung file bàn giao (chỉ người chạy đọc được). Không bao giờ in ra màn hình.
export function handoverText(a: IssuedAccount, dbName: string): string {
  return [
    '# SISCOM CRM — tài khoản nhân viên (FV-5). BÍ MẬT: chỉ chuyển trực tiếp cho người dùng, xoá file sau khi bàn giao.',
    '# Database: ' + dbName + ' | tạo lúc: ' + new Date().toISOString(),
    'Mã nhân viên: ' + a.code,
    'Họ tên: ' + a.fullName,
    'Email đăng nhập: ' + a.email,
    ...(a.role ? ['Vai trò: ' + a.role] : []),
    'Mật khẩu tạm: ' + a.password,
    'Lần đăng nhập đầu: hệ thống BẮT BUỘC đổi mật khẩu.',
    '',
  ].join('\r\n');
}
