// Test thuần, bộ thực thi GIẢ trong bộ nhớ (không DB, không .env, không Prisma, không mạng).
// Chạy: node --test backend/scripts/pg-harness/identity-verifier.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { run, EXIT } from './harness.mjs';
import { verifyDbIdentity, runPreMigrateIdentityCheck, guardedMigrateDeploy } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED } = FAKE;
const NOW = new Date('2026-10-24T12:30:00Z');
const PW = 'synthetic-placeholder';
const CODE = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED });
const conn = (o = {}) => ({ host: '127.0.0.1', port: PORT, runtime: 'native', ...o });
const evidence = (o = {}) => ({ connection: conn(), owner: goodSnapshot('owner'), app: goodSnapshot('app'), ...o });
const expected = (o = {}) => ({ db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true }, ...o });
const gateInputs = (o = {}) => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true,
  url: `postgresql://siscom_t_app_${STAMP}:${PW}@127.0.0.1:${PORT}/${DB}`, guardEnv: {}, expectedPort: PORT, now: NOW,
  label: `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`, confirmDb: DB, confirmCode: CODE, interactive: true, ...o,
});
const codes = (r) => r.reasons.map((x) => x.code);
const withSnap = (role, o) => evidence({ [role]: goodSnapshot(role, o) });
const script = (o = {}) => ({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: conn(), ...o });
const bothSnap = (o) => ({ owner: goodSnapshot('owner', o), app: goodSnapshot('app', o) });

test('bằng chứng hợp lệ → ok, verdict đóng băng', () => {
  const r = verifyDbIdentity(evidence(), expected());
  assert.equal(r.ok, true);
  assert.ok(Object.isFrozen(r));
});

test('container: serverAddr cầu nối 172.17.x được chấp nhận, cổng nội bộ khác cổng publish', () => {
  const r = verifyDbIdentity(evidence({ connection: conn({ runtime: 'container' }), ...bothSnap({ serverAddr: '172.17.0.2', serverPort: 5432 }) }), expected({ runtime: 'container' }));
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
});

// ---- DB trả về không khớp
for (const [name, role, o, code] of [
  ['current_database() sai (DB dev)', 'owner', { currentDatabase: 'siscom_crm_dev' }, 'OWNER_DB_MISMATCH'],
  ['current_user app là owner', 'app', { currentUser: FAKE.OWNER }, 'APP_USER_MISMATCH'],
  ['current_user là postgres', 'owner', { currentUser: 'postgres', sessionUser: 'postgres' }, 'OWNER_USER_MISMATCH'],
  ['session_user khác current_user (SET ROLE)', 'app', { sessionUser: 'postgres' }, 'APP_SESSION_USER_MISMATCH'],
  ['phiên superuser', 'app', { sessionIsSuperuser: 'on' }, 'APP_SESSION_SUPERUSER'],
  ['owner DB không phải role owner cùng stamp', 'app', { dbOwner: 'postgres' }, 'APP_DB_OWNER_MISMATCH'],
  ['role không LOGIN', 'owner', { rolcanlogin: false }, 'OWNER_CANLOGIN_NOT_TRUE'],
  ['còn dữ liệu không-demo', 'app', { nonDemoRowCount: 3 }, 'APP_NON_DEMO_DATA'],
  ['số dòng không-demo không xác định', 'app', { nonDemoRowCount: null }, 'APP_NON_DEMO_DATA'],
  ['trường lạ trong bằng chứng', 'owner', { extra: 1 }, 'OWNER_FIELD_UNKNOWN'],
]) {
  test(`DB trả không khớp: ${name} → từ chối`, () => {
    const r = verifyDbIdentity(withSnap(role, o), expected());
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes(code), codes(r).join(','));
  });
}

