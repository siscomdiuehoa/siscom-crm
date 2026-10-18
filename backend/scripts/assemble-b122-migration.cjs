// SISCOM CRM B1.2.2 — ghep migration = PHAN A + diff Prisma (delta) + PHAN B. CHI DOC/GHI FILE, KHONG ket noi database.
// Dich: D:\SISCOM-CRM\backend\scripts\assemble-b122-migration.cjs (file moi)
// Dung:  node scripts\assemble-b122-migration.cjs --diff <b122_delta.sql> --out <migration.sql> [--fail-test <file>] [--allow-migrations-dir]
// Mac dinh TU CHOI ghi vao prisma\migrations (chi cho phep khi co --allow-migrations-dir, dung o buoc migration that sau dien tap).
const fs = require('fs');
const path = require('path');
const a = process.argv.slice(2);
const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const diffPath = get('--diff'), out = get('--out'), failOut = get('--fail-test');
if (!diffPath || !out) { console.error('Cach dung: node scripts\\assemble-b122-migration.cjs --diff <b122_delta.sql> --out <migration.sql> [--fail-test <file>] [--allow-migrations-dir]'); process.exit(2); }
const root = path.resolve(__dirname, '..');
const migDir = path.join(root, 'prisma', 'migrations') + path.sep;
for (const p of [out, failOut].filter(Boolean)) {
  if (path.resolve(p).toLowerCase().startsWith(migDir.toLowerCase()) && !a.includes('--allow-migrations-dir')) {
    console.error('[TU CHOI] ' + p + ' nam trong prisma\\migrations. Them --allow-migrations-dir CHI KHI da dien tap thanh cong va duoc duyet.'); process.exit(3);
  }
}
const readText = (p) => { const b = fs.readFileSync(p); return (b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le') : b.toString('utf8')).replace(/^\uFEFF/, ''); };
const hand = readText(path.join(root, 'docs', 'B1.2.1_HAND_SQL.sql'));
const part = (n) => {
  const m = hand.match(new RegExp('-- >>> PART ' + n + ' BEGIN[^\\n]*\\n([\\s\\S]*?)-- <<< PART ' + n + ' END'));
  if (!m) throw new Error('Thieu PART ' + n + ' trong B1.2.1_HAND_SQL.sql');
  return m[1].trim();
};
const diff = readText(diffPath);
const scan = diff.replace(/ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION)/g, '').replace(/ON UPDATE (RESTRICT|CASCADE|SET NULL|NO ACTION)/g, '');
const bad = [];
for (const [re, why] of [[/\bDROP\b/i, 'DROP'], [/\bDELETE\b/i, 'DELETE'], [/\bTRUNCATE\b/i, 'TRUNCATE'], [/(^|\n)\s*(UPDATE|INSERT)\b/i, 'UPDATE/INSERT'], [/app_meta/i, 'app_meta'], [/ALTER\s+TABLE\s+"(?!(lookup_item|department|employee|role|permission|role_permission|employee_role|customer|contact|activity|customer_assignment|audit_log)")/i, 'ALTER bang la']]) {
  if (re.test(scan)) bad.push(why);
}
const tables = (diff.match(/CREATE TABLE "/g) || []).length;
if (bad.length) { console.error('[TU CHOI] diff chua lenh khong mong doi: ' + bad.join(', ') + '. Kiem tra lai diff (phai la delta tu DB that, chi CREATE).'); process.exit(4); }
if (tables !== 12) { console.error('[TU CHOI] Ky vong 12 CREATE TABLE, thay ' + tables + '.'); process.exit(5); }
if (!/fn_next_customer_code\(\)/.test(diff)) { console.error('[TU CHOI] diff khong chua DEFAULT fn_next_customer_code() — schema.prisma khong dung ban B1.2.1.'); process.exit(6); }
const body = '-- SISCOM CRM B1.2 crm_core (ghep tu dong boi assemble-b122-migration.cjs)\n-- Thu tu: A (extension/sequence/ham) -> Prisma diff (bang/FK/index) -> B (CHECK/partial unique/trigger/tim kiem)\n\n-- ===== PART A =====\n' + part('A') + '\n\n-- ===== PRISMA DIFF =====\n' + diff.trim() + '\n\n-- ===== PART B =====\n' + part('B') + '\n';
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, body, 'utf8');
console.log('[OK] Da ghi ' + out + ' (' + Buffer.byteLength(body) + ' byte; 12 bang; khong co DROP/DELETE/TRUNCATE/UPDATE/INSERT/app_meta trong diff).');
if (failOut) {
  fs.mkdirSync(path.dirname(path.resolve(failOut)), { recursive: true });
  fs.writeFileSync(failOut, body + '\n-- CO Y GAY LOI de thu tinh nguyen tu (chi dung tren DB nhap)\nSELECT 1/0;\n', 'utf8');
  console.log('[OK] Da ghi ban co y loi: ' + failOut);
}
