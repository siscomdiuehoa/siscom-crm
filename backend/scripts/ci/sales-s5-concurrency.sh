#!/usr/bin/env bash
# SISCOM CRM - Sales S5 (PR240-R1-01, PR240-R1-02): kiem DONG THOI (hai ket noi) cho migration phan loai quyen 20261118000000, rollback cua no
# va script cap / go quyen 2 nguoi, tren DB TAM RIENG.
# CHI dung trong CI (GITHUB_ACTIONS), superuser cua container tam (PGUSER/PGPASSWORD), 127.0.0.1. Tao DB siscom_crm_test_<stamp> MOI (khong phai
# TEST_DB_NAME cua job), migrate deploy (RBAC rong, bootstrap mo), chay sales-s5-concurrency.mjs:
#   M1/M2 migration doi dau cap opportunity.* cho admin; R1/R2/R3 rollback doi dau chen ma / script ADD; X1/X2/X3 REMOVE doi dau cap quyen ngoai
#   ma tran / doi scope. Moi ca chay ca hai thu tu den truoc - den sau.
# DB tam bi DROP khi ket thuc (ke ca loi). Khong in mat khau.
set -euo pipefail
[ -n "${GITHUB_ACTIONS:-}" ] || { echo "TU CHOI: chi chay trong GitHub Actions."; exit 2; }
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"; PGUSER="${PGUSER:-postgres}"; export PGHOST PGPORT PGUSER
[ "$PGHOST" = "127.0.0.1" ] || { echo "TU CHOI: PGHOST=$PGHOST (chi 127.0.0.1)"; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; backend="$here/../.."; docs="$backend/docs"
name="siscom_crm_test_$(date -u +%Y%m%d_%H%M%S)"
[[ "$name" =~ ^siscom_crm_test_[0-9]{8}_[0-9]{6}$ ]] && [ "$name" != "${TEST_DB_NAME:-}" ] || { echo "TU CHOI: ten DB tam $name khong hop le / trung DB cua job."; exit 2; }
# Chu so huu DB tam: role RIENG, khong superuser (prisma.config tu choi tai khoan postgres), mat khau ngau nhien; xoa khi ket thuc.
owner=siscom_s5c_owner
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
echo "DB tam dong thoi S5: $name (da migrate)"

node "$here/sales-s5-concurrency.mjs" "$url" "$(command -v psql)" \
  "$backend/prisma/migrations/20261118000000_sales_perm_class/migration.sql" \
  "$docs/SALES_S5_PERM_CLASS_ROLLBACK.sql.txt" \
  "$docs/SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt" \
  "$docs/SALES_S5_OPPORTUNITY_PERMISSIONS_REMOVE.sql.txt"
echo "DAT: kiem dong thoi Sales S5 (migration / rollback / ADD / REMOVE)"
