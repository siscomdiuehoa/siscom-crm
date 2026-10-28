import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ACTOR_PROVIDER } from '../../common/auth/actor';
import { SessionActorProvider } from '../../common/auth/session/session-actor.provider';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Module nghiệp vụ xác thực (route /auth/*). Dùng ACTOR_PROVIDER đã bind trong common AuthModule; AuthService cần đúng
// SessionActorProvider (tra phiên sau khi cấp) nên lấy qua token ACTOR_PROVIDER (không tạo instance thứ hai).
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, { provide: SessionActorProvider, useExisting: ACTOR_PROVIDER }],
})
export class AuthApiModule {}
