import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';

// B3 A6 — GIAO DIỆN EXPORT của module activities cho module customers (Modular Monolith: customers chỉ dùng lớp này, không import nội bộ khác).
// Thiết kế §5 / §5.4: xoá mềm khách => thu hồi MỌI quyền theo việc trên các hoạt động của khách (CUSTOMER_DELETED) và rút đề xuất chuyển đang chờ
// (WITHDRAWN) — trong CÙNG transaction với việc xoá khách (tx do CustomersService truyền vào), có nhật ký cho từng dòng.
export const ACTIVITY_CUSTOMER_HOOKS = Symbol('ACTIVITY_CUSTOMER_HOOKS');
export interface ActivityCustomerHooksPort {
  onCustomerSoftDeleted(tx: Prisma.TransactionClient, customerId: string, actorId: string, requestId?: string): Promise<{ revoked: number; withdrawn: number }>;
}

@Injectable()
export class ActivityCustomerHooks implements ActivityCustomerHooksPort {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort) {}

  async onCustomerSoftDeleted(tx: Prisma.TransactionClient, customerId: string, actorId: string, requestId?: string): Promise<{ revoked: number; withdrawn: number }> {
    const revoked = await tx.$queryRaw<{ employee_id: string; activity_id: string; code: string; reason: string }[]>`
      UPDATE activity_access aa SET revoked_at = now(), revoked_by = ${actorId}::uuid,
        revoke_reason = (CASE WHEN aa.expires_at <= now() THEN 'EXPIRED' ELSE 'CUSTOMER_DELETED' END)::activity_access_revoke_reason
      FROM activity a
      WHERE aa.activity_id = a.id AND a.customer_id = ${customerId}::uuid AND aa.revoked_at IS NULL
      RETURNING aa.employee_id, aa.activity_id, a.code, aa.revoke_reason::text AS reason`;
    for (const r of revoked) {
      await this.audit.record(tx, {
        action: 'activity.access_revoke', entityType: 'activity', entityId: r.activity_id, entityCode: r.code,
        summary: 'Thu hồi quyền theo việc ' + r.code + ' (' + r.reason + ')', changes: { employeeId: r.employee_id, revokeReason: r.reason },
        actorEmployeeId: actorId, requestId,
      });
    }
    const withdrawn = await tx.$queryRaw<{ id: string; activity_id: string; code: string }[]>`
      UPDATE activity_transfer_request t SET status = 'WITHDRAWN', decided_by = ${actorId}::uuid, decided_at = now()
      FROM activity a
      WHERE t.activity_id = a.id AND a.customer_id = ${customerId}::uuid AND t.status = 'PENDING'
      RETURNING t.id, t.activity_id, a.code`;
    for (const r of withdrawn) {
      await this.audit.record(tx, {
        action: 'activity.transfer_withdraw', entityType: 'activity', entityId: r.activity_id, entityCode: r.code,
        summary: 'Tự rút đề xuất chuyển việc ' + r.code + ' (khách hàng bị xoá)', changes: { transferRequestId: r.id, status: ['PENDING', 'WITHDRAWN'], auto: true },
        actorEmployeeId: actorId, requestId,
      });
    }
    return { revoked: revoked.length, withdrawn: withdrawn.length };
  }
}
