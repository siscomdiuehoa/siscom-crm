#!/usr/bin/env bash
# SISCOM CRM - kiem thu THAT (chi tren may CI dung mot lan, can root): setup-backup-pull.sh + sshd that (127.0.0.1:2222, cau hinh rieng,
# UsePAM no) + quyen tep that + pull-backups.ps1 chay bang pwsh. Khong cham PostgreSQL, khong cham sshd/ufw cua may.
#   sudo bash backend/scripts/linux/tests/e2e-backup-pull.sh
# Kiem: thu muc sao luu chinh van root 700 (backup-pull khong vao duoc); chi bo MA HOA HOAN CHINH duoc lien ket cung sang thu muc keo
# (ke ca bo tao SAU khi cai, nhu backup-db.sh); .dump/.partial/tep tam/tep la (umask 077 va 022) khong doc duoc; retention go lien ket;
# keo dung bo; khong ghi/xoa/doi ten; lenh SSH bi bo qua; khong doc /root, khoa ky; khoa la bi tu choi; --remove go sach.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Can root (sudo)."; exit 1; }
[ "$(uname -s)" = Linux ] || { echo "Chi chay tren Linux."; exit 1; }
for c in pwsh ssh sftp ssh-keygen ssh-keyscan /usr/sbin/sshd /usr/lib/openssh/sftp-server; do
  command -v "$c" >/dev/null 2>&1 || { echo "Thieu $c"; exit 1; }
done
id backup-pull >/dev/null 2>&1 && { echo "User backup-pull da co tren may nay - khong chay e2e."; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lin="$(cd "$here/.." && pwd)"
win="$(cd "$lin/../windows" && pwd)"
tmp="$(mktemp -d)"
bdir="/var/backups/siscom-crm-e2e-$$"; pdir="$bdir-pull"; etc="/etc/siscom-crm-e2e-$$"
export SISCOM_BACKUP_DIR="$bdir" SISCOM_PULL_DIR="$pdir" SISCOM_ETC="$etc"
sshd_pid=""
cleanup() {
  [ -n "$sshd_pid" ] && kill "$sshd_pid" 2>/dev/null
  id backup-pull >/dev/null 2>&1 && { pkill -u backup-pull 2>/dev/null; userdel backup-pull 2>/dev/null; }
  rm -rf "$tmp" "$bdir" "$pdir" "$etc" /var/lib/backup-pull "${other:-/var/backups/khong-co-e2e-other}"
}
trap cleanup EXIT
pass=0; fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
check()     { local n="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$n"; else bad "$n"; fi; }
check_not() { local n="$1"; shift; if "$@" >/dev/null 2>&1; then bad "$n"; else ok "$n"; fi; }
# shellcheck source=../lib.sh
. "$lin/lib.sh"

# --- Bo sao luu gia giong backup-db.sh (umask 077, redirect/mv trong thu muc, ky ssh-keygen -Y, roi backup_pull_sync) ---
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
    backup_pull_sync "$bdir" )   # nhu backup-db.sh: sau khi tao + tu kiem + retention
}
ts() { date -u -d "$1" +%Y%m%d_%H%M%S; }
install -d -m 700 "$bdir"
s1="siscom_crm_staging_$(ts '-3 hour')"; make_set "$s1"
sp="siscom_crm_staging_$(ts '-150 min')"; make_set "$sp" plain
check "chua cai backup-pull: backup_pull_sync khong tao thu muc keo" test ! -e "$pdir"

echo "== 1. setup-backup-pull.sh tren may that =="
ssh-keygen -q -t ed25519 -N '' -C 'may owner' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/stranger"
out="$(bash "$lin/setup-backup-pull.sh" --pubkey "$tmp/client.pub" 2>&1)"; rc=$?
printf '%s\n' "$out" | sed 's/^/    /'
check "setup thoat 0" test "$rc" = 0
check "chay lai (idempotent) thoat 0" bash "$lin/setup-backup-pull.sh" --pubkey "$tmp/client.pub"
check "PR235-SEC-01: thu muc sao luu chinh van root 700" test "$(stat -c '%U:%G %a' "$bdir")" = "root:root 700"
check_not "PR235-SEC-01: backup-pull KHONG vao duoc thu muc chinh" runuser -u backup-pull -- test -x "$bdir"
check "thu muc keo root:backup-pull 750" test "$(stat -c '%U:%G %a' "$pdir")" = "root:backup-pull 750"
for p in .dump.age .dump.age.sha256 .manifest .manifest.sig; do
  check "bo co san truoc setup: $p la lien ket cung, root:backup-pull 640, doc duoc" bash -c "[ '$pdir/$s1$p' -ef '$bdir/$s1$p' ] && [ \"\$(stat -c '%U:%G %a' '$pdir/$s1$p')\" = 'root:backup-pull 640' ] && runuser -u backup-pull -- test -r '$pdir/$s1$p'"
