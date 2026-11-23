#!/usr/bin/env bash
# SISCOM CRM - BUOC 1 go-live (PR #255 muc 5, Owner chon "chi doi Caddy"): doi Caddy tu IP 42.96.15.235 sang crm.siscom.io.vn.
# Chay TREN VPS bang root qua: ssh ... 'bash -s -- <che-do>' < step1-caddy.sh
#   pre       chi doc: trang thai truoc + dau van tay DB staging
#   apply     sao luu 2 tep -> ghi caddy.env + siscom-tls.caddy (tu /root/golive-step1/, ban repo 2de465c) -> caddy validate -> restart
#   post      chi doc: TLS, dich vu, dau van tay DB staging (so voi pre)
#   rollback <STAMP>  tra 2 tep .bak-<STAMP>, validate, restart (ve IP)
# KHONG cai goi, KHONG chay provision.sh, KHONG dung database (chi doc so dong staging de chung minh khong doi).
set -euo pipefail
mode="${1:-}"; NEW_HOST=crm.siscom.io.vn; IP=42.96.15.235
ENVF=/etc/siscom-crm/caddy.env; TLSF=/etc/caddy/siscom-tls.caddy; CF=/etc/caddy/Caddyfile; SRC=/root/golive-step1
CHK=/opt/siscom-crm/current/backend/scripts/linux/check-tls.sh
[ "$(id -u)" = 0 ] || { echo "can root"; exit 2; }

staging_fp() { # so dong tung bang public cua siscom_crm_staging (chi doc)
  sudo -u postgres psql -X -q -tA -d siscom_crm_staging -c "SELECT md5(string_agg(tablename || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text, ',' ORDER BY tablename)) || ' (' || count(*) || ' bang)' FROM pg_tables WHERE schemaname = 'public'"
}
state() {
  echo "thoi diem: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "caddy: $(systemctl is-active caddy); backend: $(systemctl is-active siscom-crm-backend); postgresql: $(systemctl is-active postgresql)"
  echo "caddy.env: $(grep -E '^SISCOM_(HOST|ACME_CA)=' "$ENVF" | tr '\n' ' ')($(stat -c '%a %U' "$ENVF"))"
  echo "siscom-tls.caddy: $(grep -v '^\s*#' "$TLSF" | grep -v '^\s*$' | tr -s ' \t\n' ' ')($(stat -c '%a %U' "$TLSF"); sha $(sha256sum "$TLSF" | cut -c1-16))"
  echo "Caddyfile sha: $(sha256sum "$CF" | cut -c1-16)"
  echo "health/database: $(curl -s http://127.0.0.1:3000/api/v1/health/database | grep -oE '"(database|migrated|leastPrivilege|authLeastPrivilege)":("[a-z]+"|[a-z]+)' | tr '\n' ' ')"
  echo "DB: $(sudo -u postgres psql -X -q -tA -d postgres -c "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE datname LIKE 'siscom%'")"
  echo "dau van tay staging: $(staging_fp)"
  echo "cong nghe ngoai: $(ss -ltnH | awk '{print $4}' | grep -v -E '^(127\.|\[::1\])' | sort -u | tr '\n' ' ')"
}
validate() { ( set -a; . "$ENVF"; set +a; caddy validate --config "$CF" --adapter caddyfile ) >/tmp/step1-validate.out 2>&1; }

