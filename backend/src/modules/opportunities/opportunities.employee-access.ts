import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { effectiveAccessOf, EmployeeAccess } from '../../common/auth/scope-merge';

// Sales S6 — nguồn quyền hiệu lực của NGƯỜI KHÁC (người phụ trách cơ hội; từ S8: người nhận khi chuyển). Bản thật đọc vai trò trong DB qua pool
// nghiệp vụ bằng CHÍNH hàm hợp nhất của SessionActorProvider (effectiveAccessOf). Chỉ dùng làm điều kiện THU HẸP / cờ hiển thị — không bao giờ
// cấp quyền cho người gọi. Provider riêng của module (không import nội bộ module activities); test thay bằng bảng do test đặt.
export interface OppEmployeeAccessReader {
  load(db: Pick<Prisma.TransactionClient, 'employee'>, ids: readonly string[]): Promise<Map<string, EmployeeAccess>>;
}
export const OPP_EMPLOYEE_ACCESS = Symbol('OPP_EMPLOYEE_ACCESS');

@Injectable()
export class DbOppEmployeeAccess implements OppEmployeeAccessReader {
  load(db: Pick<Prisma.TransactionClient, 'employee'>, ids: readonly string[]): Promise<Map<string, EmployeeAccess>> {
    return effectiveAccessOf(db, ids);
  }
}
