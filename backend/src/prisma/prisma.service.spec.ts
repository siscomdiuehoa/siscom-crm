import { PrismaService } from './prisma.service';

// Hồi quy CI run 41079797422 (P3b): test helper và CLI (seed-lookups, bootstrap-auth) tạo PrismaService bằng đối tượng CHỈ có getOrThrow.
// Constructor không được đòi thêm phương thức nào khác của ConfigService (không kết nối DB: adapter tạo pool lười).
describe('PrismaService constructor', () => {
  it('chỉ cần getOrThrow("DATABASE_URL") — không gọi config.get', async () => {
    // PrismaClient (Prisma 7) trả về proxy từ constructor => không dùng toBeInstanceOf; kiểm: không ném và có hook kiểm role khởi động.
    let p: PrismaService | undefined;
    expect(() => { p = new PrismaService({ getOrThrow: () => 'postgresql://u@127.0.0.1:1/siscom_crm_test_20261030_000000' } as never); }).not.toThrow();
    expect(typeof p?.onApplicationBootstrap).toBe('function');
    await p?.$disconnect();
  });
});
