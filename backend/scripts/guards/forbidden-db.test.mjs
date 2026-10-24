// Test offline đồng bộ danh sách DB cấm (G-04). Không DB, không .env, không process.env.
// Chạy: node --test backend/scripts/guards/forbidden-db.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORBIDDEN_DB_NAMES, normalizeDbName, isForbiddenDbName } from './forbidden-db.mjs';
import { validateDisposableTarget } from './pg-dryrun-guard.mjs';
import { verifyDbIdentity } from '../pg-harness/identity-verifier.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const MUST_HAVE = ['siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948', 'siscom_app', 'postgres', 'template0', 'template1', 'siscom_crm', 'siscom_crm_prod', 'siscom_crm_production'];

test('nguồn sự thật: danh sách đóng băng, đã chuẩn hóa, chứa mọi DB bắt buộc', () => {
  assert.ok(Object.isFrozen(FORBIDDEN_DB_NAMES));
  for (const n of MUST_HAVE) assert.ok(FORBIDDEN_DB_NAMES.includes(n), 'thiếu ' + n);
  for (const n of FORBIDDEN_DB_NAMES) assert.equal(n, normalizeDbName(n), 'phải ở dạng chuẩn hóa: ' + n);
  assert.equal(new Set(FORBIDDEN_DB_NAMES).size, FORBIDDEN_DB_NAMES.length, 'không trùng lặp');
});

test('isForbiddenDbName: alias/hoa-thường/khoảng trắng/%-mã hóa/ngoặc kép đều bị coi là cấm', () => {
  for (const n of FORBIDDEN_DB_NAMES) assert.equal(isForbiddenDbName(n), true, n);
  for (const v of [' siscom_crm_dev', 'siscom_crm_dev ', '\tSISCOM_CRM_DEV\n', 'Siscom_Crm_Dev', '"siscom_crm_dev"', 'siscom_crm_%64ev', '%73iscom_crm_dev', 'POSTGRES', ' Template0 ', 'SISCOM_APP', 'siscom_crm_dev​', 'siscom_crm_dev\u0000', 'ｓｉｓｃｏｍ_crm_dev']) assert.equal(isForbiddenDbName(v), true, JSON.stringify(v));
});

test('isForbiddenDbName: mặc định từ chối với đầu vào không phải chuỗi hoặc không giải mã được', () => {
  for (const v of [undefined, null, 42, {}, [], true, '%E0%A4%A']) assert.equal(isForbiddenDbName(v), true, String(v));
  assert.equal(isForbiddenDbName('siscom_crm_test_20261024_120000'), false);
});

test('đồng bộ: 3 phiên bản (2 .mjs + test-db-guard.ts) cùng một danh sách', () => {
  const ts = read('../../test/helpers/test-db-guard.ts');
  const m = /FORBIDDEN_DB_NAMES\s*:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\]/.exec(ts);
  assert.ok(m, 'không tìm thấy FORBIDDEN_DB_NAMES trong test-db-guard.ts');
  const tsList = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual([...tsList].sort(), [...FORBIDDEN_DB_NAMES].sort(), 'test-db-guard.ts lệch nguồn sự thật');
  for (const rel of ['pg-dryrun-guard.mjs', '../pg-harness/identity-verifier.mjs']) {
    const code = stripComments(read(rel));
    assert.ok(/from\s+'(?:\.\/|\.\.\/guards\/)forbidden-db\.mjs'/.test(code), rel + ' phải import forbidden-db.mjs');
    assert.ok(!/FORBIDDEN_DB\s*=\s*new Set/.test(code), rel + ' không được giữ bản sao cục bộ');
  }
});

