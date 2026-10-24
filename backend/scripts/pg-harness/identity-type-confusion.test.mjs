// I01: hồi quy type-confusion cho cổng định danh PG (H01/H04/H08 follow-up). Chỉ test thuần + executor giả trong bộ nhớ:
// không PostgreSQL, không mạng, không .env; mật khẩu trong URL là chuỗi giả.
// Bất biến: mọi đầu vào/bằng chứng/verdict "lạ kiểu" KHÔNG được dẫn tới verdict cho DB khác DB thử, verdict giả/cũ, hoặc migrateDeploy sai đích.
// Chạy: node --test backend/scripts/pg-harness/identity-type-confusion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { runPreMigrateIdentityCheck, guardedMigrateDeploy, verifyDbIdentity } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED, APP } = FAKE;
const DEV = 'siscom_crm_dev';
const NOW = new Date('2026-10-24T12:30:00Z');
const PW = 'synthetic-placeholder';
const LABEL = `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`;
const CODE = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED });
const urlFor = (db) => `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${db}`;
const expected = () => ({ db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true } });
const gateInputs = () => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true, url: urlFor(DB), guardEnv: {}, expectedPort: PORT, now: NOW,
  label: LABEL, confirmDb: DB, confirmCode: CODE, interactive: true,
});
const script = () => ({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: { host: '127.0.0.1', port: PORT, runtime: 'native' } });
const goodEvidence = (role) => ({ ...goodSnapshot(role), connection: { host: '127.0.0.1', port: PORT, runtime: 'native' } });
const migrates = (ex) => ex.calls.filter((c) => c.method === 'migrateDeploy');

/** Executor mà readIdentity trả giá trị THÔ do test dựng (không qua structuredClone như FakeDbExecutor). */
class RawExecutor extends FakeDbExecutor {
  constructor(make) { super(script()); this.make = make; }
  async readIdentity(role) { this.calls.push({ method: 'readIdentity', role }); return this.make(role); }
}

/** Bất biến chung: không ném, nếu cấp verdict thì chỉ cho DB thử, không migrate DB khác. */
async function run({ g = gateInputs(), e = expected(), ex = new FakeDbExecutor(script()) } = {}) {
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
  if (r.ok) assert.equal(r.verdict.db, DB, 'verdict cấp cho DB lạ');
  else assert.equal(r.verdict, undefined);
  assert.equal(migrates(ex).length, 0, 'runPreMigrateIdentityCheck không bao giờ được gọi migrateDeploy');
  return { r, ex };
}
const denied = async (opts) => {
  const { r, ex } = await run(opts);
  assert.equal(r.ok, false, JSON.stringify(r.reasons));
  return { r, ex };
};

class Evil { constructor() { this.db = DB; } }
class MyDate extends Date {}
const cyc = () => { const o = { a: 1 }; o.self = o; return o; };
const ANOMALY = {
  Map: () => new Map([['db', DEV]]),
  Set: () => new Set([DEV]),
  RegExp: () => /siscom/,
  Error: () => new Error(DEV),
  Uint8Array: () => new Uint8Array([1, 2]),
  ArrayBuffer: () => new ArrayBuffer(4),
  'Date lớp con': () => new MyDate(NOW),
  'instance lớp': () => new Evil(),
  'proto lạ': () => Object.create({ db: DEV }),
  'proto null có khóa': () => Object.assign(Object.create(null), { db: DEV }),
  'String wrapper': () => new String(DB),
  'Number wrapper': () => new Number(PORT),
  'Boolean wrapper': () => new Boolean(true),
  BigInt: () => 5n,
  'mảng chứa Map': () => [new Map()],
  'Symbol': () => Symbol('x'),
  'hàm': () => () => DEV,
  Proxy: () => new Proxy({ db: DEV }, {}),
};

