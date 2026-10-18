import { makeDecorator } from './make-decorator';

export const PHONE_MESSAGE = 'Số điện thoại chưa hợp lệ: số Việt Nam gồm 10–11 chữ số (bắt đầu 0 hoặc +84); số quốc tế dạng +<mã nước><số>';

// Bản TS của isPhone (frontend util.js): bỏ ' .()-', 00x -> +x, +84 -> 0; VN ^0\d{9,10}$; quốc tế ^\+(?!84)[1-9]\d{7,14}$.
function canonical(s: string): string {
  let p = s.trim().replace(/[\s.()-]/g, '');
  if (/^00[1-9]/.test(p)) p = '+' + p.slice(2);
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  return p;
}
export function isVnPhone(s: string): boolean {
  const p = canonical(s);
  if (/^0\d{9,10}$/.test(p)) return true;
  return /^\+(?!84)[1-9]\d{7,14}$/.test(p);
}
// Dạng chuẩn hoá để lưu phone_e164 (VN: +84...; quốc tế: giữ nguyên). null nếu không hợp lệ.
export function normalizePhoneE164(s: string): string | null {
  if (!isVnPhone(s)) return null;
  const p = canonical(s);
  return p.startsWith('0') ? '+84' + p.slice(1) : p;
}
export const IsVnPhone = makeDecorator('isVnPhone', isVnPhone, PHONE_MESSAGE);
