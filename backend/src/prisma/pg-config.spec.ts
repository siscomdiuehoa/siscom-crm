import { DB_SESSION_TIME_ZONE, pgPoolConfig } from './pg-config';

// D.0: @prisma/adapter-pg ghi Date dạng giờ UTC KHÔNG kèm múi giờ và đọc timestamptz bằng cách thay múi giờ trả về bằng +00:00.
// Hai chiều đó chỉ đúng khi phiên PostgreSQL chạy UTC, nên mọi kết nối của ứng dụng phải tự đặt TimeZone=UTC,
// không phụ thuộc cấu hình máy chủ (máy chủ Windows tại VN mặc định +07).
const URL_OK = 'postgresql://siscom_app:x@127.0.0.1:5432/siscom_crm_test_20261029_000000';

describe('pgPoolConfig (D.0 — phiên DB luôn UTC)', () => {
  it('đặt TimeZone=UTC và DateStyle=ISO (adapter chỉ đọc đúng định dạng ISO) qua tham số khởi động của mọi phiên', () => {
    expect(DB_SESSION_TIME_ZONE).toBe('UTC');
    expect(pgPoolConfig(URL_OK).options).toBe('-c TimeZone=UTC -c DateStyle=ISO');
  });

  it('giữ nguyên chuỗi kết nối và tham số pool đang dùng', () => {
    const c = pgPoolConfig(URL_OK);
    expect(c.connectionString).toBe(URL_OK);
    expect(c.max).toBe(10);
    expect(c.connectionTimeoutMillis).toBe(2000);
    expect(c.idleTimeoutMillis).toBe(30000);
  });

  it('từ chối DATABASE_URL tự đặt options (pg ưu tiên chuỗi kết nối => sẽ ghi đè TimeZone=UTC)', () => {
    expect(() => pgPoolConfig(URL_OK + '?options=-c%20TimeZone%3DAsia%2FHo_Chi_Minh')).toThrow(/options/);
    expect(() => pgPoolConfig(URL_OK + '?sslmode=disable&options=x')).toThrow(/options/);
    // pg-connection-string giải mã tên tham số và chấp nhận tham số không có "=" => các dạng này cũng ghi đè được
    expect(() => pgPoolConfig(URL_OK + '?options')).toThrow(/options/);
    expect(() => pgPoolConfig(URL_OK + '?%6Fptions=-c%20TimeZone%3DX')).toThrow(/options/);
    expect(() => pgPoolConfig(URL_OK + '?a=1&opt%69ons=x')).toThrow(/options/);
  });

  it('chấp nhận các tham số truy vấn khác', () => {
    expect(pgPoolConfig(URL_OK + '?sslmode=disable&application_name=siscom').options).toBe('-c TimeZone=UTC -c DateStyle=ISO');
    expect(pgPoolConfig(URL_OK + '?application_name=options').options).toBe('-c TimeZone=UTC -c DateStyle=ISO');
  });
});
