import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SECRET_RE, UUID_RE } from './grant-token';
import { ActorBindingVerifier, AUTH_SQL_RUNNER, ParamSqlRunner, SessionBoundActor } from './privileged.types';

// Header mang BẰNG CHỨNG (không phải danh tính): `<sessionId>.<grant>`. Mọi header/body/query khác (x-actor-id, actorId, p_actor...) bị bỏ qua.
// Grant do ứng dụng auth cấp sau khi người dùng nhập lại mật khẩu (step-up); DB chỉ giữ SHA-256, hết hạn <= 10 phút, dùng 1..5 lần.
export const PRIV_GRANT_HEADER = 'x-priv-grant';
// Chỉ ĐỌC (không tiêu thụ). Hàm *_v2 xác minh LẠI và tiêu thụ nguyên tử trong chính giao dịch thực thi nên kết quả này không phải thẩm quyền.
export const RESOLVE_GRANT_SQL = 'SELECT public.fn_auth_priv_grant_actor($1::uuid, $2::text) AS employee_id';

export function parseGrantHeader(value: unknown): { sessionId: string; grant: string } | null {
  if (typeof value !== 'string') return null; // header lặp => Node nối bằng ", " hoặc trả mảng => không khớp
  const i = value.indexOf('.');
  if (i < 0) return null;
  const sessionId = value.slice(0, i);
  const grant = value.slice(i + 1);
  if (!UUID_RE.test(sessionId) || !SECRET_RE.test(grant)) return null;
  return { sessionId: sessionId.toLowerCase(), grant };
}

// ActorBindingVerifier giai đoạn 2. KHÔNG được đăng ký mặc định trong PrivilegedModule: chỉ khi triển khai cấp AUTH_SQL_RUNNER (pool siscom_auth)
// và provider thật. dbVerifiable=true ĐÚNG vì danh tính do PostgreSQL suy ra từ grant gắn phiên, và hàm *_v2 xác minh lại khi thực thi.
@Injectable()
export class SessionGrantVerifier implements ActorBindingVerifier {
  readonly dbVerifiable = true;
  constructor(@Inject(AUTH_SQL_RUNNER) private readonly run: ParamSqlRunner) {}

  async verify(req: Request): Promise<SessionBoundActor | null> {
    const parsed = parseGrantHeader(req.headers[PRIV_GRANT_HEADER]);
    if (!parsed) return null;
    let rows: unknown[];
    try {
      rows = await this.run(RESOLVE_GRANT_SQL, [parsed.sessionId, parsed.grant]);
    } catch {
      return null; // lỗi DB => từ chối (fail-closed)
    }
    const row = Array.isArray(rows) && rows.length === 1 ? (rows[0] as Record<string, unknown> | null) : null;
    const employeeId = row?.employee_id;
    if (typeof employeeId !== 'string' || !UUID_RE.test(employeeId)) return null;
    return { employeeId, departmentId: null, proof: parsed.grant, sessionId: parsed.sessionId };
  }
}
