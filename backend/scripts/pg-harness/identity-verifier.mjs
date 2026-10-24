// Kiểm định định danh PostgreSQL TRƯỚC mọi migration (F-02, NHÁP). Đặc tả: plan #100 §4.2.6/§4.2.7/§4.2.8, handoff E-03 §1 mục 8.
// Lõi THUẦN + giao diện tiêm (DbExecutor). Không import pg/Prisma/child_process/net/fs, không đọc process.env/.env, không kết nối DB.
// Adapter duy nhất trong kho này là FakeDbExecutor trong bộ nhớ (test-support/). Đường `--execute` của harness.mjs KHÔNG được nối vào đây và vẫn NOT_IMPLEMENTED.
// Reject by default: bằng chứng thiếu/sai kiểu/thừa trường → từ chối. Lý do chỉ chứa mã + thông điệp cố định, không phản chiếu giá trị từ DB.
import { expectedConfirmationCode } from '../guards/pg-dryrun-guard.mjs';
import { isForbiddenDbName } from '../guards/forbidden-db.mjs';
import { evaluateExecutionGate } from './harness.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const SHARED_CLUSTER_PORT = 5432;
const DB_RE = /^siscom_crm_test_(\d{8}_\d{6})$/;
const OWNER_RE = /^siscom_t_owner_(\d{8}_\d{6})$/;
const APP_RE = /^siscom_t_app_(\d{8}_\d{6})$/;
const LABEL_RE = /^SISCOM_DISPOSABLE_TEST:(\d{8}_\d{6}):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const PRIV_FLAGS = ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls'];
const SNAPSHOT_KEYS = new Set(['currentDatabase', 'currentUser', 'sessionUser', 'sessionIsSuperuser', 'rolcanlogin', ...PRIV_FLAGS, 'dbOwner', 'dbLabel', 'serverAddr', 'serverPort', 'nonDemoRowCount']);
const EVIDENCE_KEYS = new Set(['connection', 'owner', 'app']);
const CONNECTION_KEYS = new Set(['host', 'port', 'runtime']);
/** Phương thức bắt buộc của bộ thực thi tiêm vào. Chỉ readIdentity là đọc; migrateDeploy chỉ được gọi qua guardedMigrateDeploy. */
export const EXECUTOR_METHODS = ['readIdentity', 'migrateDeploy'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Sổ đăng ký quyền migrate: CHỈ runPreMigrateIdentityCheck (sau cổng thực thi + kiểm định) được ghi. verdict -> {executor, db, issuedAt, labelCreatedAt}. */
const grants = new WeakMap();
const MAX_VERDICT_AGE_MS = 5 * 60 * 1000;

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
  return new Date(t).toISOString().slice(0, 10) === s.slice(0, 10) ? t : null;
}

const isLoopback = (a) => a === '127.0.0.1' || a === '::1';
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'; // 0..255, không số 0 đứng trước
const BRIDGE_RE = new RegExp(`^172\\.(?:1[6-9]|2\\d|3[01])\\.${OCTET}\\.${OCTET}$`);
const isContainerBridge = (a) => BRIDGE_RE.test(a);
const isPort = (p) => Number.isInteger(p) && p >= 1 && p <= 65535;

/**
 * Sao chép sâu CHỈ các khóa chuỗi SỞ HỮU, enumerable vào đối tượng không prototype (Date giữ nguyên). Trường thiếu luôn đọc ra undefined,
 * không bao giờ "điền" từ Object.prototype bị ô nhiễm hay từ prototype tự gắn (Object.create). `memo` giữ nguyên quan hệ đồng nhất tham chiếu.
 */
function ownCopy(v, memo = new WeakMap()) {
  if (v === null || typeof v !== 'object' || v instanceof Date) return v;
  if (memo.has(v)) return memo.get(v);
  const out = Array.isArray(v) ? [] : Object.create(null);
  memo.set(v, out);
  for (const k of Object.keys(v)) out[k] = ownCopy(v[k], memo);
  return out;
}

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

/**
 * Kiểm một ảnh chụp định danh (kết quả đọc chỉ-đọc qua một kết nối) theo vai.
 * `expected`: { db, stamp, role:'owner'|'app', ownerRole, appRole, port, runtime }.
 */
