import { DomainException } from '../../errors/domain.exception';
import { SECRET_RE } from './grant-secret';
import { ParamSqlRunner } from './privileged.types';
import { ResetAbusePolicy } from './reset-abuse.policy';

export const RESET_PASSWORD_SQL = 'SELECT public.fn_auth_api_reset_password_v2($1::text, $2::text, $3::text, $4::jsonb) AS result';

export interface NewSecret { hash: string; algo: string; params: Record<string, unknown> }

// Hợp đồng ĐẦU RA chung (F-04): thành công => { status: 'OK' }; MỌI thất bại (mã sai/hết hạn/đã dùng/nhân viên khóa/DB lỗi/định dạng sai)
// => cùng một DomainException(400, RESET_INVALID) với cùng thông điệp. Bị giới hạn tốc độ => 429 RESET_RATE_LIMITED (chỉ phụ thuộc NGUỒN, không
// phụ thuộc tài khoản/mã). Không có tham số tài khoản: mã tự định danh (DB tra theo băm) nên không thể dò sự tồn tại của tài khoản.
// Service CHƯA gắn vào controller/route nào (không đổi hợp đồng API hiện có); route công khai sẽ là PR riêng, được duyệt.
export class PasswordResetService {
  constructor(private readonly run: ParamSqlRunner, private readonly policy: ResetAbusePolicy) {}

  async reset(input: { token: unknown; newSecret: NewSecret; sourceKey: string }): Promise<{ status: 'OK' }> {
    const { sourceKey } = input;
    if (!this.policy.tryAcquire(sourceKey)) throw new DomainException(429, 'RESET_RATE_LIMITED', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.');
    const fail = (): never => {
      this.policy.recordFailure(sourceKey);
      throw new DomainException(400, 'RESET_INVALID', 'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    };
    const token = input.token;
    if (typeof token !== 'string' || !SECRET_RE.test(token)) return fail();
    const s = input.newSecret;
    if (!s || typeof s.hash !== 'string' || typeof s.algo !== 'string' || typeof s.params !== 'object' || s.params === null) return fail();
    let result: unknown;
    try {
      const rows = await this.run(RESET_PASSWORD_SQL, [token, s.hash, s.algo, JSON.stringify(s.params)]);
      result = (rows[0] as { result?: unknown } | undefined)?.result;
    } catch {
      return fail();
    }
    if (result !== 'OK') return fail();
    return { status: 'OK' };
  }
}
