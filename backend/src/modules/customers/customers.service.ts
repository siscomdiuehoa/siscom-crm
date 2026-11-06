import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, Permission, RequestCtx, Scope } from '../../common/auth/actor';
import { inScope, OwnerInfo } from '../../common/auth/scope';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { DomainException } from '../../common/errors/domain.exception';
import { mapPrismaError, sqlStateOf } from '../../common/errors/prisma-error.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_LINKS_CHECKER, ActiveLinksChecker } from './customers.deletion-guard';
import { ACTIVITY_CUSTOMER_HOOKS, ActivityCustomerHooksPort } from '../activities/activities.customer-hooks';
import { DEFAULT_STATUS_CODE, DEFAULT_TIER_CODE, LOOKUP_TYPES, LookupKey, MAX_OFFSET_WINDOW } from './customers.defaults';
import { customerErrors } from './customers.errors';
import { CustomerRow, toDetail, toListItem } from './customers.mapper';
import { assertOwnerInScope, closeOwnerAssignment, loadOwnerCandidate, openOwnerAssignment, ownerIdForCreate, ownerIdForUpdate } from './customers.ownership';
import { listOwnerCandidates, widestScope } from './customers.owner-candidates';
import { buildOrderBy, CUSTOMER_DETAIL_INCLUDE, scopeWhere } from './customers.queries';
import { buildSearchCountQuery, buildSearchPageQuery, chooseSearchPath } from './customers.search';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { QueryCustomersDto } from './dto/query-customers.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';
import { EMAIL_MESSAGE, isEmailB1 } from './validators/vn-email';
import { isVnPhone, normalizePhoneE164, PHONE_MESSAGE } from './validators/vn-phone';
import { isTaxId, TAX_MESSAGE } from './validators/vn-tax-id';
import { isWebsite, WEBSITE_MESSAGE } from './validators/vn-website';

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, 'customer' | 'lookupItem'>;
type Kind = 'create' | 'update' | 'restore';
type Box = { taxId: string | null; excludeId?: string };

const REDACTED = new Set(['phone', 'phoneE164', 'email', 'address', 'note']);
const REDACTED_TEXT = '(đã thay đổi)';

