#!/usr/bin/env bash
# SISCOM CRM - tao DATABASE TAM cach ly cho CI (service container PostgreSQL trong job GitHub Actions).
# CHI dung trong CI: server la container tam, song trong job, huy khi job ket thuc. KHONG bao gio tro toi siscom_crm_dev
# hay bat ky may chu nao ngoai 127.0.0.1. Khong in mat khau. Khong doc .env.
#
# Dung: pg-temp-db.sh create | split | grants v1|v2|v3 | unsplit | drop
#   (B1.4 P3c) create sinh TEST_AUTH_DATABASE_URL + TEST_AUTH_PW (role siscom_auth do AUTH_ROLE.sql tao o split - dien tap nhanh CREATE ROLE);
#   split = ROLE_SPLIT -> AUTH_ROLE -> APP_GRANTS_V4 x2; auth = AUTH_ROLE + V4 (tach lai sau rollback); unauth = AUTH_ROLE_ROLLBACK
#   voi DB canary3 cung cluster cap CONNECT cho siscom_auth (phai GIU CONNECT/SET/role), roi khong canary => role bi DROP.
#   create:  tao role ung dung siscom_app (NOSUPERUSER) va role chu so huu siscom_migrator (NOSUPERUSER, B1.4 P3) voi mat khau ngau nhien,
#            tao DB siscom_crm_test_<YYYYMMDD_HHMMSS> OWNER siscom_app (MO HINH CU B1.1 - de tai hien S1 truoc khi tach), ghi TEST_DB_NAME,
#            TEST_DATABASE_URL (app) va TEST_MIGRATE_DATABASE_URL (migrator), ca hai da mask, vao $GITHUB_ENV.
#   split:   TACH ROLE S1 tren DB tam: docs/B1.3_S1_ROLE_SPLIT.sql.txt (superuser cua container), AUTH_ROLE, roi APP_GRANTS_V4 (B3 A3) (migrator, P3c).
#   grants v1|v2: dien tap rollback quyen P3b (V1 = B1.3_S1_APP_GRANTS.sql.txt, chi de rollback; V2 = toi thieu) + tu kiem bieu thuc
#            "quyen rong kieu V1" cua src/prisma/db-role-check.ts bang chinh role app (v1 => true, v2 => false; sai => thoat 1).
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
valid_canary() { [[ "$1" =~ ^siscom_crm_canary_[0-9]{8}_[0-9]{6}$ ]]; }
# C1 (ra soat P3): REASSIGN OWNED doi ca doi tuong DUNG CHUNG toan cluster (database/tablespace). Mo phong may Windows cua owner: mot DB KHAC
# cung cluster do siscom_app so huu (nhu siscom_crm_dev / baseline). Sau split va sau unsplit, DB canary phai GIU NGUYEN chu so huu siscom_app
# va siscom_app van CONNECT duoc. Sai => thoat 1 (bai tai hien C1).
assert_canary() { # assert_canary <nhan buoc>
  local c="${CANARY_DB_NAME:-}"; valid_canary "$c" || { echo "THIEU/sai CANARY_DB_NAME."; exit 2; }
  local owner conn
  owner="$(psql_su -tA -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$c'")"
  conn="$(psql_su -tA -c "SELECT has_database_privilege('siscom_app', '$c', 'CONNECT')")"
  echo "canary [$1]: $c owner=$owner app_connect=$conn"
  if [ "$owner" != "siscom_app" ] || [ "$conn" != "t" ]; then
    echo "KHONG DAT (C1): DB canary cung cluster bi doi chu so huu / mat CONNECT khi tach role tren DB khac. Script S1 KHONG duoc dung ngoai CI."
    exit 1
  fi
}
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
    pw="$(openssl rand -hex 24)"; mpw="$(openssl rand -hex 24)"; apw="$(openssl rand -hex 24)"
    echo "::add-mask::$pw"; echo "::add-mask::$mpw"; echo "::add-mask::$apw"
    url="postgresql://siscom_app:${pw}@127.0.0.1:${PGPORT}/${name}"
    murl="postgresql://siscom_migrator:${mpw}@127.0.0.1:${PGPORT}/${name}"
    aurl="postgresql://siscom_auth:${apw}@127.0.0.1:${PGPORT}/${name}"
    echo "::add-mask::$url"; echo "::add-mask::$murl"; echo "::add-mask::$aurl"
    ver="$(psql_su -tA -c 'SHOW server_version')"
    echo "PostgreSQL server (container tam): $ver"
    ensure_role siscom_app "$pw"
    ensure_role siscom_migrator "$mpw"
    # MO HINH CU (B1.1): DB thuoc siscom_app => extension "trusted" owner tu CREATE duoc khi migrate. Buoc "split" chuyen sang migrator.
    psql_su -c "CREATE DATABASE \"$name\" OWNER siscom_app ENCODING 'UTF8' TEMPLATE template0"
    # DB canary (C1): mo phong DB khac cung cluster do siscom_app so huu, PUBLIC khong CONNECT (nhu setup-db/create-test-db tren Windows).
    canary="siscom_crm_canary_$(date -u +%Y%m%d_%H%M%S)"; valid_canary "$canary" || { echo "TU CHOI: ten canary khong hop le."; exit 2; }
    psql_su -c "CREATE DATABASE \"$canary\" OWNER siscom_app ENCODING 'UTF8' TEMPLATE template0" \
            -c "REVOKE ALL ON DATABASE \"$canary\" FROM PUBLIC" -c "GRANT CONNECT ON DATABASE \"$canary\" TO siscom_app"
    echo "CANARY_DB_NAME=$canary" >> "$GITHUB_ENV"; export CANARY_DB_NAME="$canary"
    assert_canary "sau create"
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
      echo "TEST_AUTH_DATABASE_URL=$aurl"
      echo "TEST_AUTH_PW=$apw"
    } >> "$GITHUB_ENV"
    echo "DB tam da tao: $name (owner siscom_app - mo hinh cu; role siscom_migrator san sang cho buoc split)."
    ;;
  split)
    name="${TEST_DB_NAME:-}"; valid_name "$name" || { echo "TU CHOI: TEST_DB_NAME khong phai DB tam hop le."; exit 2; }
    [ -n "${TEST_MIGRATE_DATABASE_URL:-}" ] || { echo "THIEU TEST_MIGRATE_DATABASE_URL."; exit 2; }
    assert_canary "truoc split"
    echo "--- S1 ROLE_SPLIT (superuser container) tren $name ---"
    psql -X -q -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$name" -f "$docs/B1.3_S1_ROLE_SPLIT.sql.txt"
    assert_canary "sau ROLE_SPLIT"
    # B1.4 P3c: role xac thuc (CREATE ROLE neu chua co voi TEST_AUTH_PW, CONNECT + SET ON PARAMETER).
    echo "--- P3c AUTH_ROLE (superuser container) tren $name ---"
    psql -X -q -v ON_ERROR_STOP=1 -v "target_db=$name" -v "auth_pw=${TEST_AUTH_PW:-}" -d "$name" -f "$docs/B1.3_S1_AUTH_ROLE.sql.txt"
    # Quyen TOI THIEU cho CA HAI role (V4 - B3 A3). V1/V2/V3 chi la duong rollback (CI dien tap o "grants v1|v2|v3").
    echo "--- S1 APP_GRANTS_V4 (siscom_migrator) tren $name ---"
    psql -X -q -w -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$TEST_MIGRATE_DATABASE_URL" -f "$docs/B1.3_S1_APP_GRANTS_V4.sql.txt"
    # I3: file khai bao => chay LAN 2 phai cho cung ket qua (VERIFY sau do van PASS).
    echo "--- S1 APP_GRANTS_V4 lan 2 (idempotent) ---"
    psql -X -q -w -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$TEST_MIGRATE_DATABASE_URL" -f "$docs/B1.3_S1_APP_GRANTS_V4.sql.txt"
    assert_canary "sau APP_GRANTS_V4"
    ;;
  grants)
    # B1.4 P3b (QA Minor 11): dien tap rollback quyen app: "grants v1" (B1.3_S1_APP_GRANTS.sql.txt - duong rollback P3b) | "grants v2" | "grants v3" (duong rollback B3 A3) | "grants v4" (hien hanh).
    name="${TEST_DB_NAME:-}"; valid_name "$name" || { echo "TU CHOI: TEST_DB_NAME khong phai DB tam hop le."; exit 2; }
    [ -n "${TEST_MIGRATE_DATABASE_URL:-}" ] || { echo "THIEU TEST_MIGRATE_DATABASE_URL."; exit 2; }
    case "${2:-}" in v1) f="B1.3_S1_APP_GRANTS.sql.txt" ;; v2) f="B1.3_S1_APP_GRANTS_V2.sql.txt" ;; v3) f="B1.3_S1_APP_GRANTS_V3.sql.txt" ;; v4) f="B1.3_S1_APP_GRANTS_V4.sql.txt" ;; *) echo "Dung: $0 grants v1|v2|v3|v4"; exit 2 ;; esac
    echo "--- $f (siscom_migrator) tren $name ---"
    psql -X -q -w -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$TEST_MIGRATE_DATABASE_URL" -f "$docs/$f"
    assert_canary "sau $f"
    # QA N4: nhanh TRUE cua bieu thuc "quyen rong kieu V1" (db-role-check.ts) phai duoc chay tren DB that: V1 => t, V2 => f.
    want=f; [ "$2" = v1 ] && want=t
    got="$(psql -X -q -w -v ON_ERROR_STOP=1 -tA -d "$TEST_DATABASE_URL" -c "SELECT has_any_column_privilege(current_user, 'public.employee_role', 'INSERT')
      OR has_column_privilege(current_user, 'public.employee_credential', 'password_hash', 'UPDATE')
      OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef
                 AND p.proname <> 'fn_auth_api_change_own_password' AND has_function_privilege(current_user, p.oid, 'EXECUTE'))")"
    echo "quyen rong kieu V1 (bang siscom_app) sau $2: $got (mong doi $want)"
    [ "$got" = "$want" ] || { echo "KHONG DAT: bieu thuc db-role-check khong khop trang thai quyen $2."; exit 1; }
    # P3c: bieu thuc "quyen xac thuc" (has_auth_grants cua db-role-check.ts): app sau v3/v4 => f, sau v1/v2 => t; auth sau v3/v4 => t.
    authexpr="has_any_column_privilege(current_user, 'public.auth_session', 'SELECT') OR has_any_column_privilege(current_user, 'public.auth_session', 'INSERT') OR has_any_column_privilege(current_user, 'public.auth_session', 'UPDATE') OR has_table_privilege(current_user, 'public.auth_session', 'DELETE') OR has_column_privilege(current_user, 'public.employee_credential', 'password_hash', 'SELECT') OR has_any_column_privilege(current_user, 'public.employee_credential', 'INSERT') OR has_any_column_privilege(current_user, 'public.employee_credential', 'UPDATE') OR has_table_privilege(current_user, 'public.employee_credential', 'DELETE') OR (CASE WHEN to_regclass('public.remember_device') IS NULL THEN false ELSE has_any_column_privilege(current_user, 'public.remember_device', 'SELECT') OR has_any_column_privilege(current_user, 'public.remember_device', 'INSERT') OR has_any_column_privilege(current_user, 'public.remember_device', 'UPDATE') OR has_table_privilege(current_user, 'public.remember_device', 'DELETE') END) OR has_function_privilege(current_user, 'public.fn_auth_api_change_own_password(uuid, integer, text, text, jsonb)', 'EXECUTE')"
    wantapp=t; { [ "$2" = v3 ] || [ "$2" = v4 ]; } && wantapp=f
    gotapp="$(psql -X -q -w -v ON_ERROR_STOP=1 -tA -d "$TEST_DATABASE_URL" -c "SELECT $authexpr")"
    echo "quyen xac thuc cua siscom_app sau $2: $gotapp (mong doi $wantapp)"
    [ "$gotapp" = "$wantapp" ] || { echo "KHONG DAT: has_auth_grants (app) khong khop trang thai $2."; exit 1; }
    if [ "$2" = v3 ] || [ "$2" = v4 ]; then
      gotauth="$(psql -X -q -w -v ON_ERROR_STOP=1 -tA -d "$TEST_AUTH_DATABASE_URL" -c "SELECT $authexpr")"
      echo "quyen xac thuc cua siscom_auth sau $2: $gotauth (mong doi t)"
      [ "$gotauth" = t ] || { echo "KHONG DAT: siscom_auth khong co quyen xac thuc sau $2."; exit 1; }
      # B3 A3: v4 cap ghi activity cho app; v3 (rollback) thu lai => VERIFY B1 phai FAIL o v3 (CI kiem rieng), o day chi kiem quyen activity.
      wantact=f; [ "$2" = v4 ] && wantact=t
      gotact="$(psql -X -q -w -v ON_ERROR_STOP=1 -tA -d "$TEST_DATABASE_URL" -c "SELECT has_table_privilege(current_user, 'public.activity', 'INSERT') AND has_table_privilege(current_user, 'public.activity', 'UPDATE') AND NOT has_table_privilege(current_user, 'public.activity', 'DELETE')")"
      echo "quyen ghi activity (khong DELETE) cua siscom_app sau $2: $gotact (mong doi $wantact)"
      [ "$gotact" = "$wantact" ] || { echo "KHONG DAT: quyen activity cua app khong khop $2."; exit 1; }
    fi
    ;;
  auth)
    # P3c: tach lai pool auth sau rollback (AUTH_ROLE tao lai role voi TEST_AUTH_PW, V4 cap quyen - B3 A3).
    name="${TEST_DB_NAME:-}"; valid_name "$name" || { echo "TU CHOI: TEST_DB_NAME khong phai DB tam hop le."; exit 2; }
    psql -X -q -v ON_ERROR_STOP=1 -v "target_db=$name" -v "auth_pw=${TEST_AUTH_PW:-}" -d "$name" -f "$docs/B1.3_S1_AUTH_ROLE.sql.txt"
    psql -X -q -w -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$TEST_MIGRATE_DATABASE_URL" -f "$docs/B1.3_S1_APP_GRANTS_V4.sql.txt"
    assert_canary "sau auth (AUTH_ROLE + V4)"
    ;;
  unauth)
    # P3c QA I-1: AUTH_ROLE_ROLLBACK khong duoc dung toi DB khac cung cluster. canary3 = DB khac cap CONNECT rieng cho siscom_auth:
    # sau rollback tren DB tam, canary3 phai GIU CONNECT, role + SET ON PARAMETER phai con. Sau do xoa canary3 va rollback lan 2 => role bi DROP.
    name="${TEST_DB_NAME:-}"; valid_name "$name" || { echo "TU CHOI: TEST_DB_NAME khong phai DB tam hop le."; exit 2; }
    canary3="siscom_crm_canary3_$(date -u +%Y%m%d_%H%M%S)"; [[ "$canary3" =~ ^siscom_crm_canary3_[0-9]{8}_[0-9]{6}$ ]] || { echo "TU CHOI: ten canary3."; exit 2; }
    psql_su -c "CREATE DATABASE \"$canary3\" OWNER siscom_migrator ENCODING 'UTF8' TEMPLATE template0" -c "REVOKE ALL ON DATABASE \"$canary3\" FROM PUBLIC" -c "GRANT CONNECT ON DATABASE \"$canary3\" TO siscom_auth"
    echo "--- P3c AUTH_ROLE_ROLLBACK (superuser) tren $name, canary3=$canary3 ---"
    psql -X -q -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$name" -f "$docs/B1.3_S1_AUTH_ROLE_ROLLBACK.sql.txt"
    c3="$(psql_su -tA -c "SELECT has_database_privilege('siscom_auth', '$canary3', 'CONNECT')")"; st="$(psql_su -tA -c "SELECT has_parameter_privilege('siscom_auth', 'app.actor_employee_id', 'SET')")"; ex="$(psql_su -tA -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='siscom_auth')")"
    echo "canary3 [sau rollback]: connect=$c3 set_param=$st role_ton_tai=$ex (mong doi t t t)"
    psql_su -c "DROP DATABASE IF EXISTS \"$canary3\" WITH (FORCE)" || true
    if [ "$c3" != t ] || [ "$st" != t ] || [ "$ex" != t ]; then echo "KHONG DAT (I-1): rollback role auth cham DB khac cung cluster."; exit 1; fi
    # QA lan 4 (C): phu thuoc ma phep kiem pg_shdepend bo qua (SET tren tham so KHAC app.actor/app.priv) => DROP ROLE that bai TRONG transaction
    # => psql thoat khac 0, role van con, SET ON PARAMETER app.actor_employee_id van con (khong nua chung).
    psql_su -c "GRANT SET ON PARAMETER app.qa4_extra TO siscom_auth"
    echo "--- (C) AUTH_ROLE_ROLLBACK voi phu thuoc bi bo qua => phai that bai ma KHONG nua chung ---"
    rc=0; psql -X -q -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$name" -f "$docs/B1.3_S1_AUTH_ROLE_ROLLBACK.sql.txt" > /tmp/qa4c.out 2>&1 || rc=$?
    tail -3 /tmp/qa4c.out
    stc="$(psql_su -tA -c "SELECT has_parameter_privilege('siscom_auth', 'app.actor_employee_id', 'SET')")"; exc="$(psql_su -tA -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='siscom_auth')")"
    echo "(C) [sau rollback that bai]: exit=$rc set_param=$stc role_ton_tai=$exc (mong doi khac 0, t, t)"
    if [ "$rc" = 0 ] || ! grep -q 'cannot be dropped' /tmp/qa4c.out || [ "$stc" != t ] || [ "$exc" != t ]; then echo "KHONG DAT (C): rollback that bai nhung de trang thai nua chung hoac khong that bai."; exit 1; fi
    psql_su -c "REVOKE SET ON PARAMETER app.qa4_extra FROM siscom_auth"
    echo "--- AUTH_ROLE_ROLLBACK lan 2 (khong con DB khac) => role bi DROP ---"
    psql -X -q -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$name" -f "$docs/B1.3_S1_AUTH_ROLE_ROLLBACK.sql.txt" | tail -2
    ex2="$(psql_su -tA -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='siscom_auth')")"; [ "$ex2" = f ] || { echo "KHONG DAT: role siscom_auth van con sau rollback lan 2."; exit 1; }
    assert_canary "sau unauth"
    ;;
  unsplit)
    name="${TEST_DB_NAME:-}"; valid_name "$name" || { echo "TU CHOI: TEST_DB_NAME khong phai DB tam hop le."; exit 2; }
    # Canary 2 (C1 nhanh ROLLBACK): mot DB KHAC da tach role hop le (owner siscom_migrator) tren cung cluster => sau rollback DB dich,
    # canary2 phai van thuoc migrator va migrator van giu quyen SET app.* (nhanh "giu quyen" cua ROLLBACK). Don ngay sau khi kiem.
    canary2="siscom_crm_canary2_$(date -u +%Y%m%d_%H%M%S)"; [[ "$canary2" =~ ^siscom_crm_canary2_[0-9]{8}_[0-9]{6}$ ]] || { echo "TU CHOI: ten canary2."; exit 2; }
    psql_su -c "CREATE DATABASE \"$canary2\" OWNER siscom_migrator ENCODING 'UTF8' TEMPLATE template0"
    echo "--- S1 ROLLBACK (superuser container) tren $name ---"
    psql -X -q -v ON_ERROR_STOP=1 -v "target_db=$name" -d "$name" -f "$docs/B1.3_S1_ROLE_SPLIT_ROLLBACK.sql.txt"
    assert_canary "sau ROLLBACK"
    c2owner="$(psql_su -tA -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$canary2'")"
    c2set="$(psql_su -tA -c "SELECT has_parameter_privilege('siscom_migrator', 'app.actor_employee_id', 'SET')")"
    echo "canary2 [sau ROLLBACK]: $canary2 owner=$c2owner migrator_set_param=$c2set"
    psql_su -c "DROP DATABASE IF EXISTS \"$canary2\" WITH (FORCE)" || true
    if [ "$c2owner" != "siscom_migrator" ] || [ "$c2set" != "t" ]; then
      echo "KHONG DAT (C1 rollback): DB khac thuoc migrator bi doi chu so huu hoac migrator mat quyen SET app.*."
      exit 1
    fi
    ;;
  drop)
    name="${TEST_DB_NAME:-}"
    if ! valid_name "$name"; then echo "Bo qua drop: TEST_DB_NAME khong phai DB tam hop le ('$name')."; exit 0; fi
    psql_su -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" || true
    if valid_canary "${CANARY_DB_NAME:-}"; then psql_su -c "DROP DATABASE IF EXISTS \"$CANARY_DB_NAME\" WITH (FORCE)" || true; fi
    psql_su -c "DROP OWNED BY siscom_auth" -c "DROP ROLE IF EXISTS siscom_auth" || true
    psql_su -c "DROP OWNED BY siscom_migrator" -c "DROP ROLE IF EXISTS siscom_migrator" || true
    psql_su -c "DROP OWNED BY siscom_app" -c "DROP ROLE IF EXISTS siscom_app" || true
    echo "Da don DB tam $name."
    ;;
  *)
    echo "Dung: $0 create | split | grants v1|v2|v3 | auth | unauth | unsplit | drop"; exit 2 ;;
esac
