#!/usr/bin/env bash
# SISCOM CRM - sao luu PostgreSQL hang dem: pg_dump -Fc (anh chup nhat quan) -> kiem pg_restore -l -> ma hoa age -> SHA-256 -> giu 14 ngay + 8 tuan.
# Chay bang root (timer systemd siscom-crm-backup.timer, 19:00 UTC = 02:00 gio VN) hoac tay: sudo backup-db.sh
# DB lay tu $SISCOM_ETC/migrate.env (MIGRATE_DATABASE_URL = siscom_migrator, doc duoc moi bang). Tu choi tai khoan postgres.
# Dau ra trong $SISCOM_BACKUP_DIR (700):
#   <db>_<YYYYMMDD_HHMMSS UTC>.dump.age          ban sao luu DA MA HOA (chi khoa RIENG cua Owner giai ma duoc)
#   <db>_<...>.dump.age.sha256                   SHA-256 cua file .age (kiem toan ven khi chep ra ngoai may chu)
#   <db>_<...>.manifest                          SHA-256 ban ro, phien ban, so dong tung bang LUC CHUP (cung anh chup voi pg_dump)
# Khoa age: danh sach KHOA CONG KHAI (age1...) o $SISCOM_ETC/backup.age-recipients (moi dong 1 khoa). Khoa RIENG khong bao gio nam tren VPS.
# Khong ma hoa chi khi dat SISCOM_BACKUP_NO_ENCRYPT=yes (tu chiu rui ro; ban .dump ro, 600).
# Khong ghi de, khong xoa gi truoc khi ban moi hop le. Ma thoat khac 0 neu bat ky buoc nao loi. Khong in mat khau/URL.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

[ "${SISCOM_REHEARSAL:-}" = 1 ] || require_root
require_cmd pg_dump pg_restore psql sha256sum
umask 077

migrate_env="$SISCOM_ETC/migrate.env"
assert_private_file "$migrate_env"
murl="$(env_get "$migrate_env" MIGRATE_DATABASE_URL)" || die "migrate.env thieu MIGRATE_DATABASE_URL."
db="$(url_dbname "$murl")"
require_ops_db "$db"
user="${murl#*://}"; user="${user%%:*}"
[ "$user" = "$ROLE_MIGRATOR" ] || die "Sao luu phai dung tai khoan $ROLE_MIGRATOR (dang '$user'); tu choi postgres/tai khoan khac."
pw="${murl#*://*:}"; pw="${pw%%@*}"
[[ "$pw" =~ ^[0-9a-f]{48}$ ]] || die "Mat khau migrator trong migrate.env sai dinh dang."

recipients="$SISCOM_ETC/backup.age-recipients"
encrypt=1
if [ "${SISCOM_BACKUP_NO_ENCRYPT:-}" = yes ]; then
  encrypt=0; warn "SISCOM_BACKUP_NO_ENCRYPT=yes: ban sao luu KHONG ma hoa."
else
  require_cmd age
  [ -s "$recipients" ] || die "Thieu $recipients (khoa cong khai age). Tao bang: age-keygen tren MAY CUA OWNER, dan dong 'age1...' vao file. Khoa rieng khong dua len VPS."
  grep -Eq '^age1[a-z0-9]+$' "$recipients" || die "$recipients khong co dong khoa cong khai age1... hop le."
fi

private_dir "$SISCOM_BACKUP_DIR"
stamp="$(date -u +%Y%m%d_%H%M%S)"
base="$SISCOM_BACKUP_DIR/${db}_${stamp}"
part="$base.dump.partial"; man="$base.manifest.partial"
[ ! -e "$base.dump" ] && [ ! -e "$base.dump.age" ] && [ ! -e "$part" ] || die "File dich da ton tai (khong ghi de). Doi vai giay roi chay lai."
cleanup() { rm -f "$part" "$man" "$base.dump.age.partial" 2>/dev/null || true; }
trap cleanup EXIT

free_kb="$(df -Pk "$SISCOM_BACKUP_DIR" | awk 'NR==2 {print $4}')"
[ "$free_kb" -gt 1048576 ] || die "O dia sao luu con duoi 1 GB trong."

export PGPASSWORD="$pw" PGCONNECT_TIMEOUT=15
conn=(-h "$SISCOM_PG_HOST" -p "$SISCOM_PG_PORT" -U "$ROLE_MIGRATOR" -d "$db")
sv="$(psql -X -q -tA -w "${conn[@]}" -c 'SHOW server_version_num')" || die "Khong ket noi duoc database $db bang $ROLE_MIGRATOR."
[[ "$sv" =~ ^[0-9]{5,6}$ ]] || die "Khong doc duoc phien ban may chu."
dumpmajor="$(pg_dump --version | grep -Eo '[0-9]+' | head -n1)"
[ "$dumpmajor" -ge $((sv / 10000)) ] || die "pg_dump ban $dumpmajor cu hon may chu PostgreSQL ban $((sv / 10000))."
info "Ket noi $db (PostgreSQL $((sv / 10000))), pg_dump $dumpmajor"

