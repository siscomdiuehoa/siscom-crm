# Phụ lục — bằng chứng chạy thật trên VPS 42.96.15.235 (12/11/2026)

> Đầu ra đã khử bí mật do **phiên điều phối** (Claude) thu qua SSH bằng khoá; Owner duyệt từng bước. **Chưa được reviewer kiểm độc lập.**
> Các bước chạy bằng script ở `c7e74fa` (provision, `--ssh-key-only`) và `4c33ba6` (create-db, deploy, run-cli) — **không phải** bản sau khi sửa R2.
> Bảng tóm tắt theo 3 cột: `docs/VPS_RUNBOOK.md` mục 12.

## 0. `provision.sh` 12 bước — script @c7e74fa — khoảng 04:30 UTC (theo báo cáo của phiên điều phối)

`SISCOM_HOST=42.96.15.235`, `--dry-run` rồi chạy thật: 12/12 bước đạt, không dịch vụ lỗi; cổng SSH đọc đúng 26266; ufw bật với 26266/80/443, kiểm từ ngoài 22/3000/3389/5432 đóng (trước đó ufw tắt, không có rule); swap 2 GB; fail2ban active; Node v24.22.3 / npm 11.19.1; PostgreSQL 18.6 `listen_addresses=localhost`; Caddy 2.11.9; Let's Encrypt cấp chứng chỉ IP profile shortlived — issuer `C=US, O=Let's Encrypt, CN=YE1`, SAN `IP Address:42.96.15.235`, notBefore 12/11 04:31 UTC, notAfter 18/11 20:31 UTC; `curl https://42.96.15.235/` không `-k`: bắt tay TLS đạt, HTTP 404 (chưa deploy); unit backend inactive/disabled; tệp cloud-init giữ khoá host đã có sẵn ⇒ script bỏ qua. Mục 0 là tóm tắt do phiên điều phối báo lại, không kèm đầu ra thô.

Nguồn: đầu ra lệnh do phiên điều phối (Claude) thu qua SSH bằng khoá, Owner duyệt từng bước. Đã khử bí mật: không có mật khẩu, không có URL kết nối, không có khoá riêng. Đây là đầu ra đã quan sát, KHÔNG phải kiểm chứng độc lập của reviewer.

## A. `provision.sh --ssh-key-only` — script @c7e74fa — khoảng 05:40–05:50 UTC

Trước khi chạy:
```
== effective (sshd -T)
port 26266
permitrootlogin yes
pubkeyauthentication yes
passwordauthentication yes
kbdinteractiveauthentication no
authorizedkeysfile .ssh/authorized_keys .ssh/authorized_keys2
== /etc/ssh/sshd_config.d/  (rỗng)
== /etc/ssh/sshd_config
12:Include /etc/ssh/sshd_config.d/*.conf
14:Port 26266
33:PermitRootLogin yes
57:PasswordAuthentication yes
79:PasswordAuthentication yes
83:PasswordAuthentication yes
ssh.socket active / ssh.service active
root authorized_keys: 2 khoá ED25519 hợp lệ (Owner, Claude)
```
Chạy (kèm hẹn giờ tự lùi 15 phút bằng systemd-run, đã huỷ sau khi kiểm đạt). Log: `/root/siscom-deploy/provision-c7e74fa-sshkeyonly.log`:
```
rc=0
[OK] Cong SSH dang dung: 26266
== 3. Swap 2 GB ... ==            [OK] Da co swap.
== 4. Tuong lua ufw ... ==         [OK] ufw dang bat, cong SSH 26266 van ALLOW.
== 7. Node 24 ==                   [OK] Node v24.22.3, npm 11.19.1
== 8. PostgreSQL 18 ==             [OK] PostgreSQL 18.6 (Ubuntu 18.6-1.pgdg24.04+2)
== 10. User dich vu + thu muc ==   [OK] User siscom da co
== 11. Unit systemd + Caddyfile == [OK] Caddy 2.11.9
[OK] https://42.96.15.235/ bat tay TLS dat (khong -k); HTTP 404 (backend/web co the chua trien khai).
== 12. cloud-init ==               [OK] Da co /etc/cloud/cloud.cfg.d/99-siscom-keep-ssh-hostkeys.cfg (ssh_deletekeys: false).
== 13. SSH chi bang khoa (--ssh-key-only) ==
[OK] root co 2 khoa hop le; Include drop-in dung truoc.
[OK] Xong.
sshd -T sau khi chạy:
permitrootlogin without-password
passwordauthentication no
kbdinteractiveauthentication no
```
Kiểm từ máy ngoài, phiên MỚI:
```
== 1. phien moi bang khoa            -> KEY_LOGIN_OK / cloud13365139165
== 2. chi mat khau (PubkeyAuthentication=no) -> root@42.96.15.235: Permission denied (publickey).
== 3. phuong thuc may chu chao       -> debug1: Authentications that can continue: publickey
```
Tệp tạo ra `/etc/ssh/sshd_config.d/00-siscom-ssh-key-only.conf`:
```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
```
Sau đó: `systemctl is-active ssh fail2ban ufw caddy postgresql` = active ×5; `systemctl --failed` = 0.
Ghi chú: ufw trên VPS này TẮT và không có rule nào trước lần provision đầu (kiểm chỉ đọc 12/11 trước khi chạy); sau provision `ufw status` chỉ có 26266/tcp, 80/tcp, 443/tcp (v4 + v6).
CHƯA kiểm: cấu hình còn giữ sau reboot.

