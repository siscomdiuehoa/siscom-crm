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
#       restrict,command="/usr/lib/openssh/sftp-server -R -d <thu muc sao luu>" ssh-ed25519 ...
#     => chi chay duoc sftp-server CHE DO CHI DOC (-R): khong ghi/xoa/doi ten, khong shell, khong chuyen tiep cong, khong pty.
#   - ACL: u:backup-pull:rx tren thu muc sao luu (liet ke) + r tren 4 tep cua cac bo MA HOA dang co (.dump.age, .dump.age.sha256,
#     .manifest, .manifest.sig). KHONG co ACL mac dinh (PR235-R1-SEC-01): tep moi (tam, .partial, .dump, tep khac) luon rieng tu;
#     bo moi do backup-db.sh cap quyen doc (backup_grant_pull) CHI SAU KHI bo ma hoa hoan tat + tu kiem dat.
#     Quyen/chu so huu cua thu muc (root 700) KHONG doi.
# KHONG sua sshd_config, KHONG nap lai sshd, KHONG doi ufw/fail2ban (authorized_keys duoc doc moi lan dang nhap).
# Gioi han da biet: sftp-server -R khong chroot => van doc duoc cac tep ma moi nguoi deu doc duoc (vd /etc/passwd); KHONG doc duoc
# /etc/siscom-crm (700), /root, khoa ky sao luu.
# Luu y: chmod/`install -m` lai thu muc sao luu se lam mat ACL => chay lai script nay (backup-db.sh/provision.sh da khong chmod lai).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

PULL_USER=backup-pull
PULL_HOME=/var/lib/backup-pull
SFTP_SERVER="${SISCOM_SFTP_SERVER:-/usr/lib/openssh/sftp-server}"
DIR="$SISCOM_BACKUP_DIR"

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

# Duong dan nam trong command="..." cua authorized_keys => chi ky tu an toan.
[[ "$DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "$DIR" != *..* ]] || die "TU CHOI: thu muc sao luu '$DIR' phai la duong dan tuyet doi chi gom [A-Za-z0-9._/-]."
[[ "$SFTP_SERVER" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "TU CHOI: duong dan sftp-server la: $SFTP_SERVER"
if [ "$DRY" = 0 ]; then
  require_root
  require_cmd setfacl getfacl useradd usermod userdel runuser
fi


if [ "$MODE" = remove ]; then
  info "Go tai khoan $PULL_USER va ACL tren $DIR"
  if [ -d "$DIR" ]; then
    run setfacl -x "u:$PULL_USER" "$DIR" || true
    run setfacl -d -x "u:$PULL_USER" "$DIR" || true
    while IFS= read -r f; do run setfacl -x "u:$PULL_USER" "$DIR/$f" || true; done < <(find "$DIR" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null)
  fi
  if [ "$DRY" = 1 ] || id "$PULL_USER" >/dev/null 2>&1; then
    run pkill -u "$PULL_USER" || true
    run userdel "$PULL_USER"
  fi
  run rm -rf --one-file-system "$PULL_HOME"
  info "Da go. Kiem: id $PULL_USER (phai bao khong co); getfacl $DIR (khong con dong user:$PULL_USER)."
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
line="restrict,command=\"$SFTP_SERVER -R -d $DIR\" ssh-ed25519 $kb siscom-backup-pull"

if [ "$DRY" = 0 ]; then
  [ -x "$SFTP_SERVER" ] || die "Khong thay $SFTP_SERVER (goi openssh-sftp-server)."
  { [ -d "$DIR" ] && [ ! -L "$DIR" ]; } || die "Chua co thu muc sao luu $DIR (chay backup-db.sh/provision.sh truoc)."
  backup_dir_ensure "$DIR"
fi

info "Khoa duoc cap: $fp; thu muc chi doc: $DIR"
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

run setfacl -m "u:$PULL_USER:rx" "$DIR"
run setfacl -d -x "u:$PULL_USER" "$DIR" 2>/dev/null || true   # go ACL mac dinh neu con tu ban cu (khong cap cho tep moi)
# Chi bo MA HOA HOAN CHINH: du 4 tep (khong symlink) va KHONG trung stem voi bo .dump plaintext (chung manifest) => cap r cho dung 4 tep.
n=0; total=0
while IFS= read -r f; do
  total=$((total + 1))
  [[ "$f" =~ ^(siscom_crm_(staging|prod)_[0-9]{8}_[0-9]{6})\.dump\.age$ ]] || continue
  st="${BASH_REMATCH[1]}"; full=1
  for p in .dump.age .dump.age.sha256 .manifest .manifest.sig; do [ -f "$DIR/$st$p" ] && [ ! -L "$DIR/$st$p" ] || full=0; done
  [ -e "$DIR/$st.dump" ] && full=0
  if [ "$full" = 0 ]; then warn "Bo $st chua hoan chinh hoac trung stem voi .dump - KHONG cap quyen."; continue; fi
  for p in .dump.age .dump.age.sha256 .manifest .manifest.sig; do run setfacl -m "u:$PULL_USER:r" "$DIR/$st$p"; n=$((n + 1)); done
done < <(find "$DIR" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | sort)
info "Cap quyen doc $n tep (bo ma hoa hoan chinh) dang co; $((total - n)) tep khac (vd .dump khong ma hoa, tep tam) KHONG cap."

if [ "$DRY" = 0 ]; then
  # Kiem sau: doc duoc bo moi nhat, KHONG ghi duoc thu muc, KHONG doc duoc /etc/siscom-crm.
  runuser -u "$PULL_USER" -- test -r "$DIR" && runuser -u "$PULL_USER" -- test -x "$DIR" || die "KIEM: $PULL_USER khong doc duoc $DIR."
  runuser -u "$PULL_USER" -- test -w "$DIR" && die "KIEM: $PULL_USER GHI duoc $DIR - dung lai, chay --remove."
  newest="$(find "$DIR" -maxdepth 1 -type f -name '*.dump.age' -printf '%f\n' | sort | tail -n1)"
  if [ -n "$newest" ]; then runuser -u "$PULL_USER" -- test -r "$DIR/$newest" || die "KIEM: $PULL_USER khong doc duoc $newest."; fi
  if [ -d "$SISCOM_ETC" ]; then runuser -u "$PULL_USER" -- test -r "$SISCOM_ETC" && die "KIEM: $PULL_USER doc duoc $SISCOM_ETC - dung lai, chay --remove."; fi
  info "Kiem dat: doc duoc $DIR${newest:+ ($newest)}, khong ghi duoc, khong doc duoc $SISCOM_ETC."
fi
info "Xong. Tren may Windows: powershell -NoProfile -ExecutionPolicy Bypass -File pull-backups.ps1 (xem docs/VPS_RUNBOOK.md G6)."
