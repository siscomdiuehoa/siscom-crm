import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// P1: ràng buộc tĩnh của module quản lý tài khoản (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6). Đọc mã nguồn, không chạy.
const dir = __dirname;
const files = [...readdirSync(dir), ...readdirSync(join(dir, 'dto')).map((f) => join('dto', f))].filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const text = (f: string): string => readFileSync(join(dir, f), 'utf8');
const all = files.map((f) => ({ f, s: text(f) }));

describe('kiểm tra tĩnh module accounts (P1)', () => {
  it('có đủ các tệp của module', () => {
    for (const f of ['accounts.controller.ts', 'accounts.module.ts', 'accounts.read.service.ts', 'accounts.write.service.ts', 'accounts.flow.ts', 'accounts.errors.ts']) expect(files).toContain(f);
  });
  it('chỉ dùng pool siscom_acct: không import PrismaService / AuthPrismaService, không tự tạo PrismaClient', () => {
    for (const { f, s } of all) {
      expect({ f, bad: /from '[^']*prisma\/(prisma|auth-prisma)\.service'/.test(s) }).toEqual({ f, bad: false });
      expect({ f, bad: /new PrismaClient\(/.test(s) }).toEqual({ f, bad: false });
    }
  });
  it('SQL thô chỉ qua tagged template (tham số gắn kết): không Unsafe, không Prisma.raw, không ghép chuỗi vào câu lệnh', () => {
    for (const { f, s } of all) {
      expect({ f, bad: /\$(queryRawUnsafe|executeRawUnsafe)|Prisma\.raw\(|Prisma\.sql\(/.test(s) }).toEqual({ f, bad: false });
      expect({ f, bad: /\$(queryRaw|executeRaw)\s*\(/.test(s) }).toEqual({ f, bad: false }); // gọi dạng hàm = có thể truyền chuỗi đã ghép
    }
  });
  it('không ghi bảng trực tiếp: mọi thay đổi đi qua hàm fn_auth_api_* / fn_acct_api_* (pool acct cũng không có quyền ghi)', () => {
    for (const { f, s } of all) {
      expect({ f, bad: /\b(tx|db|client\(\))\.[A-Za-z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(s) }).toEqual({ f, bad: false });
      expect({ f, bad: /\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/i.test(s) }).toEqual({ f, bad: false });
    }
  });
  it('không bao giờ ghi mật khẩu / hash / mã đặt lại vào log hay nhật ký', () => {
    for (const { f, s } of all) {
      expect({ f, bad: /console\.(log|info|warn|error|debug)\(/.test(s) }).toEqual({ f, bad: false });
      expect({ f, bad: /\.(log|warn|error|debug|verbose)\([^)]*(password|hash|token|secret)/i.test(s) }).toEqual({ f, bad: false });
    }
    // Nội dung nhật ký ACCOUNT_* do máy chủ dựng: chỉ các khoá vô hại.
    const w = text('accounts.write.service.ts');
    const audits = [...w.matchAll(/accountAudit\([^;]*;/g)].map((m) => m[0]);
    expect(audits.length).toBeGreaterThanOrEqual(5);
    // Tên hành động (ACCOUNT_PASSWORD_RESET…) là hằng cố định của database — chỉ xét phần `changes` còn lại.
    for (const a of audits) expect({ a, bad: /password|hash|token|secret/i.test(a.replace(/'ACCOUNT_[A-Z_]+'/, '')) }).toEqual({ a, bad: false });
  });
  it('controller: mọi route sau ActorGuard; route tĩnh (roles, departments) đứng trước mọi route :id; đủ 9 route', () => {
    const c = text('accounts.controller.ts');
    expect(c).toMatch(/@Controller\('accounts'\)\s*\n@UseGuards\(ActorGuard\)/);
    const routes = [...c.matchAll(/@(Get|Post|Patch|Delete|Put)\(([^)]*)\)/g)].map((m) => m[1] + ' ' + m[2].replace(/['"]/g, ''));
    expect(routes.slice().sort()).toEqual(['Get ', 'Get departments', 'Get roles', 'Patch :id', 'Post ', 'Post :id/disable', 'Post :id/enable', 'Post :id/reset-password', 'Post :id/role'].sort());
    const firstParam = routes.findIndex((r) => r.includes(':id'));
    expect(routes.indexOf('Get roles')).toBeLessThan(firstParam);
    expect(routes.indexOf('Get departments')).toBeLessThan(firstParam);
    expect((c.match(/new ParseUUIDPipe\(\)/g) ?? []).length).toBe(5); // 5 route :id đều kiểm uuid
  });
  it('mọi thao tác ghi: kiểm quyền (requireManager) rồi giới hạn tần suất TRƯỚC khi mở transaction', () => {
    const w = text('accounts.write.service.ts');
    const methods = ['create', 'update', 'changeRole', 'resetPassword', 'disable', 'enable'];
    for (const m of methods) {
      const start = w.indexOf('async ' + m + '(');
      expect({ m, found: start > -1 }).toEqual({ m, found: true });
      const next = methods.map((x) => w.indexOf('async ' + x + '(', start + 1)).filter((i) => i > start).sort((a, b) => a - b)[0] ?? w.length;
      const body = w.slice(start, next);
      const g = body.indexOf('this.gate(ctx)'); const t = body.indexOf('inAcctTx(');
      expect({ m, gateFirst: g > -1 && t > -1 && g < t }).toEqual({ m, gateFirst: true });
    }
    const gate = w.slice(w.indexOf('private gate('), w.indexOf('private gate(') + 400);
    expect(gate.indexOf('requireManager(ctx)')).toBeGreaterThan(-1);
    expect(gate.indexOf('requireManager(ctx)')).toBeLessThan(gate.indexOf('limiter.allow('));
  });
  it('vai trò cấp được không bao giờ gồm admin; danh sách hàm của pool acct khớp B1.5_ACCT_GRANTS (12 hàm)', () => {
    const dto = text(join('dto', 'query-accounts.dto.ts'));
    expect(dto).toContain("export const GRANTABLE_ROLE_CODES = ['crm_admin', 'sales', 'technician', 'accountant'] as const;");
    const grants = readFileSync(join(dir, '..', '..', '..', 'docs', 'B1.5_ACCT_GRANTS.sql.txt'), 'utf8');
    const granted = [...grants.matchAll(/GRANT EXECUTE ON FUNCTION public\.(fn_[a-z_]+)\(/g)].map((m) => m[1]).sort();
    const check = readFileSync(join(dir, '..', '..', 'prisma', 'db-role-check.ts'), 'utf8');
    const listed = [...(/export const ACCT_FUNCTIONS[^;]*;/.exec(check) ?? [''])[0].matchAll(/'(fn_[a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(granted).toHaveLength(12);
    expect(listed).toEqual(granted);
    // Hàm mà mã của module thực sự gọi phải nằm trong danh sách được cấp.
    const used = new Set(all.flatMap(({ s }) => [...s.matchAll(/public\.(fn_(?:auth|acct)_api_[a-z_]+)\(/g)].map((m) => m[1])));
    for (const u of used) expect({ u, granted: granted.includes(u) }).toEqual({ u, granted: true });
    expect(used.size).toBe(12);
  });
});
