// Guard tĩnh (dry-run) cho đích PostgreSQL thử — đặc tả: docs/PG_ISOLATED_ACCEPTANCE_PLAN.md §4.2 (PR #100/#107).
// Hàm THUẦN: chỉ phân tích chuỗi/đối tượng được truyền vào. Không đọc process.env, không .env, không mạng, không DB, không Prisma.
// Reject by default: chỉ trả ok=true khi mọi kiểm tra đều đạt. Lý do từ chối không chứa mật khẩu.
// Chưa bao gồm guard 6 (xác minh sau khi nối): cần kết nối DB nên ngoài phạm vi offline.
import { createHash } from 'node:crypto';
import { isForbiddenDbName } from './forbidden-db.mjs';

const ALLOWED_HOST = '127.0.0.1';
const SHARED_CLUSTER_PORT = 5432;
const DB_RE = /^siscom_crm_test_(\d{8})_(\d{6})$/;
const USER_RE = /^siscom_t_(owner|app)_(\d{8}_\d{6})$/;
const LABEL_RE = /^SISCOM_DISPOSABLE_TEST:(\d{8}_\d{6}):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/;
const URL_RE = /^postgresql:\/\/([A-Za-z0-9_]+):([^@/?#:%\s]+)@([^:/?#@\s]+):(\d{1,5})\/([A-Za-z0-9_]+)$/;
const BYPASS_RE = /^(force|yes|y|skip\w*|nonInteractive|noConfirm\w*|assumeYes|unattended|bypass\w*)$/i;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validStamp(s) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (h > 23 || mi > 59 || se > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parseIso(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  // Date.parse bù ngày không tồn tại (vd 02-30) → so lại phần ngày
  const d = new Date(t);
  return d.toISOString().slice(0, 10) === s.slice(0, 10) ? t : null;
}

/** Mã xác nhận một lần gắn <tên DB>|<stamp>|<host:cổng>|<thời điểm tạo> (plan §4.2.8). Chỉ chống nhầm lẫn/dùng lại, không phải bí mật. */
export function expectedConfirmationCode({ dbName, stamp, hostPort, createdAt }) {
  return createHash('sha256').update(`${dbName}|${stamp}|${hostPort}|${createdAt}`).digest('hex').slice(0, 16);
}

/**
 * @param {{url:string, env:Record<string,string>, expectedPort:number, now:Date, label:string,
 *          confirmation:{dbName:string, code:string, interactive:boolean}, sharedClusterApproved?:true}} input
 * @returns {{ok:boolean, reasons:{code:string, message:string}[]}}
 */
export function validateDisposableTarget(input) {
  const reasons = [];
  const fail = (code, message) => reasons.push({ code, message });
  try {
    if (!isObj(input)) return { ok: false, reasons: [{ code: 'INPUT_INVALID', message: 'Đầu vào phải là đối tượng.' }] };

    const knownTop = new Set(['url', 'env', 'expectedPort', 'now', 'label', 'confirmation', 'sharedClusterApproved']);
    for (const k of Object.keys(input)) {
      if (BYPASS_RE.test(k)) fail('BYPASS_FLAG', `Cờ bỏ qua "${k}" không được phép.`);
      else if (!knownTop.has(k)) fail('UNKNOWN_OPTION', `Tùy chọn lạ "${k}" bị từ chối.`);
    }

    // Môi trường (guard 4, 5): phải được truyền tường minh; không đọc process.env.
    if (!isObj(input.env)) fail('ENV_NOT_PROVIDED', 'Phải truyền env tường minh.');
    else {
      for (const k of Object.keys(input.env)) {
        if (/^PG/i.test(k)) fail('ENV_REDIRECT', `Biến ${k.toUpperCase()} có thể đổi đích ngầm.`);
      }
      if (Object.keys(input.env).some((k) => k.toUpperCase() === 'DATABASE_URL')) fail('ENV_DATABASE_URL_SET', 'DATABASE_URL không được đặt.');
    }

    if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) fail('NOW_INVALID', 'Thiếu thời điểm hiện tại hợp lệ.');

    const port = input.expectedPort;
    const portOk = Number.isInteger(port) && port >= 1 && port <= 65535;
    if (!portOk) fail('PORT_NOT_DECLARED', 'Phải khai báo cổng cụm thử (số nguyên 1–65535).');
    else if (port === SHARED_CLUSTER_PORT && input.sharedClusterApproved !== true) fail('PORT_SHARED_CLUSTER', 'Cổng 5432 là cụm dùng chung; cần cờ sharedClusterApproved=true được duyệt riêng.');

    // URL (guard 1–4)
    let stamp = null;
    let dbName = null;
    if (typeof input.url !== 'string') fail('URL_INVALID', 'URL phải là chuỗi.');
    else {
      const m = URL_RE.exec(input.url);
      if (!m) fail('URL_INVALID', 'URL không đúng dạng postgresql://user:mật-khẩu@host:cổng/db (không query, không %, bắt buộc mật khẩu, một host).');
      else {
        const [, user, , host, urlPort, db] = m;
        dbName = db;
        if (host !== ALLOWED_HOST) fail('HOST_NOT_ALLOWED', `Host phải đúng "${ALLOWED_HOST}".`);
        if (portOk && Number(urlPort) !== port) fail('PORT_MISMATCH', 'Cổng trong URL khác cổng đã khai báo.');
        const dm = DB_RE.exec(db);
        if (isForbiddenDbName(db) || !dm || !validStamp(`${dm[1]}_${dm[2]}`)) fail('DB_NAME_INVALID', 'Tên DB phải khớp siscom_crm_test_YYYYMMDD_HHMMSS (ngày giờ hợp lệ) và không thuộc danh sách cấm.');
        else stamp = `${dm[1]}_${dm[2]}`;
        const um = USER_RE.exec(user);
        if (!um || !validStamp(um[2])) fail('ROLE_INVALID', 'Role phải khớp siscom_t_(owner|app)_<stamp>; cấm postgres/admin/siscom_app/siscom_migrator.');
        else if (stamp && um[2] !== stamp) fail('STAMP_MISMATCH', 'Stamp của role khác stamp của tên DB.');
      }
    }

    // Nhãn sở hữu (guard 7, 9) — chuỗi COMMENT ON DATABASE do người gọi truyền vào (đọc thật cần DB, ngoài phạm vi offline).
    let createdAt = null;
    if (typeof input.label !== 'string' || input.label === '') fail('LABEL_MISSING', 'Thiếu nhãn sở hữu SISCOM_DISPOSABLE_TEST.');
    else {
      const lm = LABEL_RE.exec(input.label);
      const t = lm ? parseIso(lm[2]) : null;
      if (!lm || t === null || !validStamp(lm[1])) fail('LABEL_INVALID', 'Nhãn không đúng mẫu SISCOM_DISPOSABLE_TEST:<stamp>:<ISO8601Z>.');
      else {
        createdAt = lm[2];
        if (stamp && lm[1] !== stamp) fail('LABEL_STAMP_MISMATCH', 'Stamp trong nhãn khác stamp của DB.');
        if (input.now instanceof Date && !Number.isNaN(input.now.getTime())) {
          const age = input.now.getTime() - t;
          if (age > MAX_AGE_MS || age < -MAX_FUTURE_SKEW_MS) fail('LABEL_EXPIRED', 'Nhãn quá 2 giờ hoặc ở tương lai (DB cũ/dùng lại bị từ chối).');
        }
      }
    }

    // Xác nhận người (guard 8)
    const c = input.confirmation;
    if (!isObj(c)) fail('CONFIRMATION_MISSING', 'Thiếu xác nhận (tên DB + mã).');
    else {
      for (const k of Object.keys(c)) if (BYPASS_RE.test(k)) fail('BYPASS_FLAG', `Cờ bỏ qua "${k}" không được phép.`);
      if (c.interactive !== true) fail('CONFIRMATION_NOT_INTERACTIVE', 'Xác nhận phải do người gõ trong phiên có TTY.');
      if (dbName !== null && c.dbName !== dbName) fail('CONFIRMATION_DB_MISMATCH', 'Tên DB gõ lại không khớp.');
      if (stamp && createdAt && portOk && dbName) {
        const want = expectedConfirmationCode({ dbName, stamp, hostPort: `${ALLOWED_HOST}:${port}`, createdAt });
        if (typeof c.code !== 'string' || c.code !== want) fail('CONFIRMATION_CODE_INVALID', 'Mã xác nhận sai, hết hạn hoặc gắn với DB/cổng/thời điểm khác.');
      } else if (typeof c.code !== 'string' || c.code === '') fail('CONFIRMATION_CODE_INVALID', 'Thiếu mã xác nhận.');
    }
  } catch {
    return { ok: false, reasons: [...reasons, { code: 'INTERNAL_ERROR', message: 'Lỗi khi kiểm tra; từ chối mặc định.' }] };
  }
  return { ok: reasons.length === 0, reasons };
}
