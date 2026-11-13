#!/usr/bin/env bash
# SISCOM CRM - trien khai/cap nhat/lui ban phat hanh tren VPS. Chay bang root (sudo). Chua tung chay tren VPS that.
#
# Dung:
#   deploy.sh --tag vX.Y.Z [--frontend DIR] [--migrate] [--auto-rollback] [--dry-run]
#   deploy.sh --src DIR    [--frontend DIR] [--migrate] [--auto-rollback] [--dry-run]
#   deploy.sh --rollback [ID_BAN_PHAT_HANH] [--dry-run]
#   deploy.sh --list
#
#   --tag      Lay ma tu tag trong clone $SISCOM_OPT/repo (git clone cua repo). Tag phai khop vX.Y.Z[-hau-to] va THUOC lich su origin/main
#              (git merge-base --is-ancestor). KHONG nhan nhanh/commit tuy y.
#   --src      Thu muc nguon DA co san tren may chu (chua thu muc backend/ - vd giai nen `git archive` cua tag). Dung khi khong clone duoc.
#   --frontend Thu muc dist DA BUILD o may khac (VPS 3 GB RAM khong build giao dien): can index.html. Bo qua => dung lai web cua ban hien tai.
#   --migrate  Cho phep `prisma migrate deploy` (bang siscom_migrator, doc migrate.env) roi chay lai APP_GRANTS_V4 + VERIFY. Neu co migration
#              cho ma KHONG co --migrate => DUNG, khong doi gi them (sau khi da sao luu).
#   --auto-rollback  Kiem suc khoe that bai => tu lui ve ban truoc (mac dinh chi in huong dan).
#   --dry-run  Chi kiem tra va in cac buoc, khong tao/sua/khoi dong gi.
# Trinh tu: kiem dau vao -> tao ban phat hanh moi trong $SISCOM_OPT/releases/<id> -> npm ci -> build -> chep web -> SAO LUU (bat buoc, tru DB moi tinh)
#   -> migrate (neu --migrate) -> doi lien ket `current` (nguyen tu) -> systemctl restart -> kiem /health + /health/database trong 30 s.
# Lui: ban truoc giu nguyen thu muc; `deploy.sh --rollback` doi lien ket + khoi dong lai. DB KHONG tu lui (xem docs/VPS_RUNBOOK.md).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

mode=deploy; tag=""; src=""; fe=""; do_migrate=0; auto_rb=0; DRY=0; rb_id=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="${2:-}"; shift 2 ;;
    --src) src="${2:-}"; shift 2 ;;
    --frontend) fe="${2:-}"; shift 2 ;;
    --migrate) do_migrate=1; shift ;;
    --auto-rollback) auto_rb=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --list) mode=list; shift ;;
    --rollback) mode=rollback; shift; if [ $# -gt 0 ] && [[ "$1" != --* ]]; then rb_id="$1"; shift; fi ;;
    *) die "Tham so la: $1 (xem dau file deploy.sh)" ;;
  esac
done

releases="$SISCOM_OPT/releases"; current="$SISCOM_OPT/current"; previous_file="$SISCOM_OPT/previous"
backend_env="$SISCOM_ETC/backend.env"; migrate_env="$SISCOM_ETC/migrate.env"
run() { if [ "$DRY" = 1 ]; then printf '[DRY] %s\n' "$*"; else "$@"; fi; }
valid_id() { [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$ ]]; }

[ "${SISCOM_REHEARSAL:-}" = 1 ] || [ "$DRY" = 1 ] || require_root

cur_id() { [ -L "$current" ] && basename "$(readlink -f "$current")" || true; }

if [ "$mode" = list ]; then
  c="$(cur_id)"; echo "Ban dang chay: ${c:-(chua co)}"
  [ -d "$releases" ] && ls -1t "$releases" | sed 's/^/  /'
  exit 0
fi

# --- Doc cau hinh (khong source, khong in URL) ---
[ "$DRY" = 1 ] && [ ! -f "$backend_env" ] && warn "dry-run: chua co $backend_env (bo qua kiem DB)."
db=""
if [ -f "$backend_env" ]; then
  # DB-01: DATABASE_URL + AUTH_DATABASE_URL + MIGRATE_DATABASE_URL bat buoc, hop le, CUNG DB - TRUOC moi lenh cham DB/npm/build.
  load_db_env_triplet "$backend_env" "$migrate_env" || die "Cau hinh ket noi DB khong hop le (chi tiet o tren). Khong doi gi."
  db="$DB_NAME"
