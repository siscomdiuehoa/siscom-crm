#!/usr/bin/env bash
# SISCOM CRM - BUOC 7 go-live (PR #255 muc 5, 5.3; quy trinh khoa theo Phu luc A cua docs/SALES_S12_STAGING_PLAN.md, da lam tren staging 19/11).
# Sao luu dau tien cua siscom_crm_prod -> khoi phuc thu -> chep ban sao (da ma hoa) ra ngoai VPS va kiem chu ky + SHA-256.
# Che do:
#   backup         (VPS, Claude chay qua ssh, CAN Owner duyet buoc 7) chay sao luu, ghi ten bo vao /root/restore-set.txt, kiem chu ky
#   owner-restore  (VPS, OWNER tu chay bang PuTTY) hen gio tu xoa khoa -> Owner DAN khoa rieng age (khong hien man hinh) ->
#                  restore-test.sh -> XOA khoa ngay (ke ca khi loi). Claude khong bao gio thay khoa.
#   status         (VPS, chi doc) bo da chon, da co restore-ok chua, khoa da xoa chua, hen gio con khong, DB khoi phuc thu
#   drop <ten DB>  (VPS, CAN Owner duyet) xoa DB khoi phuc thu siscom_crm_restore_<UTC> sau khi Owner da xem
#   pull           (MAY OWNER, Git Bash) chep 5 tep cua bo da kiem ve SISCOM-CRM-PR178/backup/prod va kiem chu ky + SHA-256
# Khong ghi vao siscom_crm_prod / siscom_crm_staging; khong dung dich vu; khong in mat khau / khoa.
set -euo pipefail
mode="${1:-}"; PROD=siscom_crm_prod; BK=/var/backups/siscom-crm; SET=/root/restore-set.txt; ST=/root/golive-step7
LIN=/opt/siscom-crm/current/backend/scripts/linux; KDIR=/run/siscom-restore; KEY=$KDIR/backup.key; NS=siscom-crm-backup
vps_root() { [ "$(uname -s)" = Linux ] && [ "$(id -u)" = 0 ] || { echo "Che do nay chay tren VPS bang root."; exit 2; }; install -d -m 700 "$ST"; }

