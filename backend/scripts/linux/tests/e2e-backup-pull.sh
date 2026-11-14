#!/usr/bin/env bash
# SISCOM CRM - kiem thu THAT (chi tren may CI dung mot lan, can root): setup-backup-pull.sh + sshd that (127.0.0.1:2222, cau hinh rieng,
# UsePAM no) + ACL that + pull-backups.ps1 chay bang pwsh. Khong cham PostgreSQL, khong cham sshd/ufw cua may.
#   sudo bash backend/scripts/linux/tests/e2e-backup-pull.sh
# Kiem: keo dung bo ma hoa (ke ca bo tao SAU khi cai, umask 077 nhu backup-db.sh), KHONG keo .dump; khong ghi/xoa/doi ten duoc;
# lenh SSH bi bo qua (khong shell); khong doc duoc /root, /etc/siscom-crm; khoa la bi tu choi; backup_dir_ensure giu ACL; --remove go sach.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Can root (sudo)."; exit 1; }
[ "$(uname -s)" = Linux ] || { echo "Chi chay tren Linux."; exit 1; }
for c in pwsh setfacl getfacl ssh sftp ssh-keygen ssh-keyscan /usr/sbin/sshd /usr/lib/openssh/sftp-server; do
  command -v "$c" >/dev/null 2>&1 || { echo "Thieu $c"; exit 1; }
done
id backup-pull >/dev/null 2>&1 && { echo "User backup-pull da co tren may nay - khong chay e2e."; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lin="$(cd "$here/.." && pwd)"
win="$(cd "$lin/../windows" && pwd)"
tmp="$(mktemp -d)"
bdir="/var/backups/siscom-crm-e2e-$$"; etc="/etc/siscom-crm-e2e-$$"
export SISCOM_BACKUP_DIR="$bdir" SISCOM_ETC="$etc"
sshd_pid=""
cleanup() {
  [ -n "$sshd_pid" ] && kill "$sshd_pid" 2>/dev/null
  id backup-pull >/dev/null 2>&1 && { pkill -u backup-pull 2>/dev/null; userdel backup-pull 2>/dev/null; }
  rm -rf "$tmp" "$bdir" "$etc" /var/lib/backup-pull
}
trap cleanup EXIT
pass=0; fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
check()     { local n="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$n"; else bad "$n"; fi; }
check_not() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then bad "$n"; else ok "$n"; fi; }
# shellcheck source=../lib.sh
. "$lin/lib.sh"