done
check "thu muc keo chi co 4 tep + dau nhan dien (khong co bo plaintext)" test "$(find "$pdir" -mindepth 1 -not -name .siscom-pull-dir | wc -l)" = 4
check "dau .siscom-pull-dir root:root 600, ghi dung thu muc sao luu" bash -c "[ \"\$(stat -c '%U:%G %a' '$pdir/.siscom-pull-dir')\" = 'root:root 600' ] && grep -qxF 'source=$bdir' '$pdir/.siscom-pull-dir'"
check_not "backup-pull KHONG doc duoc dau nhan dien" runuser -u backup-pull -- test -r "$pdir/.siscom-pull-dir"
check "tep plaintext van root 600" test "$(stat -c '%U:%G %a' "$bdir/$sp.dump")" = "root:root 600"
check "authorized_keys root:backup-pull 640, -d thu muc keo" bash -c "[ \"\$(stat -c '%U:%G %a' /var/lib/backup-pull/.ssh/authorized_keys)\" = 'root:backup-pull 640' ] && grep -qF -- '-R -d $pdir\"' /var/lib/backup-pull/.ssh/authorized_keys"
check "mat khau '*'" test "$(getent shadow backup-pull | cut -d: -f2)" = '*'
# Lan sao luu tiep theo (timer): bo MA HOA hoan tat => lien ket sang thu muc keo
s2="siscom_crm_staging_$(ts '-1 hour')"; make_set "$s2"
for p in .dump.age .dump.age.sha256 .manifest .manifest.sig; do check "bo moi hoan tat: backup-pull doc duoc $p" runuser -u backup-pull -- test -r "$pdir/$s2$p"; done
# PR235-R1-SEC-01: tep tao SAU setup (umask 077 va 022) va bo CHUA hoan tat khong bao gio doc duoc
s3="siscom_crm_staging_$(ts '-30 min')"; sx="siscom_crm_staging_$(ts '-20 min')"
( umask 077; for f in "$s3.dump" "$s3.dump.partial" "$s3.dump.age.partial" "$s3.manifest.partial" la.txt "$sx.dump.age" "$sx.manifest"; do echo x > "$bdir/$f"; done )
( umask 022; for f in "$s3.dump.sha256" la2.txt "$sx.dump.age.sha256"; do echo x > "$bdir/$f"; done )
check "backup_pull_sync van thoat 0" backup_pull_sync "$bdir"
for f in "$s3.dump" "$s3.dump.partial" "$s3.dump.age.partial" "$s3.manifest.partial" la.txt "$s3.dump.sha256" la2.txt "$sx.dump.age" "$sx.dump.age.sha256" "$sx.manifest"; do
  check_not "PR235-SEC-01: '$f' (tao sau setup) KHONG doc duoc" runuser -u backup-pull -- test -r "$bdir/$f"
  check_not "PR235-SEC-01: '$f' KHONG vao thu muc keo" test -e "$pdir/$f"
