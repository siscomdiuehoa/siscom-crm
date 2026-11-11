#!/usr/bin/env bash
# SISCOM CRM - G1/G2 nen may chu: Ubuntu 24.04 (VPS 3 vCPU / 3 GB RAM / 40 GB).
#   swap 2 GB, UTC + timesyncd, ufw chi 22/80/443, fail2ban, unattended-upgrades (chi ban va bao mat, KHONG tu khoi dong lai),
#   Node 24 (NodeSource), PostgreSQL 18 (PGDG) chi nghe localhost, Caddy (HTTPS Let's Encrypt), user dich vu `siscom` khong sudo,
#   cai unit systemd + Caddyfile cua repo.
# Chay bang root TREN VPS (chua tung chay tren VPS that - xem docs/VPS_RUNBOOK.md). Idempotent: chay lai khong hong.
# Dung: provision.sh [--dry-run] [--harden-ssh]
#   --dry-run     chi in cac buoc, khong doi gi.
#   --harden-ssh  tat dang nhap SSH bang mat khau + root chi bang khoa. CHI dung SAU khi da thu dang nhap bang khoa
#                 (script tu choi neu /root/.ssh/authorized_keys rong, va kiem `sshd -t` truoc khi nap lai).
# Bien (tuy chon): SISCOM_DOMAIN (ten mien; thieu => bo qua cau hinh Caddy), SISCOM_ACME_CA (mac dinh Let's Encrypt that;
#   dat https://acme-staging-v02.api.letsencrypt.org/directory de thu), SISCOM_SSH_PORT (CHI 22 - gia tri khac bi tu choi, F2), SISCOM_SWAP_GB (2).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

DRY=0; HARDEN=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --harden-ssh) HARDEN=1 ;;
    *) die "Tham so la: $a (dung: provision.sh [--dry-run] [--harden-ssh])" ;;
  esac
done