// ---- permission/role sai
for (const f of ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls']) {
  for (const role of ['owner', 'app']) {
    for (const bad of [true, undefined, 'f', 0, null]) {
      test(`quyền sai: ${role}.${f}=${String(bad)} → từ chối`, () => {
        const r = verifyDbIdentity(withSnap(role, { [f]: bad }), expected());
        assert.equal(r.ok, false);
        assert.ok(codes(r).includes(`${role.toUpperCase()}_PRIVILEGE_FLAG`));
      });
    }
  }
}

test('owner và app dùng chung một role → từ chối (vai không tách biệt)', () => {
  const r = verifyDbIdentity(evidence({ app: goodSnapshot('app', { currentUser: FAKE.OWNER, sessionUser: FAKE.OWNER }) }), expected());
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('ROLES_NOT_SEPARATE'));
});

test('cùng một đối tượng làm cả owner lẫn app → từ chối', () => {
  const s = goodSnapshot('owner');
  assert.ok(codes(verifyDbIdentity(evidence({ owner: s, app: s }), expected())).includes('ROLES_NOT_SEPARATE'));
});

// ---- host/cổng/runtime sai
for (const [name, c, code] of [
  ['host localhost', conn({ host: 'localhost' }), 'HOST_NOT_ALLOWED'],
  ['host ::1', conn({ host: '::1' }), 'HOST_NOT_ALLOWED'],
  ['host LAN', conn({ host: '192.168.1.5' }), 'HOST_NOT_ALLOWED'],
  ['host 0.0.0.0', conn({ host: '0.0.0.0' }), 'HOST_NOT_ALLOWED'],
  ['cổng kết nối khác cổng khai báo', conn({ port: 5433 }), 'PORT_MISMATCH'],
  ['runtime khác khai báo', conn({ runtime: 'container' }), 'RUNTIME_MISMATCH'],
  ['trường lạ trong connection', conn({ socket: '/tmp/x' }), 'FIELD_UNKNOWN'],
]) {
  test(`kết nối sai: ${name} → từ chối`, () => {
    const r = verifyDbIdentity(evidence({ connection: c }), expected());
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes(code), codes(r).join(','));
  });
}

test('máy chủ PG báo địa chỉ không phải loopback (native) → từ chối', () => {
  assert.ok(codes(verifyDbIdentity(withSnap('app', { serverAddr: '10.0.0.7' }), expected())).includes('APP_SERVER_NOT_LOOPBACK'));
});

test('native: máy chủ PG báo cổng khác → từ chối', () => {
  assert.ok(codes(verifyDbIdentity(withSnap('app', { serverPort: 5432 }), expected())).includes('APP_SERVER_PORT_MISMATCH'));
});

test('container: địa chỉ ngoài dải cầu nối 172.16/12 → từ chối', () => {
  for (const addr of ['172.32.0.2', '172.15.0.2', '10.1.1.1']) {
    const r = verifyDbIdentity(evidence({ connection: conn({ runtime: 'container' }), ...bothSnap({ serverAddr: addr, serverPort: 5432 }) }), expected({ runtime: 'container' }));
    assert.ok(codes(r).includes('APP_SERVER_NOT_LOOPBACK'), addr);
  }
});

test('cổng 5432 (cụm chung) bị từ chối nếu chưa phê duyệt riêng', () => {
  assert.ok(codes(verifyDbIdentity(evidence({ connection: conn({ port: 5432 }) }), expected({ port: 5432 }))).includes('PORT_SHARED_CLUSTER'));
});

// ---- tên DB/stamp sai
for (const db of ['siscom_crm_dev', 'postgres', 'template1', 'siscom_crm_restore_20261014_214105', 'siscom_crm_test_20261324_120000', 'siscom_crm_test_20261024_126000', 'siscom_crm_test_', 'SISCOM_CRM_TEST_20261024_120000']) {
  test(`tên DB không hợp lệ/bị cấm "${db}" → từ chối`, () => {
    const r = verifyDbIdentity(evidence(), expected({ db, confirmation: { dbName: db, code: CODE, interactive: true } }));
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes('DB_NAME_INVALID'));
  });
}

