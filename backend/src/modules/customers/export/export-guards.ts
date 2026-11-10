// FV-4A tầng 0 (trong tiến trình, trước khi lấy kết nối DB). Chỉ để giảm tải; tính đúng của hạn mức do khoá tư vấn DB bảo đảm.

export type Release = () => void;

// Semaphore KHÔNG hàng đợi: hết chỗ => null ngay.
export class Slots {
  private used = 0;
  constructor(private readonly max: number) {}
  get inUse(): number { return this.used; }
  tryAcquire(): Release | null {
    if (this.used >= this.max) return null;
    this.used++;
    let done = false;
    return () => { if (!done) { done = true; this.used--; } };
  }
  async run<T>(fn: () => Promise<T>): Promise<T | null> {
    const r = this.tryAcquire();
    if (!r) return null;
    try { return await fn(); } finally { r(); }
  }
}

// Một lượt xuất đang chạy cho mỗi nhân viên trong tiến trình.
export class InFlight {
  private readonly ids = new Set<string>();
  tryEnter(id: string): Release | null {
    if (this.ids.has(id)) return null;
    this.ids.add(id);
    let done = false;
    return () => { if (!done) { done = true; this.ids.delete(id); } };
  }
}

// Bộ nhớ "đã đủ trần nhật ký không thành công tới thời điểm T" — chặn trước khi chạm DB.
export class CapMemo {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  get size(): number { return this.until.size; }
  markUntil(id: string, t: number): void { this.until.set(id, t); }
  blocked(id: string): boolean {
    const t = this.until.get(id);
    if (t === undefined) return false;
    if (this.now() >= t) { this.until.delete(id); return false; }
    return true;
  }
}
