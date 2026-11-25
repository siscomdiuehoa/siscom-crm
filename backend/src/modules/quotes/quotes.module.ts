import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { OpportunityQuotesController, QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { QuotesSetupService } from './quotes.setup.service';
import { QuotesWriteService } from './quotes.write.service';

// Mọi phản hồi của API báo giá — thành công, 4xx của guard / pipe, lỗi — đều không được lưu đệm ở trình duyệt hay máy trung gian
// (docs/QUOTES_DESIGN.md mục 7.2, ca C15). Đặt ở middleware (chạy TRƯỚC guard) nên cả phản hồi 401 / 403 / 404 cũng có tiêu đề này.
export function quoteNoStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

// Báo giá Q4: đọc (danh sách, theo cơ hội, chi tiết, giá trị điền sẵn, loại báo giá, mặc định cá nhân). Q5a: ghi báo giá (mọi lần ghi có nhật ký —
// AuditModule). Q5b: gửi / kết quả / đang theo đuổi. Q6: ghi loại báo giá + mặc định cá nhân (QuotesSetupService).
// AuthModule cấp ACTOR_PROVIDER và ActorGuard. Module chỉ dùng module cơ hội qua các hàm chính sách đã export (opportunities.access).
@Module({
  imports: [AuthModule, AuditModule, PrismaModule],
  controllers: [OpportunityQuotesController, QuotesController],
  providers: [QuotesService, QuotesWriteService, QuotesSetupService],
})
export class QuotesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(quoteNoStore).forRoutes(OpportunityQuotesController, QuotesController);
  }
}
