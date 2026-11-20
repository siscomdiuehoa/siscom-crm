#!/usr/bin/env bash
# SISCOM CRM - BUOC 5 go-live (PR #255 muc 5; Owner: "OWNER_APPROVED_TASK", 20/11/2026).
# OWNER tu chay TREN VPS (PuTTY, root):   bash /root/golive-step5/bootstrap-owner.sh
# Owner tu go 5 mat khau (khong hien tren man hinh, khong ghi tep, khong vao lich su lenh, khong qua chat).
# Script chi goi `run-cli.sh bootstrap-auth` (BOOTSTRAP_EMAIL_DOMAIN=siscom.vn) tren siscom_crm_prod: tao 5 tai khoan theo vai tro
# trong MOT giao dich (loi => khong tao gi) roi dong che do khoi tao. Khong sua gi khac.
# STEP5_SELFTEST=1: chi thu phan nhap mat khau (khong can root, khong cham database, khong goi CLI).
set -euo pipefail
LIN=/opt/siscom-crm/current/backend/scripts/linux; ETC=/etc/siscom-crm; ST=/root/golive-step5
DB=siscom_crm_prod; DOMAIN=siscom.vn; MIN=12; MAX=128
SELFTEST="${STEP5_SELFTEST:-0}"

if [ "$SELFTEST" != 1 ]; then
  [ "$(id -u)" = 0 ] || { echo "Can chay bang root."; exit 2; }
  [ -t 0 ] || { echo "Phai chay truc tiep tren man hinh PuTTY (khong qua lenh tu xa)."; exit 2; }
  # shellcheck source=/dev/null
  target="$( . "$LIN/lib.sh"; url_dbname "$(env_get "$ETC/migrate.env" MIGRATE_DATABASE_URL)" )"
  [ "$target" = "$DB" ] || { echo "DUNG: cau hinh dang tro '$target', khong phai $DB."; exit 1; }
  n="$(sudo -u postgres psql -X -q -tA -d "$DB" -c 'SELECT count(*) FROM employee')"
  [ "$n" = 0 ] || { echo "DUNG: $DB da co $n nhan vien (khoi tao chi chay mot lan)."; exit 1; }
  [ "$(sudo -u postgres psql -X -q -tA -d "$DB" -c 'SELECT public.fn_auth_bootstrap_open()')" = t ] || { echo "DUNG: che do khoi tao da dong."; exit 1; }
fi

cat <<TXT

=== SISCOM CRM - tao 5 tai khoan tren $DB ===
Ten dang nhap:  sysadmin@$DOMAIN   (Quan tri he thong - ky thuat)
                admin@$DOMAIN      (Quan tri CRM - nguoi duyet, thay toan bo khach)
                sale@$DOMAIN       (Kinh doanh)
                kythuat@$DOMAIN    (Ky thuat)
                ketoan@$DOMAIN     (Ke toan)
Moi mat khau: tu $MIN ky tu tro len, 5 mat khau KHAC nhau, khong dung lai mat khau cu / mat khau tung gui qua chat.
Khi go, man hinh KHONG hien ky tu nao (binh thuong). Go xong bam Enter. Moi mat khau go 2 lan.
Bam Ctrl+C bat ky luc nao de huy (chua tao gi).

TXT

ask() { # ask <nhan> => dat bien PW
  local a b
  while :; do
    read -rs -p "  Mat khau cho $1: " a; echo
    if [ "${#a}" -lt "$MIN" ] || [ "${#a}" -gt "$MAX" ]; then echo "    -> can tu $MIN den $MAX ky tu (vua go ${#a}). Go lai."; continue; fi
    case "$a" in ' '*|*' ') echo "    -> khong bat dau / ket thuc bang dau cach. Go lai."; continue ;; esac
    read -rs -p "  Go lai lan 2      : " b; echo
    if [ "$a" != "$b" ]; then echo "    -> hai lan go khong giong nhau. Go lai."; continue; fi
    PW="$a"; return 0
  done
}
PW=""
ask "sysadmin@$DOMAIN"; P1="$PW"
ask "admin@$DOMAIN   "; P2="$PW"
ask "sale@$DOMAIN    "; P3="$PW"
ask "kythuat@$DOMAIN "; P4="$PW"
ask "ketoan@$DOMAIN  "; P5="$PW"
PW=""
if [ "$(printf '%s\n' "$P1" "$P2" "$P3" "$P4" "$P5" | sort -u | wc -l)" != 5 ]; then
  P1=""; P2=""; P3=""; P4=""; P5=""
  echo; echo "DUNG: co mat khau trung nhau. Chua tao gi. Chay lai lenh va dat 5 mat khau khac nhau."; exit 1
fi

if [ "$SELFTEST" = 1 ]; then echo "SELFTEST: nhap hop le (5 mat khau, do dai ${#P1}/${#P2}/${#P3}/${#P4}/${#P5})."; exit 0; fi

echo; echo "Dang tao tai khoan (bam mat khau mat khoang 5-10 giay)..."
stamp="$(date -u +%Y%m%d%H%M%S)"; out="$ST/bootstrap-$stamp.out"
rc=0
( export BOOTSTRAP_EMAIL_DOMAIN="$DOMAIN" BOOTSTRAP_PASSWORD_SYSADMIN="$P1" BOOTSTRAP_PASSWORD_ADMIN="$P2" BOOTSTRAP_PASSWORD_SALE="$P3" \
         BOOTSTRAP_PASSWORD_TECHNICIAN="$P4" BOOTSTRAP_PASSWORD_ACCOUNTANT="$P5"
  bash "$LIN/run-cli.sh" bootstrap-auth ) > "$out" 2>&1 || rc=$?
P1=""; P2=""; P3=""; P4=""; P5=""
chmod 600 "$out"
sed -E 's#(postgres(ql)?://)[^ @]*@#\1***@#g' "$out"
echo
if [ "$rc" = 0 ] && grep -q 'closed=true' "$out"; then
  echo "=== XONG: da tao 5 tai khoan va dong che do khoi tao. Nhan cho Claude: \"da tao xong\". ==="
else
  echo "=== KHONG THANH CONG (ma $rc). Khong tao tai khoan nao (mot giao dich). Chup man hinh nay gui Claude (khong co mat khau trong do). ==="
  exit 1
fi
