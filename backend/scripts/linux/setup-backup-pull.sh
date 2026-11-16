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
PULL_HOME=/var/lib/backup-pull   # HANG SO, khong cho ghi de bang bien moi truong (--remove xoa .ssh/authorized_keys trong do)
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
# Chi nhan dang CHUAN: tuyet doi, khong '..', khong '//', khong '/./' hay '/.' cuoi, khong '/' cuoi (de so sanh cha/con theo chuoi la dung).
safe_path() {
  [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "$1" != *..* ]] && [[ "$1" != *//* ]] && [[ "$1" != */./* ]] && [[ "$1" != */. ]] && [[ "$1" != */ ]] && [ "$1" != / ]
}

# Duong dan nam trong command="..." cua authorized_keys => chi ky tu an toan.
safe_path "$DIR" || die "TU CHOI: thu muc sao luu '$DIR' phai la duong dan tuyet doi chi gom [A-Za-z0-9._/-]."
safe_path "$PDIR" || die "TU CHOI: thu muc keo '$PDIR' phai la duong dan tuyet doi chi gom [A-Za-z0-9._/-]."
# Khong symlink o BAT KY thanh phan nao (alias qua thu muc cha lam so sanh chuoi sai => --remove rm -rf xoa nham thu muc sao luu goc).
command -v realpath >/dev/null 2>&1 || die "Thieu lenh realpath (coreutils)."
for _p in "$DIR" "$PDIR"; do
  [ "$(realpath -m -- "$_p")" = "$_p" ] || die "TU CHOI: '$_p' di qua symlink / khong phai duong dan that (thuc te: $(realpath -m -- "$_p")). Dung duong dan that."
done
# Hai chieu: keo != sao luu, keo KHONG nam trong sao luu, va keo KHONG la cha cua sao luu (--remove/dong bo se rm -rf thu muc keo).
[ "${PDIR%/}" != "${DIR%/}" ] && [[ "${PDIR%/}/" != "${DIR%/}/"* ]] && [[ "${DIR%/}/" != "${PDIR%/}/"* ]] \
  || die "TU CHOI: thu muc keo '$PDIR' phai KHAC, KHONG nam trong va KHONG la cha cua thu muc sao luu '$DIR'."
[[ "$SFTP_SERVER" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "TU CHOI: duong dan sftp-server la: $SFTP_SERVER"
# Thu muc keo da co: CHI nhan neu (a) co dau $PULL_MARKER khop DUNG thu muc sao luu, hoac (b) dang RONG (chua co gi de mat). Khac => tu choi truoc
# MOI thay doi (install -d se doi chu/quyen; dong bo/--remove se xoa noi dung ben trong thu muc cua ung dung khac). Chi doc, chay ca khi --dry-run.
if [ -e "$PDIR" ] || [ -L "$PDIR" ]; then
  { [ -d "$PDIR" ] && [ ! -L "$PDIR" ]; } || die "TU CHOI: $PDIR da co nhung khong phai thu muc that."
  if ! pull_marker_ok "$PDIR" "$DIR" && [ -n "$(find "$PDIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    die "TU CHOI: $PDIR da co noi dung nhung THIEU/KHONG KHOP dau $PULL_MARKER (source=$DIR) - khong phai thu muc keo do script nay tao. Khong cai/go/dong bo. Kiem SISCOM_PULL_DIR."
  fi
fi
if [ "$DRY" = 0 ]; then
  require_root
  require_cmd useradd usermod userdel runuser ln
fi

if [ "$MODE" = remove ]; then
  info "Go tai khoan $PULL_USER va thu muc keo $PDIR (ban sao luu trong $DIR KHONG bi xoa)"
  # KIEM TRUOC MOI THAY DOI (chi doc, ca khi --dry-run): tai khoan va home phai la do script nay tao, neu khong => tu choi, khong xoa gi.
  if id "$PULL_USER" >/dev/null 2>&1; then
    IFS=: read -r _ _ uid _ _ h _ < <(getent passwd "$PULL_USER")
    { [ "$h" = "$PULL_HOME" ] && [ "$uid" -lt 1000 ]; } || die "TU CHOI --remove: user $PULL_USER da co nhung khong phai do script nay tao (home=$h uid=$uid, mong doi home=$PULL_HOME uid<1000). Khong xoa gi."
  fi
  if [ -e "$PULL_HOME" ] || [ -L "$PULL_HOME" ]; then
    { [ -d "$PULL_HOME" ] && [ ! -L "$PULL_HOME" ] && [ ! -L "$PULL_HOME/.ssh" ]; } || die "TU CHOI --remove: $PULL_HOME (hoac .ssh) khong phai thu muc that. Khong xoa gi."
    # Script chi tao DUNG: home/.ssh/authorized_keys. Con muc nao khac (du lieu cua nguoi/ung dung khac) => tu choi.
    [ -z "$(find "$PULL_HOME" -mindepth 1 ! -path "$PULL_HOME/.ssh" ! -path "$PULL_HOME/.ssh/authorized_keys" -print -quit 2>/dev/null)" ] \
      || die "TU CHOI --remove: $PULL_HOME co noi dung KHONG do script nay tao (chi duoc co .ssh/authorized_keys). Khong xoa gi; xu ly tay."
  fi
  if [ -d "$PDIR" ] && [ ! -L "$PDIR" ]; then
    # Da qua kiem dau/rong o tren. Tra quyen tep trong thu muc chinh ve root 600 (lien ket cung chung inode), bo TUNG lien ket tep thuong,
    # roi rmdir. KHONG rm -rf: gap thu muc con/symlink/muc la thi rmdir that bai => dung, de Owner xu ly tay.
    while IFS= read -r f; do
      [ "$f" = "$PULL_MARKER" ] || { run chown root:root "$PDIR/$f"; run chmod 600 "$PDIR/$f"; }
      run rm -f -- "$PDIR/$f"
    done < <(find "$PDIR" -mindepth 1 -maxdepth 1 -type f -printf '%f\n')
    run rmdir -- "$PDIR" || die "Khong rmdir duoc $PDIR (con muc la khong phai tep thuong). Khong xoa de quy; xu ly tay roi chay lai --remove."
  fi
  if [ "$DRY" = 1 ] || id "$PULL_USER" >/dev/null 2>&1; then
    run pkill -u "$PULL_USER" || true
    run userdel "$PULL_USER"
  fi
  # Home: chi bo DUNG tep script tao roi rmdir (da kiem o tren khong con gi khac). KHONG rm -rf.
  if [ -d "$PULL_HOME" ] && [ ! -L "$PULL_HOME" ]; then
    [ ! -e "$PULL_HOME/.ssh/authorized_keys" ] && [ ! -L "$PULL_HOME/.ssh/authorized_keys" ] || run rm -f -- "$PULL_HOME/.ssh/authorized_keys"
    [ ! -d "$PULL_HOME/.ssh" ] || run rmdir -- "$PULL_HOME/.ssh" || die "Khong rmdir duoc $PULL_HOME/.ssh."
    run rmdir -- "$PULL_HOME" || die "Khong rmdir duoc $PULL_HOME (con muc la). Khong xoa de quy; xu ly tay."
  fi
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
# Tep tam do mktemp tao (0600, ten ngau nhien, O_EXCL): khong di theo symlink dat truoc; trap don ca khi die/Ctrl-C.
tmpf="$(mktemp)" || die "Khong tao duoc tep tam."
trap 'rm -f -- "$tmpf"' EXIT
printf 'ssh-ed25519 %s\n' "$kb" > "$tmpf"
fp="$(ssh-keygen -l -f "$tmpf" 2>/dev/null | awk '{print $2}')" || true
rm -f -- "$tmpf"
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
# Dau nhan dien (root:root 600; backup-pull khong doc duoc) - ghi SAU khi thu muc da qua kiem o tren.
if [ "$DRY" = 1 ]; then
  printf '[DRY] ghi %s/%s (root:root 600): source=%s\n' "$PDIR" "$PULL_MARKER" "$DIR"
else
  tmpf="$(mktemp)" || die "Khong tao duoc tep tam."
  pull_marker_text "$DIR" > "$tmpf"
  install -m 600 -o root -g root "$tmpf" "$PDIR/$PULL_MARKER"; rm -f -- "$tmpf"
fi

# Bo MA HOA HOAN CHINH dang co (du 4 tep, khong trung stem .dump) => lien ket cung sang thu muc keo.
stems_out="$(pull_complete_stems "$DIR")" || die "Khong liet ke duoc cac bo sao luu trong $DIR (find that bai)."
stems=(); [ -z "$stems_out" ] || mapfile -t stems <<<"$stems_out"
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