// ───────── 1. Đầu vào expected/gateInputs: kiểu lạ ở TỪNG trường hợp lệ (thay giá trị thật) ─────────
const BENIGN_FOR_UNCHECKED = new Set(['BigInt', 'proto null có khóa']);
const EXPECTED_FIELDS = ['db', 'stamp', 'port', 'runtime', 'now', 'confirmation'];
const GATE_FIELDS = ['approvalRef', 'ownerGrantedTestDb', 'url', 'guardEnv', 'expectedPort', 'now', 'label', 'confirmDb', 'confirmCode', 'interactive'];
for (const [name, make] of Object.entries(ANOMALY)) {
  test(`I01 đầu vào: ${name} thay từng trường expected/gateInputs → từ chối, không migrate`, async () => {
    for (const f of EXPECTED_FIELDS) { const e = expected(); e[f] = make(); await denied({ e }); }
    for (const f of GATE_FIELDS) {
      if (f === 'guardEnv' && BENIGN_FOR_UNCHECKED.has(name)) continue; // guardEnv nhận object khóa thường; proto null được clone thành object thuần
      const g = gateInputs(); g[f] = make(); await denied({ g });
    }
  });
  test(`I01 đầu vào: ${name} lồng sâu (confirmation, guardEnv, mảng) → từ chối`, async () => {
    const e = expected(); e.confirmation.dbName = make(); await denied({ e });
    const e2 = expected(); e2.confirmation.code = make(); await denied({ e: e2 });
    // guardEnv/trường thừa không kiểm giá trị: BigInt/proto null chỉ cần KHÔNG cấp verdict sai đích
    const g = gateInputs(); g.guardEnv = { nested: [make()] };
    const g2 = gateInputs(); g2.extra = [[make()]];
    for (const gi of [g, g2]) { if (BENIGN_FOR_UNCHECKED.has(name)) await run({ g: gi }); else await denied({ g: gi }); }
  });
}

test('I01 đầu vào: Date không hợp lệ / sai kiểu cho now → từ chối', async () => {
  for (const bad of [new Date(NaN), '2026-10-24T12:30:00Z', NOW.getTime(), null, {}]) {
    const e = expected(); e.now = bad; await denied({ e });
    const g = gateInputs(); g.now = bad; await denied({ g });
  }
});

test('I01 đầu vào: khóa Symbol (kể cả không enumerable) → từ chối, executor không bị gọi', async () => {
  for (const holder of ['e', 'g']) {
    for (const enumerable of [true, false]) {
      const e = expected(); const g = gateInputs();
      Object.defineProperty(holder === 'e' ? e : g, Symbol('k'), { value: 1, enumerable, configurable: true });
      const { r, ex } = await denied({ e, g });
      assert.equal(ex.calls.length, 0);
      assert.ok(r.reasons.some((x) => x.code === 'INPUT_SNAPSHOT_INVALID'), JSON.stringify(r.reasons));
    }
  }
});

test('I01 đầu vào: accessor — getter ổn định đọc đúng 1 lần; setter-only / không enumerable không che được giá trị dev', async () => {
  // getter ổn định: chấp nhận được, nhưng chỉ đọc một lần và verdict gắn DB thử
  let n = 0;
  const e = expected(); Object.defineProperty(e, 'db', { enumerable: true, get() { n++; return DB; } });
  const { r } = await run({ e });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(n, 1);
  // setter-only: đọc ra undefined → thiếu trường → từ chối
  const e2 = expected(); Object.defineProperty(e2, 'db', { enumerable: true, set() {} }); await denied({ e: e2 });
  // thuộc tính dev không enumerable bị clone bỏ qua → thiếu trường → từ chối (không dùng giá trị ẩn)
  const e3 = expected(); delete e3.db; Object.defineProperty(e3, 'db', { value: DEV, enumerable: false }); await denied({ e: e3 });
  // getter trả kiểu lạ ở lần đọc duy nhất
  for (const make of [ANOMALY.Map, ANOMALY['instance lớp'], ANOMALY.Error]) {
    const e4 = expected(); Object.defineProperty(e4, 'db', { enumerable: true, get: make }); await denied({ e: e4 });
  }
});

