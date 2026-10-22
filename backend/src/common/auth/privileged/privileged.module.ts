import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { PrivilegedHealthController } from './privileged-health.controller';
import { PrivilegedReadyGuard } from './privileged-ready.guard';
import { PrivilegedReadinessService } from './privileged-readiness.service';

// Cổng fail-closed cho API đặc quyền. KHÔNG đăng ký probe/verifier mặc định: chúng chỉ xuất hiện khi giai đoạn 2
// (docs/B1.3_F01_PHASE2_ARCHITECTURE.md) được triển khai và duyệt. Thiếu => cổng đóng.
@Module({
  imports: [AuthModule],
  controllers: [PrivilegedHealthController],
  providers: [PrivilegedReadinessService, PrivilegedReadyGuard],
  exports: [PrivilegedReadinessService, PrivilegedReadyGuard],
})
export class PrivilegedModule {}
