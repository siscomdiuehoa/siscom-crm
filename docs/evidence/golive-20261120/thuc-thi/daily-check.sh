#!/usr/bin/env bash
# SISCOM CRM - kiem CHI DOC hang ngay sau go-live (TLS, dich vu, sao luu dem, dia, loi dich vu).
# Chay: ssh ... 'bash -s' < daily-check.sh
# Khong ghi gi vao database / cau hinh / tep tren VPS; khong doc, khong in mat khau hay khoa.
set -uo pipefail
HOST=crm.siscom.io.vn; PROD=siscom_crm_prod; BK=/var/backups/siscom-crm
LIN=/opt/siscom-crm/current/backend/scripts/linux
fail=0; warn=0
ok()   { echo "  [DAT]       $*"; }
bad()  { echo "  [KHONG DAT] $*"; fail=1; }
note() { echo "  [CHU Y]     $*"; warn=1; }
echo "== Kiem hang ngay (chi doc) == $(date -u +%Y-%m-%dT%H:%M:%SZ); ban dang chay: $(basename "$(readlink -f /opt/siscom-crm/current)")"

echo "1. HTTPS"
tls="$(bash "$LIN/check-tls.sh" "$HOST" 2>&1)"
if echo "$tls" | grep -q 'TLS OK'; then ok "check-tls.sh TLS OK"; else bad "check-tls.sh: $(echo "$tls" | tail -n2 | tr '\n' ' ')"; fi
days="$(echo "$tls" | grep -oE 'Con: [0-9]+' | grep -oE '[0-9]+' | head -n1)"
if [ "${days:-0}" -ge 21 ]; then ok "chung chi con $days ngay"; elif [ "${days:-0}" -ge 14 ]; then note "chung chi con $days ngay (Caddy phai tu gia han truoc 30 ngay)"; else bad "chung chi con ${days:-?} ngay"; fi
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/")"; [ "$code" = 200 ] && ok "https://$HOST/ = 200" || bad "https://$HOST/ = $code"

echo "2. Dich vu"
for s in siscom-crm-backend caddy postgresql; do st="$(systemctl is-active "$s" 2>/dev/null)"; [ "$st" = active ] && ok "$s = active" || bad "$s = $st"; done
hd="$(curl -s --max-time 10 http://127.0.0.1:3000/api/v1/health/database)"
for k in '"database":"up"' '"migrated":true'; do echo "$hd" | grep -qF "$k" && ok "health $k" || bad "health thieu $k"; done
nr="$(systemctl show siscom-crm-backend -p NRestarts --value 2>/dev/null)"; [ "${nr:-0}" = 0 ] && ok "backend khong tu khoi dong lai (NRestarts=0)" || note "backend da tu khoi dong lai ${nr} lan ke tu lan chay gan nhat"

echo "3. Sao luu dem"
res="$(systemctl show siscom-crm-backup.service -p Result --value)"; [ "$res" = success ] && ok "lan sao luu gan nhat: success" || bad "lan sao luu gan nhat: $res"
last="$(find "$BK" -maxdepth 1 -type f -name "${PROD}_*.dump.age" -printf '%f\n' | sort | tail -n1)"
if [ -z "$last" ]; then bad "khong co bo sao luu $PROD"; else
  ts="${last#"${PROD}"_}"; ts="${ts%.dump.age}"
  age_h=$(( ( $(date -u +%s) - $(date -u -d "${ts:0:8} ${ts:9:2}:${ts:11:2}:${ts:13:2}" +%s) ) / 3600 ))
  [ "$age_h" -le 26 ] && ok "bo moi nhat $last ($age_h gio truoc)" || bad "bo moi nhat $last da $age_h gio (qua 26 gio)"
  if ( . "$LIN/lib.sh"; verify_backup_set "$BK/$last" /etc/siscom-crm/backup-signing.allowed_signers "$PROD" ) >/dev/null 2>&1; then ok "chu ky + SHA-256 bo moi nhat hop le"; else bad "bo moi nhat khong qua kiem chu ky / SHA-256"; fi
  echo "      so dong trong bo moi nhat: $(grep -E '^rows\|(employee|customer|opportunity|activity)\|' "$BK/${last%.dump.age}.manifest" | cut -d'|' -f2,3 | tr '\n' ' ')"
fi
echo "      so bo $PROD tren VPS: $(find "$BK" -maxdepth 1 -type f -name "${PROD}_*.dump.age" | wc -l); hen gio tiep: $(systemctl list-timers --no-pager | grep siscom-crm-backup | awk '{print $1, $2, $3, $4}')"

echo "4. Dia va bo nho"
use="$(df --output=pcent / | tail -n1 | tr -dc '0-9')"; free="$(df -h --output=avail / | tail -n1 | tr -d ' ')"
if [ "$use" -lt 80 ]; then ok "o / dung $use%, con $free"; elif [ "$use" -lt 90 ]; then note "o / dung $use%, con $free"; else bad "o / dung $use%, con $free"; fi
echo "      RAM: $(free -m | awk '/^Mem:/{print $3 " / " $2 " MB dang dung"}')"

echo "5. Loi dich vu trong 24 gio"
for s in siscom-crm-backend caddy siscom-crm-backup; do
  n="$(journalctl -u "$s" --since '24 hours ago' -p err --no-pager -q -o cat 2>/dev/null | wc -l)"
  if [ "$n" = 0 ]; then ok "$s: 0 dong loi"; else note "$s: $n dong loi"; journalctl -u "$s" --since '24 hours ago' -p err --no-pager -q -o cat | tail -n3 | cut -c1-200 | sed 's/^/      /'; fi
done

echo
if [ "$fail" = 1 ]; then echo "KET QUA: CO MUC KHONG DAT"; exit 1
elif [ "$warn" = 1 ]; then echo "KET QUA: DAT, CO MUC CAN CHU Y"; else echo "KET QUA: moi muc deu DAT"; fi
