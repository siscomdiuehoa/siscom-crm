// Danh mục test tích hợp customer (CRUD / đồng thời / từ chối mặc định) cho harness PG cô lập (C-06).
// CHỈ LÀ DANH MỤC: mọi mục NOT_RUN. Chạy thật cần chủ sở hữu cấp DB thử riêng (docs/PG_ISOLATED_ACCEPTANCE_PLAN.md §9).
// Nguồn hợp đồng: backend/docs/B1.2.3_API_CONTRACT.md. Suite hiện có: backend/test/*.int-spec.ts (không sửa ở đây).
const NR = 'NOT_RUN';
const t = (id, area, title, expect, ref, suite) => ({ id, area, title, expect, ref, suite, status: NR });

export const CATALOG = [
  t('CRUD-01', 'CRUD', 'Tạo khách hợp lệ', '201, version=1, có audit cùng transaction', '§3.2/§5', 'customers.int-spec.ts'),
  t('CRUD-02', 'CRUD', 'Tạo trùng MST khi khách cũ còn hiệu lực', '409, không tạo bản ghi', '§4', 'customers.int-spec.ts'),
  t('CRUD-03', 'CRUD', 'PATCH đúng version', '200, version tăng 1', '§3.3', 'customers.int-spec.ts'),
  t('CRUD-04', 'CRUD', 'PATCH sai version', '409 CUSTOMER_VERSION_CONFLICT + details.currentVersion', '§3.3', 'customers.int-spec.ts'),
  t('CRUD-05', 'CRUD', 'DELETE luôn bị khoá', '409 DELETE_LINKS_UNVERIFIED; dữ liệu/version không đổi; không audit nghiệp vụ', '§3.4', 'customers.int-spec.ts'),
  t('CRUD-06', 'CRUD', 'Restore khách đã xoá mềm (C4)', '200; restore khách đang hoạt động → 409 CUSTOMER_NOT_DELETED', '§3.5', 'customers.int-spec.ts'),
  t('CRUD-07', 'CRUD', 'Restore khi MST bị khách khác giữ', '409 CUSTOMER_RESTORE_CONFLICT', '§3.5', 'customers.int-spec.ts'),
  t('CRUD-08', 'CRUD', 'Liệt kê/phân trang/tìm kiếm trên fixture', 'tổng và thứ tự ổn định; không trả khách ngoài phạm vi', '§3.1', 'customers.list-pagination.int-spec.ts'),
  t('CRUD-09', 'CRUD', 'Thêm liên hệ', '201; ≤1 liên hệ chính/khách', '§3.6/§6', 'contacts.int-spec.ts'),
  t('CONC-01', 'CONCURRENCY', 'Thêm liên hệ chính song song', 'cuối cùng đúng 1 liên hệ chính, không 5xx', '§6', 'concurrency.int-spec.ts'),
  t('CONC-02', 'CONCURRENCY', 'Thêm liên hệ song song với xoá mềm', 'không liên hệ nào gắn vào khách đã xoá', '§6', 'concurrency.int-spec.ts'),
  t('CONC-03', 'CONCURRENCY', 'Hai restore song song', 'đúng một thành công, còn lại 409', '§3.5', 'concurrency.int-spec.ts'),
  t('CONC-04', 'CONCURRENCY', 'Restore song song với tạo khách cùng MST', 'tối đa một khách hiệu lực giữ MST, không 5xx', '§6', 'concurrency.int-spec.ts'),
  t('CONC-05', 'CONCURRENCY', 'Hai PATCH song song cùng version', 'đúng một thành công, còn lại 409 xung đột phiên bản', '§3.3', 'concurrency.int-spec.ts'),
  t('CONC-06', 'CONCURRENCY', 'PATCH song song với xoá mềm', 'bản ghi đã xoá không "sống lại"', '§6', 'concurrency.int-spec.ts'),
  t('CONC-07', 'CONCURRENCY', 'Chờ khoá dòng > 5 s', '409 CUSTOMER_BUSY', '§3.3', 'concurrency.int-spec.ts'),
  t('DENY-01', 'DENY_BY_DEFAULT', 'Không xác thực', '401 trên mọi endpoint /customers (mặc định từ chối)', '§3', 'health.e2e-spec.ts + suite auth (chưa có ca DB)'),
  t('DENY-02', 'DENY_BY_DEFAULT', 'Provider quyền không khai báo phạm vi/quyền', 'từ chối (fail-closed)', '§3', 'customers.int-spec.ts'),
  t('DENY-03', 'DENY_BY_DEFAULT', 'Ngoài phạm vi đọc (C3 với empA/OWN)', '404 CUSTOMER_NOT_FOUND, không lộ sự tồn tại', '§3', 'customers.int-spec.ts'),
  t('DENY-04', 'DENY_BY_DEFAULT', 'Trong phạm vi đọc nhưng thiếu quyền ghi', '403 FORBIDDEN', '§3', 'customers.int-spec.ts'),
  t('DENY-05', 'DENY_BY_DEFAULT', 'OWN tạo khách với ownerId người khác', 'bị từ chối', '§3', 'customers.int-spec.ts'),
  t('DENY-06', 'DENY_BY_DEFAULT', 'Role siscom_t_app_<stamp> thực hiện DDL / ghi RBAC / UPDATE-DELETE audit_log / đọc credential', 'bị DB từ chối (B1.3_S1_PRIVILEGE_TESTS 0 FAIL)', 'PLAN §6 bước 5', 'B1.3_S1_PRIVILEGE_TESTS.sql.txt (nhánh db/b1.3.2-b-m1-2-s1s3)'),
];

export const AREAS = ['CRUD', 'CONCURRENCY', 'DENY_BY_DEFAULT'];

export function validateCatalog(list = CATALOG) {
  const problems = [];
  const ids = new Set();
  for (const e of list) {
    if (ids.has(e.id)) problems.push(`trùng id ${e.id}`);
    ids.add(e.id);
    if (!AREAS.includes(e.area)) problems.push(`${e.id}: area lạ`);
    if (e.status !== NR) problems.push(`${e.id}: status phải là ${NR} (chưa có bằng chứng chạy thật)`);
    for (const k of ['title', 'expect', 'ref', 'suite']) if (typeof e[k] !== 'string' || !e[k]) problems.push(`${e.id}: thiếu ${k}`);
  }
  for (const a of AREAS) if (!list.some((e) => e.area === a)) problems.push(`thiếu nhóm ${a}`);
  return problems;
}
