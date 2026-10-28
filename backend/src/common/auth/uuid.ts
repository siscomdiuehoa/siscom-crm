// UUID dạng chuẩn (8-4-4-4-12, chữ thường) — khớp Employee.id / AuthSession.employeeId (@db.Uuid; Postgres trả chữ thường).
// Chặt có chủ đích: không nhận chữ hoa, dấu ngoặc, tiền tố urn:, không có gạch nối hay khoảng trắng thừa; nhập sai => từ chối (fail-closed).
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isCanonicalUuid = (v: unknown): v is string => typeof v === 'string' && CANONICAL_UUID_RE.test(v);

// token_version: số nguyên an toàn >= 0 (kho/nguồn version là ranh giới không tin cậy).
export const isValidTokenVersion = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
