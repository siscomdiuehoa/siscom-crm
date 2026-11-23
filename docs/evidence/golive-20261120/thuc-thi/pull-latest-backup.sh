#!/usr/bin/env bash
# SISCOM CRM - tu dong dua bo sao luu siscom_crm_prod ra ngoai VPS:
#   (1) keo MOI bo con tren VPS ma may Owner chua co -> SISCOM-CRM-PR178/backup/prod
#   (2) kiem chu ky manifest + SHA-256 tung bo (step7.sh verify-local)
#   (3) dua bo HOP LE len Google Drive cua Owner (thu muc dong bo G:\My Drive\SISCOM-CRM-Backup\prod)
# Chay tren may Owner (Git Bash): bash pull-latest-backup.sh
# Tren VPS chi doc (find + scp tai ve). Khong giai ma. Khong xoa, khong ghi de tep nao (VPS, may, Drive).
# Bien thu: PULL_DEST (thu muc tren may), PULL_DRIVE (thu muc Drive; rong = bo qua Drive).
# Ma thoat: 0 = dat; 1 = khong dat; 2 = khong ket noi duoc VPS (van dua cac bo da co len Drive).
set -uo pipefail
K=(-i "$HOME/.ssh/siscom_vps_ed25519" -o "UserKnownHostsFile=$HOME/.ssh/known_hosts_siscom_vps" -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20)
H=root@42.96.15.235; P=26266; BK=/var/backups/siscom-crm; PROD=siscom_crm_prod
DEST="${PULL_DEST:-$HOME/SISCOM-CRM-PR178/backup/prod}"
ALLOWED="$HOME/SISCOM-CRM-PR178/backup/backup-signing.allowed_signers"
DRIVE="${PULL_DRIVE-/g/My Drive/SISCOM-CRM-Backup/prod}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PARTS="dump.age dump.age.sha256 manifest manifest.sig"
fail=0; noconn=0
ok()  { echo "  [DAT]       $*"; }
bad() { echo "  [KHONG DAT] $*"; fail=1; }
inf() { echo "      $*"; }
complete() { local d="$1" s="$2" x; for x in $PARTS; do [ -s "$d/$s.$x" ] || return 1; done; }

echo "== Dua sao luu ra ngoai VPS == $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ -s "$ALLOWED" ] || { bad "thieu khoa cong khai kiem chu ky: $ALLOWED"; echo "KET QUA CHEP: KHONG DAT"; exit 1; }
mkdir -p "$DEST"

echo "1. Keo tu VPS ve may"
list="$(ssh "${K[@]}" -p "$P" "$H" "set -o pipefail; test -d $BK && find $BK -maxdepth 1 -type f -name '${PROD}_*.dump.age' -printf '%f\n' | sort")"; lrc=$?
if [ "$lrc" = 255 ]; then noconn=1; bad "khong ket noi duoc VPS (bo qua buoc keo)"; list=""
elif [ "$lrc" != 0 ]; then bad "khong liet ke duoc thu muc sao luu tren VPS (ma $lrc) - bo qua buoc keo"; list=""
elif [ -z "$list" ]; then bad "VPS khong co bo sao luu $PROD nao"; fi
vps_sets=""
for f in $list; do
  [[ "$f" =~ ^${PROD}_[0-9]{8}_[0-9]{6}\.dump\.age$ ]] || { bad "ten bo la tren VPS, bo qua: '$f'"; continue; }
  s="${f%.dump.age}"; vps_sets="$vps_sets $s"
  if complete "$DEST" "$s"; then continue; fi
  tmp="$(mktemp -d)"
  if scp -q "${K[@]}" -P "$P" "$H:$BK/$s.*" "$tmp/" && complete "$tmp" "$s"; then
    for x in $PARTS; do [ -e "$DEST/$s.$x" ] || mv "$tmp/$s.$x" "$DEST/" || bad "khong ghi duoc $s.$x vao $DEST"; done
    if complete "$DEST" "$s"; then ok "da chep $s ($(stat -c %s "$DEST/$s.dump.age") byte)"; else bad "$s chua du 4 tep tren may sau khi chep"; fi
  else bad "chep $s that bai hoac thieu tep"; fi
  rm -rf "$tmp"
