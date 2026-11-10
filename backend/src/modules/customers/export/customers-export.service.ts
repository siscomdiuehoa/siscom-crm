import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as os from 'node:os';
import * as path from 'node:path';
import { Prisma } from '../../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx, Scope } from '../../../common/auth/actor';
import { effectiveAccessOf, EmployeeAccess, RANK } from '../../../common/auth/scope-merge';
import { AUDIT_PORT, AuditPort } from '../../../common/audit/audit.port';
import { PrismaService } from '../../../prisma/prisma.service';
import { LOOKUP_TYPES, LookupKey } from '../customers.defaults';
import { chooseSearchPath, matchedFrom, scopeSql, SearchWhereInput } from '../customers.search';
import { buildCsv, EXPORT_COLUMNS, EXPORT_COLUMNS_VERSION, ExportRow } from './csv-safe';
import type { ExportCustomersDto } from './export.dto';
import { ExportException, exportErrors } from './export.errors';
import { ExportGapMonitor, GapDbRow, GapReason } from './export-gap-monitor';
import { CapMemo, InFlight, Slots } from './export-guards';

type Tx = Prisma.TransactionClient;

// Đặc tả FV4A bản 5 + đính chính 5.1 + checklist. Các số đều cấu hình được để test (I-36 dùng transaction_timeout nhỏ).
export interface ExportConfig {
  maxRows: number; rateLimit: number; denyCap: number; windowMinutes: number;
  transactionTimeoutMs: number; statementTimeoutMs: number; lockTimeoutMs: number; idleInTxMs: number;
  exportSlots: number; denySlots: number; maxBytes: number;
  gapDir: string; gapFlushMs: number; gapDbFlushMs: number;
}
export const EXPORT_CONFIG = Symbol('EXPORT_CONFIG');
export const EXPORT_ACCESS = Symbol('EXPORT_ACCESS');
// Đọc lại quyền / trạng thái / phòng ban của người xuất TRONG transaction (pool nghiệp vụ). Test thay được để mô phỏng thu hồi.
export interface ExportAccessReader { load(tx: Pick<Tx, 'employee'>, employeeId: string): Promise<EmployeeAccess | null> }
export class DbExportAccess implements ExportAccessReader {
  async load(tx: Pick<Tx, 'employee'>, employeeId: string): Promise<EmployeeAccess | null> {
    return (await effectiveAccessOf(tx, [employeeId])).get(employeeId) ?? null;
  }
}

export function exportConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ExportConfig {
  const dir = (env.EXPORT_GAP_LOG_DIR ?? '').trim();
  // Đính chính 5.1 §3.1: production bắt buộc cấu hình thư mục log bền (fail-closed khi khởi động).
  if (!dir && env.NODE_ENV === 'production') throw new Error('Thiếu EXPORT_GAP_LOG_DIR: bắt buộc ở production để ghi bền nhật ký bị bỏ qua của chức năng xuất CSV.');
  return {
    maxRows: 5000, rateLimit: 10, denyCap: 20, windowMinutes: 60,
    transactionTimeoutMs: 20_000, statementTimeoutMs: 15_000, lockTimeoutMs: 1_000, idleInTxMs: 20_000,
    exportSlots: 2, denySlots: 2, maxBytes: 16 * 1024 * 1024,
    gapDir: dir || path.join(os.tmpdir(), 'siscom-export-gap'), gapFlushMs: 10_000, gapDbFlushMs: 600_000,
  };
}

// Hai khoá tư vấn dạng HAI khoá 32-bit, không đụng các khoá một khoá (siscom.rbac…). Hằng riêng của tính năng.
const NS_EXPORT = 0x46563441; // 'FV4A'
const NS_DENY = 0x46563444;   // 'FV4D'

export type ExportResult = 'SUCCESS' | 'DENIED_PERMISSION' | 'RATE_LIMITED' | 'IN_PROGRESS' | 'BUSY' | 'TOO_LARGE' | 'FAILED' | 'RBAC_BUSY';

export function narrower(a: Scope | null | undefined, b: Scope | null | undefined): Scope | null {
  if (!a || !b) return null;
  return RANK[a] <= RANK[b] ? a : b;
}

