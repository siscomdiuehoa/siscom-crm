// Test R-02: guardedMigrateDeploy không ném lại nguyên lỗi/cause của executor.migrateDeploy (có thể chứa chuỗi kết nối/mật khẩu).
// Chỉ FakeDbExecutor / mock tiêm vào, chuỗi giả SENTINEL. Offline: không DB, không .env, không Prisma, không mạng, không --execute.
// Chạy: node --test backend/scripts/pg-harness/migrate-error-redaction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { runPreMigrateIdentityCheck, guardedMigrateDeploy } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED } = FAKE;
const NOW = new Date('2026-10-24T12:30:00Z');
const PW = 'SYNTH-PW-never-print';
const URL_SENTINEL = `postgresql://synthetic_user:${PW}@127.0.0.1:${PORT}/x`;
const SENTINELS = [PW, URL_SENTINEL, 'synthetic_user', 'SYNTH-STACK-never-print'];
const CODE = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED });
const conn = () => ({ host: '127.0.0.1', port: PORT, runtime: 'native' });
const gateInputs = () => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true, url: `postgresql://${FAKE.APP}:x@127.0.0.1:${PORT}/${DB}`, guardEnv: {},
  expectedPort: PORT, now: NOW, label: `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`, confirmDb: DB, confirmCode: CODE, interactive: true,
});
const expected = () => ({ db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true } });
const migrateCalls = (ex) => ex.calls.filter((c) => c.method === 'migrateDeploy').length;
const leaks = (text) => SENTINELS.filter((s) => text.includes(s));

/** Mọi nơi một lỗi có thể bị in: message, stack, cause (đệ quy), thuộc tính riêng, JSON, String(), inspect. */
function surface(err) {
  const parts = [];
  const seen = new Set();
  const walk = (e) => {
    if (e === null || e === undefined || seen.has(e)) return;
    seen.add(e);
    if (typeof e !== 'object' && typeof e !== 'function') { parts.push(String(e)); return; }
    parts.push(String(e.message), String(e.stack), String(e.name));
    for (const k of Reflect.ownKeys(e)) { try { walk(e[k]); } catch { /* getter ném */ } }
    walk(e.cause);
    try { parts.push(JSON.stringify(e)); } catch { /* vòng */ }
  };
  walk(err);
  parts.push(String(err));
  return parts.join('\n');
}

async function granted() {
  const ex = new FakeDbExecutor({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: conn() });
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, true);
  return { ex, verdict: r.verdict };
}

const withCause = () => Object.assign(new Error(`connect ${URL_SENTINEL} thất bại`, { cause: new Error(`inner ${URL_SENTINEL}`) }), { stack: `Error: x\n at ${URL_SENTINEL}`, connectionString: URL_SENTINEL });
const VARIANTS = {
  'Error có message/stack/cause/thuộc tính chứa SENTINEL': () => { throw withCause(); },
  'reject bất đồng bộ bằng Error chứa SENTINEL': async () => { throw withCause(); },
  'ném chuỗi thô là SENTINEL': () => { throw URL_SENTINEL; },
  'ném object thường chứa SENTINEL': () => { throw { url: URL_SENTINEL, password: PW }; },
  'thenable từ chối bằng SENTINEL': () => ({ then(_res, rej) { rej(new Error(`pw=${PW}`)); } }),
  'ném Error có toString/message getter chứa SENTINEL': () => { throw Object.defineProperty(new Error('x'), 'message', { get() { return PW; } }); },
  'ném Proxy mà mọi truy cập đều trả SENTINEL': () => { throw new Proxy({}, { get: () => PW, ownKeys: () => { throw new Error(PW); } }); },
};

for (const [name, thrower] of Object.entries(VARIANTS)) {
  test(`R02 migrateDeploy lỗi (${name}) → MIGRATE_EXECUTOR_ERROR cố định, không lộ SENTINEL, không cause`, async () => {
    const { ex, verdict } = await granted();
    ex.migrateDeploy = async (db) => { ex.calls.push({ method: 'migrateDeploy', db }); return thrower(); };
    let caught;
    await guardedMigrateDeploy(ex, verdict, DB, NOW).then(() => assert.fail('phải từ chối (fail-closed)'), (e) => { caught = e; });
    assert.ok(caught instanceof Error, 'phải là Error mới do guard tạo');
    assert.equal(caught.code, 'MIGRATE_EXECUTOR_ERROR');
    assert.match(caught.message, /^MIGRATE_EXECUTOR_ERROR: /);
    assert.equal(caught.cause, undefined, 'không giữ cause');
    assert.deepEqual(leaks(surface(caught)), [], 'lộ giá trị nhạy cảm qua lỗi');
    assert.deepEqual(Object.keys(caught).sort(), ['code'], 'không có thuộc tính riêng nào khác ngoài code');
    assert.equal(migrateCalls(ex), 1);
  });
}

test('R02 sau lỗi migrate verdict đã bị tiêu thụ: thử lại → MIGRATE_DENIED, không gọi migrate lần 2 (fail-closed giữ nguyên)', async () => {
  const { ex, verdict } = await granted();
  ex.migrateDeploy = async (db) => { ex.calls.push({ method: 'migrateDeploy', db }); throw new Error(URL_SENTINEL); };
  await assert.rejects(() => guardedMigrateDeploy(ex, verdict, DB, NOW), /^Error: MIGRATE_EXECUTOR_ERROR/);
  await assert.rejects(() => guardedMigrateDeploy(ex, verdict, DB, NOW), /MIGRATE_DENIED/);
  assert.equal(migrateCalls(ex), 1);
});

test('R02 các guard cũ vẫn từ chối bằng MIGRATE_DENIED và KHÔNG gọi migrateDeploy (không bị đổi mã thành EXECUTOR_ERROR)', async () => {
  const a = await granted();
  const other = new FakeDbExecutor({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: conn() });
  await assert.rejects(() => guardedMigrateDeploy(other, a.verdict, DB, NOW), /MIGRATE_DENIED/);
  await assert.rejects(() => guardedMigrateDeploy(a.ex, { ...a.verdict }, DB, NOW), /MIGRATE_DENIED/);
  await assert.rejects(() => guardedMigrateDeploy(a.ex, a.verdict, `${DB}_x`, NOW), /MIGRATE_DENIED/);
  await assert.rejects(() => guardedMigrateDeploy(a.ex, a.verdict, DB, new Date(NaN)), /MIGRATE_DENIED/);
  await assert.rejects(() => guardedMigrateDeploy(a.ex, a.verdict, DB, new Date(NOW.getTime() + 3600e3)), /MIGRATE_DENIED/);
  assert.equal(migrateCalls(a.ex), 0);
});

test('R02 đường thành công không đổi: trả nguyên kết quả của executor và chỉ gọi migrateDeploy một lần với đúng DB', async () => {
  const { ex, verdict } = await granted();
  assert.deepEqual(await guardedMigrateDeploy(ex, verdict, DB, NOW), { applied: 0, simulated: true });
  assert.deepEqual(ex.calls.filter((c) => c.method === 'migrateDeploy'), [{ method: 'migrateDeploy', db: DB }]);
});
