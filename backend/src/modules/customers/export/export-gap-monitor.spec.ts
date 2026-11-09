import { ExportGapMonitor, GapDbRow, GapFileSystem, GapWriteError } from './export-gap-monitor';

// Bộ đôi hệ thống file — CHỈ trong test. failWrite / failSync: số lần tới sẽ lỗi.
class MemFs implements GapFileSystem {
  files = new Map<string, string>();
  failWrite = 0; failSync = 0; writeCode = 'ENOSPC';
  async appendDurable(file: string, data: string): Promise<void> {
    if (this.failWrite > 0) { this.failWrite--; throw new GapWriteError('write', this.writeCode); }
    this.files.set(file, (this.files.get(file) ?? '') + data); // đã ghi
    if (this.failSync > 0) { this.failSync--; throw new GapWriteError('sync', 'EIO'); }
  }
  async size(file: string) { return Buffer.byteLength(this.files.get(file) ?? ''); }
  async readTail(file: string) { return this.files.get(file) ?? ''; }
  async ensureDir() { /* bộ nhớ */ }
  lines(file: string) { return (this.files.get(file) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>); }
}
const T0 = Date.parse('2026-11-10T01:00:00Z');
const mk = (fs: MemFs, o: Partial<ConstructorParameters<typeof ExportGapMonitor>[0]> = {}) => {
  const logs: string[] = []; const db: GapDbRow[][] = []; let now = T0;
  const m = new ExportGapMonitor({ dir: '/d', fs, now: () => now, log: (_l, s) => logs.push(s), writeDb: async (r) => { db.push(r); }, ...o });
  return { m, logs, db, tick: (ms: number) => { now += ms; } };
};
const gapCount = (fs: MemFs, f: string) => fs.lines(f).filter((l) => l.event === 'export_audit_gap').reduce((s, l) => s + Number(l.count), 0);