done
rm -f "$bdir/$sx".*
check "thu muc keo chi co 8 tep (2 bo hoan chinh) + dau" test "$(find "$pdir" -mindepth 1 -not -name .siscom-pull-dir | wc -l)" = 8
check "dau nhan dien khong bi dong bo go" test -f "$pdir/.siscom-pull-dir"
# tep la bi ai do dat vao thu muc keo => bi go o lan dong bo sau
echo x > "$pdir/la3.txt"; backup_pull_sync "$bdir"
check "tep la trong thu muc keo bi go" test ! -e "$pdir/la3.txt"

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
check "tep tren VPS van nguyen" bash -c "[ -f '$bdir/$s1.manifest' ] && [ -f '$pdir/$s1.manifest' ] && [ ! -e '$pdir/x' ]"
check_not "sftp get /root bi tu choi" sftp_b "get /root/.bashrc $tmp/r"
check_not "sftp get $etc/backup-signing.key bi tu choi" sftp_b "get $etc/backup-signing.key $tmp/k"
check_not "sftp get .dump plaintext (thu muc chinh) bi tu choi" sftp_b "get $bdir/$sp.dump $tmp/p"
check_not "sftp get tep umask 022 trong thu muc chinh bi tu choi" sftp_b "get $bdir/$s3.dump.sha256 $tmp/q"
check_not "sftp ls thu muc chinh bi tu choi" sftp_b "ls $bdir"
out="$(ssh -p 2222 -i "$tmp/client" -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$tmp/known_hosts" backup-pull@127.0.0.1 'id; echo PWNED' < /dev/null 2>&1)"
check_not "lenh SSH bi bo qua (khong shell)" bash -c "printf '%s' \"\$1\" | grep -Eq 'uid=|PWNED'" _ "$out"
timeout 15 ssh -p 2222 -i "$tmp/client" -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$tmp/known_hosts" \
  -o ExitOnForwardFailure=yes -N -R 127.0.0.1:2298:127.0.0.1:22 backup-pull@127.0.0.1 >/dev/null 2>&1; rc=$?
check "chuyen tiep cong (-R) bi tu choi ngay (ma 255, khong treo)" test "$rc" = 255

echo "== 4b. Retention xoa bo trong thu muc chinh => lien ket cung bi go =="
rm -f "$bdir/$s2".*; backup_pull_sync "$bdir"
check "bo da xoa khong con trong thu muc keo" bash -c "! ls '$pdir' | grep -q '$s2'"
check "bo con lai van con" test -f "$pdir/$s1.dump.age"

