// I-04: ma trận ca ÂM tập trung cho cổng định danh PG (identity-verifier.mjs). CHỈ bổ sung ca chưa có ở
// identity-verifier.test.mjs (F-02/G01), identity-target-bind.test.mjs (G02), identity-toctou-snapshot.test.mjs (H01) và #126 (I01 type-confusion).
// Thuần bộ nhớ + FakeDbExecutor: không DB, không mạng, không .env, không Prisma; mật khẩu trong URL là chuỗi giả; không sửa --execute.
// Chạy: node --test backend/scripts/pg-harness/identity-negative-matrix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { verifyDbIdentity, runPreMigrateIdentityCheck, guardedMigrateDeploy } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED, OWNER, APP } = FAKE;
const NOW = new Date('2026-10-24T12:30:00Z');
const PW = 'synthetic-placeholder';
const LABEL = `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`;
const codeFor = (o = {}) => expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED, ...o });
const CODE = codeFor();
const conn = (o = {}) => ({ host: '127.0.0.1', port: PORT, runtime: 'native', ...o });
const evidence = (o = {}) => ({ connection: conn(), owner: goodSnapshot('owner'), app: goodSnapshot('app'), ...o });
const expected = (o = {}) => ({ db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true }, ...o });
const urlOf = (o = {}) => `postgresql://${o.user ?? APP}:${PW}@${o.host ?? '127.0.0.1'}:${o.port ?? PORT}/${o.db ?? DB}${o.suffix ?? ''}`;
const gateInputs = (o = {}) => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true, url: urlOf(), guardEnv: {}, expectedPort: PORT, now: NOW,
  label: LABEL, confirmDb: DB, confirmCode: CODE, interactive: true, ...o,
});
const script = (o = {}) => ({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: conn(), ...o });
const codes = (r) => r.reasons.map((x) => x.code);
const migrateCalls = (ex) => ex.calls.filter((c) => c.method === 'migrateDeploy').length;
const both = (o) => ({ owner: goodSnapshot('owner', o), app: goodSnapshot('app', o) });
const labelOf = (iso) => `SISCOM_DISPOSABLE_TEST:${STAMP}:${iso}`;

/** Đường ống đầy đủ qua FakeDbExecutor: phải từ chối, không verdict, không migrate, không lộ mật khẩu/giá trị DB. */
async function pipelineDenied(g, e, s = script()) {
  const ex = new FakeDbExecutor(s);
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, undefined);
  assert.equal(migrateCalls(ex), 0);
  assert.ok(!JSON.stringify(r.reasons).includes(PW));
  return { r, ex };
}
async function pipelineOk(g = gateInputs(), e = expected(), s = script()) {
  const ex = new FakeDbExecutor(s);
  const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: g, expected: e });
  return { r, ex };
}
async function withPolluted(key, value, fn) {
  assert.ok(!(key in Object.prototype), `Object.prototype đã có "${key}" trước test`);
  Object.prototype[key] = value;
  try { return await fn(); } finally { delete Object.prototype[key]; }
}

// ───────── 0. đối chứng: dữ liệu hợp lệ vẫn đạt (ma trận không làm cổng chặn nhầm) ─────────
test('I04-0 đối chứng: đường ống hợp lệ vẫn cấp verdict', async () => {
  const { r } = await pipelineOk();
  assert.equal(r.ok, true, codes(r).join(','));
});