else
  [ "$DRY" = 1 ] || die "Thieu $backend_env (chay create-db.sh $db env truoc)."
fi
port="3000"; [ -f "$backend_env" ] && port="$(env_get "$backend_env" PORT 2>/dev/null || echo 3000)"
[[ "$port" =~ ^[0-9]{2,5}$ ]] || port=3000

health() { # health: 30 giay, can ca /health va /health/database (migrated:true)
  local i body
  for i in $(seq 1 15); do
    if curl -fsS --max-time 4 "http://127.0.0.1:${port}/api/v1/health" >/dev/null 2>&1; then
      body="$(curl -fsS --max-time 4 "http://127.0.0.1:${port}/api/v1/health/database" 2>/dev/null || true)"
      if printf '%s' "$body" | grep -Eq '"database":"up"' && printf '%s' "$body" | grep -Eq '"migrated":true'; then
        info "Suc khoe OK (database up, migrated:true)."; return 0
      fi
    fi
    sleep 2
  done
  return 1
}

switch_to() { # switch_to <id>: doi lien ket nguyen tu, nho ban truoc
  local id="$1" old; old="$(cur_id)"
  [ "$DRY" = 1 ] || [ -d "$releases/$id" ] || die "Khong co ban phat hanh $id."
  [ -z "$old" ] || [ "$old" = "$id" ] || run bash -c "printf '%s' '$old' > '$previous_file'"
  run ln -sfn "$releases/$id" "$SISCOM_OPT/current.new"
  run mv -T "$SISCOM_OPT/current.new" "$current"
}
restart_and_check() {
  run systemctl daemon-reload
  run systemctl enable siscom-crm-backend >/dev/null 2>&1 || true
  run systemctl restart siscom-crm-backend
  if [ "$DRY" = 1 ]; then echo "[DRY] kiem /health + /health/database trong 30 s"; return 0; fi
  health
}

# =========================== ROLLBACK ===========================
if [ "$mode" = rollback ]; then
  c="$(cur_id)"
  if [ -z "$rb_id" ]; then [ -f "$previous_file" ] || die "Khong co ban truoc (previous). Chi dinh: deploy.sh --rollback <id>  (xem --list)."; rb_id="$(cat "$previous_file")"; fi
  valid_id "$rb_id" || die "ID ban phat hanh khong hop le."
  [ "$rb_id" != "$c" ] || die "Ban $rb_id da la ban dang chay."
  echo "Lui: ${c:-?} -> $rb_id"
  switch_to "$rb_id"
  if restart_and_check; then
    info "Da lui ve $rb_id."
    warn "DB KHONG tu lui. Neu ban '${c:-?}' da chay migration, ma cu co the khong khop schema: xem muc 'Lui' trong docs/VPS_RUNBOOK.md (khoi phuc ban sao luu vao DB MOI roi doi DATABASE_URL)."
  else
    die "Sau khi lui van khong khoe. Xem: journalctl -u siscom-crm-backend -n 100 --no-pager"
  fi
  exit 0
fi

# =========================== DEPLOY ===========================
[ -n "$tag" ] || [ -n "$src" ] || die "Can --tag <vX.Y.Z> hoac --src <thu muc>."
[ -z "$tag" ] || [ -z "$src" ] || die "Chi dung MOT trong --tag / --src."
stamp="$(date -u +%Y%m%d%H%M%S)"

# --- 1. Nguon ---
repo="$SISCOM_OPT/repo"
if [ -n "$tag" ]; then
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "Tag '$tag' sai dinh dang (mong doi vX.Y.Z hoac vX.Y.Z-hau-to)."
  [ -d "$repo/.git" ] || die "Thieu clone $repo (git clone cua repo, xem runbook) - hoac dung --src."
  if [ "$DRY" = 1 ]; then echo "[DRY] git -C $repo fetch --tags origin"; else git -C "$repo" fetch --tags --prune origin; fi
  commit="$(git -C "$repo" rev-parse --verify --quiet "refs/tags/$tag^{commit}")" || die "Tag $tag khong ton tai trong $repo."
  git -C "$repo" rev-parse --verify --quiet refs/remotes/origin/main >/dev/null || die "Khong co origin/main trong $repo."
  git -C "$repo" merge-base --is-ancestor "$commit" refs/remotes/origin/main || die "TU CHOI: tag $tag ($commit) KHONG thuoc lich su origin/main."
  id="${tag}-${stamp}"
  info "Tag $tag -> ${commit:0:12} thuoc origin/main."
