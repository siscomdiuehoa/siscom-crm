import { Injectable } from '@nestjs/common';
import type { Actor, ActorProvider, Scope } from './actor';

// Cấu hình thật khi chưa có đăng nhập (B1.3): từ chối tất cả. Không có cờ cấu hình nào đổi hành vi này.
@Injectable()
export class DenyAllActorProvider implements ActorProvider {
  async resolve(): Promise<Actor | null> {
    return null;
  }
  scopeFor(): Scope | null {
    return null;
  }
}
