import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { ASSIGNEE_ELIGIBILITY, AssigneeEligibility } from '../../common/auth/assignee-eligibility';
import { PrismaService } from '../../prisma/prisma.service';
import { OPPORTUNITY_AUTO_TASKS, OpportunityAutoTasks } from '../activities/activities.opportunity-tasks';
import { SALES_LOOKUP_TYPES } from '../lookups/sales.catalog';
import { assigneeRefusal, ScopeOf } from './opportunities.access';
import { OPP_EMPLOYEE_ACCESS, OppEmployeeAccessReader } from './opportunities.employee-access';
import { opportunityErrors } from './opportunities.errors';
import { defaultProbability, isConstructionType, lostReasonNeedsNote } from './opportunities.rules';
import { OpportunityWritesService } from './opportunities.write.service';

type Tx = Prisma.TransactionClient;
export const OWNER_CANDIDATES_MAX = 500;

// Sales S10a — CÁC LỰA CHỌN mà giao diện cần để gọi được API ghi đã có (docs/SALES_DESIGN.md §7, §8.3). CHỈ ĐỌC, không ghi bảng nào, không SQL thô.
//  - meta: giai đoạn / loại / lý do thua kèm ID (API ghi nhận typeId, stageId, lostReasonId là uuid; GET /lookups không trả id và không mở các
//    danh mục Sales). Kèm quy tắc theo MÃ mà biểu mẫu phải thể hiện: xác suất mặc định của giai đoạn, loại bắt buộc gắn dự án (R-S3), lý do thua
//    bắt buộc ghi chú. Đây chỉ là gợi ý hiển thị — máy chủ vẫn kiểm lại mọi quy tắc khi ghi.
//  - ownerCandidates: người CÓ THỂ nhận khi chuyển người phụ trách — lọc bằng CHÍNH assigneeRefusal của POST /assign (§5.4), nên người không đủ
//    điều kiện (không ACTIVE, tài khoản không dùng được, thiếu quyền, khác phòng) không xuất hiện; danh sách không nói ai bị loại vì sao.
//  - handoverCandidates: người CÓ THỂ nhận việc "Bàn giao thực hiện" khi Thắng — lọc bằng CHÍNH điều kiện của createHandover (§6.5).
// Quyền: meta cần opportunity.read (mọi phạm vi) — bản kỹ thuật (chỉ read_assigned) không dùng tới. Hai danh sách ứng viên kiểm ĐÚNG mã của thao
// tác tương ứng trên ĐÚNG cơ hội (peekForWrite: không thấy => 404, thiếu mã / ngoài điều kiện => 403) — ai không được chuyển / chốt thì không xem
// được danh sách. Mỗi request đọc trong MỘT snapshot REPEATABLE READ (cùng mẫu service đọc). Chỉ trả id, mã, họ tên, mã phòng.
@Injectable()
export class OpportunityChoicesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(OPP_EMPLOYEE_ACCESS) private readonly access: OppEmployeeAccessReader,
    @Inject(ASSIGNEE_ELIGIBILITY) private readonly eligibility: AssigneeEligibility,
    private readonly writes: OpportunityWritesService,
    @Inject(OPPORTUNITY_AUTO_TASKS) private readonly tasks: OpportunityAutoTasks,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }
  private snapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
  }

  // GET /opportunities/meta
  async meta(ctx: RequestCtx) {
    const scopeOf = this.scopeOf(ctx.actor);
    if (scopeOf('opportunity.read') === null) throw opportunityErrors.forbidden('Không có quyền xem danh mục cơ hội.');
    return this.snapshot(async (tx) => {
      const rows = await tx.lookupItem.findMany({
        where: { type: { in: [...SALES_LOOKUP_TYPES] }, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { labelVi: 'asc' }],
        select: { id: true, type: true, code: true, labelVi: true },
      });
      const of = (type: string) => rows.filter((r) => r.type === type);
      return {
        // Giai đoạn mà mã nguồn không biết xác suất mặc định (thêm tay ở DB) bị service ghi từ chối => không đưa ra làm lựa chọn.
        stages: of('opportunity_stage').filter((r) => defaultProbability(r.code) !== undefined)
          .map((r) => ({ id: r.id, code: r.code, label: r.labelVi, defaultProbability: defaultProbability(r.code) as number })),
        types: of('opportunity_type').map((r) => ({ id: r.id, code: r.code, label: r.labelVi, requiresProject: isConstructionType(r.code) })),
        lostReasons: of('opportunity_lost_reason').map((r) => ({ id: r.id, code: r.code, label: r.labelVi, requiresNote: lostReasonNeedsNote(r.code) })),
      };
    });
  }

  // GET /opportunities/:id/owner-candidates
  async ownerCandidates(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    return this.snapshot(async (tx) => {
      const row = await this.writes.peekForWrite(tx, actor, scopeOf, id, 'opportunity.assign');
      const owner = (await this.access.load(tx, [row.ownerId])).get(row.ownerId);
      const anyDepartment = scopeOf('opportunity.assign') === 'ALL';
      const departmentId = owner ? owner.departmentId : null;
      // Người chuyển không có phạm vi ALL: chỉ chuyển trong phòng của người phụ trách hiện tại; phòng chưa xác định => không ai nhận được (§5.4).
      if (!anyDepartment && departmentId === null) return { items: [], truncated: false };
      const rows = await tx.employee.findMany({
        where: { status: 'ACTIVE', deletedAt: null, id: { not: row.ownerId }, ...(anyDepartment ? {} : { departmentId }) },
        select: { id: true, code: true, fullName: true, department: { select: { code: true } } },
        orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
      });
      const ids = rows.map((r) => r.id);
      const [acc, can] = await Promise.all([this.access.load(tx, ids), this.eligibility.canSignIn(ids)]);
      const ok = rows.filter((r) => assigneeRefusal(scopeOf, owner, acc.get(r.id), can.get(r.id) === true) === null);
      const items = ok.slice(0, OWNER_CANDIDATES_MAX).map((r) => ({ id: r.id, code: r.code, fullName: r.fullName, departmentCode: r.department ? r.department.code : null }));
      // T-09: bị cắt ở OWNER_CANDIDATES_MAX => truncated = true (không cắt âm thầm).
      return { items, truncated: ok.length > OWNER_CANDIDATES_MAX };
    });
  }

  // GET /opportunities/:id/handover-candidates
  async handoverCandidates(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    return this.snapshot(async (tx) => {
      const row = await this.writes.peekForWrite(tx, actor, scopeOf, id, 'opportunity.close');
      return this.tasks.handoverCandidates(tx, { ownerId: row.customer.ownerId, ownerDepartmentId: row.customer.owner ? row.customer.owner.departmentId : null });
    });
  }
}
