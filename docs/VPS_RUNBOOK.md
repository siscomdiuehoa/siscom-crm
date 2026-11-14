# VPS_RUNBOOK — Dựng SISCOM CRM trên VPS Ubuntu 24.04 (bước V2 của kế hoạch VPS)

| Mục | Giá trị |
|---|---|
| Trạng thái | Xem **mục 12** (bảng 3 cột theo từng bước: ĐÃ CHẠY THẬT trên VPS / đã diễn tập PostgreSQL tạm hoặc CI / NOT_VERIFIED). Tóm tắt: `provision.sh` (kể cả `--ssh-key-only`) @`c7e74fa`, `create-db.sh` + `deploy.sh` lần đầu + `run-cli.sh` @`4c33ba6` **đã chạy thật** trên VPS 42.96.15.235 ngày 12/11/2026 (phiên điều phối chạy, Owner duyệt; reviewer chưa kiểm độc lập). Mã sửa R2/R3 (ufw, retention, kiểm 3 URL, trùng stem) **chưa chạy trên VPS** — VPS vẫn chạy `4c33ba6`. Sao lưu/khôi phục chưa chạy trên VPS. |
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
**Cổng SSH (F2) và tường lửa (SEC-01, sửa sau R2):** script **không đổi** cổng của `sshd`; đọc cổng đang dùng bằng `sshd -T` (gộp cả `ssh.socket`; nhiều cổng thì lấy tất cả). Allowlist ufw = đúng `ufw allow <cổng SSH>/tcp`, `ufw allow 80/tcp`, `ufw allow 443/tcp`.
- **Kiểm kê rule có sẵn** bằng `ufw show added` (chạy được cả khi ufw tắt) **ngay từ đầu script** (trước apt) và **lại trước khi thêm/bật**: có **bất kỳ** rule nào khác (allow cổng khác như 5432/3000, `deny`/`limit`/`reject` trên cổng SSH, `allow 22` khi SSH ở 26266, theo nguồn/giao diện…) ⇒ **dừng, không đổi gì, không tự xoá rule**, in danh sách để Owner tự xử lý (`ufw status numbered`, `ufw delete <số>`).
- **Không đọc được trạng thái ufw** (R3-SEC01-01): `ufw show added` trả lỗi (vd không phải root, cấu hình ufw hỏng) ⇒ **dừng ngay** ở bước kiểm đầu, trước apt và mọi thay đổi. Nếu ufw **chưa cài**, bước kiểm đầu bỏ qua và `ufw_apply` (bước 4, sau apt) kiểm kê, cũng dừng nếu lỗi.
- Thêm allowlist (idempotent) → `default deny incoming` / `allow outgoing` → kiểm kê lại → `ufw --force enable` → phân tích **toàn bộ** `ufw status verbose`: phải `Status: active`, `Default: deny (incoming)`, mọi rule (v4+v6) thuộc allowlist, đủ cổng SSH. Thiếu cổng SSH ⇒ `ufw --force disable` và dừng; có rule lạ ⇒ dừng, **không** in OK (ufw vẫn bật vì SSH còn mở). fail2ban dùng cùng cổng.
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

**Điểm lệch đã ghi nhận (staging 12/11):** với staging dữ liệu giả, Owner duyệt cho `bootstrap-auth` dùng 5 mật khẩu **sinh ngẫu nhiên trên VPS** (truyền qua biến môi trường của tiến trình, lưu tệp root 600, không in, không qua chat) thay vì Owner tự gõ. **Production vẫn theo hướng dẫn trên** (Owner tự gõ).

**Lưu ý cho VPS này trước khi chạy G2–G3:**
- Thứ tự: `create-db.sh … create` → `create-db.sh … env` (cần `SISCOM_HOST=42.96.15.235` ⇒ origin `https://42.96.15.235`) → `deploy.sh --src … --frontend … --migrate` (DB rỗng: tự bỏ qua sao lưu, migrate bằng `siscom_migrator`, rồi `grants` + VERIFY) → `run-cli.sh seed-lookups` → `run-cli.sh bootstrap-auth`.
- `run-cli.sh` dùng bản đã triển khai (`/opt/siscom-crm/current/…`), không phải thư mục giải nén.
- **Trước lần deploy THỨ HAI**: DB đã có dữ liệu nên `deploy.sh` **bắt buộc** sao lưu thành công ⇒ phải có `backup-db.sh --init-signing-key` và `/etc/siscom-crm/backup.age-recipients` (khoá công khai age của Owner) trước, nếu không deploy sẽ dừng ở bước sao lưu (đúng thiết kế, không đổi gì).
- Build backend chạy trên VPS (2,9 GB RAM + swap 2 GB; `NODE_OPTIONS=--max-old-space-size=1536`) và cần mạng ra npm registry. Frontend build trên Windows.
- `deploy.sh` và `run-cli.sh` (sau R2, DB-01; **thay đổi hành vi:** khi đã có `backend.env` thì `migrate.env` cũng bắt buộc, kể cả `deploy.sh --dry-run`) dừng ngay nếu `DATABASE_URL`, `AUTH_DATABASE_URL` (backend.env) và `MIGRATE_DATABASE_URL` (migrate.env) không đủ, sai dạng/tài khoản, hoặc không cùng một DB — trước mọi lệnh chạm DB, npm hay CLI. Tệp do `create-db.sh … env` sinh luôn đạt; chỉ lỗi khi sửa tay.
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

