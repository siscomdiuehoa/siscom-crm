import { HealthService } from './health.service';

// B1.4 P3b (M-d): /health/database báo thêm role.leastPrivilege — ứng dụng có đang chạy bằng role đặc quyền tối thiểu (siscom_app sau
// S1 + APP_GRANTS_V2) hay không. Không trả tên tài khoản/chi tiết (endpoint không cần phiên). Prisma giả: không chạm DB.
type Row = Record<string, unknown>;
// B1.4 P3c: tham số thứ ba = pool auth giả (separate + facts riêng); mặc định = pool chung (chưa tách).
function service(facts: Row | Error, meta: Row | null = { key: 'schema_baseline', value: 'B1.2' }, auth: { separate: boolean; facts: Row | Error } = { separate: false, facts }): HealthService {
  const fake = {
    // $queryRaw tagged template: câu đọc role nhận diện qua chữ 'rolsuper'; các câu khác (SELECT 1) trả ok.
    $queryRaw: async (q: TemplateStringsArray) => {
      if (!q.join('').includes('rolsuper')) return [{ ok: 1 }];
      if (facts instanceof Error) throw facts;
      return [facts];
    },
    appMeta: { findUnique: async () => meta },
  };
  const fakeAuth = { separate: auth.separate, $queryRaw: async (q: TemplateStringsArray) => { if (!q.join('').includes('rolsuper')) return [{ ok: 1 }]; if (auth.facts instanceof Error) throw auth.facts; return [auth.facts]; } };
  return new HealthService(fake as never, fakeAuth as never);
}
const least = { user: 'siscom_app', is_superuser: false, is_db_owner: false, can_create_in_public: false, is_migrator_member: false };

describe('HealthService.database — role', () => {
  it('role tối thiểu => role.leastPrivilege=true, vẫn có migrated/baseline', async () => {
    const r = await service(least).database();
    expect(r).toMatchObject({ ok: true, migrated: true, baseline: 'B1.2', role: { leastPrivilege: true, authPool: 'shared', authLeastPrivilege: null } });
    expect(typeof r.latencyMs).toBe('number');
  });
  it('chạy bằng chủ sở hữu DB (mô hình cũ) => role.leastPrivilege=false; không lộ tên tài khoản trong kết quả', async () => {
    const r = await service({ ...least, user: 'siscom_migrator', is_db_owner: true }).database();
    expect(r.ok).toBe(true);
    expect(r.role).toMatchObject({ leastPrivilege: false, authPool: 'shared' });
    expect(JSON.stringify(r)).not.toContain('siscom_migrator');
  });
  // M-6 (rà soát P3b): mỗi lần probe /health/database (load balancer gọi liên tục) không được ghi cảnh báo lặp; chỉ ghi khi trạng thái ĐỔI.
  it('cảnh báo role chỉ ghi khi trạng thái đổi, không ghi lặp mỗi lần probe', async () => {
    const s = service({ ...least, is_db_owner: true });
    const warns: string[] = [];
    (s as unknown as { logger: { warn: (m: string) => void } }).logger.warn = (m: string) => { warns.push(m); };
    for (let i = 0; i < 5; i++) await s.database();
    expect(warns).toHaveLength(1);
  });
  it('không đọc được thông tin role (lỗi truy vấn) => leastPrivilege=null, database vẫn up', async () => {
    const r = await service(new Error('boom')).database();
    expect(r.ok).toBe(true);
    expect(r.role).toMatchObject({ leastPrivilege: null, authPool: 'shared' });
  });
});

describe('HealthService.database — hai pool (B1.4 P3c)', () => {
  const app = { ...least, has_auth_grants: false, can_write_business: true };
  const auth = { user: 'siscom_auth', is_superuser: false, is_db_owner: false, can_create_in_public: false, is_migrator_member: false, has_auth_grants: true, can_write_business: false };
  it('pool auth tách riêng, đúng quyền => authPool=separate, authLeastPrivilege=true; pool app không còn quyền xác thực => leastPrivilege=true', async () => {
    const r = await service(app, undefined, { separate: true, facts: auth }).database();
    expect(r.role).toEqual({ leastPrivilege: true, authPool: 'separate', authLeastPrivilege: true });
  });
  it('pool auth tách riêng nhưng pool app VẪN còn quyền xác thực (V3 chưa áp) => leastPrivilege=false', async () => {
    const r = await service({ ...app, has_auth_grants: true }, undefined, { separate: true, facts: auth }).database();
    expect(r.role).toMatchObject({ leastPrivilege: false, authPool: 'separate' });
  });
  it('pool auth trỏ nhầm (không có quyền xác thực / ghi được customer) => authLeastPrivilege=false; không lộ tên tài khoản', async () => {
    const r = await service(app, undefined, { separate: true, facts: { ...auth, has_auth_grants: false, can_write_business: true } }).database();
    expect(r.role).toMatchObject({ authPool: 'separate', authLeastPrivilege: false });
    expect(JSON.stringify(r)).not.toContain('siscom_auth');
  });
  it('pool auth tách riêng nhưng không đọc được => authLeastPrivilege=null', async () => {
    const r = await service(app, undefined, { separate: true, facts: new Error('boom') }).database();
    expect(r.role).toMatchObject({ authPool: 'separate', authLeastPrivilege: null });
  });
});
