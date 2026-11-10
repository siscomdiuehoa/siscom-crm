import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPasswordPolicy } from '../../common/auth/login/password-policy';
import { createPrivateFile } from '../../cli/account-admin';
import { AccountAdmin, AccountAdminError, assertTargetDb, assertTargetUrl, generatePassword, GRANTABLE_ROLES, handoverText, parseArgs } from './account-admin';

const T = 'siscom_crm_test_20261108_145925';
const code = (f: () => unknown): string => { try { f(); } catch (e) { if (e instanceof AccountAdminError) return e.code; throw e; } return 'NO_ERROR'; };

// FV5-DB-GUARD (Owner 10/11/2026): ALLOWLIST — chỉ PostgreSQL thử tại 127.0.0.1:55470 / localhost:55470, tên siscom_crm_(test|restore)_<stamp>.
// KHÔNG còn --allow-db hay bất kỳ cách nào vượt giới hạn (F225-A/B chưa được duyệt cho vận hành thực tế).
describe('FV-5 assertTargetDb / assertTargetUrl (FV5-DB-GUARD)', () => {
  const U = (hostPort: string, db: string = T) => 'postgresql://siscom_migrator:s3cr3tX@' + hostPort + '/' + db;
  it('tên DB: chỉ mẫu thử; siscom_crm_dev, DB thật, tên lạ, baseline khoá luôn bị từ chối', () => {
    expect(code(() => assertTargetDb(T))).toBe('NO_ERROR');
    expect(code(() => assertTargetDb('siscom_crm_restore_20261101_101010'))).toBe('NO_ERROR');
    for (const n of ['siscom_crm_dev', 'siscom_crm', 'siscom_crm_test_x', 'postgres', '', 'siscom_crm_restore_20261014_214105']) expect(code(() => assertTargetDb(n))).toBe('DB_REFUSED');
  });
  it('không còn đường vượt: tham số thứ hai (allow-db cũ) không có tác dụng; parseArgs từ chối --allow-db ở mọi lệnh', () => {
    const loose = assertTargetDb as unknown as (n: string, allow?: string) => void;
    expect(code(() => loose('siscom_crm', 'siscom_crm'))).toBe('DB_REFUSED');
    expect(code(() => loose('siscom_crm_dev', 'siscom_crm_dev'))).toBe('DB_REFUSED');
    const looseUrl = assertTargetUrl as unknown as (u: string, allow?: string) => unknown;
    expect(code(() => looseUrl(U('127.0.0.1:5432', 'siscom_crm'), 'siscom_crm'))).toBe('DB_REFUSED');
    expect(code(() => looseUrl(U('127.0.0.1:55470', 'siscom_crm'), 'siscom_crm'))).toBe('DB_REFUSED');
    expect(code(() => parseArgs(['list', '--allow-db', T]))).toBe('INPUT');
    expect(code(() => parseArgs(['disable', '--requester', 'NV-0001', '--employee', 'NV-0009', '--reason', 'x', '--allow-db', 'siscom_crm']))).toBe('INPUT');
  });
  it('cổng: chỉ 55470; 5432, 55433 (cụm demo), cổng khác, không ghi cổng đều bị từ chối dù tên DB là tên thử', () => {
    expect(assertTargetUrl(U('127.0.0.1:55470'))).toEqual({ dbName: T, port: '55470', user: 'siscom_migrator' });
    expect(assertTargetUrl(U('localhost:55470'))).toEqual({ dbName: T, port: '55470', user: 'siscom_migrator' });
    for (const hp of ['127.0.0.1:5432', '127.0.0.1:55433', '127.0.0.1:55471', '127.0.0.1:5547', '127.0.0.1', 'localhost']) expect(code(() => assertTargetUrl(U(hp)))).toBe('DB_REFUSED');
  });
  it('host: chỉ 127.0.0.1 / localhost; IP LAN, tên miền, ::1, 127.0.0.2, 0.0.0.0, host kèm ?host= bị từ chối', () => {
    for (const hp of ['192.168.1.10:55470', 'db.siscom.vn:55470', '[::1]:55470', '127.0.0.2:55470', '0.0.0.0:55470', 'localhost.evil.com:55470', '127.0.0.1.evil.com:55470']) expect(code(() => assertTargetUrl(U(hp)))).toBe('DB_REFUSED');
    expect(code(() => assertTargetUrl(U('127.0.0.1:55470') + '?host=192.168.1.10'))).toBe('DB_REFUSED');
    expect(code(() => assertTargetUrl(U('127.0.0.1:55470') + '?port=5432'))).toBe('DB_REFUSED');
    expect(code(() => assertTargetUrl(U('127.0.0.1:55470') + '?sslmode=disable'))).toBe('NO_ERROR');
  });
  it('URL hỏng / giao thức lạ bị từ chối; thông điệp không lộ mật khẩu', () => {
    expect(code(() => assertTargetUrl('khong-phai-url'))).toBe('DB_REFUSED');
    expect(code(() => assertTargetUrl('mysql://u:p@127.0.0.1:55470/' + T))).toBe('DB_REFUSED');
    for (const u of [U('127.0.0.1:5432', 'x'), U('10.0.0.5:55470'), U('127.0.0.1:55433')]) { try { assertTargetUrl(u); throw new Error('phai tu choi'); } catch (e) { expect(String((e as Error).message)).not.toContain('s3cr3tX'); expect(e).toBeInstanceOf(AccountAdminError); } }
  });
});

