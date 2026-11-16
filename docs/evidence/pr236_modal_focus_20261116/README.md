# Nghiệm thu trình duyệt thật — PR #236 (F-A8-02, Modal quản lý focus) — 16/11/2026

Bằng chứng cho `PR236-R1-TEST-01`. Chạy trên bản code cuối của R2 (sau khi sửa `PR236-R1-UI-01` và lỗi "đang bận" phát hiện ở dưới).

## Môi trường
- **Backend thật** (`backend/dist/main.js`, NestJS) trên `127.0.0.1:3236`, **PostgreSQL 18.6 tạm cách ly**: cụm `initdb` riêng (`cluster_name = siscom_pr236_temp`), cổng `55623`, chỉ nghe `127.0.0.1`, thư mục dữ liệu ngoài repo, DB `siscom_crm_test_20261116_236000`; `prisma migrate deploy` + `seed-lookups` + `bootstrap-auth` (5 tài khoản thử, mật khẩu sinh ngẫu nhiên, không lưu trong repo). **Đã dừng và xoá cụm sau khi chạy.** Không đụng DB thật 5432 hay cụm demo 55433.
- Dữ liệu thử tạo qua API: 2 khách, mỗi khách 1 người liên hệ + 3 công việc + 1 cuộc gọi; 1 việc giao cho kỹ thuật viên (để có "Đề xuất chuyển").
- **Frontend**: `vite` dev của nhánh PR, `VITE_CRM_AUTH_ENABLED=true`, `VITE_CRM_API_ENABLED=true`, `/api` proxy sang backend (cùng origin `http://localhost:5236`); đăng nhập phiên cookie thật (admin `NV-0002`, kỹ thuật `NV-0004`).
- Trang chỉ có ở chế độ demo (`CustomerProfile`, `CustomerIO`): bản build dev không cờ trên `http://localhost:5237`.
- **Trình duyệt**: Chromium (Browser pane của app Claude). Phím **thật** (Enter/Tab/Shift+Tab/Escape) và **chuột thật**; trạng thái đo bằng một listener `focusin` cấp document trong trang (chỉ đọc).

## Cách đo mỗi ca
1. Đặt focus lên nút mở (Enter) hoặc bấm chuột nút/mục menu.
2. **Focus khi mở**: `document.activeElement` nằm trong `[role=dialog]` trên cùng.
3. **Tab / Shift+Tab**: nhấn N lần Tab rồi N lần Shift+Tab; đếm mọi lần focus đổi phần tử (`focusin`) và bao nhiêu lần nằm trong hộp. (Ô ngày giờ chuyển giữa các ô con bên trong nên số lần đổi phần tử có thể < 2N.)
4. **Escape**: hộp đóng.
5. **Trả focus**: `document.activeElement` là đúng phần tử đã mở (mục menu `<div>` ⇒ nút "Thao tác khác").

