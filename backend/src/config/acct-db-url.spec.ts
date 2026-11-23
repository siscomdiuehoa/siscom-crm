import { pickAcctDbUrl } from './acct-db-url';

// P1: pool QUẢN LÝ TÀI KHOẢN (role siscom_acct) qua ACCT_DATABASE_URL. Thiếu biến = chức năng chưa bật (null, module accounts trả 503);
// đặt sai = từ chối khởi động (fail-closed), cùng quy tắc với AUTH_DATABASE_URL.
const APP = 'postgresql://siscom_app:a@127.0.0.1:5432/siscom_crm_test_20260101_000000';
const AUTH = 'postgresql://siscom_auth:b@127.0.0.1:5432/siscom_crm_test_20260101_000000';
const ACCT = 'postgresql://siscom_acct:c@127.0.0.1:5432/siscom_crm_test_20260101_000000';

describe('pickAcctDbUrl', () => {
  it('thiếu biến hoặc chỉ có khoảng trắng => null (chưa bật, không phải lỗi)', () => {
    expect(pickAcctDbUrl({ DATABASE_URL: APP })).toBeNull();
    expect(pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: '' })).toBeNull();
    expect(pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: '   ' })).toBeNull();
  });
  it('URL hợp lệ cùng database, khác tài khoản => trả nguyên (đã cắt khoảng trắng)', () => {
    expect(pickAcctDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH, ACCT_DATABASE_URL: ' ' + ACCT + ' ' })).toBe(ACCT);
  });
  it('cùng tài khoản với pool nghiệp vụ hoặc pool xác thực => từ chối (không có cách ly)', () => {
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: APP })).toThrow(/ACCT_DATABASE_URL/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH, ACCT_DATABASE_URL: AUTH })).toThrow(/ACCT_DATABASE_URL/);
  });
  it('trỏ database / host / cổng khác => từ chối', () => {
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT.replace('000000', '000001') })).toThrow(/khác/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT.replace('127.0.0.1', '10.0.0.5') })).toThrow(/khác/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT.replace(':5432', ':5433') })).toThrow(/khác/);
  });
  it('tài khoản postgres / siscom_migrator, mật khẩu mẫu, tham số ghi đè, sai định dạng => từ chối', () => {
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT.replace('siscom_acct', 'postgres') })).toThrow(/postgres/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT.replace('siscom_acct', 'siscom_migrator') })).toThrow(/siscom_migrator/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT.replace(':c@', ':CHANGE_ME@') })).toThrow(/mẫu/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT + '?user=siscom_migrator' })).toThrow(/user/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT + '?options=-c%20x' })).toThrow(/options/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: 'khong-phai-url' })).toThrow(/định dạng/);
    expect(() => pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: 'mysql://a:b@127.0.0.1/x' })).toThrow(/postgresql/);
  });
  it('thông báo lỗi không chứa mật khẩu', () => {
    const secret = ['gia', 'tri', 'gia', 'khong', 'duoc', 'lo', '123'].join('-'); // giá trị GIẢ, ghép lúc chạy (không phải bí mật)
    let msg = '';
    try { pickAcctDbUrl({ DATABASE_URL: APP, ACCT_DATABASE_URL: ACCT.replace(':c@', ':' + secret + '@').replace('127.0.0.1', '10.9.9.9') }); } catch (e) { msg = String((e as Error).message); }
    expect(msg).not.toBe('');
    expect(msg).not.toContain(secret);
  });
});
