// J03: hồi quy tương tác giữa #126 (app.connection thiếu/sai kiểu) và #129 (ownCopy chống ô nhiễm prototype) khi ghép trên #123.
// Chỉ executor giả trong bộ nhớ: không PostgreSQL, không mạng, không .env.
// Chạy: node --test backend/scripts/pg-harness/identity-stack-interaction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { runPreMigrateIdentityCheck } from './identity-verifier.mjs';
import { FakeDbExecutor, FAKE, goodSnapshot } from './test-support/fake-db-executor.mjs';

const { STAMP, DB, PORT, CREATED, APP } = FAKE;
const NOW = new Date('2026-10-24T12:30:00Z');
const LABEL = `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`;
const CODE = expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED });
const CONN = { host: '127.0.0.1', port: PORT, runtime: 'native' };
const expected = () => ({ db: DB, stamp: STAMP, port: PORT, runtime: 'native', now: NOW, confirmation: { dbName: DB, code: CODE, interactive: true } });
const gateInputs = () => ({
  approvalRef: 'ISSUE-8#comment-123456', ownerGrantedTestDb: true, url: `postgresql://${APP}:synthetic-placeholder@127.0.0.1:${PORT}/${DB}`,
  guardEnv: {}, expectedPort: PORT, now: NOW, label: LABEL, confirmDb: DB, confirmCode: CODE, interactive: true,
});

class RawExecutor extends FakeDbExecutor {
  constructor(make) { super({ owner: goodSnapshot('owner'), app: goodSnapshot('app'), connection: CONN }); this.make = make; }
  async readIdentity(role) { this.calls.push({ method: 'readIdentity', role }); return this.make(role); }
}
const withProto = async (key, value, fn) => {
  Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true, enumerable: false });
  try { return await fn(); } finally { delete Object.prototype[key]; }
};

test('J03 stack: app thiếu connection + Object.prototype.connection bị ô nhiễm → vẫn từ chối (không điền từ prototype)', async () => {
  const make = (role) => (role === 'owner' ? { ...goodSnapshot('owner'), connection: { ...CONN } } : { ...goodSnapshot('app') });
  const r = await withProto('connection', { ...CONN }, () => runPreMigrateIdentityCheck({ executor: new RawExecutor(make), gateInputs: gateInputs(), expected: expected() }));
  assert.equal(r.ok, false, JSON.stringify(r.reasons));
  assert.equal(r.verdict, undefined);
});

test('J03 stack: app.connection sai kiểu (chuỗi/mảng/null) → từ chối khi owner có connection', async () => {
  for (const bad of ['127.0.0.1', [CONN], null, 7]) {
    const make = (role) => (role === 'owner' ? { ...goodSnapshot('owner'), connection: { ...CONN } } : { ...goodSnapshot('app'), connection: bad });
    const r = await runPreMigrateIdentityCheck({ executor: new RawExecutor(make), gateInputs: gateInputs(), expected: expected() });
    assert.equal(r.ok, false, `bad=${JSON.stringify(bad)} ${JSON.stringify(r.reasons)}`);
  }
});

test('J03 stack: bằng chứng hợp lệ (cả hai vai cùng connection) vẫn được chấp nhận — không vá quá tay', async () => {
  const make = (role) => ({ ...goodSnapshot(role), connection: { ...CONN } });
  const r = await runPreMigrateIdentityCheck({ executor: new RawExecutor(make), gateInputs: gateInputs(), expected: expected() });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(r.verdict.db, DB);
});
