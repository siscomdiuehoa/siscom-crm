// SISCOM CRM - Sales S5 (PR240-R1-01, PR240-R1-02): KIEM DONG THOI bang HAI KET NOI PostgreSQL that.
// Goi tu scripts/ci/sales-s5-concurrency.sh tren DB TAM rieng (siscom_crm_test_*, 127.0.0.1, da migrate deploy, RBAC rong, bootstrap MO).
// Dung: node sales-s5-concurrency.mjs <db-url> <psql> <migration.sql> <rollback> <add> <remove>
//   M1/M2: migration phan loai BIZ doi dau viec cap opportunity.* cho vai tro admin (ca hai thu tu).
//   R1/R2/R3: rollback phan loai doi dau viec chen ma opportunity.* / script ADD (ca hai thu tu).
//   X1/X2/X3: script REMOVE doi dau viec cap quyen NGOAI ma tran / doi scope cua dong S5 (ca hai thu tu).
// Ky vong chung: ben den sau CHO ben den truoc, roi danh gia theo trang thai MOI (tu choi) - khong bao gio ket thuc voi admin giu quyen BIZ,
// rollback bao thanh cong khi con ma, hoac REMOVE am tham xoa mot quyen vua duoc cap ngoai ma tran.
// In "PASS <ten>" / "FAIL <ten>"; thoat 1 neu co FAIL.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [url, psqlBin, migrationFile, rollbackFile, addFile, removeFile] = process.argv.slice(2);
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/siscom_crm_test_\d{8}_\d{6}$/.test(url)) { console.log('TU CHOI: URL khong phai DB tam siscom_crm_test_* tren 127.0.0.1'); process.exit(2); }
if (!removeFile) { console.log('Dung: node sales-s5-concurrency.mjs <db-url> <psql> <migration.sql> <rollback> <add> <remove>'); process.exit(2); }
const req = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'));
const { Client } = req('pg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const check = (name, ok, detail = '') => { R.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); };
const conn = async () => { const c = new Client({ connectionString: url }); await c.connect(); await c.query("SET lock_timeout = '30s'; SET statement_timeout = '45s'"); return c; };
// Chay cau lenh khong cho; { done, result, error } cap nhat khi xong (de biet cau lenh dang bi chan).
const start = (c, sql, params) => { const s = { done: false }; s.p = c.query(sql, params).then((r) => { s.done = true; s.result = r; }, (e) => { s.done = true; s.error = e; }); return s; };
// psql: steps = [['-c', sql] | ['-f', file]] chay tuan tu trong MOT phien; vars = ['ten=gia tri'].
const runPsql = (steps, vars = []) => {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...vars.flatMap((v) => ['-v', v]), '-d', url, ...steps.flat()];
  const p = spawn(psqlBin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  const s = { done: false }; s.p = new Promise((res) => p.on('close', (code) => { s.done = true; s.code = code; s.out = out; res(); })); return s;
};
const tail = (s) => String(s.out ?? '').trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 260);

const ID = (g, n) => '55c' + g + '0000-0000-4000-8000-' + String(n).padStart(12, '0');
const P_APPROVE = ID(0, 1), P_REQUEST = ID(0, 2), P_OPP_READ = ID(0, 3);
const R_ADMIN = ID(1, 1), R_CRM = ID(1, 2), R_SALES = ID(1, 3), R_TECH = ID(1, 4), R_ACCT = ID(1, 5), R_DIRECTOR = ID(1, 6);
const E_SYS = ID(2, 1), E_APP = ID(2, 2);
const MIG = '20261118000000_sales_perm_class';
const S5_CODES = ['read', 'read_assigned', 'create', 'update', 'move_stage', 'close', 'assign', 'reopen', 'delete', 'restore'].map((c) => 'opportunity.' + c);
const vars = ['s5_sysadmin=' + E_SYS, 's5_approver=' + E_APP];

