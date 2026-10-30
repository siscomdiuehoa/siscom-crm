#!/usr/bin/env bash
# SISCOM CRM - tao DATABASE TAM cach ly cho CI (service container PostgreSQL trong job GitHub Actions).
# CHI dung trong CI: server la container tam, song trong job, huy khi job ket thuc. KHONG bao gio tro toi siscom_crm_dev
# hay bat ky may chu nao ngoai 127.0.0.1. Khong in mat khau. Khong doc .env.
#
# Dung: pg-temp-db.sh create | split | unsplit | drop
#   create:  tao role ung dung siscom_app (NOSUPERUSER) va role chu so huu siscom_migrator (NOSUPERUSER, B1.4 P3) voi mat khau ngau nhien,
#            tao DB siscom_crm_test_<YYYYMMDD_HHMMSS> OWNER siscom_app (MO HINH CU B1.1 - de tai hien S1 truoc khi tach), ghi TEST_DB_NAME,
#            TEST_DATABASE_URL (app) va TEST_MIGRATE_DATABASE_URL (migrator), ca hai da mask, vao $GITHUB_ENV.
#   split:   TACH ROLE S1 tren DB tam: docs/B1.3_S1_ROLE_SPLIT.sql.txt (superuser cua container) roi docs/B1.3_S1_APP_GRANTS.sql.txt (migrator).
#   unsplit: ROLLBACK S1: docs/B1.3_S1_ROLE_SPLIT_ROLLBACK.sql.txt (superuser) => siscom_app lai la chu so huu (de dien tap rollback M1.x).
#   drop:    xoa DB tam va 2 role (ve sinh; container cung bi huy sau job).
# Bien vao: PGHOST (mac dinh 127.0.0.1), PGPORT (5432), PGUSER (postgres - superuser CUA CONTAINER TAM), PGPASSWORD.
set -euo pipefail

cmd="${1:-}"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"; PGUSER="${PGUSER:-postgres}"
export PGHOST PGPORT PGUSER
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docs="$here/../../docs"

# Cong an toan: chi 127.0.0.1 (service container map ra loopback cua runner); tu choi moi host khac.
if [ "$PGHOST" != "127.0.0.1" ]; then echo "TU CHOI: PGHOST=$PGHOST (chi cho phep 127.0.0.1)"; exit 2; fi
if [ -z "${GITHUB_ACTIONS:-}" ]; then echo "TU CHOI: script nay chi chay trong GitHub Actions (GITHUB_ACTIONS khong dat)."; exit 2; fi

psql_su() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
valid_name() { [[ "$1" =~ ^siscom_crm_test_[0-9]{8}_[0-9]{6}$ ]] && [ "$1" != "siscom_crm_dev" ]; }
# Role khong superuser, khong tao DB/role. Mat khau truyen qua bien psql (khong vao log).
# Luu y: psql KHONG thay the :'pw' ben trong khoi $$...$$, nen dung SELECT ... \gexec thay vi DO.
ensure_role() { # ensure_role <ten role> <mat khau>
  psql_su -v "r=$1" -v "pw=$2" <<'SQL'
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'r')
  THEN format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'r', :'pw')
  ELSE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'r', :'pw')
END \gexec
SQL
}

