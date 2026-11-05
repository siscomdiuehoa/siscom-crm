import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { sqlStateOf } from '../errors/prisma-error.mapper';
import type { AuditEntry, AuditPort } from './audit.port';

// B1.3.2a — bộ ghi nhật ký thật (thay PendingAuditPort). Ghi vào audit_log BẰNG CHÍNH giao dịch (tx) mà thao tác nghiệp vụ truyền vào:
// ghi lỗi => ném lỗi => giao dịch nghiệp vụ rollback (không có dữ liệu thay đổi mà thiếu nhật ký). Hợp đồng AuditPort giữ nguyên.
export const AUDIT_REDACTED_TEXT = '(đã thay đổi)';
// Lưới an toàn (D-S6): việc che trường nhạy cảm do nơi gọi làm; đây là chốt chặn cuối. Khoá nhạy cảm chỉ được mang giá trị "(đã thay đổi)".
// B3 A5: + content, outcome (nội dung/kết quả hoạt động chăm sóc), reason (lý do xoá), decisionNote (ghi chú duyệt chuyển việc).
const SENSITIVE_KEYS = new Set(['phone', 'phoneE164', 'email', 'address', 'note', 'fullName', 'title', 'password', 'passwordHash', 'token', 'refreshToken', 'secret',
  'content', 'outcome', 'reason', 'decisionNote']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z][a-z0-9_.-]{0,39}$/;
const MAX_SUMMARY = 1000;
const MAX_CHANGES_BYTES = 32768;
const MAX_REQUEST_ID = 64;

export class AuditWriteError extends Error {
  constructor(readonly reason: 'INVALID_ENTRY' | 'UNREDACTED' | 'NOT_A_TRANSACTION' | 'WRITE_FAILED', readonly field?: string) {
    super('Không ghi được nhật ký (' + reason + (field ? ': ' + field : '') + ').');
    this.name = 'AuditWriteError';
  }
}

function scan(v: unknown): void {
  if (Array.isArray(v)) { v.forEach(scan); return; }
  if (typeof v !== 'object' || v === null) return;
  for (const [k, x] of Object.entries(v)) {
    if (SENSITIVE_KEYS.has(k) && x !== AUDIT_REDACTED_TEXT) throw new AuditWriteError('UNREDACTED', 'changes.' + k);
    scan(x);
  }
}

// Thuần (không DB): kiểm tra và chuẩn hoá một AuditEntry thành dòng audit_log. Thông điệp lỗi chỉ nêu TÊN trường, không nêu giá trị.
export function buildAuditRow(e: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  const bad = (field: string): never => { throw new AuditWriteError('INVALID_ENTRY', field); };
  if (typeof e.action !== 'string' || !NAME_RE.test(e.action)) bad('action');
  if (typeof e.entityType !== 'string' || !NAME_RE.test(e.entityType)) bad('entityType');
  if (typeof e.entityId !== 'string' || !UUID_RE.test(e.entityId)) bad('entityId');
  if (typeof e.actorEmployeeId !== 'string' || !UUID_RE.test(e.actorEmployeeId)) bad('actorEmployeeId');
  if (typeof e.entityCode !== 'string' || e.entityCode.length === 0 || e.entityCode.length > 40) bad('entityCode');
  if (typeof e.summary !== 'string' || e.summary.trim().length === 0 || e.summary.length > MAX_SUMMARY) bad('summary');
  let changes: Prisma.InputJsonValue | undefined;
  if (e.changes !== undefined) {
    if (typeof e.changes !== 'object' || e.changes === null || Array.isArray(e.changes)) bad('changes');
    scan(e.changes);
    const json = JSON.stringify(e.changes);
    if (json === undefined || Buffer.byteLength(json, 'utf8') > MAX_CHANGES_BYTES) bad('changes');
    changes = JSON.parse(json) as Prisma.InputJsonValue;
  }
  const rid = typeof e.requestId === 'string' && e.requestId.length > 0 ? e.requestId.slice(0, MAX_REQUEST_ID) : null;
  return {
    actorType: 'USER',
    actorId: e.actorEmployeeId,
    actorRole: null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    entityCode: e.entityCode,
    summary: e.summary,
    ...(changes !== undefined ? { changes } : {}),
    requestId: rid,
  };
}

type AuditTx = { auditLog: { create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown> } };
function asAuditTx(tx: unknown): AuditTx {
  const d = (tx as { auditLog?: { create?: unknown } } | null | undefined)?.auditLog;
  if (!d || typeof d.create !== 'function') throw new AuditWriteError('NOT_A_TRANSACTION');
  return tx as AuditTx;
}

@Injectable()
export class DbAuditPort implements AuditPort {
  private readonly log = new Logger('Audit');

  // tx PHẢI là client của giao dịch nghiệp vụ đang mở. Mọi lỗi (dữ liệu sai, DB lỗi) => AuditWriteError => nơi gọi rollback.
  async record(tx: unknown, entry: AuditEntry): Promise<void> {
    const client = asAuditTx(tx);
    const data = buildAuditRow(entry);
    try {
      await client.auditLog.create({ data });
    } catch (e) {
      const rid = String(entry.requestId ?? '-').slice(0, MAX_REQUEST_ID).replace(/[^A-Za-z0-9._-]/g, '?');
      this.log.error('Ghi nhật ký thất bại: action=' + entry.action + ' entityType=' + entry.entityType + ' requestId=' + rid + ' sqlstate=' + (sqlStateOf(e) ?? 'n/a'));
      throw new AuditWriteError('WRITE_FAILED');
    }
  }
}
