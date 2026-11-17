import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerOpportunitiesController, OpportunitiesController } from './opportunities.controller';
import { DbOppEmployeeAccess, OPP_EMPLOYEE_ACCESS } from './opportunities.employee-access';
import { OpportunitiesService } from './opportunities.service';

// Sales S6: module Cơ hội — chỉ ĐỌC (danh sách, chi tiết, theo khách). Không ghi bảng nào => chưa cần AuditModule (S7 thêm khi có ghi).
// AuthModule cấp ACTOR_PROVIDER, ActorGuard và cổng ASSIGNEE_ELIGIBILITY (cờ ownerLostAccess).
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [CustomerOpportunitiesController, OpportunitiesController],
  providers: [OpportunitiesService, { provide: OPP_EMPLOYEE_ACCESS, useClass: DbOppEmployeeAccess }],
})
export class OpportunitiesModule {}
