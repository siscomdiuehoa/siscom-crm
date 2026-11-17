import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { ASSIGNEE_ELIGIBILITY, AssigneeEligibility } from '../../common/auth/assignee-eligibility';
import { inScope } from '../../common/auth/scope';
import { PrismaService } from '../../prisma/prisma.service';
import {
  accessPath, deletedListWhere, fullReadWhere, hasAssignedReadCode, ownerLostAccess, readsFull, ScopeOf, seesOwnerLostFlag,
} from './opportunities.access';
import { OPP_EMPLOYEE_ACCESS, OppEmployeeAccessReader } from './opportunities.employee-access';
import { opportunityErrors } from './opportunities.errors';
import {
  ContactCard, CustomerCard, OPP_DETAIL_SELECT, OPP_LIST_SELECT, OppDetailRow, OppListRow, oppRef, toOpportunityDetail, toOpportunityListItem,
} from './opportunities.mapper';
import type { QueryOpportunitiesDto } from './dto/query-opportunities.dto';

type Tx = Prisma.TransactionClient;
const MAX_OFFSET_WINDOW = 100000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
// Ngày kiểu YYYY-MM-DD cho cột DATE (không múi giờ). Ngày không có thật (2026-02-30) hoặc ngoài khoảng năm => null.
function parseYmd(v: string): Date | null {
  const d = new Date(v + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const y = d.getUTCFullYear();
  return y < MIN_YEAR || y > MAX_YEAR ? null : d;
}

// Sales S6 (docs/SALES_DESIGN.md §5.1, §5.4, §7) — ĐỌC cơ hội: danh sách, chi tiết, theo khách. Chỉ ĐƯỜNG ĐỌC ĐẦY ĐỦ (opportunity.read).
// Quy tắc: không có mã đọc nào => 403; ngoài phạm vi xem => 404 (không lộ tồn tại); mọi bộ lọc áp SAU vị từ phạm vi.
// MỘT vị từ cho mọi đường đọc: fullReadWhere (danh sách, đếm, tìm kiếm, theo khách) và readsFull (chi tiết) — cùng nguồn opportunities.access.
// CHƯA có ở S6 (có chủ đích): đường đọc theo việc của Kỹ thuật (§5.5(d), S9) — người chỉ có opportunity.read_assigned nhận danh sách rỗng và
// 404 ở chi tiết; lịch sử thay đổi /changes (S7); tổng giá trị theo cột kanban (S11).
@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(OPP_EMPLOYEE_ACCESS) private readonly access: OppEmployeeAccessReader,
    @Inject(ASSIGNEE_ELIGIBILITY) private readonly eligibility: AssigneeEligibility,
  ) {}

  private scopeOf(actor: Actor): ScopeOf { return (p) => this.actors.scopeFor(actor, p); }
  // Có ít nhất một mã đọc đang hiệu lực (đường đầy đủ hoặc đường theo việc). Không có => 403.
  private needAnyRead(scopeOf: ScopeOf): void {
    if (scopeOf('opportunity.read') === null && !hasAssignedReadCode(scopeOf)) throw opportunityErrors.forbidden('Không có quyền xem cơ hội.');
  }

  // Cờ ownerLostAccess cho một nhóm cơ hội: CHỈ tính khi người gọi có opportunity.assign đang hiệu lực (§5.4); người khác không nhận khoá này.
  private async ownerFlags(scopeOf: ScopeOf, rows: readonly OppListRow[]): Promise<(r: OppListRow) => boolean | undefined> {
    if (!seesOwnerLostFlag(scopeOf) || rows.length === 0) return () => undefined;
    const ids = [...new Set(rows.map((r) => r.ownerId))];
    const [acc, can] = await Promise.all([this.access.load(this.prisma, ids), this.eligibility.canSignIn(ids)]);
    return (r) => ownerLostAccess(oppRef(r), acc.get(r.ownerId), can.get(r.ownerId) === true);
  }

  // ───── GET /opportunities · GET /customers/:customerId/opportunities ─────
  async list(ctx: RequestCtx, q: QueryOpportunitiesDto, customerId?: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const errs: string[] = [];
    if (page * pageSize > MAX_OFFSET_WINDOW) errs.push('page × pageSize vượt quá ' + MAX_OFFSET_WINDOW + '.');
    const from = q.closeFrom === undefined ? undefined : parseYmd(q.closeFrom);
    const to = q.closeTo === undefined ? undefined : parseYmd(q.closeTo);
    if (from === null) errs.push('closeFrom không phải ngày hợp lệ (năm ' + MIN_YEAR + '–' + MAX_YEAR + ').');
    if (to === null) errs.push('closeTo không phải ngày hợp lệ (năm ' + MIN_YEAR + '–' + MAX_YEAR + ').');
    if (from && to && from > to) errs.push('closeFrom phải không sau closeTo.');
    const search = q.q === undefined ? undefined : q.q.trim();
    if (search !== undefined && search.length < 2) errs.push('Từ khoá tìm kiếm cần ít nhất 2 ký tự.');
    if (errs.length) throw opportunityErrors.validation(errs);

    const deletedOnly = q.deleted === 'only';
    // Vị từ phạm vi LUÔN đứng đầu; bộ lọc của người dùng chỉ thu hẹp thêm.
    const and: Prisma.OpportunityWhereInput[] = [deletedOnly ? deletedListWhere(actor, scopeOf) : fullReadWhere(actor, scopeOf)];
    const cust = customerId ?? q.customerId;
    if (cust) and.push({ customerId: cust });
    if (q.status) and.push({ status: q.status });
    if (q.stageId) and.push({ stageId: q.stageId });
    if (q.typeId) and.push({ typeId: q.typeId });
    if (q.ownerId) and.push({ ownerId: q.ownerId });
    if (from || to) and.push({ expectedCloseDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    // Giới hạn S6: tìm CHỨA trên tiêu đề / tên dự án. Không phân biệt hoa thường chỉ chắc chắn với chữ không dấu (ASCII); chữ có dấu tuỳ collation
    // của DB và CHƯA bỏ dấu (tìm khách hàng dùng cột đã gập dấu + chỉ mục trigram — cơ hội chưa có; đề xuất làm ở PR sau).
    if (search) and.push({ OR: [{ title: { contains: search, mode: 'insensitive' } }, { projectName: { contains: search, mode: 'insensitive' } }] });
    const where: Prisma.OpportunityWhereInput = { AND: and };

    const order = q.sortOrder ?? 'desc';
    const orderBy: Prisma.OpportunityOrderByWithRelationInput[] = q.sortBy === 'expectedCloseDate'
      ? [{ expectedCloseDate: { sort: order, nulls: 'last' } }, { code: 'desc' }]
      : q.sortBy === 'code' ? [{ code: order }]
        : q.sortBy === 'createdAt' ? [{ createdAt: order }, { code: order }]
          : [{ updatedAt: order }, { code: order }];
    const { total, rows } = await this.prisma.$transaction(async (tx: Tx) => {
      const total = await tx.opportunity.count({ where });
      const rows = total === 0 ? [] : await tx.opportunity.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: OPP_LIST_SELECT });
      return { total, rows: rows as OppListRow[] };
    });
    // Cơ hội đã xoá: không tính cờ người phụ trách (mọi đường đọc qua cơ hội đang tắt).
    const flag = deletedOnly ? () => undefined : await this.ownerFlags(scopeOf, rows);
    return { items: rows.map((r) => toOpportunityListItem(r, flag(r))), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  // Tab "Cơ hội" của khách. Người phụ trách cơ hội mà KHÔNG phụ trách khách chỉ thấy cơ hội của mình ở khách đó [C5] — vì cùng vị từ với danh sách.
  // 404 khi khách không tồn tại / đã xoá, hoặc khi người gọi không đọc được khách VÀ không thấy cơ hội nào của khách đó (không lộ tồn tại).
  async listByCustomer(ctx: RequestCtx, customerId: string, q: QueryOpportunitiesDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    if (q.deleted !== undefined) throw opportunityErrors.validation(['deleted không dùng được ở đường theo khách.']);
    if (q.customerId !== undefined) throw opportunityErrors.validation(['customerId lấy từ đường dẫn, không gửi kèm trong truy vấn.']);
    const c = await this.prisma.customer.findFirst({ where: { id: customerId }, select: { deletedAt: true, ownerId: true, owner: { select: { departmentId: true } } } });
    if (!c || c.deletedAt !== null) throw opportunityErrors.customerNotFound();
    const result = await this.list(ctx, q, customerId);
    const readsCustomer = inScope(actor, scopeOf('customer.read'), { ownerId: c.ownerId, ownerDepartmentId: c.owner ? c.owner.departmentId : null });
    if (!readsCustomer) {
      // Không đọc được khách: chỉ được ở lại nếu thấy ÍT NHẤT MỘT cơ hội của khách này (đếm KHÔNG kèm bộ lọc của người dùng).
      const visible = result.total > 0 || (await this.prisma.opportunity.findFirst({ where: { AND: [fullReadWhere(actor, scopeOf), { customerId }] }, select: { id: true } })) !== null;
      if (!visible) throw opportunityErrors.customerNotFound();
    }
    return result;
  }

  // ───── GET /opportunities/:id ─────
  async detail(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    // Nạp QUA vị từ phạm vi (cùng điều kiện với danh sách) rồi kiểm lại bằng hàm thuần — hai lớp cùng nguồn, không lớp nào bỏ qua.
    const row = (await this.prisma.opportunity.findFirst({ where: { AND: [{ id }, fullReadWhere(actor, scopeOf)] }, select: OPP_DETAIL_SELECT })) as OppDetailRow | null;
    const path = row ? accessPath(readsFull(actor, scopeOf, oppRef(row)), false /* đường theo việc: S9 */) : null;
    if (!row || path !== 'FULL') throw opportunityErrors.notFound();

    const c = await this.prisma.customer.findUniqueOrThrow({
      where: { id: row.customer.id },
      select: { id: true, code: true, name: true, shortName: true, address: true, phone: true, province: { select: { labelVi: true } } },
    });
    const customer: CustomerCard = { id: c.id, code: c.code, name: c.name, shortName: c.shortName, address: c.address, provinceName: c.province ? c.province.labelVi : null, phone: c.phone };
    const customerReadable = inScope(actor, scopeOf('customer.read'), { ownerId: row.customer.ownerId, ownerDepartmentId: row.customer.owner ? row.customer.owner.departmentId : null });
    // Người liên hệ CỦA CHÍNH cơ hội (tối thiểu); liên hệ đã xoá mềm => không trả.
    const ct = row.contactId
      ? await this.prisma.contact.findFirst({ where: { id: row.contactId, deletedAt: null }, select: { id: true, code: true, fullName: true, title: true, phone: true } })
      : null;
    const contact: ContactCard | null = ct ? { id: ct.id, code: ct.code, fullName: ct.fullName, title: ct.title, phone: ct.phone } : null;
    const flag = await this.ownerFlags(scopeOf, [row]);
    return toOpportunityDetail(row, { customer, customerReadable, contact, ownerLostAccess: flag(row) });
  }
}