function checkSnapshot(role, snap, expected, push) {
  const fail = (code, message) => push(`${role.toUpperCase()}_${code}`, message);
  if (!isObj(snap)) return fail('EVIDENCE_MISSING', 'Thiếu bằng chứng định danh.');
  if (unknownKeys(snap, SNAPSHOT_KEYS).length > 0) fail('FIELD_UNKNOWN', 'Có trường lạ trong bằng chứng; bị từ chối.'); // không phản chiếu tên khóa do DB báo
  const wantUser = role === 'owner' ? expected.ownerRole : expected.appRole;
  if (snap.currentDatabase !== expected.db) fail('DB_MISMATCH', 'current_database() khác DB mong đợi.');
  if (snap.currentUser !== wantUser) fail('USER_MISMATCH', 'current_user khác role mong đợi của vai.');
  if (snap.sessionUser !== wantUser) fail('SESSION_USER_MISMATCH', 'session_user khác role mong đợi (có SET ROLE/đổi danh tính).');
  if (snap.sessionIsSuperuser !== 'off') fail('SESSION_SUPERUSER', 'Phiên không được ở chế độ superuser (is_superuser phải là "off").');
  if (snap.rolcanlogin !== true) fail('CANLOGIN_NOT_TRUE', 'Role phải có LOGIN.');
  for (const f of PRIV_FLAGS) if (snap[f] !== false) fail('PRIVILEGE_FLAG', `Cờ đặc quyền ${f} phải đúng bằng false.`);
  if (snap.dbOwner !== expected.ownerRole) fail('DB_OWNER_MISMATCH', 'Chủ sở hữu DB phải là role owner cùng stamp.');
  if (!Number.isInteger(snap.nonDemoRowCount) || snap.nonDemoRowCount !== 0) fail('NON_DEMO_DATA', 'Phát hiện/không xác định dữ liệu không-demo trong DB thử.');
  if (typeof snap.serverAddr !== 'string') fail('SERVER_ADDR_MISSING', 'Thiếu địa chỉ máy chủ do PG báo.');
  else if (expected.runtime === 'container' ? !(isLoopback(snap.serverAddr) || isContainerBridge(snap.serverAddr)) : !isLoopback(snap.serverAddr)) fail('SERVER_NOT_LOOPBACK', 'Địa chỉ máy chủ PG báo không phải loopback/cầu nối container.');
  if (expected.runtime !== 'container' && snap.serverPort !== expected.port) fail('SERVER_PORT_MISMATCH', 'Cổng máy chủ PG báo khác cổng đã khai báo.');
  if (expected.runtime === 'container' && !isPort(snap.serverPort)) fail('SERVER_PORT_MISSING', 'Thiếu cổng máy chủ PG báo.');
}

/**
 * Kiểm định bằng chứng định danh. Hàm THUẦN, không I/O. Chỉ ok=true khi mọi điều kiện đều đạt.
 * @param {{connection:{host:string,port:number,runtime:'native'|'container'}, owner:object, app:object}} evidence
 * @param {{db:string, stamp:string, port:number, runtime:'native'|'container', now:Date, confirmation:{dbName:string, code:string, interactive:boolean}, sharedClusterApproved?:true}} expected
 * @returns {{ok:boolean, reasons:{code:string,message:string}[]}} ok=true kèm verdict gắn nhãn (không thể giả bằng object thường).
 */
