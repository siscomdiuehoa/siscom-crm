// Test thuần (không DB, không .env, không Prisma, không mạng). Chạy: node --test backend/scripts/pg-harness/harness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { run, parseArgs, buildPlan, validateFixture, evaluateExecutionGate, pickRedirectingEnv, EXIT } from './harness.mjs';
import { CATALOG, validateCatalog } from './test-catalog.mjs';

const STAMP = '20261024_120000';
const PORT = 55432;
const CREATED = '2026-10-24T12:00:00Z';
const DB = `siscom_crm_test_${STAMP}`;
const NOW = new Date('2026-10-24T12:30:00Z');
const PW = 'synthetic-placeholder';
const goodInputs = (o = {}) => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true,
  url: `postgresql://siscom_t_app_${STAMP}:${PW}@127.0.0.1:${PORT}/${DB}`, guardEnv: {}, expectedPort: PORT, now: NOW,
  label: `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`, confirmDb: DB,
  confirmCode: expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED }), interactive: true, ...o,
});
const goodEnv = (o = {}) => {
  const g = goodInputs();
  return { SISCOM_PG_APPROVAL_REF: g.approvalRef, SISCOM_PG_OWNER_GRANTED_DB: '1', SISCOM_PG_TEST_URL: g.url, SISCOM_PG_EXPECTED_PORT: String(PORT), SISCOM_PG_LABEL: g.label, SISCOM_PG_CONFIRM_DB: DB, SISCOM_PG_CONFIRM_CODE: g.confirmCode, ...o };
};
const cap = () => {
  const l = { out: [], err: [] };
  return { l, io: { out: (s) => l.out.push(s), err: (s) => l.err.push(s) } };
};

test('mặc định DRY_RUN: exit 0, mọi bước DB NOT_RUN, không cần env', () => {
  const { l, io } = cap();
  assert.equal(run([], {}, io), EXIT.OK);
  assert.match(l.out.join('\n'), /MODE=DRY_RUN/);
  assert.ok(buildPlan().filter((s) => s.requiresDb).every((s) => s.status === 'NOT_RUN'));
});

test('dry-run không in giá trị URL/mật khẩu dù env có đặt', () => {
  const { l, io } = cap();
  run([], goodEnv(), io);
  assert.ok(![...l.out, ...l.err].join('\n').includes(PW));
});

test('cờ bỏ qua / tham số lạ → USAGE 64', () => {
  for (const a of ['--force', '--yes', '-y', '--skip-confirm', '--non-interactive', '--bypass-guard', '--foo']) {
    const { io } = cap();
    assert.equal(run([a], goodEnv(), io), EXIT.USAGE, a);
  }
  assert.equal(parseArgs(['--execute']).execute, true);
});

test('--execute thiếu mọi phê duyệt → GATE_DENIED', () => {
  const { l, io } = cap();
  assert.equal(run(['--execute'], {}, io), EXIT.GATE_DENIED);
  assert.match(l.err.join('\n'), /APPROVAL_MISSING/);
  assert.match(l.err.join('\n'), /OWNER_DB_NOT_GRANTED/);
});

test('--execute thiếu/sai từng điều kiện → bị từ chối', () => {
  const cases = [
    ['thiếu phê duyệt', { SISCOM_PG_APPROVAL_REF: '' }, true, 'APPROVAL_MISSING'],
    ['chủ chưa cấp DB', { SISCOM_PG_OWNER_GRANTED_DB: '0' }, true, 'OWNER_DB_NOT_GRANTED'],
    ['DB dev', { SISCOM_PG_TEST_URL: 'postgresql://siscom_app:x@127.0.0.1:55432/siscom_crm_dev' }, true, 'GUARD_DB_NAME_INVALID'],
    ['DATABASE_URL đặt', { DATABASE_URL: 'x' }, true, 'GUARD_ENV_DATABASE_URL_SET'],
    ['PGHOST đặt', { PGHOST: 'x' }, true, 'GUARD_ENV_REDIRECT'],
    ['không TTY', {}, false, 'GUARD_CONFIRMATION_NOT_INTERACTIVE'],
    ['mã sai', { SISCOM_PG_CONFIRM_CODE: '0000000000000000' }, true, 'GUARD_CONFIRMATION_CODE_INVALID'],
  ];
  for (const [name, over, tty, code] of cases) {
    const { l, io } = cap();
    assert.equal(run(['--execute'], goodEnv(over), io, NOW, tty), EXIT.GATE_DENIED, name);
    assert.match(l.err.join('\n'), new RegExp(code), name);
  }
});

test('đủ điều kiện → vẫn NOT_IMPLEMENTED (chưa có bộ thực thi DB), không lộ mật khẩu', () => {
  const { l, io } = cap();
  assert.equal(run(['--execute'], goodEnv(), io, NOW, true), EXIT.NOT_IMPLEMENTED);
  assert.ok(![...l.out, ...l.err].join('\n').includes(PW));
});

test('evaluateExecutionGate: đầu vào rác → từ chối, không ném lỗi', () => {
  for (const x of [undefined, null, 5, 'x', {}]) assert.equal(evaluateExecutionGate(x).ok, false);
  assert.equal(evaluateExecutionGate(goodInputs()).ok, true);
});

test('pickRedirectingEnv chỉ giữ PG*/DATABASE_URL và che giá trị', () => {
  assert.deepEqual(pickRedirectingEnv({ PGHOST: 'a', DATABASE_URL: 'b', PATH: 'c', pgport: '1' }), { PGHOST: '<đã-đặt>', DATABASE_URL: '<đã-đặt>', pgport: '<đã-đặt>' });
});

test('fixture tổng hợp hợp lệ; biến thể xấu bị bắt', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures.synthetic.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateFixture(fx), []);
  const bad = structuredClone(fx);
  bad.customers[0].email = 'real@gmail.com';
  bad.customers[1].isDemo = false;
  bad.customers[2].taxId = '0123456789';
  bad.actors[0].password = 'x';
  const p = validateFixture(bad).join('|');
  for (const m of ['example.invalid', 'isDemo', 'MST ngoài dải', 'bí mật']) assert.ok(p.includes(m), m);
});

test('danh mục: hợp lệ, đủ 3 nhóm, mọi mục NOT_RUN', () => {
  assert.deepEqual(validateCatalog(), []);
  assert.ok(CATALOG.length >= 20 && CATALOG.every((e) => e.status === 'NOT_RUN'));
  assert.ok(validateCatalog([{ ...CATALOG[0], status: 'PASS' }]).some((m) => m.includes('NOT_RUN')));
  assert.ok(validateCatalog([CATALOG[0], CATALOG[0]]).some((m) => m.includes('trùng id')));
});

test('nguồn harness không import Prisma/pg/child_process/net/dotenv và không đọc .env', () => {
  const src = readFileSync(new URL('./harness.mjs', import.meta.url), 'utf8');
  assert.ok(!/from\s+'(pg|@prisma\/client|node:child_process|node:net|node:http|dotenv)'/.test(src));
  assert.ok(!/readFileSync\([^)]*\.env/.test(src));
});
