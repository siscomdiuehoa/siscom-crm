# Bản đồ tích hợp PR xếp chồng (FE #58–#98, BE auth #25–#50)

Lập 2026-10-24 từ `gh pr list` + `git` (chỉ đọc; `git merge-tree --write-tree` và `git apply --check` không ghi vào nhánh nào). Tham chiếu `origin/main` = `a5de704`. Không có test/build nào được chạy cho tài liệu này (**NOT_RUN**). Khoảng trống chức năng G1–G13 đã nêu ở `backend/docs/CRM_LOGIN_CUSTOMER_VERTICAL_SLICE_PLAN.md` (PR #57) — không lặp lại ở đây.

## 1. Cấu trúc (đã xác minh)
- Mọi PR #15–#98 đều **OPEN + DRAFT**; đầu nhánh cục bộ = đầu nhánh remote (không lệch). `main` cục bộ (`801e428`) **cũ hơn** `origin/main` (thiếu #14) — dùng `origin/main`.
- Không tìm thấy PR #27, #51–#53, #97, #99 (không phải PR trong repo này).
- Mọi PR có đáy là tổ tiên của đầu (stack nhất quán, không PR nào "đứt" gốc).

**Trục backend (tuyến tính, không bỏ qua được):**
`main ← #15 ← #17 ← #18 ← #19 ← #20 ← #21 ← #25 ← #26 ← #28 ← #29 … ← #50 ← #54 ← #84 ← {#90, #91, #93}`
- Nhánh cạnh: #16 (main), #22/#24 (main, gốc cũ `801e428`), #23 (trên #21).
- `git apply --check` thử #26 và #28→#54 lên `origin/main`: **FAIL** (cần `app.module.ts`, `privileged/*` từ #25/#26) ⇒ không tách được #28+ khỏi trục.
- #28→#54: không đổi `app.module`, controller, Prisma; chỉ có 1 tệp `.sql.txt` đề xuất (F09). ⇒ mô-đun auth offline, **chưa gắn**.
- #15–#20 thêm `schema.prisma` + 4 migration (chưa áp DB). #25 sửa `app.module.ts` (APP_GUARD `AccessGuard`, thắt chặt thêm).

**Trục frontend:**
`main ← #58 ← #59 ← #60 ← #61 ← #62 ← {#64, #65}`; `#65 ← #66 ← #69 ← #72 ← #74 ← {#75, #76}`; `#75 ← {#78, #79}`; `#79 ← #83 ← {#85, #95}`; `#85 ← #86 ← {#87 ← #88, #89 ← #92, #94 ← #96, #98}`; `#76 ← #82`.
Nhánh đăng nhập: `main ← #67 ← {#68 ← #70 ← #71, #73 ← #77 ← #81}`. Độc lập từ main: #55, #56, #57, #63, #80, #100.

## 2. Trùng / cherry-pick / bị bỏ sót (patch-id + merge-tree)
| Loại | PR | Bằng chứng |
|---|---|---|
| Trùng hệt (patch-id) | #16 ≡ commit `1188977` trong #17 | cùng patch-id |
| Đã cherry-pick vào tuyến khác | #76,#77 → #79; #78,#82 → #85; #81 → #83; #67,#68,#70,#71,#73 → #75; #87,#94 → #98 | patch-id trùng; `preview/*` (#75, #79) chỉ là nhánh demo gộp |
| Trùng gần đúng | #64 ≈ `7f271f5` (trong #69), khác ~18 dòng | #64 + tip #98 **xung đột** `CustomerForm.jsx`, `customerApiUi.js` ⇒ #64 bị #69 thay thế |
| Bị bỏ sót (không có trong tip FE #98) | #88, #89, #92, #95, #96 (FE); #84, #90, #91, #93 (hợp đồng BE) | merge-tree vào tip **sạch** (rc=0); #90/#91/#93 đôi một cũng sạch |
| Độc lập, sạch | #63, #80 (CI), #55–#57, #100 | merge-tree với tip #98 rc=0 |
| Tên gần giống nhưng KHÔNG trùng | #23 vs #24 (guard DB) | tệp thay đổi khác nhau hoàn toàn |
| Đừng gộp riêng | #75, #79, #78, #64 | nội dung đã nằm trong tip #98/#85; #78 vs tip xung đột add/add |

Tip FE #98 + tip BE #84 gộp thử: **sạch** (rc=0).

## 3. Thứ tự tích hợp ít rủi ro (đề xuất — chưa thực hiện)
Mỗi bước dùng **nhánh tích hợp mới** từ `origin/main`, squash qua PR riêng; không merge/rebase/cherry-pick lên nhánh hiện hữu.

1. **L1 – Frontend offline** (chỉ `frontend/siscom-crm-web`, không DB): tip #98 (gồm #58–#62, #65, #66, #69, #72, #74, #75…#86, #87, #94) + #95, #92, #88, #96, #89; bỏ #64, #76–#78, #81, #82 (đã có). Kiểm: `npm run build` + `node --test` trong `frontend/siscom-crm-web/`. Nhắc: đảm bảo cờ API/đăng nhập vẫn **mặc định tắt** (tiêu đề #67, #70, #83 nêu vậy — cần xác nhận bằng test).
2. **L2 – Backend nền an toàn** (không DB): trục #15→#21→#25→#26→#28…#54, thêm #84/#90/#91/#93 (test-only). Kiểm: `npx tsc --noEmit -p tsconfig.json`, `npm run test:unit` trong `backend/`. Migration M1 chỉ là tệp; `prisma migrate deploy` cần duyệt riêng (ngoài phạm vi).
3. **L3 – Hợp đồng FE↔BE** (offline, throwaway): L1+L2 trên nhánh tạm; chạy harness #96 + hợp đồng #84. Chỉ là bằng chứng tương thích, không phải nghiệm thu CRM.

## 4. Checklist 1 trang — đường tới CRM dùng được
- [ ] Duyệt: người duyệt ≠ tác giả cho L2 (bảo mật/migration) — CONTRIBUTING §3.
- [ ] L1 build + node --test PASS (chưa chạy) → PR ➜ review ➜ squash.
- [ ] L2 tsc + unit PASS (chưa chạy) → PR ➜ review ➜ squash (theo trục, không bỏ #15–#26).
- [ ] L3 harness hợp đồng PASS (chưa chạy).
- [ ] Đóng PR thay thế/trùng sau khi L1/L2 vào: #16, #64, #75, #76–#79, #81, #82, #78 (đề xuất, người dùng quyết).
- [ ] CI độc lập: #63, #80; scripts: #22, #23, #24 (xử lý riêng, gốc #22/#24 cần cập nhật theo `origin/main`).
- [ ] **BLOCKED chờ phê duyệt (không tự quyết):** AuthController, `ActorProvider` DB thay `DenyAll`, bootstrap admin, Bearer/JWT/refresh/CSRF/CORS production, áp migration lên DB. Không có các mục này thì API vẫn luôn 401 ⇒ chưa có CRM dùng được thật.

## 5. Chưa kiểm chứng
Không build/test/chạy app; không đọc nội dung cờ mặc định ngoài tiêu đề PR; không kiểm tra kết quả CI của từng PR; trùng/bỏ sót dựa vào patch-id và merge-tree (xung đột sạch ≠ test đạt).
