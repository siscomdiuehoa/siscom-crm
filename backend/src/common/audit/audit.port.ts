export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  entityCode: string;
  summary: string;
  changes?: Record<string, unknown>;
  actorEmployeeId: string;
  requestId?: string;
}

// Cổng ghi nhật ký, gọi TRONG cùng transaction với thao tác ghi. Bản thật (AuditLog) làm ở B1.2.3-B3.
export interface AuditPort {
  record(tx: unknown, entry: AuditEntry): Promise<void>;
}
export const AUDIT_PORT = Symbol('AUDIT_PORT');

// B-1: CHƯA có AuditLog => mọi thao tác ghi bị chặn từ gốc (ném lỗi => transaction rollback).
// Nhờ vậy không thể có dữ liệu được ghi mà không có nhật ký. B-3 thay bằng triển khai thật.
export class PendingAuditPort implements AuditPort {
  async record(): Promise<void> {
    throw new Error('AuditLog chưa được triển khai (B1.2.3-B3): không cho phép ghi dữ liệu khi chưa có nhật ký.');
  }
}