// ───────── 1. URL percent-encoding / biến thể đích: mọi dạng tương đương-nhưng-khác-chuỗi đều bị từ chối trước executor ─────────
const URL_VARIANTS = {
  'DB hợp lệ viết bằng %XX (chữ số)': urlOf({ db: DB.replace('2026', '%32%30%32%36') }),
  'DB hợp lệ có %5F (gạch dưới)': urlOf({ db: DB.replace('_', '%5F') }),
  'DB mã hoá kép %255F': urlOf({ db: DB.replace('_', '%255F') }),
  'DB + %2F (dấu / mã hoá)': urlOf({ db: `${DB}%2Fx` }),
  'DB + %3F (dấu ? mã hoá)': urlOf({ db: `${DB}%3Fhost=10.0.0.5` }),
  'DB + %0A (xuống dòng)': urlOf({ db: `${DB}%0A` }),
  'DB + tab thô': urlOf({ db: `${DB}\t` }),
  'DB viết hoa': urlOf({ db: DB.toUpperCase() }),
  'role hợp lệ viết bằng %73': urlOf({ user: APP.replace('siscom', '%73iscom') }),
  'role %53 (chữ hoa sau giải mã)': urlOf({ user: APP.replace('s', '%53') }),
  'role + %40evil (@ mã hoá)': urlOf({ user: `${APP}%40evil` }),
  'host mã hoá %31%32%37.0.0.1': urlOf({ host: '%31%32%37.0.0.1' }),
  'host 127.1 (rút gọn)': urlOf({ host: '127.1' }),
  'host 0x7f.0.0.1 (hex)': urlOf({ host: '0x7f.0.0.1' }),
  'host 0177.0.0.1 (bát phân)': urlOf({ host: '0177.0.0.1' }),
  'host có dấu chấm cuối': urlOf({ host: '127.0.0.1.' }),
  'host toàn-rộng Unicode': urlOf({ host: '１２７.０.０.１' }),
  'host + xuống dòng': urlOf({ host: '127.0.0.1\n' }),
  'host + \\@evil': urlOf({ host: '127.0.0.1\\@evil' }),
  'cổng có số 0 đứng trước': urlOf({ port: `0${PORT}` }),
  'cổng có dấu +': urlOf({ port: `+${PORT}` }),
  'cổng + %20': urlOf({ port: `${PORT}%20` }),
  'cổng viết bằng %35': urlOf({ port: '%35%35432' }),
  'scheme viết hoa': urlOf().replace('postgresql', 'POSTGRESQL'),
  'scheme rút gọn postgres:': urlOf().replace('postgresql', 'postgres'),
  'dấu ? rỗng cuối URL': urlOf({ suffix: '?' }),
  'dấu # rỗng cuối URL': urlOf({ suffix: '#' }),
  'không có userinfo': `postgresql://127.0.0.1:${PORT}/${DB}`,
};
for (const [name, url] of Object.entries(URL_VARIANTS)) {
  test(`I04-1 URL: ${name} → từ chối, executor không bị gọi`, async () => {
    const { ex } = await pipelineDenied(gateInputs({ url }), expected());
    assert.equal(ex.calls.length, 0);
  });
}

// ───────── 2. host/port/runtime của bằng chứng kết nối (hàm thuần) ─────────
const denyConn = (name, c, want) => test(`I04-2 kết nối: ${name} → ${want}`, () => {
  const r = verifyDbIdentity(evidence({ connection: c }), expected());
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes(want), codes(r).join(','));
});
denyConn('host có khoảng trắng cuối', conn({ host: '127.0.0.1 ' }), 'HOST_NOT_ALLOWED');
denyConn('host có số 0 đứng trước', conn({ host: '127.000.000.001' }), 'HOST_NOT_ALLOWED');
denyConn('host IPv6 ánh xạ IPv4', conn({ host: '::ffff:127.0.0.1' }), 'HOST_NOT_ALLOWED');
denyConn('host 127.0.0.2 (loopback khác)', conn({ host: '127.0.0.2' }), 'HOST_NOT_ALLOWED');
denyConn('host rỗng', conn({ host: '' }), 'HOST_NOT_ALLOWED');
denyConn('host là số', conn({ host: 2130706433 }), 'HOST_NOT_ALLOWED');
denyConn('cổng kết nối là chuỗi', conn({ port: String(PORT) }), 'PORT_MISMATCH');
denyConn('cổng kết nối thập phân', conn({ port: PORT + 0.5 }), 'PORT_MISMATCH');
denyConn('cổng kết nối NaN', conn({ port: NaN }), 'PORT_MISMATCH');
denyConn('runtime viết hoa', conn({ runtime: 'NATIVE' }), 'RUNTIME_MISMATCH');
denyConn('runtime thiếu', conn({ runtime: undefined }), 'RUNTIME_MISMATCH');

