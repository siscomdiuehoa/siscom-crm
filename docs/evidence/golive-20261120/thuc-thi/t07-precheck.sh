#!/usr/bin/env bash
# SISCOM CRM - kiem TRUOC trien khai T-07 (#258, migration #17). CHI DOC.
# Chay: ssh ... 'bash -s -- [SRC_DIR]' < t07-precheck.sh
# Moi truy van DB chay voi default_transaction_read_only=on (PostgreSQL tu chan moi lenh ghi).
# Khong tao / sua / xoa gi tren database, cau hinh hay tep (khong dung tep tam). Khong doc, khong in mat khau hay khoa.
set -uo pipefail
PROD=siscom_crm_prod; MIG=20261121000000_sales_opportunity_search_fold; SRC="${1:-}"
fail=0
ok()  { echo "  [DAT]       $*"; }
bad() { echo "  [KHONG DAT] $*"; fail=1; }
inf() { echo "      $*"; }
iq()  { local v; if v="$(q "$2")"; then inf "$1: $v"; else bad "$1: truy van loi"; fi; }  # thong tin lay tu DB: truy van loi => KHONG DAT
q() { sudo -u postgres env PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -tA -v ON_ERROR_STOP=1 -d "$PROD" -c "$1"; }
eq() { [ "$2" = "$3" ] && ok "$1 = $2" || bad "$1 = $2 (can $3)"; }

echo "== Kiem truoc T-07 (chi doc) == $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "   ban dang chay: $(basename "$(readlink -f /opt/siscom-crm/current)"); ban truoc: $(cat /opt/siscom-crm/previous 2>/dev/null || echo '?')"
eq "transaction chi doc" "$(q 'SHOW default_transaction_read_only')" on

echo "1. Migration"
iq "PostgreSQL" 'SHOW server_version'
eq "so migration da ap" "$(q 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')" 16
eq "migration loi / dang do" "$(q 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL')" 0
iq "migration moi nhat" 'SELECT migration_name FROM public._prisma_migrations ORDER BY finished_at DESC LIMIT 1'
eq "migration #17 chua ap" "$(q "SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '$MIG'")" 0
if [ -n "$SRC" ]; then
  if [ ! -d "$SRC/backend/prisma/migrations" ]; then bad "khong thay $SRC/backend/prisma/migrations (SRC_DIR sai?)"
  elif ! dbl="$(q 'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1')"; then bad "khong doc duoc danh sach migration trong DB"
  elif ! srcl="$(find "$SRC/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')"; then bad "khong liet ke duoc migration cua ban moi"
  else
    dbl="$(printf '%s\n' "$dbl" | LC_ALL=C sort)"; srcl="$(printf '%s\n' "$srcl" | LC_ALL=C sort)"
    pend="$(LC_ALL=C comm -13 <(printf '%s\n' "$dbl") <(printf '%s\n' "$srcl") | tr '\n' ' ' | sed 's/ $//')"
    extra="$(LC_ALL=C comm -23 <(printf '%s\n' "$dbl") <(printf '%s\n' "$srcl") | tr '\n' ' ')"
    eq "migration se ap tu ban moi" "$pend" "$MIG"
    [ -z "$extra" ] && ok "DB khong co migration la (ngoai ban moi)" || bad "DB co migration khong co trong ban moi: $extra"
  fi
fi

echo "2. Dieu kien cua migration #17"
eq "pg_trgm + unaccent" "$(q "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension WHERE extname IN ('pg_trgm','unaccent')")" "pg_trgm,unaccent"
eq "gin_trgm_ops co san" "$(q "SELECT count(*) FROM pg_opclass c JOIN pg_am a ON a.oid = c.opcmethod WHERE c.opcname = 'gin_trgm_ops' AND a.amname = 'gin'")" 1
eq "f_vn_fold(text) IMMUTABLE" "$(q "SELECT provolatile FROM pg_proc WHERE oid = to_regprocedure('public.f_vn_fold(text)')")" i
eq "f_vn_fold('Hòa Phát ĐÀ Nẵng')" "$(q "SELECT public.f_vn_fold('Hòa Phát ĐÀ Nẵng')")" "hoa phat da nang"
eq "chu bang opportunity" "$(q "SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'opportunity'")" siscom_migrator
eq "siscom_migrator goi duoc f_vn_fold" "$(q "SELECT has_function_privilege('siscom_migrator', 'public.f_vn_fold(text)', 'EXECUTE')")" t
eq "cot title_fold / project_name_fold chua co" "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'opportunity' AND column_name IN ('title_fold','project_name_fold')")" 0
eq "chi muc ix_opportunity_*_fold chua co" "$(q "SELECT count(*) FROM pg_class WHERE relname IN ('ix_opportunity_title_fold','ix_opportunity_project_name_fold')")" 0

echo "3. Tac dong len bang opportunity"
iq "so dong opportunity" 'SELECT count(*) FROM public.opportunity'
iq "trong do da xoa mem" 'SELECT count(*) FROM public.opportunity WHERE deleted_at IS NOT NULL'
iq "dung luong bang + chi muc" "SELECT pg_size_pretty(pg_total_relation_size('public.opportunity'))"
eq "dong tinh gap dau bi NULL (title co gia tri)" "$(q 'SELECT count(*) FROM public.opportunity WHERE title IS NOT NULL AND public.f_vn_fold(title) IS NULL')" 0
eq "dong tinh gap dau bi NULL (project_name co gia tri)" "$(q 'SELECT count(*) FROM public.opportunity WHERE project_name IS NOT NULL AND public.f_vn_fold(project_name) IS NULL')" 0
iq "do dai lon nhat sau gap dau (title)" 'SELECT coalesce(max(length(public.f_vn_fold(title))),0) FROM public.opportunity'
iq "do dai lon nhat sau gap dau (project_name)" 'SELECT coalesce(max(length(public.f_vn_fold(project_name))),0) FROM public.opportunity'

echo "4. Tinh trang database luc nay"
iq "dung luong DB" "SELECT pg_size_pretty(pg_database_size('$PROD'))"
iq "so ket noi" "SELECT count(*) FROM pg_stat_activity WHERE datname = '$PROD'"
eq "transaction mo qua 60 giay" "$(q "SELECT count(*) FROM pg_stat_activity WHERE datname = '$PROD' AND xact_start < now() - interval '60 seconds' AND pid <> pg_backend_pid()")" 0
eq "phien idle in transaction" "$(q "SELECT count(*) FROM pg_stat_activity WHERE datname = '$PROD' AND state LIKE 'idle in transaction%'")" 0
eq "khoa dang giu tren opportunity (phien khac)" "$(q "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'opportunity' AND l.pid <> pg_backend_pid()")" 0
if rows="$(q "SELECT string_agg(tablename || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text, ' ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'")" && [ -n "$rows" ]; then
  inf "so dong tung bang (moc doi chieu sau trien khai):"; printf '%s\n' "$rows" | fold -s -w 110 | sed 's/^/        /'
else bad "khong lay duoc moc so dong tung bang"; fi

echo
if [ "$fail" = 1 ]; then echo "KET QUA: CO MUC KHONG DAT"; exit 1; else echo "KET QUA: moi muc deu DAT"; fi
