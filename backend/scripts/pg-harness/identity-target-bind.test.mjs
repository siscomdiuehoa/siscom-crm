// G02: đích của cổng (gateInputs.url) phải là CÙNG MỘT đích với expected và bằng chứng DB báo. Chỉ test thuần + FakeDbExecutor trong bộ nhớ
// (không PostgreSQL thật, không .env, không thông tin đăng nhập thật; mật khẩu trong URL là chuỗi giả).
// Chạy: node --test backend/scripts/pg-harness/identity-target-bind.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { runPreMigrateIdentityCheck, guardedMigrateDeploy } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED, OWNER, APP } = FAKE;
const NOW = new Date('2026-10-24T12:30:00Z');
const PW = 'synthetic-placeholder';
const LABEL = `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`;
const CODE = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED });
const conn = (o = {}) => ({ host: '127.0.0.1', port: PORT, runtime: 'native', ...o });
const expected = (o = {}) => ({ db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true }, ...o });
const url = (o = {}) => `postgresql://${o.user ?? APP}:${PW}@${o.host ?? '127.0.0.1'}:${o.port ?? PORT}/${o.db ?? DB}${o.suffix ?? ''}`;
const gateInputs = (o = {}) => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true, url: url(), guardEnv: {}, expectedPort: PORT, now: NOW,
  label: LABEL, confirmDb: DB, confirmCode: CODE, interactive: true, ...o,
});
const script = (o = {}) => ({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: conn(), ...o });
const codes = (r) => r.reasons.map((x) => x.code);
const migrateCalls = (ex) => ex.calls.filter((c) => c.method === 'migrateDeploy').length;

async function denied(name, { g = gateInputs(), e = expected(), s = script(), want, executorCalled }) {
  const ex = new FakeDbExecutor(s);
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
  assert.equal(r.ok, false, `${name}: phải bị từ chối`);
  assert.equal(r.verdict, undefined, `${name}: không được cấp verdict`);
  assert.ok(codes(r).some((c) => want.includes(c)), `${name}: cần một trong [${want}], nhận [${codes(r)}]`);
  assert.equal(migrateCalls(ex), 0);
  if (executorCalled === false) assert.equal(ex.calls.length, 0, `${name}: executor không được bị gọi`);
  assert.ok(!JSON.stringify(r.reasons).includes(PW), `${name}: lý do không được chứa mật khẩu`);
}

test('G02-0 đích khớp hoàn toàn (URL = expected = bằng chứng) → vẫn cấp verdict và migrate 1 lần (mô phỏng)', async () => {
  for (const user of [APP, OWNER]) {
    const ex = new FakeDbExecutor(script());
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs({ url: url({ user }) }), expected: expected() });
    assert.equal(r.ok, true, JSON.stringify(r.reasons));
    assert.equal((await guardedMigrateDeploy(ex, r.verdict, DB, NOW)).simulated, true);
  }
});

