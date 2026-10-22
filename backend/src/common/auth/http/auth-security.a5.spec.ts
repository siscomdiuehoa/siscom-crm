import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { DomainException } from '../../errors/domain.exception';
import { AuthHttpHandler } from './auth-http.handler';
import { LoginSessionService } from '../login/login-session.service';
import { PasswordLoginService } from '../login/password-login.service';
import { CredentialStore, PasswordHasher, StoredCredential } from '../login/password-login.types';
import { InMemorySessionStore } from '../session/in-memory-session.store';
import { Sha256TokenHasher, SessionService, UnwiredSessionStore } from '../session/session.service';
import { SessionRecord, SessionStore, TokenVersionSource } from '../session/session.types';

// Sprint A5: kiểm thử bảo mật KẾT HỢP A1+A2+A3+A4, hoàn toàn offline (không DB, không mạng, không bí mật thật).
const PW = 'Mat-khau-thu-nghiem-1';
const TTL = 60_000;
let nowMs = Date.UTC(2026, 9, 22, 0, 0, 0);
const clock = { now: () => new Date(nowMs) };
const hasher: PasswordHasher = { verify: async (h, p) => h !== null && h === 'H:' + p };
const cred = (o: Partial<StoredCredential> = {}): StoredCredential => ({ employeeId: 7, hash: 'H:' + PW, algo: 'argon2id', active: true, ...o });
const wire = (store: SessionStore, versions: TokenVersionSource, creds: CredentialStore) => {
  const sessions = new SessionService(store, versions, new Sha256TokenHasher(), clock, TTL);
  return new AuthHttpHandler(new LoginSessionService(new PasswordLoginService(creds, hasher), sessions), sessions);
};
const build = (c: StoredCredential | null = cred()) => {
  nowMs = Date.UTC(2026, 9, 22, 0, 0, 0);
  const store = new InMemorySessionStore();
  store.setTokenVersion(7, 1);
  store.setTokenVersion(8, 1);
  return { store, handler: wire(store, store, { findByLogin: async () => c }) };
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
const login = (h: AuthHttpHandler) => h.login({ body: { login: 'nv@siscom.vn', password: PW } });

describe('A5 — vòng đời phiên qua handler (hết hạn / thu hồi / tokenVersion)', () => {
  it('phiên hợp lệ ngay trước hạn, bị từ chối đúng tại và sau thời điểm hết hạn', async () => {
    const { handler } = build();
    const { token } = await login(handler);
    nowMs += TTL - 1;
    await expect(handler.me({ headers: bearer(token) })).resolves.toEqual({ employeeId: 7 });
    nowMs += 1;
    await expectErr(handler.me({ headers: bearer(token) }), 401, 'AUTH_REQUIRED');
    nowMs += 10 * TTL;
    await expectErr(handler.me({ headers: bearer(token) }), 401, 'AUTH_REQUIRED');
  });

  it('thu hồi một phiên không ảnh hưởng phiên khác của cùng người; logout lặp / token lạ vẫn 200 và không thu hồi nhầm', async () => {
    const { handler } = build();
    const a = await login(handler);
    const b = await login(handler);
    expect(a.token).not.toBe(b.token);
    await handler.logout({ headers: bearer(a.token) });
    await handler.logout({ headers: bearer(a.token) });
    await expect(handler.logout({ headers: bearer('sid_' + 'A'.repeat(43)) })).resolves.toEqual({ ok: true });
    await expectErr(handler.me({ headers: bearer(a.token) }), 401, 'AUTH_REQUIRED');
    await expect(handler.me({ headers: bearer(b.token) })).resolves.toEqual({ employeeId: 7 });
  });

  it('thu hồi KHÔNG ghi đè thời điểm thu hồi đầu tiên (logout lặp không "làm mới" bản ghi)', async () => {
    const { handler, store } = build();
    const { token } = await login(handler);
    const hash = new Sha256TokenHasher().hash(token);
    await handler.logout({ headers: bearer(token) });
    const first = (await store.findByHash(hash))!.revokedAt;
    nowMs += 5000;
    await handler.logout({ headers: bearer(token) });
    expect((await store.findByHash(hash))!.revokedAt).toEqual(first);
  });

  it('tokenVersion lệch theo cả hai chiều (tăng/giảm) hoặc khóa tài khoản => từ chối; khôi phục đúng version cũ thì phiên cũ vẫn do kho quyết định', async () => {
    const { handler, store } = build();
    const { token } = await login(handler);
    for (const v of [2, 0, -1, 1.5, Number.MAX_SAFE_INTEGER, null]) {
      store.setTokenVersion(7, v);
      await expectErr(handler.me({ headers: bearer(token) }), 401, 'AUTH_REQUIRED');
    }
    store.setTokenVersion(7, NaN as never);
    await expectErr(handler.me({ headers: bearer(token) }), 401, 'AUTH_REQUIRED');
  });

  it('phiên của người A không dùng được khi người B bị đổi tokenVersion (cách ly theo employeeId)', async () => {
    const { handler, store } = build();
    const a = await login(handler);
    store.setTokenVersion(8, 5);
    await expect(handler.me({ headers: bearer(a.token) })).resolves.toEqual({ employeeId: 7 });
  });
});

describe('A5 — giả mạo danh tính và đăng nhập thất bại', () => {
  it('employeeId trong body/header không ảnh hưởng: phiên mang employeeId từ kho xác thực (7), không phải giá trị giả (8)', async () => {
    const { handler } = build();
    await expectErr(handler.login({ body: { login: 'nv@siscom.vn', password: PW, employeeId: 8 } }), 400, 'REQUEST_INVALID');
    await expectErr(handler.login({ body: { login: 'nv@siscom.vn', password: PW }, headers: { 'X-Employee-Id': '8' } }), 400, 'REQUEST_INVALID');
    const { token } = await login(handler);
    await expect(handler.me({ headers: bearer(token) })).resolves.toEqual({ employeeId: 7 });
    // Header giả vẫn bị từ chối ngay cả khi token hợp lệ, và không phát sinh tác dụng phụ.
    await expectErr(handler.logout({ headers: { ...bearer(token), 'x-actor-id': '8' } }), 400, 'REQUEST_INVALID');
    await expect(handler.me({ headers: bearer(token) })).resolves.toEqual({ employeeId: 7 });
  });

  it('login thất bại (sai mật khẩu / không có / khóa / thuật toán lạ / kho xác thực ném lỗi / hasher ném lỗi) => cùng phản hồi 401 và KHÔNG tạo phiên', async () => {
    const bodies = new Set<string>();
    const cases: Array<() => { store: InMemorySessionStore; handler: AuthHttpHandler; pw: string }> = [
      () => ({ ...build(), pw: 'sai' }),
      () => ({ ...build(null), pw: PW }),
      () => ({ ...build(cred({ active: false })), pw: PW }),
      () => ({ ...build(cred({ algo: 'md5' })), pw: PW }),
      () => {
        const store = new InMemorySessionStore(); store.setTokenVersion(7, 1);
        return { store, pw: PW, handler: wire(store, store, { findByLogin: async () => { throw new Error('secret-db-detail'); } }) };
      },
    ];
    for (const mk of cases) {
      const { store, handler, pw } = mk();
      const e = await expectErr(handler.login({ body: { login: 'nv@siscom.vn', password: pw } }), 401, 'LOGIN_INVALID');
      bodies.add(JSON.stringify(e.getResponse()));
      expect(store.dumpKeys()).toHaveLength(0);
      expect(JSON.stringify(e.getResponse())).not.toMatch(/secret-db-detail|md5|active|argon/i);
    }
    expect(bodies.size).toBe(1);
  });

  it('tài khoản bị khóa SAU khi đăng nhập: phiên cũ bị từ chối; đăng nhập lại cũng bị từ chối', async () => {
    const store = new InMemorySessionStore(); store.setTokenVersion(7, 1);
    let c: StoredCredential | null = cred();
    const handler = wire(store, store, { findByLogin: async () => c });
    const { token } = await login(handler);
    c = cred({ active: false }); store.setTokenVersion(7, null);
    await expectErr(handler.me({ headers: bearer(token) }), 401, 'AUTH_REQUIRED');
    await expectErr(login(handler), 401, 'LOGIN_INVALID');
  });

  it('đăng nhập đúng nhưng tài khoản không có token_version (kho phiên báo null) => không cấp phiên, cùng 401 chung', async () => {
    const { handler, store } = build();
    store.setTokenVersion(7, null);
    const e = await expectErr(login(handler), 401, 'LOGIN_INVALID');
    expect(e.message).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
    expect(store.dumpKeys()).toHaveLength(0);
  });
});

describe('A5 — kho không an toàn / chưa nối => mặc định từ chối', () => {
  const unwired = () => {
    const u = new UnwiredSessionStore();
    return wire(u, u, { findByLogin: async () => cred() });
  };
  it('UnwiredSessionStore: login/me từ chối, logout 503; mọi phương thức kho đều ném (không âm thầm thành công)', async () => {
    const h = unwired();
    await expectErr(login(h), 401, 'LOGIN_INVALID');
    await expectErr(h.me({ headers: bearer('sid_' + 'A'.repeat(43)) }), 401, 'AUTH_REQUIRED');
    await expectErr(h.logout({ headers: bearer('sid_' + 'A'.repeat(43)) }), 503, 'AUTH_UNAVAILABLE');
    const u = new UnwiredSessionStore();
    for (const op of [() => u.insert(), () => u.findByHash(), () => u.revokeByHash(), () => u.currentTokenVersion()]) expect(op).toThrow("SESSION_STORE_NOT_WIRED");
  });

  it('kho/nguồn version ném lỗi ở từng bước => me luôn 401 chung (không 500, không lộ nội dung lỗi)', async () => {
    const good = new InMemorySessionStore(); good.setTokenVersion(7, 1);
    const sessionsOk = new SessionService(good, good, new Sha256TokenHasher(), clock, TTL);
    const issued = await sessionsOk.issue(7);
    const boom = (): never => { throw new Error('conn=postgres://u:p@h/db'); };
    const brokenFind: SessionStore = { insert: async () => undefined, findByHash: async () => boom(), revokeByHash: async () => undefined };
    const brokenVersion: TokenVersionSource = { currentTokenVersion: async () => boom() };
    for (const h of [wire(brokenFind, good, { findByLogin: async () => cred() }), wire(good, brokenVersion, { findByLogin: async () => cred() })]) {
      const e = await expectErr(h.me({ headers: bearer(issued.token) }), 401, 'AUTH_REQUIRED');
      expect(JSON.stringify(e.getResponse())).not.toMatch(/postgres|conn=|Error/);
    }
  });

  // Bản ghi phiên HỎNG từ kho (lỗi lập trình/dữ liệu bẩn). Mặc định từ chối nghĩa là mọi bản ghi không đúng hình dạng phải bị loại.
  // A6 đã vá SessionService.validate (kiểm hình dạng bản ghi): các ca dưới đây là regression thường.
  const withRecord = async (mutate: (r: SessionRecord) => unknown, versionOf: (r: SessionRecord) => number | null | undefined = (r) => r.tokenVersion) => {
    const real = new InMemorySessionStore(); real.setTokenVersion(7, 1);
    const issued = await new SessionService(real, real, new Sha256TokenHasher(), clock, TTL).issue(7);
    const rec = (await real.findByHash(new Sha256TokenHasher().hash(issued.token)))!;
    const bad = mutate(rec) as SessionRecord;
    const store: SessionStore = { insert: async () => undefined, findByHash: async () => bad, revokeByHash: async () => undefined };
    const versions: TokenVersionSource = { currentTokenVersion: async () => versionOf(bad) as number | null };
    return wire(store, versions, { findByLogin: async () => cred() }).me({ headers: bearer(issued.token) });
  };
  it('expiresAt là Invalid Date (NaN) phải bị từ chối', async () => {
    await expectErr(withRecord((r) => ({ ...r, expiresAt: new Date(NaN) })), 401, 'AUTH_REQUIRED');
  });
  it('tokenVersion = undefined ở cả bản ghi và nguồn version phải bị từ chối', async () => {
    await expectErr(withRecord((r) => ({ ...r, tokenVersion: undefined }), () => undefined), 401, 'AUTH_REQUIRED');
  });
  it('bản ghi hỏng đã được từ chối an toàn: revokedAt undefined, tokenVersion NaN, expiresAt không phải Date (ném lỗi => 401)', async () => {
    await expectErr(withRecord((r) => ({ ...r, revokedAt: undefined })), 401, 'AUTH_REQUIRED');
    await expectErr(withRecord((r) => ({ ...r, tokenVersion: NaN }), () => NaN), 401, 'AUTH_REQUIRED');
    await expectErr(withRecord((r) => ({ ...r, expiresAt: 'x' })), 401, 'AUTH_REQUIRED');
  });
});

describe('A5 — rò rỉ qua log / lỗi / lưu trữ', () => {
  const SECRET_PW = 'Mat-khau-RIENG-khong-duoc-lo-9';
  it('toàn bộ luồng (thành công + thất bại) không ghi console/stdout/stderr và không đưa mật khẩu/token/băm vào lỗi hay kho', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const captured: string[] = [];
    try {
      const store = new InMemorySessionStore(); store.setTokenVersion(7, 1);
      const creds: CredentialStore = { findByLogin: async () => cred({ hash: 'H:' + SECRET_PW }) };
      const handler = wire(store, store, creds);
      const ok = await handler.login({ body: { login: 'nv@siscom.vn', password: SECRET_PW } });
      const errors: DomainException[] = [
        await fail(handler.login({ body: { login: 'nv@siscom.vn', password: SECRET_PW + 'x' } })),
        await fail(handler.login({ body: { login: 'nv@siscom.vn', password: SECRET_PW, employeeId: 1 } })),
        await fail(handler.me({ headers: bearer(ok.token.slice(0, -1) + (ok.token.endsWith('A') ? 'B' : 'A')) })),
        await fail(handler.me({ headers: { authorization: `Basic ${ok.token}` } })),
      ];
      await handler.logout({ headers: bearer(ok.token) });
      errors.push(await fail(handler.me({ headers: bearer(ok.token) })));
      for (const e of errors) captured.push(e.message, JSON.stringify(e.getResponse()), String(e.stack ?? ''), JSON.stringify(e));
      const hash = new Sha256TokenHasher().hash(ok.token);
      const blob = captured.join('\n');
      for (const s of [SECRET_PW, 'H:' + SECRET_PW, ok.token, ok.token.slice(4), hash]) expect(blob).not.toContain(s);
      const keys = store.dumpKeys().join('\n');
      expect(keys).not.toContain(SECRET_PW);
      expect(keys).not.toContain(ok.token.slice(4));
      expect(JSON.stringify([...(store as unknown as { sessions: Map<string, SessionRecord> }).sessions.values()])).not.toMatch(new RegExp(`${SECRET_PW}|${ok.token.slice(4)}`));
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      expect(out).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
      out.mockRestore(); err.mockRestore();
    }
  });

  it('tĩnh: mã nguồn xác thực (http/login/session) không dùng console/Logger/process.env/fs/mạng và không import DB (prisma/pg)', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
    const files = ['http', 'login', 'session'].flatMap((d) => walk(join(__dirname, '..', d)));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      const code = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect({ f, hit: /\bconsole\.|Logger|process\.env|from 'fs'|from 'http|from 'net'|@prisma|from 'pg'|fetch\(/.exec(code)?.[0] ?? null }).toEqual({ f, hit: null });
    }
  });
});
