import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import type { AcctPrismaService } from '../../prisma/acct-prisma.service';
import { accountErrors, mapAccountDbError } from './accounts.errors';

// P1 Task 5 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.2): các bước dùng chung của luồng "một lần bấm". Hàm thuần trên `tx`, không biết HTTP.
//  - Tài khoản HỆ THỐNG (vai trò admin, nhóm REQUEST) đứng tên tạo yêu cầu và thực thi (role_grant, role_revoke, reset_token_issue,
//    credential_create, credential_disable) — database đòi nhóm REQUEST ở các hàm này.
//  - NGƯỜI BẤM (Quản trị CRM, nhóm APPROVE) chỉ duyệt yêu cầu và gọi 4 hàm P1 (employee_create/update, must_change_set, account_audit).
//  - Cơ chế hai người của database giữ nguyên: người bấm không duyệt được yêu cầu về chính mình (TWO_PERSON), tài khoản hệ thống không
//    thực thi được yêu cầu về chính nó (SELF_MODIFICATION).
// Mọi câu SQL là tagged template (tham số gắn kết). Pool siscom_acct không ghi được bảng nào — mọi thay đổi đi qua hàm đặc quyền.
export type AcctTx = Prisma.TransactionClient;
type Sql = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
export type ApprovalType = 'ROLE_GRANT' | 'ROLE_REVOKE_CRITICAL' | 'PASSWORD_RESET';
export interface PasswordSecret { hash: string; algo: string; params: unknown }

// Yêu cầu và mã đặt lại chỉ sống trong MỘT transaction => thời hạn ngắn nhất có ý nghĩa.
export const REQUEST_TTL_MIN = 5;
export const RESET_TOKEN_TTL_MIN = 5;

// Mọi thao tác ghi của P1 chạy trong một transaction có giới hạn thời gian; lỗi của database mang tiền tố đã biết được đổi thành lỗi nghiệp vụ
// (409 LAST_APPROVER, 403 SELF_MODIFICATION…), lỗi khác ném lại nguyên vẹn cho bộ lọc chung. Lỗi ở bất kỳ bước nào => rollback toàn bộ.
export async function inAcctTx<T>(acct: AcctPrismaService, fn: (tx: AcctTx) => Promise<T>): Promise<T> {
  try {
    return await acct.client().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      return fn(tx);
    }, { maxWait: 5000, timeout: 20000 });
  } catch (e) {
    throw mapAccountDbError(e) ?? e;
  }
}

// Hai thao tác trên cùng một nhân viên chạy lần lượt. Khoá tư vấn theo transaction: pool acct không có quyền ghi nên không khoá dòng được.
export async function lockEmployee(tx: Sql, employeeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'p1-account:' + employeeId}, 0))`;
}

// Tài khoản hệ thống = ĐÚNG MỘT nhân viên đang hoạt động, chưa xoá, credential ACTIVE, giữ vai trò admin. Không có / có hơn một => 503.
export async function findSystemRequester(tx: Sql): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM public.employee e
      JOIN public.employee_role er ON er.employee_id = e.id
      JOIN public.role r ON r.id = er.role_id
      JOIN public.employee_credential c ON c.employee_id = e.id
     WHERE r.code = 'admin' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL AND c.status = 'ACTIVE'
     ORDER BY e.id LIMIT 2`;
  if (rows.length !== 1) throw accountErrors.noSystemRequester();
  return rows[0].id;
}

// Tạo yêu cầu dưới tên tài khoản hệ thống rồi người bấm duyệt ngay. Trả id yêu cầu đã APPROVED (bước thực thi tiêu thụ nó).
export async function approved(tx: Sql, sys: string, clicker: string, type: ApprovalType, employeeId: string, roleId: string | null): Promise<string> {
  const payload = JSON.stringify({ source: 'p1-account-admin', clickedBy: clicker });
  const c = await tx.$queryRaw<{ id: string }[]>`
    SELECT public.fn_auth_api_request_create(${sys}::uuid, ${type}::public.privileged_change_type, ${employeeId}::uuid, ${roleId}::uuid, ${payload}::jsonb, ${REQUEST_TTL_MIN}::int) AS id`;
  const id = c[0]?.id;
  if (!id) throw new Error('P1: không tạo được yêu cầu ' + type + '.');
  const d = await tx.$queryRaw<{ s: string }[]>`SELECT public.fn_auth_api_request_decide(${clicker}::uuid, ${id}::uuid, true)::text AS s`;
  if (d[0]?.s !== 'APPROVED') throw new Error('P1: yêu cầu ' + type + ' không được duyệt.');
  return id;
}

// Đặt mật khẩu tạm + buộc đổi ở lần đăng nhập đầu. Mã đặt lại sinh ngẫu nhiên tại đây, chỉ SHA-256 của nó được gửi ở bước phát hành, mã gốc
// chỉ đi thẳng vào hàm đặt mật khẩu của database và không rời hàm này. fn_auth_api_reset_password trả mã kết quả (không ném lỗi) => khác 'OK'
// thì dừng, bên gọi rollback. Sau đó người bấm bật must_change_password cho ĐÚNG token_version vừa đặt.
export async function setTempPassword(tx: Sql, sys: string, clicker: string, employeeId: string, secret: PasswordSecret): Promise<void> {
  const req = await approved(tx, sys, clicker, 'PASSWORD_RESET', employeeId, null);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  await tx.$queryRaw`SELECT public.fn_auth_api_reset_token_issue(${sys}::uuid, ${req}::uuid, ${tokenHash}, ${RESET_TOKEN_TTL_MIN}::int)`;
  const res = await tx.$queryRaw<{ r: string }[]>`
    SELECT public.fn_auth_api_reset_password(${employeeId}::uuid, ${token}, ${secret.hash}, ${secret.algo}, ${JSON.stringify(secret.params)}::jsonb) AS r`;
  if (res[0]?.r !== 'OK') throw accountErrors.state('Không đặt được mật khẩu cho tài khoản này.');
  const cur = await tx.$queryRaw<{ token_version: number }[]>`SELECT token_version FROM public.employee_credential WHERE employee_id = ${employeeId}::uuid`;
  if (cur.length !== 1) throw accountErrors.state('Không đặt được mật khẩu cho tài khoản này.');
  await tx.$executeRaw`SELECT public.fn_acct_api_must_change_set(${clicker}::uuid, ${employeeId}::uuid, ${Number(cur[0].token_version)}::int)`;
}

// Một dòng nhật ký ACCOUNT_* mang tên NGƯỜI BẤM (các hàm M1.2 ghi nhật ký dưới tên tài khoản hệ thống). `changes` chỉ gồm khoá vô hại —
// hàm database từ chối mọi khoá gợi ý bí mật.
export type AccountAuditAction = 'ACCOUNT_CREATE' | 'ACCOUNT_ROLE_CHANGE' | 'ACCOUNT_PASSWORD_RESET' | 'ACCOUNT_DISABLE' | 'ACCOUNT_ENABLE';
export async function accountAudit(tx: Sql, clicker: string, action: AccountAuditAction, employeeId: string, changes: Record<string, string | null> | null): Promise<void> {
  await tx.$executeRaw`SELECT public.fn_acct_api_account_audit(${clicker}::uuid, ${action}, ${employeeId}::uuid, ${changes === null ? null : JSON.stringify(changes)}::jsonb)`;
}
