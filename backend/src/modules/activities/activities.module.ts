import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivitiesController, CustomerActivitiesController } from './activities.controller';
import { DbEmployeeAccess, EMPLOYEE_ACCESS } from './activities.employee-access';
import { ActivitiesService } from './activities.service';

// B3 A5: module Hoạt động (timeline, tạo, ứng viên phụ trách). Ghi cần APP_GRANTS_V4 (INSERT/UPDATE activity cho siscom_app) — đã trên main.
@Module({
  imports: [AuthModule, AuditModule, PrismaModule],
  controllers: [CustomerActivitiesController, ActivitiesController],
  providers: [ActivitiesService, { provide: EMPLOYEE_ACCESS, useClass: DbEmployeeAccess }],
})
export class ActivitiesModule {}
