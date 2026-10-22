import { DomainException } from '../../errors/domain.exception';
import { ParamSqlRunner, SessionBoundActor } from './privileged.types';

// Bảng cố định các thao tác đặc quyền => câu SQL cố định, tham số GẮN ($n). Hai tham số đầu của mọi hàm *_v2 là (phiên, grant) lấy từ
// SessionBoundActor do verifier tạo ra; KHÔNG có đường truyền p_actor. Tên hàm không bao giờ ghép từ dữ liệu bên ngoài.
const OPS = {
  REQUEST_CREATE: { sql: 'SELECT public.fn_auth_api_request_create_v2($1::uuid, $2::text, $3::public.privileged_change_type, $4::uuid, $5::uuid, $6::jsonb, $7::integer) AS result', args: 5 },
  REQUEST_DECIDE: { sql: 'SELECT public.fn_auth_api_request_decide_v2($1::uuid, $2::text, $3::uuid, $4::boolean) AS result', args: 2 },
  ROLE_GRANT: { sql: 'SELECT public.fn_auth_api_role_grant_v2($1::uuid, $2::text, $3::uuid) AS result', args: 1 },
  ROLE_REVOKE: { sql: 'SELECT public.fn_auth_api_role_revoke_v2($1::uuid, $2::text, $3::uuid, $4::uuid, $5::uuid) AS result', args: 3 },
  ROLE_PERMISSION_CHANGE: { sql: 'SELECT public.fn_auth_api_role_permission_change_v2($1::uuid, $2::text, $3::uuid) AS result', args: 1 },
  RESET_TOKEN_ISSUE: { sql: 'SELECT public.fn_auth_api_reset_token_issue_v2($1::uuid, $2::text, $3::uuid, $4::text, $5::integer) AS result', args: 3 },
  CHANGE_OWN_PASSWORD: { sql: 'SELECT public.fn_auth_api_change_own_password_v2($1::uuid, $2::text, $3::integer, $4::text, $5::text, $6::jsonb) AS result', args: 4 },
  CREDENTIAL_CREATE: { sql: 'SELECT public.fn_auth_api_credential_create_v2($1::uuid, $2::text, $3::uuid) AS result', args: 1 },
  CREDENTIAL_DISABLE: { sql: 'SELECT public.fn_auth_api_credential_disable_v2($1::uuid, $2::text, $3::uuid, $4::text) AS result', args: 2 },
} as const;
export type PrivilegedOp = keyof typeof OPS;
export const PRIVILEGED_OPS = Object.keys(OPS) as PrivilegedOp[];
export const privilegedOpSql = (op: PrivilegedOp): string => OPS[op].sql;

// Lỗi DB => lỗi miền KHÔNG lộ thông điệp DB (tên bảng/ràng buộc/id). Mã SQLSTATE do hàm SQL đặt (M1.2/P2).
export function toDomainError(e: unknown): DomainException {
  const code = (e as { code?: unknown } | null)?.code;
  const msg = String((e as { message?: unknown } | null)?.message ?? '');
  if (code === '42501' && msg.startsWith('SESSION_PROOF_INVALID')) return new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
  if (code === '42501') return new DomainException(403, 'FORBIDDEN', 'Không đủ quyền thực hiện.');
  if (code === '23514') return new DomainException(422, 'INVALID_REQUEST', 'Yêu cầu không hợp lệ.');
  if (code === '23001') return new DomainException(409, 'CONFLICT', 'Thao tác xung đột với quy tắc hệ thống.');
  return new DomainException(500, 'INTERNAL', 'Lỗi hệ thống.');
}

export class PrivilegedApiClient {
  constructor(private readonly run: ParamSqlRunner) {}

  // `args` = các tham số nghiệp vụ SAU (phiên, grant). Số lượng phải khớp đúng; danh tính luôn từ `actor` (do verifier suy ra từ DB).
  async call(op: PrivilegedOp, actor: SessionBoundActor, args: readonly unknown[]): Promise<unknown> {
    const def = OPS[op];
    if (!def) throw new Error('privileged op không hợp lệ');
    if (!actor || typeof actor.sessionId !== 'string' || typeof actor.proof !== 'string') throw new DomainException(401, 'UNAUTHENTICATED', 'Chưa xác thực.');
    if (args.length !== def.args) throw new Error(`privileged op ${op}: cần ${def.args} tham số nghiệp vụ`);
    try {
      const rows = await this.run(def.sql, [actor.sessionId, actor.proof, ...args]);
      return (rows[0] as { result?: unknown } | undefined)?.result;
    } catch (e) {
      throw toDomainError(e);
    }
  }
}
