import { HealthService } from './health.service';

// B1.4 P3b (M-d): /health/database báo thêm role.leastPrivilege — ứng dụng có đang chạy bằng role đặc quyền tối thiểu (siscom_app sau
// S1 + APP_GRANTS_V2) hay không. Không trả tên tài khoản/chi tiết (endpoint không cần phiên). Prisma giả: không chạm DB.
type Row = Record<string, unknown>;
function service(facts: Row | Error, meta: Row | null = { key: 'schema_baseline', value: 'B1.2' }): HealthService {
  const fake = {
    // $queryRaw tagged template: câu đọc role nhận diện qua chữ 'rolsuper'; các câu khác (SELECT 1) trả ok.
    $queryRaw: async (q: TemplateStringsArray) => {
      if (!q.join('').includes('rolsuper')) return [{ ok: 1 }];
      if (facts instanceof Error) throw facts;
      return [facts];
    },
    appMeta: { findUnique: async () => meta },
  };
  return new HealthService(fake as never);
}
const least = { user: 'siscom_app', is_superuser: false, is_db_owner: false, can_create_in_public: false, is_migrator_member: false };

describe('HealthService.database — role', () => {
  it('role tối thiểu => role.leastPrivilege=true, vẫn có migrated/baseline', async () => {
    const r = await service(least).database();
    expect(r).toMatchObject({ ok: true, migrated: true, baseline: 'B1.2', role: { leastPrivilege: true } });
    expect(typeof r.latencyMs).toBe('number');
  });
  it('chạy bằng chủ sở hữu DB (mô hình cũ) => role.leastPrivilege=false; không lộ tên tài khoản trong kết quả', async () => {
    const r = await service({ ...least, user: 'siscom_migrator', is_db_owner: true }).database();
    expect(r.ok).toBe(true);
    expect(r.role).toEqual({ leastPrivilege: false });
    expect(JSON.stringify(r)).not.toContain('siscom_migrator');
  });
  it('không đọc được thông tin role (lỗi truy vấn) => leastPrivilege=null, database vẫn up', async () => {
    const r = await service(new Error('boom')).database();
    expect(r.ok).toBe(true);
    expect(r.role).toEqual({ leastPrivilege: null });
  });
});
