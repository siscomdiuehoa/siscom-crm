#!/usr/bin/env bash
# SISCOM CRM - khoi phuc THU ban sao luu vao database MOI siscom_crm_restore_<UTC stamp> va so so dong tung bang voi manifest luc chup.
# Chay bang root (can quyen superuser postgres de tao DB) - chay TAY/dinh ky (hang thang), khong dua vao timer.
# Dung: restore-test.sh [--dump FILE] [--identity FILE] [--db siscom_crm_staging|siscom_crm_prod]
#   --dump      file .dump.age hoac .dump (mac dinh: ban moi nhat cua --db trong $SISCOM_BACKUP_DIR)
#   --identity  khoa RIENG age (AGE-SECRET-KEY-...) de giai ma .age. Khoa rieng khong luu tren VPS: Owner chep len TAM, dung xong XOA.
# Khong bao gio ghi vao DB van hanh; khong xoa DB thu (in lenh DROP de Owner tu chay). PASS => ghi <dump>.restore-ok.txt.
# Chua tung chay tren VPS that. Khong in mat khau.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

dump=""; identity=""; srcdb=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) dump="${2:-}"; shift 2 ;;
    --identity) identity="${2:-}"; shift 2 ;;
    --db) srcdb="${2:-}"; shift 2 ;;
    *) die "Tham so la: $1" ;;
  esac
done
[ "${SISCOM_REHEARSAL:-}" = 1 ] || require_root
require_cmd pg_restore psql sha256sum
umask 077

if [ -z "$srcdb" ]; then
  murl="$(env_get "$SISCOM_ETC/migrate.env" MIGRATE_DATABASE_URL)" || die "Khong doc duoc DB tu migrate.env; dung --db."
  srcdb="$(url_dbname "$murl")"
fi
require_ops_db "$srcdb"
if [ -z "$dump" ]; then
  dump="$(find "$SISCOM_BACKUP_DIR" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | grep -E "^${srcdb}_[0-9]{8}_[0-9]{6}\.dump(\.age)?\$" | sort | tail -n1 || true)"
  [ -n "$dump" ] || die "Khong co ban sao luu nao cua $srcdb trong $SISCOM_BACKUP_DIR."
  dump="$SISCOM_BACKUP_DIR/$dump"
fi
[ -f "$dump" ] || die "Khong thay file: $dump"
case "$dump" in *.dump.age) is_age=1 ;; *.dump) is_age=0 ;; *) die "Duoi file phai la .dump.age hoac .dump" ;; esac
dir="$(dirname "$dump")"; fname="$(basename "$dump")"

# 1. SHA-256 cua file luu
[ -f "$dump.sha256" ] || die "Thieu $dump.sha256."
( cd "$dir" && sha256sum -c "$fname.sha256" >/dev/null ) || die "SHA-256 file sao luu KHONG khop (file hong hoac bi sua)."
info "SHA-256 file luu khop: $fname"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
plain="$dump"
if [ "$is_age" = 1 ]; then
  require_cmd age
  [ -n "$identity" ] && [ -f "$identity" ] || die "Ban .age can --identity <khoa rieng age>."
  plain="$work/restore.dump"
  age -d -i "$identity" -o "$plain" "$dump" || die "Giai ma that bai (sai khoa?)."
else
  plain="$work/restore.dump"; cp "$dump" "$plain"
fi
# pg_restore chay duoi user postgres: chi thu muc tam nay (700) thuoc postgres doc duoc ban ro; xoa khi thoat (trap).
if [ "${SISCOM_REHEARSAL:-}" != 1 ]; then chown postgres:postgres "$work" "$plain"; chmod 700 "$work"; fi
manifest="${dump%.age}"; manifest="${manifest%.dump}.manifest"
# 2. SHA-256 ban ro khop manifest (neu co)
if [ -f "$manifest" ]; then
  want="$(env_get "$manifest" plain_sha256 || true)"
  got="$(sha256sum "$plain" | cut -d' ' -f1)"
  [ -z "$want" ] || [ "$want" = "$got" ] || die "SHA-256 ban ro khac manifest."