// ---- URL của cổng ≠ expected (từ chối trước khi gọi executor). `want` gồm mã của lớp G02 hoặc mã GUARD_* nếu cổng chặn sớm hơn.
const OTHER_STAMP = '20261024_121500';
const OTHER_DB = `siscom_crm_test_${OTHER_STAMP}`;
const HOST_BAD = ['GATE_TARGET_HOST_MISMATCH', 'GATE_TARGET_MISMATCH'];
for (const [name, g, e, want] of [
  ['tên DB khác trong URL', gateInputs({ url: url({ db: OTHER_DB }) }), expected(), ['GATE_TARGET_MISMATCH']],
  ['DB dev trong URL', gateInputs({ url: url({ db: 'siscom_crm_dev' }) }), expected(), ['GATE_TARGET_MISMATCH']],
  ['confirmDb khác expected.db', gateInputs({ confirmDb: OTHER_DB }), expected(), ['GATE_TARGET_MISMATCH']],
  ['expected trỏ DB khác URL', gateInputs(), expected({ db: OTHER_DB, stamp: OTHER_STAMP }), ['GATE_TARGET_MISMATCH']],
  ['host localhost', gateInputs({ url: url({ host: 'localhost' }) }), expected(), HOST_BAD],
  ['host máy khác', gateInputs({ url: url({ host: '10.0.0.5' }) }), expected(), HOST_BAD],
  ['host IPv6 loopback ≠ host khai báo', gateInputs({ url: url({ host: '[::1]' }) }), expected(), HOST_BAD],
  ['host dạng số thập phân', gateInputs({ url: url({ host: '2130706433' }) }), expected(), HOST_BAD],
  ['cổng URL khác expected.port', gateInputs({ url: url({ port: PORT + 1 }) }), expected(), ['GATE_TARGET_PORT_MISMATCH']],
  ['expected.port khác cổng URL', gateInputs(), expected({ port: PORT + 1 }), ['GATE_TARGET_PORT_MISMATCH']],
  ['gateInputs.expectedPort khác expected.port', gateInputs({ expectedPort: PORT + 1 }), expected(), ['GATE_TARGET_PORT_MISMATCH']],
  ['URL không ghi cổng (mặc định 5432)', gateInputs({ url: `postgresql://${APP}:${PW}@127.0.0.1/${DB}` }), expected(), ['GATE_TARGET_PORT_MISMATCH']],
  ['role postgres trong URL', gateInputs({ url: url({ user: 'postgres' }) }), expected(), ['GATE_TARGET_ROLE_MISMATCH']],
  ['role cùng mẫu nhưng stamp khác', gateInputs({ url: url({ user: `siscom_t_app_${OTHER_STAMP}` }) }), expected(), ['GATE_TARGET_ROLE_MISMATCH']],
  ['URL có tham số truy vấn (host=… đổi đích ngầm)', gateInputs({ url: url({ suffix: '?host=10.0.0.5' }) }), expected(), ['GATE_TARGET_MISMATCH']],
  ['URL không phải postgresql', gateInputs({ url: `http://${APP}:${PW}@127.0.0.1:${PORT}/${DB}` }), expected(), ['GATE_TARGET_MISMATCH']],
  ['URL không phải chuỗi', gateInputs({ url: undefined }), expected(), ['GATE_TARGET_MISMATCH']],
  ['stamp expected khác stamp trong tên DB', gateInputs(), expected({ stamp: OTHER_STAMP }), ['GATE_TARGET_STAMP_MISMATCH']],
  ['mã xác nhận của cổng ≠ mã expected', gateInputs({ confirmCode: `${CODE}x` }), expected(), ['GATE_TARGET_CONFIRMATION_MISMATCH']],
  ['expected thiếu', gateInputs(), undefined, ['GATE_TARGET_MISMATCH']],
]) {
  test(`G02 URL≠expected: ${name} → từ chối, executor không bị gọi`, async () => {
    const ex = new FakeDbExecutor(script());
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, undefined);
    assert.equal(ex.calls.length, 0, 'executor không được bị gọi');
    // Chấp nhận mã của lớp G02 hoặc mã GUARD_* nếu cổng chặn sớm hơn; không bao giờ ok.
    assert.ok(codes(r).some((c) => want.includes(c) || c.startsWith('GUARD_')), `[${codes(r)}]`);
    assert.ok(!JSON.stringify(r.reasons).includes(PW));
  });
}

// Các ca lớp G02 phải được chính G02 bắt (không phụ thuộc cổng GUARD_*), để chứng minh liên kết đích có thật.
for (const [name, g, e, want] of [
  ['cổng chỉ nhận ca khớp DB nhưng expected.port lệch', gateInputs(), expected({ port: PORT + 1 }), 'GATE_TARGET_PORT_MISMATCH'],
  ['expected.stamp lệch', gateInputs(), expected({ stamp: OTHER_STAMP }), 'GATE_TARGET_STAMP_MISMATCH'],
  ['mã xác nhận expected lệch với cổng', gateInputs(), expected({ confirmation: { dbName: DB, code: `${CODE}x`, interactive: true } }), 'GATE_TARGET_CONFIRMATION_MISMATCH'],
  ['expected trỏ DB khác URL', gateInputs(), expected({ db: OTHER_DB, stamp: OTHER_STAMP }), 'GATE_TARGET_MISMATCH'],
]) {
  test(`G02 lớp liên kết tự bắt: ${name}`, async () => {
    await denied(name, { g, e, want: [want], executorCalled: false });
  });
}

