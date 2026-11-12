#!/usr/bin/env bash
# SISCOM CRM - DIEN TAP phan SQL/van hanh cua bo script Linux tren PostgreSQL TAM, CACH LY (khong can VPS, khong cham DB that/demo).
# Tao cum PostgreSQL moi (initdb) trong thu muc tam, cong la (mac dinh 55871; tu choi 5432/55433), chay:
#   create-db.sh create -> env -> prisma migrate deploy (siscom_migrator) -> grants (APP_GRANTS_V4 x2 + VERIFY + VERIFY_AUTH)
#   -> (neu co thu muc `current`) run-cli seed-lookups + bootstrap-auth -> backup-db.sh -> restore-test.sh -> tu choi sua manifest
# roi DUNG cum va XOA toan bo thu muc tam. Mat khau sinh ngau nhien trong thu muc tam, khong in ra.
# Can: PG_BIN (thu muc bin cua PostgreSQL >= 17, vd /c/Program Files/PostgreSQL/18/bin), da `npm ci` trong backend/, openssl.
#      `age` + `age-keygen` tren PATH => thu ma hoa that; khong co => SISCOM_BACKUP_NO_ENCRYPT=yes.
# Dung: PG_BIN=... bash backend/scripts/linux/tests/rehearse-pg.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lin="$(cd "$here/.." && pwd)"
backend="$(cd "$lin/../.." && pwd)"
port="${PORT:-55871}"
[[ "$port" =~ ^[0-9]{4,5}$ ]] && [ "$port" != 5432 ] && [ "$port" != 55433 ] || { echo "TU CHOI: cong $port khong duoc phep."; exit 2; }
: "${PG_BIN:?Dat PG_BIN=<thu muc bin PostgreSQL>}"
export PATH="$PG_BIN:$PATH"
for c in initdb pg_ctl psql pg_dump pg_restore openssl node; do command -v "$c" >/dev/null || { echo "Thieu $c"; exit 2; }; done
[ -d "$backend/node_modules/prisma" ] && [ -f "$backend/dist/main.js" ] || { echo "Can 'npm ci' va 'npm run build' trong backend/ truoc."; exit 2; }
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "TU CHOI: cong $port dang co dich vu lang nghe."; exit 2; fi

