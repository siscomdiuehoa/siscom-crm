// Jest (CommonJS) khóa guard TS test/helpers/test-db-guard.ts bằng fixture tổng hợp dùng chung với bản ESM (xem test/helpers/db-name-parity.test.mjs).
// Offline: không DB, không .env, không process.env, không Prisma. Chỉ chuỗi URL giả.
import fixtures from '../../../test/fixtures/db-name-normalization.fixtures.json';
import { evaluateTestDatabaseTarget, resolveTestDatabase } from '../../../test/helpers/test-db-guard';

const STAMP = '20261024_120000';
const PW = 'synthetic-placeholder';
const urlFor = (dbEncoded: string, tail = '') => `postgresql://siscom_app:${PW}@127.0.0.1:5432/${dbEncoded}${tail}`;
const codes = (url: string) => evaluateTestDatabaseTarget(url, 'legacy-shared-app').reasons.map((r) => r.code);

describe('test-db-guard.ts khớp fixture chuẩn hóa tên DB dùng chung', () => {
  it.each(fixtures.cases)('$id', (c) => {
    const v = evaluateTestDatabaseTarget(urlFor(encodeURIComponent(c.name)), 'legacy-shared-app');
    expect(v.reasons.some((r) => r.code === 'DB_FORBIDDEN')).toBe(c.forbidden);
    expect(v.ok).toBe(c.allowlisted);
    if (!v.ok) expect(v.name).toBeNull();
  });
});

describe('query/fragment không được ghi đè đích', () => {
  const base = `siscom_crm_test_${STAMP}`;
  it.each(['?dbname=siscom_crm_dev', '?host=10.0.0.1', '?options=-c%20search_path%3Dx', '?service=prod', '?', '#frag', '?schema=public'])('%s', (tail) => {
    expect(codes(urlFor(base, tail))).toContain('QUERY_NOT_ALLOWED');
  });
});

describe('env PG* bị từ chối trong resolveTestDatabase', () => {
  const ok = () => ({ TEST_DATABASE_URL: urlFor(`siscom_crm_test_${STAMP}`) });
  it.each(['PGHOST', 'PGDATABASE', 'PGSERVICE', 'PGOPTIONS', 'PGPORT', 'pgdatabase'])('%s', (k) => {
    expect(() => resolveTestDatabase({ ...ok(), [k]: 'x' }, 'legacy-shared-app')).toThrow(/ENV_PG_REDIRECT/);
  });
  it('PG* undefined coi như không đặt; env hợp lệ vẫn qua', () => {
    expect(resolveTestDatabase({ ...ok(), PGHOST: undefined }, 'legacy-shared-app').name).toBe(`siscom_crm_test_${STAMP}`);
  });
  it('thông điệp lỗi không lộ giá trị', () => {
    expect(() => resolveTestDatabase({ ...ok(), PGPASSWORD: 'leak-canary' }, 'legacy-shared-app')).toThrow(/^(?!.*leak-canary)/);
  });
});