SSH_PORT="${SISCOM_SSH_PORT:-22}"; SWAP_GB="${SISCOM_SWAP_GB:-2}"
# F2 (PR232-R1): script KHONG doi cong cua sshd. Neu nhan cong khac 22, ufw se chi mo cong do roi `ufw --force enable` CHAN 22
# (sshd van nghe 22) => mat truy cap SSH. Phien ban nay fail-closed: chi nhan 22, tu choi TRUOC khi doi bat cu gi.
[ "$SSH_PORT" = 22 ] || die "SISCOM_SSH_PORT=$SSH_PORT: phien ban nay chi ho tro cong SSH 22 (doi cong can quy trinh rieng: cau hinh sshd, mo cong moi, thu dang nhap, roi moi dong 22)."
[[ "$SWAP_GB" =~ ^[1-8]$ ]] || die "SISCOM_SWAP_GB phai tu 1 den 8."
DOMAIN="${SISCOM_DOMAIN:-}"
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then die "SISCOM_DOMAIN khong hop le: $DOMAIN"; fi
ACME_CA="${SISCOM_ACME_CA:-https://acme-v02.api.letsencrypt.org/directory}"
[[ "$ACME_CA" =~ ^https://[A-Za-z0-9./_-]+$ ]] || die "SISCOM_ACME_CA khong hop le."

run() { if [ "$DRY" = 1 ]; then printf '[DRY] %s\n' "$*"; else "$@"; fi; }
# write_file <path> <mode>  (noi dung tu stdin)
write_file() {
  if [ "$DRY" = 1 ]; then printf '[DRY] ghi %s (mode %s):\n' "$1" "$2"; sed 's/^/[DRY]   | /'; return 0; fi
  install -d -m 755 "$(dirname "$1")"
  local tmp; tmp="$(mktemp "$1.XXXXXX")"
  cat >"$tmp"; chmod "$2" "$tmp"; mv -f "$tmp" "$1"
}
step() { printf '\n== %s ==\n' "$*"; }

[ "$DRY" = 1 ] || require_root
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = "24.04" ] || { [ "$DRY" = 1 ] && warn "Khong phai Ubuntu 24.04 (dry-run, bo qua)." || die "Chi ho tro Ubuntu 24.04 (dang la ${PRETTY_NAME:-khong ro})."; }
else
  [ "$DRY" = 1 ] || die "Khong doc duoc /etc/os-release."
fi
export DEBIAN_FRONTEND=noninteractive

step "1. Goi nen + cap nhat"
run apt-get update -y
run apt-get install -y ca-certificates curl gnupg openssl ufw fail2ban unattended-upgrades apt-transport-https rsync age lsb-release jq

step "2. Gio he thong UTC + dong bo gio"
run timedatectl set-timezone UTC
run timedatectl set-ntp true
run systemctl enable --now systemd-timesyncd

step "3. Swap ${SWAP_GB} GB (RAM 3 GB chat: PostgreSQL + Node + Caddy)"
if [ "$DRY" = 0 ] && swapon --show --noheadings | grep -q .; then
  info "Da co swap."
else
  run fallocate -l "${SWAP_GB}G" /swapfile
  run chmod 600 /swapfile
  run mkswap /swapfile
  run swapon /swapfile
  if [ "$DRY" = 1 ]; then
    echo "[DRY] them /swapfile vao /etc/fstab"
  elif ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi
write_file /etc/sysctl.d/99-siscom.conf 644 <<'CONF'
vm.swappiness = 10
vm.vfs_cache_pressure = 50
CONF
if [ "$DRY" = 1 ]; then echo "[DRY] sysctl --system"; else sysctl --system >/dev/null; fi

step "4. Tuong lua ufw: chi ${SSH_PORT}/80/443"
run ufw default deny incoming
run ufw default allow outgoing
run ufw allow "${SSH_PORT}/tcp"
run ufw allow 80/tcp
run ufw allow 443/tcp
run ufw --force enable

step "5. fail2ban (SSH)"
write_file /etc/fail2ban/jail.d/siscom.local 644 <<CONF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
findtime = 10m
bantime = 1h
CONF
run systemctl enable --now fail2ban
run systemctl restart fail2ban

step "6. Tu dong cap nhat bao mat (khong tu khoi dong lai)"
write_file /etc/apt/apt.conf.d/20auto-upgrades 644 <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
write_file /etc/apt/apt.conf.d/52siscom-unattended 644 <<'CONF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
run systemctl enable --now unattended-upgrades

step "7. Node 24 (NodeSource, kho apt co khoa ky)"
if [ "$DRY" = 1 ]; then
  echo "[DRY] them kho NodeSource node_24.x va cai nodejs"
else
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a!==24||b<11){console.error("Node phai 24.x >= 24.11, dang "+process.versions.node);process.exit(1)}'
  info "Node $(node -v), npm $(npm -v)"
fi

step "8. PostgreSQL 18 (PGDG) chi nghe localhost"
if [ "$DRY" = 1 ]; then
  echo "[DRY] them kho PGDG noble-pgdg, cai postgresql-18, ghi conf.d, kiem pg_hba chi loopback"
else
  install -d -m 755 /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-18 postgresql-client-18
  pgconf=/etc/postgresql/18/main
  [ -d "$pgconf/conf.d" ] || die "Khong thay $pgconf/conf.d (cai dat PostgreSQL 18 khong nhu ky vong)."
  write_file "$pgconf/conf.d/90-siscom.conf" 644 <<'CONF'
# SISCOM CRM - VPS 3 GB RAM. Chi localhost; UTC (ung dung con tu ep TimeZone=UTC moi ket noi).
listen_addresses = 'localhost'
timezone = 'UTC'
log_timezone = 'UTC'
max_connections = 50
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB
password_encryption = scram-sha-256
log_min_duration_statement = 1000
CONF
  # pg_hba: chi local (peer) + loopback; tu choi neu co dong "host*" nao co dia chi ngoai 127.0.0.1/::1.
  bad="$(grep -Ev '^[[:space:]]*(#|$)' "$pgconf/pg_hba.conf" | awk '$1 ~ /^host/ && $4 !~ /^(127[.]0[.]0[.]1(\/32)?|::1(\/128)?)$/ { print }' || true)"
  if [ -n "$bad" ]; then echo "$bad" >&2; die "pg_hba.conf co dong host ngoai loopback (liet ke o tren). Sua tay roi chay lai."; fi
  systemctl enable postgresql
  systemctl restart postgresql
  if ss -ltn | awk '$4 ~ /:5432$/ && $4 !~ /^(127[.]0[.]0[.]1|\[::1\]):5432$/ { bad = 1 } END { exit bad ? 0 : 1 }'; then die "PostgreSQL dang nghe ngoai loopback."; fi
  info "PostgreSQL $(runuser -u postgres -- psql -X -tA -c 'SHOW server_version')"
  [ "$(runuser -u postgres -- psql -X -tA -c 'SHOW TimeZone')" = UTC ] || die "TimeZone cua PostgreSQL khong phai UTC."