for (const p of ['55432', 0, -1, 65536, 70000, 1.5, NaN, Infinity, null, undefined, 5432]) {
  test(`I04-2 expected.port=${String(p)} (kiểu/miền không hợp lệ hoặc cụm chung) → từ chối`, () => {
    const r = verifyDbIdentity(evidence({ connection: conn({ port: p }) }), expected({ port: p }));
    assert.equal(r.ok, false);
    assert.ok(codes(r).some((c) => c === 'PORT_NOT_DECLARED' || c === 'PORT_SHARED_CLUSTER'), codes(r).join(','));
  });
}
test('I04-2 cổng 5432 + sharedClusterApproved không phải đúng true (chuỗi/1/"true") → vẫn từ chối', () => {
  for (const v of ['true', 1, 'yes', {}, [true]]) {
    const r = verifyDbIdentity(evidence({ connection: conn({ port: 5432 }), owner: goodSnapshot('owner', { serverPort: 5432 }), app: goodSnapshot('app', { serverPort: 5432 }) }), expected({ port: 5432, sharedClusterApproved: v }));
    assert.ok(codes(r).includes('PORT_SHARED_CLUSTER'), `sharedClusterApproved=${JSON.stringify(v)}`);
  }
});

// serverAddr / serverPort do PG báo (container)
const cev = (o) => ({ connection: conn({ runtime: 'container' }), owner: goodSnapshot('owner', o), app: goodSnapshot('app', o) });
for (const addr of ['172.20.999.999', '172.20.256.1', '172.20.1.256', '172.016.0.2', '172.020.1.1', '172.20.1.1/16', '172.20.1', '172.20.1.1.1', '172.20.1.1\n', ' 172.20.1.1', '172.15.255.255', '172.32.0.0', '::ffff:172.20.1.1', 'fd00::1', 172]) {
  test(`I04-2 container: serverAddr ${JSON.stringify(addr)} không phải IPv4 cầu nối hợp lệ → từ chối`, () => {
    const r = verifyDbIdentity(cev({ serverAddr: addr, serverPort: 5432 }), expected({ runtime: 'container' }));
    assert.equal(r.ok, false, `lọt: ${JSON.stringify(addr)}`);
  });
}
for (const addr of ['172.16.0.0', '172.31.255.255', '172.17.0.2']) {
  test(`I04-2 container: biên hợp lệ ${addr} vẫn đạt (đối chứng, tránh chặn nhầm)`, () => {
    assert.equal(verifyDbIdentity(cev({ serverAddr: addr, serverPort: 5432 }), expected({ runtime: 'container' })).ok, true);
  });
}
for (const p of [0, -1, 65536, 70000, 1.5, '5432', NaN, null]) {
  test(`I04-2 container: serverPort ${String(p)} ngoài 1..65535 hoặc sai kiểu → từ chối`, () => {
    assert.equal(verifyDbIdentity(cev({ serverPort: p }), expected({ runtime: 'container' })).ok, false, `lọt: ${String(p)}`);
  });
}
for (const [name, o] of Object.entries({
  'serverAddr 127.0.0.2': { serverAddr: '127.0.0.2' }, 'serverAddr ::ffff:127.0.0.1': { serverAddr: '::ffff:127.0.0.1' }, 'serverAddr 127.0.0.1/32': { serverAddr: '127.0.0.1/32' },
  'serverAddr xuống dòng': { serverAddr: '127.0.0.1\n' }, 'serverAddr là số': { serverAddr: 2130706433 }, 'serverPort chuỗi': { serverPort: String(PORT) }, 'serverPort thập phân': { serverPort: PORT + 0.5 },
})) {
  test(`I04-2 native: ${name} → từ chối`, () => {
    assert.equal(verifyDbIdentity(evidence({ owner: goodSnapshot('owner', o) }), expected()).ok, false);
  });
}

