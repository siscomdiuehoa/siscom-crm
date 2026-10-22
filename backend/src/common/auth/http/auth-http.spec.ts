import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { DomainException } from '../../errors/domain.exception';
import { LoginSessionService } from '../login/login-session.service';
import { PasswordLoginService } from '../login/password-login.service';
import { CredentialStore, PasswordHasher, StoredCredential } from '../login/password-login.types';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { Sha256TokenHasher, SessionService, UnwiredSessionStore } from '../session/session.service';
import { AuthHttpHandler } from './auth-http.handler';
const E7 = '00000000-0000-4000-8000-000000000007';
const E8 = '00000000-0000-4000-8000-000000000008';
const E99 = '00000000-0000-4000-8000-000000000099';

const PW = 'Mat-khau-thu-nghiem-1';
const hasher: PasswordHasher = { verify: async (h, p) => h !== null && h === 'H:' + p };
const cred = (o: Partial<StoredCredential> = {}): StoredCredential => ({ employeeId: E7, hash: 'H:' + PW, algo: 'argon2id', active: true, ...o });
const clock = { now: () => new Date(Date.UTC(2026, 9, 22)) };
const build = (c: StoredCredential | null = cred()) => {
  const store = new InMemorySessionStore();
  store.setTokenVersion(E7, 1);
  const sessions = new SessionService(store, store, new Sha256TokenHasher(), clock, 60_000);
  const creds: CredentialStore = { findByLogin: async () => c };
  const handler = new AuthHttpHandler(new LoginSessionService(new PasswordLoginService(creds, hasher), sessions), sessions);
  return { store, handler };
};
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const fail = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as DomainException; }
  throw new Error('không ném lỗi');
};
const expectErr = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await fail(p);
  expect(e).toBeInstanceOf(DomainException);
  expect(e.getStatus()).toBe(status);
  expect(e.code).toBe(code);
  return e;
};

