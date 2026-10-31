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

// pg ưu tiên tham số trong chuỗi kết nối hơn cấu hình => "options" trong DATABASE_URL sẽ âm thầm ghi đè TimeZone=UTC.
// pg-connection-string giải mã tên tham số (%6Fptions) và nhận cả "?options" không có "=" => kiểm theo tên đã giải mã.
function hasOptionsParam(connectionString: string): boolean {
  try {
    for (const key of new URL(connectionString).searchParams.keys()) if (key.toLowerCase() === 'options') return true;
    return false;
  } catch {
    return /[?&]options(=|&|#|$)/i.test(decodeURIComponentSafe(connectionString)); // chuỗi không phải URL chuẩn: kiểm thô sau giải mã
  }
}
function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

export function pgPoolConfig(connectionString: string, name = 'DATABASE_URL'): PgPoolConfig {
  if (hasOptionsParam(connectionString)) {
    throw new Error(name + ' không được chứa tham số "options": ứng dụng tự đặt TimeZone=' + DB_SESSION_TIME_ZONE + ' cho mọi phiên (D.0).');
  }
  // DateStyle=ISO: bộ đọc của adapter-pg chỉ hiểu đúng định dạng ngày giờ ISO (mặc định của PostgreSQL, ghim lại cho chắc).
  return { connectionString, max: 10, connectionTimeoutMillis: 2000, idleTimeoutMillis: 30000, options: '-c TimeZone=' + DB_SESSION_TIME_ZONE + ' -c DateStyle=ISO' };
}
