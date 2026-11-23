import { createHash } from 'node:crypto';
import { approved, findSystemRequester, lockEmployee, setTempPassword } from './accounts.flow';

// P1 Task 5: các bước dùng chung của luồng "một lần bấm". Kiểm THỨ TỰ gọi hàm database và AI đứng tên từng bước:
// tài khoản hệ thống (nhóm REQUEST) tạo yêu cầu + thực thi; người bấm (nhóm APPROVE) chỉ duyệt và bật cờ buộc đổi mật khẩu.
const SYS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLICKER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROLE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQ = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

interface Call { sql: string; values: unknown[] }
function fakeTx(respond: (sql: string, values: unknown[]) => unknown[] = () => []) {
  const calls: Call[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ sql, values });
    return Promise.resolve(respond(sql, values));
  };
  return { tx: { $queryRaw: run, $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => run(s, ...v).then(() => 1) } as never, calls };
}
const fn = (c: Call): string => (/public\.(fn_[a-z_]+)/.exec(c.sql) ?? /(pg_advisory_xact_lock)/.exec(c.sql) ?? ['', c.sql])[1];
const codeOf = async (p: Promise<unknown>): Promise<{ status: number; code: string }> => {
  try { await p; } catch (e) { const d = e as { getStatus(): number; code: string }; return { status: d.getStatus(), code: d.code }; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
};

describe('findSystemRequester', () => {
  it('đúng một tài khoản hệ thống => trả id; truy vấn đòi vai trò admin + nhân viên ACTIVE chưa xoá + credential ACTIVE', async () => {
    const f = fakeTx(() => [{ id: SYS }]);
    expect(await findSystemRequester(f.tx)).toBe(SYS);
    expect(f.calls[0].sql).toMatch(/r\.code = 'admin'/);
    expect(f.calls[0].sql).toMatch(/e\.status = 'ACTIVE'/);
    expect(f.calls[0].sql).toMatch(/e\.deleted_at IS NULL/);
    expect(f.calls[0].sql).toMatch(/c\.status = 'ACTIVE'/);
  });
  it('không có hoặc có hơn một => 503 SYSTEM_REQUESTER_UNAVAILABLE (không đoán)', async () => {
    expect(await codeOf(findSystemRequester(fakeTx(() => []).tx))).toEqual({ status: 503, code: 'SYSTEM_REQUESTER_UNAVAILABLE' });
    expect(await codeOf(findSystemRequester(fakeTx(() => [{ id: SYS }, { id: CLICKER }]).tx))).toEqual({ status: 503, code: 'SYSTEM_REQUESTER_UNAVAILABLE' });
  });
});

describe('lockEmployee', () => {
  it('khoá tư vấn theo nhân viên trong transaction (pool acct không có quyền FOR UPDATE)', async () => {
    const f = fakeTx();
    await lockEmployee(f.tx, EMP);
    expect(fn(f.calls[0])).toBe('pg_advisory_xact_lock');
    expect(f.calls[0].values).toEqual(['p1-account:' + EMP]);
    expect(f.calls[0].sql).not.toMatch(/FOR UPDATE/i);
  });
});

describe('approved', () => {
  it('tài khoản hệ thống TẠO yêu cầu, người bấm DUYỆT; payload ghi nguồn + người bấm; trả id yêu cầu', async () => {
    const f = fakeTx((sql) => (sql.includes('request_create') ? [{ id: REQ }] : sql.includes('request_decide') ? [{ s: 'APPROVED' }] : []));
    expect(await approved(f.tx, SYS, CLICKER, 'ROLE_GRANT', EMP, ROLE)).toBe(REQ);
    expect(f.calls.map(fn)).toEqual(['fn_auth_api_request_create', 'fn_auth_api_request_decide']);
    const [create, decide] = f.calls;
    expect(create.values[0]).toBe(SYS);
    expect(create.values.slice(1, 4)).toEqual(['ROLE_GRANT', EMP, ROLE]);
    expect(JSON.parse(String(create.values[4]))).toEqual({ source: 'p1-account-admin', clickedBy: CLICKER });
    expect(decide.values).toEqual([CLICKER, REQ]);
  });
  it('không được duyệt (kết quả khác APPROVED) => ném lỗi, không trả id', async () => {
    const f = fakeTx((sql) => (sql.includes('request_create') ? [{ id: REQ }] : [{ s: 'REJECTED' }]));
    await expect(approved(f.tx, SYS, CLICKER, 'PASSWORD_RESET', EMP, null)).rejects.toThrow();
  });
});

describe('setTempPassword', () => {
  const secret = { hash: '$argon2id$v=19$thu', algo: 'argon2id', params: { m: 65536, t: 3, p: 1 } };
  const ok = (sql: string): unknown[] => (sql.includes('request_create') ? [{ id: REQ }] : sql.includes('request_decide') ? [{ s: 'APPROVED' }]
    : sql.includes('reset_password') ? [{ r: 'OK' }] : sql.includes('token_version') ? [{ token_version: 7 }] : []);
  it('đúng thứ tự: tạo + duyệt yêu cầu -> phát hành mã (chỉ gửi SHA-256) -> đặt mật khẩu bằng mã gốc -> đọc token_version -> bật buộc đổi', async () => {
    const f = fakeTx(ok);
    await setTempPassword(f.tx, SYS, CLICKER, EMP, secret);
    expect(f.calls.map(fn)).toEqual(['fn_auth_api_request_create', 'fn_auth_api_request_decide', 'fn_auth_api_reset_token_issue', 'fn_auth_api_reset_password',
      f.calls[4].sql, 'fn_acct_api_must_change_set']);
    const issue = f.calls[2]; const reset = f.calls[3]; const must = f.calls[5];
    expect(issue.values[0]).toBe(SYS); expect(issue.values[1]).toBe(REQ);
    const token = String(reset.values[1]);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issue.values[2]).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(issue.values).not.toContain(token); // mã gốc không gửi ở bước phát hành
    expect(reset.values[0]).toBe(EMP);
    expect(reset.values.slice(2)).toEqual([secret.hash, 'argon2id', JSON.stringify(secret.params)]);
    expect(f.calls[4].sql).toMatch(/SELECT token_version FROM public\.employee_credential/);
    expect(must.values).toEqual([CLICKER, EMP, 7]); // người bấm bật cờ, đúng token_version vừa đọc
  });
  it('mỗi lần gọi sinh một mã ngẫu nhiên khác nhau', async () => {
    const a = fakeTx(ok); const b = fakeTx(ok);
    await setTempPassword(a.tx, SYS, CLICKER, EMP, secret); await setTempPassword(b.tx, SYS, CLICKER, EMP, secret);
    expect(a.calls[3].values[1]).not.toBe(b.calls[3].values[1]);
  });
  it.each(['EXPIRED', 'EMPLOYEE_INACTIVE', 'INVALID', 'NO_TOKEN', 'LOCKED'])('reset_password trả %s => dừng với lỗi, KHÔNG bật cờ buộc đổi', async (r) => {
    const f = fakeTx((sql) => (sql.includes('reset_password') ? [{ r }] : ok(sql)));
    await expect(setTempPassword(f.tx, SYS, CLICKER, EMP, secret)).rejects.toThrow();
    expect(f.calls.map(fn)).not.toContain('fn_acct_api_must_change_set');
  });
  it('không đọc được token_version sau khi đặt mật khẩu => dừng với lỗi', async () => {
    const f = fakeTx((sql) => (sql.includes('token_version') ? [] : ok(sql)));
    await expect(setTempPassword(f.tx, SYS, CLICKER, EMP, secret)).rejects.toThrow();
    expect(f.calls.map(fn)).not.toContain('fn_acct_api_must_change_set');
  });
});
