import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivitiesModule } from '../activities/activities.module';
import { ContactsController } from './contacts.controller';
import { CustomersController } from './customers.controller';
import { ContactsService } from './customers.contacts.service';
import { ACTIVE_LINKS_CHECKER, UnverifiedLinksChecker } from './customers.deletion-guard';
import { CustomersService } from './customers.service';

@Module({
  // B3 A6: ActivitiesModule chỉ export ACTIVITY_CUSTOMER_HOOKS (thu hồi quyền theo việc khi xoá mềm khách).
  imports: [AuthModule, AuditModule, PrismaModule, ActivitiesModule],
  controllers: [CustomersController, ContactsController],
  providers: [
    CustomersService,
    ContactsService,
    // Chưa có kiểm tra liên kết nghiệp vụ thật => DELETE khoá. Không có cấu hình bypass.
    { provide: ACTIVE_LINKS_CHECKER, useClass: UnverifiedLinksChecker },
  ],
})
export class CustomersModule {}
