#!/usr/bin/env bash
# SISCOM CRM - kiem thu KHONG can VPS/PostgreSQL cho bo script Linux: guard ten DB, giu ban sao luu, guard tag cua deploy.sh,
# --dry-run cua provision/deploy, va cac bat bien cua unit systemd/Caddyfile. Chay: bash backend/scripts/linux/tests/test-guards.sh
# Khong cham mang, khong cham PostgreSQL, khong ghi ngoai thu muc tam.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lin="$(cd "$here/.." && pwd)"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
check() { # check <ten> <lenh...> : lenh phai thanh cong
  local n="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$n"; else bad "$n"; fi
}
check_not() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then bad "$n"; else ok "$n"; fi; }
contains() { printf '%s' "$1" | grep -qF -- "$2"; }

echo "== 1. Guard ten database (lib.sh) =="
# shellcheck source=../lib.sh
. "$lin/lib.sh"
for n in siscom_crm_staging siscom_crm_prod; do check "is_ops_db $n" is_ops_db "$n"; done
for n in siscom_crm_dev siscom_crm_test_20261029_062004 siscom_crm_restore_20261014_214105 postgres siscom_crm_prod2 siscom_crm_staging_x \
         SISCOM_CRM_PROD "siscom_crm_prod;DROP" "siscom_crm_prod " " siscom_crm_prod" "" crm_prod siscom_crm_; do
  check_not "is_ops_db tu choi '$n'" is_ops_db "$n"
done
check "is_restore_db hop le" is_restore_db siscom_crm_restore_20261111_190000
for n in siscom_crm_restore_2026111_190000 siscom_crm_restore_20261111_190000x siscom_crm_prod siscom_crm_test_20261111_190000 "siscom_crm_restore_20261111_190000;x"; do
  check_not "is_restore_db tu choi '$n'" is_restore_db "$n"
done
check "db_kind staging" test "$(db_kind siscom_crm_staging)" = staging
check "db_kind prod" test "$(db_kind siscom_crm_prod)" = prod
check "url_dbname" test "$(url_dbname 'postgresql://u:p@127.0.0.1:5432/siscom_crm_prod?sslmode=disable')" = siscom_crm_prod
printf 'A=1\nMIGRATE_DATABASE_URL=postgresql://m:x@h/d\n' > "$tmp/e.env"
check "env_get" test "$(env_get "$tmp/e.env" MIGRATE_DATABASE_URL)" = "postgresql://m:x@h/d"
check_not "env_get thieu khoa" env_get "$tmp/e.env" NOPE
# psql_su che do dien tap tu choi cong 5432 va 55433 (khong cham PostgreSQL that/demo)
for p in 5432 55433 ""; do
  check_not "SISCOM_REHEARSAL tu choi cong '$p'" bash -c ". '$lin/lib.sh'; SISCOM_REHEARSAL=1 PGHOST=127.0.0.1 PGPORT='$p' psql_su -c 'select 1'"
done

echo "== 2. Giu ban sao luu 14 ngay + 8 tuan (retention_keep) =="
# 100 ngay lien tuc, moi ngay 1 ban, ket thuc 2026-11-10
: > "$tmp/list.txt"
for i in $(seq 0 99); do d="$(date -u -d "2026-11-10 -$i day" +%Y%m%d)"; echo "siscom_crm_prod_${d}_190000.dump.age" >> "$tmp/list.txt"; done
echo "ban_la.txt" >> "$tmp/list.txt"; echo "siscom_crm_prod_2026_x.dump.age" >> "$tmp/list.txt"
keep="$(retention_keep 14 8 < "$tmp/list.txt")"
check "giu ban moi nhat" contains "$keep" "siscom_crm_prod_20261110_190000.dump.age"
check "giu ban thu 14" contains "$keep" "siscom_crm_prod_20261028_190000.dump.age"
check_not "bo ban thu 15 neu khong la ban tuan" bash -c "printf '%s' '$keep' | grep -qF siscom_crm_prod_20261026_190000"
n="$(printf '%s\n' "$keep" | grep -c .)"
# 14 ban gan nhat phu 2-3 tuan ISO; them toi da 8 tuan => tong <= 14 + 8
if [ "$n" -ge 14 ] && [ "$n" -le 22 ]; then ok "so ban giu $n trong [14,22]"; else bad "so ban giu $n ngoai [14,22]"; fi
check_not "khong giu ten la" contains "$keep" "ban_la.txt"
# moi tuan trong 8 tuan gan nhat co dung 1 ban tuan (ban moi nhat cua tuan)
wk_n="$(printf '%s\n' "$keep" | sed -E 's/.*_([0-9]{8})_.*/\1/' | while read -r d; do date -u -d "${d:0:4}-${d:4:2}-${d:6:2}" +%G-%V; done | sort -u | wc -l)"
if [ "$wk_n" -ge 8 ]; then ok "phu >= 8 tuan ISO ($wk_n)"; else bad "chi phu $wk_n tuan"; fi
one="$(printf 'siscom_crm_prod_20261110_190000.dump.age\n' | retention_keep 14 8)"
check "danh sach 1 phan tu duoc giu" test "$one" = "siscom_crm_prod_20261110_190000.dump.age"
check "danh sach rong khong loi" bash -c ". '$lin/lib.sh'; printf '' | retention_keep 14 8"

echo "== 3. create-db.sh tu choi ten/lenh la (khong can PostgreSQL) =="
for n in siscom_crm_dev siscom_crm_test_20261029_062004 siscom_crm_restore_20261014_214105 postgres 'siscom_crm_prod;x' ''; do
  out="$(SISCOM_ETC="$tmp/etc" bash "$lin/create-db.sh" "$n" create 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && { contains "$out" "TU CHOI" || [ -z "$n" ]; }; then ok "create-db tu choi '$n'"; else bad "create-db khong tu choi '$n' (rc=$rc)"; fi
done
# Chi chep rieng thu muc script (thieu backend/docs chua file SQL S1) => phai bao RO, truoc khi cham PostgreSQL
mkdir -p "$tmp/onlyscripts"; cp -r "$lin" "$tmp/onlyscripts/linux"
out="$(bash "$tmp/onlyscripts/linux/create-db.sh" siscom_crm_staging create 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "backend/docs"; then ok "create-db thieu backend/docs => dung, bao ro"; else bad "create-db thieu backend/docs khong bao ro (rc=$rc)"; fi
out="$(bash "$lin/create-db.sh" siscom_crm_prod xoa 2>&1)"; rc=$?
if [ "$rc" -ne 0 ]; then ok "create-db tu choi lenh la"; else bad "create-db nhan lenh la"; fi

echo "== 4. deploy.sh: dinh dang tag + tag phai thuoc origin/main =="
opt="$tmp/opt"; etc="$tmp/etc"; mkdir -p "$opt/releases" "$etc"
bare="$tmp/origin.git"; git init -q --bare -b main "$bare"
git clone -q "$bare" "$opt/repo" 2>/dev/null
( cd "$opt/repo" && git config user.email t@t && git config user.name t && git checkout -q -b main \
  && mkdir backend && echo '{}' > backend/package.json && git add . && git commit -qm c1 && git tag v0.1.0 \
  && git push -q origin main && git checkout -q -b side && echo x > backend/x && git add . && git commit -qm side && git tag v0.9.9 \
  && git push -q origin side --tags && git checkout -q main && git fetch -q origin ) >/dev/null 2>&1
mkdir -p "$tmp/fe"; echo '<html/>' > "$tmp/fe/index.html"
run_deploy() { SISCOM_ETC="$etc" SISCOM_OPT="$opt" bash "$lin/deploy.sh" "$@" 2>&1; }
for t in main v1 1.0.0 'v1.0.0;x' 'v1.0.0 ' v1.0 '../v1.0.0'; do
  out="$(run_deploy --dry-run --tag "$t" --frontend "$tmp/fe")"; rc=$?
  if [ "$rc" -ne 0 ] && contains "$out" "sai dinh dang"; then ok "tag '$t' bi tu choi"; else bad "tag '$t' khong bi tu choi (rc=$rc)"; fi
