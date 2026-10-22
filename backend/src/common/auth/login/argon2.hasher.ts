import * as argon2 from 'argon2';
import { PasswordHasher } from './password-login.types';

// Xác minh Argon2 bằng gói `argon2` đã có sẵn trong dependencies (không thêm phụ thuộc). So sánh do thư viện thực hiện.
export class Argon2PasswordHasher implements PasswordHasher {
  private dummy: Promise<string> | null = null;

  // Băm giả sinh một lần từ giá trị ngẫu nhiên, cùng tham số mặc định của thư viện, để nhánh "không có tài khoản" tốn thời gian tương đương.
  private dummyHash(): Promise<string> {
    return (this.dummy ??= argon2.hash(`dummy:${Math.random()}:${Date.now()}`, { type: argon2.argon2id }));
  }

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