# --- Bo sao luu gia giong backup-db.sh (umask 077, redirect/mv trong thu muc, ky ssh-keygen -Y) ---
install -d -m 700 "$etc"; ssh-keygen -q -t ed25519 -N '' -C siscom-crm-backup -f "$etc/backup-signing.key"
printf 'siscom-crm-backup namespaces="siscom-crm-backup" %s\n' "$(cut -d' ' -f1,2 "$etc/backup-signing.key.pub")" > "$tmp/allowed_signers"
make_set() { # make_set <stem> [plain]
  ( umask 077
    local b="$bdir/$1" f ext=.dump.age; [ "${2:-}" = plain ] && ext=.dump
    f="$b$ext"; head -c 4096 /dev/urandom > "$f.partial"; mv "$f.partial" "$f"
    printf 'db=siscom_crm_staging\nrows|customer|3\nencrypted=%s\nfile=%s\nfile_sha256=%s\n' "$([ "$ext" = .dump.age ] && echo 1 || echo 0)" \
      "$(basename "$f")" "$(sha256sum "$f" | cut -d' ' -f1)" > "$b.manifest"
    backup_sign "$b.manifest" "$etc/backup-signing.key" >/dev/null 2>&1
    ( cd "$bdir" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256" )
    # nhu backup-db.sh: CHI bo ma hoa, SAU khi hoan tat + tu kiem => cap quyen doc cho backup-pull
    if [ "$ext" = .dump.age ]; then backup_grant_pull "$b"; fi )
}
ts() { date -u -d "$1" +%Y%m%d_%H%M%S; }
backup_dir_ensure "$bdir"
s1="siscom_crm_staging_$(ts '-3 hour')"; make_set "$s1"
sp="siscom_crm_staging_$(ts '-150 min')"; make_set "$sp" plain

echo "== 1. setup-backup-pull.sh tren may that =="
ssh-keygen -q -t ed25519 -N '' -C 'may owner' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/stranger"
out="$(bash "$lin/setup-backup-pull.sh" --pubkey "$tmp/client.pub" 2>&1)"; rc=$?
printf '%s\n' "$out" | sed 's/^/    /'
check "setup thoat 0" test "$rc" = 0
check "chay lai (idempotent) thoat 0" bash "$lin/setup-backup-pull.sh" --pubkey "$tmp/client.pub"
check "thu muc sao luu van cua root, 700 + ACL (stat hien 750 = mask r-x), khong chmod" test "$(stat -c '%U %a' "$bdir")" = "root 750"
check "ACL u:backup-pull:r-x tren thu muc" bash -c "getfacl -p '$bdir' | grep -qx 'user:backup-pull:r-x'"
check_not "PR235-SEC-01: KHONG co ACL mac dinh" bash -c "getfacl -p '$bdir' | grep -q '^default:'"
check "tep .dump plaintext KHONG co ACL backup-pull" bash -c "! getfacl -p '$bdir/$sp.dump' | grep -q backup-pull"
check_not "backup-pull khong doc duoc .dump plaintext" runuser -u backup-pull -- test -r "$bdir/$sp.dump"
check_not "backup-pull khong doc duoc manifest cua bo plaintext" runuser -u backup-pull -- test -r "$bdir/$sp.manifest"
check "bo ma hoa co san truoc setup: doc duoc" runuser -u backup-pull -- test -r "$bdir/$s1.manifest.sig"
check "authorized_keys root:backup-pull 640" test "$(stat -c '%U:%G %a' /var/lib/backup-pull/.ssh/authorized_keys)" = "root:backup-pull 640"
check "mat khau '*'" test "$(getent shadow backup-pull | cut -d: -f2)" = '*'
# Lan sao luu tiep theo (timer): backup_dir_ensure KHONG lam mat ACL; bo MA HOA hoan tat (backup_grant_pull) doc duoc du umask 077
backup_dir_ensure "$bdir"
check "backup_dir_ensure giu ACL (mask r-x)" bash -c "getfacl -p '$bdir' | grep -qx 'mask::r-x'"
s2="siscom_crm_staging_$(ts '-1 hour')"; make_set "$s2"
for p in .dump.age .dump.age.sha256 .manifest .manifest.sig; do check "bo moi hoan tat: backup-pull doc duoc $p" runuser -u backup-pull -- test -r "$bdir/$s2$p"; done
# PR235-R1-SEC-01: tep tao SAU setup (umask 077 va umask 022, nhu redirect cua shell) KHONG ke thua quyen doc cua backup-pull
s3="siscom_crm_staging_$(ts '-30 min')"
( umask 077; echo x > "$bdir/$s3.dump"; echo x > "$bdir/$s3.dump.partial"; echo x > "$bdir/$s3.dump.age.partial"; echo x > "$bdir/$s3.manifest.partial"; echo x > "$bdir/la.txt" )
( umask 022; echo x > "$bdir/$s3.dump.sha256"; echo x > "$bdir/la2.txt" )
for f in "$s3.dump" "$s3.dump.partial" "$s3.dump.age.partial" "$s3.manifest.partial" la.txt "$s3.dump.sha256" la2.txt; do
  check_not "PR235-SEC-01: tep moi '$f' KHONG doc duoc" runuser -u backup-pull -- test -r "$bdir/$f"
done
# bo ma hoa CHUA hoan tat (chua qua backup_grant_pull): doc khong duoc
sx="siscom_crm_staging_$(ts '-20 min')"; ( umask 077; echo x > "$bdir/$sx.dump.age"; echo x > "$bdir/$sx.manifest" )
check_not "PR235-SEC-01: bo ma hoa CHUA hoan tat KHONG doc duoc" runuser -u backup-pull -- test -r "$bdir/$sx.dump.age"
rm -f "$bdir/$sx.dump.age" "$bdir/$sx.manifest"
check_not "backup_grant_pull tu choi bo thieu tep" backup_grant_pull "$bdir/$sx"

echo "== 2. sshd that 127.0.0.1:2222 =="
mkdir -p /run/sshd
ssh-keygen -q -t ed25519 -N '' -f "$tmp/hostkey"
cat > "$tmp/sshd_config" <<CONF
Port 2222
ListenAddress 127.0.0.1
HostKey $tmp/hostkey
PidFile $tmp/sshd.pid
UsePAM no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
StrictModes yes
AuthorizedKeysFile .ssh/authorized_keys
Subsystem sftp /usr/lib/openssh/sftp-server
CONF
/usr/sbin/sshd -t -f "$tmp/sshd_config" || { echo "sshd -t loi"; exit 1; }
/usr/sbin/sshd -D -e -f "$tmp/sshd_config" 2> "$tmp/sshd.log" & sshd_pid=$!
for _ in $(seq 1 50); do ssh-keyscan -p 2222 -t ed25519 127.0.0.1 > "$tmp/known_hosts" 2>/dev/null && [ -s "$tmp/known_hosts" ] && break; sleep 0.2; done
check "sshd nghe 2222 + co known_hosts" test -s "$tmp/known_hosts"
sopt=(-P 2222 -i "$tmp/client" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$tmp/known_hosts")
sftp_b() { printf '%s\n' "$@" > "$tmp/b.sftp"; sftp -b "$tmp/b.sftp" "${sopt[@]}" backup-pull@127.0.0.1; }

echo "== 3. pull-backups.ps1 (pwsh) keo qua sftp that =="
drive="$tmp/Drive Co Cach"; work="$tmp/work"; mkdir -p "$drive"; cp "$tmp/allowed_signers" "$drive/backup-signing.allowed_signers"
pull() { pwsh -NoProfile -File "$win/pull-backups.ps1" -VpsHost 127.0.0.1 -Port 2222 -KeyFile "${PULL_KEY:-$tmp/client}" -SshBin /usr/bin \
  -KnownHostsFile "$tmp/known_hosts" -DriveDir "$drive" -WorkDir "$work" > "$tmp/pull.out" 2>&1; }
pull; rc=$?; sed 's/^/    /' "$tmp/pull.out"
check "pull thoat 0" test "$rc" = 0
for s in "$s1" "$s2"; do for p in .dump.age .dump.age.sha256 .manifest .manifest.sig; do
  check "Drive co $s$p" cmp -s "$bdir/$s$p" "$drive/staging/$s$p"
done; done
check_not "KHONG keo .dump plaintext" bash -c "find '$tmp' -name '*.dump' -o -name '*.partial' | grep -q ."
pull; rc=$?
check "chay lai thoat 0, Drive van 8 tep" bash -c "[ $rc = 0 ] && [ \$(ls '$drive/staging' | wc -l) = 8 ]"
printf 'x' >> "$bdir/$s2.dump.age"; rm -f "$drive/staging/$s2".*
pull; rc=$?
check "bo bi sua tren VPS => thoat 1, KHONG vao Drive" bash -c "[ $rc = 1 ] && [ ! -e '$drive/staging/$s2.dump.age' ]"
PULL_KEY="$tmp/stranger" pull; rc=$?
check "khoa la => thoat 1, log bao khong liet ke duoc" bash -c "[ $rc = 1 ] && grep -q 'Khong liet ke duoc' '$tmp/pull.out'"

echo "== 4. Tai khoan chi doc: khong ghi/xoa/doi ten, khong shell, khong ra ngoai =="
echo hi > "$tmp/up.txt"
check_not "sftp put bi tu choi" sftp_b "put $tmp/up.txt"
check_not "sftp rm bi tu choi" sftp_b "rm $s1.manifest"
check_not "sftp rename bi tu choi" sftp_b "rename $s1.manifest x.manifest"
check_not "sftp mkdir bi tu choi" sftp_b "mkdir x"
check "tep tren VPS van nguyen" test -f "$bdir/$s1.manifest"
check_not "sftp get /root bi tu choi" sftp_b "get /root/.bashrc $tmp/r"
check_not "sftp get $etc/backup-signing.key bi tu choi" sftp_b "get $etc/backup-signing.key $tmp/k"
check_not "sftp get .dump plaintext bi tu choi" sftp_b "get $sp.dump $tmp/p"
out="$(ssh -p 2222 -i "$tmp/client" -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$tmp/known_hosts" backup-pull@127.0.0.1 'id; echo PWNED' < /dev/null 2>&1)"
check_not "lenh SSH bi bo qua (khong shell)" bash -c "printf '%s' \"\$1\" | grep -Eq 'uid=|PWNED'" _ "$out"
timeout 15 ssh -p 2222 -i "$tmp/client" -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$tmp/known_hosts" \
  -o ExitOnForwardFailure=yes -N -R 127.0.0.1:2298:127.0.0.1:22 backup-pull@127.0.0.1 >/dev/null 2>&1; rc=$?
check "chuyen tiep cong (-R) bi tu choi ngay (ma 255, khong treo)" test "$rc" = 255

echo "== 5. --remove go sach =="
check "--remove thoat 0" bash "$lin/setup-backup-pull.sh" --remove
check_not "user backup-pull da xoa" id backup-pull
check_not "khong con ACL backup-pull tren thu muc" bash -c "getfacl -p '$bdir' 2>/dev/null | grep -q backup-pull"
check_not "/var/lib/backup-pull da xoa" test -e /var/lib/backup-pull
check_not "sftp sau --remove bi tu choi" sftp_b "ls"
check "thu muc sao luu + bo sao luu van nguyen" test -f "$bdir/$s1.dump.age"

echo
echo "Ket qua: $pass dat, $fail loi."
[ "$fail" -eq 0 ] || { echo "--- sshd.log ---"; tail -n 40 "$tmp/sshd.log"; }
[ "$fail" -eq 0 ]
