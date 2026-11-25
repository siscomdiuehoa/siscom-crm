#!/usr/bin/env bash
# SISCOM CRM - Bao gia Q2 (docs/QUOTES_DESIGN.md muc 11: B12, B13, B15, F1, F2, F7b): rollback / ap lai + kiem DONG THOI (hai ket noi) tren DB TAM RIENG.
# CHI dung trong CI (GITHUB_ACTIONS), superuser cua container tam (PGUSER/PGPASSWORD), 127.0.0.1. Tao DB siscom_crm_test_<stamp> MOI (khong phai
# TEST_DB_NAME cua job), migrate deploy, roi:
#   F1  rollback chay SACH khi 5 bang chi co dong nap san "chung";
#   F2  migrate deploy ap lai tu dau sau rollback (ma BG- bat dau lai tu dau, dong "chung" co lai);
#   P1  migration ap MOT PHAN (thieu quote_line + dong _prisma_migrations chua xong) => rollback van chay sach; ap lai;
#   B12 / B13 / B15: quotes-q2-concurrency.mjs (hai ket noi that, SQL truc tiep);
#   F7b rollback TU CHOI khi da co bao gia da gui - khong go gi, khong mat dong nao.
# DB tam bi DROP khi ket thuc (ke ca loi). Khong in mat khau.
set -euo pipefail
[ -n "${GITHUB_ACTIONS:-}" ] || { echo "TU CHOI: chi chay trong GitHub Actions."; exit 2; }
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"; PGUSER="${PGUSER:-postgres}"; export PGHOST PGPORT PGUSER
[ "$PGHOST" = "127.0.0.1" ] || { echo "TU CHOI: PGHOST=$PGHOST (chi 127.0.0.1)"; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; backend="$here/../.."; docs="$backend/docs"
name="siscom_crm_test_$(date -u +%Y%m%d_%H%M%S)"
[[ "$name" =~ ^siscom_crm_test_[0-9]{8}_[0-9]{6}$ ]] && [ "$name" != "${TEST_DB_NAME:-}" ] || { echo "TU CHOI: ten DB tam $name khong hop le / trung DB cua job."; exit 2; }
# Chu so huu DB tam: role RIENG, khong superuser (prisma.config tu choi tai khoan postgres), mat khau ngau nhien; xoa khi ket thuc.
owner=siscom_q2c_owner
pw="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"; echo "::add-mask::$pw"
url="postgresql://${owner}:${pw}@127.0.0.1:${PGPORT}/${name}"; echo "::add-mask::$url"
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" >/dev/null 2>&1 || true
  psql -X -q -d postgres -c "REVOKE SET ON PARAMETER app.actor_employee_id, app.priv_request_id FROM $owner" -c "DROP ROLE IF EXISTS $owner" >/dev/null 2>&1 || true
}
trap cleanup EXIT
psql -X -q -v ON_ERROR_STOP=1 -d postgres -v pw="$pw" <<SQL
SELECT format('CREATE ROLE $owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'pw') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$owner') \gexec
CREATE DATABASE "$name" OWNER $owner ENCODING 'UTF8' TEMPLATE template0;
GRANT SET ON PARAMETER app.actor_employee_id, app.priv_request_id TO $owner;
SQL
deploy() { ( cd "$backend" && DATABASE_URL="$url" MIGRATE_DATABASE_URL= npx prisma migrate deploy >/dev/null ); }
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -d "$url" -c "$1"; }
rollback() { psql -X -q -v ON_ERROR_STOP=1 -d "$url" -f "$docs/QUOTES_Q2_ROLLBACK.sql.txt"; }
applied="to_regclass('public.quote_line') IS NOT NULL AND (SELECT count(*) = 1 FROM public.quote_template WHERE code = 'chung') AND public.fn_auth_perm_class('quote.read') = 'BIZ' AND public.fn_next_quote_code() = 'BG-0001'"
deploy
echo "DB tam dong thoi Q2: $name (da migrate)"

# F1: rollback sach khi chi co dong nap san
rollback >/dev/null && [ "$(q "SELECT to_regclass('public.quote') IS NULL AND public.fn_auth_perm_class('quote.read') = 'OTHER' AND public.fn_auth_perm_class('opportunity.read') = 'BIZ'")" = t ] \
  && echo "PASS F1 rollback chay sach khi 5 bang chi co dong nap san; fn_auth_perm_class ve ban Sales S5" || { echo "FAIL F1 rollback khi bang rong"; exit 1; }
# F2: ap lai tu dau
deploy && [ "$(q "SELECT $applied")" = t ] && echo "PASS F2 migrate deploy ap lai tu dau sau rollback (ma BG-0001, dong 'chung', quote.* = BIZ)" || { echo "FAIL F2 ap lai sau rollback"; exit 1; }
# P1: ap mot phan (gia lap migration that bai giua chung: chua co quote_line, chua thay fn_auth_perm_class, dong _prisma_migrations chua xong)
psql -X -q -v ON_ERROR_STOP=1 -d "$url" -c "DROP TABLE quote_line; DROP FUNCTION fn_quote_line_guard(); UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = '20261125000000_quotes'"
rollback >/dev/null && echo "PASS P1 rollback khi migration ap MOT PHAN (thieu quote_line, dong _prisma_migrations chua xong) chay sach" || { echo "FAIL P1 rollback khi migration ap mot phan"; exit 1; }
deploy && [ "$(q "SELECT $applied")" = t ] && echo "PASS P2 migrate deploy ap lai sau rollback mot phan" || { echo "FAIL P2 ap lai sau rollback mot phan"; exit 1; }

# B12 / B13 / B15
node "$here/quotes-q2-concurrency.mjs" "$url"

# F7b: da co bao gia da gui / da chap nhan => rollback TU CHOI, khong mat dong nao
before="$(q "SELECT (SELECT count(*) FROM quote) || '/' || (SELECT count(*) FROM quote_version) || '/' || (SELECT count(*) FROM quote_line)")"
out="$(rollback 2>&1)" && { echo "FAIL F7b rollback phai TU CHOI khi da co bao gia"; exit 1; }
echo "$out" | grep -Eq 'TU CHOI: con [0-9]+ dong quote ' || { echo "$out" | tail -5; echo "FAIL F7b khong thay thong bao TU CHOI"; exit 1; }
after="$(q "SELECT (SELECT count(*) FROM quote) || '/' || (SELECT count(*) FROM quote_version) || '/' || (SELECT count(*) FROM quote_line)")"
[ "$before" = "$after" ] && [ "$(q "SELECT $(echo "$applied" | sed "s/ AND public.fn_next_quote_code() = 'BG-0001'//")")" = t ] \
  && echo "PASS F7b rollback tu choi khi da co bao gia da gui; so dong quote/quote_version/quote_line giu nguyen ($after), cau truc con nguyen" || { echo "FAIL F7b du lieu / cau truc thay doi sau khi rollback tu choi ($before -> $after)"; exit 1; }
echo "DAT: Bao gia Q2 - rollback / ap lai / ap mot phan / dong thoi hai ket noi"
