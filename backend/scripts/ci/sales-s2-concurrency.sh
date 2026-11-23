#!/usr/bin/env bash
# SISCOM CRM - Sales S2 (PR237-R1-01, PR237-R1-02): kiem DONG THOI (hai ket noi) + rollback khi migration AP MOT PHAN, tren DB TAM RIENG.
# CHI dung trong CI (GITHUB_ACTIONS), superuser cua container tam (PGUSER/PGPASSWORD), 127.0.0.1. Tao DB siscom_crm_test_<stamp> MOI (khong phai
# TEST_DB_NAME cua job), migrate deploy, chay sales-s2-concurrency.mjs (C1/C2 lien he cung khach, R1/R2 rollback khoa truoc khi kiem), roi:
#   P1 ap mot phan: co bang S2 nhung thieu cot activity.opportunity_id + dong _prisma_migrations chua xong => rollback van chay sach;
#   P2 migrate deploy ap lai tu dau sau rollback.
# DB tam bi DROP khi ket thuc (ke ca loi). Khong in mat khau.
set -euo pipefail
[ -n "${GITHUB_ACTIONS:-}" ] || { echo "TU CHOI: chi chay trong GitHub Actions."; exit 2; }
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"; PGUSER="${PGUSER:-postgres}"; export PGHOST PGPORT PGUSER
[ "$PGHOST" = "127.0.0.1" ] || { echo "TU CHOI: PGHOST=$PGHOST (chi 127.0.0.1)"; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; backend="$here/../.."; docs="$backend/docs"
name="siscom_crm_test_$(date -u +%Y%m%d_%H%M%S)"
[[ "$name" =~ ^siscom_crm_test_[0-9]{8}_[0-9]{6}$ ]] && [ "$name" != "${TEST_DB_NAME:-}" ] || { echo "TU CHOI: ten DB tam $name khong hop le / trung DB cua job."; exit 2; }
# Chu so huu DB tam: role RIENG, khong superuser (prisma.config tu choi tai khoan postgres), mat khau ngau nhien; xoa khi ket thuc.
owner=siscom_s2c_owner
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
( cd "$backend" && DATABASE_URL="$url" MIGRATE_DATABASE_URL= npx prisma migrate deploy >/dev/null )
echo "DB tam dong thoi: $name (da migrate)"
# Sales S9b: bang opportunity_document tro toi opportunity => theo dung thu tu lui (docs/SALES_DESIGN.md §9), go S9b TRUOC khi dien tap rollback S2.
# Sales T-07 (moi nhat): cot sinh tu dong nam tren opportunity => go T-07 truoc S9b (SALES_S2_ROLLBACK tu choi khi T-07 con).
# Bang rong (DB vua migrate) => rollback T-07, S9b chay sach; migrate deploy sau do ap lai T-07, S9b cung S2.
s9_rollback() {
  psql -X -q -v ON_ERROR_STOP=1 -d "$name" -f "$docs/SALES_T07_SEARCH_FOLD_ROLLBACK.sql.txt" >/dev/null || { echo "FAIL rollback Sales T-07 truoc khi dien tap rollback S2"; exit 1; }
  psql -X -q -v ON_ERROR_STOP=1 -d "$name" -f "$docs/SALES_S9_DOCUMENT_ROLLBACK.sql.txt" >/dev/null || { echo "FAIL rollback Sales S9b truoc khi dien tap rollback S2"; exit 1; }
}
# Truoc do: rollback S2 PHAI tu choi ro rang khi S9b chua go (khong mat gi, khong loi phu thuoc kho hieu).
out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$name" -f "$docs/SALES_S2_ROLLBACK.sql.txt" 2>&1)" && { echo "FAIL S0 rollback S2 phai TU CHOI khi con bang opportunity_document"; exit 1; }
echo "$out" | grep -q 'TU CHOI: con bang opportunity_document' && echo "PASS S0 rollback S2 tu choi khi chua go Sales S9b (dung thu tu lui)" || { echo "$out" | tail -5; echo "FAIL S0 khong thay thong bao TU CHOI"; exit 1; }
s9_rollback

node "$here/sales-s2-concurrency.mjs" "$url" "$(command -v psql)" "$docs/SALES_S2_ROLLBACK.sql.txt"

# P1: ap mot phan (gia lap migration that bai giua chung: da tao bang, chua them cot activity.opportunity_id; dong _prisma_migrations chua xong)
( cd "$backend" && DATABASE_URL="$url" MIGRATE_DATABASE_URL= npx prisma migrate deploy >/dev/null )
s9_rollback
psql -X -q -v ON_ERROR_STOP=1 -d "$name" -c "ALTER TABLE activity DROP COLUMN opportunity_id CASCADE; UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = '20261117000000_sales_opportunity'"
psql -X -q -v ON_ERROR_STOP=1 -d "$name" -f "$docs/SALES_S2_ROLLBACK.sql.txt" >/dev/null && echo "PASS P1 rollback khi migration ap MOT PHAN (thieu cot activity.opportunity_id, dong _prisma_migrations chua xong) chay sach" \
  || { echo "FAIL P1 rollback khi migration ap mot phan"; exit 1; }
# P2: ap lai tu dau sau rollback
( cd "$backend" && DATABASE_URL="$url" MIGRATE_DATABASE_URL= npx prisma migrate deploy >/dev/null ) && \
  [ "$(psql -X -q -tA -d "$name" -c "SELECT to_regclass('public.opportunity') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity' AND column_name = 'opportunity_id')")" = t ] \
  && echo "PASS P2 migrate deploy ap lai tu dau sau rollback" || { echo "FAIL P2 ap lai sau rollback"; exit 1; }
echo "DAT: kiem dong thoi + ap mot phan Sales S2"
