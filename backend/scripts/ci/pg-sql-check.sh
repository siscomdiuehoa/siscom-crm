#!/usr/bin/env bash
# SISCOM CRM - chay mot file SQL kiem thu/rollback (backend/docs/B1.3_*.sql.txt) tren DB TAM cua CI bang psql va danh gia ket qua.
# CHI dung trong CI (GITHUB_ACTIONS) voi TEST_DATABASE_URL tro toi siscom_crm_test_* tren 127.0.0.1 (moi file SQL con tu kiem
# current_database() va tu choi DB khong phai ban sao thu). Khong in URL/mat khau (URL da duoc ::add-mask:: khi tao DB tam).
#
# Dung: pg-sql-check.sh <file.sql.txt> <mode> [as]
#   mode=res  : file tu tong ket bang cac dong "PASS|n" / "FAIL|n" (psql -tA). Dat khi psql thoat 0, co >=1 dong PASS|n va KHONG co FAIL|n.
#   mode=fail : NGUOC LAI cua res - bai TAI HIEN (RED): dat khi psql thoat 0 va CO it nhat mot dong FAIL|n (B1.4 P3: S1 truoc khi tach role).
#   mode=ok   : file in cac dong "label|t" hoac "label|f" (psql -tA). Dat khi psql thoat 0, co >=1 dong va KHONG co dong "|f".
#   mode=run  : chi can psql thoat 0 (vi du rollback: file tu RAISE neu khong sach).
#   as=app (mac dinh): ket noi TEST_DATABASE_URL (siscom_app) | as=migrator: TEST_MIGRATE_DATABASE_URL (siscom_migrator, chu so huu sau S1).
set -euo pipefail
file="${1:-}"; mode="${2:-}"; as="${3:-app}"
[ -n "${GITHUB_ACTIONS:-}" ] || { echo "TU CHOI: chi chay trong GitHub Actions."; exit 2; }
[ -f "$file" ] || { echo "THIEU file SQL: $file"; exit 2; }
[ -n "${TEST_DATABASE_URL:-}" ] || { echo "THIEU TEST_DATABASE_URL."; exit 2; }
case "$TEST_DATABASE_URL" in postgresql://siscom_app:*@127.0.0.1:*/siscom_crm_test_*) ;; *) echo "TU CHOI: TEST_DATABASE_URL khong phai DB tam siscom_crm_test_* tren 127.0.0.1 voi user siscom_app."; exit 2 ;; esac

case "$as" in
  app) conn_url="$TEST_DATABASE_URL" ;;
  migrator)
    [ -n "${TEST_MIGRATE_DATABASE_URL:-}" ] || { echo "THIEU TEST_MIGRATE_DATABASE_URL."; exit 2; }
    case "$TEST_MIGRATE_DATABASE_URL" in postgresql://siscom_migrator:*@127.0.0.1:*/siscom_crm_test_*) ;; *) echo "TU CHOI: TEST_MIGRATE_DATABASE_URL khong phai DB tam siscom_crm_test_* voi user siscom_migrator."; exit 2 ;; esac
    conn_url="$TEST_MIGRATE_DATABASE_URL" ;;
  *) echo "as khong hop le: $as (app|migrator)"; exit 2 ;;
esac

out="$(mktemp)"
set +e
psql -X -q -w -v ON_ERROR_STOP=1 -tA -d "$conn_url" -f "$file" >"$out" 2>&1
code=$?
set -e
echo "----- $(basename "$file") (as=$as, psql exit=$code) -----"
# In ket qua (chi nhan/ket qua test, khong co bi mat). Gioi han 200 dong.
head -n 200 "$out"
[ "$code" -eq 0 ] || { echo "KHONG DAT: psql thoat ma $code"; exit 1; }
case "$mode" in
  res)
    grep -Eq '^PASS\|[0-9]+$' "$out" || { echo "KHONG DAT: khong thay dong PASS|n"; exit 1; }
    if grep -Eq '^FAIL\|[0-9]+$' "$out"; then echo "KHONG DAT: co dong FAIL"; exit 1; fi
    echo "DAT: $(grep -E '^PASS\|[0-9]+$' "$out" | tail -n1)" ;;
  fail)
    grep -Eq '^FAIL\|[1-9][0-9]*$' "$out" || { echo "KHONG DAT (bai tai hien): mong doi co dong FAIL|n nhung khong thay."; exit 1; }
    echo "DAT (RED tai hien, mong doi): $(grep -E '^FAIL\|[0-9]+$' "$out" | tail -n1)" ;;
  ok)
    [ -s "$out" ] || { echo "KHONG DAT: khong co dong ket qua"; exit 1; }
    if grep -Eq '\|f$' "$out"; then echo "KHONG DAT: co dong |f"; exit 1; fi
    echo "DAT: $(grep -Ec '\|t$' "$out") dong ok=t" ;;
  run) echo "DAT: psql thoat 0" ;;
  *) echo "mode khong hop le: $mode"; exit 2 ;;
esac
