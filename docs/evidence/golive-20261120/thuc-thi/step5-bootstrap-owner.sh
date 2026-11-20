#!/usr/bin/env bash
# SISCOM CRM - BUOC 5 go-live (PR #255 muc 5; Owner: "OWNER_APPROVED_TASK", 20/11/2026).
# OWNER tu chay TREN VPS (PuTTY, root):   bash /root/golive-step5/bootstrap-owner.sh
# Owner tu go 5 mat khau (khong hien tren man hinh, khong ghi tep, khong vao lich su lenh, khong qua chat).
# Script chi goi `run-cli.sh bootstrap-auth` (BOOTSTRAP_EMAIL_DOMAIN=siscom.vn) tren siscom_crm_prod: tao 5 tai khoan theo vai tro
# trong MOT giao dich (loi => khong tao gi) roi dong che do khoi tao. Khong sua gi khac.
#
# Bao ve bi mat (review R1 cua PR #256, HIGH-01):
#   - umask 077 tu dong dau; tep nhat ky duoc tao voi quyen 600 TRUOC khi ghi bat ky dong nao.
#   - Dau ra tho cua CLI KHONG ghi ra dia va KHONG in ra man hinh: chi giu trong bo nho, loc theo DANH SACH CHO PHEP (allowlist)
#     roi moi in / ghi nhat ky. Dong la => thay bang "(1 dong bi loc)".
#   - Sau khi chay: do trong dau ra tho xem co chuoi nao trung 5 mat khau vua go khong (so trong bo nho, khong qua tham so lenh).
#     Co => bao loi, KHONG in, KHONG ghi gi cua dau ra do.
#   - Mat khau chi nam trong bien cua shell va moi truong cua tien trinh con (root moi doc duoc); khong qua tham so dong lenh.
#
# Thu bang du lieu gia (khong can root, khong cham database, khong goi CLI that):
#   STEP5_SELFTEST=1                      chi thu phan nhap mat khau
#   STEP5_SELFTEST=1 STEP5_FAKE_CLI=<tep> STEP5_TEST_DIR=<thu muc tam>   chay <tep> thay cho run-cli.sh (xem test-step5.sh)
set -euo pipefail
umask 077
LIN=/opt/siscom-crm/current/backend/scripts/linux; ETC=/etc/siscom-crm; ST=/root/golive-step5
DB=siscom_crm_prod; DOMAIN=siscom.vn; MIN=12; MAX=128
SELFTEST="${STEP5_SELFTEST:-0}"; FAKE="${STEP5_FAKE_CLI:-}"

if [ "$SELFTEST" = 1 ]; then
  if [ -n "$FAKE" ]; then ST="${STEP5_TEST_DIR:?can STEP5_TEST_DIR}"; [ -f "$FAKE" ] || { echo "khong thay STEP5_FAKE_CLI"; exit 2; }; fi
else
  [ -z "$FAKE" ] || { echo "STEP5_FAKE_CLI chi dung khi STEP5_SELFTEST=1."; exit 2; }
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

if [ "$SELFTEST" = 1 ] && [ -z "$FAKE" ]; then echo "SELFTEST: nhap hop le (5 mat khau, do dai ${#P1}/${#P2}/${#P3}/${#P4}/${#P5})."; exit 0; fi

# Tep nhat ky: tao voi quyen 600 TRUOC khi co noi dung (umask 077 + chmod tuong minh).
# (Git Bash tren Windows khong dat duoc quyen 700 => chi che do thu moi cho phep mkdir -p; chay that ma loi thi dung.)
if ! install -d -m 700 "$ST" 2>/dev/null; then
  if [ "$SELFTEST" = 1 ]; then mkdir -p "$ST"; else P1=""; P2=""; P3=""; P4=""; P5=""; echo "DUNG: khong tao duoc thu muc nhat ky $ST quyen 700. Chua tao gi."; exit 1; fi
fi
stamp="$(date -u +%Y%m%d%H%M%S)"; out="$ST/bootstrap-$stamp.out"
: > "$out"; chmod 600 "$out"

