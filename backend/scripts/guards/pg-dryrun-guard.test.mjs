// Test offline cho pg-dryrun-guard.mjs (kế hoạch PR #100 §4.2). Chỉ dùng chuỗi URL GIẢ; không DB, không .env, không Prisma.
// Chạy: node --test backend/scripts/guards/pg-dryrun-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDisposableTarget, expectedConfirmationCode } from './pg-dryrun-guard.mjs';

const STAMP = '20261024_120000';
const NOW = new Date('2026-10-24T12:30:00Z');
const PORT = 55432;
const PW = 'synthetic-placeholder';
const CREATED = '2026-10-24T12:00:00Z';
const DB = `siscom_crm_test_${STAMP}`;

const mkUrl = (o = {}) => {
  const { user = `siscom_t_app_${STAMP}`, host = '127.0.0.1', port = PORT, db = DB, tail = '' } = o;
  return `postgresql://${user}:${PW}@${host}:${port}/${db}${tail}`;
};
const codeFor = (o = {}) => expectedConfirmationCode({ dbName: DB, stamp: STAMP, hostPort: `127.0.0.1:${PORT}`, createdAt: CREATED, ...o });
function good(over = {}) {
  return {
    url: mkUrl(),
    env: {},
    expectedPort: PORT,
    now: NOW,
    label: `SISCOM_DISPOSABLE_TEST:${STAMP}:${CREATED}`,
    confirmation: { dbName: DB, code: codeFor(), interactive: true },
    ...over,
  };
}
const reject = (input, code) => {
  const r = validateDisposableTarget(input);
  assert.equal(r.ok, false, 'phải bị từ chối');
  if (code) assert.ok(r.reasons.some((x) => x.code === code), `thiếu mã ${code}; có: ${r.reasons.map((x) => x.code)}`);
  return r;
};

test('dương: đầu vào hợp lệ (owner và app) được chấp nhận', () => {
  assert.equal(validateDisposableTarget(good()).ok, true);
  assert.equal(validateDisposableTarget(good({ url: mkUrl({ user: `siscom_t_owner_${STAMP}` }) })).ok, true);
});

test('reject by default: thiếu/sai kiểu đầu vào', () => {
  for (const bad of [undefined, null, 'x', 42, [], {}]) assert.equal(validateDisposableTarget(bad).ok, false);
  reject(good({ url: undefined }), 'URL_INVALID');
  reject(good({ url: '' }), 'URL_INVALID');
  reject(good({ url: 'không phải url' }), 'URL_INVALID');
  reject(good({ env: undefined }), 'ENV_NOT_PROVIDED');
  reject(good({ now: undefined }), 'NOW_INVALID');
  reject(good({ expectedPort: undefined }), 'PORT_NOT_DECLARED');
});

test('host ngoài allowlist', () => {
  for (const host of ['localhost', '0.0.0.0', '::1', '[::1]', '10.0.0.5', '192.168.1.10', 'db.example.com', '127.0.0.2', '127.0.0.1.evil.test']) reject(good({ url: mkUrl({ host }) }));
  for (const host of ['localhost', '10.0.0.5', 'db.example.com', '127.0.0.2']) reject(good({ url: mkUrl({ host }) }), 'HOST_NOT_ALLOWED');
  reject(good({ url: `postgresql://siscom_t_app_${STAMP}:${PW}@127.0.0.1:${PORT},10.0.0.1:${PORT}/${DB}` }));
});

test('giao thức sai', () => {
  reject(good({ url: mkUrl().replace('postgresql://', 'postgres://') }), 'URL_INVALID');
  reject(good({ url: mkUrl().replace('postgresql://', 'http://') }), 'URL_INVALID');
});

