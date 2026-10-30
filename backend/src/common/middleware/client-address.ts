import { isIP } from 'node:net';
import type { Request } from 'express';

// Địa chỉ nguồn của yêu cầu, dùng cho hạn mức đăng nhập/đổi mật khẩu và tiền tố IP ghi phiên (B1.4 P1).
// req.ip do Express tính theo cài đặt 'trust proxy' (proxy-addr): false => luôn là địa chỉ socket (X-Forwarded-For bị
// bỏ qua); loopback / số hop => địa chỉ của hop gần nhất KHÔNG được tin, nên phần header do khách tự thêm không có tác dụng.
// Chuẩn hoá: cắt khoảng trắng/tab, bỏ zone id IPv6 (%eth0 — độ dài không giới hạn, không được vào DB), IPv4-mapped
// (::ffff:a.b.c.d) về IPv4 để tiền tố phiên /24 có nghĩa. Giá trị không phải IP hợp lệ (proxy sai cấu hình, header giả)
// => rơi về địa chỉ socket: không đưa chuỗi tuỳ ý vào khoá hạn mức hay nhật ký phiên. Không có gì hợp lệ => 'unknown'/null.
export interface ClientAddress { source: string; ip: string | null }

const V4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

export function normalizeIp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const mapped = V4_MAPPED.exec(s);
  if (mapped) s = mapped[1];
  return isIP(s) !== 0 ? s : null;
}

export function clientAddress(req: Pick<Request, 'ip'> & { socket?: { remoteAddress?: string } }): ClientAddress {
  const ip = normalizeIp(req.ip) ?? normalizeIp(req.socket?.remoteAddress);
  return { source: ip ?? 'unknown', ip };
}
