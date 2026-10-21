import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './common/auth/permissions.decorator';
import { HealthController } from './health/health.controller';
import { ContactsController } from './modules/customers/contacts.controller';
import { CustomersController } from './modules/customers/customers.controller';
import { LookupsController } from './modules/lookups/lookups.controller';

// B1.3 M1.3 — chính sách quyền TỪNG endpoint đọc từ metadata THẬT của controller (không dùng regex trên mã nguồn).
// Bảng dưới là hợp đồng: thêm route mới hoặc nới/bớt quyền mà không sửa bảng này => test đỏ (buộc có review).
const CONTROLLERS = [CustomersController, ContactsController, LookupsController, HealthController];

interface Route { key: string; perms: string[] | undefined; isPublic: boolean }
function routesOf(cls: new (...a: never[]) => unknown): Route[] {
  const base = Reflect.getMetadata(PATH_METADATA, cls) as string;
  const classPublic = Reflect.getMetadata(PUBLIC_KEY, cls) === true;
  const classPerms = Reflect.getMetadata(PERMISSIONS_KEY, cls) as string[] | undefined;
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((n) => n !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, cls.prototype[n]) !== undefined)
    .map((n) => {
      const h = cls.prototype[n];
      const path = Reflect.getMetadata(PATH_METADATA, h) as string;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, h) as number];
      return {
        key: `${method} /${[base, path].filter((s) => s && s !== '/').join('/')}`,
        perms: (Reflect.getMetadata(PERMISSIONS_KEY, h) as string[] | undefined) ?? classPerms,
        isPublic: (Reflect.getMetadata(PUBLIC_KEY, h) as boolean | undefined) === true || classPublic,
      };
    });
}
const all = CONTROLLERS.flatMap((c) => routesOf(c as never));

const EXPECTED_PROTECTED: Record<string, string[]> = {
  'GET /customers': ['customer.read'],
  'GET /customers/:id': ['customer.read'],
  'POST /customers': ['customer.create'],
  'PATCH /customers/:id': ['customer.update', 'customer.read'],
  'DELETE /customers/:id': ['customer.delete', 'customer.read'],
  'POST /customers/:id/restore': ['customer.restore', 'customer.read'],
  'GET /customers/:customerId/contacts': ['contact.read', 'customer.read'],
  'POST /customers/:customerId/contacts': ['contact.create', 'customer.update', 'customer.read'],
  'GET /lookups': ['lookup.read'],
};
const EXPECTED_PUBLIC = ['GET /health', 'GET /health/database'];

describe('metadata quyền theo endpoint (fail-closed)', () => {
  it('quét được route của mọi controller', () => expect(all.length).toBe(Object.keys(EXPECTED_PROTECTED).length + EXPECTED_PUBLIC.length));
  it('route được bảo vệ khớp CHÍNH XÁC bảng quyền đã chốt (không thừa, không thiếu, không nới)', () => {
    const actual = Object.fromEntries(all.filter((r) => !r.isPublic).map((r) => [r.key, r.perms]));
    expect(actual).toEqual(EXPECTED_PROTECTED);
  });
  it('route public chỉ gồm health', () => {
    expect(all.filter((r) => r.isPublic).map((r) => r.key).sort()).toEqual([...EXPECTED_PUBLIC].sort());
  });
  it('không route nào vừa public vừa khai báo quyền, và không route nào thiếu cả hai', () => {
    for (const r of all) {
      const declared = Array.isArray(r.perms) && r.perms.length > 0;
      expect({ route: r.key, ok: r.isPublic !== declared }).toEqual({ route: r.key, ok: true });
    }
  });
  it('route ghi (POST/PATCH/DELETE) luôn đòi quyền ghi tương ứng, không chỉ customer.read', () => {
    for (const r of all.filter((x) => /^(POST|PATCH|DELETE) /.test(x.key) && !x.isPublic)) {
      expect({ route: r.key, write: (r.perms ?? []).some((p) => !p.endsWith('.read')) }).toEqual({ route: r.key, write: true });
    }
  });
});
