import { HttpException } from '@nestjs/common';
import { LoginAbusePolicy, LoginAbuseStore, ThrottledPasswordLogin } from './login-abuse.policy';
import { PasswordLoginService } from './password-login.service';
import { CredentialStore, PasswordHasher } from './password-login.types';
import { RequestSource, RequestSourceResolver } from './request-source';

// CHỈ test offline: không Nest, không DB, không mạng. Địa chỉ dùng dải tài liệu (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32).
const PROXY = '10.0.0.0/8';
const via = (r: RequestSource) => ('via' in r ? r.via : 'NONE');
const mk = (proxies: string[] = [PROXY], ipv6PrefixBits?: number) => new RequestSourceResolver({ trustedProxies: proxies, ipv6PrefixBits });

describe('RequestSourceResolver — cấu hình bắt buộc, không mặc định', () => {
  it.each([[undefined], [{}], [{ trustedProxies: 'x' }], [{ trustedProxies: ['không-phải-ip'] }], [{ trustedProxies: ['10.0.0.0/33'] }],
    [{ trustedProxies: ['0.0.0.0/0'] }], [{ trustedProxies: ['::/0'] }], [{ trustedProxies: ['10.0.0.1/8/8'] }], [{ trustedProxies: [5] }],
    [{ trustedProxies: [], ipv6PrefixBits: 0 }], [{ trustedProxies: [], ipv6PrefixBits: 129 }], [{ trustedProxies: [], ipv6PrefixBits: 64.5 }],
  ])('cấu hình sai => ném lỗi (%j)', (cfg) => {
    expect(() => new RequestSourceResolver(cfg as never)).toThrow(/REQUEST_SOURCE_CONFIG/);
  });
  it('mảng rỗng hợp lệ (= không tin header)', () => {
    expect(() => mk([])).not.toThrow();
  });
});

describe('RequestSourceResolver — nguồn không đáng tin: bỏ qua header', () => {
  it('socket ngoài allowlist + XFF giả => nguồn là socket, header bị bỏ qua', () => {
    expect(mk().resolve({ socketAddress: '203.0.113.9', forwardedFor: '198.51.100.1' })).toEqual({ source: 'ip4:203.0.113.9', via: 'SOCKET' });
  });
  it('allowlist rỗng: ngay cả socket 10.x cũng không được tin', () => {
    expect(mk([]).resolve({ socketAddress: '10.1.2.3', forwardedFor: '198.51.100.1' })).toEqual({ source: 'ip4:10.1.2.3', via: 'SOCKET' });
  });
  it('hai máy khách khác nhau từ xa không thể chung hoặc mạo danh khóa nhau bằng XFF', () => {
    const r = mk();
    const a = r.resolve({ socketAddress: '203.0.113.1', forwardedFor: '8.8.8.8' });
    const b = r.resolve({ socketAddress: '203.0.113.2', forwardedFor: '8.8.8.8' });
    expect(a.source).not.toBe(b.source);
  });
  it('XFF rác không ảnh hưởng khi socket không đáng tin', () => {
    expect(mk().resolve({ socketAddress: '203.0.113.9', forwardedFor: '<script>,,%%' })).toEqual({ source: 'ip4:203.0.113.9', via: 'SOCKET' });
  });
});

describe('RequestSourceResolver — proxy đáng tin: duyệt XFF từ phải sang trái', () => {
  it('lấy phần tử không đáng tin đầu tiên từ bên phải', () => {
    expect(mk().resolve({ socketAddress: '10.0.0.5', forwardedFor: '198.51.100.7' })).toEqual({ source: 'ip4:198.51.100.7', via: 'FORWARDED' });
    expect(mk().resolve({ socketAddress: '10.0.0.5', forwardedFor: '198.51.100.7, 10.0.0.9' })).toEqual({ source: 'ip4:198.51.100.7', via: 'FORWARDED' });
  });
  it('phần tử bên trái do máy khách tự đặt bị bỏ qua (chống giả mạo chèn)', () => {
    const r = mk().resolve({ socketAddress: '10.0.0.5', forwardedFor: '1.1.1.1, 2.2.2.2, 198.51.100.7' });
    expect(r).toEqual({ source: 'ip4:198.51.100.7', via: 'FORWARDED' });
  });
  it('nhiều giá trị header (mảng) được ghép đúng thứ tự', () => {
    expect(mk().resolve({ socketAddress: '10.0.0.5', forwardedFor: ['1.1.1.1', '198.51.100.7, 10.0.0.9'] })).toEqual({ source: 'ip4:198.51.100.7', via: 'FORWARDED' });
  });
  it.each([
    ['thiếu header', undefined], ['rỗng', ''], ['không phải chuỗi', 42], ['phần tử hỏng', '198.51.100.7, abc'],
    ['phần tử rỗng', '198.51.100.7,,10.0.0.9'], ['toàn proxy', '10.0.0.2, 10.0.0.3'], ['quá dài', '1.1.1.1,'.repeat(200)],
    ['quá nhiều bước', Array<string>(33).fill('198.51.100.7').join(',')], ['số 0 đứng đầu', '198.051.100.7'],
    ['kèm cổng', '198.51.100.7:443'], ['hex/thập phân', '0xC6336407'],
  ])('XFF %s từ proxy đáng tin => source=null (fail-closed)', (_n, h) => {
    expect(mk().resolve({ socketAddress: '10.0.0.5', forwardedFor: h })).toEqual({ source: null, reason: 'FORWARDED_INVALID' });
  });
});

