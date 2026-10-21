import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryCustomersDto } from '../../modules/customers/dto/query-customers.dto';

// B1.3.2-B — ca từ chối (negative) OFFLINE cho hàng rào của script xác minh. Chỉ đọc văn bản + chạy regex trong JS:
// KHÔNG chạy PowerShell/psql, KHÔNG database, KHÔNG .env. Không thay thế việc chạy thật trên bản sao thử (chờ chủ dự án duyệt).
const BACKEND = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(BACKEND, rel), 'utf8').replace(/\r\n/g, '\n');
const noComment = (s: string): string => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

const verify = read('scripts/windows/auth-m13-verify.ps1');
const runner = read('scripts/windows/run-auth-int-tests.ps1');
const functional = read('docs/B1.3_M1_3_FUNCTIONAL_TESTS.sql.txt');
const intSpec = read('test/access-isolation.auth-int-spec.ts');
const SCRIPTS: [string, string][] = [['auth-m13-verify.ps1', verify], ['run-auth-int-tests.ps1', runner]];

const psString = (src: string, name: string): string => {
  const m = new RegExp('^\\$' + name + " = '([^']*)'", 'm').exec(noComment(src));
  expect(m).not.toBeNull();
  return (m as RegExpExecArray)[1];
};
const psDenyList = (src: string): string[] => {
  const m = /^\$DB_DENY = @\(([^)]*)\)/m.exec(noComment(src));
  expect(m).not.toBeNull();
  return (m as RegExpExecArray)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
};
// Mô phỏng đúng thứ tự guard của script: allowlist -> danh sách cấm -> từ khóa cấm. JS `$` (không cờ m) tương đương `\z` của .NET.
const accepted = (src: string, name: string): boolean => {
  const allow = new RegExp(psString(src, 'DB_ALLOW').replace(/\\z/g, '$'));
  const words = new RegExp(psString(src, 'DB_DENY_WORDS').replace('(?i)', ''), 'i');
  return allow.test(name) && !psDenyList(src).includes(name) && !words.test(name);
};

describe.each(SCRIPTS)('ca từ chối tên database của %s', (_n, src) => {
  it.each([
    'siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948',
    'siscom_crm_prod_20261022_101500', 'siscom_crm_production', 'siscom_crm_live_20261022_101500', 'siscom_crm_baseline_20261022_101500',
    'siscom_crm_restore_20261022_101500_dev', 'SISCOM_CRM_DEV', 'SISCOM_CRM_RESTORE_20261022_101500',
    'siscom_crm_restore_20261022', 'siscom_crm_restore_2026102_101500', 'siscom_crm_staging_20261022_101500',
    'postgres', 'template1', '', ' ',
    'siscom_crm_test_20261022_101500 ', ' siscom_crm_test_20261022_101500', 'siscom_crm_test_20261022_101500\n', 'siscom_crm_restore_20261022_101500\r\n', 'siscom_crm_restore_20261022_101500\u0000',
    'siscom_crm_test_20261022_101500;DROP DATABASE x', 'siscom_crm_test_20261022_101500" -c "x', 'x/../siscom_crm_test_20261022_101500',
  ])('từ chối %j', (name) => expect(accepted(src, name)).toBe(false));
  it('chữ số Unicode (Arabic-Indic) không lọt allowlist', () => {
    expect(accepted(src, 'siscom_crm_test_٢٠٢٦١٠٢٢_١٠١٥٠٠')).toBe(false);
  });
  it.each(['siscom_crm_restore_20261022_101500', 'siscom_crm_test_20261022_101500'])('chấp nhận định dạng hợp lệ %s (chưa nghĩa là bản sao tồn tại)', (name) => expect(accepted(src, name)).toBe(true));
  // PowerShell -match/-notmatch KHÔNG phân biệt hoa/thường (khác regex JS ở trên), nên bắt buộc dùng -cnotmatch/-cne.
  // Kiểm tra chạy thật bằng PowerShell: scripts/windows/tests/auth-db-guard-case.tests.ps1.
  it('allowlist/template/.env dùng toán tử phân biệt hoa/thường (-cnotmatch/-cne)', () => {
    const code = noComment(src);
    expect(code).toContain('$DatabaseName -cnotmatch $DB_ALLOW');
    expect(code).toContain("$TemplateDb -cnotmatch '^siscom_crm_restore_");
    for (const needle of ["$user -cne 'siscom_app'", "$u.Host -cne '127.0.0.1'", "$src -cne 'siscom_crm_dev'", "$info[3] -cne ('SISCOM_STATS_CLONE_OF:'"]) expect(code).toContain(needle);
    expect(code).not.toMatch(/\$DatabaseName -notmatch \$DB_ALLOW/);
  });
  it('TemplateDb chỉ nhận siscom_crm_restore_<8 số>_<6 số>, kết thúc \\z, và phải khác bản sao', () => {
    expect(noComment(src)).toContain("$TemplateDb -cnotmatch '^siscom_crm_restore_[0-9]{8}_[0-9]{6}\\z' -or $TemplateDb -eq $DatabaseName");
  });
});

