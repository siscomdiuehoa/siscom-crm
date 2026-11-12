# VPS_RUNBOOK — Dựng SISCOM CRM trên VPS Ubuntu 24.04 (bước V2 của kế hoạch VPS)

| Mục | Giá trị |
|---|---|
| Trạng thái | **`provision.sh` @`c7e74fa` ĐÃ CHẠY THẬT trên VPS 42.96.15.235 (12/11/2026, Owner duyệt, phiên điều phối chạy): 12/12 bước đạt, Let's Encrypt đã cấp chứng chỉ cho IP (mục 11).** Chưa chạy trên VPS: `--ssh-key-only`, `create-db.sh`, `deploy.sh`, `run-cli.sh`, sao lưu/khôi phục, timer sao lưu, tự gia hạn chứng chỉ. Phần SQL/vận hành đã diễn tập trên PostgreSQL tạm (Windows và job CI `linux-scripts` Ubuntu 24.04). Xem mục 9 |
| Sửa sau review R1 | F1 manifest sao lưu được **ký** và ràng buộc vào file; F2 cổng SSH **đọc từ `sshd -T`** (VPS thật 26266) và mở đúng cổng đó trước khi bật ufw; F3 kiểm argon2/Prisma trên bản build + job CI Linux; `deploy.sh` dọn bản phát hành dở dang khi dừng (mục 10) |
| Máy đích | BKNS Cloud VM, Ubuntu 24.04, 3 vCPU / 3 GB RAM / 40 GB (hạn dịch vụ 11/11/2027) |
| Nền thiết kế | `docs/B1.4_VPS_DEPLOY_PLAN.md` (PR #176), `docs/B1.5_VPS_STAGING_PLAN.md`, `backend/docs/VPS_LINUX_NOTES.md`, `backend/docs/B1.4_P4_LINUX_SCRIPTS_DESIGN.md` (nhánh `docs/b1.4-p4-linux-scripts-design`) |
| Mã nguồn | `backend/scripts/linux/` |
| Không làm trong PR này | Không tạo tag `v0.1.0`, không merge, không chạm VPS, không đổi mã TypeScript. CI: chỉ **thêm** job `linux-scripts` (Owner giao ở F3), không đổi job cũ |

## 1. Bố cục trên VPS

```
/etc/siscom-crm/            root:root 700
  db-roles.env              600  mật khẩu 3 role (sinh bởi create-db.sh, không in ra)
  backend.env               600  env của dịch vụ (DATABASE_URL=siscom_app, AUTH_DATABASE_URL=siscom_auth, CORS...)
  migrate.env               600  MIGRATE_DATABASE_URL=siscom_migrator — KHÔNG nằm trong env của dịch vụ
  caddy.env                 600  SISCOM_HOST, SISCOM_ACME_CA
/etc/caddy/siscom-tls.caddy    644  một trong caddy/tls-domain.caddy, tls-ip-shortlived.caddy, tls-ip-internal.caddy (provision.sh chọn)
  backup.age-recipients     644  khoá CÔNG KHAI age của Owner (khoá riêng không bao giờ lên VPS)
  backup-signing.key        600  khoá RIÊNG ed25519 ký manifest sao lưu (sinh trên VPS bằng backup-db.sh --init-signing-key)
  backup-signing.allowed_signers  644  khoá công khai tương ứng (Owner chép 1 bản ra ngoài VPS)
/opt/siscom-crm/
  repo/                     clone git (chỉ cần nếu dùng deploy.sh --tag)
  releases/<id>/{backend,web}   mỗi bản phát hành (root:root, người khác chỉ đọc)
  current -> releases/<id>  liên kết nguyên tử; previous = id bản trước
/var/backups/siscom-crm/    root 700  *.dump.age, .manifest, .manifest.sig (xác thực), .sha256 (chỉ kiểm lỗi chép, không xác thực)
/var/log/siscom-crm/export-gap/   user siscom 0700 (EXPORT_GAP_LOG_DIR — bắt buộc ở production, FV-4A)
```

Ba role (cấp cluster, dùng chung giữa staging và prod trên cùng VPS): `siscom_migrator` (chủ sở hữu, DDL, migrate, sao lưu), `siscom_app` (DML tối thiểu), `siscom_auth` (pool xác thực). Dịch vụ chạy bằng user hệ thống `siscom` (không shell, không sudo, không sở hữu mã của chính nó).

## 2. Việc Owner cần có trước (V0)

1. VPS đang **bật**, quyền root bằng mật khẩu (không gửi qua chat) và khoá SSH công khai của Claude đã dán vào `/root/.ssh/authorized_keys` — hoặc Owner tự chạy các lệnh dưới đây.
2. **Host (`SISCOM_HOST`, bắt buộc)** — không có chế độ HTTP thuần (backend production bắt buộc `COOKIE_SECURE=true`: cookie `Secure` không lưu qua http và mật khẩu sẽ đi dạng rõ).
   - **Quyết định Owner 12/11: lần dựng staging đầu tiên dùng IP `42.96.15.235` (MẶC ĐỊNH); tên miền bổ sung sau** (DNS `siscom.io.vn` do AZDIGI quản lý, chưa thêm được bản ghi). Script hỗ trợ cả hai, không cần sửa khi đổi.
   - **Khi có tên miền** (phương án sau) của công ty `siscom.io.vn` (DNS do AZDIGI quản lý, không có bản ghi CAA): staging `crm-staging.siscom.io.vn`, production `crm.siscom.io.vn`. Tạo **bản ghi A** cho từng tên trỏ về `42.96.15.235`. **Không đụng bản ghi gốc `siscom.io.vn`** (website + mail công ty ở máy chủ khác). Chứng chỉ Let's Encrypt thường (90 ngày), Caddy tự gia hạn.
   - **Kiểm DNS trước** (script tự kiểm, dừng nếu sai — tránh xin chứng chỉ khi DNS chưa trỏ và dính giới hạn của Let's Encrypt): `dig +short crm-staging.siscom.io.vn` phải ra **duy nhất** `42.96.15.235` (không có `dig` thì `getent ahostsv4 <host>`). IP công khai của máy lấy từ `SISCOM_PUBLIC_IP` hoặc địa chỉ nguồn của tuyến ra Internet (`ip -4 route get 1.1.1.1`).
   - **IPv4 (mặc định cho lần dựng đầu)** `SISCOM_HOST=42.96.15.235` — Let's Encrypt cấp chứng chỉ cho IP chỉ với profile `shortlived` (bảng profile của Let's Encrypt: hiệu lực 160 giờ ≈ 6 ngày, loại định danh "DNS, IP"), xác thực HTTP-01/TLS-ALPN-01 nên cổng 80/443 phải mở và IP phải là của chính máy. Caddyfile dùng `tls { issuer acme … { profile shortlived } }`: subdirective `profile` có trong tài liệu `tls` của Caddy (ghi "EXPERIMENTAL"), cần Caddy ≥ 2.10 (script kiểm, cũ hơn thì dừng; < 2.11 thì cảnh báo). Lỗi xin chứng chỉ IP với Let's Encrypt (caddyserver/caddy#7399, thông báo "cannot have public IP certificate") đã được đóng/sửa sau 2.10.0; **chưa xác định chính xác bản chứa bản sửa** ⇒ dùng Caddy mới nhất. **Đã kiểm trên VPS 12/11: Caddy 2.11.9 + Let's Encrypt cấp chứng chỉ IP thành công (mục 11); tự gia hạn chưa kiểm.**
   - **Dự phòng (không mặc định):** `SISCOM_TLS_MODE=internal` (chỉ với IPv4) ⇒ `tls internal`, chứng chỉ do CA nội bộ của Caddy ký; phải cài CA gốc (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`) lên **từng** máy/điện thoại, và vì có HSTS nên trình duyệt không cho bỏ qua cảnh báo.
   - **Đổi host sau này** (vd từ IP sang tên miền, hoặc staging → production): không sửa script — chạy lại `SISCOM_HOST=<host mới> bash provision.sh` (ghi lại `caddy.env` + tệp TLS) và `SISCOM_HOST=<host mới> bash create-db.sh <db> env` (CORS/`AUTH_ALLOWED_ORIGINS` = `https://<host mới>`), rồi `systemctl restart siscom-crm-backend`. Cookie gắn với origin cũ ⇒ **mọi người phải đăng nhập lại** trên địa chỉ mới; ghi nhớ đăng nhập (Remember Me) ở origin cũ không dùng được.

**Hiện trạng VPS (Owner kiểm chỉ-đọc 12/11/2026, Claude phiên này không chạm VPS):** Ubuntu 24.04.5, 3 vCPU, 2,9 GB RAM, **chưa có swap**, ufw **tắt**, 38 GB ổ; sshd `Port 26266`, `PermitRootLogin yes`, `PasswordAuthentication yes` (dòng 57/79/83 của `/etc/ssh/sshd_config`); `eth0` do systemd-networkd quản lý (IP tĩnh cloud-init, có cài NetworkManager); đã gỡ desktop/xrdp; chưa có Node, PostgreSQL, Caddy.

**cloud-init của BKNS:** đĩa seed NoCloud được gắn lại mỗi lần boot ⇒ cloud-init coi là **máy mới**: tạo lại khoá host SSH và **đặt lại mật khẩu root** (`chpasswd`). `provision.sh` tạo (idempotent) `/etc/cloud/cloud.cfg.d/99-siscom-keep-ssh-hostkeys.cfg` với `ssh_deletekeys: false` để giữ khoá host (Owner đã tạo tay tệp này). Seed **không** đặt `ssh_pwauth` nên không đè cấu hình sshd. Việc **đặt lại mật khẩu root mỗi lần boot chưa được chặn**: sau khi bật `--ssh-key-only` thì mật khẩu root không còn dùng được qua SSH, nhưng vẫn dùng được ở console của nhà cung cấp — Owner quyết có tắt module `chpasswd`/`set-passwords` của cloud-init hay không (chưa làm trong PR này).
3. **Khoá age của Owner** (trên máy Owner, không phải VPS): `age-keygen -o siscom-backup.key`, giữ file `.key` ở nơi an toàn; dòng `Public key: age1…` là thứ dán lên VPS. **Mất khoá riêng = mất khả năng đọc mọi bản sao lưu.**
4. Nơi lưu bản sao ngoài VPS (Q9 của B1.4) và ai chép — chưa có script chép ra ngoài trong PR này.
5. Tag phát hành (`v0.1.0`) do Owner duyệt riêng sau khi PR này merge; trước đó dùng `deploy.sh --src` với thư mục xuất từ commit đã review (mục 4).

## 3. Thứ tự chạy và tiêu chí PASS

Mọi lệnh bằng `root` (hoặc `sudo`). Đưa **cả cây `backend/`** của đúng commit đã review lên VPS — **không** chép riêng `backend/scripts/linux/`: `create-db.sh` cần các file SQL trong `backend/docs/` (thiếu thì script dừng, báo rõ) và `deploy.sh --src` cần `backend/package.json`. Trên máy Windows (tắt chuyển CRLF; SSH của VPS ở cổng **26266**):

```bash
git -c core.autocrlf=false archive --format=tar.gz -o siscom-src.tar.gz <commit> backend
scp -P 26266 siscom-src.tar.gz root@42.96.15.235:/root/
# trên VPS:
mkdir -p /root/siscom-src && tar -xzf /root/siscom-src.tar.gz -C /root/siscom-src && cd /root/siscom-src/backend/scripts/linux
```

Các lệnh dưới đây chạy trong `/root/siscom-src/backend/scripts/linux` (gọi tắt "thư mục script").

### G1 — Máy chủ nền (`provision.sh`)

```bash
# thử trước, không đổi gì:
SISCOM_HOST=42.96.15.235 bash provision.sh --dry-run
# chạy thật (thêm SISCOM_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory để thử chứng chỉ không tính hạn mức):
SISCOM_HOST=42.96.15.235 bash provision.sh
```

Làm: apt cập nhật, UTC + `systemd-timesyncd`, swap 2 GB (`/swapfile`, `swappiness=10`), `ufw` mặc định chặn vào và chỉ mở **cổng SSH đang dùng** (đọc từ `sshd -T`, VPS thật là 26266) + 80 + 443, fail2ban cho SSH cùng cổng, unattended-upgrades (**không** tự khởi động lại), Node 24 (NodeSource), PostgreSQL 18 (PGDG, `listen_addresses='localhost'`, `timezone='UTC'`, kiểm `pg_hba` chỉ loopback), Caddy, user `siscom`, journald `SystemMaxUse=500M`, cài 3 unit systemd và `Caddyfile`.

**PASS khi**: `ufw status` chỉ có cổng SSH đang dùng (26266), 80, 443 — script tự kiểm sau khi bật, thiếu cổng SSH thì tự tắt lại ufw và dừng; `timedatectl` = UTC và đồng bộ; `free -m` có Swap 2 GB; `node -v` là 24.x (≥ 24.11); `ss -ltn | grep 5432` chỉ `127.0.0.1`/`[::1]`; `sudo -u postgres psql -tAc 'SHOW TimeZone'` = `UTC`; `id siscom` có và không thuộc nhóm `sudo`/`admin`.
**Cổng SSH (F2):** script **không đổi** cổng của `sshd`. Trước mọi thay đổi, nó đọc cổng đang dùng bằng `sshd -T` (gộp cả cổng `ssh.socket` nếu đang chạy; nhiều cổng thì lấy tất cả), đọc lại ngay trước khi bật ufw, **mở các cổng đó trước** rồi mới đặt `deny` mặc định và `ufw --force enable`, sau đó kiểm `ufw status` còn `<cổng>/tcp ALLOW`. Thiếu ⇒ `ufw --force disable` và dừng. fail2ban dùng cùng cổng.
**FAIL / dừng ngay** (trước khi đổi gì): thiếu/sai `SISCOM_HOST`; tên miền mà bản ghi A không phải **duy nhất** IP công khai của máy; IPv4 không phải IP của chính máy; không xác định được IP công khai (đặt `SISCOM_PUBLIC_IP`); `SISCOM_TLS_MODE=internal` với tên miền; `sshd -T` lỗi hoặc không có cổng hợp lệ (vd không chạy bằng root; script in dòng lỗi của `sshd -T` — gặp `Missing privilege separation directory: /run/sshd` thì chạy từ phiên SSH đang mở hoặc sau `systemctl start ssh`); `SISCOM_SSH_PORT` được đặt nhưng không trùng cổng đang nghe.
**SSH chỉ bằng khoá** — cờ **riêng** `--ssh-key-only`, chỉ chạy khi Owner duyệt và **đã thử đăng nhập bằng khoá ở phiên MỚI** (cổng 26266):

```bash
SISCOM_HOST=42.96.15.235 bash provision.sh --dry-run --ssh-key-only   # xem trước
SISCOM_HOST=42.96.15.235 bash provision.sh --ssh-key-only
```

Ghi drop-in `/etc/ssh/sshd_config.d/00-siscom-ssh-key-only.conf` (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password`); tên `00-` để đứng trước mọi drop-in khác (vd `50-cloud-init.conf`) vì OpenSSH lấy **giá trị đầu tiên**. Từ chối nếu: tài khoản đang đăng nhập (`$SUDO_USER`, mặc định `root`) chưa có ≥ 1 khoá **hợp lệ** (`ssh-keygen -l` đọc được) trong `~/.ssh/authorized_keys`; `AuthorizedKeysFile` không gồm `.ssh/authorized_keys`; dòng `Include /etc/ssh/sshd_config.d/*.conf` không đứng **trước** các dòng xác thực/`Match` của `/etc/ssh/sshd_config` (trên VPS các dòng 57/79/83 chỉ bị drop-in đè khi `Include` ở đầu file — Ubuntu mặc định như vậy, script vẫn kiểm). Sau khi ghi: `sshd -t`, rồi `sshd -T` phải thể hiện `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin prohibit-password`; sai ⇒ gỡ drop-in, **không** nạp lại sshd. Đạt ⇒ `systemctl reload-or-restart ssh`. **Lùi**: `rm /etc/ssh/sshd_config.d/00-siscom-ssh-key-only.conf && systemctl reload-or-restart ssh` (ở phiên SSH còn mở hoặc console nhà cung cấp).
**Lùi**: VPS chưa có dữ liệu — dựng lại máy từ trang quản lý nhà cung cấp.

### G2 — Database staging (`create-db.sh`)

```bash
cd /root/siscom-src/backend/scripts/linux
bash create-db.sh siscom_crm_staging create      # 3 role + DB mới + tách role S1 + role auth
SISCOM_HOST=42.96.15.235 bash create-db.sh siscom_crm_staging env   # ghi backend.env + migrate.env
```

**PASS khi**: script in `Tách role xong: owner=siscom_migrator, app+auth CONNECT, PUBLIC không có quyền`; tạo lại cùng tên bị `TỪ CHỐI`; tên khác `siscom_crm_staging|siscom_crm_prod` (kể cả `siscom_crm_dev`, tên `siscom_crm_test_*`, baseline) bị từ chối ngay.
**Lùi**: `bash create-db.sh siscom_crm_staging drop --yes-drop siscom_crm_staging` (chỉ khi chưa có dữ liệu thật; prod cần thêm `SISCOM_ALLOW_DROP_PROD=siscom_crm_prod`).

### G3 — Backend (lần triển khai đầu)

Frontend build trên **máy Windows** (VPS 3 GB không build giao diện), bằng PowerShell:

```powershell
cd frontend\siscom-crm-web
npm ci
$env:VITE_CRM_AUTH_ENABLED='true'; $env:VITE_CRM_API_ENABLED='true'; $env:VITE_CRM_API_BASE='/api/v1'
npm run build            # ra thư mục dist\ ; build bằng PowerShell, không dùng Git Bash (làm hỏng đường dẫn /api/v1)
scp -P 26266 -r dist root@42.96.15.235:/root/siscom-web-dist
```

Trên VPS, lần đầu (DB còn rỗng nên có `--migrate`; chưa có tag `v0.1.0` nên dùng `--src` với cây vừa giải nén):

```bash
cd /root/siscom-src/backend/scripts/linux
bash deploy.sh --src /root/siscom-src --frontend /root/siscom-web-dist --migrate --dry-run   # xem kế hoạch
bash deploy.sh --src /root/siscom-src --frontend /root/siscom-web-dist --migrate
# (sau khi Owner duyệt tạo tag trên main: bash deploy.sh --tag v0.1.0 ... — cần clone /opt/siscom-crm/repo + deploy key)
bash /opt/siscom-crm/current/backend/scripts/linux/run-cli.sh seed-lookups        # danh mục D3 (57 mục)
# 5 mật khẩu bootstrap do Owner tự gõ, KHÔNG ghi file/chat (trong shell root):
for k in SYSADMIN ADMIN SALE TECHNICIAN ACCOUNTANT; do read -rsp "BOOTSTRAP_PASSWORD_$k: " v; export "BOOTSTRAP_PASSWORD_$k=$v"; echo; done
export BOOTSTRAP_EMAIL_DOMAIN=<tên-miền-email-công-ty>
bash /opt/siscom-crm/current/backend/scripts/linux/run-cli.sh bootstrap-auth
unset BOOTSTRAP_PASSWORD_{SYSADMIN,ADMIN,SALE,TECHNICIAN,ACCOUNTANT} v
```

**Lưu ý cho VPS này trước khi chạy G2–G3:**
- Thứ tự: `create-db.sh … create` → `create-db.sh … env` (cần `SISCOM_HOST=42.96.15.235` ⇒ origin `https://42.96.15.235`) → `deploy.sh --src … --frontend … --migrate` (DB rỗng: tự bỏ qua sao lưu, migrate bằng `siscom_migrator`, rồi `grants` + VERIFY) → `run-cli.sh seed-lookups` → `run-cli.sh bootstrap-auth`.
- `run-cli.sh` dùng bản đã triển khai (`/opt/siscom-crm/current/…`), không phải thư mục giải nén.
- **Trước lần deploy THỨ HAI**: DB đã có dữ liệu nên `deploy.sh` **bắt buộc** sao lưu thành công ⇒ phải có `backup-db.sh --init-signing-key` và `/etc/siscom-crm/backup.age-recipients` (khoá công khai age của Owner) trước, nếu không deploy sẽ dừng ở bước sao lưu (đúng thiết kế, không đổi gì).
- Build backend chạy trên VPS (2,9 GB RAM + swap 2 GB; `NODE_OPTIONS=--max-old-space-size=1536`) và cần mạng ra npm registry. Frontend build trên Windows.
- `--tag` cần `/opt/siscom-crm/repo` (git clone; kho riêng tư cần deploy key do Owner cấp) và chỉ nhận tag dạng `vX.Y.Z[-hậu-tố]` **thuộc lịch sử `origin/main`**.

Nếu chưa có tag, dùng `--src <thư mục có backend/>` (vd giải nén `git archive <commit đã review> backend`) thay `--tag`. `--tag` cần `/opt/siscom-crm/repo` (git clone; kho riêng tư cần deploy key do Owner cấp) và chỉ nhận tag dạng `vX.Y.Z[-hậu-tố]` **thuộc lịch sử `origin/main`**.

`deploy.sh` làm: kiểm đầu vào → tạo `releases/<id>` → `npm ci --ignore-scripts` → `npm run build` (với `DATABASE_URL` giả, không `MIGRATE`) → **kiểm argon2 hash/verify + Prisma CLI trên chính bản build** (F3; lỗi thì dừng, không đổi gì) → chép web → **sao lưu bắt buộc** (bỏ qua nếu DB mới tinh) → `prisma migrate status`; có migration chờ mà không `--migrate` thì **dừng không đổi gì** → `migrate deploy` + `create-db.sh grants` (APP_GRANTS_V4 hai lần, VERIFY, VERIFY_AUTH) → đổi liên kết `current` nguyên tử → `systemctl restart` → kiểm `/api/v1/health` và `/health/database` (`database:up`, `migrated:true`) trong 30 giây. Không đạt: in hướng dẫn lùi (hoặc tự lùi với `--auto-rollback`). Dừng ở **bất kỳ** bước nào trước khi đổi liên kết (kể cả sao lưu lỗi, có migration chờ mà thiếu `--migrate`, smoke F3 lỗi) ⇒ thư mục `releases/<id>` dở dang bị xoá, bản đang chạy không bị đụng.

Vì sao `--ignore-scripts` (F3): chỉ 3 gói production có lifecycle script — `argon2` (`node-gyp-build`: chỉ biên dịch khi **không** có prebuild; gói đã kèm `prebuilds/linux-x64/argon2.glibc.node`, N-API), `prisma` và `@prisma/engines` (postinstall). Bỏ cờ này nghĩa là chạy script của bên thứ ba bằng **root** lúc deploy. Thay vào đó `deploy.sh` kiểm thật: hash + verify (đúng/sai) bằng argon2 và `prisma --version`; job CI `linux-scripts` làm đúng quy trình này trên Ubuntu 24.04 rồi khởi động backend production và đăng nhập thật (sai mật khẩu 401, đúng 200, cookie `Secure`).

**PASS khi**: `systemctl is-active siscom-crm-backend` = active; `curl -s http://127.0.0.1:3000/api/v1/health/database` có `"migrated":true`, `leastPrivilege:true`, `authPool:"separate"`, `authLeastPrivilege:true`; `prisma migrate status` không còn migration chờ; `journalctl -u siscom-crm-backend -n 50` không lỗi; `create-db.sh … grants` in `PASS|73` (VERIFY) và `PASS|33` (VERIFY_AUTH); file `/var/log/siscom-crm/export-gap/export-audit-gap-<ngày>.jsonl` có dòng `"event":"startup"`; `ss -ltn | grep 3000` chỉ `127.0.0.1`.
**Lùi**: `deploy.sh --rollback` (về bản trước) hoặc `systemctl stop siscom-crm-backend`; DB mới tinh thì drop và làm lại G2–G3.

### G4 — HTTPS (Caddy)

Caddy đã cấu hình trong G1 theo `SISCOM_HOST`. Sau `systemctl restart caddy`, `provision.sh` **chờ tối đa 180 giây** cho tới khi `https://<host>/` bắt tay TLS được **không `-k`** (bất kỳ mã HTTP nào cũng tính là đạt vì backend có thể chưa triển khai). Không đạt ⇒ in log Caddy liên quan và **dừng**, **không** chuyển sang HTTP.

**Thứ tự thử chứng chỉ khi host là IP (lần dựng đầu):**
1. Let's Encrypt cho IP, profile `shortlived` (mặc định, `SISCOM_TLS_MODE` không đặt). Caddy < 2.10 ⇒ script dừng trước khi ghi cấu hình; Let's Encrypt/Caddy từ chối ⇒ script dừng sau 180 giây, kèm log.
2. Chỉ khi Owner đồng ý: `SISCOM_TLS_MODE=internal SISCOM_HOST=42.96.15.235 bash provision.sh` ⇒ chứng chỉ tự ký bởi CA nội bộ của Caddy. **Trình duyệt và điện thoại sẽ báo không tin cậy** cho tới khi cài `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` lên **từng** thiết bị (vì có HSTS nên không bỏ qua cảnh báo được). Script tự kiểm bằng `--cacert` của CA đó, không dùng `-k`.
3. Không bao giờ dùng HTTP thuần.

**Lệnh kiểm (chạy trên VPS, chỉ đọc):**

```bash
caddy version                                                     # chế độ IP cần >= 2.10; nên dùng bản mới nhất (#7399)
curl -sS -o /dev/null -w '%{http_code}\n' https://42.96.15.235/    # KHÔNG -k; lỗi chứng chỉ => curl thoát khác 0
echo | openssl s_client -connect 42.96.15.235:443 2>/dev/null | openssl x509 -noout -issuer -enddate   # bên cấp + ngày hết hạn
bash check-tls.sh                                                 # gộp các kiểm trên; thoát 1 nếu còn < 2 ngày (IP) / < 14 ngày (tên miền)
journalctl -u caddy --since '-2 days' --no-pager | grep -iE 'renew|obtain|error'   # lịch sử gia hạn
```

**Gia hạn thủ công** (chỉ khi Caddy không tự gia hạn được và chứng chỉ sắp hết; mỗi lần là một lần xin chứng chỉ mới, chú ý giới hạn của Let's Encrypt): (1) `systemctl reload caddy` — Caddy kiểm lại và gia hạn chứng chỉ đã tới hạn; (2) nếu vẫn không được: dừng Caddy, chuyển (không xoá) thư mục chứng chỉ của host trong `/var/lib/caddy/.local/share/caddy/certificates/<thư-mục-CA>/<host>/` ra chỗ khác, `systemctl start caddy` để xin lại, rồi `check-tls.sh`. Lỗi lặp lại với IP ⇒ cập nhật Caddy, hoặc (Owner duyệt) chuyển sang `SISCOM_TLS_MODE=internal`.

Kiểm thêm: `curl -I https://<host>/` (200, `strict-transport-security`, `x-content-type-options`); `curl -I http://<host>/` chuyển 308 sang HTTPS; cookie đăng nhập có `Secure`; `bash check-tls.sh` (đọc host từ `caddy.env`).
**PASS khi**: `curl https://<host>/` **không dùng `-k`** bắt tay TLS được (sau G3: `curl -fsS https://<host>/api/v1/health` cũng đạt) (chứng chỉ được tin sẵn); `check-tls.sh` in "TLS OK", cấp bởi Let's Encrypt (không còn staging CA nếu đã thử); trang đăng nhập mở được trên Chrome và iPhone thật; quét cổng từ ngoài (`nmap -Pn -p- 42.96.15.235`) chỉ thấy cổng SSH (26266), 80, 443.
**Gia hạn**: Caddy tự gia hạn (khoảng khi còn 1/3 thời hạn). Kiểm: `check-tls.sh` (thoát 1 khi chứng chỉ còn **< 14 ngày** với tên miền, **< 2 ngày** với IP — vì chứng chỉ IP chỉ ~6 ngày), `journalctl -u caddy --since '-2 days' | grep -iE 'renew|obtain|error'`. Nên cho `check-tls.sh` chạy hằng ngày và gửi cảnh báo (chưa cài sẵn — cần Owner chọn kênh cảnh báo).
**FAIL khi**: `curl` không `-k` báo lỗi chứng chỉ; `check-tls.sh` thoát 1; log Caddy có lỗi `obtain`/`renew` lặp lại (với IP: nghi #7399 ⇒ cập nhật Caddy, hoặc tạm dùng `SISCOM_TLS_MODE=internal`).
**Lùi**: `systemctl stop caddy` (không ảnh hưởng DB).

### G5 — Nghiệm thu (Owner/Claude, có bằng chứng)

Theo B1.4 §5 G5: đăng nhập 4–5 tài khoản, đổi mật khẩu lần đầu, kiểm vai trò, CSRF thiếu token = 403, giới hạn đăng nhập theo IP thật (hai máy khác nhau). Kết quả ghi vào `docs/B1.4_VPS_ACCEPTANCE.md` (PR riêng).

### G6 — Sao lưu và khôi phục thử

```bash
# 1) khoá công khai age của Owner lên VPS (dán đúng dòng age1...):
echo 'age1…' > /etc/siscom-crm/backup.age-recipients
# 2) khoá KÝ manifest (một lần; F1). In ra khoá CÔNG KHAI: Owner chép dòng đó ra ngoài VPS, cất cùng khoá riêng age:
bash backup-db.sh --init-signing-key
# 3) sao lưu tay lần đầu + bật timer 02:00 giờ VN (19:00 UTC):
systemctl start siscom-crm-backup.service && journalctl -u siscom-crm-backup -n 20 --no-pager
systemctl enable --now siscom-crm-backup.timer && systemctl list-timers siscom-crm-backup.timer
# 4) khôi phục thử (Owner chép khoá riêng age lên TẠM, dùng xong xoá):
bash restore-test.sh --identity /root/siscom-backup.key
shred -u /root/siscom-backup.key
# Kiểm một bản đã chép RA NGOÀI VPS (trên máy có ssh-keygen), dùng allowed_signers Owner giữ:
#   ssh-keygen -Y verify -f allowed_signers -I siscom-crm-backup -n siscom-crm-backup -s <stem>.manifest.sig < <stem>.manifest
#   rồi so `file_sha256` trong manifest với `sha256sum <stem>.dump.age`.
```

`backup-db.sh`: `pg_dump -Fc` bằng `siscom_migrator` trên **ảnh chụp nhất quán** (`--snapshot`; số dòng từng bảng trong `.manifest` đếm cùng ảnh chụp) → kiểm `pg_restore -l` → mã hoá age → ghi `file`, `file_sha256` vào manifest → **ký manifest** (`ssh-keygen -Y sign`, ed25519, namespace `siscom-crm-backup`) → tự kiểm chữ ký → giữ **14 bản mới nhất + mỗi tuần 1 bản (8 tuần)**, chỉ xoá file đúng mẫu tên của DB đó trong thư mục sao lưu. Từ chối nếu thiếu khoá ký, thiếu khoá age (trừ khi tự đặt `SISCOM_BACKUP_NO_ENCRYPT=yes`), ổ còn < 1 GB, hoặc tài khoản là `postgres`. Lỗi ở bất kỳ bước nào ⇒ không để lại bộ sao lưu dở dang/chưa ký.
`restore-test.sh`: **xác thực trước** (chữ ký manifest bằng `allowed_signers`; `db` = DB mong đợi; `file` = đúng tên file; `file_sha256` = SHA-256 thật) — sai bất kỳ điểm nào ⇒ dừng, **chưa tạo DB thử** → giải mã → SHA-256 bản rõ phải khớp manifest đã ký → tạo DB `siscom_crm_restore_<UTC>` → `pg_restore` → so **số dòng từng bảng** và **tập bảng** với manifest + `_prisma_migrations` → ghi `<dump>.restore-ok.txt`; **không tự xoá** DB thử (in lệnh `DROP`). Không còn nhánh "thiếu manifest thì so với DB nguồn hiện tại".

Vì sao ký (F1): age chỉ **mã hoá**, ai có khoá **công khai** age cũng tạo được một bản `.age` hợp lệ; `.sha256` không có khoá nên ai sửa file cũng tính lại được. Chữ ký ed25519 trên manifest (chứa SHA-256 của file) ràng buộc file + manifest với khoá riêng chỉ nằm trên VPS. **Giới hạn**: ai có root trên VPS đọc được khoá ký ⇒ chữ ký chống sửa ở kho sao lưu và bản sao ngoài VPS, **không** chống máy chủ đã bị chiếm quyền. Muốn chống cả trường hợp đó cần ký ở máy khác (ngoài phạm vi PR này).
**FAIL khi** (đã có test âm): sửa số dòng / tên DB / hash trong manifest; xoá manifest hoặc chữ ký; ký bằng khoá lạ; chỉ thay file sao lưu; thay **cả bộ** (file + manifest + chữ ký + .sha256) bằng một bản sao lưu hợp lệ khác.

**PASS khi**: có file `.dump.age` + `.manifest` + `.manifest.sig` (+ `.sha256`); `restore-test.sh` in `Chữ ký manifest hợp lệ…` rồi `PASS: <n> bảng khớp số dòng`; `allowed_signers` đã có bản ngoài VPS; bản sao lưu đầu tiên đã **chép ra ngoài VPS** (Owner chọn nơi; chưa tự động) và đã thử giải mã bằng khoá riêng ở máy Owner. Nhớ sao lưu thêm `/var/log/siscom-crm/export-gap` nếu cần giữ nhật ký xuất CSV.

### G7 — Production (V6, cần `OWNER_APPROVED_TASK` riêng cho tài khoản thật)

Chỉ làm khi staging đã chạy ổn vài ngày. Dịch vụ `siscom-crm-backend` chỉ có **một** instance trên cổng 3000, nên chuyển từ staging sang prod là **đổi DB mà dịch vụ trỏ tới**:

```bash
systemctl stop siscom-crm-backend
bash create-db.sh siscom_crm_prod create
SISCOM_HOST=crm.siscom.io.vn bash create-db.sh siscom_crm_prod env --force-env   # ghi đè env sang prod (cố ý)
deploy.sh --tag v0.1.0 --migrate        # (dùng lại web hiện tại) ; rồi seed-lookups + bootstrap-auth như G3 với mật khẩu THẬT
```

DB staging giữ để so sánh hoặc xoá bằng `drop`. Tài khoản thật sau bootstrap: xem mục 9 về `account-admin`.

## 4. Cập nhật sau go-live (mỗi lần)

1. Thông báo bảo trì (dịch vụ dừng vài chục giây). 2. Build FE nếu đổi giao diện (như G3). 3. `deploy.sh --tag vX.Y.Z [--frontend DIR] [--migrate]` (đã sao lưu tự động trước migrate). 4. Kiểm health + thử đăng nhập. 5. Kiểm `deploy.sh --list`.

## 5. Cách lùi

| Tình huống | Cách lùi | DB |
|---|---|---|
| Bản mới không khoẻ sau deploy | `deploy.sh --rollback` (hoặc `--auto-rollback` lúc deploy); đổi `current` về `previous`, restart, kiểm health | **Không tự lùi.** Migration của dự án cộng thêm nên mã cũ thường vẫn chạy; nếu không, khôi phục bản sao lưu |
| Migration hỏng giữa chừng | Dừng; **không** sửa tay DB. Khôi phục bản sao lưu trước deploy vào DB **mới**: `restore-test.sh` (tạo `siscom_crm_restore_*`), kiểm, rồi trỏ `DATABASE_URL`/`AUTH_DATABASE_URL`/`MIGRATE_DATABASE_URL` sang DB đó (cần chạy `ROLE_SPLIT`+`AUTH_ROLE`+`grants` cho DB đó — hiện `create-db.sh` chỉ nhận tên `staging|prod`, nên khôi phục thật cần quyết định riêng của Owner) | Không khôi phục đè lên DB đang chạy |
| Caddy/chứng chỉ lỗi | `systemctl stop caddy`; backend vẫn chỉ nghe `127.0.0.1` | Không đổi |
| Cả máy hỏng | Dựng VPS mới bằng G1, khôi phục từ bản sao lưu **ngoài VPS** sau khi kiểm chữ ký bằng `allowed_signers` Owner giữ (`restore-test.sh --allowed-signers <file>`) | Cần khoá riêng age + `allowed_signers` |
| Deploy dừng giữa chừng (trước khi đổi liên kết) | Không cần làm gì: `releases/<id>` dở dang tự xoá, `current` không đổi | Không đổi (sao lưu vừa tạo vẫn giữ) |
| Mất khoá ký sao lưu trên VPS | Bản cũ vẫn kiểm được bằng `allowed_signers` cũ (Owner giữ). Tạo khoá mới cần xoá cặp khoá cũ **có chủ đích** rồi `--init-signing-key`; giữ cả `allowed_signers` cũ để kiểm bản cũ | Không đổi |

## 6. Bảng biến môi trường (không chứa bí mật)

Giá trị thật chỉ nằm trên VPS. Cột "Đặt ở" cho biết nơi.

| Biến | Giá trị / ví dụ | Đặt ở | Ghi chú |
|---|---|---|---|
| `NODE_ENV` | `production` | unit systemd | cố định |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | unit systemd | không mở cổng 3000 ra ngoài |
| `TRUST_PROXY` | `loopback` | unit systemd | P1: tin `X-Forwarded-For` từ Caddy cùng máy |
| `COOKIE_SECURE` | `true` | unit systemd | production cấm `false` |
| `EXPORT_GAP_LOG_DIR` | `/var/log/siscom-crm/export-gap` | unit systemd | FV-4A: thiếu/không ghi được thì backend không khởi động; `LogsDirectory=siscom-crm` tạo thư mục |
| `DATABASE_URL` | `postgresql://siscom_app:<ngẫu nhiên>@127.0.0.1:5432/<db>` | `backend.env` | sinh bởi `create-db.sh … env` |
| `AUTH_DATABASE_URL` | `postgresql://siscom_auth:<ngẫu nhiên>@127.0.0.1:5432/<db>` | `backend.env` | bắt buộc ở production (P3c) |
| `CORS_ORIGINS`, `AUTH_ALLOWED_ORIGINS` | `https://<domain>` | `backend.env` | cùng origin |
| `LOG_LEVEL` | `log` | `backend.env` | |
| `SESSION_IDLE_MINUTES` / `SESSION_ABS_HOURS` | `480` / `12` | `backend.env` | |
| `LOGIN_WINDOW_MINUTES`, `LOGIN_MAX_PER_SOURCE`, `LOGIN_MAX_PER_IDENTIFIER`, `LOGIN_LOCK_AFTER_FAILURES`, `LOGIN_LOCK_MINUTES` | `15`, `30`, `5`, `5`, `15` | `backend.env` | mặc định của ứng dụng |
| `MIGRATE_DATABASE_URL` | `postgresql://siscom_migrator:<ngẫu nhiên>@127.0.0.1:5432/<db>` | `migrate.env` | **không** vào env của dịch vụ; chỉ deploy/backup/CLI đọc |
| `SISCOM_HOST` | `42.96.15.235` (mặc định lần dựng staging đầu); sau này `crm-staging.siscom.io.vn` / `crm.siscom.io.vn` | biến khi chạy `provision.sh` / `create-db.sh env` ⇒ `caddy.env`, `CORS_ORIGINS` = `AUTH_ALLOWED_ORIGINS` = `https://<host>` | bắt buộc; thay `SISCOM_DOMAIN` cũ (đặt biến cũ ⇒ dừng) |
| `SISCOM_TLS_MODE` | `acme` (mặc định); `internal` chỉ với IPv4, dự phòng | biến khi chạy `provision.sh` | |
| `SISCOM_PUBLIC_IP` | `42.96.15.235` | biến khi chạy `provision.sh` (tuỳ chọn) | mặc định lấy địa chỉ nguồn của tuyến ra Internet; dùng để kiểm DNS / IP |
| `SISCOM_ACME_CA` | mặc định Let's Encrypt; staging CA để thử | `caddy.env` | |
| `SISCOM_SSH_PORT` | (tuỳ chọn) vd `26266` | biến khi chạy `provision.sh` | chỉ để đối chiếu: phải trùng cổng `sshd -T` đang nghe, không thì dừng; script không đổi cổng SSH |
| `SISCOM_SWAP_GB` | `2` (1–8) | biến khi chạy `provision.sh` | |
| `SEED_LOOKUPS_ALLOW_DB` | tên DB hiện hành | `run-cli.sh` tự đặt | để `seed-lookups` chấp nhận DB van hành |
| `BOOTSTRAP_PASSWORD_{SYSADMIN,ADMIN,SALE,TECHNICIAN,ACCOUNTANT}` | Owner gõ, ≥ 12 ký tự | shell root, tạm | không ghi file, không qua chat |
| `BOOTSTRAP_EMAIL_DOMAIN` | tên miền email công ty | shell root, tạm | |
| `SISCOM_BACKUP_NO_ENCRYPT` | `yes` | tự chịu rủi ro | mặc định bắt buộc mã hoá |
| `SISCOM_ETC`, `SISCOM_OPT`, `SISCOM_BACKUP_DIR`, `SISCOM_PG_HOST`, `SISCOM_PG_PORT` | `/etc/siscom-crm`, `/opt/siscom-crm`, `/var/backups/siscom-crm`, `127.0.0.1`, `5432` | mặc định trong `lib.sh` | chỉ đổi khi diễn tập |
| `SISCOM_REHEARSAL` | `1` | **chỉ diễn tập** trên PostgreSQL tạm | từ chối cổng 5432/55433; không dùng trên VPS |

## 7. Kiểm thử không cần VPS (trong kho)

```bash
bash backend/scripts/linux/tests/test-guards.sh       # guard tên DB, giữ bản sao lưu, guard tag, --dry-run, unit/Caddyfile, F1 ký manifest, F2 cổng SSH, F3 + dọn bản dở dang
shellcheck -x -S warning -e SC1091 backend/scripts/linux/*.sh backend/scripts/linux/tests/*.sh
# Diễn tập SQL/vận hành trên PostgreSQL tạm cách ly (cần `npm ci --ignore-scripts` + `npm run build` trong backend/ và PostgreSQL ≥ 17 cục bộ):
PG_BIN="/usr/lib/postgresql/18/bin" bash backend/scripts/linux/tests/rehearse-pg.sh
```

`rehearse-pg.sh` dựng cụm PostgreSQL mới ở cổng lạ (mặc định 55871), chạy: tạo role/DB/tách role → migrate bằng `siscom_migrator` → APP_GRANTS_V4 hai lần → VERIFY `PASS|73` và VERIFY_AUTH `PASS|33` → seed → bootstrap → sao lưu **không có khoá ký phải bị từ chối** → tạo khoá ký → sao lưu ký + mã hoá age → khôi phục thử PASS → **8 ca âm F1** (sửa số dòng / tên DB / hash, xoá manifest, xoá chữ ký, ký bằng khoá lạ, chỉ thay file, thay cả bộ bằng bản hợp lệ khác — đều phải bị từ chối trước khi tạo DB thử) → khôi phục lại bộ gốc PASS → **backend production** chạy bằng env do script sinh: `/health/database` `migrated:true`, đăng nhập sai mật khẩu 401, đúng 200, cookie `Secure` (argon2 verify thật) → drop; rồi dừng cụm và xoá thư mục tạm.

**CI** (job `linux-scripts`, Ubuntu 24.04, bắt buộc trong `CI gate`): cài PostgreSQL 18 từ PGDG + `age` + `shellcheck`; `bash -n` + ShellCheck; `test-guards.sh`; `npm ci --ignore-scripts` + build + `backend_runtime_smoke`; `rehearse-pg.sh`; `provision.sh --dry-run` trên Ubuntu 24.04 thật; `systemd-analyze verify` 3 unit (bản sao tạm, chỉ đổi đường dẫn `ExecStart` cho runner); `caddy validate` bằng ảnh `caddy:2.10.2`.

## 8. Quyết định thiết kế đáng chú ý

- **Một service, một DB hiện hành** (staging rồi chuyển sang prod): đơn giản và hợp RAM 3 GB; muốn chạy song song staging + prod cần unit mẫu `@` và hai cổng — chưa làm.
- **File env root:root 600** (không phải `root:siscom`): systemd đọc `EnvironmentFile` trước khi hạ quyền nên user dịch vụ không cần đọc được bí mật.
- **VERIFY trên DB `staging|prod`**: hai file `B1.3_S1_VERIFY*.sql.txt` chỉ cho DB `siscom_crm_(restore|test)_*`. `create-db.sh grants` thay **đúng một dòng regex guard đó** bằng `^<tên DB>$` trong bản sao tạm rồi chạy; nếu file SQL đổi và không còn đúng một dòng như vậy thì script **dừng** (không tắt guard). Không sửa các file SQL gốc.
- **Sao lưu bằng `siscom_migrator`** (đọc mọi bảng); file dump chứa dữ liệu thật ⇒ thư mục 700, mã hoá age, chép ngoài VPS.
- **Build backend trên VPS** với `NODE_OPTIONS=--max-old-space-size=1536` + swap 2 GB, `npm ci --ignore-scripts`, rồi `backend_runtime_smoke` (argon2 hash/verify + Prisma CLI) trước khi đổi liên kết.
- **Ký manifest sao lưu bằng `ssh-keygen -Y`** (OpenSSH, có sẵn trên Ubuntu và Git for Windows): không thêm phụ thuộc mới; tách biệt với age (age lo bí mật, chữ ký lo toàn vẹn/nguồn gốc).

## 9. Giới hạn đã biết và việc cần Owner quyết

1. **Đã kiểm trên VPS thật (12/11)**: `provision.sh` (dry-run rồi chạy thật): đọc cổng SSH 26266, ufw, swap, fail2ban, unattended-upgrades, Node 24, PostgreSQL 18 chỉ localhost, Caddy 2.11.9, chứng chỉ Let's Encrypt cho IP, `curl https://42.96.15.235/` không `-k` (mục 11). **NOT_VERIFIED trên VPS thật**: `--ssh-key-only`; `create-db.sh`; `deploy.sh` chế độ thật (đổi liên kết `current`, `systemctl restart`, kiểm health, rollback, build với 2,9 GB RAM); `run-cli.sh`; `backup-db.sh`/`restore-test.sh` và timer sao lưu dưới systemd; `ProtectSystem=strict`/`LogsDirectory` khi backend chạy thật; **tự gia hạn** chứng chỉ IP (~6 ngày) và gia hạn thủ công. Trên Linux (CI Ubuntu 24.04) đã kiểm: ShellCheck, test guard, `provision.sh --dry-run`, `npm ci --ignore-scripts` + build + argon2/Prisma, diễn tập PostgreSQL 18 + age + backend production đăng nhập thật, `systemd-analyze verify`, `caddy validate`/`adapt`.
2. **`account-admin` (FV5) khoá cứng vào PostgreSQL thử cổng 55470** (`FV5-DB-GUARD`) nên **không chạy được trên VPS**. Bước V6 (tài khoản thật sau bootstrap: thêm nhân viên, đặt lại mật khẩu, khoá/mở) cần một PR/quyết định riêng; trước đó chỉ có 5 tài khoản bootstrap.
3. **Staging và prod dùng chung 3 role/mật khẩu** (role cấp cluster, `REASSIGN OWNED` của `ROLE_SPLIT` cũng cấp cluster). Chấp nhận được khi cùng một VPS, một người quản trị; nếu cần tách hẳn cần hậu tố role theo DB (sửa các file SQL S1 — ngoài phạm vi).
4. **Chưa có chép bản sao lưu ra ngoài VPS** và chưa có healthcheck ngoài: chờ Owner chọn nơi lưu (Q9).
5. **Khoá ký sao lưu nằm trên VPS** (F1): chống sửa đổi ở kho sao lưu và bản sao ngoài VPS, không chống kẻ đã có root trên VPS. Ký ở máy khác là phương án mạnh hơn — cần quyết định riêng.
6. **Đổi cổng SSH** không nằm trong script: script chỉ đọc cổng đang dùng. Ubuntu 24.04 có thể nghe SSH qua `ssh.socket`; script gộp cả cổng của `ssh.socket` nếu đang chạy.
7. Tin cậy khoá kho ngoài: `provision.sh` lấy khoá GPG của NodeSource, PGDG, Caddy qua HTTPS rồi ghi vào kho `signed-by`; Owner có thể đối chiếu vân tay khoá với trang chính thức trước khi chạy thật.
8. Tag `v0.1.0` chưa tồn tại; `deploy.sh --tag` chỉ dùng được sau khi Owner duyệt tạo tag trên `main`.
9. **Chứng chỉ cho IP**: Let's Encrypt **đã cấp** qua Caddy 2.11.9 với profile `shortlived` trên VPS (mục 11). **Chưa kiểm chứng**: Caddy tự gia hạn trước hạn (lần đầu dự kiến khoảng 16–17/11, chứng chỉ hết hạn 18/11/2026 20:31 UTC) — cần chạy `check-tls.sh` sau mốc đó. Chưa có cảnh báo tự động khi chứng chỉ sắp hết hạn (chỉ có `check-tls.sh` chạy tay).
10. **Cloud-init đặt lại mật khẩu root mỗi lần boot**: chưa chặn (xem mục 2).

## 10. Thay đổi sau review R1 (PR #232)

| ID | Vấn đề đã tái hiện trên `c34f602` | Sửa | Bằng chứng |
|---|---|---|---|
| F1 | Thay cả bộ `.dump` + `.manifest` của bản A bằng bản B (tính lại `.sha256`, không cần khoá nào) ⇒ `restore-test.sh` vẫn `PASS`; xoá manifest ⇒ vẫn `PASS` (nhánh "so với DB nguồn hiện tại") | Manifest thêm `file`, `file_sha256`; ký ed25519 (`ssh-keygen -Y`); `verify_backup_set` kiểm chữ ký + tên file + SHA-256 + DB **trước** mọi bước; bỏ nhánh thiếu manifest; so cả tập bảng; sao lưu từ chối khi thiếu khoá ký | `test-guards.sh` mục 7 (17 kiểm tra), `rehearse-pg.sh` 8 ca âm |
| F2 | `SISCOM_SSH_PORT=2222` ⇒ `ufw allow 2222/tcp` nhưng `sshd` vẫn ở 22 và `ufw --force enable` chặn 22 ⇒ mất SSH | Lần 1 (f304d45): chỉ nhận 22. **Lần 2** (theo VPS thật cổng 26266): đọc cổng từ `sshd -T` (+ `ssh.socket`), mở đúng các cổng đó trước `ufw --force enable`, kiểm `ufw status` sau khi bật (thiếu ⇒ tắt ufw, dừng); không đọc được ⇒ từ chối trước khi đổi gì; fail2ban cùng cổng | `test-guards.sh` mục 5, 8, 8b, 8c, 8d |
| Host | (yêu cầu mới, không phải lỗi R1) Owner có tên miền `siscom.io.vn`; cũng cần chạy được bằng IP | `SISCOM_HOST` (tên miền mặc định / IPv4 phụ) thay `SISCOM_DOMAIN`; kiểm DNS A = duy nhất IP công khai của máy (hoặc IPv4 = IP của máy) **trước** mọi thay đổi; 3 tệp TLS (`tls-domain`, `tls-ip-shortlived`, `tls-ip-internal`) được `import` vào Caddyfile; kiểm phiên bản Caddy; `check-tls.sh`; `create-db.sh env` đặt origin `https://<host>` | `test-guards.sh` mục 8b; diễn tập backend với tên miền và với IP (đăng xuất Origin lạ ⇒ 403, `https://<host>` ⇒ 200); CI `caddy validate`/`adapt` 3 chế độ, kiểm DNS thật |
| F3 | `npm ci --ignore-scripts` chưa được kiểm trên Linux; deploy không kiểm argon2 lúc chạy. Kèm lỗi liên quan: `die` trước khi đổi liên kết để lại `releases/<id>` dở dang (trap ERR không bắt `exit`) | Giữ `--ignore-scripts`; `backend_runtime_smoke` trong deploy; trap EXIT dọn bản dở dang; job CI `linux-scripts` | `test-guards.sh` mục 9; CI `linux-scripts` |

## 11. Bằng chứng chạy thật trên VPS (12/11/2026)

Owner duyệt; phiên điều phối chạy `provision.sh` @`c7e74fa` trên VPS 42.96.15.235 (Ubuntu 24.04.5), `SISCOM_HOST=42.96.15.235`, `--dry-run` trước rồi chạy thật. Phiên viết script **không** SSH vào VPS; số liệu dưới đây do phiên điều phối báo lại.

| Mục | Kết quả |
|---|---|
| Bước của `provision.sh` | 12/12 đạt, không dịch vụ nào lỗi |
| Cổng SSH | đọc đúng **26266** từ `sshd -T` |
| ufw | bật, cho phép 26266/80/443; kiểm từ ngoài: 22, 3000, 3389, 5432 **đóng** |
| Swap / fail2ban | 2 GB / active |
| Node / npm | v24.22.3 / 11.19.1 |
| PostgreSQL | 18.6, `listen_addresses=localhost` |
| Caddy | 2.11.9 |
| Chứng chỉ | Let's Encrypt, profile `shortlived`: issuer `C=US, O=Let's Encrypt, CN=YE1`, SAN `IP Address:42.96.15.235`, notBefore 12/11/2026 04:31 UTC, notAfter 18/11/2026 20:31 UTC |
| `curl https://42.96.15.235/` (không `-k`) | bắt tay TLS đạt, HTTP 404 (chưa deploy web) |
| Unit backend | `inactive`/`disabled` (đúng: chưa deploy) |
| cloud-init | tệp `99-siscom-keep-ssh-hostkeys.cfg` đã có sẵn (Owner tạo tay) ⇒ script bỏ qua, đúng thiết kế |
| Chưa chạy | `--ssh-key-only`, `create-db.sh`, `deploy.sh`, `run-cli.sh`, sao lưu/khôi phục |

Việc cần theo dõi: chạy `check-tls.sh` sau khoảng 16–17/11/2026 để xác nhận Caddy đã tự gia hạn (chứng chỉ hiện tại hết hạn 18/11/2026 20:31 UTC).