// ---- Bằng chứng/đối tượng chứng cứ của DB khác (forged) không được cấp quyền cho DB đúng
const snapB = (role, o = {}) => goodSnapshot(role, { currentDatabase: OTHER_DB, ...o });
const otherLabel = `SISCOM_DISPOSABLE_TEST:${OTHER_STAMP}:${CREATED}`;
for (const [name, s, want] of [
  ['cả hai vai báo DB B', script({ owner: snapB('owner'), app: snapB('app') }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['chỉ vai app báo DB B', script({ app: snapB('app') }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['connection.port là cổng DB B', script({ connection: conn({ port: PORT + 1 }) }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['connection.host khác URL', script({ connection: conn({ host: '10.0.0.5' }) }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['connection.host dạng localhost', script({ connection: conn({ host: 'localhost' }) }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['serverPort do PG báo khác cổng URL', script({ owner: goodSnapshot('owner', { serverPort: PORT + 1 }), app: goodSnapshot('app', { serverPort: PORT + 1 }) }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['nhãn DB trong bằng chứng khác nhãn của cổng', script({ owner: goodSnapshot('owner', { dbLabel: otherLabel }), app: goodSnapshot('app', { dbLabel: otherLabel }) }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['thiếu connection', script({ connection: undefined }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['bằng chứng rỗng', script({ owner: undefined, app: undefined }), ['GATE_EVIDENCE_TARGET_MISMATCH']],
  ['role owner của stamp khác', script({ owner: goodSnapshot('owner', { currentUser: `siscom_t_owner_${OTHER_STAMP}`, sessionUser: `siscom_t_owner_${OTHER_STAMP}` }) }), ['OWNER_USER_MISMATCH']],
  ['role app của stamp khác', script({ app: goodSnapshot('app', { currentUser: `siscom_t_app_${OTHER_STAMP}`, sessionUser: `siscom_t_app_${OTHER_STAMP}` }) }), ['APP_USER_MISMATCH']],
]) {
  test(`G02 bằng chứng giả/DB khác: ${name} → không cấp verdict`, async () => {
    await denied(name, { s, want });
  });
}

test('G02 hai vai kết nối tới đích khác nhau → CONNECTION_INCONSISTENT, không verdict', async () => {
  class Split extends FakeDbExecutor {
    async readIdentity(role) {
      const r = await super.readIdentity(role);
      return role === 'app' && r ? { ...r, connection: conn({ port: PORT + 1 }) } : r;
    }
  }
  const ex = new Split(script());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('CONNECTION_INCONSISTENT'));
  assert.equal(migrateCalls(ex), 0);
});

test('G02 getter đổi giá trị giữa các lần đọc không qua mặt được (chụp một lần rồi kiểm)', async () => {
  let n = 0;
  class Shifty extends FakeDbExecutor {
    async readIdentity(role) {
      this.calls.push({ method: 'readIdentity', role });
      const snap = goodSnapshot(role);
      Object.defineProperty(snap, 'currentDatabase', { enumerable: true, get: () => (n++ === 0 ? DB : OTHER_DB) });
      return { connection: conn(), ...snap };
    }
  }
  const ex = new Shifty(script());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, false);
  assert.equal(migrateCalls(ex), 0);
});

test('G02 bằng chứng không clone được (chứa hàm) → EXECUTOR_ERROR, mặc định từ chối', async () => {
  class Bad extends FakeDbExecutor {
    async readIdentity(role) {
      this.calls.push({ method: 'readIdentity', role });
      return { ...goodSnapshot(role), connection: conn(), probe: () => 1 };
    }
  }
  const ex = new Bad(script());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('EXECUTOR_ERROR'));
  assert.equal(migrateCalls(ex), 0);
});

test('G02 verdict cấp cho DB A không dùng được cho DB B', async () => {
  const ex = new FakeDbExecutor(script());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, true);
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, OTHER_DB, NOW), /MIGRATE_DENIED/);
  assert.equal(migrateCalls(ex), 0);
});