## B. `create-db.sh siscom_crm_staging create` + `env` — script @4c33ba6 — 05:51–05:53 UTC

Nguồn đưa lên: `git archive 4c33ba62… backend` → tar.gz, SHA-256 hai đầu khớp `28f7a2b880d24e815fc9a985c0404eb4220464168220e74c49c861b8875366b9`. Giải nén `/root/siscom-deploy/src-4c33ba6/`. Trước khi chạy: PostgreSQL chỉ có `postgres/template0/template1`, không có role `siscom%`. Log: `/root/siscom-deploy/create-db-staging.log`:
```
[OK] Da sinh mat khau 3 role -> /etc/siscom-crm/db-roles.env (600). KHONG in ra man hinh.
[OK] Da tao database siscom_crm_staging (staging), chu so huu siscom_migrator.
[OK] Tach role xong: owner=siscom_migrator, app+auth CONNECT, PUBLIC khong co quyen.
rc_create=0
[OK] Da ghi /etc/siscom-crm/backend.env va /etc/siscom-crm/migrate.env (600) tro DB siscom_crm_staging, domain 42.96.15.235.
rc_env=0
== /etc/siscom-crm/
drwx------ root root .
-rw------- root root backend.env
-rw------- root root caddy.env
-rw------- root root db-roles.env
-rw------- root root migrate.env
CORS_ORIGINS=https://42.96.15.235
AUTH_ALLOWED_ORIGINS=https://42.96.15.235
== db
siscom_crm_staging|siscom_migrator
siscom_app|f|f        (rolsuper|rolcreatedb)
siscom_migrator|f|f
siscom_auth|f|f
== tao lai
[LOI] TU CHOI: database siscom_crm_staging DA TON TAI (script chi tao DB moi).
```

## C. `deploy.sh --src … --frontend … --migrate` (lần đầu, DB mới tinh) — script @4c33ba6 — 05:54–05:55 UTC

Giao diện build trên Windows (PowerShell, `VITE_CRM_AUTH_ENABLED=true`, `VITE_CRM_API_ENABLED=true`, `VITE_CRM_API_BASE=/api/v1`) từ `git archive 4c33ba6 frontend/siscom-crm-web`; 17 tệp, 1 117 729 byte, hai đầu khớp. Thử khô trước rồi chạy thật. Log: `/root/siscom-deploy/deploy-4c33ba6.log` (trích cuối):
```
12 migrations found in prisma/migrations
All migrations have been successfully applied.
PASS|73
[OK] B1.3_S1_VERIFY.sql.txt: PASS|73
PASS|33
[OK] B1.3_S1_VERIFY_AUTH.sql.txt: PASS|33
[OK] GRANTS + VERIFY DAT tren siscom_crm_staging.
[OK] Suc khoe OK (database up, migrated:true).
[OK] TRIEN KHAI THANH CONG: src-20261112055437 (DB siscom_crm_staging).
rc=0
```
Kiểm độc lập sau deploy:
```
systemctl is-active siscom-crm-backend -> active ; is-enabled -> enabled
curl http://127.0.0.1:3000/api/v1/health/database ->
{"status":"ok","database":"up","latencyMs":2,"schema":{"migrated":true,"baseline":"b1.1"},"role":{"leastPrivilege":true,"authPool":"separate","authLeastPrivilege":true},"time":"2026-11-12T05:55:57.069Z"}
ss -ltn: 127.0.0.1:3000 ; 127.0.0.1:5432 ; [::1]:5432
journalctl -u siscom-crm-backend -n 200 | grep -ciE 'error|exception' -> 0
/var/log/siscom-crm/export-gap/export-audit-gap-20261112.jsonl  (có)
select count(*) from _prisma_migrations where finished_at is not null -> 12
```

