import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { effectiveAccessOf, EmployeeAccess } from '../../common/auth/scope-merge';

// Nguồn phạm vi quyền của NGƯỜI KHÁC (người được giao việc, ứng viên phụ trách). Bản thật đọc vai trò trong DB qua pool nghiệp vụ.
// Chỉ dùng làm điều kiện THU HẸP (AND), không bao giờ cấp quyền cho người gọi (thiết kế §5).
export interface EmployeeAccessReader {
  load(db: Pick<Prisma.TransactionClient, 'employee'>, ids: readonly string[]): Promise<Map<string, EmployeeAccess>>;
}
export const EMPLOYEE_ACCESS = Symbol('EMPLOYEE_ACCESS');

@Injectable()
export class DbEmployeeAccess implements EmployeeAccessReader {
  load(db: Pick<Prisma.TransactionClient, 'employee'>, ids: readonly string[]): Promise<Map<string, EmployeeAccess>> {
    return effectiveAccessOf(db, ids);
  }
}
