import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { DomainException } from '../../errors/domain.exception';
import { ACTOR_BINDING_VERIFIER, ActorBindingVerifier, AuthedPrivRequest } from './privileged.types';
import { PrivilegedReadinessService } from './privileged-readiness.service';

// Dùng SAU ActorGuard cho mọi route đặc quyền tương lai: @UseGuards(ActorGuard, PrivilegedReadyGuard).
// Từ chối theo thứ tự: cổng chưa sẵn sàng (503) -> không có danh tính ràng buộc (401) -> danh tính lệch phiên (403).
// Không đọc body/query/header để lấy danh tính; chỉ tin kết quả của ActorBindingVerifier.
@Injectable()
export class PrivilegedReadyGuard implements CanActivate {
  constructor(
    private readonly readiness: PrivilegedReadinessService,
    @Optional() @Inject(ACTOR_BINDING_VERIFIER) private readonly verifier?: ActorBindingVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await this.readiness.isReady()) || !this.verifier) {
      throw new DomainException(503, 'PRIVILEGED_UNAVAILABLE', 'Chức năng đặc quyền hiện không khả dụng.');
    }
    const req = context.switchToHttp().getRequest<AuthedPrivRequest>();
    let bound = null;
    try {
      bound = await this.verifier.verify(req);
    } catch {
      bound = null;
    }
    if (!bound || typeof bound.employeeId !== 'string' || !bound.employeeId || typeof bound.proof !== 'string' || !bound.proof) {
      throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    }
    if (!req.actor || req.actor.employeeId !== bound.employeeId) {
      throw new DomainException(403, 'ACTOR_MISMATCH', 'Danh tính không khớp phiên.');
    }
    req.privilegedActor = bound;
    return true;
  }
}