test('stamp mong đợi khác stamp của tên DB → từ chối', () => {
  assert.ok(codes(verifyDbIdentity(evidence(), expected({ stamp: '20261024_130000' }))).includes('STAMP_MISMATCH'));
});

// ---- thiếu bằng chứng
test('thiếu bằng chứng: undefined/null/mảng/chuỗi → từ chối, không ném lỗi', () => {
  for (const ev of [undefined, null, [], 'x', 42]) {
    const r = verifyDbIdentity(ev, expected());
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r), ['EVIDENCE_MISSING']);
  }
});

test('thiếu thông số mong đợi → từ chối', () => {
  for (const ex of [undefined, null, [], 'x']) assert.deepEqual(codes(verifyDbIdentity(evidence(), ex)), ['EXPECTED_INVALID']);
});

for (const key of ['connection', 'owner', 'app']) {
  test(`thiếu "${key}" → từ chối`, () => {
    const ev = evidence();
    delete ev[key];
    assert.equal(verifyDbIdentity(ev, expected()).ok, false);
  });
}

test('thiếu từng trường của ảnh chụp → từ chối', () => {
  for (const k of Object.keys(goodSnapshot('app'))) {
    const s = goodSnapshot('app');
    delete s[k];
    assert.equal(verifyDbIdentity(evidence({ app: s }), expected()).ok, false, `thiếu ${k} vẫn ok`);
  }
});

test('trường lạ ở cấp bằng chứng → từ chối', () => {
  assert.ok(codes(verifyDbIdentity({ ...evidence(), superuser: true }, expected())).includes('FIELD_UNKNOWN'));
});

// ---- nhãn + xác nhận
test('thiếu nhãn / nhãn rác / nhãn stamp khác → từ chối', () => {
  assert.ok(codes(verifyDbIdentity(evidence(bothSnap({ dbLabel: '' })), expected())).includes('LABEL_MISSING'));
  assert.ok(codes(verifyDbIdentity(evidence(bothSnap({ dbLabel: 'hello' })), expected())).includes('LABEL_INVALID'));
  assert.ok(codes(verifyDbIdentity(evidence(bothSnap({ dbLabel: `SISCOM_DISPOSABLE_TEST:20261024_130000:${CREATED}` })), expected())).includes('LABEL_STAMP_MISMATCH'));
});

test('nhãn hết hạn (>2h) hoặc ở tương lai → từ chối', () => {
  assert.ok(codes(verifyDbIdentity(evidence(), expected({ now: new Date('2026-10-24T14:00:01Z') }))).includes('LABEL_EXPIRED'));
  assert.ok(codes(verifyDbIdentity(evidence(), expected({ now: new Date('2026-10-24T11:50:00Z') }))).includes('LABEL_EXPIRED'));
});

test('hai vai thấy nhãn khác nhau → từ chối', () => {
  const r = verifyDbIdentity(evidence({ app: goodSnapshot('app', { dbLabel: `SISCOM_DISPOSABLE_TEST:${STAMP}:2026-10-24T12:10:00Z` }) }), expected());
  assert.ok(codes(r).includes('LABEL_INCONSISTENT'));
});

test('thiếu/sai mã xác nhận, sai tên DB gõ lại, không TTY → từ chối', () => {
  const conf = (o) => expected({ confirmation: { dbName: DB, code: CODE, interactive: true, ...o } });
  assert.ok(codes(verifyDbIdentity(evidence(), expected({ confirmation: undefined }))).includes('CONFIRMATION_MISSING'));
  assert.ok(codes(verifyDbIdentity(evidence(), conf({ code: 'deadbeefdeadbeef' }))).includes('CONFIRMATION_CODE_INVALID'));
  assert.ok(codes(verifyDbIdentity(evidence(), conf({ code: undefined }))).includes('CONFIRMATION_CODE_INVALID'));
  assert.ok(codes(verifyDbIdentity(evidence(), conf({ dbName: 'siscom_crm_test_20261024_999999' }))).includes('CONFIRMATION_DB_MISMATCH'));
  assert.ok(codes(verifyDbIdentity(evidence(), conf({ interactive: false }))).includes('CONFIRMATION_NOT_INTERACTIVE'));
});

