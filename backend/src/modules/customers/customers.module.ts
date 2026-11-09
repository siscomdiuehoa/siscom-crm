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
import { CustomersExportController } from './export/customers-export.controller';
import { CustomersExportService, DbExportAccess, EXPORT_ACCESS, EXPORT_CONFIG, exportConfigFromEnv } from './export/customers-export.service';

@Module({
  // B3 A6: ActivitiesModule chỉ export ACTIVITY_CUSTOMER_HOOKS (thu hồi quyền theo việc khi xoá mềm khách).
  imports: [AuthModule, AuditModule, PrismaModule, ActivitiesModule],
  controllers: [CustomersController, ContactsController, CustomersExportController],
  providers: [
    CustomersService,
    ContactsService,
    // Chưa có kiểm tra liên kết nghiệp vụ thật => DELETE khoá. Không có cấu hình bypass.
    { provide: ACTIVE_LINKS_CHECKER, useClass: UnverifiedLinksChecker },
    // FV-4A: xuất CSV phía máy chủ.
    CustomersExportService,
    { provide: EXPORT_ACCESS, useClass: DbExportAccess },
    { provide: EXPORT_CONFIG, useFactory: () => exportConfigFromEnv() },
  ],
})
export class CustomersModule {}
