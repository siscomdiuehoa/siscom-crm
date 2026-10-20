# Tiến độ B1.2.3-B2 – Customer Search Performance (cập nhật 2026-10-16, cuối ngày)

## Trạng thái một dòng
**P1 ĐẠT, baseline khóa. P2-1, P2-2, P2-3b-0 ĐẠT (unit 165/165, integration 69/69). P2-3 KHÔNG nghiệm thu hoàn toàn: 26/30 ca đạt; 4 ca còn vượt ngưỡng (list p100 150,0 ms; relevance nguyen van/mi/an). P2-3c (cột fold STORED) đã nghiên cứu xong và KHÔNG triển khai. Không migration production, không sửa src thêm. Không đo lặp. Ngưỡng giữ nguyên.**

## VIỆC TIẾP THEO (đọc đầu tiên khi quay lại)
Xem mục "Kết luận P2-3c" và "Thứ tự ưu tiên" ở cuối file.

## Ràng buộc đã chốt (không đổi nếu người dùng không duyệt)
- Ngưỡng nghiệm thu: danh sách p95 < 150 ms; tìm kiếm ≥ 3 ký tự < 500 ms từng từ khóa; 2 ký tự < 1.500 ms. Không hạ ngưỡng, không giới hạn kết quả, không đổi định nghĩa relevance, giữ `buildSearchOrder` + tie-break `c.code DESC`.
- Không sửa schema, migration, dependency, `.env`, authentication; không thêm migration cho `nguyen van`. Không chạm `siscom_crm_dev`. Không tạo thêm benchmark P1.
- Môi trường thiết kế không có Node/TS/Jest/PostgreSQL/PowerShell: không tuyên bố build/test đạt khi chưa có kết quả thật.
- Giao file: ZIP có cấu trúc `SISCOM-CRM/backend/...`, ghi rõ đường dẫn đích và file chép đè.

