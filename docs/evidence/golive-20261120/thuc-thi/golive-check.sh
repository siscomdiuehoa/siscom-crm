#!/usr/bin/env bash
# SISCOM CRM - kiem GO/NO-GO CHI DOC tren VPS (PR #255 muc 5.1, 5.4): G1 HTTPS, G2 dich vu + database, G6 database that sach, G8 staging con nguyen.
# Chay: ssh ... 'bash -s -- <so tai khoan ky vong: 0 truoc buoc 5 | 5 sau buoc 5>' < golive-check.sh
# Khong ghi gi vao database / cau hinh; khong doc, khong in mat khau. Truy van G6 chay bang SET ROLE siscom_migrator.
set -uo pipefail
EXP="${1:-5}"; HOST=crm.siscom.io.vn; PROD=siscom_crm_prod; STG=siscom_crm_staging
LIN=/opt/siscom-crm/current/backend/scripts/linux
fail=0
ok()  { echo "  [DAT]       $*"; }
bad() { echo "  [KHONG DAT] $*"; fail=1; }
chk() { if [ "$2" = "$3" ]; then ok "$1 = $2"; else bad "$1 = $2 (ky vong $3)"; fi; }
q()   { sudo -u postgres psql -X -q -tA -v ON_ERROR_STOP=1 -d "$PROD" -c "SET ROLE siscom_migrator" -c "$1"; }
echo "== GO/NO-GO chi doc == $(date -u +%Y-%m-%dT%H:%M:%SZ); tai khoan ky vong: $EXP; ban dang chay: $(basename "$(readlink -f /opt/siscom-crm/current)")"

echo "G1 HTTPS"
tls="$(bash "$LIN/check-tls.sh" "$HOST" 2>&1)"; echo "$tls" | sed 's/^/      /'
if echo "$tls" | grep -q 'TLS OK'; then ok "check-tls.sh TLS OK"; else bad "check-tls.sh"; fi
if echo "$tls" | grep -q "Let's Encrypt"; then ok "cap boi Let's Encrypt"; else bad "khong phai Let's Encrypt"; fi
days="$(echo "$tls" | grep -oE 'Con: [0-9]+' | grep -oE '[0-9]+' | head -n1)"; if [ "${days:-0}" -ge 14 ]; then ok "con $days ngay (>= 14)"; else bad "con ${days:-?} ngay"; fi
chk "https://$HOST/ (khong -k)" "$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/")" 200
chk "http://$HOST/" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOST/")" "308 https://$HOST/"
hdr="$(curl -sI "https://$HOST/" | tr -d '\r')"
if echo "$hdr" | grep -qi '^strict-transport-security: max-age=31536000'; then ok "HSTS"; else bad "thieu HSTS"; fi
if echo "$hdr" | grep -qi '^x-content-type-options: nosniff'; then ok "nosniff"; else bad "thieu nosniff"; fi
chk "cong nghe ra ngoai" "$(ss -ltnH | awk '{print $4}' | grep -v -E '^(127[.]|[[]::1[]])' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | tr '\n' ' ')" "80 443 26266 "

echo "G2 dich vu va database"
chk "siscom-crm-backend" "$(systemctl is-active siscom-crm-backend)" active
hd="$(curl -s http://127.0.0.1:3000/api/v1/health/database)"
for k in '"database":"up"' '"migrated":true' '"leastPrivilege":true' '"authPool":"separate"' '"authLeastPrivilege":true'; do
  if echo "$hd" | grep -qF "$k"; then ok "health $k"; else bad "health thieu $k"; fi
done
chk "cong 3000" "$(ss -ltnH 'sport = :3000' | awk '{print $4}' | tr '\n' ' ')" "127.0.0.1:3000 "
chk "migration hoan tat / chua xong" "$(q "SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) || ' / ' || count(*) FILTER (WHERE finished_at IS NULL) FROM _prisma_migrations")" "16 / 0"
chk "cau hinh tro database" "$( . "$LIN/lib.sh"; echo "$(url_dbname "$(env_get /etc/siscom-crm/backend.env DATABASE_URL)") $(url_dbname "$(env_get /etc/siscom-crm/backend.env AUTH_DATABASE_URL)") $(url_dbname "$(env_get /etc/siscom-crm/migrate.env MIGRATE_DATABASE_URL)")" )" "$PROD $PROD $PROD"
chk "origin dang nhap" "$( . "$LIN/lib.sh"; env_get /etc/siscom-crm/backend.env AUTH_ALLOWED_ORIGINS )" "https://$HOST"
echo "      (PASS|75 + PASS|33 cua create-db.sh grants: xem nhat ky buoc 3 - khong chay lai vi lenh do co ghi quyen)"