case "$mode" in
  backup)
    vps_root
    n="$(sudo -u postgres psql -X -q -tA -d "$PROD" -c 'SELECT count(*) FROM employee')"
    echo "employee tren $PROD: $n $([ "$n" = 5 ] || echo '(CHU Y: chua du 5 tai khoan - nen lam buoc 5 truoc de ban sao luu dau tien co tai khoan)')"
    systemctl start siscom-crm-backup.service || true
    res="$(systemctl show siscom-crm-backup.service -p Result --value)"; echo "Result=$res"
    [ "$res" = success ] || { journalctl -u siscom-crm-backup.service -n 15 --no-pager -o cat | grep -E '^\[' | tail -6; echo "DUNG: sao luu khong thanh cong."; exit 1; }
    f="$(journalctl -u siscom-crm-backup.service -n 40 --no-pager -o cat | grep 'Da sao luu:' | tail -n1 | grep -oE "$BK/${PROD}_[0-9]{8}_[0-9]{6}[.]dump[.]age")"
    [ -n "$f" ] && [ -f "$f" ] || { echo "DUNG: khong xac dinh duoc bo sao luu vua tao."; exit 1; }
    ( . "$LIN/lib.sh"; verify_backup_set "$f" /etc/siscom-crm/backup-signing.allowed_signers "$PROD" ) || { echo "DUNG: bo sao luu khong qua kiem chu ky."; exit 1; }
    echo "$f" > "$SET"; echo "bo se kiem: $(cat "$SET") - chu ky manifest + SHA-256 hop le"
    ls -l "$f" "${f%.dump.age}.manifest" "${f%.dump.age}.manifest.sig" "$f.sha256" | awk '{print "  " $5, $9}'
    echo "manifest: $(grep -E '^(db|file_sha256)=' "${f%.dump.age}.manifest" | tr '\n' ' ') so bang: $(grep -c '^rows|' "${f%.dump.age}.manifest")"
    echo "khoa ky (cong khai) tren VPS: $(sha256sum /etc/siscom-crm/backup-signing.allowed_signers | cut -c1-16)"
    ;;
  owner-restore)
    vps_root
    [ -t 0 ] || { echo "Phai chay truc tiep tren man hinh PuTTY."; exit 2; }
    [ -s "$SET" ] || { echo "Chua co $SET (Claude chua chay buoc sao luu)."; exit 1; }
    f="$(cat "$SET")"; [[ "$f" =~ ^$BK/${PROD}_[0-9]{8}_[0-9]{6}[.]dump[.]age$ ]] && [ -f "$f" ] || { echo "DUNG: $SET khong tro mot bo sao luu cua $PROD."; exit 1; }
    cleanup() {
      stty echo 2>/dev/null || true
      if [ -e "$KEY" ]; then shred -u "$KEY" 2>/dev/null || rm -f "$KEY"; fi
      systemctl stop siscom-key-cleanup.timer siscom-key-cleanup.service 2>/dev/null || true
      echo; echo "Khoa: $([ -e "$KEY" ] && echo 'CON TEP - xoa tay: shred -u '"$KEY" || echo 'da xoa'); hen gio con cho: $(systemctl list-timers 'siscom-key-cleanup*' --no-pager 2>/dev/null | grep -c siscom-key-cleanup || true)"
    }
    trap cleanup EXIT
    echo "=== Khoi phuc thu bo: $(basename "$f") ==="
    install -d -m 700 "$KDIR"
    systemctl stop siscom-key-cleanup.timer siscom-key-cleanup.service 2>/dev/null || true
    systemctl reset-failed siscom-key-cleanup.timer siscom-key-cleanup.service 2>/dev/null || true
    [ ! -e "$KEY" ] || shred -u "$KEY"
    systemd-run --collect --on-active=30min --unit=siscom-key-cleanup /bin/sh -c "[ ! -e $KEY ] || /usr/bin/shred -u $KEY" >/dev/null 2>&1 \
      || { echo "DUNG: khong hen duoc gio tu xoa khoa - KHONG dua khoa len."; exit 1; }
    [ "$(systemctl list-timers 'siscom-key-cleanup*' --no-pager | grep -c siscom-key-cleanup)" -ge 1 ] || { echo "DUNG: khong thay hen gio."; exit 1; }
    echo "Da hen: sau 30 phut he thong tu xoa khoa du co chuyen gi."
    echo
    echo "Bay gio DAN noi dung tep khoa rieng age (chuot phai trong PuTTY), bam Enter, roi bam Ctrl+D."
    echo "Man hinh se KHONG hien gi khi dan (binh thuong)."
    stty -echo
    ( umask 077; cat > "$KEY" )
    stty echo; echo
    chmod 600 "$KEY"
    grep -q '^AGE-SECRET-KEY-' "$KEY" || { echo "DUNG: noi dung vua dan khong phai khoa rieng age (khong thay dong AGE-SECRET-KEY-...). Khoa se bi xoa; chay lai lenh."; exit 1; }
    echo "Da nhan khoa ($(grep -c '^AGE-SECRET-KEY-' "$KEY") dong khoa). Dang khoi phuc thu..."
    out="$ST/restore-$(date -u +%Y%m%d%H%M%S).out"; rc=0
    ( cd "$LIN" && bash restore-test.sh --db "$PROD" --dump "$f" --identity "$KEY" ) > "$out" 2>&1 || rc=$?
    chmod 600 "$out"; grep -E '^\[(OK|LOI)\]|KHAC|Don dep' "$out" | cut -c1-150
    if [ "$rc" = 0 ] && grep -q 'PASS:' "$out" && [ -f "$f.restore-ok.txt" ]; then
      echo; echo "=== DAT: khoi phuc thu thanh cong. Nhan cho Claude: \"khoi phuc thu xong\". ==="
    else
      echo; echo "=== KHONG DAT (ma $rc). Chup man hinh nay gui Claude (khong co khoa trong do). ==="; exit 1
    fi
    ;;
  status)
    vps_root
    echo "== BUOC 7 - trang thai == $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "bo $PROD dang co: $(ls -1 "$BK" | grep -E "^${PROD}_.*[.]dump[.]age$" | tr '\n' ' ')"
    if [ -s "$SET" ]; then f="$(cat "$SET")"; echo "bo da chon: $f"
      echo "restore-ok: $([ -f "$f.restore-ok.txt" ] && tr '\n' ' ' < "$f.restore-ok.txt" || echo 'CHUA CO')"
    else echo "bo da chon: (chua co $SET)"; fi
    echo "tep khoa tren VPS: $([ -e "$KEY" ] && echo 'CON (phai xoa)' || echo 'khong co'); hen gio xoa khoa dang cho: $(systemctl list-timers 'siscom-key-cleanup*' --no-pager 2>/dev/null | grep -c siscom-key-cleanup || true)"
    echo "DB khoi phuc thu: $(sudo -u postgres psql -X -q -tA -d postgres -c "SELECT coalesce(string_agg(datname, ',' ORDER BY datname), '(khong co)') FROM pg_database WHERE datname LIKE 'siscom_crm_restore_%'")"
    echo "sao luu dem: $(systemctl list-timers --no-pager | grep siscom-crm-backup | awk '{print $1, $2, $3, $4}'); lan gan nhat: $(systemctl show siscom-crm-backup.service -p Result --value) luc $(systemctl show siscom-crm-backup.service -p ExecMainExitTimestamp --value)"
    ;;
  drop)
    vps_root
    d="${2:-}"; [[ "$d" =~ ^siscom_crm_restore_[0-9]{8}_[0-9]{6}$ ]] || { echo "Ten DB khong hop le (chi siscom_crm_restore_<UTC>)."; exit 1; }
    sudo -u postgres psql -X -q -d postgres -c "DROP DATABASE \"$d\""; echo "da xoa DB thu $d"
    ;;
  pull)
    K=(-i "$HOME/.ssh/siscom_vps_ed25519" -o "UserKnownHostsFile=$HOME/.ssh/known_hosts_siscom_vps" -o StrictHostKeyChecking=yes)
    DEST="$HOME/SISCOM-CRM-PR178/backup/prod"; ALLOWED="$HOME/SISCOM-CRM-PR178/backup/backup-signing.allowed_signers"
    [ -s "$ALLOWED" ] || { echo "Thieu $ALLOWED (ban Owner giu ngoai VPS)."; exit 1; }
    f="$(ssh "${K[@]}" -p 26266 root@42.96.15.235 "cat $SET")"
    [[ "$f" =~ ^$BK/${PROD}_[0-9]{8}_[0-9]{6}[.]dump[.]age$ ]] || { echo "Ten bo khong hop le: $f"; exit 1; }
    stem="$(basename "${f%.dump.age}")"; mkdir -p "$DEST"
    for x in "$stem.dump.age" "$stem.manifest" "$stem.manifest.sig" "$stem.dump.age.sha256" "$stem.dump.age.restore-ok.txt"; do
      scp -q "${K[@]}" -P 26266 "root@42.96.15.235:$BK/$x" "$DEST/" || echo "  (khong co $x tren VPS)"
    done
    bash "$0" verify-local "$DEST/$stem.dump.age" "$ALLOWED" "$PROD"
    echo "so bo $PROD dang giu ngoai VPS: $(ls -1 "$DEST" | grep -c '[.]dump[.]age$') (giu toi thieu 14 bo gan nhat)"
    ;;
  verify-local) # verify-local <tep .dump.age> <allowed_signers> <ten DB> - kiem ban da chep (chay tren may Owner, chi doc)
    f="${2:?}"; allowed="${3:?}"; want="${4:?}"; man="${f%.dump.age}.manifest"
    [ -f "$f" ] && [ -f "$man" ] && [ -f "$man.sig" ] || { echo "[KHONG DAT] thieu tep cua bo $(basename "$f")"; exit 1; }
    ssh-keygen -q -Y verify -f "$allowed" -I "$NS" -n "$NS" -s "$man.sig" < "$man" >/dev/null 2>&1 || { echo "[KHONG DAT] chu ky manifest khong hop le"; exit 1; }
    echo "[DAT] chu ky manifest hop le (khoa cong khai Owner giu ngoai VPS)"
    [ "$(grep '^db=' "$man" | cut -d= -f2 | tr -d '\r')" = "$want" ] || { echo "[KHONG DAT] manifest thuoc DB khac"; exit 1; }
    [ "$(grep '^file=' "$man" | cut -d= -f2 | tr -d '\r')" = "$(basename "$f")" ] || { echo "[KHONG DAT] manifest mo ta tep khac"; exit 1; }
    got="$(sha256sum "$f" | cut -d' ' -f1)"; exp="$(grep '^file_sha256=' "$man" | cut -d= -f2 | tr -d '\r')"
    [ "$got" = "$exp" ] || { echo "[KHONG DAT] SHA-256 tep khac manifest da ky"; exit 1; }
    echo "[DAT] SHA-256 khop manifest da ky: $got"
    echo "[$([ -f "$f.restore-ok.txt" ] && echo DAT || echo 'CHUA CO')] dau khoi phuc thu (.restore-ok.txt)"
    ;;
  *) echo "che do: backup | owner-restore | status | drop <ten DB> | pull | verify-local <tep> <allowed_signers> <ten DB>"; exit 2 ;;
esac
