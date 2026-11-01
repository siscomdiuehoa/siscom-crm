# Bằng chứng B1.4 — Danh mục Tỉnh/Thành (2026-11-01)

Owner mở lại phần Tỉnh/Thành (đã hoãn ngày 29/10/2026) và duyệt trong chat: **34 đơn vị hành chính cấp tỉnh có hiệu lực từ 01/07/2025** (6 thành phố trực thuộc trung ương + 28 tỉnh); thứ tự **Hà Nội → TP. Hồ Chí Minh → Đà Nẵng**, còn lại theo ABC tiếng Việt; chỉ nạp vào **DB demo** (cụm 55433).

Thay đổi: chỉ **dữ liệu** trong `backend/src/modules/lookups/lookups.catalog.ts` (bảng `lookup_item` có sẵn, `type = 'province'`, `sort_order`) + test. Không migration, không đổi cấu trúc, không đổi API, không đổi frontend (ô "Tỉnh / Thành phố" vốn đọc `GET /lookups?type=province`, sắp theo `sort_order`).
Mã ASCII cố định (trigger cấm đổi mã): `HA_NOI`, `HO_CHI_MINH`, `DA_NANG`, … Đổi tên hiển thị sau này = sửa `label_vi`.

| File | Nội dung | Kết quả |
|---|---|---|
| `01_seed_demo_db.txt` | Kiểm cụm (`cluster_name = siscom_demo`) rồi nạp bằng CLI seed có sẵn (idempotent, `siscom_migrator` vì DB đã tách role) vào `siscom_crm_test_20261101_103435` | **PASS**: chèn mới 34, 23 mục cũ giữ nguyên |
| `02_chrome_tinh_thanh.txt/.json` + `02_provinceChrome.mjs` | Chrome thật: API trả 34 mục đúng thứ tự; ô trên biểu mẫu 34 lựa chọn đúng thứ tự; hết thông báo "Máy chủ chưa có danh mục này"; chọn Đà Nẵng, lưu, trang chi tiết hiện Đà Nẵng | **PASS 5 / FAIL 0** |
| `03_*.png` | Ảnh: ô Tỉnh/Thành đang mở; chi tiết khách có Đà Nẵng | — |

Test: backend unit `jest --config test/jest-unit.json` **543 / 543** (mới `lookups.province.spec.ts` 5 ca: đủ 34, không còn tên đơn vị đã sáp nhập, mã ASCII duy nhất, mã 3 thành phố ưu tiên, thứ tự). Build backend đạt.

## Sau QA độc lập (0 Critical, 2 Important, 4 Minor)
- Danh sách 34 đơn vị, chính tả (Thanh Hóa, Khánh Hòa, Đắk Lắk, Huế), thứ tự ABC (Đ sau D; a < ă < â; u < ư), mã ASCII: QA xác nhận đúng.
- Đã sửa: `02_provinceChrome.mjs` — chú thích đúng nội dung, import `harnessGuard.mjs` theo đường dẫn tương đối trong kho (chạy lại được), ghi rõ web 4173 lúc chạy là build PR #188 (PR này không đổi frontend) và tên ảnh gốc `province_*.png` → `03_*.png`.
- **Ghi nhận, chờ owner quyết:** tài liệu đã nghiệm thu `docs/B1.3_MVP_ACCEPTANCE.md` và `docs/B1.3_DEMO_PACK.md` vẫn ghi "không seed province / Q3 = 23 mục". Trên DB đã nạp danh mục này, Q3 sẽ ra **57** (= 23 + 34) — đúng, không phải lỗi. PR này không sửa tài liệu nghiệm thu cũ.
- Cố ý: nhãn "TP. Hồ Chí Minh" có tiền tố theo đúng chữ owner dùng; 5 thành phố khác không có tiền tố.
- Thứ tự ABC theo từng chữ cái (chuẩn Unicode tiếng Việt): Nghệ An trước Ninh Bình, Quảng Ngãi trước Quảng Ninh (nếu coi "NG" là một chữ cái riêng như một số từ điển cũ thì thứ tự này đảo).
- Fixture test tích hợp `PROV_A` (sortOrder 10, trùng Hà Nội) chỉ có trong DB test; không ảnh hưởng test hiện tại.

Không chạm `siscom_crm_dev` / PostgreSQL 5432. Muốn có danh mục trên DB khác cần duyệt riêng (chạy cùng CLI seed).
Dữ liệu thử để lại trên DB demo: khách `Cty Tinh Thanh …` (Đà Nẵng).
