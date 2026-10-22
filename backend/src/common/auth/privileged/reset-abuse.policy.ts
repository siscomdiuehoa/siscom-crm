// Chính sách chống lạm dụng đặt lại mật khẩu (F-04), tầng ứng dụng. Cửa sổ cố định, theo NGUỒN (khóa do tầng gọi suy ra từ địa chỉ socket đáng tin;
// KHÔNG lấy từ nội dung request, KHÔNG tin X-Forwarded-For nếu chưa cấu hình proxy tin cậy). Không có hạn mức TOÀN CỤC: hạn mức toàn cục sẽ
// cho kẻ tấn công chặn mọi người dùng hợp lệ (DoS); chặn lưu lượng lớn là việc của lớp biên (WAF/reverse proxy) — xem tài liệu thiết kế.
export interface ResetAbuseOptions { windowMs: number; maxAttempts: number; maxFailures: number; maxKeys: number }
export const DEFAULT_RESET_ABUSE: ResetAbuseOptions = { windowMs: 15 * 60_000, maxAttempts: 30, maxFailures: 10, maxKeys: 10_000 };

interface Bucket { start: number; attempts: number; failures: number }

export class ResetAbusePolicy {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly opt: ResetAbuseOptions = DEFAULT_RESET_ABUSE, private readonly now: () => number = Date.now) {}

  private bucket(key: string): Bucket {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || t - b.start >= this.opt.windowMs || t < b.start) {
      b = { start: t, attempts: 0, failures: 0 };
      this.buckets.delete(key);
      this.buckets.set(key, b);
      // Bộ nhớ có giới hạn: vượt maxKeys thì bỏ khóa cũ nhất (Map giữ thứ tự chèn). Nguồn bị bỏ sẽ được tính lại từ 0 (chấp nhận được, ưu tiên không cạn bộ nhớ).
      while (this.buckets.size > this.opt.maxKeys) this.buckets.delete(this.buckets.keys().next().value as string);
    }
    return b;
  }

  // false => từ chối (429) TRƯỚC khi chạm DB. Mỗi lần được phép tính là một lần thử.
  tryAcquire(key: string): boolean {
    const b = this.bucket(key);
    if (b.attempts >= this.opt.maxAttempts || b.failures >= this.opt.maxFailures) return false;
    b.attempts += 1;
    return true;
  }
  recordFailure(key: string): void {
    this.bucket(key).failures += 1;
  }
  size(): number {
    return this.buckets.size;
  }
}
