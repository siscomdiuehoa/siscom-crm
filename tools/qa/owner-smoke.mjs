// Owner smoke OFFLINE: node tools/qa/owner-smoke.mjs [--frontend-only]   (Node >= 18, không cài thêm gói, không mạng, không DB, không .env)
// Chạy các bài test OFFLINE có sẵn + bài hành trình mới, in PASS/FAIL ngắn gọn.
// Mã thoát: 0 = mọi bước đã chạy và đạt | 1 = có bước FAIL | 2 = BLOCKED (thiếu tiền đề, bước KHÔNG chạy được).
// Chống "xanh giả": bước đạt chỉ khi fail=0, skipped=0, todo=0 VÀ số test đạt >= ngưỡng tối thiểu (test bị xoá/bỏ qua => FAIL).
// --frontend-only: bỏ qua backend; kết quả ghi rõ "PARTIAL", không được hiểu là đã kiểm chứng backend.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'frontend', 'siscom-crm-web');
const BE = path.join(ROOT, 'backend');
const frontendOnly = process.argv.includes('--frontend-only');

// Môi trường con: bỏ mọi biến có thể trỏ tới DB/bí mật/cờ VITE_* của máy người dùng (bài test tự đặt cờ cần thiết).
const SENSITIVE = /DATABASE|^PG|POSTGRES|SECRET|JWT|PASSWORD|TOKEN|^VITE_/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SENSITIVE.test(k)));

const FRONTEND = [
  { id: 'FE-journey-mock', file: 'ownerAcceptanceSmoke.test.mjs', min: 6, what: 'cờ TẮT mặc định + hành trình đăng nhập/khách hàng (máy chủ giả fail-closed)' },
  { id: 'FE-customer-matrix', file: 'customerApiSmokeOffline.test.mjs', min: 51, what: 'cờ TẮT/BẬT + ma trận lỗi 400/401/403/404/409/5xx/mạng' },
  { id: 'FE-demo-isolation', file: 'apiModeDemoIsolation.test.mjs', min: 11, what: 'API bật không hiện dữ liệu demo/localStorage; API tắt giữ demo' },
  { id: 'FE-login-preview', file: 'loginPreview.test.mjs', min: 7, what: 'đăng nhập xem thử không bao giờ thành công' },
];
const BACKEND = { id: 'BE-health-customers', specs: ['src/health', 'src/modules/customers/customers.http.spec.ts'], min: 30, what: 'health (Prisma giả) + Customers DenyAll => 401, không chạm DB' };

const results = [];
const record = (id, status, detail, what) => { results.push({ id, status }); console.log(`[${status}] ${id} — ${what}${detail ? ' :: ' + detail : ''}`); };
const tail = (s, n = 25) => String(s).split(/\r?\n/).slice(-n).join('\n');

function runFrontend(step) {
  const file = path.join('tests', step.file);
  if (!existsSync(path.join(FE, file))) return record(step.id, 'BLOCKED', 'thiếu file test ' + file, step.what);
  if (!existsSync(path.join(FE, 'node_modules'))) return record(step.id, 'BLOCKED', 'thiếu frontend/siscom-crm-web/node_modules (chạy npm ci ở đó)', step.what);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: FE, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return record(step.id, 'FAIL', 'không khởi chạy được node: ' + r.error.message, step.what);
  const n = (k) => { const m = new RegExp('^# ' + k + ' (\\d+)', 'm').exec(r.stdout); return m ? Number(m[1]) : NaN; };
  const c = { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), todo: n('todo') };
  const sum = `pass ${c.pass}/${c.tests}, fail ${c.fail}, skipped ${c.skipped}, todo ${c.todo}`;
  const bad = r.status !== 0 || Object.values(c).some(Number.isNaN) || c.fail !== 0 || c.skipped !== 0 || c.todo !== 0 || c.pass < step.min;
  if (bad) { console.log(tail(r.stdout + r.stderr)); return record(step.id, 'FAIL', `${sum}; exit ${r.status}; tối thiểu ${step.min} test đạt`, step.what); }
  record(step.id, 'PASS', sum, step.what);
}

function runBackend(step) {
  const jest = path.join(BE, 'node_modules', 'jest', 'bin', 'jest.js');
  if (!existsSync(jest)) return record(step.id, 'BLOCKED', 'thiếu backend/node_modules (chạy npm ci ở backend)', step.what);
  if (!existsSync(path.join(BE, 'src', 'generated', 'prisma'))) return record(step.id, 'BLOCKED', 'thiếu backend/src/generated/prisma (chạy npm run prisma:generate; không cần DB)', step.what);
  const r = spawnSync(process.execPath, [jest, '--config', 'test/jest-unit.json', '--runInBand', '--json', ...step.specs], { cwd: BE, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return record(step.id, 'FAIL', 'không khởi chạy được jest: ' + r.error.message, step.what);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* không phải JSON => FAIL bên dưới */ }
  if (!j) { console.log(tail(r.stdout + r.stderr)); return record(step.id, 'FAIL', 'jest không trả JSON; exit ' + r.status, step.what); }
  const sum = `pass ${j.numPassedTests}/${j.numTotalTests}, fail ${j.numFailedTests}, pending ${j.numPendingTests}, todo ${j.numTodoTests}`;
  if (r.status !== 0 || !j.success || j.numFailedTests || j.numPendingTests || j.numTodoTests || j.numRuntimeErrorTestSuites || j.numPassedTests < step.min) {
    console.log(tail(r.stderr)); return record(step.id, 'FAIL', `${sum}; exit ${r.status}; tối thiểu ${step.min} test đạt`, step.what);
  }
  record(step.id, 'PASS', sum, step.what);
}

console.log('SISCOM CRM — owner smoke OFFLINE (mock). Không chạm DB/.env/mạng.');
for (const s of FRONTEND) runFrontend(s);
if (frontendOnly) console.log('[SKIP-DECLARED] ' + BACKEND.id + ' — bỏ qua theo --frontend-only (backend CHƯA được kiểm chứng trong lần chạy này)');
else runBackend(BACKEND);

const fail = results.filter((r) => r.status === 'FAIL').length;
const blocked = results.filter((r) => r.status === 'BLOCKED').length;
const pass = results.filter((r) => r.status === 'PASS').length;
console.log('\nKHÔNG ĐƯỢC KIỂM CHỨNG bởi script này (cần tiền đề thật): đăng nhập nhân viên thật (chưa có AuthController), PostgreSQL + migration, trình duyệt thật. Xem docs/OWNER_SMOKE.md.');
const verdict = fail ? 'FAIL' : blocked ? 'BLOCKED' : frontendOnly ? 'PARTIAL-PASS (frontend only)' : 'PASS (offline/mock)';
console.log(`RESULT: ${verdict} — ${pass} đạt, ${fail} lỗi, ${blocked} bị chặn`);
process.exit(fail ? 1 : blocked ? 2 : 0);