done
out="$(run_deploy --dry-run --tag v0.1.0 --frontend "$tmp/fe")"; rc=$?
if [ "$rc" -eq 0 ] && contains "$out" "thuoc origin/main" && contains "$out" "[DRY]"; then ok "tag thuoc main -> ke hoach dry-run"; else bad "tag thuoc main bi tu choi sai (rc=$rc): $out"; fi
out="$(run_deploy --dry-run --tag v0.9.9 --frontend "$tmp/fe")"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "KHONG thuoc lich su origin/main"; then ok "tag ngoai main bi tu choi"; else bad "tag ngoai main khong bi tu choi (rc=$rc)"; fi
out="$(run_deploy --dry-run --tag v7.7.7 --frontend "$tmp/fe")"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "khong ton tai"; then ok "tag khong ton tai bi tu choi"; else bad "tag khong ton tai (rc=$rc)"; fi
out="$(run_deploy --dry-run --frontend "$tmp/fe")"; rc=$?
if [ "$rc" -ne 0 ]; then ok "thieu --tag/--src bi tu choi"; else bad "thieu --tag/--src khong bi tu choi"; fi
out="$(run_deploy --dry-run --tag v0.1.0 --src "$tmp" --frontend "$tmp/fe")"; rc=$?
if [ "$rc" -ne 0 ]; then ok "--tag va --src cung luc bi tu choi"; else bad "--tag + --src khong bi tu choi"; fi
out="$(run_deploy --dry-run --tag v0.1.0 --frontend "$tmp/nope")"; rc=$?
if [ "$rc" -ne 0 ]; then ok "--frontend khong co index.html bi tu choi"; else bad "--frontend la khong bi tu choi"; fi
# --src: thu muc co backend/package.json
mkdir -p "$tmp/srctree/backend"; echo '{}' > "$tmp/srctree/backend/package.json"
out="$(run_deploy --dry-run --src "$tmp/srctree" --frontend "$tmp/fe")"; rc=$?
if [ "$rc" -eq 0 ] && contains "$out" "[DRY]"; then ok "--src hop le -> dry-run"; else bad "--src dry-run loi (rc=$rc): $out"; fi
out="$(run_deploy --dry-run --src "$tmp" --frontend "$tmp/fe")"; rc=$?
if [ "$rc" -ne 0 ]; then ok "--src thieu backend/package.json bi tu choi"; else bad "--src sai khong bi tu choi"; fi
# backend.env tro DB la => deploy tu choi
for k in "DATABASE_URL|siscom_app" "AUTH_DATABASE_URL|siscom_auth"; do printf '%s=postgresql://%s:%048d@127.0.0.1:5432/siscom_crm_dev\n' "${k%%|*}" "${k#*|}" 0; done > "$etc/backend.env"
printf 'MIGRATE_DATABASE_URL=postgresql://siscom_migrator:%048d@127.0.0.1:5432/siscom_crm_dev\n' 0 > "$etc/migrate.env"; chmod 600 "$etc/backend.env" "$etc/migrate.env"
out="$(SISCOM_REHEARSAL=1 SISCOM_ETC="$etc" SISCOM_OPT="$opt" bash "$lin/deploy.sh" --dry-run --tag v0.1.0 --frontend "$tmp/fe" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "TU CHOI"; then ok "backend.env tro siscom_crm_dev bi tu choi"; else bad "backend.env DB la khong bi tu choi (rc=$rc)"; fi
chmod 644 "$etc/backend.env"
out="$(SISCOM_ETC="$etc" SISCOM_OPT="$opt" bash "$lin/deploy.sh" --dry-run --tag v0.1.0 --frontend "$tmp/fe" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "600"; then ok "backend.env quyen 644 bi tu choi"; else bad "backend.env 644 khong bi tu choi (rc=$rc)"; fi
rm -f "$etc/backend.env" "$etc/migrate.env"
out="$(run_deploy --rollback ../../etc 2>&1)"; rc=$?
if [ "$rc" -ne 0 ]; then ok "rollback ID co ../ bi tu choi"; else bad "rollback ID ../ khong bi tu choi"; fi

echo "== 5. provision.sh --dry-run =="
# sshd/systemctl GIA tren PATH: provision doc cong SSH that bang `sshd -T` (ca khi dry-run). STUB_SSHD_PORTS="22,26266" | FAIL.
stub="$tmp/stub"; mkdir -p "$stub"
cat > "$stub/sshd" <<'STUB'
#!/usr/bin/env bash
[ "${1:-}" = -T ] || exit 0
[ "${STUB_SSHD_PORTS:-}" = FAIL ] && { echo "sshd: no hostkeys available" >&2; exit 1; }
echo "permitrootlogin yes"
IFS=, read -ra ps <<<"${STUB_SSHD_PORTS:-}"; for p in "${ps[@]}"; do echo "port $p"; done
echo "authorizedkeysfile .ssh/authorized_keys .ssh/authorized_keys2"
STUB
printf '#!/usr/bin/env bash\nexit 1\n' > "$stub/systemctl"
chmod +x "$stub/sshd" "$stub/systemctl"
# DNS/IP/caddy GIA: STUB_DNS="ip1,ip2" (rong => khong co ban ghi), STUB_SRC_IP = dia chi nguon cua tuyen ra Internet, STUB_CADDY_VER.
cat > "$stub/dig" <<'STUB'
#!/usr/bin/env bash
IFS=, read -ra ips <<<"${STUB_DNS:-}"; for i in "${ips[@]}"; do [ -n "$i" ] && echo "$i"; done; exit 0
STUB
cat > "$stub/ip" <<'STUB'
#!/usr/bin/env bash
echo "1.1.1.1 via 10.0.0.1 dev eth0 src ${STUB_SRC_IP:-42.96.15.235} uid 0"
STUB
cat > "$stub/caddy" <<'STUB'
#!/usr/bin/env bash
[ "${1:-}" = version ] && echo "v${STUB_CADDY_VER:-2.11.9} h1:stub"; exit 0
STUB
chmod +x "$stub/dig" "$stub/ip" "$stub/caddy"
# ufw GIA co trang thai (STUB_UFW_DIR: rules = moi dong "allow 26266/tcp" | "deny 26266/tcp"..., active, default) + nhat ky loi goi (calls).
# STUB_UFW_INJECT_AFTER_ENABLE="<rule>": chen rule la khi enable (mo phong rule xuat hien giua chung). STUB_UFW_DROP_SSH_AFTER_ENABLE=<cong>: mat rule SSH khi enable.
cat > "$stub/ufw" <<'STUB'
#!/usr/bin/env bash
d="${STUB_UFW_DIR:-}"
if [ -z "$d" ]; then [ "${1:-} ${2:-}" = "show added" ] && { echo "Added user rules (see 'ufw status' for running firewall):"; echo "(None)"; }; exit 0; fi
mkdir -p "$d"; touch "$d/rules"; echo "$*" >> "$d/calls"
st="$(cat "$d/active" 2>/dev/null || echo inactive)"; def="$(cat "$d/default" 2>/dev/null || echo 'deny (incoming), allow (outgoing), disabled (routed)')"
case "$*" in
  "show added")
    echo "Added user rules (see 'ufw status' for running firewall):"
    if [ -s "$d/rules" ]; then sed 's/^/ufw /' "$d/rules"; else echo "(None)"; fi ;;
  allow\ *|deny\ *|limit\ *|reject\ *)
    grep -qxF "$*" "$d/rules" && echo "Skipping adding existing rule" || { echo "$*" >> "$d/rules"; echo "Rule added"; } ;;
  "default deny incoming") echo "${def/* (incoming)/deny (incoming)}" > /dev/null; echo "deny (incoming), allow (outgoing), disabled (routed)" > "$d/default" ;;
  "default allow outgoing") : ;;
  "--force enable")
    echo active > "$d/active"
    [ -n "${STUB_UFW_INJECT_AFTER_ENABLE:-}" ] && echo "$STUB_UFW_INJECT_AFTER_ENABLE" >> "$d/rules"
    [ -n "${STUB_UFW_DROP_SSH_AFTER_ENABLE:-}" ] && { grep -vxF "allow ${STUB_UFW_DROP_SSH_AFTER_ENABLE}/tcp" "$d/rules" > "$d/r2" || true; mv "$d/r2" "$d/rules"; }
    echo "Firewall is active and enabled on system startup" ;;
  "--force disable") echo inactive > "$d/active"; echo "Firewall stopped and disabled on system startup" ;;
  "status verbose"|"status")
    if [ "$st" != active ]; then echo "Status: inactive"; exit 0; fi
    echo "Status: active"; echo "Logging: on (low)"; echo "Default: $def"; echo "New profiles: skip"; echo
    printf '%-27s%-12s%s\n' To Action From; printf '%-27s%-12s%s\n' -- ------ ----
    for v6 in "" " (v6)"; do
      while read -r act port; do
        a="$(echo "$act" | tr a-z A-Z) IN"; printf '%-27s%-12s%s\n' "$port$v6" "$a" "Anywhere$v6"
      done < "$d/rules"
    done ;;
  *) echo "ufw gia: lenh khong ho tro: $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$stub/ufw"
