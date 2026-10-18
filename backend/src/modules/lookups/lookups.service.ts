import { Inject, Injectable } from '@nestjs/common';
import { ACTOR_PROVIDER, ActorProvider, RequestCtx } from '../../common/auth/actor';
import { DomainException } from '../../common/errors/domain.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { QueryLookupsDto } from './dto/query-lookups.dto';

export const LOOKUP_ALLOWED_TYPES: readonly string[] = ['customer_tier', 'customer_status', 'industry', 'source', 'province'];

@Injectable()
export class LookupsService {
  constructor(private readonly prisma: PrismaService, @Inject(ACTOR_PROVIDER) private readonly actors: ActorProvider) {}

  // Chỉ đọc. Không trả id nội bộ/isSystem; chỉ mục đang hoạt động. Client gửi MÃ (code), không gửi uuid.
  async list(ctx: RequestCtx, q: QueryLookupsDto) {
    if (!this.actors.scopeFor(ctx.actor, 'lookup.read')) throw new DomainException(403, 'FORBIDDEN', 'Không có quyền thực hiện thao tác này.');
    const types = [...new Set(q.type.split(',').map((t) => t.trim()).filter(Boolean))];
    if (types.length === 0 || types.length > LOOKUP_ALLOWED_TYPES.length || types.some((t) => !LOOKUP_ALLOWED_TYPES.includes(t))) {
      throw new DomainException(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', ['Loại danh mục không hợp lệ. Cho phép: ' + LOOKUP_ALLOWED_TYPES.join(', ') + '.']);
    }
    const rows = await this.prisma.lookupItem.findMany({
      where: { type: { in: types }, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { labelVi: 'asc' }],
      select: { type: true, code: true, labelVi: true, sortOrder: true, isActive: true },
    });
    const out: Record<string, { code: string; label: string; sortOrder: number; isActive: boolean }[]> = {};
    for (const t of types) out[t] = [];
    for (const r of rows) out[r.type]?.push({ code: r.code, label: r.labelVi, sortOrder: r.sortOrder, isActive: r.isActive });
    return out;
  }
}
