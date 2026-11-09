import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';

// FV-4A §3a + đính chính 5.1 §3 + checklist B3: giám sát các lần KHÔNG ghi được dòng nhật ký không thành công.
// Ba kênh: bộ đếm trong bộ nhớ (bộ đệm), file JSONL bền (fsync mỗi chu kỳ), dòng DB customer.export_audit_gap (gộp).
// Không bao giờ chứa dữ liệu khách hay chuỗi tìm kiếm: chỉ id NV, lý do, số lượng, mốc thời gian, instanceId.

export type GapReason = 'CAP_REACHED' | 'SLOTS_BUSY' | 'LOCK_BUSY' | 'DB_ERROR';
export const GAP_REASONS: readonly GapReason[] = ['CAP_REACHED', 'SLOTS_BUSY', 'LOCK_BUSY', 'DB_ERROR'];
const OTHER = 'OTHER';

// Lớp ghi file tách riêng để test thay được (bộ đôi chỉ nằm trong thư mục test / spec).
export interface GapFileSystem {
  // Ghi nối rồi fsync. Lỗi phải mang stage: 'write' (chưa chắc đã ghi) hoặc 'sync' (đã ghi nhưng không chắc bền).
  appendDurable(file: string, data: string): Promise<void>;
  size(file: string): Promise<number>;
  readTail(file: string, maxBytes: number): Promise<string>;
  ensureDir(dir: string): Promise<void>;
}
export class GapWriteError extends Error {
  constructor(readonly stage: 'write' | 'sync', readonly code: string) { super('gap-log ' + stage + ' ' + code); }
}

export const nodeGapFs: GapFileSystem = {
  async appendDurable(file, data) {
    let h: fsp.FileHandle | undefined;
    try {
      h = await fsp.open(file, 'a', 0o600);
      try { await h.appendFile(data, 'utf8'); } catch (e) { throw new GapWriteError('write', (e as NodeJS.ErrnoException).code ?? 'EUNKNOWN'); }
      try { await h.sync(); } catch (e) { throw new GapWriteError('sync', (e as NodeJS.ErrnoException).code ?? 'EUNKNOWN'); }
    } catch (e) {
      if (e instanceof GapWriteError) throw e;
      throw new GapWriteError('write', (e as NodeJS.ErrnoException).code ?? 'EUNKNOWN');
    } finally { if (h) await h.close().catch(() => undefined); }
  },
  async size(file) { try { return (await fsp.stat(file)).size; } catch { return 0; } },
  async readTail(file, maxBytes) {
    try {
      const h = await fsp.open(file, 'r');
      try { const st = await h.stat(); const len = Math.min(st.size, maxBytes); const buf = Buffer.alloc(len); await h.read(buf, 0, len, st.size - len); return buf.toString('utf8'); } finally { await h.close(); }
    } catch { return ''; }
  },
  async ensureDir(dir) { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); },
};

export interface GapMonitorOptions {
  dir: string;
  fs?: GapFileSystem;
  now?: () => number;
  capBytes?: number;      // trần mỗi file / ngày (mặc định 10 MiB)
  reserveBytes?: number;  // phần dành cho dòng đánh dấu đầy (mặc định 4 KiB)
  maxKeys?: number;       // trần khoá (lý do, NV) trong bộ nhớ (mặc định 1000)
  log?: (level: 'warn' | 'error', msg: string) => void;
  // Ghi dòng DB gộp; ném lỗi => giữ bộ đếm, cộng dồn.
  writeDb?: (rows: GapDbRow[]) => Promise<void>;
  instanceId?: string;
}
export interface GapDbRow { actorId: string; reasons: Partial<Record<GapReason, number>>; fileDropped: number; fileUnpersisted: number; from: string; to: string; instanceId: string }

type Key = string; // reason|actor
const keyOf = (r: GapReason, a: string): Key => r + '|' + a;

