import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';
import type { AuthedRequest, RequestCtx } from './actor';

export const CurrentCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestCtx => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.actor) throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
  return { actor: req.actor, requestId: req.requestId };
});