test('I01 đầu vào: tham chiếu vòng → không ném, không cấp verdict sai đích', async () => {
  for (const holder of ['e', 'g']) {
    const e = expected(); const g = gateInputs();
    (holder === 'e' ? e : g).cycle = cyc();
    (holder === 'e' ? e : g).self = holder === 'e' ? e : g;
    await run({ e, g });
  }
  const e = expected(); e.db = DEV; e.confirmation.dbName = DEV; e.self = e; await denied({ e });
});

test('I01 đầu vào: khóa __proto__ / constructor / toString sở hữu không đổi được kết quả', async () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    for (const holder of ['e', 'g']) {
      const e = expected(); const g = gateInputs();
      Object.defineProperty(holder === 'e' ? e : g, key, { value: { db: DEV, url: urlFor(DEV) }, enumerable: true, configurable: true, writable: true });
      await run({ e, g });
    }
  }
});

test('I01 đầu vào: thiếu/undefined/null từng trường (kể cả lồng) → từ chối, không migrate', async () => {
  for (const f of EXPECTED_FIELDS) for (const how of ['delete', 'undefined', 'null']) {
    const e = expected(); if (how === 'delete') delete e[f]; else e[f] = how === 'null' ? null : undefined;
    await denied({ e });
  }
  for (const f of GATE_FIELDS) for (const how of ['delete', 'undefined', 'null']) {
    const g = gateInputs(); if (how === 'delete') delete g[f]; else g[f] = how === 'null' ? null : undefined;
    await denied({ g });
  }
  for (const f of ['dbName', 'code', 'interactive']) for (const how of ['delete', 'undefined', 'null']) {
    const e = expected(); if (how === 'delete') delete e.confirmation[f]; else e.confirmation[f] = how === 'null' ? null : undefined;
    await denied({ e });
  }
});

test('I01 đầu vào: executor sai kiểu (null/mảng/chuỗi/thiếu phương thức) → từ chối, không ném', async () => {
  for (const bad of [null, undefined, [], 'x', 5, {}, { readIdentity() {} }, { migrateDeploy() {} }, { readIdentity: 1, migrateDeploy: 2 }]) {
    const r = await runPreMigrateIdentityCheck({ executor: bad, gateInputs: gateInputs(), expected: expected() });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, undefined);
  }
});

// ───────── 2. URL cổng sai định dạng / đánh lừa ─────────
const BAD_URLS = [
  '', ' ', 'not a url', 'postgresql://', 'postgresql:///', 'postgresql:', '//127.0.0.1', 'http://127.0.0.1/' + DB, 'mysql://u@127.0.0.1/' + DB,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DEV}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}?host=db.example.invalid`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}?dbname=${DEV}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}#${DEV}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}/../${DEV}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}/extra`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/%E0%A4%A`,
  `postgresql://%E0%A4%A:${PW}@127.0.0.1:${PORT}/${DB}`,
  `postgresql://${APP}:${PW}@127.0.0.1:99999/${DB}`,
  `postgresql://${APP}:${PW}@127.0.0.1:/${DB}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}@evil.example.invalid/${DB}`,
  `postgresql://127.0.0.1:${PORT}@evil.example.invalid/${DB}`,
  `postgresql://${APP}:${PW}@evil.example.invalid:${PORT}/${DB}`,
  `postgresql://${APP}:${PW}@localhost:${PORT}/${DB}`,
  `postgresql://${APP}:${PW}@[::1]:${PORT}/${DB}`,
  `postgresql://${APP}:${PW}@127.0.0.1,evil.example.invalid:${PORT}/${DB}`,
  `postgresql://${APP}:${PW}@127.0.0.1:5432/${DB}`,
  `postgresql://siscom_app:${PW}@127.0.0.1:${PORT}/${DB}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}­`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}\u0000`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB}%00`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DB.toUpperCase()}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DEV.replace('d', '%64')}`,
  `postgresql://${APP}:${PW}@127.0.0.1:${PORT}/${DEV}%20`,
];
test('I01 URL: mọi URL sai định dạng / đánh lừa host-DB-role → từ chối, executor không bị gọi', async () => {
  for (const url of BAD_URLS) {
    const g = gateInputs(); g.url = url;
    const { ex } = await denied({ g });
    assert.equal(ex.calls.length, 0, `URL lọt qua tới executor: ${JSON.stringify(url)}`);
  }
});
test('I01 URL: giá trị không phải chuỗi (URL object, mảng, đối tượng toString, số, null) → từ chối', async () => {
  const vals = [new URL(urlFor(DB)), [urlFor(DB)], { toString: () => urlFor(DB) }, { href: urlFor(DB) }, 5, null, undefined, true, new String(urlFor(DB))];
  for (const url of vals) { const g = gateInputs(); g.url = url; const { ex } = await denied({ g }); assert.equal(ex.calls.length, 0); }
});
test('I01 URL: cặp URL↔expected lệch từng chiều (URL=dev/expected=test và ngược lại) → từ chối', async () => {
  const g = gateInputs(); g.url = urlFor(DEV); await denied({ g });
  const e = expected(); e.db = DEV; await denied({ e });
  const g2 = gateInputs(); g2.confirmDb = DEV; await denied({ g: g2 });
});