case "$mode" in
  pre)
    echo "== TRUOC BUOC 1 =="; state
    echo "Caddyfile live = repo: $(cmp -s "$CF" "$SRC/Caddyfile" && echo co || echo KHONG)"
    echo "tep repo: Caddyfile $(sha256sum "$SRC/Caddyfile" | cut -c1-16), tls-domain.caddy $(sha256sum "$SRC/tls-domain.caddy" | cut -c1-16)"
    echo "DNS: $(getent ahostsv4 "$NEW_HOST" | awk 'NR==1{print $1}')"
    echo "https://$IP/ => $(curl -s -o /dev/null -w '%{http_code}' "https://$IP/")"
    bash "$CHK" "$IP" 2>&1 | tail -3
    ;;
  apply)
    [ -f "$SRC/Caddyfile" ] && [ -f "$SRC/tls-domain.caddy" ] || { echo "thieu tep repo trong $SRC"; exit 1; }
    cmp -s "$CF" "$SRC/Caddyfile" || { echo "DUNG: /etc/caddy/Caddyfile khac repo - khong doi gi."; exit 1; }
    [ "$(getent ahostsv4 "$NEW_HOST" | awk 'NR==1{print $1}')" = "$IP" ] || { echo "DUNG: DNS $NEW_HOST khong tro $IP - khong doi gi."; exit 1; }
    stamp="$(date -u +%Y%m%d%H%M%S)"
    cp -a "$ENVF" "$ENVF.bak-$stamp"; cp -a "$TLSF" "$TLSF.bak-$stamp"
    echo "STAMP=$stamp (sao luu: $ENVF.bak-$stamp, $TLSF.bak-$stamp)"
    ( umask 077; printf 'SISCOM_HOST=%s\nSISCOM_ACME_CA=%s\n' "$NEW_HOST" "https://acme-v02.api.letsencrypt.org/directory" > "$ENVF.new"; chmod 600 "$ENVF.new"; mv -f "$ENVF.new" "$ENVF" )
    install -m 644 -o root -g root "$SRC/tls-domain.caddy" "$TLSF"
    if ! validate; then
      tail -5 /tmp/step1-validate.out
      cp -a "$ENVF.bak-$stamp" "$ENVF"; cp -a "$TLSF.bak-$stamp" "$TLSF"
      echo "DUNG: caddy validate loi - da tra 2 tep cu, KHONG restart."; exit 1
    fi
    echo "caddy validate: $(grep -o 'Valid configuration' /tmp/step1-validate.out)"
    systemctl restart caddy
    ok=0; for _ in $(seq 1 36); do
      if curl -sS --max-time 8 -o /dev/null "https://$NEW_HOST/" 2>/dev/null; then ok=1; break; fi; sleep 5; done
    if [ "$ok" != 1 ]; then
      journalctl -u caddy --since '-5 min' --no-pager | grep -iE 'error|obtain|challenge' | tail -10
      echo "CANH BAO: chua co chung chi tin cay sau 180 giay. Lui: 'bash -s -- rollback $stamp'"; exit 1
    fi
    echo "TLS dat cho https://$NEW_HOST/ (khong -k)."
    journalctl -u caddy --since '-5 min' --no-pager -o cat | grep -oE '"msg":"(certificate obtained successfully|obtaining certificate)[^"]*"' | sort -u || true
    ;;
  post)
    echo "== SAU BUOC 1 =="; state
    bash "$CHK" "$NEW_HOST" 2>&1 | tail -4
    echo "https://$NEW_HOST/ => $(curl -s -o /dev/null -w '%{http_code}' "https://$NEW_HOST/")  (khong -k)"
    echo "https://$NEW_HOST/api/v1/health => $(curl -s -o /dev/null -w '%{http_code}' "https://$NEW_HOST/api/v1/health")"
    echo "http://$NEW_HOST/ => $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' "http://$NEW_HOST/")"
    echo "header: $(curl -sI "https://$NEW_HOST/" | grep -iE '^(strict-transport-security|x-content-type-options|server):' | tr -d '\r' | tr '\n' ' ')"
    echo "https://$IP/ (IP cu) => $(curl -s -k -o /dev/null -w '%{http_code}' --max-time 8 "https://$IP/" || echo 'khong ket noi')"
    # Dang nhap: chi kiem bang preflight OPTIONS (khong gui tai khoan, khong ghi nhat ky dang nhap vao DB staging)
    echo "CORS preflight /auth/login voi Origin https://$NEW_HOST: [$(curl -s -o /dev/null -D - -X OPTIONS -H "Origin: https://$NEW_HOST" -H 'Access-Control-Request-Method: POST' "https://$NEW_HOST/api/v1/auth/login" | grep -i '^access-control-allow-origin' | tr -d '\r' || true)] (trong = origin chua duoc phep, dung ky vong truoc buoc 2)"
    ;;
  rollback)
    stamp="${2:?can STAMP}"
    cp -a "$ENVF.bak-$stamp" "$ENVF"; cp -a "$TLSF.bak-$stamp" "$TLSF"
    validate || { tail -5 /tmp/step1-validate.out; echo "validate loi sau khi tra tep"; exit 1; }
    systemctl restart caddy; sleep 5
    echo "da lui ve IP: https://$IP/ => $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$IP/")"
    ;;
  *) echo "che do: pre | apply | post | rollback <STAMP>"; exit 2 ;;
esac