test('cổng: lệch cổng khai báo; 5432 (chung cụm dev) cần duyệt rõ', () => {
  reject(good({ url: mkUrl({ port: 55433 }) }), 'PORT_MISMATCH');
  reject(good({ url: mkUrl({ port: 5432 }), expectedPort: 5432 }), 'PORT_SHARED_CLUSTER');
  const shared = good({ url: mkUrl({ port: 5432 }), expectedPort: 5432, sharedClusterApproved: true, confirmation: { dbName: DB, code: codeFor({ hostPort: '127.0.0.1:5432' }), interactive: true } });
  assert.equal(validateDisposableTarget(shared).ok, true);
  reject({ ...shared, sharedClusterApproved: 'yes' }, 'PORT_SHARED_CLUSTER');
  reject(good({ expectedPort: 0, url: mkUrl({ port: 0 }) }), 'PORT_NOT_DECLARED');
  reject(good({ expectedPort: '55432' }), 'PORT_NOT_DECLARED');
});

test('DB dev/prod/baseline/hệ thống bị cấm', () => {
  for (const db of ['siscom_crm_dev', 'siscom_crm_restore_20261014_214105', 'siscom_crm_restore_20261015_214948', 'postgres', 'template0', 'template1', 'siscom_crm_prod', 'siscom_crm']) reject(good({ url: mkUrl({ db }) }), 'DB_NAME_INVALID');
});

test('tên DB sai mẫu / ngày giờ không hợp lệ', () => {
  for (const db of [`siscom_crm_restore_${STAMP}`, 'siscom_crm_test_2026102_120000', `${DB}x`, `SISCOM_CRM_TEST_${STAMP}`, 'siscom_crm_test_20261324_120000', 'siscom_crm_test_20261024_250000', 'siscom_crm_test_20260230_120000', `x${DB}`]) reject(good({ url: mkUrl({ db }) }), 'DB_NAME_INVALID');
});

test('role: admin/postgres/siscom_app/siscom_migrator bị từ chối', () => {
  for (const user of ['postgres', 'admin', 'root', 'siscom_app', 'siscom_migrator', 'siscom_t_app', `siscom_t_admin_${STAMP}`, `siscom_t_app_${STAMP}x`]) reject(good({ url: mkUrl({ user }) }), 'ROLE_INVALID');
});

test('stamp user lệch stamp DB', () => {
  reject(good({ url: mkUrl({ user: 'siscom_t_app_20261024_120001' }) }), 'STAMP_MISMATCH');
});

test('thiếu mật khẩu / mã hóa % đổi đích', () => {
  reject(good({ url: `postgresql://siscom_t_app_${STAMP}@127.0.0.1:${PORT}/${DB}` }), 'URL_INVALID');
  reject(good({ url: `postgresql://siscom_t_app_${STAMP}:@127.0.0.1:${PORT}/${DB}` }), 'URL_INVALID');
  reject(good({ url: mkUrl({ db: 'siscom_crm_test_%32%30261024_120000' }) }), 'URL_INVALID');
  reject(good({ url: mkUrl({ user: 'siscom_t_app_%32%30261024_120000' }) }), 'URL_INVALID');
});

test('tham số URL làm đổi đích bị từ chối (mọi query/fragment)', () => {
  for (const tail of ['?host=10.0.0.1', '?dbname=siscom_crm_dev', '?options=-c%20search_path%3Dx', '?service=prod', '?sslmode=disable', '?', '#frag']) reject(good({ url: mkUrl({ tail }) }), 'URL_INVALID');
});