// ───────── 3. vai owner/app ─────────
test('I04-3 hoán đổi cả hai ảnh chụp (owner mang danh app và ngược lại) → từ chối đủ bốn mã', () => {
  const r = verifyDbIdentity(evidence({ owner: goodSnapshot('app'), app: goodSnapshot('owner') }), expected());
  for (const c of ['OWNER_USER_MISMATCH', 'APP_USER_MISMATCH', 'OWNER_SESSION_USER_MISMATCH', 'APP_SESSION_USER_MISMATCH']) assert.ok(codes(r).includes(c), c);
});
for (const role of ['owner', 'app']) {
  const want = role === 'owner' ? OWNER : APP;
  for (const [name, o] of Object.entries({
    'role viết hoa': { currentUser: want.toUpperCase(), sessionUser: want.toUpperCase() },
    'role có khoảng trắng cuối': { currentUser: `${want} `, sessionUser: `${want} ` },
    'role cùng mẫu stamp lệch 1 giây': { currentUser: want.replace('120000', '120001'), sessionUser: want.replace('120000', '120001') },
    'chỉ session_user lệch': { sessionUser: want.replace('120000', '120001') },
    'dbOwner là role app': { dbOwner: APP },
    'dbOwner viết hoa': { dbOwner: OWNER.toUpperCase() },
    'dbOwner thiếu': { dbOwner: undefined },
    'is_superuser = "ON"': { sessionIsSuperuser: 'ON' },
    'is_superuser = true (boolean)': { sessionIsSuperuser: true },
    'is_superuser thiếu': { sessionIsSuperuser: undefined },
    'rolcanlogin = "true"': { rolcanlogin: 'true' },
    'rolcanlogin = 1': { rolcanlogin: 1 },
    'nonDemoRowCount = "0"': { nonDemoRowCount: '0' },
    'nonDemoRowCount = NaN': { nonDemoRowCount: NaN },
    'nonDemoRowCount = 0.5': { nonDemoRowCount: 0.5 },
    'nonDemoRowCount = -1': { nonDemoRowCount: -1 },
    'nonDemoRowCount = 1e21': { nonDemoRowCount: 1e21 },
    'nonDemoRowCount = [0]': { nonDemoRowCount: [0] },
  })) {
    test(`I04-3 ${role}: ${name} → từ chối`, () => {
      assert.equal(verifyDbIdentity(evidence({ [role]: goodSnapshot(role, o) }), expected()).ok, false);
    });
  }
}

// ───────── 4. tên DB / stamp (lịch hợp lệ, biên) ─────────
const withDb = (db, stamp) => expected({ db, stamp, confirmation: { dbName: db, code: CODE, interactive: true } });
for (const st of ['20260230_120000', '20250229_120000', '20261024_240000', '20261024_120060', '20260001_120000', '20261000_120000', '00000000_000000', '20261031_235960']) {
  test(`I04-4 stamp lịch không tồn tại ${st} → DB_NAME_INVALID`, () => {
    const r = verifyDbIdentity(evidence(), withDb(`siscom_crm_test_${st}`, st));
    assert.ok(codes(r).includes('DB_NAME_INVALID'));
  });
}
test('I04-4 ngày nhuận 20240229 là stamp hợp lệ (không bị cổng chặn nhầm): tên DB được chấp nhận, chỉ bằng chứng lệch mới bị từ chối', () => {
  const r = verifyDbIdentity(evidence(), withDb('siscom_crm_test_20240229_120000', '20240229_120000'));
  assert.ok(!codes(r).includes('DB_NAME_INVALID') && !codes(r).includes('STAMP_MISMATCH'), codes(r).join(','));
});
for (const db of [`${DB} `, `${DB}\n`, ` ${DB}`, `${DB}\u0000`, 'siscom_crm_test_２０２６１０２４_１２００００', `${DB}_x`, DB.replace('test', 'TEST'), DB.replace('crm_test', 'crm_dev'), { toString: () => DB }, [DB], 123]) {
  test(`I04-4 db=${JSON.stringify(db)} biến thể/kiểu lạ → DB_NAME_INVALID`, () => {
    const r = verifyDbIdentity(evidence(), expected({ db }));
    assert.ok(codes(r).includes('DB_NAME_INVALID'), codes(r).join(','));
  });
}
for (const st of [`${STAMP}\n`, `${STAMP} `, undefined, null, 20261024120000, [STAMP]]) {
  test(`I04-4 expected.stamp=${JSON.stringify(st)} → STAMP_MISMATCH`, () => {
    assert.ok(codes(verifyDbIdentity(evidence(), expected({ stamp: st }))).includes('STAMP_MISMATCH'));
  });
}

