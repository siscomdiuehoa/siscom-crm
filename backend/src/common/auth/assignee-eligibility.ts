import { Injectable, Logger } from '@nestjs/common';
import { AuthPrismaService } from '../../prisma/auth-prisma.service';

// Sales S5 (docs/SALES_DESIGN.md §5.4 "Nguồn kiểm trạng thái tài khoản của người nhận", PR234-R3-DESIGN-01).
// Cổng NỘI BỘ của module auth: cho phần nghiệp vụ biết MỘT cờ cho mỗi nhân viên — tài khoản có dùng được hay không — mà pool nghiệp vụ
// (siscom_app) không phải đọc employee_credential (APP_GRANTS: app không có quyền nào trên bảng đó, VERIFY mục B1e).
//  - Chạy trên POOL AUTH (siscom_auth). Chỉ SELECT đúng cột credential.status; không đọc hash, token_version, bộ đếm khoá.
//  - Trả đúng một boolean cho mỗi id; không trả lý do, không trả trường nào của credential.
//  - Fail-closed: id lạ, id không hợp lệ, truy vấn lỗi => false cho MỌI id trong lần gọi (người gọi sẽ từ chối, không ghi gì).
//  - KHÔNG có endpoint công khai nào tra trạng thái tài khoản; chỉ service Sales dùng (người nhận cơ hội + cờ ownerLostAccess).
//  - Người làm công việc (TASK) KHÔNG dùng cổng này: giữ hợp đồng B3 §5 (chỉ employee.status = ACTIVE).

// MỘT tiêu chí dùng chung với SessionActorProvider (người đang đăng nhập): nhân viên ACTIVE, chưa xoá mềm, credential tồn tại và ACTIVE.
// Khoá tạm do nhập sai (locked_until) KHÔNG tính — đúng như phiên hiện nay; đây không phải cam kết lần đăng nhập kế tiếp sẽ thành công.
export interface SignInFacts {
  status: string;
  deletedAt: Date | null;
  credential: { status: string } | null;
}
export function accountUsable(e: SignInFacts): boolean {
  return e.status === 'ACTIVE' && e.deletedAt === null && e.credential?.status === 'ACTIVE';
}

export interface AssigneeEligibility {
  // Map có ĐỦ mọi id được hỏi (đã khử trùng); thiếu dữ liệu => false.
  canSignIn(employeeIds: readonly string[]): Promise<ReadonlyMap<string, boolean>>;
}
export const ASSIGNEE_ELIGIBILITY = Symbol('ASSIGNEE_ELIGIBILITY');

@Injectable()
export class AuthPoolAssigneeEligibility implements AssigneeEligibility {
  private readonly log = new Logger('AssigneeEligibility');

  constructor(private readonly prisma: AuthPrismaService) {}

  async canSignIn(employeeIds: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    const out = new Map<string, boolean>();
    for (const id of employeeIds) out.set(id, false);
    if (out.size === 0) return out;
    try {
      const rows = await this.prisma.employee.findMany({
        where: { id: { in: [...out.keys()] } },
        select: { id: true, status: true, deletedAt: true, credential: { select: { status: true } } },
      });
      for (const e of rows) if (out.has(e.id)) out.set(e.id, accountUsable(e));
    } catch (err) {
      // Không ghi id / dữ liệu tài khoản vào log; chỉ ghi loại lỗi.
      this.log.warn('Không kiểm được trạng thái tài khoản (fail-closed): ' + (err instanceof Error ? err.name : 'lỗi'));
      for (const id of out.keys()) out.set(id, false);
    }
    return out;
  }
}
