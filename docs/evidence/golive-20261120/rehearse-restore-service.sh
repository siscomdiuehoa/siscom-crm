#!/usr/bin/env bash
# SISCOM CRM - DIEN TAP quy trinh R-SVC (PR #255 muc 5.2): tro dich vu CRM sang database DA KHOI PHUC tu ban sao luu.
# CHI chay tren cum PostgreSQL TAM, CACH LY (initdb trong thu muc tam, cong la mac dinh 55872; tu choi 5432/55433). Khong can VPS,
# khong cham database that hay staging. Mat khau sinh ngau nhien trong thu muc tam, khong in ra. Xong thi dung cum va xoa thu muc tam.
#
# Cac buoc giong het VPS (cung script backend/scripts/linux cua ban ma da build), ten DB dung `siscom_crm_prod`:
#   A. Dung DB: create -> env -> migrate deploy -> grants -> seed-lookups -> bootstrap-auth -> backend chay; tao khach K1 qua API
#   B. Sao luu dem (backup-db.sh, ma hoa age + ky)  => moc RPO
#   C. Sau sao luu: tao khach K2 qua API (du lieu se mat); gia lap su co: doi ten bang customer (dich vu loi)
#   D. R-SVC (do RTO): dung dich vu -> restore-test.sh (xac thuc + khoi phuc vao siscom_crm_restore_<UTC> + so dong) -> doi ten DB hong
#      thanh siscom_crm_prod_hong_<UTC> -> doi ten DB khoi phuc thanh siscom_crm_prod -> ROLE_SPLIT + AUTH_ROLE (quyen cap database)
#      -> kiem quyen nhu create-db.sh -> create-db.sh grants (APP_GRANTS_V5 x2 + VERIFY + VERIFY_AUTH) -> chay dich vu -> /health/database
#   E. Kiem: dang nhap 5 tai khoan bang mat khau cu; K1 co, K2 khong (RPO); sai mat khau 401; sao luu dem chay tiep tren DB moi;
#      DB hong con giu nguyen de dieu tra.
# Can: PG_BIN (bin PostgreSQL >= 17), OPT = thu muc co current/backend da `npm ci` + `npm run build` dung SHA da duyet, age, openssl, curl.
# Dung: PG_BIN=... OPT=... bash docs/evidence/golive-20261120/rehearse-restore-service.sh
set -euo pipefail

port="${PORT:-55872}"; bport="${BACKEND_PORT:-39172}"
[[ "$port" =~ ^[0-9]{4,5}$ ]] && [ "$port" != 5432 ] && [ "$port" != 55433 ] || { echo "TU CHOI: cong $port khong duoc phep."; exit 2; }
: "${PG_BIN:?Dat PG_BIN=<thu muc bin PostgreSQL>}"; : "${OPT:?Dat OPT=<thu muc chua current/backend da build>}"
OPT="$(cd "$OPT" && pwd)"; be="$OPT/current/backend"; lin="$be/scripts/linux"
[ -f "$be/dist/main.js" ] && [ -f "$be/dist/cli/bootstrap-auth.js" ] && [ -d "$be/node_modules/prisma" ] || { echo "OPT chua co ban build day du."; exit 2; }
export PATH="$PG_BIN:$PATH"
for c in initdb pg_ctl psql pg_dump pg_restore openssl node curl age age-keygen ssh-keygen; do command -v "$c" >/dev/null || { echo "Thieu $c"; exit 2; }; done
for p in "$port" "$bport"; do if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "TU CHOI: cong $p dang co dich vu."; exit 2; fi; done

