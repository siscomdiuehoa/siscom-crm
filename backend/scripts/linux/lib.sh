#!/usr/bin/env bash
# SISCOM CRM - ham dung chung cho script Linux (VPS). CHI "source", khong chay truc tiep.
# Khong in mat khau/URL. Khong doc .env cua nguoi dung. Thong diep tieng Viet khong dau (an toan locale SSH).

SISCOM_ETC="${SISCOM_ETC:-/etc/siscom-crm}"
SISCOM_OPT="${SISCOM_OPT:-/opt/siscom-crm}"
SISCOM_BACKUP_DIR="${SISCOM_BACKUP_DIR:-/var/backups/siscom-crm}"
SISCOM_PG_HOST="${SISCOM_PG_HOST:-127.0.0.1}"
SISCOM_PG_PORT="${SISCOM_PG_PORT:-5432}"

info() { printf '[OK] %s\n' "$*"; }
warn() { printf '[CANH BAO] %s\n' "$*" >&2; }
die()  { printf '[LOI] %s\n' "$*" >&2; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "Can chay bang root (sudo)."; }
require_cmd() { local c; for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "Thieu lenh: $c"; done; }

# --- Ten database: CHI 2 ten van hanh co dinh; moi ten khac bi tu choi (khong bao gio dung DB la, siscom_crm_dev, baseline...). ---
# staging/prod: DB van hanh tren VPS. restore: DB thu khoi phuc (chi restore-test.sh tao).
is_ops_db()     { [[ "${1:-}" =~ ^siscom_crm_(staging|prod)$ ]]; }
is_restore_db() { [[ "${1:-}" =~ ^siscom_crm_restore_[0-9]{8}_[0-9]{6}$ ]]; }
require_ops_db() { is_ops_db "${1:-}" || die "TU CHOI: ten database '${1:-}' khong hop le (chi siscom_crm_staging hoac siscom_crm_prod)."; }
db_kind() { case "$1" in siscom_crm_staging) echo staging ;; siscom_crm_prod) echo prod ;; *) return 1 ;; esac; }

# Ten role co dinh (cluster-wide, dung chung giua staging va prod tren cung VPS).
# shellcheck disable=SC2034  # dung o cac script goi lib.sh
ROLE_MIGRATOR=siscom_migrator
# shellcheck disable=SC2034
ROLE_APP=siscom_app
# shellcheck disable=SC2034
ROLE_AUTH=siscom_auth

# --- Chay psql bang superuser postgres. Mac dinh: peer qua runuser (khong mat khau). ---
# SISCOM_REHEARSAL=1 (CHI de dien tap tren PostgreSQL tam): dung PGHOST/PGPORT/PGUSER/PGPASSWORD cua moi truong; tu choi cong 5432/55433.
psql_su() {
  if [ "${SISCOM_REHEARSAL:-}" = 1 ]; then
    case "${PGPORT:-}" in ''|5432|55433) die "SISCOM_REHEARSAL: cong '${PGPORT:-}' khong duoc phep (chi PostgreSQL tam, cong la)." ;; esac
    [ "${PGHOST:-}" = 127.0.0.1 ] || die "SISCOM_REHEARSAL: PGHOST phai la 127.0.0.1."
    psql -X -q -v ON_ERROR_STOP=1 "$@"
  else
    runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"
  fi
}

# Chay mot file SQL qua STDIN voi cac bien psql "mat khau/ten" dat bang \set (KHONG qua tham so dong lenh => khong lo trong ps).
# run_sql_file <db> <file> [ten=gia_tri ...]   (gia tri khong duoc chua dau nhay don)
run_sql_file_su() {
  local db="$1" file="$2"; shift 2
  [ -f "$file" ] || die "Thieu file SQL: $file"
  local kv
  { for kv in "$@"; do
      [[ "${kv#*=}" != *"'"* ]] || die "Gia tri bien SQL khong duoc chua dau nhay don."
      printf '\set %s '"'"'%s'"'"'\n' "${kv%%=*}" "${kv#*=}"
    done
    cat "$file"
  } | psql_su -d "$db" -f -
}