## D. `run-cli.sh` — script @4c33ba6 (bản đã triển khai) — 05:55–05:56 UTC
```
Chay seed-lookups tren DB siscom_crm_staging (tai khoan siscom_migrator).
Seed danh muc tren siscom_crm_staging: tong 57, chen moi 57, da co 0.
  customer_tier 4/4  customer_status 4/4  source 5/5  industry 10/10  province 34/34

Chay bootstrap-auth tren DB siscom_crm_staging (tai khoan siscom_migrator).
Khoi tao xong tren siscom_crm_staging (qua MIGRATE_DATABASE_URL, closed=true).
  sysadmin   NV-0001  sysadmin@siscom.local  vai tro=admin
  admin      NV-0002  admin@siscom.local  vai tro=crm_admin
  sale       NV-0003  sale@siscom.local  vai tro=sales
  technician NV-0004  kythuat@siscom.local  vai tro=technician
  accountant NV-0005  ketoan@siscom.local  vai tro=accountant
```
Mật khẩu 5 tài khoản thử: sinh ngẫu nhiên trên VPS, truyền qua biến môi trường của tiến trình, lưu tệp root 600; không in, không qua chat. (Khác runbook: runbook ghi Owner tự gõ; với staging dữ liệu giả Owner đã duyệt cách sinh ngẫu nhiên.)

## E. Kiểm qua HTTPS — 05:55–05:57 UTC
Từ máy ngoài (Windows, curl không `-k`):
```
trang chu 200
{"status":"ok","service":"siscom-crm-backend","version":"dev","uptimeSeconds":18,...}   health 200
Strict-Transport-Security: max-age=31536000
X-Content-Type-Options: nosniff
http->308 https://42.96.15.235/
```
Từ VPS qua `https://42.96.15.235` (đi qua Caddy), mật khẩu đọc từ tệp, không in:
```
SYSADMIN:   login=200 cookieSecure=2 httpOnly=1 me=200 customers=403
ADMIN:      login=200 cookieSecure=2 httpOnly=1 me=200 customers=200
SALE:       login=200 cookieSecure=2 httpOnly=1 me=200 customers=200
TECHNICIAN: login=200 cookieSecure=2 httpOnly=1 me=200 customers=200
ACCOUNTANT: login=200 cookieSecure=2 httpOnly=1 me=200 customers=200
sai mat khau -> 401
```
(`cookieSecure=2`: 2 dòng Set-Cookie có `Secure`; `httpOnly=1`: 1 dòng có `HttpOnly` — cookie phiên; cookie CSRF đọc được bằng JS theo thiết kế.)
Quyền sau bootstrap trên DB mới tinh: 9 mã `activity.*` (16 dòng role_permission) và `customer.export` (crm_admin:ALL) có sẵn từ ma trận BIZ; không chạy file B3/FV4.
Trình duyệt (Chromium trong ứng dụng): trang đăng nhập hiển thị đúng; console chỉ có 2 lỗi 401 của lời gọi kiểm phiên khi chưa đăng nhập. Owner xác nhận đã tự đăng nhập và dùng thử ("Vào được rồi", "việc 1 anh đã làm ok rồi").

## F. Chưa chạy / chưa kiểm trên VPS (NOT_VERIFIED)
- `backup-db.sh` (kể cả `--init-signing-key`), `restore-test.sh`, timer sao lưu.
- `deploy.sh` lần hai (nhánh sao lưu bắt buộc), `--rollback`, `--auto-rollback`, `--tag`, dọn bản dở dang khi lỗi.
- Tự gia hạn chứng chỉ IP (chứng chỉ đầu hết 18/11 20:31 UTC); `check-tls.sh` trên VPS.
- `--ssh-key-only` và ufw sau reboot.
- Giới hạn RAM/hardening systemd dưới tải.
- `nmap -p-` toàn bộ cổng (mới kiểm 22, 80, 443, 3000, 3389, 5432, 26266).
- G5 đầy đủ: CSRF thiếu token = 403, giới hạn đăng nhập theo IP thật, iPhone (chưa có biên bản).
