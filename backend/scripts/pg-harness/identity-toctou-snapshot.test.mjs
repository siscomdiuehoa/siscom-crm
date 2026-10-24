// H01: TOCTOU — runPreMigrateIdentityCheck phải chụp bất biến `expected` + `gateInputs` ngay đầu hàm (G09 QA Issue #8, P0).
// Chỉ test thuần + FakeDbExecutor trong bộ nhớ (không PostgreSQL, không .env, mật khẩu trong URL là chuỗi giả).
// Chạy: node --test backend/scripts/pg-harness/identity-toctou-snapshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { runPreMigrateIdentityCheck, guardedMigrateDeploy } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED, APP } = FAKE;
const DEV = 'siscom_crm_dev';
const NOW = new Date('2026-10-24T12:30:00Z');
const PW = 'synthetic-placeholder';
const LABEL = `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`;
const CODE = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED });
const goodUrl = `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}`;
const devUrl = `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DEV}`;
const expected = () => ({ db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true } });
const gateInputs = () => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true, url: goodUrl, guardEnv: {}, expectedPort: PORT, now: NOW,
  label: LABEL, confirmDb: DB, confirmCode: CODE, interactive: true,
});
const script = () => ({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: { host: '127.0.0.1', port: PORT, runtime: 'native' } });
const migrateTargets = (ex) => ex.calls.filter((c) => c.method === 'migrateDeploy').map((c) => JSON.stringify(c));

/** Getter "đổi theo thời gian": trả `good` trong `k` lần đọc đầu rồi trả `bad`. `reads.n` đếm số lần đọc object gốc. */
function flip(obj, key, good, bad, k) {
  const reads = { n: 0 };
  Object.defineProperty(obj, key, { enumerable: true, configurable: true, get() { return reads.n++ < k ? good : bad; } });
  return reads;
}

/** Bất biến an toàn: dù getter đổi thế nào, KHÔNG BAO GIỜ cấp verdict cho dev/prod và không migrate dev. */
function assertNeverDev(r, ex, label) {
  assert.equal(migrateTargets(ex).filter((s) => s.includes(DEV)).length, 0, `${label}: migrateDeploy('${DEV}') bị gọi`);
  if (r.ok) assert.equal(r.verdict.db, DB, `${label}: verdict cấp cho DB lạ`);
}

test('H01 exploit: expected.db getter test→dev sau K lần đọc, K=0..60 → không verdict dev, getter chỉ bị đọc ≤1 lần', async () => {
  for (let k = 0; k <= 60; k++) {
    const e = expected();
    const reads = flip(e, 'db', DB, DEV, k);
    const ex = new FakeDbExecutor(script());
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: e });
    assertNeverDev(r, ex, `expected.db K=${k}`);
    if (r.ok) await guardedMigrateDeploy(ex, r.verdict, DB, NOW);
    assertNeverDev(r, ex, `expected.db K=${k} sau migrate`);
    assert.ok(reads.n <= 1, `K=${k}: object gốc bị đọc lại ${reads.n} lần (phải chụp một lần)`);
  }
});

const FLIPS = [
  ['gateInputs', 'url', goodUrl, devUrl],
  ['gateInputs', 'confirmDb', DB, DEV],
  ['gateInputs', 'guardEnv', {}, { PGHOST: 'x' }],
  ['gateInputs', 'expectedPort', PORT, 5432],
  ['expected', 'port', PORT, 5432],
  ['expected', 'stamp', STAMP, '20200101_000000'],
  ['expected', 'confirmation', expected().confirmation, { dbName: DEV, code: 'x', interactive: true }],
];
for (const [holder, key, good, bad] of FLIPS) {
  test(`H01 exploit: ${holder}.${key} đổi theo thời gian (K=0..30) → không verdict dev, không đọc lại object gốc`, async () => {
    for (let k = 0; k <= 30; k++) {
      const e = expected();
      const g = gateInputs();
      const reads = flip(holder === 'expected' ? e : g, key, good, bad, k);
      const ex = new FakeDbExecutor(script());
      const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
      assertNeverDev(r, ex, `${holder}.${key} K=${k}`);
      assert.ok(reads.n <= 1, `${holder}.${key} K=${k}: bị đọc lại ${reads.n} lần`);
    }
  });
}

