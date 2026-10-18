import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';
import { ACTOR_PROVIDER, ActorProvider, AuthedRequest } from './actor';

@Injectable()
export class ActorGuard implements CanActivate {
  constructor(@Inject(ACTOR_PROVIDER) private readonly provider: ActorProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const actor = await this.provider.resolve(req);
    if (!actor) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    req.actor = actor;
    return true;
  }
}