else
  [ -d "$src/backend" ] && [ -f "$src/backend/package.json" ] || die "$src khong co backend/package.json."
  src="$(cd "$src" && pwd)"
  id="src-${stamp}"
  commit="(thu muc $src)"
fi
valid_id "$id" || die "ID ban phat hanh sinh ra khong hop le."
rel="$releases/$id"

# --- 2. Kiem frontend ---
if [ -n "$fe" ]; then
  [ -f "$fe/index.html" ] || die "--frontend $fe khong co index.html (chua build?)."
  fe="$(cd "$fe" && pwd)"
elif [ -d "$current/web" ]; then
  info "Khong co --frontend: dung lai web cua ban hien tai."
else
  [ "$DRY" = 1 ] || die "Lan trien khai dau can --frontend <dist da build>."
fi

# --- 3. DB hien trang (chi doc) ---
fresh_db=0
if [ -f "$migrate_env" ] && [ "$DRY" = 0 ]; then
  murl="$MIG_URL"
  mpw="${murl#*://*:}"; mpw="${mpw%%@*}"
  has_mig="$(PGPASSWORD="$mpw" psql -X -q -tA -w -h "$SISCOM_PG_HOST" -p "$SISCOM_PG_PORT" -U "$ROLE_MIGRATOR" -d "$db" -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL" 2>/dev/null)" \
    || die "Khong ket noi duoc $db bang $ROLE_MIGRATOR (PostgreSQL chay chua? migrate.env dung chua?)."
  [ "$has_mig" = t ] || fresh_db=1
fi

cat <<PLAN
== KE HOACH ($([ "$DRY" = 1 ] && echo DRY-RUN || echo THAT)) ==
  DB dich      : ${db:-?}
  Ban moi      : $id   (nguon: ${tag:-$src} ${commit:+| $commit})
  Frontend     : ${fe:-giu web hien tai}
  Migrate      : $([ "$do_migrate" = 1 ] && echo co || echo khong)   DB moi tinh: $([ "$fresh_db" = 1 ] && echo co || echo khong)
  Tu lui       : $([ "$auto_rb" = 1 ] && echo co || echo khong)
PLAN

# --- 4. Tao ban phat hanh ---
# Moi lan thoat truoc khi doi lien ket (ke ca `die`: exit KHONG kich hoat trap ERR) => bo ban phat hanh do dang.
[ "$DRY" = 1 ] || [ ! -e "$rel" ] || die "Ban phat hanh $rel da ton tai."
cleanup_failed() { [ "$DRY" = 1 ] || [ ! -d "$rel" ] || { warn "Dung truoc khi doi lien ket: bo ban phat hanh do dang $rel (ban hien tai KHONG bi dong cham)."; rm -rf "$rel"; }; }
trap 'cleanup_failed' EXIT
run install -d -m 755 "$rel"
if [ -n "$tag" ]; then
  if [ "$DRY" = 1 ]; then echo "[DRY] git archive $tag backend | tar -x -C $rel"; else git -C "$repo" archive --format=tar "$commit" backend | tar -x -C "$rel"; fi
else
  if [ "$DRY" = 1 ]; then echo "[DRY] tar (tru node_modules/.git/dist) $src/backend -> $rel/backend"; else
    tar -C "$src" --exclude=node_modules --exclude=.git --exclude=dist --exclude='.env*' -cf - backend | tar -x -C "$rel"
  fi
fi

if [ "$DRY" = 1 ]; then
  echo "[DRY] cd $rel/backend && npm ci --ignore-scripts && npm run build (DATABASE_URL gia, khong MIGRATE) && kiem argon2 hash/verify + Prisma CLI"
