// D.0 — Phiên PostgreSQL của ứng dụng LUÔN chạy UTC.
// @prisma/adapter-pg ghi Date thành chuỗi giờ UTC KHÔNG kèm múi giờ (PostgreSQL hiểu theo TimeZone của phiên) và khi đọc
// timestamptz thì thay múi giờ trả về bằng +00:00. Hai chiều chỉ đúng khi phiên chạy UTC; máy chủ tại VN mặc định +07
// => lệch 7 giờ. Đặt TimeZone qua tham số khởi động của từng kết nối (ưu tiên hơn mặc định của máy chủ/DB/role).
// Lưu và xử lý theo UTC; hiển thị giờ Việt Nam là việc của giao diện. Không cộng/trừ giờ thủ công ở bất kỳ đâu.
export const DB_SESSION_TIME_ZONE = 'UTC';

export interface PgPoolConfig {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  options: string;
}

export function pgPoolConfig(connectionString: string): PgPoolConfig {
  // pg ưu tiên tham số trong chuỗi kết nối hơn cấu hình => "options" trong DATABASE_URL sẽ âm thầm ghi đè TimeZone=UTC.
  const q = connectionString.indexOf('?');
  if (q >= 0 && /(^|&)options=/i.test(connectionString.slice(q + 1))) {
    throw new Error('DATABASE_URL không được chứa tham số "options": ứng dụng tự đặt TimeZone=' + DB_SESSION_TIME_ZONE + ' cho mọi phiên (D.0).');
  }
  return { connectionString, max: 10, connectionTimeoutMillis: 2000, idleTimeoutMillis: 30000, options: '-c TimeZone=' + DB_SESSION_TIME_ZONE };
}
