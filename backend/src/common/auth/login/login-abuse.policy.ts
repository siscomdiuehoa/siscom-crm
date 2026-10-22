// Chính sách chống lạm dụng ĐĂNG NHẬP (A10-4), thuần + tiêm phụ thuộc, KHÔNG I/O, KHÔNG gắn route/guard, KHÔNG kích hoạt khi chạy.
//
// CHƯA CÓ NGƯỠNG SẢN XUẤT: ngưỡng/cửa sổ PHẢI do chủ sở hữu duyệt rồi truyền tường minh. Không có DEFAULT; thiếu/không hợp lệ => ném lỗi
// (không để lọt thành "limiter" rỗng tưởng là an toàn). Kích hoạt trên môi trường thật: BLOCKED cho đến khi có ngưỡng được duyệt + kho bền vững.
//
// Hợp đồng:
// - Khóa theo NGUỒN (do tầng gọi suy ra từ địa chỉ socket đáng tin, không lấy từ nội dung request) và theo cặp NGUỒN+danh tính đã chuẩn hóa.
//   Không có khóa theo danh tính riêng lẻ/toàn cục: sẽ cho kẻ tấn công khóa tài khoản nạn nhân (DoS).
// - Khóa lưu trữ/log là băm (keyHasher tiêm vào, nên là HMAC có bí mật): không chứa email/mã NV/IP thô.
// - Danh tính sai định dạng chỉ tính vào hạn mức nguồn (không băm đầu vào thô, tránh tràn bộ nhớ bởi chuỗi tùy ý).
// - Kho không sẵn sàng/ném lỗi/trả giá trị lạ => TỪ CHỐI (fail-closed), không bao giờ cho qua.
// - Từ chối xảy ra TRƯỚC khi tra cứu credential (xem ThrottledPasswordLogin).
import { DomainException } from '../../errors/domain.exception';
import { parseLoginIdentifier } from './login-identifier';
import { VerifiedLogin } from './password-login.types';

export interface LoginAbuseConfig {
  readonly windowMs: number;
  readonly maxPerSource: number;
  readonly maxPerSourceIdentifier: number;
}

// Cổng lưu trữ: tăng bộ đếm cửa sổ cố định của `key` và trả số lần ĐÃ tính (gồm lần này). Có thể ném lỗi (kho không sẵn sàng).
export interface LoginAbuseStore {
  hit(key: string, nowMs: number, windowMs: number): Promise<number>;
}

export interface LoginAbuseLog { warn(event: string, fields: Readonly<Record<string, string | number>>): void }

export type LoginAbuseDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'RATE_LIMITED' | 'POLICY_UNAVAILABLE' };

export interface LoginAbuseDeps {
  readonly config: LoginAbuseConfig;
  readonly store: LoginAbuseStore;
  readonly keyHasher: (material: string) => string;
  readonly now: () => number;
  readonly log?: LoginAbuseLog;
}

const posInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

export class LoginAbusePolicy {
  constructor(private readonly deps: LoginAbuseDeps) {
    const c = deps?.config;
    if (!c || !posInt(c.windowMs) || !posInt(c.maxPerSource) || !posInt(c.maxPerSourceIdentifier)) {
      throw new Error('LOGIN_ABUSE_CONFIG_REQUIRED: cần windowMs/maxPerSource/maxPerSourceIdentifier là số nguyên dương do chủ sở hữu duyệt');
    }
    if (!deps.store || typeof deps.keyHasher !== 'function' || typeof deps.now !== 'function') {
      throw new Error('LOGIN_ABUSE_DEPS_REQUIRED: cần store, keyHasher, now');
    }
  }

  // Mỗi lần gọi tính một lần thử. Không ném lỗi: mọi sự cố => từ chối.
  async check(input: { source: unknown; identifier: unknown }): Promise<LoginAbuseDecision> {
    const { config: c, store, keyHasher, now, log } = this.deps;
    try {
      if (typeof input.source !== 'string' || input.source.length === 0) return this.deny('POLICY_UNAVAILABLE');
      const src = keyHasher(`src|${input.source}`);
      const keys: Array<{ key: string; max: number }> = [{ key: `login:s:${src}`, max: c.maxPerSource }];
      const id = parseLoginIdentifier(input.identifier);
      if (id.kind !== 'INVALID') {
        const norm = id.kind === 'EMAIL' ? id.value.toLowerCase() : id.value;
        keys.push({ key: `login:si:${keyHasher(`si|${input.source}|${id.kind}|${norm}`)}`, max: c.maxPerSourceIdentifier });
      }
      const t = now();
      if (!Number.isFinite(t)) return this.deny('POLICY_UNAVAILABLE');
      let limited = false;
      for (const k of keys) {
        const n = await store.hit(k.key, t, c.windowMs);
        if (!Number.isSafeInteger(n) || n < 1) return this.deny('POLICY_UNAVAILABLE');
        if (n > k.max) limited = true;
      }
      if (limited) {
        log?.warn('login.rate_limited', { sourceKey: src });
        return { allowed: false, reason: 'RATE_LIMITED' };
      }
      return { allowed: true };
    } catch {
      return this.deny('POLICY_UNAVAILABLE');
    }
  }

  private deny(reason: 'POLICY_UNAVAILABLE'): LoginAbuseDecision {
    this.deps.log?.warn('login.policy_unavailable', {});
    return { allowed: false, reason };
  }
}

// Bộ giữ chỗ an toàn cho "chưa cấu hình": luôn từ chối. Dùng khi chưa có ngưỡng được duyệt (không phải limiter, không cho qua).
export const UNCONFIGURED_LOGIN_ABUSE_POLICY: Pick<LoginAbusePolicy, 'check'> = Object.freeze({
  check: async (): Promise<LoginAbuseDecision> => ({ allowed: false, reason: 'POLICY_UNAVAILABLE' }),
});

// Lớp bọc: kiểm tra hạn mức TRƯỚC khi gọi verifier (tức trước khi tra credential). Từ chối dùng một lỗi chung, không lộ lý do.
export class ThrottledPasswordLogin {
  constructor(
    private readonly policy: Pick<LoginAbusePolicy, 'check'>,
    private readonly inner: { verify(input: { login: unknown; password: unknown }): Promise<VerifiedLogin> },
  ) {}

  async verify(input: { source: unknown; login: unknown; password: unknown }): Promise<VerifiedLogin> {
    const d = await this.policy.check({ source: input.source, identifier: input.login });
    if (!d.allowed) throw new DomainException(429, 'LOGIN_THROTTLED', 'Quá nhiều lần thử, vui lòng thử lại sau.');
    return this.inner.verify({ login: input.login, password: input.password });
  }
}
