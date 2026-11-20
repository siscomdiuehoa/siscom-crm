#!/usr/bin/env bash
# SISCOM CRM - BUOC 2 go-live (PR #255 muc 5; Owner: "OWNER_APPROVED_MIGRATION siscom_crm_prod", 20/11/2026).
# Chay TREN VPS bang root: ssh ... 'bash -s -- <che-do>' < step2-db.sh
#   pre     chi doc: trang thai + dau van tay DAY DU DB staging (owner/ACL, schema pg_dump -s, so dong)
#   apply   1) backup-db.sh (staging, lan cuoi) + kiem chu ky/SHA-256 - LOI => DUNG, khong lam tiep
#           2) systemctl stop siscom-crm-backend
#           3) sao luu backend.env / migrate.env (.bak-<STAMP>, 600 root)
#           4) create-db.sh siscom_crm_prod create
#           5) SISCOM_HOST=crm.siscom.io.vn create-db.sh siscom_crm_prod env --force-env
#           Dich vu DE DUNG (DB moi chua migrate; buoc 3 deploy.sh --migrate se chay lai dich vu).
#   post    chi doc: DB moi dung chu so huu / quyen; env tro siscom_crm_prod; staging trung dau van tay truoc
# KHONG migration, KHONG seed, KHONG bootstrap, KHONG xoa DB nao. Khong in mat khau.
set -euo pipefail
mode="${1:-}"; LIN=/opt/siscom-crm/current/backend/scripts/linux; ETC=/etc/siscom-crm; ST=/root/golive-step2
STG=siscom_crm_staging; PROD=siscom_crm_prod; HOST=crm.siscom.io.vn
[ "$(id -u)" = 0 ] || { echo "can root"; exit 2; }
install -d -m 700 "$ST"
md5() { md5sum | cut -c1-32; }
fp_db() { # chu so huu + ACL database | md5 schema (pg_dump -s, bo dong \restrict ngau nhien) | md5 so dong tung bang
  local d="$1"
  echo "owner+acl=[$(sudo -u postgres psql -X -q -tA -d postgres -c "SELECT pg_get_userbyid(datdba) || ' ' || coalesce(datacl::text, '(mac dinh)') FROM pg_database WHERE datname = '$d'")] schema=$(sudo -u postgres pg_dump -s -d "$d" | grep -v -E '^\\(un)?restrict ' | md5) rows=$(sudo -u postgres psql -X -q -tA -d "$d" -c "SELECT string_agg(tablename || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" | md5)"
}
envdb() { # ten DB ma env dang tro (khong in mat khau)
  ( . "$LIN/lib.sh"
    echo "backend.env DATABASE_URL -> $(url_dbname "$(env_get "$ETC/backend.env" DATABASE_URL)"), AUTH_DATABASE_URL -> $(url_dbname "$(env_get "$ETC/backend.env" AUTH_DATABASE_URL)"); migrate.env -> $(url_dbname "$(env_get "$ETC/migrate.env" MIGRATE_DATABASE_URL)"); origin: $(env_get "$ETC/backend.env" AUTH_ALLOWED_ORIGINS) ($(stat -c '%a %U' "$ETC/backend.env"), $(stat -c '%a %U' "$ETC/migrate.env"))" )
}
state() {
  echo "thoi diem: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "backend: $(systemctl is-active siscom-crm-backend || true); caddy: $(systemctl is-active caddy); postgresql: $(systemctl is-active postgresql)"
  echo "DB: $(sudo -u postgres psql -X -q -tA -d postgres -c "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE datname LIKE 'siscom%'")"
  envdb
  echo "dau van tay $STG: $(fp_db "$STG")"
}

case "$mode" in
  pre)
    echo "== TRUOC BUOC 2 =="; state
    echo "health/database: $(curl -s http://127.0.0.1:3000/api/v1/health/database | grep -oE '"(database|migrated|leastPrivilege|authLeastPrivilege)":("[a-z]+"|[a-z]+)' | tr '\n' ' ')"
    fp_db "$STG" > "$ST/staging-fp-pre.txt"
    ;;
  apply)
    [ -f "$ST/staging-fp-pre.txt" ] || { echo "chay pre truoc"; exit 1; }
    if sudo -u postgres psql -X -q -tA -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$PROD'" | grep -q 1; then echo "DUNG: $PROD da ton tai"; exit 1; fi
    stamp="$(date -u +%Y%m%d%H%M%S)"; echo "STAMP=$stamp"
    echo "--- 1. sao luu staging lan cuoi ---"
    bash "$LIN/backup-db.sh" > "$ST/backup-$stamp.out" 2>&1 || { tail -8 "$ST/backup-$stamp.out"; echo "DUNG: sao luu staging lan cuoi KHONG thanh cong - khong sang buoc tiep (dieu kien dung muc 5.2)."; exit 1; }
    grep -E '^\[(OK|LOI)\]' "$ST/backup-$stamp.out" | cut -c1-140
    dump="$(find /var/backups/siscom-crm -maxdepth 1 -name "${STG}_*.dump.age" -newer "$ST/staging-fp-pre.txt" | sort | tail -n1)"
    [ -n "$dump" ] || { echo "DUNG: khong thay bo sao luu moi"; exit 1; }
    ( . "$LIN/lib.sh"; verify_backup_set "$dump" "$ETC/backup-signing.allowed_signers" "$STG" ) || { echo "DUNG: bo sao luu moi khong qua kiem chu ky"; exit 1; }
    echo "bo sao luu lan cuoi: $(basename "$dump") - chu ky manifest + SHA-256 hop le"
    echo "--- 2. dung dich vu ---"
    systemctl stop siscom-crm-backend; echo "backend: $(systemctl is-active siscom-crm-backend || true)"
    echo "--- 3. sao luu env ---"
    cp -a "$ETC/backend.env" "$ETC/backend.env.bak-$stamp"; cp -a "$ETC/migrate.env" "$ETC/migrate.env.bak-$stamp"
    echo "$ETC/backend.env.bak-$stamp, $ETC/migrate.env.bak-$stamp ($(stat -c '%a %U' "$ETC/backend.env.bak-$stamp"))"
    echo "--- 4. create-db.sh $PROD create ---"
    bash "$LIN/create-db.sh" "$PROD" create > "$ST/create-$stamp.out" 2>&1 || { grep -E '^\[(OK|LOI)\]|TU CHOI' "$ST/create-$stamp.out" | cut -c1-160; echo "DUNG: create loi (dich vu de dung; env CHUA doi)"; exit 1; }
    grep -E '^\[(OK|LOI)\]|TU CHOI' "$ST/create-$stamp.out" | cut -c1-160
    echo "--- 5. create-db.sh $PROD env --force-env (SISCOM_HOST=$HOST) ---"
    SISCOM_HOST="$HOST" bash "$LIN/create-db.sh" "$PROD" env --force-env > "$ST/env-$stamp.out" 2>&1 || { grep -E '^\[(OK|LOI)\]|TU CHOI' "$ST/env-$stamp.out" | cut -c1-160; echo "DUNG: env loi"; exit 1; }
    grep -E '^\[(OK|LOI)\]|TU CHOI' "$ST/env-$stamp.out" | cut -c1-160
    echo "Dich vu de DUNG: $PROD chua migrate (buoc 3)."
    ;;
  post)
    echo "== SAU BUOC 2 =="; state
    chk="$(sudo -u postgres psql -X -q -tA -d postgres -c "SELECT pg_get_userbyid(datdba) || '|' || has_database_privilege('siscom_app','$PROD','CONNECT') || '|' || has_database_privilege('siscom_auth','$PROD','CONNECT') || '|' || has_database_privilege('siscom_app','$PROD','CREATE') || '|' || (SELECT string_agg(has_database_privilege('public','$PROD',p)::text, ',') FROM unnest(ARRAY['CONNECT','TEMP','CREATE']) p) FROM pg_database WHERE datname = '$PROD'")"
    echo "$PROD quyen (owner|app CONNECT|auth CONNECT|app CREATE|PUBLIC CONNECT,TEMP,CREATE): $chk  [ky vong siscom_migrator|true|true|false|false,false,false]"
    echo "$PROD bang public: $(sudo -u postgres psql -X -q -tA -d "$PROD" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'") (ky vong 0: chua migrate)"
    fp_db "$STG" > "$ST/staging-fp-post.txt"
    if cmp -s "$ST/staging-fp-pre.txt" "$ST/staging-fp-post.txt"; then echo "staging: dau van tay TRUNG truoc buoc 2 (owner/ACL, schema, so dong)"; else echo "CANH BAO: staging KHAC truoc buoc 2"; diff "$ST/staging-fp-pre.txt" "$ST/staging-fp-post.txt" || true; fi
    echo "bo sao luu staging moi nhat: $(ls -1t /var/backups/siscom-crm | grep -E "^${STG}_.*\.dump\.age$" | head -1)"
    echo "timer sao luu dem: $(systemctl list-timers --no-pager | grep siscom-crm-backup | awk '{print $1, $2, $3, $4}')"
    echo "https://$HOST/ => $(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/") ; /api/v1/health => $(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/api/v1/health") (ky vong 502: dich vu dung cho buoc 3)"
    ;;
  *) echo "che do: pre | apply | post"; exit 2 ;;
esac
