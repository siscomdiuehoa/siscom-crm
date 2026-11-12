#!/usr/bin/env bash
# SISCOM CRM - kiem chung chi HTTPS dang phuc vu cho SISCOM_HOST: con han bao nhieu ngay, ai cap, va https:// co chay KHONG can -k.
# Chi doc (ket noi TLS toi chinh host). Chay tay hoac dinh ky (cron/timer) - ma thoat khac 0 la canh bao.
# Dung: check-tls.sh [host] [so-ngay-toi-thieu]
#   host mac dinh: SISCOM_HOST trong $SISCOM_ETC/caddy.env.
#   so-ngay-toi-thieu mac dinh: 2 voi IPv4 (chung chi shortlived ~6 ngay, Caddy gia han khi con ~1/3 thoi han),
#                               14 voi ten mien (chung chi 90 ngay, Caddy gia han khi con ~30 ngay).
# Ma thoat: 0 OK; 1 con it hon nguong / het han / khong ket noi duoc / https loi chung chi.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
require_cmd openssl curl

host="${1:-}"
if [ -z "$host" ]; then host="$(env_get "$SISCOM_ETC/caddy.env" SISCOM_HOST)" || die "Khong co host (tham so 1) va khong doc duoc $SISCOM_ETC/caddy.env."; fi
kind="$(host_kind "$host")" || die "Host khong hop le: $host"
min="${2:-}"; [ -n "$min" ] || { [ "$kind" = ipv4 ] && min=2 || min=14; }
[[ "$min" =~ ^[0-9]{1,3}$ ]] || die "So ngay toi thieu khong hop le: $min"

# SNI chi gui voi ten mien (IP khong dung SNI).
sni=(); [ "$kind" = domain ] && sni=(-servername "$host")
pem="$(echo | openssl s_client -connect "${host}:443" "${sni[@]}" 2>/dev/null | openssl x509 2>/dev/null)" || true
[ -n "$pem" ] || die "Khong lay duoc chung chi tu ${host}:443."
end="$(printf '%s\n' "$pem" | openssl x509 -noout -enddate | cut -d= -f2)"
issuer="$(printf '%s\n' "$pem" | openssl x509 -noout -issuer | sed 's/^issuer= *//')"
left="$(days_until "$end")" || die "Khong doc duoc ngay het han: $end"
echo "Host: $host ($kind) | Het han: $end | Con: $left ngay | Cap boi: $issuer"

fail=0
if curl -fsS --max-time 10 -o /dev/null "https://${host}/api/v1/health"; then
  info "https://${host}/api/v1/health dat (KHONG dung -k: chung chi duoc tin)."
else
  warn "https://${host}/api/v1/health KHONG dat khi kiem chung chi (hoac backend chua chay)."; fail=1
fi
if [ "$left" -lt "$min" ]; then
  warn "Chung chi con $left ngay (< $min). Kiem Caddy gia han: journalctl -u caddy --since '-2 days' | grep -iE 'renew|obtain|error'"; fail=1
fi
[ "$fail" = 0 ] && info "TLS OK." || exit 1
