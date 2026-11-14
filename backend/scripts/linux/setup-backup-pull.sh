#!/usr/bin/env bash
# SISCOM CRM - tao/go tai khoan CHI DOC `backup-pull` de may Windows cua Owner KEO ban sao luu MA HOA ve Google Drive
# (backend/scripts/windows/pull-backups.ps1). VPS KHONG giu mat khau/token Google nao.
#
#   sudo bash setup-backup-pull.sh --pubkey <file khoa cong khai ed25519 .pub> [--dry-run]
#   sudo bash setup-backup-pull.sh --remove [--dry-run]
#
# Lam gi (idempotent, chay lai duoc):
#   - user he thong `backup-pull`: shell /bin/sh (lenh ep buoc chay qua shell), mat khau '*' (khong dang nhap bang mat khau duoc),
#     home /var/lib/backup-pull (root:root 755, user KHONG ghi duoc).
#   - /var/lib/backup-pull/.ssh (root:backup-pull 750) + authorized_keys (root:backup-pull 640) DUNG 1 khoa:
#       restrict,command="/usr/lib/openssh/sftp-server -R -d <thu muc keo>" ssh-ed25519 ...
#     => chi chay duoc sftp-server CHE DO CHI DOC (-R): khong ghi/xoa/doi ten, khong shell, khong chuyen tiep cong, khong pty.
#   - Thu muc KEO rieng $SISCOM_PULL_DIR (mac dinh /var/backups/siscom-crm-pull, root:backup-pull 750). Chi chua LIEN KET CUNG (hard link,
#     khong ton dung luong) cua 4 tep moi bo MA HOA HOAN CHINH (root:backup-pull 640). backup-pull KHONG co quyen gi tren thu muc sao luu
#     chinh (root 700, khong ACL) => tep tam/.partial/.dump/tep khac o do khong bao gio doc duoc (PR235-R1-SEC-01).
#     Bo moi: backup-db.sh goi backup_pull_sync SAU KHI bo ma hoa hoan tat + tu kiem; bo bi retention xoa thi lien ket cung bi go.
# KHONG sua sshd_config, KHONG nap lai sshd, KHONG doi ufw/fail2ban (authorized_keys duoc doc moi lan dang nhap).
# Gioi han da biet: sftp-server -R khong chroot => van doc duoc cac tep ma moi nguoi deu doc duoc (vd /etc/passwd); KHONG doc duoc
# thu muc sao luu chinh, /etc/siscom-crm (700), /root, khoa ky sao luu.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

PULL_USER=backup-pull
PULL_HOME=/var/lib/backup-pull
SFTP_SERVER="${SISCOM_SFTP_SERVER:-/usr/lib/openssh/sftp-server}"
DIR="$SISCOM_BACKUP_DIR"
PDIR="$SISCOM_PULL_DIR"

DRY=0; MODE=""; PUBKEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pubkey) [ $# -ge 2 ] || die "--pubkey can duong dan file .pub"; MODE=add; PUBKEY="$2"; shift 2 ;;
    --remove) MODE=remove; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) die "Tham so la: $1" ;;
  esac
done
[ -n "$MODE" ] || die "Can --pubkey <file .pub> hoac --remove."

run() { if [ "$DRY" = 1 ]; then printf '[DRY] %s\n' "$*"; else "$@"; fi; }
safe_path() { [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "$1" != *..* ]] && [ "$1" != / ]; }

