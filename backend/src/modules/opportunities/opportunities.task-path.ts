import type { Prisma } from '../../generated/prisma/client';
import type { Actor } from '../../common/auth/actor';
// Vị từ ĐỌC của B3 (thuần, không Nest): dùng ĐÚNG hàm của module Hoạt động để "đọc được việc A" ở đây không bao giờ lệch với GET /activities/:id.
import { dbNow, scopeReadWhere, taskAccessWhere } from '../activities/activities.access';
import { accessPath, AccessPath, fullReadWhere, hasAssignedReadCode, readsFull, OppRef, ScopeOf } from './opportunities.access';

// Sales S9a — ĐƯỜNG ĐỌC THEO VIỆC của Kỹ thuật (docs/SALES_DESIGN.md §5.5(d)). KHÔNG lưu quyền riêng: tính lại ở MỌI request, bằng vị từ.
// Người gọi đọc được BẢN KỸ THUẬT của cơ hội O khi TỒN TẠI hoạt động A thoả TẤT CẢ:
//   A.opportunity_id = O; A.type = TASK; A.status = OPEN; A.deleted_at IS NULL; A.performed_by = người gọi;
//   người gọi ĐANG đọc được A theo đúng vị từ B3: trong phạm vi đọc khách (customer.read ∧ activity.read), HOẶC có activity_access của chính A
//   chưa thu hồi, chưa hết hạn, kèm activity.update_own còn hiệu lực;
//   người gọi có opportunity.read_assigned đang hiệu lực; cơ hội và khách chưa xoá mềm.
// Vì là vị từ nên quyền TỰ HẾT khi một điều kiện không còn: việc DONE / CANCELLED / xoá mềm; đổi người làm; activity_access hết hạn / bị thu hồi;
// opportunity_id của việc bị đổi / bỏ; mất vai trò; cơ hội hoặc khách bị xoá mềm.
// KHÔNG dùng ngoại lệ việc nhắc tạm hoãn (§5.5(e)) làm căn cứ: người làm việc nhắc là người phụ trách cơ hội, vốn đã đạt đường đầy đủ.

type Tx = Prisma.TransactionClient;
const NONE: Prisma.OpportunityWhereInput = { id: { in: [] } };
const LIVE: Prisma.OpportunityWhereInput = { deletedAt: null, customer: { is: { deletedAt: null } } };

// now: đồng hồ PostgreSQL (dbNow) — cùng mốc với hạn activity_access của B3.
export function taskPathWhere(actor: Actor, scopeOf: ScopeOf, now: Date): Prisma.OpportunityWhereInput {
  if (!hasAssignedReadCode(scopeOf)) return NONE;
  const readable: Prisma.ActivityWhereInput[] = [scopeReadWhere(actor, scopeOf)];
  const byAccess = taskAccessWhere(actor, scopeOf, now);
  if (byAccess) readable.push(byAccess);
  return { AND: [LIVE, { activities: { some: { type: 'TASK', status: 'OPEN', deletedAt: null, performedById: actor.employeeId, OR: readable } } }] };
}

// Vị từ ĐỌC HỢP NHẤT cho danh sách / đếm / tìm kiếm / theo khách: đạt đường đầy đủ HOẶC đường theo việc. Bộ lọc của người dùng áp SAU.
export function anyReadWhere(actor: Actor, scopeOf: ScopeOf, now: Date): Prisma.OpportunityWhereInput {
  return hasAssignedReadCode(scopeOf) ? { OR: [fullReadWhere(actor, scopeOf), taskPathWhere(actor, scopeOf, now)] } : fullReadWhere(actor, scopeOf);
}

// Người gọi có đạt đường theo việc với MỘT cơ hội không (truy vấn trong transaction / snapshot của nơi gọi).
export async function readsByTask(tx: Tx, actor: Actor, scopeOf: ScopeOf, opportunityId: string): Promise<boolean> {
  if (!hasAssignedReadCode(scopeOf)) return false;
  const now = await dbNow(tx);
  return (await tx.opportunity.findFirst({ where: { AND: [{ id: opportunityId }, taskPathWhere(actor, scopeOf, now)] }, select: { id: true } })) !== null;
}

// Đường truy cập của người gọi với một cơ hội đã nạp: FULL (đầy đủ) thắng TASK (bản kỹ thuật); null = không thấy (404).
export async function resolvePath(tx: Tx, actor: Actor, scopeOf: ScopeOf, opportunityId: string, ref: OppRef): Promise<AccessPath | null> {
  const full = readsFull(actor, scopeOf, ref);
  return accessPath(full, full ? false : await readsByTask(tx, actor, scopeOf, opportunityId));
}
