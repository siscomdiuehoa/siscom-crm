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

  const auth = validateAuthEnv(str, nodeEnv, corsList, errors);

  if (errors.length) throw new Error('Cấu hình không hợp lệ:\n - ' + errors.join('\n - '));

  return { ...raw, NODE_ENV: nodeEnv, HOST: host, PORT: port, DATABASE_URL: dbUrl, CORS_ORIGIN_LIST: corsList, LOG_LEVELS: LEVELS[level], ...auth };
}

// B1.3.2-A: JWT_ACCESS_SECRET chưa bắt buộc (module auth chưa bật). Gói C đổi thành true khi nhập AuthApiModule.
const AUTH_SECRET_REQUIRED = false;
const MIN_SECRET_BYTES = 32;

// Bien moi truong cho xac thuc (B1.3.1_FINAL_DESIGN). Chỉ kiểm tra khi có khai báo; mặc định an toàn. Không in giá trị.
function validateAuthEnv(str: (k: string) => string, nodeEnv: string, corsList: string[], errors: string[]): Record<string, unknown> {
  const intIn = (k: string, def: number, min: number, max: number): number => {
    const v = str(k);
    const n = v ? Number(v) : def;
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${k} phải là số nguyên từ ${min} đến ${max}`);
    return n;
  };
  const secretOk = (k: string, v: string): boolean => {
    if (Buffer.byteLength(v, 'utf8') < MIN_SECRET_BYTES) { errors.push(`${k} phải dài tối thiểu ${MIN_SECRET_BYTES} byte`); return false; }
    if (v.includes('CHANGE_ME')) { errors.push(`${k} vẫn là giá trị mẫu; hãy sinh khóa ngẫu nhiên`); return false; }
    return true;
  };

  const secret = str('JWT_ACCESS_SECRET');
  const secretPrev = str('JWT_ACCESS_SECRET_PREV');
  if (!secret) {
    if (AUTH_SECRET_REQUIRED) errors.push('Thiếu JWT_ACCESS_SECRET');
    if (secretPrev) errors.push('JWT_ACCESS_SECRET_PREV chỉ dùng khi đã có JWT_ACCESS_SECRET');
  } else {
    secretOk('JWT_ACCESS_SECRET', secret);
    if (secretPrev && secretOk('JWT_ACCESS_SECRET_PREV', secretPrev) && secretPrev === secret) errors.push('JWT_ACCESS_SECRET_PREV phải khác JWT_ACCESS_SECRET');
  }

  const accessTtl = intIn('ACCESS_TTL_SECONDS', 600, 60, 3600);
  const idleDays = intIn('REFRESH_IDLE_DAYS', 7, 1, 30);
  const absDays = intIn('REFRESH_ABS_DAYS', 30, 1, 90);
  if (idleDays > absDays) errors.push('REFRESH_IDLE_DAYS không được lớn hơn REFRESH_ABS_DAYS');

  // B1.3 MVP session cookie (Issue #8, 28/10/2026): phien idle truot + han tuyet doi; gioi han dang nhap theo nguon; khoa credential tam.
  const sessionIdle = intIn('SESSION_IDLE_MINUTES', 480, 5, 1440);
  const sessionAbs = intIn('SESSION_ABS_HOURS', 12, 1, 24 * 30);
  if (sessionIdle > sessionAbs * 60) errors.push('SESSION_IDLE_MINUTES không được lớn hơn SESSION_ABS_HOURS (tính theo phút)');
  const loginWindow = intIn('LOGIN_WINDOW_MINUTES', 15, 1, 1440);
  const loginMaxSource = intIn('LOGIN_MAX_PER_SOURCE', 30, 1, 10000);
  const loginMaxIdent = intIn('LOGIN_MAX_PER_IDENTIFIER', 5, 1, 1000);
  const lockMinutes = intIn('LOGIN_LOCK_MINUTES', 15, 1, 1440);
  const lockAfter = intIn('LOGIN_LOCK_AFTER_FAILURES', 5, 1, 100);

  const cookieRaw = (str('COOKIE_SECURE') || 'true').toLowerCase();
  if (cookieRaw !== 'true' && cookieRaw !== 'false') errors.push('COOKIE_SECURE phải là true hoặc false');
  if (nodeEnv === 'production' && cookieRaw === 'false') errors.push('Môi trường production không được đặt COOKIE_SECURE=false');

  // Mặc định trùng CORS_ORIGINS (proxy cùng origin, D7).
  const originsRaw = str('AUTH_ALLOWED_ORIGINS');
  const origins = originsRaw ? originsRaw.split(',').map((s) => s.trim()).filter(Boolean) : corsList;
  for (const o of origins) {
    if (o === '*') { errors.push('AUTH_ALLOWED_ORIGINS không được dùng *'); continue; }
    try {
      const u = new URL(o);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.pathname !== '/') errors.push('AUTH_ALLOWED_ORIGINS có giá trị sai định dạng (cần dạng http://host:cổng, không có đường dẫn)');
    } catch {
      errors.push('AUTH_ALLOWED_ORIGINS có giá trị không phải URL hợp lệ');
    }
  }

  // Không nhận "true" (tin mọi proxy => giả mạo IP, vô hiệu throttle). Chỉ false, loopback hoặc số hop 1..5.
  const proxyRaw = (str('TRUST_PROXY') || 'false').toLowerCase();
  let trustProxy: false | 'loopback' | number = false;
  if (proxyRaw === 'loopback') trustProxy = 'loopback';
  else if (/^[1-5]$/.test(proxyRaw)) trustProxy = Number(proxyRaw);
  else if (proxyRaw !== 'false') errors.push('TRUST_PROXY phải là false, loopback hoặc số nguyên từ 1 đến 5');

  return {
    JWT_ACCESS_SECRET: secret || undefined,
    JWT_ACCESS_SECRET_PREV: secretPrev || undefined,
    ACCESS_TTL_SECONDS: accessTtl,
    REFRESH_IDLE_DAYS: idleDays,
    REFRESH_ABS_DAYS: absDays,
    COOKIE_SECURE: cookieRaw !== 'false',
    SESSION_IDLE_MINUTES: sessionIdle,
    SESSION_ABS_HOURS: sessionAbs,
    LOGIN_WINDOW_MINUTES: loginWindow,
    LOGIN_MAX_PER_SOURCE: loginMaxSource,
    LOGIN_MAX_PER_IDENTIFIER: loginMaxIdent,
    LOGIN_LOCK_MINUTES: lockMinutes,
    LOGIN_LOCK_AFTER_FAILURES: lockAfter,
    AUTH_ALLOWED_ORIGIN_LIST: origins,
    TRUST_PROXY: trustProxy,
  };
}