test('mã xác nhận gắn cổng khác → từ chối', () => {
  const other = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: '127.0.0.1:55433', createdAt: CREATED });
  assert.ok(codes(verifyDbIdentity(evidence(), expected({ confirmation: { dbName: DB, code: other, interactive: true } }))).includes('CONFIRMATION_CODE_INVALID'));
});

test('thiếu "now" → từ chối', () => {
  assert.ok(codes(verifyDbIdentity(evidence(), expected({ now: undefined }))).includes('NOW_INVALID'));
});

test('getter ném lỗi trong bằng chứng → từ chối mặc định (INTERNAL_ERROR), không ném ra ngoài', () => {
  const ev = evidence();
  Object.defineProperty(ev, 'owner', { get() { throw new Error('boom'); }, enumerable: true });
  const r = verifyDbIdentity(ev, expected());
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('INTERNAL_ERROR'));
});

test('lý do từ chối không phản chiếu giá trị từ DB/mật khẩu', () => {
  const evil = 'postgresql://evil:topsecret@host/db';
  const r = verifyDbIdentity(withSnap('app', { currentDatabase: evil, currentUser: evil, dbOwner: evil, dbLabel: evil, serverAddr: evil, secret: evil }), expected());
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('topsecret'));
});

// ---- điều phối với bộ thực thi giả
test('luồng đạt: owner→app đọc trước, rồi guardedMigrateDeploy mới gọi migrate', async () => {
  const ex = new FakeDbExecutor(script());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.deepEqual(ex.calls.map((c) => c.method + (c.role ? `:${c.role}` : '')), ['readIdentity:owner', 'readIdentity:app']);
  const res = await guardedMigrateDeploy(ex, r.verdict, DB);
  assert.equal(res.simulated, true);
  assert.deepEqual(ex.calls.map((c) => c.method), ['readIdentity', 'readIdentity', 'migrateDeploy']);
});

test('cổng thực thi chưa đạt → KHÔNG có lời gọi nào tới executor', async () => {
  const bad = [gateInputs({ approvalRef: undefined }), gateInputs({ ownerGrantedTestDb: false }), gateInputs({ confirmCode: 'x' }), gateInputs({ url: `postgresql://postgres:${PW}@127.0.0.1:${PORT}/siscom_crm_dev` }), undefined, null];
  for (const g of bad) {
    const ex = new FakeDbExecutor(script());
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: expected() });
    assert.equal(r.ok, false);
    assert.equal(ex.calls.length, 0);
  }
});

test('bằng chứng sai → ok=false, không verdict, guardedMigrateDeploy từ chối và KHÔNG gọi migrate', async () => {
  const ex = new FakeDbExecutor(script({ app: goodSnapshot('app', { rolsuper: true }) }));
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, undefined);
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, DB), /MIGRATE_DENIED/);
  assert.ok(!ex.calls.some((c) => c.method === 'migrateDeploy'));
});

test('thiếu bằng chứng từ executor (undefined) → từ chối', async () => {
  const ex = new FakeDbExecutor({ connection: conn() });
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, false);
});

test('executor ném lỗi chứa chuỗi kết nối → từ chối, không lộ nội dung lỗi', async () => {
  const ex = new FakeDbExecutor(script({ throwOn: 'readIdentity' }));
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['EXECUTOR_ERROR']);
  assert.ok(!JSON.stringify(r).includes('pw'));
});

test('executor thiếu phương thức / không phải đối tượng → từ chối', async () => {
  for (const executor of [undefined, null, {}, { readIdentity() {} }, 'x']) {
    const r = await runPreMigrateIdentityCheck({ executor, gateInputs: gateInputs(), expected: expected() });
    assert.deepEqual(codes(r), ['EXECUTOR_INVALID']);
  }
});

