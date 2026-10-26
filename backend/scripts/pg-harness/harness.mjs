// Harness backend + PostgreSQL disposable (C-06, NHÁP). Đặc tả: docs/PG_ISOLATED_ACCEPTANCE_PLAN.md (PR #100), guard C-05.
// Mặc định DRY_RUN: chỉ in kế hoạch. Không đọc .env, không kết nối DB, không gọi Prisma/psql, không có bộ thực thi DB trong bản nháp này.
// Chế độ --execute: qua cổng fail-closed (phê duyệt + guard C-05 + TTY); kể cả khi qua cổng vẫn dừng NOT_IMPLEMENTED (exit 3).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDisposableTarget } from '../guards/pg-dryrun-guard.mjs';
import { CATALOG, validateCatalog } from './test-catalog.mjs';

export const EXIT = { OK: 0, GATE_DENIED: 2, NOT_IMPLEMENTED: 3, USAGE: 64 };
const APPROVAL_RE = /^[A-Za-z0-9#:_/.-]{8,200}$/;
const BYPASS_ARG_RE = /^--?(force|yes|y|skip.*|non-?interactive|no-?confirm.*|assume-?yes|unattended|bypass.*)$/i;
const SECRET_KEY_RE = /pass(word)?|secret|token|credential|api[_-]?key|private/i;
const SYNTH_EMAIL_RE = /^[^@\s]+@example\.invalid$/;
const SECRET_VALUE_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s@]+@|^\s*bearer\s+\S|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const DEFAULT_FIXTURE_URL = new URL('./fixtures.synthetic.json', import.meta.url);

/** Các bước từ plan §6; mọi bước cần DB đều NOT_RUN. */
export function buildPlan() {
  const s = (step, name, runAs, requiresDb) => ({ step, name, runAs, requiresDb, status: 'NOT_RUN' });
  return [
    s(0, 'Tiền kiểm guard offline (node --test)', 'không DB', false),
    s(1, 'Tạo role + DB mới siscom_crm_test_<stamp> + nhãn sở hữu', 'postgres (nhập ẩn)', true),
    s(2, 'Guard trực tuyến chỉ đọc (§4.2.6)', 'siscom_t_owner_<stamp>', true),
    s(3, 'prisma migrate deploy', 'siscom_t_owner_<stamp>', true),
    s(4, 'Cấp quyền ít quyền (B1.3_S1_APP_GRANTS đổi tên role)', 'siscom_t_owner_<stamp>', true),
    s(5, 'B1.3_S1_PRIVILEGE_TESTS', 'superuser', true),
    s(6, 'Constraint tests M1/M1.1/M1.2', 'siscom_t_owner_<stamp>', true),
    s(7, 'Nạp fixture tổng hợp + chạy danh mục integration (customer CRUD/đồng thời/deny-by-default)', 'siscom_t_app_<stamp>', true),
    s(8, 'Drift: prisma migrate status', 'siscom_t_owner_<stamp>', true),
    s(9, 'In lệnh dọn thủ công (không tự DROP)', 'postgres', true),
  ];
}

/** Kiểm fixture tổng hợp: nhỏ, is_demo, miền example.invalid, dải MST/SĐT giả, không khóa bí mật, không trùng khóa. */
export function validateFixture(fx) {
  const p = [];
  const walk = (v, path) => {
    if (typeof v === 'string') { if (SECRET_VALUE_RE.test(v)) p.push(`${path}: giá trị nghi bí mật/chuỗi kết nối`); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (SECRET_KEY_RE.test(k)) p.push(`${path}.${k}: khóa nghi bí mật`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(fx, '$');
  if (fx === null || typeof fx !== 'object' || Array.isArray(fx)) { p.push('fixture: gốc phải là đối tượng JSON'); return p; }
  const cs = fx.customers;
  const ct = fx.contacts;
  if (!Array.isArray(cs) || cs.length === 0 || cs.length > 300) p.push('customers: phải có 1–300 dòng');
  if (!Array.isArray(ct) || ct.length > 300) p.push('contacts: tối đa 300 dòng');
  if ([...(Array.isArray(cs) ? cs : []), ...(Array.isArray(ct) ? ct : [])].some((r) => r === null || typeof r !== 'object' || Array.isArray(r))) { p.push('customers/contacts: mỗi dòng phải là đối tượng'); return p; }
  const keys = new Set();
  const taxes = new Set();
  // M03: chỉ định vị bằng chỉ số dòng; không phản chiếu giá trị do fixture cung cấp (key/fullName) ra thông báo.
  (Array.isArray(cs) ? cs : []).forEach((c, i) => {
    const at = `customers[${i}]`;
    if (c.isDemo !== true) p.push(`${at}: thiếu isDemo=true`);
    if (!SYNTH_EMAIL_RE.test(c.email ?? '')) p.push(`${at}: email phải thuộc example.invalid`);
    if (!/^9999\d{6}$/.test(c.taxId ?? '')) p.push(`${at}: MST ngoài dải giả 9999xxxxxx`);
    if (!/^0900\d{6}$/.test(c.phone ?? '')) p.push(`${at}: SĐT ngoài dải giả 0900xxxxxx`);
    if (keys.has(c.key)) p.push(`${at}: trùng key`);
    keys.add(c.key);
    if (taxes.has(c.taxId)) p.push(`${at}: trùng MST`);
    taxes.add(c.taxId);
  });
  (Array.isArray(ct) ? ct : []).forEach((c, i) => {
    const at = `contacts[${i}]`;
    if (c.isDemo !== true) p.push(`${at}: thiếu isDemo=true`);
    if (!keys.has(c.customer)) p.push(`${at}: customer không tồn tại`);
    if (!SYNTH_EMAIL_RE.test(c.email ?? '')) p.push(`${at}: email phải thuộc example.invalid`);
  });
  return p;
}

/**
 * Cổng thực thi fail-closed. `inputs` hoàn toàn tường minh (không đọc process.env/.env ở đây).
 * Kết quả không bao giờ chứa URL/mật khẩu.
 */
export function evaluateExecutionGate(inputs) {
  const reasons = [];
  const i = inputs !== null && typeof inputs === 'object' ? inputs : {};
  if (typeof i.approvalRef !== 'string' || !APPROVAL_RE.test(i.approvalRef)) reasons.push({ code: 'APPROVAL_MISSING', message: 'Thiếu mã tham chiếu phê duyệt văn bản của chủ sở hữu (SISCOM_PG_APPROVAL_REF).' });
  if (i.ownerGrantedTestDb !== true) reasons.push({ code: 'OWNER_DB_NOT_GRANTED', message: 'Chủ sở hữu chưa cấp DB thử riêng (SISCOM_PG_OWNER_GRANTED_DB=1).' });
  const g = validateDisposableTarget({
    url: i.url, env: i.guardEnv, expectedPort: i.expectedPort, now: i.now, label: i.label,
    confirmation: { dbName: i.confirmDb, code: i.confirmCode, interactive: i.interactive === true },
    ...(i.sharedClusterApproved === true ? { sharedClusterApproved: true } : {}),
  });
  if (!g.ok) reasons.push(...g.reasons.map((r) => ({ code: `GUARD_${r.code}`, message: r.message })));
  return { ok: reasons.length === 0, reasons };
}

/** Chỉ giữ biến môi trường có thể đổi đích ngầm (PG*, DATABASE_URL) và che giá trị, để guard từ chối. Không đọc .env. */
export function pickRedirectingEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => /^PG/i.test(k) || k.toUpperCase() === 'DATABASE_URL').map(([k]) => [k, '<đã-đặt>']));
}

