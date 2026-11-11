#!/usr/bin/env bash
# SISCOM CRM - tao DB van hanh MOI + 3 role + tach role S1 (B1.4 P3/P3c/B3 A3). Chay bang root (sudo) TREN VPS.
# CHI nhan ten DB co dinh: siscom_crm_staging | siscom_crm_prod. Moi ten khac (siscom_crm_dev, baseline, DB la...) bi TU CHOI.
# Mat khau KHONG qua tham so dong lenh va khong in ra: sinh ngau nhien tren may chu, luu $SISCOM_ETC/db-roles.env (root, 600).
#
# Dung: create-db.sh <db> <lenh> [tuy chon]
#   create   Tao 3 role (neu chua co), DB moi (OWNER siscom_migrator, UTF8, template0), chay B1.3_S1_ROLE_SPLIT + B1.3_S1_AUTH_ROLE.
#            Tu choi neu DB da ton tai. (Chua co bang: quyen chi cap duoc SAU migrate => lenh grants.)
#   env      Ghi $SISCOM_ETC/backend.env (DATABASE_URL=siscom_app, AUTH_DATABASE_URL=siscom_auth, CORS..., 600) va
#            $SISCOM_ETC/migrate.env (MIGRATE_DATABASE_URL=siscom_migrator, 600, KHONG nam trong env cua dich vu). Can SISCOM_DOMAIN.
#            Tu choi ghi de file da co tro DB KHAC (dung --force-env de thay, sau khi dung dich vu).
#   grants   SAU `prisma migrate deploy`: chay B1.3_S1_APP_GRANTS_V4 (siscom_migrator, 2 lan - idempotent), roi
#            B1.3_S1_VERIFY (siscom_app, phai PASS|n, khong FAIL) va B1.3_S1_VERIFY_AUTH (superuser). Thieu PASS => thoat 1.
#   drop     Xoa DB (de lam lai khi CHUA co du lieu that). Can: --yes-drop <db>; prod con can SISCOM_ALLOW_DROP_PROD=<db>.
#            Tu choi neu backend.env dang tro DB nay va dich vu dang chay. KHONG xoa role.
# Chua tung chay tren VPS that. Dien tap tren PostgreSQL tam: SISCOM_REHEARSAL=1 (xem lib.sh va docs/VPS_RUNBOOK.md).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
docs="$(cd "$here/../../docs" && pwd)"

db="${1:-}"; cmd="${2:-}"
[ -n "$db" ] && [ -n "$cmd" ] || die "Dung: create-db.sh <siscom_crm_staging|siscom_crm_prod> <create|env|grants|drop> [...]"
shift 2
require_ops_db "$db"
require_cmd psql openssl
[ "${SISCOM_REHEARSAL:-}" = 1 ] || require_root

roles_env="$SISCOM_ETC/db-roles.env"
backend_env="$SISCOM_ETC/backend.env"
migrate_env="$SISCOM_ETC/migrate.env"

role_exists() { [ "$(psql_su -d postgres -tA -c "SELECT 1 FROM pg_roles WHERE rolname = '$1'")" = 1 ]; }
db_exists()   { [ "$(psql_su -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" = 1 ]; }

load_role_passwords() { # dat PW_APP PW_MIGRATOR PW_AUTH tu db-roles.env (khong source)
  assert_private_file "$roles_env"
  PW_APP="$(env_get "$roles_env" SISCOM_APP_PW)" && PW_MIGRATOR="$(env_get "$roles_env" SISCOM_MIGRATOR_PW)" && PW_AUTH="$(env_get "$roles_env" SISCOM_AUTH_PW)" \
    || die "$roles_env thieu SISCOM_APP_PW/SISCOM_MIGRATOR_PW/SISCOM_AUTH_PW."
  local p; for p in "$PW_APP" "$PW_MIGRATOR" "$PW_AUTH"; do [[ "$p" =~ ^[0-9a-f]{48}$ ]] || die "Mat khau trong $roles_env sai dinh dang (mong doi 48 ky tu hex do script sinh)."; done
}

# Tao/giu role: chi tao moi khi chua co; da co thi KHONG doi mat khau (khop cach cua cac file SQL S1). Mat khau di qua STDIN.
ensure_role() { # ensure_role <role> <mat khau>
  [[ "$2" != *"'"* ]] || die "mat khau khong hop le."
  psql_su -d postgres <<SQL
\\set r '$1'
\\set pw '$2'
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'r')
  THEN format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', :'r')
  ELSE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'r', :'pw')
END \\gexec
SQL
}