describe('FV-5 generatePassword', () => {
  it('đạt chính sách D17 (kể cả không chứa email), dài 20, đủ 4 nhóm, không trùng nhau', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword({ email: 'nguyenvana@siscom.vn', code: 'NV-0123' });
      expect(pw).toHaveLength(20);
      expect(checkPasswordPolicy(pw, { email: 'nguyenvana@siscom.vn', code: 'NV-0123' })).toEqual([]);
      expect(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)).toBe(true);
      expect(pw).not.toMatch(/[0O1lI\s"',;]/);
      seen.add(pw);
    }
    expect(seen.size).toBe(300);
    expect(code(() => generatePassword({}, 12))).toBe('INPUT');
  });
});

describe('FV-5 parseArgs', () => {
  const add = ['add', '--requester', 'NV-0001', '--approver', 'NV-0002', '--email', 'a@siscom.vn', '--full-name', 'Nguyễn A', '--department', 'KD', '--role', 'sales', '--out', 'x.txt'];
  it('lệnh add đủ tham số', () => {
    expect(parseArgs(add)).toMatchObject({ command: 'add', requester: 'NV-0001', approver: 'NV-0002', email: 'a@siscom.vn', fullName: 'Nguyễn A', department: 'KD', role: 'sales', out: 'x.txt', demo: false, yes: false });
  });
  it('từ chối: lệnh lạ, cờ lạ (kể cả --password), thiếu giá trị, thiếu tham số bắt buộc, requester = approver, vai trò admin/lạ, email sai', () => {
    expect(code(() => parseArgs(['drop']))).toBe('INPUT');
    expect(code(() => parseArgs([...add, '--password', 'x']))).toBe('INPUT');
    expect(code(() => parseArgs(['disable', '--requester']))).toBe('INPUT');
    expect(code(() => parseArgs(['add', '--requester', 'NV-0001']))).toBe('INPUT');
    expect(code(() => parseArgs(add.map((v) => (v === 'NV-0002' ? 'nv-0001' : v))))).toBe('TWO_PERSON');
    expect(code(() => parseArgs(add.map((v) => (v === 'sales' ? 'admin' : v))))).toBe('INPUT');
    expect(GRANTABLE_ROLES).not.toContain('admin');
    // Owner 08/11/2026: tạm CẤM cấp crm_admin qua CLI (vai trò xem toàn bộ khách + người duyệt) cho tới khi có phê duyệt hai người thật.
    expect(code(() => parseArgs(add.map((v) => (v === 'sales' ? 'crm_admin' : v))))).toBe('INPUT');
    expect(GRANTABLE_ROLES).toEqual(['sales', 'technician', 'accountant']);
    expect(code(() => parseArgs(add.map((v) => (v === 'a@siscom.vn' ? 'khong-email' : v))))).toBe('INPUT');
    expect(code(() => parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009']))).toBe('INPUT'); // thiếu --out
    expect(parseArgs(['list']).command).toBe('list');
  });
});

// Giả lập Prisma: ghi lại thứ tự lời gọi SQL (chỉ phần chữ của template) để kiểm luồng gọi đúng hàm đặc quyền.
function fakeDb(o: { db?: string; can?: boolean; open?: boolean; port?: number | null; emp?: Record<string, unknown>[]; reset?: string; dup?: number; markRows?: number; noCred?: boolean; credStatus?: string } = {}) {
  const calls: string[] = []; const values: unknown[][] = [];
  const run = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push(sql); values.push(v);
    if (sql.includes('current_database()')) return [{ db: o.db ?? T, can: o.can ?? true, open: o.open ?? false, port: o.port === undefined ? 55470 : o.port }];
    if (sql.includes('FROM public.employee e LEFT JOIN')) {
      const k = String(v[0]);
      const rows = o.emp ?? [{ id: 'req-1', code: 'NV-0001', email: 'sys@x.vn', full_name: 'Sys', status: 'ACTIVE', cred_status: 'ACTIVE' }, { id: 'appr-2', code: 'NV-0002', email: 'adm@x.vn', full_name: 'Adm', status: 'ACTIVE', cred_status: 'ACTIVE' }, { id: 'emp-9', code: 'NV-0009', email: 'b@x.vn', full_name: 'B', status: 'ACTIVE', cred_status: 'ACTIVE' }];
      return rows.filter((r) => r.code === k || r.email === k);
    }
    if (sql.includes('count(*)::int AS n FROM public.employee')) return [{ n: o.dup ?? 0 }];
    if (sql.includes('FROM public.department')) return [{ id: 'dept-1' }];
    if (sql.includes('FROM public.role WHERE')) return [{ id: 'role-1' }];
    if (sql.includes('INSERT INTO public.employee')) return [{ id: 'new-7', code: 'NV-0007' }];
    if (sql.includes('fn_auth_api_request_create')) return [{ id: 'req-' + calls.length }];
    if (sql.includes('fn_auth_api_request_decide')) return [{ s: 'APPROVED' }];
    if (sql.includes('fn_auth_api_reset_password')) return [{ r: o.reset ?? 'OK' }];
    if (sql.includes('SELECT token_version FROM public.employee_credential')) return o.noCred ? [] : [{ token_version: 4 }];
    if (sql.includes('SELECT status::text AS status FROM public.employee_credential')) return [{ status: o.credStatus ?? 'ACTIVE' }];
    if (sql.startsWith('UPDATE public.employee_credential')) return o.markRows ?? 1;
    return [];
  };
  const tx = { $queryRaw: jest.fn(run), $executeRaw: jest.fn(run) };
  const db = { $queryRaw: jest.fn(run), $executeRaw: jest.fn(run), $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { db, calls, values };
}
const hasher = { hash: jest.fn(async () => '$argon2id$v=19$fake') };
const idx = (calls: string[], frag: string) => calls.findIndex((c) => c.includes(frag));

describe('FV-5 AccountAdmin (giả lập DB)', () => {
  it('preflight: từ chối DB sai, không phải chủ sở hữu, bootstrap còn mở', async () => {
    await expect(new AccountAdmin(fakeDb().db as never, hasher).preflight()).resolves.toBe(T);
    await expect(new AccountAdmin(fakeDb({ db: 'siscom_crm_dev' }).db as never, hasher).preflight()).rejects.toThrow('DB_REFUSED');
    await expect(new AccountAdmin(fakeDb({ can: false }).db as never, hasher).preflight()).rejects.toThrow('NOT_OWNER');
    await expect(new AccountAdmin(fakeDb({ open: true }).db as never, hasher).preflight()).rejects.toThrow('BOOTSTRAP_OPEN');
  });
  it('FV5-DB-GUARD preflight: CLI yêu cầu cổng THẬT của máy chủ (inet_server_port) = 55470; khác / không xác minh được (null) => DB_REFUSED', async () => {
    const ok = fakeDb();
    await expect(new AccountAdmin(ok.db as never, hasher).preflight({ serverPort: 55470 })).resolves.toBe(T);
    expect(ok.calls[0]).toContain('inet_server_port()');
    for (const port of [5432, 55433, null]) await expect(new AccountAdmin(fakeDb({ port }).db as never, hasher).preflight({ serverPort: 55470 })).rejects.toThrow('DB_REFUSED');
    await expect(new AccountAdmin(fakeDb({ db: 'siscom_crm' }).db as never, hasher).preflight({ serverPort: 55470 })).rejects.toThrow('DB_REFUSED');
  });
  it('add: một transaction; employee -> credential placeholder -> ROLE_GRANT 2 người -> PASSWORD_RESET 2 người -> bật must_change; không lộ mật khẩu trong SQL', async () => {
    const f = fakeDb();
    const r = await new AccountAdmin(f.db as never, hasher).add(parseArgs(['add', '--requester', 'NV-0001', '--approver', 'NV-0002', '--email', 'Moi@Siscom.vn', '--full-name', 'Nhân viên mới', '--department', 'KD', '--role', 'sales', '--out', 'x']));
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    const c = f.calls;
    const order = ['INSERT INTO public.employee', 'fn_auth_api_credential_create', 'fn_auth_api_request_create', 'fn_auth_api_request_decide', 'fn_auth_api_role_grant',
      'fn_auth_api_reset_token_issue', 'fn_auth_api_reset_password', 'UPDATE public.employee_credential SET must_change_password = true', 'PASSWORD_MUST_CHANGE_SET'];
    const pos = order.map((s) => idx(c, s));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(c.filter((s) => s.includes('fn_auth_api_request_create'))).toHaveLength(2);
    // requester tạo/thi hành, approver duyệt
    const decide = f.values[idx(c, 'fn_auth_api_request_decide')];
    expect(decide[0]).toBe('appr-2');
    expect(f.values[idx(c, 'fn_auth_api_role_grant')][0]).toBe('req-1');
    expect(r).toMatchObject({ code: 'NV-0007', email: 'moi@siscom.vn', role: 'sales' });
    expect(checkPasswordPolicy(r.password, { email: r.email })).toEqual([]);
    // Mật khẩu gốc không bao giờ được gửi vào DB (chỉ hash argon2; mã reset chỉ gửi SHA-256 cho phát hành).
    expect(JSON.stringify(f.values)).not.toContain(r.password);
    const issue = f.values[idx(c, 'fn_auth_api_reset_token_issue')];
    expect(String(issue[2])).toMatch(/^[0-9a-f]{64}$/);
  });
  it('add: email trùng / requester = approver (qua email & mã) / reset_password khác OK -> lỗi, không bật must_change', async () => {
    const base = ['add', '--requester', 'NV-0001', '--approver', 'NV-0002', '--email', 'b@x.vn', '--full-name', 'B', '--department', 'KD', '--role', 'sales', '--out', 'x'];
    await expect(new AccountAdmin(fakeDb({ dup: 1 }).db as never, hasher).add(parseArgs(base))).rejects.toThrow('DUPLICATE');
    const same = fakeDb();
    await expect(new AccountAdmin(same.db as never, hasher).add(parseArgs(base.map((v) => (v === 'NV-0002' ? 'sys@x.vn' : v))))).rejects.toThrow('TWO_PERSON');
    expect(idx(same.calls, 'INSERT INTO public.employee')).toBe(-1);
    const bad = fakeDb({ reset: 'INVALID' });
    await expect(new AccountAdmin(bad.db as never, hasher).add(parseArgs(base.map((v) => (v === 'b@x.vn' ? 'c@x.vn' : v))))).rejects.toThrow('RESET_FAILED');
    expect(idx(bad.calls, 'must_change_password = true')).toBe(-1);
  });
  it('reset-password: PASSWORD_RESET 2 người + bật must_change; nhân viên không có credential -> lỗi', async () => {
    const f = fakeDb();
    const r = await new AccountAdmin(f.db as never, hasher).resetPassword(parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009', '--out', 'x']));
    expect(r.code).toBe('NV-0009');
    expect(idx(f.calls, 'fn_auth_api_credential_create')).toBe(-1);
    expect(idx(f.calls, 'fn_auth_api_role_grant')).toBe(-1);
    expect(idx(f.calls, 'must_change_password = true')).toBeGreaterThan(idx(f.calls, 'fn_auth_api_reset_password'));
    const none = fakeDb({ emp: [{ id: 'req-1', code: 'NV-0001', email: 's', full_name: 'S', status: 'ACTIVE', cred_status: 'ACTIVE' }, { id: 'appr-2', code: 'NV-0002', email: 'a', full_name: 'A', status: 'ACTIVE', cred_status: 'ACTIVE' }, { id: 'e3', code: 'NV-0003', email: 'n', full_name: 'N', status: 'ACTIVE', cred_status: null }] });
    await expect(new AccountAdmin(none.db as never, hasher).resetPassword(parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0003', '--out', 'x']))).rejects.toThrow('INPUT');
  });
  it('M1: cờ buộc đổi mật khẩu chỉ bật đúng tài khoản + đúng lần reset (token_version mới = cũ + 1, đúng hash vừa đặt, đang ACTIVE, cờ đang tắt)', async () => {
    const f = fakeDb();
    await new AccountAdmin(f.db as never, hasher).resetPassword(parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009', '--out', 'x']));
    const lock = idx(f.calls, 'SELECT token_version FROM public.employee_credential');
    expect(lock).toBeGreaterThan(-1);
    expect(f.calls[lock]).toContain('FOR UPDATE');
    expect(lock).toBeLessThan(idx(f.calls, 'fn_auth_api_request_create')); // khoá dòng TRƯỚC khi phát hành/đặt mật khẩu
    const u = idx(f.calls, 'must_change_password = true');
    expect(f.calls[u]).toMatch(/WHERE employee_id = \?::uuid AND status = 'ACTIVE' AND token_version = \? AND password_hash = \? AND must_change_password = false/);
    expect(f.values[u]).toEqual(['emp-9', 5, '$argon2id$v=19$fake']);
  });
  it('M1: điều kiện không khớp (0 dòng: sai tài khoản / sai lần reset / bị đổi chen giữa) hoặc thiếu credential -> lỗi, cả transaction huỷ', async () => {
    const z = fakeDb({ markRows: 0 });
    await expect(new AccountAdmin(z.db as never, hasher).resetPassword(parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009', '--out', 'x']))).rejects.toThrow('MUST_CHANGE_FAILED');
    expect(idx(z.calls, 'PASSWORD_MUST_CHANGE_SET')).toBe(-1);
    const two = fakeDb({ markRows: 2 });
    await expect(new AccountAdmin(two.db as never, hasher).resetPassword(parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009', '--out', 'x']))).rejects.toThrow('MUST_CHANGE_FAILED');
    const nc = fakeDb({ noCred: true });
    await expect(new AccountAdmin(nc.db as never, hasher).resetPassword(parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009', '--out', 'x']))).rejects.toThrow('INTERNAL');
    expect(idx(nc.calls, 'fn_auth_api_request_create')).toBe(-1);
  });
  // F225-C (FV5-C-FIX, Owner 10/11/2026): reset-password KHÔNG được mở khoá; mở khoá là lệnh riêng `unlock` có xác nhận rõ ràng.
  const RESET9 = ['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009', '--out', 'x'];
  const UNLOCK9 = ['unlock', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009', '--reason', 'Đi làm lại', '--confirm-unlock', 'NV-0009', '--out', 'x'];
  it('F225-C: reset-password trên tài khoản ĐANG KHOÁ => ACCOUNT_DISABLED, không tạo yêu cầu, không đặt mật khẩu, không mở khoá', async () => {
    const f = fakeDb({ credStatus: 'DISABLED' });
    await expect(new AccountAdmin(f.db as never, hasher).resetPassword(parseArgs(RESET9))).rejects.toThrow('ACCOUNT_DISABLED');
    for (const s of ['fn_auth_api_request_create', 'fn_auth_api_reset_token_issue', 'fn_auth_api_reset_password', 'must_change_password = true']) expect(idx(f.calls, s)).toBe(-1);
    expect(idx(f.calls, 'SELECT status::text AS status FROM public.employee_credential')).toBeGreaterThan(idx(f.calls, 'FOR UPDATE')); // đọc trạng thái SAU khi khoá dòng
  });
  it('F225-C: unlock trên tài khoản đang khoá => PASSWORD_RESET 2 người + buộc đổi mật khẩu + audit ACCOUNT_UNLOCK kèm lý do', async () => {
    const f = fakeDb({ credStatus: 'DISABLED' });
    const r = await new AccountAdmin(f.db as never, hasher).unlock(parseArgs(UNLOCK9));
    expect(r.code).toBe('NV-0009');
    const order = ['fn_auth_api_request_create', 'fn_auth_api_request_decide', 'fn_auth_api_reset_password', 'must_change_password = true', 'ACCOUNT_UNLOCK'];
    const pos = order.map((s) => idx(f.calls, s));
    expect(pos.every((p) => p >= 0)).toBe(true); expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    const au = f.values[idx(f.calls, 'ACCOUNT_UNLOCK')];
    expect(au[0]).toBe('req-1'); expect(au[1]).toBe('emp-9'); expect(String(au[2])).toContain('Đi làm lại');
    expect(JSON.stringify(f.values)).not.toContain(r.password);
  });
  it('F225-C: unlock từ chối khi tài khoản KHÔNG khoá, khi mã xác nhận không khớp đúng mã nhân viên, khi requester = approver', async () => {
    const act = fakeDb();
    await expect(new AccountAdmin(act.db as never, hasher).unlock(parseArgs(UNLOCK9))).rejects.toThrow('NOT_DISABLED');
    expect(idx(act.calls, 'fn_auth_api_request_create')).toBe(-1);
    const wrong = fakeDb({ credStatus: 'DISABLED' });
    await expect(new AccountAdmin(wrong.db as never, hasher).unlock(parseArgs(UNLOCK9.map((v, i) => (i === 10 ? 'b@x.vn' : v))))).rejects.toThrow('CONFIRM_UNLOCK');
    expect(idx(wrong.calls, 'FOR UPDATE')).toBe(-1); expect(idx(wrong.calls, 'fn_auth_api_request_create')).toBe(-1);
    await expect(new AccountAdmin(fakeDb({ credStatus: 'DISABLED' }).db as never, hasher).unlock(parseArgs(UNLOCK9.map((v) => (v === 'NV-0002' ? 'sys@x.vn' : v))))).rejects.toThrow('TWO_PERSON');
  });
  it('F225-C: parseArgs — unlock bắt buộc --reason, --confirm-unlock, --approver, --out; --confirm-unlock không dùng cho lệnh khác', () => {
    expect(parseArgs(UNLOCK9)).toMatchObject({ command: 'unlock', employee: 'NV-0009', reason: 'Đi làm lại', confirmUnlock: 'NV-0009' });
    for (const drop of ['--reason', '--confirm-unlock', '--approver', '--out']) { const i = UNLOCK9.indexOf(drop); expect(code(() => parseArgs(UNLOCK9.filter((_, k) => k !== i && k !== i + 1)))).toBe('INPUT'); }
    expect(code(() => parseArgs([...RESET9, '--confirm-unlock', 'NV-0009']))).toBe('INPUT');
  });
  it('F225-C: add vẫn tạo được tài khoản dù placeholder credential ở trạng thái DISABLED (không bị chặn nhầm)', async () => {
    const f = fakeDb({ credStatus: 'DISABLED' });
    const r = await new AccountAdmin(f.db as never, hasher).add(parseArgs(['add', '--requester', 'NV-0001', '--approver', 'NV-0002', '--email', 'moi2@siscom.vn', '--full-name', 'Mới', '--department', 'KD', '--role', 'sales', '--out', 'x']));
    expect(r.code).toBe('NV-0007'); expect(idx(f.calls, 'must_change_password = true')).toBeGreaterThan(-1);
  });
  it('disable: gọi fn_auth_api_credential_disable(requester, nhân viên, lý do); nhân viên không tồn tại -> NOT_FOUND', async () => {
    const f = fakeDb();
    await new AccountAdmin(f.db as never, hasher).disable(parseArgs(['disable', '--requester', 'NV-0001', '--employee', 'NV-0009', '--reason', 'Nghỉ việc']));
    expect(f.values[idx(f.calls, 'fn_auth_api_credential_disable')]).toEqual(['req-1', 'emp-9', 'Nghỉ việc']);
    await expect(new AccountAdmin(fakeDb().db as never, hasher).disable(parseArgs(['disable', '--requester', 'NV-0001', '--employee', 'NV-9999', '--reason', 'x']))).rejects.toThrow('NOT_FOUND');
  });
});

describe('FV-5 file bàn giao', () => {
  it('handoverText có đủ thông tin; createPrivateFile không ghi đè file có sẵn', () => {
    const fake = generatePassword(); // sinh lúc chạy: không để chuỗi giống mật khẩu trong mã (gitleaks quét mọi nhánh)
    const t = handoverText({ code: 'NV-0007', email: 'a@x.vn', fullName: 'A', role: 'sales', password: fake }, T);
    expect(t).toContain('NV-0007'); expect(t).toContain(fake); expect(t).toContain('BẮT BUỘC đổi mật khẩu');
    const dir = mkdtempSync(join(tmpdir(), 'fv5-'));
    try {
      const p = join(dir, 'co-san.txt'); writeFileSync(p, 'cu');
      expect(code(() => createPrivateFile(p))).toBe('OUT_EXISTS');
      expect(readFileSync(p, 'utf8')).toBe('cu');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
