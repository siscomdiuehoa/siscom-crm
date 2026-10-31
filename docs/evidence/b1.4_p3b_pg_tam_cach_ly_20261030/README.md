# Bằng chứng kiểm thử B1.4 P3b trên PostgreSQL tạm cách ly (2026-10-30)

| Mục | Giá trị |
|---|---|
| PR | #182 `db/b1.4-p3b-app-grants-v2`; mã kiểm ở HEAD `caeaa72` (mục 01–07), riêng 06/07 chạy trên `61dfc56`+ thay đổi tương đương (không ảnh hưởng harness) |
| Môi trường | Cluster PostgreSQL **riêng** tạo bằng `initdb` trong thư mục tạm, PostgreSQL 18.6, chỉ nghe `127.0.0.1:55432`, `TimeZone=Asia/Bangkok`. **Không** dùng server PostgreSQL của owner (cổng 5432); không chạm `siscom_crm_dev`/baseline. Cluster đã huỷ sau khi kiểm |
| Dữ liệu | Giả: DB `siscom_crm_test_<stamp>`, tài khoản bootstrap `*@siscom.local`, mật khẩu thử ngẫu nhiên (đã xoá) |
| Đã loại bỏ | Mọi chuỗi kết nối (`<url-da-che>`), mật khẩu thử, mật khẩu mới trong ca đổi mật khẩu; mã ANSI. File JSON harness không chứa giá trị cookie/token (chỉ tên và thuộc tính) |

| File | Nội dung | Kết quả |
|---|---|---|
| `01_chuan_bi_db_v2_verify_m1.log` | migrate → VERIFY trước tách (RED) → ROLE_SPLIT → V2 ×2 → VERIFY → M1/M1.1/M1.2/M1.3; canary | `FAIL\|47` → `PASS\|67`; M1.x `PASS\|131/43/115`, M1.3 6/6 |
| `02_kiem_role_production_chay_nham_v1.log` | Backend `NODE_ENV=production` bằng `siscom_app` sau khi chạy nhầm V1, rồi sau V2 | V1 ⇒ thoát 1, log "quyền rộng kiểu APP_GRANTS V1"; V2 ⇒ khởi động |
| `03_kiem_role_production_app_vs_migrator.log` | (a) `siscom_app` ⇒ chạy; (b) `siscom_migrator` ⇒ từ chối | (a) `role.leastPrivilege=true`; (b) thoát 1 |
| `04_kiem_role_production_db_len_sau.log` | DB tắt lúc backend khởi động (migrator URL) ⇒ cảnh báo, kiểm lại; DB lên ⇒ phát hiện | thoát 1 trong cùng giây DB lên |
| `05_integration_db5_tom_tat.log` | `npm run test:e2e:customers` trên DB đã áp V2 cuối | 13/13 suite, 136/136 test |
| `06_harness_chrome_4_vai_tro.log` + `_evidence.json` | `sessionRolesChrome.mjs` (Chrome thật, backend `dist/main.js` bằng `siscom_app`, FE build + preview) | 91 PASS / 0 FAIL / 0 KNOWN |
| `07_minh_hoa_s3_r1_r2.log` | Dưới quyền `siscom_app`: R1 đổi mật khẩu admin qua `fn_auth_api_change_own_password` (trong ROLLBACK); R2 chèn `auth_session` rồi `/auth/me` | R1 làm được (có audit); R2 làm được, `/auth/me` = `crm_admin`, không audit — S3 **chưa đóng** |

Sự cố trong lúc kiểm (đã xử lý, ghi ở `backend/docs/B1.4_P3B_APP_GRANTS_V2.md` §4.1): build FE bị Git Bash đổi `/api/v1`; một lượt harness chạy nhầm backend cũ (kết quả bị loại); lỗi thật phát hiện và sửa: production từ chối khởi động nhưng không in log (`Logger.flush()`).
