// Test offline cho test-db-guard.ts (F-03). Chỉ dùng chuỗi URL GIẢ; không DB, không .env, không Prisma, không process.env.
// Chạy (Node >= 22.18/24, tự bỏ kiểu TS): node --test backend/test/helpers/test-db-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateTestDatabaseTarget as ev, resolveTestDatabase, FORBIDDEN_DB_NAMES } from './test-db-guard.ts';

const S = '20261024_120000';
const PW = 'synthetic-placeholder';
const legacy = (o = {}) => { const { user = 'siscom_app', host = '127.0.0.1', port = '5432', db = 'siscom_crm_test_' + S, tail = '' } = o; return `postgresql://${user}:${PW}@${host}${port === '' ? '' : ':' + port}/${db}${tail}`; };
const disp = (o = {}) => legacy({ user: 'siscom_t_app_' + S, port: '55432', ...o });
const codes = (v) => v.reasons.map((r) => r.code);
const denied = (url, profile, code) => {
  const v = ev(url, profile);
  assert.equal(v.ok, false, 'phải bị từ chối: ' + profile);
  assert.equal(v.name, null);
  if (code) assert.ok(codes(v).includes(code), `thiếu ${code}; có ${codes(v)}`);
};

test('dương: legacy và disposable hợp lệ', () => {
  assert.deepEqual([ev(legacy(), 'legacy-shared-app').ok, ev(legacy(), 'legacy-shared-app').name], [true, 'siscom_crm_test_' + S]);
  assert.equal(ev(legacy({ db: 'siscom_crm_restore_' + S }), 'legacy-shared-app').ok, true);
  assert.equal(ev(legacy({ port: '' }), 'legacy-shared-app').ok, true);
  assert.equal(ev(disp(), 'disposable').ok, true);
  assert.equal(ev(disp({ user: 'siscom_t_owner_' + S }), 'disposable').ok, true);
});

test('mặc định từ chối: profile và URL thiếu/sai kiểu', () => {
  for (const p of [undefined, null, '', 'LEGACY', 'dev', 'production', 42, {}]) denied(legacy(), p, 'PROFILE_INVALID');
  for (const bad of [undefined, null, '', 42, [], {}, true]) for (const p of ['legacy-shared-app', 'disposable']) denied(bad, p, 'URL_MISSING');
  for (const bad of ['không phải url', 'postgresql://', 'postgresql://u:p@/db']) denied(bad, 'legacy-shared-app');
});

test('siscom_crm_dev và baseline đã khóa bị cấm ở mọi profile', () => {
  for (const db of FORBIDDEN_DB_NAMES) {
    denied(legacy({ db }), 'legacy-shared-app', 'DB_FORBIDDEN');
    denied(disp({ db }), 'disposable', 'DB_FORBIDDEN');
  }
  assert.ok(FORBIDDEN_DB_NAMES.includes('siscom_crm_dev'));
  denied(legacy({ db: 'siscom_crm_restore_20261014_214105' }), 'legacy-shared-app', 'DB_FORBIDDEN'); // khớp TEST_DB_RE cũ nhưng là baseline khóa
  denied(legacy({ db: 'siscom_crm_dev%00' }), 'legacy-shared-app');
  denied(legacy({ db: 'siscom_crm_%64ev' }), 'legacy-shared-app'); // mã hóa phần trăm
});

test('tên database sai dạng', () => {
  for (const db of ['', 'siscom_crm', 'siscom_crm_prod', 'siscom_crm_test_', 'siscom_crm_test_2026', 'siscom_crm_test_20261024_120000x', 'xsiscom_crm_test_' + S, 'SISCOM_CRM_TEST_' + S, 'siscom_crm_test_' + S + '/x', 'siscom_crm_test_' + S + '%2Fx', 'production', 'siscom_prod']) {
    denied(legacy({ db }), 'legacy-shared-app');
    denied(disp({ db }), 'disposable');
  }
  denied(disp({ db: 'siscom_crm_restore_' + S }), 'disposable', 'DB_NAME_NOT_DISPOSABLE'); // restore_* chỉ thuộc legacy
});

test('host ngoài 127.0.0.1', () => {
  for (const host of ['localhost', '0.0.0.0', '[::1]', '10.0.0.5', '192.168.1.10', 'db.example.com', '127.0.0.2', '127.0.0.1.evil.test', 'prod-db.internal']) {
    denied(legacy({ host }), 'legacy-shared-app', 'HOST_NOT_ALLOWED');
    denied(disp({ host }), 'disposable', 'HOST_NOT_ALLOWED');
  }
  denied(`postgresql://siscom_app:${PW}@127.0.0.1:5432,10.0.0.1:5432/siscom_crm_test_${S}`, 'legacy-shared-app'); // đa host
});

test('query/fragment có thể ghi đè host/db/options → bị cấm', () => {
  for (const tail of ['?host=10.0.0.5', '?dbname=siscom_crm_dev', '?options=-c%20search_path%3Dx', '?sslmode=disable', '?schema=public', '?', '#frag', '?host=%2Fvar%2Frun']) {
    denied(legacy({ tail }), 'legacy-shared-app', 'QUERY_NOT_ALLOWED');
    denied(disp({ tail }), 'disposable', 'QUERY_NOT_ALLOWED');
  }
});

test('giao thức sai', () => {
  for (const proto of ['postgres', 'http', 'https', 'mysql', 'file']) {
    denied(legacy().replace('postgresql://', proto + '://'), 'legacy-shared-app');
    denied(disp().replace('postgresql://', proto + '://'), 'disposable');
  }
});