else
  warn "Khong co manifest: se so voi DB nguon HIEN TAI (chi tuong doi)."
fi
items="$(pg_restore -l "$plain" | grep -vc '^;')" || items=0
[ "$items" -ge 3 ] || die "pg_restore -l khong doc duoc (so muc $items)."

# 3. Tao DB thu va khoi phuc
target="siscom_crm_restore_$(date -u +%Y%m%d_%H%M%S)"
is_restore_db "$target" || die "Ten DB thu khong hop le: $target"
[ "$(psql_su -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = '$target'")" != 1 ] || die "DB $target da ton tai."
psql_su -d postgres -c "CREATE DATABASE \"$target\" OWNER $ROLE_MIGRATOR ENCODING 'UTF8' TEMPLATE template0"
info "Da tao DB thu $target"
if [ "${SISCOM_REHEARSAL:-}" = 1 ]; then
  pg_restore --no-owner --role="$ROLE_MIGRATOR" --exit-on-error -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" "$plain"
else
  runuser -u postgres -- pg_restore --no-owner --role="$ROLE_MIGRATOR" --exit-on-error -d "$target" "$plain" \
    || die "pg_restore that bai. DB thu $target van con; xoa: sudo -u postgres psql -c 'DROP DATABASE \"$target\"'"
fi
info "pg_restore hoan tat"

# 4. So sanh so dong
fail=0; checked=0
tcount() { psql_su -d "$1" -tA -c "SELECT count(*) FROM public.$2"; }
if [ -f "$manifest" ]; then
  while IFS='|' read -r tag t n; do
    [ "$tag" = rows ] || continue
    [[ "$t" =~ ^[a-z_][a-z0-9_]*$ ]] || die "Manifest co ten bang la."
    got="$(tcount "$target" "$t")"; checked=$((checked + 1))
    if [ "$got" != "$n" ]; then echo "  KHAC: $t manifest=$n khoi_phuc=$got"; fail=1; fi
  done < "$manifest"
else
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    got="$(tcount "$target" "$t")"; src="$(tcount "$srcdb" "$t")"; checked=$((checked + 1))
    if [ "$got" != "$src" ]; then echo "  KHAC: $t nguon_hien_tai=$src khoi_phuc=$got"; fail=1; fi
  done < <(psql_su -d "$target" -tA -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
fi
[ "$checked" -ge 1 ] || die "Khong co bang nao de so (manifest rong?)."
tables_n="$(psql_su -d "$target" -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
meta="$(psql_su -d "$target" -tA -c "SELECT coalesce((SELECT value FROM app_meta WHERE key = 'schema_baseline'), '(khong co)')" 2>/dev/null || echo '(khong co bang app_meta)')"
mig="$(psql_su -d "$target" -tA -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo 0)"
info "DB thu $target: $tables_n bang public, schema_baseline=$meta, migration xong=$mig"
[ "$fail" = 0 ] || die "KHONG DAT: so dong khac manifest o tren. DB thu $target giu lai de dieu tra."
[ "$mig" -ge 1 ] || die "KHONG DAT: _prisma_migrations khong co dong nao hoan tat."
info "PASS: $checked bang khop so dong."
{
  echo "sha256_file=$(cut -d' ' -f1 "$dump.sha256")"
  echo "dump=$fname"
  echo "restored_db=$target"
  echo "tables_checked=$checked"
  echo "schema_baseline=$meta"
  echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$dump.restore-ok.txt"
info "Da ghi $dump.restore-ok.txt"
echo "Don dep khi xong (KHONG tu dong): sudo -u postgres psql -c 'DROP DATABASE \"$target\"'"
if [ "$is_age" = 1 ]; then echo "NHAC: xoa khoa rieng age khoi VPS neu da chep len de giai ma: shred -u <file>"; fi
