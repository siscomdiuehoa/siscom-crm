import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerOpportunitiesController, OpportunitiesController } from './opportunities.controller';
import { DbOppEmployeeAccess, OPP_EMPLOYEE_ACCESS } from './opportunities.employee-access';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityWritesService } from './opportunities.write.service';

// Sales S6: đọc (danh sách, chi tiết, theo khách). Sales S7: ghi (tạo, sửa, đổi giai đoạn) + lịch sử — mọi lần ghi có nhật ký (AuditModule).
// AuthModule cấp ACTOR_PROVIDER, ActorGuard và cổng ASSIGNEE_ELIGIBILITY (cờ ownerLostAccess).
@Module({
  imports: [AuthModule, AuditModule, PrismaModule],
  controllers: [CustomerOpportunitiesController, OpportunitiesController],
  providers: [OpportunitiesService, OpportunityWritesService, { provide: OPP_EMPLOYEE_ACCESS, useClass: DbOppEmployeeAccess }],
})
export class OpportunitiesModule {}