else
  require_cmd node npm curl
  ( cd "$rel/backend"
    export NODE_OPTIONS="--max-old-space-size=1536"
    npm ci --ignore-scripts --no-audit --no-fund
    env -u MIGRATE_DATABASE_URL -u AUTH_DATABASE_URL DATABASE_URL=postgresql://ci_placeholder@127.0.0.1:1/x npm run build )
  [ -f "$rel/backend/dist/main.js" ] || die "Build khong tao dist/main.js."
  # F3: --ignore-scripts chan lifecycle script cua dependency (khong chay ma cai dat duoi root). argon2 dung prebuild N-API co san trong goi
  # (linux-x64 glibc); kiem hash/verify that + Prisma CLI tren CHINH ban build nay, TRUOC khi dua vao chay.
  backend_runtime_smoke "$rel/backend" || die "Ban build khong chay duoc tren may nay (argon2/Prisma). Khong doi gi."
fi

# --- 5. Web ---
if [ -n "$fe" ]; then
  run cp -a "$fe" "$rel/web"
elif [ -d "$current/web" ]; then
  run cp -a "$current/web" "$rel/web"
fi
if [ "$DRY" = 0 ]; then
  # Chu root, nguoi khac chi doc: dich vu (user siscom) khong sua duoc ma cua chinh no; Caddy doc duoc web.
  chown -R root:root "$rel"; chmod -R go-w,a+rX "$rel"
fi

# --- 6. Sao luu bat buoc (tru DB moi tinh) ---
if [ "$fresh_db" = 1 ]; then
  info "DB chua migrate (moi tinh): bo qua sao luu."
else
  if [ "$DRY" = 1 ]; then echo "[DRY] $here/backup-db.sh (bat buoc PASS)"; else "$here/backup-db.sh" || die "Sao luu THAT BAI - dung deploy, khong doi gi."; fi
fi

# --- 7. Migration ---
if [ "$DRY" = 1 ]; then
  echo "[DRY] prisma migrate status (migrator) ${do_migrate:+; neu --migrate: migrate deploy + create-db.sh grants}"
else
  murl="$MIG_URL"; appurl="$APP_URL"
  pr() { ( cd "$rel/backend"; unset AUTH_DATABASE_URL; export DATABASE_URL="$appurl" MIGRATE_DATABASE_URL="$murl"; npx --no-install prisma "$@" ); }
  status_out="$(pr migrate status 2>&1 || true)"
  if printf '%s' "$status_out" | grep -qi 'have not yet been applied\|not yet been applied'; then pending=1
  elif printf '%s' "$status_out" | grep -qi 'up to date'; then pending=0
  else printf '%s\n' "$status_out" | tail -15 | sed -E 's#(postgres(ql)?://)[^ @]*@#\1***@#g' >&2; die "prisma migrate status khong ro ket qua (xem tren)."; fi
  if [ "$pending" = 1 ]; then
    if [ "$do_migrate" != 1 ]; then die "Co migration CHO ap dung. Chay lai voi --migrate (da co ban sao luu vua tao). Chua doi gi: ban hien tai van chay."; fi
    info "Ap migration (prisma migrate deploy, $ROLE_MIGRATOR)..."
    pr migrate deploy
    pr migrate status | grep -qi 'up to date' || die "Sau migrate deploy van con migration cho."
  elif [ "$do_migrate" = 1 ]; then
    info "Khong co migration cho."
  fi
  if [ "$do_migrate" = 1 ]; then "$rel/backend/scripts/linux/create-db.sh" "$db" grants; fi
fi

# --- 8. Doi lien ket + khoi dong + suc khoe ---
trap - EXIT
old="$(cur_id)"
switch_to "$id"
if restart_and_check; then
  info "TRIEN KHAI THANH CONG: $id (DB $db)."
else
  warn "KIEM SUC KHOE THAT BAI sau khi chay ban $id."
  echo "  Xem log : journalctl -u siscom-crm-backend -n 100 --no-pager"
  if [ "$auto_rb" = 1 ] && [ -n "$old" ]; then
    warn "Tu lui ve $old ..."
    switch_to "$old"; restart_and_check && die "Da lui ve $old (DB khong lui)." || die "Lui ve $old cung khong khoe. Can xu ly tay."
  fi
  [ -n "$old" ] && echo "  Lui     : sudo $here/deploy.sh --rollback $old"
  exit 1
fi

# --- 9. Don ban cu (giu 3 ban moi nhat + current + previous) ---
if [ "$DRY" = 0 ]; then
  keep_prev="$(cat "$previous_file" 2>/dev/null || true)"
  i=0
  while IFS= read -r r; do
    i=$((i + 1))
    [ "$i" -le 3 ] && continue
    [ "$r" != "$id" ] && [ "$r" != "$keep_prev" ] && valid_id "$r" && { rm -rf "${releases:?}/$r"; info "Da xoa ban phat hanh cu: $r"; }
  done < <(ls -1t "$releases")
fi