export function verifyDbIdentity(evidence, expected) {
  const reasons = [];
  const push = (code, message) => reasons.push({ code, message });
  try {
    if (!isObj(evidence)) return deny([{ code: 'EVIDENCE_MISSING', message: 'Thiếu bằng chứng định danh.' }]);
    if (!isObj(expected)) return deny([{ code: 'EXPECTED_INVALID', message: 'Thiếu thông số mong đợi.' }]);
    const memo = new WeakMap();
    evidence = ownCopy(evidence, memo);
    expected = ownCopy(expected, memo);
    if (unknownKeys(evidence, EVIDENCE_KEYS).length > 0) push('FIELD_UNKNOWN', 'Có trường lạ trong bằng chứng; bị từ chối.');

    // Tên DB + stamp
    const dm = typeof expected.db === 'string' ? DB_RE.exec(expected.db) : null;
    if (!dm || isForbiddenDbName(expected.db) || !validStamp(dm[1])) push('DB_NAME_INVALID', 'Tên DB phải khớp siscom_crm_test_YYYYMMDD_HHMMSS hợp lệ và không thuộc danh sách cấm.');
    const stamp = dm && validStamp(dm[1]) ? dm[1] : null;
    if (stamp && expected.stamp !== stamp) push('STAMP_MISMATCH', 'Stamp mong đợi khác stamp của tên DB.');
    const ownerRole = stamp ? `siscom_t_owner_${stamp}` : null;
    const appRole = stamp ? `siscom_t_app_${stamp}` : null;
    if (ownerRole !== null && (!OWNER_RE.test(ownerRole) || !APP_RE.test(appRole) || ownerRole === appRole)) push('ROLE_INVALID', 'Owner và app phải là hai role khác nhau đúng mẫu siscom_t_*.');

    // Cổng + runtime + host khai báo của kết nối
    const port = expected.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) push('PORT_NOT_DECLARED', 'Phải khai báo cổng cụm thử hợp lệ.');
    else if (port === SHARED_CLUSTER_PORT && expected.sharedClusterApproved !== true) push('PORT_SHARED_CLUSTER', 'Cổng 5432 là cụm dùng chung; cần phê duyệt riêng.');
    if (expected.runtime !== 'native' && expected.runtime !== 'container') push('RUNTIME_INVALID', 'runtime phải là "native" hoặc "container".');
    const conn = evidence.connection;
    if (!isObj(conn)) push('CONNECTION_MISSING', 'Thiếu thông tin kết nối khai báo.');
    else {
      if (unknownKeys(conn, CONNECTION_KEYS).length > 0) push('FIELD_UNKNOWN', 'Có trường lạ trong bằng chứng; bị từ chối.');
      if (conn.host !== LOOPBACK_HOST) push('HOST_NOT_ALLOWED', `Host kết nối phải đúng "${LOOPBACK_HOST}".`);
      if (conn.port !== port) push('PORT_MISMATCH', 'Cổng kết nối khác cổng đã khai báo.');
      if (conn.runtime !== expected.runtime) push('RUNTIME_MISMATCH', 'runtime kết nối khác runtime đã khai báo.');
    }

    // Hai vai tách biệt: owner ≠ app, mỗi vai một ảnh chụp riêng
    if (isObj(evidence.owner) && isObj(evidence.app) && evidence.owner === evidence.app) push('ROLES_NOT_SEPARATE', 'Owner và app không được dùng chung một ảnh chụp.');
    if (ownerRole !== null && stamp !== null) {
      const exp = { db: expected.db, ownerRole, appRole, port, runtime: expected.runtime };
      checkSnapshot('owner', evidence.owner, exp, push);
      checkSnapshot('app', evidence.app, exp, push);
      if (isObj(evidence.owner) && isObj(evidence.app) && evidence.owner.currentUser === evidence.app.currentUser) push('ROLES_NOT_SEPARATE', 'Owner và app phải là hai role khác nhau.');

      // Nhãn sở hữu + mã xác nhận (đọc lại từ DB, không tin chuỗi người gọi)
      const label = isObj(evidence.owner) ? evidence.owner.dbLabel : undefined;
      if (isObj(evidence.app) && evidence.app.dbLabel !== label) push('LABEL_INCONSISTENT', 'Hai vai thấy nhãn DB khác nhau.');
      let createdAt = null;
      if (typeof label !== 'string' || label === '') push('LABEL_MISSING', 'Thiếu nhãn sở hữu SISCOM_DISPOSABLE_TEST.');
      else {
        const lm = LABEL_RE.exec(label);
        const t = lm ? parseIso(lm[2]) : null;
        if (!lm || t === null || !validStamp(lm[1])) push('LABEL_INVALID', 'Nhãn không đúng mẫu SISCOM_DISPOSABLE_TEST:<stamp>:<ISO8601Z>.');
        else {
          createdAt = lm[2];
          if (lm[1] !== stamp) push('LABEL_STAMP_MISMATCH', 'Stamp trong nhãn khác stamp của DB.');
          if (!(expected.now instanceof Date) || Number.isNaN(expected.now.getTime())) push('NOW_INVALID', 'Thiếu thời điểm hiện tại hợp lệ.');
          else {
            const age = expected.now.getTime() - t;
            if (age > MAX_AGE_MS || age < -MAX_FUTURE_SKEW_MS) push('LABEL_EXPIRED', 'Nhãn quá 2 giờ hoặc ở tương lai.');
          }
        }
      }
      const c = expected.confirmation;
      if (!isObj(c)) push('CONFIRMATION_MISSING', 'Thiếu xác nhận (tên DB + mã).');
      else {
        if (c.interactive !== true) push('CONFIRMATION_NOT_INTERACTIVE', 'Xác nhận phải do người gõ trong phiên có TTY.');
        if (c.dbName !== expected.db) push('CONFIRMATION_DB_MISMATCH', 'Tên DB gõ lại không khớp.');
        if (createdAt !== null && Number.isInteger(port)) {
          const want = expectedConfirmationCode({ dbName: expected.db, stamp, hostPort: `${LOOPBACK_HOST}:${port}`, createdAt });
          if (typeof c.code !== 'string' || c.code !== want) push('CONFIRMATION_CODE_INVALID', 'Mã xác nhận sai, hết hạn hoặc gắn với DB/cổng/thời điểm khác.');
        } else if (typeof c.code !== 'string' || c.code === '') push('CONFIRMATION_CODE_INVALID', 'Thiếu mã xác nhận.');
      }
    }
  } catch {
    return deny([...reasons, { code: 'INTERNAL_ERROR', message: 'Lỗi khi kiểm tra; từ chối mặc định.' }]);
  }
  if (reasons.length > 0) return deny(reasons);
  // Kết quả thuần: KHÔNG đăng ký quyền migrate. Chỉ runPreMigrateIdentityCheck (sau cổng) mới cấp quyền.
  return Object.freeze({ ok: true, reasons: Object.freeze([]), db: expected.db, stamp: expected.stamp });
}

