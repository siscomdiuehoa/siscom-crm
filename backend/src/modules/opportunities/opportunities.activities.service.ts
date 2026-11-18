import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { inScope } from '../../common/auth/scope';
import { PrismaService } from '../../prisma/prisma.service';
import { dbNow, ownerInfo, scopeReadWhere, taskAccessWhere } from '../activities/activities.access';
import { ACTIVITY_SELECT, ActivityRow, toActivity } from '../activities/activities.mapper';
import { OPPORTUNITY_ACTIVITIES, OpportunityActivityGate } from '../activities/activities.opportunity-gate';
import type { CreateActivityDto } from '../activities/dto/create-activity.dto';
import { hasAssignedReadCode, readsFull, ScopeOf } from './opportunities.access';
import { opportunityErrors } from './opportunities.errors';
import { anyReadWhere } from './opportunities.task-path';
import { OpportunityWritesService } from './opportunities.write.service';
import type { QueryOpportunityActivitiesDto } from './dto/query-opportunity-activities.dto';

type Tx = Prisma.TransactionClient;
const MAX_OFFSET_WINDOW = 100000;
const SELECT = { ...ACTIVITY_SELECT, opportunityAutoKind: true } as const;
type Row = ActivityRow & { opportunityAutoKind: string | null };

// Sales S9a (docs/SALES_DESIGN.md §5.5(a)(b)) — hoạt động THEO CƠ HỘI. Đây là đường của người phụ trách cơ hội KHÔNG phụ trách khách: phạm vi bó
// trong đúng MỘT cơ hội; không mở timeline khách, hoạt động không gắn cơ hội, hay cơ hội khác của khách. API Hoạt động chung không đổi.
// Sales KHÔNG có endpoint chi tiết hoạt động riêng: chi tiết luôn qua GET /activities/:id của B3.
@Injectable()
export class OpportunityActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    private readonly writes: OpportunityWritesService,
    @Inject(OPPORTUNITY_ACTIVITIES) private readonly gate: OpportunityActivityGate,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }

  // ───── GET /opportunities/:id/activities ─────
  // CHỈ hoạt động có opportunity_id = cơ hội đó và chưa xoá mềm. Bộ lọc theo ĐƯỜNG TRUY CẬP của người gọi với cơ hội:
  //  - đường đầy đủ => mọi hoạt động của cơ hội;
  //  - CHỈ đường theo việc => quyền với cơ hội KHÔNG thay cho quyền với từng việc: mỗi dòng phải có performed_by = người gọi VÀ người gọi đang
  //    đọc được CHÍNH dòng đó theo vị từ đọc của B3 (trong phạm vi đọc khách, hoặc activity_access của chính dòng đó còn hiệu lực kèm
  //    activity.update_own). Việc A còn hiệu lực chỉ mở đường tới cơ hội; nó không cho đọc việc B mà B3 đã từ chối.
  // Bộ lọc nằm TRONG điều kiện truy vấn, trước khi đếm và phân trang. Một snapshot REPEATABLE READ cho cả request (như các đường đọc khác).
  async list(ctx: RequestCtx, id: string, q: QueryOpportunityActivitiesDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('opportunity.read') === null && !hasAssignedReadCode(scopeOf)) throw opportunityErrors.forbidden('Không có quyền xem cơ hội.');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    if (page * pageSize > MAX_OFFSET_WINDOW) throw opportunityErrors.validation(['page × pageSize vượt quá ' + MAX_OFFSET_WINDOW + '.']);
    return this.prisma.$transaction(async (tx: Tx) => {
      const now = await dbNow(tx);
      const opp = await tx.opportunity.findFirst({
        where: { AND: [{ id }, anyReadWhere(actor, scopeOf, now)] },
        select: { id: true, ownerId: true, deletedAt: true, customer: { select: { ownerId: true, deletedAt: true, owner: { select: { departmentId: true } } } } },
      });
      if (!opp) throw opportunityErrors.notFound();
      const full = readsFull(actor, scopeOf, opp);
      const and: Prisma.ActivityWhereInput[] = [{ opportunityId: id, deletedAt: null }];
      if (!full) {
        const readable: Prisma.ActivityWhereInput[] = [scopeReadWhere(actor, scopeOf)];
        const byAccess = taskAccessWhere(actor, scopeOf, now);
        if (byAccess) readable.push(byAccess);
        and.push({ performedById: actor.employeeId, OR: readable });
      }
      if (q.type) and.push({ type: q.type });
      if (q.status) and.push({ status: q.status });
      const where: Prisma.ActivityWhereInput = { AND: and };
      const order = q.sortOrder ?? 'desc';
      const total = await tx.activity.count({ where });
      const rows = (total === 0 ? [] : await tx.activity.findMany({ where, orderBy: [{ occurredAt: order }, { code: order }], skip: (page - 1) * pageSize, take: pageSize, select: SELECT })) as Row[];
      // Người liên hệ của hoạt động: chỉ khi đạt đường đầy đủ VÀ có contact.read trong phạm vi chủ khách (như B3). Đường theo việc: không bao giờ.
      const showContact = full && inScope(actor, scopeOf('contact.read'), ownerInfo(opp.customer));
      const items = rows.map((r) => { const a = toActivity(r); return { ...a, contact: showContact ? a.contact : null, autoKind: r.opportunityAutoKind }; });
      return { items, access: full ? ('FULL' as const) : ('TASK' as const), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
  }

  // ───── POST /opportunities/:id/activities ─────
  // Hoạt động luôn gắn opportunity_id = cơ hội đó và customer_id = khách của cơ hội. Ba kiểm độc lập (§5.5(b)):
  //  1. cơ hội: người gọi đạt opportunity.update (loadForWrite: khoá khách FOR SHARE -> cơ hội FOR UPDATE; không thấy => 404, thiếu quyền => 403);
  //  2. + 3. mã hoạt động và người nhận: OpportunityActivityGate (module Hoạt động), cùng transaction.
  async create(ctx: RequestCtx, id: string, dto: CreateActivityDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    return this.writes.inTx(async (tx) => {
      const row = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.update');
      return this.gate.createForOpportunity(tx, ctx, { id: row.id, customerId: row.customerId, contactId: row.contactId }, dto);
    });
  }
}