fi

step "9. Caddy (kho chinh thuc Cloudsmith)"
if [ "$DRY" = 1 ]; then
  echo "[DRY] them kho Caddy, cai caddy"
else
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

step "10. User dich vu + thu muc"
if [ "$DRY" = 0 ] && id siscom >/dev/null 2>&1; then
  info "User siscom da co"
else
  run useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin --user-group siscom
fi
run install -d -m 700 -o root -g root "$SISCOM_ETC"
run install -d -m 755 -o root -g root "$SISCOM_OPT" "$SISCOM_OPT/releases"
run install -d -m 700 -o root -g root "$SISCOM_BACKUP_DIR"
write_file /etc/systemd/journald.conf.d/siscom.conf 644 <<'CONF'
[Journal]
SystemMaxUse=500M
CONF
run systemctl restart systemd-journald

step "11. Unit systemd + Caddyfile cua repo"
for u in siscom-crm-backend.service siscom-crm-backup.service siscom-crm-backup.timer; do
  run install -m 644 -o root -g root "$here/systemd/$u" "/etc/systemd/system/$u"
done
run systemctl daemon-reload
if [ -n "$DOMAIN" ]; then
  write_file "$SISCOM_ETC/caddy.env" 600 <<CONF
SISCOM_DOMAIN=${DOMAIN}
SISCOM_ACME_CA=${ACME_CA}
CONF
  write_file /etc/systemd/system/caddy.service.d/siscom.conf 644 <<CONF
[Service]
EnvironmentFile=${SISCOM_ETC}/caddy.env
CONF
  if [ -f /etc/caddy/Caddyfile ] && ! cmp -s /etc/caddy/Caddyfile "$here/caddy/Caddyfile"; then
    run cp -n /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.orig-$(date -u +%Y%m%d)"
  fi
  run install -m 644 -o root -g root "$here/caddy/Caddyfile" /etc/caddy/Caddyfile
  run systemctl daemon-reload
  if [ "$DRY" = 0 ]; then
    ( set -a; . "$SISCOM_ETC/caddy.env"; set +a; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile ) || die "Caddyfile khong hop le."
    systemctl enable caddy
    systemctl restart caddy
  fi
  info "Caddy cho ${DOMAIN}. Ban ghi DNS A phai tro ve IP VPS truoc thi Let's Encrypt cap duoc chung chi."
else
  warn "Chua dat SISCOM_DOMAIN: bo qua cau hinh Caddy (chay lai provision.sh khi da co ten mien)."
fi

if [ "$HARDEN" = 1 ]; then
  step "12. Cung co SSH (--harden-ssh)"
  if [ "$DRY" = 0 ]; then
    [ -s /root/.ssh/authorized_keys ] || die "TU CHOI --harden-ssh: /root/.ssh/authorized_keys rong (se tu khoa minh). Dan khoa cong khai va THU dang nhap bang khoa truoc."
  fi
  write_file /etc/ssh/sshd_config.d/10-siscom-hardening.conf 644 <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  if [ "$DRY" = 0 ]; then
    sshd -t || { rm -f /etc/ssh/sshd_config.d/10-siscom-hardening.conf; die "sshd -t loi; da go cau hinh cung co."; }
  fi
  run systemctl reload ssh
  warn "GIU nguyen phien SSH hien tai; mo phien MOI bang khoa de kiem truoc khi dong."
fi

step "Kiem tra cuoi"
if [ "$DRY" = 0 ]; then
  ufw status | sed 's/^/  /'
  timedatectl | grep -E 'Time zone|synchronized' | sed 's/^/  /'
  free -m | sed 's/^/  /'
fi
info "Xong. Tiep theo: create-db.sh siscom_crm_staging create (xem docs/VPS_RUNBOOK.md)."
