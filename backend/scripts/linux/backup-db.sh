#!/usr/bin/env bash
# SISCOM CRM - sao luu PostgreSQL hang dem: pg_dump -Fc (anh chup nhat quan) -> kiem pg_restore -l -> ma hoa age -> SHA-256 -> giu 14 ngay + 8 tuan.
# Chay bang root (timer systemd siscom-crm-backup.timer, 19:00 UTC = 02:00 gio VN) hoac tay: sudo backup-db.sh
# DB lay tu $SISCOM_ETC/migrate.env (MIGRATE_DATABASE_URL = siscom_migrator, doc duoc moi bang). Tu choi tai khoan postgres.
# Dau ra trong $SISCOM_BACKUP_DIR (700):
#   <db>_<YYYYMMDD_HHMMSS UTC>.dump.age          ban sao luu DA MA HOA (chi khoa RIENG cua Owner giai ma duoc)
#   <db>_<...>.dump.age.sha256                   SHA-256 cua file .age - CHI kiem loi chep file, KHONG phai xac thuc (khong co khoa)
#   <db>_<...>.manifest                          db, file, file_sha256, SHA-256 ban ro, so dong tung bang LUC CHUP (cung anh chup voi pg_dump)
#   <db>_<...>.manifest.sig                      CHU KY ed25519 (ssh-keygen -Y, namespace siscom-crm-backup) cua manifest - F1 (PR232-R1)
# Khoa age: danh sach KHOA CONG KHAI (age1...) o $SISCOM_ETC/backup.age-recipients (moi dong 1 khoa). Khoa RIENG khong bao gio nam tren VPS.
# Khoa ky: $SISCOM_ETC/backup-signing.key (root 600) + backup-signing.allowed_signers (cong khai). Tao 1 lan: backup-db.sh --init-signing-key
#   (Owner chep allowed_signers ra ngoai VPS de kiem ban sao ngoai may chu). Thieu khoa ky => TU CHOI sao luu (fail-closed).
# Khong ma hoa (SISCOM_BACKUP_NO_ENCRYPT=yes) CHI cho DB thu cach ly khi dien tap (SISCOM_REHEARSAL=1); TU CHOI voi siscom_crm_prod va moi DB van hanh,
#   kiem truoc khi dump (quyet dinh Owner 12/11). Ban .dump ro van duoc ky manifest.
# Giu ban (SEC-02, dieu kien Owner): retention CHI tinh tren bo .dump.age (14 moi nhat + moi tuan 1 bo, 8 tuan). Bo .dump (plaintext)
#   KHONG BAO GIO bi script xoa. Che do ma hoa ma con bo .dump: ban .age moi van duoc tao + ky + tu kiem, roi liet ke plaintext va
#   THOAT != 0 MOI LAN cho toi khi Owner xu ly TAY (phe duyet rieng; co bo .age thay the qua xac thuc + restore-test dat; xoa tay).
#   Khong co co nao bo qua kiem soat nay va khong co co tu xoa plaintext. deploy.sh coi sao luu != 0 la loi.
# Khong ghi de, khong xoa gi truoc khi ban moi hop le. Ma thoat khac 0 neu bat ky buoc nao loi. Khong in mat khau/URL.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

sign_key="$SISCOM_ETC/backup-signing.key"
allowed="$SISCOM_ETC/backup-signing.allowed_signers"
if [ "${1:-}" = --init-signing-key ]; then
  [ "${SISCOM_REHEARSAL:-}" = 1 ] || require_root
  require_cmd ssh-keygen
  [ ! -e "$sign_key" ] || die "Da co $sign_key (khong ghi de: doi khoa la quy trinh rieng, can giu khoa cong khai cu de kiem ban cu)."
  private_dir "$SISCOM_ETC"
  ( umask 077; ssh-keygen -q -t ed25519 -N '' -C "$BACKUP_SIG_NS" -f "$sign_key" )
  chmod 600 "$sign_key"
  printf '%s namespaces="%s" %s\n' "$BACKUP_SIG_NS" "$BACKUP_SIG_NS" "$(cut -d' ' -f1,2 "$sign_key.pub")" > "$allowed"
  chmod 644 "$allowed" "$sign_key.pub"
  info "Da tao khoa ky sao luu $sign_key (600). Khoa CONG KHAI (chep ra ngoai VPS, giu cung khoa rieng age):"
  cat "$allowed"
  exit 0
