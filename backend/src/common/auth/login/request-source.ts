// Suy NGUỒN request cho limiter đăng nhập (thuần, KHÔNG I/O, KHÔNG gắn route/guard, KHÔNG kích hoạt khi chạy).
//
// CHƯA CÓ DANH SÁCH PROXY SẢN XUẤT: `trustedProxies` PHẢI do chủ sở hữu/vận hành duyệt rồi truyền tường minh (không có mặc định).
// Danh sách rỗng = KHÔNG BAO GIỜ tin header: nguồn là địa chỉ socket do máy chủ thấy.
//
// Hợp đồng:
// - Đầu vào đáng tin duy nhất là `socketAddress` (do tầng HTTP lấy từ kết nối). Header X-Forwarded-For chỉ được xét khi socket thuộc proxy đáng tin.
// - Khi socket đáng tin: duyệt XFF từ PHẢI sang TRÁI, bỏ qua các proxy đáng tin; phần tử không đáng tin đầu tiên là máy khách.
//   Phần tử trái của nó (có thể do máy khách tự đặt) bị bỏ qua hoàn toàn.
// - Thiếu/sai định dạng/quá dài/chuỗi toàn proxy => source = null (tầng gọi phải TỪ CHỐI, fail-closed), không đoán.
// - Chuẩn hóa: IPv4-mapped IPv6 => IPv4; IPv6 viết đầy đủ chữ thường; có thể gộp theo tiền tố (ipv6PrefixBits). Có tiền tố họ địa chỉ để không trùng khóa.
// - Không bao giờ ném lỗi khi phân giải; không log; chuỗi đầu ra chỉ chứa địa chỉ đã chuẩn hóa (tầng limiter băm nó trước khi lưu/log).
// Giới hạn: không biết số bước nhảy (hop) thực tế; mức gộp IPv6 sản xuất (/64?) và nội dung allowlist là quyết định chính sách, chưa duyệt.

export interface RequestSourceConfig {
  readonly trustedProxies: readonly string[]; // IP hoặc CIDR; [] = không tin header
  readonly ipv6PrefixBits?: number; // 1..128, mặc định 128 (không gộp)
}

export interface RequestSourceInput {
  readonly socketAddress: unknown;
  readonly forwardedFor?: unknown; // giá trị header X-Forwarded-For (chuỗi hoặc mảng chuỗi)
}

export type RequestSource =
  | { readonly source: string; readonly via: 'SOCKET' | 'FORWARDED' }
  | { readonly source: null; readonly reason: 'SOCKET_INVALID' | 'FORWARDED_INVALID' };

interface Addr { readonly v: 4 | 6; readonly n: bigint }

const MAX_HEADER_LEN = 1024;
const MAX_HOPS = 32;

function parseV4(s: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0n;
  for (let i = 1; i <= 4; i++) {
    // Từ chối số 0 đứng đầu (mơ hồ bát phân giữa các bộ phân tích) và > 255.
    if (m[i].length > 1 && m[i].startsWith('0')) return null;
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n << 8n) | BigInt(o);
  }
  return n;
}

function parseV6(raw: string): bigint | null {
  let s = raw;
  const pct = s.indexOf('%'); // zone id (fe80::1%eth0) không thuộc danh tính nguồn
  if (pct >= 0) s = s.slice(0, pct);
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return null;
  let tail = 0n;
  let tailGroups = 0;
  if (s.includes('.')) {
    const k = s.lastIndexOf(':');
    const v4 = parseV4(s.slice(k + 1));
    if (v4 === null) return null;
    tail = v4;
    tailGroups = 2;
    s = `${s.slice(0, k + 1)}0:0`;
  }
  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const toGroups = (p: string) => (p === '' ? [] : p.split(':'));
  const head = toGroups(dbl[0]);
  const rest = dbl.length === 2 ? toGroups(dbl[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (dbl.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(dbl.length === 2 ? fill : 0).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  if (tailGroups) n = (n & ~0xffffffffn) | tail;
  return n;
}

// IPv4-mapped (::ffff:a.b.c.d) => IPv4 để cùng một máy không có hai danh tính.
function parseAddr(raw: unknown): Addr | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length === 0 || s.length > 64) return null;
  const v4 = parseV4(s);
  if (v4 !== null) return { v: 4, n: v4 };
  const v6 = parseV6(s);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) return { v: 4, n: v6 & 0xffffffffn };
  return { v: 6, n: v6 };
}