export class ExportGapMonitor {
  readonly instanceId: string;
  private readonly fs: GapFileSystem;
  private readonly now: () => number;
  private readonly capBytes: number;
  private readonly reserve: number;
  private readonly maxKeys: number;
  private readonly log: (level: 'warn' | 'error', msg: string) => void;
  // Chờ ghi file (gộp theo khoá) và chờ ghi DB (gộp theo khoá).
  private pendingFile = new Map<Key, number>();
  private pendingDb = new Map<Key, number>();
  private fileDropped = new Map<string, number>();      // theo NV: sự kiện sau khi file đầy
  private fileUnpersisted = new Map<string, number>();  // theo NV: lỗi ghi / fsync / tràn bộ đệm
  private windowStart: number;
  private currentDay = '';
  private bytes = 0;
  private full = false;
  private lastLog = new Map<string, number>();
  private flushing: Promise<void> | null = null;
  degraded = false;

  constructor(private readonly opts: GapMonitorOptions) {
    this.fs = opts.fs ?? nodeGapFs;
    this.now = opts.now ?? Date.now;
    this.capBytes = opts.capBytes ?? 10 * 1024 * 1024;
    this.reserve = opts.reserveBytes ?? 4096;
    this.maxKeys = opts.maxKeys ?? 1000;
    this.log = opts.log ?? (() => undefined);
    this.instanceId = opts.instanceId ?? randomUUID();
    this.windowStart = this.now();
  }

  private day(): string { return new Date(this.now()).toISOString().slice(0, 10).replace(/-/g, ''); }
  file(day = this.day()): string { return path.join(this.opts.dir, 'export-audit-gap-' + day + '.jsonl'); }

  // Một lần bỏ ghi. Không ném lỗi, không chạm DB / đĩa.
  record(reason: GapReason, actorId: string): void {
    for (const m of [this.pendingFile, this.pendingDb]) {
      let k = keyOf(reason, actorId);
      if (!m.has(k) && m.size >= this.maxKeys) k = keyOf(reason, OTHER);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    const t = this.now(); const last = this.lastLog.get(reason) ?? 0;
    if (t - last >= 60_000) { this.lastLog.set(reason, t); this.log(reason === 'DB_ERROR' ? 'error' : 'warn', JSON.stringify({ event: 'export_audit_gap', reason, instanceId: this.instanceId })); }
  }

  get pendingKeys(): number { return this.pendingFile.size; }
  counts(actorId: string): { dropped: number; unpersisted: number } { return { dropped: this.fileDropped.get(actorId) ?? 0, unpersisted: this.fileUnpersisted.get(actorId) ?? 0 }; }

  private async rollDay(): Promise<void> {
    const d = this.day();
    if (d === this.currentDay) return;
    this.currentDay = d; this.full = false;
    this.bytes = await this.fs.size(this.file(d));
    if (this.bytes >= this.capBytes - this.reserve) this.full = true;
  }

  // Ghi một dòng hệ thống (startup / shutdown / abnormal / full). Lỗi => trả false.
  private async writeLine(obj: Record<string, unknown>, force = false): Promise<boolean> {
    await this.rollDay();
    const line = JSON.stringify({ ...obj, instanceId: this.instanceId, at: new Date(this.now()).toISOString() }) + '\n';
    const n = Buffer.byteLength(line);
    if (!force && (this.full || this.bytes + n > this.capBytes - this.reserve)) return false;
    try { await this.fs.appendDurable(this.file(), line); this.bytes += n; this.degraded = false; return true; } catch (e) { this.onFsError(e); return false; }
  }

  private onFsError(e: unknown): void {
    this.degraded = true;
    const code = e instanceof GapWriteError ? e.stage + ':' + e.code : 'unknown';
    const t = this.now(); const last = this.lastLog.get('FILE') ?? 0;
    if (t - last >= 60_000) { this.lastLog.set('FILE', t); this.log('error', JSON.stringify({ event: 'export_gap_log_degraded', code, instanceId: this.instanceId })); }
  }

  private bump(m: Map<string, number>, actor: string, n: number): void { m.set(actor, (m.get(actor) ?? 0) + n); }