# Doc bien KEY tu mot file env dang KEY=VALUE (khong source, khong thuc thi). In gia tri ra stdout.
env_get() { # env_get <file> <KEY>
  local line; line="$(grep -E "^$2=" "$1" 2>/dev/null | tail -n1)" || true
  [ -n "$line" ] || return 1
  printf '%s' "${line#*=}"
}

# File chua bi mat phai la 600, chu root.
assert_private_file() {
  [ -f "$1" ] || die "Thieu file: $1"
  local mode owner
  mode="$(stat -c '%a' "$1")"; owner="$(stat -c '%U' "$1")"
  if [ "$mode" != 600 ]; then if [ "${SISCOM_REHEARSAL:-}" = 1 ]; then warn "File $1 quyen $mode (dien tap: bo qua; VPS that phai 600)."; else die "File $1 phai co quyen 600 (hien $mode)."; fi; fi
  [ "$owner" = root ] || [ "${SISCOM_REHEARSAL:-}" = 1 ] || die "File $1 phai thuoc root (hien $owner)."
}

# URL postgres -> ten DB (khong in mat khau).
url_dbname() { local p="${1#*://}"; p="${p#*@}"; p="${p#*/}"; printf '%s' "${p%%\?*}"; }

# --- Giu ban sao luu: <daily> ban moi nhat + moi tuan (ISO) giu ban moi nhat cua <weekly> tuan gan nhat (hop cua hai tap). ---
# stdin: moi dong 1 ten file <db>_YYYYMMDD_HHMMSS.dump[.age]; stdout: cac ten file PHAI GIU. Ten sai dinh dang bi bo qua (khong bao gio xoa).
retention_keep() {
  local daily="$1" weekly="$2" f d wk n=0 w=0
  local -A keep=() seen=()
  local re='^(.+)_([0-9]{8})_([0-9]{6})\.dump(\.age)?$'
  while IFS= read -r f; do
    [[ "$f" =~ $re ]] || continue
    n=$((n + 1)); [ "$n" -le "$daily" ] && keep["$f"]=1
    d="${BASH_REMATCH[2]}"
    wk="$(date -u -d "${d:0:4}-${d:4:2}-${d:6:2}" +%G-%V)"
    if [ -z "${seen[$wk]:-}" ] && [ "$w" -lt "$weekly" ]; then seen["$wk"]=1; w=$((w + 1)); keep["$f"]=1; fi
  done < <(sort -r)
  for f in "${!keep[@]}"; do printf '%s\n' "$f"; done | sort
}

