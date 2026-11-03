# Bằng chứng B1.5 — bản demo qua HTTPS trong Wi-Fi nội bộ (phương án B, mkcert) — 2026-11-03

Thực hiện theo `docs/B1.5_PHONE_HTTPS_GUIDE.md` mục **G** và `docs/B1.5_WINDOWS_HTTPS_SETUP_STEPS.md` bước 7–8, trên máy owner `DESKTOP-JSKKF7F`, mã `main` **0b80ae4** (gồm #196, #197, #199, #200). Chỉ cụm PostgreSQL demo `127.0.0.1:55433` (DB `siscom_crm_test_20261101_103435`, dữ liệu thử); PostgreSQL 5432 không đụng; không deploy.

## Chuẩn bị (owner đã duyệt từng bước 01/11/2026)
- Caddy v2.11.7 (SHA-256 khớp digest phát hành, SHA-512 khớp `checksums.txt`) và mkcert v1.4.4 (SHA-256 khớp manifest winget) trong `D:\SISCOM-CRM-lan-tools\`.
- CA nội bộ + chứng chỉ cho `192.168.1.10` trong `D:\SISCOM-CRM-demo-pg\private\lan-certs` (**không** `mkcert -install`).
- Quy tắc firewall do owner tạo: `SISCOM demo LAN 8443` — Inbound TCP 8443, local `192.168.1.10`, remote `192.168.1.0/24`, hồ sơ Public (mạng hiện tại), chỉ `caddy.exe`.
- Worktree demo cập nhật lên `main` 0b80ae4: `npm ci` backend (lockfile mới của #200, Prisma 7.10.1), build backend + frontend (cờ demo), test `mobilePwa.test.mjs` 4/4.
- `demo-lan.ps1 -Step start`: thành công; tự kiểm cổng: **chỉ `192.168.1.10:8443` mở ra Wi-Fi**, 3100/4173/55433 chỉ loopback.

## Kết quả
| Mục | File | Kết quả |
|---|---|---|
| Bước 7 — TLS thật (`demo-lan-tls-verify.mjs`, chỉ tin đúng `rootCA.pem`) | `01_kiem_tls_that_buoc7.txt` | **PASS=15 FAIL=0 WARN=0** — TLS 1.3; SAN đúng IP; còn hạn 821 ngày; đối chứng: thiếu CA ⇒ `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, CA không có trong 111 chứng chỉ kho Root Windows (so SHA-256); TLS 1.0/1.1 bị từ chối; giao diện/backend/manifest PWA qua HTTPS; Origin lạ ⇒ 403 `CSRF_FAILED`; `http://` trên 8443 không trả giao diện; 3100/4173/55433/5432 đóng trên IP Wi-Fi |
| Selftest script (`demo-lan-tls-verify.selftest.mjs`) | — | 15/15 pass |
| Bước 8 — Chrome 4 vai trò qua HTTPS | `02_chrome_https_4_vai_tro.log/.json` | **91 PASS / 0 FAIL** — thêm kiểm `siscom_sid` (HttpOnly+**Secure**+Lax, Path=/api/v1), `siscom_csrf` (**Secure**, không HttpOnly, Path=/) |
| Bước 8 — Remember Me qua HTTPS | `03_chrome_https_remember_me.log/.json` | **24 PASS / 0 FAIL** — `siscom_rmb` HttpOnly+**Secure**+Lax, Path=/api/v1/auth |
| Hạn mức đăng nhập theo IP (định danh không tồn tại, không khoá tài khoản demo) | — | 5 lần sai qua proxy ⇒ 401×5; lần 6 qua proxy ⇒ **429**; cùng định danh gọi thẳng `127.0.0.1:3100` (nguồn khác) ⇒ 401 (không 429) ⇒ đếm theo IP khách thật nhờ `TRUST_PROXY=loopback`, không gộp chung IP của Caddy |

## Cách chạy bước 8 (giới hạn nói rõ)
- Chrome headless, **hồ sơ tạm riêng** (xoá sau khi chạy), cờ `--ignore-certificate-errors-spki-list=rRt0ebipnpmUbI/xSa34k987xHJhUhwScxAfWVLIFr0=` — **chỉ chấp nhận đúng khoá công khai** của chứng chỉ Caddy (SPKI do bước 7 in ra). Không dùng `--ignore-certificate-errors`. Chrome owner đang dùng không bị ảnh hưởng.
- Harness trong repo (`tests/browser/sessionRolesChrome.mjs`) cố ý chỉ cho host `127.0.0.1` (`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`). Bộ HTTPS chạy bằng **bản sao ngoài repo** chỉ đổi: địa chỉ `https://192.168.1.10:8443`, luật phân giải thêm đúng `EXCLUDE 192.168.1.10` (mọi host khác vẫn chặn), cờ SPKI, và assertion `Secure` cho cookie. Tiến trình Node của harness chỉ tin thêm `rootCA.pem` (chứng chỉ công khai) qua `NODE_EXTRA_CA_CERTS`.
- Kết luận TLS dựa trên **bước 7 + điện thoại thật**; bộ Chrome chỉ chứng minh **hành vi ứng dụng** qua HTTPS.

## Còn lại (owner)
- Cài `rootCA.pem` lên iPhone/Android, mở `https://192.168.1.10:8443`, làm checklist `docs/B1.5_OWNER_ACCEPTANCE_CHECKLIST.md` mục 10 (điện thoại thật, PWA "Thêm vào màn hình chính") và mục 1–7.
- Kết thúc buổi thử: đóng 3 cửa sổ demo, `Disable-NetFirewallRule -DisplayName "SISCOM demo LAN 8443"` (Administrator).

Mật khẩu demo nạp từ file bằng script, không in; đã kiểm các file bằng chứng không chứa mật khẩu hay giá trị cookie.