// ───────── 5. hiệu lực thời gian (biên chính xác) ─────────
const verifyAt = (iso, now) => verifyDbIdentity(evidence(both({ dbLabel: labelOf(iso) })), expected({ now, confirmation: { dbName: DB, code: codeFor({ createdAt: iso }), interactive: true } }));
test('I04-5 biên tuổi nhãn: đúng 2h đạt; 2h+1ms bị từ chối', () => {
  assert.equal(verifyAt('2026-10-24T12:00:00Z', new Date('2026-10-24T14:00:00Z')).ok, true);
  assert.ok(codes(verifyAt('2026-10-24T12:00:00Z', new Date('2026-10-24T14:00:00.001Z'))).includes('LABEL_EXPIRED'));
});
test('I04-5 biên nhãn ở tương lai: lệch đúng 60s đạt; 60s+1ms bị từ chối', () => {
  assert.equal(verifyAt('2026-10-24T12:00:00Z', new Date('2026-10-24T11:59:00Z')).ok, true);
  assert.ok(codes(verifyAt('2026-10-24T12:00:00Z', new Date('2026-10-24T11:58:59.999Z'))).includes('LABEL_EXPIRED'));
});
for (const iso of ['2026-02-30T12:00:00Z', '2026-13-24T12:00:00Z', '2026-10-24T24:00:00Z', '2026-10-24T12:00:60Z', '2026-10-24T12:00:00', '2026-10-24T12:00:00+07:00', '2026-10-24T12:00:00z', '2026-10-24 12:00:00Z', '2026-10-24T12:00Z', '2026-10-24T12:00:00.Z', '2026-10-24T12:00:00Z ']) {
  test(`I04-5 nhãn thời điểm ${JSON.stringify(iso)} sai mẫu/lịch → LABEL_INVALID`, () => {
    assert.ok(codes(verifyAt(iso, NOW)).includes('LABEL_INVALID'));
  });
}
test('I04-5 nhãn năm 0000 → bị từ chối (hết hạn), không ném', () => {
  assert.equal(verifyAt('0000-10-24T12:00:00Z', NOW).ok, false);
});
test('I04-5 "now" là chuỗi ISO / số epoch / Date không hợp lệ / lớp con Date mang giá trị lạ → từ chối', () => {
  for (const now of ['2026-10-24T12:30:00Z', NOW.getTime(), new Date(NaN), null, {}, { getTime: () => NOW.getTime() }]) {
    assert.equal(verifyDbIdentity(evidence(), expected({ now })).ok, false, `now=${String(now)}`);
  }
});
test('I04-5 guardedMigrateDeploy biên verdict: đúng 5 phút kể từ lúc cấp đạt; 5 phút+1ms bị từ chối', async () => {
  for (const [dt, okExpected] of [[5 * 60 * 1000, true], [5 * 60 * 1000 + 1, false]]) {
    const { r, ex } = await pipelineOk();
    assert.equal(r.ok, true);
    const now = new Date(NOW.getTime() + dt);
    if (okExpected) { await guardedMigrateDeploy(ex, r.verdict, DB, now); assert.equal(migrateCalls(ex), 1); }
    else { await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, DB, now), /MIGRATE_DENIED/); assert.equal(migrateCalls(ex), 0); }
  }
});
test('I04-5 guardedMigrateDeploy: nhãn vượt 2h tại thời điểm migrate dù verdict còn tươi (<5 phút) → từ chối', async () => {
  const issued = new Date('2026-10-24T13:59:00Z'); // nhãn 12:00:00 → tuổi 1h59
  const { r, ex } = await pipelineOk(gateInputs({ now: issued }), expected({ now: issued }));
  assert.equal(r.ok, true, codes(r).join(','));
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, DB, new Date('2026-10-24T14:00:01Z')), /MIGRATE_DENIED/);
  assert.equal(migrateCalls(ex), 0);
});
test('I04-5 guardedMigrateDeploy: đồng hồ lùi quá 60s so với lúc cấp → từ chối; lùi đúng 60s đạt', async () => {
  const a = await pipelineOk();
  await assert.rejects(() => guardedMigrateDeploy(a.ex, a.r.verdict, DB, new Date(NOW.getTime() - 60 * 1000 - 1)), /MIGRATE_DENIED/);
  const b = await pipelineOk();
  await guardedMigrateDeploy(b.ex, b.r.verdict, DB, new Date(NOW.getTime() - 60 * 1000));
  assert.equal(migrateCalls(b.ex), 1);
});

