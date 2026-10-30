import { isIP } from 'node:net';
import type { Request } from 'express';

// Địa chỉ nguồn của yêu cầu, dùng cho hạn mức đăng nhập/đổi mật khẩu và tiền tố IP ghi phiên (B1.4 P1).
// req.ip do Express tính theo cài đặt 'trust proxy' (proxy-addr): false => luôn là địa chỉ socket (X-Forwarded-For bị
// bỏ qua); loopback / số hop => địa chỉ của hop gần nhất KHÔNG được tin, nên phần header do khách tự thêm không có tác dụng.
// Giá trị không phải IP hợp lệ (proxy sai cấu hình, header giả) => rơi về địa chỉ socket: không đưa chuỗi tuỳ ý vào
// khoá hạn mức hay nhật ký phiên. Không có gì hợp lệ => source 'unknown' (chung một bucket), ip null.
export interface ClientAddress { source: string; ip: string | null }

export function clientAddress(req: Pick<Request, 'ip'> & { socket?: { remoteAddress?: string } }): ClientAddress {
  const valid = (v: unknown): string | null => (typeof v === 'string' && isIP(v) !== 0 ? v : null);
  const ip = valid(req.ip) ?? valid(req.socket?.remoteAddress);
  return { source: ip ?? 'unknown', ip };
}