export STUB_DNS=42.96.15.235 STUB_SRC_IP=42.96.15.235
out="$(PATH="$stub:$PATH" STUB_SSHD_PORTS=22 SISCOM_ETC="$tmp/e2" SISCOM_OPT="$tmp/o2" SISCOM_BACKUP_DIR="$tmp/b2" SISCOM_HOST=crm-staging.siscom.io.vn bash "$lin/provision.sh" --dry-run 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "dry-run thanh cong" || bad "dry-run loi rc=$rc"
for p in "ufw allow 22/tcp" "ufw allow 80/tcp" "ufw allow 443/tcp" "ufw default deny incoming" "fallocate -l 2G /swapfile" "node_24.x" "postgresql-18" "fail2ban" "unattended-upgrades" "caddy"; do
  check "dry-run co '$p'" contains "$out" "$p"
done
n_allow="$(printf '%s\n' "$out" | grep -c '^\[DRY\] ufw allow')"
[ "$n_allow" -eq 3 ] && ok "chi 3 quy tac ufw allow" || bad "so quy tac ufw allow = $n_allow"
check_not "khong mo 5432/3000" bash -c "printf '%s' '$out' | grep -E 'ufw allow (5432|3000)'"
out="$(PATH="$stub:$PATH" STUB_SSHD_PORTS=22 SISCOM_HOST='bad_domain' bash "$lin/provision.sh" --dry-run 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "SISCOM_HOST sai bi tu choi" || bad "SISCOM_HOST sai khong bi tu choi"
out="$(bash "$lin/provision.sh" --bogus 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "tham so la bi tu choi" || bad "tham so la khong bi tu choi"

echo "== 6. Bat bien unit systemd / Caddyfile / env mau =="
svc="$lin/systemd/siscom-crm-backend.service"
for p in "User=siscom" "EnvironmentFile=/etc/siscom-crm/backend.env" "Environment=HOST=127.0.0.1" "Environment=PORT=3000" "Environment=NODE_ENV=production" \
         "Environment=EXPORT_GAP_LOG_DIR=/var/log/siscom-crm/export-gap" "LogsDirectory=siscom-crm" "Environment=TRUST_PROXY=loopback" "Environment=COOKIE_SECURE=true" "NoNewPrivileges=true" "ProtectSystem=strict" "ReadOnlyPaths=/opt/siscom-crm" "Restart=on-failure"; do
  check "unit co '$p'" grep -qxF "$p" "$svc"
done
check_not "unit khong chay root" grep -Eq '^User=root' "$svc"
check_not "unit khong co MIGRATE_DATABASE_URL" grep -q MIGRATE_DATABASE_URL "$svc"
check "timer 19:00 UTC" grep -q 'OnCalendar=\*-\*-\* 19:00:00 UTC' "$lin/systemd/siscom-crm-backup.timer"
check "timer Persistent" grep -q 'Persistent=true' "$lin/systemd/siscom-crm-backup.timer"
cf="$lin/caddy/Caddyfile"
check "Caddyfile co HSTS" grep -q 'Strict-Transport-Security' "$cf"
check "Caddyfile /api/* -> 127.0.0.1:3000" grep -q 'reverse_proxy 127.0.0.1:3000' "$cf"
check "Caddyfile phuc vu dist tinh" grep -q 'root \* /opt/siscom-crm/current/web' "$cf"
check_not "Caddyfile khong ghi de Origin" grep -qi 'header_up Origin' "$cf"
check "env mau dung CHANGE_ME" grep -q CHANGE_ME "$lin/env/backend.env.example"
check_not "env mau khong co MIGRATE_DATABASE_URL (dong gia tri)" grep -Eq '^MIGRATE_DATABASE_URL=' "$lin/env/backend.env.example"
check_not "khong co mat khau that trong script" grep -REq 'postgres(ql)?://[a-z_]+:[0-9a-f]{32,}@' "$lin"

echo "== 7. F1 (PR232-R1): manifest sao luu phai duoc KY (ssh-keygen -Y) va rang buoc vao file sao luu =="
if ! command -v ssh-keygen >/dev/null 2>&1; then
  bad "thieu ssh-keygen (OpenSSH) - khong kiem duoc F1"
else
  bk="$tmp/f1"; mkdir -p "$bk"
  ssh-keygen -q -t ed25519 -N '' -C siscom-crm-backup -f "$tmp/sk" >/dev/null
  printf 'siscom-crm-backup namespaces="siscom-crm-backup" %s\n' "$(cat "$tmp/sk.pub")" > "$tmp/allowed"
  ssh-keygen -q -t ed25519 -N '' -C attacker -f "$tmp/evil" >/dev/null
  mkset() { # mkset <stamp> <noi dung>: tao 1 bo sao luu gia (file + manifest da ky bang khoa that)
    local f="$bk/siscom_crm_prod_$1.dump.age"
    printf '%s' "$2" > "$f"
    { echo "db=siscom_crm_prod"; echo "taken_utc=$1"; echo "rows|customer|3"; echo "plain_sha256=$(printf 'plain-%s' "$2" | sha256sum | cut -d' ' -f1)"
      echo "file=$(basename "$f")"; echo "file_sha256=$(sha256sum "$f" | cut -d' ' -f1)"; } > "$bk/siscom_crm_prod_$1.manifest"
    backup_sign "$bk/siscom_crm_prod_$1.manifest" "$tmp/sk"
  }
  vset() { verify_backup_set "$bk/siscom_crm_prod_$1.dump.age" "$tmp/allowed" "${2:-siscom_crm_prod}"; }
  if ! declare -F backup_sign >/dev/null || ! declare -F verify_backup_set >/dev/null; then
    bad "lib.sh chua co backup_sign/verify_backup_set (F1 chua sua)"
  else
    mkset 20261110_190000 AAAA; mkset 20261111_190000 BBBB
    check "bo sao luu nguyen ven duoc chap nhan" vset 20261110_190000
    check_not "ten DB mong doi khac => tu choi" vset 20261110_190000 siscom_crm_staging
    m="$bk/siscom_crm_prod_20261110_190000.manifest"; cp "$m" "$m.orig"
    sed -i 's/^rows|customer|3/rows|customer|4/' "$m"; check_not "sua so dong trong manifest => tu choi" vset 20261110_190000; cp "$m.orig" "$m"
    sed -i 's/^db=siscom_crm_prod/db=siscom_crm_staging/' "$m"; check_not "sua ten DB trong manifest => tu choi" vset 20261110_190000; cp "$m.orig" "$m"
    sed -i 's/^plain_sha256=./plain_sha256=0/' "$m"; check_not "sua hash trong manifest => tu choi" vset 20261110_190000; cp "$m.orig" "$m"
    printf 'X' >> "$bk/siscom_crm_prod_20261110_190000.dump.age"; check_not "file sao luu bi sua => tu choi" vset 20261110_190000
    printf 'AAAA' > "$bk/siscom_crm_prod_20261110_190000.dump.age"; check "khoi phuc file goc => lai chap nhan" vset 20261110_190000
    # thay CA file + manifest + chu ky bang bo B (hop le, cung khoa) duoi ten A => file= trong manifest khong khop ten
    for s in .dump.age .manifest .manifest.sig; do cp "$bk/siscom_crm_prod_20261110_190000$s" "$tmp/a$s"; cp "$bk/siscom_crm_prod_20261111_190000$s" "$bk/siscom_crm_prod_20261110_190000$s"; done
    check_not "thay ca bo bang bo sao luu khac => tu choi" vset 20261110_190000
    for s in .dump.age .manifest .manifest.sig; do cp "$tmp/a$s" "$bk/siscom_crm_prod_20261110_190000$s"; done
    cp "$bk/siscom_crm_prod_20261111_190000.dump.age" "$bk/siscom_crm_prod_20261110_190000.dump.age"
    check_not "chi thay file sao luu (giu manifest) => tu choi" vset 20261110_190000
    printf 'AAAA' > "$bk/siscom_crm_prod_20261110_190000.dump.age"
    # ke tan cong co khoa CONG KHAI age (tu tao ban sao luu hop le) va tu ky bang khoa rieng cua minh => khong nam trong allowed_signers
    sed -i 's/^rows|customer|3/rows|customer|9/' "$m"; rm -f "$m.sig"; ssh-keygen -q -Y sign -f "$tmp/evil" -n siscom-crm-backup "$m" >/dev/null 2>&1
    check_not "manifest ky bang khoa la => tu choi" vset 20261110_190000
    cp "$m.orig" "$m"; rm -f "$m.sig"; check_not "thieu chu ky => tu choi" vset 20261110_190000
    backup_sign "$m" "$tmp/sk"; check "ky lai bang khoa that => chap nhan" vset 20261110_190000
    mv "$m" "$m.x"; check_not "thieu manifest => tu choi" vset 20261110_190000; mv "$m.x" "$m"
    check_not "allowed_signers rong => tu choi" verify_backup_set "$bk/siscom_crm_prod_20261110_190000.dump.age" /dev/null siscom_crm_prod
  fi
  # restore-test KHONG duoc con nhanh "khong co manifest => so voi DB nguon hien tai"
  check_not "restore-test khong con nhanh du phong thieu manifest" grep -q 'Khong co manifest: se so voi DB nguon' "$lin/restore-test.sh"
  check "backup-db.sh ky manifest" grep -q 'backup_sign' "$lin/backup-db.sh"
  check "restore-test.sh xac thuc bo sao luu" grep -q 'verify_backup_set' "$lin/restore-test.sh"
