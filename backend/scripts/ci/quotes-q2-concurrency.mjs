// SISCOM CRM - Bao gia Q2 (docs/QUOTES_DESIGN.md muc 11: B12, B13, B15): KIEM DONG THOI bang HAI KET NOI PostgreSQL that, SQL TRUC TIEP (khong qua API).
// Goi tu scripts/ci/quotes-q2-concurrency.sh tren DB TAM rieng (siscom_crm_test_*, 127.0.0.1) - KHONG chay tren DB khac.
// Dung: node quotes-q2-concurrency.mjs <db-url>
//   B12: hai transaction cung chap nhan tren MOT co hoi (hai phien ban da gui cua bao gia dang theo duoi; va bao gia dang theo duoi vs bao gia khac)
//        => dung MOT ben thanh cong; lap 50 lan, khong lan nao co hai phien ban duoc chap nhan. Diem cho la dong opportunity (pg_locks).
//        Ghi chu: U-3 (toi da mot bao gia dang theo duoi / co hoi) + R-Q7 (chi chap nhan bao gia dang theo duoi) => hai bao gia KHAC NHAU cua mot co hoi
//        khong bao gio cung du dieu kien chap nhan; ben khong theo duoi luon bi QUOTE_NOT_PRIMARY.
//   B13: chap nhan X  vs  doi bao gia dang theo duoi sang Y - ca hai thu tu + kieu "ung dung (co hoi -> phien ban) vs SQL truc tiep (phien ban -> co hoi)":
//        ket qua chi co the la mot ben bi tu choi boi R-Q7 / R-Q8 hoac bi deadlock_detected; KHONG BAO GIO "da chap nhan X nhung dang theo duoi Y".
//   B15: them / sua / xoa dong chua commit  vs  gui chinh phien ban do - ca hai thu tu.
// In "PASS <ten>" / "FAIL <ten>"; thoat 1 neu co FAIL.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [url] = process.argv.slice(2);
if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/siscom_crm_test_\d{8}_\d{6}$/.test(url)) { console.log('TU CHOI: URL khong phai DB tam siscom_crm_test_* tren 127.0.0.1'); process.exit(2); }
const req = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'));
const { Client } = req('pg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const check = (name, ok, detail = '') => { R.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); };
const conn = async () => { const c = new Client({ connectionString: url }); await c.connect(); await c.query("SET lock_timeout = '20s'; SET statement_timeout = '30s'"); return c; };
// Chay cau lenh khong cho; { done, result, error } cap nhat khi xong (de biet cau lenh dang bi chan).
const start = (c, sql, params) => { const s = { done: false }; s.p = c.query(sql, params).then((r) => { s.done = true; s.result = r; }, (e) => { s.done = true; s.error = e; }); return s; };
const errOf = (s) => (s.error ? (s.error.constraint || s.error.code) : 'OK');
const pid = async (c) => (await c.query('SELECT pg_backend_pid() AS p')).rows[0].p;

const RUN = Date.now().toString(16).slice(-8).padStart(8, '0');          // moi lan chay mot day ID rieng (chay lai tren cung DB khong trung khoa)
let seq = 0;
const ID = () => `6b2${RUN.slice(3)}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const EMP = ID(), TIER = ID(), STATUS = ID(), TYPE = ID(), STAGE = ID(), K = ID();
const a = await conn(); const b = await conn(); const o = await conn();   // o: ket noi quan sat / dung du lieu
const one = async (sql, params) => (await o.query(sql, params)).rows[0];

let TPL;
const mkOpp = async () => { const id = ID(); await o.query(`INSERT INTO opportunity (id, customer_id, title, type_id, stage_id, owner_id, is_demo) VALUES ($1, $2, 'Q2C co hoi', $3, $4, $5, true)`, [id, K, TYPE, STAGE, EMP]); return id; };
const mkQuote = async (opp) => { const id = ID(); await o.query(`INSERT INTO quote (id, opportunity_id, customer_id, template_id, item_name, created_by) VALUES ($1, $2, $3, $4, 'Q2C hang muc', $5)`, [id, opp, K, TPL, EMP]); return id; };
const mkDraft = async (quote, no, price = 100) => {
  const id = ID();
  await o.query(`INSERT INTO quote_version (id, quote_id, version_no, code_snapshot, item_name, print_template, template_name, title, columns, vat_mode, quoter_name, created_by,
                   base10_vnd, subtotal_vnd, vat10_vnd, total_vnd)
                 VALUES ($1, $2, $3, 'BG-Q2C', 'Q2C', 'siscom-v1', 'Q2C', 'BANG BAO GIA', '[]', 'QUOTE', 'Q2C NV', $4, $5::bigint, $5::bigint, ($5::bigint * 10 + 50) / 100, $5::bigint + ($5::bigint * 10 + 50) / 100)`, [id, quote, no, EMP, price]);
  await o.query(`INSERT INTO quote_line (quote_version_id, line_no, description, unit, quantity, unit_price_vnd, vat_percent, amount_vnd) VALUES ($1, 1, 'Q2C dong', 'cai', 1, $2, 10, $2)`, [id, price]);
  return id;
};
const SEND = `UPDATE quote_version SET status = 'SENT', quote_date = current_date, valid_until = current_date + 15, sent_by = $2, sent_at = now() WHERE id = $1`;
const ACCEPT = `UPDATE quote_version SET status = 'ACCEPTED', decided_by = $2, decided_at = now() WHERE id = $1`;
const mkSent = async (quote, no, price) => { const id = await mkDraft(quote, no, price); await o.query(SEND, [id, EMP]); return id; };
const accepted = async (opp) => Number((await one(`SELECT count(*) AS n FROM quote_version v JOIN quote q ON q.id = v.quote_id WHERE q.opportunity_id = $1 AND v.status = 'ACCEPTED'`, [opp])).n);
// Bat bien (B16e + B13): khong co phien ban ACCEPTED lech co hoi / khong ACCEPTED ma co gia tri / >1 chap nhan tren mot co hoi / chap nhan tren bao gia khong theo duoi
const broken = async () => Number((await one(`SELECT
    (SELECT count(*) FROM quote_version v JOIN quote q ON q.id = v.quote_id WHERE (v.status = 'ACCEPTED' AND v.accepted_opportunity_id IS DISTINCT FROM q.opportunity_id) OR (v.status <> 'ACCEPTED' AND v.accepted_opportunity_id IS NOT NULL))
  + (SELECT count(*) FROM (SELECT 1 FROM quote_version v JOIN quote q ON q.id = v.quote_id WHERE v.status = 'ACCEPTED' GROUP BY q.opportunity_id HAVING count(*) > 1) x)
  + (SELECT count(*) FROM quote_version v JOIN quote q ON q.id = v.quote_id WHERE v.status = 'ACCEPTED' AND NOT q.is_primary)
  + (SELECT count(*) FROM (SELECT 1 FROM quote WHERE is_primary AND deleted_at IS NULL GROUP BY opportunity_id HAVING count(*) > 1) y) AS n`)).n);
// Ket noi p dang cho khoa dong cua bang rel? (khoa "tuple" cua bang do, lay truoc khi ngu cho transaction giu dong)
const waitsOn = async (p, rel) => Number((await one(`SELECT count(*) AS n FROM pg_locks WHERE pid = $1 AND locktype = 'tuple' AND relation = $2::regclass`, [p, 'public.' + rel])).n) > 0;
const LOSER = new Set(['QUOTE_ALREADY_ACCEPTED', 'QUOTE_NOT_PRIMARY', 'QUOTE_PRIMARY_FIXED', '23505', '40P01', 'uq_quote_version_accepted_opportunity', 'uq_quote_version_one_accepted']);
const finish = async (c, s) => { await s.p; await c.query(s.error ? 'ROLLBACK' : 'COMMIT'); };

try {
  await o.query(`INSERT INTO lookup_item (id, type, code, label_vi) VALUES ($1, 'customer_tier', $5, 'Q2C hang'), ($2, 'customer_status', $6, 'Q2C trang thai'), ($3, 'opportunity_type', $7, 'Q2C loai'), ($4, 'opportunity_stage', $8, 'Q2C giai doan')`,
    [TIER, STATUS, TYPE, STAGE, 'ZZ_Q2C_TIER_' + RUN.toUpperCase(), 'ZZ_Q2C_STATUS_' + RUN.toUpperCase(), 'ZZ_Q2C_TYPE_' + RUN.toUpperCase(), 'ZZ_Q2C_STAGE_' + RUN.toUpperCase()]);
  await o.query(`INSERT INTO employee (id, full_name, email, status, is_demo) VALUES ($1, 'Q2C NV', $2, 'ACTIVE', true)`, [EMP, `q2c.${RUN}@example.invalid`]);
  await o.query(`INSERT INTO customer (id, name, phone, tier_id, status_id, is_demo) VALUES ($1, 'Q2C Khach', $4, $2, $3, true)`, [K, TIER, STATUS, '09' + String(parseInt(RUN, 16) % 100000000).padStart(8, '0')]);
  TPL = (await one(`SELECT id FROM quote_template WHERE code = 'chung'`)).id;
  const pa = await pid(a), pb = await pid(b);

  // ── B12a: xen ke CO KIEM SOAT - A chap nhan v1 (chua commit), B chap nhan v2 cua cung bao gia dang theo duoi
  {
    const opp = await mkOpp(); const q = await mkQuote(opp); const v1 = await mkSent(q, 1, 100); const v2 = await mkSent(q, 2, 150);
    await o.query('UPDATE quote SET is_primary = true WHERE id = $1', [q]);
    await a.query('BEGIN'); await a.query(ACCEPT, [v1, EMP]);
    await b.query('BEGIN'); const sb = start(b, ACCEPT, [v2, EMP]);
    await sleep(700); const blocked = !sb.done; const onOpp = await waitsOn(pb, 'opportunity');
    await a.query('COMMIT'); await finish(b, sb);
    check('B12a chap nhan thu hai bi CHAN trong khi lan chap nhan dau chua commit', blocked);
    check('B12a diem cho la dong opportunity (pg_locks: khoa tuple cua bang opportunity)', onOpp);
    check('B12a sau khi ben dau commit: ben sau bi tu choi QUOTE_ALREADY_ACCEPTED', sb.error && sb.error.constraint === 'QUOTE_ALREADY_ACCEPTED', errOf(sb));
    check('B12a dung MOT phien ban duoc chap nhan tren co hoi', (await accepted(opp)) === 1);
  }
  // ── B12b: 50 lan chay DUA that su (hai lenh gui cung luc, autocommit) - xen ke hai kieu: (chan) hai phien ban cua bao gia dang theo duoi; (le) bao gia dang theo duoi vs bao gia khac
  {
    let exactlyOne = 0, bad = 0; const seen = new Map();
    for (let i = 0; i < 50; i++) {
      const opp = await mkOpp(); const q = await mkQuote(opp); const v1 = await mkSent(q, 1, 100);
      let v2;
      if (i % 2 === 0) v2 = await mkSent(q, 2, 150);
      else { const q2 = await mkQuote(opp); v2 = await mkSent(q2, 1, 150); }
      await o.query('UPDATE quote SET is_primary = true WHERE id = $1', [q]);
      const [s1, s2] = i % 4 < 2 ? [start(a, ACCEPT, [v1, EMP]), start(b, ACCEPT, [v2, EMP])] : [start(b, ACCEPT, [v2, EMP]), start(a, ACCEPT, [v1, EMP])];
      await Promise.all([s1.p, s2.p]);
      const n = await accepted(opp); if (n === 1) exactlyOne++; else bad++;
      for (const s of [s1, s2]) { const e = errOf(s); seen.set(e, (seen.get(e) || 0) + 1); if (e !== 'OK' && !LOSER.has(e)) bad++; }
    }
    check('B12b 50 lan chay dua: lan nao cung co DUNG MOT phien ban duoc chap nhan, ben thua chi nhan ma loi nghiep vu / trung chi muc / deadlock', exactlyOne === 50 && bad === 0, [...seen].map(([k, v]) => k + '=' + v).join(' '));
  }
  // ── B13a: A chap nhan X (chua commit); B tat dang theo duoi cua X
  {
    const opp = await mkOpp(); const x = await mkQuote(opp); const y = await mkQuote(opp); const xv = await mkSent(x, 1, 100); await mkSent(y, 1, 150);
    await o.query('UPDATE quote SET is_primary = true WHERE id = $1', [x]);
    await a.query('BEGIN'); await a.query(ACCEPT, [xv, EMP]);
    await b.query('BEGIN'); const sb = start(b, 'UPDATE quote SET is_primary = false WHERE id = $1', [x]);
    await sleep(700); const blocked = !sb.done; const onOpp = await waitsOn(pb, 'opportunity');
    await a.query('COMMIT'); await finish(b, sb);
    check('B13a doi bao gia dang theo duoi bi CHAN (tai dong opportunity) trong khi lan chap nhan chua commit', blocked && onOpp);
    check('B13a sau khi chap nhan commit: doi dang theo duoi bi tu choi QUOTE_PRIMARY_FIXED', sb.error && sb.error.constraint === 'QUOTE_PRIMARY_FIXED', errOf(sb));
    const st = await one('SELECT (SELECT is_primary FROM quote WHERE id = $1) AS xp, (SELECT is_primary FROM quote WHERE id = $2) AS yp', [x, y]);
    check('B13a ket qua: X duoc chap nhan va van dang theo duoi; Y khong', (await accepted(opp)) === 1 && st.xp === true && st.yp === false);
  }
  // ── B13b: B doi dang theo duoi X -> Y (chua commit); A chap nhan X
  {
    const opp = await mkOpp(); const x = await mkQuote(opp); const y = await mkQuote(opp); const xv = await mkSent(x, 1, 100); await mkSent(y, 1, 150);
    await o.query('UPDATE quote SET is_primary = true WHERE id = $1', [x]);
    await b.query('BEGIN'); await b.query('UPDATE quote SET is_primary = false WHERE id = $1', [x]); await b.query('UPDATE quote SET is_primary = true WHERE id = $1', [y]);
    await a.query('BEGIN'); const sa = start(a, ACCEPT, [xv, EMP]);
    await sleep(700); const blocked = !sa.done; const onOpp = await waitsOn(pa, 'opportunity');
    await b.query('COMMIT'); await finish(a, sa);
    check('B13b chap nhan bi CHAN (tai dong opportunity) trong khi viec doi dang theo duoi chua commit', blocked && onOpp);
    check('B13b sau khi doi dang theo duoi commit: chap nhan X bi tu choi QUOTE_NOT_PRIMARY', sa.error && sa.error.constraint === 'QUOTE_NOT_PRIMARY', errOf(sa));
    const st = await one('SELECT (SELECT is_primary FROM quote WHERE id = $1) AS xp, (SELECT is_primary FROM quote WHERE id = $2) AS yp', [x, y]);
    check('B13b ket qua: khong phien ban nao duoc chap nhan; Y dang theo duoi', (await accepted(opp)) === 0 && st.xp === false && st.yp === true);
  }
  // ── B13c: "ung dung" (khoa co hoi TRUOC, roi ghi phien ban) vs SQL truc tiep (ghi phien ban TRUOC, trigger moi khoa co hoi) tren CUNG mot phien ban => vong cho
  {
    const opp = await mkOpp(); const x = await mkQuote(opp); const xv = await mkSent(x, 1, 100);
    await o.query('UPDATE quote SET is_primary = true WHERE id = $1', [x]);
    await a.query('BEGIN'); await a.query('SELECT 1 FROM opportunity WHERE id = $1 FOR UPDATE', [opp]);          // A = duong ung dung
    await b.query('BEGIN'); const sb = start(b, ACCEPT, [xv, EMP]);                                             // B = SQL truc tiep: giu dong phien ban, cho co hoi
    await sleep(500); const bBlocked = !sb.done;
    const sa = start(a, ACCEPT, [xv, EMP]);                                                                     // A can dong phien ban B dang giu => vong cho
    await Promise.all([sa.p, sb.p]);
    await a.query(sa.error ? 'ROLLBACK' : 'COMMIT'); await b.query(sb.error ? 'ROLLBACK' : 'COMMIT');
    const codes = [errOf(sa), errOf(sb)];
    check('B13c SQL truc tiep bi chan boi khoa co hoi cua duong ung dung', bBlocked);
    check('B13c vong cho: PostgreSQL huy dung MOT ben (40P01 deadlock_detected), ben kia hoan tat', codes.filter((c) => c === '40P01').length === 1 && codes.filter((c) => c === 'OK').length === 1, codes.join(' / '));
    check('B13c ket qua: dung mot phien ban duoc chap nhan, khong trang thai ghi do', (await accepted(opp)) === 1);
  }
  // ── B13d: 30 lan chay dua: chap nhan X  vs  chuyen dang theo duoi sang Y (hai lenh trong mot transaction)
  {
    let bad = 0; const seen = new Map();
    for (let i = 0; i < 30; i++) {
      const opp = await mkOpp(); const x = await mkQuote(opp); const y = await mkQuote(opp); const xv = await mkSent(x, 1, 100); await mkSent(y, 1, 150);
      await o.query('UPDATE quote SET is_primary = true WHERE id = $1', [x]);
      const sw = (async () => { try { await b.query('BEGIN'); await b.query('UPDATE quote SET is_primary = false WHERE id = $1', [x]); await b.query('UPDATE quote SET is_primary = true WHERE id = $1', [y]); await b.query('COMMIT'); return 'OK'; } catch (e) { await b.query('ROLLBACK'); return e.constraint || e.code; } })();
      const sa = start(a, ACCEPT, [xv, EMP]);
      const [rs] = await Promise.all([sw, sa.p]); const ra = errOf(sa);
      const st = await one('SELECT (SELECT is_primary FROM quote WHERE id = $1) AS xp, (SELECT is_primary FROM quote WHERE id = $2) AS yp', [x, y]); const n = await accepted(opp);
      const key = ra + '|' + rs; seen.set(key, (seen.get(key) || 0) + 1);
      const okState = (n === 1 && st.xp && !st.yp && ra === 'OK' && rs !== 'OK') || (n === 0 && !st.xp && st.yp && rs === 'OK' && ra !== 'OK') || (n === 0 && st.xp && !st.yp && ra !== 'OK' && rs !== 'OK');
      if (!okState || (ra !== 'OK' && !LOSER.has(ra)) || (rs !== 'OK' && !LOSER.has(rs))) bad++;
    }
    check('B13d 30 lan chay dua chap nhan X vs doi sang Y: khong lan nao ra "da chap nhan X nhung dang theo duoi Y"', bad === 0, [...seen].map(([k, v]) => k + '=' + v).join(' '));
  }
  // ── B15a: A them dong (chua commit, khong sua tong); B gui chinh phien ban do
  {
    const opp = await mkOpp(); const q = await mkQuote(opp); const v = await mkDraft(q, 1, 100);
    await a.query('BEGIN'); await a.query(`INSERT INTO quote_line (quote_version_id, line_no, description, unit, quantity, unit_price_vnd, vat_percent, amount_vnd) VALUES ($1, 2, 'Q2C dong them', 'cai', 1, 50, 10, 50)`, [v]);
    await b.query('BEGIN'); const sb = start(b, SEND, [v, EMP]);
    await sleep(700); const blocked = !sb.done; const onVersion = await waitsOn(pb, 'quote_version');
    await a.query('COMMIT'); await finish(b, sb);
    check('B15a lenh gui bi CHAN (tai dong quote_version) trong khi viec them dong chua commit', blocked && onVersion);
    check('B15a sau khi them dong commit: lenh gui bi tu choi QUOTE_TOTAL_MISMATCH (tong khong con khop)', sb.error && sb.error.constraint === 'QUOTE_TOTAL_MISMATCH', errOf(sb));
    check('B15a phien ban van la nhap, co 2 dong', (await one(`SELECT status = 'DRAFT' AND (SELECT count(*) FROM quote_line WHERE quote_version_id = $1) = 2 AS ok FROM quote_version WHERE id = $1`, [v])).ok);
  }
  // ── B15b: A xoa dong duy nhat (chua commit); B gui => sau commit: QUOTE_EMPTY
  {
    const opp = await mkOpp(); const q = await mkQuote(opp); const v = await mkDraft(q, 1, 100);
    await a.query('BEGIN'); await a.query('DELETE FROM quote_line WHERE quote_version_id = $1', [v]);
    await b.query('BEGIN'); const sb = start(b, SEND, [v, EMP]);
    await sleep(700); const blocked = !sb.done;
    await a.query('COMMIT'); await finish(b, sb);
    check('B15b lenh gui bi CHAN trong khi viec xoa dong chua commit; sau do bi tu choi QUOTE_EMPTY', blocked && sb.error && sb.error.constraint === 'QUOTE_EMPTY', errOf(sb));
  }
  // ── B15c: B gui (chua commit); A them / sua / xoa dong => bi chan roi bi tu choi QUOTE_VERSION_LOCKED
  {
    const opp = await mkOpp(); const q = await mkQuote(opp); const v = await mkDraft(q, 1, 100);
    await b.query('BEGIN'); await b.query(SEND, [v, EMP]);
    const sa = start(a, `INSERT INTO quote_line (quote_version_id, line_no, description, unit, quantity, unit_price_vnd, vat_percent, amount_vnd) VALUES ($1, 2, 'Q2C dong muon', 'cai', 1, 50, 10, 50)`, [v]);
    await sleep(700); const blocked = !sa.done; const onVersion = await waitsOn(pa, 'quote_version');
    await b.query('COMMIT'); await sa.p;
    check('B15c viec them dong bi CHAN (tai dong quote_version) trong khi lenh gui chua commit', blocked && onVersion);
    check('B15c sau khi lenh gui commit: them dong bi tu choi QUOTE_VERSION_LOCKED', sa.error && sa.error.constraint === 'QUOTE_VERSION_LOCKED', errOf(sa));
    const su = start(a, 'UPDATE quote_line SET cost_price_vnd = 1 WHERE quote_version_id = $1', [v]); await su.p;
    const sd = start(a, 'DELETE FROM quote_line WHERE quote_version_id = $1', [v]); await sd.p;
    check('B15c sua / xoa dong cua phien ban vua gui bi tu choi QUOTE_VERSION_LOCKED', su.error && su.error.constraint === 'QUOTE_VERSION_LOCKED' && sd.error && sd.error.constraint === 'QUOTE_VERSION_LOCKED', errOf(su) + ' / ' + errOf(sd));
    check('B15c phien ban da gui giu nguyen 1 dong, tong 100', (await one(`SELECT status = 'SENT' AND subtotal_vnd = 100 AND (SELECT count(*) FROM quote_line WHERE quote_version_id = $1) = 1 AS ok FROM quote_version WHERE id = $1`, [v])).ok);
  }
  // ── Gui  vs  xoa mem bao gia (R-Q1 / R-Q9 cung lay diem khoa chung)
  {
    const opp = await mkOpp(); const q = await mkQuote(opp); const v = await mkDraft(q, 1, 100);
    await a.query('BEGIN'); await a.query(`UPDATE quote SET deleted_at = now(), deleted_by = $2, delete_reason = 'thu' WHERE id = $1`, [q, EMP]);
    await b.query('BEGIN'); const sb = start(b, SEND, [v, EMP]);
    await sleep(700); const blocked = !sb.done;
    await a.query('COMMIT'); await finish(b, sb);
    check('X1 gui bi CHAN trong khi xoa mem bao gia chua commit; sau do bi tu choi QUOTE_DELETED', blocked && sb.error && sb.error.constraint === 'QUOTE_DELETED', errOf(sb));
    const opp2 = await mkOpp(); const q2 = await mkQuote(opp2); const v2 = await mkDraft(q2, 1, 100);
    await b.query('BEGIN'); await b.query(SEND, [v2, EMP]);
    const sa = start(a, `UPDATE quote SET deleted_at = now(), deleted_by = $2, delete_reason = 'thu' WHERE id = $1`, [q2, EMP]);
    await sleep(700); const blocked2 = !sa.done;
    await b.query('COMMIT'); await sa.p;
    check('X2 xoa mem bi CHAN trong khi lenh gui chua commit; sau do bi tu choi QUOTE_DELETE_FORBIDDEN', blocked2 && sa.error && sa.error.constraint === 'QUOTE_DELETE_FORBIDDEN', errOf(sa));
  }
  check('B16e bat bien sau TOAN BO cac ca dong thoi: 0 dong vi pham', (await broken()) === 0);
} catch (e) {
  check('LOI NGOAI DU KIEN', false, (e.code || '') + ' ' + e.message);
} finally {
  for (const c of [a, b, o]) { try { await c.query('ROLLBACK'); } catch { /* bo qua */ } await c.end(); }
}
const fail = R.filter((x) => !x).length;
console.log(`TONG: ${R.length - fail} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
