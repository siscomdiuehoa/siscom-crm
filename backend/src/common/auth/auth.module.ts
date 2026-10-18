import { Inject, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ACTOR_PROVIDER, ActorProvider } from './actor';
import { ActorGuard } from './actor.guard';
import { DenyAllActorProvider } from './deny-all-actor.provider';

// Cho tới khi có đăng nhập thật (B1.3), provider là DenyAll: mọi route dùng ActorGuard trả 401.
// Chỉ test mới thay provider (overrideProvider); không có đường cấu hình nào ở production.
@Module({
  providers: [{ provide: ACTOR_PROVIDER, useClass: DenyAllActorProvider }, ActorGuard],
  exports: [ACTOR_PROVIDER, ActorGuard],
})
export class AuthModule implements OnModuleInit {
  constructor(@Inject(ACTOR_PROVIDER) private readonly provider: ActorProvider) {}

  onModuleInit(): void {
    if (this.provider instanceof DenyAllActorProvider) {
      new Logger('Auth').warn('Customer API đang ở chế độ TỪ CHỐI TẤT CẢ (401): chưa có xác thực thật. Đây là chủ ý cho tới B1.3.');
    }
  }
}
