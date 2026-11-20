#!/usr/bin/env bash
# SISCOM CRM - bo thu NHANH LOI cho step5-bootstrap-owner.sh va step7.sh bang DU LIEU GIA (review R1 cua PR #256).
# Khong cham database, khong goi CLI that, khong dung khoa / mat khau that: mat khau gia sinh ngau nhien, CLI gia, tep "khoa" gia.
# Dung: bash test-golive-scripts.sh            (chay duoc tren Git Bash va Linux; cung thu muc voi 2 kich ban)
#       Linux + root + systemd: them nhom "REAL" (hen gio systemd that + tep khong xoa duoc bang chattr +i).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; S5="$here/step5-bootstrap-owner.sh"; S7="$here/step7.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { echo "  [DAT]       $*"; pass=$((pass + 1)); }
bad() { echo "  [KHONG DAT] $*"; fail=$((fail + 1)); }
is() { if [ "$2" = "$3" ]; then ok "$1 = $2"; else bad "$1 = $2 (ky vong $3)"; fi; }
has() { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1 (khong thay: $3)"; fi; }
hasnt() { if printf '%s' "$2" | grep -qF -- "$3"; then bad "$1 (THAY: $3)"; else ok "$1"; fi; }
linux=0; [ "$(uname -s)" = Linux ] && linux=1
echo "== $(uname -srm); bash $BASH_VERSION; uid=$(id -u) =="
for f in "$S5" "$S7"; do if bash -n "$f"; then ok "bash -n $(basename "$f")"; else bad "bash -n $(basename "$f")"; fi; done

# ---------------------------------------------------------------- step5
g() { openssl rand -hex 8; }
A="$(g)"; B="$(g)"; C="$(g)"; D="$(g)"; E="$(g)"
inp() { printf '%s\n' "$A" "$A" "$B" "$B" "$C" "$C" "$D" "$D" "$E" "$E"; }
run5() { # run5 <cli gia> => dau ra vao $o, nhat ky vao $l, ma thoat $rc5; thu muc nhat ky $T/st
  rm -rf "$T/st"; rc5=0
  inp | STEP5_SELFTEST=1 STEP5_FAKE_CLI="$1" STEP5_TEST_DIR="$T/st" bash "$S5" > "$T/o" 2>&1 || rc5=$?
  o="$(cat "$T/o")"; logf="$(find "$T/st" -name 'bootstrap-*.out' 2>/dev/null | head -n1)"; l=""; [ -z "$logf" ] || l="$(cat "$logf")"
}
nosecret() { local x; for x in "$A" "$B" "$C" "$D" "$E"; do hasnt "$1: khong lo mat khau gia" "$o$l" "$x"; done; }

echo "S5-1 nhap sai (qua ngan, go lai khac, trung nhau)"
r="$(printf '%s\n' ngan "$A" "$A" "$B" "$B" "$C" "$C" "$D" "$D" "$E" "$E" | STEP5_SELFTEST=1 bash "$S5" 2>&1)"; has "qua ngan bi tu choi roi nhap lai duoc" "$r" "can tu 12 den 128"; has "ket thuc hop le" "$r" "SELFTEST: nhap hop le"
r="$(printf '%s\n' "$A" khackhackhackhac "$A" "$A" "$B" "$B" "$C" "$C" "$D" "$D" "$E" "$E" | STEP5_SELFTEST=1 bash "$S5" 2>&1)"; has "go lai khac bi tu choi" "$r" "khong giong nhau"
r="$(printf '%s\n' "$A" "$A" "$A" "$A" "$C" "$C" "$D" "$D" "$E" "$E" | STEP5_SELFTEST=1 bash "$S5" 2>&1)"; has "trung nhau bi dung" "$r" "co mat khau trung nhau"

cat > "$T/cli-ok.sh" <<'CLI'
# CLI gia: thanh cong. Ghi lai quyen cua tep nhat ky TAI THOI DIEM CLI dang chay (tep phai da ton tai va 600).
lf="$(find "$STEP5_TEST_DIR" -name 'bootstrap-*.out' | head -n1)"
{ if [ -n "$lf" ]; then stat -c '%a' "$lf"; else echo THIEU; fi; stat -c '%a' "$STEP5_TEST_DIR"; } > "$STEP5_TEST_DIR/../perm.txt" 2>/dev/null
echo "Chay bootstrap-auth tren DB siscom_crm_prod (tai khoan siscom_migrator)."
echo "Khoi tao xong tren siscom_crm_prod (qua MIGRATE_DATABASE_URL, closed=true). Tai khoan (dang nhap bang email HOAC ma NV):"
echo "  sysadmin   NV-0001  sysadmin@siscom.vn  vai tro=admin"
echo "  admin      NV-0002  admin@siscom.vn  vai tro=crm_admin"
echo "  sale       NV-0003  sale@siscom.vn  vai tro=sales"
echo "  technician NV-0004  kythuat@siscom.vn  vai tro=technician"
echo "  accountant NV-0005  ketoan@siscom.vn  vai tro=accountant"
CLI
echo "S5-2 CLI gia thanh cong"
run5 "$T/cli-ok.sh"; is "ma thoat" "$rc5" 0; has "in dong XONG" "$o" "=== XONG: da tao 5 tai khoan"; has "nhat ky co 5 tai khoan" "$l" "so tai khoan in ra: 5"; nosecret "S5-2"
if [ "$linux" = 1 ]; then
  is "quyen tep nhat ky luc CLI dang chay" "$(sed -n 1p "$T/perm.txt")" 600; is "quyen thu muc nhat ky" "$(sed -n 2p "$T/perm.txt")" 700; is "quyen tep nhat ky sau cung" "$(stat -c '%a' "$logf")" 600
else echo "  (bo qua kiem quyen 600/700: khong phai Linux)"; fi

cat > "$T/cli-leak.sh" <<'CLI'
echo "Chay bootstrap-auth tren DB siscom_crm_prod (tai khoan siscom_migrator)."
echo "debug env: BOOTSTRAP_PASSWORD_ADMIN=$BOOTSTRAP_PASSWORD_ADMIN"
echo "Khoi tao xong tren siscom_crm_prod (qua MIGRATE_DATABASE_URL, closed=true). Tai khoan (dang nhap bang email HOAC ma NV):"
CLI
echo "S5-3 CLI gia LO mat khau"
run5 "$T/cli-leak.sh"; is "ma thoat" "$rc5" 3; has "bao CLI lo mat khau" "$o" "CHUA MAT KHAU"; nosecret "S5-3"; hasnt "khong in dong debug" "$o$l" "debug env"

cat > "$T/cli-noise.sh" <<'CLI'
echo "Chay bootstrap-auth tren DB siscom_crm_prod (tai khoan siscom_migrator)."
echo "Khoi tao that bai: Invalid tx.employeeCredential.create() invocation: { passwordHash: '\$argon2id\$v=19\$m=65536\$GIAGIAGIA', url: 'postgresql://siscom_migrator:GIA-PW-DB@127.0.0.1:5432/siscom_crm_prod' }"
echo "DATABASE_URL=postgresql://siscom_app:GIA-PW-APP@127.0.0.1/siscom_crm_prod"
exit 1
CLI
echo "S5-4 CLI gia loi, in hash / URL co mat khau DB (gia)"
run5 "$T/cli-noise.sh"; is "ma thoat" "$rc5" 1; has "bao KHONG THANH CONG" "$o" "=== KHONG THANH CONG"; has "dem dong bi loc" "$o" "2 dong cua CLI bi loc"
hasnt "khong in / ghi hash" "$o$l" 'argon2id'; hasnt "khong in / ghi URL" "$o$l" 'postgresql://'; hasnt "khong in / ghi mat khau DB gia" "$o$l" 'GIA-PW'; nosecret "S5-4"

cat > "$T/cli-closed.sh" <<'CLI'
echo "Chay bootstrap-auth tren DB siscom_crm_prod (tai khoan siscom_migrator)."
echo "Khoi tao that bai: BOOTSTRAP_CLOSED: chế độ khởi tạo đã đóng; không khởi tạo lại."
exit 1
CLI
echo "S5-5 CLI gia bao BOOTSTRAP_CLOSED"
run5 "$T/cli-closed.sh"; is "ma thoat" "$rc5" 1; has "in ly do da biet" "$o" "BOOTSTRAP_CLOSED"; nosecret "S5-5"
echo "S5-6 chan dung CLI gia ngoai che do thu"
r="$(STEP5_FAKE_CLI="$T/cli-ok.sh" bash "$S5" 2>&1 </dev/null)"; has "tu choi STEP5_FAKE_CLI khi khong SELFTEST" "$r" "chi dung khi STEP5_SELFTEST=1"

# ---------------------------------------------------------------- step7 cleanup_key (lenh gia tren PATH)
mkdir -p "$T/stub" "$T/k" "$T/p1" "$T/p2" "$T/p3"
cat > "$T/stub/systemctl" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$T/systemctl.calls"
case "\$1" in list-timers) echo "x siscom-key-cleanup.timer siscom-key-cleanup.service" ;; esac
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 1\n' > "$T/stub/fail"
chmod +x "$T/stub"/*
echo "S7-1 cleanup_key: xoa DUOC khoa gia => huy hen gio"
echo "KHOA GIA" > "$T/k/backup.key"; : > "$T/systemctl.calls"; cp "$T/stub/systemctl" "$T/p1/"
r="$(PATH="$T/p1:$PATH" STEP7_TEST_KEY="$T/k/backup.key" bash "$S7" selftest-cleanup 2>&1)"; rc=$?
is "ma thoat" "$rc" 0; if [ ! -e "$T/k/backup.key" ]; then ok "tep khoa gia da mat"; else bad "tep khoa gia con"; fi
has "da goi systemctl stop hen gio" "$(cat "$T/systemctl.calls")" "stop siscom-key-cleanup.timer"
echo "S7-2 cleanup_key: KHONG xoa duoc khoa gia (shred + rm deu loi) => GIU hen gio, bao loi"
echo "KHOA GIA" > "$T/k/backup.key"; : > "$T/systemctl.calls"; cp "$T/stub/systemctl" "$T/p2/"; cp "$T/stub/fail" "$T/p2/shred"; cp "$T/stub/fail" "$T/p2/rm"
r="$(PATH="$T/p2:$PATH" STEP7_TEST_KEY="$T/k/backup.key" bash "$S7" selftest-cleanup 2>&1)"; rc=$?
is "ma thoat" "$rc" 1; if [ -e "$T/k/backup.key" ]; then ok "tep khoa gia van con (dung kich ban loi)"; else bad "tep khoa gia bi xoa"; fi
hasnt "KHONG goi systemctl stop" "$(cat "$T/systemctl.calls")" "stop"; has "bao KHONG XOA DUOC KHOA" "$r" "KHONG XOA DUOC KHOA"; has "noi ro giu hen gio" "$r" "KHONG huy hen gio"
echo "S7-3 selftest tu choi duong dan khoa that"
r="$(STEP7_TEST_KEY=/run/siscom-restore/backup.key bash "$S7" selftest-cleanup 2>&1)"; has "tu choi" "$r" "TU CHOI"

# ---------------------------------------------------------------- step7 verify-local (bo sao luu gia, khoa ky gia)
echo "S7-4 verify-local / G7 tren bo sao luu GIA"
V="$T/v"; mkdir -p "$V"; ssh-keygen -q -t ed25519 -N '' -f "$V/sign" >/dev/null
echo "siscom-crm-backup namespaces=\"siscom-crm-backup\" $(cut -d' ' -f1,2 "$V/sign.pub")" > "$V/allowed"
mkset() { # mkset <stem> <so employee>
  local st="$1"; head -c 2048 /dev/urandom > "$V/$st.dump.age"
  { echo "db=siscom_crm_prod"; echo "file=$st.dump.age"; echo "file_sha256=$(sha256sum "$V/$st.dump.age" | cut -d' ' -f1)"; echo "rows|employee|$2"; echo "rows|customer|0"; } > "$V/$st.manifest"
  rm -f "$V/$st.manifest.sig"; ssh-keygen -q -Y sign -f "$V/sign" -n siscom-crm-backup "$V/$st.manifest" >/dev/null 2>&1
}
marker() { { echo "sha256_file=$2"; echo "manifest_signature=verified"; echo "dump=$1.dump.age"; echo "restored_db=siscom_crm_restore_20261120_000000"; echo "tables_checked=24"; } > "$V/$1.dump.age.restore-ok.txt"; }
vl() { r="$(bash "$S7" verify-local "$V/$1.dump.age" "$V/allowed" siscom_crm_prod 2>&1)"; rc=$?; }
s0=siscom_crm_prod_20261120_000001; mkset "$s0" 0; vl "$s0"; is "employee=0, chua co dau: ma thoat" "$rc" 0; has "bao CHUA DU employee" "$r" "CHUA DU"; has "G7 CHUA DAT" "$r" "KET LUAN G7: CHUA DAT"
s5=siscom_crm_prod_20261120_000002; mkset "$s5" 5; vl "$s5"; has "employee=5 nhung chua co dau => G7 CHUA DAT" "$r" "KET LUAN G7: CHUA DAT"
marker "$s5" "$(sha256sum "$V/$s5.dump.age" | cut -d' ' -f1)"; vl "$s5"; is "employee=5 + dau dung bo: ma thoat" "$rc" 0; has "G7 DAT" "$r" "KET LUAN G7 (phan ban sao ngoai VPS): DAT"
marker "$s5" "0000000000000000000000000000000000000000000000000000000000000000"; vl "$s5"; is "dau cua bo khac: ma thoat" "$rc" 1; has "bao dau khong thuoc bo" "$r" "KHONG thuoc bo nay"
rm -f "$V/$s5.dump.age.restore-ok.txt"; echo x >> "$V/$s5.dump.age"; vl "$s5"; is "tep bi sua: ma thoat" "$rc" 1; has "bao SHA-256 khac" "$r" "SHA-256 tep khac manifest"
mkset "$s5" 5; sed -i 's/^rows|employee|5/rows|employee|6/' "$V/$s5.manifest"; vl "$s5"; is "manifest bi sua: ma thoat" "$rc" 1; has "bao chu ky khong hop le" "$r" "chu ky manifest khong hop le"

# ---------------------------------------------------------------- step7 pull (ssh / scp gia): tep bat buoc fail-closed, dau tuy chon
echo "S7-5 pull voi ssh / scp GIA"
R="$T/remote"; H="$T/home"; mkdir -p "$R" "$H/SISCOM-CRM-PR178/backup"; cp "$V/allowed" "$H/SISCOM-CRM-PR178/backup/backup-signing.allowed_signers"
sp=siscom_crm_prod_20261120_000003; mkset "$sp" 5; for x in dump.age manifest manifest.sig; do cp "$V/$sp.$x" "$R/"; done; echo "sha" > "$R/$sp.dump.age.sha256"
cat > "$T/p3/ssh" <<STUB
#!/usr/bin/env bash
c="\${!#}"
case "\$c" in cat\ *) echo "/var/backups/siscom-crm/$sp.dump.age" ;; test\ -f*) [ -f "$R/$sp.dump.age.restore-ok.txt" ] ;; *) exit 9 ;; esac
STUB
cat > "$T/p3/scp" <<STUB
#!/usr/bin/env bash
n=\$#; src="\${@:n-1:1}"; dst="\${!#}"; b="\$(basename "\$src")"
[ "\$b" != "\${FAKE_SCP_FAIL:-}" ] || exit 1
cp "$R/\$b" "\$dst" 2>/dev/null
STUB
chmod +x "$T/p3"/*
pl() { r="$(PATH="$T/p3:$PATH" HOME="$H" FAKE_SCP_FAIL="${1:-}" bash "$S7" pull 2>&1)"; rc=$?; }
pl "$sp.manifest.sig"; is "thieu tep BAT BUOC (manifest.sig): ma thoat" "$rc" 1; has "bao DUNG vi tep bat buoc" "$r" "khong chep duoc tep bat buoc"
pl ""; is "du 4 tep, chua co dau: ma thoat" "$rc" 0; has "ghi ro chua khoi phuc thu" "$r" "chua co dau khoi phuc thu cua bo nay tren VPS"; has "G7 CHUA DAT" "$r" "KET LUAN G7: CHUA DAT"
marker "$sp" "$(sha256sum "$V/$sp.dump.age" | cut -d' ' -f1)"; cp "$V/$sp.dump.age.restore-ok.txt" "$R/"; pl ""; is "co dau dung bo: ma thoat" "$rc" 0; has "G7 DAT" "$r" "KET LUAN G7 (phan ban sao ngoai VPS): DAT"

# ---------------------------------------------------------------- REAL: systemd that + tep khong xoa duoc (chi Linux root co systemd)
if [ "$linux" = 1 ] && [ "$(id -u)" = 0 ] && [ -d /run/systemd/system ] && command -v chattr >/dev/null; then
  echo "S7-REAL hen gio systemd THAT + tep khoa gia khong xoa duoc (chattr +i)"
  I="/var/tmp/siscom-rsvc-test-$$"; mkdir -p "$I"; K="$I/backup.key"; echo "KHOA GIA" > "$K"
  systemctl stop siscom-key-cleanup.timer siscom-key-cleanup.service 2>/dev/null; systemctl reset-failed siscom-key-cleanup.timer siscom-key-cleanup.service 2>/dev/null
  if systemd-run --collect --on-active=30min --unit=siscom-key-cleanup /bin/sh -c "[ ! -e $K ] || /usr/bin/shred -u $K" >/dev/null 2>&1; then ok "hen gio that da tao"; else bad "khong tao duoc hen gio that"; fi
  if chattr +i "$K" 2>/dev/null; then
    r="$(STEP7_TEST_KEY="$K" bash "$S7" selftest-cleanup 2>&1)"; rc=$?
    is "khong xoa duoc: ma thoat" "$rc" 1; if [ -e "$K" ]; then ok "tep khoa gia van con"; else bad "tep bi xoa"; fi
    is "hen gio that VAN CON cho" "$(systemctl list-timers 'siscom-key-cleanup*' --no-pager | grep -c siscom-key-cleanup)" 1; has "bao KHONG XOA DUOC KHOA" "$r" "KHONG XOA DUOC KHOA"
    chattr -i "$K"
  else echo "  (he tep khong ho tro chattr +i: bo qua nhanh loi that)"; fi
  r="$(STEP7_TEST_KEY="$K" bash "$S7" selftest-cleanup 2>&1)"; rc=$?
  is "xoa duoc: ma thoat" "$rc" 0; if [ ! -e "$K" ]; then ok "tep khoa gia da mat"; else bad "tep con"; fi
  is "hen gio that da huy" "$(systemctl list-timers 'siscom-key-cleanup*' --no-pager | grep -c siscom-key-cleanup)" 0
  rm -rf "$I"
else echo "S7-REAL (bo qua: can Linux + root + systemd + chattr)"; fi

echo; echo "TONG: $pass dat, $fail khong dat"; [ "$fail" = 0 ]