  // Chu kỳ đẩy file (mặc định 10 s). Gộp theo (lý do, NV).
  async flushFile(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      if (!this.pendingFile.size) return;
      await this.rollDay();
      const batch = this.pendingFile; this.pendingFile = new Map();
      const t = new Date(this.now()).toISOString();
      const lines: string[] = []; const items: Array<[string, number]> = [];
      for (const [k, count] of batch) {
        const [reason, actor] = k.split('|') as [GapReason, string];
        if (this.full) { this.bump(this.fileDropped, actor, count); continue; }
        lines.push(JSON.stringify({ event: 'export_audit_gap', reason, actor, count, at: t, instanceId: this.instanceId }) + '\n'); items.push([k, count]);
      }
      if (!lines.length) return;
      // Trần: chỉ ghi các dòng còn vừa; phần còn lại + dòng đánh dấu đầy (dùng phần dành sẵn).
      let take = 0; let size = 0;
      while (take < lines.length && this.bytes + size + Buffer.byteLength(lines[take]!) <= this.capBytes - this.reserve) { size += Buffer.byteLength(lines[take]!); take++; }
      const data = lines.slice(0, take).join('');
      if (take > 0) {
        try { await this.fs.appendDurable(this.file(), data); this.bytes += size; this.degraded = false; } catch (e) {
          this.onFsError(e);
          if (e instanceof GapWriteError && e.stage === 'sync') { for (const [k, c] of items.slice(0, take)) this.bump(this.fileUnpersisted, k.split('|')[1]!, c); }
          else for (const [k, c] of items.slice(0, take)) this.requeue(k, c);
        }
      }
      if (take < lines.length) {
        for (const [k, c] of items.slice(take)) this.bump(this.fileDropped, k.split('|')[1]!, c);
        if (!this.full) { this.full = true; await this.writeLine({ event: 'export_gap_log_full', capBytes: this.capBytes }, true); }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private requeue(k: Key, c: number): void {
    if (!this.pendingFile.has(k) && this.pendingFile.size >= this.maxKeys) { this.bump(this.fileUnpersisted, k.split('|')[1]!, c); return; }
    this.pendingFile.set(k, (this.pendingFile.get(k) ?? 0) + c);
  }

  // Chu kỳ ghi DB (mặc định 10 phút). Lỗi => giữ, cộng dồn.
  async flushDb(): Promise<void> {
    if (!this.opts.writeDb || (!this.pendingDb.size && !this.fileDropped.size && !this.fileUnpersisted.size)) return;
    const from = new Date(this.windowStart).toISOString(); const to = new Date(this.now()).toISOString();
    const byActor = new Map<string, GapDbRow>();
    const row = (a: string): GapDbRow => { let r = byActor.get(a); if (!r) { r = { actorId: a, reasons: {}, fileDropped: 0, fileUnpersisted: 0, from, to, instanceId: this.instanceId }; byActor.set(a, r); } return r; };
    for (const [k, c] of this.pendingDb) { const [reason, actor] = k.split('|') as [GapReason, string]; const r = row(actor); r.reasons[reason] = (r.reasons[reason] ?? 0) + c; }
    for (const [a, c] of this.fileDropped) row(a).fileDropped += c;
    for (const [a, c] of this.fileUnpersisted) row(a).fileUnpersisted += c;
    try {
      await this.opts.writeDb([...byActor.values()]);
      this.pendingDb = new Map(); this.fileDropped = new Map(); this.fileUnpersisted = new Map(); this.windowStart = this.now();
    } catch { this.log('error', JSON.stringify({ event: 'export_audit_gap_db_failed', instanceId: this.instanceId })); }
  }

  // Khởi động: dòng startup; nếu phiên trước không có shutdown => abnormal_stop_detected kèm mốc bền cuối cùng.
  async start(): Promise<void> {
    await this.fs.ensureDir(this.opts.dir);
    const tail = await this.fs.readTail(this.file(), 256 * 1024);
    const lines = tail.split('\n').filter((l) => l.trim().startsWith('{'));
    let prevId: string | null = null; let prevShut = false; let lastAt: string | null = null;
    for (const l of lines) { try { const o = JSON.parse(l) as { event?: string; instanceId?: string; at?: string }; if (o.event === 'startup') { prevId = o.instanceId ?? null; prevShut = false; } if (o.event === 'shutdown' && o.instanceId === prevId) prevShut = true; if (o.instanceId === prevId) lastAt = o.at ?? lastAt; } catch { /* dòng hỏng: bỏ qua */ } }
    if (prevId && !prevShut) await this.writeLine({ event: 'abnormal_stop_detected', previousInstanceId: prevId, lastDurableAt: lastAt });
    await this.writeLine({ event: 'startup' });
  }

  async shutdown(): Promise<void> {
    await this.flushFile();
    await this.flushDb();
    await this.writeLine({ event: 'shutdown' }, true);
  }
}
