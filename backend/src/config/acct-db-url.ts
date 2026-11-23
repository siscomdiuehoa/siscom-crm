// P1: pool QUẢN LÝ TÀI KHOẢN riêng (role siscom_acct) qua ACCT_DATABASE_URL — chỉ module accounts dùng. Hàm thuần, không đọc .env,
// không in URL/mật khẩu (thông điệp chỉ nêu TÊN biến).
//   - Thiếu biến (hoặc rỗng): chức năng CHƯA BẬT => null. Module accounts trả 503 ACCOUNT_ADMIN_UNAVAILABLE; phần còn lại chạy bình thường.
//   - Khi đặt: cùng host/cổng/database với DATABASE_URL (chống trỏ nhầm DB), KHÁC tài khoản của pool nghiệp vụ và pool xác thực
//     (cùng tài khoản = không cách ly), không postgres / siscom_migrator, không mật khẩu mẫu. Sai => ném lỗi (từ chối khởi động, fail-closed).
// Cùng quy tắc với config/auth-db-url.ts (pool xác thực).
export function pickAcctDbUrl(env: Record<string, string | undefined>): string | null {
  const acct = (env.ACCT_DATABASE_URL ?? '').trim();
  if (!acct) return null;
  const app = (env.DATABASE_URL ?? '').trim();
  if (!app) throw new Error('Thiếu DATABASE_URL.');
  const a = parse(acct, 'ACCT_DATABASE_URL');
  const b = parse(app, 'DATABASE_URL');
  const user = decodeURIComponent(a.username);
  if (user.toLowerCase() === 'postgres') throw new Error('ACCT_DATABASE_URL không được dùng tài khoản postgres (superuser).');
  if (user.toLowerCase() === 'siscom_migrator') throw new Error('ACCT_DATABASE_URL không được dùng tài khoản siscom_migrator (chủ sở hữu database).');
  if (decodeURIComponent(a.password).includes('CHANGE_ME')) throw new Error('ACCT_DATABASE_URL vẫn là mật khẩu mẫu; sinh mật khẩu ngẫu nhiên trên máy chủ.');
  // pg-connection-string cho ?user= / ?password= / ?dbname= ghi đè phần userinfo/path; ?options= ghi đè TimeZone=UTC. Từ chối các khoá này.
  for (const k of a.searchParams.keys()) {
    if (['user', 'password', 'dbname', 'options'].includes(k.toLowerCase())) throw new Error('ACCT_DATABASE_URL không được chứa tham số "' + k + '" (ghi đè tài khoản/database/options qua chuỗi truy vấn).');
  }
  const qp = (x: URL, k: string): string => x.searchParams.get(k) ?? '';
  const same = a.hostname === b.hostname && (a.port || '5432') === (b.port || '5432') && decodeURIComponent(a.pathname) === decodeURIComponent(b.pathname)
    && qp(a, 'host') === qp(b, 'host') && qp(a, 'port') === qp(b, 'port') && qp(a, 'hostaddr') === qp(b, 'hostaddr');
  if (!same) throw new Error('ACCT_DATABASE_URL trỏ tới host/cổng/database khác với DATABASE_URL: từ chối (pool quản lý tài khoản phải cùng database).');
  if (user === decodeURIComponent(b.username)) throw new Error('ACCT_DATABASE_URL dùng cùng tài khoản với DATABASE_URL: không có cách ly, từ chối. Dùng siscom_acct (B1.5_ACCT_ROLE.sql.txt).');
  const auth = (env.AUTH_DATABASE_URL ?? '').trim();
  if (auth) {
    let authUser = '';
    try { authUser = decodeURIComponent(new URL(auth).username); } catch { authUser = ''; }
    if (authUser && user === authUser) throw new Error('ACCT_DATABASE_URL dùng cùng tài khoản với AUTH_DATABASE_URL: không có cách ly, từ chối. Dùng siscom_acct (B1.5_ACCT_ROLE.sql.txt).');
  }
  return acct;
}

function parse(url: string, name: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(name + ' sai định dạng (mật khẩu chứa ký tự đặc biệt chưa mã hoá URL?).'); }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new Error(name + ' phải bắt đầu bằng postgresql://');
  if (!u.username) throw new Error(name + ' thiếu tên tài khoản.');
  if (u.pathname.length < 2) throw new Error(name + ' thiếu tên database.');
  return u;
}