echo "G6 database that sach (muc 5.4)"
for t in customer contact customer_assignment opportunity opportunity_change opportunity_document activity activity_access activity_transfer_request privileged_change_request password_reset_token; do
  chk "$t" "$(q "SELECT count(*) FROM public.$t")" 0
done
for t in employee employee_credential employee_role; do chk "$t" "$(q "SELECT count(*) FROM public.$t")" "$EXP"; done
chk "role" "$(q "SELECT count(*) FROM public.role")" "$EXP"
chk "lookup_item" "$(q "SELECT count(*) FROM public.lookup_item")" 73
echo "      audit_log theo hanh dong: $(q "SELECT coalesce(string_agg(action || '=' || n, ', ' ORDER BY action), '(trong)') FROM (SELECT action, count(*) n FROM public.audit_log GROUP BY action) s")"
chk "audit_log ngoai auth.*" "$(q "SELECT count(*) FROM public.audit_log WHERE action NOT LIKE 'auth.%'")" 0
echo "      auth_session=$(q "SELECT count(*) FROM public.auth_session") remember_device=$(q "SELECT count(*) FROM public.remember_device") (chi phien dang nhap - duoc phep)"
open="$(q "SELECT public.fn_auth_bootstrap_open()")"
if [ "$EXP" = 0 ]; then chk "che do khoi tao dang mo" "$open" t; else chk "che do khoi tao dang mo" "$open" f; fi
echo "      app_meta: $(q "SELECT string_agg(key, ', ' ORDER BY key) FROM public.app_meta")"

echo "G8 rollback: staging con nguyen"
chk "database" "$(sudo -u postgres psql -X -q -tA -d postgres -c "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE datname LIKE 'siscom%'")" "$PROD,$STG"
rows="$(sudo -u postgres psql -X -q -tA -d "$STG" -c "SELECT string_agg(tablename || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" | md5sum | cut -c1-32)"
chk "staging dau van tay so dong" "$rows" 759869c0cd70a1f8e83140c273fe9339
last="$(ls -1 /var/backups/siscom-crm | grep -E "^${STG}_[0-9_]+[.]dump[.]age$" | sort | tail -n1)"
chk "bo sao luu staging lan cuoi" "$last" "siscom_crm_staging_20261120_092749.dump.age"
if ( . "$LIN/lib.sh"; verify_backup_set "/var/backups/siscom-crm/$last" /etc/siscom-crm/backup-signing.allowed_signers "$STG" ) >/dev/null 2>&1; then ok "chu ky + SHA-256 bo sao luu staging lan cuoi"; else bad "chu ky bo sao luu staging"; fi
chk "ban ma staging de lui (previous)" "$(cat /opt/siscom-crm/previous)" src-20261119093630
if [ -d /opt/siscom-crm/releases/src-20261119093630 ]; then ok "thu muc ban staging con"; else bad "mat thu muc ban staging"; fi
echo "      env .bak: $(ls /etc/siscom-crm/ | grep -c 'bak-20261120092749') tep; caddy .bak: $(ls /etc/siscom-crm/caddy.env.bak-20261120085931 /etc/caddy/siscom-tls.caddy.bak-20261120085931 2>/dev/null | wc -l) tep"
echo "      sao luu dem: $(systemctl list-timers --no-pager | grep siscom-crm-backup | awk '{print $1, $2, $3, $4}'); bo $PROD da co: $(ls -1 /var/backups/siscom-crm | grep -c "^${PROD}_.*[.]dump[.]age$")"

echo
if [ "$fail" = 0 ]; then echo "KET QUA: moi muc kiem duoc deu DAT."; else echo "KET QUA: CO MUC KHONG DAT (xem tren)."; fi
exit "$fail"