fi

echo "== 8. F2 (VPS that dung cong 26266): cong SSH doc tu sshd -T; ufw + fail2ban mo DUNG cong do; khong doc duoc => tu choi =="
prov() { # prov <cong sshd gia, cach nhau dau phay | FAIL> [tham so...]: provision --dry-run voi sshd/systemctl gia tren PATH
  local ports="$1"; shift
  PATH="$stub:$PATH" STUB_SSHD_PORTS="$ports" SISCOM_ETC="$tmp/e8" SISCOM_OPT="$tmp/o8" SISCOM_BACKUP_DIR="$tmp/b8" \
    SISCOM_HOST="${HOST_T-crm-staging.siscom.io.vn}" bash "$lin/provision.sh" --dry-run "$@" 2>&1
}
out="$(prov 26266)"; rc=$?
if [ "$rc" -eq 0 ] && contains "$out" "ufw allow 26266/tcp" && contains "$out" "port = 26266"; then ok "cong 26266: ufw + fail2ban dung 26266"; else bad "cong 26266 (rc=$rc)"; fi
check_not "cong 26266: KHONG mo 22" contains "$out" "ufw allow 22/tcp"
n_allow="$(printf '%s\n' "$out" | grep -c '^\[DRY\] ufw allow')"
[ "$n_allow" -eq 3 ] && ok "cong 26266: chi 3 quy tac (SSH that, 80, 443)" || bad "cong 26266: $n_allow quy tac ufw allow"
o_ena="$(printf '%s\n' "$out" | grep -n 'ufw --force enable' | cut -d: -f1)"; o_ssh="$(printf '%s\n' "$out" | grep -n 'ufw allow 26266/tcp' | cut -d: -f1)"
[ -n "$o_ena" ] && [ -n "$o_ssh" ] && [ "$o_ssh" -lt "$o_ena" ] && ok "mo cong SSH TRUOC ufw --force enable" || bad "thu tu mo cong / enable sai"
check "co buoc kiem ufw status sau enable" contains "$out" "kiem ufw status"
out="$(prov 22,26266)"; rc=$?
if [ "$rc" -eq 0 ] && contains "$out" "ufw allow 22/tcp" && contains "$out" "ufw allow 26266/tcp" && contains "$out" "port = 22,26266"; then ok "nhieu cong (22,26266): mo ca hai"; else bad "nhieu cong (rc=$rc)"; fi
for bad_ports in FAIL "" abc 0 70000; do
  out="$(prov "$bad_ports")"; rc=$?
  if [ "$rc" -ne 0 ] && ! contains "$out" "ufw allow"; then ok "cong sshd '$bad_ports' => tu choi truoc khi doi ufw"; else bad "cong sshd '$bad_ports' khong bi tu choi (rc=$rc)"; fi
done
out="$(SISCOM_SSH_PORT=22 prov 26266)"; rc=$?
[ "$rc" -ne 0 ] && ok "SISCOM_SSH_PORT khac cong that => tu choi" || bad "SISCOM_SSH_PORT=22 trong khi sshd 26266 khong bi tu choi"
out="$(SISCOM_SSH_PORT=26266 prov 26266)"; rc=$?
[ "$rc" -eq 0 ] && ok "SISCOM_SSH_PORT khop cong that => chap nhan" || bad "SISCOM_SSH_PORT khop van bi tu choi (rc=$rc)"

echo "== 8b. SISCOM_HOST bat buoc: ten mien (mac dinh) hoac IPv4 cong khai; kiem DNS truoc khi doi gi =="
for h in crm.siscom.io.vn crm-staging.siscom.io.vn; do check "host_kind $h = domain" test "$(host_kind "$h")" = domain; done
check "host_kind 42.96.15.235 = ipv4" test "$(host_kind 42.96.15.235)" = ipv4
for h in 10.0.0.1 192.168.1.10 127.0.0.1 172.20.1.1 100.64.1.1 169.254.1.1 0.1.2.3 224.0.0.1 256.1.1.1 01.2.3.4 1.2.3 siscom a_b.vn 'crm.siscom.io.vn;x' '' CRM.SISCOM.IO.VN; do
  check_not "host_kind tu choi '$h'" host_kind "$h"
done
check "version_ge 2.11.9 >= 2.10.0" version_ge 2.11.9 2.10.0
check_not "version_ge 2.9.1 >= 2.10.0" version_ge 2.9.1 2.10.0
check "days_until ngay tuong lai > 0" test "$(days_until "$(date -u -d '+5 days' '+%b %d %H:%M:%S %Y GMT')")" -ge 4
out="$(HOST_T='' prov 26266)"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "SISCOM_HOST" && ! contains "$out" "apt-get"; then ok "thieu SISCOM_HOST => dung truoc khi lam gi"; else bad "thieu SISCOM_HOST khong dung (rc=$rc)"; fi
out="$(SISCOM_DOMAIN=crm.siscom.io.vn prov 26266)"; rc=$?
[ "$rc" -ne 0 ] && contains "$out" "SISCOM_HOST" && ok "bien cu SISCOM_DOMAIN => dung, bao doi ten" || bad "SISCOM_DOMAIN cu van duoc nhan (rc=$rc)"
# ten mien: DNS A phai = dung IP cong khai cua VPS
out="$(prov 26266)"; rc=$?
if [ "$rc" -eq 0 ] && contains "$out" "SISCOM_HOST=crm-staging.siscom.io.vn" && contains "$out" "tls-domain.caddy"; then ok "ten mien + DNS dung => Caddy che do ten mien"; else bad "ten mien DNS dung (rc=$rc)"; fi
check_not "che do ten mien KHONG dung profile shortlived" contains "$out" "tls-ip-shortlived.caddy"
for dns in 1.2.3.4 "" "42.96.15.235,1.2.3.4"; do
  out="$(STUB_DNS="$dns" prov 26266)"; rc=$?
  if [ "$rc" -ne 0 ] && contains "$out" "DNS" && ! contains "$out" "apt-get"; then ok "DNS '$dns' khong trung 42.96.15.235 => dung truoc khi lam gi"; else bad "DNS '$dns' khong bi tu choi (rc=$rc)"; fi
