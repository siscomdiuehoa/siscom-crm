import * as argon2 from 'argon2';
import { DomainException } from '../../errors/domain.exception';
import { Argon2PasswordHasher } from './argon2.hasher';
import { PasswordLoginService } from './password-login.service';
import { CredentialStore, PasswordHasher, StoredCredential } from './password-login.types';

const PW = 'Mat-khau-thu-nghiem-1';
let goodHash: string;
beforeAll(async () => {
  goodHash = await argon2.hash(PW, { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 });
});

const store = (c: StoredCredential | null | Error): CredentialStore & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, findByLogin: async (l) => { calls.push(l); if (c instanceof Error) throw c; return c; } };
};
const cred = (o: Partial<StoredCredential> = {}): StoredCredential => ({ employeeId: 7, hash: goodHash, algo: 'argon2id', active: true, ...o });
const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DomainException; } throw new Error('không ném lỗi'); };

describe('PasswordLoginService + Argon2PasswordHasher (offline)', () => {
  const hasher = new Argon2PasswordHasher();

  it('đúng mật khẩu => employeeId lấy từ bộ lưu trữ; đăng nhập được chuẩn hóa', async () => {
    const s = store(cred());
    await expect(new PasswordLoginService(s, hasher).verify({ login: '  NV@Siscom.VN ', password: PW })).resolves.toEqual({ employeeId: 7 });
    expect(s.calls).toEqual(['nv@siscom.vn']);
  });

  it('mọi thất bại cho cùng một lỗi 401 LOGIN_INVALID, cùng thông điệp', async () => {
    const cases: Array<[string, CredentialStore, unknown, unknown]> = [
      ['sai mật khẩu', store(cred()), 'a@b', 'sai'],
      ['không có tài khoản', store(null), 'a@b', PW],
      ['tài khoản khóa', store(cred({ active: false })), 'a@b', PW],
      ['thuật toán lạ', store(cred({ algo: 'md5' })), 'a@b', PW],
      ['băm hỏng', store(cred({ hash: 'khong-phai-argon2' })), 'a@b', PW],
      ['lỗi bộ lưu trữ', store(new Error('pg://user:secret@host')), 'a@b', PW],
      ['login không phải chuỗi', store(cred()), { $ne: 1 }, PW],
      ['mật khẩu không phải chuỗi', store(cred()), 'a@b', 123],
      ['login rỗng', store(cred()), '   ', PW],
      ['mật khẩu quá dài', store(cred()), 'a@b', 'x'.repeat(1025)],
    ];
    const msgs = new Set<string>();
    for (const [name, st, login, password] of cases) {
      const e = await rejection(new PasswordLoginService(st, hasher).verify({ login, password }));
      expect([name, e.getStatus(), e.code]).toEqual([name, 401, 'LOGIN_INVALID']);
      msgs.add(e.message);
      expect(JSON.stringify(e.getResponse())).not.toMatch(/secret|pg:|argon2/);
    }
    expect(msgs.size).toBe(1);
  });

  it('danh tính không đến từ request: trường thừa (employeeId/actorId) bị bỏ qua', async () => {
    const s = store(cred({ employeeId: 7 }));
    const r = await new PasswordLoginService(s, hasher).verify({ login: 'a@b', password: PW, employeeId: 999, actorId: 1 } as never);
    expect(r).toEqual({ employeeId: 7 });
  });

  it('nhánh không dùng được vẫn gọi hasher (băm giả) — không rẽ nhánh sớm', async () => {
    const seen: Array<string | null> = [];
    const spy: PasswordHasher = { verify: async (h) => { seen.push(h); return true; } };
    for (const st of [store(null), store(cred({ active: false })), store(cred({ algo: 'x' }))]) {
      await rejection(new PasswordLoginService(st, spy).verify({ login: 'a@b', password: PW }));
    }
    expect(seen).toEqual([null, null, null]);
  });

  it('hasher: không ném lỗi, băm giả/băm hỏng => false', async () => {
    await expect(hasher.verify(null, PW)).resolves.toBe(false);
    await expect(hasher.verify('$argon2id$hong', PW)).resolves.toBe(false);
    await expect(hasher.verify(goodHash, PW)).resolves.toBe(true);
    await expect(hasher.verify(goodHash, 'sai')).resolves.toBe(false);
  });
});
