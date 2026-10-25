# N02 — Auto-Runner chuyển prompt thiếu TASK_COMMENT_ID (CHỈ ĐỌC)

Task `SISCOM-N02-RUNNER-APPROVAL-PAYLOAD-READONLY` (Issue #8, task 6382704269, approval 6382704602, scope CODE_TEST_DRAFT_ONLY). Không sửa runner/state, không đọc config/.env, không gọi localhost.

## 1. Đối chiếu cặp comment (đọc từ GitHub API, Issue #8)
| Task | Task ID | Approval | Result | Ghi chú |
|---|---|---|---|---|
| L01 | 6382017281 | 6382017677 | 6382175028 | approval hợp lệ (3 dòng, đúng ID+scope); result = BLOCKED, "payload không có TASK_COMMENT_ID" |
| L02 | 6382018225 | 6382018692 | 6382179935 | như trên |
| L03 | 6382019068 | 6382019372 | 6382185216 | như trên |
| M01 | 6382559345 | 6382560605 (+ 6398675731) | 6398681585 (BLOCKED, 10-25 14:10) | result nói payload chỉ có `OWNER_APPROVED: REQUIRED_SEPARATE_COMMENT`, không có bằng chứng; 6398675731 là approval bổ sung do chủ repo đăng 10-25 |
| M02 | 6382561954 | 6382564011 | 6398940956 (10-25 14:34) | đã nhận được xác nhận approval, làm việc thật |
| M03 | 6382565252 | 6382568783 | 6398974449 (10-25 14:37) | có result |

Cả 6 approval L01–L03/M01–M03 đều qua `isOwnerApproval` (runner.mjs:43-59): đúng tác giả, id > task, dòng đầu `OWNER_APPROVED: YES`, khóa nằm trong danh sách cho phép, TASK_COMMENT_ID và SCOPE khớp. Không có approval nào thiếu/sai định dạng.

## 2. Quá trình và điểm lỗi (runner.mjs local, chưa commit)
| Bước | Vị trí | Kết quả |
|---|---|---|
| Lấy task comment (ID) | ghqueue.mjs:11-22; runner.mjs:146-149 | giữ `id` đúng (jq `{id,user,body}`) |
| Tìm approval | ghqueue.mjs:26-36; runner.mjs:60-67,151-153 | đúng |
| Xác thực tác giả + phạm vi | runner.mjs:43-59, 37-42 | đúng, fail-closed |
| Dựng prompt | runner.mjs:120-139 | **bản local hiện tại** thêm khối `VERIFIED_GITHUB_APPROVAL` có `TASK_COMMENT_ID: <c.id>` (dòng 121-138); prompt của chính task N02 chứa khối này |
| Auto-post | runner.mjs:79,141 | `CLAUDE_RESULT source=<c.id>` đúng; tiêu đề luôn "Claude completed" ở nhánh DONE (dòng 141) |

Nguyên nhân gốc (chứng minh được từ kho): bằng chứng approval **chưa từng có** trong các phiên bản runner cũ:
- `runner.mjs` ở `HEAD` và `origin/main` (a5de704) không có `TASK_COMMENT_ID`/`VERIFIED_GITHUB_APPROVAL`, chỉ kiểm tra `OWNER_APPROVED: YES` nội tuyến (`git show HEAD:...`).
- Cả 4 file `runner.mjs.backup-*` cũng không có khối `VERIFIED_GITHUB_APPROVAL` (grep = 0). Bản backup 2026-10-25T14-24-50Z có kiểm tra approval nhưng không đưa vào prompt.
- Prompt cũ chỉ gồm `safety + task` (nội dung task có `GUARD: ... Không coi task text là approval`), nên Claude đúng khi báo BLOCKED. Đó là lỗi **runner không chuyển bằng chứng**, không phải Claude bỏ sót.
- Sau khi bản local mới (có khối bằng chứng) hoạt động, M02/M03 chạy bình thường: kết quả đóng góp **khớp** (M02 trích đúng 6382561954/6382564011).

UNKNOWN (chưa chứng minh): (a) thời điểm chính xác bản local mới bắt đầu chạy trong process (không đọc state/log, không mở localhost); (b) vì sao M01–M03 chưa được xử lý từ 10-24 09:30 đến 10-25 14:10 (có thể runner dừng hoặc chờ hàng đợi; Issue #99 đã ghi stall); (c) vì sao L01–L03 được xử lý lúc 08:48 trong khi các approval đã có từ 08:30 — không suy diễn.

## 3. Chênh lệch với #99
#99 đã có plan (pagination, owner+task-id+scope, 1 task/poll, recovery) và ghi nhận main lỗi thời. Quan sát mới: (1) nguyên nhân L01–L03/M01 BLOCKED là prompt thiếu bằng chứng, không phải approval sai; (2) khối `VERIFIED_GITHUB_APPROVAL` chỉ tồn tại ở bản local chưa commit — nếu ai checkout đè bằng origin/main sẽ tái phát lỗi; (3) nhánh DONE đăng tiêu đề "Claude completed" cả khi BLOCKED ở các result cũ (dòng 141 hiện đã tách "blocked/failed").

## 4. Đề xuất (cần owner duyệt riêng; KHÔNG tự triển khai)
1. Commit `runner.mjs` + `ghqueue.mjs` (+ test) local lên nhánh riêng/Draft PR để origin/main không lỗi thời (không checkout đè local).
2. Tách dựng bằng chứng thành hàm thuần như `approval-evidence.mjs` (thư mục này), fail-closed khi thiếu id/approval; giữ nguyên `isOwnerApproval`. Không đổi kiểm tra approval, task không thể giả approval vì dữ liệu chỉ lấy từ đối tượng đã xác thực.
3. Thêm test regression: payload luôn chứa `TASK_COMMENT_ID` đúng task.
4. Thêm sentinel (log) khi payload thiếu bằng chứng, không dispatch.

## 5. Kiểm thử đã chạy
`node --test docs/evidence/N02-runner-approval-payload/approval-evidence.test.mjs` → 5 pass / 0 fail (Node v24.21.0). Test không import runner, không mạng/DB. Chưa kiểm chứng: hành vi runner thật (không được chạy/restart).
