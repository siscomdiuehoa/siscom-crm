import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestCtx } from '../../common/auth/actor';
import { ActivitiesService } from './activities.service';
import type { CreateActivityDto } from './dto/create-activity.dto';

// Sales S9a — §5.5(b): cổng nội bộ để SERVICE SALES tạo hoạt động / công việc TỪ một cơ hội (POST /opportunities/:id/activities).
// KHÔNG phải endpoint. Nơi gọi (OpportunityActivitiesService) đã, trong CÙNG transaction: khoá khách FOR SHARE + cơ hội FOR UPDATE và kiểm người
// gọi đạt opportunity.update trên cơ hội. Cổng này kiểm hai điều còn lại của §5.5(b) rồi ghi:
//   2. mã hoạt động đang hiệu lực (activity.create, hoặc activity.create_tech với 3 loại kỹ thuật) — ở BẤT KỲ phạm vi;
//   3. người nhận của MỌI TASK — kể cả để mặc định / tự chọn chính mình (PR245-R1-01): đúng quy tắc B3 — ACTIVE, cùng phòng người giao trừ khi activity.assign = ALL; đọc được khách => giao
//      nội bộ; không đọc được => chỉ TASK, external=true, người giao có activity.assign_external, người nhận có thẩm quyền kỹ thuật, cấp
//      activity_access theo B3 §5.4 trong cùng transaction.
// "Phạm vi do quyền trên cơ hội quyết định" CHỈ tồn tại ở đường này; /customers/:id/activities và /activities… vẫn tính theo khách như B3.
export const OPPORTUNITY_ACTIVITIES = Symbol('OPPORTUNITY_ACTIVITIES');

@Injectable()
export class OpportunityActivityGate {
  constructor(private readonly activities: ActivitiesService) {}

  createForOpportunity(tx: Prisma.TransactionClient, ctx: RequestCtx, opportunity: { id: string; customerId: string; contactId: string | null }, dto: CreateActivityDto) {
    return this.activities.createForOpportunity(tx, ctx, opportunity, dto);
  }
}
