import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PrismaService } from '../../../prisma/prisma.service';
import { CustomersExportService, ExportConfig, exportConfigFromEnv } from './customers-export.service';
import { ExportGapMonitor, GapFileSystem, GapWriteError } from './export-gap-monitor';

// FV4A-R1-FIX (F222-R1): start() phải TỪ CHỐI khi không ghi được dòng "startup" — thư mục tồn tại nhưng không ghi được
// thì backend không được khởi động mà thiếu kênh ghi bền (fail-closed, đính chính 5.1 §3.1).
class MemFs implements GapFileSystem {
  files = new Map<string, string>(); failWrite = 0; failSync = 0;
  async appendDurable(file: string, data: string): Promise<void> {
    if (this.failWrite > 0) { this.failWrite--; throw new GapWriteError('write', 'EPERM'); }
    this.files.set(file, (this.files.get(file) ?? '') + data);
    if (this.failSync > 0) { this.failSync--; throw new GapWriteError('sync', 'EIO'); }
  }
  async size(file: string) { return Buffer.byteLength(this.files.get(file) ?? ''); }
  async readTail(file: string) { return this.files.get(file) ?? ''; }
  async ensureDir() { /* bộ nhớ */ }
  lines(file: string) { return (this.files.get(file) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>); }
}
const T0 = Date.parse('2026-11-10T01:00:00Z');
const mk = (mem: MemFs, o: Partial<ConstructorParameters<typeof ExportGapMonitor>[0]> = {}) => new ExportGapMonitor({ dir: '/d', fs: mem, now: () => T0, ...o });

describe('FV4A-R1-FIX ExportGapMonitor.start()', () => {
  it('lỗi GHI dòng startup (thư mục không ghi được) => start() bị từ chối, nêu EXPORT_GAP_LOG_DIR và mã lỗi', async () => {
    const mem = new MemFs(); mem.failWrite = 1;
    await expect(mk(mem).start()).rejects.toThrow(/EXPORT_GAP_LOG_DIR.*write:EPERM/);
  });
  it('fsync dòng startup lỗi => start() bị từ chối (chưa chắc bền)', async () => {
    const mem = new MemFs(); mem.failSync = 1;
    await expect(mk(mem).start()).rejects.toThrow(/EXPORT_GAP_LOG_DIR.*sync:EIO/);
  });
  it('file của ngày ĐÃ ĐẦY => start() vẫn thành công và vẫn có dòng startup (đầy không phải lý do chặn khởi động)', async () => {
    const mem = new MemFs(); const m = mk(mem, { capBytes: 2000, reserveBytes: 500 });
    mem.files.set(m.file(), 'x'.repeat(1990) + '\n');
    await expect(m.start()).resolves.toBeUndefined();
    expect(mem.files.get(m.file())).toMatch(/"event":"startup"/);
  });
  it('bình thường => thành công, có đúng một dòng startup', async () => {
    const mem = new MemFs(); const m = mk(mem);
    await m.start();
    expect(mem.lines(m.file()).filter((l) => l.event === 'startup')).toHaveLength(1);
  });
  it('hệ thống file THẬT: nơi ghi không ghi được (tên file log của ngày là một THƯ MỤC) => start() bị từ chối', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv4a-r1-'));
    try {
      const m = new ExportGapMonitor({ dir });
      fs.mkdirSync(m.file());
      await expect(m.start()).rejects.toThrow(/EXPORT_GAP_LOG_DIR/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('CustomersExportService.onModuleInit bị từ chối khi không ghi được => Nest dừng khởi động (không tạo hẹn giờ)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv4a-r1-'));
    try {
      const cfg: ExportConfig = { ...exportConfigFromEnv({ NODE_ENV: 'test' }), gapDir: dir };
      const svc = new CustomersExportService({} as PrismaService, { resolve: async () => null, scopeFor: () => null }, { record: async () => undefined }, { load: async () => null }, cfg);
      fs.mkdirSync(svc.monitor.file());
      await expect(svc.onModuleInit()).rejects.toThrow(/EXPORT_GAP_LOG_DIR/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('hệ thống file THẬT: thư mục ghi được => thành công và file có dòng startup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv4a-r1-'));
    try {
      const m = new ExportGapMonitor({ dir });
      await m.start();
      expect(fs.readFileSync(m.file(), 'utf8')).toMatch(/"event":"startup"/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