// ───────── 6. bằng chứng/xác nhận giả ─────────
for (const [name, c] of Object.entries({
  'mã viết hoa': CODE.toUpperCase(), 'mã + khoảng trắng': `${CODE} `, 'mã bị cắt': CODE.slice(0, -1), 'mã của DB khác (stamp +1s)': codeFor({ stamp: '20261024_120001', dbName: 'siscom_crm_test_20261024_120001' }),
  'mã của thời điểm tạo khác': codeFor({ createdAt: '2026-10-24T12:00:01Z' }), 'mã gắn host khác': codeFor({ hostPort: `localhost:${PORT}` }), 'mã là số': 12345, 'mã là mảng': [CODE], 'mã rỗng': '',
})) {
  test(`I04-6 xác nhận giả: ${name} → CONFIRMATION_CODE_INVALID`, () => {
    assert.ok(codes(verifyDbIdentity(evidence(), expected({ confirmation: { dbName: DB, code: c, interactive: true } }))).includes('CONFIRMATION_CODE_INVALID'));
  });
}
for (const v of ['true', 1, 'yes', undefined, null, {}]) {
  test(`I04-6 confirmation.interactive=${JSON.stringify(v)} (không phải đúng true) → CONFIRMATION_NOT_INTERACTIVE`, () => {
    assert.ok(codes(verifyDbIdentity(evidence(), expected({ confirmation: { dbName: DB, code: CODE, interactive: v } }))).includes('CONFIRMATION_NOT_INTERACTIVE'));
  });
}
test('I04-6 tên DB gõ lại có khoảng trắng / viết hoa / kiểu lạ → CONFIRMATION_DB_MISMATCH', () => {
  for (const dbName of [`${DB} `, DB.toUpperCase(), undefined, [DB], { toString: () => DB }]) {
    assert.ok(codes(verifyDbIdentity(evidence(), expected({ confirmation: { dbName, code: CODE, interactive: true } }))).includes('CONFIRMATION_DB_MISMATCH'));
  }
});
test('I04-6 nhãn chỉ một vai (vai kia thiếu/khác) hoặc hai vai hoán đổi nhãn → từ chối', () => {
  assert.ok(codes(verifyDbIdentity(evidence({ app: goodSnapshot('app', { dbLabel: undefined }) }), expected())).includes('LABEL_INCONSISTENT'));
  assert.ok(codes(verifyDbIdentity(evidence({ owner: goodSnapshot('owner', { dbLabel: undefined }) }), expected())).some((c) => c === 'LABEL_MISSING' || c === 'LABEL_INCONSISTENT'));
});
test('I04-6 bằng chứng clone từ cùng một object nhưng khác tham chiếu vẫn cần hai role khác nhau', () => {
  const s = goodSnapshot('owner');
  assert.ok(codes(verifyDbIdentity(evidence({ owner: s, app: { ...s } }), expected())).includes('ROLES_NOT_SEPARATE'));
});
test('I04-6 đường ống: executor trả bằng chứng đúng cho DB test nhưng cổng cấp cho URL role owner/app của stamp khác → từ chối', async () => {
  const other = 'siscom_t_owner_20261024_120001';
  await pipelineDenied(gateInputs({ url: urlOf({ user: other }) }), expected());
});

