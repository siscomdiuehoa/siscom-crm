import { pickAuthDbUrl } from './auth-db-url';

// B1.4 P3c: pool xác thực riêng (siscom_auth) qua AUTH_DATABASE_URL. Hàm thuần, không đọc .env, không in URL.
const APP = 'postgresql://siscom_app:x%40y@127.0.0.1:5432/siscom_crm_test_20261031_000000';
const AUTH = 'postgresql://siscom_auth:z@127.0.0.1:5432/siscom_crm_test_20261031_000000';

describe('pickAuthDbUrl (B1.4 P3c)', () => {
  it('có AUTH_DATABASE_URL hợp lệ (cùng host/cổng/database, khác tài khoản) => dùng, separate=true', () => {
    expect(pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH }, 'production')).toEqual({ url: AUTH, source: 'AUTH_DATABASE_URL', separate: true });
    expect(pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: ' ' + AUTH + ' ' }, 'development').url).toBe(AUTH);
    expect(pickAuthDbUrl({ DATABASE_URL: APP + '?schema=public', AUTH_DATABASE_URL: AUTH }, 'test').separate).toBe(true);
  });
  it('ngoài production, thiếu AUTH_DATABASE_URL => rơi về DATABASE_URL (máy Windows chưa tách), separate=false', () => {
    expect(pickAuthDbUrl({ DATABASE_URL: APP }, 'development')).toEqual({ url: APP, source: 'DATABASE_URL', separate: false });
    expect(pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: '' }, 'test').separate).toBe(false);
    expect(pickAuthDbUrl({ DATABASE_URL: APP }, undefined).separate).toBe(false);
  });
  it('production: thiếu AUTH_DATABASE_URL => từ chối (fail-closed, nêu tên biến, không nêu giá trị)', () => {
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP }, 'production')).toThrow(/AUTH_DATABASE_URL/);
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP }, 'production')).not.toThrow(/x%40y/);
  });
  it('AUTH_DATABASE_URL cùng tài khoản với DATABASE_URL => từ chối ở mọi môi trường (không có cách ly)', () => {
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: APP }, 'development')).toThrow(/cùng tài khoản/);
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: APP }, 'production')).toThrow(/cùng tài khoản/);
  });
  it('khác host/cổng/database với DATABASE_URL => từ chối', () => {
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH.replace('5432', '5433') }, 'test')).toThrow(/khác/);
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH.replace('_000000', '_000001') }, 'test')).toThrow(/khác/);
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH + '?host=/tmp' }, 'test')).toThrow(/khác/);
  });
  it('sai định dạng / tài khoản postgres / thiếu DATABASE_URL => từ chối', () => {
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: 'mysql://a@b/c' }, 'test')).toThrow(/postgresql/);
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH.replace('siscom_auth', 'postgres') }, 'test')).toThrow(/postgres/);
    expect(() => pickAuthDbUrl({ AUTH_DATABASE_URL: AUTH }, 'test')).toThrow(/DATABASE_URL/);
  });
});

// QA P3c I-3 / M-1: mật khẩu mẫu và tham số query ghi đè tài khoản/DB (pg-connection-string nhận ?user=, ?password=, ?dbname=) phải bị từ chối.
describe('pickAuthDbUrl — mật khẩu mẫu và tham số query ghi đè', () => {
  it('AUTH_DATABASE_URL còn CHANGE_ME => từ chối (không nêu giá trị)', () => {
    expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH.replace(':z@', ':CHANGE_ME_X@') }, 'test')).toThrow(/mật khẩu mẫu/);
  });
  it('?user= / ?password= / ?dbname= / ?options= trong AUTH_DATABASE_URL => từ chối (ghi đè tài khoản/DB qua query)', () => {
    for (const q of ['user=siscom_app', 'password=x', 'dbname=other', 'options=-c%20TimeZone%3DUTC', 'USER=postgres']) {
      expect(() => pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH + '?' + q }, 'test')).toThrow(/tham số/);
    }
    expect(pickAuthDbUrl({ DATABASE_URL: APP, AUTH_DATABASE_URL: AUTH + '?schema=public&sslmode=require' }, 'test').separate).toBe(true);
  });
});