test('legacy: chỉ siscom_app và cổng 5432', () => {
  for (const user of ['postgres', 'siscom_owner', 'siscom_t_app_' + S, 'SISCOM_APP', 'siscom_app2', '']) denied(legacy({ user }), 'legacy-shared-app');
  denied(legacy({ user: 'postgres' }), 'legacy-shared-app', 'ROLE_NOT_ALLOWED');
  for (const port of ['5433', '55432', '1']) denied(legacy({ port }), 'legacy-shared-app', 'PORT_NOT_ALLOWED');
});

test('disposable: tách khỏi siscom_app, postgres, role không cùng stamp', () => {
  denied(disp({ user: 'siscom_app' }), 'disposable', 'ROLE_RESERVED');
  denied(disp({ user: 'postgres' }), 'disposable', 'ROLE_RESERVED');
  for (const user of ['siscom_owner', 'siscom_t_app_', 'siscom_t_admin_' + S, 'SISCOM_T_APP_' + S, 'siscom_t_app_' + S + 'x', '']) denied(disp({ user }), 'disposable');
  denied(disp({ user: 'siscom_t_app_20261024_130000' }), 'disposable', 'STAMP_MISMATCH');
  denied(disp({ user: 'siscom_t_owner_20250101_000000' }), 'disposable', 'STAMP_MISMATCH');
});

test('disposable: cổng phải khai báo rõ và khác 5432', () => {
  denied(disp({ port: '5432' }), 'disposable', 'PORT_SHARED_CLUSTER');
  denied(disp({ port: '' }), 'disposable', 'PORT_NOT_DECLARED'); // ngầm định 5432
  for (const port of ['0', '80', '1023']) denied(disp({ port }), 'disposable');
  denied(disp({ port: '65536' }), 'disposable');
  for (const port of ['5433', '55432', '65535', '1024']) assert.equal(ev(disp({ port }), 'disposable').ok, true);
});

test('lý do từ chối không phản chiếu URL, mật khẩu, tên role/db', () => {
  const secretUrl = `postgresql://secret_role_zz:${PW}@10.9.8.7:5432/secret_db_zz?host=leak`;
  for (const p of ['legacy-shared-app', 'disposable']) {
    const text = JSON.stringify(ev(secretUrl, p));
    for (const frag of [PW, 'secret_role_zz', 'secret_db_zz', '10.9.8.7', 'leak']) assert.ok(!text.includes(frag), `lộ "${frag}"`);
  }
  let msg = '';
  try { resolveTestDatabase({ TEST_DATABASE_URL: secretUrl }, 'legacy-shared-app'); } catch (e) { msg = String(e.message); }
  assert.ok(msg.startsWith('Từ chối ['));
  for (const frag of [PW, 'secret_role_zz', 'secret_db_zz', '10.9.8.7']) assert.ok(!msg.includes(frag));
});

test('resolveTestDatabase: env tiêm, xóa DATABASE_URL, không đụng process.env', () => {
  const before = { d: process.env.DATABASE_URL, t: process.env.TEST_DATABASE_URL };
  const env = { DATABASE_URL: `postgresql://siscom_app:${PW}@127.0.0.1:5432/siscom_crm_dev`, TEST_DATABASE_URL: legacy() };
  const r = resolveTestDatabase(env, 'legacy-shared-app');
  assert.deepEqual(r, { url: legacy(), name: 'siscom_crm_test_' + S });
  assert.equal('DATABASE_URL' in env, false);
  assert.deepEqual({ d: process.env.DATABASE_URL, t: process.env.TEST_DATABASE_URL }, before);
});

test('resolveTestDatabase: fail-closed', () => {
  const thr = (env, p, re) => assert.throws(() => resolveTestDatabase(env, p), re);
  thr(undefined, 'legacy-shared-app', /ENV_NOT_PROVIDED/);
  thr(null, 'disposable', /ENV_NOT_PROVIDED/);
  thr({}, 'legacy-shared-app', /URL_MISSING/);
  thr({ TEST_DATABASE_URL: '' }, 'disposable', /URL_MISSING/);
  thr({ TEST_DATABASE_URL: legacy() }, 'nope', /PROFILE_INVALID/);
  thr({ TEST_DATABASE_URL: legacy({ db: 'siscom_crm_dev' }) }, 'legacy-shared-app', /DB_FORBIDDEN/);
  thr({ TEST_DATABASE_URL: legacy() }, 'disposable', /ROLE_RESERVED|PORT/); // URL legacy không qua được hồ sơ disposable
  thr({ TEST_DATABASE_URL: disp() }, 'legacy-shared-app', /ROLE_NOT_ALLOWED/); // và ngược lại
  thr({ DATABASE_URL: legacy(), TEST_DATABASE_URL: legacy() }, 'legacy-shared-app', /SAME_AS_DATABASE_URL/);
  assert.equal(resolveTestDatabase({ TEST_DATABASE_URL: disp() }, 'disposable').name, 'siscom_crm_test_' + S);
});

test('cách ly tĩnh: guard không import/IO; test-db.ts ủy quyền cho guard', () => {
  const dir = new URL('.', import.meta.url);
  const guard = readFileSync(new URL('test-db-guard.ts', dir), 'utf8');
  assert.ok(!/^\s*import\s/m.test(guard) && !/\brequire\s*\(/.test(guard), 'guard không được import gì');
  const code = guard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const re of [/process\.env/, /\bprisma\b/i, /child_process/, /\bnode:/, /\bfetch\s*\(/, /\bnet\b/, /\.env\b/]) assert.ok(!re.test(code), 'guard dính ' + re);
  const td = readFileSync(new URL('test-db.ts', dir), 'utf8');
  assert.ok(td.includes("resolveTestDatabase(env, 'legacy-shared-app')") && td.includes("resolveTestDatabase(env, 'disposable')"));
  assert.ok(!/delete process\.env/.test(td), 'test-db.ts không tự xóa process.env nữa (xóa qua env tiêm)');
});