describe('RequestSourceResolver — chuẩn hóa IPv4/IPv6', () => {
  it.each([undefined, null, '', 'abc', 123, '999.1.1.1', '1.2.3', '1.2.3.4.5', '010.0.0.1', '::g', ':::', '1::2::3', '1:2:3:4:5:6:7:8:9'])(
    'socket không hợp lệ %p => SOCKET_INVALID', (s) => {
      expect(mk().resolve({ socketAddress: s })).toEqual({ source: null, reason: 'SOCKET_INVALID' });
    });
  it('IPv4-mapped IPv6 trùng danh tính với IPv4 thuần', () => {
    const r = mk();
    expect(r.resolve({ socketAddress: '::ffff:203.0.113.9' }).source).toBe('ip4:203.0.113.9');
    expect(r.resolve({ socketAddress: '::FFFF:cb00:7109' }).source).toBe('ip4:203.0.113.9');
    expect(r.resolve({ socketAddress: '203.0.113.9' }).source).toBe('ip4:203.0.113.9');
  });
  it('các cách viết IPv6 khác nhau của cùng một địa chỉ chuẩn hóa về một chuỗi', () => {
    const r = mk();
    const forms = ['2001:db8::1', '2001:DB8:0:0:0:0:0:1', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:0::1'];
    expect(new Set(forms.map((f) => r.resolve({ socketAddress: f }).source)).size).toBe(1);
    expect(r.resolve({ socketAddress: '2001:db8::1' }).source).toBe('ip6:2001:0db8:0000:0000:0000:0000:0000:0001/128');
  });
  it('zone id bị loại; loopback ::1 hợp lệ', () => {
    expect(mk().resolve({ socketAddress: 'fe80::1%eth0' }).source).toBe(mk().resolve({ socketAddress: 'fe80::1' }).source);
    expect(mk().resolve({ socketAddress: '::1' }).source).toBe('ip6:0000:0000:0000:0000:0000:0000:0000:0001/128');
  });
  it('họ địa chỉ có tiền tố riêng: IPv4 không trùng khóa với IPv6', () => {
    const r = mk();
    expect(r.resolve({ socketAddress: '1.2.3.4' }).source).not.toBe(r.resolve({ socketAddress: '::102:304' }).source);
  });
  it('ipv6PrefixBits gộp theo tiền tố; mặc định 128 không gộp', () => {
    const exact = mk();
    const a = '2001:db8:1:2::1', b = '2001:db8:1:2::2', c = '2001:db8:1:3::1';
    expect(exact.resolve({ socketAddress: a }).source).not.toBe(exact.resolve({ socketAddress: b }).source);
    const p64 = mk([PROXY], 64);
    expect(p64.resolve({ socketAddress: a }).source).toBe(p64.resolve({ socketAddress: b }).source);
    expect(p64.resolve({ socketAddress: a }).source).not.toBe(p64.resolve({ socketAddress: c }).source);
  });
  it('allowlist IPv6 CIDR và IPv4-mapped: proxy ::ffff:10.0.0.5 khớp 10.0.0.0/8', () => {
    expect(mk().resolve({ socketAddress: '::ffff:10.0.0.5', forwardedFor: '198.51.100.7' }).source).toBe('ip4:198.51.100.7');
    const r6 = mk(['2001:db8:ffff::/48']);
    expect(r6.resolve({ socketAddress: '2001:db8:ffff:1::5', forwardedFor: '2001:db8:1::9' })).toEqual({ source: 'ip6:2001:0db8:0001:0000:0000:0000:0000:0009/128', via: 'FORWARDED' });
    expect(via(r6.resolve({ socketAddress: '2001:db8:fffe::5', forwardedFor: '2001:db8:1::9' }))).toBe('SOCKET');
  });
  it('ranh giới CIDR: 10.255.255.255 trong /8, 11.0.0.0 ngoài', () => {
    expect(via(mk().resolve({ socketAddress: '10.255.255.255', forwardedFor: '198.51.100.7' }))).toBe('FORWARDED');
    expect(via(mk().resolve({ socketAddress: '11.0.0.0', forwardedFor: '198.51.100.7' }))).toBe('SOCKET');
  });
  it('không ném lỗi với đầu vào bất thường (null/đối tượng)', () => {
    expect(() => mk().resolve(null as never)).not.toThrow();
    expect(mk().resolve({ socketAddress: {} })).toEqual({ source: null, reason: 'SOCKET_INVALID' });
  });
});

// ---- Bộ điều hợp handler CHỈ TRONG TEST: socket + header -> resolver -> ThrottledPasswordLogin -> PasswordLoginService (credential giả) ----
class MemoryStore implements LoginAbuseStore {
  readonly keys: string[] = [];
  down = false;
  private readonly c = new Map<string, number>();
  async hit(key: string): Promise<number> {
    if (this.down) throw new Error('store down 10.9.9.9');
    this.keys.push(key);
    this.c.set(key, (this.c.get(key) ?? 0) + 1);
    return this.c.get(key)!;
  }
}
const hasher: PasswordHasher = { verify: async (hash, pw) => hash === 'H' && pw === 'dung-mat-khau' };

function boot(opts: { max?: number; proxies?: string[] } = {}) {
  const store = new MemoryStore();
  const logs: string[] = [];
  const lookups: unknown[] = [];
  const creds: CredentialStore = {
    findByIdentifier: async (id) => { lookups.push(id); return id.kind === 'EMPLOYEE_CODE' && id.value === 'NV-0007' ? { employeeId: '00000000-0000-4000-8000-000000000007', hash: 'H', algo: 'argon2id', active: true } : null; },
  };
  const policy = new LoginAbusePolicy({
    config: { windowMs: 10_000, maxPerSource: opts.max ?? 3, maxPerSourceIdentifier: opts.max ?? 3 }, // số giả CHỈ cho test
    store, keyHasher: (m) => `k${[...m].reduce((a, c) => (a * 131 + c.charCodeAt(0)) >>> 0, 7)}`,
    now: () => 1_000, log: { warn: (e, f) => logs.push(e + JSON.stringify(f)) },
  });
  const throttled = new ThrottledPasswordLogin(policy, new PasswordLoginService(creds, hasher));
  const resolver = new RequestSourceResolver({ trustedProxies: opts.proxies ?? [PROXY] });
  // Bộ điều hợp: trả mã HTTP mô phỏng. Không có nguồn xác định => 429 (từ chối trước khi tra credential).
  const attempt = async (socketAddress: string, xff: string | undefined, login: string, password: string) => {
    const s = resolver.resolve({ socketAddress, forwardedFor: xff });
    try {
      await throttled.verify({ source: s.source, login, password });
      return 200;
    } catch (e) {
      if (e instanceof HttpException) return e.getStatus();
      throw e;
    }
  };
  return { store, logs, lookups, attempt };
}

describe('Bộ điều hợp handler (test-only) + limiter theo nguồn đã suy ra — zero DB', () => {
  it('mật khẩu đúng 200, sai 401, vượt ngưỡng 429 theo cùng nguồn', async () => {
    const f = boot({ max: 3 });
    expect(await f.attempt('203.0.113.9', undefined, 'NV-0007', 'dung-mat-khau')).toBe(200);
    expect(await f.attempt('203.0.113.9', undefined, 'NV-0007', 'sai')).toBe(401);
    expect(await f.attempt('203.0.113.9', undefined, 'NV-0007', 'dung-mat-khau')).toBe(200);
    const before = f.lookups.length;
    expect(await f.attempt('203.0.113.9', undefined, 'NV-0007', 'dung-mat-khau')).toBe(429);
    expect(f.lookups).toHaveLength(before); // bị chặn TRƯỚC khi tra credential
  });
  it('khách ngoài đổi XFF mỗi lần KHÔNG né được ngưỡng (header bị bỏ qua)', async () => {
    const f = boot({ max: 2 });
    const codes: number[] = [];
    for (let i = 1; i <= 4; i++) codes.push(await f.attempt('203.0.113.9', `198.51.100.${i}`, 'NV-0007', 'sai'));
    expect(codes).toEqual([401, 401, 429, 429]);
  });
  it('sau proxy đáng tin: kẻ tấn công bị khóa riêng, người dùng khác cùng proxy vẫn đăng nhập được (không 429 mọi người)', async () => {
    const f = boot({ max: 2 });
    for (let i = 0; i < 3; i++) await f.attempt('10.0.0.5', '198.51.100.7', 'NV-0007', 'sai');
    expect(await f.attempt('10.0.0.5', '198.51.100.7', 'NV-0007', 'dung-mat-khau')).toBe(429);
    expect(await f.attempt('10.0.0.5', '198.51.100.8', 'NV-0007', 'dung-mat-khau')).toBe(200);
  });
  it('ĐỐI CHỨNG lỗi gốc: nếu dùng địa chỉ socket của proxy làm nguồn, một kẻ tấn công khóa mọi người sau proxy', async () => {
    const f = boot({ max: 2, proxies: [] }); // không tin header => nguồn = IP proxy chung
    for (let i = 0; i < 3; i++) await f.attempt('10.0.0.5', '198.51.100.7', 'NV-0007', 'sai');
    expect(await f.attempt('10.0.0.5', '198.51.100.8', 'NV-0007', 'dung-mat-khau')).toBe(429);
  });
  it('không xác định được nguồn (XFF hỏng từ proxy) => 429 và không tra credential', async () => {
    const f = boot();
    expect(await f.attempt('10.0.0.5', undefined, 'NV-0007', 'dung-mat-khau')).toBe(429);
    expect(await f.attempt('10.0.0.5', 'rác', 'NV-0007', 'dung-mat-khau')).toBe(429);
    expect(await f.attempt('khong-ip', undefined, 'NV-0007', 'dung-mat-khau')).toBe(429);
    expect(f.lookups).toHaveLength(0);
    expect(f.store.keys).toHaveLength(0);
  });
  it('kho limiter lỗi => 429 fail-closed, không tra credential', async () => {
    const f = boot();
    f.store.down = true;
    expect(await f.attempt('203.0.113.9', undefined, 'NV-0007', 'dung-mat-khau')).toBe(429);
    expect(f.lookups).toHaveLength(0);
  });
  it('khóa kho + log không chứa IP (IPv4/IPv6, cả trong XFF), mã NV hay mật khẩu thô', async () => {
    const f = boot({ max: 1 });
    await f.attempt('203.0.113.9', undefined, 'NV-0007', 'mat-khau-bi-mat-123');
    await f.attempt('203.0.113.9', undefined, 'NV-0007', 'mat-khau-bi-mat-123');
    await f.attempt('10.0.0.5', '2001:db8::77', 'NV-0007', 'mat-khau-bi-mat-123');
    await f.attempt('10.0.0.5', '2001:db8::77', 'NV-0007', 'mat-khau-bi-mat-123');
    await f.attempt('khong-ip', undefined, 'NV-0007', 'mat-khau-bi-mat-123');
    const dump = JSON.stringify(f.store.keys) + f.logs.join('');
    expect(f.logs.length).toBeGreaterThan(0);
    for (const raw of ['203.0.113.9', '10.0.0.5', '2001:db8', '0077', 'NV-0007', 'mat-khau-bi-mat-123', 'ip4:', 'ip6:']) expect(dump).not.toContain(raw);
  });
  it('IPv4-mapped và IPv4 thuần dùng chung một hạn mức (không né ngưỡng bằng đổi cách viết)', async () => {
    const f = boot({ max: 2 });
    const codes = [
      await f.attempt('203.0.113.9', undefined, 'NV-0007', 'sai'),
      await f.attempt('::ffff:203.0.113.9', undefined, 'NV-0007', 'sai'),
      await f.attempt('::FFFF:cb00:7109', undefined, 'NV-0007', 'sai'),
    ];
    expect(codes).toEqual([401, 401, 429]);
  });
});
