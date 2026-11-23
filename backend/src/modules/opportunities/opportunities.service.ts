import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { ASSIGNEE_ELIGIBILITY, AssigneeEligibility } from '../../common/auth/assignee-eligibility';
import { inScope } from '../../common/auth/scope';
import { PrismaService } from '../../prisma/prisma.service';
import { dbNow } from '../activities/activities.access';
import {
  deletedListWhere, hasAssignedReadCode, ownerLostAccess, readsFull, ScopeOf, seesOwnerLostFlag,
} from './opportunities.access';
import { anyReadWhere, listReadWhere, resolvePath } from './opportunities.task-path';
import { OPP_EMPLOYEE_ACCESS, OppEmployeeAccessReader } from './opportunities.employee-access';
import { opportunityErrors } from './opportunities.errors';
import {
  ContactCard, CustomerCard, OPP_DETAIL_SELECT, OPP_LIST_SELECT, OppDetailRow, OppListRow, oppRef, toOpportunityDetail, toOpportunityListItem,
  toOpportunityTechDetail, toOpportunityTechListItem,
} from './opportunities.mapper';
import { foldedTextWhere, foldSearch } from './opportunities.search';
import type { QueryOpportunitiesDto } from './dto/query-opportunities.dto';
import type { QueryBoardSummaryDto } from './dto/query-board-summary.dto';
import type { QueryOpportunityChangesDto } from './dto/query-opportunity-changes.dto';

