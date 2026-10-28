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
  // B1.3 MVP: thay DenyAll bằng SessionActorProvider (phiên cookie server-side). DenyAllActorProvider vẫn tồn tại nhưng không được gắn ở đâu.
  it('AuthModule nối SessionActorProvider; không có provider thay thế nào khác trong src; DenyAll không còn được gắn', () => {
    const auth = text(join(SRC, 'common', 'auth', 'auth.module.ts'));
    expect(auth).toMatch(/useClass: SessionActorProvider/);
    expect(prod.filter((p) => /useClass: DenyAllActorProvider/.test(text(p)))).toEqual([]);
    expect(prod.filter((p) => /x-(actor|employee|user)-id|X-(Actor|Employee|User)-Id/.test(text(p)))).toEqual([]);
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
  it('controller chỉ có đúng các route của Contract B-1 (không PUT)', () => {
    const c = text(join(SRC, 'modules', 'customers', 'customers.controller.ts'));
    expect([...c.matchAll(/@(Get|Post|Patch|Put|Delete)\(/g)].map((m) => m[1]).sort()).toEqual(['Delete', 'Get', 'Get', 'Patch', 'Post', 'Post']);
    expect(c).toMatch(/@UseGuards\(ActorGuard\)/);
  });
});
