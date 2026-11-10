# AGENTS.md — Quy tắc an toàn cho trợ lý lập trình AI

Áp dụng cho mọi tác tử làm việc trong kho này. Quy tắc nhấn mạnh **an toàn dữ liệu trước, tốc độ sau**. Khi nghi ngờ: dừng lại và hỏi.

**Vai trò và review:** Claude (Kai) là CTO, kiến trúc sư, lập trình viên và người sửa lỗi; ChatGPT là reviewer độc lập; Owner phê duyệt quyết định quan trọng. Codex là developer hỗ trợ và Gemini là QA độc lập, chỉ chạy khi Owner duyệt từng việc; Codex chỉ chạy khi **chuẩn cách ly** (mục 10.3 tài liệu quy trình) còn đạt — mọi file bí mật phải có quyền **chỉ tài khoản Owner** và không để bí mật ở nơi sandbox Codex đọc được (ví dụ thư mục Temp). Mọi PR theo [docs/QUY_TRINH_PHOI_HOP_AI.md](docs/QUY_TRINH_PHOI_HOP_AI.md): tối đa 3 vòng review, chỉ review diff mới, gom lỗi theo nhóm, không báo lại lỗi đã đóng.

## 1. Bắt đầu mỗi phiên
1. Đọc [`docs/STATUS.md`](docs/STATUS.md) (hiện trạng ngắn; trỏ tới tài liệu chi tiết theo hạng mục), [CONTRIBUTING.md](CONTRIBUTING.md) và [quy trình phối hợp AI](docs/QUY_TRINH_PHOI_HOP_AI.md).
2. Kiểm tra nhánh hiện tại và `git status`. Không làm việc trên `main`; dùng nhánh riêng và Pull Request. Không tự merge, không push khi chưa được người dùng chấp thuận.
3. Chỉ ghi vào báo cáo những gì đã **xác minh** từ kho hoặc từ kết quả chạy thật. Không suy đoán trạng thái nghiệm thu, không tuyên bố PASS khi chưa có kết quả thật.

## 2. Tuyệt đối không (nếu người dùng chưa duyệt riêng, bằng văn bản)
- Chạy lệnh **ghi** vào database: migration, seed, reset, restore, `DROP`/`DELETE`/`TRUNCATE`, hoặc bất kỳ script nào tác động database.
- Dùng `prisma migrate dev`, `prisma migrate reset`, `prisma db push`, `prisma db execute` với dữ liệu thật. Chỉ `prisma migrate deploy` được phép khi đã được duyệt, trên đúng database đã nêu.
- Chạm database chính `siscom_crm_dev`, hoặc các database đã khóa làm baseline (xem [`docs/PROGRESS_B1.2.3-B2.md`](docs/PROGRESS_B1.2.3-B2.md)). Tên database thử hợp lệ: `siscom_crm_restore_*`, `siscom_crm_test_*`.
- Sửa, tạo lại, đổi tên, lưu lại hay đổi xuống dòng của **migration đã áp dụng** (kể cả `migration_lock.toml`). Không chạy lại `backend/scripts/assemble-b122-migration.cjs`.
- Đọc, in, sao chép, commit hay đưa vào log: `.env`, mật khẩu, khóa, JWT secret, chuỗi kết nối, bản sao lưu, dump, dữ liệu khách hàng thật. Không ghi đè `.env`, `package-lock.json`, `node_modules`.
- Thêm hoặc nâng dependency; đổi `package.json`, `.gitignore`, `.gitattributes` khi chưa có yêu cầu và PR riêng.
- Đổi ngưỡng nghiệm thu, công thức tìm kiếm/relevance, hợp đồng API đã chốt, hoặc các baseline đã nghiệm thu (P1/P2/B1.2.3…).
- Chạy benchmark hiệu năng hoặc bộ integration test khi không được yêu cầu rõ. Không chạy lại bài đã đạt nếu không có thay đổi ảnh hưởng.
- `git push --force`, `git reset --hard` trên nhánh dùng chung, xóa nhánh/tag của người khác, `git add -f` các tệp bị ignore (ví dụ `*.sql`) khi chưa có PR xử lý việc đó.
- Xóa file trùng, dọn mã, đổi kiến trúc khi chưa được duyệt.

## 3. Quy tắc làm việc
- **Phạm vi nhỏ:** một yêu cầu = một thay đổi tối thiểu. Không "tiện tay" sửa nơi khác. Gợi ý cải tiến thì ghi lại để người dùng quyết.
- **Modular Monolith:** thêm miền nghiệp vụ = module riêng trong `backend/src/modules/<miền>`; dùng module khác qua giao diện export, không import chéo vào nội bộ; `backend/src/common` chỉ hạ tầng.
- **Mặc định từ chối:** không làm yếu cơ chế từ chối khi chưa xác thực. Danh tính không được lấy từ nội dung request. Không đưa provider/checker giả vào `src` (chỉ trong `test`).
- **Frontend chính thức:** `frontend/siscom-crm-web`. Không dùng các bản sao giao diện trong `backend/src`.
- **Migration mới:** chỉ cộng thêm, tương thích ngược, có test ràng buộc, rollback viết sẵn (không tự chạy), thử trên bản sao database mới trước. Không chứa dữ liệu thật hoặc bí mật.
- **Kiểm thử:** chỉ chạy phần liên quan; ghi kết quả thật. Môi trường không chạy được (không có Node/PostgreSQL) thì nêu rõ "chưa kiểm chứng".
- **Giao file cho người dùng Windows:** ghi rõ đường dẫn đích trên `D:\SISCOM-CRM\…`, phân biệt **file mới** và **file chép đè**, nêu file không đụng tới, có bước sao lưu và rollback.
- **Ngôn ngữ:** báo cáo và tài liệu bằng tiếng Việt, ngắn gọn, nêu rõ điều đã xác minh và điều chưa kiểm chứng.

## 4. Khi gặp tình huống không chắc
Dừng, nêu vấn đề, đưa phương án và rủi ro, chờ người dùng quyết. Với mọi thao tác không thể hoàn tác (dữ liệu, lịch sử Git, bí mật), mặc định là **không làm**.
