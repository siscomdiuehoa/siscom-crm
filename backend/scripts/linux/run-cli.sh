#!/usr/bin/env bash
# SISCOM CRM - chay CLI van hanh cua backend (seed-lookups | bootstrap-auth) tren VPS voi dung env cua DB hien hanh.
# Chay bang root. Nap backend.env (DATABASE_URL, AUTH_DATABASE_URL...) + migrate.env (MIGRATE_DATABASE_URL, siscom_migrator) vao moi truong
# CUA TIEN TRINH CON (khong in, khong ghi file). Chi cho 2 lenh co ten co dinh; tu choi neu DB khong phai staging/prod.
# Dung: run-cli.sh seed-lookups
#       run-cli.sh bootstrap-auth      (can BOOTSTRAP_PASSWORD_SYSADMIN/_ADMIN/_SALE/_TECHNICIAN/_ACCOUNTANT trong moi truong,
#                                       Owner go tren may chu: `read -rs BOOTSTRAP_PASSWORD_SYSADMIN; export BOOTSTRAP_PASSWORD_SYSADMIN` ...
#                                       trong shell root; KHONG ghi vao file, khong qua chat. Tuy chon BOOTSTRAP_EMAIL_DOMAIN.)
# Luu y: CLI account-admin (FV5) hien bi khoa cung vao PostgreSQL thu cong 55470 => KHONG chay duoc tren VPS (xem docs/VPS_RUNBOOK.md muc "Gioi han da biet").
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

cli="${1:-}"
case "$cli" in seed-lookups|bootstrap-auth) ;; *) die "Dung: run-cli.sh <seed-lookups|bootstrap-auth>" ;; esac
[ "${SISCOM_REHEARSAL:-}" = 1 ] || require_root
require_cmd node

backend_env="$SISCOM_ETC/backend.env"; migrate_env="$SISCOM_ETC/migrate.env"
assert_private_file "$backend_env"; assert_private_file "$migrate_env"
appurl="$(env_get "$backend_env" DATABASE_URL)"; db="$(url_dbname "$appurl")"
require_ops_db "$db"
murl="$(env_get "$migrate_env" MIGRATE_DATABASE_URL)"
[ "$(url_dbname "$murl")" = "$db" ] || die "backend.env va migrate.env tro DB khac nhau."

dir="$SISCOM_OPT/current/backend"
[ -f "$dir/dist/cli/$cli.js" ] || die "Thieu $dir/dist/cli/$cli.js (da deploy chua?)."

echo "Chay $cli tren DB $db (tai khoan $ROLE_MIGRATOR)."
cd "$dir"
# export (khong dung `env VAR=...`) de bi mat khong xuat hien trong tham so tien trinh.
export NODE_ENV=production HOST=127.0.0.1 PORT=3000 TRUST_PROXY=loopback COOKIE_SECURE=true
export DATABASE_URL="$appurl" MIGRATE_DATABASE_URL="$murl" SEED_LOOKUPS_ALLOW_DB="$db"
AUTH_DATABASE_URL="$(env_get "$backend_env" AUTH_DATABASE_URL)"; export AUTH_DATABASE_URL
CORS_ORIGINS="$(env_get "$backend_env" CORS_ORIGINS)"; export CORS_ORIGINS
AUTH_ALLOWED_ORIGINS="$(env_get "$backend_env" AUTH_ALLOWED_ORIGINS)"; export AUTH_ALLOWED_ORIGINS
exec node "dist/cli/$cli.js"
