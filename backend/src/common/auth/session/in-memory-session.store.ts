import { SessionRecord, SessionStore, TokenVersionSource } from './session.types';

// Bộ chứa trong bộ nhớ CHỈ để kiểm thử/phát triển offline; không dùng làm bộ lưu trữ thật (mất khi khởi động lại, không chia sẻ giữa tiến trình).
export class InMemorySessionStore implements SessionStore, TokenVersionSource {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly versions = new Map<number, number>();

  setTokenVersion(employeeId: number, version: number | null): void {
    if (version === null) this.versions.delete(employeeId); else this.versions.set(employeeId, version);
  }
  async currentTokenVersion(employeeId: number): Promise<number | null> { return this.versions.get(employeeId) ?? null; }
  async insert(r: SessionRecord): Promise<void> { this.sessions.set(r.tokenHash, r); }
  async findByHash(h: string): Promise<SessionRecord | null> { return this.sessions.get(h) ?? null; }
  async revokeByHash(h: string, at: Date): Promise<void> {
    const r = this.sessions.get(h);
    if (r && r.revokedAt === null) this.sessions.set(h, { ...r, revokedAt: at });
  }
  // Dành cho test: kiểm tra không có token gốc nào nằm trong bộ chứa.
  dumpKeys(): string[] { return [...this.sessions.keys()]; }
}
