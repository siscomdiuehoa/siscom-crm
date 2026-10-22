import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'generated' ? [] : files(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}
const prod = files(SRC);
const text = (p: string) => readFileSync(p, 'utf8');

describe('kiểm tra tĩnh mã production (src, không tính *.spec.ts)', () => {
  it('có file để quét', () => expect(prod.length).toBeGreaterThan(10));
  it('không dùng $queryRawUnsafe / $executeRawUnsafe', () => {
    expect(prod.filter((p) => /\$(query|execute)RawUnsafe/.test(text(p)))).toEqual([]);
  });
  it('mã production không import từ thư mục test và không chứa provider/checker giả', () => {
    expect(prod.filter((p) => /from ['"][^'"]*\/test\//.test(text(p)))).toEqual([]);
    expect(prod.filter((p) => /TestLinksChecker|TestActorProvider/.test(text(p)))).toEqual([]);
  });
  it('AuthModule nối DenyAllActorProvider; không có provider thay thế nào khác trong src', () => {
    const auth = text(join(SRC, 'common', 'auth', 'auth.module.ts'));
    expect(auth).toMatch(/useClass: DenyAllActorProvider/);
    expect(prod.filter((p) => /provide: ACTOR_PROVIDER/.test(text(p)))).toEqual([join(SRC, 'common', 'auth', 'auth.module.ts')]);
  });
  it('AuditModule nối DbAuditPort (B1.3.2a); PendingAuditPort không còn được gắn ở đâu trong src', () => {
    const am = text(join(SRC, 'common', 'audit', 'audit.module.ts'));
    expect(am).toMatch(/useClass: DbAuditPort/);
    expect(prod.filter((p) => /provide: AUDIT_PORT/.test(text(p)))).toEqual([join(SRC, 'common', 'audit', 'audit.module.ts')]);
    expect(prod.filter((p) => /useClass: PendingAuditPort/.test(text(p)))).toEqual([]);
  });
  it('CustomersModule dùng AuditModule và DELETE khoá (UnverifiedLinksChecker)', () => {
    const m = text(join(SRC, 'modules', 'customers', 'customers.module.ts'));
    expect(m).toMatch(/imports: \[[^\]]*AuditModule/);
    expect(m).not.toMatch(/PendingAuditPort/);
    expect(m).toMatch(/useClass: UnverifiedLinksChecker/);
  });
  it('DbAuditPort chỉ ghi qua giao dịch được truyền vào (không tự dùng PrismaService hay SQL thô)', () => {
    expect(text(join(SRC, 'common', 'audit', 'db-audit.port.ts'))).not.toMatch(/PrismaService|\$(query|execute)Raw/);
  });
  it('UnverifiedLinksChecker không bao giờ trả verified: true', () => {
    expect(text(join(SRC, 'modules', 'customers', 'customers.deletion-guard.ts'))).not.toMatch(/verified:\s*true/);
  });
  it('AccessGuard là APP_GUARD duy nhất ở AuthModule; AuthModule được nạp trực tiếp ở AppModule (B1.3 M1.3)', () => {
    expect(prod.filter((p) => /provide: APP_GUARD/.test(text(p)))).toEqual([join(SRC, 'common', 'auth', 'auth.module.ts')]);
    expect(text(join(SRC, 'common', 'auth', 'auth.module.ts'))).toMatch(/provide: APP_GUARD, useClass: AccessGuard/);
    expect(text(join(SRC, 'app.module.ts'))).toMatch(/imports: \[[^\]]*AuthModule/);
  });
  it('MỌI route của mọi controller khai báo @RequirePermissions(...) hoặc @Public() (không route nào dựa vào mặc định)', () => {
    const controllers = prod.filter((p) => p.endsWith('.controller.ts'));
    expect(controllers.length).toBeGreaterThanOrEqual(4);
    const bad: string[] = [];
    for (const f of controllers) {
      const t = text(f);
      const classPublic = /@Public\(\)\s*\n\s*export class/.test(t) || /@Public\(\)\s*\n@[A-Za-z]+\([^)]*\)\s*\nexport class/.test(t) || /@Controller\([^)]*\)\s*\n@Public\(\)/.test(t);
      for (const m of t.matchAll(/@(Get|Post|Patch|Put|Delete)\([^)]*\)([\s\S]*?)(?=\n\s*(?:async\s+)?[A-Za-z_]+\()/g)) {
        if (!classPublic && !/@RequirePermissions\(/.test(m[2])) bad.push(f + ' :: @' + m[1]);
      }
    }
    expect(bad).toEqual([]);
  });
  it('@Public() chỉ được dùng ở controller health (health + health/privileged)', () => {
    expect(prod.filter((p) => /^\s*@Public\(\)/m.test(text(p)) && !p.endsWith('permissions.decorator.ts')).map((p) => p.split(/[\\/]/).pop()).sort()).toEqual(['health.controller.ts', 'privileged-health.controller.ts']);
  });
  it('AccessGuard không đọc danh tính từ header/body/query', () => {
    expect(text(join(SRC, 'common', 'auth', 'access.guard.ts'))).not.toMatch(/\.headers|\.body|\.query|\.params/);
  });
  it('controller chỉ có đúng các route của Contract B-1 (không PUT)', () => {
    const c = text(join(SRC, 'modules', 'customers', 'customers.controller.ts'));
    expect([...c.matchAll(/@(Get|Post|Patch|Put|Delete)\(/g)].map((m) => m[1]).sort()).toEqual(['Delete', 'Get', 'Get', 'Patch', 'Post', 'Post']);
    expect(c).toMatch(/@UseGuards\(ActorGuard\)/);
  });
});