const a = await conn(); const b = await conn();
const one = async (sql, params) => (await a.query(sql, params)).rows[0];
const cls = async () => (await one("SELECT public.fn_auth_perm_class('opportunity.read') AS c")).c;
const migRow = async () => Number((await one('SELECT count(*) AS n FROM public._prisma_migrations WHERE migration_name = $1', [MIG])).n);
const oppCodes = async () => Number((await one("SELECT count(*) AS n FROM public.permission WHERE code LIKE 'opportunity.%'")).n);
const s5Rows = async () => Number((await one('SELECT count(*) AS n FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id WHERE p.code = ANY ($1)', [S5_CODES])).n);
const adminOpp = async () => Number((await one("SELECT count(*) AS n FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id WHERE rp.role_id = $1 AND p.code LIKE 'opportunity.%'", [R_ADMIN])).n);
// Chuan hoa trang thai giua cac ca (chi tren DB tam nay): than ham theo lop mong muon + dong _prisma_migrations. Hai than ham chep dung
// migration M1 (OTHER) va migration S5 (BIZ); khac nhau duy nhat o tien to "opportunity".
const setState = async (want) => {
  const prefixes = 'customer|contact|activity|interaction|approval' + (want === 'BIZ' ? '|opportunity' : '');
  await a.query(`CREATE OR REPLACE FUNCTION public.fn_auth_perm_class(p_code text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $f$
    SELECT CASE WHEN p_code = 'access.approve' THEN 'APPROVE'
      WHEN p_code IN ('employee.manage', 'role.manage', 'auth.credential.manage', 'auth.reset.request', 'access.request') THEN 'REQUEST'
      WHEN p_code ~ '^(${prefixes})\\.' THEN 'BIZ' ELSE 'OTHER' END $f$`);
  await a.query('DELETE FROM public._prisma_migrations WHERE migration_name = $1', [MIG]);
  if (want === 'BIZ') await a.query("INSERT INTO public._prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, 's5c', $1, now(), now(), 1)", [MIG]);
};
// Mot yeu cau dac quyen 2 nguoi (tao -> duyet -> thuc thi) trong MOT cau lenh.
const priv = (roleId, code, op, scope) => [`DO $d$ DECLARE v uuid; BEGIN
  v := public.fn_auth_api_request_create('${E_SYS}', 'ROLE_PERMISSION_CHANGE', NULL, '${roleId}',
         jsonb_build_object('op', '${op}', 'permissionId', (SELECT id FROM public.permission WHERE code = '${code}')${scope ? ", 'scope', '" + scope + "'" : ''}, 's5c', '${code}'), 60);
  PERFORM public.fn_auth_api_request_decide('${E_APP}', v, true);
  PERFORM public.fn_auth_api_role_permission_change('${E_SYS}', v);
END $d$`];