work="$(mktemp -d)"
cleanup() {
  if [ -f "$work/pg/data/postmaster.pid" ]; then pg_ctl -D "$work/pg/data" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/pg" "$work/etc" "$work/bk" "$work/opt"
openssl rand -hex 16 > "$work/pg/su.pw"
initdb -D "$work/pg/data" -U postgres -E UTF8 --no-locale --auth=scram-sha-256 --pwfile="$work/pg/su.pw" >/dev/null
printf "\nport = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nmax_connections = 30\n" "$port" >> "$work/pg/data/postgresql.conf"
pg_ctl -D "$work/pg/data" -l "$work/pg/server.log" -w start >/dev/null
echo "== Cum tam PostgreSQL $(PGPASSWORD="$(cat "$work/pg/su.pw")" psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -tA -c 'SHOW server_version') cong $port =="

export SISCOM_REHEARSAL=1 PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres SISCOM_PG_PORT="$port"
PGPASSWORD="$(cat "$work/pg/su.pw")"; export PGPASSWORD
export SISCOM_ETC="$work/etc" SISCOM_OPT="$work/opt" SISCOM_BACKUP_DIR="$work/bk" SISCOM_HOST=crm.example.vn
db=siscom_crm_staging
step() { printf '\n--- %s ---\n' "$*"; }

step "create"; bash "$lin/create-db.sh" "$db" create 2>&1 | grep -E '^\[(OK|LOI)\]'
step "create lan 2 phai TU CHOI"; if bash "$lin/create-db.sh" "$db" create >/dev/null 2>&1; then echo "KHONG DAT: tao lai DB da ton tai"; exit 1; else echo "dat (tu choi)"; fi
step "tu choi DB la"; if bash "$lin/create-db.sh" siscom_crm_dev create >/dev/null 2>&1; then echo "KHONG DAT"; exit 1; else echo "dat (tu choi siscom_crm_dev)"; fi
step "env"; bash "$lin/create-db.sh" "$db" env 2>&1 | grep -E '^\[(OK|LOI)\]'
step "prisma migrate deploy (siscom_migrator)"
( cd "$backend"
  DATABASE_URL="$(grep '^DATABASE_URL=' "$work/etc/backend.env" | cut -d= -f2-)"; MIGRATE_DATABASE_URL="$(grep '^MIGRATE_DATABASE_URL=' "$work/etc/migrate.env" | cut -d= -f2-)"
  export DATABASE_URL MIGRATE_DATABASE_URL
  npx --no-install prisma migrate deploy 2>&1 | tail -2
  npx --no-install prisma migrate status 2>&1 | tail -1 )
step "grants + VERIFY"; bash "$lin/create-db.sh" "$db" grants 2>&1 | grep -E '^\[(OK|LOI)\]|PASS|FAIL'

if ln -s "$(cd "$backend/.." && pwd)" "$work/opt/current" 2>/dev/null && [ -f "$work/opt/current/backend/dist/cli/seed-lookups.js" ]; then
  step "seed-lookups"; bash "$lin/run-cli.sh" seed-lookups 2>&1 | grep -E 'Seed danh muc|LOI|Loi|TU CHOI'
  step "bootstrap-auth (mat khau thu ngau nhien)"
  for k in SYSADMIN ADMIN SALE TECHNICIAN ACCOUNTANT; do export "BOOTSTRAP_PASSWORD_$k=$(openssl rand -hex 12)"; done
  export BOOTSTRAP_EMAIL_DOMAIN=rehearsal.test
  bash "$lin/run-cli.sh" bootstrap-auth 2>&1 | grep -E 'Khoi tao|Loi|TU CHOI'
else
  echo "(bo qua seed/bootstrap: khong tao duoc lien ket current - vd Windows khong co quyen symlink)"
fi

step "backup"
if command -v age >/dev/null && command -v age-keygen >/dev/null; then
  age-keygen -o "$work/age.key" >/dev/null 2>&1; grep -o 'age1[a-z0-9]*' "$work/age.key" | head -1 > "$work/etc/backup.age-recipients"; ident=(--identity "$work/age.key")
else
  export SISCOM_BACKUP_NO_ENCRYPT=yes; ident=(); echo "(khong co age: sao luu khong ma hoa)"
fi
step "backup khi CHUA co khoa ky (phai TU CHOI - F1)"
if bash "$lin/backup-db.sh" >"$work/nokey.out" 2>&1; then echo "KHONG DAT: sao luu khong co khoa ky van chay"; exit 1; else grep -E '^\[LOI\]' "$work/nokey.out" | cut -c1-110; fi
step "tao khoa ky sao luu"; bash "$lin/backup-db.sh" --init-signing-key 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-110
bash "$lin/backup-db.sh" 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-120
A="$(find "$work/bk" -name "${db}_*.dump*" ! -name '*.sha256' ! -name '*.txt' | sort | head -n1)"
step "restore-test (phai PASS)"
bash "$lin/restore-test.sh" "${ident[@]}" --dump "$A" 2>&1 | grep -E '^\[(OK|LOI)\]|KHAC' | cut -c1-110

# --- F1: cac kieu sua/trao doi phai bi TU CHOI truoc khi tao DB thu ---
neg() { # neg <mo ta>: restore-test tren A phai that bai
  if bash "$lin/restore-test.sh" "${ident[@]}" --dump "$A" >"$work/neg.out" 2>&1; then echo "KHONG DAT ($1): van PASS"; exit 1; fi
  grep -qE 'Da tao DB thu' "$work/neg.out" && { echo "KHONG DAT ($1): da tao DB thu truoc khi tu choi"; exit 1; }
  echo "dat ($1): $(grep -E '^\[LOI\]' "$work/neg.out" | head -n1 | cut -c1-100)"
}
mA="${A%.dump*}.manifest"; cp "$mA" "$work/mA"; cp "$mA.sig" "$work/mA.sig"; cp "$A" "$work/A"
step "F1 negative"
sed -i 's/^rows|employee|5/rows|employee|6/' "$mA"; neg "sua so dong"; cp "$work/mA" "$mA"
sed -i "s/^db=$db/db=siscom_crm_prod/" "$mA"; neg "sua ten DB"; cp "$work/mA" "$mA"
sed -i 's/^plain_sha256=./plain_sha256=0/' "$mA"; neg "sua hash"; cp "$work/mA" "$mA"
rm -f "$mA"; neg "xoa manifest"; cp "$work/mA" "$mA"
rm -f "$mA.sig"; neg "xoa chu ky"; cp "$work/mA.sig" "$mA.sig"
ssh-keygen -q -t ed25519 -N '' -f "$work/evil" >/dev/null; sed -i 's/^rows|employee|5/rows|employee|6/' "$mA"; rm -f "$mA.sig"
ssh-keygen -q -Y sign -f "$work/evil" -n siscom-crm-backup "$mA" >/dev/null 2>&1; neg "ky bang khoa la"; cp "$work/mA" "$mA"; cp "$work/mA.sig" "$mA.sig"
sleep 1; bash "$lin/backup-db.sh" >/dev/null 2>&1   # ban B hop le, cung khoa
B="$(find "$work/bk" -name "${db}_*.dump*" ! -name '*.sha256' ! -name '*.txt' | sort | tail -n1)"; [ "$B" != "$A" ] || { echo "KHONG tao duoc ban B"; exit 1; }
mB="${B%.dump*}.manifest"
cp "$B" "$A"; neg "chi thay file sao luu bang ban B"; cp "$work/A" "$A"
cp "$B" "$A"; cp "$mB" "$mA"; cp "$mB.sig" "$mA.sig"; ( cd "$work/bk" && sha256sum "$(basename "$A")" > "$(basename "$A").sha256" )
neg "thay CA bo (file+manifest+chu ky+sha256) bang ban B"; cp "$work/A" "$A"; cp "$work/mA" "$mA"; cp "$work/mA.sig" "$mA.sig"
step "khoi phuc lai bo goc => PASS"
bash "$lin/restore-test.sh" "${ident[@]}" --dump "$A" 2>&1 | grep -E 'PASS|^\[LOI\]' | cut -c1-110

if [ "${#ident[@]}" -gt 0 ]; then
  step "SEC-02: con bo plaintext (.dump) khi dang ma hoa => ban .age moi van tao, nhung thoat != 0, khong xoa plaintext"
  sleep 1; SISCOM_BACKUP_NO_ENCRYPT=yes bash "$lin/backup-db.sh" >/dev/null 2>&1 || { echo "KHONG DAT: khong tao duoc bo plaintext"; exit 1; }
  P="$(find "$work/bk" -name "${db}_*.dump" | sort | tail -n1)"; [ -n "$P" ] || { echo "KHONG DAT: khong thay bo plaintext"; exit 1; }
  sleep 1; nage_before="$(find "$work/bk" -name "${db}_*.dump.age" | wc -l)"
  if bash "$lin/backup-db.sh" > "$work/sec02.out" 2>&1; then echo "KHONG DAT: sao luu ma hoa thoat 0 du con plaintext"; exit 1; fi
  grep -qF "$(basename "$P")" "$work/sec02.out" || { echo "KHONG DAT: khong liet ke plaintext"; exit 1; }
  [ -e "$P" ] || { echo "KHONG DAT: plaintext bi xoa ma khong co chinh sach"; exit 1; }
  [ "$(find "$work/bk" -name "${db}_*.dump.age" | wc -l)" -gt "$nage_before" ] || { echo "KHONG DAT: khong tao ban .age moi"; exit 1; }
  grep -E '^\[LOI\]' "$work/sec02.out" | head -n2 | cut -c1-140; echo "dat (thoat != 0, liet ke, giu plaintext, co ban .age moi)"
  step "SEC-02: SISCOM_BACKUP_PLAINTEXT=keep => thoat 0 + canh bao; =purge => xoa du bo plaintext"
  sleep 1; SISCOM_BACKUP_PLAINTEXT=keep bash "$lin/backup-db.sh" > "$work/keep.out" 2>&1 || { tail -5 "$work/keep.out"; echo "KHONG DAT: keep"; exit 1; }
  grep -q 'CANH BAO' "$work/keep.out" && [ -e "$P" ] || { echo "KHONG DAT: keep khong canh bao/khong giu"; exit 1; }
  sleep 1; SISCOM_BACKUP_PLAINTEXT=purge bash "$lin/backup-db.sh" > "$work/purge.out" 2>&1 || { tail -5 "$work/purge.out"; echo "KHONG DAT: purge"; exit 1; }
  stemP="${P%.dump}"; for x in "$P" "$P.sha256" "$stemP.manifest" "$stemP.manifest.sig"; do [ ! -e "$x" ] || { echo "KHONG DAT: purge con $x"; exit 1; }; done
  [ -z "$(find "$work/bk" -name "${db}_*.dump")" ] || { echo "KHONG DAT: van con plaintext sau purge"; exit 1; }
  echo "dat (keep: canh bao + giu; purge: xoa du bo plaintext, con $(find "$work/bk" -name "${db}_*.dump.age" | wc -l) bo .age)"
fi

if [ -f "$work/opt/current/backend/dist/main.js" ] && [ -n "${BOOTSTRAP_PASSWORD_SYSADMIN:-}" ]; then
  bport="${BACKEND_PORT:-39171}"
  # backend_smoke <SISCOM_HOST>: ghi lai env bang create-db.sh (CORS/AUTH_ALLOWED_ORIGINS = https://<host>), chay backend production,
  # dang nhap (argon2 verify that) roi dang xuat: Origin la => 403, Origin https://<host> + X-CSRF-Token => thanh cong.
  backend_smoke() {
    local h="$1" bpid hd bad good wrong right sid csrf
    SISCOM_HOST="$h" bash "$lin/create-db.sh" "$db" env 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-110
    grep -qx "CORS_ORIGINS=https://$h" "$work/etc/backend.env" && grep -qx "AUTH_ALLOWED_ORIGINS=https://$h" "$work/etc/backend.env" \
      || { echo "KHONG DAT: backend.env khong co origin https://$h"; exit 1; }
    ( set -a; . "$work/etc/backend.env"; set +a
      export NODE_ENV=production HOST=127.0.0.1 PORT="$bport" TRUST_PROXY=loopback COOKIE_SECURE=true EXPORT_GAP_LOG_DIR="$work/export-gap"
      cd "$work/opt/current/backend" && exec node dist/main.js ) > "$work/backend.log" 2>&1 &
    bpid=$!
    for _ in $(seq 1 30); do curl -fsS --max-time 2 "http://127.0.0.1:$bport/api/v1/health" >/dev/null 2>&1 && break; sleep 1; done
    hd="$(curl -fsS "http://127.0.0.1:$bport/api/v1/health/database" || true)"
    login() { curl -s -o /dev/null -D "$work/h.txt" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Origin: https://$h" \
                --data "{\"login\":\"sysadmin@rehearsal.test\",\"password\":\"$1\"}" "http://127.0.0.1:$bport/api/v1/auth/login"; }
    bad="$(login "sai-mat-khau-123")"; good="$(login "$BOOTSTRAP_PASSWORD_SYSADMIN")"
    sid="$(grep -i '^set-cookie: *siscom_sid=' "$work/h.txt" | head -n1 | sed -E 's/^[^:]*: *siscom_sid=([^;]*).*/\1/' | tr -d '\r')"
    csrf="$(grep -i '^set-cookie: *siscom_csrf=' "$work/h.txt" | head -n1 | sed -E 's/^[^:]*: *siscom_csrf=([^;]*).*/\1/' | tr -d '\r')"
    logout() { curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $1" -H "X-CSRF-Token: $csrf" -H "Cookie: siscom_sid=$sid; siscom_csrf=$csrf" \
                 "http://127.0.0.1:$bport/api/v1/auth/logout"; }
    wrong="$(logout "https://khac.example.net")"; right="$(logout "https://$h")"
    kill "$bpid" 2>/dev/null || true; wait "$bpid" 2>/dev/null || true
    echo "[$h] health/database: $(printf '%s' "$hd" | grep -o '"migrated":[a-z]*'), $(printf '%s' "$hd" | grep -o '"leastPrivilege":[a-z]*')"
    echo "[$h] dang nhap sai => $bad ; dung => $good ; cookie Secure: $(grep -ci '^set-cookie:.*secure' "$work/h.txt") ; dang xuat Origin la => $wrong ; Origin https://$h => $right"
    printf '%s' "$hd" | grep -q '"migrated":true' && [ "$bad" = 401 ] && [ "$good" = 200 ] && grep -qi '^set-cookie:.*secure' "$work/h.txt" \
      && [ "$wrong" = 403 ] && [[ "$right" =~ ^20[04]$ ]] \
      || { tail -20 "$work/backend.log"; echo "KHONG DAT: backend production voi SISCOM_HOST=$h"; exit 1; }
    echo "dat"
  }
  step "backend production: SISCOM_HOST la TEN MIEN (mac dinh)"; backend_smoke crm-staging.siscom.io.vn
  step "backend production: SISCOM_HOST la IPv4 (phuong an phu) - doi host chi can chay lai env"; backend_smoke 42.96.15.235
fi
step "drop DB (lam lai)"
bash "$lin/create-db.sh" "$db" drop --yes-drop "$db" 2>&1 | grep -E '^\[(OK|LOI)\]'
echo; echo "DIEN TAP HOAN TAT: moi buoc dat. Da dung cum tam va xoa thu muc tam."