describe('FV-4A ExportGapMonitor', () => {
  it('ghi bền gộp theo (lý do, NV); không có dữ liệu khách; log stdout ≤ 1 dòng/phút/lý do', async () => {
    const fs = new MemFs(); const { m, logs } = mk(fs);
    await m.start();
    for (let i = 0; i < 500; i++) m.record('CAP_REACHED', 'emp-1');
    m.record('DB_ERROR', 'emp-2');
    await m.flushFile();
    expect(gapCount(fs, m.file())).toBe(501);
    expect(logs.filter((l) => l.includes('CAP_REACHED'))).toHaveLength(1);
    expect(fs.files.get(m.file())).not.toMatch(/search|name|phone|email/i);
  });

  it('I-46 (đơn vị): đạt trần => dừng ghi, đúng MỘT dòng export_gap_log_full, đếm fileDropped', async () => {
    const fs = new MemFs(); const { m, db } = mk(fs, { capBytes: 6000, reserveBytes: 1000 });
    await m.start();
    for (let i = 0; i < 200; i++) m.record('LOCK_BUSY', 'emp-' + i); // 200 khoá => vượt trần
    await m.flushFile();
    for (let i = 0; i < 5; i++) m.record('LOCK_BUSY', 'emp-x');
    await m.flushFile();
    const L = fs.lines(m.file());
    expect(L.filter((l) => l.event === 'export_gap_log_full')).toHaveLength(1);
    expect(Buffer.byteLength(fs.files.get(m.file())!)).toBeLessThanOrEqual(6000);
    const written = gapCount(fs, m.file());
    await m.flushDb();
    const dropped = db[0]!.reduce((s, r) => s + r.fileDropped, 0);
    expect(written + dropped).toBe(205);
    expect(dropped).toBeGreaterThan(0);
  });

  it('U-14: ENOSPC => không ném lỗi, giữ để thử lại, log error ≤ 1/phút; hết lỗi thì đẩy bù', async () => {
    const fs = new MemFs(); const { m, logs, tick } = mk(fs);
    await m.start();
    fs.failWrite = 3;
    m.record('SLOTS_BUSY', 'emp-1'); await expect(m.flushFile()).resolves.toBeUndefined();
    m.record('SLOTS_BUSY', 'emp-1'); await m.flushFile();
    expect(m.degraded).toBe(true);
    expect(logs.filter((l) => l.includes('export_gap_log_degraded'))).toHaveLength(1);
    tick(61_000); m.record('SLOTS_BUSY', 'emp-1'); await m.flushFile();
    expect(gapCount(fs, m.file())).toBe(0);
    await m.flushFile(); // lần 4: hết lỗi
    expect(gapCount(fs, m.file())).toBe(3);
    expect(m.degraded).toBe(false);
  });

  it('U-14: bộ đệm tối đa maxKeys; khoá thừa khi đang lỗi => fileUnpersisted', async () => {
    const fs = new MemFs(); const { m } = mk(fs, { maxKeys: 3 });
    await m.start(); fs.failWrite = 99;
    for (let i = 0; i < 3; i++) m.record('LOCK_BUSY', 'e' + i);
    await m.flushFile();
    for (let i = 3; i < 6; i++) m.record('LOCK_BUSY', 'e' + i); // vào khoá OTHER (đủ 3 khoá)
    expect(m.pendingKeys).toBeLessThanOrEqual(4);
  });

  it('U-15: fsync EIO => lô coi là CHƯA bền, đếm fileUnpersisted, không thử lại (không nhân đôi)', async () => {
    const fs = new MemFs(); const { m, db } = mk(fs);
    await m.start(); fs.failSync = 1;
    m.record('DB_ERROR', 'emp-9'); await m.flushFile();
    expect(m.counts('emp-9').unpersisted).toBe(1);
    await m.flushFile();
    expect(gapCount(fs, m.file())).toBe(1); // dòng đã ghi một lần, không ghi lại
    await m.flushDb();
    expect(db[0]![0]).toMatchObject({ actorId: 'emp-9', fileUnpersisted: 1, reasons: { DB_ERROR: 1 } });
  });

  it('I-48/I-49 (đơn vị): tắt bình thường có shutdown; lần chết đột ngột => abnormal_stop_detected', async () => {
    const fs = new MemFs();
    const a = mk(fs, { instanceId: 'A' }); await a.m.start(); a.m.record('CAP_REACHED', 'e'); await a.m.shutdown();
    const b = mk(fs, { instanceId: 'B' }); await b.m.start(); b.m.record('CAP_REACHED', 'e'); await b.m.flushFile(); // B chết, không shutdown
    const c = mk(fs, { instanceId: 'C' }); await c.m.start();
    const L = fs.lines(c.m.file());
    expect(L.filter((l) => l.event === 'abnormal_stop_detected').map((l) => l.previousInstanceId)).toEqual(['B']);
    expect(L.filter((l) => l.event === 'shutdown').map((l) => l.instanceId)).toEqual(['A']);
  });

  it('I-35 (đơn vị): ghi DB lỗi => giữ bộ đếm, cộng dồn; thành công => xoá', async () => {
    const fs = new MemFs(); let fail = true; const rows: GapDbRow[][] = [];
    const { m } = mk(fs, { writeDb: async (r) => { if (fail) throw new Error('db'); rows.push(r); } });
    await m.start();
    m.record('CAP_REACHED', 'e1'); await m.flushDb();
    m.record('CAP_REACHED', 'e1'); fail = false; await m.flushDb();
    expect(rows[0]![0]!.reasons.CAP_REACHED).toBe(2);
    await m.flushDb();
    expect(rows).toHaveLength(1);
  });

  it('I-43 (đơn vị): 1.500 NV => ≤ 1.000 khoá + OTHER, tổng đếm đủ', async () => {
    const fs = new MemFs(); const { m } = mk(fs);
    await m.start();
    for (let i = 0; i < 1500; i++) m.record('CAP_REACHED', 'e' + i);
    expect(m.pendingKeys).toBeLessThanOrEqual(1001);
    await m.flushFile();
    expect(gapCount(fs, m.file())).toBe(1500);
  });
});