test('H01 exploit: đổi expected/gateInputs sang dev NGAY TRONG readIdentity (sau khi cổng đã duyệt) → verdict vẫn gắn DB test', async () => {
  const e = expected();
  const g = gateInputs();
  const ex = new FakeDbExecutor(script());
  const orig = ex.readIdentity.bind(ex);
  ex.readIdentity = async (role) => { e.db = DEV; g.url = devUrl; g.confirmDb = DEV; return orig(role); };
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(r.verdict.db, DB);
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, DEV, NOW), /MIGRATE_DENIED/);
  await guardedMigrateDeploy(ex, r.verdict, DB, NOW);
  assert.equal(migrateTargets(ex).length, 1);
  assert.ok(!migrateTargets(ex)[0].includes(DEV));
});

test('H01 negative: Proxy (expected / gateInputs) → từ chối fail-closed, executor không bị gọi', async () => {
  for (const which of ['expected', 'gateInputs']) {
    const base = which === 'expected' ? expected() : gateInputs();
    const proxy = new Proxy(base, { get: (t, p) => t[p] });
    const ex = new FakeDbExecutor(script());
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: which === 'gateInputs' ? proxy : gateInputs(), expected: which === 'expected' ? proxy : expected() });
    assert.equal(r.ok, false, which);
    assert.equal(r.verdict, undefined);
    assert.equal(ex.calls.length, 0, `${which}: executor không được bị gọi`);
    assert.ok(r.reasons.some((x) => x.code === 'INPUT_SNAPSHOT_INVALID'), JSON.stringify(r.reasons));
  }
});

class Evil { constructor() { this.db = DB; } }
const ANOMALIES = {
  'hàm': () => () => 1,
  'Symbol': () => Symbol('x'),
  'Map': () => new Map([['db', DEV]]),
  'Set': () => new Set([1]),
  'RegExp': () => /x/,
  'Error': () => new Error('x'),
  'instance lớp tuỳ biến': () => new Evil(),
  'Object.create(proto lạ)': () => Object.create({ db: DEV }),
  'Uint8Array': () => new Uint8Array(2),
  'Promise': () => Promise.resolve(1),
};
for (const holder of ['expected', 'gateInputs']) {
  for (const [name, make] of Object.entries(ANOMALIES)) {
    test(`H01 negative: ${holder} chứa kiểu bất thường (${name}) → INPUT_SNAPSHOT_INVALID, không ném, không gọi executor`, async () => {
      const e = expected();
      const g = gateInputs();
      (holder === 'expected' ? e : g).extra = make();
      const ex = new FakeDbExecutor(script());
      const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
      assert.equal(r.ok, false);
      assert.equal(r.verdict, undefined);
      assert.equal(ex.calls.length, 0);
      assert.ok(r.reasons.some((x) => x.code === 'INPUT_SNAPSHOT_INVALID'), JSON.stringify(r.reasons));
    });
  }
  test(`H01 negative: getter ném lỗi trong ${holder} → từ chối, lý do không phản chiếu nội dung lỗi`, async () => {
    const e = expected();
    const g = gateInputs();
    Object.defineProperty(holder === 'expected' ? e : g, 'extra', { enumerable: true, get() { throw new Error(`boom ${PW}`); } });
    const ex = new FakeDbExecutor(script());
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
    assert.equal(r.ok, false);
    assert.equal(ex.calls.length, 0);
    assert.ok(!JSON.stringify(r.reasons).includes(PW));
  });
}

test('H01 negative: null / mảng / nguyên thuỷ / undefined cho expected & gateInputs vẫn bị từ chối (fail-closed)', async () => {
  for (const bad of [null, undefined, [], 0, 'x', true]) {
    for (const [g, e] of [[bad, expected()], [gateInputs(), bad]]) {
      const ex = new FakeDbExecutor(script());
      const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
      assert.equal(r.ok, false);
      assert.equal(r.verdict, undefined);
      assert.equal(ex.calls.length, 0);
    }
  }
});

test('H01 positive: dữ liệu hợp lệ vẫn cấp verdict; đổi object gốc SAU khi cấp không ảnh hưởng verdict', async () => {
  const e = expected();
  const g = gateInputs();
  const ex = new FakeDbExecutor(script());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.ok(Object.isFrozen(r.verdict));
  e.db = DEV; g.url = devUrl;
  assert.equal(r.verdict.db, DB);
  assert.equal((await guardedMigrateDeploy(ex, r.verdict, DB, NOW)).simulated, true);
  assert.equal(migrateTargets(ex).filter((s) => s.includes(DEV)).length, 0);
});

test('H01 positive: hàm không đóng băng/đổi object của người gọi (chỉ chụp bản sao)', async () => {
  const e = expected();
  const g = gateInputs();
  await runPreMigrateIdentityCheck({ executor: new FakeDbExecutor(script()), gateInputs: g, expected: e });
  assert.equal(Object.isFrozen(e), false);
  assert.equal(Object.isFrozen(g), false);
  assert.equal(e.db, DB);
});