`backup-db.sh`: `pg_dump -Fc` bằng `siscom_migrator` trên **ảnh chụp nhất quán** (`--snapshot`; số dòng từng bảng trong `.manifest` đếm cùng ảnh chụp) → kiểm `pg_restore -l` → mã hoá age → ghi `file`, `file_sha256` vào manifest → **ký manifest** (`ssh-keygen -Y sign`, ed25519, namespace `siscom-crm-backup`) → tự kiểm chữ ký → giữ **14 bản mới nhất + mỗi tuần 1 bản (8 tuần)**, chỉ xoá file đúng mẫu tên của DB đó trong thư mục sao lưu. Từ chối nếu thiếu khoá ký, thiếu khoá age (không có ngoại lệ trên VPS: `SISCOM_BACKUP_NO_ENCRYPT=yes` chỉ cho diễn tập cách ly), ổ còn < 1 GB, hoặc tài khoản là `postgres`. Lỗi ở bất kỳ bước nào ⇒ không để lại bộ sao lưu dở dang/chưa ký.

**Giữ bản và bản plaintext (SEC-02, sửa sau R2 theo điều kiện Owner 12/11):** retention (14 bộ mới nhất + mỗi tuần 1 bộ, 8 tuần) **chỉ tính và chỉ xoá các bộ `<db>_<ts>.dump.age`** của đúng DB, xoá đủ sidecar của bộ đó (`.sha256`, `.restore-ok.txt`, `.manifest`, `.manifest.sig`). **Bộ `.dump` (plaintext) không bao giờ bị script xoá hay sửa**, kể cả khi quá hạn giữ; script chỉ phát hiện và liệt kê.
- **Chế độ mã hoá (mặc định) mà còn ≥ 1 bộ `.dump` của DB:** bản `.age` mới **vẫn được tạo, ký và tự kiểm**; sau đó script liệt kê đủ tên các bộ plaintext và **thoát ≠ 0 mỗi lần chạy** cho đến khi Owner xử lý bằng tay. **Không có cờ nào bỏ qua kiểm soát này và không có cờ tự xoá plaintext** (mã `keep`/`purge` của bản `ead6338` đã bị xoá hẳn; đặt biến cũ không có tác dụng gì).
- **Trùng stem (R3-SEC02-01):** nếu cùng `<db>_<ts>` có cả `.dump` và `.dump.age` (vd sao chép/khôi phục bộ cũ bằng tay) thì hai bộ **dùng chung** `<stem>.manifest`/`.manifest.sig` ⇒ script **không xoá bất kỳ tệp nào** của stem đó (kể cả `.dump.age` quá hạn), liệt kê stem và thoát ≠ 0 ở mọi chế độ; hàm xoá còn tự từ chối khi thấy `<stem>.dump`. `backup-db.sh` tự nó không tạo trùng stem (từ chối nếu `<stem>.dump` hoặc `<stem>.dump.age` đã tồn tại). Owner quyết giữ bộ nào rồi xử lý tay như quy trình dưới.
- **Tác động tới `deploy.sh`:** sao lưu thoát ≠ 0 ⇒ deploy dừng trước migrate (đúng thiết kế).
- **Quy trình xoá plaintext bằng tay (chỉ khi Owner phê duyệt riêng bằng văn bản):**
  1. Có bộ `.age` thay thế **mới hơn** bộ plaintext: `restore-test.sh --dump <bộ .age> --identity <khoá riêng age>` in `Chữ ký manifest hợp lệ…` và `PASS: <n> bảng khớp số dòng`, có tệp `<bộ .age>.restore-ok.txt`.
  2. Owner duyệt riêng, ghi rõ tên từng bộ plaintext sẽ xoá.
  3. Xoá tay đúng các tệp của từng bộ: `<stem>.dump`, `<stem>.dump.sha256`, `<stem>.dump.restore-ok.txt` (nếu có), `<stem>.manifest`, `<stem>.manifest.sig` (nên dùng `shred -u` vì là dữ liệu thật).
  4. Chạy lại `backup-db.sh` ⇒ phải thoát 0.
- **Production bắt buộc mã hoá (quyết định Owner 12/11):** `SISCOM_BACKUP_NO_ENCRYPT=yes` bị **từ chối với `siscom_crm_prod`**, và với mọi DB vận hành (kể cả `siscom_crm_staging` trên VPS) — chỉ được dùng cho DB thử **cách ly** khi diễn tập (`SISCOM_REHEARSAL=1`, PostgreSQL tạm). Kiểm **ngay từ đầu**, trước mọi kết nối DB, dump hay tạo thư mục. Trong diễn tập, bộ plaintext không bị retention xoá (tích luỹ, có cảnh báo số bộ); bộ `.age` cũ vẫn do retention quản.
`restore-test.sh`: **xác thực trước** (chữ ký manifest bằng `allowed_signers`; `db` = DB mong đợi; `file` = đúng tên file; `file_sha256` = SHA-256 thật) — sai bất kỳ điểm nào ⇒ dừng, **chưa tạo DB thử** → giải mã → SHA-256 bản rõ phải khớp manifest đã ký → tạo DB `siscom_crm_restore_<UTC>` → `pg_restore` → so **số dòng từng bảng** và **tập bảng** với manifest + `_prisma_migrations` → ghi `<dump>.restore-ok.txt`; **không tự xoá** DB thử (in lệnh `DROP`). Không còn nhánh "thiếu manifest thì so với DB nguồn hiện tại".

