// Test M-03: che giá trị nhạy cảm trên mọi kênh đầu ra (stdout/stderr CLI, thông điệp lỗi, JSON.stringify kết quả, reporter JUnit/TAP),
// kể cả khi giá trị nhạy cảm nằm ở argv, khóa/tên trong fixture, hoặc trong exception/Proxy của executor. Chỉ dùng chuỗi giả, không token dạng thật.
// Offline: không DB, không .env, không Prisma, không mạng. Chạy: node --test backend/scripts/pg-harness/harness.redaction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, EXIT, validateFixture } from './harness.mjs';
import { runPreMigrateIdentityCheck } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';

const PW = 'SYNTH-PW-never-print';
const URL_SENTINEL = `postgresql://synthetic_user:${PW}@127.0.0.1:55432/x`;
const SENTINELS = [PW, URL_SENTINEL, 'synthetic_user', 'SYNTH-TOKEN-should-never-print-0123456789'];
const CLI = fileURLToPath(new URL('./harness.mjs', import.meta.url));
const FIXTURE = new URL('./fixtures.synthetic.json', import.meta.url);
const good = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'm03-redaction-'));
const put = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return pathToFileURL(p); };
const leaks = (text) => SENTINELS.filter((s) => text.includes(s));
const minimalEnv = () => (process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {});
const exec = (argv, fixtureUrl) => {
  const out = []; const err = [];
  const code = run(argv, {}, { out: (s) => out.push(s), err: (s) => err.push(s) }, new Date(), false, fixtureUrl);
  return { code, all: [...out, ...err].join('\n') };
};

const ARGV_CASES = [URL_SENTINEL, `--password=${PW}`, `--skip-${PW}`, `--token=${PW}`];

test('M03 argv chứa giá trị nhạy cảm → exit 64, không phản chiếu argv ra stdout/stderr (in-process)', () => {
  for (const a of ARGV_CASES) {
    const r = exec([a, '--execute']);
    assert.equal(r.code, EXIT.USAGE);
    assert.deepEqual(leaks(r.all), [], 'lộ qua argv');
    assert.match(r.all, /^USAGE: /);
  }
});

test('M03 argv chứa giá trị nhạy cảm → tiến trình con CLI cũng không lộ ra stdout/stderr', () => {
  for (const a of ARGV_CASES) {
    const r = spawnSync(process.execPath, [CLI, a], { env: minimalEnv(), encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, EXIT.USAGE);
    assert.deepEqual(leaks(`${r.stdout}${r.stderr}`), [], 'lộ qua tiến trình con');
  }
});

const FIXTURE_CASES = [
  ['customers[0].key là chuỗi kết nối giả + dòng sai MST', (c) => { c.customers[0].key = URL_SENTINEL; c.customers[0].taxId = 'bad'; }],
  ['customers[0].key chứa mật khẩu giả (không khớp mẫu bí mật) + dòng sai MST', (c) => { c.customers[0].key = `k-${PW}`; c.customers[0].taxId = 'bad'; }],
  ['contacts[0].fullName là chuỗi kết nối giả + email ngoài miền', (c) => { c.contacts[0].fullName = URL_SENTINEL; c.contacts[0].email = 'x@y.test'; }],
  ['contacts[0].fullName chứa mật khẩu giả + thiếu isDemo', (c) => { c.contacts[0].fullName = `n-${PW}`; c.contacts[0].isDemo = false; }],
  ['key trùng, chứa mật khẩu giả', (c) => { c.customers[0].key = `k-${PW}`; c.customers[1].key = `k-${PW}`; }],
];

for (const [name, mutate] of FIXTURE_CASES) {
  test(`M03 fixture [${name}] → bị từ chối, không phản chiếu giá trị fixture ra đầu ra`, () => {
    const c = good(); mutate(c);
    const problems = validateFixture(c);
    assert.ok(problems.length > 0);
    assert.deepEqual(leaks(problems.join('\n')), [], 'validateFixture lộ');
    for (const argv of [[], ['--execute']]) {
      const r = exec(argv, put('fx.json', JSON.stringify(c)));
      assert.equal(r.code, EXIT.GATE_DENIED);
      assert.match(r.all, /ASSET_INVALID/);
      assert.deepEqual(leaks(r.all), [], `run(${argv.join(' ') || 'dry-run'}) lộ`);
    }
  });
}

test('M03 fixture đối chứng: vẫn chỉ ra đúng vị trí lỗi (chỉ số dòng) sau khi bỏ phản chiếu giá trị', () => {
  const c = good(); c.customers[1].taxId = 'bad';
  const p = validateFixture(c);
  assert.equal(p.length, 1);
  assert.match(p[0], /customers\[1\]/);
  assert.match(p[0], /MST/);
});

// ---- Executor: exception object / Proxy / getter. Executor chỉ là bản giả trong bộ nhớ, không I/O. ----
const confirmCode = () => expectedConfirmationCode({ dbName: FAKE.DB, stamp: FAKE.STAMP, hostPort: `127.0.0.1:${FAKE.PORT}`, createdAt: FAKE.CREATED });
const gateInputs = () => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true,
  url: `postgresql://${FAKE.APP}:${PW}@127.0.0.1:${FAKE.PORT}/${FAKE.DB}`, guardEnv: {}, expectedPort: FAKE.PORT,
  now: new Date('2026-10-24T12:05:00Z'), label: `SISCOM_DISPOSABLE_TEST:${FAKE.STAMP}:${FAKE.CREATED}`, confirmDb: FAKE.DB,
  confirmCode: confirmCode(), interactive: true,
});
const expected = () => ({
  db: FAKE.DB, stamp: FAKE.STAMP, port: FAKE.PORT, runtime: 'native', now: new Date('2026-10-24T12:05:00Z'),
  confirmation: { dbName: FAKE.DB, code: confirmCode(), interactive: true },
});
const okScript = () => ({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: { host: '127.0.0.1', port: FAKE.PORT, runtime: 'native' } });
const leakyErrors = [
  ['Error có message chứa chuỗi kết nối giả', () => new Error(`lỗi ${URL_SENTINEL}`)],
  ['Error có cause + toJSON chứa mật khẩu giả', () => Object.assign(new Error('x', { cause: { pw: PW } }), { toJSON: () => ({ pw: PW }), pw: PW })],
  ['đối tượng thường (không phải Error)', () => ({ message: URL_SENTINEL, password: PW })],
  ['chuỗi thô', () => URL_SENTINEL],
  ['Error có getter message ném lỗi', () => Object.defineProperty(new Error('x'), 'message', { get() { throw new Error(PW); } })],
  ['Proxy ném lỗi ở mọi bẫy', () => new Proxy({}, { get() { throw new Error(PW); }, ownKeys() { throw new Error(PW); } })],
  ['null', () => null],
];