fi
[ $# -eq 0 ] || die "Tham so la: $1 (dung: backup-db.sh | backup-db.sh --init-signing-key)"

# SEC-02 (quyet dinh Owner 12/11): production BAT BUOC ma hoa. SISCOM_BACKUP_NO_ENCRYPT=yes chi duoc dung cho DB thu CACH LY
# (dien tap SISCOM_REHEARSAL=1, khong bao gio siscom_crm_prod). Kiem NGAY TU DAU - truoc moi ket noi DB / dump / tao thu muc.
if [ "${SISCOM_BACKUP_NO_ENCRYPT:-}" = yes ]; then
  ne_db="$(url_dbname "$(env_get "$SISCOM_ETC/migrate.env" MIGRATE_DATABASE_URL 2>/dev/null || true)")"
  [ "$ne_db" != siscom_crm_prod ] || die "TU CHOI: SISCOM_BACKUP_NO_ENCRYPT=yes voi siscom_crm_prod - production bat buoc ma hoa (age). Khong dump."
  [ "${SISCOM_REHEARSAL:-}" = 1 ] || die "TU CHOI: SISCOM_BACKUP_NO_ENCRYPT=yes chi cho DB thu CACH LY (dien tap SISCOM_REHEARSAL=1), khong cho DB van hanh ('${ne_db:-?}'). Khong dump."
fi
[ "${SISCOM_REHEARSAL:-}" = 1 ] || require_root
require_cmd pg_dump pg_restore psql sha256sum ssh-keygen
umask 077
assert_private_file "$sign_key"
[ -s "$allowed" ] || die "Thieu $allowed. Chay: backup-db.sh --init-signing-key"

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

backup_dir_ensure "$SISCOM_BACKUP_DIR"   # khong chmod lai thu muc da co (giu ACL doc cua backup-pull)
stamp="$(date -u +%Y%m%d_%H%M%S)"
base="$SISCOM_BACKUP_DIR/${db}_${stamp}"
part="$base.dump.partial"; man="$base.manifest.partial"
[ ! -e "$base.dump" ] && [ ! -e "$base.dump.age" ] && [ ! -e "$part" ] || die "File dich da ton tai (khong ghi de). Doi vai giay roi chay lai."
done_ok=0
# That bai o bat ky buoc nao (ke ca sau khi da tao file cuoi) => khong de lai bo sao luu do dang/chua ky.
cleanup() {
  rm -f "$part" "$man" "$base.dump.age.partial" 2>/dev/null || true
  [ "$done_ok" = 1 ] || rm -f "$base.dump.age" "$base.dump" "$base.manifest" "$base.manifest.sig" "$base.dump.age.sha256" "$base.dump.sha256" 2>/dev/null || true
}
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
{
  echo "encrypted=$encrypt"
  echo "file=$(basename "$final")"
  echo "file_sha256=$(sha256sum "$final" | cut -d' ' -f1)"
} >> "$man"
mv "$man" "$base.manifest"
backup_sign "$base.manifest" "$sign_key" || die "Ky manifest that bai."
verify_backup_set "$final" "$allowed" "$db" || die "Tu kiem bo sao luu vua tao KHONG dat (khoa ky / allowed_signers khong khop?)."
( cd "$SISCOM_BACKUP_DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256" )
done_ok=1
trap - EXIT
grc=0
if [ "$encrypt" = 1 ]; then backup_grant_pull "$base" || grc=$?; fi   # chi bo MA HOA, sau khi tu kiem dat
info "Da sao luu: $final ($(stat -c '%s' "$final") byte, $items muc, ma hoa=$encrypt); manifest da ky va tu kiem dat."
info "SHA-256 (file luu): $(cut -d' ' -f1 "$final.sha256")"

# --- Giu ban (SEC-02): CHI bo .dump.age cua DB nay bi retention xoa; plaintext chi duoc liet ke. Ma hoa + con plaintext => ban .age moi
# DA tao + tu kiem, nhung thoat != 0 cho toi khi Owner xu ly tay. ---
prc=0; backup_prune "$SISCOM_BACKUP_DIR" "$db" "$encrypt" || prc=$?
[ "$prc" = 0 ] || die "Ban sao luu ma hoa moi DA tao va tu kiem dat ($final), nhung buoc giu ban/plaintext chua xong (ma $prc, chi tiet o tren)."
[ "$grc" = 0 ] || die "Ban sao luu ma hoa moi DA tao va tu kiem dat ($final), nhung CHUA cap duoc quyen doc cho backup-pull (may Owner se khong keo duoc). Chay lai setup-backup-pull.sh."
info "Nho chep ra NGOAI may chu (Owner chon noi luu)."
