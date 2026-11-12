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
printf 'DATABASE_URL=postgresql://siscom_app:%048d@127.0.0.1:5432/siscom_crm_dev\n' 0 > "$etc/backend.env"; chmod 600 "$etc/backend.env"
out="$(SISCOM_REHEARSAL=1 SISCOM_ETC="$etc" SISCOM_OPT="$opt" bash "$lin/deploy.sh" --dry-run --tag v0.1.0 --frontend "$tmp/fe" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "TU CHOI"; then ok "backend.env tro siscom_crm_dev bi tu choi"; else bad "backend.env DB la khong bi tu choi (rc=$rc)"; fi
chmod 644 "$etc/backend.env"
out="$(SISCOM_ETC="$etc" SISCOM_OPT="$opt" bash "$lin/deploy.sh" --dry-run --tag v0.1.0 --frontend "$tmp/fe" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && contains "$out" "600"; then ok "backend.env quyen 644 bi tu choi"; else bad "backend.env 644 khong bi tu choi (rc=$rc)"; fi
rm -f "$etc/backend.env"
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

echo "== 9. F3 (PR232-R1): deploy.sh kiem argon2 hash/verify + Prisma CLI tren ban build TRUOC khi doi lien ket =="
check "lib.sh co backend_runtime_smoke" grep -q '^backend_runtime_smoke()' "$lin/lib.sh"
check "deploy.sh goi backend_runtime_smoke" grep -q 'backend_runtime_smoke "\$rel/backend"' "$lin/deploy.sh"
check "deploy.sh van dung npm ci --ignore-scripts" grep -q 'npm ci --ignore-scripts' "$lin/deploy.sh"
# deploy that bai bang `die` (build khong ra dist/main.js) TRUOC khi doi lien ket => khong de lai ban phat hanh do dang
if command -v npm >/dev/null 2>&1; then
  d3="$tmp/d3"; mkdir -p "$d3/etc" "$d3/opt/releases" "$d3/src/backend"
  printf 'DATABASE_URL=postgresql://siscom_app:%048d@127.0.0.1:5432/siscom_crm_staging\n' 0 > "$d3/etc/backend.env"; chmod 600 "$d3/etc/backend.env"
  printf '{"name":"x","version":"1.0.0","private":true,"scripts":{"build":"node -e 0"}}\n' > "$d3/src/backend/package.json"
  printf '{"name":"x","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"x","version":"1.0.0"}}}\n' > "$d3/src/backend/package-lock.json"
  mkdir -p "$d3/fe"; echo '<html/>' > "$d3/fe/index.html"
  out="$(SISCOM_REHEARSAL=1 SISCOM_ETC="$d3/etc" SISCOM_OPT="$d3/opt" bash "$lin/deploy.sh" --src "$d3/src" --frontend "$d3/fe" 2>&1)"; rc=$?
  left="$(find "$d3/opt/releases" -mindepth 1 -maxdepth 1 | wc -l)"
  if [ "$rc" -ne 0 ] && contains "$out" "dist/main.js" && [ "$left" -eq 0 ]; then ok "deploy die truoc doi lien ket => da xoa ban do dang"; else bad "deploy die de lai $left ban do dang (rc=$rc)"; fi
  check_not "khong tao lien ket current khi that bai" test -e "$d3/opt/current"
else
  bad "thieu npm - khong kiem duoc don ban do dang"
fi

echo
echo "Ket qua: $pass dat, $fail loi."
[ "$fail" -eq 0 ]
