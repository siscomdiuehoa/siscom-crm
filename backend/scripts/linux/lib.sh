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

# --- SSH (VPS that dung cong 26266): KHONG doi cau hinh cong cua sshd; chi DOC cong dang dung de mo dung cong tren ufw/fail2ban. ---
# sshd_ports: in cac cong SSH (moi cong 1 dong, tang dan, khong trung) tu `sshd -T`; Ubuntu 24.04 co the nghe qua ssh.socket
# => cong ListenStream cua ssh.socket (neu dang chay) cung duoc gop vao. That bai (ma 1) neu khong doc duoc / co gia tri la.
sshd_ports() {
  local out p ports=()
  if ! out="$(sshd -T 2>&1)"; then
    printf '[LOI] sshd -T: %s\n' "$(printf '%s\n' "$out" | head -n 2 | tr '\n' ' ')" >&2
    return 1
  fi
  while IFS= read -r p; do ports+=("$p"); done < <(printf '%s\n' "$out" | awk 'tolower($1) == "port" { print $2 }')
  if systemctl is-active --quiet ssh.socket 2>/dev/null; then
    while IFS= read -r p; do ports+=("$p"); done < <(systemctl show ssh.socket -p Listen --value 2>/dev/null | grep -Eo ':[0-9]+ ' | tr -d ': ')
  fi
  [ "${#ports[@]}" -ge 1 ] || return 1
  for p in "${ports[@]}"; do
    [[ "$p" =~ ^[0-9]{1,5}$ ]] && [ "$p" -ge 1 ] && [ "$p" -le 65535 ] || return 1
  done
  printf '%s\n' "${ports[@]}" | sort -nu
}
# sshd_include_first <sshd_config>: 0 neu dong `Include .../sshd_config.d/*.conf` dung TRUOC moi dong xac thuc/Match dang hoat dong.
# OpenSSH lay gia tri DAU TIEN => drop-in chi co hieu luc khi duoc Include truoc cac dong PasswordAuthentication/PermitRootLogin... cua file chinh.
sshd_include_first() {
  [ -f "$1" ] || return 1
  [ "$(awk '
    /^[[:space:]]*(#|$)/ { next }
    { k = tolower($1) }
    k == "include" && $2 ~ /sshd_config\.d\/\*\.conf$/ { print "ok"; exit }
    k ~ /^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication|challengeresponseauthentication|authenticationmethods|pubkeyauthentication|match)$/ { print "bad"; exit }
  ' "$1")" = ok ]
}
# count_authorized_keys <file>: so khoa cong khai HOP LE (ssh-keygen doc duoc) trong authorized_keys; 0 neu khong co file.
count_authorized_keys() {
  local f="$1" n=0 line
  [ -f "$f" ] || { echo 0; return 0; }
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    if printf '%s\n' "$line" | ssh-keygen -l -f - >/dev/null 2>&1; then n=$((n + 1)); fi
  done < "$f"
  echo "$n"
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

# backup_dir_ensure <thu muc sao luu>: CHUA co => tao 700 (private_dir). DA co => KHONG chmod lai (chmod/install -m 700 dat lai ACL mask ve ---
# => mat quyen doc cua tai khoan chi-doc backup-pull, xem setup-backup-pull.sh); chi KIEM, sai thi tu choi: thu muc that (khong symlink),
# thuoc nguoi chay, 'other' = 0, bit group != 0 chi khi co ACL, va khong ai (group/ACL) co quyen GHI.
backup_dir_ensure() {
  local d="$1" perm g
  if [ ! -e "$d" ] && [ ! -L "$d" ]; then private_dir "$d"; return; fi
  { [ -d "$d" ] && [ ! -L "$d" ]; } || die "TU CHOI: $d khong phai thu muc that."
  [ "${SISCOM_REHEARSAL:-}" = 1 ] && return 0
  perm="$(stat -c '%a' "$d")"; g="${perm: -2:1}"
  [ "$(stat -c '%u' "$d")" = "$(id -u)" ] || die "TU CHOI: $d khong thuoc $(id -un)."
  [ "${perm: -1}" = 0 ] || die "TU CHOI: $d cho 'other' quyen ($perm). Sua: chmod o= $d"
  (( (g & 2) == 0 )) || die "TU CHOI: $d cho group/ACL quyen GHI ($perm)."
  if [ "$g" != 0 ] && ! ls -ld "$d" | awk '{print $1}' | grep -q '+$'; then die "TU CHOI: $d cho group quyen ($perm) khong qua ACL. Sua: chmod g= $d"; fi
  return 0
}

# --- SISCOM_HOST: ten mien (mac dinh, Let's Encrypt 90 ngay) HOAC IPv4 cong khai (phuong an phu: profile shortlived ~6 ngay). ---
# host_kind <host>: in "domain" | "ipv4"; that bai neu sai dinh dang hoac IPv4 khong cong khai (rieng/loopback/CGNAT/multicast...).
host_kind() {
  local h="${1:-}" o a b
  if [[ "$h" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
    local -a m=("${BASH_REMATCH[@]}")   # [[ =~ ]] trong vong lap ghi de BASH_REMATCH => chep truoc
    for o in "${m[@]:1:4}"; do [[ "$o" =~ ^(0|[1-9][0-9]{0,2})$ ]] && [ "$o" -le 255 ] || return 1; done
    a="${m[1]}"; b="${m[2]}"
    { [ "$a" -eq 0 ] || [ "$a" -eq 10 ] || [ "$a" -eq 127 ] || [ "$a" -ge 224 ] \
      || { [ "$a" -eq 169 ] && [ "$b" -eq 254 ]; } || { [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; } \
      || { [ "$a" -eq 192 ] && [ "$b" -eq 168 ]; } || { [ "$a" -eq 100 ] && [ "$b" -ge 64 ] && [ "$b" -le 127 ]; }; } && return 1
    echo ipv4
  elif [ "${#h}" -le 253 ] && [[ "$h" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
    echo domain
  else
    return 1
  fi
}
# version_ge <a> <b>: 0 neu phien ban a >= b (dang X.Y.Z).
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }
# public_ipv4: SISCOM_PUBLIC_IP neu dat, nguoc lai dia chi nguon cua tuyen ra Internet (`ip -4 route get 1.1.1.1`). Phai la IPv4 cong khai.
public_ipv4() {
  local ip="${SISCOM_PUBLIC_IP:-}"
  [ -n "$ip" ] || ip="$(ip -4 -o route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }')"
  [ "$(host_kind "$ip" 2>/dev/null)" = ipv4 ] || return 1
  echo "$ip"
}
# dns_a_records <ten mien>: cac ban ghi A (moi dong 1, sap xep). Uu tien `dig` (bo qua /etc/hosts), khong co thi getent ahostsv4.
dns_a_records() {
  if command -v dig >/dev/null 2>&1; then
    { dig +short +time=3 +tries=2 A "$1" 2>/dev/null || true; } | { grep -E '^[0-9]+(\.[0-9]+){3}$' || true; } | sort -u
  else
    { getent ahostsv4 "$1" 2>/dev/null || true; } | awk '{ print $1 }' | sort -u
  fi
}
# caddy_version_check <domain|ipv4-acme|ipv4-internal>: in phien ban; ipv4-acme can >= 2.10 (subdirective `profile` cua issuer acme).
caddy_version_check() {
  local v
  v="$(caddy version 2>/dev/null | grep -Eo '^v?[0-9]+\.[0-9]+\.[0-9]+' | head -n1 | tr -d v)"
  [ -n "$v" ] || { printf '[LOI] Khong doc duoc phien ban Caddy (`caddy version`).\n' >&2; return 1; }
  echo "[OK] Caddy $v"
  if [ "$1" = ipv4-acme ]; then
    version_ge "$v" 2.10.0 || { printf '[LOI] Caddy %s < 2.10: chua co `profile` cho issuer acme => khong xin duoc chung chi IP (profile shortlived).\n' "$v" >&2; return 1; }
    version_ge "$v" 2.11.0 || warn "Caddy $v: loi xin chung chi IP voi Let's Encrypt (caddyserver/caddy#7399) da duoc sua SAU 2.10.0 (chua xac dinh dung ban). Nen dung ban moi nhat."
  elif ! version_ge "$v" 2.10.0; then
    warn "Caddy $v cu (< 2.10). Nen cap nhat."
  fi
}
# days_until <ngay kieu openssl notAfter>: so ngay (lam tron xuong) tu bay gio den ngay do; am neu da qua.
days_until() {
  local end now; end="$(date -u -d "$1" +%s 2>/dev/null)" || return 1; now="$(date -u +%s)"
  echo $(( (end - now) / 86400 ))
}

# --- SEC-01 (PR232-R2): tuong lua ufw CHI gom cong SSH dang dung + 80 + 443, kiem ke rule CO SAN va TOAN BO tap rule sau khi bat. ---
# Khong bao gio tu xoa/reset rule cua Owner: gap rule la => dung (fail-closed) va huong dan.
# ufw_allowlist <cong SSH csv>: cac dong `ufw show added` hop le (sap xep).
ufw_allowlist() {
  local p; local -a ps; IFS=, read -ra ps <<<"$1"
  { for p in "${ps[@]}" 80 443; do printf 'ufw allow %s/tcp\n' "$p"; done; } | sort -u
}
# ufw_foreign_added <cong SSH csv>: doc `ufw show added` tu stdin, in cac rule KHONG thuoc allowlist.
ufw_foreign_added() {
  local allow; allow="$(ufw_allowlist "$1")"
  grep -E '^ufw ' | while IFS= read -r line; do
    printf '%s\n' "$allow" | grep -qxF "$line" || printf '%s\n' "$line"
  done
}
# ufw_status_problems <cong SSH csv>: doc `ufw status verbose` tu stdin; in moi van de (rong = dung allowlist, deny incoming, active).
ufw_status_problems() {
  local csv="$1" st p; local -a ps; IFS=, read -ra ps <<<"$csv"
  st="$(cat)"
  printf '%s\n' "$st" | grep -qx 'Status: active' || echo "ufw khong o trang thai active"
  printf '%s\n' "$st" | grep -E '^Default:' | grep -q 'deny (incoming)' || echo "mac dinh incoming khong phai deny"
  local rules allowed line
  rules="$(printf '%s\n' "$st" | awk 'f && NF { print } /^--/ { f = 1 }' | sed -E 's/ \(v6\)//g; s/[[:space:]]+/ /g; s/ $//' | sort -u)"
  allowed="$(for p in "${ps[@]}" 80 443; do printf '%s/tcp ALLOW IN Anywhere\n' "$p"; done | sort -u)"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    printf '%s\n' "$allowed" | grep -qxF "$line" || echo "rule la: $line"
  done <<<"$rules"
  for p in "${ps[@]}"; do
    printf '%s\n' "$rules" | grep -qxF "$p/tcp ALLOW IN Anywhere" || echo "THIEU_SSH: $p/tcp"
  done
}
# ufw_apply <dry 0|1> <cong SSH csv>: kiem ke -> them allowlist -> default -> kiem ke lai -> bat -> kiem toan bo trang thai.
ufw_apply() {
  local dry="$1" csv="$2" p added foreign probs; local -a ps; IFS=, read -ra ps <<<"$csv"
  if ! command -v ufw >/dev/null 2>&1; then
    [ "$dry" = 1 ] && { echo "[DRY] ufw chua cai: kiem ke rule co san se chay khi chay that (sau buoc apt)"; for p in "${ps[@]}" 80 443; do echo "[DRY] ufw allow ${p}/tcp"; done; return 0; }
    printf '[LOI] Khong co lenh ufw.\n' >&2; return 1
  fi
  added="$(ufw show added 2>&1)" || { printf '[LOI] Khong doc duoc `ufw show added`.\n' >&2; return 1; }
  foreign="$(printf '%s\n' "$added" | ufw_foreign_added "$csv")"
  if [ -n "$foreign" ]; then
    printf '[LOI] ufw da co rule NGOAI allowlist (chi cho phep: %s/tcp, 80/tcp, 443/tcp). KHONG doi gi, KHONG tu xoa rule:\n' "${csv//,//tcp, }" >&2
    printf '%s\n' "$foreign" | sed 's/^/    /' >&2
    printf '  Owner tu xu ly: `ufw status numbered` roi `ufw delete <so>` (hoac giu lai va khong dung provision.sh cho tuong lua), sau do chay lai.\n' >&2
    return 1
  fi
  if [ "$dry" = 1 ]; then
    echo "[DRY] kiem ke ufw: khong co rule ngoai allowlist"
    for p in "${ps[@]}" 80 443; do echo "[DRY] ufw allow ${p}/tcp"; done
    echo "[DRY] ufw default deny incoming"; echo "[DRY] ufw default allow outgoing"
    echo "[DRY] kiem ke lai (ufw show added = allowlist)"; echo "[DRY] ufw --force enable"
    echo "[DRY] kiem ufw status: phai co ${csv}/tcp ALLOW; TOAN BO rule = allowlist; mac dinh deny incoming (thieu SSH => ufw --force disable va dung; rule la => dung)"
    return 0
  fi
  for p in "${ps[@]}" 80 443; do ufw allow "${p}/tcp" >/dev/null || { printf '[LOI] ufw allow %s/tcp loi.\n' "$p" >&2; return 1; }; done
  ufw default deny incoming >/dev/null && ufw default allow outgoing >/dev/null || { printf '[LOI] ufw default loi.\n' >&2; return 1; }
  foreign="$(ufw show added 2>&1 | ufw_foreign_added "$csv")"
  [ -z "$foreign" ] || { printf '[LOI] Rule la xuat hien truoc khi bat ufw; KHONG bat:\n%s\n' "$foreign" >&2; return 1; }
  ufw --force enable >/dev/null || { printf '[LOI] ufw --force enable loi.\n' >&2; return 1; }
  probs="$(ufw status verbose 2>&1 | ufw_status_problems "$csv")"
  if printf '%s\n' "$probs" | grep -q '^THIEU_SSH'; then
    ufw --force disable >/dev/null 2>&1 || true
    printf '[LOI] Sau khi bat, ufw KHONG cho phep cong SSH => da TAT lai ufw de giu truy cap:\n%s\n' "$probs" >&2; return 1
  fi
  if [ -n "$probs" ]; then
    printf '[LOI] Sau khi bat, trang thai ufw KHONG dung allowlist (ufw van bat, cong SSH van mo):\n%s\n' "$probs" | sed '2,$s/^/    /' >&2; return 1
  fi
  echo "[OK] ufw dang bat; TOAN BO rule = ${csv}/tcp, 80/tcp, 443/tcp (v4+v6); mac dinh deny incoming."
}

# --- SEC-02 (PR232-R2, dieu kien Owner 12/11): retention CHI tinh giu/xoa tren cac bo .dump.age cua DUNG DB (xoa du sidecar bo do).
# Bo .dump (plaintext) KHONG BAO GIO bi script xoa hay sua - ke ca khi qua han giu; chi phat hien + liet ke.
# backup_rm_age_set <thu muc> <ten file .dump.age>: xoa file + .sha256 + .restore-ok.txt + <stem>.manifest + <stem>.manifest.sig.
# R3-SEC02-01: <stem>.manifest/.manifest.sig DUNG CHUNG voi <stem>.dump neu trung stem => co <stem>.dump thi TU CHOI, khong xoa gi.
backup_rm_age_set() {
  local d="$1" f="$2" stem
  case "$f" in *.dump.age) stem="${f%.dump.age}" ;; *) return 1 ;; esac
  if [ -e "$d/$stem.dump" ]; then
    printf '[LOI] Khong xoa %s: co %s.dump cung stem (dung chung manifest/chu ky voi ban plaintext).\n' "$f" "$stem" >&2
    return 1
  fi
  rm -f -- "$d/$f" "$d/$f.sha256" "$d/$f.restore-ok.txt" "$d/$stem.manifest" "$d/$stem.manifest.sig"
}
# backup_prune <thu muc> <db> <ma hoa 0|1>
#   ma thoat: 0 = xong; 3 = (a) che do ma hoa ma CON >= 1 bo plaintext, hoac (b) co stem TRUNG (.dump va .dump.age cung ten goc) o bat ky
#   che do nao (da liet ke, KHONG xoa gi cua stem do) - lap lai MOI LAN cho toi khi Owner xu ly tay.
backup_prune() {
  local d="$1" db="$2" enc="$3" f stem
  local -a ages keep plains conflicts=()
  mapfile -t ages < <(find "$d" -maxdepth 1 -type f -printf '%f\n' | grep -E "^${db}_[0-9]{8}_[0-9]{6}\.dump\.age\$" | sort || true)
  [ -n "${ages[0]:-}" ] || ages=()
  # R3-SEC02-01: phat hien stem trung TRUOC khi retention xoa bat cu gi.
  for f in "${ages[@]}"; do stem="${f%.dump.age}"; [ -e "$d/$stem.dump" ] && conflicts+=("$stem"); done
  mapfile -t keep < <(printf '%s\n' "${ages[@]}" | retention_keep 14 8)
  for f in "${ages[@]}"; do
    printf '%s\n' "${keep[@]}" | grep -qxF "$f" && continue
    stem="${f%.dump.age}"
    if printf '%s\n' "${conflicts[@]}" | grep -qxF "$stem"; then continue; fi   # trung stem: KHONG xoa gi (ke ca .age)
    backup_rm_age_set "$d" "$f" && info "Da xoa bo .age cu: $f"
  done
  mapfile -t plains < <(find "$d" -maxdepth 1 -type f -printf '%f\n' | grep -E "^${db}_[0-9]{8}_[0-9]{6}\.dump\$" | sort || true)
  [ -n "${plains[0]:-}" ] || plains=()
  info "Con ${#keep[@]} bo .age (theo retention) va ${#plains[@]} bo plaintext cua $db; ${#conflicts[@]} stem trung."
  if [ "${#conflicts[@]}" -gt 0 ]; then
    printf '[LOI] %s stem co CA .dump va .dump.age (dung chung <stem>.manifest/.manifest.sig). Script KHONG xoa bat ky tep nao cua cac stem nay:\n' "${#conflicts[@]}" >&2
    printf '    %s\n' "${conflicts[@]}" >&2
  fi
  [ "${#plains[@]}" -eq 0 ] && [ "${#conflicts[@]}" -eq 0 ] && return 0
  if [ "$enc" = 0 ] && [ "${#conflicts[@]}" -eq 0 ]; then
    warn "Che do KHONG ma hoa: hien co ${#plains[@]} bo plaintext cua $db; retention KHONG xoa plaintext => se tich luy, can Owner xu ly tay (xem runbook)."
    return 0
  fi
  if [ "${#plains[@]}" -gt 0 ]; then
    printf '[LOI] Con %s bo sao luu KHONG ma hoa cua %s. Script KHONG xoa va KHONG bo qua:\n' "${#plains[@]}" "$db" >&2
    printf '    %s\n' "${plains[@]}" >&2
  fi
  printf '  Xu ly TAY, chi khi Owner phe duyet rieng: (1) co bo .age thay the qua verify_backup_set; (2) restore-test.sh --dump <bo .age> dat;\n' >&2
  printf '  (3) Owner xoa tay tung bo plaintext (.dump, .dump.sha256, .dump.restore-ok.txt, .manifest, .manifest.sig). Stem trung: Owner quyet giu bo nao. Xem docs/VPS_RUNBOOK.md G6.\n' >&2
  return 3
}

# --- DB-01 (PR232-R2): ba URL ket noi phai co du, dung dang, dung tai khoan, host loopback va CUNG mot DB van hanh. ---
# db_url_check <url> <tai khoan mong doi>: in ten DB neu hop le; KHONG in URL/mat khau.
db_url_check() {
  local re='^postgres(ql)?://([a-z_]+):([0-9a-f]{48})@(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})/([a-z0-9_]+)$'
  [[ "${1:-}" =~ $re ]] || return 1
  [ "${BASH_REMATCH[2]}" = "$2" ] || return 1
  printf '%s\n' "${BASH_REMATCH[6]}"
}
# load_db_env_triplet <backend.env> <migrate.env>: dat APP_URL, AUTH_URL, MIG_URL, DB_NAME. Loi => 1 + ly do (khong in URL).
load_db_env_triplet() {
  local be="$1" me="$2" a b m da db_ dm
  [ -f "$be" ] || { printf '[LOI] Thieu %s.\n' "$be" >&2; return 1; }
  [ -f "$me" ] || { printf '[LOI] Thieu %s.\n' "$me" >&2; return 1; }
  assert_private_file "$be"; assert_private_file "$me"
  a="$(env_get "$be" DATABASE_URL)" || { printf '[LOI] %s thieu DATABASE_URL.\n' "$be" >&2; return 1; }
  b="$(env_get "$be" AUTH_DATABASE_URL)" || { printf '[LOI] %s thieu AUTH_DATABASE_URL.\n' "$be" >&2; return 1; }
  m="$(env_get "$me" MIGRATE_DATABASE_URL)" || { printf '[LOI] %s thieu MIGRATE_DATABASE_URL.\n' "$me" >&2; return 1; }
  da="$(db_url_check "$a" "$ROLE_APP")" || { printf '[LOI] DATABASE_URL sai dang/tai khoan (can %s, mat khau 48 hex, host loopback).\n' "$ROLE_APP" >&2; return 1; }
  db_="$(db_url_check "$b" "$ROLE_AUTH")" || { printf '[LOI] AUTH_DATABASE_URL sai dang/tai khoan (can %s, mat khau 48 hex, host loopback).\n' "$ROLE_AUTH" >&2; return 1; }
  dm="$(db_url_check "$m" "$ROLE_MIGRATOR")" || { printf '[LOI] MIGRATE_DATABASE_URL sai dang/tai khoan (can %s, mat khau 48 hex, host loopback).\n' "$ROLE_MIGRATOR" >&2; return 1; }
  if [ "$da" != "$db_" ] || [ "$da" != "$dm" ]; then
    printf '[LOI] Ba URL tro DB khac nhau: DATABASE_URL=%s, AUTH_DATABASE_URL=%s, MIGRATE_DATABASE_URL=%s. Dung.\n' "$da" "$db_" "$dm" >&2; return 1
  fi
  is_ops_db "$da" || { printf '[LOI] TU CHOI: DB %s khong phai siscom_crm_staging|siscom_crm_prod.\n' "$da" >&2; return 1; }
  # shellcheck disable=SC2034  # dung o deploy.sh / run-cli.sh
  APP_URL="$a"
  # shellcheck disable=SC2034
  AUTH_URL="$b"
  # shellcheck disable=SC2034
  MIG_URL="$m"
  # shellcheck disable=SC2034
  DB_NAME="$da"
}
