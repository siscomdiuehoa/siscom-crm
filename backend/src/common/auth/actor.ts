import type { Request } from 'express';

// 8 quyền đã chốt (N5). Việc CẤP quyền (vai trò, ma trận) thuộc B1.3; ở đây chỉ định nghĩa hợp đồng.
export type Permission =
  | 'customer.read' | 'customer.create' | 'customer.update' | 'customer.delete' | 'customer.restore'
  | 'contact.read' | 'contact.create' | 'lookup.read'
  // B3 A4 (docs/B3_ACTIVITIES_DESIGN.md §5): luật theo vai trò tách thành mã quyền riêng — Actor KHÔNG mang vai trò.
  | 'activity.read' | 'activity.create' | 'activity.create_tech' | 'activity.update' | 'activity.update_own'
  | 'activity.assign' | 'activity.delete' | 'activity.assign_external' | 'activity.transfer_request'
  // FV-4A (đặc tả FV4A bản 5 §1): quyền xuất riêng; phạm vi xuất = phạm vi HẸP hơn giữa customer.read và customer.export.
  | 'customer.export';
// B3 A4: 9 mã quyền hoạt động (dùng cho kiểm nhất quán KNOWN / ALL_PERMS / BIZ / script cấp quyền 2 người).
export const ACTIVITY_PERMISSIONS: readonly Permission[] = ['activity.read', 'activity.create', 'activity.create_tech', 'activity.update', 'activity.update_own', 'activity.assign', 'activity.delete', 'activity.assign_external', 'activity.transfer_request'];
export type Scope = 'ALL' | 'DEPARTMENT' | 'OWN';

export interface Actor {
  employeeId: string;
  departmentId: string | null;
}
export interface RequestCtx {
  actor: Actor;
  requestId?: string;
}
export type AuthedRequest = Request & { actor?: Actor; requestId?: string };

export interface ActorProvider {
  // null = chưa xác thực.
  resolve(req: Request): Promise<Actor | null>;
  // null = không có quyền. Không khai báo = không có quyền (fail-closed).
  scopeFor(actor: Actor, permission: Permission): Scope | null;
}
export const ACTOR_PROVIDER = Symbol('ACTOR_PROVIDER');