echo "== 4c. backup_pull_sync DUOI SANDBOX systemd (ProtectSystem=strict, ReadWritePaths nhu unit that) + thieu thu muc keo =="
s4="siscom_crm_staging_$(ts '-10 min')"; make_set "$s4"; rm -f "$pdir/$s4".*
check_not "truoc sync: bo $s4 chua co trong thu muc keo" test -e "$pdir/$s4.dump.age"
if [ -d /run/systemd/system ] && command -v systemd-run >/dev/null 2>&1; then
  # Lay ReadWritePaths tu unit THAT (khong tu viet lai); thu muc thu nam duoi /var/backups nen nam trong pham vi ghi duoc cua unit.
  unit="$lin/systemd/siscom-crm-backup.service"
  rw="$(sed -n 's/^ReadWritePaths=//p' "$unit")"
  sd_sync() { systemd-run --quiet --wait --collect --pipe -p ProtectSystem=strict -p PrivateTmp=true -p UMask=0077 -p "ReadWritePaths=$rw" \
    -p "ReadOnlyPaths=$etc" -E "SISCOM_BACKUP_DIR=$bdir" -E "SISCOM_PULL_DIR=$pdir" -E "SISCOM_ETC=$etc" \
    bash -c ". '$lin/lib.sh'; backup_pull_sync '$bdir'"; }
  case "$bdir$pdir" in "$rw"/*"$rw"/*) ok "thu muc thu nam duoi ReadWritePaths cua unit ($rw)" ;; *) bad "thu muc thu khong nam duoi $rw" ;; esac
  check "systemd-run: backup_pull_sync thoat 0 duoi ProtectSystem=strict" sd_sync
  for p in .dump.age .dump.age.sha256 .manifest .manifest.sig; do
    check "systemd-run: lien ket cung $p duoc tao trong thu muc keo, backup-pull doc duoc" bash -c "[ '$pdir/$s4$p' -ef '$bdir/$s4$p' ] && runuser -u backup-pull -- test -r '$pdir/$s4$p'"
  done
else
  bad "khong co systemd (PID 1) / systemd-run tren may nay - KHONG kiem duoc sandbox (CI ubuntu-24.04 phai co)"
fi
mv "$pdir" "$pdir.gone"
check_not "da cai backup-pull nhung THIEU thu muc keo => backup_pull_sync thoat != 0 (khong im lang)" backup_pull_sync "$bdir"
mv "$pdir.gone" "$pdir"
check "co lai thu muc keo => backup_pull_sync thoat 0" backup_pull_sync "$bdir"

echo "== 5. --remove go sach =="
check "--remove thoat 0" bash "$lin/setup-backup-pull.sh" --remove
check_not "user backup-pull da xoa" id backup-pull
check_not "thu muc keo da xoa" test -e "$pdir"
check "tep sao luu tra ve root:root 600" test "$(stat -c '%U:%G %a' "$bdir/$s1.manifest.sig")" = "root:root 600"
check_not "/var/lib/backup-pull da xoa" test -e /var/lib/backup-pull
check_not "sftp sau --remove bi tu choi" sftp_b "ls"
check "thu muc sao luu + bo sao luu van nguyen" test -f "$bdir/$s1.dump.age"

echo "== 6. Thu muc keo CO SAN khong do script tao => tu choi, khong xoa/doi gi (cau hinh nham SISCOM_PULL_DIR) =="
other="/var/backups/siscom-crm-e2e-other-$$"
mkdir -p "$other/sub"; echo keep > "$other/app.txt"; echo keep > "$other/sub/deep.txt"; chmod 711 "$other"
before="$(stat -c '%U:%G %a' "$other")"
check_not "cai vao thu muc co noi dung la => tu choi" env SISCOM_PULL_DIR="$other" bash "$lin/setup-backup-pull.sh" --pubkey "$tmp/client.pub"
check_not "go (--remove) thu muc co noi dung la => tu choi" env SISCOM_PULL_DIR="$other" bash "$lin/setup-backup-pull.sh" --remove
check "thu muc la con nguyen noi dung" bash -c "[ \"\$(cat '$other/app.txt')\" = keep ] && [ \"\$(cat '$other/sub/deep.txt')\" = keep ]"
check "thu muc la KHONG bi doi chu/quyen" test "$(stat -c '%U:%G %a' "$other")" = "$before"
check_not "tu choi xay ra truoc khi tao user backup-pull" id backup-pull
printf 'siscom-pull-dir v1\nsource=/var/backups/mot-noi-khac\n' > "$other/.siscom-pull-dir"
check_not "dau nhan dien KHAC thu muc sao luu => tu choi" env SISCOM_PULL_DIR="$other" bash "$lin/setup-backup-pull.sh" --pubkey "$tmp/client.pub"
check "thu muc co dau khac van con nguyen" test -f "$other/app.txt"
rm -rf "$other"
mkdir -p "$other"
check "thu muc co san nhung RONG => nhan, ghi dau" env SISCOM_PULL_DIR="$other" bash "$lin/setup-backup-pull.sh" --pubkey "$tmp/client.pub"
check "dau ghi dung" grep -qxF "source=$bdir" "$other/.siscom-pull-dir"
mkdir "$other/la"
check_not "--remove: gap muc la (thu muc con) => dung, KHONG rm -rf" env SISCOM_PULL_DIR="$other" bash "$lin/setup-backup-pull.sh" --remove
check "thu muc con la van con" test -d "$other/la"
rmdir "$other/la"
check "--remove thu muc keo dung dau => thoat 0" env SISCOM_PULL_DIR="$other" bash "$lin/setup-backup-pull.sh" --remove
check_not "thu muc keo thu 2 da go (rmdir)" test -e "$other"
rm -rf "$other"

echo "== 6b. --remove KHONG xoa home/tai khoan khong do script tao =="
check_not "user backup-pull da go het (diem xuat phat)" id backup-pull
check_not "home da go het (diem xuat phat)" test -e /var/lib/backup-pull
check "--remove khi CHUA TUNG cai => thoat 0, khong loi" bash "$lin/setup-backup-pull.sh" --remove
mkdir -p /var/lib/backup-pull; echo keep > /var/lib/backup-pull/du-lieu-la
check_not "--remove: home co du lieu la (chua co user) => tu choi" bash "$lin/setup-backup-pull.sh" --remove
check "du lieu la trong home con nguyen" test "$(cat /var/lib/backup-pull/du-lieu-la)" = keep
rm -rf /var/lib/backup-pull
useradd --system --no-create-home --home-dir /srv/khac-e2e --shell /usr/sbin/nologin backup-pull
check_not "--remove: user backup-pull cua NOI KHAC (home khac) => tu choi" bash "$lin/setup-backup-pull.sh" --remove
check "user cua noi khac van con" id backup-pull
userdel backup-pull

echo
echo "Ket qua: $pass dat, $fail loi."
[ "$fail" -eq 0 ] || { echo "--- sshd.log ---"; tail -n 40 "$tmp/sshd.log"; }
[ "$fail" -eq 0 ]
