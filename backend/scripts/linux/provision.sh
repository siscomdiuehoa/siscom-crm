#!/usr/bin/env bash
# SISCOM CRM - G1/G2 nen may chu: Ubuntu 24.04 (VPS 3 vCPU / 3 GB RAM / 40 GB).
#   swap 2 GB, UTC + timesyncd, ufw chi (cong SSH DANG DUNG)/80/443, fail2ban, unattended-upgrades (chi ban va bao mat, KHONG tu
#   khoi dong lai), Node 24 (NodeSource), PostgreSQL 18 (PGDG) chi nghe localhost, Caddy (HTTPS Let's Encrypt), user dich vu `siscom`
#   khong sudo, giu khoa host SSH qua cloud-init (BKNS gan lai dia seed moi lan boot), cai unit systemd + Caddyfile cua repo.
# Chay bang root TREN VPS (chua tung chay tren VPS that - xem docs/VPS_RUNBOOK.md). Idempotent: chay lai khong hong.
# Dung: SISCOM_DOMAIN=<ten mien> provision.sh [--dry-run] [--ssh-key-only]
#   --dry-run       chi in cac buoc, khong doi gi (van DOC cong SSH that bang `sshd -T` => chay bang root).
#   --ssh-key-only  (co RIENG, Owner duyet) tat dang nhap SSH bang mat khau, root chi bang khoa: drop-in
#                   /etc/ssh/sshd_config.d/00-siscom-ssh-key-only.conf. Tu choi neu tai khoan dang dang nhap chua co >= 1 khoa hop le
#                   trong authorized_keys, neu `Include sshd_config.d/*.conf` khong dung truoc cac dong xac thuc cua file chinh,
#                   neu `sshd -t` loi, hoac neu `sshd -T` sau khi ghi chua the hien dung gia tri (go drop-in, khong nap lai).
# Cong SSH: KHONG doi. Doc cong DANG DUNG tu `sshd -T` (+ ssh.socket neu dang chay), mo DUNG cac cong do tren ufw TRUOC `ufw --force enable`,
#   roi kiem `ufw status` con cac cong do (khong => tat lai ufw va dung). Khong doc duoc cong => tu choi truoc khi doi gi.
# Bien: SISCOM_DOMAIN (BAT BUOC - thieu thi dung ngay), SISCOM_ACME_CA (mac dinh Let's Encrypt that; dat
#   https://acme-staging-v02.api.letsencrypt.org/directory de thu), SISCOM_SSH_PORT (tuy chon: neu dat phai TRUNG mot cong sshd dang
#   nghe - chi de doi chieu, khong doi cong), SISCOM_SWAP_GB (2).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

DRY=0; KEYONLY=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --ssh-key-only) KEYONLY=1 ;;
    *) die "Tham so la: $a (dung: SISCOM_DOMAIN=<ten mien> provision.sh [--dry-run] [--ssh-key-only])" ;;
  esac
done

SWAP_GB="${SISCOM_SWAP_GB:-2}"
[[ "$SWAP_GB" =~ ^[1-8]$ ]] || die "SISCOM_SWAP_GB phai tu 1 den 8."
DOMAIN="${SISCOM_DOMAIN:-}"
[ -n "$DOMAIN" ] || die "Thieu SISCOM_DOMAIN (bat buoc: Caddy cap HTTPS cho ten mien; ban ghi DNS A phai tro ve IP VPS). Chua co ten mien => chua chay provision.sh."
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "SISCOM_DOMAIN khong hop le: $DOMAIN"

# Cong SSH that (F2 lam lai theo VPS that cong 26266): doc, khong doi. Doc TRUOC moi thay doi.
mapfile -t SSH_PORTS < <(sshd_ports || true)
[ "${#SSH_PORTS[@]}" -ge 1 ] || die "Khong doc duoc cong SSH dang dung (sshd -T loi/khong co cong hop le; can chay bang root). Dung truoc khi doi tuong lua."
if [ -n "${SISCOM_SSH_PORT:-}" ] && ! printf '%s\n' "${SSH_PORTS[@]}" | grep -qxF "$SISCOM_SSH_PORT"; then
  die "SISCOM_SSH_PORT=$SISCOM_SSH_PORT khong trung cong sshd dang nghe (${SSH_PORTS[*]}). Script khong doi cong SSH."
fi
SSH_PORTS_CSV="$(IFS=,; echo "${SSH_PORTS[*]}")"
info "Cong SSH dang dung: ${SSH_PORTS_CSV}"
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

step "4. Tuong lua ufw: chi SSH (${SSH_PORTS_CSV})/80/443"
# Doc lai cong ngay truoc khi bat (phong sshd doi trong luc apt chay): phai TRUNG danh sach da doc o dau.
if [ "$DRY" = 0 ]; then
  [ "$(sshd_ports | paste -sd, -)" = "$SSH_PORTS_CSV" ] || die "Cong SSH thay doi trong luc chay (nay: $(sshd_ports | paste -sd, - || true)). Dung, chua bat ufw."
fi
# Mo cong TRUOC (ke ca truong hop ufw da bat san: dat "deny" mac dinh truoc khi co quy tac SSH co the cat phien moi).
for p in "${SSH_PORTS[@]}"; do run ufw allow "${p}/tcp"; done
run ufw allow 80/tcp
run ufw allow 443/tcp
run ufw default deny incoming
run ufw default allow outgoing
run ufw --force enable
if [ "$DRY" = 1 ]; then
  echo "[DRY] kiem ufw status: phai co ${SSH_PORTS_CSV}/tcp ALLOW (khong => ufw --force disable va dung)"
