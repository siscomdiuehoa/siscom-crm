import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivitiesController, ActivityTransferRequestsController, CustomerActivitiesController } from './activities.controller';
import { ACTIVITY_CUSTOMER_HOOKS, ActivityCustomerHooks } from './activities.customer-hooks';
import { DbEmployeeAccess, EMPLOYEE_ACCESS } from './activities.employee-access';
import { OPPORTUNITY_ACTIVITIES, OpportunityActivityGate } from './activities.opportunity-gate';
import { OPPORTUNITY_AUTO_TASKS, OpportunityAutoTasks } from './activities.opportunity-tasks';
import { ActivitiesService } from './activities.service';
import { ActivityTasksService } from './activities.tasks.service';
import { ActivityTransfersService } from './activities.transfers.service';

// B3 A5: module Hoạt động (timeline, tạo, ứng viên phụ trách). Ghi cần APP_GRANTS_V4 (INSERT/UPDATE activity cho siscom_app) — đã trên main.
// B3 A6: danh sách việc, chuông, chi tiết/sửa/giao/hoàn thành/mở lại/huỷ/xoá mềm, lịch sử, quyền theo việc (§5.4), đề xuất chuyển (§5.5).
// Export DUY NHẤT ACTIVITY_CUSTOMER_HOOKS cho module customers (thu hồi quyền theo việc khi xoá mềm khách).
@Module({
  imports: [AuthModule, AuditModule, PrismaModule],
  controllers: [CustomerActivitiesController, ActivitiesController, ActivityTransferRequestsController],
  providers: [ActivitiesService, ActivityTasksService, ActivityTransfersService, { provide: EMPLOYEE_ACCESS, useClass: DbEmployeeAccess },
    { provide: ACTIVITY_CUSTOMER_HOOKS, useClass: ActivityCustomerHooks },
    // Sales S8b: cổng việc tự sinh của cơ hội (việc nhắc tạm hoãn, việc bàn giao) — chỉ module Cơ hội dùng, trong transaction của nó.
    { provide: OPPORTUNITY_AUTO_TASKS, useClass: OpportunityAutoTasks },
    // Sales S9a: cổng tạo hoạt động từ cơ hội (§5.5(b)) — chỉ module Cơ hội dùng, trong transaction của nó.
    { provide: OPPORTUNITY_ACTIVITIES, useClass: OpportunityActivityGate }],
  exports: [ACTIVITY_CUSTOMER_HOOKS, OPPORTUNITY_AUTO_TASKS, OPPORTUNITY_ACTIVITIES],
})
export class ActivitiesModule {}
