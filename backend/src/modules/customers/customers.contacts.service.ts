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
import { EMAIL_MESSAGE, isEmailB1 } from './validators/vn-email';
import { isVnPhone, PHONE_MESSAGE } from './validators/vn-phone';

type Tx = Prisma.TransactionClient;
const CONTACT_SELECT = { id: true, code: true, fullName: true, title: true, phone: true, email: true, isPrimary: true, note: true, createdAt: true } as const;
interface ContactRow { id: string; code: string; fullName: string; title: string | null; phone: string | null; email: string | null; isPrimary: boolean; note: string | null; createdAt: Date }
const toContact = (c: ContactRow) => ({ id: c.id, code: c.code, fullName: c.fullName, title: c.title, phone: c.phone, email: c.email, isPrimary: c.isPrimary, note: c.note, createdAt: c.createdAt.toISOString() });
const blank = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());
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
}
