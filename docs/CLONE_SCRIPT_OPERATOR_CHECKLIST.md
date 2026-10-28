# Checklist vận hành Windows — `make-stats-clone` (tạo bản sao thử)

Phạm vi: chỉ hướng dẫn. Bước tạo bản sao cần mật khẩu `postgres` nhập tương tác; **tác tử AI không chạy bước này**.

## 1. File cần chép (đích `D:\SISCOM-CRM\backend\scripts\windows\`)

| File | Loại |
|---|---|
| `make-stats-clone.guards.ps1` | **MỚI** (bắt buộc nằm cùng thư mục với `make-stats-clone.ps1`; thiếu thì script dừng, mã thoát 1) |
| `make-stats-clone.ps1` | **CHÉP ĐÈ** |
| `tests\make-stats-clone.guards.tests.ps1`, `tests\make-stats-clone.guards.tests.bat` | **MỚI** (kiểm thử offline) |

Không đụng tới: `make-stats-clone.bat`, `run-search-bench.*`, `run-auth-int-tests.*`, migration, `.env`, `package.json`.

Sao lưu trước khi chép đè: `copy make-stats-clone.ps1 make-stats-clone.ps1.bak-YYYYMMDD`.
Rollback: chép lại `.bak`, xóa `make-stats-clone.guards.ps1` và thư mục `tests\`.

## 2. Kiểm thử offline (không cần PostgreSQL)

```
powershell -NoProfile -ExecutionPolicy Bypass -File backend\scripts\windows\tests\make-stats-clone.guards.tests.ps1
```
Kỳ vọng: `KET QUA: DAT (offline, khong ket noi database).` và `FAIL: 0`. Khác thì **không** chạy script thật.

## 3. Trước khi chạy script thật (cần chủ sở hữu duyệt riêng)

- [ ] Tên nguồn và tên bản sao đúng `siscom_crm_restore_YYYYMMDD_HHMMSS`: chữ thường, chỉ số ASCII 0–9, không khoảng trắng/xuống dòng thừa. Tên bản sao **không** được là baseline đã khóa hoặc `siscom_crm_dev`.
- [ ] Không có ứng dụng nào đang kết nối database nguồn (script từ chối nếu có, không tự ngắt kết nối).
- [ ] `.env` có `DATABASE_URL` dạng `postgresql://siscom_app:…@127.0.0.1:5432/siscom_crm_dev` (chỉ để lấy mật khẩu; script từ chối host/port/user/scheme khác). Không in, không chụp màn hình `.env`.
- [ ] Ba lần xác nhận khi script hỏi phân biệt hoa/thường: tên nguồn, tên bản sao, `TAO-BAN-SAO`.
- [ ] Mật khẩu `postgres` chỉ gõ tại dấu nhắc ẩn, không đưa vào lệnh/log/chat.

## 4. Sau khi chạy

- Đối chiếu dòng `KET QUA:` và log ở `D:\SISCOM-CRM\backups\b123\` (log không chứa mật khẩu).
- Xóa bản sao khi xong bằng tay, chỉ đúng bản sao đó (lệnh `DROP DATABASE` in sẵn ở cuối script).