done
[ "$noconn" = 1 ] || inf "tren VPS: $(echo $vps_sets | wc -w) bo; moi nhat: $(echo $vps_sets | tr ' ' '\n' | tail -n1)"

echo "2. Kiem chu ky + SHA-256 tren may"
good=""
for f in $(find "$DEST" -maxdepth 1 -type f -name "${PROD}_*.dump.age" -printf '%f\n' | sort); do
  s="${f%.dump.age}"
  complete "$DEST" "$s" || { bad "$s tren may thieu tep"; continue; }
  out="$(bash "$HERE/step7.sh" verify-local "$DEST/$f" "$ALLOWED" "$PROD" 2>&1)"
  if echo "$out" | grep -q '^\[KHONG DAT\]' || ! echo "$out" | grep -q '^\[DAT\] SHA-256 khop'; then bad "$s khong qua kiem: $(echo "$out" | grep '^\[KHONG DAT\]' | head -n1)"
  else good="$good $s"; fi
done
for s in $vps_sets; do case " $good " in *" $s "*) ;; *) bad "bo $s con tren VPS nhung chua co ban hop le tren may";; esac; done
ngood=$(echo $good | wc -w); latest="$(echo $good | tr ' ' '\n' | tail -n1)"
[ "$ngood" -gt 0 ] && ok "$ngood bo tren may hop le; moi nhat: $latest" || bad "khong co bo hop le nao tren may"
if [ -n "$latest" ]; then
  ts="${latest#"${PROD}"_}"
  age_h=$(( ( $(date -u +%s) - $(date -u -d "${ts:0:8} ${ts:9:2}:${ts:11:2}:${ts:13:2}" +%s) ) / 3600 ))
  [ "$age_h" -le 30 ] && ok "bo moi nhat tren may cach day $age_h gio" || bad "bo moi nhat tren may da $age_h gio (qua 30 gio)"
fi

echo "3. Dua len Google Drive"
if [ -z "$DRIVE" ]; then inf "bo qua (PULL_DRIVE rong)"
elif [ ! -d "$(dirname "$DRIVE")" ]; then bad "khong thay thu muc Drive $(dirname "$DRIVE") (Google Drive chua chay / chua dang nhap?)"
else
  mkdir -p "$DRIVE"
  da="$(dirname "$DRIVE")/backup-signing.allowed_signers"
  if [ ! -s "$da" ]; then
    if cp "$ALLOWED" "$da.tmp$$" && mv "$da.tmp$$" "$da" && cmp -s "$ALLOWED" "$da"; then inf "da dat khoa cong khai kiem chu ky len Drive"
    else rm -f "$da.tmp$$"; bad "khong dat duoc khoa cong khai kiem chu ky len Drive"; fi
  elif ! cmp -s "$ALLOWED" "$da"; then bad "khoa cong khai tren Drive KHAC tren may - khong ghi de, can xem lai"; fi
  up=0
  for s in $good; do
    for x in $PARTS; do
      src="$DEST/$s.$x"; dst="$DRIVE/$s.$x"
      if [ -e "$dst" ]; then cmp -s "$src" "$dst" || bad "$s.$x tren Drive KHAC ban tren may - khong ghi de"; continue; fi
      cp "$src" "$dst.tmp$$" && mv "$dst.tmp$$" "$dst" || { bad "chep $s.$x len Drive that bai"; rm -f "$dst.tmp$$"; continue; }
      cmp -s "$src" "$dst" || bad "$s.$x tren Drive sai noi dung sau khi chep"
      [ "$x" = dump.age ] && up=$((up+1))
    done
  done
  ndrive=$(find "$DRIVE" -maxdepth 1 -type f -name "${PROD}_*.dump.age" | wc -l)
  ok "Drive: them $up bo, tong $ndrive bo tai $DRIVE (Google Drive tu tai len may chu)"
fi

echo
if [ "$fail" = 1 ]; then echo "KET QUA CHEP: KHONG DAT"; [ "$noconn" = 1 ] && exit 2; exit 1; fi
echo "KET QUA CHEP: DAT (chua khoi phuc thu cac bo nay)"
