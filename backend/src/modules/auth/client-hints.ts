// Chỉ lưu tiền tố IP (IPv4 /24, IPv6 /48) để nhận diện phiên/thiết bị bất thường mà không lưu địa chỉ đầy đủ.
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::/48';
  return null;
}