case "$cmd" in
  create)
    db_exists "$db" && die "TU CHOI: database $db DA TON TAI (script chi tao DB moi)."
    kind="$(db_kind "$db")"
    # Mat khau role: dung chung cho staging va prod (role cap cluster). Lan dau sinh moi; da co role ma mat file => dung lai, khong doan.
    if [ -f "$roles_env" ]; then
      load_role_passwords
    else
      for r in "$ROLE_APP" "$ROLE_MIGRATOR" "$ROLE_AUTH"; do
        role_exists "$r" && die "Role $r da ton tai nhung khong co $roles_env: khong the biet mat khau. Xu ly thu cong (dat lai mat khau + tao file) roi chay lai."
      done
      PW_APP="$(openssl rand -hex 24)"; PW_MIGRATOR="$(openssl rand -hex 24)"; PW_AUTH="$(openssl rand -hex 24)"
      private_dir "$SISCOM_ETC"
      ( umask 077
        printf 'SISCOM_APP_PW=%s\nSISCOM_MIGRATOR_PW=%s\nSISCOM_AUTH_PW=%s\n' "$PW_APP" "$PW_MIGRATOR" "$PW_AUTH" > "$roles_env.new"
        mv -f "$roles_env.new" "$roles_env" )
      chmod 600 "$roles_env"
      info "Da sinh mat khau 3 role -> $roles_env (600). KHONG in ra man hinh."
    fi
    ensure_role "$ROLE_APP" "$PW_APP"
    ensure_role "$ROLE_MIGRATOR" "$PW_MIGRATOR"
    ensure_role "$ROLE_AUTH" "$PW_AUTH"
    # DB moi: chu so huu la migrator ngay tu dau (ROLE_SPLIT van chay de dat REVOKE/GRANT va GRANT SET ON PARAMETER dung quy cach).
    psql_su -d postgres -c "CREATE DATABASE \"$db\" OWNER $ROLE_MIGRATOR ENCODING 'UTF8' TEMPLATE template0"
    info "Da tao database $db ($kind), chu so huu $ROLE_MIGRATOR."
    run_sql_file_su "$db" "$docs/B1.3_S1_ROLE_SPLIT.sql.txt" "target_db=$db"
    run_sql_file_su "$db" "$docs/B1.3_S1_AUTH_ROLE.sql.txt" "target_db=$db"
    chk="$(psql_su -d postgres -tA -c "SELECT pg_get_userbyid(datdba) || '|' || has_database_privilege('$ROLE_APP','$db','CONNECT') || '|' || has_database_privilege('$ROLE_AUTH','$db','CONNECT') || '|' || has_database_privilege('$ROLE_APP','$db','CREATE') || '|' || (SELECT string_agg(has_database_privilege('public','$db',p)::text, ',') FROM unnest(ARRAY['CONNECT','TEMP','CREATE']) p) FROM pg_database WHERE datname = '$db'")"
    [ "$chk" = "$ROLE_MIGRATOR|true|true|false|false,false,false" ] || die "Kiem sau tach role KHONG DAT: '$chk'"
    info "Tach role xong: owner=$ROLE_MIGRATOR, app+auth CONNECT, PUBLIC khong co quyen. Tiep: ghi env (lenh env), migrate, roi lenh grants."
    ;;

  env)
    db_exists "$db" || die "Database $db chua ton tai (chay create truoc)."
    force=0; [ "${1:-}" = "--force-env" ] && force=1
    domain="${SISCOM_DOMAIN:-}"
    [[ "$domain" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "Can SISCOM_DOMAIN hop le (vd crm.example.vn)."
    load_role_passwords
    for f in "$backend_env" "$migrate_env"; do
      if [ -e "$f" ] && [ "$force" = 0 ]; then
        cur="$(env_get "$f" DATABASE_URL 2>/dev/null || env_get "$f" MIGRATE_DATABASE_URL 2>/dev/null || true)"
        [ "$(url_dbname "$cur")" = "$db" ] || die "TU CHOI: $f da ton tai va tro DB khac ('$(url_dbname "$cur")'). Dung dich vu roi chay lai voi --force-env."
      fi
    done
    base="127.0.0.1:${SISCOM_PG_PORT}/${db}"
    ( umask 077
      cat > "$backend_env.new" <<EOF
# Sinh boi create-db.sh $(date -u +%Y-%m-%dT%H:%M:%SZ). root:root 600. NODE_ENV/HOST/PORT/TRUST_PROXY/COOKIE_SECURE dat co dinh trong unit systemd.
DATABASE_URL=postgresql://${ROLE_APP}:${PW_APP}@${base}
AUTH_DATABASE_URL=postgresql://${ROLE_AUTH}:${PW_AUTH}@${base}
CORS_ORIGINS=https://${domain}
AUTH_ALLOWED_ORIGINS=https://${domain}
LOG_LEVEL=log
SESSION_IDLE_MINUTES=480
SESSION_ABS_HOURS=12
LOGIN_WINDOW_MINUTES=15
LOGIN_MAX_PER_SOURCE=30
LOGIN_MAX_PER_IDENTIFIER=5
LOGIN_LOCK_AFTER_FAILURES=5
LOGIN_LOCK_MINUTES=15
EOF
      cat > "$migrate_env.new" <<EOF
# Sinh boi create-db.sh. root:root 600. CHI deploy.sh/backup-db.sh/run-cli.sh doc; KHONG dua vao env cua dich vu.
MIGRATE_DATABASE_URL=postgresql://${ROLE_MIGRATOR}:${PW_MIGRATOR}@${base}
EOF
      chmod 600 "$backend_env.new" "$migrate_env.new"
      mv -f "$backend_env.new" "$backend_env"; mv -f "$migrate_env.new" "$migrate_env" )
    info "Da ghi $backend_env va $migrate_env (600) tro DB $db, domain $domain."
    ;;

  grants)
    db_exists "$db" || die "Database $db chua ton tai."
    assert_private_file "$migrate_env"
    murl="$(env_get "$migrate_env" MIGRATE_DATABASE_URL)"
    [ "$(url_dbname "$murl")" = "$db" ] || die "migrate.env tro DB '$(url_dbname "$murl")' khong phai $db."
    load_role_passwords
    [ "$(psql_su -d "$db" -tA -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" = t ] || die "Chua migrate ($db khong co _prisma_migrations). Chay prisma migrate deploy truoc."
    export PGCONNECT_TIMEOUT=10
    # Ket noi bang tai khoan that qua TCP loopback; mat khau qua PGPASSWORD trong tien trinh con, khong qua tham so.
    mig_psql() { PGPASSWORD="$PW_MIGRATOR" psql -X -q -w -v ON_ERROR_STOP=1 -h "$SISCOM_PG_HOST" -p "$SISCOM_PG_PORT" -U "$ROLE_MIGRATOR" -d "$db" "$@"; }
    app_psql() { PGPASSWORD="$PW_APP" psql -X -q -w -v ON_ERROR_STOP=1 -tA -h "$SISCOM_PG_HOST" -p "$SISCOM_PG_PORT" -U "$ROLE_APP" -d "$db" "$@"; }
    for i in 1 2; do
      echo "--- APP_GRANTS_V4 (siscom_migrator) lan $i ---"
      mig_psql -v "target_db=$db" -f "$docs/B1.3_S1_APP_GRANTS_V4.sql.txt"
    done
    # Cac file VERIFY chi cho phep DB thu (regex siscom_crm_(restore|test)_...). Tren DB van hanh ta doi DUNG dong regex thanh ten DB nay
    # (khong tat guard): neu dong regex khong con dung 1 lan trong file => dung (an toan khi file SQL doi sau nay).
    verify_one() { # verify_one <file> <app|su>
      local f="$1" who="$2" tmp out
      local re="'^siscom_crm_(restore|test)_[0-9]{8}_[0-9]{6}\$'"
      [ "$(grep -cF -- "$re" "$f")" -eq 1 ] || die "$(basename "$f"): khong tim dung 1 dong regex guard DB thu; khong chay duoc tren $db (kiem file SQL)."
      tmp="$(mktemp)"; trap 'rm -f "$tmp"' RETURN
      awk -v new="'^${db}\$'" -v old="$re" '{ i = index($0, old); if (i) { $0 = substr($0, 1, i - 1) new substr($0, i + length(old)) } print }' "$f" > "$tmp"
      grep -qF -- "'^${db}\$'" "$tmp" || die "Khong thay the duoc guard trong $(basename "$f")."
      echo "--- $(basename "$f") (as=$who) ---"
      if [ "$who" = app ]; then out="$(app_psql -f "$tmp")" || { echo "$out" | tail -20; die "VERIFY ($who) loi."; }
      else out="$(psql_su -d "$db" -tA -f - < "$tmp")" || { echo "$out" | tail -20; die "VERIFY ($who) loi."; }; fi
      echo "$out" | tail -n 40
      echo "$out" | grep -Eq '^FAIL\|[0-9]+$' && die "$(basename "$f"): co dong FAIL."
      echo "$out" | grep -Eq '^PASS\|[0-9]+$' || die "$(basename "$f"): khong thay dong PASS|n."
      info "$(basename "$f"): $(echo "$out" | grep -E '^PASS\|[0-9]+$' | tail -n1)"
    }
    verify_one "$docs/B1.3_S1_VERIFY.sql.txt" app
    verify_one "$docs/B1.3_S1_VERIFY_AUTH.sql.txt" su
    info "GRANTS + VERIFY DAT tren $db."
    ;;

  drop)
    db_exists "$db" || die "Database $db khong ton tai."
    [ "${1:-}" = "--yes-drop" ] && [ "${2:-}" = "$db" ] || die "Can them: --yes-drop $db"
    if [ "$(db_kind "$db")" = prod ] && [ "${SISCOM_ALLOW_DROP_PROD:-}" != "$db" ]; then die "TU CHOI xoa prod: can SISCOM_ALLOW_DROP_PROD=$db (chi khi CHUA co du lieu that va Owner da dong y)."; fi
    if [ -f "$backend_env" ] && [ "$(url_dbname "$(env_get "$backend_env" DATABASE_URL 2>/dev/null || true)")" = "$db" ] && systemctl is-active --quiet siscom-crm-backend 2>/dev/null; then
      die "TU CHOI: dich vu siscom-crm-backend dang chay tren $db. systemctl stop siscom-crm-backend truoc."
    fi
    psql_su -d postgres -c "DROP DATABASE \"$db\" WITH (FORCE)"
    info "Da xoa database $db (role giu nguyen)."
    ;;

  *) die "Lenh la: $cmd (create|env|grants|drop)" ;;
esac
