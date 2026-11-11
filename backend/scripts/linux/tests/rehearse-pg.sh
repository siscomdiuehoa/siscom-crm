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
export SISCOM_ETC="$work/etc" SISCOM_OPT="$work/opt" SISCOM_BACKUP_DIR="$work/bk" SISCOM_DOMAIN=crm.example.vn
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
bash "$lin/backup-db.sh" 2>&1 | grep -E '^\[(OK|LOI)\]' | cut -c1-110
step "restore-test (phai PASS)"
bash "$lin/restore-test.sh" "${ident[@]}" 2>&1 | grep -E '^\[(OK|LOI)\]|KHAC' | cut -c1-110
step "restore-test voi manifest bi sua (phai KHONG DAT)"
m="$(find "$work/bk" -name '*.manifest' | head -n1)"; sed -i 's/^rows|employee|5/rows|employee|6/' "$m"
if bash "$lin/restore-test.sh" "${ident[@]}" >"$work/neg.out" 2>&1; then echo "KHONG DAT: manifest sai van PASS"; exit 1; else grep -E 'KHAC|KHONG DAT' "$work/neg.out" | cut -c1-110; echo "dat (that bai dung nhu mong doi)"; fi
step "drop DB (lam lai)"
bash "$lin/create-db.sh" "$db" drop --yes-drop "$db" 2>&1 | grep -E '^\[(OK|LOI)\]'
echo; echo "DIEN TAP HOAN TAT: moi buoc dat. Da dung cum tam va xoa thu muc tam."