Vì sao ký (F1): age chỉ **mã hoá**, ai có khoá **công khai** age cũng tạo được một bản `.age` hợp lệ; `.sha256` không có khoá nên ai sửa file cũng tính lại được. Chữ ký ed25519 trên manifest (chứa SHA-256 của file) ràng buộc file + manifest với khoá riêng chỉ nằm trên VPS. **Giới hạn**: ai có root trên VPS đọc được khoá ký ⇒ chữ ký chống sửa ở kho sao lưu và bản sao ngoài VPS, **không** chống máy chủ đã bị chiếm quyền. Muốn chống cả trường hợp đó cần ký ở máy khác (ngoài phạm vi PR này).
**FAIL khi** (đã có test âm): sửa số dòng / tên DB / hash trong manifest; xoá manifest hoặc chữ ký; ký bằng khoá lạ; chỉ thay file sao lưu; thay **cả bộ** (file + manifest + chữ ký + .sha256) bằng một bản sao lưu hợp lệ khác.

**PASS khi**: có file `.dump.age` + `.manifest` + `.manifest.sig` (+ `.sha256`); `restore-test.sh` in `Chữ ký manifest hợp lệ…` rồi `PASS: <n> bảng khớp số dòng`; `allowed_signers` đã có bản ngoài VPS; bản sao lưu đầu tiên đã **chép ra ngoài VPS** (Owner chọn nơi; tự động hoá: G6b) và đã thử giải mã bằng khoá riêng ở máy Owner. Nhớ sao lưu thêm `/var/log/siscom-crm/export-gap` nếu cần giữ nhật ký xuất CSV.

### G6b — Tự động kéo bản sao lưu mã hoá về Google Drive (máy Windows của Owner)

Mô hình **kéo**: máy Windows của Owner tự tải về mỗi sáng; VPS **không** giữ mật khẩu/token Google ⇒ VPS bị chiếm quyền cũng không xoá/ghi đè được bản sao ngoài.

**Trên VPS (một lần, cần Owner duyệt; phiên điều phối chạy):** tài khoản chỉ đọc `backup-pull`.
```bash
# Owner tạo khoá RIÊNG cho việc kéo trên máy Windows (khoá riêng chỉ ở máy đó):
#   ssh-keygen -t ed25519 -f C:\Users\<user>\.ssh\siscom_backup_pull
# rồi chép DUY NHẤT file .pub lên VPS, ví dụ /root/siscom_backup_pull.pub
cd /opt/siscom-crm/current/backend/scripts/linux
bash setup-backup-pull.sh --pubkey /root/siscom_backup_pull.pub --dry-run   # xem trước, không đổi gì
bash setup-backup-pull.sh --pubkey /root/siscom_backup_pull.pub
# Lùi: bash setup-backup-pull.sh --remove
```
Script tạo user hệ thống `backup-pull` (shell `/bin/sh`, mật khẩu `*`, home `/var/lib/backup-pull` root:root 755), `authorized_keys` (root:backup-pull 640) **đúng 1 khoá ed25519**:
`restrict,command="/usr/lib/openssh/sftp-server -R -d /var/backups/siscom-crm" ssh-ed25519 …` ⇒ chỉ chạy được sftp **chế độ chỉ đọc**: không ghi/xoá/đổi tên, không shell, không chuyển tiếp cổng, không pty. Quyền đọc cấp bằng **ACL** theo từng tệp: `u:backup-pull:rx` trên thư mục (để liệt kê) + `r` cho đúng 4 tệp của mỗi bộ **mã hoá hoàn chỉnh** đang có (không cấp cho bộ thiếu tệp, bộ trùng stem với `.dump`, manifest của bộ plaintext). **Không có ACL mặc định** (PR235-R1-SEC-01): mọi tệp mới (tệp tạm, `.partial`, `.dump`, tệp khác) luôn riêng tư; bộ mới do `backup-db.sh` cấp quyền đọc (`backup_grant_pull`) **chỉ sau khi** bộ mã hoá hoàn tất và tự kiểm đạt — cấp lỗi ⇒ `backup-db.sh` thoát ≠ 0. Chủ sở hữu/quyền `root 700` của thư mục **không đổi**. **Không** sửa `sshd_config`, không nạp lại sshd, không đổi ufw/fail2ban. Script tự kiểm sau khi cài: `backup-pull` đọc được bộ mới nhất, **không** ghi được thư mục, **không** đọc được `/etc/siscom-crm`.
**Thứ tự:** VPS phải chạy bản `backup-db.sh` có `backup_grant_pull` (bản phát hành chứa PR này) **trước** khi dựa vào việc kéo tự động; bản cũ tạo bộ mới không cấp quyền ⇒ máy Owner không tải được ⇒ `pull-backups.ps1` báo lỗi (không âm thầm).