## Quyết định kỹ thuật
- **V5 (UNION + `count(*) OVER ()` + điểm relevance của src) là thiết kế mặc định; V7 (điểm liên hệ bằng LATERAL) chỉ dự phòng**: dùng V7 chỉ khi sau P2-3 một từ khóa vượt ngưỡng ở mức API, V7 cải thiện p95Worst ≥ 15% đúng ở từ khóa đó và test tương đương đạt.
- V3/V6/V8 (`IN (… UNION ALL …)`) bị loại: V3 treo 120 s khi thống kê `owner_id` cũ (Nested Loop Semi Join, ước lượng 1 dòng; r5-B xác nhận). Trên thống kê đúng V3 xong 163–377 ms.
- Đường chọn: UNION khi không `deleted=only` và chuỗi đã fold ≥ 3 ký tự; còn lại giữ OR (2 ký tự, `deleted=only`).
- Prisma timeout giao dịch KHÔNG hủy câu SQL đang chạy (T2: `pg_sleep(5)` chạy trọn 5.008 ms với timeout 2.000 ms); timeout hiển thị bằng P2028 ở câu kế tiếp. Không gửi câu ghi sau hạn (lỗi Prisma #29762). Đề xuất `SET LOCAL statement_timeout` từng câu: `docs/B1.2.3_B2_TX_SAFETY.md` (đề xuất, chưa áp dụng).
- Sort mặc định API là `createdAt` (không tính điểm); `relevance` chỉ khi chọn. Phải đo riêng từng sort; ngưỡng nghiệm thu giữ theo ca `relevance` trong `search.perf-spec.ts`.

## Kết quả P1 (đã nghiệm thu)
- Bài 1 (V1–V8 khớp V1), 3, 4, 5, 7: ĐẠT. Bài 6 (r5-C): 22/22 nhóm (S0a + 21 kịch bản) PASS trên bản sao đã ANALYZE, ~109 s, rollback/fingerprint đạt.
- r5-A (T1/T2 timeout Prisma) ĐẠT; r5-B (V3 thống kê mới) ĐẠT.
- p95Worst lõi `relevance` (V5 / V7): nguyen van 728,4 / 722,8 ms (**VƯỢT 500**); minh phat 206,5 / 231,5; dien lanh 275,3 / 268,7; cumperf 79,1 / 76,2. Chưa có trong tay: p95 V1–V4, V6, V8 và EXPLAIN (nằm trong `bench_*.json`/`bench_plans_*.json` đã khóa).
- `0912345` trả 0 kết quả (không phải kiểm thử SĐT); `mi` chỉ đo với `sortBy=createdAt`.

## Cơ sở dữ liệu
- Nguồn `siscom_crm_restore_20261014_214105`: không bị sửa. Bản sao đã ANALYZE `siscom_crm_restore_20261015_214948` (đã commit setup, autovacuum `customer` tắt): giữ đến hết P2 rồi xóa thủ công (`DROP DATABASE`, cần `postgres`). `siscom_crm_dev`: chưa từng bị chạm.
- Môi trường: PostgreSQL 18.6; `@prisma/client` và `@prisma/adapter-pg` 7.10.0.

## P2-1 (đã giao, chờ nghiệm thu)
- File: `src/modules/customers/customers.search.ts` (thêm `textBranches`, `buildOuterWhere`, `chooseSearchPath`, `buildSearchPageQuery`, `buildSearchCountQuery`; `buildSearchWhere` dựng lại, SQL/tham số giữ nguyên), `customers.search.spec.ts` (+16 test, kỳ vọng tổng unit 165), `docs/B1.2.3_B2_P2_REPORT.md`. **`customers.service.ts` chưa sửa** → hành vi production chưa đổi.
- Người dùng cần: sao lưu 2 file cũ vào `D:\SISCOM-CRM\backups\p2-1-before\`, chép đè, chạy `npx tsc --noEmit -p tsconfig.json`, `npx jest src/modules/customers/customers.search.spec.ts`, `npm run build`, `npm run test:unit`, integration (66 test) trên DB thử MỚI. Điểm nghi: cú pháp `type SearchWhereInput` trong import của spec.

## Việc tiếp theo (theo thứ tự, mỗi bước chờ duyệt)
1. Nhận kết quả P2-1 từ người dùng (tsc/jest/build/unit/integration). Sửa nếu có lỗi.
2. **P2-2:** gắn vào `runSearch` trong `customers.service.ts`: fold → `chooseSearchPath` → một truy vấn trang kèm tổng; trang rỗng: `page = 1` ⇒ tổng 0, `page > 1` ⇒ `buildSearchCountQuery`; giữ nguyên `findMany` theo thứ tự ID, REPEATABLE READ, `MAX_OFFSET_WINDOW`, mã lỗi. Thêm `test/customers.search-equivalence.int-spec.ts` (UNION so với OR: total, toàn bộ ID đúng thứ tự, trang đầu/giữa/cuối/vượt cuối; ma trận từ khóa gồm SĐT có kết quả nhiều dạng, 2 ký tự × mọi sort, quyền ALL/OWN/DEPARTMENT/không quyền, `deleted`/`deleted=only`, bộ lọc).
3. **P2-3:** trên DB thử MỚI: build, unit, integration, `search.perf-spec.ts` ngưỡng 150/500/1.500 ms (đo `nguyen van` theo mức API cả `relevance` và `createdAt`).
4. Nếu `nguyen van` + `relevance` vẫn ≥ 500 ms: P2 chưa đạt → P2-1b (H1: chỉ tối ưu truy vấn, bảo toàn thứ tự, ví dụ gộp điểm liên hệ bằng `GROUP BY` một lần, tính fold một lần) → nếu vẫn không đủ: lập báo cáo H2/H3 (cột fold sinh sẵn + trigram, hoặc bảng tìm kiếm phi chuẩn hóa; cần migration, **chỉ khi người dùng duyệt riêng**).
5. P2-4: báo cáo `docs/B1.2.3_B2_P2_REPORT.md` hoàn chỉnh; rồi mới B1.2.3-B3.

## Mục mở ngoài P2
- Cảnh báo adapter-pg `client.query()` chồng truy vấn: theo dõi riêng.
- Tải `bench_*.json`/`bench_plans_*.json` lên dự án nếu muốn điền đủ bảng p95 V1–V8 (hiện chỉ có số do người dùng trích).

## Gói đã giao (theo thứ tự, trong thư mục gốc dự án thiết kế)
`SISCOM-CRM-B1.2.3-B2-PATCH1.zip`, `…-P1-BENCH.zip`, `…-P1-BENCH-r2.zip`, `…-P1-PROOFONLY-r3.zip`, `…-P1-SCENARIOS-r4.zip`, `…-P1-R4_1.zip`, `…-P1-R4_2.zip`, `…-P1-R5A.zip`, `…-P1-R5B.zip`, `…-P1-R5C.zip`, `…-P1-ACCEPTANCE-P2-PLAN.zip`, `…-P1-ACCEPTANCE-v2-R5C-PLAN.zip`, `…-P1-FINAL-P2-0-PLAN.zip` (gồm nghiệm thu P1 bản 3, khóa baseline, kế hoạch P2-0, `lock-p1-baseline`), `SISCOM-CRM-B1.2.3-B2-P2-1.zip`. Mã nguồn các gói nằm dưới `_export/deliveries/B1.2.3-B2-P1/`, `…-P1-acceptance/`, `…-P2-1/`.

## Cập nhật P2-3 (2026-10-16)
- P2-1 (tsc/build/unit 165/165) và P2-2 (integration 68/68) đã nghiệm thu; V5 đã tích hợp vào Customer API.
- P2-3 đo API trên bản sao `siscom_crm_restore_20261015_214948`: 26/30 ca đạt. 4 ca FAIL: list/all/p100 315,7 ms (150); nguyen van/relevance 709 ms (500; EXPLAIN 674,7 ms vs createdAt 107,5 ms, SubPlan điểm liên hệ 19.794 lần); mi/relevance 1.915,6 ms và an/relevance 2.123,9 ms (1.500; chưa có EXPLAIN).
- Chờ duyệt kế hoạch `docs/B1.2.3_B2_P2_3A_PLAN.md`: A = điểm liên hệ theo tập (GROUP BY), B = cùng cách cho đường OR 2 ký tự, C = migration (cột fold sinh sẵn; cần duyệt riêng). Bước A là chẩn đoán chỉ đọc; chưa sửa `src`.
- Quy trình tinh gọn (từ 2026-10-16): không chạy lại P1/test đã PASS; chỉ kiểm thử phần bị ảnh hưởng; một lượt build+unit+integration sau mỗi bước hoàn thiện; benchmark chỉ ở P2-3; nghiệm thu cuối xác nhận mọi kiểm tra bắt buộc trên mã cuối. DB thử tái dùng: `siscom_crm_restore_20261016_201553` (e2e), bản sao PERF `…20261015_214948` (đo).

## Cập nhật P2-3a bước A (2026-10-16)
- Kết luận: A1/A2 KHÔNG vào production (nguyen van và an vẫn vượt cổng SQL; A3 dừng vì statement_timeout 57014, không có kết quả so khớp; `failures=[]` không phải nghiệm thu). Không tăng statement_timeout; không chạy lại P2-3a/P1.
- Trang 100: COUNT 3,8 ms; Prisma skip1980 tối đa 160,9 ms.
- Chờ duyệt `docs/B1.2.3_B2_P2_3B_PLAN.md`: P2-3b-0 (trang 100, không migration, mẫu 2 bước như runSearch); Phương án 1 = cột `contact.full_name_fold` GENERATED STORED (cần migration + xử lý schema Prisma, cần duyệt riêng); Phương án 2 = thêm cột fold cho customer. Cần dữ liệu `a0.derived` và `a4.sqlIdsOnly_offset1980` từ JSON để chốt. Chưa viết migration, chưa sửa src.

## Cập nhật P2-3b-0 (2026-10-16)
- P2-3b-0 (phân trang 2 bước cho trang sâu của danh sách) đạt: unit 165/165, integration 69/69. Giữ nguyên bản vá.
- Đo trang 100 (ApiPerf, bản sao PERF `…_20261015_214948`): p95Worst 315,7 → 150,0 ms (−52,5%), VẪN FAIL (quy tắc < 150 ms); trang 1 = 98,2 ms PASS. Không đổi ngưỡng; không đo lại ngay; sẽ đo lại 1 lần ở lượt nghiệm thu cuối P2-3. Cách giảm thêm (nếu cần): chỉ mục sắp xếp (migration, cần duyệt riêng) – chưa làm.
- Ưu tiên tiếp: ba ca relevance nguyen van/mi/an. Chốt bằng a0.derived (foldMs vs similarityMs) có sẵn trong p23a_diag_2026-10-16T14-23-12-333Z.json: foldMs/(foldMs+similarityMs) ≥ ~30% → chuẩn bị (chưa chạy) migration contact.full_name_fold STORED + sửa nhánh relevance; < 30% → dừng, báo cáo quyết định nghiệp vụ về relevance 2 ký tự. Chưa viết migration, chưa sửa src.

## Cập nhật P2-3c thiết kế (2026-10-16)
- A0: fold 96,7 ms/158,3 ms (63,4% của chi phí hàm); S0 SubPlan: nguyen van 19.794×0,010ms, mi 29.691×0,013, an 49.485×0,011. Nhận định: cột fold riêng lẻ chỉ tiết kiệm ~4–7% S0; chỉ có ý nghĩa khi đi cùng gom điểm theo tập (A2-stored, ước ~62 ms cho 100.000 liên hệ). Dự đoán (chưa đo): SQL mi/an gần/đạt cổng, NHƯNG API vẫn > ngưỡng cả ba ca; API chậm hơn SQL S0 ~360–450 ms ở mi/an (chưa giải thích).
- Gói thiết kế: docs/B1.2.3_B2_P2_3C_DESIGN.md + docs/proposed-migration/{fold_precheck,up,down,fold_sync_test}.sql (KHÔNG nằm trong prisma/migrations). Chờ duyệt: áp up.sql CHỈ trên bản sao thử mới; cần schema.prisma (model Contact) + tên thư mục migrations. Chưa chạy migration, chưa sửa src/schema.

## Cập nhật P2-3c trạng thái (2026-10-18)
- DB thử: `siscom_crm_restore_20261016_221242`. Guard/Apply/Sync/Rollback: PASS. Drift: FAIL, Prisma đề xuất `ALTER TABLE "contact" DROP COLUMN "full_name_fold"` — đúng dự kiến (schema.prisma chưa khai báo cột). KHÔNG chạy lệnh DROP; không chạm `siscom_crm_dev`. Không tạo lại DB, không chạy lại bước đã PASS.
- Hệ quả cho migration production (chưa duyệt): phải khai báo cột trong `model Contact` (sửa schema, cần duyệt riêng) hoặc chấp nhận drift; phương án xử lý sẽ nêu trong báo cáo quyết định sau probe.
- Bước kế: chạy probe (`fold-verify.bat -DatabaseName siscom_crm_restore_20261016_221242 -TemplateDb siscom_crm_restore_20261015_214948 -Step probe`), gửi log + `fold_probe_*.json`. Phân tích: `equality.allOk`, `gateVerdict`, `decomposition.gapHttpMinusTxMedian`, `estimatedApiP95WorstAfterA2S`. Tiếp tục tối ưu chỉ khi A2-STORED đạt cổng SQL VÀ API ≤ ngưỡng (500/1.500 ms) ở nguyen van/mi/an; nếu SQL đạt nhưng API vẫn vượt → điều tra khoảng hở API−SQL, không migration.

## Cập nhật P2-3c kiểm chứng (2026-10-16)
- Đã đọc nguồn: f_vn_fold(p text) SQL IMMUTABLE PARALLEL SAFE STRICT (dùng unaccent STABLE bên trong → rủi ro lệch nếu đổi unaccent.rules, cùng loại với các chỉ mục ix_*_fold); schema.prisma model Contact không có trường fold; B1.2.2 đã chứng minh migrate diff --from-config-datasource không lệch với chỉ mục viết tay.
- Gói SISCOM-CRM-B1.2.3-B2-P2-3C-VERIFY.zip: fold-verify.ps1/.bat (guard|apply|sync|rollback|drift|probe), fold-probe.bench-spec.ts (S0 vs A2-stored, so khớp trong PG, phân rã SQL/API), SQL đề xuất, hướng dẫn. Template mặc định cho bản sao mới = ...20261015_214948 (chỉ đọc) — cần user xác nhận. Cấm làm đích: siscom_crm_dev, ...214105, ...214948. Chưa chạy gì; chưa sửa src/schema/migration.

## Kết luận P2-3c (2026-10-18) — CHỐT, KHÔNG TRIỂN KHAI
- Bản sao `siscom_crm_restore_20261016_221242`: Guard/Apply/Sync/Rollback PASS; Probe 3/3 Jest PASS, S0 và A2-STORED khớp tuyệt đối. Drift FAIL (schema.prisma chưa khai báo `full_name_fold`; Prisma đề xuất DROP COLUMN — đã KHÔNG chạy).
- SQL max A2-STORED: nguyen van 707,8 ms (cổng 500); mi 1.381,1 ms; an 1.383,4 ms (cổng SQL chưa đạt cả ba). Dự báo API (ƯỚC TÍNH, không phải đo): 651,7 / 1.170,1 / 1.318,6 ms. A2-STORED làm CHẬM cumperf và minh phat (từ khóa ít kết quả).
- Quyết định: (1) không đưa P2-3c vào DB chính; (2) giữ nguyên code Customer API và bản vá P2-3b-0; (3) không chạy thêm benchmark lặp; (4) không đổi ngưỡng; (5) KHÔNG đánh dấu P2-3 nghiệm thu hoàn toàn.
- Hạng mục hiệu năng CHƯA ĐẠT (ghi nhận, không che): list/all/p100 = 150,0 ms (quy tắc < 150); relevance nguyen van ≈ 709 ms (500); mi ≈ 1.916 ms (1.500); an ≈ 2.124 ms (1.500). Cùng truy vấn với sortBy=createdAt (mặc định API) đạt (nguyen van ≈ 107 ms).
- Đánh giá phương án nhỏ không migration: KHÔNG có phương án đủ chắc chắn. Lý do: sort relevance bắt buộc chấm điểm toàn bộ tập khớp (20–50 nghìn khách) rồi sắp xếp; cắt bớt liên hệ/ứng viên, giới hạn kết quả hoặc đổi công thức đều vi phạm ràng buộc (không đổi định nghĩa relevance, không giới hạn kết quả); gom điểm theo tập chỉ đáng nếu có cột fold (đã loại, làm chậm từ khóa ít kết quả); V7 đã đo không cải thiện ≥ 15%. Không đề xuất thử thêm.
- Lối thoát còn lại là QUYẾT ĐỊNH NGHIỆP VỤ/KIẾN TRÚC (chưa thực hiện, cần duyệt): (a) giữ sort mặc định createdAt và coi relevance cho từ khóa quá ngắn/phổ biến là giới hạn đã biết; (b) ngưỡng riêng cho relevance 2 ký tự; (c) bảng/chỉ mục tìm kiếm phi chuẩn hóa (trigram GIN, migration lớn) ở giai đoạn sau. Ngưỡng hiện hành chỉ đổi khi người dùng duyệt.
- Dọn dẹp: bản sao `…221242`, `…201553`, `…214948` xóa thủ công khi người dùng cho phép; không xóa `…214105`.

## Thứ tự ưu tiên tiếp theo
1. **P2-4 (ngắn):** hoàn thiện `docs/B1.2.3_B2_P2_REPORT.md` ở trạng thái "đạt có điều kiện": bảng 26/30 đạt, 4 ca chưa đạt, kết luận P2-3c, các lựa chọn (a)(b)(c). Chỉ viết tài liệu, không chạy gì.
2. **Quyết định của người dùng** về (a)/(b)/(c) — chặn việc đóng B2; không chặn các hạng mục dưới.
3. **B1.2.2/B1.2 Authentication + RBAC thực thi** theo `docs/B1.2_PLAN.md` (đang chờ phê duyệt): ưu tiên cao nhất cho chức năng, vì tìm kiếm hiện dùng quyền ALL/OWN/DEPARTMENT mà chưa có xác thực thật.
4. **TX safety:** áp `SET LOCAL statement_timeout` từng câu (`docs/B1.2.3_B2_TX_SAFETY.md`) — rủi ro vận hành thật (timeout Prisma không hủy SQL), cần duyệt.
5. **B3** theo kế hoạch B1.2.3 và các chức năng CRM còn thiếu (người dùng liệt kê ưu tiên; hiện chưa có danh sách trong tài liệu).
6. Dọn bản sao thử; sao lưu DB vào `D:\SISCOM-CRM\backups\` (cần đổi script mặc định, chờ duyệt).

## Quyết định 2026-10-18 (phương án A)
Giữ 4 ca relevance/p100 chưa đạt, tiếp tục các phân hệ CRM khác. Đã lập `deliveries/SISCOM-CRM/backend/docs/B1.2.3_B2_P2_REPORT.md` (nghiệm thu CÓ ĐIỀU KIỆN, không PASS toàn bộ) và `deliveries/SISCOM-CRM/docs/PLAN_NEXT_AUTH_RBAC.md` (kế hoạch B1.3, chưa triển khai). Không đổi ngưỡng/công thức, không migration, không chạy lại benchmark/test. Bước kế: anh trả lời 5 câu ở cuối PLAN_NEXT_AUTH_RBAC.md.

## B1.3.0 (2026-10-18) — thiết kế, chờ duyệt
Định hướng đã chốt: email+mật khẩu nội bộ; access JWT ngắn + refresh HttpOnly Secure cookie (rotation/revoke/CSRF); ma trận 6 vai trò B0 = bản nháp; dữ liệu mẫu; chuẩn bị 2FA không bắt buộc. Đã lập `deliveries/SISCOM-CRM/backend/docs/B1.3.0_DESIGN.md` (kiến trúc, ma trận, migration M1/M2, API, kế hoạch B1.3.1–5, kiểm thử, rollback, D1–D10). Chưa code, chưa migration. P2-4 vẫn "có điều kiện".

## B1.3.1 (2026-10-18) — thiết kế chi tiết, chờ duyệt (chưa code/migration/dependency)
D1–D10 đã chốt. Đã đối chiếu mã: ActorProvider chỉ có resolve+scopeFor (đồng bộ), KHÔNG có can(); `CustomersModule` đang dùng PendingAuditPort (mọi ghi bị chặn) và `create` chỉ cho scope ALL (OWN/DEPARTMENT cần CustomerAssignment — B3 chưa làm). Đăng nhập thật chưa làm ghi dữ liệu khách chạy được nếu chưa có DbAuditPort/gán chủ sở hữu. Tài liệu: `deliveries/SISCOM-CRM/backend/docs/B1.3.1_DETAILED_DESIGN.md` (ma trận 6×8 + khác biệt B0, tách sys./biz. không thêm vai trò, M1/M2, JWT/refresh/CSRF/khóa/audit/bootstrap, kiểm thử leo thang, rollback). Chờ D11–D15. P2-4 vẫn "có điều kiện".

## B1.3.1 rev.2 (2026-10-18) — thiết kế cuối, khóa có điều kiện
Đã chốt D11–D15. Phát hiện: verify-baseline-b123 chỉ đối chiếu nền B1.1; mã B1/B2/P2 chưa từng được đối chiếu → đã tạo verify-baseline-b130 (78 file, chỉ đọc), chờ người dùng chạy. M1 4 bảng đủ cho quy trình hai người (thêm ràng buộc + trigger chặn đường vòng + SoD, không thêm bảng). static-guards.spec.ts phải đổi có chủ ý khi đổi binding audit/provider. Chia B1.3.2a (DbAuditPort) và B1.3.2 (M1 + auth). Tài liệu: B1.3.1_FINAL_DESIGN.md. Chưa code/migration/dependency; chờ phê duyệt riêng. P2-4 vẫn "có điều kiện".

## Đối chiếu baseline B1.3.0 (2026-10-18)
verify-baseline-b130: KHỚP 75/78; 3 file Jest khác nhưng tương đương ngữ nghĩa (rootDir/testMatch/tsconfig tường minh), nguồn gốc không được ghi nhận → chấp nhận kèm ghi chú; manifest rev.2 cập nhật 3 hash. Toàn bộ src/package.json/schema/migration KHỚP, không có .ts lạ trong src. Không chép đè/hoàn nguyên Jest. B1.3.2a chưa bắt đầu, chờ xác nhận + phê duyệt riêng. Chi tiết: backend/docs/B1.3.0_BASELINE_JEST_RECONCILIATION.md.

## B1.3.2a (2026-10-18) — gói DbAuditPort đã soạn, CHƯA kiểm chứng
Người dùng duyệt sau verify-baseline-b130 KHỚP 78/78. Gói: DbAuditPort (ghi audit_log cùng giao dịch, lỗi => rollback), AuditModule, customers.module.ts đổi dây nối, static-guards.spec.ts cập nhật có chủ đích, test đơn vị (18 ca) + integration riêng test/audit.int-spec.ts (10 ca), run-audit-tests, verify-baseline-b132a. Không đổi schema/migration/.env/dependency/API/tìm kiếm; DenyAll giữ nguyên (mọi route 401). Chờ kết quả tsc/unit/integration từ máy người dùng; chưa áp dụng lên DB chính. Tài liệu: backend/docs/B1.3.2a_REPORT.md. P2-4 vẫn "có điều kiện".

## B1.3.2a NGHIỆM THU kỹ thuật trên môi trường thử (2026-10-18)
Người dùng báo: tsc PASS; unit liên quan 27/27; integration 79/79, 9/9 suite (69 cũ + 10 audit) trên siscom_crm_restore_20261016_201553; không chạy benchmark. Chốt nghiệm thu kỹ thuật trên môi trường THỬ; CHƯA triển khai production; DenyAll giữ nguyên; Customer API contract và baseline P1/P2 không đổi. Còn mở nhỏ: kết quả npm run test:unit toàn bộ và verify-baseline-b132a chưa thấy.
## B1.3.2 — kế hoạch (2026-10-18), chưa code
Chia 4 gói: A dependency+env (@nestjs/jwt 11.0.2, @nestjs/throttler 6.5.0, argon2 0.45.1 — cần xác nhận npm view), B M1 trên bản sao mới, C module auth (DenyAll giữ), D integration + nghiệm thu. Chi tiết: backend/docs/B1.3.2_PLAN.md. Không migration/thay đổi DB chính. P2-4 vẫn "có điều kiện".
## B1.3.2-A (2026-10-20) — dependency + biến môi trường auth, chờ review PR
Ghim @nestjs/jwt 11.0.2, @nestjs/throttler 6.5.0, argon2 0.45.1 (peer khớp Nest 11; argon2 nạp prebuild win32-x64, không cần phương án B). env.validation.ts kiểm biến auth; JWT_ACCESS_SECRET chưa bắt buộc (bật ở gói C). Đã chạy: tsc exit 0, test:unit 195/195, build exit 0. Không DB/migration/.env. Chi tiết: backend/docs/B1.3.2-A_AUTH_DEPS_REPORT.md. P2-4 vẫn "có điều kiện".
## B1.3.2-B (2026-10-20) — M1 auth core ĐÃ SOẠN, chưa áp DB, chờ review PR
Chủ dự án duyệt soạn thảo. Nhánh db/b1.3.2-b-auth-core: schema.prisma (+4 model, 3 enum), migration 20261020000000_b1_3_auth_core (cộng thêm; trigger hai người/SoD/khóa bootstrap/bất biến), test ràng buộc + rollback (file .sql cục bộ, .gitignore chặn — không add -f), auth-m1-verify.bat/.ps1. Kiểm tĩnh: prisma validate, diff offline. CHƯA chạy SQL/migration; chưa kiểm chứng trên PostgreSQL. Bước kế (cần duyệt riêng): bản sao mới từ mẫu ...214948 (chỉ đọc) → guard/apply/constraints/regress/rollback/drift. Chi tiết: backend/docs/B1.3.2B_REPORT.md. P2-4 vẫn "có điều kiện".
## B1.3.2-B sửa PR #15 (2026-10-20) — đóng gói, chưa áp DB
Test ràng buộc + rollback M1 đổi thành `backend/docs/B1.3_M1_CONSTRAINT_TESTS.sql.txt`, `B1.3_M1_ROLLBACK.sql.txt` (đã vào Git, không đổi `.gitignore`, không `add -f`); `auth-m1-verify.ps1` trỏ đường dẫn mới, in SHA sau chuẩn hóa LF. `migration.sql` không đổi. Rà soát tĩnh S1–S9 (B1.3.2B_REPORT.md mục 8): S1–S3 (chủ sở hữu bảng/GUC danh tính/ghi `password_hash`) = việc trước production; S4 (`employee.status` và LAST_*), S5 = sửa được trong M1 nhưng là thay đổi bảo mật mới — chờ duyệt. Chưa chạy SQL/DB; chưa kiểm chứng. P2-4 vẫn "có điều kiện".
## B1.3.2-B M1.1 (2026-10-20) — sửa S4/S5 bằng migration cộng thêm, CHƯA áp DB, chờ review PR
Chủ dự án duyệt triển khai S4/S5. Nhánh db/b1.3.2-b-m1-1-s4s5 (xếp chồng PR #17). Migration mới 20261020120000_b1_3_auth_m1_1_guards: trigger employee (LAST_ADMIN/LAST_APPROVER khi rời ACTIVE/xóa mềm, có khóa advisory; chặn kích hoạt lại người giữ admin/access.approve; bỏ qua khi khởi tạo; từ chối REPEATABLE READ) + trigger privileged_change_request (EXECUTED chỉ qua fn_auth_consume_request trong trigger, executed_by = actor ACTIVE). M1 không sửa (SHA giữ CE8AB3BB…94DC). Test/rollback/setup song song dạng .sql.txt + auth-m11-verify. Kiểm tĩnh: parser PS 0 lỗi, 0 CR/ngoài ASCII; rà soát chỉ đọc không có lỗi chặn. CHƯA chạy SQL, chưa kiểm chứng trên PostgreSQL. Chi tiết: backend/docs/B1.3.2B_M1_1_REPORT.md. S1–S3 vẫn là việc trước production. P2-4 vẫn "có điều kiện".
