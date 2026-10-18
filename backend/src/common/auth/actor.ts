import type { Request } from 'express';

// 8 quyền đã chốt (N5). Việc CẤP quyền (vai trò, ma trận) thuộc B1.3; ở đây chỉ định nghĩa hợp đồng.
export type Permission =
  | 'customer.read' | 'customer.create' | 'customer.update' | 'customer.delete' | 'customer.restore'
  | 'contact.read' | 'contact.create' | 'lookup.read';
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
