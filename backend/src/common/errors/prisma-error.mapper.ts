import { DomainException } from './domain.exception';

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null;
function dig(v: unknown, ...path: string[]): unknown {
  let cur: unknown = v;
  for (const k of path) {
    if (!isDict(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// Nhận diện lỗi do duck-typing (không import Prisma) vì cách Prisma 7 + adapter-pg gắn SQLSTATE/constraint
// vào lỗi CHƯA được kiểm chứng trên máy thật; thử nhiều vị trí, không tìm thấy thì trả null (=> 500 chung).
export function prismaCodeOf(e: unknown): string | undefined {
  const c = dig(e, 'code');
  return typeof c === 'string' && /^P\d{4}$/.test(c) ? c : undefined;
}

export function sqlStateOf(e: unknown): string | undefined {
  const cands = [dig(e, 'meta', 'driverAdapterError', 'cause', 'originalCode'), dig(e, 'meta', 'code'), dig(e, 'cause', 'code'), dig(e, 'originalCode'), dig(e, 'code')];
  for (const c of cands) if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) && !/^P\d{4}$/.test(c)) return c;
  return undefined;
}

// Chỉ dùng để so khớp nội bộ; KHÔNG bao giờ đưa vào phản hồi hay log.
function constraintText(e: unknown): string {
  const parts: string[] = [];
  const t = dig(e, 'meta', 'target');
  if (Array.isArray(t)) parts.push(t.join(','));
  else if (typeof t === 'string') parts.push(t);
  for (const p of [dig(e, 'meta', 'driverAdapterError', 'cause', 'constraint'), dig(e, 'meta', 'constraint'), dig(e, 'meta', 'message'), dig(e, 'message')]) if (typeof p === 'string') parts.push(p);
  return parts.join(' ');
}

export function mapPrismaError(e: unknown): DomainException | null {
  const pc = prismaCodeOf(e);
  const st = sqlStateOf(e);
  if (!pc && !st) return null;
  if (pc === 'P2025') return new DomainException(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.');
  if (st === '55P03' || st === '40001' || st === '40P01') return new DomainException(409, 'CUSTOMER_BUSY', 'Bản ghi đang được xử lý bởi thao tác khác. Vui lòng thử lại.');
  if (pc === 'P2002' || st === '23505') {
    const c = constraintText(e);
    if (/uq_customer_tax_id_active|tax_id/i.test(c)) return new DomainException(409, 'CUSTOMER_DUPLICATE_TAX_ID', 'Mã số thuế đã được dùng bởi một khách hàng khác.');
    if (/uq_contact_primary_active/i.test(c)) return new DomainException(409, 'CONTACT_PRIMARY_CONFLICT', 'Khách hàng đã có người liên hệ chính khác.');
    return new DomainException(409, 'CONSTRAINT_CONFLICT', 'Dữ liệu xung đột với bản ghi đã có.');
  }
  if (pc === 'P2003' || pc === 'P2004' || st === '23503' || st === '23514' || st === '23001') return new DomainException(409, 'CONSTRAINT_CONFLICT', 'Dữ liệu vi phạm ràng buộc của hệ thống.');
  return null;
}
