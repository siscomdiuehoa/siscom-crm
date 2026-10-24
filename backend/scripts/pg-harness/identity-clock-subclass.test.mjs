// J04: hồi quy đồng hồ `now` của guardedMigrateDeploy là Date con có getTime() đổi giá trị theo lần gọi (fail-open trước vá: lần 1 hợp lệ, lần 2 NaN → so sánh NaN luôn sai → "chưa cũ").
// Chỉ executor giả trong bộ nhớ: không PostgreSQL, không mạng, không .env.
// Chạy: node --test backend/scripts/pg-harness/identity-clock-subclass.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { runPreMigrateIdentityCheck, guardedMigrateDeploy } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED, APP } = FAKE;
const NOW = new Date('2026-10-24T12:30:00Z');
const LABEL = `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`;
const CODE = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED });
const CONN = { host: '127.0.0.1', port: PORT, runtime: 'native' };
const migrateCalls = (ex) => ex.calls.filter((c) => c.method === 'migrateDeploy').length;

async function granted() {
  const ex = new FakeDbExecutor({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: CONN });
  const r = await runPreMigrateIdentityCheck({
    executor: ex,
    gateInputs: { approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true, url: `postgresql://${APP}:synthetic-placeholder@127.0.0.1:${PORT}/${DB}`, guardEnv: {}, expectedPort: PORT, now: NOW, label: LABEL, confirmDb: DB, confirmCode: CODE, interactive: true },
    expected: { db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true } },
  });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  return { ex, verdict: r.verdict };
}
const STALE = NOW.getTime() + 10 * 3600 * 1000;

test('J04 guardedMigrateDeploy: Date con getTime() lần 1 hợp lệ, lần 2 NaN → MIGRATE_DENIED, không migrate', async () => {
  class Flaky extends Date { constructor(ms) { super(ms); this.n = 0; } getTime() { return this.n++ === 0 ? NOW.getTime() : NaN; } }
  const { ex, verdict } = await granted();
  await assert.rejects(() => guardedMigrateDeploy(ex, verdict, DB, new Flaky(STALE)), /MIGRATE_DENIED/);
  assert.equal(migrateCalls(ex), 0);
});

test('J04 guardedMigrateDeploy: Date con ghi đè getTime() trả giờ "tươi" nhưng giờ thật đã cũ → từ chối (dùng getTime nội tại)', async () => {
  class Liar extends Date { getTime() { return NOW.getTime(); } }
  const { ex, verdict } = await granted();
  await assert.rejects(() => guardedMigrateDeploy(ex, verdict, DB, new Liar(STALE)), /MIGRATE_DENIED/);
  assert.equal(migrateCalls(ex), 0);
});

test('J04 guardedMigrateDeploy: đối chứng — Date thật còn hạn vẫn được migrate đúng một lần (executor giả)', async () => {
  const { ex, verdict } = await granted();
  await guardedMigrateDeploy(ex, verdict, DB, new Date(NOW.getTime() + 1000));
  assert.equal(migrateCalls(ex), 1);
});
