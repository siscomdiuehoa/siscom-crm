import { pickPrismaCliUrl } from './migrate-url';

// B1.4 P3: Prisma CLI / CLI vận hành chọn URL: MIGRATE_DATABASE_URL (siscom_migrator) ưu tiên, rơi về DATABASE_URL. Không superuser.
const APP = 'postgresql://siscom_app:x%40y@127.0.0.1:5432/siscom_crm_test_20261030_000000';
const MIG = 'postgresql://siscom_migrator:z@127.0.0.1:5432/siscom_crm_test_20261030_000000';

describe('pickPrismaCliUrl (B1.4 P3 S1)', () => {
  it('không có MIGRATE_DATABASE_URL => dùng DATABASE_URL (máy chưa tách role, hành vi cũ)', () => {
    expect(pickPrismaCliUrl({ DATABASE_URL: APP })).toEqual({ url: APP, source: 'DATABASE_URL' });
    expect(pickPrismaCliUrl({ DATABASE_URL: APP, MIGRATE_DATABASE_URL: '   ' })).toEqual({ url: APP, source: 'DATABASE_URL' });
  });
  it('có MIGRATE_DATABASE_URL => ưu tiên, kể cả khi DATABASE_URL cũng có (cùng host/cổng/database)', () => {
    expect(pickPrismaCliUrl({ DATABASE_URL: APP, MIGRATE_DATABASE_URL: MIG })).toEqual({ url: MIG, source: 'MIGRATE_DATABASE_URL' });
    expect(pickPrismaCliUrl({ MIGRATE_DATABASE_URL: ' ' + MIG + ' ' }).url).toBe(MIG);
    expect(pickPrismaCliUrl({ DATABASE_URL: APP + '?schema=public', MIGRATE_DATABASE_URL: MIG }).url).toBe(MIG); // khác query string vẫn cùng DB
    expect(pickPrismaCliUrl({ DATABASE_URL: APP.replace(':5432/', '/'), MIGRATE_DATABASE_URL: MIG }).url).toBe(MIG); // bỏ trống cổng = 5432
  });
  it('I2: cả hai biến đều đặt nhưng trỏ DB/host/cổng KHÁC nhau => từ chối (không để MIGRATE_DATABASE_URL âm thầm migrate nhầm DB)', () => {
    const otherDb = 'postgresql://siscom_migrator:z@127.0.0.1:5432/siscom_crm_test_20261030_999999';
    const otherHost = 'postgresql://siscom_migrator:z@10.0.0.9:5432/siscom_crm_test_20261030_000000';
    const otherPort = 'postgresql://siscom_migrator:z@127.0.0.1:5433/siscom_crm_test_20261030_000000';
    const otherSocketHost = MIG + '?host=/var/run/postgresql';
    const otherPortParam = MIG + '?port=5433'; // pg-connection-string ưu tiên ?port= hơn phần :5432
    for (const mig of [otherDb, otherHost, otherPort, otherSocketHost, otherPortParam]) {
      expect(() => pickPrismaCliUrl({ DATABASE_URL: APP, MIGRATE_DATABASE_URL: mig })).toThrow(/MIGRATE_DATABASE_URL.*khác.*DATABASE_URL/);
    }
    // thông điệp không lộ URL/mật khẩu
    let msg = '';
    try { pickPrismaCliUrl({ DATABASE_URL: APP, MIGRATE_DATABASE_URL: otherDb }); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toContain('x%40y'); expect(msg).not.toContain(':z@');
  });
  it('thiếu cả hai => lỗi rõ ràng', () => {
    expect(() => pickPrismaCliUrl({})).toThrow(/Thiếu DATABASE_URL/);
    expect(() => pickPrismaCliUrl({ DATABASE_URL: '' })).toThrow(/Thiếu DATABASE_URL/);
  });
  it('từ chối superuser postgres, sai giao thức, thiếu tài khoản/database — nêu đúng tên biến bị lỗi', () => {
    expect(() => pickPrismaCliUrl({ MIGRATE_DATABASE_URL: 'postgresql://postgres:p@127.0.0.1:5432/db' })).toThrow(/MIGRATE_DATABASE_URL không được dùng tài khoản postgres/);
    expect(() => pickPrismaCliUrl({ DATABASE_URL: 'postgresql://POSTGRES:p@127.0.0.1:5432/db' })).toThrow(/DATABASE_URL không được dùng tài khoản postgres/);
    expect(() => pickPrismaCliUrl({ DATABASE_URL: 'mysql://a:b@h/db' })).toThrow(/postgresql:\/\//);
    expect(() => pickPrismaCliUrl({ DATABASE_URL: 'postgresql://:p@127.0.0.1:5432/db' })).toThrow(/thiếu tên tài khoản/);
    expect(() => pickPrismaCliUrl({ DATABASE_URL: 'postgresql://a:p@127.0.0.1:5432/' })).toThrow(/thiếu tên database/);
    expect(() => pickPrismaCliUrl({ DATABASE_URL: 'not a url' })).toThrow(/sai định dạng/);
  });
  it('không lộ URL/mật khẩu trong thông điệp lỗi', () => {
    const secret = 'S3cr3t-Mat-Khau';
    for (const bad of ['postgresql://postgres:' + secret + '@127.0.0.1:5432/db', 'postgresql://a:' + secret + '@127.0.0.1:5432/']) {
      let msg = '';
      try { pickPrismaCliUrl({ DATABASE_URL: bad }); } catch (e) { msg = (e as Error).message; }
      expect(msg).not.toContain(secret);
    }
  });
});