done
out="$(STUB_SRC_IP=10.0.0.5 prov 26266)"; rc=$?
[ "$rc" -ne 0 ] && contains "$out" "SISCOM_PUBLIC_IP" && ok "IP nguon la IP rieng, khong dat SISCOM_PUBLIC_IP => dung" || bad "IP rieng khong bi tu choi (rc=$rc)"
out="$(STUB_SRC_IP=10.0.0.5 SISCOM_PUBLIC_IP=42.96.15.235 prov 26266)"; rc=$?
[ "$rc" -eq 0 ] && ok "SISCOM_PUBLIC_IP=42.96.15.235 => chap nhan" || bad "SISCOM_PUBLIC_IP dung van bi tu choi (rc=$rc)"
# IPv4: phuong an phu, profile shortlived; tls internal chi khi chi dinh ro
out="$(HOST_T=42.96.15.235 prov 26266)"; rc=$?
if [ "$rc" -eq 0 ] && contains "$out" "tls-ip-shortlived.caddy" && contains "$out" "SISCOM_HOST=42.96.15.235"; then ok "IPv4 => profile shortlived (mac dinh cua che do IP)"; else bad "IPv4 shortlived (rc=$rc)"; fi
out="$(HOST_T=42.96.15.236 prov 26266)"; rc=$?
[ "$rc" -ne 0 ] && ! contains "$out" "apt-get" && ok "IPv4 khac IP cong khai cua may => dung" || bad "IPv4 sai may khong bi tu choi (rc=$rc)"
out="$(HOST_T=42.96.15.235 SISCOM_TLS_MODE=internal prov 26266)"; rc=$?
[ "$rc" -eq 0 ] && contains "$out" "tls-ip-internal.caddy" && ok "IPv4 + SISCOM_TLS_MODE=internal => tls internal" || bad "IPv4 internal (rc=$rc)"
out="$(SISCOM_TLS_MODE=internal prov 26266)"; rc=$?
[ "$rc" -ne 0 ] && ok "ten mien + tls internal => tu choi" || bad "ten mien + internal khong bi tu choi"
out="$(SISCOM_TLS_MODE=bogus prov 26266)"; rc=$?
[ "$rc" -ne 0 ] && ok "SISCOM_TLS_MODE la => tu choi" || bad "SISCOM_TLS_MODE la khong bi tu choi"
# Caddy: phien ban + noi dung tep
check "caddy_version_check ipv4-acme 2.11.9" env PATH="$stub:$PATH" STUB_CADDY_VER=2.11.9 bash -c ". '$lin/lib.sh'; caddy_version_check ipv4-acme"
check_not "caddy_version_check ipv4-acme 2.9.1 => loi" env PATH="$stub:$PATH" STUB_CADDY_VER=2.9.1 bash -c ". '$lin/lib.sh'; caddy_version_check ipv4-acme"
check "caddy_version_check domain 2.9.1 => chi canh bao" env PATH="$stub:$PATH" STUB_CADDY_VER=2.9.1 bash -c ". '$lin/lib.sh'; caddy_version_check domain"
check "Caddyfile dung {\$SISCOM_HOST}" grep -q '^{\$SISCOM_HOST} {' "$lin/caddy/Caddyfile"
check "Caddyfile import tep TLS" grep -q 'import /etc/caddy/siscom-tls.caddy' "$lin/caddy/Caddyfile"
check "tls-ip-shortlived co 'profile shortlived'" grep -q 'profile shortlived' "$lin/caddy/tls-ip-shortlived.caddy"
check "tls-ip-internal co 'tls internal'" grep -q 'tls internal' "$lin/caddy/tls-ip-internal.caddy"
check_not "tls-domain khong dat issuer/profile" grep -Eq '^[[:space:]]*(tls|issuer|profile)' "$lin/caddy/tls-domain.caddy"
check "co check-tls.sh" test -f "$lin/check-tls.sh"
# Sau khi khoi dong Caddy: phai CHO chung chi duoc tin (https, KHONG -k); khong co => dung, bao ro; KHONG bao gio lui ve HTTP
out="$(HOST_T=42.96.15.235 prov 26266)"
check "IPv4: dry-run co buoc cho chung chi https://42.96.15.235/ (khong -k)" contains "$out" "cho chung chi: curl https://42.96.15.235/ (khong -k)"
check_not "khong co lenh curl -k / --insecure trong provision.sh" grep -Eq 'curl[^#(]*[[:space:]](-k|--insecure)([[:space:]]|$)' "$lin/provision.sh" "$lin/check-tls.sh"
check_not "khong co duong lui sang HTTP thuan trong provision.sh/Caddyfile" grep -Eq 'auto_https[[:space:]]+off|http://\{\$SISCOM_HOST\}' "$lin/provision.sh" "$lin/caddy/Caddyfile"
out="$(HOST_T=42.96.15.235 SISCOM_TLS_MODE=internal prov 26266)"
check "internal: dry-run kiem bang --cacert CA noi bo cua Caddy" contains "$out" "--cacert"
check "internal: canh bao thiet bi phai tin CA" contains "$out" "phai cai CA"
check "check-tls.sh: kiem TLS bang ma thoat curl (khong -f, khong -k)" grep -q 'curl -sS --max-time 10 -o /dev/null -w' "$lin/check-tls.sh"

echo "== 8c. SSH chi-khoa: co rieng, drop-in 00-, Include truoc, can khoa trong authorized_keys =="
out="$(prov 26266)"
check_not "mac dinh KHONG dong cham cau hinh SSH" contains "$out" "sshd_config.d/00-siscom"
out="$(prov 26266 --ssh-key-only)"
check "--ssh-key-only dung drop-in 00-siscom-ssh-key-only.conf" contains "$out" "/etc/ssh/sshd_config.d/00-siscom-ssh-key-only.conf"
check "--ssh-key-only co PasswordAuthentication no" contains "$out" "PasswordAuthentication no"
out="$(prov 26266 --harden-ssh)"; rc=$?; [ "$rc" -ne 0 ] && ok "co cu --harden-ssh bi tu choi (doi ten)" || bad "--harden-ssh van duoc nhan"
if declare -F sshd_include_first >/dev/null && declare -F count_authorized_keys >/dev/null; then
  printf 'Include /etc/ssh/sshd_config.d/*.conf\n#PasswordAuthentication yes\nPort 26266\nPermitRootLogin yes\nPasswordAuthentication yes\n' > "$tmp/sc1"
  check "Include o dau file => dat" sshd_include_first "$tmp/sc1"
  printf 'Port 26266\nPasswordAuthentication yes\nInclude /etc/ssh/sshd_config.d/*.conf\n' > "$tmp/sc2"
  check_not "PasswordAuthentication truoc Include => tu choi" sshd_include_first "$tmp/sc2"
  printf 'PermitRootLogin yes\n' > "$tmp/sc3"; check_not "khong co Include => tu choi" sshd_include_first "$tmp/sc3"
  printf 'Match User x\n  PasswordAuthentication yes\nInclude /etc/ssh/sshd_config.d/*.conf\n' > "$tmp/sc4"; check_not "Match truoc Include => tu choi" sshd_include_first "$tmp/sc4"
  check_not "authorized_keys khong ton tai => 0 khoa" test "$(count_authorized_keys "$tmp/khong-co")" -ge 1
  printf '# chu thich\n\nkhong-phai-khoa\n' > "$tmp/ak0"; check "authorized_keys chi rac => 0" test "$(count_authorized_keys "$tmp/ak0")" -eq 0
  if command -v ssh-keygen >/dev/null 2>&1; then
    { cat "$tmp/sk.pub"; cat "$tmp/evil.pub"; echo 'rac'; } > "$tmp/ak2"; check "authorized_keys 2 khoa hop le => 2" test "$(count_authorized_keys "$tmp/ak2")" -eq 2
  fi
else
  bad "lib.sh chua co sshd_include_first/count_authorized_keys"
fi

echo "== 8d. cloud-init BKNS: giu khoa host SSH (idempotent) =="
out="$(prov 26266)"
check "ghi /etc/cloud/cloud.cfg.d/99-siscom-keep-ssh-hostkeys.cfg" contains "$out" "99-siscom-keep-ssh-hostkeys.cfg"
check "noi dung ssh_deletekeys: false" contains "$out" "ssh_deletekeys: false"