Thư mục sao lưu **không còn bị chmod lại**: `backup-db.sh` dùng `backup_dir_ensure` (chưa có ⇒ tạo 700; đã có ⇒ chỉ kiểm: thuộc root, `other` = 0, bit group chỉ qua ACL, không ai được ghi — sai ⇒ từ chối), `provision.sh` bỏ qua thư mục đã có. Lý do: `chmod 700`/`install -d -m 700` đặt lại ACL mask về `---` ⇒ mất quyền đọc của `backup-pull`. Nếu ai đó chmod tay thư mục ⇒ chạy lại `setup-backup-pull.sh` (idempotent).

**Trên máy Windows:** `backend/scripts/windows/pull-backups.ps1` (Windows PowerShell 5.1 hoặc pwsh 7; OpenSSH có sẵn của Windows `C:\Windows\System32\OpenSSH`).
```powershell
# Lần đầu: khoá host VPS phải có trong known_hosts (StrictHostKeyChecking=yes). Kiểm vân tay với phiên điều phối trước khi gõ yes:
sftp -P 26266 -i $HOME\.ssh\siscom_backup_pull backup-pull@42.96.15.235
# Chạy tay:
powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\backend\scripts\windows\pull-backups.ps1
# Task Scheduler 8:00 hằng ngày, bật "Run task as soon as possible after a scheduled start is missed":
schtasks /Create /TN "SISCOM CRM keo sao luu" /SC DAILY /ST 08:00 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File <duong dan>\pull-backups.ps1"
```
Mặc định: `-VpsHost 42.96.15.235 -Port 26266 -User backup-pull -KeyFile $HOME\.ssh\siscom_backup_pull -Database siscom_crm_staging -DriveDir 'G:\My Drive\SISCOM-CRM-Backup' -WorkDir $HOME\SISCOM-CRM-PR178\backup -MaxAgeHours 26`. Bộ vào `<DriveDir>\staging\` (`siscom_crm_prod` ⇒ `<DriveDir>\prod\`). `allowed_signers` phải nằm ở `<DriveDir>\backup-signing.allowed_signers`. **Khoá riêng age không bao giờ để trong `DriveDir`.**

Mỗi lần chạy: liệt kê qua sftp **chỉ** tên đúng mẫu `<db>_<ts>.dump.age|.dump.age.sha256|.manifest|.manifest.sig` (`.dump` và tên lạ bị bỏ qua) → bộ nào trên Drive **chưa đủ 4 tệp** (chưa có, hoặc dở dang do lần trước bị ngắt) và trên nguồn **đủ 4 tệp** thì tải vào `<WorkDir>\incoming\<stem>` (nguồn thiếu tệp ⇒ cảnh báo, chờ lần sau; nhưng nếu bộ đó đã dở dang trên Drive ⇒ lỗi) → kiểm **chữ ký manifest** (`ssh-keygen -Y verify` với `allowed_signers` trên Drive), `db=` đúng, `encrypted=1`, `file=` đúng tên, `file_sha256` = SHA-256 thật, `.sha256` khớp → **chỉ bộ đạt** mới vào Drive: tệp đã có trên Drive phải **trùng byte** bản vừa xác minh (khác ⇒ lỗi, **không ghi đè**), tệp còn thiếu được chép vào tên tạm rồi đổi tên (bị ngắt không để lại tệp cụt mang tên thật), sau đó **kiểm lại cả bộ trên Drive** (PR235-R1-BIZ-01); bộ lỗi giữ ở `<WorkDir>\incoming\loi\`. **Không xoá gì trên Drive** (dọn bản cũ làm tay). Log: `<WorkDir>\pull-backups.log`.
**Mã thoát 1 (lỗi) khi:** không kết nối/liệt kê được, bộ nào kiểm không đạt, thiếu thư mục Drive/`allowed_signers`, bộ dở dang trên Drive không hoàn thiện được, hoặc **bộ HỢP LỆ mới nhất TRÊN DRIVE** (đủ 4 tệp, kiểm lại chữ ký + SHA-256 mỗi lần chạy) **cũ hơn 26 giờ** — bộ đang tạo/thiếu tệp trên VPS không được tính (PR235-R1-BIZ-02). Chưa có cảnh báo email/Zalo — xem log hoặc lịch sử Task Scheduler.

**Giới hạn đã biết:** `sftp-server -R` không chroot ⇒ `backup-pull` vẫn **đọc** được các tệp mà mọi user đều đọc được (vd `/etc/passwd`, `/etc/os-release`); **không** đọc được `/etc/siscom-crm` (700), `/root`, khoá ký, `.dump` plaintext (đã kiểm trong e2e). Muốn chặn hẳn cần `ChrootDirectory` + `Match User` trong `sshd_config` (đổi cấu hình sshd ⇒ để PR sau nếu Owner muốn). Nhiều lần đăng nhập lỗi từ máy Owner có thể bị fail2ban chặn IP tạm thời.

**Kiểm thử trong kho:** `backend/scripts/windows/pull-backups.test.ps1` (offline, bộ giả ký bằng khoá tạm: bộ hợp lệ, chạy lại không ghi đè, manifest bị sửa, khoá lạ, thiếu chữ ký, DB khác, file bị sửa, plaintext, bộ quá cũ, bộ hợp lệ 40 giờ + bộ dở 1 giờ ⇒ lỗi, bộ hỏng trên Drive, ngắt sau 1/2/3 tệp rồi chạy lại ⇒ hoàn thiện, tệp khác trên Drive ⇒ lỗi không ghi đè, bộ dở mà nguồn đã mất tệp ⇒ lỗi, thiếu `allowed_signers`); `backend/scripts/linux/tests/e2e-backup-pull.sh` (CI, root: sshd thật 127.0.0.1:2222 `UsePAM no`, ACL thật, pwsh kéo qua sftp; put/rm/rename/mkdir bị từ chối, lệnh SSH bị bỏ qua, `-R` bị từ chối, `/root` và khoá ký không đọc được, không có ACL mặc định, bộ mã hoá hoàn tất (qua `backup_grant_pull`) đọc được, còn `.dump`/`.partial`/tệp tạm/tệp lạ tạo sau setup (umask 077 và 022) và bộ chưa hoàn tất **không** đọc được, `backup_dir_ensure` giữ ACL, `--remove` gỡ sạch); guard tests mục 13 trong `test-guards.sh`.

**Chưa kiểm trên VPS thật (NOT_VERIFIED):** ACL trên ổ của VPS, `backup_grant_pull` trong lần timer đầu, kết nối từ máy Owner qua cổng 26266, Task Scheduler. Điểm kiểm sau khi cài: (1) `sftp` từ máy Owner liệt kê được; (2) `ssh -p 26266 -i … backup-pull@42.96.15.235 id` không in `uid=`; (3) `put` bị từ chối; (4) chạy `pull-backups.ps1` thoát 0, Drive có đủ bộ; (5) sáng hôm sau log có bộ mới.

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
| `SISCOM_BACKUP_NO_ENCRYPT` | `yes` | **chỉ diễn tập** (`SISCOM_REHEARSAL=1`, DB thử cách ly) | từ chối với `siscom_crm_prod` và mọi DB vận hành trên VPS; mặc định bắt buộc mã hoá |
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

1. **Phạm vi kiểm chứng**: xem bảng mục 12. Bằng chứng VPS là đầu ra do phiên điều phối thu (phụ lục `docs/VPS_EVIDENCE_20261112.md`), **chưa được reviewer kiểm độc lập**. Mã sửa sau R2 (SEC-01 ufw, SEC-02 retention, DB-01 kiểm 3 URL) chỉ có test/CI, **chưa chạy trên VPS**.
2. **`account-admin` (FV5) khoá cứng vào PostgreSQL thử cổng 55470** (`FV5-DB-GUARD`) nên **không chạy được trên VPS**. Bước V6 (tài khoản thật sau bootstrap: thêm nhân viên, đặt lại mật khẩu, khoá/mở) cần một PR/quyết định riêng; trước đó chỉ có 5 tài khoản bootstrap.
3. **Staging và prod dùng chung 3 role/mật khẩu** (role cấp cluster, `REASSIGN OWNED` của `ROLE_SPLIT` cũng cấp cluster). Chấp nhận được khi cùng một VPS, một người quản trị; nếu cần tách hẳn cần hậu tố role theo DB (sửa các file SQL S1 — ngoài phạm vi).
4. **Chưa có chép bản sao lưu ra ngoài VPS** và chưa có healthcheck ngoài: chờ Owner chọn nơi lưu (Q9).
5. **Khoá ký sao lưu nằm trên VPS** (F1): chống sửa đổi ở kho sao lưu và bản sao ngoài VPS, không chống kẻ đã có root trên VPS. Ký ở máy khác là phương án mạnh hơn — cần quyết định riêng.
6. **Đổi cổng SSH** không nằm trong script: script chỉ đọc cổng đang dùng. Ubuntu 24.04 có thể nghe SSH qua `ssh.socket`; script gộp cả cổng của `ssh.socket` nếu đang chạy.
7. Tin cậy khoá kho ngoài: `provision.sh` lấy khoá GPG của NodeSource, PGDG, Caddy qua HTTPS rồi ghi vào kho `signed-by`; Owner có thể đối chiếu vân tay khoá với trang chính thức trước khi chạy thật.
8. Tag `v0.1.0` chưa tồn tại; `deploy.sh --tag` chỉ dùng được sau khi Owner duyệt tạo tag trên `main`.
9. **Chứng chỉ cho IP**: Let's Encrypt **đã cấp** qua Caddy 2.11.9 với profile `shortlived` trên VPS (mục 11). **Chưa kiểm chứng**: Caddy tự gia hạn trước hạn (lần đầu dự kiến khoảng 16–17/11, chứng chỉ hết hạn 18/11/2026 20:31 UTC) — cần chạy `check-tls.sh` sau mốc đó. Chưa có cảnh báo tự động khi chứng chỉ sắp hết hạn (chỉ có `check-tls.sh` chạy tay).
10. **Cloud-init đặt lại mật khẩu root mỗi lần boot**: chưa chặn (xem mục 2).
11. **Sao lưu plaintext (SEC-02):** script không bao giờ tự xoá bộ `.dump` (và tệp kèm); chế độ mã hoá còn plaintext ⇒ thoát ≠ 0 mỗi lần tới khi Owner xoá tay theo quy trình G6. `SISCOM_BACKUP_NO_ENCRYPT=yes` bị từ chối trên production và mọi DB vận hành (chỉ diễn tập cách ly). Nếu đã có bộ `.dump` trên VPS từ trước, lần sao lưu mã hoá đầu tiên sẽ thoát ≠ 0 (và chặn deploy) cho tới khi xử lý tay.
12. **Tường lửa (SEC-01):** mọi rule ufw ngoài allowlist, kể cả rule có comment/`limit`/theo nguồn riêng, đều bị coi là lạ ⇒ dừng (chặt có chủ đích: không tự xoá/reset rule).

## 10. Thay đổi sau review R1, R2 và R3 (PR #232)

| ID | Vấn đề đã tái hiện trên `c34f602` | Sửa | Bằng chứng |
|---|---|---|---|
| F1 | Thay cả bộ `.dump` + `.manifest` của bản A bằng bản B (tính lại `.sha256`, không cần khoá nào) ⇒ `restore-test.sh` vẫn `PASS`; xoá manifest ⇒ vẫn `PASS` (nhánh "so với DB nguồn hiện tại") | Manifest thêm `file`, `file_sha256`; ký ed25519 (`ssh-keygen -Y`); `verify_backup_set` kiểm chữ ký + tên file + SHA-256 + DB **trước** mọi bước; bỏ nhánh thiếu manifest; so cả tập bảng; sao lưu từ chối khi thiếu khoá ký | `test-guards.sh` mục 7 (17 kiểm tra), `rehearse-pg.sh` 8 ca âm |
| F2 | `SISCOM_SSH_PORT=2222` ⇒ `ufw allow 2222/tcp` nhưng `sshd` vẫn ở 22 và `ufw --force enable` chặn 22 ⇒ mất SSH | Lần 1 (f304d45): chỉ nhận 22. **Lần 2** (theo VPS thật cổng 26266): đọc cổng từ `sshd -T` (+ `ssh.socket`), mở đúng các cổng đó trước `ufw --force enable`, kiểm `ufw status` sau khi bật (thiếu ⇒ tắt ufw, dừng); không đọc được ⇒ từ chối trước khi đổi gì; fail2ban cùng cổng | `test-guards.sh` mục 5, 8, 8b, 8c, 8d |
| Host | (yêu cầu mới, không phải lỗi R1) Owner có tên miền `siscom.io.vn`; cũng cần chạy được bằng IP | `SISCOM_HOST` (tên miền mặc định / IPv4 phụ) thay `SISCOM_DOMAIN`; kiểm DNS A = duy nhất IP công khai của máy (hoặc IPv4 = IP của máy) **trước** mọi thay đổi; 3 tệp TLS (`tls-domain`, `tls-ip-shortlived`, `tls-ip-internal`) được `import` vào Caddyfile; kiểm phiên bản Caddy; `check-tls.sh`; `create-db.sh env` đặt origin `https://<host>` | `test-guards.sh` mục 8b; diễn tập backend với tên miền và với IP (đăng xuất Origin lạ ⇒ 403, `https://<host>` ⇒ 200); CI `caddy validate`/`adapt` 3 chế độ, kiểm DNS thật |
| F3 | `npm ci --ignore-scripts` chưa được kiểm trên Linux; deploy không kiểm argon2 lúc chạy. Kèm lỗi liên quan: `die` trước khi đổi liên kết để lại `releases/<id>` dở dang (trap ERR không bắt `exit`) | Giữ `--ignore-scripts`; `backend_runtime_smoke` trong deploy; trap EXIT dọn bản dở dang; job CI `linux-scripts` | `test-guards.sh` mục 9; CI `linux-scripts` |
| SEC-01 (R2) | `provision.sh` chỉ thêm allow và grep cổng SSH: rule ufw có sẵn (allow 5432/3000, deny SSH đứng trước…) không bị phát hiện | `ufw_apply`/`ufw_foreign_added`/`ufw_status_problems` (lib.sh): kiểm kê `ufw show added` từ đầu và trước khi bật; rule lạ ⇒ dừng, không tự xoá; sau khi bật kiểm toàn bộ `ufw status verbose` | `test-guards.sh` mục 10 (13 ca: sạch, chạy lại, 5432, 3000, deny/limit SSH, allow 22, theo nguồn, rule lạ sau khi bật, mất SSH sau khi bật, dry-run) |
| SEC-02 (R2) | Giữ bản chỉ nhìn phần mở rộng của lần chạy hiện tại ⇒ bộ `.dump` cũ còn mãi khi chuyển sang mã hoá (tái hiện trên `4c33ba6`: sao lưu mã hoá thoát 0, "Con 1 ban") | Bản cuối theo quyết định Owner (`33bc555` + commit này): retention chỉ xoá bộ `.age` (đủ sidecar); plaintext **không bao giờ bị xoá**, chỉ liệt kê; mã hoá còn plaintext ⇒ thoát ≠ 0 mỗi lần; **đã xoá mã `keep`/`purge`** (có ở `ead6338`) — không còn biến hay nhánh nào; **production bắt buộc mã hoá** (`NO_ENCRYPT` bị từ chối với `siscom_crm_prod` và mọi DB vận hành, kiểm trước dump) | `test-guards.sh` mục 11 (15 kiểm tra); `rehearse-pg.sh` trên PostgreSQL thật |
| R3-SEC02-01 (R3) | `backup_rm_age_set` xoá `<stem>.manifest`/`.manifest.sig` khi xoá bộ `.age` quá hạn, kể cả khi có `<stem>.dump` cùng stem ⇒ mất sidecar của plaintext (tái hiện trên `7648ffd`: 20 stem trùng, 160 tệp còn 90) | Phát hiện stem trùng trước retention; không xoá gì của stem trùng; liệt kê + thoát ≠ 0; hàm xoá tự từ chối khi có `<stem>.dump` | `test-guards.sh` mục 11 (5 kiểm tra R3) |
| R3-SEC01-01 (R3) | Bước kiểm ufw đầu script che lỗi `ufw show added` bằng `2>/dev/null … \|\| true` | Lỗi đọc ⇒ dừng ngay, trước apt/mọi thay đổi | `test-guards.sh` mục 10 (1 kiểm tra) |
| DB-01 (R2) | `run-cli.sh`/`deploy.sh` không kiểm `AUTH_DATABASE_URL` (và deploy bỏ qua khi thiếu `migrate.env`) | `load_db_env_triplet`/`db_url_check` (lib.sh): 3 URL bắt buộc, đúng dạng, đúng tài khoản, host loopback, **cùng DB**, gọi trước mọi lệnh chạm DB/npm/CLI | `test-guards.sh` mục 12 (9 ca hàm + 2 tích hợp với `npm`/`psql`/`node` giả: không lời gọi nào khi env lệch + 1 đối chứng) |

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

