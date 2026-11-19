import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { AUDIT_REDACTED_TEXT } from '../../common/audit/db-audit.port';
import { PrismaService } from '../../prisma/prisma.service';
import { dbNow } from '../activities/activities.access';
import { hasAssignedReadCode, readsFull, ScopeOf } from './opportunities.access';
import { opportunityErrors } from './opportunities.errors';
import { anyReadWhere } from './opportunities.task-path';
import { OpportunityWritesService } from './opportunities.write.service';
import type { AddOpportunityDocumentDto, DeleteOpportunityDocumentDto } from './dto/opportunity-document.dto';

type Tx = Prisma.TransactionClient;
const MAX_ACTIVE_DOCUMENTS = 200;
const DOC_SELECT = { id: true, kind: true, fileName: true, url: true, createdAt: true, createdBy: { select: { id: true, code: true, fullName: true } } } as const;
interface DocRow { id: string; kind: string; fileName: string; url: string; createdAt: Date; createdBy: { id: string; code: string; fullName: string } }
const toDocument = (r: DocRow) => ({ id: r.id, kind: r.kind, fileName: r.fileName, url: r.url, createdAt: r.createdAt.toISOString(), createdBy: { id: r.createdBy.id, code: r.createdBy.code, fullName: r.createdBy.fullName } });

// Sales S9b (docs/SALES_DESIGN.md §6.14 [C10]) — TÀI LIỆU CƠ HỘI: chỉ đường dẫn https + tên tệp. Chỉ thêm / xoá mềm, không sửa (DB cũng chặn).
// Quyền XEM theo ĐƯỜNG TRUY CẬP của người gọi với cơ hội (§5.4), không theo tên vai trò:
//   - đường đầy đủ => TECHNICAL + COMMERCIAL;
//   - CHỈ đường theo việc (Kỹ thuật) => CHỈ TECHNICAL — điều kiện kind nằm TRONG where, không lọc sau khi đọc.
// Thêm / xoá mềm: người đạt opportunity.update trên cơ hội (loadForWrite: khoá khách FOR SHARE -> cơ hội FOR UPDATE; không thấy => 404, thiếu quyền => 403).
// Nhật ký chung KHÔNG mang tên tệp, đường dẫn, lý do (tên tệp có thể chứa giá trị / tên dự án) — chỉ id tài liệu + loại.
@Injectable()
export class OpportunityDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly writes: OpportunityWritesService,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }

  // ───── GET /opportunities/:id/documents ─────
  async list(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    if (scopeOf('opportunity.read') === null && !hasAssignedReadCode(scopeOf)) throw opportunityErrors.forbidden('Không có quyền xem cơ hội.');
    return this.prisma.$transaction(async (tx: Tx) => {
      const opp = await tx.opportunity.findFirst({
        where: { AND: [{ id }, anyReadWhere(actor, scopeOf, await dbNow(tx))] },
        select: { id: true, ownerId: true, deletedAt: true, customer: { select: { ownerId: true, deletedAt: true } } },
      });
      if (!opp) throw opportunityErrors.notFound();
      const full = readsFull(actor, scopeOf, opp);
      const where: Prisma.OpportunityDocumentWhereInput = { opportunityId: id, deletedAt: null, ...(full ? {} : { kind: 'TECHNICAL' }) };
      const rows = (await tx.opportunityDocument.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_ACTIVE_DOCUMENTS, select: DOC_SELECT })) as DocRow[];
      return { items: rows.map(toDocument), access: full ? ('FULL' as const) : ('TASK' as const) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
  }

  // ───── POST /opportunities/:id/documents ─────
  async add(ctx: RequestCtx, id: string, dto: AddOpportunityDocumentDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    return this.writes.inTx(async (tx) => {
      const opp = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.update');
      // Dòng cơ hội đang khoá FOR UPDATE => đếm và thêm không đua với yêu cầu thêm khác của cùng cơ hội.
      if ((await tx.opportunityDocument.count({ where: { opportunityId: id, deletedAt: null } })) >= MAX_ACTIVE_DOCUMENTS) throw opportunityErrors.documentLimit(MAX_ACTIVE_DOCUMENTS);
      const row = (await tx.opportunityDocument.create({ data: { opportunityId: id, kind: dto.kind, fileName: dto.fileName, url: dto.url, createdById: actor.employeeId }, select: DOC_SELECT })) as DocRow;
      await this.audit.record(tx, {
        action: 'opportunity.document_add', entityType: 'opportunity', entityId: id, entityCode: opp.code, summary: 'Thêm tài liệu (' + dto.kind + ') cho cơ hội ' + opp.code,
        changes: { documentId: [null, row.id], kind: [null, dto.kind], fileName: AUDIT_REDACTED_TEXT, url: AUDIT_REDACTED_TEXT }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return toDocument(row);
    });
  }

  // ───── DELETE /opportunities/:id/documents/:docId ─────
  async remove(ctx: RequestCtx, id: string, docId: string, dto: DeleteOpportunityDocumentDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    return this.writes.inTx(async (tx) => {
      const opp = await this.writes.loadForWrite(tx, actor, scopeOf, id, 'opportunity.update');
      // Tài liệu phải thuộc ĐÚNG cơ hội trên đường dẫn và chưa xoá; khác => 404 (không lộ tài liệu của cơ hội khác).
      const doc = await tx.opportunityDocument.findFirst({ where: { id: docId, opportunityId: id, deletedAt: null }, select: { id: true, kind: true } });
      if (!doc) throw opportunityErrors.documentNotFound();
      const upd = await tx.opportunityDocument.updateMany({ where: { id: docId, opportunityId: id, deletedAt: null }, data: { deletedAt: new Date(), deletedById: actor.employeeId, deleteReason: dto.reason } });
      if (upd.count !== 1) throw opportunityErrors.documentNotFound();
      await this.audit.record(tx, {
        action: 'opportunity.document_delete', entityType: 'opportunity', entityId: id, entityCode: opp.code, summary: 'Xoá mềm tài liệu (' + doc.kind + ') của cơ hội ' + opp.code,
        changes: { documentId: [doc.id, null], kind: [doc.kind, null], reason: AUDIT_REDACTED_TEXT }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId,
      });
      return { id: doc.id, deleted: true as const };
    });
  }
}