// Lỗi từ chối nội bộ: rollback transaction rồi mới ghi nhật ký không thành công (đường riêng).
class Reject extends Error { constructor(readonly result: ExportResult, readonly http: ExportException, readonly extra: Record<string, unknown> = {}) { super(result); } }

interface ExportSummary { mode: string; filters: Record<string, string | boolean>; hasSearch: boolean; searchLen: number; idsRequested: number }

@Injectable()
export class CustomersExportService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CustomersExport');
  private readonly inFlight = new InFlight();
  private readonly exportSlots: Slots;
  private readonly denySlots: Slots;
  private readonly capMemo = new CapMemo();
  readonly monitor: ExportGapMonitor;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EXPORT_ACCESS) private readonly access: ExportAccessReader,
    @Inject(EXPORT_CONFIG) private readonly cfg: ExportConfig,
  ) {
    this.exportSlots = new Slots(cfg.exportSlots);
    this.denySlots = new Slots(cfg.denySlots);
    this.monitor = new ExportGapMonitor({
      dir: cfg.gapDir,
      log: (level, msg) => (level === 'error' ? this.log.error(msg) : this.log.warn(msg)),
      writeDb: (rows) => this.writeGapRows(rows),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.monitor.start();
    const t1 = setInterval(() => { void this.monitor.flushFile(); }, this.cfg.gapFlushMs); t1.unref();
    const t2 = setInterval(() => { void this.monitor.flushDb(); }, this.cfg.gapDbFlushMs); t2.unref();
    this.timers = [t1, t2];
  }
  async onModuleDestroy(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    await this.monitor.shutdown().catch(() => undefined);
  }

  async export(ctx: RequestCtx, dto: ExportCustomersDto): Promise<{ buffer: Buffer; rows: number; skipped: number; exportId: string; filename: string }> {
    const { actor } = ctx;
    const sum = this.summarize(dto);
    if (dto.mode === 'selected' && !dto.ids?.length) throw exportErrors.validation(['mode=selected cần ids (1–500).']);
    if (dto.mode === 'filtered' && dto.ids) throw exportErrors.validation(['ids chỉ dùng với mode=selected.']);

    // 0a. Quyền theo phiên (nạp lại mỗi request).
    const s0 = narrower(this.actors.scopeFor(actor, 'customer.read'), this.actors.scopeFor(actor, 'customer.export'));
    if (!s0) return this.deny(ctx, 'DENIED_PERMISSION', exportErrors.forbidden(), sum);
    // 0b. Một lượt mỗi người trong tiến trình.
    const leave = this.inFlight.tryEnter(actor.employeeId);
    if (!leave) return this.deny(ctx, 'IN_PROGRESS', exportErrors.inProgress(), sum);
    // 0c. Tối đa n lượt đồng thời, không hàng đợi.
    const free = this.exportSlots.tryAcquire();
    if (!free) { leave(); return this.deny(ctx, 'BUSY', exportErrors.busy(), sum); }
    try {
      return await this.prisma.$transaction((tx) => this.runTx(tx, ctx, dto, s0, sum), { maxWait: 2000, timeout: this.cfg.transactionTimeoutMs });
    } catch (e) {
      if (e instanceof Reject) return this.deny(ctx, e.result, e.http, sum, e.extra);
      if (e instanceof ExportException) throw e; // 400 (lookup, validation) — không phải lượt từ chối quyền
      this.log.error('Xuất CSV thất bại: ' + (e instanceof Error ? e.constructor.name : 'unknown') + ' requestId=' + (ctx.requestId ?? '-'));
      return this.deny(ctx, 'FAILED', exportErrors.failed(), sum);
    } finally { free(); leave(); }
  }

  // Thứ tự câu lệnh bắt buộc (đính chính 5.1 §1.3; U-12): mỗi bước là MỘT câu lệnh riêng.
  private async runTx(tx: Tx, ctx: RequestCtx, dto: ExportCustomersDto, s0: Scope, sum: ExportSummary) {
    const { actor } = ctx;
    // 1. Giới hạn thời gian (set_config(..., true) = SET LOCAL, có tham số; không dùng SQL ghép chuỗi).
    await tx.$queryRaw`SELECT set_config('transaction_timeout', ${this.cfg.transactionTimeoutMs + 'ms'}, true), set_config('statement_timeout', ${this.cfg.statementTimeoutMs + 'ms'}, true), set_config('lock_timeout', ${this.cfg.lockTimeoutMs + 'ms'}, true), set_config('idle_in_transaction_session_timeout', ${this.cfg.idleInTxMs + 'ms'}, true)`;
    // 2a. Khoá CHIA SẺ RBAC, không chờ: thay đổi quyền/vai trò/trạng thái NV (trigger giữ khoá độc quyền) phải chờ lượt xuất này.
    const [rb] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock_shared(hashtext('siscom.rbac')) AS ok`;
    if (!rb?.ok) throw new Reject('RBAC_BUSY', exportErrors.rbacBusy());
    // 2b. Khoá theo người, không chờ.
    const [mine] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${NS_EXPORT}::int, hashtext(${actor.employeeId}::text)) AS ok`;
    if (!mine?.ok) throw new Reject('IN_PROGRESS', exportErrors.inProgress());
    // 3. Kiểm lại quyền trong transaction (ảnh chụp lấy SAU khi đã giữ khoá).
    const acc = await this.access.load(tx, actor.employeeId);
    const s1 = acc && acc.active ? narrower(acc.scopes['customer.read'], acc.scopes['customer.export']) : null;
    const scope = narrower(s0, s1);
    if (!acc || !scope) throw new Reject('DENIED_PERMISSION', exportErrors.forbidden());
    const effActor: Actor = { employeeId: actor.employeeId, departmentId: acc.departmentId };
    // 4. Hạn mức (đếm SUCCESS đã commit — câu lệnh sau khi giữ khoá 2b).
    const [rl] = await tx.$queryRaw<{ n: number; oldest: Date | null }[]>`SELECT count(*)::int AS n, min(occurred_at) AS oldest FROM audit_log WHERE action = 'customer.export' AND actor_employee_id = ${actor.employeeId}::uuid AND changes->>'result' = 'SUCCESS' AND occurred_at > now() - make_interval(mins => ${this.cfg.windowMinutes}::int)`;
    if ((rl?.n ?? 0) >= this.cfg.rateLimit) {
      const retry = rl?.oldest ? Math.max(1, Math.ceil((rl.oldest.getTime() + this.cfg.windowMinutes * 60_000 - Date.now()) / 1000)) : 60;
      throw new Reject('RATE_LIMITED', exportErrors.rateLimited(retry));
    }
    // Mã danh mục -> id (sai mã => 400; không bao giờ bỏ qua bộ lọc). Chuỗi tìm kiếm chuẩn hoá bằng đúng f_vn_fold như danh sách.
    // Hai câu này không đọc dữ liệu khách hàng nên không ảnh hưởng tính nhất quán của câu dữ liệu ở bước 5.
    const ids = await this.resolveLookups(tx, dto);
    let folded = '';
    if (dto.search !== undefined) {
      const [f] = await tx.$queryRaw<{ t: string | null }[]>`SELECT public.f_vn_fold(btrim(${dto.search})) AS t`;
      folded = f?.t ?? '';
      if (folded.length < 2) throw exportErrors.validation(['search phải có ít nhất 2 ký tự.']);
    }
    // 5. MỘT câu truy vấn: nguồn duy nhất cho quyết định vượt giới hạn, nội dung CSV, rowCount, skipped.
    const rows = await tx.$queryRaw<ExportRow[]>(this.buildDataQuery(effActor, scope, dto, ids, folded));
    if (rows.length > this.cfg.maxRows) throw new Reject('TOO_LARGE', exportErrors.tooLarge(), { overLimit: true });
    // 6. Dựng CSV từ đúng các dòng đó.
    const csv = buildCsv(rows);
    if (csv.bytes > this.cfg.maxBytes) throw new Error('EXPORT_TOO_MANY_BYTES');
    const skipped = dto.mode === 'selected' ? (dto.ids?.length ?? 0) - rows.length : 0;
    // 7. Nhật ký SUCCESS trong cùng transaction (fail-closed).
    const code = await this.employeeCode(tx, actor.employeeId);
    const exportId = ctx.requestId ?? ('exp-' + Date.now().toString(36));
    await this.audit.record(tx, {
      action: 'customer.export', entityType: 'customer_export', entityId: actor.employeeId, entityCode: code,
      summary: 'Xuất ' + rows.length + ' khách hàng (CSV)',
      changes: { result: 'SUCCESS', ...sum, scope, rowCount: rows.length, skipped, prefixedCells: csv.prefixedCells, limit: this.cfg.maxRows, columnsVersion: EXPORT_COLUMNS_VERSION },
      actorEmployeeId: actor.employeeId, requestId: exportId,
    });
    const d = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // ngày giờ VN
    return { buffer: Buffer.from(csv.text, 'utf8'), rows: rows.length, skipped, exportId, filename: 'KhachHang_' + d + '.csv' };
  }

  private summarize(dto: ExportCustomersDto): ExportSummary {
    const filters: Record<string, string | boolean> = {};
    for (const k of ['status', 'tier', 'industry', 'source', 'province'] as const) if (dto[k]) filters[k] = dto[k] as string;
    if (dto.ownerId) filters.ownerId = true; // không ghi id người khác vào nhật ký
    return { mode: dto.mode, filters, hasSearch: !!dto.search, searchLen: dto.search ? dto.search.length : 0, idsRequested: dto.ids?.length ?? 0 };
  }

  private async resolveLookups(tx: Tx, dto: ExportCustomersDto): Promise<Partial<Record<LookupKey, string>>> {
    const keys = (['tier', 'status', 'industry', 'source', 'province'] as LookupKey[]).filter((k) => typeof dto[k] === 'string' && dto[k] !== '');
    if (!keys.length) return {};
    const found = await tx.lookupItem.findMany({ where: { OR: keys.map((k) => ({ type: LOOKUP_TYPES[k], code: dto[k] as string })) }, select: { id: true, type: true, code: true } });
    const out: Partial<Record<LookupKey, string>> = {};
    for (const k of keys) {
      const r = found.find((x) => x.type === LOOKUP_TYPES[k] && x.code === dto[k]);
      if (!r) throw exportErrors.lookupInvalid(k);
      out[k] = r.id;
    }
    return out;
  }

  private buildDataQuery(actor: Actor, scope: Scope, dto: ExportCustomersDto, ids: Partial<Record<LookupKey, string>>, folded: string): Prisma.Sql {
    const p: SearchWhereInput = { actor, folded, raw: dto.search ?? '', deletedOnly: false, readScope: scope, restoreScope: null, ownerId: dto.ownerId, ids };
    let from: Prisma.Sql; let where: Prisma.Sql;
    if (dto.search !== undefined) {
      const m = matchedFrom(p, chooseSearchPath(folded, false));
      from = m.from; where = m.where;
    } else { from = Prisma.sql`customer c`; where = Prisma.sql`c.deleted_at IS NULL AND ${this.outer(p)}`; }
    const sel = dto.mode === 'selected' && dto.ids?.length ? Prisma.sql` AND c.id = ANY(${dto.ids}::uuid[])` : Prisma.empty;
    return Prisma.sql`SELECT c.code, c.name, c.tax_id AS "taxId", ind.label_vi AS industry, tr.label_vi AS tier, st.label_vi AS status, ow.full_name AS owner, c.address, pv.label_vi AS province, c.phone, c.email
      FROM ${from}
      LEFT JOIN lookup_item ind ON ind.id = c.industry_id LEFT JOIN lookup_item tr ON tr.id = c.tier_id LEFT JOIN lookup_item st ON st.id = c.status_id
      LEFT JOIN lookup_item pv ON pv.id = c.province_id LEFT JOIN employee ow ON ow.id = c.owner_id
      WHERE ${where}${sel}
      ORDER BY c.code ASC LIMIT ${this.cfg.maxRows + 1}::int`;
  }
  private outer(p: SearchWhereInput): Prisma.Sql {
    // Giống buildOuterWhere nhưng không lặp điều kiện deleted_at.
    const parts: Prisma.Sql[] = [scopeSql(p.actor, p.readScope)];
    if (p.ownerId) parts.push(Prisma.sql`c.owner_id = ${p.ownerId}::uuid`);
    for (const k of ['tier', 'status', 'industry', 'source', 'province'] as LookupKey[]) if (p.ids[k]) parts.push(Prisma.sql`${LOOKUP_COL[k]} = ${p.ids[k]}::uuid`);
    return Prisma.join(parts, ' AND ');
  }

  private async employeeCode(tx: Pick<Tx, 'employee'>, id: string): Promise<string> {
    const e = await tx.employee.findUnique({ where: { id }, select: { code: true } });
    return e?.code ?? 'NV-?';
  }

  // Đường không thành công (§3 bản 4 + §3a bản 5): phản hồi lỗi LUÔN trả, không phụ thuộc việc ghi nhật ký.
  private async deny(ctx: RequestCtx, result: ExportResult, http: ExportException, sum: ExportSummary, extra: Record<string, unknown> = {}): Promise<never> {
    await this.recordFailure(ctx, result, sum, extra).catch(() => undefined);
    throw http;
  }

  private async recordFailure(ctx: RequestCtx, result: ExportResult, sum: ExportSummary, extra: Record<string, unknown>): Promise<void> {
    const id = ctx.actor.employeeId;
    if (this.capMemo.blocked(id)) return this.gap('CAP_REACHED', id);
    const free = this.denySlots.tryAcquire();
    if (!free) return this.gap('SLOTS_BUSY', id);
    try {
      const out = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', '2000ms', true), set_config('lock_timeout', '0', true)`;
        const [lk] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${NS_DENY}::int, hashtext(${id}::text)) AS ok`;
        if (!lk?.ok) return 'LOCK_BUSY' as const;
        const [c] = await tx.$queryRaw<{ n: number; oldest: Date | null }[]>`SELECT count(*)::int AS n, min(occurred_at) AS oldest FROM audit_log WHERE action = 'customer.export' AND actor_employee_id = ${id}::uuid AND changes->>'result' <> 'SUCCESS' AND occurred_at > now() - make_interval(mins => ${this.cfg.windowMinutes}::int)`;
        if ((c?.n ?? 0) >= this.cfg.denyCap) {
          this.capMemo.markUntil(id, (c?.oldest ? c.oldest.getTime() : Date.now()) + this.cfg.windowMinutes * 60_000);
          return 'CAP_REACHED' as const;
        }
        const code = await this.employeeCode(tx, id);
        await this.audit.record(tx, {
          action: 'customer.export', entityType: 'customer_export', entityId: id, entityCode: code,
          summary: 'Từ chối xuất: ' + result,
          changes: { result, ...sum, rowCount: 0, ...extra, limit: this.cfg.maxRows, columnsVersion: EXPORT_COLUMNS_VERSION },
          actorEmployeeId: id, requestId: ctx.requestId,
        });
        return 'OK' as const;
      }, { maxWait: 1000, timeout: 3000 });
      if (out !== 'OK') this.gap(out, id);
    } catch { this.gap('DB_ERROR', id); } finally { free(); }
  }
  private gap(reason: GapReason, id: string): void { this.monitor.record(reason, id); }

  private async writeGapRows(rows: GapDbRow[]): Promise<void> {
    const real = rows.filter((r) => /^[0-9a-f-]{36}$/i.test(r.actorId));
    const other = rows.length - real.length;
    if (other) this.log.warn(JSON.stringify({ event: 'export_audit_gap_other', rows: other })); // khoá OTHER: chỉ còn ở file/stdout
    if (!real.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const r of real) {
        await this.audit.record(tx, {
          action: 'customer.export_audit_gap', entityType: 'customer_export', entityId: r.actorId, entityCode: await this.employeeCode(tx, r.actorId),
          summary: 'Lượt từ chối xuất không được ghi nhật ký', changes: { reasons: r.reasons, fileDropped: r.fileDropped, fileUnpersisted: r.fileUnpersisted, from: r.from, to: r.to, instanceId: r.instanceId },
          actorEmployeeId: r.actorId,
        });
      }
    });
  }
}

const LOOKUP_COL: Record<LookupKey, Prisma.Sql> = {
  tier: Prisma.sql`c.tier_id`, status: Prisma.sql`c.status_id`, industry: Prisma.sql`c.industry_id`, source: Prisma.sql`c.source_id`, province: Prisma.sql`c.province_id`,
};