echo "== 10. SEC-01 (PR232-R2): ufw kiem ke rule CO SAN truoc khi bat, kiem TOAN BO tap rule sau khi bat =="
# RED tren ma cu: provision --dry-run voi rule 5432 co san van di tiep (khong hoi ufw)
u="$tmp/ufw-c"; mkdir -p "$u"; echo "allow 5432/tcp" > "$u/rules"
out="$(STUB_UFW_DIR="$u" prov 26266)"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "5432" && ! contains "$out" "[DRY] ufw allow"; then ok "provision --dry-run: rule 5432 co san => dung truoc khi them/bat"; else bad "provision --dry-run voi rule 5432 co san van di tiep (rc=$rc)"; fi
if declare -F ufw_apply >/dev/null; then
  ua() { # ua <ten ca> [rules co san...] : chay ufw_apply that (khong dry) tren ufw gia; dat UOUT/URC; thu muc trang thai $tmp/ufw-<ten>
    local name="$1"; shift; local dir="$tmp/ufw-$name"; rm -rf "$dir"; mkdir -p "$dir"; : > "$dir/rules"
    local r; for r in "$@"; do echo "$r" >> "$dir/rules"; done
    UOUT="$(PATH="$stub:$PATH" STUB_UFW_DIR="$dir" bash -c ". '$lin/lib.sh'; ufw_apply 0 26266" 2>&1)"; URC=$?; UDIR="$dir"
  }
  final_ok() { [ "$(sort "$UDIR/rules")" = "$(printf 'allow 26266/tcp\nallow 443/tcp\nallow 80/tcp\n' | sort)" ] && [ "$(cat "$UDIR/active")" = active ]; }
  ua sach; { [ "$URC" -eq 0 ] && final_ok && contains "$UOUT" "[OK]"; } && ok "(a) ufw sach => dung allowlist 26266/80/443, active" || bad "(a) ufw sach (rc=$URC): $UOUT"
  PATH="$stub:$PATH" STUB_UFW_DIR="$UDIR" bash -c ". '$lin/lib.sh'; ufw_apply 0 26266" >/dev/null 2>&1; rc=$?
  { [ "$rc" -eq 0 ] && final_ok; } && ok "(b) chay lai tren allowlist => van dung, khong them rule" || bad "(b) chay lai (rc=$rc)"
  for c in "c|allow 5432/tcp" "d|allow 3000" "e|deny 26266/tcp" "e2|limit 26266/tcp" "e3|allow 22/tcp" "e4|allow from 10.0.0.0/8"; do
    n="${c%%|*}"; r="${c#*|}"
    ua "$n" "$r"
    if [ "$URC" -ne 0 ] && contains "$UOUT" "$r" && ! contains "$UOUT" "[OK]" && ! grep -Eq '^(allow|default|--force enable)' "$UDIR/calls"; then
      ok "($n) rule co san '$r' => dung, khong goi allow/default/enable, khong OK"
    else bad "($n) rule co san '$r' khong bi chan dung cach (rc=$URC)"; fi
  done
  # (f) rule la xuat hien SAU khi bat => dung, khong OK
  rm -rf "$tmp/ufw-f"; mkdir -p "$tmp/ufw-f"; : > "$tmp/ufw-f/rules"
  out="$(PATH="$stub:$PATH" STUB_UFW_DIR="$tmp/ufw-f" STUB_UFW_INJECT_AFTER_ENABLE="allow 5432/tcp" bash -c ". '$lin/lib.sh'; ufw_apply 0 26266" 2>&1)"; rc=$?
  { [ "$rc" -ne 0 ] && contains "$out" "5432" && ! contains "$out" "[OK] ufw"; } && ok "(f) rule la sau khi bat => dung, khong OK" || bad "(f) rule la sau khi bat (rc=$rc)"
  # (g) mat cong SSH sau khi bat => tat lai ufw, dung
  rm -rf "$tmp/ufw-g"; mkdir -p "$tmp/ufw-g"; : > "$tmp/ufw-g/rules"
  out="$(PATH="$stub:$PATH" STUB_UFW_DIR="$tmp/ufw-g" STUB_UFW_DROP_SSH_AFTER_ENABLE=26266 bash -c ". '$lin/lib.sh'; ufw_apply 0 26266" 2>&1)"; rc=$?
  { [ "$rc" -ne 0 ] && grep -qx -- '--force disable' "$tmp/ufw-g/calls" && [ "$(cat "$tmp/ufw-g/active")" = inactive ]; } && ok "(g) thieu SSH sau khi bat => ufw --force disable, dung" || bad "(g) thieu SSH sau khi bat (rc=$rc)"
  # dry-run: chi doc, khong goi lenh ghi
  rm -rf "$tmp/ufw-dry"; mkdir -p "$tmp/ufw-dry"; : > "$tmp/ufw-dry/rules"
  out="$(PATH="$stub:$PATH" STUB_UFW_DIR="$tmp/ufw-dry" bash -c ". '$lin/lib.sh'; ufw_apply 1 26266" 2>&1)"; rc=$?
  { [ "$rc" -eq 0 ] && [ "$(grep -cv '^show added$' "$tmp/ufw-dry/calls")" -eq 0 ] && contains "$out" "[DRY] ufw allow 26266/tcp"; } && ok "dry-run: chi 'ufw show added', in ke hoach" || bad "dry-run ufw_apply (rc=$rc)"
else
  bad "lib.sh chua co ufw_apply (SEC-01 chua sua)"
fi

