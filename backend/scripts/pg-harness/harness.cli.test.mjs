// Test CLI qua tiến trình con (E-03). Không DB, không .env, không Prisma, không mạng: tiến trình con nhận env TƯỜNG MINH
// (chỉ SystemRoot + giá trị tổng hợp), stdin không phải TTY. Chạy: node --test backend/scripts/pg-harness/harness.cli.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { buildPlan, EXIT } from './harness.mjs';
import { CATALOG } from './test-catalog.mjs';

const CLI = fileURLToPath(new URL('./harness.mjs', import.meta.url));
const STAMP = '20261024_120000';
const PORT = 55432;
const DB = `siscom_crm_test_${STAMP}`;
const CREATED = '2026-10-24T12:00:00Z';
const PW = 'synthetic-placeholder';
const base = process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
const fullEnv = (o = {}) => ({
  ...base,
  SISCOM_PG_APPROVAL_REF: 'ISSUE-8#comment-123456', SISCOM_PG_OWNER_GRANTED_DB: '1',
  SISCOM_PG_TEST_URL: `postgresql://siscom_t_app_${STAMP}:${PW}@127.0.0.1:${PORT}/${DB}`, SISCOM_PG_EXPECTED_PORT: String(PORT),
  SISCOM_PG_LABEL: `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`, SISCOM_PG_CONFIRM_DB: DB,
  SISCOM_PG_CONFIRM_CODE: expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED }), ...o,
});
const cli = (args, env) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

test('CLI mặc định (không env): DRY_RUN exit 0, kết quả DB NOT_RUN', () => {
  const r = cli([], { ...base });
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /MODE=DRY_RUN/);
  assert.match(r.out, /Kết quả DB integration: NOT_RUN/);
});

test('CLI --execute không env (thiếu phê duyệt + chưa cấp DB) → exit 2, không kết nối DB', () => {
  const r = cli(['--execute'], { ...base });
  assert.equal(r.code, EXIT.GATE_DENIED);
  assert.match(r.err, /APPROVAL_MISSING/);
  assert.match(r.err, /OWNER_DB_NOT_GRANTED/);
  assert.match(r.err, /Không kết nối DB/);
});

test('CLI --execute thiếu quyền từng phần → exit 2 (không bao giờ 0/3)', () => {
  const cases = [
    ['thiếu mã phê duyệt', { SISCOM_PG_APPROVAL_REF: '' }, 'APPROVAL_MISSING'],
    ['chủ chưa cấp DB', { SISCOM_PG_OWNER_GRANTED_DB: '' }, 'OWNER_DB_NOT_GRANTED'],
    ['thiếu URL', { SISCOM_PG_TEST_URL: '' }, 'GUARD_URL_INVALID'],
    ['trỏ DB dev', { SISCOM_PG_TEST_URL: `postgresql://siscom_app:${PW}@127.0.0.1:${PORT}/siscom_crm_dev` }, 'GUARD_DB_NAME_INVALID'],
    ['host không phải 127.0.0.1', { SISCOM_PG_TEST_URL: `postgresql://siscom_t_app_${STAMP}:${PW}@localhost:${PORT}/${DB}` }, 'GUARD_HOST_NOT_ALLOWED'],
    ['role postgres', { SISCOM_PG_TEST_URL: `postgresql://postgres:${PW}@127.0.0.1:${PORT}/${DB}` }, 'GUARD_ROLE_INVALID'],
    ['cổng cụm chung 5432 chưa duyệt', { SISCOM_PG_EXPECTED_PORT: '5432', SISCOM_PG_TEST_URL: `postgresql://siscom_t_app_${STAMP}:${PW}@127.0.0.1:5432/${DB}` }, 'GUARD_PORT_SHARED_CLUSTER'],
    ['thiếu nhãn sở hữu', { SISCOM_PG_LABEL: '' }, 'GUARD_LABEL_MISSING'],
    ['mã xác nhận sai', { SISCOM_PG_CONFIRM_CODE: '0000000000000000' }, 'GUARD_CONFIRMATION_CODE_INVALID'],
    ['DATABASE_URL đặt', { DATABASE_URL: 'x' }, 'GUARD_ENV_DATABASE_URL_SET'],
    ['PGHOST đặt', { PGHOST: 'x' }, 'GUARD_ENV_REDIRECT'],
  ];
  for (const [name, over, code] of cases) {
    const r = cli(['--execute'], fullEnv(over));
    assert.equal(r.code, EXIT.GATE_DENIED, `${name}: exit ${r.code}`);
    assert.match(r.err, new RegExp(code), name);
    assert.ok(!r.all.includes(PW), `${name}: lộ mật khẩu`);
  }
});

test('CLI --execute không TTY: luôn bị từ chối kể cả khi mọi biến khác "đủ" (không có đường bỏ qua)', () => {
  const r = cli(['--execute'], fullEnv());
  assert.equal(r.code, EXIT.GATE_DENIED);
  assert.match(r.err, /GUARD_CONFIRMATION_NOT_INTERACTIVE/);
  assert.ok(!r.all.includes(PW));
});

test('CLI cờ bỏ qua / tham số lạ → exit 64', () => {
  for (const a of ['--force', '--yes', '--skip-confirm', '--non-interactive', '--bypass-guard', '--unknown']) {
    const r = cli([a, '--execute'], fullEnv());
    assert.equal(r.code, EXIT.USAGE, a);
  }
});

test('bất biến kế hoạch: guard định danh DB (bước 2) đứng TRƯỚC migrate (bước 3); chỉ bước 0 không cần DB; mọi bước NOT_RUN', () => {
  const plan = buildPlan();
  const guard = plan.find((s) => /Guard trực tuyến/.test(s.name));
  const migrate = plan.find((s) => /prisma migrate deploy/.test(s.name));
  assert.ok(guard && migrate && guard.step < migrate.step);
  assert.deepEqual(plan.filter((s) => !s.requiresDb).map((s) => s.step), [0]);
  assert.ok(plan.every((s) => s.status === 'NOT_RUN'));
  assert.ok(!plan.some((s) => /DROP|reset|db push|seed/i.test(s.name.replace(/không tự DROP/, ''))));
});

test('danh mục giới hạn đúng 22 ca: 9 CRUD / 7 CONCURRENCY / 6 DENY_BY_DEFAULT, mọi ca NOT_RUN', () => {
  const n = (a) => CATALOG.filter((e) => e.area === a).length;
  assert.equal(CATALOG.length, 22);
  assert.deepEqual([n('CRUD'), n('CONCURRENCY'), n('DENY_BY_DEFAULT')], [9, 7, 6]);
  assert.ok(CATALOG.every((e) => e.status === 'NOT_RUN'));
});
