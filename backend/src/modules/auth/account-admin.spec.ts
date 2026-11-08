import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPasswordPolicy } from '../../common/auth/login/password-policy';
import { createPrivateFile } from '../../cli/account-admin';
import { AccountAdmin, AccountAdminError, assertTargetDb, assertTargetUrl, generatePassword, GRANTABLE_ROLES, handoverText, parseArgs } from './account-admin';

const T = 'siscom_crm_test_20261108_145925';
const code = (f: () => unknown): string => { try { f(); } catch (e) { if (e instanceof AccountAdminError) return e.code; throw e; } return 'NO_ERROR'; };

describe('FV-5 assertTargetDb / assertTargetUrl', () => {
  it('DB thử được phép; siscom_crm_dev, baseline khoá, tên lạ bị từ chối khi không có --allow-db', () => {
    expect(code(() => assertTargetDb(T))).toBe('NO_ERROR');
    expect(code(() => assertTargetDb('siscom_crm_restore_20261101_101010'))).toBe('NO_ERROR');
    for (const n of ['siscom_crm_dev', 'siscom_crm', 'siscom_crm_test_x', 'postgres', '']) expect(code(() => assertTargetDb(n))).toBe('DB_REFUSED');
    expect(code(() => assertTargetDb('siscom_crm_restore_20261014_214105'))).toBe('DB_REFUSED');
    expect(code(() => assertTargetDb('siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261014_214105'))).toBe('DB_REFUSED'); // baseline: không bao giờ
  });
  it('--allow-db phải khớp ĐÚNG tên DB đang kết nối', () => {
    expect(code(() => assertTargetDb('siscom_crm', 'siscom_crm'))).toBe('NO_ERROR');
    expect(code(() => assertTargetDb('siscom_crm', 'siscom_crm_dev'))).toBe('DB_REFUSED');
    expect(code(() => assertTargetDb('siscom_crm_dev', 'siscom_crm_dev'))).toBe('NO_ERROR');
  });
  it('cổng 5432 (hoặc không ghi cổng) cần --allow-db; URL hỏng bị từ chối; không lộ mật khẩu trong thông điệp', () => {
    expect(code(() => assertTargetUrl('postgresql://siscom_migrator:s3cr3tX@127.0.0.1:5432/' + T))).toBe('DB_REFUSED');
    expect(code(() => assertTargetUrl('postgresql://siscom_migrator:s3cr3tX@127.0.0.1/' + T))).toBe('DB_REFUSED');
    expect(assertTargetUrl('postgresql://siscom_migrator:s3cr3tX@127.0.0.1:55470/' + T)).toEqual({ dbName: T, port: '55470', user: 'siscom_migrator' });
    expect(code(() => assertTargetUrl('khong-phai-url'))).toBe('DB_REFUSED');
    try { assertTargetUrl('postgresql://u:s3cr3tX@127.0.0.1:5432/x'); } catch (e) { expect(String((e as Error).message)).not.toContain('s3cr3tX'); }
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
    expect(code(() => parseArgs(add.map((v) => (v === 'a@siscom.vn' ? 'khong-email' : v))))).toBe('INPUT');
    expect(code(() => parseArgs(['reset-password', '--requester', 'NV-0001', '--approver', 'NV-0002', '--employee', 'NV-0009']))).toBe('INPUT'); // thiếu --out
    expect(parseArgs(['list']).command).toBe('list');
  });
});

// Giả lập Prisma: ghi lại thứ tự lời gọi SQL (chỉ phần chữ của template) để kiểm luồng gọi đúng hàm đặc quyền.
function fakeDb(o: { db?: string; can?: boolean; open?: boolean; emp?: Record<string, unknown>[]; reset?: string; dup?: number } = {}) {
  const calls: string[] = []; const values: unknown[][] = [];
  const run = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push(sql); values.push(v);
    if (sql.includes('current_database()')) return [{ db: o.db ?? T, can: o.can ?? true, open: o.open ?? false }];
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
    if (sql.startsWith('UPDATE public.employee_credential')) return 1;
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
  it('disable: gọi fn_auth_api_credential_disable(requester, nhân viên, lý do); nhân viên không tồn tại -> NOT_FOUND', async () => {
    const f = fakeDb();
    await new AccountAdmin(f.db as never, hasher).disable(parseArgs(['disable', '--requester', 'NV-0001', '--employee', 'NV-0009', '--reason', 'Nghỉ việc']));
    expect(f.values[idx(f.calls, 'fn_auth_api_credential_disable')]).toEqual(['req-1', 'emp-9', 'Nghỉ việc']);
    await expect(new AccountAdmin(fakeDb().db as never, hasher).disable(parseArgs(['disable', '--requester', 'NV-0001', '--employee', 'NV-9999', '--reason', 'x']))).rejects.toThrow('NOT_FOUND');
  });
});

describe('FV-5 file bàn giao', () => {
  it('handoverText có đủ thông tin; createPrivateFile không ghi đè file có sẵn', () => {
    const t = handoverText({ code: 'NV-0007', email: 'a@x.vn', fullName: 'A', role: 'sales', password: 'Xy-12345678abcdEF' }, T);
    expect(t).toContain('NV-0007'); expect(t).toContain('Xy-12345678abcdEF'); expect(t).toContain('BẮT BUỘC đổi mật khẩu');
    const dir = mkdtempSync(join(tmpdir(), 'fv5-'));
    try {
      const p = join(dir, 'co-san.txt'); writeFileSync(p, 'cu');
      expect(code(() => createPrivateFile(p))).toBe('OUT_EXISTS');
      expect(readFileSync(p, 'utf8')).toBe('cu');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