# --- F1 (PR232-R1): XAC THUC bo sao luu. ---
# age chi ma hoa (ai co khoa CONG KHAI cung tao duoc ban .age hop le) va SHA-256 khong khoa khong chong sua doi => manifest duoc KY bang
# khoa rieng ed25519 cua MAY CHU (ssh-keygen -Y sign, namespace rieng); manifest chua ten + SHA-256 cua file sao luu nen chu ky rang buoc
# ca file lan manifest. Xac thuc bang allowed_signers (khoa cong khai; Owner giu them 1 ban ngoai VPS de kiem ban sao ngoai may chu).
# Gioi han: ai co root tren VPS doc duoc khoa ky => chu ky chong sua o kho sao luu/ban sao ngoai, KHONG chong may chu bi chiem quyen.
BACKUP_SIG_NS=siscom-crm-backup
backup_sign() { # backup_sign <manifest> <khoa rieng> -> <manifest>.sig
  rm -f "$1.sig"
  ssh-keygen -q -Y sign -f "$2" -n "$BACKUP_SIG_NS" "$1" >/dev/null 2>&1 && [ -s "$1.sig" ]
}
# verify_backup_set <file .dump.age|.dump> <allowed_signers> <ten DB mong doi>: 0 = hop le; ly do tu choi in ra stderr.
verify_backup_set() {
  local f="$1" allowed="$2" want="$3" dir base stem man got
  dir="$(dirname "$f")"; base="$(basename "$f")"
  case "$base" in *.dump.age) stem="${base%.dump.age}" ;; *.dump) stem="${base%.dump}" ;; *) printf '[LOI] duoi file la: %s\n' "$base" >&2; return 1 ;; esac
  is_ops_db "$want" || { printf '[LOI] ten DB mong doi khong hop le\n' >&2; return 1; }
  [[ "$stem" =~ ^${want}_[0-9]{8}_[0-9]{6}$ ]] || { printf '[LOI] ten file %s khong thuoc DB %s\n' "$base" "$want" >&2; return 1; }
  man="$dir/$stem.manifest"
  [ -f "$f" ] || { printf '[LOI] thieu file sao luu\n' >&2; return 1; }
  [ -f "$man" ] || { printf '[LOI] thieu manifest %s\n' "$(basename "$man")" >&2; return 1; }
  [ -f "$man.sig" ] || { printf '[LOI] thieu chu ky %s.sig\n' "$(basename "$man")" >&2; return 1; }
  [ -s "$allowed" ] || { printf '[LOI] thieu/rong allowed_signers: %s\n' "$allowed" >&2; return 1; }
  ssh-keygen -q -Y verify -f "$allowed" -I "$BACKUP_SIG_NS" -n "$BACKUP_SIG_NS" -s "$man.sig" < "$man" >/dev/null 2>&1 \
    || { printf '[LOI] chu ky manifest KHONG hop le (manifest bi sua hoac ky bang khoa khong duoc tin)\n' >&2; return 1; }
  # Tu day manifest da xac thuc: doi chieu voi file thuc te va DB mong doi. Moi truong khoa xuat hien dung 1 lan.
  [ "$(grep -c '^db=' "$man")" = 1 ] && [ "$(grep -c '^file=' "$man")" = 1 ] && [ "$(grep -c '^file_sha256=' "$man")" = 1 ] \
    || { printf '[LOI] manifest thieu/trung truong db/file/file_sha256\n' >&2; return 1; }
  [ "$(env_get "$man" db)" = "$want" ] || { printf '[LOI] manifest thuoc DB khac\n' >&2; return 1; }
  [ "$(env_get "$man" file)" = "$base" ] || { printf '[LOI] manifest mo ta file khac\n' >&2; return 1; }
  got="$(sha256sum "$f" | cut -d' ' -f1)"
  [ "$(env_get "$man" file_sha256)" = "$got" ] || { printf '[LOI] SHA-256 file sao luu khac manifest da ky\n' >&2; return 1; }
  return 0
}

# --- F3 (PR232-R1): kiem ban build TRUOC khi dua vao chay: argon2 (prebuild, cai bang npm ci --ignore-scripts) phai hash + verify
# duoc tren chinh may nay; Prisma CLI chay duoc. Khong cham DB, khong doc env bi mat.
backend_runtime_smoke() { # backend_runtime_smoke <thu muc backend>
  ( cd "$1" || exit 1
    node -e '
      const a = require("argon2");
      const pw = "siscom-smoke-" + process.pid;
      (async () => {
        const h = await a.hash(pw);
        if (!h.startsWith("$argon2id$")) throw new Error("hash khong phai argon2id");
        if (!(await a.verify(h, pw))) throw new Error("verify mat khau dung that bai");
        if (await a.verify(h, pw + "x")) throw new Error("verify mat khau sai van dung");
        console.log("[OK] argon2 hash/verify (" + process.platform + "-" + process.arch + ", node " + process.versions.node + ")");
      })().catch((e) => { console.error("[LOI] argon2: " + e.message); process.exit(1); });
    ' || exit 1
    v="$(env -u MIGRATE_DATABASE_URL DATABASE_URL=postgresql://ci_placeholder@127.0.0.1:1/x npx --no-install prisma --version 2>/dev/null | grep -Ei '^prisma ' | head -n1)" || true
    [ -n "$v" ] || { echo "[LOI] Prisma CLI khong chay duoc." >&2; exit 1; }
    echo "[OK] $v" )
}

# Tao thu muc rieng tu (700). Dien tap tren Windows/Git Bash: install -m khong doi duoc ACL => chi khi SISCOM_REHEARSAL=1 moi chap nhan mkdir -p.
private_dir() {
  install -d -m 700 "$1" 2>/dev/null && return 0
  if [ "${SISCOM_REHEARSAL:-}" = 1 ]; then mkdir -p "$1"; else die "Khong tao duoc thu muc rieng tu $1."; fi
}