// ───────── 7. constructor / prototype ─────────
const own = (json) => JSON.parse(json); // JSON.parse tạo khóa __proto__ SỞ HỮU (không đổi prototype)
test('I04-7 khóa sở hữu __proto__ / constructor / prototype trong evidence, connection, snapshot → từ chối (trường lạ)', () => {
  const polluted = { __proto__: `{"__proto__":{"rolsuper":false}}`, ctor: `{"constructor":{"prototype":{"x":1}}}`, proto: `{"prototype":{}}` };
  for (const frag of Object.values(polluted)) {
    const extra = own(frag);
    for (const ev of [{ ...evidence(), ...extra }, evidence({ connection: { ...conn(), ...extra } }), evidence({ owner: { ...goodSnapshot('owner'), ...extra } }), evidence({ app: { ...goodSnapshot('app'), ...extra } })]) {
      const r = verifyDbIdentity(ev, expected());
      assert.equal(r.ok, false, frag);
      assert.ok(codes(r).some((c) => c.endsWith('FIELD_UNKNOWN')), `${frag}: ${codes(r)}`);
    }
  }
});
test('I04-7 đối tượng chỉ KẾ THỪA trường hợp lệ qua prototype (Object.create) không được coi là bằng chứng/expected hợp lệ', () => {
  const inh = (o) => Object.create(o);
  const cases = {
    'owner kế thừa': [evidence({ owner: inh(goodSnapshot('owner')) }), expected()],
    'app kế thừa': [evidence({ app: inh(goodSnapshot('app')) }), expected()],
    'connection kế thừa': [evidence({ connection: inh(conn()) }), expected()],
    'evidence kế thừa': [inh(evidence()), expected()],
    'expected kế thừa': [evidence(), inh(expected())],
    'confirmation kế thừa': [evidence(), expected({ confirmation: inh({ dbName: DB, code: CODE, interactive: true }) })],
  };
  for (const [name, [ev, ex]] of Object.entries(cases)) assert.equal(verifyDbIdentity(ev, ex).ok, false, name);
});
test('I04-7 ô nhiễm Object.prototype: trường THIẾU trong snapshot không được "điền" bằng giá trị kế thừa (hàm thuần + đường ống)', async () => {
  const miss = (k) => { const s = goodSnapshot('owner'); delete s[k]; return s; };
  for (const [k, v] of [['rolsuper', false], ['rolcreaterole', false], ['rolcreatedb', false], ['rolreplication', false], ['rolbypassrls', false], ['rolcanlogin', true], ['sessionIsSuperuser', 'off'], ['nonDemoRowCount', 0], ['dbOwner', OWNER], ['currentDatabase', DB]]) {
    await withPolluted(k, v, async () => {
      assert.equal(verifyDbIdentity(evidence({ owner: miss(k) }), expected()).ok, false, `verify: ${k}`);
      const { r } = await pipelineOk(gateInputs(), expected(), script({ owner: miss(k) }));
      assert.equal(r.ok, false, `pipeline: ${k}`);
    });
  }
});
test('I04-7 ô nhiễm Object.prototype: expected/evidence THIẾU trường không được điền từ prototype', async () => {
  const dropE = (k) => { const e = expected(); delete e[k]; return e; };
  for (const [k, v] of [['db', DB], ['stamp', STAMP], ['port', PORT], ['runtime', 'native'], ['now', NOW], ['confirmation', { dbName: DB, code: CODE, interactive: true }]]) {
    await withPolluted(k, v, async () => {
      assert.equal(verifyDbIdentity(evidence(), dropE(k)).ok, false, `verify expected.${k}`);
      assert.equal((await pipelineOk(gateInputs(), dropE(k))).r.ok, false, `pipeline expected.${k}`);
    });
  }
  for (const [k, v] of [['connection', conn()], ['owner', goodSnapshot('owner')], ['app', goodSnapshot('app')]]) {
    const ev = evidence(); delete ev[k];
    await withPolluted(k, v, async () => assert.equal(verifyDbIdentity(ev, expected()).ok, false, `evidence.${k}`));
  }
});
test('I04-7 ô nhiễm Object.prototype: gateInputs THIẾU trường (approvalRef/url/label/…) không được điền từ prototype', async () => {
  for (const k of ['approvalRef', 'url', 'label', 'confirmDb', 'confirmCode', 'expectedPort', 'interactive', 'ownerGrantedTestDb']) {
    const g = gateInputs(); const v = g[k]; delete g[k];
    await withPolluted(k, v, async () => {
      const { ex } = await pipelineDenied(g, expected());
      assert.equal(ex.calls.length, 0, `gateInputs.${k}: executor không được bị gọi`);
    });
  }
});
test('I04-7 ô nhiễm Object.prototype.toJSON và khóa lạ không làm lệch kết quả hợp lệ hay từ chối', async () => {
  for (const [k, v] of [['toJSON', () => ({})], ['i04Marker', 1]]) {
    await withPolluted(k, v, async () => {
      assert.equal((await pipelineOk()).r.ok, true, `${k}: đường hợp lệ phải vẫn đạt`);
      const bad = script({ owner: goodSnapshot('owner', { rolsuper: true }) });
      await pipelineDenied(gateInputs(), expected(), bad);
    });
  }
});