## Kết quả (17/17 đạt)
| # | Hộp thoại (component) | Mở bằng | Focus khi mở | Tab/Shift+Tab trong hộp | Escape đóng | Focus trả về |
|---|---|---|---|---|---|---|
| 1 | Hoàn thành công việc (`TaskActions`) — kèm bấm vào vùng chữ trong hộp rồi Tab/Shift+Tab | Enter | ô Kết quả | 20/20; sau khi bấm vùng chữ: focus ở khung hộp, Tab ⇒ nút Đóng, Shift+Tab ⇒ nút Hoàn thành | ✔ | nút Hoàn thành ✔ |
| 2 | Hoàn thành công việc — **đang bận** (dòng bị khoá 15 s trong DB tạm) | Enter | ô Kết quả | khi bận: Huỷ/Hoàn thành disabled, focus rơi về `<body>`; Tab ⇒ về ô Kết quả trong hộp, các lần sau ở trong hộp | Escape khi bận **không** đóng ✔; hết bận (409) hộp vẫn mở, báo lỗi; Escape ⇒ đóng | nút Hoàn thành ✔ |
| 3 | Sửa hoạt động (`TaskActions`, menu) | chuột | ô Tiêu đề | 10/10 | ✔ | "Thao tác khác" ✔ |
| 4 | Giao lại công việc (menu) | chuột | ô tìm người | 24/24 | ✔ | "Thao tác khác" ✔ |
| 5 | Huỷ công việc này? (xác nhận `App.jsx`, menu) | chuột | nút **Không** | 16/16 | ✔ | "Thao tác khác" ✔ |
| 6 | Lịch sử thay đổi (menu) | chuột | nút Đóng (chân) | 12/12 | ✔ | "Thao tác khác" ✔ |
| 7 | Xoá hoạt động (menu) | chuột | ô lý do | 12/12 | ✔ | "Thao tác khác" ✔ |
| 8 | Đề xuất chuyển người phụ trách (menu, tài khoản kỹ thuật) | chuột | ô lý do | 24/24 | ✔ | "Thao tác khác" ✔ |
| 9 | Thêm người liên hệ (`CustomerApiDetail`) | Enter | ô Họ tên | 30/30 | ✔ | nút Thêm người liên hệ ✔ |
| 10 | Sửa người liên hệ (`CustomerApiDetail`) | chuột | ô Họ tên | 30/30 | ✔ | nút Sửa người liên hệ ✔ |
| 11 | Xoá người liên hệ …? (xác nhận `App.jsx`) | chuột | nút **Huỷ** | 12/12 | ✔ | nút Xoá người liên hệ ✔ |
| 12 | **Huỷ ghi nhận? chồng lên drawer** "Ghi nhận hoạt động" (đã gõ nội dung, Escape trong drawer) | Escape | nút Tiếp tục nhập | 12/12 | ✔ chỉ đóng hộp xác nhận; drawer **vẫn mở, giữ nội dung** | ô nội dung trong drawer ✔ |
| 13 | Thêm người liên hệ (`CustomerProfile`, demo) | Enter | ô đầu | 30/30 | ✔ | nút Thêm ✔ |
| 14 | Sửa người liên hệ (`CustomerProfile`, demo) | Enter | ô đầu | 30/30 | ✔ | nút Sửa ✔ |
| 15 | Không thể xoá khách hàng (xác nhận `App.jsx`, demo) | Enter | nút Huỷ | 12/12 | ✔ | nút Xoá khách hàng ✔ |
| 16 | Xuất danh sách khách hàng (`CustomerIO`, demo) | Enter | ô đầu | 40/40 | ✔ | nút Xuất ✔ |
| 17 | Nhập khách hàng từ file (`CustomerIO`, demo) | Enter | vùng chọn file | 20/20 | ✔ | nút Nhập ✔ |

Ghi chú:
- Chế độ API: nút **Nhập** bị tắt và **Xuất** tải CSV trực tiếp (không mở hộp) ⇒ hai hộp `CustomerIO` chỉ có ở chế độ demo (ca 16–17).
- **Lỗi phát hiện trong lượt nghiệm thu này và đã sửa trước khi chạy bảng trên** (ca 2): bản `9a8c470` — khi bấm lưu, nút bị disabled ⇒ focus về `<body>` ⇒ 7/9 lần Tab đi ra trang phía sau. Sửa: listener `keydown` cấp document kéo Tab về hộp trên cùng khi focus nằm ngoài hộp (test `modalFocus.test.mjs` "đang bận…").
- Sau khi lưu thành công (không bận lâu), focus về đúng phần tử nút của dòng (React tái dùng phần tử; nhãn đổi thành "Mở lại").