case "$cmd" in
  create)
    name="siscom_crm_test_$(date -u +%Y%m%d_%H%M%S)"
    # Khop dung TEST_DB_RE cua backend/test/helpers/test-db.ts; khong bao gio la siscom_crm_dev.
    if ! valid_name "$name"; then echo "TU CHOI: ten DB khong hop le: $name"; exit 2; fi
    pw="$(openssl rand -hex 24)"; mpw="$(openssl rand -hex 24)"
    echo "::add-mask::$pw"; echo "::add-mask::$mpw"
    url="postgresql://siscom_app:${pw}@127.0.0.1:${PGPORT}/${name}"
    murl="postgresql://siscom_migrator:${mpw}@127.0.0.1:${PGPORT}/${name}"
    echo "::add-mask::$url"; echo "::add-mask::$murl"
    ver="$(psql_su -tA -c 'SHOW server_version')"
    echo "PostgreSQL server (container tam): $ver"
    ensure_role siscom_app "$pw"
    ensure_role siscom_migrator "$mpw"
    # MO HINH CU (B1.1): DB thuoc siscom_app => extension "trusted" owner tu CREATE duoc khi migrate. Buoc "split" chuyen sang migrator.
    psql_su -c "CREATE DATABASE \"$name\" OWNER siscom_app ENCODING 'UTF8' TEMPLATE template0"
    # PostgreSQL >= 15: role thuong CHI duoc dung GUC tuy bien (app.*) trong "CREATE FUNCTION ... SET app.x = ..." (M1.2) khi co
    # GRANT SET ON PARAMETER (pg_parameter_acl). Day cung la DIEU KIEN TRIEN KHAI tren DB that (B1.3_S1_ROLE_SPLIT cap cho ca hai role).
    psql_su -c "GRANT SET ON PARAMETER app.actor_employee_id TO siscom_app" -c "GRANT SET ON PARAMETER app.priv_request_id TO siscom_app"
    # Xac nhan lai bang ket noi cua chinh siscom_app (khong superuser).
    PGPASSWORD="$pw" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U siscom_app -d "$name" -tA \
      -c "SELECT current_database() || ' ' || current_user || ' super=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text"
    {
      echo "TEST_DB_NAME=$name"
      echo "TEST_DATABASE_URL=$url"
      echo "TEST_MIGRATE_DATABASE_URL=$murl"
    } >> "$GITHUB_ENV"
    echo "DB tam da tao: $name (owner siscom_app - mo hinh cu; role siscom_migrator san sang cho buoc split)."
    ;;
  split)
    name="${TEST_DB_NAME:-}"; valid_name "$name" || { echo "TU CHOI: TEST_DB_NAME khong phai DB tam hop le."; exit 2; }
    [ -n "${TEST_MIGRATE_DATABASE_URL:-}" ] || { echo "THIEU TEST_MIGRATE_DATABASE_URL."; exit 2; }
    echo "--- S1 ROLE_SPLIT (superuser container) tren $name ---"
    psql -X -q -v ON_ERROR_STOP=1 -d "$name" -f "$docs/B1.3_S1_ROLE_SPLIT.sql.txt"
    echo "--- S1 APP_GRANTS (siscom_migrator) tren $name ---"
    psql -X -q -w -v ON_ERROR_STOP=1 -d "$TEST_MIGRATE_DATABASE_URL" -f "$docs/B1.3_S1_APP_GRANTS.sql.txt"
    ;;
  unsplit)
    name="${TEST_DB_NAME:-}"; valid_name "$name" || { echo "TU CHOI: TEST_DB_NAME khong phai DB tam hop le."; exit 2; }
    echo "--- S1 ROLLBACK (superuser container) tren $name ---"
    psql -X -q -v ON_ERROR_STOP=1 -d "$name" -f "$docs/B1.3_S1_ROLE_SPLIT_ROLLBACK.sql.txt"
    ;;
  drop)
    name="${TEST_DB_NAME:-}"
    if ! valid_name "$name"; then echo "Bo qua drop: TEST_DB_NAME khong phai DB tam hop le ('$name')."; exit 0; fi
    psql_su -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" || true
    psql_su -c "DROP OWNED BY siscom_migrator" -c "DROP ROLE IF EXISTS siscom_migrator" || true
    psql_su -c "DROP OWNED BY siscom_app" -c "DROP ROLE IF EXISTS siscom_app" || true
    echo "Da don DB tam $name."
    ;;
  *)
    echo "Dung: $0 create | split | unsplit | drop"; exit 2 ;;
esac