work="$(mktemp -d)"; bpid=""
cleanup() {
  [ -z "$bpid" ] || { kill "$bpid" 2>/dev/null || true; wait "$bpid" 2>/dev/null || true; }
  if [ -f "$work/pg/data/postmaster.pid" ]; then pg_ctl -D "$work/pg/data" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/pg" "$work/etc" "$work/bk"
openssl rand -hex 16 > "$work/pg/su.pw"
initdb -D "$work/pg/data" -U postgres -E UTF8 --no-locale --auth=scram-sha-256 --pwfile="$work/pg/su.pw" >/dev/null
printf "\nport = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nmax_connections = 40\n" "$port" >> "$work/pg/data/postgresql.conf"
pg_ctl -D "$work/pg/data" -l "$work/pg/server.log" -w start >/dev/null
export SISCOM_REHEARSAL=1 PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres SISCOM_PG_PORT="$port"
PGPASSWORD="$(cat "$work/pg/su.pw")"; export PGPASSWORD
export SISCOM_ETC="$work/etc" SISCOM_OPT="$OPT" SISCOM_BACKUP_DIR="$work/bk" SISCOM_HOST=crm.siscom.io.vn
db=siscom_crm_prod; origin="https://$SISCOM_HOST"
su() { psql -X -q -v ON_ERROR_STOP=1 -tA -d "$1" "${@:2}"; }
step() { printf '\n--- %s ---\n' "$*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
echo "== Cum tam PostgreSQL $(su postgres -c 'SHOW server_version') cong $port; ban ma: ${GIT_SHA:-(xem OPT)} =="

# ---------------------------------------------------------------- A. dung DB nhu buoc 2-5
step "A. create / env / migrate / grants / seed / bootstrap ($db)"
bash "$lin/create-db.sh" "$db" create 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
bash "$lin/create-db.sh" "$db" env 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
( cd "$be"; set -a; . "$work/etc/backend.env"; . "$work/etc/migrate.env"; set +a; unset AUTH_DATABASE_URL
  npx --no-install prisma migrate deploy 2>&1 | tail -1 )
bash "$lin/create-db.sh" "$db" grants 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
bash "$lin/run-cli.sh" seed-lookups 2>&1 | grep -E 'Seed danh muc|LOI|Loi|TU CHOI' | cut -c1-120
for k in SYSADMIN ADMIN SALE TECHNICIAN ACCOUNTANT; do export "BOOTSTRAP_PASSWORD_$k=$(openssl rand -hex 12)"; done
export BOOTSTRAP_EMAIL_DOMAIN=rehearsal.test
bash "$lin/run-cli.sh" bootstrap-auth 2>&1 | grep -E 'Khoi tao|Loi|TU CHOI' | cut -c1-120

start_backend() {
  ( set -a; . "$work/etc/backend.env"; set +a
    export NODE_ENV=production HOST=127.0.0.1 PORT="$bport" TRUST_PROXY=loopback COOKIE_SECURE=true EXPORT_GAP_LOG_DIR="$work/export-gap"
    cd "$be" && exec node dist/main.js ) >> "$work/backend.log" 2>&1 &
  bpid=$!
}
stop_backend() { kill "$bpid" 2>/dev/null || true; wait "$bpid" 2>/dev/null || true; bpid=""; }
health_ok() { # cho toi 30 s: /health/database (database up, migrated:true) - giong deploy.sh
  local i body
  for i in $(seq 1 30); do
    body="$(curl -fsS --max-time 2 "http://127.0.0.1:$bport/api/v1/health/database" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -q '"database":"up"' && printf '%s' "$body" | grep -q '"migrated":true'; then printf '%s' "$body" > "$work/hd.json"; return 0; fi
    sleep 1
  done
  return 1
}
# login <email> <mat khau> => in ma HTTP; luu cookie phien vao $work/sid, $work/csrf
login() {
  local code
  code="$(curl -s -o /dev/null -D "$work/h.txt" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Origin: $origin" \
            --data "{\"login\":\"$1\",\"password\":\"$2\"}" "http://127.0.0.1:$bport/api/v1/auth/login")"
  grep -i '^set-cookie: *siscom_sid=' "$work/h.txt" | head -n1 | sed -E 's/^[^:]*: *siscom_sid=([^;]*).*/\1/' | tr -d '\r' > "$work/sid" || true
  grep -i '^set-cookie: *siscom_csrf=' "$work/h.txt" | head -n1 | sed -E 's/^[^:]*: *siscom_csrf=([^;]*).*/\1/' | tr -d '\r' > "$work/csrf" || true
  echo "$code"
}
api() { # api <METHOD> <path> [json] => body; dung phien hien tai
  curl -s -X "$1" -H 'Content-Type: application/json' -H "Origin: $origin" -H "X-CSRF-Token: $(cat "$work/csrf")" \
       -H "Cookie: siscom_sid=$(cat "$work/sid"); siscom_csrf=$(cat "$work/csrf")" ${3:+--data "$3"} "http://127.0.0.1:$bport/api/v1$2"
}
has_customer() { { api GET "/customers?search=$1&pageSize=50" | grep -o "\"name\":\"$1 " || true; } | wc -l | tr -d ' '; }  # so khach co ten bat dau bang $1

start_backend; health_ok || { tail -20 "$work/backend.log"; echo "KHONG DAT: backend khong len"; exit 1; }
[ "$(login "admin@rehearsal.test" "$BOOTSTRAP_PASSWORD_ADMIN")" = 200 ] || { echo "KHONG DAT: dang nhap admin"; exit 1; }
api POST /customers '{"name":"THU-K1 truoc sao luu"}' | grep -q '"id"' || { echo "KHONG DAT: tao K1"; exit 1; }
echo "Tao khach THU-K1 (truoc sao luu): co=$(has_customer THU-K1)"

# ---------------------------------------------------------------- B. sao luu dem (moc RPO)
step "B. sao luu (backup-db.sh, ma hoa age + ky)"
age-keygen -o "$work/age.key" >/dev/null 2>&1; grep -o 'age1[a-z0-9]*' "$work/age.key" | head -1 > "$work/etc/backup.age-recipients"
bash "$lin/backup-db.sh" --init-signing-key 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-110
t_backup="$(date -u +%s)"; echo "moc sao luu: $(now)"
bash "$lin/backup-db.sh" 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
dump="$(find "$work/bk" -name "${db}_*.dump.age" | sort | tail -n1)"; [ -n "$dump" ] || { echo "KHONG DAT: khong co ban sao luu"; exit 1; }
echo "ban sao luu: $(basename "$dump") ($(wc -c < "$dump") byte)"

# ---------------------------------------------------------------- C. du lieu sau sao luu + su co
step "C. sau sao luu: tao THU-K2; gia lap su co (doi ten bang customer)"
sleep 2
api POST /customers '{"name":"THU-K2 sau sao luu"}' | grep -q '"id"' || { echo "KHONG DAT: tao K2"; exit 1; }
echo "THU-K2 co=$(has_customer THU-K2)"
su "$db" -c "ALTER TABLE public.customer RENAME TO customer_hong_gia_lap"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $origin" -H "Cookie: siscom_sid=$(cat "$work/sid"); siscom_csrf=$(cat "$work/csrf")" "http://127.0.0.1:$bport/api/v1/customers")"
echo "su co: GET /customers => $code (mong doi loi 5xx)"; [[ "$code" =~ ^5 ]] || { echo "KHONG DAT: gia lap su co khong gay loi"; exit 1; }
t_incident="$(date -u +%s)"

# ---------------------------------------------------------------- D. R-SVC (do RTO)
step "D. R-SVC: khoi phuc va tro dich vu sang DB da khoi phuc"
t0="$(date -u +%s)"; echo "T0 dung dich vu: $(now)"
stop_backend                                                               # VPS: systemctl stop siscom-crm-backend
echo "D1 restore-test.sh (Owner nap khoa age tam):"
bash "$lin/restore-test.sh" --db "$db" --dump "$dump" --identity "$work/age.key" > "$work/restore.out" 2>&1 || { tail -15 "$work/restore.out"; echo "KHONG DAT: restore-test"; exit 1; }
grep -E '^\[(OK|LOI)\]|KHAC' "$work/restore.out" | cut -c1-120
rdb="$(grep -oE 'siscom_crm_restore_[0-9]{8}_[0-9]{6}' "$work/restore.out" | head -n1)"; [ -n "$rdb" ] || { echo "KHONG DAT: khong thay DB khoi phuc"; exit 1; }
grep -q 'PASS:' "$work/restore.out" || { echo "KHONG DAT: restore-test khong PASS"; exit 1; }
hong="siscom_crm_prod_hong_$(date -u +%Y%m%d_%H%M%S)"
echo "D2 doi ten: $db -> $hong (giu de dieu tra); $rdb -> $db"
su postgres -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname IN ('$db', '$rdb') AND pid <> pg_backend_pid()" >/dev/null
su postgres -c "ALTER DATABASE \"$db\" RENAME TO \"$hong\""
su postgres -c "ALTER DATABASE \"$rdb\" RENAME TO \"$db\""
echo "D3 quyen cap database (ROLE_SPLIT + AUTH_ROLE, superuser):"
su "$db" -v target_db="$db" -f "$be/docs/B1.3_S1_ROLE_SPLIT.sql.txt" > "$work/rs.out" 2>&1 || { tail -15 "$work/rs.out"; echo "KHONG DAT: ROLE_SPLIT"; exit 1; }
su "$db" -v target_db="$db" -f "$be/docs/B1.3_S1_AUTH_ROLE.sql.txt" > "$work/ar.out" 2>&1 || { tail -15 "$work/ar.out"; echo "KHONG DAT: AUTH_ROLE"; exit 1; }
chk="$(su postgres -c "SELECT pg_get_userbyid(datdba) || '|' || has_database_privilege('siscom_app','$db','CONNECT') || '|' || has_database_privilege('siscom_auth','$db','CONNECT') || '|' || has_database_privilege('siscom_app','$db','CREATE') || '|' || (SELECT string_agg(has_database_privilege('public','$db',p)::text, ',') FROM unnest(ARRAY['CONNECT','TEMP','CREATE']) p) FROM pg_database WHERE datname = '$db'")"
echo "    kiem nhu create-db.sh: $chk"; [ "$chk" = "siscom_migrator|true|true|false|false,false,false" ] || { echo "KHONG DAT: quyen cap database"; exit 1; }
echo "D4 create-db.sh grants:"
bash "$lin/create-db.sh" "$db" grants 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
echo "D5 chay dich vu (env KHONG doi vi ten DB giu nguyen):"
start_backend                                                              # VPS: systemctl start siscom-crm-backend
health_ok || { tail -20 "$work/backend.log"; echo "KHONG DAT: dich vu khong khoe sau khoi phuc"; exit 1; }
t1="$(date -u +%s)"; echo "T1 suc khoe dat: $(now)"
echo "/health/database: $(grep -oE '"(database|migrated|leastPrivilege|authPool|authLeastPrivilege)":("[a-z]+"|[a-z]+)' "$work/hd.json" | tr '\n' ' ')"

# ---------------------------------------------------------------- E. kiem sau khoi phuc
step "E. kiem sau khoi phuc"
grep -q '"leastPrivilege":true' "$work/hd.json" && grep -q '"authLeastPrivilege":true' "$work/hd.json" || { echo "KHONG DAT: least privilege"; exit 1; }
for a in sysadmin:SYSADMIN admin:ADMIN sale:SALE kythuat:TECHNICIAN ketoan:ACCOUNTANT; do
  v="BOOTSTRAP_PASSWORD_${a#*:}"; c="$(login "${a%%:*}@rehearsal.test" "${!v}")"; echo "dang nhap ${a%%:*}@ (mat khau cu) => $c"; [ "$c" = 200 ] || { echo "KHONG DAT"; exit 1; }
done
c="$(login "admin@rehearsal.test" "sai-mat-khau-123")"; echo "sai mat khau => $c"; [ "$c" = 401 ] || { echo "KHONG DAT"; exit 1; }
login "admin@rehearsal.test" "$BOOTSTRAP_PASSWORD_ADMIN" >/dev/null
k1="$(has_customer THU-K1)"; k2="$(has_customer THU-K2)"
echo "du lieu: THU-K1 (truoc sao luu) co=$k1 ; THU-K2 (sau sao luu) co=$k2"
[ "$k1" -ge 1 ] && [ "$k2" = 0 ] || { echo "KHONG DAT: du lieu sau khoi phuc khong dung ky vong"; exit 1; }
api POST /customers '{"name":"THU-K3 sau khoi phuc"}' | grep -q '"id"' && echo "ghi moi sau khoi phuc: dat (THU-K3)" || { echo "KHONG DAT: khong ghi duoc sau khoi phuc"; exit 1; }
sleep 1
bash "$lin/backup-db.sh" 2>&1 | grep -E '^\[(OK|LOI)\]' | tail -2 | cut -c1-120
n="$(find "$work/bk" -name "${db}_*.dump.age" | wc -l | tr -d ' ')"; echo "sao luu dem chay tiep tren DB moi: so ban .age = $n"; [ "$n" -ge 2 ] || { echo "KHONG DAT"; exit 1; }
echo "DB hong giu lai: $(su postgres -c "SELECT datname FROM pg_database WHERE datname = '$hong'") (xoa chi khi Owner duyet: DROP DATABASE)"

step "KET QUA"
echo "RTO (may, tu dung dich vu toi suc khoe dat; chua tinh thoi gian Owner quyet dinh va nap khoa): $((t1 - t0)) giay"
echo "RPO dien tap: mat du lieu tao sau moc sao luu ($((t_incident - t_backup)) giay truoc su co; THU-K2). Production: sao luu dem => toi da ~24 gio."
echo "DIEN TAP R-SVC HOAN TAT: moi buoc dat. Da dung cum tam va xoa thu muc tam."
