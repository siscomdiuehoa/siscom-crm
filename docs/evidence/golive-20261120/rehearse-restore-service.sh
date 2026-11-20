#!/usr/bin/env bash
# SISCOM CRM - DIEN TAP quy trinh R-SVC (PR #255 muc 5.2): tro dich vu CRM sang database DA KHOI PHUC tu ban sao luu,
# KEM duong lui khi R-SVC loi THAT giua chung (sau khi R4 da commit va mot phan R5 da chay).
# CHI chay tren cum PostgreSQL TAM, CACH LY (initdb trong thu muc tam, cong la mac dinh 55872; tu choi 5432/55433). Khong cham
# database that hay staging. Mat khau sinh ngau nhien trong thu muc tam, khong in ra. Xong thi dung cum va xoa thu muc tam.
#
# Hai che do:
#   - mac dinh (Windows/Git Bash hoac Linux khong root): SISCOM_REHEARSAL=1 - superuser qua TCP + mat khau, khong runuser/chown/systemd.
#   - REAL=1 (Linux, root, giong VPS): KHONG dat SISCOM_REHEARSAL => script chay dung nhanh VPS: psql superuser qua `runuser -u postgres`
#     (peer, socket cua cum tam), restore-test.sh `chown postgres` + `runuser pg_restore`, kiem file 600/root. Neu may co systemd:
#     backend chay bang CHINH unit production backend/scripts/linux/systemd/siscom-crm-backend.service (User=siscom + cac tuy chon
#     bao ve), chi doi duong dan / cong / ten (in diff), cai vao /run/systemd/system (tam, mat khi khoi dong lai) - KHONG ghi /etc.
#     Tao user he thong `siscom` neu may dien tap chua co. Dung / chay bang `systemctl stop` / `systemctl start` nhu VPS.
#
#   A. Dung DB `siscom_crm_prod` nhu buoc 2-5; backend chay; tao khach THU-K1 qua API
#   B. Sao luu (backup-db.sh, age + ky) => moc RPO
#   C. Tao THU-K2 sau sao luu; gia lap su co (doi ten bang customer => GET /customers 500)
#   D. R1 dung dich vu; R2 restore-test.sh
#   F. LAN 1 - LOI THAT GIUA CHUNG + DUONG LUI: R3 doi ten; R4 chay DUNG (ROLE_SPLIT + AUTH_ROLE da commit); R5 `create-db.sh grants`
#      chay APP_GRANTS_V5 (commit) roi loi o VERIFY (gia lap: mat khau siscom_app trong cum lech voi db-roles.env) => duong lui:
#      doi nguoc ten, khac phuc nguyen nhan (tra mat khau role). Kiem dau van tay DAY DU cua DB goc (chu so huu + ACL database,
#      schema day du co OWNER/GRANT qua pg_dump -s, so dong tung bang), dau van tay role (thuoc tinh, thanh vien, ACL tham so),
#      du lieu DB khoi phuc khong doi; dich vu chay lai tren DB goc van loi nhu truoc R-SVC.
#   G. LAN 2 - DUONG CHINH (dung lai DB khoi phuc o R2, da mang thay doi cua lan 1): R3 -> R4 -> R5 -> R6
#   E. R7: 5 tai khoan dang nhap mat khau cu, sai mat khau 401, THU-K1 co / THU-K2 khong, ghi moi duoc, sao luu chay tiep, DB hong con
# Can: PG_BIN (bin PostgreSQL >= 17), OPT = thu muc co current/backend da `npm ci` + `npm run build` dung SHA da duyet, age, openssl, curl.
# Dung: PG_BIN=... OPT=... [REAL=1] bash docs/evidence/golive-20261120/rehearse-restore-service.sh
set -euo pipefail

