import { createHash } from 'node:crypto';

// Giới hạn đăng nhập theo cửa sổ cố định, trong bộ nhớ tiến trình: theo NGUỒN (địa chỉ socket, không tin header) và theo
// cặp NGUỒN + danh tính đã chuẩn hoá. Không có hạn mức theo danh tính riêng (tránh DoS khoá tài khoản người khác).
// Khoá lưu dạng băm (không giữ IP/email thô). Bộ nhớ có giới hạn: vượt maxKeys thì bỏ khoá cũ nhất.
// Khoá credential bền vững (failed_count/locked_until) nằm ở DB (AuthService) — đây chỉ là lớp chặn sớm trước khi chạm DB.
export interface LoginLimiterOptions { windowMs: number; maxPerSource: number; maxPerIdentifier: number; maxKeys?: number }
interface Bucket { start: number; n: number }

export class LoginLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;
  constructor(private readonly opt: LoginLimiterOptions, private readonly now: () => number = Date.now) {
    for (const k of ['windowMs', 'maxPerSource', 'maxPerIdentifier'] as const) {
      if (!Number.isSafeInteger(opt[k]) || opt[k] <= 0) throw new Error('LOGIN_LIMITER_CONFIG_INVALID: ' + k);
    }
    this.maxKeys = opt.maxKeys ?? 20_000;
  }

  private hit(key: string): number {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || t - b.start >= this.opt.windowMs || t < b.start) {
      b = { start: t, n: 0 };
      this.buckets.delete(key);
      this.buckets.set(key, b);
      while (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value as string);
    }
    b.n += 1;
    return b.n;
  }

  // Mỗi lần gọi tính một lần thử. true = được phép; false = vượt hạn mức (429).
  allow(source: string, normalizedIdentifier: string | null): boolean {
    if (typeof source !== 'string' || source.length === 0) return false;
    const h = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32);
    let ok = this.hit('s:' + h(source)) <= this.opt.maxPerSource;
    if (normalizedIdentifier !== null) ok = (this.hit('si:' + h(source + '|' + normalizedIdentifier)) <= this.opt.maxPerIdentifier) && ok;
    return ok;
  }

  size(): number { return this.buckets.size; }
}