export function parseArgs(argv) {
  const out = { execute: false, listCatalog: false, errors: [] };
  // M03: không phản chiếu giá trị argv (có thể là chuỗi kết nối/mật khẩu gõ nhầm) ra stderr; chỉ nêu vị trí.
  argv.forEach((a, i) => {
    if (a === '--dry-run') out.execute = false;
    else if (a === '--execute') out.execute = true;
    else if (a === '--list-catalog') out.listCatalog = true;
    else if (BYPASS_ARG_RE.test(a)) out.errors.push(`Cờ bỏ qua ở vị trí ${i + 1} không được phép.`);
    else out.errors.push(`Tham số lạ ở vị trí ${i + 1}.`);
  });
  return out;
}

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Đọc fixture; mọi lỗi (mất file, UTF-8 hỏng, JSON sai) → thông báo cố định, không ném, không kèm nội dung/đường dẫn/env. */
export function loadFixture(url = DEFAULT_FIXTURE_URL) {
  try {
    return { fx: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(url))) };
  } catch (e) {
    const why = e instanceof SyntaxError ? 'JSON không hợp lệ' : e instanceof TypeError ? 'ký tự UTF-8 không hợp lệ' : 'không đọc được tệp';
    return { problem: `fixture: ${why}` };
  }
}

export function run(argv, env, io = defaultIo, now = new Date(), tty = false, fixtureUrl = DEFAULT_FIXTURE_URL) {
  const args = parseArgs(argv);
  if (args.errors.length) { args.errors.forEach((e) => io.err(`USAGE: ${e}`)); return EXIT.USAGE; }
  const loaded = loadFixture(fixtureUrl);
  const assetProblems = [...('problem' in loaded ? [loaded.problem] : validateFixture(loaded.fx)), ...validateCatalog()];
  if (assetProblems.length) { assetProblems.forEach((e) => io.err(`ASSET_INVALID: ${e}`)); return EXIT.GATE_DENIED; }
  if (args.listCatalog) CATALOG.forEach((e) => io.out(`${e.id}\t${e.area}\t${e.status}\t${e.title}`));
  if (!args.execute) {
    io.out('MODE=DRY_RUN (không kết nối DB, không đọc .env). Kế hoạch:');
    buildPlan().forEach((s) => io.out(`  ${s.step}. [${s.status}] ${s.name} — chạy bằng: ${s.runAs}`));
    io.out('Kết quả DB integration: NOT_RUN');
    return EXIT.OK;
  }
  const gate = evaluateExecutionGate({
    approvalRef: env.SISCOM_PG_APPROVAL_REF, ownerGrantedTestDb: env.SISCOM_PG_OWNER_GRANTED_DB === '1',
    url: env.SISCOM_PG_TEST_URL, guardEnv: pickRedirectingEnv(env), expectedPort: Number(env.SISCOM_PG_EXPECTED_PORT),
    now, label: env.SISCOM_PG_LABEL, confirmDb: env.SISCOM_PG_CONFIRM_DB, confirmCode: env.SISCOM_PG_CONFIRM_CODE, interactive: tty,
    sharedClusterApproved: env.SISCOM_PG_SHARED_CLUSTER_APPROVED === '1',
  });
  if (!gate.ok) {
    gate.reasons.forEach((r) => io.err(`DENIED ${r.code}: ${r.message}`));
    io.err('Không kết nối DB. Kết quả: NOT_RUN');
    return EXIT.GATE_DENIED;
  }
  io.err('NOT_IMPLEMENTED: bản nháp chưa có bộ thực thi DB; cần PR riêng được duyệt. Không kết nối DB. Kết quả: NOT_RUN');
  return EXIT.NOT_IMPLEMENTED;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = run(process.argv.slice(2), process.env, defaultIo, new Date(), Boolean(process.stdin.isTTY));
}