port="${PORT:-55872}"; bport="${BACKEND_PORT:-39172}"
[[ "$port" =~ ^[0-9]{4,5}$ ]] && [ "$port" != 5432 ] && [ "$port" != 55433 ] || { echo "TU CHOI: cong $port khong duoc phep."; exit 2; }
: "${PG_BIN:?Dat PG_BIN=<thu muc bin PostgreSQL>}"; : "${OPT:?Dat OPT=<thu muc chua current/backend da build>}"
OPT="$(cd "$OPT" && pwd)"; be="$OPT/current/backend"; lin="$be/scripts/linux"
[ -f "$be/dist/main.js" ] && [ -f "$be/dist/cli/bootstrap-auth.js" ] && [ -d "$be/node_modules/prisma" ] || { echo "OPT chua co ban build day du."; exit 2; }
export PATH="$PG_BIN:$PATH"
REAL="${REAL:-0}"; use_systemd=0
if [ "$REAL" = 1 ]; then
  [ "$(uname -s)" = Linux ] && [ "$(id -u)" = 0 ] || { echo "REAL=1 can Linux + root."; exit 2; }
  id postgres >/dev/null 2>&1 || { echo "REAL=1 can user he thong postgres."; exit 2; }
  for c in runuser chown; do command -v "$c" >/dev/null || { echo "Thieu $c"; exit 2; }; done
  [ -d /run/systemd/system ] && command -v systemctl >/dev/null && use_systemd=1
fi
for c in initdb pg_ctl psql pg_dump pg_restore openssl node curl age age-keygen ssh-keygen md5sum; do command -v "$c" >/dev/null || { echo "Thieu $c"; exit 2; }; done
for p in "$port" "$bport"; do if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "TU CHOI: cong $p dang co dich vu."; exit 2; fi; done