interface Cidr { readonly addr: Addr; readonly bits: number }

function parseCidr(raw: string): Cidr | null {
  const [ip, len, extra] = raw.split('/');
  if (extra !== undefined) return null;
  const a = parseAddr(ip);
  if (!a) return null;
  const max = a.v === 4 ? 32 : 128;
  if (len === undefined) return { addr: a, bits: max };
  if (!/^\d{1,3}$/.test(len)) return null;
  const bits = Number(len);
  return bits <= max ? { addr: a, bits } : null;
}

const maskOf = (v: 4 | 6, bits: number): bigint => {
  const w = v === 4 ? 32n : 128n;
  return bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << (w - BigInt(bits));
};

function inCidr(a: Addr, c: Cidr): boolean {
  if (a.v !== c.addr.v) return false;
  const m = maskOf(a.v, c.bits);
  return (a.n & m) === (c.addr.n & m);
}

function hex6(n: bigint): string {
  const parts: string[] = [];
  for (let i = 7; i >= 0; i--) parts.push(((n >> BigInt(i * 16)) & 0xffffn).toString(16).padStart(4, '0'));
  return parts.join(':');
}

export class RequestSourceResolver {
  private readonly proxies: readonly Cidr[];
  private readonly v6Bits: number;

  constructor(config: RequestSourceConfig) {
    if (!config || !Array.isArray(config.trustedProxies)) {
      throw new Error('REQUEST_SOURCE_CONFIG_REQUIRED: cần trustedProxies (mảng IP/CIDR do vận hành duyệt; [] = không tin header)');
    }
    const list: Cidr[] = [];
    for (const p of config.trustedProxies) {
      const c = typeof p === 'string' ? parseCidr(p) : null;
      if (!c) throw new Error('REQUEST_SOURCE_CONFIG_INVALID: mục trustedProxies không phải IP/CIDR hợp lệ');
      if (c.bits === 0) throw new Error('REQUEST_SOURCE_CONFIG_INVALID: không chấp nhận CIDR /0 (tin mọi nguồn)');
      list.push(c);
    }
    const bits = config.ipv6PrefixBits ?? 128;
    if (!Number.isInteger(bits) || bits < 1 || bits > 128) throw new Error('REQUEST_SOURCE_CONFIG_INVALID: ipv6PrefixBits phải là số nguyên 1..128');
    this.proxies = list;
    this.v6Bits = bits;
  }

  resolve(input: RequestSourceInput): RequestSource {
    try {
      const sock = parseAddr(input?.socketAddress);
      if (!sock) return { source: null, reason: 'SOCKET_INVALID' };
      if (!this.isTrusted(sock)) return { source: this.format(sock), via: 'SOCKET' };

      const hops = this.parseForwarded(input.forwardedFor);
      if (!hops) return { source: null, reason: 'FORWARDED_INVALID' };
      for (let i = hops.length - 1; i >= 0; i--) {
        if (!this.isTrusted(hops[i])) return { source: this.format(hops[i]), via: 'FORWARDED' };
      }
      return { source: null, reason: 'FORWARDED_INVALID' }; // toàn proxy: không có máy khách xác định được
    } catch {
      return { source: null, reason: 'SOCKET_INVALID' };
    }
  }

  private isTrusted(a: Addr): boolean {
    return this.proxies.some((c) => inCidr(a, c));
  }

  private parseForwarded(h: unknown): Addr[] | null {
    const joined = Array.isArray(h) ? h.join(',') : h;
    if (typeof joined !== 'string' || joined.length === 0 || joined.length > MAX_HEADER_LEN) return null;
    const parts = joined.split(',');
    if (parts.length > MAX_HOPS) return null;
    const out: Addr[] = [];
    for (const p of parts) {
      const a = parseAddr(p);
      if (!a) return null; // một phần tử hỏng làm hỏng cả chuỗi (không "bỏ qua rồi đoán")
      out.push(a);
    }
    return out;
  }

  private format(a: Addr): string {
    if (a.v === 4) return `ip4:${[24n, 16n, 8n, 0n].map((s) => Number((a.n >> s) & 0xffn)).join('.')}`;
    const keep = maskOf(6, this.v6Bits);
    return `ip6:${hex6(a.n & keep)}/${this.v6Bits}`;
  }
}