## 12. Bảng kiểm chứng theo từng bước (cập nhật sau R2)

**Nguồn bằng chứng (điều kiện 4 của Owner):**
- **"Claude báo cáo (phiên điều phối thu)"**: đầu ra quan sát được ở phụ lục `docs/VPS_EVIDENCE_20261112.md`, Owner duyệt từng bước — **ChatGPT chưa kiểm độc lập** các kết quả VPS này ([REVIEW-R2] ghi là "Claude-reported").
- **"ChatGPT đã kiểm độc lập" (R2 @`4c33ba6`)**: chỉ gồm việc đọc đủ 21 tệp và đối chiếu trạng thái CI run `43163436884` (6/6) đúng HEAD; ChatGPT không chạy lại script, không vào VPS.
- Mã sửa sau R2 và R3 (SEC-01, SEC-02, DB-01, R3-SEC02-01, R3-SEC01-01) **chưa được ai kiểm độc lập** — R3 của ChatGPT kiểm mã @`7648ffd` (đọc mã + trạng thái CI, tự tái hiện lỗi trùng stem trong shell cách ly; không chạy lại RED trên SHA cũ); bản sửa R3 chờ ChatGPT kiểm lần cuối. Chỉ có test/CI do Claude chạy.

Các bước VPS chạy bằng script ở SHA ghi trong ngoặc, **không phải** bản sau khi sửa R2.

