// SISCOM CRM - Sales S2 (PR237-R1-01, PR237-R1-02): KIEM DONG THOI bang HAI KET NOI PostgreSQL that.
// Goi tu scripts/ci/sales-s2-concurrency.sh tren DB TAM rieng (siscom_crm_test_*, 127.0.0.1) - KHONG chay tren DB khac.
// Dung: node sales-s2-concurrency.mjs <db-url> <psql> <rollback.sql.txt>
//   C1/C2: rang buoc "lien he cung khach" cua co hoi giu dung o CA HAI thu tu (tao co hoi gan lien he  vs  chuyen lien he sang khach khac).
//   R1/R2: rollback khoa ghi TRUOC khi kiem du lieu => (R1) ghi den truoc: rollback cho, thay dong da commit va TU CHOI;
//          (R2) rollback den truoc: ghi bi chan toi khi rollback xong, KHONG co dong nao bi DROP mat.
// In "PASS <ten>" / "FAIL <ten>"; thoat 1 neu co FAIL.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [url, psqlBin, rollbackFile] = process.argv.slice(2);
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/siscom_crm_test_\d{8}_\d{6}$/.test(url)) { console.log('TU CHOI: URL khong phai DB tam siscom_crm_test_* tren 127.0.0.1'); process.exit(2); }
const req = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'));
const { Client } = req('pg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const check = (name, ok, detail = '') => { R.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); };
const conn = async () => { const c = new Client({ connectionString: url }); await c.connect(); await c.query("SET lock_timeout = '20s'; SET statement_timeout = '30s'"); return c; };
// Chay cau lenh khong cho; tra ve { done, result, error } cap nhat khi xong (de biet cau lenh dang bi chan).
const start = (c, sql, params) => { const s = { done: false }; s.p = c.query(sql, params).then((r) => { s.done = true; s.result = r; }, (e) => { s.done = true; s.error = e; }); return s; };
const runPsql = (extraVars = []) => {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extraVars.flatMap((v) => ['-v', v]), '-d', url, '-f', rollbackFile];
  const p = spawn(psqlBin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  const s = { done: false }; s.p = new Promise((res) => p.on('close', (code) => { s.done = true; s.code = code; s.out = out; res(); })); return s;
};

const ID = (n) => '5a200000-0000-4000-8000-' + String(n).padStart(12, '0');
const K1 = ID(31), K2 = ID(32), C = ID(41), EMP = ID(21), TYPE = ID(13), STAGE = ID(14);
const insOpp = (id) => ['INSERT INTO opportunity (id, customer_id, contact_id, title, type_id, stage_id, owner_id, is_demo) VALUES ($1, $2, $3, $4, $5, $6, $7, true)', [id, K1, C, 'S2 dong thoi', TYPE, STAGE, EMP]];
const mismatch = async (c) => Number((await c.query('SELECT count(*) AS n FROM opportunity o JOIN contact ct ON ct.id = o.contact_id WHERE ct.customer_id <> o.customer_id')).rows[0].n);

const a = await conn(); const b = await conn();
try {
  await a.query(`INSERT INTO lookup_item (id, type, code, label_vi) VALUES ($1, 'customer_tier', 'ZZ_S2C_TIER', 'S2C hang'), ($2, 'customer_status', 'ZZ_S2C_STATUS', 'S2C trang thai'),
    ($3, 'opportunity_type', 'ZZ_S2C_TYPE', 'S2C loai'), ($4, 'opportunity_stage', 'ZZ_S2C_STAGE', 'S2C giai doan')`, [ID(11), ID(12), TYPE, STAGE]);
  await a.query(`INSERT INTO employee (id, full_name, email, status, is_demo) VALUES ($1, 'S2C NV', 's2c@example.invalid', 'ACTIVE', true)`, [EMP]);
  await a.query(`INSERT INTO customer (id, name, phone, tier_id, status_id, is_demo) VALUES ($1, 'S2C K1', '0906000001', $3, $4, true), ($2, 'S2C K2', '0906000002', $3, $4, true)`, [K1, K2, ID(11), ID(12)]);
  await a.query(`INSERT INTO contact (id, customer_id, full_name, phone, is_demo) VALUES ($1, $2, 'S2C lien he', '0906000011', true)`, [C, K1]);

  // C1: A tao co hoi (lien he C cua K1), CHUA commit; B chuyen C sang K2.
  await a.query('BEGIN'); await a.query(...insOpp(ID(61)));
  await b.query('BEGIN'); const bu = start(b, 'UPDATE contact SET customer_id = $1 WHERE id = $2', [K2, C]);
  await sleep(700); const blocked1 = !bu.done;
  await a.query('COMMIT'); await bu.p; await b.query(bu.error ? 'ROLLBACK' : 'COMMIT');
  check('C1 chuyen lien he bi CHAN trong khi co hoi chua commit dang gan lien he', blocked1);
  check('C1 sau khi co hoi commit: chuyen lien he that bai (23001 RESTRICT cua FK ghep), lien he van o K1', bu.error && bu.error.code === '23001', bu.error ? bu.error.code + ' ' + bu.error.message : 'UPDATE chay duoc');
  check('C1 khong co co hoi nao lech khach voi lien he', (await mismatch(a)) === 0);
  await a.query('DELETE FROM opportunity WHERE id = $1', [ID(61)]);
  await a.query('UPDATE contact SET customer_id = $1 WHERE id = $2', [K1, C]);

  // C2: B chuyen C sang K2, CHUA commit; A tao co hoi gan C cho K1.
  await b.query('BEGIN'); await b.query('UPDATE contact SET customer_id = $1 WHERE id = $2', [K2, C]);
  await a.query('BEGIN'); const ai = start(a, ...insOpp(ID(62)));
  await sleep(700); const blocked2 = !ai.done;
  await b.query('COMMIT'); await ai.p; await a.query(ai.error ? 'ROLLBACK' : 'COMMIT');
  check('C2 tao co hoi bi CHAN trong khi viec chuyen lien he chua commit', blocked2);
  check('C2 sau khi chuyen lien he commit: tao co hoi that bai (23503)', ai.error && ai.error.code === '23503', ai.error ? ai.error.code + ' ' + ai.error.message : 'INSERT chay duoc');
  check('C2 khong co co hoi nao lech khach voi lien he', (await mismatch(a)) === 0);
  await a.query('UPDATE contact SET customer_id = $1 WHERE id = $2', [K1, C]);
  await a.query('DELETE FROM opportunity WHERE id = $1', [ID(62)]);

  // R1: ghi den TRUOC (chua commit), rollback chay => cho khoa; ghi commit => rollback thay 1 dong va TU CHOI, dong van con.
  await a.query('BEGIN'); await a.query(...insOpp(ID(63)));
  const r1 = runPsql();
  await sleep(1200); const r1blocked = !r1.done;
  await a.query('COMMIT'); await r1.p;
  check('R1 rollback CHO khoa khi co ghi chua commit', r1blocked);
  check('R1 rollback TU CHOI sau khi ghi commit (thay dong vua ghi)', r1.code !== 0 && /TU CHOI: con 1 dong opportunity/.test(r1.out), 'psql thoat ' + r1.code);
  check('R1 dong vua ghi VAN CON (khong bi DROP)', Number((await a.query('SELECT count(*) AS n FROM opportunity WHERE id = $1', [ID(63)])).rows[0].n) === 1);
  await a.query('DELETE FROM opportunity WHERE id = $1', [ID(63)]);

  // R2: rollback den TRUOC (giu khoa, test hook tam dung 3 s sau khi khoa), ghi den sau => bi chan; rollback xong => bang da go,
  //     ghi that bai, KHONG co du lieu nao da commit bi mat.
  const r2 = runPsql(['s2_rollback_test_pause=3']);
  await sleep(1200);
  await a.query('BEGIN'); const w = start(a, ...insOpp(ID(64)));
  await sleep(700); const r2blocked = !w.done;
  await r2.p; await w.p; await a.query('ROLLBACK').catch(() => {});
  check('R2 ghi bi CHAN trong khi rollback dang giu khoa', r2blocked);
  check('R2 rollback xong (thoat 0) - bang rong luc kiem, khong co gi bi mat', r2.code === 0, 'psql thoat ' + r2.code + (r2.code ? ' ' + r2.out.slice(-300) : ''));
  check('R2 ghi den sau that bai (bang da go), khong commit duoc', !!w.error, w.error ? w.error.code + ' ' + w.error.message : 'INSERT chay duoc');
  check('R2 bang opportunity da go', (await a.query("SELECT to_regclass('public.opportunity') IS NULL AS gone")).rows[0].gone === true);
} catch (e) {
  check('khong loi bat ngo', false, e && (e.code || '') + ' ' + (e && e.message));
} finally {
  await a.end().catch(() => {}); await b.end().catch(() => {});
}
const fail = R.filter((x) => !x).length;
console.log((fail ? 'FAIL|' : 'PASS|') + (fail || R.length));
process.exit(fail ? 1 : 0);