echo; echo "Dang tao tai khoan (bam mat khau mat khoang 5-10 giay)..."
run_cli() { if [ -n "$FAKE" ]; then bash "$FAKE"; else bash "$LIN/run-cli.sh" bootstrap-auth; fi; }
rc=0
raw="$( ( export BOOTSTRAP_EMAIL_DOMAIN="$DOMAIN" BOOTSTRAP_PASSWORD_SYSADMIN="$P1" BOOTSTRAP_PASSWORD_ADMIN="$P2" BOOTSTRAP_PASSWORD_SALE="$P3" \
                 BOOTSTRAP_PASSWORD_TECHNICIAN="$P4" BOOTSTRAP_PASSWORD_ACCOUNTANT="$P5"
          run_cli ) 2>&1 )" || rc=$?

# 1) Dau ra tho co chua mat khau vua go khong? (so trong bo nho)
leak=0
for p in "$P1" "$P2" "$P3" "$P4" "$P5"; do case "$raw" in *"$p"*) leak=1 ;; esac; done
P1=""; P2=""; P3=""; P4=""; P5=""; p=""
if [ "$leak" = 1 ]; then
  raw=""
  echo "[step5] CANH BAO: dau ra cua CLI CHUA MAT KHAU - khong in, khong ghi. Ma thoat CLI: $rc" | tee -a "$out"
  echo; echo "=== DUNG: bao Claude dong \"CLI lo mat khau\" (khong chup phan mat khau). Kiem tai khoan da tao hay chua truoc khi lam gi tiep. ==="
  exit 3
fi

# 2) Loc theo danh sach cho phep; dong la khong duoc in / ghi.
ok_line=0; accounts=0; dropped=0
re_run='^Chay bootstrap-auth tren DB siscom_crm_prod \(tai khoan siscom_migrator\)\.$'
re_done='^Khoi tao xong tren siscom_crm_prod \(qua MIGRATE_DATABASE_URL, closed=true\)\. Tai khoan \(dang nhap bang email HOAC ma NV\):$'
re_acc='^  (sysadmin|admin|sale|technician|accountant) +NV-[0-9]{4,} +(sysadmin|admin|sale|kythuat|ketoan)@siscom\.vn +vai tro=(admin|crm_admin|sales|technician|accountant)$'
re_fail='^Khoi tao that bai: (BOOTSTRAP_CLOSED|BOOTSTRAP_INPUT): [^$'"'"'"`\\]{0,160}$'
re_missing='^Khoi tao that bai: Thiếu biến môi trường BOOTSTRAP_PASSWORD_[A-Z]+$'
re_lib='^\[(OK|LOI|CANH BAO)\] [^$'"'"'"`\\@]{0,200}$'
while IFS= read -r line; do
  line="${line%$'\r'}"
  [ -n "$line" ] || continue
  if [[ "$line" =~ $re_done ]]; then ok_line=1; elif [[ "$line" =~ $re_acc ]]; then accounts=$((accounts + 1));
  elif [[ "$line" =~ $re_run || "$line" =~ $re_fail || "$line" =~ $re_missing || "$line" =~ $re_lib ]]; then :;
  else dropped=$((dropped + 1)); continue; fi
  printf '%s\n' "$line" | tee -a "$out"
done <<< "$raw"
raw=""
[ "$dropped" = 0 ] || echo "[step5] ($dropped dong cua CLI bi loc, khong in / khong ghi)" | tee -a "$out"
echo "[step5] ma thoat CLI: $rc; so tai khoan in ra: $accounts" >> "$out"

echo
if [ "$rc" = 0 ] && [ "$ok_line" = 1 ] && [ "$accounts" = 5 ]; then
  echo "=== XONG: da tao 5 tai khoan va dong che do khoi tao. Nhan cho Claude: \"da tao xong\". ==="
else
  echo "=== KHONG THANH CONG (ma $rc, $accounts tai khoan in ra, $dropped dong bi loc). Tao tai khoan la MOT giao dich: loi => khong tao tai khoan nao. Chup man hinh nay gui Claude (khong co mat khau trong do). ==="
  exit 1
fi