for (const [name, make] of leakyErrors) {
  test(`M03 executor.readIdentity từ chối (${name}) → EXECUTOR_ERROR cố định, không lộ, không gọi migrateDeploy`, async () => {
    const ex = new FakeDbExecutor(okScript());
    ex.readIdentity = async (role) => { ex.calls.push({ method: 'readIdentity', role }); throw make(); };
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
    assert.equal(r.ok, false);
    assert.deepEqual(r.reasons.map((x) => x.code), ['EXECUTOR_ERROR']);
    assert.deepEqual(leaks(JSON.stringify(r)), []);
    assert.deepEqual(ex.calls.map((c) => c.method), ['readIdentity']);
  });
}

test('M03 executor.readIdentity ném đồng bộ (không async) → vẫn fail-closed, không lộ', async () => {
  const ex = new FakeDbExecutor(okScript());
  ex.readIdentity = () => { throw new Error(URL_SENTINEL); };
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.deepEqual(r.reasons.map((x) => x.code), ['EXECUTOR_ERROR']);
  assert.deepEqual(leaks(JSON.stringify(r)), []);
});

test('M03 executor là Proxy có bẫy get ném lỗi → EXECUTOR_INVALID cố định, không ném, không lộ', async () => {
  const ex = new Proxy(new FakeDbExecutor(okScript()), { get() { throw new Error(PW); }, has() { throw new Error(PW); } });
  let r;
  await assert.doesNotReject(async () => { r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() }); });
  assert.deepEqual(r.reasons.map((x) => x.code), ['EXECUTOR_INVALID']);
  assert.deepEqual(leaks(JSON.stringify(r)), []);
});

test('M03 cổng chưa đạt (thiếu phê duyệt) → executor KHÔNG được gọi và lý do không chứa URL/mật khẩu', async () => {
  const ex = new FakeDbExecutor(okScript());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: { ...gateInputs(), approvalRef: undefined }, expected: expected() });
  assert.equal(r.ok, false);
  assert.deepEqual(ex.calls, []);
  assert.deepEqual(leaks(JSON.stringify(r)), []);
});

test('M03 bằng chứng executor chứa giá trị nhạy cảm ở trường lạ/giá trị sai → lý do cố định, không phản chiếu', async () => {
  const bad = okScript();
  bad.owner.currentUser = URL_SENTINEL;
  bad.app.dbLabel = `x-${PW}`;
  bad.app[`k_${PW}`] = PW;
  const ex = new FakeDbExecutor(bad);
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, false);
  assert.deepEqual(leaks(JSON.stringify(r)), []);
  assert.ok(!ex.calls.some((c) => c.method === 'migrateDeploy'));
});

// ---- Reporter: kết quả JUnit/TAP của một bộ test hiện có (fixture-guard, chứa sentinel giả) không được chứa giá trị giả ----
test('M03 reporter JUnit/TAP của bộ fixture-guard không chứa giá trị nhạy cảm giả', () => {
  const target = fileURLToPath(new URL('./harness.fixture-guard.test.mjs', import.meta.url));
  for (const reporter of ['junit', 'tap']) {
    const r = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, target], { encoding: 'utf8', timeout: 120000, env: minimalEnv() });
    assert.equal(r.status, 0, `${reporter}: exit ${r.status}`);
    assert.deepEqual(leaks(`${r.stdout}${r.stderr}`), [], reporter);
  }
});

test('dọn thư mục tạm', () => { rmSync(dir, { recursive: true, force: true }); });