// ───────── 8. đường lỗi (error paths) ─────────
test('I04-8 executor có getter readIdentity/migrateDeploy ném lỗi → từ chối fail-closed, không ném ra ngoài', async () => {
  for (const method of ['readIdentity', 'migrateDeploy']) {
    const ex = { readIdentity: async () => goodSnapshot('owner'), migrateDeploy: async () => ({}) };
    Object.defineProperty(ex, method, { get() { throw new Error(`mô phỏng postgresql://u:${PW}@h/db`); }, enumerable: true });
    const r = await runPreMigrateIdentityCheck({ executor: ex, gateInputs: gateInputs(), expected: expected() });
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r.reasons).includes(PW));
  }
});
test('I04-8 readIdentity ném đồng bộ / reject / treo thenable lỗi / chỉ vai app lỗi → EXECUTOR_ERROR, không migrate, không lộ nội dung lỗi', async () => {
  const mk = (readIdentity) => ({ readIdentity, migrateDeploy: async () => { throw new Error('không được gọi'); } });
  const good = { owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: conn() };
  const variants = {
    'ném đồng bộ': mk(() => { throw new Error(`pw=${PW}`); }),
    'reject': mk(async () => { throw new Error(`pw=${PW}`); }),
    'thenable lỗi': mk(() => ({ then(_res, rej) { rej(new Error(`pw=${PW}`)); } })),
    'chỉ app lỗi': mk(async (role) => { if (role === 'app') throw new Error(`pw=${PW}`); return { ...good.owner, connection: good.connection }; }),
  };
  for (const [name, executor] of Object.entries(variants)) {
    const r = await runPreMigrateIdentityCheck({ executor, gateInputs: gateInputs(), expected: expected() });
    assert.equal(r.ok, false, name);
    assert.deepEqual(codes(r), ['EXECUTOR_ERROR'], name);
    assert.ok(!JSON.stringify(r).includes(PW), name);
  }
});
test('I04-8 migrateDeploy ném lỗi: bị che thành MIGRATE_EXECUTOR_ERROR (không lộ nội dung gốc), verdict đã bị tiêu thụ — thử lại KHÔNG gọi migrate lần 2', async () => {
  const { r, ex } = await pipelineOk();
  const orig = ex.migrateDeploy.bind(ex);
  let n = 0;
  ex.migrateDeploy = async (db) => { n += 1; await orig(db); throw new Error(`mô phỏng lỗi migrate ${PW}`); };
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, DB, NOW), (e) => e.code === 'MIGRATE_EXECUTOR_ERROR' && !String(e.message).includes('mô phỏng lỗi migrate') && !String(e.message).includes(PW) && e.cause === undefined);
  await assert.rejects(() => guardedMigrateDeploy(ex, r.verdict, DB, NOW), /MIGRATE_DENIED/);
  assert.equal(n, 1);
});
test('I04-8 verdict bị từ chối do cổng chưa đạt không để lại quyền: dùng lại verdict của lần chạy khác với executor mới bị từ chối', async () => {
  const a = await pipelineOk();
  const b = new FakeDbExecutor(script());
  await assert.rejects(() => guardedMigrateDeploy(b, a.r.verdict, DB, NOW), /MIGRATE_DENIED/);
  assert.equal(migrateCalls(b), 0);
  await guardedMigrateDeploy(a.ex, a.r.verdict, DB, NOW);
  assert.equal(migrateCalls(a.ex), 1);
});
test('I04-8 mọi lý do từ chối chỉ dùng mã/thông điệp cố định: không phản chiếu giá trị lạ từ DB (kể cả khóa dài/Unicode)', () => {
  const evil = 'postgresql://u:synthetic-placeholder@h/db‮<script>';
  const r = verifyDbIdentity(evidence({ owner: { ...goodSnapshot('owner'), [evil.repeat(5)]: 1, dbLabel: evil, currentUser: evil, serverAddr: evil } }), expected());
  assert.equal(r.ok, false);
  const s = JSON.stringify(r.reasons);
  assert.ok(!s.includes(PW) && !s.includes('<script>') && !s.includes('‮'));
});
