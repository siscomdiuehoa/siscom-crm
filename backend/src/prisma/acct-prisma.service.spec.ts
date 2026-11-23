import type { ConfigService } from '@nestjs/config';
import { AcctPrismaService } from './acct-prisma.service';
import * as roleCheck from './db-role-check';

// P1 (rà soát cuối, điểm 2): pool quản lý tài khoản là TUỲ CHỌN. Bật dở dang (đã có ACCT_DATABASE_URL nhưng role chưa được cấp quyền, hoặc
// kiểm đặc quyền không đạt) KHÔNG được làm cả ứng dụng từ chối khởi động: chỉ riêng /accounts trả 503, có dòng lỗi trong log.
const cfg = (acct?: string): ConfigService => {
  const env: Record<string, string | undefined> = {
    DATABASE_URL: 'postgresql://siscom_app:x@127.0.0.1:1/siscom_crm_test_x', AUTH_DATABASE_URL: 'postgresql://siscom_auth:x@127.0.0.1:1/siscom_crm_test_x', ACCT_DATABASE_URL: acct,
  };
  return { get: (k: string) => env[k], getOrThrow: (k: string) => { if (!env[k]) throw new Error('thiếu ' + k); return env[k]; } } as unknown as ConfigService;
};
const ACCT = 'postgresql://siscom_acct:x@127.0.0.1:1/siscom_crm_test_x';
const codeOf = (fn: () => unknown): { status: number; code: string } => {
  try { fn(); } catch (e) { const d = e as { getStatus(): number; code: string }; return { status: d.getStatus(), code: d.code }; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
};

describe('AcctPrismaService — pool tuỳ chọn', () => {
  afterEach(() => jest.restoreAllMocks());

  it('không có ACCT_DATABASE_URL => available = false, client() ném 503; khởi động không kiểm gì', async () => {
    const spy = jest.spyOn(roleCheck, 'enforceDbRoleAtStartup');
    const s = new AcctPrismaService(cfg(undefined));
    await s.onApplicationBootstrap();
    expect(s.available).toBe(false);
    expect(codeOf(() => s.client())).toEqual({ status: 503, code: 'ACCOUNT_ADMIN_UNAVAILABLE' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('kiểm đặc quyền ĐẠT => available = true, client() dùng được', async () => {
    jest.spyOn(roleCheck, 'enforceDbRoleAtStartup').mockResolvedValue(undefined as never);
    const s = new AcctPrismaService(cfg(ACCT));
    await s.onApplicationBootstrap();
    expect(s.available).toBe(true);
    expect(() => s.client()).not.toThrow();
    await s.onModuleDestroy();
  });

  it('kiểm đặc quyền KHÔNG ĐẠT (role chưa được cấp quyền / thừa quyền / không nối được) => KHÔNG ném lỗi khởi động; tắt riêng pool này (503)', async () => {
    jest.spyOn(roleCheck, 'enforceDbRoleAtStartup').mockRejectedValue(new Error('DB_ROLE_NOT_LEAST_PRIVILEGE: acct thiếu quyền'));
    const s = new AcctPrismaService(cfg(ACCT));
    await expect(s.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(s.available).toBe(false);
    expect(codeOf(() => s.client())).toEqual({ status: 503, code: 'ACCOUNT_ADMIN_UNAVAILABLE' });
    await s.onModuleDestroy();
  });
});
