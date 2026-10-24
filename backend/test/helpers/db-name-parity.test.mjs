// Parity ESM <-> TS: cùng một fixture tổng hợp chạy qua scripts/guards/forbidden-db.mjs và test/helpers/test-db-guard.ts.
// Offline: không DB, không .env, không process.env. Chạy (Node >= 22.18/24): node --test test/helpers/db-name-parity.test.mjs (trong backend/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isForbiddenDbName, FORBIDDEN_DB_NAMES as ESM_NAMES } from '../../scripts/guards/forbidden-db.mjs';
import { evaluateTestDatabaseTarget, FORBIDDEN_DB_NAMES as TS_NAMES } from './test-db-guard.ts';

const { cases } = JSON.parse(readFileSync(new URL('../fixtures/db-name-normalization.fixtures.json', import.meta.url), 'utf8'));
const tsVerdict = (name) => evaluateTestDatabaseTarget(`postgresql://siscom_app:synthetic-placeholder@127.0.0.1:5432/${encodeURIComponent(name)}`, 'legacy-shared-app');

test('fixture không rỗng và id duy nhất', () => {
  assert.ok(cases.length >= 20);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
});

test('danh sách cấm ESM và TS bằng nhau (tập hợp)', () => {
  assert.deepEqual([...TS_NAMES].sort(), [...ESM_NAMES].sort());
});

for (const c of cases) {
  test('parity: ' + c.id, () => {
    const esm = isForbiddenDbName(c.name);
    const ts = tsVerdict(c.name);
    const tsForbidden = ts.reasons.some((r) => r.code === 'DB_FORBIDDEN');
    assert.equal(esm, c.forbidden, 'ESM lệch fixture');
    assert.equal(tsForbidden, c.forbidden, 'TS lệch fixture');
    assert.equal(esm, tsForbidden, 'ESM và TS lệch nhau');
    assert.equal(ts.ok, c.allowlisted);
  });
}