test('biến môi trường libpq/Prisma đổi đích ngầm', () => {
  for (const k of ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGPASSWORD']) reject(good({ env: { [k]: 'x' } }), 'ENV_REDIRECT');
  reject(good({ env: { DATABASE_URL: 'x' } }), 'ENV_DATABASE_URL_SET');
  reject(good({ env: { DATABASE_URL: '' } }), 'ENV_DATABASE_URL_SET');
  assert.equal(validateDisposableTarget(good({ env: { PATH: 'x', TEST_DATABASE_URL: 'x' } })).ok, true);
});

test('nhãn sở hữu: thiếu, sai mẫu, lệch stamp, cũ >2 giờ, tương lai', () => {
  reject(good({ label: undefined }), 'LABEL_MISSING');
  reject(good({ label: '' }), 'LABEL_MISSING');
  reject(good({ label: 'SISCOM_DISPOSABLE_TEST:abc' }), 'LABEL_INVALID');
  reject(good({ label: `OTHER:${STAMP}:${CREATED}` }), 'LABEL_INVALID');
  reject(good({ label: `SISCOM_DISPOSABLE_TEST:20261024_120001:${CREATED}` }), 'LABEL_STAMP_MISMATCH');
  reject(good({ label: `SISCOM_DISPOSABLE_TEST:${STAMP}:2026-10-24T09:00:00Z` }), 'LABEL_EXPIRED');
  reject(good({ label: `SISCOM_DISPOSABLE_TEST:${STAMP}:2026-10-24T14:00:00Z` }), 'LABEL_EXPIRED');
  reject(good({ label: `SISCOM_DISPOSABLE_TEST:${STAMP}:2026-13-45T99:00:00Z` }), 'LABEL_INVALID');
});

test('xác nhận: thiếu, sai tên DB, sai mã, không TTY, cờ bỏ qua, mã gắn thời điểm/cổng khác', () => {
  const c = good().confirmation;
  reject(good({ confirmation: undefined }), 'CONFIRMATION_MISSING');
  reject(good({ confirmation: { ...c, dbName: 'siscom_crm_test_20261024_120001' } }), 'CONFIRMATION_DB_MISMATCH');
  reject(good({ confirmation: { ...c, code: 'deadbeef' } }), 'CONFIRMATION_CODE_INVALID');
  reject(good({ confirmation: { ...c, code: '' } }), 'CONFIRMATION_CODE_INVALID');
  reject(good({ confirmation: { ...c, interactive: false } }), 'CONFIRMATION_NOT_INTERACTIVE');
  const { interactive, ...noTty } = c;
  reject(good({ confirmation: noTty }), 'CONFIRMATION_NOT_INTERACTIVE');
  for (const flag of ['force', 'yes', 'Force', 'skipConfirmation', 'nonInteractive']) reject(good({ confirmation: { ...c, [flag]: true } }), 'BYPASS_FLAG');
  reject(good({ force: true }), 'BYPASS_FLAG');
  reject(good({ yes: true }), 'BYPASS_FLAG');
  reject(good({ confirmation: { ...c, code: codeFor({ createdAt: '2026-10-24T12:00:01Z' }) } }), 'CONFIRMATION_CODE_INVALID');
  reject(good({ confirmation: { ...c, code: codeFor({ hostPort: '127.0.0.1:55433' }) } }), 'CONFIRMATION_CODE_INVALID');
});

test('không rò mật khẩu qua lý do từ chối', () => {
  const r = reject(good({ url: mkUrl({ host: 'localhost', user: 'postgres' }) }));
  assert.ok(!JSON.stringify(r).includes(PW));
});

test('nhiều lỗi được gom đủ, không dừng ở lỗi đầu', () => {
  const r = reject(good({ url: mkUrl({ host: 'localhost', user: 'siscom_app', db: 'siscom_crm_dev' }) }));
  const codes = r.reasons.map((x) => x.code);
  for (const c of ['HOST_NOT_ALLOWED', 'ROLE_INVALID', 'DB_NAME_INVALID']) assert.ok(codes.includes(c), c);
});

test('hàm thuần: không đổi đầu vào, không đọc process.env', () => {
  const input = good();
  const snap = JSON.stringify(input);
  process.env.PGHOST = 'poison';
  try { assert.equal(validateDisposableTarget(input).ok, true); } finally { delete process.env.PGHOST; }
  assert.equal(JSON.stringify(input), snap);
});