describe.each(SCRIPTS)('ca từ chối host/tài khoản/nguồn mật khẩu của %s', (_n, src) => {
  const code = noComment(src);
  const body = code.slice(code.indexOf('function Get-AppPasswordFromEnv'), code.indexOf('return $pw'));
  it('.env chỉ để lấy mật khẩu: bắt buộc user siscom_app, host 127.0.0.1, cổng 5432, nguồn siscom_crm_dev; mật khẩu rỗng bị từ chối', () => {
    expect(body).toContain("if ($user -cne 'siscom_app') { Fail");
    expect(body).toContain("if ($u.Host -cne '127.0.0.1') { Fail");
    expect(body).toContain('if ($port -ne 5432) { Fail');
    expect(body).toContain("if ($src -cne 'siscom_crm_dev') { Fail");
    expect(body).toContain('if (-not $pw) { Fail');
  });
  it('lỗi đọc .env không in nội dung (Fail không nối $val/$line/$pw/$ui) và biến nhạy cảm được xóa', () => {
    const failLines = body.split('\n').filter((l) => /\bFail\b/.test(l));
    expect(failLines.length).toBeGreaterThan(0);
    for (const l of failLines) expect(l).not.toMatch(/\+\s*\$(val|line|pw|ui)\b/);
    expect(body).toMatch(/\$val = \$null; \$line = \$null; \$ui = \$null; \$u = \$null/);
  });
  it('mọi chuỗi kết nối chỉ trỏ 127.0.0.1:5432/$DatabaseName bằng siscom_app; không localhost/0.0.0.0/::1', () => {
    const urls = code.match(/postgres(ql)?:\/\/[^\s'"]*/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toBe('postgresql://siscom_app:');
    expect(code).toMatch(/'@127\.0\.0\.1:5432\/' \+ \$DatabaseName/);
    expect(code).not.toMatch(/localhost|0\.0\.0\.0|::1/);
  });
  it('không có đường bỏ qua xác nhận tương tác (không tham số -Force/-Yes/-Confirm, không đọc xác nhận từ môi trường)', () => {
    expect(code).not.toMatch(/\[switch\]\$(Force|Yes|Confirm|NoPrompt|SkipConfirm|AutoConfirm|Unattended)/i);
    expect(code).not.toMatch(/\$env:[A-Z_]*(CONFIRM|FORCE|YES)/i);
    expect(code).toMatch(/Read-Host 'Go lai CHINH XAC ten[^']*'\) -ne \$DatabaseName\) \{ Fail/);
  });
});

describe('khớp giữa test tích hợp cách ly quyền và hợp đồng DTO (không cần DB)', () => {
  const check = async (plain: object): Promise<string[]> =>
    (await validate(plainToInstance(QueryCustomersDto, plain) as object, { whitelist: true, forbidNonWhitelisted: true })).flatMap((e) => Object.values(e.constraints ?? {}));
  const UUID = '11111111-1111-4111-8111-111111111111';
  it('scope/actorId/employeeId là tham số lạ => bị từ chối (400 trong test tích hợp)', async () => {
    for (const q of [{ scope: 'ALL' }, { actorId: UUID }, { employeeId: UUID }]) expect((await check(q)).length).toBeGreaterThan(0);
  });
  it('ownerId=<uuid> là bộ lọc HỢP LỆ (200, không phải 400): cách ly OWN dựa vào AND phạm vi ở service, không dựa vào DTO', async () => {
    expect(await check({ ownerId: UUID })).toEqual([]);
    expect(await check({ ownerId: 'e-other' })).not.toEqual([]);
  });
  it('test tích hợp đọc danh sách ở data.items (controller bọc { data: { items } })', () => {
    expect(intSpec).toContain('res.body.data.items');
    expect(intSpec).not.toMatch(/res\.body\.data as \{/);
  });
});

describe('thu hồi mã reset — kỳ vọng tĩnh ở bộ test chức năng M1.3', () => {
  const expects = functional.split('\n').filter((l) => /^SELECT pg_temp\.expect_/.test(l)).join('\n').toLowerCase();
  it('có đủ nhóm ca: thu hồi, không ảnh hưởng người khác, NO_TOKEN, EXPIRED, hàm trigger không gọi trực tiếp, PUBLIC không có EXECUTE', () => {
    for (const needle of ['thu hoi', 'khong bi anh huong', 'no_token', 'expired', 'khong goi truc tiep', 'public khong co execute']) expect(expects).toContain(needle);
  });
  it('không có lời gọi expect_* nằm ngoài quy ước một-dòng-bắt-đầu-bằng-SELECT (script đếm PASS dựa vào quy ước này)', () => {
    const stray = functional.split('\n').filter((l) => /pg_temp\.expect_(ok|err|true)\(/.test(l) && !/^SELECT pg_temp\.expect_/.test(l) && !/^\s*--/.test(l) && !/CREATE FUNCTION/.test(l));
    expect(stray).toEqual([]);
  });
});
