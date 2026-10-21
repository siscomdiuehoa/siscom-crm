import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// B1.3.2-B — kiểm tra TĨNH (chỉ đọc văn bản, KHÔNG chạy script, KHÔNG SQL, KHÔNG database, KHÔNG .env) bộ script/test chuẩn bị kiểm chứng tích hợp.
// Không thay thế việc chạy thật trên bản sao thử (chờ chủ dự án duyệt riêng): chỉ chặn hồi quy các hàng rào an toàn và quy ước đếm phép kiểm.
const BACKEND = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(BACKEND, rel), 'utf8');
const LF = (s: string): string => s.replace(/\r\n/g, '\n');
const noComment = (s: string): string => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

const verify = LF(read('scripts/windows/auth-m13-verify.ps1'));
const runner = LF(read('scripts/windows/run-auth-int-tests.ps1'));
const functional = LF(read('docs/B1.3_M1_3_FUNCTIONAL_TESTS.sql.txt'));
const intSpec = read('test/access-isolation.auth-int-spec.ts');
const jestAuth = JSON.parse(read('test/jest-auth-int.json')) as { testRegex: string };

describe.each([['auth-m13-verify.ps1', verify], ['run-auth-int-tests.ps1', runner]])('hàng rào database của %s', (_name, src) => {
  const code = noComment(src);
  it('chỉ chấp nhận siscom_crm_(restore|test)_YYYYMMDD_HHMMSS, có danh sách cấm và từ khóa cấm', () => {
    expect(code).toContain("'^siscom_crm_(restore|test)_\\d{8}_\\d{6}$'");
    for (const d of ['siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948']) expect(code).toContain("'" + d + "'");
    expect(code).toContain('(dev|prod|production|baseline|live)');
  });
  it('mọi lệnh psql nối 127.0.0.1:5432 bằng siscom_app vào -d $DatabaseName (không bao giờ siscom_crm_dev)', () => {
    const psqlCalls = code.split('\n').filter((l) => /-d \$DatabaseName|'-d', \$DatabaseName/.test(l));
    expect(psqlCalls.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/-d\s+siscom_crm_dev/);
    expect(code).not.toMatch(/'-d',\s*'siscom_crm_dev'/);
    for (const l of code.split('\n').filter((x) => /-h 127\.0\.0\.1|'-h'/.test(x))) expect(l).toMatch(/-p 5432|'5432'/);
    expect(code).not.toMatch(/-h\s+(?!127\.0\.0\.1)[\w.]+/);
  });
  it('bắt buộc xác nhận gõ lại tên bản sao, kiểm nhãn make-stats-clone và current_database() trước khi làm', () => {
    expect(code).toContain("Read-Host 'Go lai CHINH XAC ten");
    expect(code).toContain("'SISCOM_STATS_CLONE_OF:' + $TemplateDb");
    expect(code).toMatch(/\$info\[0\] -ne \$DatabaseName/);
  });
  it('không in/ghi mật khẩu, xóa biến môi trường trong finally, không lệnh prisma ghi nguy hiểm', () => {
    expect(code).not.toMatch(/Say\s*\(?\s*\$script:pw|Write-Host\s*\(?\s*\$script:pw|Add-Content[^\n]*\$script:pw/);
    expect(code).toMatch(/finally \{[^\n]*\$script:pw = \$null/);
    expect(code).toMatch(/Remove-Item \('Env:' \+ \$n\)/);
    expect(code).not.toMatch(/migrate\s+(dev|reset)|db\s+push|db\s+execute|DROP\s+DATABASE|CREATE\s+DATABASE|\bTRUNCATE\b/i);
  });
});

describe('auth-m13-verify.ps1 — bước và thứ tự', () => {
  it('có đủ bước, gồm static (offline) và functional13/structure13/concurrency', () => {
    const m = /ValidateSet\(([^)]*)\)\]\[string\]\$Step/.exec(verify);
    expect(m).not.toBeNull();
    const steps = (m as RegExpExecArray)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(steps).toEqual(['static', 'guard', 'apply', 'constraints', 'constraints11', 'constraints12', 'structure13', 'functional13', 'regress', 'drift', 'rollback', 'concurrency']);
  });
  it('bước static không mở kết nối: nhánh static nằm trước Get-AppPasswordFromEnv/Psql đầu tiên', () => {
    const iStatic = verify.indexOf("if ($Step -eq 'static')");
    const iPw = verify.indexOf('$script:pw = Get-AppPasswordFromEnv (Join-Path');
    expect(iStatic).toBeGreaterThan(0);
    expect(iPw).toBeGreaterThan(iStatic);
    const staticBranch = verify.slice(iStatic, verify.indexOf('else {', iStatic));
    expect(staticBranch).not.toMatch(/\bPsql\b|TryPsql|Prisma @|Get-AppPasswordFromEnv|Read-Host/);
  });
  it('rollback theo thứ tự M1.3 -> M1.2 -> M1.1 -> M1 rồi mới deploy lại; apply/rollback cần WRITE-SCHEMA', () => {
    const body = verify.slice(verify.indexOf("'rollback' {"));
    const order = ['$f.rb13', '$f.rb12', '$f.rb11', '$f.rb1;'].map((k) => body.indexOf('F = ' + k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(verify).toContain("'WRITE-SCHEMA'");
    expect(verify).toContain("'COMMIT-FIXTURES'");
  });
  it('trạng thái kỳ vọng: 6 thư mục migration, M1.3 = 1|1|1, regress = 57 PASS', () => {
    expect(verify).toContain("$EXPECT_ALL = '4|10|1 / 2|2|1 / 2|17|1 / 1|1|1'");
    expect(verify).toContain("$EXPECT_NONE = '0|0|0 / 0|0|0 / 0|0|0 / 0|0|0'");
    expect(verify).toContain("-ne '57'");
    expect(verify).toMatch(/\$dirs\.Count -ne 6/);
    const migs = readdirSync(join(BACKEND, 'prisma', 'migrations'), { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(migs).toHaveLength(6);
  });
  it('functional13 so PASS với số phép kiểm khai báo trong tệp SQL', () => {
    expect(verify).toContain("'^SELECT pg_temp\\.expect_(ok|err|true)\\('");
    expect(verify).toMatch(/Run-ConstraintFile \$f\.f13 \$expected/);
  });
});

describe('B1.3_M1_3_FUNCTIONAL_TESTS.sql.txt', () => {
  const expects = functional.split('\n').filter((l) => /^SELECT pg_temp\.expect_(ok|err|true)\(/.test(l));
  it('chỉ ASCII, có guard tên DB thử, tự ROLLBACK, không COMMIT/DDL phá hoại, không dữ liệu thật', () => {
    // eslint-disable-next-line no-control-regex
    expect(functional).not.toMatch(/[^\x00-\x7F]/);
    expect(functional).toContain("current_database() !~ '^siscom_crm_(restore|test)_[0-9]{8}_[0-9]{6}$'");
    expect(functional).toContain("'siscom_crm_dev'");
    expect(functional.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(functional).not.toMatch(/^\s*COMMIT\s*;/m);
    expect(functional).not.toMatch(/DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE|CREATE\s+(ROLE|USER)|ALTER\s+(ROLE|USER)|\bPASSWORD\s+'/i);
    const emails = functional.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    for (const e of emails) expect(e).toMatch(/@example\.invalid$/);
  });
  it('quy ước đếm: ≥ 30 phép kiểm, mỗi phép một dòng, đủ nhóm dương tính + âm tính + cô lập', () => {
    expect(expects.length).toBeGreaterThanOrEqual(30);
    const all = expects.join('\n');
    expect((all.match(/expect_err\(/g) ?? []).length).toBeGreaterThanOrEqual(6); // âm tính
    for (const needle of ['NO_TOKEN', 'EXPIRED', 'KHONG bi anh huong', 'khong co quyen REQUEST', 'STALE']) expect(all.toUpperCase()).toContain(needle.toUpperCase().replace('STALE', 'STALE'));
  });
  it('mọi thực thể kiểm chứng đều dùng id cố định tiền tố f1396 và cuối tệp in PASS/FAIL', () => {
    expect(functional).toContain("CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END");
    expect(functional).toContain('can_xem_lai');
    expect(functional).not.toMatch(/f138[0-9]|f1390|f1391|f1392/); // không dùng lại id của bộ test khác
  });
});

describe('test tích hợp cách ly quyền (access-isolation.auth-int-spec.ts)', () => {
  it('không bị gom vào unit hay vào test:e2e:customers; chỉ jest-auth-int.json chạy', () => {
    expect(new RegExp(jestAuth.testRegex).test('access-isolation.auth-int-spec.ts')).toBe(true);
    expect(/\.int-spec\.ts$/.test('access-isolation.auth-int-spec.ts')).toBe(false);
    expect(/^.*\.spec\.ts$/.test('access-isolation.auth-int-spec.ts')).toBe(false); // jest-unit: src/**/*.spec.ts
    expect(readdirSync(join(BACKEND, 'test')).filter((n) => n.endsWith('.auth-int-spec.ts'))).toEqual(['access-isolation.auth-int-spec.ts']);
  });
  it('chỉ dùng DB thử qua helper đã có (createTestPrisma + assertTestConnection), không đọc .env/DATABASE_URL', () => {
    expect(intSpec).toContain('createTestPrisma()');
    expect(intSpec).toContain('assertTestConnection(');
    expect(intSpec).not.toMatch(/process\.env\.DATABASE_URL|\.env\b|siscom_crm_dev/);
  });
});
