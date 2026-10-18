type LogLevelName = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

const LEVELS: Record<string, LogLevelName[]> = {
  error: ['error', 'fatal'],
  warn: ['error', 'fatal', 'warn'],
  log: ['error', 'fatal', 'warn', 'log'],
  debug: ['error', 'fatal', 'warn', 'log', 'debug'],
  verbose: ['error', 'fatal', 'warn', 'log', 'debug', 'verbose'],
};
const DEFAULT_CORS = 'http://localhost:5173,http://127.0.0.1:5173';

// Kiem tra bien moi truong luc khoi dong. Thông báo lỗi chỉ nêu TÊN biến, không bao giờ in giá trị (tránh lộ mật khẩu).
export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const str = (k: string): string => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');

  const nodeEnv = str('NODE_ENV') || 'development';
  if (!['development', 'production', 'test'].includes(nodeEnv)) errors.push('NODE_ENV phải là development, production hoặc test');

  const host = str('HOST') || '127.0.0.1';
  const portRaw = str('PORT') || '3000';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT phải là số nguyên từ 1 đến 65535');

  const dbUrl = str('DATABASE_URL');
  if (!dbUrl) {
    errors.push('Thiếu DATABASE_URL (chạy scripts\\windows\\setup-db.bat để tạo file .env)');
  } else {
    try {
      const u = new URL(dbUrl);
      if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') errors.push('DATABASE_URL phải bắt đầu bằng postgresql://');
      if (!u.username) errors.push('DATABASE_URL thiếu tên tài khoản');
      if (decodeURIComponent(u.username).toLowerCase() === 'postgres') errors.push('DATABASE_URL không được dùng tài khoản postgres (superuser); hãy dùng siscom_app');
      if (u.pathname.length < 2) errors.push('DATABASE_URL thiếu tên database');
      if (decodeURIComponent(u.password).includes('CHANGE_ME')) errors.push('DATABASE_URL vẫn là mật khẩu mẫu; hãy chạy setup-db.bat');
    } catch {
      errors.push('DATABASE_URL sai định dạng (có thể mật khẩu chứa ký tự đặc biệt chưa mã hoá URL)');
    }
  }

  const corsRaw = str('CORS_ORIGINS');
  if (nodeEnv === 'production' && !corsRaw) errors.push('Môi trường production bắt buộc khai báo CORS_ORIGINS');
  const corsList = (corsRaw || DEFAULT_CORS).split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of corsList) {
    if (o === '*') { errors.push('CORS_ORIGINS không được dùng *'); continue; }
    try {
      const u = new URL(o);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.pathname !== '/') errors.push('CORS_ORIGINS có giá trị sai định dạng (cần dạng http://host:cổng, không có đường dẫn)');
    } catch {
      errors.push('CORS_ORIGINS có giá trị không phải URL hợp lệ');
    }
  }

  const level = (str('LOG_LEVEL') || 'log').toLowerCase();
  if (!LEVELS[level]) errors.push('LOG_LEVEL phải là error, warn, log, debug hoặc verbose');

  if (errors.length) throw new Error('Cấu hình không hợp lệ:\n - ' + errors.join('\n - '));

  return { ...raw, NODE_ENV: nodeEnv, HOST: host, PORT: port, DATABASE_URL: dbUrl, CORS_ORIGIN_LIST: corsList, LOG_LEVELS: LEVELS[level] };
}
