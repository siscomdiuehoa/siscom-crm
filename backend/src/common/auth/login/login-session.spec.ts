import { DomainException } from '../../errors/domain.exception';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { Sha256TokenHasher, SessionService, UnwiredSessionStore } from '../session/session.service';
import { SessionRecord } from '../session/session.types';
import { LoginSessionService } from './login-session.service';
import { PasswordLoginService } from './password-login.service';
import { CredentialStore, PasswordHasher, StoredCredential } from './password-login.types';

const PW = 'Mat-khau-thu-nghiem-1';
// Hasher giả chỉ trong test: "hash" hợp lệ là 'H:' + mật khẩu.
const hasher: PasswordHasher = { verify: async (h, p) => h !== null && h === 'H:' + p };
const cred = (o: Partial<StoredCredential> = {}): StoredCredential => ({ employeeId: 7, hash: 'H:' + PW, algo: 'argon2id', active: true, ...o });
const creds = (c: StoredCredential | null): CredentialStore => ({ findByLogin: async () => c });
const clock = { now: () => new Date(Date.UTC(2026, 9, 22)) };
const build = (c: StoredCredential | null, sessionStore = new InMemorySessionStore()) => {
  sessionStore.setTokenVersion(7, 1);
  sessionStore.setTokenVersion(99, 1);
  const sessions = new SessionService(sessionStore, sessionStore, new Sha256TokenHasher(), clock, 60_000);
  return { sessionStore, svc: new LoginSessionService(new PasswordLoginService(creds(c), hasher), sessions) };
};
const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DomainException; } throw new Error('không ném lỗi'); };
const expectGeneric = async (p: Promise<unknown>) => {
  const e = await rejection(p);
  expect(e).toBeInstanceOf(DomainException);
  expect(e.getStatus()).toBe(401);
  expect(e.code).toBe('LOGIN_INVALID');
  expect(e.message).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
};

describe('LoginSessionService (offline)', () => {
  it('đúng mật khẩu => token mờ + hạn; phiên gắn employeeId từ kho xác thực; chỉ lưu băm', async () => {
    const { svc, sessionStore } = build(cred());
    const out = await svc.login({ login: 'nv@siscom.vn', password: PW });
    expect(out.token).toMatch(/^sid_[A-Za-z0-9_-]{43}$/);
    expect(out.expiresAt.getTime()).toBe(clock.now().getTime() + 60_000);
    expect(Object.keys(out).sort()).toEqual(['expiresAt', 'token']);
    expect(sessionStore.dumpKeys()).toEqual([new Sha256TokenHasher().hash(out.token)]);
    const sessions = new SessionService(sessionStore, sessionStore, new Sha256TokenHasher(), clock, 60_000);
    await expect(sessions.validate(out.token)).resolves.toEqual({ employeeId: 7, tokenVersion: 1 });
  });

  it('sai mật khẩu / không có tài khoản / tài khoản khóa / sai thuật toán => cùng lỗi chung và KHÔNG tạo phiên', async () => {
    const cases: Array<[string, StoredCredential | null, string]> = [
      ['sai mật khẩu', cred(), 'sai'], ['không có tài khoản', null, PW],
      ['khóa', cred({ active: false }), PW], ['thuật toán lạ', cred({ algo: 'md5' }), PW],
    ];
    for (const [, c, pw] of cases) {
      const { svc, sessionStore } = build(c);
      await expectGeneric(svc.login({ login: 'nv@siscom.vn', password: pw }));
      expect(sessionStore.dumpKeys()).toHaveLength(0);
    }
  });

  it('không gọi SessionService.issue khi xác minh thất bại', async () => {
    const issue = jest.fn();
    const svc = new LoginSessionService(new PasswordLoginService(creds(cred()), hasher), { issue } as unknown as SessionService);
    await expectGeneric(svc.login({ login: 'nv@siscom.vn', password: 'sai' }));
    expect(issue).not.toHaveBeenCalled();
  });

  it('lỗi ghi phiên => lỗi chung, không lộ nguyên nhân, không trả token', async () => {
    const store = new InMemorySessionStore();
    store.insert = async (_r: SessionRecord) => { throw new Error('SECRET connection string postgres://u:p@h/db'); };
    const { svc } = build(cred(), store);
    const e = await rejection(svc.login({ login: 'nv@siscom.vn', password: PW }));
    expect(e.code).toBe('LOGIN_INVALID');
    expect(JSON.stringify([e.message, e.getResponse?.()])).not.toMatch(/SECRET|postgres/);
  });

  it('kho phiên chưa nối (Unwired) => fail-closed bằng lỗi chung dù mật khẩu đúng', async () => {
    const unwired = new UnwiredSessionStore();
    const svc = new LoginSessionService(
      new PasswordLoginService(creds(cred()), hasher),
      new SessionService(unwired, unwired, new Sha256TokenHasher(), clock, 60_000),
    );
    await expectGeneric(svc.login({ login: 'nv@siscom.vn', password: PW }));
  });

  it('tài khoản không còn token_version (null) => lỗi chung, không có phiên', async () => {
    const { svc, sessionStore } = build(cred());
    sessionStore.setTokenVersion(7, null);
    await expectGeneric(svc.login({ login: 'nv@siscom.vn', password: PW }));
    expect(sessionStore.dumpKeys()).toHaveLength(0);
  });

  it('không giả mạo employeeId: trường thừa trong đầu vào bị bỏ qua, phiên luôn mang employeeId của kho xác thực', async () => {
    const { svc, sessionStore } = build(cred({ employeeId: 7 }));
    const spoof = { login: 'nv@siscom.vn', password: PW, employeeId: 99, employee_id: 99, headers: { 'x-employee-id': '99' } };
    const out = await svc.login(spoof);
    const sessions = new SessionService(sessionStore, sessionStore, new Sha256TokenHasher(), clock, 60_000);
    await expect(sessions.validate(out.token)).resolves.toEqual({ employeeId: 7, tokenVersion: 1 });
  });

  it('đầu vào sai kiểu/null => lỗi chung, không ném TypeError', async () => {
    const { svc } = build(cred());
    await expectGeneric(svc.login(null as never));
    await expectGeneric(svc.login({ login: 5, password: {} }));
  });
});