test('hai vai báo kết nối tới đích khác nhau → từ chối', async () => {
  class Split extends FakeDbExecutor {
    async readIdentity(role) {
      const s = await super.readIdentity(role);
      return role === 'app' ? { ...s, connection: conn({ port: 55433 }) } : s;
    }
  }
  const r = await runPreMigrateIdentityCheck({ executor: new Split(script()), gateInputs: gateInputs(), expected: expected() });
  assert.deepEqual(codes(r), ['CONNECTION_INCONSISTENT']);
});

test('guardedMigrateDeploy: verdict giả/thiếu/sai DB/dùng lại → từ chối, migrate chỉ chạy đúng 1 lần', async () => {
  const ex = new FakeDbExecutor(script());
  const forged = Object.freeze({ ok: true, reasons: [], db: DB, stamp: STAMP });
  await assert.rejects(() => guardedMigrateDeploy(ex, forged, DB), /MIGRATE_DENIED/);
  await assert.rejects(() => guardedMigrateDeploy(ex, undefined, DB), /MIGRATE_DENIED/);
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, 'siscom_crm_dev'), /MIGRATE_DENIED/);
  await guardedMigrateDeploy(ex, r.verdict, DB);
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, DB), /MIGRATE_DENIED/);
  assert.equal(ex.calls.filter((c) => c.method === 'migrateDeploy').length, 1);
});

test('khi từ chối chỉ có lời gọi đọc (readIdentity), không có lời gọi ghi', async () => {
  const ex = new FakeDbExecutor(script({ owner: goodSnapshot('owner', { currentDatabase: 'siscom_crm_dev' }) }));
  await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.deepEqual([...new Set(ex.calls.map((c) => c.method))], ['readIdentity']);
});

// ---- đường --execute thật vẫn NOT_IMPLEMENTED; cách ly adapter
test('harness --execute qua cổng vẫn exit NOT_IMPLEMENTED (3) và không nối bộ kiểm định', () => {
  const io = { out() {}, err() {} };
  const g = gateInputs();
  const env = { SISCOM_PG_APPROVAL_REF: g.approvalRef, SISCOM_PG_OWNER_GRANTED_DB: '1', SISCOM_PG_TEST_URL: g.url, SISCOM_PG_EXPECTED_PORT: String(PORT), SISCOM_PG_LABEL: g.label, SISCOM_PG_CONFIRM_DB: DB, SISCOM_PG_CONFIRM_CODE: CODE };
  assert.equal(run(['--execute'], env, io, NOW, true), EXIT.NOT_IMPLEMENTED);
  assert.ok(!/identity-verifier|fake-db-executor/.test(readFileSync(new URL('./harness.mjs', import.meta.url), 'utf8')));
});

test('cách ly adapter: mã mới không import pg/prisma/child_process/net/fs/http/env; fake không bị mã sản xuất import', () => {
  const FORBIDDEN = /from\s+['"](?:pg|pg-[\w-]+|@prisma\/[\w-]+|prisma|child_process|node:child_process|net|node:net|tls|node:tls|http|node:http|https|node:https|dns|node:dns|fs|node:fs|node:fs\/promises|fs\/promises|worker_threads|node:worker_threads)['"]|require\(|import\(|process\.env|PrismaClient|fetch\(|spawn|execSync|execFile/;
  for (const f of ['./identity-verifier.mjs', './test-support/fake-db-executor.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!FORBIDDEN.test(src), `${f} chứa import/khái niệm bị cấm`);
  }
  for (const f of ['./harness.mjs', '../guards/pg-dryrun-guard.mjs', './identity-verifier.mjs']) {
    assert.ok(!readFileSync(new URL(f, import.meta.url), 'utf8').includes('fake-db-executor'), `${f} import fake`);
  }
});
