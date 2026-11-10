import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { Actor, ACTOR_PROVIDER, ActorProvider, Permission, RequestCtx, Scope } from '../../common/auth/actor';
import { inScope, OwnerInfo } from '../../common/auth/scope';
import { AUDIT_PORT, AuditPort } from '../../common/audit/audit.port';
import { DomainException } from '../../common/errors/domain.exception';
import { mapPrismaError } from '../../common/errors/prisma-error.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import { customerErrors } from './customers.errors';
import type { CreateContactDto } from './dto/create-contact.dto';
import type { DeleteContactDto, UpdateContactDto } from './dto/update-contact.dto';
import { EMAIL_MESSAGE, isEmailB1 } from './validators/vn-email';
import { isVnPhone, PHONE_MESSAGE } from './validators/vn-phone';

type Tx = Prisma.TransactionClient;
const CONTACT_SELECT = { id: true, code: true, fullName: true, title: true, phone: true, email: true, isPrimary: true, note: true, createdAt: true, updatedAt: true } as const;
interface ContactRow { id: string; code: string; fullName: string; title: string | null; phone: string | null; email: string | null; isPrimary: boolean; note: string | null; createdAt: Date; updatedAt: Date }
const toContact = (c: ContactRow) => ({ id: c.id, code: c.code, fullName: c.fullName, title: c.title, phone: c.phone, email: c.email, isPrimary: c.isPrimary, note: c.note, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() });
const blank = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());
// Sửa: undefined = không gửi (giữ nguyên); null/'' = xoá giá trị.
const patchVal = (v: string | null | undefined): string | null | undefined => (v === undefined ? undefined : blank(v));
const OPTIONAL_FIELDS = ['title', 'phone', 'email', 'note'] as const;
// Mốc mới luôn LỚN HƠN mốc cũ (độ chính xác mili-giây) để hai lần ghi liên tiếp không trùng updatedAt.
const nextStamp = (prev: Date): Date => new Date(Math.max(Date.now(), prev.getTime() + 1));
const parseStamp = (s: unknown): Date | null => {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const ownerInfo = (r: { ownerId: string | null; owner: { departmentId: string | null } | null }): OwnerInfo => ({ ownerId: r.ownerId, ownerDepartmentId: r.owner ? r.owner.departmentId : null });
const CUSTOMER_PICK = { id: true, code: true, deletedAt: true, ownerId: true, owner: { select: { departmentId: true } } } as const;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  private scopeOf(actor: Actor, p: Permission): Scope {
    const s = this.actors.scopeFor(actor, p);
    if (!s) throw customerErrors.forbidden();
    return s;
  }

  // Liên hệ chỉ xem được khi xem được khách hàng (phạm vi customer.read VÀ contact.read); ngoài phạm vi => 404.
  async list(ctx: RequestCtx, customerId: string) {
    const { actor } = ctx;
    const contactScope = this.scopeOf(actor, 'contact.read');
    const readScope = this.scopeOf(actor, 'customer.read');
    const cust = await this.prisma.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: CUSTOMER_PICK });
    if (!cust || !inScope(actor, readScope, ownerInfo(cust)) || !inScope(actor, contactScope, ownerInfo(cust))) throw customerErrors.notFound();
    const rows = await this.prisma.contact.findMany({ where: { customerId, deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }, { code: 'asc' }], select: CONTACT_SELECT });
    return { items: rows.map(toContact) };
  }

  async create(ctx: RequestCtx, customerId: string, dto: CreateContactDto) {
    const { actor } = ctx;
    const contactScope = this.scopeOf(actor, 'contact.create');
    const updateScope = this.scopeOf(actor, 'customer.update');
    const fullName = dto.fullName.trim();
    const phone = blank(dto.phone);
    const email = blank(dto.email);
    const errs: string[] = [];
    if (!fullName) errs.push('Vui lòng nhập họ tên người liên hệ');
    // 04/11/2026: không còn bắt buộc phone/email — không tạo số/email giả.
    if (phone && !isVnPhone(phone)) errs.push(PHONE_MESSAGE);
    if (email && !isEmailB1(email)) errs.push(EMAIL_MESSAGE);
    if (errs.length) throw customerErrors.validation(errs);
    const isPrimary = dto.isPrimary === true;
    try {
      return await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
        // Khoá dòng khách TRƯỚC (cùng thứ tự với sửa/xoá/khôi phục) rồi mới kiểm lại trạng thái.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer WHERE id = ${customerId}::uuid FOR UPDATE`;
        if (!locked.length) throw customerErrors.notFound();
        const cust = await tx.customer.findFirst({ where: { id: customerId }, select: CUSTOMER_PICK });
        const readScope = this.scopeOf(actor, 'customer.read');
        if (!cust || !inScope(actor, readScope, ownerInfo(cust))) throw customerErrors.notFound();
        if (cust.deletedAt) throw new DomainException(409, 'CUSTOMER_DELETED', 'Khách hàng đã bị xoá, không thể thêm liên hệ.');
        if (!inScope(actor, contactScope, ownerInfo(cust)) || !inScope(actor, updateScope, ownerInfo(cust))) throw customerErrors.forbidden();
        if (isPrimary) await tx.contact.updateMany({ where: { customerId, isPrimary: true, deletedAt: null }, data: { isPrimary: false, updatedById: actor.employeeId } });
        const c = await tx.contact.create({
          data: { customerId, fullName, title: blank(dto.title), phone, email, isPrimary, note: blank(dto.note), createdById: actor.employeeId, updatedById: actor.employeeId },
          select: CONTACT_SELECT,
        });
        // Nhật ký không chứa thông tin cá nhân của người liên hệ (D12).
        await this.audit.record(tx, { action: 'contact.create', entityType: 'contact', entityId: c.id, entityCode: c.code, summary: 'Thêm liên hệ ' + c.code + ' cho khách hàng ' + cust.code, changes: { isPrimary: [false, isPrimary] }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
        return toContact(c);
      }, { maxWait: 5000, timeout: 20000 });
    } catch (e) {
      if (e instanceof DomainException) throw e;
      const m = mapPrismaError(e);
      if (m) throw m;
      throw e;
    }
  }

  // ───── FV-3: sửa / xoá mềm (Owner 08/11/2026, phương án A) ─────
  // Quyền ghi = customer.update trong phạm vi của TỪNG khách chủ quản (không có mã quyền contact.update/delete).
  // Không thấy khách/liên hệ (customer.read hoặc contact.read ngoài phạm vi) => 404; thấy nhưng không có customer.update trên khách đó => 403.

  async update(ctx: RequestCtx, customerId: string, contactId: string, dto: UpdateContactDto) {
    const { actor } = ctx;
    const expected = this.checkStamp(dto.updatedAt);
    const fullName = dto.fullName === undefined ? undefined : (dto.fullName ?? '').trim();
    const vals: Partial<Record<(typeof OPTIONAL_FIELDS)[number], string | null>> = {};
    for (const k of OPTIONAL_FIELDS) { const v = patchVal(dto[k]); if (v !== undefined) vals[k] = v; }
    const errs: string[] = [];
    if (fullName !== undefined && !fullName) errs.push('Vui lòng nhập họ tên người liên hệ');
    if (vals.phone && !isVnPhone(vals.phone)) errs.push(PHONE_MESSAGE);
    if (vals.email && !isEmailB1(vals.email)) errs.push(EMAIL_MESSAGE);
    if (errs.length) throw customerErrors.validation(errs);
    const scopes = this.writeScopes(actor);
    return this.inTx(async (tx) => {
      const { cust, cur } = await this.loadForWrite(tx, actor, scopes, customerId, contactId, expected);
      const data: Record<string, unknown> = {};
      if (fullName !== undefined && fullName !== cur.fullName) data.fullName = fullName;
      for (const k of OPTIONAL_FIELDS) if (vals[k] !== undefined && vals[k] !== cur[k]) data[k] = vals[k];
      if (dto.isPrimary !== undefined && dto.isPrimary !== cur.isPrimary) data.isPrimary = dto.isPrimary;
      const fields = Object.keys(data).sort();
      if (!fields.length) return toContact(cur); // không thay đổi: không ghi, không nhật ký, giữ updatedAt
      const changes: Record<string, unknown> = { fields };
      if (data.isPrimary === true) {
        await tx.contact.updateMany({ where: { customerId, isPrimary: true, deletedAt: null, id: { not: contactId } }, data: { isPrimary: false, updatedById: actor.employeeId } });
      }
      if ('isPrimary' in data) changes.isPrimary = [cur.isPrimary, data.isPrimary];
      const r = await tx.contact.updateMany({ where: { id: contactId, customerId, deletedAt: null, updatedAt: cur.updatedAt }, data: { ...data, updatedById: actor.employeeId, updatedAt: nextStamp(cur.updatedAt) } });
      if (r.count !== 1) throw customerErrors.contactVersionConflict(cur.updatedAt.toISOString());
      // Nhật ký chỉ ghi TÊN trường đổi, không ghi giá trị (thông tin cá nhân — D12).
      await this.audit.record(tx, { action: 'contact.update', entityType: 'contact', entityId: contactId, entityCode: cur.code, summary: 'Sửa liên hệ ' + cur.code + ' của khách hàng ' + cust.code, changes, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      return toContact(await tx.contact.findUniqueOrThrow({ where: { id: contactId }, select: CONTACT_SELECT }));
    });
  }

  async remove(ctx: RequestCtx, customerId: string, contactId: string, dto: DeleteContactDto) {
    const { actor } = ctx;
    const expected = this.checkStamp(dto.updatedAt);
    const scopes = this.writeScopes(actor);
    return this.inTx(async (tx) => {
      const { cust, cur } = await this.loadForWrite(tx, actor, scopes, customerId, contactId, expected);
      const now = nextStamp(cur.updatedAt);
      // Xoá MỀM: chỉ UPDATE deleted_at/deleted_by; không DELETE vật lý (app không có quyền DELETE trên contact).
      const r = await tx.contact.updateMany({ where: { id: contactId, customerId, deletedAt: null, updatedAt: cur.updatedAt }, data: { deletedAt: now, deletedById: actor.employeeId, updatedById: actor.employeeId, updatedAt: now } });
      if (r.count !== 1) throw customerErrors.contactVersionConflict(cur.updatedAt.toISOString());
      await this.audit.record(tx, { action: 'contact.delete', entityType: 'contact', entityId: contactId, entityCode: cur.code, summary: 'Xoá mềm liên hệ ' + cur.code + ' của khách hàng ' + cust.code, changes: { wasPrimary: cur.isPrimary }, actorEmployeeId: actor.employeeId, requestId: ctx.requestId });
      return { id: cur.id, code: cur.code };
    });
  }

  private checkStamp(v: unknown): Date {
    const d = parseStamp(v);
    if (!d) throw customerErrors.validation(['Thiếu hoặc sai mốc cập nhật (updatedAt) của người liên hệ']);
    return d;
  }

  private writeScopes(actor: Actor) {
    return { read: this.scopeOf(actor, 'customer.read'), contactRead: this.scopeOf(actor, 'contact.read'), update: this.scopeOf(actor, 'customer.update') };
  }

  // Khoá dòng khách TRƯỚC (cùng thứ tự với tạo liên hệ / sửa / xoá khách) => mọi lần ghi liên hệ của một khách tuần tự hoá.
  private async loadForWrite(tx: Tx, actor: Actor, s: { read: Scope; contactRead: Scope; update: Scope }, customerId: string, contactId: string, expected: Date) {
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer WHERE id = ${customerId}::uuid FOR UPDATE`;
    if (!locked.length) throw customerErrors.notFound();
    const cust = await tx.customer.findFirst({ where: { id: customerId }, select: CUSTOMER_PICK });
    if (!cust || !inScope(actor, s.read, ownerInfo(cust)) || !inScope(actor, s.contactRead, ownerInfo(cust))) throw customerErrors.notFound();
    if (cust.deletedAt) throw new DomainException(409, 'CUSTOMER_DELETED', 'Khách hàng đã bị xoá, không thể sửa hoặc xoá liên hệ.');
    if (!inScope(actor, s.update, ownerInfo(cust))) throw customerErrors.forbidden();
    const cur = await tx.contact.findFirst({ where: { id: contactId, customerId, deletedAt: null }, select: CONTACT_SELECT });
    if (!cur) throw customerErrors.contactNotFound();
    if (cur.updatedAt.getTime() !== expected.getTime()) throw customerErrors.contactVersionConflict(cur.updatedAt.toISOString());
    return { cust, cur };
  }

  private async inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, { maxWait: 5000, timeout: 20000 });
    } catch (e) {
      if (e instanceof DomainException) throw e;
      const m = mapPrismaError(e);
      if (m) throw m;
      throw e;
    }
  }
}
