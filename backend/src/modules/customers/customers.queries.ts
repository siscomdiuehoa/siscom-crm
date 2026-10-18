import type { Prisma } from '../../generated/prisma/client';
import type { Actor, Scope } from '../../common/auth/actor';

export const CUSTOMER_DETAIL_INCLUDE = {
  tier: true,
  status: true,
  industry: true,
  source: true,
  province: true,
  owner: { select: { id: true, code: true, fullName: true, departmentId: true } },
} satisfies Prisma.CustomerInclude;

const NONE: Prisma.CustomerWhereInput = { id: { in: [] } };

// Điều kiện phạm vi đọc. Fail-closed: không xác định => không khớp dòng nào.
export function scopeWhere(actor: Actor, scope: Scope | null): Prisma.CustomerWhereInput {
  switch (scope) {
    case 'ALL': return {};
    case 'OWN': return { ownerId: actor.employeeId };
    case 'DEPARTMENT': return actor.departmentId ? { owner: { is: { departmentId: actor.departmentId } } } : NONE;
    default: return NONE;
  }
}

// sortBy chỉ nhận từ bảng trắng (đã kiểm ở DTO); phụ theo code giảm dần để thứ tự ổn định.
export function buildOrderBy(sortBy: string, order: 'asc' | 'desc'): Prisma.CustomerOrderByWithRelationInput[] {
  let primary: Prisma.CustomerOrderByWithRelationInput;
  if (sortBy === 'tier') primary = { tier: { sortOrder: order } };
  else if (sortBy === 'status') primary = { status: { sortOrder: order } };
  else if (sortBy === 'code') primary = { code: order };
  else if (sortBy === 'name') primary = { name: order };
  else if (sortBy === 'updatedAt') primary = { updatedAt: order };
  else primary = { createdAt: order };
  return sortBy === 'code' ? [primary] : [primary, { code: 'desc' }];
}