test('hành vi: 2 guard .mjs từ chối mọi biến thể DB cấm bằng mã DB_NAME_INVALID', () => {
  const S = '20261024_120000';
  const variants = [...FORBIDDEN_DB_NAMES, ' siscom_crm_dev', 'SISCOM_CRM_DEV', 'siscom_app'];
  for (const db of variants) {
    const r = validateDisposableTarget({ url: `postgresql://siscom_t_app_${S}:synthetic-placeholder@127.0.0.1:55432/${db}`, env: {}, expectedPort: 55432, now: new Date('2026-10-24T12:30:00Z') });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.code === 'DB_NAME_INVALID' || x.code === 'URL_INVALID'), db);
    const v = verifyDbIdentity({}, { db, stamp: S, port: 55432, runtime: 'native', now: new Date('2026-10-24T12:30:00Z') });
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((x) => x.code === 'DB_NAME_INVALID'), 'identity-verifier: ' + JSON.stringify(db));
  }
});

test('cách ly tĩnh: helper thuần, không import, không I/O', () => {
  const code = stripComments(read('forbidden-db.mjs'));
  assert.ok(!/^\s*import\s/m.test(code) && !/\brequire\s*\(/.test(code), 'helper không được import gì (tránh vòng import)');
  for (const re of [/process\.env/, /\bprisma\b/i, /child_process/, /\bnode:/, /\bfetch\s*\(/, /\.env\b/]) assert.ok(!re.test(code), 'helper dính ' + re);
});

test('ca biên (G09): soft-hyphen U+00AD và chuỗi rỗng bị coi là cấm ở helper dùng chung', () => {
  for (const v of ['siscom_crm_­dev', '­siscom_crm_dev', 'siscom_crm_dev­', 'sis­com_app', 'post­gres', 'siscom_crm_%C2%ADdev', '', '   ', '­', '""', '​']) assert.equal(isForbiddenDbName(v), true, JSON.stringify(v));
  assert.equal(normalizeDbName('siscom_crm_­dev'), 'siscom_crm_dev');
});

test('ca biên (G09): allowlist siscom_crm_test_<stamp> vẫn hoạt động, không chặn sai DB thử hợp lệ', async () => {
  const S = '20261024_120000';
  for (const v of ['siscom_crm_test_' + S, 'SISCOM_CRM_TEST_' + S, 'siscom_crm_restore_20261020_101010']) assert.equal(isForbiddenDbName(v), false, v);
  const v = verifyDbIdentity({}, { db: 'siscom_crm_test_' + S, stamp: S, port: 55432, runtime: 'native', now: new Date('2026-10-24T12:30:00Z') });
  assert.ok(!v.reasons.some((x) => x.code === 'DB_NAME_INVALID'), 'identity-verifier chặn sai DB thử hợp lệ');
  const { evaluateTestDatabaseTarget } = await import('../../test/helpers/test-db-guard.ts');
  const ok = evaluateTestDatabaseTarget(`postgresql://siscom_t_app_${S}:synthetic-placeholder@127.0.0.1:55432/siscom_crm_test_${S}`, 'disposable');
  assert.equal(ok.ok, true, JSON.stringify(ok.reasons));
  const legacy = evaluateTestDatabaseTarget(`postgresql://siscom_app:synthetic-placeholder@127.0.0.1:5432/siscom_crm_test_${S}`, 'legacy-shared-app');
  assert.equal(legacy.ok, true, JSON.stringify(legacy.reasons));
});

test('ca biên (G09): test-db-guard.ts đồng bộ — soft-hyphen/rỗng bị từ chối bằng DB_FORBIDDEN', async () => {
  const { evaluateTestDatabaseTarget } = await import('../../test/helpers/test-db-guard.ts');
  const S = '20261024_120000';
  for (const profile of ['legacy-shared-app', 'disposable']) {
    const role = profile === 'disposable' ? `siscom_t_app_${S}` : 'siscom_app';
    const port = profile === 'disposable' ? 55432 : 5432;
    for (const db of ['siscom_crm_%C2%ADdev', '%C2%ADsiscom_crm_dev', 'post%C2%ADgres', '%C2%AD', '']) {
      const r = evaluateTestDatabaseTarget(`postgresql://${role}:synthetic-placeholder@127.0.0.1:${port}/${db}`, profile);
      assert.equal(r.ok, false);
      assert.ok(r.reasons.some((x) => x.code === 'DB_FORBIDDEN'), profile + ' ' + JSON.stringify(db) + ' -> ' + JSON.stringify(r.reasons));
    }
  }
});
