import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException } from '../errors/domain.exception';
import { ACTOR_PROVIDER, ActorProvider, AuthedRequest, Permission } from './actor';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './permissions.decorator';

// B1.3 M1.3 — guard TOÀN CỤC (APP_GUARD trong AuthModule), chạy TRƯỚC guard của controller và trước pipe/handler (chưa chạm database).
// Thứ tự: @Public => cho qua | thiếu khai báo quyền => 403 | danh tính CHỈ từ ActorProvider (không đọc header/body/query) => null = 401
//   | thiếu bất kỳ quyền nào đã khai báo => 403. Phạm vi trên bản ghi (IDOR) vẫn do service kiểm.
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACTOR_PROVIDER) private readonly provider: ActorProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets) === true;
    const perms = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets);
    const declared = Array.isArray(perms) && perms.length > 0;
    if (isPublic && !declared) return true;
    if (!declared || isPublic) throw new DomainException(403, 'FORBIDDEN', 'Không có quyền thực hiện thao tác này.');
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const actor = await this.provider.resolve(req);
    // Fail-closed: actor sai hình dạng (thiếu/rỗng employeeId) coi như chưa xác thực; scope lạ (ngoài ALL/DEPARTMENT/OWN) coi như không có quyền.
    if (!actor || typeof actor.employeeId !== 'string' || actor.employeeId.length === 0) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    for (const p of perms) {
      const scope = this.provider.scopeFor(actor, p);
      if (scope !== 'ALL' && scope !== 'DEPARTMENT' && scope !== 'OWN') throw new DomainException(403, 'FORBIDDEN', 'Không có quyền thực hiện thao tác này.');
    }
    req.actor = actor;
    return true;
  }
}
