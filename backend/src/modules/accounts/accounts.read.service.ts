import { Inject, Injectable } from '@nestjs/common';
import { ACTOR_PROVIDER } from '../../common/auth/actor';
import type { ActorProvider, RequestCtx } from '../../common/auth/actor';
import type { Prisma } from '../../generated/prisma/client';
import { AcctPrismaService } from '../../prisma/acct-prisma.service';
import { accountErrors } from './accounts.errors';
import {
  ACCOUNT_ROLE_CODES, ACCOUNT_STATUS_FILTERS, ACCOUNTS_PAGE_SIZE_DEFAULT, ACCOUNTS_PAGE_SIZE_MAX, GRANTABLE_ROLE_CODES, QueryAccountsDto,
} from './dto/query-accounts.dto';

// P1 Task 4 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.5): API ĐỌC của trang Tài khoản.
//  - Chỉ người có access.approve (Quản trị CRM). Kiểm quyền TRƯỚC khi chạm pool: người không có quyền luôn nhận 403, kể cả khi chức năng chưa bật.
//  - Mọi truy vấn đi qua pool siscom_acct (AcctPrismaService) — role này chỉ đọc được employee / employee_role / role / department và 5 cột
//    trạng thái của employee_credential; vì vậy select bên dưới KHÔNG BAO GIỜ nhắc tới password_hash / params / algo (PostgreSQL sẽ từ chối).
export type AccountLogin = 'ACTIVE' | 'MUST_CHANGE' | 'DISABLED' | 'NONE';
export interface AccountRow {
  id: string; code: string; fullName: string; email: string | null; departmentId: string | null; departmentName: string | null; positionTitle: string | null;
  roles: string[]; login: AccountLogin; isSystem: boolean; isSelf: boolean; updatedAt: string;
}
export interface AccountList { items: AccountRow[]; page: number; pageSize: number; total: number; totalPages: number }

// Vai trò đánh dấu tài khoản hệ thống (đứng tên yêu cầu thay cho người bấm; không thao tác được qua giao diện).
export const SYSTEM_ROLE_CODE = 'admin';

export const ACCOUNT_SELECT = {
  id: true, code: true, fullName: true, email: true, departmentId: true, positionTitle: true, updatedAt: true,
  department: { select: { name: true } },
  roles: { select: { role: { select: { code: true } } } },
  credential: { select: { status: true, mustChangePassword: true } },
} as const;
interface AccountDbRow {
  id: string; code: string; fullName: string; email: string | null; departmentId: string | null; positionTitle: string | null; updatedAt: Date;
  department: { name: string } | null; roles: { role: { code: string } }[]; credential: { status: string; mustChangePassword: boolean } | null;
}
type AcctDb = Pick<Prisma.TransactionClient, 'employee' | 'role' | 'department'>;

export function toAccountRow(e: AccountDbRow, selfId: string): AccountRow {
  const roles = e.roles.map((r) => r.role.code).sort();
  const login: AccountLogin = e.credential === null ? 'NONE' : e.credential.status !== 'ACTIVE' ? 'DISABLED' : e.credential.mustChangePassword ? 'MUST_CHANGE' : 'ACTIVE';
  return {
    id: e.id, code: e.code, fullName: e.fullName, email: e.email, departmentId: e.departmentId, departmentName: e.department?.name ?? null, positionTitle: e.positionTitle,
    roles, login, isSystem: roles.includes(SYSTEM_ROLE_CODE), isSelf: e.id === selfId, updatedAt: e.updatedAt.toISOString(),
  };
}

@Injectable()
export class AccountsReadService {
  constructor(private readonly acct: AcctPrismaService, @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider) {}

  // Cổng quyền dùng chung cho mọi API của module (đọc và ghi).
  requireManager(ctx: RequestCtx): void {
    if (this.actors.scopeFor(ctx.actor, 'access.approve') === null) throw accountErrors.forbidden();
  }

  async list(ctx: RequestCtx, q: QueryAccountsDto): Promise<AccountList> {
    this.requireManager(ctx);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? ACCOUNTS_PAGE_SIZE_DEFAULT;
    const errs: string[] = [];
    if (!Number.isInteger(page) || page < 1) errs.push('page phải là số nguyên từ 1.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACCOUNTS_PAGE_SIZE_MAX) errs.push('pageSize phải từ 1 đến ' + ACCOUNTS_PAGE_SIZE_MAX + '.');
    const search = q.q === undefined ? undefined : q.q.trim();
    if (search !== undefined && search.length < 2) errs.push('Từ khoá tìm kiếm cần ít nhất 2 ký tự.');
    if (q.role !== undefined && !(ACCOUNT_ROLE_CODES as readonly string[]).includes(q.role)) errs.push('Vai trò không hợp lệ.');
    if (q.status !== undefined && !(ACCOUNT_STATUS_FILTERS as readonly string[]).includes(q.status)) errs.push('Trạng thái không hợp lệ.');
    if (errs.length) throw accountErrors.validation(errs);

    const filters: Prisma.EmployeeWhereInput[] = [{ deletedAt: null }];
    if (search) filters.push({ OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] });
    if (q.role) filters.push({ roles: { some: { role: { code: q.role } } } });
    if (q.status) filters.push({ credential: { is: { status: q.status } } });
    const where: Prisma.EmployeeWhereInput = { AND: filters };

    // count và rows trong MỘT transaction chỉ đọc => cùng một ảnh chụp, tổng khớp danh sách.
    return this.acct.client().$transaction(async (tx) => {
      const total = await tx.employee.count({ where });
      const rows = total === 0 ? [] : await tx.employee.findMany({ where, orderBy: [{ code: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: ACCOUNT_SELECT });
      return { items: (rows as AccountDbRow[]).map((e) => toAccountRow(e, ctx.actor.employeeId)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
    });
  }

  // Năm vai trò của hệ thống theo thứ tự cố định; grantable = cấp được qua giao diện.
  async roles(ctx: RequestCtx): Promise<{ code: string; name: string; grantable: boolean }[]> {
    this.requireManager(ctx);
    const rows = await this.acct.client().role.findMany({ where: { code: { in: [...ACCOUNT_ROLE_CODES] } }, select: { code: true, name: true } });
    const byCode = new Map(rows.map((r) => [r.code, r.name]));
    return ACCOUNT_ROLE_CODES.filter((c) => byCode.has(c)).map((c) => ({ code: c, name: byCode.get(c) as string, grantable: (GRANTABLE_ROLE_CODES as readonly string[]).includes(c) }));
  }

  async departments(ctx: RequestCtx): Promise<{ id: string; name: string }[]> {
    this.requireManager(ctx);
    return this.acct.client().department.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }], select: { id: true, name: true } });
  }

  // Một dòng theo id trên kết nối / transaction đã có (đường ghi trả lại dòng sau thao tác). Không thấy hoặc đã xoá => 404.
  async rowById(db: AcctDb, id: string, selfId: string): Promise<AccountRow> {
    const e = await db.employee.findFirst({ where: { id, deletedAt: null }, select: ACCOUNT_SELECT });
    if (!e) throw accountErrors.notFound();
    return toAccountRow(e as AccountDbRow, selfId);
  }
}