# Duong dan nam trong command="..." cua authorized_keys => chi ky tu an toan.
safe_path "$DIR" || die "TU CHOI: thu muc sao luu '$DIR' phai la duong dan tuyet doi chi gom [A-Za-z0-9._/-]."
safe_path "$PDIR" || die "TU CHOI: thu muc keo '$PDIR' phai la duong dan tuyet doi chi gom [A-Za-z0-9._/-]."
[ "${PDIR%/}" != "${DIR%/}" ] && [[ "${PDIR%/}/" != "${DIR%/}/"* ]] || die "TU CHOI: thu muc keo '$PDIR' phai KHAC va KHONG nam trong thu muc sao luu '$DIR'."
[[ "$SFTP_SERVER" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "TU CHOI: duong dan sftp-server la: $SFTP_SERVER"
if [ "$DRY" = 0 ]; then
  require_root
  require_cmd useradd usermod userdel runuser ln
fi

if [ "$MODE" = remove ]; then
  info "Go tai khoan $PULL_USER va thu muc keo $PDIR (ban sao luu trong $DIR KHONG bi xoa)"
  if [ -d "$PDIR" ] && [ ! -L "$PDIR" ]; then
    # Tra quyen tep trong thu muc chinh ve root 600 (lien ket cung chung inode) roi xoa thu muc keo.
    while IFS= read -r f; do run chown root:root "$PDIR/$f"; run chmod 600 "$PDIR/$f"; done < <(find "$PDIR" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')
    run rm -rf --one-file-system -- "$PDIR"
  fi
  if [ "$DRY" = 1 ] || id "$PULL_USER" >/dev/null 2>&1; then
    run pkill -u "$PULL_USER" || true
    run userdel "$PULL_USER"
  fi
  run rm -rf --one-file-system -- "$PULL_HOME"
  info "Da go. Kiem: id $PULL_USER (phai bao khong co); ls -ld $PDIR (khong con)."
  exit 0
fi

# --- add ---
[ -f "$PUBKEY" ] || die "Khong thay file khoa cong khai: $PUBKEY"
require_cmd ssh-keygen
mapfile -t klines < <(grep -v '^[[:space:]]*\(#\|$\)' "$PUBKEY" | tr -d '\r')
[ "${#klines[@]}" -eq 1 ] || die "TU CHOI: $PUBKEY phai co DUNG 1 dong khoa (dang co ${#klines[@]})."
k="${klines[0]}"
[[ "$k" =~ ^ssh-ed25519\ (AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]+={0,2})(\ .*)?$ ]] \
  || die "TU CHOI: chi nhan khoa ed25519 dang 'ssh-ed25519 AAAA... [ghi chu]' (khong tuy chon, khong RSA/khoa khac)."
kb="${BASH_REMATCH[1]}"
printf 'ssh-ed25519 %s\n' "$kb" > "${TMPDIR:-/tmp}/bp.$$.pub"
fp="$(ssh-keygen -l -f "${TMPDIR:-/tmp}/bp.$$.pub" 2>/dev/null | awk '{print $2}')" || true
rm -f "${TMPDIR:-/tmp}/bp.$$.pub"
[[ "$fp" =~ ^SHA256: ]] || die "TU CHOI: ssh-keygen khong doc duoc khoa trong $PUBKEY."
line="restrict,command=\"$SFTP_SERVER -R -d $PDIR\" ssh-ed25519 $kb siscom-backup-pull"

if [ "$DRY" = 0 ]; then
  [ -x "$SFTP_SERVER" ] || die "Khong thay $SFTP_SERVER (goi openssh-sftp-server)."
  { [ -d "$DIR" ] && [ ! -L "$DIR" ]; } || die "Chua co thu muc sao luu $DIR (chay backup-db.sh/provision.sh truoc)."
  { [ ! -e "$PDIR" ] && [ ! -L "$PDIR" ]; } || { [ -d "$PDIR" ] && [ ! -L "$PDIR" ]; } || die "TU CHOI: $PDIR da co nhung khong phai thu muc that."
  [ "$(stat -c %d "$DIR")" = "$(stat -c %d "$(dirname "$PDIR")")" ] || die "TU CHOI: $PDIR phai cung o dia voi $DIR (lien ket cung)."
fi

info "Khoa duoc cap: $fp; thu muc chi doc: $PDIR"
if [ "$DRY" = 0 ] && id "$PULL_USER" >/dev/null 2>&1; then
  IFS=: read -r _ _ uid _ _ h sh < <(getent passwd "$PULL_USER")
  [ "$h" = "$PULL_HOME" ] && [ "$uid" -lt 1000 ] || die "TU CHOI: user $PULL_USER da co nhung khong phai do script nay tao (home=$h uid=$uid). Kiem tay."
  [ "$sh" = /bin/sh ] || run usermod -s /bin/sh "$PULL_USER"
  info "User $PULL_USER da co"
else
  run useradd --system --user-group --home-dir "$PULL_HOME" --no-create-home --shell /bin/sh "$PULL_USER"
fi
run usermod -p '*' "$PULL_USER"
run install -d -m 755 -o root -g root "$PULL_HOME"
run install -d -m 750 -o root -g "$PULL_USER" "$PULL_HOME/.ssh"
if [ "$DRY" = 1 ]; then
  printf '[DRY] ghi %s (root:%s 640):\n      %s\n' "$PULL_HOME/.ssh/authorized_keys" "$PULL_USER" "$line"
else
  tmpk="$(mktemp)"; printf '%s\n' "$line" > "$tmpk"
  install -m 640 -o root -g "$PULL_USER" "$tmpk" "$PULL_HOME/.ssh/authorized_keys"; rm -f "$tmpk"
fi
run install -d -m 750 -o root -g "$PULL_USER" "$PDIR"

# Bo MA HOA HOAN CHINH dang co (du 4 tep, khong trung stem .dump) => lien ket cung sang thu muc keo.
mapfile -t stems < <(pull_complete_stems "$DIR")
if [ "$DRY" = 1 ]; then
  for st in "${stems[@]}"; do printf '[DRY] lien ket cung %s/%s.{dump.age,dump.age.sha256,manifest,manifest.sig} -> %s (root:%s 640)\n' "$DIR" "$st" "$PDIR" "$PULL_USER"; done
else
  backup_pull_sync "$DIR" || die "Khong dua duoc bo sao luu sang $PDIR."
fi
info "Dua ${#stems[@]} bo ma hoa hoan chinh sang $PDIR; moi tep khac trong $DIR (vd .dump khong ma hoa, tep tam) KHONG dua sang."

if [ "$DRY" = 0 ]; then
  # Kiem sau: doc duoc bo moi nhat trong thu muc keo, KHONG ghi duoc, KHONG vao duoc thu muc chinh, KHONG doc duoc /etc/siscom-crm.
  runuser -u "$PULL_USER" -- test -r "$PDIR" && runuser -u "$PULL_USER" -- test -x "$PDIR" || die "KIEM: $PULL_USER khong doc duoc $PDIR."
  runuser -u "$PULL_USER" -- test -w "$PDIR" && die "KIEM: $PULL_USER GHI duoc $PDIR - dung lai, chay --remove."
  runuser -u "$PULL_USER" -- test -x "$DIR" && die "KIEM: $PULL_USER vao duoc $DIR - dung lai, chay --remove."
  newest=""; [ "${#stems[@]}" -eq 0 ] || newest="${stems[${#stems[@]}-1]}"
  if [ -n "$newest" ]; then runuser -u "$PULL_USER" -- test -r "$PDIR/$newest.manifest.sig" || die "KIEM: $PULL_USER khong doc duoc $newest."; fi
  if [ -d "$SISCOM_ETC" ]; then runuser -u "$PULL_USER" -- test -r "$SISCOM_ETC" && die "KIEM: $PULL_USER doc duoc $SISCOM_ETC - dung lai, chay --remove."; fi
  info "Kiem dat: doc duoc $PDIR${newest:+ ($newest)}, khong ghi duoc, khong vao duoc $DIR, khong doc duoc $SISCOM_ETC."
fi
info "Xong. Tren may Windows: powershell -NoProfile -ExecutionPolicy Bypass -File pull-backups.ps1 (xem docs/VPS_RUNBOOK.md G6b)."