# Anh chup nhat quan: mot phien REPEATABLE READ giu mo, xuat snapshot; pg_dump --snapshot va dem dong dung CUNG anh chup => manifest khop ban dump.
coproc SNAP { psql -X -q -tA -w "${conn[@]}" 2>/dev/null; }
snap_pid="${SNAP_PID:-}"
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n' >&"${SNAP[1]}"
snapid=""
IFS= read -r -t 30 first <&"${SNAP[0]}" || die "Khong mo duoc phien anh chup."
cr=$'\r'  # psql tren Windows (chi dien tap) xuong dong CRLF; tren Linux khong co \r
first="${first%"$cr"}"
if [ "$first" = BEGIN ]; then IFS= read -r -t 30 snapid <&"${SNAP[0]}" || true; snapid="${snapid%"$cr"}"; else snapid="$first"; fi
[[ "$snapid" =~ ^[0-9A-F]+(-[0-9A-F]+)+$ ]] || die "Khong lay duoc snapshot id."
snap_q() { # snap_q <sql>  -> in 1 dong ket qua tu phien anh chup
  local line marker="__END_${RANDOM}${RANDOM}__"
  printf '%s\nSELECT %s;\n' "$1" "'$marker'" >&"${SNAP[1]}"
  while IFS= read -r -t 60 line <&"${SNAP[0]}"; do line="${line%"$cr"}"; [ "$line" = "$marker" ] && break; printf '%s\n' "$line"; done
}
snap_close() { { printf 'COMMIT;\n\\q\n' >&"${SNAP[1]}"; } 2>/dev/null || true; if [ -n "$snap_pid" ]; then wait "$snap_pid" 2>/dev/null || true; fi; }

pg_dump -w "${conn[@]}" -Fc -Z 6 --snapshot="$snapid" -f "$part" || { snap_close; die "pg_dump that bai. Khong co file sao luu nao duoc tao."; }
{
  echo "db=$db"
  echo "taken_utc=$stamp"
  echo "server_version_num=$sv"
  tables="$(snap_q "SELECT quote_ident(tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;")"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    [[ "$t" =~ ^[a-z_][a-z0-9_]*$ ]] || { snap_close; die "Ten bang la: $t"; }
    n="$(snap_q "SELECT count(*) FROM public.$t;")"
    [[ "$n" =~ ^[0-9]+$ ]] || { snap_close; die "Khong dem duoc dong bang $t."; }
    echo "rows|$t|$n"
  done <<<"$tables"
} > "$man"
snap_close
grep -q '^rows|' "$man" || die "Manifest khong co bang nao (database rong?). Bo ban sao luu."

size="$(stat -c '%s' "$part")"
[ "$size" -ge 1024 ] || die "File sao luu qua nho ($size byte)."
items="$(pg_restore -l "$part" | grep -vc '^;')" || items=0
[ "$items" -ge 3 ] || die "pg_restore -l khong doc duoc ban sao luu (so muc $items). Da bo file loi."
grep -q '^rows|app_meta|' "$man" || warn "Khong thay bang app_meta (da migrate chua?)."
plain_sha="$(sha256sum "$part" | cut -d' ' -f1)"
echo "plain_sha256=$plain_sha" >> "$man"
echo "plain_bytes=$size" >> "$man"

if [ "$encrypt" = 1 ]; then
  final="$base.dump.age"
  age -R "$recipients" -o "$final.partial" "$part"
  [ -s "$final.partial" ] || die "Ma hoa age that bai."
  mv "$final.partial" "$final"
  rm -f "$part"
else
  final="$base.dump"
  mv "$part" "$final"
fi
mv "$man" "$base.manifest"
( cd "$SISCOM_BACKUP_DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256" )
trap - EXIT
info "Da sao luu: $final ($(stat -c '%s' "$final") byte, $items muc, ma hoa=$encrypt)"
info "SHA-256 (file luu): $(cut -d' ' -f1 "$final.sha256")"

# --- Giu ban: 14 ban moi nhat + moi tuan 1 ban (8 tuan gan nhat). CHI xoa trong thu muc sao luu, CHI ten dung mau, CHI cua DB nay. ---
ext='dump.age'; [ "$encrypt" = 1 ] || ext='dump'
ext_re="${ext//./\\.}"
mapfile -t all < <(find "$SISCOM_BACKUP_DIR" -maxdepth 1 -type f -printf '%f\n' | grep -E "^${db}_[0-9]{8}_[0-9]{6}\\.${ext_re}\$" | sort || true)
mapfile -t keep < <(printf '%s\n' "${all[@]}" | retention_keep 14 8)
for f in "${all[@]}"; do
  if ! printf '%s\n' "${keep[@]}" | grep -qxF "$f"; then
    stem="${f%."$ext"}"
    rm -f -- "$SISCOM_BACKUP_DIR/$f" "$SISCOM_BACKUP_DIR/$f.sha256" "$SISCOM_BACKUP_DIR/$stem.manifest" "$SISCOM_BACKUP_DIR/$f.restore-ok.txt"
    info "Da xoa ban cu: $f"
  fi
done
info "Con ${#keep[@]} ban sao luu cua $db. Nho chep ra NGOAI may chu (Owner chon noi luu)."