try {
  check('tien dieu kien: da migrate (BIZ, co dong migration), RBAC rong, bootstrap MO', (await cls()) === 'BIZ' && (await migRow()) === 1
    && Number((await one('SELECT (SELECT count(*) FROM role) + (SELECT count(*) FROM permission) AS n')).n) === 0 && (await one('SELECT public.fn_auth_bootstrap_open() AS o')).o === true);

  // ===== M: migration (chieu nang) doi dau cap opportunity.* cho vai tro admin =====
  await a.query("INSERT INTO public.role (id, code, name, is_system, is_confirmed) VALUES ($1, 'admin', 'S5C sysadmin', true, true)", [R_ADMIN]);
  await a.query("INSERT INTO public.permission (id, code) VALUES ($1, 'opportunity.read')", [P_OPP_READ]);
  await setState('OTHER');

  // M1: B cap quyen cho admin (ham cu = OTHER nen SoD chua chan), CHUA commit; A chay migration.
  await b.query('BEGIN'); await b.query("INSERT INTO public.role_permission (role_id, permission_id, scope) VALUES ($1, $2, 'ALL')", [R_ADMIN, P_OPP_READ]);
  let m = runPsql([['-f', migrationFile]]); await sleep(1500);
  check('M1 migration CHO giao dich cap quyen dang mo (khoa truoc khi tien kiem)', m.done === false);
  await b.query('COMMIT'); await m.p;
  check('M1 migration TU CHOI khi admin da giu opportunity.* (thay dong vua commit)', m.code !== 0 && /TU CHOI: vai tro admin dang giu quyen opportunity/.test(m.out), 'exit=' + m.code + ' ' + tail(m));
  check('M1 ham KHONG doi (van OTHER) => khong co trang thai admin giu quyen BIZ', (await cls()) === 'OTHER' && (await adminOpp()) === 1, 'lop=' + (await cls()));
  await a.query('DELETE FROM public.role_permission WHERE role_id = $1', [R_ADMIN]);
  await setState('OTHER');

  // M2: A ap migration trong transaction CHUA commit; B cap quyen cho admin.
  m = runPsql([['-c', 'BEGIN'], ['-f', migrationFile], ['-c', 'SELECT pg_sleep(3)'], ['-c', 'COMMIT']]); await sleep(1200);
  await b.query('BEGIN');
  let w = start(b, "INSERT INTO public.role_permission (role_id, permission_id, scope) VALUES ($1, $2, 'ALL')", [R_ADMIN, P_OPP_READ]); await sleep(800);
  check('M2 lenh cap quyen bi CHAN trong luc migration chua commit', w.done === false);
  await m.p; await w.p; await b.query(w.error ? 'ROLLBACK' : 'COMMIT');
  check('M2 migration xong; lenh cap quyen duoc danh gia theo ham MOI => SoD tu choi (23514)', m.code === 0 && w.error?.code === '23514', 'exit=' + m.code + ' sqlstate=' + (w.error?.code ?? 'khong loi'));
  check('M2 ket thuc: opportunity.* la BIZ va admin KHONG giu quyen nao', (await cls()) === 'BIZ' && (await adminOpp()) === 0);
  await a.query('DELETE FROM public.role_permission WHERE role_id = $1', [R_ADMIN]);
  await a.query('DELETE FROM public.permission WHERE id = $1', [P_OPP_READ]);
  await setState('BIZ');

  // ===== R: rollback (chieu lui) doi dau chen ma opportunity.* / script ADD =====
  // R1: B chen mot ma opportunity.*, CHUA commit; A chay rollback.
  await b.query('BEGIN'); await b.query("INSERT INTO public.permission (code) VALUES ('opportunity.zz_s5c_r1')");
  let r = runPsql([['-f', rollbackFile]]); await sleep(1500);
  check('R1 rollback CHO giao dich chen ma dang mo (khoa bang truoc khi dem)', r.done === false);
  await b.query('COMMIT'); await r.p;
  check('R1 rollback TU CHOI khi con ma (thay ma vua commit)', r.code !== 0 && /TU CHOI: con 1 ma opportunity/.test(r.out), 'exit=' + r.code + ' ' + tail(r));
  check('R1 ham KHONG bi tra ve ban cu (van BIZ), dong migration con', (await cls()) === 'BIZ' && (await migRow()) === 1, 'lop=' + (await cls()));
  await a.query("DELETE FROM public.permission WHERE code = 'opportunity.zz_s5c_r1'");
  await setState('BIZ');

  // R2: A rollback giu khoa (moc tam dung); B chen ma => bi chan toi khi rollback xong.
  r = runPsql([['-f', rollbackFile]], ['s5_test_pause=3']); await sleep(1200);
  w = start(b, "INSERT INTO public.permission (code) VALUES ('opportunity.zz_s5c_r2')"); await sleep(800);
  check('R2 lenh chen ma bi CHAN trong luc rollback giu khoa', w.done === false && r.done === false);
  await r.p; await w.p;
  check('R2 rollback xong sach TRUOC khi lenh chen chay (khong co ma nao luc doi ham)', r.code === 0 && (await cls()) === 'OTHER' && (await migRow()) === 0, 'exit=' + r.code + ' ' + tail(r));
  await a.query("DELETE FROM public.permission WHERE code = 'opportunity.zz_s5c_r2'");
  await setState('BIZ');

  // R3: A rollback giu khoa; B chay script ADD => cho, roi TU CHOI vi opportunity.* khong con la BIZ (kiem SAU khi lay khoa).
  r = runPsql([['-f', rollbackFile]], ['s5_test_pause=3']); await sleep(1200);
  let ad = runPsql([['-f', addFile]], vars); await sleep(800);
  check('R3 script ADD bi CHAN trong luc rollback giu khoa (kiem BIZ sau khi lay khoa)', ad.done === false && r.done === false);
  await r.p; await ad.p;
  check('R3 rollback xong; ADD TU CHOI (chua thuoc nhom BIZ), khong chen ma nao', r.code === 0 && ad.code !== 0 && /chua thuoc nhom BIZ/.test(ad.out) && (await oppCodes()) === 0, 'rollback=' + r.code + ' add=' + ad.code + ' ' + tail(ad));
  await setState('BIZ');

  // ===== X: script REMOVE doi dau cap quyen NGOAI ma tran / doi scope (bootstrap DA DONG, luong 2 nguoi) =====
  await a.query(`INSERT INTO public.permission (id, code) VALUES ($1, 'access.approve'), ($2, 'access.request')`, [P_APPROVE, P_REQUEST]);
  await a.query(`INSERT INTO public.role (id, code, name, is_system, is_confirmed) VALUES ($1, 'crm_admin', 'S5C crm_admin', true, true), ($2, 'sales', 'S5C sales', true, true),
    ($3, 'technician', 'S5C technician', true, true), ($4, 'accountant', 'S5C accountant', true, true), ($5, 'director', 'S5C ngoai ma tran', false, true)`, [R_CRM, R_SALES, R_TECH, R_ACCT, R_DIRECTOR]);
  await a.query(`INSERT INTO public.role_permission (role_id, permission_id, scope) VALUES ($1, $2, 'ALL'), ($3, $4, 'ALL')`, [R_ADMIN, P_REQUEST, R_CRM, P_APPROVE]);
  await a.query(`INSERT INTO public.employee (id, full_name, email, status, is_demo) VALUES ($1, 'S5C Sysadmin', 's5c.sys@example.invalid', 'ACTIVE', true), ($2, 'S5C CRM admin', 's5c.crm@example.invalid', 'ACTIVE', true)`, [E_SYS, E_APP]);
  await a.query(`INSERT INTO public.employee_credential (employee_id, password_hash, password_algo, password_params) VALUES ($1, '$argon2id$v=19$thu-s5c-s', 'argon2id', '{"m":65536,"t":3,"p":1}'), ($2, '$argon2id$v=19$thu-s5c-c', 'argon2id', '{"m":65536,"t":3,"p":1}')`, [E_SYS, E_APP]);
  await a.query(`INSERT INTO public.employee_role (employee_id, role_id) VALUES ($1, $2), ($3, $4)`, [E_SYS, R_ADMIN, E_APP, R_CRM]);
  await a.query("SELECT public.fn_auth_bootstrap_close('s5c')");
  const addAll = async () => { const s = runPsql([['-f', addFile]], vars); await s.p; return s; };
  ad = await addAll();
  check('X0 ADD (2 nguoi) cap du 17 dong / 10 ma', ad.code === 0 && (await s5Rows()) === 17 && (await oppCodes()) === 10, 'exit=' + ad.code + ' ' + tail(ad));

  // X1: B cap director:opportunity.read:OWN (ngoai ma tran), CHUA commit; A chay REMOVE.
  await b.query('BEGIN'); await b.query(...priv(R_DIRECTOR, 'opportunity.read', 'ADD', 'OWN'));
  let x = runPsql([['-f', removeFile]], vars); await sleep(1500);
  check('X1 REMOVE CHO giao dich cap quyen dang mo (khoa truoc tien kiem 0a)', x.done === false);
  await b.query('COMMIT'); await x.p;
  check('X1 REMOVE TU CHOI vi dong ngoai ma tran vua commit - khong go gi', x.code !== 0 && /TU CHOI REMOVE/.test(x.out) && /director:opportunity\.read:OWN/.test(x.out), 'exit=' + x.code + ' ' + tail(x));
  check('X1 moi dong con nguyen: 17 dong S5 + 1 dong director, 10 ma', (await s5Rows()) === 18 && (await oppCodes()) === 10, 'dong=' + (await s5Rows()));
  await a.query(...priv(R_DIRECTOR, 'opportunity.read', 'REMOVE'));

  // X2: A REMOVE giu khoa (moc tam dung, sau khoa - truoc tien kiem 0a); B cap director:opportunity.read:OWN.
  x = runPsql([['-f', removeFile]], [...vars, 's5_test_pause=3']); await sleep(1200);
  await b.query('BEGIN');
  w = start(b, ...priv(R_DIRECTOR, 'opportunity.read', 'ADD', 'OWN')); await sleep(800);
  check('X2 lenh cap quyen bi CHAN trong luc REMOVE giu khoa', w.done === false && x.done === false);
  await x.p; await w.p; await b.query('ROLLBACK');
  check('X2 REMOVE xong sach (17 dong, 10 ma); lenh cap quyen den sau THAT BAI (ma da bi go) chu khong bi xoa am tham', x.code === 0 && !!w.error && (await s5Rows()) === 0 && (await oppCodes()) === 0,
    'exit=' + x.code + ' loi B=' + (w.error ? (w.error.code ?? 'co loi') : 'KHONG LOI') + ' dong=' + (await s5Rows()));

  // X3: doi scope cua mot dong S5 giua tien kiem va vong go. B doi sales:opportunity.read OWN -> ALL, CHUA commit; A chay REMOVE.
  ad = await addAll();
  check('X3 chuan bi: ADD lai 17 dong', ad.code === 0 && (await s5Rows()) === 17);
  await b.query('BEGIN'); await b.query(...priv(R_SALES, 'opportunity.read', 'SET_SCOPE', 'ALL'));
  x = runPsql([['-f', removeFile]], vars); await sleep(1500);
  check('X3 REMOVE CHO giao dich doi scope dang mo', x.done === false);
  await b.query('COMMIT'); await x.p;
  check('X3 REMOVE TU CHOI vi scope lech ma tran (sales:opportunity.read:ALL) - khong go gi', x.code !== 0 && /TU CHOI REMOVE/.test(x.out) && /sales:opportunity\.read:ALL/.test(x.out), 'exit=' + x.code + ' ' + tail(x));
  check('X3 17 dong con nguyen, sales:opportunity.read van la ALL', (await s5Rows()) === 17
    && (await one("SELECT rp.scope::text AS s FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id WHERE rp.role_id = $1 AND p.code = 'opportunity.read'", [R_SALES])).s === 'ALL');
} catch (e) {
  check('KHONG LOI NGOAI DU KIEN', false, String(e?.message ?? e).slice(0, 300));
} finally {
  await a.end().catch(() => {}); await b.end().catch(() => {});
}
const fail = R.filter((x) => !x).length;
console.log((fail ? 'FAIL|' + fail : 'PASS|' + R.length));
process.exit(fail ? 1 : 0);