echo "== 11. SEC-02 (PR232-R2, dieu kien Owner): retention CHI xoa bo .age; plaintext KHONG BAO GIO bi xoa, chi liet ke + thoat != 0 =="
if declare -F backup_prune >/dev/null && command -v ssh-keygen >/dev/null 2>&1; then
  bp="$tmp/bp"
  mkb() { # mkb <dir> <stamp> <dump|dump.age> [ky=1]: tao bo sao luu gia day du sidecar (manifest ky bang khoa that $tmp/sk)
    local d="$1" s="$2" e="$3" f; f="$d/siscom_crm_prod_$s.$e"; printf 'x%s' "$s" > "$f"
    ( cd "$d" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256" ); echo ok > "$f.restore-ok.txt"
    { echo "db=siscom_crm_prod"; echo "file=$(basename "$f")"; echo "file_sha256=$(sha256sum "$f" | cut -d' ' -f1)"; } > "$d/siscom_crm_prod_$s.manifest"
    [ "${4:-1}" = 1 ] && backup_sign "$d/siscom_crm_prod_$s.manifest" "$tmp/sk"
    return 0
  }
  orphans() { # in sidecar khong con file chinh
    local d="$1" x stem
    for x in "$d"/*; do case "$x" in
      *.sha256|*.restore-ok.txt) [ -e "${x%.sha256}" ] || [ -e "${x%.restore-ok.txt}" ] || echo "$x" ;;
      *.manifest|*.manifest.sig) stem="${x%.sig}"; stem="${stem%.manifest}"; [ -e "$stem.dump" ] || [ -e "$stem.dump.age" ] || echo "$x" ;;
    esac; done
  }
  snapP() { (cd "$1" && find . -maxdepth 1 -type f -name '*_180000*' -exec sha256sum {} + | sort); }   # moi tep cua cac bo plaintext (gio 180000)
  ageok() { local x; for x in "$1"/*.dump.age; do verify_backup_set "$x" "$tmp/allowed" siscom_crm_prod 2>/dev/null || return 1; done; }
  # (b)(c) 30 bo plaintext cu (18:00) + 30 bo .age cu (19:00) + 1 bo .age moi; ma hoa => .age qua han bi xoa du sidecar,
  #        KHONG tep plaintext nao bi xoa/sua (ke ca qua han giu), thoat 3 va liet ke plaintext
  rm -rf "$bp"; mkdir -p "$bp"
  for i in $(seq 1 30); do d="$(date -u -d "2026-11-11 -$i day" +%Y%m%d)"; mkb "$bp" "${d}_180000" dump; mkb "$bp" "${d}_190000" dump.age; done
  mkb "$bp" 20261112_190000 dump.age
  before="$(snapP "$bp")"
  out="$(backup_prune "$bp" siscom_crm_prod 1 2>&1)"; rc=$?
  nage="$(find "$bp" -maxdepth 1 -name '*.dump.age' | wc -l)"; nplain="$(find "$bp" -maxdepth 1 -name '*.dump' | wc -l)"
  { [ "$rc" -eq 3 ] && [ "$(snapP "$bp")" = "$before" ] && [ "$nplain" -eq 30 ]; } && ok "(b) 30 bo plaintext (qua han giu) => KHONG tep plaintext/sidecar nao bi xoa hay sua, thoat 3" || bad "(b) plaintext bi dong cham (rc=$rc, con $nplain)"
  { contains "$out" "siscom_crm_prod_20261012_180000.dump" && contains "$out" "siscom_crm_prod_20261110_180000.dump" && contains "$out" "restore-test.sh"; } && ok "(b) liet ke DU ten plaintext + nhac quy trinh xoa tay (restore-test)" || bad "(b) khong liet ke du / khong nhac quy trinh"
  { [ ! -e "$bp/siscom_crm_prod_20261012_190000.dump.age" ] && [ ! -e "$bp/siscom_crm_prod_20261012_190000.manifest" ] && [ "$nage" -ge 14 ] && [ "$nage" -le 22 ] && [ -e "$bp/siscom_crm_prod_20261112_190000.dump.age" ] && [ -z "$(orphans "$bp")" ] && ageok "$bp"; } \
    && ok "(c) retention chi xoa bo .age qua han (con $nage bo .age), du sidecar, bo con lai qua xac thuc" || bad "(c) retention .age (con $nage, mo coi: $(orphans "$bp" | head -2))"
  # chay lai: van thoat 3 MOI LAN, van khong dong cham plaintext
  backup_prune "$bp" siscom_crm_prod 1 >/dev/null 2>&1; rc2=$?
  { [ "$rc2" -eq 3 ] && [ "$(snapP "$bp")" = "$before" ]; } && ok "chay lai => van thoat 3, plaintext nguyen ven" || bad "chay lai (rc=$rc2)"
  # (e) dat SISCOM_BACKUP_PLAINTEXT=keep|purge khong doi hanh vi
  for v in keep purge; do
    SISCOM_BACKUP_PLAINTEXT=$v backup_prune "$bp" siscom_crm_prod 1 >/dev/null 2>&1; rcv=$?
    { [ "$rcv" -eq 3 ] && [ "$(snapP "$bp")" = "$before" ]; } && ok "(e) SISCOM_BACKUP_PLAINTEXT=$v => khong bo qua loi, khong xoa" || bad "(e) $v doi hanh vi (rc=$rcv)"
  done
  # Khong con DUONG THUC THI keep/purge: kiem tinh (khong con bien/nhanh trong ma) + hanh vi (dat bien => khong doi, da kiem o tren)
  check_not "(e) backup-db.sh/lib.sh khong con SISCOM_BACKUP_PLAINTEXT" grep -q 'SISCOM_BACKUP_PLAINTEXT' "$lin/backup-db.sh" "$lin/lib.sh"
  check_not "(e) backup-db.sh/lib.sh khong con nhanh keep/purge" grep -Eiq '(^|[^_a-z])(keep|purge)\)|=(keep|purge)' "$lin/backup-db.sh" "$lin/lib.sh"
  # Production BAT BUOC ma hoa: NO_ENCRYPT bi tu choi TRUOC khi dump/ket noi DB (pg_dump/psql gia ghi nhat ky loi goi => phai rong)
  ne="$tmp/ne"; rm -rf "$ne"; mkdir -p "$ne/etc" "$ne/stub"; necalls="$ne/calls"; : > "$necalls"
  for b in pg_dump pg_restore psql age; do printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\nexit 0\n' "$b" "$necalls" > "$ne/stub/$b"; chmod +x "$ne/stub/$b"; done
  ssh-keygen -q -t ed25519 -N '' -f "$ne/etc/backup-signing.key" >/dev/null; cp "$tmp/allowed" "$ne/etc/backup-signing.allowed_signers"
  nebk() { # nebk <db> [REHEARSAL]: chay backup-db.sh NO_ENCRYPT voi migrate.env tro <db>
    printf 'MIGRATE_DATABASE_URL=postgresql://siscom_migrator:%048d@127.0.0.1:5432/%s\n' 0 "$1" > "$ne/etc/migrate.env"; chmod 600 "$ne/etc/migrate.env" "$ne/etc/backup-signing.key"
    : > "$necalls"
    PATH="$ne/stub:$PATH" SISCOM_REHEARSAL="${2:-}" SISCOM_ETC="$ne/etc" SISCOM_BACKUP_DIR="$ne/bk" SISCOM_BACKUP_NO_ENCRYPT=yes bash "$lin/backup-db.sh" 2>&1
  }
  out="$(nebk siscom_crm_prod 1)"; rc=$?
  { [ "$rc" -ne 0 ] && contains "$out" "siscom_crm_prod" && contains "$out" "NO_ENCRYPT" && [ ! -s "$necalls" ] && [ ! -e "$ne/bk" ]; } \
    && ok "production + SISCOM_BACKUP_NO_ENCRYPT=yes => tu choi TRUOC dump (khong pg_dump/psql, khong tao thu muc sao luu)" || bad "prod NO_ENCRYPT khong bi tu choi dung cach (rc=$rc, loi goi: $(tr '\n' ';' < "$necalls" | cut -c1-80))"
  out="$(nebk siscom_crm_prod)"; rc=$?
  { [ "$rc" -ne 0 ] && [ ! -s "$necalls" ]; } && ok "production + NO_ENCRYPT (khong dien tap) => tu choi" || bad "prod NO_ENCRYPT khong dien tap (rc=$rc)"
  out="$(nebk siscom_crm_staging)"; rc=$?
  { [ "$rc" -ne 0 ] && contains "$out" "SISCOM_REHEARSAL" && [ ! -s "$necalls" ]; } && ok "staging that (khong SISCOM_REHEARSAL=1) + NO_ENCRYPT => tu choi (chi DB thu cach ly)" || bad "staging NO_ENCRYPT ngoai dien tap khong bi tu choi (rc=$rc)"
  out="$(nebk siscom_crm_staging 1)"
  check_not "dien tap cach ly (SISCOM_REHEARSAL=1) + staging: KHONG bi chan boi kiem NO_ENCRYPT" contains "$out" "NO_ENCRYPT bi tu choi"
  # (d) chieu nguoc NO_ENCRYPT (encrypt=0): .age cu van duoc retention quan; plaintext tich luy, KHONG bi xoa, co canh bao so bo
  rm -rf "$bp"; mkdir -p "$bp"
  for i in $(seq 1 30); do d="$(date -u -d "2026-11-11 -$i day" +%Y%m%d)"; mkb "$bp" "${d}_180000" dump; mkb "$bp" "${d}_190000" dump.age; done
  before="$(snapP "$bp")"
  out="$(backup_prune "$bp" siscom_crm_prod 0 2>&1)"; rc=$?
  { [ "$rc" -eq 0 ] && [ "$(snapP "$bp")" = "$before" ] && [ ! -e "$bp/siscom_crm_prod_20261012_190000.dump.age" ] && [ -z "$(orphans "$bp")" ] && contains "$out" "30 bo"; } \
    && ok "(d) NO_ENCRYPT: .age cu bi retention xoa, 30 bo plaintext giu nguyen + canh bao so bo" || bad "(d) chieu nguoc (rc=$rc)"
  # khong co plaintext + ma hoa => thoat 0
  rm -rf "$bp"; mkdir -p "$bp"; mkb "$bp" 20261111_190000 dump.age
  backup_prune "$bp" siscom_crm_prod 1 >/dev/null 2>&1 && ok "khong co plaintext => thoat 0" || bad "khong co plaintext ma van loi"
  check "backup-db.sh goi backup_prune" grep -q 'backup_prune ' "$lin/backup-db.sh"
else
  bad "lib.sh chua co backup_prune (SEC-02 chua sua) hoac thieu ssh-keygen"
fi

echo "== 12. DB-01 (PR232-R2): DATABASE_URL, AUTH_DATABASE_URL, MIGRATE_DATABASE_URL bat buoc, hop le, CUNG DB - truoc build/sao luu/migrate/CLI =="
pw48="$(printf '%048d' 7)"
mkenv() { # mkenv <thu muc> <app url|-> <auth url|-> <mig url|->  ('-' = bo dong)
  local d="$1"; mkdir -p "$d"; : > "$d/backend.env"; : > "$d/migrate.env"
  [ "$2" = - ] || echo "DATABASE_URL=$2" >> "$d/backend.env"
  [ "$3" = - ] || echo "AUTH_DATABASE_URL=$3" >> "$d/backend.env"
  printf "CORS_ORIGINS=https://42.96.15.235
AUTH_ALLOWED_ORIGINS=https://42.96.15.235
" >> "$d/backend.env"
  [ "$4" = - ] || echo "MIGRATE_DATABASE_URL=$4" >> "$d/migrate.env"
  chmod 600 "$d/backend.env" "$d/migrate.env"
}
U() { printf 'postgresql://%s:%s@127.0.0.1:5432/%s' "$1" "$pw48" "$2"; }
S=siscom_crm_staging; Pd=siscom_crm_prod
if declare -F load_db_env_triplet >/dev/null; then
  tri() { SISCOM_REHEARSAL=1 bash -c ". '$lin/lib.sh'; load_db_env_triplet '$1/backend.env' '$1/migrate.env' && echo \"DB=\$DB_NAME\"" 2>&1; }
  mkenv "$tmp/t1" "$(U siscom_app $S)" "$(U siscom_auth $S)" "$(U siscom_migrator $S)"; out="$(tri "$tmp/t1")"; rc=$?
  { [ "$rc" -eq 0 ] && contains "$out" "DB=$S"; } && ok "3 URL cung DB staging => PASS" || bad "3 URL cung DB (rc=$rc): $out"
  for c in "AUTH tro prod|$(U siscom_app $S)|$(U siscom_auth $Pd)|$(U siscom_migrator $S)" \
           "MIGRATE tro prod|$(U siscom_app $S)|$(U siscom_auth $S)|$(U siscom_migrator $Pd)" \
           "thieu AUTH|$(U siscom_app $S)|-|$(U siscom_migrator $S)" \
           "thieu MIGRATE|$(U siscom_app $S)|$(U siscom_auth $S)|-" \
           "AUTH khong hop le|$(U siscom_app $S)|postgresql://siscom_auth@127.0.0.1:5432/$S|$(U siscom_migrator $S)" \
           "AUTH sai tai khoan|$(U siscom_app $S)|$(U siscom_app $S)|$(U siscom_migrator $S)" \
           "host ngoai loopback|$(U siscom_app $S)|postgresql://siscom_auth:$pw48@10.0.0.5:5432/$S|$(U siscom_migrator $S)" \
           "ca 3 tro DB la|$(U siscom_app siscom_crm_dev)|$(U siscom_auth siscom_crm_dev)|$(U siscom_migrator siscom_crm_dev)"; do
    IFS='|' read -r name a b m <<<"$c"
    mkenv "$tmp/t2" "$a" "$b" "$m"; out="$(tri "$tmp/t2")"; rc=$?
    { [ "$rc" -ne 0 ] && ! contains "$out" "$pw48"; } && ok "$name => FAIL, khong in mat khau/URL" || bad "$name khong bi tu choi (rc=$rc)"
  done
else
  bad "lib.sh chua co load_db_env_triplet (DB-01 chua sua)"
fi
# Tich hop: env lech (AUTH tro prod) => deploy.sh va run-cli.sh KHONG duoc goi npm/npx/node/psql/systemctl/curl
cs="$tmp/callstub"; mkdir -p "$cs"; calls="$tmp/calls.log"; : > "$calls"
for b in npm npx node psql systemctl curl pg_dump; do printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\nexit 0\n' "$b" "$calls" > "$cs/$b"; chmod +x "$cs/$b"; done
mkenv "$tmp/t3" "$(U siscom_app $S)" "$(U siscom_auth $Pd)" "$(U siscom_migrator $S)"
mkdir -p "$tmp/t3opt/releases" "$tmp/t3src/backend" "$tmp/t3fe"; echo '{}' > "$tmp/t3src/backend/package.json"; echo '<html/>' > "$tmp/t3fe/index.html"
out="$(PATH="$cs:$PATH" SISCOM_REHEARSAL=1 SISCOM_ETC="$tmp/t3" SISCOM_OPT="$tmp/t3opt" bash "$lin/deploy.sh" --src "$tmp/t3src" --frontend "$tmp/t3fe" --migrate 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && [ ! -s "$calls" ] && ! contains "$out" "$pw48"; } && ok "deploy.sh voi AUTH tro prod => dung, KHONG goi npm/psql/node/systemctl" || bad "deploy.sh AUTH lech (rc=$rc, loi goi: $(tr '\n' ';' < "$calls" | cut -c1-120))"
: > "$calls"; mkdir -p "$tmp/t3opt/current/backend/dist/cli"; echo '' > "$tmp/t3opt/current/backend/dist/cli/seed-lookups.js"
out="$(PATH="$cs:$PATH" SISCOM_REHEARSAL=1 SISCOM_ETC="$tmp/t3" SISCOM_OPT="$tmp/t3opt" bash "$lin/run-cli.sh" seed-lookups 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && [ ! -s "$calls" ] && ! contains "$out" "$pw48"; } && ok "run-cli.sh voi AUTH tro prod => dung, KHONG goi node" || bad "run-cli.sh AUTH lech (rc=$rc, loi goi: $(tr '\n' ';' < "$calls" | cut -c1-120))"
# Doi chung: env DUNG => run-cli goi node (chung minh stub bat duoc loi goi)
: > "$calls"; mkenv "$tmp/t3" "$(U siscom_app $S)" "$(U siscom_auth $S)" "$(U siscom_migrator $S)"
PATH="$cs:$PATH" SISCOM_REHEARSAL=1 SISCOM_ETC="$tmp/t3" SISCOM_OPT="$tmp/t3opt" bash "$lin/run-cli.sh" seed-lookups >/dev/null 2>&1
grep -q '^node ' "$calls" && ok "doi chung: env dung => run-cli goi node" || bad "doi chung run-cli khong goi node"

echo "== 9. F3 (PR232-R1): deploy.sh kiem argon2 hash/verify + Prisma CLI tren ban build TRUOC khi doi lien ket =="
check "lib.sh co backend_runtime_smoke" grep -q '^backend_runtime_smoke()' "$lin/lib.sh"
check "deploy.sh goi backend_runtime_smoke" grep -q 'backend_runtime_smoke "\$rel/backend"' "$lin/deploy.sh"
check "deploy.sh van dung npm ci --ignore-scripts" grep -q 'npm ci --ignore-scripts' "$lin/deploy.sh"
# deploy that bai bang `die` (build khong ra dist/main.js) TRUOC khi doi lien ket => khong de lai ban phat hanh do dang
if command -v npm >/dev/null 2>&1; then
  d3="$tmp/d3"; mkdir -p "$d3/etc" "$d3/opt/releases" "$d3/src/backend"
  for k in "DATABASE_URL|siscom_app" "AUTH_DATABASE_URL|siscom_auth"; do printf '%s=postgresql://%s:%048d@127.0.0.1:5432/siscom_crm_staging\n' "${k%%|*}" "${k#*|}" 0; done > "$d3/etc/backend.env"
  printf 'MIGRATE_DATABASE_URL=postgresql://siscom_migrator:%048d@127.0.0.1:5432/siscom_crm_staging\n' 0 > "$d3/etc/migrate.env"; chmod 600 "$d3/etc/backend.env" "$d3/etc/migrate.env"
  mkdir -p "$d3/stub"; printf '#!/usr/bin/env bash\necho t\n' > "$d3/stub/psql"; chmod +x "$d3/stub/psql"   # DB "da migrate" => khong phai DB moi tinh
  printf '{"name":"x","version":"1.0.0","private":true,"scripts":{"build":"node -e 0"}}\n' > "$d3/src/backend/package.json"
  printf '{"name":"x","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x","version":"1.0.0"}}}\n' > "$d3/src/backend/package-lock.json"
  mkdir -p "$d3/fe"; echo '<html/>' > "$d3/fe/index.html"
  out="$(PATH="$d3/stub:$PATH" SISCOM_REHEARSAL=1 SISCOM_ETC="$d3/etc" SISCOM_OPT="$d3/opt" bash "$lin/deploy.sh" --src "$d3/src" --frontend "$d3/fe" 2>&1)"; rc=$?
  left="$(find "$d3/opt/releases" -mindepth 1 -maxdepth 1 | wc -l)"
  if [ "$rc" -ne 0 ] && contains "$out" "dist/main.js" && [ "$left" -eq 0 ]; then ok "deploy die truoc doi lien ket => da xoa ban do dang"; else bad "deploy die de lai $left ban do dang (rc=$rc)"; fi
  check_not "khong tao lien ket current khi that bai" test -e "$d3/opt/current"
else
  bad "thieu npm - khong kiem duoc don ban do dang"
fi

echo
echo "Ket qua: $pass dat, $fail loi."
[ "$fail" -eq 0 ]
