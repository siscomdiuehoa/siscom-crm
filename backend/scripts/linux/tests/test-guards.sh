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
out="$(SISCOM_ETC="$tmp/e2" SISCOM_OPT="$tmp/o2" SISCOM_BACKUP_DIR="$tmp/b2" SISCOM_DOMAIN=crm.example.vn bash "$lin/provision.sh" --dry-run 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "dry-run thanh cong" || bad "dry-run loi rc=$rc"
for p in "ufw allow 22/tcp" "ufw allow 80/tcp" "ufw allow 443/tcp" "ufw default deny incoming" "fallocate -l 2G /swapfile" "node_24.x" "postgresql-18" "fail2ban" "unattended-upgrades" "caddy"; do
  check "dry-run co '$p'" contains "$out" "$p"
done
n_allow="$(printf '%s\n' "$out" | grep -c 'ufw allow')"
[ "$n_allow" -eq 3 ] && ok "chi 3 quy tac ufw allow" || bad "so quy tac ufw allow = $n_allow"
check_not "khong mo 5432/3000" bash -c "printf '%s' '$out' | grep -E 'ufw allow (5432|3000)'"
out="$(SISCOM_DOMAIN='bad_domain' bash "$lin/provision.sh" --dry-run 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "SISCOM_DOMAIN sai bi tu choi" || bad "SISCOM_DOMAIN sai khong bi tu choi"
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

echo
echo "Ket qua: $pass dat, $fail loi."
[ "$fail" -eq 0 ]