| Script / bước | (1) ĐÃ CHẠY THẬT trên VPS 42.96.15.235 — **Claude báo cáo (phiên điều phối thu)**, ChatGPT chưa kiểm độc lập (SHA script, giờ UTC 12/11/2026, kết quả) | (2) Đã diễn tập PostgreSQL tạm / CI — do Claude chạy; ChatGPT R2 đã đối chiếu trạng thái CI 6/6 @`4c33ba6` | (3) NOT_VERIFIED |
|---|---|---|---|
| `provision.sh` 12 bước | `c7e74fa`, khoảng 04:30: 12/12 đạt; cổng 26266; ufw 26266/80/443, từ ngoài 22/3000/3389/5432 đóng; swap 2 GB; fail2ban; Node 24.22.3; PostgreSQL 18.6 chỉ loopback; Caddy 2.11.9 | dry-run trên Ubuntu 24.04 (CI) | Kiểm kê ufw mới (SEC-01) trên VPS; trạng thái sau reboot |
| Chứng chỉ IP (Caddy, profile shortlived) | `c7e74fa`: Let's Encrypt YE1, SAN IP 42.96.15.235, 12/11 04:31 → 18/11 20:31; `curl https://42.96.15.235/` không `-k` đạt | `caddy validate`/`adapt` 3 chế độ (CI) | Tự gia hạn; `check-tls.sh` trên VPS; gia hạn thủ công |
| `provision.sh --ssh-key-only` | `c7e74fa`, 05:40–05:50: `sshd -T` → `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin without-password`; phiên mới bằng khoá vào được; chỉ mật khẩu → `Permission denied (publickey)` | test guard (`sshd`/`ufw` giả) | Sau reboot (cloud-init nạp lại seed) |
| `create-db.sh create` + `env` | `4c33ba6`, 05:51–05:53: owner `siscom_migrator`; 3 role không superuser/createdb; 4 tệp `/etc/siscom-crm` mode 600; CORS = `https://42.96.15.235`; tạo lại ⇒ `TU CHOI` | diễn tập PG tạm (Windows + CI) | `create-db.sh drop`, DB `siscom_crm_prod` |
| `deploy.sh --src --frontend --migrate` lần đầu | `4c33ba6`, 05:54–05:55: 12 migration; VERIFY `PASS|73`, VERIFY_AUTH `PASS|33`; health `migrated:true`, `leastPrivilege:true`, `authPool:separate`; chỉ nghe `127.0.0.1:3000`; 0 dòng error | build + argon2/Prisma (CI); test guard dọn bản dở dang | Deploy lần 2 (nhánh sao lưu bắt buộc), `--rollback`, `--auto-rollback`, `--tag`, dọn bản dở dang trên VPS; **kiểm 3 URL (DB-01) trên VPS** |
| `run-cli.sh seed-lookups` / `bootstrap-auth` | `4c33ba6`, 05:55–05:56: 57/57 mục; 5 tài khoản thử, `closed=true` (mật khẩu sinh ngẫu nhiên — xem điểm lệch ở G3) | diễn tập PG tạm | **Kiểm 3 URL (DB-01) trên VPS** |
| HTTPS từ ngoài + đăng nhập | 05:55–05:57: trang chủ 200, health 200, HSTS + nosniff, `http://` → 308; 5 tài khoản đăng nhập 200, cookie `Secure`/`HttpOnly`, sai mật khẩu 401; quyền `/customers` đúng ma trận; Owner tự đăng nhập dùng thử | backend production 2 chế độ host (CI) | G5 đầy đủ (CSRF thiếu token, giới hạn theo IP thật, iPhone); `nmap -p-` |
| `backup-db.sh` (+ `--init-signing-key`), `restore-test.sh`, timer | Chưa chạy | ký + age + 8 ca âm F1 + SEC-02 (plaintext không bị xoá, thoát ≠ 0, quy trình xoá tay) (PG tạm, CI) | Toàn bộ trên VPS; bản sao ngoài VPS |
| Unit systemd | `siscom-crm-backend` active/enabled sau deploy (`4c33ba6`) | `systemd-analyze verify` (CI) | Giới hạn RAM / hardening dưới tải; timer sao lưu |
| Mã sửa R2 (SEC-01, SEC-02, DB-01) | **Chưa chạy trên VPS** | test guard + diễn tập + CI trên SHA sau sửa | Toàn bộ trên VPS |

