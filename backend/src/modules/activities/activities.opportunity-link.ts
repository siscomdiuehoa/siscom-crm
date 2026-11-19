import type { Prisma } from '../../generated/prisma/client';
import type { Actor } from '../../common/auth/actor';
// Vị từ THUẦN của Sales — một nguồn duy nhất cho "thấy được cơ hội" và "đạt opportunity.update trên cơ hội".
import { assertWrite, OppRef, ScopeOf } from '../opportunities/opportunities.access';
import { opportunityErrors } from '../opportunities/opportunities.errors';
import { resolvePath } from '../opportunities/opportunities.task-path';
import { activityErrors } from './activities.errors';

type Tx = Prisma.TransactionClient;

// Sales S9a — §5.5(c): GẮN / ĐỔI / BỎ opportunityId của một hoạt động qua API Hoạt động chung. Ngoài kiểm B3 như cũ (nơi gọi đã làm), với TỪNG
// cơ hội liên quan (cũ và mới): không thấy được => 404 OPPORTUNITY_NOT_FOUND; thấy được nhưng không đạt opportunity.update => 403; cơ hội thuộc
// khách khác => 400. "Cùng khách" là CHƯA đủ: người phụ trách khách chỉ-đọc một cơ hội KHÔNG gắn được việc vào đó (gắn việc là mở đường đọc cơ
// hội cho người làm việc). Thứ tự kiểm: thấy được -> quyền sửa -> cùng khách (không lộ cơ hội của khách khác cho người không thấy nó).
// Khoá dòng cơ hội FOR SHARE tới hết transaction: người phụ trách / xoá mềm không đổi giữa lúc kiểm và lúc ghi. Thứ tự khoá toàn hệ thống:
// khách -> (hoạt động) -> cơ hội ở đây; khách -> cơ hội -> việc TỰ SINH ở service Sales. Không vòng chờ vì việc tự sinh không đổi được cơ hội
// (nơi gọi từ chối TRƯỚC khi vào hàm này).
export async function assertOpportunityLink(tx: Tx, actor: Actor, scopeOf: ScopeOf, opportunityId: string, customerId: string): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity WHERE id = ${opportunityId}::uuid FOR SHARE`;
  const row = locked.length
    ? await tx.opportunity.findFirst({ where: { id: opportunityId }, select: { customerId: true, ownerId: true, deletedAt: true, customer: { select: { ownerId: true, deletedAt: true } } } })
    : null;
  if (!row) throw opportunityErrors.notFound();
  const ref: OppRef = { ownerId: row.ownerId, deletedAt: row.deletedAt, customer: { ownerId: row.customer.ownerId, deletedAt: row.customer.deletedAt } };
  assertWrite(actor, scopeOf, 'opportunity.update', ref, await resolvePath(tx, actor, scopeOf, opportunityId, ref));
  if (row.customerId !== customerId) throw activityErrors.opportunityMismatch();
}
