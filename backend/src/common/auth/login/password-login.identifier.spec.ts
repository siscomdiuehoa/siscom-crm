import { DomainException } from '../../errors/domain.exception';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { Sha256TokenHasher, SessionService } from '../session/session.service';
import { LoginSessionService } from './login-session.service';
import { PasswordLoginService } from './password-login.service';
import { CredentialStore, LoginLookupIdentifier, PasswordHasher, StoredCredential } from './password-login.types';
const E7 = '00000000-0000-4000-8000-000000000007';
const PW = 'Mat-khau-thu-nghiem-1';

// Hasher giả chỉ trong test: "hash" hợp lệ là 'H:' + mật khẩu.
const hasher: PasswordHasher = { verify: async (h, p) => h !== null && h === 'H:' + p };
const cred: StoredCredential = { employeeId: E7, hash: 'H:' + PW, algo: 'argon2id', active: true };
const store = () => {
  const calls: LoginLookupIdentifier[] = [];
  const s: CredentialStore = { findByIdentifier: async (i) => { calls.push(i); return cred; } };
  return { calls, s };
};
const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DomainException; } throw new Error('không ném lỗi'); };

describe('PasswordLoginService — danh tính đăng nhập (A10-3, offline)', () => {
  it('NV-0001 được chấp nhận, tra theo EMPLOYEE_CODE đúng chữ hoa (không hạ chữ thường)', async () => {
    const { calls, s } = store();
    await expect(new PasswordLoginService(s, hasher).verify({ login: '  NV-0001 ', password: PW })).resolves.toEqual({ employeeId: E7 });
    expect(calls).toEqual([{ kind: 'EMPLOYEE_CODE', value: 'NV-0001' }]);
  });

  it('email giữ nguyên hoa/thường để DB so khớp lower(email)', async () => {
    const { calls, s } = store();
    await new PasswordLoginService(s, hasher).verify({ login: 'Nguyen.Van@Siscom.VN', password: PW });
    expect(calls).toEqual([{ kind: 'EMAIL', value: 'Nguyen.Van@Siscom.VN' }]);
  });

  it('giá trị không chuẩn / sai định dạng => 401 LOGIN_INVALID, một thông điệp, không chạm kho', async () => {
    const bad: unknown[] = ['nv-0001', 'Nv-0001', 'NV-001', 'NV0001', 'NV-00 01', 'a@@b', '@b', 'a@', 'a b@c.d', 'a\u0000@b.c', '', '   ', 'x'.repeat(300), 42, null, { $ne: 1 }];
    const msgs = new Set<string>();
    for (const login of bad) {
      const { calls, s } = store();
      const e = await rejection(new PasswordLoginService(s, hasher).verify({ login, password: PW }));
      expect([String(login), e.getStatus(), e.code]).toEqual([String(login), 401, 'LOGIN_INVALID']);
      expect(calls).toHaveLength(0);
      msgs.add(e.message + JSON.stringify(e.getResponse()));
    }
    expect(msgs.size).toBe(1);
  });

  it('không có tài khoản vs sai mật khẩu vs định dạng sai => cùng phản hồi (không dò tài khoản)', async () => {
    const miss: CredentialStore = { findByIdentifier: async () => null };
    const results = [
      await rejection(new PasswordLoginService(miss, hasher).verify({ login: 'NV-9999', password: PW })),
      await rejection(new PasswordLoginService(store().s, hasher).verify({ login: 'NV-0001', password: 'sai' })),
      await rejection(new PasswordLoginService(store().s, hasher).verify({ login: 'nv-0001', password: PW })),
    ].map((e) => JSON.stringify([e.getStatus(), e.code, e.message, e.getResponse()]));
    expect(new Set(results).size).toBe(1);
  });

  it('trường employeeId/actor do client gửi bị bỏ qua; employeeId chỉ từ kho', async () => {
    const { calls, s } = store();
    const r = await new PasswordLoginService(s, hasher).verify({ login: 'NV-0001', password: PW, employeeId: 999, actorId: 1 } as never);
    expect(r).toEqual({ employeeId: E7 });
    expect(Object.keys(calls[0]).sort()).toEqual(['kind', 'value']);
  });
});

describe('LoginSessionService — không tạo phiên khi danh tính/credential không hợp lệ (A10-3)', () => {
  const clock = { now: () => new Date(Date.UTC(2026, 9, 22)) };
  const build = () => {
    const sessionStore = new InMemorySessionStore();
    sessionStore.setTokenVersion(E7, 1);
    const sessions = new SessionService(sessionStore, sessionStore, new Sha256TokenHasher(), clock, 60_000);
    return { sessionStore, svc: new LoginSessionService(new PasswordLoginService(store().s, hasher), sessions) };
  };

  it('nv-0001 / mật khẩu sai => 401 LOGIN_INVALID và không có phiên; NV-0001 đúng => có phiên', async () => {
    const a = build();
    for (const input of [{ login: 'nv-0001', password: PW }, { login: 'NV-0001', password: 'sai' }]) {
      const e = await rejection(a.svc.login(input));
      expect([e.getStatus(), e.code]).toEqual([401, 'LOGIN_INVALID']);
    }
    expect(a.sessionStore.dumpKeys()).toHaveLength(0);
    const ok = await a.svc.login({ login: 'NV-0001', password: PW });
    expect(ok.token).toMatch(/^sid_/);
    expect(a.sessionStore.dumpKeys()).toHaveLength(1);
  });
});