describe('AuthHttpHandler (offline, chưa gắn route)', () => {
  it('login -> me -> logout -> me: đường đi đúng và thu hồi hiệu lực ngay', async () => {
    const { handler } = build();
    const out = await handler.login({ body: { login: 'nv@siscom.vn', password: PW } });
    expect(Object.keys(out).sort()).toEqual(['expiresAt', 'token']);
    expect(out.expiresAt).toBe('2026-10-22T00:01:00.000Z');
    await expect(handler.me({ headers: bearer(out.token) })).resolves.toEqual({ employeeId: E7 });
    await expect(handler.logout({ headers: bearer(out.token) })).resolves.toEqual({ ok: true });
    await expect(handler.logout({ headers: bearer(out.token) })).resolves.toEqual({ ok: true }); // lặp lại: idempotent
    await expectErr(handler.me({ headers: bearer(out.token) }), 401, 'AUTH_REQUIRED');
  });

  it('login: body sai hình dạng / trường thừa (giả mạo employeeId, actor) / quá dài => 400 chung, không chạm kho', async () => {
    const { handler, store } = build();
    const bad: unknown[] = [
      undefined, null, 'x', 42, [], [{ login: 'a', password: 'b' }], {}, { login: 'a' }, { password: 'b' },
      { login: 1, password: 'b' }, { login: 'a', password: {} }, { login: '', password: 'b' }, { login: 'a', password: '' },
      { login: 'a', password: 'b', employeeId: 1 }, { login: 'a', password: 'b', actor: { id: 1 } }, { login: 'a', password: 'b', token: 'sid_x' },
      { login: 'a'.repeat(255), password: 'b' }, { login: 'a', password: 'b'.repeat(1025) },
      JSON.parse('{"login":"a","password":"b","__proto__":{"employeeId":1}}'),
    ];
    for (const body of bad) {
      const e = await expectErr(handler.login({ body }), 400, 'REQUEST_INVALID');
      expect(e.message).toBe('Yêu cầu không hợp lệ.');
    }
    expect(store.dumpKeys()).toHaveLength(0);
  });

  it('header giả danh tính (x-employee-id, X-Actor-Id, x-user-id...) bị từ chối ở mọi thao tác, kể cả khi token hợp lệ', async () => {
    const { handler } = build();
    const out = await handler.login({ body: { login: 'nv@siscom.vn', password: PW } });
    for (const h of ['x-employee-id', 'X-Actor-Id', 'x-user-id', 'x-auth-employee', 'x-impersonate']) {
      await expectErr(handler.login({ body: { login: 'nv@siscom.vn', password: PW }, headers: { [h]: '1' } }), 400, 'REQUEST_INVALID');
      await expectErr(handler.me({ headers: { ...bearer(out.token), [h]: '99' } }), 400, 'REQUEST_INVALID');
      await expectErr(handler.logout({ headers: { ...bearer(out.token), [h]: '99' } }), 400, 'REQUEST_INVALID');
    }
    await expect(handler.me({ headers: bearer(out.token) })).resolves.toEqual({ employeeId: E7 }); // chưa bị thu hồi
  });

  it('login: sai mật khẩu / không có tài khoản / tài khoản khóa => cùng 401 LOGIN_INVALID, không lộ tồn tại, không phiên', async () => {
    const msgs = new Set<string>();
    for (const [c, pw] of [[cred(), 'sai'], [null, PW], [cred({ active: false }), PW]] as Array<[StoredCredential | null, string]>) {
      const { handler, store } = build(c);
      const e = await expectErr(handler.login({ body: { login: 'nv@siscom.vn', password: pw } }), 401, 'LOGIN_INVALID');
      msgs.add(JSON.stringify(e.getResponse()));
      expect(store.dumpKeys()).toHaveLength(0);
    }
    expect(msgs.size).toBe(1);
  });

  it('bearer sai: thiếu / sai scheme / sai định dạng / dư khoảng trắng / quá dài / mảng / token trong query => 401 AUTH_REQUIRED y hệt', async () => {
    const { handler } = build();
    const { token } = await handler.login({ body: { login: 'nv@siscom.vn', password: PW } });
    const headers: unknown[] = [
      undefined, '', 'Bearer', 'Bearer ', `Basic ${token}`, `Bearer  ${token}`, ` Bearer ${token}`, `Bearer ${token} `, `Bearer ${token}x`,
      `Bearer ${token}\r\nX-Employee-Id: 1`, 'Bearer sid_abc', `Bearer ${token.slice(0, -1)}`, `Bearer ${'sid_' + 'A'.repeat(500)}`,
      `Bearer ${token}`.repeat(3), [`Bearer ${token}`], 123, token,
    ];
    const bodies = new Set<string>();
    for (const authorization of headers) {
      for (const op of [handler.me.bind(handler), handler.logout.bind(handler)]) {
        const e = await expectErr(op({ headers: { authorization: authorization as string } }), 401, 'AUTH_REQUIRED');
        bodies.add(JSON.stringify(e.getResponse()));
      }
    }
    // Query không được hỗ trợ: dù có thêm trường query, thiếu header vẫn bị từ chối.
    await expectErr(handler.me({ headers: {}, query: { token } } as never), 401, 'AUTH_REQUIRED');
    expect(bodies.size).toBe(1);
    // Cú pháp scheme không phân biệt hoa thường vẫn dùng được.
    await expect(handler.me({ headers: { authorization: `bearer ${token}` } })).resolves.toEqual({ employeeId: E7 });
  });

  it('me: token đúng định dạng nhưng lạ / hết hạn / bị thu hồi / lệch token_version => cùng 401, không lộ lý do', async () => {
    const { handler, store } = build();
    const unknown = 'sid_' + 'A'.repeat(43);
    const a = await fail(handler.me({ headers: bearer(unknown) }));
    const { token } = await handler.login({ body: { login: 'nv@siscom.vn', password: PW } });
    store.setTokenVersion(E7, 2); // đổi mật khẩu / thu hồi toàn bộ
    const b = await fail(handler.me({ headers: bearer(token) }));
    store.setTokenVersion(E7, null); // tài khoản không dùng được
    const c = await fail(handler.me({ headers: bearer(token) }));
    for (const e of [a, b, c]) { expect(e.getStatus()).toBe(401); expect(e.code).toBe('AUTH_REQUIRED'); }
    expect(JSON.stringify(a.getResponse())).toBe(JSON.stringify(b.getResponse()));
    expect(JSON.stringify(b.getResponse())).toBe(JSON.stringify(c.getResponse()));
  });

  it('kho phiên chưa nối (UnwiredSessionStore): mặc định từ chối; lỗi chung, không lộ nguyên nhân; không báo logout thành công giả', async () => {
    const unwired = new UnwiredSessionStore();
    const sessions = new SessionService(unwired, unwired);
    const creds: CredentialStore = { findByLogin: async () => cred() };
    const handler = new AuthHttpHandler(new LoginSessionService(new PasswordLoginService(creds, hasher), sessions), sessions);
    const e1 = await expectErr(handler.login({ body: { login: 'nv@siscom.vn', password: PW } }), 401, 'LOGIN_INVALID');
    await expectErr(handler.me({ headers: bearer('sid_' + 'A'.repeat(43)) }), 401, 'AUTH_REQUIRED');
    const e3 = await expectErr(handler.logout({ headers: bearer('sid_' + 'A'.repeat(43)) }), 503, 'AUTH_UNAVAILABLE');
    for (const e of [e1, e3]) expect(JSON.stringify(e.getResponse())).not.toMatch(/NOT_WIRED|store|Error|stack/i);
  });

  it('đầu ra thành công/thất bại không chứa mật khẩu, băm, hay token đã gửi', async () => {
    const { handler } = build();
    const out = await handler.login({ body: { login: 'nv@siscom.vn', password: PW } });
    expect(JSON.stringify(out)).not.toContain(PW);
    expect(JSON.stringify(out)).not.toContain('H:');
    const e = await fail(handler.me({ headers: bearer(out.token.slice(0, -1) + (out.token.endsWith('A') ? 'B' : 'A')) }));
    expect(JSON.stringify(e.getResponse())).not.toContain(out.token.slice(4, 20));
  });

  it('mặc định từ chối ở tầng nguồn: không decorator Nest và không file nguồn nào ngoài thư mục http/spec import handler', () => {
    const dir = join(__dirname);
    for (const f of ['auth-http.handler.ts', 'auth-http.contract.ts']) {
      expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/@(Controller|Get|Post|Public|Module|Injectable)\b|@nestjs\/common/);
    }
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const src = join(__dirname, '..', '..', '..');
    const importers = walk(src).filter((p) => !p.startsWith(dir) && /auth-http\.(handler|contract)/.test(readFileSync(p, 'utf8')));
    expect(importers).toEqual([]);
  });
});
