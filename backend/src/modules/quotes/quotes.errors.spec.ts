// Báo giá Q5 — đổi lỗi DB thành mã lỗi API cố định (docs/QUOTES_DESIGN.md mục 7.2, mục 19 điểm 5). Kiểm thuần với các hình dạng lỗi
// mà Prisma 7 + adapter-pg có thể trả: trường constraint của lỗi gốc, thông điệp mở đầu bằng mã của trigger, tên chỉ mục duy nhất.
import { quoteConstraintOf, quoteDbError } from './quotes.errors';

const adapter = (originalCode: string, constraint?: string, originalMessage?: string) => ({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode, constraint, originalMessage } } } });

describe('quoteConstraintOf', () => {
  it('đọc trường constraint do trigger đặt; rơi về thông điệp; rơi về tên chỉ mục trong meta.target', () => {
    expect(quoteConstraintOf(adapter('23001', 'QUOTE_VERSION_LOCKED'))).toBe('QUOTE_VERSION_LOCKED');
    expect(quoteConstraintOf(adapter('23001', undefined, 'QUOTE_DELETE_FORBIDDEN: bao gia BG-0001 da co phien ban da gui - khong xoa.'))).toBe('QUOTE_DELETE_FORBIDDEN');
    expect(quoteConstraintOf({ code: 'P2002', meta: { target: ['uq_quote_version_one_draft'] } })).toBe('uq_quote_version_one_draft');
    expect(quoteConstraintOf({ message: 'something else' })).toBeNull();
  });
});

describe('quoteDbError', () => {
  it('mã trigger / chỉ mục đã biết => mã API cố định', () => {
    expect(quoteDbError(adapter('23001', 'QUOTE_VERSION_LOCKED'))?.code).toBe('QUOTE_VERSION_LOCKED');
    expect(quoteDbError(adapter('23505', 'uq_quote_version_one_draft'))?.code).toBe('QUOTE_DRAFT_EXISTS');
    expect(quoteDbError(adapter('23505', 'uq_quote_version_accepted_opportunity'))?.code).toBe('QUOTE_ALREADY_ACCEPTED');
    expect(quoteDbError(adapter('23001', 'QUOTE_ALREADY_ACCEPTED'))?.code).toBe('QUOTE_ALREADY_ACCEPTED');
    expect(quoteDbError(adapter('23001', 'QUOTE_DELETE_FORBIDDEN'))?.code).toBe('QUOTE_DELETE_FORBIDDEN');
  });
  it('khoá chờ quá hạn / xung đột tuần tự / khoá chéo => 409 QUOTE_BUSY', () => {
    for (const st of ['55P03', '40001', '40P01']) expect(quoteDbError(adapter(st))?.code).toBe('QUOTE_BUSY');
  });
  it('vi phạm ràng buộc khác => 409 CONSTRAINT_CONFLICT, thông điệp không chứa tên ràng buộc hay nội dung PostgreSQL', () => {
    const e = quoteDbError(adapter('23514', 'ck_qv_totals', 'new row violates check constraint "ck_qv_totals"'));
    expect(e?.code).toBe('CONSTRAINT_CONFLICT');
    expect(String(e?.message) + JSON.stringify(e?.details ?? null)).not.toMatch(/ck_|constraint|postgres|row/i);
  });
  it('lỗi không phải của DB => null (để nguyên, thành 500 chung)', () => {
    expect(quoteDbError(new Error('boom'))).toBeNull();
  });
});