type Tx = Prisma.TransactionClient;
const MAX_OFFSET_WINDOW = 100000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
// T-02: lịch sử thay đổi phân trang (mới nhất trước) — mặc định 50, tối đa 100 dòng / trang (DTO kiểm), cùng giới hạn cửa sổ offset với danh sách.
const CHANGES_PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ngày kiểu YYYY-MM-DD cho cột DATE (không múi giờ). Ngày không có thật (2026-02-30) hoặc ngoài khoảng năm => null.
function parseYmd(v: string): Date | null {
  const d = new Date(v + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const y = d.getUTCFullYear();
  return y < MIN_YEAR || y > MAX_YEAR ? null : d;
}
// Tham số đã kiểm hợp lệ của một lần đọc danh sách (dựng TRƯỚC khi mở transaction).
// fullOnly: yêu cầu có bộ lọc trên trường mà bản kỹ thuật KHÔNG được thấy (status, ownerId) => chỉ xét dòng đạt đường đầy đủ (L-01).
// search: từ khoá đã trim (≥ 2 ký tự); được GẬP DẤU trong transaction đọc (listIn) rồi mới thành điều kiện (T-07).
interface ListPlan { page: number; pageSize: number; deletedOnly: boolean; fullOnly: boolean; search?: string; filters: Prisma.OpportunityWhereInput[]; orderBy: Prisma.OpportunityOrderByWithRelationInput[] }

// Sales S6 (docs/SALES_DESIGN.md §5.1, §5.4, §7) — ĐỌC cơ hội: danh sách, chi tiết, theo khách. S9a thêm ĐƯỜNG ĐỌC THEO VIỆC (§5.5(d)).
// Quy tắc: không có mã đọc nào => 403; ngoài phạm vi xem => 404 (không lộ tồn tại); mọi bộ lọc áp SAU vị từ phạm vi.
// MỘT vị từ cho mọi đường đọc: anyReadWhere = đường đầy đủ (fullReadWhere) HOẶC đường theo việc (taskPathWhere) — dùng cho danh sách, đếm, tìm
// kiếm, theo khách và chi tiết. ĐƯỜNG TRUY CẬP của người gọi với TỪNG cơ hội quyết định trường được trả: đạt đường đầy đủ (readsFull) => mọi
// trường; chỉ đạt đường theo việc => bản kỹ thuật (mapper toOpportunityTech*: không giá trị, xác suất, hold / won / lost, lịch sử).
//
// ĐỌC NHẤT QUÁN (PR241-R1-01, PR241-R1-02): MỖI request đọc toàn bộ dữ liệu nghiệp vụ của nó (cơ hội, căn cứ quyền, thẻ khách, người liên hệ,
// count + rows, quyền hiệu lực của người phụ trách) trong MỘT transaction REPEATABLE READ — một snapshot duy nhất của PostgreSQL. Vì vậy phản
// hồi không bao giờ ghép quyền của trạng thái cũ với dữ liệu của trạng thái mới, và total luôn khớp items. Không truy vấn nghiệp vụ nào đi qua
// this.prisma trực tiếp — chỉ qua `tx` của snapshot(). (Prisma nạp quan hệ bằng truy vấn RIÊNG, nên ngay cả một findFirst có select lồng cũng
// cần snapshot này.) Transaction chỉ đọc => không khoá ghi, không lỗi tuần tự hoá. Ngoại lệ có chủ đích: cổng AssigneeEligibility chạy trên pool
// auth (không thể chung snapshot) — chỉ ảnh hưởng cờ ownerLostAccess, không ảnh hưởng quyền đọc hay dữ liệu trả về.
// Kiểm bằng hai kết nối có đồng bộ rõ ràng: test/opportunities.consistency.int-spec.ts.
//
// Tổng theo cột kanban (T-04, boardSummary bên dưới): CHỈ tính trên đường đầy đủ. Lịch sử /changes: chỉ đường đầy đủ (bên dưới).
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
  // Một snapshot cho cả request (cùng mẫu CustomersService.list).
  private snapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
  }

  // Cờ ownerLostAccess cho một nhóm cơ hội: CHỈ tính khi người gọi có opportunity.assign đang hiệu lực (§5.4); người khác không nhận khoá này.
  // Quyền hiệu lực của người phụ trách đọc trong CÙNG snapshot (tx); trạng thái tài khoản lấy từ cổng auth (pool khác).
  private async ownerFlags(tx: Tx, scopeOf: ScopeOf, rows: readonly OppListRow[]): Promise<(r: OppListRow) => boolean | undefined> {
    if (!seesOwnerLostFlag(scopeOf) || rows.length === 0) return () => undefined;
    const ids = [...new Set(rows.map((r) => r.ownerId))];
    const [acc, can] = await Promise.all([this.access.load(tx, ids), this.eligibility.canSignIn(ids)]);
    return (r) => ownerLostAccess(oppRef(r), acc.get(r.ownerId), can.get(r.ownerId) === true);
  }

  // Kiểm tham số và dựng bộ lọc của người dùng (KHÔNG gồm vị từ phạm vi — vị từ được ghép ở listIn, luôn đứng đầu).
  private plan(q: QueryOpportunitiesDto, customerId?: string): ListPlan {
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

    const filters: Prisma.OpportunityWhereInput[] = [];
    const cust = customerId ?? q.customerId;
    if (cust) filters.push({ customerId: cust });
    if (q.status) filters.push({ status: q.status });
    if (q.stageId) filters.push({ stageId: q.stageId });
    if (q.typeId) filters.push({ typeId: q.typeId });
    if (q.ownerId) filters.push({ ownerId: q.ownerId });
    if (from || to) filters.push({ expectedCloseDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    // T-07: tìm CHỨA trên tiêu đề / tên dự án, KHÔNG phân biệt dấu tiếng Việt và hoa/thường — điều kiện dựng ở listIn (cần gập dấu từ khoá
    // bằng public.f_vn_fold trong transaction; xem opportunities.search.ts). Ở đây chỉ kiểm độ dài.

    const order = q.sortOrder ?? 'desc';
    const orderBy: Prisma.OpportunityOrderByWithRelationInput[] = q.sortBy === 'expectedCloseDate'
      ? [{ expectedCloseDate: { sort: order, nulls: 'last' } }, { code: 'desc' }]
      : q.sortBy === 'code' ? [{ code: order }]
        : q.sortBy === 'createdAt' ? [{ createdAt: order }, { code: order }]
          : [{ updatedAt: order }, { code: order }];
    return { page, pageSize, deletedOnly: q.deleted === 'only', fullOnly: q.status !== undefined || q.ownerId !== undefined, ...(search ? { search } : {}), filters, orderBy };
  }

  // T-07: gập dấu từ khoá (plan đã kiểm ≥ 2 ký tự). Sau gập còn < 2 ký tự (không xảy ra với f_vn_fold hiện tại) => 400, không tìm với mẫu rỗng.
  private async folded(tx: Tx, search: string): Promise<string> {
    const f = await foldSearch(tx, search);
    if (f.length < 2) throw opportunityErrors.validation(['Từ khoá tìm kiếm cần ít nhất 2 ký tự.']);
    return f;
  }

  // Đọc danh sách TRONG snapshot đã mở: count và rows dùng CÙNG where, cùng snapshot.
  private async listIn(tx: Tx, actor: Actor, scopeOf: ScopeOf, p: ListPlan) {
    // Vị từ phạm vi LUÔN đứng đầu; bộ lọc của người dùng chỉ thu hẹp thêm. Danh sách đã xoá: chỉ đường riêng của khôi phục (không có đường theo việc).
    const now = await dbNow(tx);
    // L-01: bản kỹ thuật (đường theo việc) không có trạng thái / người phụ trách (§5.4). Nếu vẫn áp bộ lọc status / ownerId lên dòng theo việc thì việc
    // dòng đó có / không trong kết quả sẽ tiết lộ đúng hai trường này. Có một trong hai bộ lọc => vị từ phạm vi CHỈ còn đường đầy đủ; dòng theo việc
    // không tham gia cả đếm lẫn phân trang (không phải lọc sau khi đọc). Bộ lọc trên trường được thấy (giai đoạn, loại, khách, ngày, từ khoá) không đổi.
    // T-07: từ khoá gập dấu bằng CHÍNH hàm sinh hai cột gập dấu (opportunities.search.ts), trong cùng snapshot; điều kiện văn bản đứng SAU vị từ phạm vi.
    const text = p.search === undefined ? [] : [foldedTextWhere(await this.folded(tx, p.search))];
    const scope = p.deletedOnly ? deletedListWhere(actor, scopeOf) : listReadWhere(actor, scopeOf, now, p.fullOnly);
    const where: Prisma.OpportunityWhereInput = { AND: [scope, ...p.filters, ...text] };
    const total = await tx.opportunity.count({ where });
    const rows = (total === 0 ? [] : await tx.opportunity.findMany({ where, orderBy: p.orderBy, skip: (p.page - 1) * p.pageSize, take: p.pageSize, select: OPP_LIST_SELECT })) as OppListRow[];
    // Cơ hội đã xoá: không tính cờ người phụ trách (mọi đường đọc qua cơ hội đang tắt).
    // Từng dòng: đạt đường đầy đủ => bản đầy đủ; không đạt (chỉ lọt nhờ đường theo việc) => bản kỹ thuật. Dòng đã xoá chỉ có ở đường khôi phục => đầy đủ.
    const isFull = (r: OppListRow): boolean => p.deletedOnly || readsFull(actor, scopeOf, oppRef(r));
    const flag = p.deletedOnly ? () => undefined : await this.ownerFlags(tx, scopeOf, rows.filter(isFull));
    return { items: rows.map((r) => (isFull(r) ? toOpportunityListItem(r, flag(r)) : toOpportunityTechListItem(r))), page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) };
  }

  // ───── GET /opportunities ─────
  async list(ctx: RequestCtx, q: QueryOpportunitiesDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    const p = this.plan(q);
    return this.snapshot((tx) => this.listIn(tx, actor, scopeOf, p));
  }

  // ───── GET /customers/:customerId/opportunities ─────
  // Tab "Cơ hội" của khách. Người phụ trách cơ hội mà KHÔNG phụ trách khách chỉ thấy cơ hội của mình ở khách đó [C5] — vì cùng vị từ với danh sách.
  // 404 khi khách không tồn tại / đã xoá, hoặc khi người gọi không đọc được khách VÀ không thấy cơ hội nào của khách đó (không lộ tồn tại).
  async listByCustomer(ctx: RequestCtx, customerId: string, q: QueryOpportunitiesDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    if (q.deleted !== undefined) throw opportunityErrors.validation(['deleted không dùng được ở đường theo khách.']);
    if (q.customerId !== undefined) throw opportunityErrors.validation(['customerId lấy từ đường dẫn, không gửi kèm trong truy vấn.']);
    const p = this.plan(q, customerId);
    return this.snapshot(async (tx) => {
      const c = await tx.customer.findFirst({ where: { id: customerId }, select: { deletedAt: true, ownerId: true, owner: { select: { departmentId: true } } } });
      if (!c || c.deletedAt !== null) throw opportunityErrors.customerNotFound();
      const result = await this.listIn(tx, actor, scopeOf, p);
      const readsCustomer = inScope(actor, scopeOf('customer.read'), { ownerId: c.ownerId, ownerDepartmentId: c.owner ? c.owner.departmentId : null });
      if (!readsCustomer) {
        // Không đọc được khách: chỉ được ở lại nếu thấy ÍT NHẤT MỘT cơ hội của khách này (kiểm KHÔNG kèm bộ lọc của người dùng).
        const visible = result.total > 0 || (await tx.opportunity.findFirst({ where: { AND: [anyReadWhere(actor, scopeOf, await dbNow(tx)), { customerId }] }, select: { id: true } })) !== null;
        if (!visible) throw opportunityErrors.customerNotFound();
      }
      return result;
    });
  }

  // ───── GET /opportunities/:id ─────
  async detail(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    return this.snapshot((tx) => this.detailIn(tx, actor, scopeOf, id));
  }

  // Đọc chi tiết TRONG transaction đã mở. Đường đọc dùng snapshot REPEATABLE READ ở trên; đường ghi (S7) gọi lại hàm này trong chính transaction
  // ghi, sau khi đã khoá dòng khách (FOR SHARE) và dòng cơ hội (FOR UPDATE) — căn cứ quyền và dữ liệu trả về không thể đổi giữa chừng.
  async detailIn(tx: Tx, actor: Actor, scopeOf: ScopeOf, id: string) {
    {
      // Nạp QUA vị từ phạm vi (cùng điều kiện với danh sách) rồi kiểm lại bằng hàm thuần — hai lớp cùng nguồn, không lớp nào bỏ qua.
      const row = (await tx.opportunity.findFirst({ where: { AND: [{ id }, anyReadWhere(actor, scopeOf, await dbNow(tx))] }, select: OPP_DETAIL_SELECT })) as OppDetailRow | null;
      const path = row ? await resolvePath(tx, actor, scopeOf, id, oppRef(row)) : null;
      if (!row || path === null) throw opportunityErrors.notFound();
      // Chỉ đạt đường theo việc => bản kỹ thuật; không đọc thẻ khách, người liên hệ, cờ người phụ trách.
      if (path === 'TASK') return toOpportunityTechDetail(row);

      // Thẻ khách và người liên hệ đọc trong CÙNG snapshot với căn cứ quyền ở trên (PR241-R1-01).
      const c = await tx.customer.findFirst({
        where: { id: row.customer.id, deletedAt: null },
        select: { id: true, code: true, name: true, shortName: true, address: true, phone: true, ownerId: true, owner: { select: { departmentId: true } }, province: { select: { labelVi: true } } },
      });
      if (!c) throw opportunityErrors.notFound(); // không thể xảy ra trong cùng snapshot (vị từ đã buộc khách chưa xoá) — fail-closed
      const customer: CustomerCard = { id: c.id, code: c.code, name: c.name, shortName: c.shortName, address: c.address, provinceName: c.province ? c.province.labelVi : null, phone: c.phone };
      const customerReadable = inScope(actor, scopeOf('customer.read'), { ownerId: c.ownerId, ownerDepartmentId: c.owner ? c.owner.departmentId : null });
      // Người liên hệ CỦA CHÍNH cơ hội (tối thiểu); liên hệ đã xoá mềm => không trả.
      const ct = row.contactId
        ? await tx.contact.findFirst({ where: { id: row.contactId, customerId: row.customer.id, deletedAt: null }, select: { id: true, code: true, fullName: true, title: true, phone: true } })
        : null;
      const contact: ContactCard | null = ct ? { id: ct.id, code: ct.code, fullName: ct.fullName, title: ct.title, phone: ct.phone } : null;
      const flag = await this.ownerFlags(tx, scopeOf, [row]);
      return toOpportunityDetail(row, { customer, customerReadable, contact, ownerLostAccess: flag(row) });
    }
  }

  // ───── GET /opportunities/:id/changes (S7) ─────
  // Lịch sử thay đổi (giai đoạn, giá trị, xác suất, ngày dự kiến chốt…): CHỈ đường đọc đầy đủ (§5.4 — đường theo việc không bao giờ nhận).
  // Cùng snapshot với bước kiểm quyền. Mới nhất trước (changedAt, id).
  // T-02: phân trang offset (page, pageSize ≤ 100; mặc định 50) kèm total / totalPages — count và trang đọc trong CÙNG snapshot nên luôn khớp.
  // T-03: dòng OWNER lưu id nhân viên => kèm oldOwner / newOwner { id, code, fullName } đọc trong CÙNG snapshot (null khi không tìm thấy). Chỉ
  // đường đầy đủ nhận lịch sử, nên tên người phụ trách cũ không mở thêm gì cho bản kỹ thuật.
  async changes(ctx: RequestCtx, id: string, q: QueryOpportunityChangesDto = {}) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? CHANGES_PAGE_SIZE;
    if (page * pageSize > MAX_OFFSET_WINDOW) throw opportunityErrors.validation(['page × pageSize vượt quá ' + MAX_OFFSET_WINDOW + '.']);
    return this.snapshot(async (tx) => {
      const row = await tx.opportunity.findFirst({ where: { AND: [{ id }, anyReadWhere(actor, scopeOf, await dbNow(tx))] }, select: { id: true, ownerId: true, deletedAt: true, customer: { select: { ownerId: true, deletedAt: true } } } });
      if (!row) throw opportunityErrors.notFound();
      // Thấy được cơ hội nhưng chỉ qua đường theo việc => 403 (không bao giờ nhận lịch sử giá trị / xác suất).
      if (!readsFull(actor, scopeOf, row)) throw opportunityErrors.forbidden('Lịch sử thay đổi chỉ dành cho người xem đầy đủ cơ hội.');
      const total = await tx.opportunityChange.count({ where: { opportunityId: id } });
      const rows = total === 0 ? [] : await tx.opportunityChange.findMany({
        where: { opportunityId: id }, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, field: true, oldValue: true, newValue: true, reason: true, changedAt: true, changedBy: { select: { id: true, code: true, fullName: true } } },
      });
      const ownerIds = [...new Set(rows.filter((r) => r.field === 'OWNER').flatMap((r) => [r.oldValue, r.newValue]).filter((v): v is string => v !== null && UUID_RE.test(v)))];
      const people = ownerIds.length ? await tx.employee.findMany({ where: { id: { in: ownerIds } }, select: { id: true, code: true, fullName: true } }) : [];
      const person = (v: string | null) => { const e = v === null ? undefined : people.find((p) => p.id === v); return e ? { id: e.id, code: e.code, fullName: e.fullName } : null; };
      return {
        items: rows.map((r) => ({
          id: r.id, field: r.field, oldValue: r.oldValue, newValue: r.newValue, reason: r.reason, changedAt: r.changedAt.toISOString(),
          changedBy: { id: r.changedBy.id, code: r.changedBy.code, fullName: r.changedBy.fullName },
          ...(r.field === 'OWNER' ? { oldOwner: person(r.oldValue), newOwner: person(r.newValue) } : {}),
        })),
        page, pageSize, total, totalPages: Math.ceil(total / pageSize),
      };
    });
  }

  // ───── GET /opportunities/board-summary (T-04) ─────
  // Tổng CHÍNH XÁC theo cột kanban (không chỉ trên thẻ đã tải): mỗi giai đoạn — số cơ hội ĐANG MỞ, tổng giá trị dự kiến (chuỗi số nguyên VNĐ,
  // null khi không có cơ hội nào có giá trị), số cơ hội có / chưa có giá trị — kèm số cơ hội TẠM HOÃN (nút "Tạm hoãn" dưới kanban).
  // Bộ lọc loại / từ khoá dựng bằng CHÍNH plan() của danh sách => khớp đúng các cột (GET /opportunities?status=OPEN&stageId=…).
  // BẢO MẬT: CHỈ đường đọc ĐẦY ĐỦ (listReadWhere(..., true) = vị từ đầy đủ). Dòng chỉ đạt đường theo việc bị loại khỏi CẢ số đếm LẪN tổng tiền —
  // giống cột kanban (có bộ lọc status => danh sách cũng chỉ xét đường đầy đủ, L-01). Người không có opportunity.read (Kỹ thuật chỉ có
  // read_assigned) => 403: không bao giờ nhận số tiền.
  async boardSummary(ctx: RequestCtx, q: QueryBoardSummaryDto) {
    const { actor } = ctx;
    const scopeOf = this.scopeOf(actor);
    this.needAnyRead(scopeOf);
    if (scopeOf('opportunity.read') === null) throw opportunityErrors.forbidden('Tổng theo giai đoạn chỉ dành cho người xem đầy đủ cơ hội.');
    const p = this.plan({ typeId: q.typeId, q: q.q });
    return this.snapshot(async (tx) => {
      const full = listReadWhere(actor, scopeOf, await dbNow(tx), true);
      // Vị từ đường đầy đủ LUÔN đứng đầu; bộ lọc của người dùng và trạng thái chỉ thu hẹp thêm.
      const where = (status: 'OPEN' | 'ON_HOLD'): Prisma.OpportunityWhereInput => ({ AND: [full, ...p.filters, { status }] });
      const groups = await tx.opportunity.groupBy({ by: ['stageId'], where: where('OPEN'), _count: { _all: true, expectedAmountVnd: true }, _sum: { expectedAmountVnd: true } });
      const onHoldCount = await tx.opportunity.count({ where: where('ON_HOLD') });
      const stages = groups.map((g) => {
        const known = g._count.expectedAmountVnd;
        const sum = g._sum.expectedAmountVnd;
        return { stageId: g.stageId, count: g._count._all, knownAmountCount: known, unknownAmountCount: g._count._all - known, sumExpectedAmountVnd: known > 0 && sum !== null ? sum.toString() : null };
      }).sort((a, b) => (a.stageId < b.stageId ? -1 : a.stageId > b.stageId ? 1 : 0));
      return { stages, onHoldCount };
    });
  }
}
