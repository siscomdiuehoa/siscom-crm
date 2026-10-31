// B1.4 P3c: pool XÁC THỰC riêng (role siscom_auth) qua AUTH_DATABASE_URL — đóng S3: SQL tuỳ ý trong pool nghiệp vụ (siscom_app) không còn
// đọc hash, tạo phiên hay gọi hàm đổi mật khẩu. Hàm thuần, không đọc .env, không in URL/mật khẩu (thông điệp chỉ nêu TÊN biến).
//   - production: AUTH_DATABASE_URL BẮT BUỘC (thiếu => từ chối khởi động, fail-closed).
//   - development/test: thiếu => dùng DATABASE_URL (máy Windows chưa tách role; separate=false, chỉ cảnh báo).
//   - Khi đặt: cùng host/cổng/database với DATABASE_URL (chống trỏ nhầm DB), KHÁC tài khoản (cùng tài khoản = không cách ly), không postgres.
export type AuthDbUrlSource = 'AUTH_DATABASE_URL' | 'DATABASE_URL';
export interface AuthDbUrl { url: string; source: AuthDbUrlSource; separate: boolean }

export function pickAuthDbUrl(env: Record<string, string | undefined>, nodeEnv: string | undefined): AuthDbUrl {
  const app = (env.DATABASE_URL ?? '').trim();
  const auth = (env.AUTH_DATABASE_URL ?? '').trim();
  if (!app) throw new Error('Thiếu DATABASE_URL.');
  if (!auth) {
    if (nodeEnv === 'production') throw new Error('Môi trường production bắt buộc đặt AUTH_DATABASE_URL (tài khoản siscom_auth, cùng database với DATABASE_URL; xem B1.4_P3C_S3_AUTH_ROLE_DESIGN.md).');
    return { url: app, source: 'DATABASE_URL', separate: false };
  }
  const a = parse(auth, 'AUTH_DATABASE_URL');
  const b = parse(app, 'DATABASE_URL');
  if (decodeURIComponent(a.username).toLowerCase() === 'postgres') throw new Error('AUTH_DATABASE_URL không được dùng tài khoản postgres (superuser).');
  const qp = (x: URL, k: string): string => x.searchParams.get(k) ?? '';
  const same = a.hostname === b.hostname && (a.port || '5432') === (b.port || '5432') && decodeURIComponent(a.pathname) === decodeURIComponent(b.pathname)
    && qp(a, 'host') === qp(b, 'host') && qp(a, 'port') === qp(b, 'port') && qp(a, 'hostaddr') === qp(b, 'hostaddr');
  if (!same) throw new Error('AUTH_DATABASE_URL trỏ tới host/cổng/database khác với DATABASE_URL: từ chối (pool xác thực phải cùng database).');
  if (decodeURIComponent(a.username) === decodeURIComponent(b.username)) throw new Error('AUTH_DATABASE_URL dùng cùng tài khoản với DATABASE_URL: không có cách ly, từ chối. Dùng siscom_auth (B1.3_S1_AUTH_ROLE.sql.txt).');
  return { url: auth, source: 'AUTH_DATABASE_URL', separate: true };
}

function parse(url: string, name: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(name + ' sai định dạng (mật khẩu chứa ký tự đặc biệt chưa mã hoá URL?).'); }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new Error(name + ' phải bắt đầu bằng postgresql://');
  if (!u.username) throw new Error(name + ' thiếu tên tài khoản.');
  if (u.pathname.length < 2) throw new Error(name + ' thiếu tên database.');
  return u;
}