**Bảng PASS / NOT_VERIFIED cho các mục sửa sau R2** (cột "Nguồn": ai tạo ra bằng chứng)

| Mục | Kết quả | Nguồn | Trên VPS |
|---|---|---|---|
| SEC-01 ufw: kiểm kê rule có sẵn, dừng khi có rule lạ, kiểm toàn bộ trạng thái sau khi bật | PASS ở mức test (13 ca, ufw giả) + dry-run kiểm kê thật trên runner CI | Claude chạy; ChatGPT **chưa** kiểm độc lập (chờ R3) | NOT_VERIFIED |
| SEC-02 giữ bản: chỉ xoá `.age`; hơn 14 bộ plaintext cũ còn nguyên; không manifest/checksum/chữ ký plaintext nào bị xoá; còn plaintext ⇒ `.age` mới hợp lệ + liệt kê + thoát ≠ 0; không plaintext ⇒ thoát 0; không còn mã `keep`/`purge` | PASS ở mức test (15 kiểm tra) + diễn tập PostgreSQL thật (Windows, CI) | Claude chạy; ChatGPT **chưa** kiểm độc lập (chờ R3) | NOT_VERIFIED (chưa có sao lưu nào trên VPS) |
| SEC-02 production bắt buộc mã hoá: `NO_ENCRYPT` + `siscom_crm_prod` ⇒ từ chối trước dump; DB vận hành ngoài diễn tập ⇒ từ chối | PASS ở mức test (không có lời gọi `pg_dump`/`psql`, không tạo thư mục sao lưu) | Claude chạy; ChatGPT **chưa** kiểm độc lập | NOT_VERIFIED |
| DB-01 ba URL cùng DB | PASS ở mức test (9 ca hàm + 2 tích hợp + 1 đối chứng) | Claude chạy; ChatGPT **chưa** kiểm độc lập | NOT_VERIFIED |
| DOC-01 tài liệu | Runbook mục 12 + phụ lục | Claude viết; bằng chứng VPS do phiên điều phối thu | — |
| R3-SEC02-01: `.dump` và `.dump.age` trùng stem (dùng chung `<stem>.manifest`/`.manifest.sig`) ⇒ không xoá bất kỳ tệp nào của stem đó, liệt kê, thoát ≠ 0; bộ `.age` không trùng vẫn được dọn | PASS ở mức test (5 kiểm tra, 20 stem trùng × 8 tệp, SHA trước/sau trùng) | Claude chạy; ChatGPT R3 đã tự tái hiện **lỗi** (hành vi xoá của `backup_rm_age_set`) trong shell cách ly; **bản sửa chưa** được ChatGPT kiểm | NOT_VERIFIED |
| R3-SEC01-01: preflight không đọc được `ufw show added` ⇒ dừng trước apt và mọi thay đổi | PASS ở mức test (`ufw` giả trả lỗi) | Claude chạy; ChatGPT chưa kiểm bản sửa | NOT_VERIFIED |

**Trạng thái VPS:** VPS 42.96.15.235 **vẫn chạy mã `4c33ba6`** (Owner giữ nguyên để tiếp tục thử nghiệm). Mã sửa R2 và R3 **chưa lên VPS**.
