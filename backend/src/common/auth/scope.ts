import type { Actor, Scope } from './actor';

export interface OwnerInfo {
  ownerId: string | null;
  ownerDepartmentId: string | null;
}

// Fail-closed: phạm vi không xác định, khách không có chủ sở hữu (với OWN/DEPARTMENT), nhân viên không có phòng ban (DEPARTMENT) => false.
export function inScope(actor: Actor, scope: Scope | null, c: OwnerInfo): boolean {
  switch (scope) {
    case 'ALL': return true;
    case 'OWN': return c.ownerId !== null && c.ownerId === actor.employeeId;
    case 'DEPARTMENT': return actor.departmentId !== null && c.ownerDepartmentId === actor.departmentId;
    default: return false;
  }
}