work="$(mktemp -d)"; chmod 755 "$work"; bpid=""; unit="siscom-crm-backend-rsvc"; unitfile="/run/systemd/system/$unit.service"
# REAL: thu muc cau hinh o /run (khong bi PrivateTmp cua unit che), root 700 - nhu /etc/siscom-crm tren VPS.
if [ "$REAL" = 1 ]; then etc="/run/siscom-rsvc-$$"; install -d -m 700 -o root -g root "$etc"; else etc="$work/etc"; mkdir -p "$etc"; fi
pgrun() { if [ "$REAL" = 1 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
start_backend() { # VPS: systemctl start siscom-crm-backend
  if [ "$use_systemd" = 1 ]; then systemctl start "$unit"
  else
    ( set -a; . "$etc/backend.env"; set +a
      export NODE_ENV=production HOST=127.0.0.1 PORT="$bport" TRUST_PROXY=loopback COOKIE_SECURE=true EXPORT_GAP_LOG_DIR="$work/export-gap"
      cd "$be" && exec node dist/main.js ) >> "$work/backend.log" 2>&1 &
    bpid=$!
  fi
}
stop_backend() { # VPS: systemctl stop siscom-crm-backend
  if [ "$use_systemd" = 1 ]; then systemctl stop "$unit" 2>/dev/null || true
  elif [ -n "$bpid" ]; then kill "$bpid" 2>/dev/null || true; wait "$bpid" 2>/dev/null || true; bpid=""; fi
}
cleanup() {
  stop_backend 2>/dev/null || true
  if [ "$use_systemd" = 1 ] && [ -f "$unitfile" ]; then rm -f "$unitfile"; systemctl daemon-reload || true; fi
  if [ -f "$work/pg/data/postmaster.pid" ]; then pgrun pg_ctl -D "$work/pg/data" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf "$work"; [ "$REAL" != 1 ] || rm -rf "$etc"
}
trap cleanup EXIT
mkdir -p "$work/pg" "$work/bk"
if [ "$REAL" = 1 ]; then
  chown postgres:postgres "$work/pg"; chmod 700 "$work/bk"
  runuser -u postgres -- initdb -D "$work/pg/data" -U postgres -E UTF8 --no-locale --auth-local=peer --auth-host=scram-sha-256 >/dev/null
  mkdir -p "$work/pg/sock"; chown postgres:postgres "$work/pg/sock"
  printf "\nport = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = '%s'\nmax_connections = 40\n" "$port" "$work/pg/sock" >> "$work/pg/data/postgresql.conf"
  runuser -u postgres -- pg_ctl -D "$work/pg/data" -l "$work/pg/server.log" -w start >/dev/null
  # Nhanh VPS cua lib.sh: psql_su = `runuser -u postgres -- psql` (peer); PGHOST/PGPORT tro socket cua cum TAM (khong phai cum he thong).
  export PGHOST="$work/pg/sock" PGPORT="$port" SISCOM_PG_PORT="$port"; unset SISCOM_REHEARSAL
  su() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -tA -d "$1" "${@:2}"; }
  sudump() { runuser -u postgres -- pg_dump -s -d "$1"; }
else
  openssl rand -hex 16 > "$work/pg/su.pw"
  initdb -D "$work/pg/data" -U postgres -E UTF8 --no-locale --auth=scram-sha-256 --pwfile="$work/pg/su.pw" >/dev/null
  printf "\nport = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nmax_connections = 40\n" "$port" >> "$work/pg/data/postgresql.conf"
  pg_ctl -D "$work/pg/data" -l "$work/pg/server.log" -w start >/dev/null
  export SISCOM_REHEARSAL=1 PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres SISCOM_PG_PORT="$port"
  PGPASSWORD="$(cat "$work/pg/su.pw")"; export PGPASSWORD
  su() { psql -X -q -v ON_ERROR_STOP=1 -tA -d "$1" "${@:2}"; }
  sudump() { pg_dump -s -d "$1"; }
fi
export SISCOM_ETC="$etc" SISCOM_OPT="$OPT" SISCOM_BACKUP_DIR="$work/bk" SISCOM_HOST=crm.siscom.io.vn
db=siscom_crm_prod; origin="https://$SISCOM_HOST"
step() { printf '\n--- %s ---\n' "$*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
echo "== $(uname -srm); $( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo '?'); uid=$(id -u) =="
echo "== Che do: $([ "$REAL" = 1 ] && echo "REAL (nhanh VPS: runuser/chown/kiem 600-root), systemd=$use_systemd" || echo 'SISCOM_REHEARSAL=1'); PostgreSQL $(su postgres -c 'SHOW server_version') cong $port; ban ma: ${GIT_SHA:-(xem OPT)} =="

# ---------------------------------------------------------------- A. dung DB nhu buoc 2-5
step "A. create / env / migrate / grants / seed / bootstrap ($db)"
bash "$lin/create-db.sh" "$db" create 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
bash "$lin/create-db.sh" "$db" env 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
( cd "$be"; set -a; . "$etc/backend.env"; . "$etc/migrate.env"; set +a; unset AUTH_DATABASE_URL
  npx --no-install prisma migrate deploy 2>&1 | tail -1 )
bash "$lin/create-db.sh" "$db" grants 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
bash "$lin/run-cli.sh" seed-lookups 2>&1 | grep -E 'Seed danh muc|LOI|Loi|TU CHOI' | cut -c1-120
for k in SYSADMIN ADMIN SALE TECHNICIAN ACCOUNTANT; do export "BOOTSTRAP_PASSWORD_$k=$(openssl rand -hex 12)"; done
export BOOTSTRAP_EMAIL_DOMAIN=rehearsal.test
bash "$lin/run-cli.sh" bootstrap-auth 2>&1 | grep -E 'Khoi tao|Loi|TU CHOI' | cut -c1-120

# ---------------------------------------------------------------- unit systemd (REAL + systemd)
if [ "$use_systemd" = 1 ]; then
  step "Unit systemd: dung tep production, chi doi duong dan / cong / ten"
  id siscom >/dev/null 2>&1 || { useradd --system --no-create-home --shell /usr/sbin/nologin siscom; echo "tao user he thong siscom tren may dien tap (VPS da co)"; }
  src_unit="$lin/systemd/siscom-crm-backend.service"
  sed -e "s#^WorkingDirectory=.*#WorkingDirectory=$be#" \
      -e "s#^EnvironmentFile=.*#EnvironmentFile=$etc/backend.env#" \
      -e "s#^Environment=PORT=3000\$#Environment=PORT=$bport#" \
      -e "s#^ReadOnlyPaths=/opt/siscom-crm\$#ReadOnlyPaths=$OPT#" \
      -e "s#^ExecStart=/usr/bin/node #ExecStart=$(command -v node) #" \
      -e "s#^LogsDirectory=siscom-crm\$#LogsDirectory=siscom-crm-rsvc#" \
      -e "s#^Environment=EXPORT_GAP_LOG_DIR=/var/log/siscom-crm/#Environment=EXPORT_GAP_LOG_DIR=/var/log/siscom-crm-rsvc/#" \
      -e "/^Requires=postgresql.service\$/d" \
      -e "s#^After=network-online.target postgresql.service\$#After=network-online.target#" \
      "$src_unit" > "$unitfile"
  echo "khac biet so voi unit production (diff -u):"; diff -u "$src_unit" "$unitfile" | grep -E '^[-+][^-+]' || true
  systemctl daemon-reload
  echo "User=$(systemctl show -p User --value "$unit") Group=$(systemctl show -p Group --value "$unit") ProtectSystem=$(systemctl show -p ProtectSystem --value "$unit") ProtectHome=$(systemctl show -p ProtectHome --value "$unit") PrivateTmp=$(systemctl show -p PrivateTmp --value "$unit") NoNewPrivileges=$(systemctl show -p NoNewPrivileges --value "$unit")"
  echo "backend.env: $(stat -c '%a %U:%G' "$etc/backend.env") ; migrate.env: $(stat -c '%a %U:%G' "$etc/migrate.env")"
  if runuser -u siscom -- cat "$etc/backend.env" >/dev/null 2>&1; then echo "KHONG DAT: user siscom doc duoc backend.env"; exit 1; fi
  echo "user siscom KHONG doc duoc backend.env (dung: systemd doc EnvironmentFile bang root roi moi ha quyen)"
  runuser -u siscom -- test -r "$be/dist/main.js" && runuser -u siscom -- test -x "$(command -v node)" || { echo "KHONG DAT: siscom khong doc duoc ung dung / node"; exit 1; }
  echo "user siscom doc duoc ung dung ($be) va chay duoc node"
fi

backend_tail() { if [ "$use_systemd" = 1 ]; then journalctl -u "$unit" -n 20 --no-pager 2>/dev/null || true; else tail -20 "$work/backend.log"; fi; }
health_ok() { # toi 30 s: /health/database (database up, migrated:true) - giong deploy.sh
  local i body
  for i in $(seq 1 30); do
    body="$(curl -fsS --max-time 2 "http://127.0.0.1:$bport/api/v1/health/database" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -q '"database":"up"' && printf '%s' "$body" | grep -q '"migrated":true'; then printf '%s' "$body" > "$work/hd.json"; return 0; fi
    sleep 1
  done
  return 1
}
login() { # login <email> <mat khau> => ma HTTP; cookie phien vao $work/sid, $work/csrf
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
customers_code() { curl -s -o /dev/null -w '%{http_code}' -H "Origin: $origin" -H "Cookie: siscom_sid=$(cat "$work/sid"); siscom_csrf=$(cat "$work/csrf")" "http://127.0.0.1:$bport/api/v1/customers"; }
md5() { md5sum | cut -c1-32; }
# Dau van tay DB (theo ten): chu so huu + ACL database | md5 schema day du (pg_dump -s: bang, ham, OWNER, GRANT/REVOKE, bo dong \restrict
# ngau nhien cua pg_dump 18) | md5 (ten bang = so dong) moi bang public
fp_db() {
  local d="$1" meta schema rows
  meta="$(su postgres -c "SELECT pg_get_userbyid(datdba) || ' ' || coalesce(datacl::text, '(mac dinh)') FROM pg_database WHERE datname = '$d'")"
  schema="$(sudump "$d" | grep -v -E '^\\(un)?restrict ' | md5)"
  rows="$(su "$d" -c "SELECT string_agg(tablename || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" | md5)"
  echo "owner+acl=[$meta] schema=$schema rows=$rows"
}
fp_rows() { su "$1" -c "SELECT string_agg(tablename || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" | md5; }
# Dau van tay role cap cluster: thuoc tinh 3 role siscom_*, thanh vien, ACL tham so (GRANT SET ON PARAMETER)
fp_roles() {
  su postgres -c "SELECT (SELECT string_agg(format('%s:%s%s%s%s%s%s%s', rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls), ',' ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'siscom\_%')
     || ' | ' || coalesce((SELECT string_agg(r.rolname || '>' || m.rolname, ',' ORDER BY 1) FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member WHERE r.rolname LIKE 'siscom\_%' OR m.rolname LIKE 'siscom\_%'), '-')
     || ' | ' || coalesce((SELECT string_agg(parname || '=' || paracl::text, ',' ORDER BY parname) FROM pg_parameter_acl), '-')" | md5
}
db_exists_su() { [ "$(su postgres -c "SELECT count(*) FROM pg_database WHERE datname = '$1'")" = 1 ]; }
app_pw_from_env() { grep '^SISCOM_APP_PW=' "$etc/db-roles.env" | cut -d= -f2-; }

start_backend; health_ok || { backend_tail; echo "KHONG DAT: backend khong len"; exit 1; }
if [ "$use_systemd" = 1 ]; then
  mp="$(systemctl show -p MainPID --value "$unit")"; echo "dich vu chay: unit $unit, MainPID $mp, user $(ps -o user= -p "$mp")"
  [ "$(ps -o user= -p "$mp" | tr -d ' ')" = siscom ] || { echo "KHONG DAT: tien trinh khong chay bang siscom"; exit 1; }
fi
echo "/health/database: $(grep -oE '"(database|migrated|leastPrivilege|authPool|authLeastPrivilege)":("[a-z]+"|[a-z]+)' "$work/hd.json" | tr '\n' ' ')"
[ "$(login "admin@rehearsal.test" "$BOOTSTRAP_PASSWORD_ADMIN")" = 200 ] || { echo "KHONG DAT: dang nhap admin"; exit 1; }
api POST /customers '{"name":"THU-K1 truoc sao luu"}' | grep -q '"id"' || { echo "KHONG DAT: tao K1"; exit 1; }
echo "Tao khach THU-K1 (truoc sao luu): co=$(has_customer THU-K1)"

# ---------------------------------------------------------------- B. sao luu (moc RPO)
step "B. sao luu (backup-db.sh, ma hoa age + ky)"
age-keygen -o "$work/age.key" >/dev/null 2>&1; grep -o 'age1[a-z0-9]*' "$work/age.key" | head -1 > "$etc/backup.age-recipients"
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
code="$(customers_code)"; echo "su co: GET /customers => $code (mong doi 5xx)"; [[ "$code" =~ ^5 ]] || { echo "KHONG DAT: gia lap su co khong gay loi"; exit 1; }
t_incident="$(date -u +%s)"

# ---------------------------------------------------------------- D. R1-R2
step "D. R1 dung dich vu, R2 restore-test.sh"
t0="$(date -u +%s)"; echo "T0 dung dich vu: $(now)"
stop_backend
bash "$lin/restore-test.sh" --db "$db" --dump "$dump" --identity "$work/age.key" > "$work/restore.out" 2>&1 || { tail -15 "$work/restore.out"; echo "KHONG DAT: restore-test"; exit 1; }
grep -E '^\[(OK|LOI)\]|KHAC' "$work/restore.out" | cut -c1-120
rdb="$(grep -oE 'siscom_crm_restore_[0-9]{8}_[0-9]{6}' "$work/restore.out" | head -n1)"; [ -n "$rdb" ] || { echo "KHONG DAT: khong thay DB khoi phuc"; exit 1; }
grep -q 'PASS:' "$work/restore.out" || { echo "KHONG DAT: restore-test khong PASS"; exit 1; }
t_r2="$(date -u +%s)"

terminate() { su postgres -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname IN ('$db', '$rdb') AND pid <> pg_backend_pid()" >/dev/null; }
r3() { # R3: doi ten DB hong -> $hong, DB khoi phuc -> $db
  terminate
  su postgres -c "ALTER DATABASE \"$db\" RENAME TO \"$hong\""
  su postgres -c "ALTER DATABASE \"$rdb\" RENAME TO \"$db\""
}
r4() { # R4: quyen cap database (ROLE_SPLIT + AUTH_ROLE, superuser) + kiem nhu create-db.sh create
  su "$db" -v target_db="$db" -f "$be/docs/B1.3_S1_ROLE_SPLIT.sql.txt" > "$work/rs.out" 2>&1 || return 1
  su "$db" -v target_db="$db" -f "$be/docs/B1.3_S1_AUTH_ROLE.sql.txt" > "$work/ar.out" 2>&1 || return 1
  chk="$(su postgres -c "SELECT pg_get_userbyid(datdba) || '|' || has_database_privilege('siscom_app','$db','CONNECT') || '|' || has_database_privilege('siscom_auth','$db','CONNECT') || '|' || has_database_privilege('siscom_app','$db','CREATE') || '|' || (SELECT string_agg(has_database_privilege('public','$db',p)::text, ',') FROM unnest(ARRAY['CONNECT','TEMP','CREATE']) p) FROM pg_database WHERE datname = '$db'")"
  echo "    R4 kiem nhu create-db.sh: $chk"; [ "$chk" = "siscom_migrator|true|true|false|false,false,false" ]
}
rollback_r3() { # Duong lui khi loi o R3-R5: doi nguoc hai ten
  terminate
  su postgres -c "ALTER DATABASE \"$db\" RENAME TO \"$rdb\""
  su postgres -c "ALTER DATABASE \"$hong\" RENAME TO \"$db\""
}

# ---------------------------------------------------------------- F. lan 1: loi that sau khi R4 da commit, giua R5 => duong lui
step "F. LAN 1 - R4 commit xong, R5 loi giua chung => duong lui (doi nguoc ten)"
fpA_goc="$(fp_db "$db")"; fpA_rdb="$(fp_db "$rdb")"; fpR="$(fp_roles)"; rows_rdb="$(fp_rows "$rdb")"
echo "TRUOC  DB goc      ($db): $fpA_goc"
echo "TRUOC  DB khoi phuc ($rdb): $fpA_rdb"
echo "TRUOC  role cluster: $fpR"
hong="siscom_crm_prod_hong_$(date -u +%Y%m%d_%H%M%S)"
r3; echo "R3: $db -> $hong ; $rdb -> $db"
r4 || { tail -15 "$work/rs.out" "$work/ar.out"; echo "KHONG DAT: R4 lan 1 phai chay dung"; exit 1; }
echo "R4 da COMMIT (ROLE_SPLIT + AUTH_ROLE) tren DB dang mang ten $db"
# Loi gia lap giua R5: mat khau siscom_app trong cum lech voi db-roles.env => create-db.sh grants chay APP_GRANTS_V5 (commit 2 lan)
# roi VERIFY (dang nhap bang siscom_app) that bai.
su postgres <<SQL >/dev/null
ALTER ROLE siscom_app PASSWORD '$(openssl rand -hex 24)';
SQL
if bash "$lin/create-db.sh" "$db" grants > "$work/grants1.out" 2>&1; then echo "KHONG DAT: R5 khong loi nhu du kien"; exit 1; fi
echo "R5 loi giua chung: $(grep -c -- '--- APP_GRANTS_V5 (siscom_migrator) lan' "$work/grants1.out") lan APP_GRANTS_V5 da chay (commit); dong loi: $(grep -E '^\[LOI\]|FATAL|failed' "$work/grants1.out" | head -n1 | sed -E 's/(postgres(ql)?:\/\/)[^ @]*@/\1***@/g' | cut -c1-110)"
grep -q -- '--- APP_GRANTS_V5 (siscom_migrator) lan 1 ---' "$work/grants1.out" || { echo "KHONG DAT: APP_GRANTS_V5 chua chay truoc khi loi"; exit 1; }
fpB_moi="$(fp_db "$db")"; echo "SAU R4/R5 mot phan, DB dang mang ten $db: $fpB_moi"
[ "$fpB_moi" != "$fpA_rdb" ] || { echo "KHONG DAT: R4/R5 khong de lai thay doi nao (khong chung minh duoc loi sau commit)"; exit 1; }
t_rb0="$(date -u +%s)"
rollback_r3
su postgres <<SQL >/dev/null
ALTER ROLE siscom_app PASSWORD '$(app_pw_from_env)';
SQL
t_rb1="$(date -u +%s)"
echo "duong lui: $db <- $hong ; $rdb <- $db ; khac phuc nguyen nhan (tra mat khau siscom_app theo db-roles.env) ($((t_rb1 - t_rb0)) giay)"
db_exists_su "$db" && db_exists_su "$rdb" && ! db_exists_su "$hong" || { echo "KHONG DAT: ten DB sau duong lui"; exit 1; }
fpC_goc="$(fp_db "$db")"; fpC_rdb="$(fp_db "$rdb")"; fpR2="$(fp_roles)"; rows_rdb2="$(fp_rows "$rdb")"
echo "SAU    DB goc      ($db): $fpC_goc"
echo "SAU    role cluster: $fpR2"
echo "SAU    DB khoi phuc ($rdb): $fpC_rdb"
[ "$fpC_goc" = "$fpA_goc" ] || { echo "KHONG DAT: DB goc doi chu so huu / ACL / schema / du lieu sau duong lui"; exit 1; }
[ "$fpR2" = "$fpR" ] || { echo "KHONG DAT: role cluster doi sau duong lui"; exit 1; }
[ "$rows_rdb2" = "$rows_rdb" ] || { echo "KHONG DAT: du lieu DB khoi phuc doi"; exit 1; }
echo "dat: DB goc trung TRUOC ca chu so huu, ACL database, schema (OWNER/GRANT), so dong; role cluster trung; du lieu DB khoi phuc khong doi"
echo "     (DB khoi phuc mang san thay doi quyen cua R4/R5 lan 1 - ROLE_SPLIT/AUTH_ROLE/APP_GRANTS chay lai duoc, lan 2 kiem lai)"
start_backend; health_ok || { backend_tail; echo "KHONG DAT: dich vu khong chay lai tren DB goc sau duong lui"; exit 1; }
login "admin@rehearsal.test" "$BOOTSTRAP_PASSWORD_ADMIN" >/dev/null
code="$(customers_code)"; echo "dich vu tren DB goc sau duong lui: GET /customers => $code (dung trang thai truoc R-SVC: van loi)"
[[ "$code" =~ ^5 ]] || { echo "KHONG DAT: trang thai sau duong lui khac truoc R-SVC"; exit 1; }
stop_backend

# ---------------------------------------------------------------- G. lan 2: duong chinh
step "G. LAN 2 - R3 -> R6 (dung lai DB khoi phuc o R2, khong khoi phuc lai)"
t_g0="$(date -u +%s)"
hong="siscom_crm_prod_hong_$(date -u +%Y%m%d_%H%M%S)"
r3; echo "R3: $db -> $hong ; $rdb -> $db"
r4 || { tail -15 "$work/rs.out" "$work/ar.out"; echo "KHONG DAT: R4"; exit 1; }
echo "R5 create-db.sh grants:"
bash "$lin/create-db.sh" "$db" grants > "$work/grants2.out" 2>&1 || { tail -15 "$work/grants2.out"; echo "KHONG DAT: R5"; exit 1; }
grep -E '^\[(OK|LOI)\]' "$work/grants2.out" | cut -c1-120
start_backend
health_ok || { backend_tail; echo "KHONG DAT: dich vu khong khoe sau khoi phuc"; exit 1; }
t1="$(date -u +%s)"; echo "R6 T1 suc khoe dat: $(now)"
echo "/health/database: $(grep -oE '"(database|migrated|leastPrivilege|authPool|authLeastPrivilege)":("[a-z]+"|[a-z]+)' "$work/hd.json" | tr '\n' ' ')"
if [ "$use_systemd" = 1 ]; then mp="$(systemctl show -p MainPID --value "$unit")"; echo "dich vu: unit $unit, user $(ps -o user= -p "$mp")"; fi

# ---------------------------------------------------------------- E. kiem sau khoi phuc (R7)
step "E. R7 kiem sau khoi phuc"
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
n="$(find "$work/bk" -name "${db}_*.dump.age" | wc -l | tr -d ' ')"; echo "sao luu chay tiep tren DB moi: so ban .age = $n"; [ "$n" -ge 2 ] || { echo "KHONG DAT"; exit 1; }
db_exists_su "$hong" || { echo "KHONG DAT: mat DB hong"; exit 1; }
echo "DB hong giu lai: $hong (xoa chi khi Owner duyet: DROP DATABASE)"

step "KET QUA"
echo "RTO duong chinh (may): R1-R2 $((t_r2 - t0)) giay + R3-R6 $((t1 - t_g0)) giay = $((t_r2 - t0 + t1 - t_g0)) giay (chua tinh Owner quyet dinh / nap khoa)"
echo "Duong lui (doi nguoc ten + khac phuc): $((t_rb1 - t_rb0)) giay; tong thoi gian ke ca lan loi: $((t1 - t0)) giay"
echo "RPO dien tap: mat du lieu tao sau moc sao luu ($((t_incident - t_backup)) giay truoc su co; THU-K2). Production: sao luu dem => toi da ~24 gio."
echo "DIEN TAP R-SVC HOAN TAT: moi buoc dat. Da dung cum tam va xoa thu muc tam."