else
  st="$(ufw status)"
  for p in "${SSH_PORTS[@]}"; do
    if ! printf '%s\n' "$st" | grep -Eq "^${p}/tcp[[:space:]]+ALLOW"; then
      ufw --force disable || true
      die "Sau khi bat, ufw KHONG cho phep cong SSH ${p}/tcp => da TAT lai ufw de giu truy cap. Kiem tra quy tac ufw roi chay lai."
    fi
  done
  info "ufw dang bat, cong SSH ${SSH_PORTS_CSV} van ALLOW."
fi

step "5. fail2ban (SSH, cung cong)"
write_file /etc/fail2ban/jail.d/siscom.local 644 <<CONF
[sshd]
enabled = true
port = ${SSH_PORTS_CSV}
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
{ # Caddy (SISCOM_DOMAIN da bat buoc o dau script)
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
}

step "12. cloud-init: giu khoa host SSH (BKNS gan lai dia seed NoCloud moi lan boot => cloud-init coi la may moi)"
# Chi chan viec XOA/TAO LAI khoa host SSH. Viec cloud-init dat lai mat khau root (chpasswd) KHONG doi o day - xem runbook.
cloudcfg=/etc/cloud/cloud.cfg.d/99-siscom-keep-ssh-hostkeys.cfg
if [ "$DRY" = 1 ] || [ -d /etc/cloud/cloud.cfg.d ]; then
  if [ "$DRY" = 0 ] && [ -f "$cloudcfg" ] && grep -qx 'ssh_deletekeys: false' "$cloudcfg"; then
    info "Da co $cloudcfg (ssh_deletekeys: false)."
  else
    write_file "$cloudcfg" 644 <<'CONF'
# SISCOM CRM: khong xoa/tao lai khoa host SSH khi cloud-init chay lai (seed NoCloud cua nha cung cap gan lai moi lan boot).
ssh_deletekeys: false
CONF
  fi
else
  info "Khong co cloud-init (/etc/cloud/cloud.cfg.d): bo qua."
fi

if [ "$KEYONLY" = 1 ]; then
  step "13. SSH chi bang khoa (--ssh-key-only)"
  dropin=/etc/ssh/sshd_config.d/00-siscom-ssh-key-only.conf
  login_user="${SUDO_USER:-root}"
  login_home="$(getent passwd "$login_user" | cut -d: -f6 || true)"
  if [ "$DRY" = 0 ]; then
    [ -n "$login_home" ] || die "Khong xac dinh duoc thu muc nha cua $login_user."
    nkeys="$(count_authorized_keys "$login_home/.ssh/authorized_keys")"
    [ "$nkeys" -ge 1 ] || die "TU CHOI --ssh-key-only: $login_home/.ssh/authorized_keys cua $login_user khong co khoa hop le (se tu khoa minh). Dan khoa cong khai va THU dang nhap bang khoa o phien MOI truoc."
    sshd -T 2>/dev/null | awk 'tolower($1) == "authorizedkeysfile"' | grep -q '\.ssh/authorized_keys' \
      || die "TU CHOI: AuthorizedKeysFile cua sshd khong gom .ssh/authorized_keys."
    sshd_include_first /etc/ssh/sshd_config \
      || die "TU CHOI: /etc/ssh/sshd_config khong co 'Include /etc/ssh/sshd_config.d/*.conf' TRUOC cac dong xac thuc (OpenSSH lay gia tri dau tien => drop-in se khong co hieu luc). Sua file chinh truoc."
    info "$login_user co $nkeys khoa hop le; Include drop-in dung truoc."
  else
    echo "[DRY] kiem: authorized_keys cua ${login_user} co >= 1 khoa hop le; Include sshd_config.d/*.conf dung truoc trong sshd_config; AuthorizedKeysFile"
  fi
  write_file "$dropin" 644 <<'CONF'
# SISCOM CRM (--ssh-key-only): ten 00- de dung TRUOC moi drop-in khac (vd 50-cloud-init.conf); OpenSSH lay gia tri dau tien.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  if [ "$DRY" = 0 ]; then
    sshd -t || { rm -f "$dropin"; die "sshd -t loi; da go $dropin, KHONG nap lai sshd."; }
    eff="$(sshd -T 2>/dev/null | awk '{ print tolower($1) "=" tolower($2) }')"
    if ! { printf '%s\n' "$eff" | grep -qx 'passwordauthentication=no' && printf '%s\n' "$eff" | grep -qx 'kbdinteractiveauthentication=no' \
           && printf '%s\n' "$eff" | grep -Eqx 'permitrootlogin=(prohibit-password|without-password)'; }; then
      rm -f "$dropin"; die "sshd -T chua the hien PasswordAuthentication/KbdInteractive=no, PermitRootLogin=prohibit-password (co cau hinh khac dung truoc). Da go $dropin, KHONG nap lai."
    fi
  else
    echo "[DRY] sshd -t; sshd -T phai the hien passwordauthentication no, kbdinteractiveauthentication no, permitrootlogin prohibit-password (khong => go drop-in)"
  fi
  run systemctl reload-or-restart ssh
  warn "GIU nguyen phien SSH hien tai; mo phien MOI bang khoa (dung cong ${SSH_PORTS_CSV}) de kiem truoc khi dong. Lui: rm $dropin && systemctl reload-or-restart ssh"
fi

step "Kiem tra cuoi"
if [ "$DRY" = 0 ]; then
  ufw status | sed 's/^/  /'
  timedatectl | grep -E 'Time zone|synchronized' | sed 's/^/  /'
  free -m | sed 's/^/  /'
fi
info "Xong. Tiep theo: create-db.sh siscom_crm_staging create (xem docs/VPS_RUNBOOK.md)."