// ───────── 3. Bằng chứng do executor trả về (readIdentity thô) ─────────
test('I01 bằng chứng: owner/app là kiểu lạ → từ chối, không ném, không migrate', async () => {
  for (const [name, make] of Object.entries(ANOMALY)) {
    for (const which of ['owner', 'app', 'both']) {
      const ex = new RawExecutor((role) => (which === 'both' || which === role ? make() : goodEvidence(role)));
      const { r } = await run({ ex });
      assert.equal(r.ok, false, `${name}/${which}: ${JSON.stringify(r.reasons)}`);
    }
  }
});
test('I01 bằng chứng: wrapper String/Number/Boolean và kiểu lạ ở từng trường snapshot → từ chối', async () => {
  const keys = Object.keys(goodSnapshot('owner'));
  const swaps = { 'String wrapper': (v) => new String(v), 'Number wrapper': (v) => new Number(v), 'Boolean wrapper': (v) => new Boolean(v),
    Map: () => new Map(), Uint8Array: () => new Uint8Array(1), Error: () => new Error('x'), 'instance lớp': () => new Evil(), Date: () => new Date(NOW), BigInt: () => 0n };
  for (const [name, swap] of Object.entries(swaps)) for (const k of keys) for (const role of ['owner', 'app']) {
    const ex = new RawExecutor((rl) => { const s = goodEvidence(rl); if (rl === role) s[k] = swap(s[k]); return s; });
    const { r } = await run({ ex });
    assert.equal(r.ok, false, `${name} tại ${role}.${k} lọt qua`);
  }
});
test('I01 bằng chứng: kiểu lạ trong connection (host/port/runtime) → từ chối', async () => {
  for (const [name, make] of Object.entries(ANOMALY)) for (const k of ['host', 'port', 'runtime']) {
    const ex = new RawExecutor((role) => { const s = goodEvidence(role); if (role === 'owner') s.connection[k] = make(); return s; });
    const { r } = await run({ ex });
    assert.equal(r.ok, false, `${name} tại connection.${k} lọt qua`);
  }
  for (const make of [() => 'x', () => null, () => [1], () => new Map()]) {
    const ex = new RawExecutor((role) => { const s = goodEvidence(role); if (role === 'owner') s.connection = make(); return s; });
    assert.equal((await run({ ex })).r.ok, false);
  }
});
test('I01 bằng chứng: connection của app thiếu/kiểu lạ/lệch so với owner → CONNECTION_INCONSISTENT', async () => {
  const bads = [undefined, null, 'x', [], 0, true, new Map(), { host: '127.0.0.1', port: PORT, runtime: 'native', extra: DEV }, { host: '127.0.0.1', port: String(PORT), runtime: 'native' }, { host: 'evil.example.invalid', port: PORT, runtime: 'native' }];
  for (const bad of bads) {
    const ex = new RawExecutor((role) => { const s = goodEvidence(role); if (role === 'app') { if (bad === undefined) delete s.connection; else s.connection = bad; } return s; });
    const { r } = await denied({ ex });
    assert.ok(r.reasons.some((x) => x.code === 'CONNECTION_INCONSISTENT'), `${String(bad)}: ${JSON.stringify(r.reasons)}`);
  }
});
test('I01 bằng chứng: guardEnv proto null chứa PG* vẫn bị cổng từ chối', async () => {
  const g = gateInputs(); g.guardEnv = Object.assign(Object.create(null), { PGHOST: 'evil.example.invalid' });
  assert.equal((await denied({ g })).ex.calls.length, 0);
});
test('I01 bằng chứng: Proxy / getter ném lỗi / hàm / Symbol / tham chiếu vòng → từ chối, không ném, lý do không lộ nội dung', async () => {
  const makers = [
    () => new Proxy(goodEvidence('owner'), {}),
    () => { const s = goodEvidence('owner'); Object.defineProperty(s, 'x', { enumerable: true, get() { throw new Error(`boom ${PW}`); } }); return s; },
    () => ({ ...goodEvidence('owner'), f: () => 1 }),
    () => ({ ...goodEvidence('owner'), s: Symbol('s') }),
    () => { const s = goodEvidence('owner'); s.self = s; return s; },
    () => { const s = goodEvidence('owner'); s.connection.self = s.connection; return s; },
  ];
  for (const mk of makers) for (const role of ['owner', 'app']) {
    const ex = new RawExecutor((rl) => (rl === role ? mk() : goodEvidence(rl)));
    const { r } = await run({ ex });
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r.reasons).includes(PW));
  }
});
test('I01 bằng chứng: getter đổi giá trị (test→dev) trong bằng chứng chỉ đọc một lần; kết quả luôn gắn DB thử hoặc bị từ chối', async () => {
  for (let k = 0; k <= 4; k++) {
    let n = 0;
    const ex = new RawExecutor((role) => {
      const s = goodEvidence(role);
      Object.defineProperty(s, 'currentDatabase', { enumerable: true, get() { return n++ < k ? DB : DEV; } });
      return s;
    });
    await run({ ex });
  }
});
test('I01 bằng chứng: executor trả null/undefined/mảng/chuỗi/số/Promise lồng → từ chối', async () => {
  for (const v of [null, undefined, [], 'x', 0, true, Promise.resolve(goodEvidence('owner')), { then(res) { res(null); } }]) {
    const ex = new RawExecutor(() => v);
    assert.equal((await run({ ex })).r.ok, false);
  }
});
test('I01 bằng chứng: thiếu/undefined/null từng trường snapshot & connection → từ chối', async () => {
  for (const k of Object.keys(goodSnapshot('owner'))) for (const how of ['delete', 'undefined', 'null']) for (const role of ['owner', 'app']) {
    const ex = new RawExecutor((rl) => { const s = goodEvidence(rl); if (rl === role) { if (how === 'delete') delete s[k]; else s[k] = how === 'null' ? null : undefined; } return s; });
    assert.equal((await run({ ex })).r.ok, false, `${how} ${role}.${k} lọt qua`);
  }
  for (const k of ['host', 'port', 'runtime']) for (const how of ['delete', 'undefined', 'null']) {
    const ex = new RawExecutor((rl) => { const s = goodEvidence(rl); if (rl === 'owner') { if (how === 'delete') delete s.connection[k]; else s.connection[k] = how === 'null' ? null : undefined; } return s; });
    assert.equal((await run({ ex })).r.ok, false, `${how} connection.${k} lọt qua`);
  }
  const noConn = new RawExecutor((rl) => { const s = goodEvidence(rl); delete s.connection; return s; });
  assert.equal((await run({ ex: noConn })).r.ok, false);
});
test('I01 bằng chứng: trường lạ (khóa chuỗi/Symbol) trong snapshot → từ chối', async () => {
  const ex = new RawExecutor((rl) => ({ ...goodEvidence(rl), extra: 1 }));
  assert.equal((await run({ ex })).r.ok, false);
  const sym = new RawExecutor((rl) => { const s = goodEvidence(rl); s[Symbol('k')] = DEV; return s; });
  await run({ ex: sym }); // Symbol bị structuredClone bỏ; kết quả (nếu ok) vẫn chỉ gắn DB thử
});

