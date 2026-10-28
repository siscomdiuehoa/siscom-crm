import * as argon2 from 'argon2';

// Argon2id với tham số tường minh (B1.3.2_PLAN: m=65536 KiB, t=3, p=1). Gói `argon2` đã ghim ở B1.3.2-A; không thêm dependency.
export const ARGON2_ALGO = 'argon2id';
export const ARGON2_PARAMS = { m: 65536, t: 3, p: 1 } as const;
const OPTS: argon2.HashOptions = { type: argon2.argon2id, memoryCost: ARGON2_PARAMS.m, timeCost: ARGON2_PARAMS.t, parallelism: ARGON2_PARAMS.p };

export class Argon2PasswordHasher {
  private dummy: Promise<string> | null = null;

  // Băm giả sinh một lần, cùng tham số, để nhánh "không có tài khoản / không dùng được" tốn thời gian tương đương (chống dò tài khoản).
  private dummyHash(): Promise<string> {
    return (this.dummy ??= argon2.hash(`dummy:${Math.random()}:${Date.now()}`, OPTS));
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTS);
  }

  // Không ném lỗi ra ngoài: băm hỏng/lỗi thư viện => false.
  async verify(hash: string | null, password: string): Promise<boolean> {
    try {
      if (hash === null || !hash.startsWith('$argon2')) {
        await argon2.verify(await this.dummyHash(), password);
        return false;
      }
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
