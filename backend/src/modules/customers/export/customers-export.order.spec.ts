import type { Actor, ActorProvider } from '../../../common/auth/actor';
import type { AuditEntry, AuditPort } from '../../../common/audit/audit.port';
import type { PrismaService } from '../../../prisma/prisma.service';
import { CustomersExportService, ExportConfig, exportConfigFromEnv, narrower } from './customers-export.service';

// FV-4A U-12 (đính chính 5.1 §1.3): thứ tự câu lệnh trong transaction xuất; khoá và kiểm quyền là các câu lệnh RIÊNG.
const ACTOR: Actor = { employeeId: '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f', departmentId: null };
const cfg: ExportConfig = { ...exportConfigFromEnv({ NODE_ENV: 'test' }), gapDir: 'unused' };

function build(opts: { rbacOk?: boolean; mineOk?: boolean; dbScopes?: Record<string, string>; active?: boolean; successCount?: number; rows?: number } = {}) {
  const log: string[] = []; const audits: AuditEntry[] = [];
  const text = (a: unknown): string => {
    if (Array.isArray(a)) return a.join('?');
    const o = a as { sql?: string; strings?: string[] };
    return o.sql ?? (o.strings ?? []).join('?');
  };
  const tx = {
    $queryRaw: async (a: unknown) => {
      const q = text(a).replace(/\s+/g, ' ');
      if (q.includes('set_config')) { log.push('set_config'); return [{}]; }
      if (q.includes('pg_try_advisory_xact_lock_shared')) { log.push('lock_rbac_shared'); return [{ ok: opts.rbacOk ?? true }]; }
      if (q.includes('pg_try_advisory_xact_lock(')) { log.push('lock_actor'); return [{ ok: opts.mineOk ?? true }]; }
      if (q.includes('FROM audit_log')) { log.push('rate_count'); return [{ n: opts.successCount ?? 0, oldest: null }]; }
      if (q.includes('FROM customer c')) { log.push('data'); return Array.from({ length: opts.rows ?? 2 }, (_, i) => ({ code: 'KH-' + i, name: 'A', taxId: null, industry: null, tier: null, status: null, owner: null, address: null, province: null, phone: null, email: null })); }
      log.push('other:' + q.slice(0, 30)); return [];
    },
    employee: { findUnique: async () => { log.push('employee_code'); return { code: 'NV-0001' }; } },
    lookupItem: { findMany: async () => [] },
  };
  const prisma = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as unknown as PrismaService;
  const actors: ActorProvider = { resolve: async () => ACTOR, scopeFor: (_a, p) => (p === 'customer.read' || p === 'customer.export' ? 'ALL' : null) };
  const audit: AuditPort = { record: async (_t, e) => { log.push('audit:' + (e.changes as { result: string }).result); audits.push(e); } };
  const access = { load: async () => { log.push('recheck_access'); return { id: ACTOR.employeeId, departmentId: null, active: opts.active ?? true, scopes: (opts.dbScopes ?? { 'customer.read': 'ALL', 'customer.export': 'ALL' }) as never }; } };
  return { svc: new CustomersExportService(prisma, actors, audit, access, cfg), log, audits };
}
const run = (b: ReturnType<typeof build>) => b.svc.export({ actor: ACTOR, requestId: 'req-1' }, { mode: 'filtered' });
// Chỉ xét phần trong transaction xuất (đường ghi nhật ký từ chối chạy sau đó, trong transaction khác).
const main = (log: string[]) => { const i = log.findIndex((x) => x.startsWith('audit:') && x !== 'audit:SUCCESS'); return i < 0 ? log : log.slice(0, i); };

describe('FV-4A U-12 thứ tự câu lệnh', () => {
  it('thành công: set_config -> khoá chia sẻ RBAC -> khoá theo người -> kiểm lại quyền -> đếm hạn mức -> MỘT câu dữ liệu -> nhật ký SUCCESS', async () => {
    const b = build();
    const r = await run(b);
    expect(b.log).toEqual(['set_config', 'lock_rbac_shared', 'lock_actor', 'recheck_access', 'rate_count', 'data', 'employee_code', 'audit:SUCCESS']);
    expect(b.log.filter((x) => x === 'data')).toHaveLength(1);
    expect(r.rows).toBe(2);
  });
  it('RBAC đang bận => 429 EXPORT_RBAC_BUSY; KHÔNG kiểm quyền, KHÔNG đọc dữ liệu', async () => {
    const b = build({ rbacOk: false });
    await expect(run(b)).rejects.toMatchObject({ code: 'EXPORT_RBAC_BUSY' });
    expect(b.log.slice(0, 2)).toEqual(['set_config', 'lock_rbac_shared']);
    expect(b.log).not.toContain('recheck_access'); expect(b.log).not.toContain('data');
  });
  it('quyền trong DB đã bị gỡ (phiên vẫn còn) => 403; kiểm quyền chạy SAU khi giữ hai khoá; không đọc dữ liệu, không SUCCESS', async () => {
    const b = build({ dbScopes: { 'customer.read': 'ALL' } });
    await expect(run(b)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(b.log.slice(0, 4)).toEqual(['set_config', 'lock_rbac_shared', 'lock_actor', 'recheck_access']);
    expect(main(b.log)).not.toContain('data'); expect(b.log).not.toContain('audit:SUCCESS');
  });
  it('U-09: 5.001 dòng => 422; không ghi SUCCESS', async () => {
    const b = build({ rows: 5001 });
    await expect(run(b)).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE' });
    expect(b.log).not.toContain('audit:SUCCESS');
  });
  it('đủ hạn mức => 429 EXPORT_RATE_LIMITED trước khi đọc dữ liệu', async () => {
    const b = build({ successCount: 10 });
    await expect(run(b)).rejects.toMatchObject({ code: 'EXPORT_RATE_LIMITED' });
    expect(b.log).not.toContain('data');
  });
});

describe('FV-4A U-01 narrower và I-44 cấu hình', () => {
  it('phạm vi hẹp hơn thắng; thiếu một bên => null (đủ 3×3 + thiếu)', () => {
    const S = ['OWN', 'DEPARTMENT', 'ALL'] as const;
    for (const a of S) for (const b of S) expect(narrower(a, b)).toBe(S[Math.min(S.indexOf(a), S.indexOf(b))]);
    expect(narrower(null, 'ALL')).toBeNull(); expect(narrower('ALL', undefined)).toBeNull();
  });
  it('production thiếu EXPORT_GAP_LOG_DIR => từ chối cấu hình; có => dùng đúng thư mục; ngoài production => thư mục tạm', () => {
    expect(() => exportConfigFromEnv({ NODE_ENV: 'production' })).toThrow(/EXPORT_GAP_LOG_DIR/);
    expect(exportConfigFromEnv({ NODE_ENV: 'production', EXPORT_GAP_LOG_DIR: 'D:/logs/gap' }).gapDir).toBe('D:/logs/gap');
    expect(exportConfigFromEnv({ NODE_ENV: 'development' }).gapDir).toMatch(/siscom-export-gap/);
  });
});
