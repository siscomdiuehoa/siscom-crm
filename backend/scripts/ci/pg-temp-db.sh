#!/usr/bin/env bash
# SISCOM CRM - tao DATABASE TAM cach ly cho CI (service container PostgreSQL trong job GitHub Actions).
# CHI dung trong CI: server la container tam, song trong job, huy khi job ket thuc. KHONG bao gio tro toi siscom_crm_dev
# hay bat ky may chu nao ngoai 127.0.0.1. Khong in mat khau. Khong doc .env.
#
# Dung: pg-temp-db.sh create | drop
#   create: tao role ung dung siscom_app (NOSUPERUSER) voi mat khau ngau nhien, tao DB siscom_crm_test_<YYYYMMDD_HHMMSS>
#           (OWNER siscom_app; extension pg_trgm/unaccent la "trusted" nen owner tu CREATE duoc), ghi TEST_DB_NAME va
#           TEST_DATABASE_URL (da mask) vao $GITHUB_ENV.
#   drop:   xoa DB tam va role (ve sinh; container cung bi huy sau job).
# Bien vao: PGHOST (mac dinh 127.0.0.1), PGPORT (5432), PGUSER (postgres - superuser CUA CONTAINER TAM), PGPASSWORD.
set -euo pipefail

cmd="${1:-}"
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"; PGUSER="${PGUSER:-postgres}"
export PGHOST PGPORT PGUSER

# Cong an toan: chi 127.0.0.1 (service container map ra loopback cua runner); tu choi moi host khac.
if [ "$PGHOST" != "127.0.0.1" ]; then echo "TU CHOI: PGHOST=$PGHOST (chi cho phep 127.0.0.1)"; exit 2; fi
if [ -z "${GITHUB_ACTIONS:-}" ]; then echo "TU CHOI: script nay chi chay trong GitHub Actions (GITHUB_ACTIONS khong dat)."; exit 2; fi

psql_su() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }

case "$cmd" in
  create)
    name="siscom_crm_test_$(date -u +%Y%m%d_%H%M%S)"
    # Khop dung TEST_DB_RE cua backend/test/helpers/test-db.ts; khong bao gio la siscom_crm_dev.
    if ! [[ "$name" =~ ^siscom_crm_test_[0-9]{8}_[0-9]{6}$ ]] || [ "$name" = "siscom_crm_dev" ]; then echo "TU CHOI: ten DB khong hop le: $name"; exit 2; fi
    pw="$(openssl rand -hex 24)"
    echo "::add-mask::$pw"
    url="postgresql://siscom_app:${pw}@127.0.0.1:${PGPORT}/${name}"
    echo "::add-mask::$url"
    ver="$(psql_su -tA -c 'SHOW server_version')"
    echo "PostgreSQL server (container tam): $ver"
    # Role ung dung: khong superuser, khong tao DB/role. Mat khau truyen qua bien psql (khong vao log).
    psql_su -v "pw=$pw" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_app') THEN
    EXECUTE format('CREATE ROLE siscom_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'pw');
  ELSE
    EXECUTE format('ALTER ROLE siscom_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'pw');
  END IF;
END $$;
SQL
    psql_su -c "CREATE DATABASE \"$name\" OWNER siscom_app ENCODING 'UTF8' TEMPLATE template0"
    # Xac nhan lai bang ket noi cua chinh siscom_app (khong superuser).
    PGPASSWORD="$pw" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U siscom_app -d "$name" -tA \
      -c "SELECT current_database() || ' ' || current_user || ' super=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text"
    {
      echo "TEST_DB_NAME=$name"
      echo "TEST_DATABASE_URL=$url"
    } >> "$GITHUB_ENV"
    echo "DB tam da tao: $name (owner siscom_app, khong superuser)."
    ;;
  drop)
    name="${TEST_DB_NAME:-}"
    if ! [[ "$name" =~ ^siscom_crm_test_[0-9]{8}_[0-9]{6}$ ]]; then echo "Bo qua drop: TEST_DB_NAME khong phai DB tam hop le ('$name')."; exit 0; fi
    psql_su -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" || true
    psql_su -c "DROP ROLE IF EXISTS siscom_app" || true
    echo "Da don DB tam $name."
    ;;
  *)
    echo "Dung: $0 create | drop"; exit 2 ;;
esac