// ───────── 4. verifyDbIdentity (hàm thuần) với kiểu lạ ─────────
test('I01 verifyDbIdentity: kiểu lạ cho evidence/expected → từ chối, không ném, không verdict dùng được', async () => {
  const good = { connection: { host: '127.0.0.1', port: PORT, runtime: 'native' }, owner: goodSnapshot('owner'), app: goodSnapshot('app') };
  for (const [name, make] of Object.entries(ANOMALY)) {
    for (const [ev, ex] of [[make(), expected()], [good, make()], [{ ...good, owner: make() }, expected()], [{ ...good, connection: make() }, expected()]]) {
      let v;
      assert.doesNotThrow(() => { v = verifyDbIdentity(ev, ex); }, name);
      if (v.ok) {
        // chỉ chấp nhận khi dữ liệu vẫn đúng hoàn toàn (vd. Date lớp con ở trường không dùng); verdict này KHÔNG có quyền migrate
        const executor = new FakeDbExecutor(script());
        await assert.rejects(() => guardedMigrateDeploy(executor, v, DB, NOW), /MIGRATE_DENIED/);
        assert.equal(migrates(executor).length, 0);
      }
    }
  }
});

// ───────── 5. guardedMigrateDeploy: verdict giả/stale/sai DB/kiểu lạ ─────────
async function realVerdict() {
  const ex = new FakeDbExecutor(script());
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  return { ex, v: r.verdict };
}
const forgeries = (v) => ({
  'structuredClone': () => structuredClone(v),
  'spread': () => ({ ...v }),
  'Object.assign': () => Object.assign({}, v),
  'JSON round-trip': () => JSON.parse(JSON.stringify(v)),
  'Object.create(verdict)': () => Object.create(v),
  'Proxy(verdict)': () => new Proxy(v, {}),
  'literal ok:true': () => ({ ok: true, reasons: [], db: DB, stamp: STAMP }),
  'đóng băng literal': () => Object.freeze({ ok: true, reasons: Object.freeze([]), db: DB, stamp: STAMP }),
  'Map': () => new Map([['ok', true]]),
  'mảng': () => [v],
  'chuỗi': () => 'ok',
  'null': () => null,
  'undefined': () => undefined,
  'hàm': () => Object.assign(() => 1, v),
  'verifyDbIdentity (hàm thuần)': () => verifyDbIdentity({ connection: { host: '127.0.0.1', port: PORT, runtime: 'native' }, owner: goodSnapshot('owner'), app: goodSnapshot('app') }, expected()),
});
test('I01 guardedMigrateDeploy: verdict giả/sao chép/Proxy/prototype → MIGRATE_DENIED, executor không bị gọi', async () => {
  const { ex, v } = await realVerdict();
  for (const [name, mk] of Object.entries(forgeries(v))) {
    await assert.rejects(() => guardedMigrateDeploy(ex, mk(), DB, NOW), /MIGRATE_DENIED/, name);
  }
  assert.equal(migrates(ex).length, 0);
  // verdict thật vẫn dùng được đúng một lần sau mọi giả mạo thất bại
  await guardedMigrateDeploy(ex, v, DB, NOW);
  assert.equal(migrates(ex).length, 1);
  assert.equal(migrates(ex)[0].db, DB);
  await assert.rejects(() => guardedMigrateDeploy(ex, v, DB, NOW), /MIGRATE_DENIED/);
  assert.equal(migrates(ex).length, 1);
});
test('I01 guardedMigrateDeploy: tham số db sai kiểu/đánh lừa → MIGRATE_DENIED, không migrate', async () => {
  const dbs = [DEV, new String(DB), [DB], { toString: () => DB }, { valueOf: () => DB }, `${DB} `, `${DB}­`, DB.toUpperCase(), '', null, undefined, 5, Symbol.for('x'), `${DB}\0`];
  for (const bad of dbs) {
    const { ex, v } = await realVerdict();
    await assert.rejects(() => guardedMigrateDeploy(ex, v, bad, NOW), /MIGRATE_DENIED/);
    assert.equal(migrates(ex).length, 0, `db lạ lọt tới migrate: ${String(typeof bad)}`);
  }
});
test('I01 guardedMigrateDeploy: executor khác (Proxy/bản sao/lớp con/mồi) → MIGRATE_DENIED', async () => {
  const { ex, v } = await realVerdict();
  const decoys = [
    new Proxy(ex, {}),
    { readIdentity: ex.readIdentity.bind(ex), migrateDeploy: ex.migrateDeploy.bind(ex) },
    Object.create(ex),
    new FakeDbExecutor(script()),
    null, undefined, 'x', [], {},
  ];
  for (const d of decoys) await assert.rejects(() => guardedMigrateDeploy(d, v, DB, NOW), /MIGRATE_DENIED/);
  assert.equal(migrates(ex).length, 0);
  if (decoys[3] instanceof FakeDbExecutor) assert.equal(migrates(decoys[3]).length, 0);
});
test('I01 guardedMigrateDeploy: đồng hồ sai kiểu / quá hạn / tương lai → từ chối, không migrate', async () => {
  const stale = [new Date(NOW.getTime() + 5 * 60 * 1000 + 1), new Date(NOW.getTime() + 3 * 60 * 60 * 1000), new Date(NOW.getTime() - 61 * 1000)];
  const wrongType = [NOW.getTime(), NOW.toISOString(), null, undefined, {}, new Date(NaN), new Proxy(new Date(NOW), {}), { getTime: () => NOW.getTime() }];
  for (const now of [...stale, ...wrongType]) {
    const { ex, v } = await realVerdict();
    await assert.rejects(() => guardedMigrateDeploy(ex, v, DB, now));
    assert.equal(migrates(ex).length, 0);
  }
});
test('I01 guardedMigrateDeploy: verdict stale đã bị xóa, không dùng lại được kể cả với đồng hồ hợp lệ', async () => {
  const { ex, v } = await realVerdict();
  await assert.rejects(() => guardedMigrateDeploy(ex, v, DB, new Date(NOW.getTime() + 10 * 60 * 1000)), /MIGRATE_DENIED/);
  await assert.rejects(() => guardedMigrateDeploy(ex, v, DB, NOW), /MIGRATE_DENIED/);
  assert.equal(migrates(ex).length, 0);
});
test('I01 guardedMigrateDeploy: gọi đồng thời hai lần chỉ migrate một lần, đúng DB thử', async () => {
  const { ex, v } = await realVerdict();
  const res = await Promise.allSettled([guardedMigrateDeploy(ex, v, DB, NOW), guardedMigrateDeploy(ex, v, DB, NOW)]);
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(migrates(ex).length, 1);
  assert.equal(migrates(ex)[0].db, DB);
});
test('I01 guardedMigrateDeploy: verdict bị đóng băng, không sửa được db/ok sau khi cấp', async () => {
  const { ex, v } = await realVerdict();
  assert.ok(Object.isFrozen(v));
  assert.throws(() => { 'use strict'; v.db = DEV; }, TypeError);
  assert.throws(() => { 'use strict'; v.ok = false; }, TypeError);
  assert.throws(() => Object.defineProperty(v, 'db', { value: DEV }), TypeError);
  assert.equal(Object.setPrototypeOf.length, 2);
  assert.throws(() => Object.setPrototypeOf(v, { db: DEV }), TypeError);
  await assert.rejects(() => guardedMigrateDeploy(ex, v, DEV, NOW), /MIGRATE_DENIED/);
});
test('I01 guardedMigrateDeploy: verdict của run A không dùng được với executor/DB của run B', async () => {
  const a = await realVerdict();
  const b = await realVerdict();
  await assert.rejects(() => guardedMigrateDeploy(b.ex, a.v, DB, NOW), /MIGRATE_DENIED/);
  await assert.rejects(() => guardedMigrateDeploy(a.ex, b.v, DB, NOW), /MIGRATE_DENIED/);
  assert.equal(migrates(a.ex).length + migrates(b.ex).length, 0);
});