/** Phân tích URL của cổng thành đích chuẩn hoá {host, port, user, db}; null nếu không hợp lệ (fail-closed). Không trả mật khẩu. */
function parseGateTarget(url) {
  try {
    const u = new URL(url);
    if ((u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') || u.search !== '' || u.hash !== '') return null;
    return { host: u.hostname.toLowerCase(), port: u.port === '' ? SHARED_CLUSTER_PORT : Number(u.port), user: decodeURIComponent(u.username), db: decodeURIComponent(u.pathname.slice(1)) };
  } catch {
    return null;
  }
}

/**
 * TRƯỚC khi đọc định danh: đích của cổng (URL + DB gõ xác nhận + cổng khai báo + mã) phải là CÙNG MỘT đích với `expected`.
 * Tránh cổng đạt cho DB/host/cổng/role A rồi cấp quyền cho B. Trả mã lỗi cố định hoặc null nếu khớp.
 */
function gateTargetProblem(gateInputs, expected) {
  const t = parseGateTarget(gateInputs.url);
  if (t === null) return 'GATE_TARGET_MISMATCH';
  if (t.db !== expected.db || gateInputs.confirmDb !== expected.db) return 'GATE_TARGET_MISMATCH';
  if (t.host !== LOOPBACK_HOST) return 'GATE_TARGET_HOST_MISMATCH';
  if (!Number.isInteger(expected.port) || t.port !== expected.port || gateInputs.expectedPort !== expected.port) return 'GATE_TARGET_PORT_MISMATCH';
  const dm = DB_RE.exec(expected.db);
  if (!dm || expected.stamp !== dm[1]) return 'GATE_TARGET_STAMP_MISMATCH';
  if (t.user !== `siscom_t_owner_${dm[1]}` && t.user !== `siscom_t_app_${dm[1]}`) return 'GATE_TARGET_ROLE_MISMATCH';
  if (!isObj(expected.confirmation) || gateInputs.confirmCode !== expected.confirmation.code) return 'GATE_TARGET_CONFIRMATION_MISMATCH';
  return null;
}

/** SAU khi đọc định danh: bằng chứng do DB báo phải đúng là của đích trong URL của cổng (host/cổng/DB/nhãn), không phải của DB khác. */
function evidenceTargetProblem(gateInputs, evidence) {
  const t = parseGateTarget(gateInputs.url);
  const { connection: c, owner, app } = evidence;
  if (t === null || !isObj(c) || !isObj(owner) || !isObj(app)) return 'GATE_EVIDENCE_TARGET_MISMATCH';
  if (c.host !== t.host || c.port !== t.port || owner.dbLabel !== gateInputs.label) return 'GATE_EVIDENCE_TARGET_MISMATCH';
  for (const snap of [owner, app]) {
    if (snap.currentDatabase !== t.db) return 'GATE_EVIDENCE_TARGET_MISMATCH';
    if (c.runtime !== 'container' && snap.serverPort !== t.port) return 'GATE_EVIDENCE_TARGET_MISMATCH';
  }
  return null;
}

function deny(reasons) {
  return Object.freeze({ ok: false, reasons: Object.freeze(reasons) });
}

function missingMethods(executor) {
  try {
    return isObj(executor) || typeof executor === 'function' ? EXECUTOR_METHODS.filter((m) => typeof executor[m] !== 'function') : [...EXECUTOR_METHODS];
  } catch {
    return [...EXECUTOR_METHODS]; // getter/Proxy ném lỗi → coi như thiếu phương thức (fail-closed, không ném, không lộ nội dung lỗi)
  }
}

/**
 * Chạy kiểm định trước migration qua bộ thực thi TIÊM VÀO. Thứ tự cố định:
 *  1) cổng thực thi (evaluateExecutionGate) — chưa đạt thì KHÔNG gọi executor nào;
 *  2) readIdentity('owner'), readIdentity('app') (chỉ đọc);
 *  3) verifyDbIdentity.
 * Không bao giờ gọi migrateDeploy; trả verdict để guardedMigrateDeploy dùng.
 * @returns {Promise<{ok:boolean, reasons:{code:string,message:string}[], verdict?:object}>}
 */
export async function runPreMigrateIdentityCheck({ executor, gateInputs: gateInputsArg, expected: expectedArg }) {
  // H01 (TOCTOU): chụp BẤT BIẾN một lần ngay đầu hàm; mọi bước sau chỉ dùng bản chụp, không bao giờ đọc lại object gốc.
  const snap = snapshotInputs(gateInputsArg, expectedArg);
  if (snap === null) return { ok: false, reasons: [{ code: 'INPUT_SNAPSHOT_INVALID', message: 'Đầu vào (gateInputs/expected) không chụp được an toàn; từ chối mặc định.' }] };
  const { gateInputs, expected } = snap;
  const missing = missingMethods(executor);
  if (missing.length > 0) return { ok: false, reasons: [{ code: 'EXECUTOR_INVALID', message: 'Bộ thực thi thiếu phương thức bắt buộc.' }] };
  const gate = evaluateExecutionGate(gateInputs);
  if (!gate.ok) return { ok: false, reasons: gate.reasons };
  const targetProblem = isObj(expected) ? gateTargetProblem(gateInputs, expected) : 'GATE_TARGET_MISMATCH';
  if (targetProblem !== null) return { ok: false, reasons: [{ code: targetProblem, message: 'Đích của cổng thực thi (URL/DB/host/cổng/role/stamp/xác nhận) khác đích mong đợi.' }] };
  let evidence;
  try {
    // structuredClone: chụp một lần, chặn getter/Proxy đổi giá trị giữa lúc kiểm và lúc dùng; không clone được → từ chối.
    const owner = structuredClone(await executor.readIdentity('owner'));
    const app = structuredClone(await executor.readIdentity('app'));
    const connection = isObj(owner) && isObj(owner.connection) ? owner.connection : undefined;
    evidence = { connection, owner: isObj(owner) ? stripConnection(owner) : owner, app: isObj(app) ? stripConnection(app) : app };
    if (isObj(app) && (connection !== undefined && !isObj(app.connection) || isObj(app.connection) && JSON.stringify(app.connection) !== JSON.stringify(connection))) {
      return { ok: false, reasons: [{ code: 'CONNECTION_INCONSISTENT', message: 'Hai vai kết nối tới đích khác nhau.' }] };
    }
  } catch {
    return { ok: false, reasons: [{ code: 'EXECUTOR_ERROR', message: 'Bộ thực thi báo lỗi khi đọc định danh; từ chối mặc định.' }] };
  }
  evidence = ownCopy(evidence); // bản chụp đã clone; đọc trường thiếu không được rơi về prototype
  const mismatch = evidenceTargetProblem(gateInputs, evidence);
  if (mismatch !== null) return { ok: false, reasons: [{ code: mismatch, message: 'Bằng chứng định danh không thuộc đích mà cổng thực thi đã chấp thuận.' }] };
  const verdict = verifyDbIdentity(evidence, expected);
  if (!verdict.ok) return { ok: false, reasons: [...verdict.reasons] };
  // Cấp quyền migrate: gắn với đúng executor + DB + thời điểm (expected.now đã được kiểm hợp lệ) + ngày tạo nhãn.
  const labelCreatedAt = Date.parse(LABEL_RE.exec(evidence.owner.dbLabel)[2]);
  const granted = Object.freeze({ ok: true, reasons: Object.freeze([]), db: expected.db, stamp: expected.stamp });
  grants.set(granted, { executor, db: expected.db, issuedAt: expected.now.getTime(), labelCreatedAt });
  return { ok: true, reasons: [], verdict: granted };
}

const PLAIN_PROTOS = new Set([Object.prototype, null, Array.prototype, Date.prototype]);

/** Cây dữ liệu gốc chỉ gồm primitive/object thuần/mảng/Date, khóa chuỗi. Chỉ dùng mô tả thuộc tính (không gọi getter); Proxy đã bị structuredClone từ chối trước đó. */
function isPlainTree(v, seen = new WeakSet()) {
  if (typeof v === 'function' || typeof v === 'symbol') return false;
  if (v === null || typeof v !== 'object') return true;
  if (seen.has(v)) return true;
  seen.add(v);
  if (!PLAIN_PROTOS.has(Object.getPrototypeOf(v))) return false;
  for (const key of Reflect.ownKeys(v)) {
    if (typeof key === 'symbol') return false;
    const d = Object.getOwnPropertyDescriptor(v, key);
    if (d && 'value' in d && !isPlainTree(d.value, seen)) return false;
  }
  return true;
}

function deepFreeze(v, seen = new WeakSet()) {
  if (v === null || typeof v !== 'object' || seen.has(v)) return v;
  seen.add(v);
  for (const k of Reflect.ownKeys(v)) deepFreeze(v[k], seen);
  return Object.freeze(v);
}

/**
 * Chụp một lần {gateInputs, expected}: structuredClone (getter chạy đúng một lần; Proxy/hàm/Symbol/getter ném lỗi → DataCloneError),
 * kiểm kiểu bất thường (Map/Set/RegExp/lớp tuỳ biến/khóa Symbol…) rồi đóng băng sâu bản chụp. Trả null nếu không an toàn (fail-closed).
 */
function snapshotInputs(gateInputs, expected) {
  try {
    const copy = structuredClone({ gateInputs, expected });
    if (!isPlainTree(copy) || !isPlainTree({ gateInputs, expected })) return null;
    return deepFreeze(ownCopy(copy));
  } catch {
    return null;
  }
}

function stripConnection(snap) {
  const { connection: _c, ...rest } = snap;
  return rest;
}

/**
 * Cách DUY NHẤT để gọi migrateDeploy: cần verdict do runPreMigrateIdentityCheck cấp (tức đã qua cổng phê duyệt + kiểm định đích),
 * đúng executor, đúng DB, chưa cũ (≤5 phút kể từ lúc cấp, nhãn DB ≤2 giờ) theo đồng hồ `now` do người gọi tiêm. Dùng một lần.
 * verifyDbIdentity (hàm thuần) KHÔNG cấp quyền này. Không hợp lệ → ném MIGRATE_DENIED, không gọi executor.
 */
export async function guardedMigrateDeploy(executor, verdict, db, now) {
  const g = isObj(verdict) ? grants.get(verdict) : undefined;
  if (g === undefined || verdict.ok !== true) throw new Error('MIGRATE_DENIED: thiếu verdict định danh hợp lệ.');
  if (typeof db !== 'string' || verdict.db !== db || g.db !== db) throw new Error('MIGRATE_DENIED: verdict không thuộc DB này.');
  if (missingMethods(executor).length > 0 || executor !== g.executor) throw new Error('MIGRATE_DENIED: bộ thực thi không hợp lệ hoặc không phải bộ đã được cấp quyền.');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('MIGRATE_DENIED: thiếu đồng hồ hợp lệ.');
  const t = now.getTime();
  if (t - g.issuedAt > MAX_VERDICT_AGE_MS || g.issuedAt - t > MAX_FUTURE_SKEW_MS || t - g.labelCreatedAt > MAX_AGE_MS) {
    grants.delete(verdict);
    throw new Error('MIGRATE_DENIED: verdict đã cũ.');
  }
  grants.delete(verdict); // dùng một lần
  return executor.migrateDeploy(db);
}