// null/'' => null; undefined => undefined (không gửi); còn lại trim.
function blank(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}
// Quy tắc suy tên viết tắt giống normalizeCustomer của frontend B1.1.
export function deriveShortName(name: string): string {
  const s = name.replace(/^(Công ty|Cty)\s+(CP|TNHH|Cổ phần)\s*/i, '') || name;
  return s.slice(0, 120);
}
// Nhật ký: trường nhạy cảm chỉ ghi "(đã thay đổi)" (D12).
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[k] = REDACTED.has(k) ? REDACTED_TEXT : [a, b];
  }
  return out;
}
const ownerInfo = (r: { ownerId: string | null; owner: { departmentId: string | null } | null }): OwnerInfo => ({ ownerId: r.ownerId, ownerDepartmentId: r.owner ? r.owner.departmentId : null });

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(ACTIVE_LINKS_CHECKER) private readonly links: ActiveLinksChecker,
    // B3 A6 (§5, §5.4): giao diện export của module activities — thu hồi quyền theo việc + rút đề xuất chuyển khi xoá mềm khách.
    @Inject(ACTIVITY_CUSTOMER_HOOKS) private readonly activityHooks: ActivityCustomerHooksPort,
  ) {}

  // ───── tiện ích ─────
  private scopeOf(actor: Actor, p: Permission): Scope {
    const s = this.actors.scopeFor(actor, p);
    if (!s) throw customerErrors.forbidden();
    return s;
  }

  private inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      return fn(tx);
    }, { maxWait: 5000, timeout: 20000 });
  }

  // Khoá dòng khách hàng: điểm tuần tự hoá mọi thao tác ghi trên cùng một khách.
  private async lock(tx: Tx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  private async loadVisible(db: Db, actor: Actor, id: string, includeDeleted = false): Promise<CustomerRow> {
    const readScope = this.scopeOf(actor, 'customer.read');
    const row = await db.customer.findFirst({ where: includeDeleted ? { id } : { id, deletedAt: null }, include: CUSTOMER_DETAIL_INCLUDE });
    if (!row || !inScope(actor, readScope, ownerInfo(row))) throw customerErrors.notFound(); // ngoài phạm vi đọc => 404, không lộ sự tồn tại
    return row;
  }

  private async resolveLookups(db: Db, wanted: Partial<Record<LookupKey, string | null | undefined>>, requireActive: boolean): Promise<Partial<Record<LookupKey, string>>> {
    const pairs = (Object.keys(wanted) as LookupKey[]).filter((k) => typeof wanted[k] === 'string' && wanted[k] !== '').map((k) => ({ key: k, type: LOOKUP_TYPES[k], code: wanted[k] as string }));
    if (!pairs.length) return {};
    const rows = await db.lookupItem.findMany({ where: { OR: pairs.map((p) => ({ type: p.type, code: p.code })) }, select: { id: true, type: true, code: true, isActive: true } });
    const out: Partial<Record<LookupKey, string>> = {};
    for (const p of pairs) {
      const r = rows.find((x) => x.type === p.type && x.code === p.code);
      if (!r || (requireActive && !r.isActive)) throw customerErrors.lookupInvalid(p.key);
      out[p.key] = r.id;
    }
    return out;
  }

  private checkFormats(f: { phone?: string | null; taxId?: string | null; email?: string | null; website?: string | null }, stored?: { phone: string | null; email: string | null; website: string | null }): void {
    const errs: string[] = [];
    if (f.phone && !(stored && stored.phone === f.phone) && !isVnPhone(f.phone)) errs.push(PHONE_MESSAGE);
    if (f.taxId && !isTaxId(f.taxId)) errs.push(TAX_MESSAGE);
    if (f.email && !(stored && stored.email === f.email) && !isEmailB1(f.email)) errs.push(EMAIL_MESSAGE);
    if (f.website && !(stored && stored.website === f.website) && !isWebsite(f.website)) errs.push(WEBSITE_MESSAGE);
    if (errs.length) throw customerErrors.validation(errs);
  }

  // Khách còn hiệu lực đang giữ MST; chỉ lộ mã/tên khi người thao tác được XEM khách đó (fail-closed).
  private async conflictFor(db: Db, actor: Actor, taxId: string, excludeId?: string): Promise<{ exists: boolean; visible: { code: string; name: string } | null }> {
    const hit = await db.customer.findFirst({
      where: { taxId, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, code: true, ownerId: true, owner: { select: { departmentId: true } } },
    });
    if (!hit) return { exists: false, visible: null };
    const readScope = this.actors.scopeFor(actor, 'customer.read');
    if (!inScope(actor, readScope, ownerInfo(hit))) return { exists: true, visible: null };
    const full = await db.customer.findUnique({ where: { id: hit.id }, select: { name: true } });
    return { exists: true, visible: full ? { code: hit.code, name: full.name } : null };
  }

  private async assertTaxFree(db: Db, actor: Actor, taxId: string, excludeId?: string): Promise<void> {
    const c = await this.conflictFor(db, actor, taxId, excludeId);
    if (c.exists) throw customerErrors.duplicateTaxId(c.visible);
  }

  // Bắt lỗi DB khi đua nhau (unique MST...) và đổi sang lỗi nghiệp vụ; không lộ chi tiết.
  private async guarded<T>(actor: Actor, kind: Kind, box: Box, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainException) throw e;
      const m = mapPrismaError(e);
      if (!m) throw e;
      if (m.code === 'CUSTOMER_DUPLICATE_TAX_ID' && box.taxId) {
        const c = await this.conflictFor(this.prisma, actor, box.taxId, box.excludeId);
        throw kind === 'restore' ? customerErrors.restoreConflict(c.visible ? [c.visible] : []) : customerErrors.duplicateTaxId(c.visible);
      }
      throw m;
    }
  }

  // ───── đọc ─────
  // PR 7 (D15): ứng viên chủ sở hữu theo phạm vi RỘNG NHẤT của customer.create / customer.update (không dùng employee.read).
  // Không có cả hai quyền => 403. Chỉ đọc, không transaction.
  async ownerCandidates(ctx: RequestCtx) {
    const { actor } = ctx;
    const scope = widestScope(this.actors.scopeFor(actor, 'customer.create'), this.actors.scopeFor(actor, 'customer.update'));
    if (!scope) throw customerErrors.forbidden();
    return listOwnerCandidates(this.prisma, actor, scope);
  }
  async get(ctx: RequestCtx, id: string) {
    return toDetail(await this.loadVisible(this.prisma, ctx.actor, id));
  }

  async list(ctx: RequestCtx, q: QueryCustomersDto) {
    const { actor } = ctx;
    const readScope = this.scopeOf(actor, 'customer.read');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    if (page * pageSize > MAX_OFFSET_WINDOW) throw customerErrors.validation(['page × pageSize vượt quá ' + MAX_OFFSET_WINDOW + '.']);
    if (q.sortBy === 'relevance' && q.search === undefined) throw customerErrors.validation(['sortBy=relevance chỉ dùng được khi có search.']);
    const deletedOnly = q.deleted === 'only';
    // N6: xem khách đã xoá cần quyền restore VÀ vẫn bị giới hạn bởi phạm vi đọc (không mở rộng quyền xem chỉ nhờ restore).
    const restoreScope = deletedOnly ? this.scopeOf(actor, 'customer.restore') : null;
    const and: Prisma.CustomerWhereInput[] = [scopeWhere(actor, readScope)];
    if (deletedOnly) and.push(scopeWhere(actor, restoreScope));
    const ids = await this.resolveLookups(this.prisma, { tier: q.tier, status: q.status, industry: q.industry, source: q.source, province: q.province }, false);
    const where: Prisma.CustomerWhereInput = {
      deletedAt: deletedOnly ? { not: null } : null,
      AND: and,
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(ids.tier ? { tierId: ids.tier } : {}),
      ...(ids.status ? { statusId: ids.status } : {}),
      ...(ids.industry ? { industryId: ids.industry } : {}),
      ...(ids.source ? { sourceId: ids.source } : {}),
      ...(ids.province ? { provinceId: ids.province } : {}),
    };
    const sortBy = q.sortBy ?? 'createdAt';
    const order = q.sortOrder ?? 'desc';
    const search = q.search;
    const run = () => this.prisma.$transaction<{ total: number; rows: CustomerRow[] }>(async (tx) => {
      if (search !== undefined) return this.runSearch(tx, actor, { search, page, pageSize, deletedOnly, readScope, restoreScope, ownerId: q.ownerId, ids, sortBy, order });
      const total = await tx.customer.count({ where });
      const rows = total === 0 ? [] : await this.listPage(tx, where, buildOrderBy(sortBy, order), (page - 1) * pageSize, pageSize);
      return { total, rows };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });
    let res: { total: number; rows: CustomerRow[] } | undefined;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await run(); } catch (e) { if (sqlStateOf(e) !== '40001' || attempt === 2) throw e; } // xung đột snapshot: thử lại
    }
    if (!res) throw customerErrors.validation(['Không đọc được danh sách.']);
    return { items: res.rows.map(toListItem), page, pageSize, total: res.total, totalPages: Math.ceil(res.total / pageSize) };
  }

  // P2-3b-0: trang sâu (skip > 0) lấy ID trước bằng CÙNG where/orderBy/skip/take (không nạp quan hệ), rồi nạp chi tiết đúng các ID đó và giữ nguyên thứ tự. Trang 1 giữ một truy vấn như cũ.
  private async listPage(tx: Tx, where: Prisma.CustomerWhereInput, orderBy: Prisma.CustomerOrderByWithRelationInput[], skip: number, take: number): Promise<CustomerRow[]> {
    if (skip === 0) return tx.customer.findMany({ where, include: CUSTOMER_DETAIL_INCLUDE, orderBy, skip, take });
    const idRows = await tx.customer.findMany({ where, select: { id: true }, orderBy, skip, take });
    if (idRows.length === 0) return [];
    const found = await tx.customer.findMany({ where: { id: { in: idRows.map((r) => r.id) } }, include: CUSTOMER_DETAIL_INCLUDE });
    const byId = new Map<string, CustomerRow>(found.map((r) => [r.id, r]));
    return idRows.map((r) => byId.get(r.id)).filter((r): r is CustomerRow => r !== undefined);
  }

  // Tìm kiếm CHÍNH XÁC: tổng = số dòng khớp (không trần kết quả); trang = id theo thứ tự rồi nạp bằng Prisma. P2-2: ≥3 ký tự (không deleted=only) dùng UNION (V5), còn lại OR.
  // Không gọi fn_customer_search (có LIMIT); điều kiện dựng inline bằng đúng biểu thức đã có chỉ mục. Test so khớp với hàm đó.
  private async runSearch(
    tx: Tx,
    actor: Actor,
    p: { search: string; page: number; pageSize: number; deletedOnly: boolean; readScope: Scope | null; restoreScope: Scope | null; ownerId?: string; ids: Partial<Record<LookupKey, string>>; sortBy: string; order: 'asc' | 'desc' },
  ): Promise<{ total: number; rows: CustomerRow[] }> {
    const f = await tx.$queryRaw<{ t: string | null }[]>`SELECT public.f_vn_fold(btrim(${p.search})) AS t`;
    const folded = f[0]?.t ?? '';
    if (folded.length < 2) throw customerErrors.validation(['search phải có ít nhất 2 ký tự.']);
    const sp = { actor, folded, raw: p.search, deletedOnly: p.deletedOnly, readScope: p.readScope, restoreScope: p.restoreScope, ownerId: p.ownerId, ids: p.ids };
    const path = chooseSearchPath(folded, p.deletedOnly);
    // Một truy vấn: trang + tổng (count(*) OVER () tính trước LIMIT/OFFSET). Trang rỗng: page=1 ⇒ tổng 0; page>1 ⇒ đếm riêng để tổng vẫn chính xác (trang vượt cuối).
    const idRows = await tx.$queryRaw<{ id: string; total: number }[]>(buildSearchPageQuery(sp, path, { sortBy: p.sortBy, order: p.order }, p.pageSize, (p.page - 1) * p.pageSize));
    let total = 0;
    if (idRows.length > 0) total = Number(idRows[0]?.total ?? 0);
    else if (p.page > 1) total = Number((await tx.$queryRaw<{ n: number }[]>(buildSearchCountQuery(sp, path)))[0]?.n ?? 0);
    if (total === 0) return { total, rows: [] };
    const idList = idRows.map((r) => r.id);
    const found = idList.length ? await tx.customer.findMany({ where: { id: { in: idList } }, include: CUSTOMER_DETAIL_INCLUDE }) : [];
    const byId = new Map<string, CustomerRow>(found.map((r) => [r.id, r]));
    const rows = idList.map((id) => byId.get(id)).filter((r): r is CustomerRow => r !== undefined);
    return { total, rows };
  }

  // ───── tạo ─────
  async create(ctx: RequestCtx, dto: CreateCustomerDto) {
    const { actor } = ctx;
    const scope = this.scopeOf(actor, 'customer.create');
    // B-3: chủ sở hữu theo phạm vi (OWN/DEPARTMENT không gửi => chính người tạo, D14); ứng viên được kiểm tồn tại/ACTIVE/cùng phạm vi trong transaction.
    const wantOwner = ownerIdForCreate(actor, scope, blank(dto.ownerId));
    const ownerReason = blank(dto.ownerReason) ?? null;
    const name = dto.name.trim();
    const phone = blank(dto.phone) ?? null; // 04/11/2026: không bắt buộc; không tạo số giả
    if (name.length < 2) throw customerErrors.validation(['Tên công ty quá ngắn']);
    const taxId = blank(dto.taxId) ?? null;
    const email = blank(dto.email) ?? null;
    const website = blank(dto.website) ?? null;
    this.checkFormats({ phone, taxId, email, website });
    const box: Box = { taxId };
    return this.guarded(actor, 'create', box, () => this.inTx(async (tx) => {
      const ids = await this.resolveLookups(tx, { tier: blank(dto.tier) ?? DEFAULT_TIER_CODE, status: blank(dto.status) ?? DEFAULT_STATUS_CODE, industry: blank(dto.industry), source: blank(dto.source), province: blank(dto.province) }, true);
      if (taxId) await this.assertTaxFree(tx, actor, taxId);
      let ownerId: string | null = null;
      if (wantOwner) { const cand = await loadOwnerCandidate(tx, wantOwner); assertOwnerInScope(actor, scope, cand); ownerId = cand.id; }
      const shortName = blank(dto.shortName) ?? deriveShortName(name);
      const data = {
        name, shortName, taxId, phone, phoneE164: phone ? normalizePhoneE164(phone) : null, email, website,
        address: blank(dto.address) ?? null, note: blank(dto.note) ?? null, tags: dto.tags ?? [],
        tierId: ids.tier as string, statusId: ids.status as string,
        industryId: ids.industry ?? null, sourceId: ids.source ?? null, provinceId: ids.province ?? null,
        ownerId, createdById: actor.employeeId, updatedById: actor.employeeId,
      }; // code/id/version/revenue: để PostgreSQL/Prisma tự sinh; không bao giờ nhận từ client
      const created = await tx.customer.create({ data, select: { id: true, code: true } });
      if (ownerId) await openOwnerAssignment(tx, { customerId: created.id, employeeId: ownerId, assignedById: actor.employeeId, reason: ownerReason });
      await this.audit.record(tx, { action: 'customer.create', entityType: 'customer', entityId: created.id, entityCode: created.code, summary: 'Tạo khách hàng ' + created.code, changes: diffFields({}, { name, shortName, taxId, phone, phoneE164: data.phoneE164, email, website, address: data.address, note: data.note, tags: data.tags, ownerId }), actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      return toDetail(await tx.customer.findUniqueOrThrow({ where: { id: created.id }, include: CUSTOMER_DETAIL_INCLUDE }));
    }));
  }

  // ───── sửa ─────
  async update(ctx: RequestCtx, id: string, dto: UpdateCustomerDto) {
    const { actor } = ctx;
    const upScope = this.scopeOf(actor, 'customer.update');
    const taxIn = blank(dto.taxId);
    const box: Box = { taxId: typeof taxIn === 'string' ? taxIn : null, excludeId: id };
    return this.guarded(actor, 'update', box, () => this.inTx(async (tx) => {
      if (!(await this.lock(tx, id))) throw customerErrors.notFound();
      const cur = await this.loadVisible(tx, actor, id);
      if (!inScope(actor, upScope, ownerInfo(cur))) throw customerErrors.forbidden();
      if (cur.version !== dto.version) throw customerErrors.versionConflict(cur.version);

      const data: Prisma.CustomerUncheckedUpdateManyInput = {};
      const after: Record<string, unknown> = {};
      const before: Record<string, unknown> = { name: cur.name, shortName: cur.shortName, taxId: cur.taxId, phone: cur.phone, phoneE164: cur.phoneE164, email: cur.email, website: cur.website, address: cur.address, note: cur.note, tags: cur.tags, tier: cur.tier.code, status: cur.status.code, industry: cur.industry?.code ?? null, source: cur.source?.code ?? null, province: cur.province?.code ?? null, ownerId: cur.ownerId };
      const name = dto.name === undefined ? undefined : dto.name.trim();
      if (name !== undefined) { if (name.length < 2) throw customerErrors.validation(['Tên công ty quá ngắn']); data.name = name; after.name = name; }
      const phone = blank(dto.phone); // undefined = giữ nguyên; null = xoá số
      const email = blank(dto.email);
      const website = blank(dto.website);
      this.checkFormats({ phone, taxId: typeof taxIn === 'string' ? taxIn : null, email: email ?? null, website: website ?? null }, { phone: cur.phone, email: cur.email, website: cur.website });
      if (phone !== undefined && phone !== cur.phone) { data.phone = phone; data.phoneE164 = phone ? normalizePhoneE164(phone) : null; after.phone = phone; after.phoneE164 = data.phoneE164; }
      if (taxIn !== undefined && taxIn !== cur.taxId) { data.taxId = taxIn; after.taxId = taxIn; }
      if (email !== undefined && email !== cur.email) { data.email = email; after.email = email; }
      if (website !== undefined && website !== cur.website) { data.website = website; after.website = website; }
      for (const k of ['address', 'note'] as const) {
        const v = blank(dto[k]);
        if (v !== undefined && v !== cur[k]) { data[k] = v; after[k] = v; }
      }
      if (dto.shortName !== undefined) {
        const sn = blank(dto.shortName) ?? deriveShortName(name ?? cur.name);
        if (sn !== cur.shortName) { data.shortName = sn; after.shortName = sn; }
      }
      if (dto.tags !== undefined && JSON.stringify(dto.tags) !== JSON.stringify(cur.tags)) { data.tags = dto.tags; after.tags = dto.tags; }

      // Danh mục: chỉ kiểm khi GIÁ TRỊ ĐỔI (mục đã gán nhưng sau đó ngừng dùng vẫn giữ được).
      const wanted: Partial<Record<LookupKey, string>> = {};
      const clear: LookupKey[] = [];
      for (const k of ['tier', 'status', 'industry', 'source', 'province'] as const) {
        const v = blank(dto[k]);
        if (v === undefined) continue;
        const curCode = cur[k]?.code ?? null;
        if (v === null) { if (curCode !== null) clear.push(k); } else if (v !== curCode) wanted[k] = v;
      }
      const ids = await this.resolveLookups(tx, wanted, true);
      for (const k of Object.keys(wanted) as LookupKey[]) { (data as Record<string, unknown>)[k + 'Id'] = ids[k]; after[k] = wanted[k]; }
      for (const k of clear) { (data as Record<string, unknown>)[k + 'Id'] = null; after[k] = null; }

      // B-3 (§3.7): chủ sở hữu chỉ đổi khi gửi giá trị KHÁC hiện tại; ứng viên phải tồn tại/ACTIVE và cùng phạm vi customer.update.
      const newOwner = ownerIdForUpdate(actor, upScope, cur.ownerId, blank(dto.ownerId));
      if (newOwner !== undefined) {
        if (newOwner) { const cand = await loadOwnerCandidate(tx, newOwner); assertOwnerInScope(actor, upScope, cand); }
        data.ownerId = newOwner; after.ownerId = newOwner;
      }

      if (Object.keys(data).length === 0) return toDetail(cur); // không có thay đổi: không tăng version, không ghi nhật ký
      if (data.taxId && typeof data.taxId === 'string') await this.assertTaxFree(tx, actor, data.taxId, id);

      const r = await tx.customer.updateMany({ where: { id, version: dto.version, deletedAt: null }, data: { ...data, updatedById: actor.employeeId, version: { increment: 1 } } });
      if (r.count !== 1) throw customerErrors.versionConflict(cur.version);
      if (newOwner !== undefined) {
        await closeOwnerAssignment(tx, id); // đóng phân công OWNER đang hiệu lực (giờ DB)
        if (newOwner) await openOwnerAssignment(tx, { customerId: id, employeeId: newOwner, assignedById: actor.employeeId, reason: blank(dto.ownerReason) ?? null });
      }
      await this.audit.record(tx, { action: 'customer.update', entityType: 'customer', entityId: id, entityCode: cur.code, summary: 'Cập nhật khách hàng ' + cur.code, changes: diffFields(before, after), actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      return toDetail(await tx.customer.findUniqueOrThrow({ where: { id }, include: CUSTOMER_DETAIL_INCLUDE }));
    }));
  }

  // ───── xoá (KHOÁ: N2 = Y) ─────
  async remove(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const delScope = this.scopeOf(actor, 'customer.delete');
    const row = await this.loadVisible(this.prisma, actor, id);
    if (!inScope(actor, delScope, ownerInfo(row))) throw customerErrors.forbidden();
    const check = await this.links.check(id);
    if (!check.verified) throw customerErrors.deleteUnverified(check.unchecked);
    return this.softDelete(ctx, id); // chỉ tới đây khi checker THẬT trả verified: true (production hiện không có)
  }

  private softDelete(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    return this.guarded(actor, 'update', { taxId: null }, () => this.inTx(async (tx) => {
      if (!(await this.lock(tx, id))) throw customerErrors.notFound();
      const cur = await this.loadVisible(tx, actor, id);
      const r = await tx.customer.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), deletedById: actor.employeeId, updatedById: actor.employeeId, version: { increment: 1 } } });
      if (r.count !== 1) throw customerErrors.notFound();
      await this.audit.record(tx, { action: 'customer.delete', entityType: 'customer', entityId: id, entityCode: cur.code, summary: 'Xoá mềm khách hàng ' + cur.code, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      // Cùng transaction: thu hồi mọi activity_access của khách (CUSTOMER_DELETED) + rút đề xuất chuyển đang chờ (WITHDRAWN) — thiết kế §5.4.
      await this.activityHooks.onCustomerSoftDeleted(tx, id, actor.employeeId, ctx.requestId);
      return toDetail(await tx.customer.findUniqueOrThrow({ where: { id }, include: CUSTOMER_DETAIL_INCLUDE }));
    }));
  }

  // ───── khôi phục ─────
  async restore(ctx: RequestCtx, id: string) {
    const { actor } = ctx;
    const rScope = this.scopeOf(actor, 'customer.restore');
    const box: Box = { taxId: null, excludeId: id };
    return this.guarded(actor, 'restore', box, () => this.inTx(async (tx) => {
      if (!(await this.lock(tx, id))) throw customerErrors.notFound();
      const cur = await this.loadVisible(tx, actor, id, true);
      if (!inScope(actor, rScope, ownerInfo(cur))) throw customerErrors.forbidden();
      if (!cur.deletedAt) throw customerErrors.notDeleted();
      box.taxId = cur.taxId;
      const conflicts = await tx.$queryRaw<{ conflict_code: string; conflict_name: string }[]>`SELECT conflict_code, conflict_name FROM public.fn_customer_restore_conflicts(${id}::uuid)`;
      if (conflicts.length) throw await this.restoreConflict(tx, actor, conflicts);
      const r = await tx.customer.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null, deleteReason: null, restoredAt: new Date(), restoredById: actor.employeeId, updatedById: actor.employeeId, version: { increment: 1 } } });
      if (r.count !== 1) throw customerErrors.notDeleted();
      await this.audit.record(tx, { action: 'customer.restore', entityType: 'customer', entityId: id, entityCode: cur.code, summary: 'Khôi phục khách hàng ' + cur.code, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      return toDetail(await tx.customer.findUniqueOrThrow({ where: { id }, include: CUSTOMER_DETAIL_INCLUDE }));
    }));
  }

  private async restoreConflict(tx: Tx, actor: Actor, conflicts: { conflict_code: string; conflict_name: string }[]): Promise<DomainException> {
    const readScope = this.actors.scopeFor(actor, 'customer.read');
    const rows = await tx.customer.findMany({ where: { code: { in: conflicts.map((c) => c.conflict_code) } }, select: { code: true, ownerId: true, owner: { select: { departmentId: true } } } });
    const visible = conflicts.filter((c) => { const r = rows.find((x) => x.code === c.conflict_code); return !!r && inScope(actor, readScope, ownerInfo(r)); }).map((c) => ({ code: c.conflict_code, name: c.conflict_name }));
    return customerErrors.restoreConflict(visible);
  }
}