## Kết quả thô (JSON, trích từ trang)
```json
[
  {"label":"TaskActions: Hoàn thành — đang bận (bản sửa R2)","title":"Hoàn thành công việc","focusOnOpen":true,"firstFocus":"TEXTAREA","tabInside":"(đang bận) 1/1","closedByEscape":true,"focusReturned":true,"opener":"BUTTON Hoàn thành"},
  {"label":"CustomerApiDetail: Thêm người liên hệ (Enter)","title":"Thêm người liên hệ","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"30/30","closedByEscape":true,"focusReturned":true,"opener":"BUTTON Thêm người liên hệ"},
  {"label":"CustomerApiDetail: Sửa người liên hệ (chuột)","title":"Sửa người liên hệ","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"30/30","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Sửa người liên hệ Anh Liên Hệ 0]"},
  {"label":"CustomerApiDetail: Xoá người liên hệ — xác nhận App (chuột)","title":"Xoá người liên hệ Anh Liên Hệ 0?","focusOnOpen":true,"firstFocus":"BUTTON Huỷ","tabInside":"12/12","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Xoá người liên hệ Anh Liên Hệ 0]"},
  {"label":"Modal xác nhận chồng lên drawer Ghi nhận (Escape trên drawer)","title":"Huỷ ghi nhận?","focusOnOpen":true,"firstFocus":"BUTTON Tiếp tục nhập","tabInside":"12/12","closedByEscape":true,"focusReturned":true,"opener":"TEXTAREA Nội dung thử chưa lưu","dialogsAfter":["Ghi nhận hoạt động"],"drawerTextKept":"Nội dung thử chưa lưu"},
  {"label":"TaskActions menu: Đề xuất chuyển (kỹ thuật, chuột)","title":"Đề xuất chuyển người phụ trách","focusOnOpen":true,"firstFocus":"TEXTAREA","tabInside":"24/24","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Thao tác khác]"},
  {"label":"TaskActions: Hoàn thành (Enter) + bấm vào vùng chữ trong hộp rồi Tab","title":"Hoàn thành công việc","focusOnOpen":true,"firstFocus":"TEXTAREA","tabInside":"20/20","closedByEscape":true,"focusReturned":true,"opener":"BUTTON Hoàn thành"},
  {"label":"menu: Sửa","title":"Sửa hoạt động","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"10/10","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Thao tác khác]"},
  {"label":"menu: Giao lại","title":"Giao lại công việc","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"24/24","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Thao tác khác]"},
  {"label":"menu: Huỷ việc (xác nhận App)","title":"Huỷ công việc này?","focusOnOpen":true,"firstFocus":"BUTTON Không","tabInside":"16/16","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Thao tác khác]"},
  {"label":"menu: Lịch sử","title":"Lịch sử thay đổi","focusOnOpen":true,"firstFocus":"BUTTON Đóng","tabInside":"12/12","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Thao tác khác]"},
  {"label":"menu: Xoá","title":"Xoá hoạt động","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"12/12","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Thao tác khác]"},
  {"label":"CustomerProfile (demo): Thêm người liên hệ (Enter)","title":"Thêm người liên hệ","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"30/30","closedByEscape":true,"focusReturned":true,"opener":"BUTTON Thêm"},
  {"label":"CustomerProfile (demo): Sửa người liên hệ (Enter)","title":"Sửa người liên hệ","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"30/30","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Sửa]"},
  {"label":"App xác nhận (demo): Xoá khách hàng (Enter)","title":"Không thể xoá khách hàng","focusOnOpen":true,"firstFocus":"BUTTON Huỷ","tabInside":"12/12","closedByEscape":true,"focusReturned":true,"opener":"BUTTON[Xoá khách hàng]"},
  {"label":"CustomerIO (demo): Xuất (Enter)","title":"Xuất danh sách khách hàng","focusOnOpen":true,"firstFocus":"INPUT","tabInside":"40/40","closedByEscape":true,"focusReturned":true,"opener":"BUTTON Xuất"},
  {"label":"CustomerIO (demo): Nhập (Enter)","title":"Nhập khách hàng từ file","focusOnOpen":true,"firstFocus":"DIV Kéo thả file vào đây hoặc bấm","tabInside":"20/20","closedByEscape":true,"focusReturned":true,"opener":"BUTTON Nhập"}
]
```
